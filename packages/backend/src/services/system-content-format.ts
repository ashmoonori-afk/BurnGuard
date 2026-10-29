import { createHash } from "node:crypto";
import { assertSafeName } from "../security/path-boundary";
import { parseCanonicalTreeManifest, type CanonicalTreeManifest } from "./canonical-tree-manifest";

export class SystemContentError extends Error {
  readonly name = "SystemContentError";
  constructor(readonly code: "system_content_corrupt" | "system_content_conflict" | "system_content_unavailable" | "expected_digest_conflict" | "system_content_failed") {
    super(code);
  }
}

export const SYSTEM_CONTENT_WRITERS = ["palette", "canonical", "brand-image", "bundled-addition", "token", "font", "rules", "logo", "bundle-import"] as const;
export type SystemContentWriter = typeof SYSTEM_CONTENT_WRITERS[number];
export type ContentHead = {
  readonly receipt_id: string; readonly revision: number; readonly schema_version: 1 | 2; readonly digest: string;
};
export type ContentBase = {
  readonly head: ContentHead | null; readonly metadata_revision: number;
  readonly lifecycle: "active" | "archived"; readonly manifest: CanonicalTreeManifest; readonly preservation_digest: string;
};
export type ContentProvenance = {
  readonly format: "system-content-v1"; readonly writer: SystemContentWriter;
  readonly source_extraction: { readonly receipt_id: string; readonly digest: string } | null;
};
export type PairFile = { readonly bytes: string; readonly length: number; readonly sha256: string };
export type PairSnapshot = { readonly present: false } | { readonly present: true; readonly json: PairFile; readonly css: PairFile };
export type PaletteHistory = { readonly emitter_version: string; readonly before: PairSnapshot; readonly after: PairSnapshot };
export type ContentJournal = {
  readonly transaction_version: 1; readonly operation_id: string; readonly system_id: string;
  readonly mode: "replace" | "create"; readonly intent: "publish" | "rollback"; readonly cleanup: "pending" | "complete";
  readonly base: ContentBase | null; readonly result_preservation_digest: string; readonly write_set: readonly string[];
  readonly palette_history: PaletteHistory | null; readonly failure_code: "system_content_failed" | "system_content_conflict" | "system_content_corrupt" | null;
};
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function contentHash(bytes: string | Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
export function corrupt(): never { throw new SystemContentError("system_content_corrupt"); }
export function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return corrupt();
  const record: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  const actual = Object.keys(record).sort();
  if (actual.length !== keys.length || actual.some((key, index) => key !== [...keys].sort()[index])) return corrupt();
  return record;
}
export function digest(value: unknown): string { return typeof value === "string" && SHA256.test(value) ? value : corrupt(); }
export function operationId(value: unknown): string { return typeof value === "string" && UUID.test(value) ? value : corrupt(); }
function identifier(value: unknown): string { if (typeof value !== "string" || value.length > 255) return corrupt(); return assertSafeName(value); }
export function contentPath(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096 || value.includes("\\") || value.normalize("NFC") !== value) return corrupt();
  for (const part of value.split("/")) assertSafeName(part);
  return value;
}
function integer(value: unknown, minimum = 0): number { return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum ? value : corrupt(); }
export function parseContentHead(value: unknown): ContentHead | null {
  if (value === null) return null;
  const r = exactRecord(value, ["receipt_id", "revision", "schema_version", "digest"]);
  if (r["schema_version"] !== 1 && r["schema_version"] !== 2) return corrupt();
  return { receipt_id: identifier(r["receipt_id"]), revision: integer(r["revision"], -Number.MAX_SAFE_INTEGER), schema_version: r["schema_version"], digest: digest(r["digest"]) };
}
export function parseContentProvenance(value: unknown): ContentProvenance {
  const r = exactRecord(value, ["format", "writer", "source_extraction"]);
  if (r["format"] !== "system-content-v1") return corrupt();
  const writer = SYSTEM_CONTENT_WRITERS.find((candidate) => candidate === r["writer"]);
  if (writer === undefined) return corrupt();
  const source = r["source_extraction"];
  const extraction = source === null ? null : exactRecord(source, ["receipt_id", "digest"]);
  return { format: "system-content-v1", writer, source_extraction: extraction === null ? null : { receipt_id: identifier(extraction["receipt_id"]), digest: digest(extraction["digest"]) } };
}
function parsePairFile(value: unknown, json: boolean): PairFile {
  const r = exactRecord(value, ["bytes", "length", "sha256"]);
  const bytes = r["bytes"];
  if (typeof bytes !== "string" || (json ? bytes.length > 65_536 : Buffer.byteLength(bytes) > 1024 * 1024)) return corrupt();
  const length = integer(r["length"]);
  const sha256 = digest(r["sha256"]);
  if (Buffer.byteLength(bytes) !== length || contentHash(bytes) !== sha256 || Buffer.from(bytes).toString("utf8") !== bytes) return corrupt();
  return { bytes, length, sha256 };
}
function parsePair(value: unknown): PairSnapshot {
  if (typeof value !== "object" || value === null || !("present" in value)) return corrupt();
  if (value.present === false) { exactRecord(value, ["present"]); return { present: false }; }
  const r = exactRecord(value, ["present", "json", "css"]);
  if (r["present"] !== true) return corrupt();
  return { present: true, json: parsePairFile(r["json"], true), css: parsePairFile(r["css"], false) };
}
export function parseContentJournal(value: unknown): ContentJournal {
  const r = exactRecord(value, ["transaction_version", "operation_id", "system_id", "mode", "intent", "cleanup", "base", "result_preservation_digest", "write_set", "palette_history", "failure_code"]);
  if (r["transaction_version"] !== 1 || (r["mode"] !== "replace" && r["mode"] !== "create") || (r["intent"] !== "publish" && r["intent"] !== "rollback") || (r["cleanup"] !== "pending" && r["cleanup"] !== "complete")) return corrupt();
  let base: ContentBase | null = null;
  if (r["base"] !== null) {
    const b = exactRecord(r["base"], ["head", "metadata_revision", "lifecycle", "manifest", "preservation_digest"]);
    if (b["lifecycle"] !== "active" && b["lifecycle"] !== "archived") return corrupt();
    base = { head: parseContentHead(b["head"]), metadata_revision: integer(b["metadata_revision"]), lifecycle: b["lifecycle"], manifest: parseCanonicalTreeManifest(b["manifest"]), preservation_digest: digest(b["preservation_digest"]) };
  }
  if ((r["mode"] === "create") !== (base === null)) return corrupt();
  const paths = r["write_set"];
  if (!Array.isArray(paths) || paths.length > 10_000) return corrupt();
  const writeSet = paths.map(contentPath);
  const folded = new Set<string>();
  for (const [index, name] of writeSet.entries()) {
    if ((index > 0 && name <= (writeSet[index - 1] ?? "")) || folded.has(name.toLowerCase())) return corrupt();
    folded.add(name.toLowerCase());
  }
  let history: PaletteHistory | null = null;
  if (r["palette_history"] !== null) {
    if (Buffer.byteLength(JSON.stringify(r["palette_history"])) > 4 * 1024 * 1024) return corrupt();
    const h = exactRecord(r["palette_history"], ["emitter_version", "before", "after"]);
    if (typeof h["emitter_version"] !== "string" || !/^[a-zA-Z0-9._-]{1,64}$/.test(h["emitter_version"])) return corrupt();
    history = { emitter_version: h["emitter_version"], before: parsePair(h["before"]), after: parsePair(h["after"]) };
  }
  const code = r["failure_code"];
  if (code !== null && code !== "system_content_failed" && code !== "system_content_conflict" && code !== "system_content_corrupt") return corrupt();
  return { transaction_version: 1, operation_id: operationId(r["operation_id"]), system_id: identifier(r["system_id"]), mode: r["mode"], intent: r["intent"], cleanup: r["cleanup"], base, result_preservation_digest: digest(r["result_preservation_digest"]), write_set: writeSet, palette_history: history, failure_code: code };
}
