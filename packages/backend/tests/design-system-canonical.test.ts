import { afterEach, expect, spyOn, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseHexColor } from "@bg/shared/color";
import { createDefaultPalette, serializePalette, type PaletteState } from "@bg/shared/palette";
import { createDefaultThemeSettings, synthesizeTheme, type CanonicalTransferProof, type SemanticTheme } from "@bg/shared/theme";
import { getCatalogRow, getCurrentSystemContent, getPendingSystemOperation } from "../src/db/catalog-repository";
import { readCanonicalTransfer, validateCanonicalTransferReceipt } from "../src/db/canonical-transfer-repository";
import { canonicalFiles, readCanonicalCandidate, validateCanonicalContent, writeCanonicalCandidate } from "../src/services/canonical-theme-files";
import { readOwnedCanonical } from "../src/services/design-system-canonical";
import { paletteContentEnvironment, readDesignSystemPalette, saveDesignSystemPalette } from "../src/services/design-system-palette";
import { withSystemContentAccess } from "../src/services/system-content-access";
import { contentObservationDigest, observeSystemContent, publishSystemContent, type ContentEnvironment } from "../src/services/system-content-publication";
import { expectedDigest, fixture, rulesAdapter, validateRules } from "./fixtures/system-content-fixture";
import { catalogPaths } from "../src/services/catalog-files";
import { copyCatalogSystem, purgeCatalogSystem, reconcileCatalogState, trashCatalogSystem } from "../src/services/catalog-lifecycle";

const homes: string[] = [];
const databases: Database[] = [];
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
async function publish(env: ContentEnvironment, theme: SemanticTheme, proof: CanonicalTransferProof | null = canonicalFiles(theme).proof) {
  return withSystemContentAccess(env.db, env.systemsRoot, ["test-system"], async lease => {
    const base = await observeSystemContent(env, "test-system", lease);
    return publishSystemContent(env, {
      systemId: "test-system", mode: "replace", expectedDigest: contentObservationDigest(base), lease,
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
