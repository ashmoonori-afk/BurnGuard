import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultGenerationOptions, type EditScope } from "@bg/shared";
import { getSqlite } from "../src/db/sqlite-client";
import { listSequencedSessionEvents } from "../src/db/event-sequence-repository";
import { projectsDir } from "../src/lib/paths";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { artifactHistory } from "../src/services/artifact-history";
import { interruptUserTurn, startUserTurn } from "../src/services/turns";

export async function executeScopeTurnFixture(input: { scope: EditScope; baseHtml: string; nextHtml: string; repairHtml?: string; interrupt?: boolean; widen?: boolean }) {
  const projectId = `scope-turn-${crypto.randomUUID()}`;
  const sessionId = `${projectId}-session`;
  const root = path.join(projectsDir, projectId);
  const db = getSqlite();
  await mkdir(path.join(root, "assets"), { recursive: true });
  await writeFile(path.join(root, "index.html"), input.baseHtml);
  await writeFile(path.join(root, "styles.css"), "body{color:#111}");
  for (const name of ["one", "two", "three"]) await writeFile(path.join(root, "assets", `${name}.png`), `synthetic-${name}`);
  db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, "Synthetic scope QA", root);
  db.prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
  try {
    const base = await new ArtifactCoordinator(db).initialize(projectId, root);
    let promptScope: unknown;
    const run = async (scope: EditScope) => {
      const turn = startUserTurn(sessionId, { type: "user.message", text: "Edit the selected image", generation: { ...defaultGenerationOptions("codex"), edit_scope: scope } }, undefined, {
        detectBackends: async () => ({ backends: [{ id: "codex", found: true, binary_path: "fixture", version: "test" }] }),
        runAdapter: async (_backend, adapter) => {
          const line = adapter.prompt.split("\n").find(line => line.startsWith("<burnguard-edit-scope-v1>"));
          promptScope = line === undefined ? null : JSON.parse(line.split(">")[1]!.split("<")[0]!);
          await writeFile(path.join(adapter.projectDir, "index.html"), input.nextHtml);
          if (input.interrupt) interruptUserTurn(sessionId);
          return { exitCode: 0 };
        },
        reviewDesign: async review => {
          if (input.repairHtml !== undefined) await writeFile(path.join(review.adapter.projectDir, "index.html"), input.repairHtml);
          return { status: "checked", repairs: input.repairHtml === undefined ? 0 : 1, result: null };
        },
      });
      if (!turn) throw new Error("fixture_turn_unavailable");
      await turn.promise;
      const identity = db.query<{ current_revision: number; current_digest: string }, [string]>("SELECT current_revision,current_digest FROM projects WHERE id=?").get(projectId)!;
      return { operationId: turn.operationId, revision: identity.current_revision, digest: identity.current_digest, html: await readFile(path.join(root, "index.html"), "utf8"), treeDigest: (await inspectCanonicalTree(root)).tree_digest, history: artifactHistory(db, projectId, identity.current_revision, identity.current_digest), events: listSequencedSessionEvents(db, sessionId, 0).map(item => item.event), promptScope };
    };
    const result = await run(input.scope);
    const widened = input.widen ? await run({ mode: "unrestricted" }) : null;
    return { baseDigest: base.tree_digest, result, widened };
  } finally {
    db.prepare("DELETE FROM projects WHERE id=?").run(projectId);
    await rm(root, { recursive: true, force: true });
  }
}
