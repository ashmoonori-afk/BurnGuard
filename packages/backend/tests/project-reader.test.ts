import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { appRootDir, projectsDir, systemsDir } from "../src/lib/paths";
import { createDesignSystemRecord, createProjectRecord } from "../src/db/seed";
import { getSqlite } from "../src/db/sqlite-client";
import { deleteProject } from "../src/services/project-deletion";
import { listProjects, openProfileReader, readProject, renderProjectBrief } from "../src/cli/project-reader";

const SYSTEM_ID = `reader-system-${process.pid}`;
let projectId = "";

beforeAll(async () => {
  const dir = path.join(systemsDir, SYSTEM_ID);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, "colors_and_type.css"), ":root { --brand: #112233; }\n");
  await fsp.writeFile(path.join(dir, "rules.json"), JSON.stringify({ schema_version: 1, rules: [{ id: "r1", kind: "dont", text: "No gradients", origin: { type: "manual" }, created_at: 1 }] }));
  await createDesignSystemRecord({ id: SYSTEM_ID, name: "Reader System", description: null, status: "published", sourceType: "manual", sourceUri: null, dirPath: dir, skillMdPath: null, tokensCssPath: path.join(dir, "colors_and_type.css"), readmeMdPath: null, thumbnailPath: null });
  const project = await createProjectRecord({ name: `reader-${process.pid}`, type: "prototype", designSystemId: SYSTEM_ID, backendId: "codex", optionsJson: JSON.stringify({ standing_instructions: "Audience: new sales staff." }), entrypoint: "index.html", thumbnailPath: null });
  projectId = project.id;
});
afterAll(async () => {
  await deleteProject(getSqlite(), projectId);
  getSqlite().prepare("DELETE FROM design_systems WHERE id=?").run(SYSTEM_ID);
  await fsp.rm(path.join(systemsDir, SYSTEM_ID), { recursive: true, force: true });
});

describe("read-only project reader", () => {
  test("Given a profile When projects are listed and one is read Then the brief carries its directory, standing note, system rules and files", async () => {
    const reader = openProfileReader(appRootDir);
    try {
      expect(listProjects(reader).some((project) => project.id === projectId && project.design_system === "Reader System")).toBe(true);
      const view = await readProject(reader, projectId);
      expect(view?.directory.startsWith(projectsDir)).toBe(true);
      expect(view?.standing_instructions).toBe("Audience: new sales staff.");
      expect(view?.design_system?.rules.rules.map((rule) => [rule.kind, rule.text])).toEqual([["dont", "No gradients"]]);
      expect(view?.files).toContain("index.html");
      expect(view?.files.some((file) => file.startsWith(".meta"))).toBe(false);
      const brief = renderProjectBrief(view!);
      for (const fragment of ["Audience: new sales staff.", "- No gradients", "- index.html"]) expect(brief).toContain(fragment);
      expect(await readProject(reader, "no-such-project")).toBeNull();
    } finally { reader.close(); }
  });

  test("Given the reader When it tries to write Then the database refuses because it is opened read-only", () => {
    const reader = openProfileReader(appRootDir);
    try {
      expect(() => reader.db.run("UPDATE projects SET name='x' WHERE id=?", [projectId])).toThrow();
    } finally { reader.close(); }
  });

  test("Given a stored project directory outside the managed root When read Then the reader refuses it", async () => {
    const outside = await fsp.mkdtemp(path.join(path.dirname(appRootDir), "reader-outside-"));
    const original = getSqlite().query<{ dir_path: string }, [string]>("SELECT dir_path FROM projects WHERE id=?").get(projectId)!.dir_path;
    getSqlite().prepare("UPDATE projects SET dir_path=? WHERE id=?").run(outside, projectId);
    const reader = openProfileReader(appRootDir);
    try {
      await expect(readProject(reader, projectId)).rejects.toThrow();
    } finally {
      reader.close();
      getSqlite().prepare("UPDATE projects SET dir_path=? WHERE id=?").run(original, projectId);
      await fsp.rm(outside, { recursive: true, force: true });
    }
  });

  test("Given a relative profile root When opened Then it is refused", () => {
    expect(() => openProfileReader("relative/profile")).toThrow();
  });
});
