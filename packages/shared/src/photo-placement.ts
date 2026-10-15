import {
  UpgradeContractError,
  decodeContract,
  isRecord,
  requiredArray,
  requiredNumber,
  requiredString,
  type UnknownRecord,
} from "./contract-parser";

/**
 * Photographic placement record (doc/image-production). One entry per real-world photographic image a design
 * places: where it goes, which real references it was checked against, whether the provider actually received
 * those references, and which candidates were compared. The agent fills the file; the backend derives the status,
 * so a record can never claim to be verified. Reference photos are inputs only and never belong in a deliverable.
 */

/** Both live under `.meta/`, which the canonical artifact tree excludes, so references can never ship by location alone. */
export const PHOTO_PLACEMENTS_FILE = ".meta/photo-placements.json";
export const PHOTO_REFERENCE_DIR = ".meta/references";
export const PHOTO_PLACEMENT_LIMITS = { max_placements: 24, max_references: 12, max_candidates: 8, max_facts: 12, max_text: 400 } as const;

export const PHOTO_PLACEMENT_MODES = ["cover", "crop"] as const;
export type PhotoPlacementMode = (typeof PHOTO_PLACEMENT_MODES)[number];
export const PHOTO_ATTACHMENT_RECEIPTS = ["yes", "no", "unsupported"] as const;
export type PhotoAttachmentReceipt = (typeof PHOTO_ATTACHMENT_RECEIPTS)[number];
export type PhotoPlacementStatus = "reference_verified" | "unverified" | "unsupported";
export type PhotoPlacementMissing = "reference_sources" | "attachment_receipt" | "candidate_comparison";

export type PhotoReferenceV1 = { readonly url: string; readonly licence: string; readonly local_file: string; readonly sha256: string };
export type PhotoScaleFactV1 = { readonly claim: string; readonly status: "verified" | "estimated"; readonly source: string | null };
export type PhotoCandidateV1 = { readonly id: string; readonly file: string; readonly rejected_reason: string | null };
export type PhotoPlacementV1 = {
  readonly id: string;
  readonly purpose: string;
  readonly box: { readonly width_px: number; readonly height_px: number };
  readonly placement_mode: PhotoPlacementMode;
  readonly text_safe_region: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null;
  readonly references: readonly PhotoReferenceV1[];
  readonly scale_facts: readonly PhotoScaleFactV1[];
  readonly attachment_receipt: PhotoAttachmentReceipt;
  readonly candidates: readonly PhotoCandidateV1[];
  readonly chosen_candidate: string | null;
};
export type PhotoPlacementsV1 = { readonly schema_version: 1; readonly placements: readonly PhotoPlacementV1[] };

const SHA256_HEX = /^[0-9a-f]{64}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;

/** Status that cannot lie: verified only with a source, a positive receipt and two compared candidates. */
export function derivePhotoPlacementStatus(placement: PhotoPlacementV1): { readonly status: PhotoPlacementStatus; readonly missing: readonly PhotoPlacementMissing[] } {
  const missing: PhotoPlacementMissing[] = [];
  if (placement.references.length === 0) missing.push("reference_sources");
  if (placement.attachment_receipt !== "yes") missing.push("attachment_receipt");
  if (placement.candidates.length < 2) missing.push("candidate_comparison");
  const status: PhotoPlacementStatus = missing.length === 0 ? "reference_verified" : placement.attachment_receipt === "unsupported" ? "unsupported" : "unverified";
  return { status, missing };
}

export function parsePhotoPlacementsV1(input: unknown): PhotoPlacementsV1 {
  const record = decodeContract(input);
  exact(record, ["schema_version", "placements"]);
  if (requiredNumber(record, "schema_version") !== 1) invalid("schema_version");
  const raw = requiredArray(record, "placements");
  if (raw.length > PHOTO_PLACEMENT_LIMITS.max_placements) invalid("placements");
  const placements = raw.map((value, index) => parsePlacement(value, `placements.${index}`));
  if (new Set(placements.map((placement) => placement.id)).size !== placements.length) invalid("placements.id");
  return { schema_version: 1, placements };
}

function parsePlacement(value: unknown, path: string): PhotoPlacementV1 {
  const record = asRecord(value, path);
  exact(record, ["id", "purpose", "box", "placement_mode", "text_safe_region", "references", "scale_facts", "attachment_receipt", "candidates", "chosen_candidate"]);
  const id = text(record, "id", path, 64);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) invalid(`${path}.id`);
  const box = asRecord(record["box"], `${path}.box`);
  exact(box, ["width_px", "height_px"]);
  const candidates = bounded(requiredArray(record, "candidates"), PHOTO_PLACEMENT_LIMITS.max_candidates, `${path}.candidates`).map((item, index) => parseCandidate(item, `${path}.candidates.${index}`));
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  if (candidateIds.size !== candidates.length) invalid(`${path}.candidates.id`);
  const chosenRaw = record["chosen_candidate"];
  const chosen = chosenRaw === null ? null : text(record, "chosen_candidate", path, 64);
  if (chosen !== null && !candidateIds.has(chosen)) invalid(`${path}.chosen_candidate`);
  return {
    id,
    purpose: text(record, "purpose", path, PHOTO_PLACEMENT_LIMITS.max_text),
    box: { width_px: positive(box, "width_px", `${path}.box`), height_px: positive(box, "height_px", `${path}.box`) },
    placement_mode: oneOf(record, "placement_mode", path, PHOTO_PLACEMENT_MODES),
    text_safe_region: record["text_safe_region"] === null ? null : parseRegion(record["text_safe_region"], `${path}.text_safe_region`),
    references: bounded(requiredArray(record, "references"), PHOTO_PLACEMENT_LIMITS.max_references, `${path}.references`).map((item, index) => parseReference(item, `${path}.references.${index}`)),
    scale_facts: bounded(requiredArray(record, "scale_facts"), PHOTO_PLACEMENT_LIMITS.max_facts, `${path}.scale_facts`).map((item, index) => parseFact(item, `${path}.scale_facts.${index}`)),
    attachment_receipt: oneOf(record, "attachment_receipt", path, PHOTO_ATTACHMENT_RECEIPTS),
    candidates,
    chosen_candidate: chosen,
  };
}

function parseReference(value: unknown, path: string): PhotoReferenceV1 {
  const record = asRecord(value, path);
  exact(record, ["url", "licence", "local_file", "sha256"]);
  const url = text(record, "url", path, 2048);
  let parsed: URL;
  try { parsed = new URL(url); } catch { return invalid(`${path}.url`); }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") invalid(`${path}.url`);
  const sha256 = requiredString(record, "sha256");
  if (!SHA256_HEX.test(sha256)) invalid(`${path}.sha256`);
  return { url, licence: text(record, "licence", path, 120), local_file: referenceFile(record, path), sha256 };
}

function parseFact(value: unknown, path: string): PhotoScaleFactV1 {
  const record = asRecord(value, path);
  exact(record, ["claim", "status", "source"]);
  const status = oneOf(record, "status", path, ["verified", "estimated"] as const);
  const source = record["source"] === null ? null : text(record, "source", path, 2048);
  if (status === "verified" && source === null) invalid(`${path}.source`);
  return { claim: text(record, "claim", path, PHOTO_PLACEMENT_LIMITS.max_text), status, source };
}

function parseCandidate(value: unknown, path: string): PhotoCandidateV1 {
  const record = asRecord(value, path);
  exact(record, ["id", "file", "rejected_reason"]);
  return {
    id: text(record, "id", path, 64),
    file: relativeFile(record, "file", path),
    rejected_reason: record["rejected_reason"] === null ? null : text(record, "rejected_reason", path, PHOTO_PLACEMENT_LIMITS.max_text),
  };
}

function parseRegion(value: unknown, path: string): { x: number; y: number; width: number; height: number } {
  const record = asRecord(value, path);
  exact(record, ["x", "y", "width", "height"]);
  const read = (key: string): number => {
    const number = record[key];
    if (typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > 1) invalid(`${path}.${key}`);
    return number;
  };
  const region = { x: read("x"), y: read("y"), width: read("width"), height: read("height") };
  if (region.width === 0 || region.height === 0 || region.x + region.width > 1 + 1e-9 || region.y + region.height > 1 + 1e-9) invalid(path);
  return region;
}

function relativeFile(record: UnknownRecord, key: string, path: string): string {
  const value = text(record, key, path, 512);
  if (value.startsWith("/") || value.includes("\\") || /^[A-Za-z]:/.test(value) || value.split("/").some((part) => part === ".." || part === "")) invalid(`${path}.${key}`);
  return value;
}

function referenceFile(record: UnknownRecord, path: string): string {
  const value = relativeFile(record, "local_file", path);
  if (!value.startsWith(`${PHOTO_REFERENCE_DIR}/`)) invalid(`${path}.local_file`);
  return value;
}

function text(record: UnknownRecord, key: string, path: string, max: number): string {
  const value = requiredString(record, key);
  if (value.trim().length === 0 || value.length > max || CONTROL_CHARACTERS.test(value)) invalid(`${path}.${key}`);
  return value;
}

function positive(record: UnknownRecord, key: string, path: string): number {
  const value = requiredNumber(record, key);
  if (!Number.isFinite(value) || value <= 0 || value > 100_000) invalid(`${path}.${key}`);
  return value;
}

function oneOf<T extends string>(record: UnknownRecord, key: string, path: string, allowed: readonly T[]): T {
  const value = requiredString(record, key);
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) invalid(`${path}.${key}`);
  return match;
}

function bounded(items: readonly unknown[], max: number, path: string): readonly unknown[] {
  if (items.length > max) invalid(path);
  return items;
}

function asRecord(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) invalid(path);
  return value;
}

function exact(record: UnknownRecord, keys: readonly string[]): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) if (!allowed.has(key)) invalid(key);
  for (const key of keys) if (!(key in record)) throw new UpgradeContractError("missing_required_field", key);
}

function invalid(path: string): never {
  throw new UpgradeContractError("invalid_field", path);
}
