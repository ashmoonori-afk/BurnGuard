import { afterEach, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseHexColor } from "@bg/shared/color";
import { createDefaultPalette, serializePalette, type PaletteState } from "@bg/shared/palette";
import { createDefaultThemeSettings, synthesizeTheme, type CanonicalTransferProof, type SemanticTheme } from "@bg/shared/theme";
import { getCatalogRow, getCurrentSystemContent, getPendingSystemOperation } from "../src/db/catalog-repository";
import { readCanonicalTransfer, validateCanonicalTransferReceipt } from "../src/db/canonical-transfer-repository";
import { canonicalFiles, readCanonicalCandidate, validateCanonicalContent, writeCanonicalCandidate } from "../src/services/canonical-theme-files";
import { readDesignSystemCanonical, readOwnedCanonical } from "../src/services/design-system-canonical";
import { paletteContentEnvironment, readDesignSystemPalette, saveDesignSystemPalette } from "../src/services/design-system-palette";
import { withSystemContentAccess } from "../src/services/system-content-access";
import { contentObservationDigest, observeSystemContent, publishSystemContent, type ContentEnvironment } from "../src/services/system-content-publication";
import { expectedDigest, fixture, rulesAdapter, validateRules } from "./fixtures/system-content-fixture";
import { catalogPaths } from "../src/services/catalog-files";
import { copyCatalogSystem, purgeCatalogSystem, reconcileCatalogState, trashCatalogSystem } from "../src/services/catalog-lifecycle";
import { getSqlite } from "../src/db/sqlite-client";
import { systemsDir } from "../src/lib/paths";
import { classifyApiRoute, createApp } from "../src/server";
import { BURNGUARD_CAPABILITY_HEADER } from "../src/security/request-authority";
import { inspectContentTree } from "../src/services/system-content-tree";
import { canonicalPinContent, canonicalPinStylesheet, parseCanonicalPinContent, type CanonicalPinSelection } from "@bg/shared/canonical-pin";
import { createProjectRecord } from "../src/db/seed";
import { getProjectDetail } from "../src/db/project-read-repository";
import { designSystemPinDigest, ensureProjectDesignSystemPin, inspectProjectDesignSystemPin,
  readProjectDesignSystemPin, refreshProjectDesignSystemPin, type DesignSystemPin } from "../src/services/project-design-system-pin";
import { compactPinnedDesignSystemContext, renderPinnedDesignSystemContext } from "../src/harness/prompt-design-system";
import { provisionCanonicalPinStylesheet, selectedPinnedThemeCss } from "../src/services/canonical-pin-assets";
import { resolveTokenColor } from "../src/services/design-system-contrast";
import { buildSessionContext } from "../src/services/context";
import { buildPrompt } from "../src/harness/prompt-builder";

const homes: string[] = [];
const databases: Database[] = [];
const routeIds: string[] = [];
const pinProjectIds: string[] = [];
const pendingCases = new Set<{ readonly promise: Promise<unknown>; readonly phase: () => string }>();
function trackedCase<T>(run: (mark: (phase: string) => void) => Promise<T>): Promise<T> {
  let phase = "setup";
  const promise = run(value => { phase = value; });
  const pending = { promise, phase: () => phase };
  pendingCases.add(pending);
  void promise.then(() => pendingCases.delete(pending), () => pendingCases.delete(pending));
  return promise;
}
afterEach(async () => {
  // A runner deadline does not cancel filesystem/SQLite work. Drain owned work before strict close.
  if (pendingCases.size > 0) console.error("CANONICAL_CASE_PENDING", JSON.stringify([...pendingCases].map(value => value.phase())));
  await Promise.allSettled([...pendingCases].map(value => value.promise));
  for (const db of databases.splice(0)) db.close(true);
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
  for (const id of pinProjectIds.splice(0)) {
    const project = await getProjectDetail(id);
    getSqlite().query("DELETE FROM projects WHERE id=?").run(id);
    if (project !== null) await rm(project.dir_path, { recursive: true, force: true });
  }
  for (const id of routeIds.splice(0)) {
    getSqlite().query("DELETE FROM design_systems WHERE id=?").run(id);
    await rm(path.join(systemsDir, id), { recursive: true, force: true });
  }
});
function themeFor(palette: PaletteState): SemanticTheme {
  return synthesizeTheme({
    system_id: "portable-identity", default_mode: "light", palette,
    sources: { brand: { kind: "anchor", id: "brand" }, surface: { kind: "scale", id: "neutral" },
      status: { success: parseHexColor("#15803d"), warning: parseHexColor("#a16207"),
        destructive: parseHexColor("#b91c1c"), info: parseHexColor("#0369a1") } },
    settings: { light: createDefaultThemeSettings(), dark: createDefaultThemeSettings() },
  });
}
async function setup() {
  const home = await mkdtemp(path.join(tmpdir(), "bg-canonical-service-"));
  homes.push(home);
  const value = await fixture(home, "replace");
  databases.push(value.db);
  const env = paletteContentEnvironment(value.db, value.systemsRoot);
  const palette: PaletteState = { ...createDefaultPalette(),
    anchors: [{ id: "brand", name: "Brand", color: parseHexColor("#b64128") }] };
  const initial = await readDesignSystemPalette("test-system", env);
  await saveDesignSystemPalette("test-system", { expected_digest: initial.expected_digest, state: palette }, env);
  return { ...value, env, palette };
}
async function publish(env: ContentEnvironment, theme: SemanticTheme, proof: CanonicalTransferProof | null = canonicalFiles(theme).proof, id = "test-system") {
  return withSystemContentAccess(env.db, env.systemsRoot, [id], async lease => {
    const base = await observeSystemContent(env, id, lease);
    return publishSystemContent(env, {
      systemId: id, mode: "replace", expectedDigest: contentObservationDigest(base), lease,
      adapter: {
        provenance: { format: "system-content-v1", writer: "canonical", source_extraction: null },
        writeSet: () => ["canonical/SKILL.md", "canonical/theme.css", "canonical/theme.json"],
        transform: async stage => { await writeCanonicalCandidate(stage, theme); },
        validate: validateCanonicalContent,
        ...(proof === null ? {} : { canonicalTransfer: async () => proof }),
      },
    });
  });
}
async function owned(env: ContentEnvironment, id = "test-system") {
  return withSystemContentAccess(env.db, env.systemsRoot, [id], async lease =>
    readOwnedCanonical(env, await observeSystemContent(env, id, lease), lease));
}
async function lifecycle<T>(run: () => Promise<T>): Promise<T> {
  // Own the existing lifecycle repository's uncached statements without mocking their behavior.
  const statements = spyOn(Database.prototype, "prepare");
  try { return await run(); }
  finally {
    for (const result of statements.mock.results) if (result.type === "return") result.value.finalize();
    statements.mockRestore();
  }
}

test("Given a full SQLite query cache When canonical receipt reads finish Then strict close does not depend on garbage collection", async () => {
  const prepared = await lifecycle(async () => {
    const f = await setup();
    const result = await publish(f.env, themeFor(f.palette));
    if (result.receipt === null) throw new Error("Missing canonical receipt");
    return { f, receipt: result.receipt };
  });
  prepared.f.db.close(true);
  const reader = new Database(prepared.f.dbPath);
  databases.push(reader);
  const cacheLimit: unknown = Reflect.get(Database, "MAX_QUERY_CACHE_SIZE");
  if (typeof cacheLimit !== "number" || !Number.isSafeInteger(cacheLimit) || cacheLimit < 1 || cacheLimit > 1000) {
    throw new Error("Unsupported SQLite query cache limit");
  }
  for (let index = 0; index < cacheLimit; index += 1) {
    reader.query(`SELECT ${index}`).get();
  }
  // Retain real statement wrappers so GC timing cannot hide an unowned native statement.
  const statements = spyOn(reader, "prepare");
  try {
    expect(validateCanonicalTransferReceipt(reader, prepared.receipt)).not.toBeNull();
    expect(() => reader.close(true)).not.toThrow();
  } finally {
    for (const result of statements.mock.results) if (result.type === "return") result.value.finalize();
    statements.mockRestore();
  }
});

test("Given an owned canonical triple When the palette changes Then one receipt publishes matching state and both modes without changing legacy bytes", async () => {
  const f = await setup();
  const original = themeFor(f.palette);
  await publish(f.env, original);
  const legacy = await readFile(path.join(f.live, "README.md"), "utf8");
  const first = await owned(f.env);
  expect(first?.theme.system_id).toBe("portable-identity");
  const palette = await readDesignSystemPalette("test-system", f.env);
  const changed = { ...f.palette, anchors: f.palette.anchors.map(anchor => ({
    ...anchor, color: parseHexColor("#126ab0"),
  })) };
  await saveDesignSystemPalette("test-system", { expected_digest: palette.expected_digest, state: changed }, f.env);
  const current = await owned(f.env);
  if (current === null) throw new Error("Missing coupled canonical theme");
  expect(current.theme.palette).toEqual(changed);
  expect(current.css).not.toBe(first?.css);
  const head = getCurrentSystemContent(f.db, "test-system");
  if (head === null) throw new Error("Missing coupled receipt");
  expect(readCanonicalTransfer(f.db, head.id)).toEqual(current.proof);
  expect(await readFile(path.join(f.live, "palette/state.json"), "utf8")).toBe(serializePalette(changed));
  expect(await readFile(path.join(f.live, "README.md"), "utf8")).toBe(legacy);
});

test("Given an owned theme When selected palette sources are removed Then saving keeps explicit prior semantic values rather than inventing replacements", async () => {
  const f = await setup();
  await publish(f.env, themeFor(f.palette));
  const before = await owned(f.env);
  const palette = await readDesignSystemPalette("test-system", f.env);
  const changed = { ...f.palette, anchors: [], scales: f.palette.scales.map(scale => ({ ...scale, id: `new-${scale.id}` })) };
  await saveDesignSystemPalette("test-system", { expected_digest: palette.expected_digest, state: changed }, f.env);
  const after = await owned(f.env);
  expect(after?.theme.sources.brand.kind).toBe("color");
  expect(after?.theme.sources.surface.kind).toBe("colors");
  expect(after?.theme.palette).toEqual(changed);
  expect(after?.css).toBe(before?.css);
});

test("Given an owned canonical theme When an unrelated rules revision commits Then digest-linked local ancestry preserves its exact ownership", async () => {
  const f = await setup();
  await publish(f.env, themeFor(f.palette));
  const before = await owned(f.env);
  const environment = { ...f.env, validators: { ...f.env.validators, rules: validateRules } };

  const result = await publishSystemContent(environment, { systemId: "test-system", mode: "replace",
    expectedDigest: await expectedDigest(environment), adapter: rulesAdapter() });

  if (result.receipt === null) throw new Error("Missing rules receipt");
  expect(readCanonicalTransfer(f.db, result.receipt.id)).toBeNull();
  expect(await owned(f.env)).toEqual(before);
});

test("Given a failure after candidate publication When palette Save rolls back Then the pair and canonical triple both return to the prior owner", async () => {
  const f = await setup();
  await publish(f.env, themeFor(f.palette));
  const before = await owned(f.env);
  const palette = await readDesignSystemPalette("test-system", f.env);
  let injected = false;
  await expect(saveDesignSystemPalette("test-system", { expected_digest: palette.expected_digest,
    state: { ...f.palette, curve: { ...f.palette.curve, amount: 0.15 } } }, {
    ...f.env, atBoundary: async boundary => {
      if (boundary === "candidate-moved") { injected = true; throw new Error("injected canonical rollback"); }
    },
  })).rejects.toMatchObject({ code: "system_content_failed" });
  expect(injected).toBe(true);
  expect(await owned(f.env)).toEqual(before);
  expect((await readDesignSystemPalette("test-system", f.env)).state).toEqual(f.palette);
});

test("Given deterministic canonical bytes without a receipt When ownership is requested Then valid content alone cannot authorize it", async () => {
  const f = await setup();
  await writeCanonicalCandidate(f.live, themeFor(f.palette));
  f.db.query("DELETE FROM design_system_receipts WHERE design_system_id=?").run("test-system");
  expect((await readCanonicalCandidate(f.live))?.theme.system_id).toBe("portable-identity");
  await expect(owned(f.env)).rejects.toMatchObject({ code: "system_content_unavailable" });
});

test.each([
  { declaration: "missing", code: "system_content_unavailable" },
  { declaration: "stale", code: "system_content_conflict" },
] as const)("Given a %s canonical declaration When new bytes are staged Then the existing owner remains unchanged", async ({ declaration, code }) => {
  const f = await setup();
  const original = themeFor(f.palette);
  await publish(f.env, original);
  const before = await owned(f.env);
  const changed: SemanticTheme = { ...original, default_mode: "dark" };
  await expect(publish(f.env, changed, declaration === "missing" ? null : canonicalFiles(original).proof))
    .rejects.toMatchObject({ code });
  expect(await owned(f.env)).toEqual(before);
});

test("Given a canonical candidate When an extra file or mismatched palette is introduced Then validation rejects the complete candidate", async () => {
  const f = await setup();
  await writeCanonicalCandidate(f.live, themeFor(f.palette));
  await writeFile(path.join(f.live, "canonical", "extra.txt"), "unowned");
  await expect(readCanonicalCandidate(f.live)).rejects.toMatchObject({ code: "system_content_corrupt" });
  await rm(path.join(f.live, "canonical", "extra.txt"));
  await writeFile(path.join(f.live, "palette", "state.json"), serializePalette({
    ...f.palette, display: { ...f.palette.display, appearance: "dark" },
  }));
  await expect(readCanonicalCandidate(f.live)).rejects.toMatchObject({ code: "system_content_conflict" });
});

test.each(["theme.json", "theme.css", "SKILL.md"])(
  "Given an extra UTF-8 marker in %s When canonical bytes are read Then decoding cannot silently authorize different bytes",
  async member => {
    const f = await setup();
    await writeCanonicalCandidate(f.live, themeFor(f.palette));
    const file = path.join(f.live, "canonical", member);
    await writeFile(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), await readFile(file)]));
    await expect(readCanonicalCandidate(f.live)).rejects.toMatchObject({ code: "system_content_corrupt" });
  },
);

test.each(["duplicate", "derive"] as const)(
  "Given a canonical %s When the original is purged Then exact bytes and receipt-local ownership survive",
  operation => trackedCase(async mark => {
    const f = await setup();
    mark("canonical-publication");
    await publish(f.env, themeFor(f.palette));
    const original = await owned(f.env);
    const sourceHead = getCurrentSystemContent(f.db, "test-system");
    if (sourceHead === null || original === null) throw new Error("Missing source owner");
    const paths = await catalogPaths(f.systemsRoot, "test-system", f.live);
    await lifecycle(async () => {
      mark("copy");
      await copyCatalogSystem(f.db, f.systemsRoot, "test-system", {
        id: "canonical-child", name: "Child", operation, reason: null, metadata: {},
      });
      mark("trash");
      await trashCatalogSystem(f.db, f.systemsRoot, "test-system");
    });

    mark("purge");
    await lifecycle(() => purgeCatalogSystem(f.db, f.systemsRoot, "test-system"));

    mark("read-independent-owner");
    expect(getCatalogRow(f.db, "test-system")).toBeNull();
    expect(existsSync(paths.trash)).toBe(false);
    expect(readCanonicalTransfer(f.db, sourceHead.id)).toBeNull();
    expect(await owned(f.env, "canonical-child")).toEqual(original);
    const child = getCurrentSystemContent(f.db, "canonical-child");
    if (child === null) throw new Error("Missing independent child owner");
    expect(child.contentRevision).toBeLessThan(0);
    expect(readCanonicalTransfer(f.db, child.id)).toEqual(original.proof);
  }),
);

test("Given a canonical child whose source was purged When its palette is saved Then the new local revision retains the portable namespace", () => trackedCase(async mark => {
  const f = await setup();
  mark("canonical-publication");
  await publish(f.env, themeFor(f.palette));
  await lifecycle(async () => {
    mark("copy");
    await copyCatalogSystem(f.db, f.systemsRoot, "test-system", {
      id: "canonical-child", name: "Child", operation: "derive", reason: null, metadata: {},
    });
    mark("trash");
    await trashCatalogSystem(f.db, f.systemsRoot, "test-system");
    mark("purge");
    await purgeCatalogSystem(f.db, f.systemsRoot, "test-system");
  });
  mark("read-child-palette");
  const before = await readDesignSystemPalette("canonical-child", f.env);
  const changed = { ...f.palette, anchors: f.palette.anchors.map(anchor => ({ ...anchor, color: parseHexColor("#126ab0") })) };

  mark("save-child-palette");
  await saveDesignSystemPalette("canonical-child", { expected_digest: before.expected_digest, state: changed }, f.env);

  mark("read-independent-owner");
  const after = await owned(f.env, "canonical-child");
  expect(after?.theme.palette).toEqual(changed);
  expect(after?.theme.system_id).toBe("portable-identity");
  expect(getCurrentSystemContent(f.db, "canonical-child")?.contentRevision).toBe(1);
  expect(getCatalogRow(f.db, "test-system")).toBeNull();
}));

test.each([false, true])(
  "Given a published copy with corrupt proof=%s and no source When recovery runs Then only a valid local owner can commit",
  corruptProof => trackedCase(async mark => {
    const f = await setup();
    mark("canonical-publication");
    await publish(f.env, themeFor(f.palette));
    const priorFault = process.env.BG_CATALOG_FAULT;
    try {
      process.env.BG_CATALOG_FAULT = "db-after-fs:derive:canonical-child";
      mark("copy-interruption");
      await expect(lifecycle(() => copyCatalogSystem(f.db, f.systemsRoot, "test-system", {
        id: "canonical-child", name: "Child", operation: "derive", reason: null, metadata: {},
      }))).rejects.toMatchObject({ code: "catalog_operation_failed" });
    } finally {
      if (priorFault === undefined) delete process.env.BG_CATALOG_FAULT;
      else process.env.BG_CATALOG_FAULT = priorFault;
    }
    const pending = getPendingSystemOperation(f.db, "canonical-child");
    if (pending === null) throw new Error("Missing published copy receipt");
    const childRoot = path.join(f.systemsRoot, "canonical-child");
    const bytes = await readCanonicalCandidate(childRoot);
    await lifecycle(async () => {
      mark("trash");
      await trashCatalogSystem(f.db, f.systemsRoot, "test-system");
      mark("purge");
      await purgeCatalogSystem(f.db, f.systemsRoot, "test-system");
    });
    if (corruptProof) {
      const mutation = f.db.prepare("UPDATE design_system_canonical_transfers SET json_sha256=? WHERE receipt_id=?");
      try { mutation.run("0".repeat(64), pending.id); }
      finally { mutation.finalize(); }
    }

    mark("recover");
    const result = await lifecycle(() => reconcileCatalogState(f.db, f.systemsRoot));

    mark("verify-recovery");
    expect(await readCanonicalCandidate(childRoot)).toEqual(bytes);
    expect(getCatalogRow(f.db, "test-system")).toBeNull();
    if (corruptProof) {
      expect(result).toEqual({ recovered: 0, failed: 1 });
      expect(getCurrentSystemContent(f.db, "canonical-child")).toBeNull();
      expect(getPendingSystemOperation(f.db, "canonical-child")?.id).toBe(pending.id);
      await expect(owned(f.env, "canonical-child")).rejects.toMatchObject({ code: "system_content_unavailable" });
    } else {
      expect(result).toEqual({ recovered: 1, failed: 0 });
      expect(getCurrentSystemContent(f.db, "canonical-child")?.id).toBe(pending.id);
      expect(await owned(f.env, "canonical-child")).toEqual(bytes);
    }
  }),
);

const routeCapability = "canonical-route-test-capability";
function canonicalRequest(id: string, overrides: Record<string, string> = {}, method = "GET") {
  return new Request(`http://127.0.0.1:14070/api/design-systems/${id}/canonical`, {
    method,
    headers: { host: "127.0.0.1:14070", origin: "http://127.0.0.1:14070",
      [BURNGUARD_CAPABILITY_HEADER]: routeCapability, ...overrides },
  });
}
function canonicalApp() {
  return createApp({ capability: routeCapability, bootstrapSecret: "canonical-route-test-bootstrap", appAuthority: "127.0.0.1:14070" });
}
async function canonicalRouteFixture() {
  const id = `canonical-route-${crypto.randomUUID()}`;
  routeIds.push(id);
  const live = path.join(systemsDir, id);
  await mkdir(live, { recursive: true });
  await writeFile(path.join(live, "README.md"), "legacy bytes\r\n");
  getSqlite().query("INSERT INTO design_systems(id,name,status,dir_path,created_at,updated_at) VALUES (?,?,'draft',?,1,1)")
    .run(id, "Canonical route fixture", live);
  return { id, live, env: paletteContentEnvironment() };
}
async function ownedCanonicalRouteFixture() {
  const f = await canonicalRouteFixture();
  const palette = { ...createDefaultPalette(), anchors: [{ id: "brand", name: "Brand", color: parseHexColor("#b64128") }] };
  const current = await readDesignSystemPalette(f.id);
  await saveDesignSystemPalette(f.id, { expected_digest: current.expected_digest, state: palette });
  const theme = themeFor(palette);
  await publish(f.env, theme, canonicalFiles(theme).proof, f.id);
  return { ...f, theme };
}

test("Given canonical route and raw file URLs When dispatched Then only the typed resource selects the system domain", () => {
  expect(classifyApiRoute("/api/design-systems/example/canonical", "GET")).toBe("system");
  expect(classifyApiRoute("/api/design-systems/example/files/canonical/theme.json", "GET")).toBe("catalog");
  expect(classifyApiRoute("/api/design-systems/canonical", "GET")).toBe("catalog");
});

test("Given an owned canonical route When authorized GET reads it Then both modes and exact CSS arrive without another receipt or byte change", async () => {
  const f = await ownedCanonicalRouteFixture();
  const before = await inspectContentTree(f.live);
  const receipt = getCurrentSystemContent(getSqlite(), f.id);
  const response = await canonicalApp().request(canonicalRequest(f.id));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: await readDesignSystemCanonical(f.id, f.env) });
  expect(await readDesignSystemCanonical(f.id, f.env)).toMatchObject({
    theme: f.theme, css: canonicalFiles(f.theme).css, receipt_id: receipt?.id, content_revision: receipt?.contentRevision,
  });
  expect(await inspectContentTree(f.live)).toEqual(before);
  expect(getCurrentSystemContent(getSqlite(), f.id)).toEqual(receipt);
});

test("Given a legacy canonical route and a missing ID When GET reads them Then absence of canonical data differs from a missing system", async () => {
  const f = await canonicalRouteFixture();
  const response = await canonicalApp().request(canonicalRequest(f.id));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ data: { theme: null, css: null, receipt_id: null, content_revision: 0 } });
  expect((await canonicalApp().request(canonicalRequest("missing-canonical-system"))).status).toBe(404);
});

test.each(["proof", "bytes", "archived", "pending"] as const)(
  "Given a canonical route with invalid %s When GET reads it Then no unowned theme or private diagnostic escapes",
  async fault => {
    const f = await ownedCanonicalRouteFixture();
    const receipt = getCurrentSystemContent(getSqlite(), f.id);
    if (receipt === null) throw new Error("Missing canonical route receipt");
    if (fault === "proof") getSqlite().query("DELETE FROM design_system_canonical_transfers WHERE receipt_id=?").run(receipt.id);
    else if (fault === "bytes") await writeFile(path.join(f.live, "canonical", "theme.css"), "changed bytes");
    else if (fault === "archived") getSqlite().query("UPDATE design_systems SET lifecycle='archived' WHERE id=?").run(f.id);
    else getSqlite().query("UPDATE design_system_receipts SET status='prepared' WHERE id=?").run(receipt.id);
    const response = await canonicalApp().request(canonicalRequest(f.id));
    expect(response.status).toBe(409);
    const body: unknown = await response.json();
    expect(body).toHaveProperty("error.code");
    expect(body).not.toHaveProperty("data");
    expect(JSON.stringify(body)).not.toContain(f.live);
    expect(JSON.stringify(body)).not.toContain(routeCapability);
  },
);

test.each([
  { header: "host", value: "evil.test", status: 421, method: "GET" },
  { header: "origin", value: "http://evil.test", status: 403, method: "OPTIONS" },
  { header: BURNGUARD_CAPABILITY_HEADER, value: "wrong", status: 403, method: "GET" },
] as const)(
  "Given hostile $header on the canonical route When $method enters the real app Then launch authority rejects it",
  async ({ header, value, status, method }) => {
    expect((await canonicalApp().request(canonicalRequest("missing", { [header]: value }, method))).status).toBe(status);
  },
);

test("Given no capability or an unsafe ID on the canonical route When GET enters Then it returns only a stable refusal", async () => {
  const missing = canonicalRequest("missing");
  missing.headers.delete(BURNGUARD_CAPABILITY_HEADER);
  expect((await canonicalApp().request(missing)).status).toBe(403);
  const response = await canonicalApp().request(canonicalRequest("C%3Aprivate"));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "invalid_body" } });
});

async function canonicalProjectPinFixture() {
  const f = await ownedCanonicalRouteFixture();
  const project = await createProjectRecord({
    name: "Pinned canonical fixture", type: "prototype", designSystemId: f.id, backendId: "codex",
    optionsJson: null, entrypoint: "index.html", thumbnailPath: null,
    initializeArtifact: stage => writeFile(path.join(stage, "index.html"), "<h1>Saved artwork</h1>"),
  });
  pinProjectIds.push(project.id);
  const legacy = readProjectDesignSystemPin(project.id);
  if (legacy === null) throw new Error("Missing initial legacy pin");
  return { ...f, project, legacy };
}

async function adoptCanonicalPin(projectId: string, mode: "light" | "dark"): Promise<DesignSystemPin> {
  const current = await ensureProjectDesignSystemPin(projectId);
  const selection: CanonicalPinSelection = { format: "canonical-v1", mode };
  const proposed = await inspectProjectDesignSystemPin(projectId, {}, selection);
  if (current === null || proposed === null) throw new Error("Missing pin candidate");
  await refreshProjectDesignSystemPin(projectId, current.digest, proposed.candidate_digest, selection);
  const pin = readProjectDesignSystemPin(projectId);
  if (pin?.format !== "canonical-v1") throw new Error("Missing adopted pin");
  return pin;
}

test.each(["light", "dark"] as const)(
  "Given a legacy canonical project pin When its owner explicitly adopts %s through the API Then only future authoring changes",
  async mode => {
    const f = await canonicalProjectPinFixture();
    const before = await inspectContentTree(f.project.dir_path);
    expect(f.legacy.format).toBeUndefined();
    const selection: CanonicalPinSelection = { format: "canonical-v1", mode };
    const proposal = await inspectProjectDesignSystemPin(f.project.id, {}, selection);
    if (proposal === null) throw new Error("Missing canonical proposal");
    const url = `http://127.0.0.1:14070/api/projects/${f.project.id}/design-system-pin`;
    const headers = canonicalRequest("unused").headers;
    const preview = await canonicalApp().request(new Request(`${url}?format=canonical-v1&mode=${mode}`, { headers }));
    expect(preview.status).toBe(200);
    expect(await preview.json()).toEqual({ data: proposal });
    headers.set("content-type", "application/json");
    const response = await canonicalApp().request(new Request(url, { method: "POST", headers,
      body: JSON.stringify({ expected_digest: f.legacy.digest, candidate_digest: proposal.candidate_digest, ...selection }) }));
    expect(response.status).toBe(200);
    const pin = readProjectDesignSystemPin(f.project.id);
    if (pin === null) throw new Error("Missing adopted canonical pin");
    expect(pin).toMatchObject({ format: "canonical-v1", revision: 2, digest: proposal.candidate_digest });
    expect(parseCanonicalPinContent(pin)).toEqual({ schema_version: 1, mode, theme: f.theme });
    expect(await inspectContentTree(f.project.dir_path)).toEqual(before);
    expect(existsSync(path.join(f.project.dir_path, canonicalPinStylesheet(pin.digest)))).toBe(false);
    for (const render of [renderPinnedDesignSystemContext, compactPinnedDesignSystemContext]) {
      const text = render(pin);
      const binding = /<canonical_theme_binding_v1>\n([^\n]+)\n<\/canonical_theme_binding_v1>/u.exec(text)?.[1];
      if (binding === undefined) throw new Error("Missing canonical binding");
      expect(JSON.parse(binding)).toEqual({ system_id: f.theme.system_id, mode, stylesheet: canonicalPinStylesheet(pin.digest) });
      expect(text.split("<selected_theme_v1>")).toHaveLength(2);
      expect(text).not.toContain(f.live);
    }
    const background = f.theme.modes[mode].background;
    if (background.type !== "color") throw new Error("Expected a literal fixture background");
    expect(resolveTokenColor(selectedPinnedThemeCss(pin), "--background"))
      .toBe("#" + background.channels.map(channel => channel.toString(16).padStart(2, "0")).join(""));
  },
);

test.each(["busy", "stale-candidate", "stale-pin"] as const)(
  "Given a canonical project pin proposal with %s When adoption is requested Then its previous representation remains",
  async fault => {
    const f = await canonicalProjectPinFixture();
    const selection: CanonicalPinSelection = { format: "canonical-v1", mode: "dark" };
    const proposal = await inspectProjectDesignSystemPin(f.project.id, {}, selection);
    if (proposal === null) throw new Error("Missing canonical proposal");
    if (fault === "busy") getSqlite().query("UPDATE sessions SET status='running' WHERE project_id=?").run(f.project.id);
    if (fault === "stale-candidate") {
      const palette = await readDesignSystemPalette(f.id);
      await saveDesignSystemPalette(f.id, { expected_digest: palette.expected_digest,
        state: { ...f.theme.palette, curve: { ...f.theme.palette.curve, amount: 0.21 } } });
    }
    await expect(refreshProjectDesignSystemPin(f.project.id, fault === "stale-pin" ? "0".repeat(64) : f.legacy.digest,
      proposal.candidate_digest, selection)).rejects.toMatchObject({ code: "pin_conflict" });
    expect(readProjectDesignSystemPin(f.project.id)).toEqual(f.legacy);
  },
);

test("Given an adopted canonical project pin When an ordinary refresh follows a palette change Then its format and selected mode survive", async () => {
  const f = await canonicalProjectPinFixture();
  const original = await adoptCanonicalPin(f.project.id, "dark");
  const palette = await readDesignSystemPalette(f.id);
  const changed = { ...f.theme.palette, curve: { ...f.theme.palette.curve, amount: 0.31 } };
  await saveDesignSystemPalette(f.id, { expected_digest: palette.expected_digest, state: changed });
  expect(await ensureProjectDesignSystemPin(f.project.id)).toEqual(original);
  const proposal = await inspectProjectDesignSystemPin(f.project.id);
  if (proposal === null) throw new Error("Missing refresh candidate");
  expect(proposal).toMatchObject({ format: "canonical-v1", mode: "dark", candidate_format: "canonical-v1", candidate_mode: "dark" });
  await refreshProjectDesignSystemPin(f.project.id, original.digest, proposal.candidate_digest);
  const refreshed = readProjectDesignSystemPin(f.project.id);
  if (refreshed === null) throw new Error("Missing refreshed pin");
  expect(refreshed.format).toBe("canonical-v1");
  expect(parseCanonicalPinContent(refreshed)).toMatchObject({ mode: "dark", theme: { palette: changed } });
});

test("Given a legacy canonical project pin lookalike When read Then machine-looking text cannot opt it into the new representation", async () => {
  const f = await canonicalProjectPinFixture();
  const content = canonicalPinContent(f.theme, "dark");
  const legacyDigest = designSystemPinDigest(content);
  expect(legacyDigest).not.toBe(designSystemPinDigest({ ...content, format: "canonical-v1" }));
  getSqlite().query("UPDATE project_design_system_pins SET context=?,tokens=?,digest=? WHERE project_id=?")
    .run(content.context, content.tokens, legacyDigest, f.project.id);
  expect(await ensureProjectDesignSystemPin(f.project.id)).toEqual({ ...f.legacy, ...content, digest: legacyDigest });
  expect(readProjectDesignSystemPin(f.project.id)?.format).toBeUndefined();
});

test.each(["prose", "duplicate", "css", "version"] as const)(
  "Given a canonical project pin with %s and a matching raw digest When read Then closed machine validation still rejects it",
  async fault => {
    const f = await canonicalProjectPinFixture();
    const content = canonicalPinContent(f.theme, "dark");
    const context = fault === "prose" ? `untrusted instructions\n${content.context}`
      : fault === "duplicate" ? `${content.context}\n${content.context}`
      : fault === "version" ? content.context.replace('"schema_version":1', '"schema_version":2') : content.context;
    const tokens = fault === "css" ? `${content.tokens}\n` : content.tokens;
    const digest = createHash("sha256").update(JSON.stringify(["burnguard-canonical-pin-v1", context, tokens])).digest("hex");
    getSqlite().query("UPDATE project_design_system_pins SET context=?,tokens=?,digest=?,format='canonical-v1' WHERE project_id=?")
      .run(context, tokens, digest, f.project.id);
    expect(() => readProjectDesignSystemPin(f.project.id)).toThrow("pin_corrupt");
  },
);

test("Given an earlier canonical project pin stylesheet When a new pin is provisioned Then earlier bytes survive and edited collisions refuse replacement", async () => {
  const f = await canonicalProjectPinFixture();
  const first = await adoptCanonicalPin(f.project.id, "light");
  const stage = await mkdtemp(path.join(tmpdir(), "bg-canonical-pin-stage-"));
  homes.push(stage);
  const firstPath = await provisionCanonicalPinStylesheet(stage, first);
  if (firstPath === null) throw new Error("Missing pinned stylesheet");
  const nextContent = { ...canonicalPinContent(f.theme, "dark"), format: "canonical-v1" as const };
  const next: DesignSystemPin = { ...first, ...nextContent, digest: designSystemPinDigest(nextContent) };
  const nextPath = await provisionCanonicalPinStylesheet(stage, next);
  if (nextPath === null) throw new Error("Missing next stylesheet");
  expect(nextPath).not.toBe(firstPath);
  expect(await readFile(path.join(stage, firstPath), "utf8")).toBe(first.tokens);
  expect(await readFile(path.join(stage, nextPath), "utf8")).toBe(next.tokens);
  await writeFile(path.join(stage, nextPath), "user-edited bytes");
  await expect(provisionCanonicalPinStylesheet(stage, next)).rejects.toMatchObject({ code: "system_content_conflict" });
  expect(await readFile(path.join(stage, nextPath), "utf8")).toBe("user-edited bytes");
});

test.each(["full", "compact"] as const)(
  "Given a frozen canonical project pin When the actual %s prompt is built after catalog changes Then its mode and both token maps remain pinned",
  async contextMode => {
    const f = await canonicalProjectPinFixture();
    const pin = await adoptCanonicalPin(f.project.id, "dark");
    const current = await readDesignSystemPalette(f.id);
    await saveDesignSystemPalette(f.id, { expected_digest: current.expected_digest,
      state: { ...f.theme.palette, curve: { ...f.theme.palette.curve, amount: 0.29 } } });
    const context = await buildSessionContext(f.project.session_id);
    if (context === null) throw new Error("Missing real session context");
    const prompt = await buildPrompt(context, { type: "user.message", text: "Change the footer content." }, { contextMode });
    const block = /<selected_theme_v1>\n([^\n]+)\n<\/selected_theme_v1>/u.exec(prompt)?.[1];
    if (block === undefined) throw new Error("Missing pinned theme block");
    expect(JSON.parse(block)).toEqual({ schema_version: 1, mode: "dark", theme: f.theme });
    expect(prompt.split("<selected_theme_v1>")).toHaveLength(2);
    expect(context.designSystemPin).toEqual(pin);
    expect(prompt).not.toContain(f.live);
  },
);

test("Given malformed canonical project pin selections When the actual API receives them Then no implicit adoption occurs", async () => {
  const f = await canonicalProjectPinFixture();
  const url = `http://127.0.0.1:14070/api/projects/${f.project.id}/design-system-pin`;
  const headers = canonicalRequest("unused").headers;
  for (const query of ["format=canonical-v1", "mode=dark", "format=canonical-v2&mode=dark", "format=canonical-v1&mode=system"]) {
    expect((await canonicalApp().request(new Request(`${url}?${query}`, { headers }))).status).toBe(400);
  }
  headers.set("content-type", "application/json");
  for (const selection of [{ format: "canonical-v1" }, { mode: "dark" }, { format: "canonical-v2", mode: "dark" }]) {
    const response = await canonicalApp().request(new Request(url, { method: "POST", headers,
      body: JSON.stringify({ expected_digest: f.legacy.digest, candidate_digest: "0".repeat(64), ...selection }) }));
    expect(response.status).toBe(400);
  }
  expect(readProjectDesignSystemPin(f.project.id)).toEqual(f.legacy);
});
