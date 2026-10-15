import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { canonicalTreePath, inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { runMigrationsFrom } from "../src/db/migrate";
import { artifactHistory } from "../src/services/artifact-history";
import { compareRevisionTrees, resolveRevisionReference } from "../src/services/revision-comparison";
import { defaultGenerationOptions, parseEditScope, parseGenerationOptions, parseRevisionComparison } from "@bg/shared";
import { editScopePromptLine } from "../src/harness/prompt-edit-scope";
import { parsePersistedNormalizedEvent } from "../src/db/event-sequence-repository";

let db: Database;
let root: string;
const html = '<html><head><link rel="stylesheet" href="styles.css"></head><body><section data-graphic-artboard="p1"><h1 data-bg-node-id="title1">First   title</h1><img data-bg-node-id="photo1" src="assets/one.png"></section><section data-graphic-artboard="p2"><h1 data-bg-node-id="title2">Second title</h1><img data-bg-node-id="photo2" src="assets/two.png"></section><section data-graphic-artboard="p3"><p>Untouched</p><img src="assets/three.png"></section></body></html>';

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "bg-edit-scope-"));
  db = new Database(":memory:");
  await runMigrationsFrom(db, path.join(import.meta.dir, "../src/db/migrations"));
  await mkdir(path.join(root, "assets"));
  await writeFile(path.join(root, "index.html"), html);
  await writeFile(path.join(root, "styles.css"), "body{color:#111}");
  for (const name of ["one", "two", "three"]) await writeFile(path.join(root, "assets", `${name}.png`), `synthetic-${name}`);
  db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES ('scope','Scope','prototype',?,'index.html','codex',1,1)").run(root);
  db.exec("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES ('scope-session','scope','codex','idle',1,1,1)");
});

afterEach(async () => { db.close(); await rm(root, { recursive: true, force: true }); });

describe("edit scope publication contract", () => {
  test("Given image_only on two artboards When swapping two image references Then text and unrelated hashes survive publication", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("scope", root);
    const result = await coordinator.run({ projectId: "scope", projectDir: root, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest,
      editScope: { mode: "image_only", targets: [{ rel_path: "index.html", artboard_id: "p1" }, { rel_path: "index.html", artboard_id: "p2" }] },
      mutate: async stage => { await writeFile(path.join(stage, "index.html"), html.replace("assets/one.png", "assets/temp.png").replace("assets/two.png", "assets/one.png").replace("assets/temp.png", "assets/two.png")); },
    });
    expect(result.status).toBe("committed");
    const after = await inspectCanonicalTree(root);
    expect(after.files.filter(file => file.path !== "index.html")).toEqual(base.files.filter(file => file.path !== "index.html"));
    expect(result.comparison?.pages.map(page => [page.artboard_id, page.kinds])).toEqual([["p1", ["image"]], ["p2", ["image"]]]);
    expect(result.comparison?.pages.every(page => page.text_changes.length === 0)).toBe(true);
    expect(artifactHistory(db, "scope", 1, result.resultDigest).latest_comparison).toEqual(result.comparison);
    expect(parseRevisionComparison(result.comparison)).toEqual(result.comparison);
  });

  test("Given text_only When replacing an image Then publication fails and base revision stays intact", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("scope", root);
    await expect(coordinator.run({ projectId: "scope", projectDir: root, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest,
      editScope: { mode: "text_only" }, mutate: async stage => { await writeFile(path.join(stage, "index.html"), html.replace("assets/one.png", "assets/two.png")); },
    })).rejects.toMatchObject({ code: "edit_scope_violation", findings: [expect.objectContaining({ kind: "image", rel_path: "index.html", artboard_id: "p1", node_id: "photo1" })] });
    expect((await inspectCanonicalTree(root)).tree_digest).toBe(base.tree_digest);
    expect(db.query("SELECT current_revision FROM projects WHERE id='scope'").get()).toEqual({ current_revision: 0 });
    expect(artifactHistory(db, "scope", 0, base.tree_digest).scope_violation?.comparison.findings).toEqual([expect.objectContaining({ kind: "image", node_id: "photo1" })]);
  });

  for (const scenario of [
    { mode: "image_only" as const, kind: "text", file: "index.html", content: html.replace("Second title", "Changed copy") },
    { mode: "text_only" as const, kind: "style", file: "styles.css", content: "body{color:#222}" },
    { mode: "text_only" as const, kind: "image", file: "assets/one.png", content: "replacement image bytes" },
    { mode: "image_only" as const, kind: "style", file: "index.html", content: html.replace('<h1 data-bg-node-id="title1">', '<h1 data-bg-node-id="title1" style="color:red">') },
    { mode: "image_only" as const, kind: "structure", file: "index.html", content: html.replace('data-bg-node-id="photo1"', 'data-bg-node-id="photo1" width="20"') },
    { mode: "image_only" as const, kind: "asset", file: "payload.json", content: '{"changed":true}' },
  ]) test(`Given ${scenario.mode} When an out-of-scope ${scenario.kind} edit occurs in ${scenario.file} Then the typed finding blocks publication`, async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("scope", root);
    await expect(coordinator.run({ projectId: "scope", projectDir: root, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest,
      editScope: { mode: scenario.mode }, mutate: async stage => { await writeFile(path.join(stage, scenario.file), scenario.content); },
    })).rejects.toMatchObject({ code: "edit_scope_violation", findings: expect.arrayContaining([expect.objectContaining({ kind: scenario.kind })]) });
    expect(await readFile(path.join(root, "index.html"), "utf8")).toBe(html);
    expect((await inspectCanonicalTree(root)).tree_digest).toBe(base.tree_digest);
  });

  test("Given text_only with a node target When a different artboard changes Then it is blocked", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("scope", root);
    await expect(coordinator.run({ projectId: "scope", projectDir: root, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest,
      editScope: { mode: "text_only", targets: [{ rel_path: "index.html", node_id: "title1" }] }, mutate: async stage => { await writeFile(path.join(stage, "index.html"), html.replace("Second title", "Changed")); },
    })).rejects.toMatchObject({ code: "edit_scope_violation", findings: expect.arrayContaining([expect.objectContaining({ kind: "text", node_id: "title2" })]) });
  });

  test("Given text_only with a node target When that text changes Then comparison contains its normalized before and after values", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("scope", root);
    const result = await coordinator.run({ projectId: "scope", projectDir: root, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest,
      editScope: { mode: "text_only", targets: [{ rel_path: "index.html", node_id: "title1" }] }, mutate: async stage => { await writeFile(path.join(stage, "index.html"), html.replace("First   title", "Updated title")); },
    });
    expect(result.comparison?.pages).toEqual([expect.objectContaining({ artboard_id: "p1", kinds: ["text"], text_changes: [expect.objectContaining({ node_id: "title1", before: "First title", after: "Updated title" })] })]);
  });

  test("Given image_only on one node When its bytes change Then non-target assets and all text remain unchanged", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("scope", root);
    const result = await coordinator.run({ projectId: "scope", projectDir: root, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest,
      editScope: { mode: "image_only", targets: [{ rel_path: "index.html", node_id: "photo1" }] }, mutate: async stage => { await writeFile(path.join(stage, "assets/one.png"), "new synthetic image bytes"); },
    });
    expect(result.status).toBe("committed");
    expect(result.comparison?.pages).toEqual([expect.objectContaining({ artboard_id: "p1", kinds: ["image"], text_changes: [] })]);
  });

  test("Given image_only on one node When a shared asset also changes another artboard Then the non-target use blocks publication", async () => {
    await writeFile(path.join(root, "index.html"), html.replace("assets/two.png", "assets/one.png"));
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("scope", root);
    await expect(coordinator.run({ projectId: "scope", projectDir: root, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest,
      editScope: { mode: "image_only", targets: [{ rel_path: "index.html", node_id: "photo1" }] }, mutate: async stage => { await writeFile(path.join(stage, "assets/one.png"), "shared replacement"); },
    })).rejects.toMatchObject({ code: "edit_scope_violation", findings: expect.arrayContaining([expect.objectContaining({ artboard_id: "p2", node_id: "photo2", kind: "image" })]) });
  });

  test("Given an omitted scope When text image and style all change Then today's unrestricted publication remains available", async () => {
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("scope", root);
    const result = await coordinator.run({ projectId: "scope", projectDir: root, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest,
      mutate: async stage => { await writeFile(path.join(stage, "index.html"), html.replace("First   title", "New").replace("assets/one.png", "assets/two.png")); await writeFile(path.join(stage, "styles.css"), "body{color:red}"); },
    });
    expect(result.status).toBe("committed");
  });

  test("Given identical trees When comparing repeatedly Then normalized source comparisons are deterministic", async () => {
    const first = await compareRevisionTrees(root, root, { mode: "image_only" });
    expect(first.pages).toEqual([]);
    expect(first.findings).toEqual([]);
    expect(await compareRevisionTrees(root, root, { mode: "image_only" })).toEqual(first);
  });

  for (const [flavor, base, target] of [[path.win32, "C:\\artifacts", "C:\\artifacts\\pages\\index.html"], [path.posix, "/artifacts", "/artifacts/pages/index.html"]] as const) {
    test(`Given a ${flavor.sep === "\\" ? "Windows" : "POSIX"} artifact path When resolving a local image Then the shared URL inventory stays canonical`, () => {
      const relPath = canonicalTreePath(base, target, flavor);
      expect(relPath).toBe("pages/index.html");
      expect(resolveRevisionReference(relPath, "../assets/photo.png?v=2")).toBe("assets/photo.png");
      const cssPath = canonicalTreePath(base, flavor.join(base, "styles", "theme.css"), flavor);
      expect(resolveRevisionReference(cssPath, "../assets/photo.png?v=2")).toBe("assets/photo.png");
      expect(parseEditScope({ mode: "image_only", targets: [{ rel_path: relPath }] }).targets?.[0].rel_path).toBe(relPath);
    });
  }

  test("Given malformed scope paths or modes When parsed Then none silently become unrestricted", () => {
    for (const target of ["../index.html", "C:\\private\\index.html", "/private/index.html", "pages\\index.html"]) expect(() => parseEditScope({ mode: "image_only", targets: [{ rel_path: target }] })).toThrow();
    expect(() => parseEditScope({ mode: "image" })).toThrow();
    const generation = { ...defaultGenerationOptions("codex"), edit_scope: { mode: "image_only" as const, targets: [{ rel_path: "index.html", node_id: "photo1" }] } };
    expect(parseGenerationOptions(generation)).toEqual(generation);
    const line = editScopePromptLine(generation.edit_scope);
    expect(JSON.parse(line.split(">")[1]!.split("<")[0]!)).toMatchObject(generation.edit_scope);
    expect(line.includes("\n")).toBe(false);
    expect(line.length).toBeLessThan(4096);
    expect(parsePersistedNormalizedEvent(JSON.stringify({ id: "scope-error", ts: 1, type: "status.error", code: "edit_scope_violation", message: "not applied", recoverable: true }), "scope-error")).toMatchObject({ code: "edit_scope_violation" });
  });

  test("Given generation.edit_scope When a real turn swaps images Then the harness and publication use that same scope", async () => {
    const { executeScopeTurnFixture } = await import("./edit-scope-turn-fixture");
    const observed = await executeScopeTurnFixture({ scope: { mode: "image_only" }, baseHtml: html, nextHtml: html.replace("assets/one.png", "assets/two.png") });
    expect(observed.result.revision).toBe(1);
    expect(observed.result.promptScope).toMatchObject({ mode: "image_only" });
    expect(observed.result.history.latest_comparison?.pages).toEqual([expect.objectContaining({ artboard_id: "p1", kinds: ["image"], text_changes: [] })]);
  });

  test("Given a real text_only turn When it replaces an image Then replay carries the refusal and only an explicit unrestricted retry can publish", async () => {
    const { executeScopeTurnFixture } = await import("./edit-scope-turn-fixture");
    const observed = await executeScopeTurnFixture({ scope: { mode: "text_only" }, baseHtml: html, nextHtml: html.replace("assets/one.png", "assets/two.png"), widen: true });
    expect(observed.result.revision).toBe(0);
    expect(observed.result.treeDigest).toBe(observed.baseDigest);
    expect(observed.result.events).toContainEqual(expect.objectContaining({ type: "status.error", code: "edit_scope_violation", notApplied: expect.objectContaining({ operationId: observed.result.operationId }) }));
    expect(observed.widened?.revision).toBe(1);
  });

  for (const interrupted of [false, true]) test(`Given image_only When ${interrupted ? "an interrupted writer" : "a design repair"} changes copy Then the original snapshot still blocks publication`, async () => {
    const { executeScopeTurnFixture } = await import("./edit-scope-turn-fixture");
    const copy = html.replace("Second title", "Forbidden copy");
    const observed = await executeScopeTurnFixture({ scope: { mode: "image_only" }, baseHtml: html, nextHtml: interrupted ? copy : html.replace("assets/one.png", "assets/two.png"), ...(interrupted ? { interrupt: true } : { repairHtml: copy }) });
    expect(observed.result.revision).toBe(0);
    expect(observed.result.treeDigest).toBe(observed.baseDigest);
    expect(observed.result.history.scope_violation?.comparison.findings).toContainEqual(expect.objectContaining({ node_id: "title2", kind: "text" }));
  });

  for (const fixture of [
    { surface: "linked stylesheet", document: html.replace('href="styles.css"', 'data-bg-node-id="sheet" href="styles/theme.css"'), css: '[data-graphic-artboard=p2]{background-image:url("../assets/one.png")}', nodeId: "sheet" },
    { surface: "inline style", document: html.replace('data-graphic-artboard="p2"', 'data-graphic-artboard="p2" data-bg-node-id="background2" style="background-image:url(assets/one.png)"'), css: "body{color:#111}", nodeId: "background2" },
    { surface: "style block", document: html.replace("</head>", '<style data-bg-node-id="sheetblock">[data-graphic-artboard=p2]{background-image:url("assets/one.png")}</style></head>'), css: "body{color:#111}", nodeId: "sheetblock" },
  ]) test(`Given a targeted image also used by an untargeted ${fixture.surface} When its bytes change Then publication is blocked`, async () => {
    await writeFile(path.join(root, "index.html"), fixture.document);
    await mkdir(path.join(root, "styles"));
    await writeFile(path.join(root, "styles", "theme.css"), fixture.css);
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("scope", root);
    await expect(coordinator.run({ projectId: "scope", projectDir: root, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest,
      editScope: { mode: "image_only", targets: [{ rel_path: "index.html", node_id: "photo1" }] }, mutate: async stage => { await writeFile(path.join(stage, "assets/one.png"), "changed image bytes"); },
    })).rejects.toMatchObject({ code: "edit_scope_violation", findings: expect.arrayContaining([expect.objectContaining({ rel_path: "index.html", node_id: fixture.nodeId, kind: "image" })]) });
    expect((await inspectCanonicalTree(root)).tree_digest).toBe(base.tree_digest);
  });

  test("Given one stylesheet loaded by two pages When a shared image changes Then every loading link contributes its scope location", async () => {
    await writeFile(path.join(root, "styles.css"), 'body{background-image:url("assets/one.png")}');
    await writeFile(path.join(root, "other.html"), '<html><head><link data-bg-node-id="other-sheet" rel="stylesheet" href="styles.css"></head><body>Other page</body></html>');
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("scope", root);
    await expect(coordinator.run({ projectId: "scope", projectDir: root, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest,
      editScope: { mode: "image_only", targets: [{ rel_path: "index.html" }] }, mutate: async stage => { await writeFile(path.join(stage, "assets/one.png"), "shared image bytes"); },
    })).rejects.toMatchObject({ code: "edit_scope_violation", findings: expect.arrayContaining([expect.objectContaining({ rel_path: "other.html", node_id: "other-sheet", kind: "image" })]) });
    expect((await inspectCanonicalTree(root)).tree_digest).toBe(base.tree_digest);
  });

  test("Given CSS using an unrelated image When only a targeted image changes Then publication still passes", async () => {
    await writeFile(path.join(root, "styles.css"), 'body{background-image:url("assets/three.png")}');
    const coordinator = new ArtifactCoordinator(db);
    const base = await coordinator.initialize("scope", root);
    const result = await coordinator.run({ projectId: "scope", projectDir: root, kind: "turn", expectedRevision: 0, expectedArtifactDigest: base.tree_digest,
      editScope: { mode: "image_only", targets: [{ rel_path: "index.html", node_id: "photo1" }] }, mutate: async stage => { await writeFile(path.join(stage, "assets/one.png"), "targeted image bytes"); },
    });
    expect(result.status).toBe("committed");
    expect(result.comparison?.findings).toEqual([]);
    expect((await inspectCanonicalTree(root)).files.filter(file => file.path !== "assets/one.png")).toEqual(base.files.filter(file => file.path !== "assets/one.png"));
  });
});
