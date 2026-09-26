import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { fingerprintHtmlNode } from "../src/services/file-patch";
import { artifactOperationRoutes } from "../src/routes/artifact-operations";

const projectId = `styles-routes-${process.pid}`;
const source = '<p data-bg-node-id="hero" style="color: red">Base</p>';
let root = "";
let identity: Record<string, unknown>;

beforeAll(async () => {
  await runMigrations();
  root = await mkdtemp(path.join(tmpdir(), "burnguard-styles-routes-"));
  await writeFile(path.join(root, "index.html"), source);
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(projectId, projectId, root);
  getSqlite().prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(`${projectId}-session`, projectId);
  const base = await new ArtifactCoordinator(getSqlite()).initialize(projectId, root);
  const file = base.files[0];
  if (file === undefined) throw new Error("fixture file missing");
  identity = { expected_revision: 0, expected_artifact_digest: base.tree_digest, expected_file_hash: file.sha256, node_bg_id: "hero", node_fingerprint: fingerprintHtmlNode(source, "hero").fingerprint };
});

afterAll(async () => {
  getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
  await rm(root, { recursive: true, force: true });
});

async function patchStyles(styles: Record<string, string | null>): Promise<Response> {
  return artifactOperationRoutes.request(`http://local/api/projects/${projectId}/fs/index.html`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...identity, styles }) });
}

test("CSS-12: Given a style name that is not a CSS property or custom property When PATCH styles is sent Then invalid_style_name rejects before any mutation", async () => {
  const before = getSqlite().query("SELECT current_revision,current_digest FROM projects WHERE id=?").get(projectId);
  for (const name of ["color; background", "color:red", "--", "1color", "a b", ""]) {
    const response = await patchStyles({ [name]: "url(x)" });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_style_name" } });
  }
  expect(await readFile(path.join(root, "index.html"), "utf8")).toBe(source);
  expect(getSqlite().query("SELECT current_revision,current_digest FROM projects WHERE id=?").get(projectId)).toEqual(before);
});

test("CSS-12: Given a style value with markup, braces, a newline or an oversized payload When PATCH styles is sent Then invalid_style_value rejects before any mutation", async () => {
  for (const value of ["red</style>", "red}", "{red", "red\nblue", "x".repeat(4097)]) {
    const response = await patchStyles({ color: value });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_style_value" } });
  }
  expect(await readFile(path.join(root, "index.html"), "utf8")).toBe(source);
});

test("CSS-12: Given a valid custom property and a null removal When PATCH styles is sent Then the patch commits", async () => {
  const response = await patchStyles({ "--accent": "#123456", color: null, "font-size": "1.5rem" });
  expect(response.status).toBe(200);
  expect(await readFile(path.join(root, "index.html"), "utf8")).toBe('<p data-bg-node-id="hero" style="--accent: #123456; font-size: 1.5rem">Base</p>');
});
