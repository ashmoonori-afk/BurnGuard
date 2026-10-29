import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import {
  emitPaletteCss, PALETTE_EMITTER_VERSION, parsePaletteState, parseSaveDesignSystemPaletteRequest,
  serializePalette, type DesignSystemPaletteResponse, type SaveDesignSystemPaletteRequest,
} from "@bg/shared/palette";
import { UpgradeContractError } from "@bg/shared/contract-parser";
import { getCurrentSystemContent, type CatalogReceiptRow } from "../db/catalog-repository";
import { getSqlite } from "../db/sqlite-client";
import { systemsDir } from "../lib/paths";
import { PathBoundaryError } from "../security/path-boundary";
import { withSystemContentAccess, type SystemContentLease } from "./system-content-access";
import { bundledThemeHistory, themeAdditiveDigest, themeFileHash } from "./bundled-theme-refresh";
import { CanonicalTreeManifestError } from "./canonical-tree-manifest";
import {
  contentHash, parseContentJournal, parseContentProvenance, SystemContentError,
  type PairFile, type PairSnapshot,
} from "./system-content-format";
import {
  observeSystemContent, publishSystemContent, type ContentEnvironment, type ContentObservation, type ContentValidator,
} from "./system-content-publication";
import { readPreservedFile, safeContentChild, type ContentTree } from "./system-content-tree";

const PAIR_PATHS = ["palette/scales.css", "palette/state.json"] as const;
export class DesignSystemPaletteError extends Error {
  readonly name = "DesignSystemPaletteError";
  constructor(readonly code: "design_system_not_found" | "invalid_lifecycle" | "palette_ownership_conflict") { super(code); }
}
function corrupt(): never { throw new SystemContentError("system_content_corrupt"); }
function ownership(): never { throw new DesignSystemPaletteError("palette_ownership_conflict"); }
function snapshot(bytes: Buffer): PairFile {
  const text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes)) return corrupt();
  return { bytes: text, length: bytes.length, sha256: contentHash(bytes) };
}
async function readPair(root: string, tree: ContentTree): Promise<PairSnapshot> {
  const entries = tree.inventory.filter(entry => entry[1].split("/")[0]?.normalize("NFC").toLowerCase() === "palette");
  if (entries.length === 0) return { present: false };
  if (entries.length !== 3 || !entries.some(entry => entry[0] === "directory" && entry[1] === "palette") ||
    PAIR_PATHS.some(name => !entries.some(entry => entry[0] === "file" && entry[1] === name))) return ownership();
  const json = snapshot(await readPreservedFile(root, "palette/state.json", entries.find(entry => entry[1] === "palette/state.json"), 4 * 65_536));
  const css = snapshot(await readPreservedFile(root, "palette/scales.css", entries.find(entry => entry[1] === "palette/scales.css"), 1024 * 1024));
  if (json.bytes.length > 65_536) return corrupt();
  return { present: true, json, css };
}
function validatePair(pair: PairSnapshot, version: string): void {
  if (version !== PALETTE_EMITTER_VERSION || !pair.present) return corrupt();
  try {
    const state = parsePaletteState(pair.json.bytes);
    const json = serializePalette(state);
    if ((pair.json.bytes !== json && pair.json.bytes !== `${json}\n`) || emitPaletteCss(state) !== pair.css.bytes) return corrupt();
  } catch (error) {
    if (error instanceof UpgradeContractError || error instanceof SyntaxError) return corrupt();
    throw error;
  }
}
/** This exact function is also registered for publication/recovery; no closure-specific validator. */
export const validatePaletteContent: ContentValidator = async (root, journal) => {
  const history = journal.palette_history;
  if (history === null) return corrupt();
  validatePair(history.after, history.emitter_version);
  if (history.before.present) validatePair(history.before, history.emitter_version);
  const names = (await readdir(await safeContentChild(root, "palette"))).sort();
  if (names.length !== 2 || names[0] !== "scales.css" || names[1] !== "state.json") return corrupt();
  // The publisher validates full inventory and pair hashes too. Read again through its bounded IO seam.
  if (!history.after.present) return corrupt();
  for (const [name, file] of [["state.json", history.after.json], ["scales.css", history.after.css]] as const) {
    const bytes = await readPreservedFile(root, `palette/${name}`, undefined, name === "state.json" ? 4 * 65_536 : 1024 * 1024);
    if (bytes.length !== file.length || contentHash(bytes) !== file.sha256) return corrupt();
  }
};
export function paletteContentEnvironment(db: Database = getSqlite(), root: string = systemsDir): ContentEnvironment {
  return { db, systemsRoot: root, operationId: randomUUID, now: Date.now, validators: { palette: validatePaletteContent } };
}
function required(base: ContentObservation): void {
  if (base.row === null) throw new DesignSystemPaletteError("design_system_not_found");
  if (base.row.lifecycle !== "active") throw new DesignSystemPaletteError("invalid_lifecycle");
  if (base.tree === null) return corrupt();
  if (base.head !== null && !Number.isSafeInteger(base.head.revision)) return corrupt();
}
async function actualPair(base: ContentObservation): Promise<PairSnapshot> {
  required(base);
  if (base.tree === null) return corrupt();
  return readPair(base.live, base.tree);
}
async function expectedIdentity(base: ContentObservation): Promise<string> {
  const pair = await actualPair(base);
  const file = (name: string, member: PairFile | null) => [name, member === null ? "absent" : "present", member?.length ?? 0, member?.sha256 ?? null];
  return contentHash(JSON.stringify(["system-palette-save-v1", base.systemId, base.row?.metadataRevision, base.row?.lifecycle,
    base.recordPaths, base.head, base.tree?.manifest.tree_digest, base.tree?.preservation_digest,
    file("palette/state.json", pair.present ? pair.json : null), file("palette/scales.css", pair.present ? pair.css : null)]));
}
/** Follow only committed, digest-linked app evidence. A copied transaction journal is never authority. */
function ownedVersion(env: ContentEnvironment, initial: CatalogReceiptRow | null, pair: PairSnapshot): string | null {
  let receipt: CatalogReceiptRow | null = initial;
  const seen = new Set<string>();
  while (receipt !== null) {
    if (seen.has(receipt.id) || seen.size >= 10_000 || receipt.status !== "committed") return corrupt();
    seen.add(receipt.id);
    if (receipt.schemaVersion === 1) return null;
    if (receipt.schemaVersion !== 2) return corrupt();
    const provenance = parseContentProvenance(JSON.parse(receipt.provenanceJson));
    if (receipt.operation === "content") {
      const journal = parseContentJournal(JSON.parse(receipt.metadataJson));
      if (journal.system_id !== receipt.designSystemId || receipt.id !== `system-content-${journal.operation_id}`) return corrupt();
      if (provenance.writer === "palette") {
        const history = journal.palette_history;
        if (history === null || JSON.stringify(history.after) !== JSON.stringify(pair)) return corrupt();
        return history.emitter_version;
      }
    } else if (receipt.operation !== "duplicate" && receipt.operation !== "derive") return corrupt();
    if (receipt.parentReceiptId === null) return null;
    const parent: CatalogReceiptRow | null = env.db.query<CatalogReceiptRow, [string]>(`SELECT id,design_system_id designSystemId,status,
      content_revision contentRevision,schema_version schemaVersion,digest,manifest_json manifestJson,
      provenance_json provenanceJson,operation,parent_system_id parentSystemId,parent_receipt_id parentReceiptId,
      parent_digest parentDigest,reason,metadata_json metadataJson,source_path sourcePath,destination_path destinationPath
      FROM design_system_receipts WHERE id=?`).get(receipt.parentReceiptId);
    if (parent === null || parent.digest !== receipt.parentDigest || parent.designSystemId !== receipt.parentSystemId ||
      receipt.operation !== "content" && (receipt.digest !== parent.digest || receipt.manifestJson !== parent.manifestJson)) return corrupt();
    receipt = parent;
  }
  return null;
}
function assertOwned(env: ContentEnvironment, base: ContentObservation, pair: PairSnapshot): void {
  if (!pair.present) return;
  let version: string | null;
  try { version = ownedVersion(env, getCurrentSystemContent(env.db, base.systemId), pair); }
  catch (error) { if (error instanceof SyntaxError) return corrupt(); throw error; }
  if (version !== null) { validatePair(pair, version); return; }
  // Keep the shipped additive-history format ready for its later 43-system producer.
  const slug = base.systemId.startsWith("builtin-theme-") ? base.systemId.slice("builtin-theme-".length) : null;
  const files = new Map([
    ["palette/state.json", themeFileHash(Buffer.from(pair.json.bytes))],
    ["palette/scales.css", themeFileHash(Buffer.from(pair.css.bytes))],
  ]);
  if (slug === null || !(bundledThemeHistory.additive?.[slug]?.palette ?? []).includes(themeAdditiveDigest(files, "palette"))) return ownership();
  validatePair(pair, PALETTE_EMITTER_VERSION);
}
async function response(env: ContentEnvironment, base: ContentObservation): Promise<DesignSystemPaletteResponse> {
  const pair = await actualPair(base);
  assertOwned(env, base, pair);
  return { state: pair.present ? parsePaletteState(pair.json.bytes) : null, css: pair.present ? pair.css.bytes : null,
    expected_digest: await expectedIdentity(base), content_revision: base.head?.revision ?? 0, receipt_id: base.head?.receipt_id ?? null };
}
async function observePalette(env: ContentEnvironment, id: string, lease: SystemContentLease): Promise<ContentObservation> {
  try { return await observeSystemContent(env, id, lease); }
  catch (error) {
    if (error instanceof PathBoundaryError || error instanceof CanonicalTreeManifestError) return corrupt();
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return corrupt();
    throw error;
  }
}
export async function readDesignSystemPalette(id: string, env: ContentEnvironment = paletteContentEnvironment()): Promise<DesignSystemPaletteResponse> {
  return withSystemContentAccess(env.db, env.systemsRoot, [id], async lease => response(env, await observePalette(env, id, lease)));
}
export async function saveDesignSystemPalette(id: string, input: SaveDesignSystemPaletteRequest, env: ContentEnvironment = paletteContentEnvironment()): Promise<DesignSystemPaletteResponse> {
  const request = parseSaveDesignSystemPaletteRequest(input);
  const json = serializePalette(request.state), css = emitPaletteCss(request.state);
  if (Buffer.byteLength(css) > 1024 * 1024) return corrupt();
  return withSystemContentAccess(env.db, env.systemsRoot, [id], async lease => {
    const base = await observePalette(env, id, lease);
    const pair = await actualPair(base);
    if (await expectedIdentity(base) !== request.expected_digest) throw new SystemContentError("expected_digest_conflict");
    assertOwned(env, base, pair);
    const prior = getCurrentSystemContent(env.db, id);
    const source = prior === null ? null : prior.schemaVersion === 2 ? parseContentProvenance(JSON.parse(prior.provenanceJson)).source_extraction :
      { receipt_id: prior.operation === "content" ? prior.id : prior.parentReceiptId, digest: prior.digest };
    if (source !== null && source.receipt_id === null) return corrupt();
    const sourceExtraction = source === null || source.receipt_id === null ? null : { receipt_id: source.receipt_id, digest: source.digest };
    const values = new Map([["palette/state.json", json], ["palette/scales.css", css]]);
    const changed = PAIR_PATHS.filter(name => !pair.present || (name === "palette/state.json" ? pair.json.bytes : pair.css.bytes) !== values.get(name));
    const result = await publishSystemContent(env, { systemId: id, mode: "replace", expectedDigest: request.expected_digest, lease, adapter: {
      provenance: { format: "system-content-v1", writer: "palette", source_extraction: sourceExtraction },
      expectedIdentity, writeSet: () => changed,
      transform: async (stage, _base, boundary) => {
        await mkdir(await safeContentChild(stage, "palette"), { recursive: true });
        await writeFile(await safeContentChild(stage, "palette", "state.json"), json);
        await boundary("stage-state-written");
        await writeFile(await safeContentChild(stage, "palette", "scales.css"), css);
        await boundary("stage-css-written");
      },
      validate: validatePaletteContent,
      paletteHistory: async () => ({ emitter_version: PALETTE_EMITTER_VERSION, before: pair,
        after: { present: true, json: snapshot(Buffer.from(json)), css: snapshot(Buffer.from(css)) } }),
    } });
    return response(env, result.observation);
  });
}
