import { parseCanonicalTreeManifest, type CanonicalTreeManifest } from "./canonical-tree-manifest";
import type { ArtifactFileDiff } from "./artifact-tree-storage";

const HASH = /^[0-9a-f]{64}$/;
const KINDS = ["patch", "palette", "turn", "restore", "undo", "external", "initialize"] as const;
export type ArtifactOperationKind = (typeof KINDS)[number];
export type ArtifactReplay = {
  readonly kind: ArtifactOperationKind;
  readonly parent_operation_id: string | null;
  readonly publication: "base" | "result";
};

export class ArtifactReceiptError extends Error {
  readonly name = "ArtifactReceiptError";
  constructor(readonly code: "corrupt_receipt", message: string) { super(message); }
}

export function parseArtifactSnapshot(value: string): { readonly snapshot_path: string; readonly stage_path: string; readonly base_manifest: CanonicalTreeManifest } {
  const item = parseReceipt(value, ["schema_version", "snapshot_path", "stage_path", "base_manifest"]);
  if (item["schema_version"] !== 1 || !nonempty(item["snapshot_path"]) || !nonempty(item["stage_path"])) fail("Snapshot receipt is invalid");
  return { snapshot_path: item["snapshot_path"], stage_path: item["stage_path"], base_manifest: parseCanonicalTreeManifest(item["base_manifest"]) };
}

export function parseArtifactRetention(value: string): { readonly replayable: boolean; readonly retained_until: number; readonly pruned_at: number | null; readonly prune_reason: string | null } {
  const item = parseReceipt(value, ["schema_version", "replayable", "retained_until", "pruned_at", "prune_reason"]);
  const replayable = item["replayable"];
  const retainedUntil = safeCount(item["retained_until"]);
  const prunedAt = nullableCount(item["pruned_at"]);
  const pruneReason = item["prune_reason"];
  if (item["schema_version"] !== 1 || typeof replayable !== "boolean" || (pruneReason !== null && !nonempty(pruneReason))) fail("Retention receipt is invalid");
  if (replayable ? prunedAt !== null || pruneReason !== null : prunedAt === null || pruneReason === null) fail("Retention state is inconsistent");
  return { replayable, retained_until: retainedUntil, pruned_at: prunedAt, prune_reason: pruneReason };
}

export function parseArtifactDiff(value: string): readonly ArtifactFileDiff[] {
  const parsed: unknown = parseJson(value);
  if (!Array.isArray(parsed)) fail("Diff receipt is invalid");
  const canonicalPaths = new Set<string>();
  let previous = "";
  return parsed.map((entry) => {
    const item = exactRecord(entry, ["path", "action", "before_hash", "after_hash", "before_bytes", "after_bytes"], "Diff entry is invalid");
    const filePath = item["path"];
    const action = item["action"];
    if (!canonicalPath(filePath) || filePath <= previous || (action !== "created" && action !== "edited" && action !== "deleted")) fail("Diff entries are not canonical");
    const folded = filePath.toLocaleLowerCase("en-US");
    if (canonicalPaths.has(folded)) fail("Diff paths collide");
    canonicalPaths.add(folded); previous = filePath;
    const beforeHash = nullableHash(item["before_hash"]); const afterHash = nullableHash(item["after_hash"]);
    const beforeBytes = byteCount(item["before_bytes"]); const afterBytes = byteCount(item["after_bytes"]);
    if ((action === "created" && (beforeHash !== null || beforeBytes !== 0 || afterHash === null)) || (action === "deleted" && (afterHash !== null || afterBytes !== 0 || beforeHash === null)) || (action === "edited" && (beforeHash === null || afterHash === null))) fail("Diff action fields are inconsistent");
    return { path: filePath, action, before_hash: beforeHash, after_hash: afterHash, before_bytes: beforeBytes, after_bytes: afterBytes };
  });
}

export function parseArtifactReplay(value: string): ArtifactReplay {
  const item = parseReceipt(value, ["schema_version", "kind", "parent_operation_id", "publication"]);
  const kind = item["kind"];
  const parent = item["parent_operation_id"];
  const publication = item["publication"];
  if (item["schema_version"] !== 1 || !KINDS.includes(kind as ArtifactOperationKind) || (parent !== null && !nonempty(parent)) || (publication !== "base" && publication !== "result")) fail("Replay receipt is invalid");
  if (kind === "undo" ? parent === null : kind !== "external" && parent !== null) fail("Replay parent is invalid");
  return { kind: kind as ArtifactOperationKind, parent_operation_id: parent, publication };
}

function parseReceipt(value: string, keys: readonly string[]): Readonly<Record<string, unknown>> {
  return exactRecord(parseJson(value), keys, "Receipt is not an exact object");
}
function exactRecord(value: unknown, keys: readonly string[], message: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(message);
  const record = value as Readonly<Record<string, unknown>>;
  const actual = Object.keys(record).sort(); const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(message);
  return record;
}
function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch (error) { throw new ArtifactReceiptError("corrupt_receipt", error instanceof Error ? error.message : "Receipt is not JSON"); }
}
function nullableHash(value: unknown): string | null { if (value === null) return null; if (typeof value !== "string" || !HASH.test(value)) fail("Diff hash is invalid"); return value; }
function byteCount(value: unknown): number { return safeCount(value); }
function safeCount(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail("Receipt count is invalid"); return value; }
function nullableCount(value: unknown): number | null { return value === null ? null : safeCount(value); }
function nonempty(value: unknown): value is string { return typeof value === "string" && value.length > 0; }
function canonicalPath(value: unknown): value is string { return nonempty(value) && !value.startsWith("/") && !value.includes("\\") && !value.includes("\0") && value.normalize("NFC") === value && value.split("/").every((part) => part !== "" && part !== "." && part !== ".."); }
function fail(message: string): never { throw new ArtifactReceiptError("corrupt_receipt", message); }
