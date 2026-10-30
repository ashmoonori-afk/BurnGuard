import { expect, spyOn, test } from "bun:test";
import { EventEmitter, once } from "node:events";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { runMigrations } from "../src/db/migrate-local";
import { createDesignSystemRecord } from "../src/db/seed";
import { getSqlite } from "../src/db/sqlite-client";
import { sampleLayoutFiles } from "../src/data/sample-layouts";
import { projectsDir, systemsDir } from "../src/lib/paths";
import { designDirectionRoutes, replaceDesignDirectionWorkflowForTest } from "../src/routes/design-directions";
import { DesignDirectionWorkflow, DesignDirectionWorkflowError } from "../src/services/design-direction-workflow";
import * as access from "../src/services/system-content-access";
import { contentObservationDigest, observeSystemContent, publishSystemContent, type ContentAdapter } from "../src/services/system-content-publication";
import { environment, rulesAdapter } from "./fixtures/system-content-fixture";

async function bounded<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Direction access event deadline")), 10_000);
    })]);
  } finally { clearTimeout(timer); }
}

test("Given a live system paused at base-moved When direction generation reads Then its workflow receives only the complete committed layout", async () => {
  await runMigrations();
  const db = getSqlite();
  const systemId = `direction-read-system-${process.pid}`, projectId = `direction-read-project-${process.pid}`;
  const sessionId = `${projectId}-session`, systemRoot = path.join(systemsDir, systemId), projectRoot = path.join(projectsDir, projectId);
  const prior = sampleLayoutFiles("editorial"), next = sampleLayoutFiles("split-saas");
  expect(prior.layout).not.toEqual(next.layout);
  await mkdir(systemRoot, { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(systemRoot, "colors_and_type.css"), prior.css);
  await writeFile(path.join(systemRoot, "README.md"), prior.readme);
  await writeFile(path.join(systemRoot, "SKILL.md"), "# Direction read fixture");
  await createDesignSystemRecord({
    id: systemId, name: "Direction read fixture", description: null, status: "draft", sourceType: "upload", sourceUri: null,
    dirPath: systemRoot, skillMdPath: path.join(systemRoot, "SKILL.md"), tokensCssPath: path.join(systemRoot, "colors_and_type.css"),
    readmeMdPath: path.join(systemRoot, "README.md"), thumbnailPath: null,
  });
  db.query("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,design_system_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',?,1,1)").run(projectId, "Direction read project", projectRoot, systemId);
  db.query("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
  const events = new EventEmitter(), moved = once(events, "moved"), release = once(events, "release"), queued = once(events, "queued");
  const replacement = new DesignDirectionWorkflow();
  const generated = spyOn(replacement, "generate").mockImplementation(async () => { throw new DesignDirectionWorkflowError("operation_capacity"); });
  const restoreWorkflow = replaceDesignDirectionWorkflowForTest(replacement);
  let restoreAccess: (() => void) | undefined;
  let publication: ReturnType<typeof publishSystemContent> | undefined;
  let response: Promise<Response> | undefined;
  try {
    const env = environment(db, systemsDir);
    const expected = await access.withSystemContentAccess(db, systemsDir, [systemId], async lease =>
      contentObservationDigest(await observeSystemContent(env, systemId, lease))
    );
    const adapter: ContentAdapter = {
      ...rulesAdapter(),
      writeSet: () => ["README.md", "colors_and_type.css"],
      transform: async stage => {
        await writeFile(path.join(stage, "colors_and_type.css"), next.css);
        await writeFile(path.join(stage, "README.md"), next.readme);
      },
      validate: async stage => {
        expect(await readFile(path.join(stage, "colors_and_type.css"), "utf8")).toBe(next.css);
        expect(await readFile(path.join(stage, "README.md"), "utf8")).toBe(next.readme);
      },
    };
    publication = publishSystemContent({ ...env, validators: { ...env.validators, [adapter.provenance.writer]: adapter.validate }, atBoundary: async name => {
      if (name === "base-moved") { events.emit("moved"); await release; }
    } }, { systemId, mode: "replace", expectedDigest: expected, adapter });
    await bounded(Promise.race([moved, publication.then(() => { throw new Error("Publication missed base-moved"); })]));
    const originalAccess = access.withSystemContentAccess;
    const observedAccess: typeof originalAccess = (database, root, ids, read) => {
      const pending = originalAccess(database, root, ids, read);
      if (ids.includes(systemId)) events.emit("queued");
      return pending;
    };
    const observed = spyOn(access, "withSystemContentAccess").mockImplementation(observedAccess);
    restoreAccess = () => observed.mockRestore();
    const pendingResponse = Promise.resolve(designDirectionRoutes.request(`http://local/api/projects/${projectId}/design-directions/generate`, { method: "POST" }));
    response = pendingResponse;
    await bounded(Promise.race([queued, pendingResponse.then(() => { throw new Error("Direction read bypassed shared access"); })]));
    expect(generated).toHaveBeenCalledTimes(0);
    events.emit("release");
    await bounded(publication);
    const settled = await bounded(pendingResponse);
    expect(settled.status).toBe(422);
    expect(generated).toHaveBeenCalledTimes(1);
    expect(generated.mock.calls[0]?.[0].designSystem).toEqual({ id: systemId, name: "Direction read fixture", layout: next.layout });
  } finally {
    events.emit("release");
    await Promise.allSettled([publication, response]);
    restoreAccess?.();
    restoreWorkflow();
    generated.mockRestore();
    db.query("DELETE FROM projects WHERE id=?").run(projectId);
    db.query("DELETE FROM design_systems WHERE id=?").run(systemId);
    await rm(projectRoot, { recursive: true, force: true });
    await rm(systemRoot, { recursive: true, force: true });
  }
});
