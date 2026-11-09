import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { cp, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { parseAppScreensManifest, resolveAppScreensManifest } from "@bg/shared";
import { parseProjectInput, ProjectInputError } from "../src/routes/home-project-input";
import { parseStoredProjectOptions } from "../src/services/project-options";
import { createProjectRecord, getProjectDetail } from "../src/db/seed";
import { getSqlite } from "../src/db/sqlite-client";
import { runMigrationsFrom } from "../src/db/migrate";
import { buildPrompt, resolveDeliverable } from "../src/harness/prompt-builder";
import { ensureLearningSchema } from "./learning-fixture";

test.each([
  [undefined, { width: 390, height: 844 }],
  [{ width: 1440, height: 900 }, { width: 1440, height: 900 }],
] as const)("Given creation frame %j When creating Then options and initial manifest round-trip to %j", async (chosen, frame) => {
  const parsed = parseProjectInput({
    name: "App", type: "app_screens", design_system_id: null, backend_id: "codex",
    ...(chosen === undefined ? {} : { options: { app_screens_frame: chosen } }),
  });
  const created = await createProjectRecord({ ...parsed, thumbnailPath: null });
  try {
    const stored = await getProjectDetail(created.id);
    expect(stored?.type).toBe("app_screens");
    expect(parseStoredProjectOptions(stored?.options_json ?? null).app_screens_frame).toEqual(frame);
    const manifest = parseAppScreensManifest(await readFile(path.join(created.dir_path, "screens.json"), "utf8"), ["screens/start.html"]);
    expect(manifest.frame).toEqual(frame);
    expect(manifest.sections[0]?.screens).toEqual([{ file: "screens/start.html", title: "start" }]);
    expect(created.entrypoint).toBe("screens/start.html");
    expect(await readFile(path.join(created.dir_path, created.entrypoint), "utf8")).toContain(`width:${frame.width}px;height:${frame.height}px`);
  } finally {
    getSqlite().query("DELETE FROM projects WHERE id=?").run(created.id);
    await rm(created.dir_path, { recursive: true, force: true });
  }
});

test("Given malformed frame geometry When parsing creation Then the request is refused", () => {
  expect(() => parseProjectInput({ name: "App", type: "app_screens", design_system_id: null, backend_id: "codex", options: { app_screens_frame: { width: 0, height: 844 } } })).toThrow(ProjectInputError);
});

test.each(["compact", "full"] as const)("Given App screens in %s mode When building a prompt Then the chosen frame contract routes to its own skill", async (contextMode) => {
  ensureLearningSchema(getSqlite());
  const prompt = await buildPrompt({
    project: { project_id: "app-screens-prompt", project_name: "App", project_type: "app_screens", project_dir: "/tmp/app-screens-prompt", entrypoint: "screens/start.html", options_json: JSON.stringify({ app_screens_frame: { width: 1440, height: 900 } }) },
    files: [], attachments: [], designSystem: null, openComments: [],
  }, { type: "user.message", text: "Build a diagram of the screen flow", active_rel_path: "screens/pair.html" }, { contextMode });
  const encoded = prompt.match(/<burnguard-app-screens-v1>\n([^\n]+)\n<\/burnguard-app-screens-v1>/u)?.[1];
  expect(encoded === undefined ? null : JSON.parse(encoded)).toEqual({ schema_version: 1, frame: { width: 1440, height: 900 }, manifest: "screens.json", directory: "screens", active_file: "screens/pair.html" });
  expect(resolveDeliverable("app_screens", "Build a diagram")).toBe("app_screens");
});

test("Given a pre-0028 database When migrated Then all project bytes, child rows and indexes survive and App screens is accepted", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "bg-app-screens-migration-"));
  const source = path.join(import.meta.dir, "../src/db/migrations");
  const db = new Database(":memory:");
  try {
    for (const file of (await readdir(source)).filter((file) => file.endsWith(".sql") && file < "0028")) {
      await cp(path.join(source, file), path.join(directory, file));
    }
    await runMigrationsFrom(db, directory);
    db.exec("INSERT INTO projects(id,name,type,dir_path,backend_id,created_at,updated_at,options_json,current_revision,current_digest,missing_design_system_ref) VALUES ('p','Existing','prototype','/tmp/p','codex',1,2,'{\"kept\":true}',7,'digest','missing')");
    db.exec("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES ('s','p','codex','idle',1,2,2)");
    const before = db.query("SELECT * FROM projects WHERE id='p'").get();
    await cp(path.join(source, "0028_app_screens_project_type.sql"), path.join(directory, "0028_app_screens_project_type.sql"));
    await runMigrationsFrom(db, directory);
    expect(db.query("SELECT * FROM projects WHERE id='p'").get()).toEqual(before);
    expect(db.query("SELECT id,project_id FROM sessions").all()).toEqual([{ id: "s", project_id: "p" }]);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.query("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='projects' ORDER BY name").all()).toEqual([{ name: "idx_projects_ds" }, { name: "idx_projects_updated" }, { name: "sqlite_autoindex_projects_1" }]);
    expect(() => db.exec("INSERT INTO projects(id,name,type,dir_path,backend_id,created_at,updated_at) VALUES ('a','App','app_screens','/tmp/a','codex',1,1)")).not.toThrow();
    expect(() => db.exec("INSERT INTO projects(id,name,type,dir_path,backend_id,created_at,updated_at) VALUES ('b','Bad','unknown','/tmp/b','codex',1,1)")).toThrow();
  } finally {
    db.close();
    await rm(directory, { recursive: true, force: true });
  }
});

const files = ["screens/b.html", "screens/a.html", "index.html"];
const valid = {
  schema_version: 1, frame: { width: 1440, height: 900 },
  sections: [{ id: "main", name: "Main", screens: [
    { file: "screens/b.html", title: "B" },
    { file: "screens/missing.html", title: "Not generated yet" },
    { file: "screens/a.html", title: "A" },
  ] }],
};

describe("App screens manifest", () => {
  test("Given an ordered manifest When parsing Then only known screens retain their section and order", () => {
    expect(parseAppScreensManifest(JSON.stringify(valid), files)).toEqual({
      ...valid, sections: [{ id: "main", name: "Main", screens: [
        { file: "screens/b.html", title: "B" }, { file: "screens/a.html", title: "A" },
      ] }],
    });
  });
  test.each([null, "{", { ...valid, schema_version: 2 }, { ...valid, frame: { width: -1, height: 900 } }])(
    "Given a missing or invalid manifest %j When resolving Then phone frames and sorted files recover",
    (input) => {
      expect(resolveAppScreensManifest(input, files)).toEqual({
        schema_version: 1, frame: { width: 390, height: 844 },
        sections: [{ id: "screens", name: "Screens", screens: [
          { file: "screens/a.html", title: "a" }, { file: "screens/b.html", title: "b" },
        ] }],
      });
    },
  );
  test.each(["../a.html", "pages/a.html", "/screens/a.html", "screens/../a.html", "screens/./a.html", "screens\\a.html", "screens/a.js", "screens/%2e%2e/a.html", "screens/a.html#x", "screens//a.html"])(
    "Given an unsafe file %s When parsing Then the manifest is rejected",
    (file) => {
      expect(() => parseAppScreensManifest({ ...valid, sections: [{ id: "main", name: "Main", screens: [{ file, title: "Unsafe" }] }] }, files)).toThrow();
    },
  );
  test("Given duplicate unknown files When parsing Then duplicates are rejected before filtering", () => {
    expect(() => parseAppScreensManifest({ ...valid, sections: [
      { id: "main", name: "Main", screens: [{ file: "screens/missing.html", title: "A" }, { file: "screens/MISSING.html", title: "B" }] },
    ] }, files)).toThrow();
  });
  test("Given a chosen desktop frame When the manifest is absent Then recovery keeps that frame", () => {
    expect(resolveAppScreensManifest(null, files, { width: 1440, height: 900 }).frame).toEqual({ width: 1440, height: 900 });
  });
});
