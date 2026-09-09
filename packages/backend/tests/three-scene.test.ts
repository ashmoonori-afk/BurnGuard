import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseThreeScene, type ThreeSceneV1 } from "@bg/shared";
import { runMigrationsFrom } from "../src/db/migrate";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { applyThreeScene, getThreeRuntime, readThreeScene, saveThreeScene } from "../src/services/three-scene";
import { classifyApiRoute } from "../src/server";

const scene: ThreeSceneV1 = { schema_version: 1, background: "#ffffff", objects: [{ id: "cube1", shape: "cube", color: "#3366ff", position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }] };

test("Given untrusted scene JSON When parsed Then unsupported code, duplicate IDs and unsafe dimensions are rejected", () => {
  expect(parseThreeScene(scene)).toEqual(scene);
  expect(() => parseThreeScene({ ...scene, script: "alert(1)" })).toThrow();
  expect(() => parseThreeScene({ ...scene, objects: [scene.objects[0], scene.objects[0]] })).toThrow();
  expect(() => parseThreeScene({ ...scene, objects: [{ ...scene.objects[0], scale: [0, 1, 1] }] })).toThrow();
  expect(() => parseThreeScene({ ...scene, objects: [{ ...scene.objects[0], position: [Infinity, 1, 1] }] })).toThrow();
  expect(classifyApiRoute("/api/projects/p/three-scene", "PUT")).toBe("three-scene");
});

test("Given existing HTML When adding then editing a scene Then other content stays byte-identical and config reloads", () => {
  const source = '<!doctype html><body><h1 data-bg-node-id="hero">Keep me</h1></body>';
  const first = applyThreeScene(source, "nested/index.html", scene, "/* local runtime */");
  const second = applyThreeScene(first, "nested/index.html", { ...scene, background: "#000000" }, "/* local runtime */");
  expect(second.startsWith(source.replace("</body>", ""))).toBe(true);
  expect(second.endsWith("</body>")).toBe(true);
  expect(readThreeScene(second)?.background).toBe("#000000");
  expect(second.match(/<section data-bg-three=/g)?.length).toBe(1);
  expect(second).not.toContain("<script src=");
});

test("Given local Three.js When bundled Then the portable runtime and MIT license are available without CDN imports", async () => {
  const result = await getThreeRuntime();
  expect(result.javascript.length).toBeGreaterThan(10000);
  expect(result.javascript).not.toMatch(/(?:from\s*|import\s*\()["']https?:/);
  expect(result.license).toContain("Permission is hereby granted");
});

test("Given an artifact When a scene is saved and undone Then CAS is enforced and the original HTML is restored", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "burnguard-three-"));
  const db = new Database(":memory:");
  try {
    await runMigrationsFrom(db, path.join(import.meta.dir, "../src/db/migrations"));
    const original = '<html><body><h1 data-bg-node-id="hero">Original</h1></body></html>';
    await writeFile(path.join(root, "index.html"), original);
    db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES ('p','P','prototype',?,'index.html','codex',1,1)").run(root);
    db.exec("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES ('s','p','codex','idle',1,1,1)");
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("p", root);
    const input = { projectId: "p", projectDir: root, relPath: "index.html", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, expectedFileHash: base.files[0]!.sha256, scene };
    const saved = await saveThreeScene(coordinator, input);
    expect(saved.status).toBe("committed");
    expect(readThreeScene(await readFile(path.join(root, "index.html"), "utf8"))).toEqual(scene);
    await expect(saveThreeScene(coordinator, input)).rejects.toMatchObject({ code: "stale_revision" });
    await coordinator.undo({ projectId: "p", projectDir: root, operationId: saved.id, expectedRevision: saved.resultRevision, expectedArtifactDigest: saved.resultDigest });
    expect(await readFile(path.join(root, "index.html"), "utf8")).toBe(original);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});
