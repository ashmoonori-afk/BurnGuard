import { afterEach, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseHexColor } from "@bg/shared/color";
import { createDefaultPalette, serializePalette, type PaletteState } from "@bg/shared/palette";
import { createDefaultThemeSettings, synthesizeTheme, type CanonicalTransferProof, type SemanticTheme } from "@bg/shared/theme";
import { getCurrentSystemContent } from "../src/db/catalog-repository";
import { readCanonicalTransfer } from "../src/db/canonical-transfer-repository";
import { canonicalFiles, readCanonicalCandidate, validateCanonicalContent, writeCanonicalCandidate } from "../src/services/canonical-theme-files";
import { readOwnedCanonical } from "../src/services/design-system-canonical";
import { paletteContentEnvironment, readDesignSystemPalette, saveDesignSystemPalette } from "../src/services/design-system-palette";
import { withSystemContentAccess } from "../src/services/system-content-access";
import { contentObservationDigest, observeSystemContent, publishSystemContent, type ContentEnvironment } from "../src/services/system-content-publication";
import { fixture } from "./fixtures/system-content-fixture";

const homes: string[] = [];
const databases: Database[] = [];
afterEach(async () => {
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
async function owned(env: ContentEnvironment) {
  return withSystemContentAccess(env.db, env.systemsRoot, ["test-system"], async lease =>
    readOwnedCanonical(env, await observeSystemContent(env, "test-system", lease), lease));
}

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
