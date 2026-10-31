import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import {
  emitPaletteCss, formatPaletteCssChannel, paletteCssIdentifier, PALETTE_EMITTER_VERSION, parsePaletteState, parsePaletteTransferProof, parseSaveDesignSystemPaletteRequest,
  serializePalette, type DesignSystemPaletteResponse, type PaletteState, type PaletteTransferProof, type SaveDesignSystemPaletteRequest,
} from "@bg/shared/palette";
import { UpgradeContractError } from "@bg/shared/contract-parser";
import { updateThemePalette } from "@bg/shared/theme";
import { getCurrentSystemContent, type CatalogReceiptRow } from "../db/catalog-repository";
import { PaletteTransferRepositoryError, validatePaletteTransferReceipt } from "../db/palette-transfer-repository";
import { getSqlite } from "../db/sqlite-client";
import { systemsDir } from "../lib/paths";
import { PathBoundaryError } from "../security/path-boundary";
import { assertSystemContentLease, withSystemContentAccess, type SystemContentLease } from "./system-content-access";
import { bundledThemeHistory, themeAdditiveDigest, themeFileHash } from "./bundled-theme-refresh";
import { CanonicalTreeManifestError, parseCanonicalTreeManifest } from "./canonical-tree-manifest";
import {
  contentHash, parseContentJournal, parseContentProvenance, SystemContentError,
  type PairFile, type PairSnapshot,
} from "./system-content-format";
import {
  observeSystemContent, publishSystemContent, type ContentEnvironment, type ContentObservation, type ContentValidator,
} from "./system-content-publication";
import { inspectContentTree, readPreservedFile, safeContentChild, type ContentTree } from "./system-content-tree";
import { canonicalFiles, validateCanonicalContent, writeCanonicalCandidate } from "./canonical-theme-files";
import { readOwnedCanonical } from "./design-system-canonical";

const PAIR_PATHS = ["palette/scales.css", "palette/state.json"] as const;
const LEGACY_EMITTER_VERSION = "burnguard-palette-1";
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
function pairEmitterVersion(pair: PairSnapshot): PaletteTransferProof["emitter_version"] {
  if (!pair.present) return corrupt();
  for (const version of [PALETTE_EMITTER_VERSION, LEGACY_EMITTER_VERSION] as const) {
    if (pair.css.bytes.startsWith(`/* ${version} */\n`)) return version;
  }
  return corrupt();
}
function canonicalLegacyCss(bytes: string, state: PaletteState): string {
  if (!bytes.startsWith(`/* ${LEGACY_EMITTER_VERSION} */\n`)) return corrupt();
  const exactAnchors = new Set(state.anchors.filter(anchor => anchor.color.space === "srgb")
    .map(anchor => `--bg-palette-anchor-${paletteCssIdentifier(anchor.id)}`));
  return bytes.replace(`/* ${LEGACY_EMITTER_VERSION} */`, `/* ${PALETTE_EMITTER_VERSION} */`)
    .replace(/^  (--bg-palette-[a-zA-Z0-9_-]+): color\((srgb|display-p3) ([0-9.e+-]+) ([0-9.e+-]+) ([0-9.e+-]+)\);$/gm,
      (match, name: string, space: string, r: string, g: string, b: string) => {
        if (name.startsWith("--bg-palette-anchor-") && (space === "display-p3" || exactAnchors.has(name))) return match;
        const channels = [r, g, b].map(raw => {
          const value = Number(raw);
          if (!Number.isFinite(value) || value < 0 || value > 1 || String(value) !== raw) return corrupt();
          return formatPaletteCssChannel(value);
        });
        return `  ${name}: color(${space} ${channels.join(" ")});`;
      });
}
function validatePair(pair: PairSnapshot, version: string): void {
  if ((version !== PALETTE_EMITTER_VERSION && version !== LEGACY_EMITTER_VERSION) || !pair.present) return corrupt();
  try {
    const state = parsePaletteState(pair.json.bytes);
    const json = serializePalette(state);
    const css = version === LEGACY_EMITTER_VERSION ? canonicalLegacyCss(pair.css.bytes, state) : pair.css.bytes;
    if ((pair.json.bytes !== json && pair.json.bytes !== `${json}\n`) || emitPaletteCss(state) !== css) return corrupt();
  } catch (error) {
    if (error instanceof UpgradeContractError || error instanceof SyntaxError) return corrupt();
    throw error;
  }
}
function validateTransferPair(pair: PairSnapshot, proof: PaletteTransferProof): void {
  if (!pair.present || pair.json.length !== proof.state.size_bytes || pair.json.sha256 !== proof.state.sha256 ||
    pair.css.length !== proof.css.size_bytes || pair.css.sha256 !== proof.css.sha256) return corrupt();
  validatePair(pair, proof.emitter_version);
}
/** Byte validation of a supplied declaration grants no live ownership. */
export async function validatePaletteTransferAtRoot(root: string, input: PaletteTransferProof): Promise<void> {
  const proof = parsePaletteTransferProof(input);
  validateTransferPair(await readPair(root, await inspectContentTree(root)), proof);
}
/** This exact function is also registered for publication/recovery; no closure-specific validator. */
export const validatePaletteContent: ContentValidator = async (root, journal) => {
  const history = journal.palette_history;
  if (history === null) return corrupt();
  validatePair(history.after, history.emitter_version);
  // The result version can advance while the authenticated prior bytes remain unchanged.
  if (history.before.present) validatePair(history.before, pairEmitterVersion(history.before));
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
  return { db, systemsRoot: root, operationId: randomUUID, now: Date.now,
    validators: { palette: validatePaletteContent, canonical: validateCanonicalContent, "bundle-import": validateBundleImportContent } };
}
const validateBundleImportContent: ContentValidator = async (root, journal) => {
  if (journal.mode !== "create" || journal.base !== null || journal.palette_history !== null) return corrupt();
  await validateCanonicalContent(root, journal);
  const pair = await readPair(root, await inspectContentTree(root));
  if (!pair.present) return corrupt();
  validatePair(pair, pairEmitterVersion(pair));
};
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
function ownedVersion(env: ContentEnvironment, base: ContentObservation, pair: PairSnapshot): PaletteTransferProof["emitter_version"] | null {
  let receipt: CatalogReceiptRow | null = getCurrentSystemContent(env.db, base.systemId);
  const seen = new Set<string>();
  while (receipt !== null) {
    if (seen.has(receipt.id) || seen.size >= 10_000 || receipt.status !== "committed" ||
      receipt.designSystemId !== base.systemId || (receipt.schemaVersion !== 1 && receipt.schemaVersion !== 2)) return corrupt();
    seen.add(receipt.id);
    const proof = validatePaletteTransferReceipt(env.db, receipt);
    if (proof !== null) {
      if (receipt.destinationPath !== null && receipt.destinationPath !== base.live) return corrupt();
      validateTransferPair(pair, proof);
      return proof.emitter_version;
    }
    // Foreign lineage is historical metadata, never a live palette dependency.
    if (receipt.operation === "duplicate" || receipt.operation === "derive") return null;
    if (receipt.schemaVersion === 1) return null;
    if (receipt.operation !== "content" || !Number.isSafeInteger(receipt.contentRevision) || receipt.contentRevision < 1) return corrupt();
    const provenance = parseContentProvenance(JSON.parse(receipt.provenanceJson));
    const journal = parseContentJournal(JSON.parse(receipt.metadataJson));
    const manifest = parseCanonicalTreeManifest(JSON.parse(receipt.manifestJson));
    const head = journal.base?.head ?? null;
    if (journal.system_id !== base.systemId || receipt.id !== `system-content-${journal.operation_id}` ||
      receipt.digest !== manifest.tree_digest || journal.intent !== "publish" || journal.failure_code !== null ||
      receipt.destinationPath !== base.live || receipt.sourcePath !== (journal.mode === "replace" ? base.live : null) ||
      receipt.parentReceiptId !== (head?.receipt_id ?? null) || receipt.parentDigest !== (head?.digest ?? null) ||
      receipt.parentSystemId !== (head === null ? null : base.systemId) ||
      (provenance.writer === "palette") !== (journal.palette_history !== null)) return corrupt();
    if (provenance.writer === "palette") {
      const history = journal.palette_history;
      if (history === null || JSON.stringify(history.after) !== JSON.stringify(pair)) return corrupt();
      const version = pairEmitterVersion(pair);
      if (history.emitter_version !== version) return corrupt();
      validatePair(pair, version);
      return version;
    }
    if (receipt.parentReceiptId === null) return null;
    const parent: CatalogReceiptRow | null = env.db.query<CatalogReceiptRow, [string]>(`SELECT id,design_system_id designSystemId,status,
      content_revision contentRevision,schema_version schemaVersion,digest,manifest_json manifestJson,
      provenance_json provenanceJson,operation,parent_system_id parentSystemId,parent_receipt_id parentReceiptId,
      parent_digest parentDigest,reason,metadata_json metadataJson,source_path sourcePath,destination_path destinationPath
      FROM design_system_receipts WHERE id=?`).get(receipt.parentReceiptId);
    if (parent === null || head === null || parent.digest !== head.digest || parent.designSystemId !== base.systemId ||
      parent.contentRevision !== head.revision || parent.schemaVersion !== head.schema_version ||
      JSON.stringify(parseCanonicalTreeManifest(JSON.parse(parent.manifestJson))) !== JSON.stringify(journal.base?.manifest)) return corrupt();
    receipt = parent;
  }
  return null;
}
function assertOwned(env: ContentEnvironment, base: ContentObservation, pair: PairSnapshot): PaletteTransferProof["emitter_version"] | null {
  if (!pair.present) return null;
  let version: PaletteTransferProof["emitter_version"] | null;
  try { version = ownedVersion(env, base, pair); }
  catch (error) {
    if (error instanceof SyntaxError || error instanceof PaletteTransferRepositoryError || error instanceof CanonicalTreeManifestError) return corrupt();
    throw error;
  }
  if (version !== null) return version;
  // Keep the shipped additive-history format ready for its later 43-system producer.
  const slug = base.systemId.startsWith("builtin-theme-") ? base.systemId.slice("builtin-theme-".length) : null;
  const files = new Map([
    ["palette/state.json", themeFileHash(Buffer.from(pair.json.bytes))],
    ["palette/scales.css", themeFileHash(Buffer.from(pair.css.bytes))],
  ]);
  if (slug === null || !(bundledThemeHistory.additive?.[slug]?.palette ?? []).includes(themeAdditiveDigest(files, "palette"))) return ownership();
  version = pairEmitterVersion(pair);
  validatePair(pair, version);
  return version;
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
/** The caller already owns this genuine lease; do not acquire a nested lock. */
export async function authenticatePaletteTransfer(env: ContentEnvironment, id: string, lease: SystemContentLease): Promise<PaletteTransferProof | null> {
  assertSystemContentLease(lease, env.systemsRoot, id);
  const base = await observePalette(env, id, lease);
  const pair = await actualPair(base);
  const version = assertOwned(env, base, pair);
  if (!pair.present) return null;
  if (version === null) return corrupt();
  return parsePaletteTransferProof({ schema_version: 1, emitter_version: version,
    state: { size_bytes: pair.json.length, sha256: pair.json.sha256 },
    css: { size_bytes: pair.css.length, sha256: pair.css.sha256 } });
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
    const canonical = await readOwnedCanonical(env, base, lease);
    const nextCanonical = canonical === null ? null : serializePalette(canonical.theme.palette) === json
      ? canonical : canonicalFiles(updateThemePalette(canonical.theme, request.state));
    const prior = getCurrentSystemContent(env.db, id);
    const source = prior === null ? null : prior.schemaVersion === 2 ? parseContentProvenance(JSON.parse(prior.provenanceJson)).source_extraction :
      { receipt_id: prior.operation === "content" ? prior.id : prior.parentReceiptId, digest: prior.digest };
    if (source !== null && source.receipt_id === null) return corrupt();
    const sourceExtraction = source === null || source.receipt_id === null ? null : { receipt_id: source.receipt_id, digest: source.digest };
    const values = new Map([["palette/state.json", json], ["palette/scales.css", css]]);
    const changed: string[] = PAIR_PATHS.filter(name => !pair.present || (name === "palette/state.json" ? pair.json.bytes : pair.css.bytes) !== values.get(name));
    if (canonical !== null && nextCanonical !== null) for (const [name, before, after] of [
      ["canonical/theme.json", canonical.json, nextCanonical.json],
      ["canonical/theme.css", canonical.css, nextCanonical.css],
      ["canonical/SKILL.md", canonical.skill, nextCanonical.skill],
    ] as const) if (before !== after) changed.push(name);
    changed.sort();
    const result = await publishSystemContent(env, { systemId: id, mode: "replace", expectedDigest: request.expected_digest, lease, adapter: {
      provenance: { format: "system-content-v1", writer: "palette", source_extraction: sourceExtraction },
      expectedIdentity, writeSet: () => changed,
      transform: async (stage, _base, boundary) => {
        await mkdir(await safeContentChild(stage, "palette"), { recursive: true });
        await writeFile(await safeContentChild(stage, "palette", "state.json"), json);
        await boundary("stage-state-written");
        await writeFile(await safeContentChild(stage, "palette", "scales.css"), css);
        await boundary("stage-css-written");
        if (nextCanonical !== null) await writeCanonicalCandidate(stage, nextCanonical.theme);
      },
      validate: validatePaletteContent,
      canonicalTransfer: async () => nextCanonical?.proof ?? null,
      paletteHistory: async () => ({ emitter_version: PALETTE_EMITTER_VERSION, before: pair,
        after: { present: true, json: snapshot(Buffer.from(json)), css: snapshot(Buffer.from(css)) } }),
    } });
    return response(env, result.observation);
  });
}
