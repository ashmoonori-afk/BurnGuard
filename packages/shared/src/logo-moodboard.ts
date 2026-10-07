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
 * Project moodboard contract (doc/23-logo-design-deliverable). A board is a bounded, revisioned
 * list of immutable visual references: uploaded image files and bookmarked HTTPS links. Links are
 * metadata only and are never fetched; the board proves nothing about an opaque link's pixels.
 *
 * File `id` and `sha256` are both the content hash, so a re-encoding cannot reuse an identity.
 * `digest` is the canonical hash of the board; `revision` is the compare-and-set token every
 * mutation must be submitted against. The shared parser is pure: no filesystem, no network.
 */

export const MOODBOARD_SCHEMA_VERSION = 1 as const;

export const MOODBOARD_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type MoodboardMimeType = (typeof MOODBOARD_MIME_TYPES)[number];

export const MOODBOARD_LIMITS = {
  max_files: 12,
  max_links: 16,
  max_file_bytes: 5 * 1024 * 1024,
  max_total_bytes: 25 * 1024 * 1024,
  max_url_chars: 2048,
} as const;

export type MoodboardFileItemV1 = {
  readonly kind: "file";
  readonly id: string;
  readonly sha256: string;
  readonly mime_type: MoodboardMimeType;
  readonly size_bytes: number;
  readonly original_name: string;
  readonly fingerprint: string;
  readonly added_at: number;
};

export type MoodboardLinkItemV1 = {
  readonly kind: "link";
  readonly id: string;
  readonly url: string;
  readonly added_at: number;
};

export type MoodboardItemV1 = MoodboardFileItemV1 | MoodboardLinkItemV1;

export type LogoMoodboardV1 = {
  readonly schema_version: 1;
  readonly revision: number;
  readonly digest: string;
  readonly items: readonly MoodboardItemV1[];
};

const SHA256_HEX = /^[0-9a-f]{64}$/;
const FINGERPRINT_HEX = /^[0-9a-f]{16}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;

export function parseLogoMoodboardV1(input: unknown): LogoMoodboardV1 {
  const record = decodeContract(input);
  exact(record, ["schema_version", "revision", "digest", "items"]);
  if (requiredNumber(record, "schema_version") !== 1) invalid("schema_version");
  const revision = requiredNumber(record, "revision");
  const digest = sha256Hex(record, "digest", "digest");
  const rawItems = requiredArray(record, "items");
  const items = rawItems.map(parseItem);
  const ids = new Set<string>();
  let fileCount = 0;
  let linkCount = 0;
  let totalBytes = 0;
  for (const item of items) {
    if (ids.has(item.id)) invalid("items.id");
    ids.add(item.id);
    if (item.kind === "file") {
      fileCount += 1;
      totalBytes += item.size_bytes;
    } else {
      linkCount += 1;
    }
  }
  if (fileCount > MOODBOARD_LIMITS.max_files) invalid("items.files");
  if (linkCount > MOODBOARD_LIMITS.max_links) invalid("items.links");
  if (totalBytes > MOODBOARD_LIMITS.max_total_bytes) invalid("items.total_bytes");
  return { schema_version: 1, revision, digest, items };
}

function parseItem(value: unknown, index: number): MoodboardItemV1 {
  const path = `items.${index}`;
  if (!isRecord(value)) invalid(path);
  if (value.kind === "file") return parseFileItem(value, path);
  if (value.kind === "link") return parseLinkItem(value, path);
  return invalid(`${path}.kind`);
}

function parseFileItem(value: UnknownRecord, path: string): MoodboardFileItemV1 {
  exact(value, ["kind", "id", "sha256", "mime_type", "size_bytes", "original_name", "fingerprint", "added_at"]);
  const id = sha256Hex(value, "id", `${path}.id`);
  const sha256 = sha256Hex(value, "sha256", `${path}.sha256`);
  if (id !== sha256) invalid(`${path}.id`);
  const rawMime = requiredString(value, "mime_type");
  const mimeType = MOODBOARD_MIME_TYPES.find((candidate) => candidate === rawMime);
  if (mimeType === undefined) invalid(`${path}.mime_type`);
  const sizeBytes = requiredNumber(value, "size_bytes");
  if (sizeBytes < 1 || sizeBytes > MOODBOARD_LIMITS.max_file_bytes) invalid(`${path}.size_bytes`);
  const originalName = requiredString(value, "original_name").trim();
  if (originalName.length === 0 || originalName.length > 255 || CONTROL_CHARACTERS.test(originalName) || originalName.includes("/") || originalName.includes("\\")) invalid(`${path}.original_name`);
  const fingerprint = requiredString(value, "fingerprint");
  if (!FINGERPRINT_HEX.test(fingerprint)) invalid(`${path}.fingerprint`);
  const addedAt = requiredNumber(value, "added_at");
  return {
    kind: "file",
    id,
    sha256,
    mime_type: mimeType,
    size_bytes: sizeBytes,
    original_name: originalName,
    fingerprint,
    added_at: addedAt,
  };
}

function parseLinkItem(value: UnknownRecord, path: string): MoodboardLinkItemV1 {
  exact(value, ["kind", "id", "url", "added_at"]);
  const id = sha256Hex(value, "id", `${path}.id`);
  const url = requiredString(value, "url");
  if (url.length > MOODBOARD_LIMITS.max_url_chars || CONTROL_CHARACTERS.test(url) || /\s/.test(url)) invalid(`${path}.url`);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    if (error instanceof TypeError) invalid(`${path}.url`);
    throw error;
  }
  if (parsed.protocol !== "https:" || parsed.hostname.length === 0 || parsed.username !== "" || parsed.password !== "") invalid(`${path}.url`);
  const addedAt = requiredNumber(value, "added_at");
  return { kind: "link", id, url, added_at: addedAt };
}

function sha256Hex(record: UnknownRecord, key: string, path: string): string {
  const value = requiredString(record, key);
  if (!SHA256_HEX.test(value)) invalid(path);
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
