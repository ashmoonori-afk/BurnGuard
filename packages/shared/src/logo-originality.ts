import {
  UpgradeContractError,
  decodeContract,
  isRecord,
  requiredArray,
  requiredNumber,
  requiredString,
  type UnknownRecord,
} from "./contract-parser";
import { LOGO_CANDIDATE_COUNT } from "./logo";
import { MOODBOARD_LIMITS } from "./logo-moodboard";

/**
 * Originality screening receipt (doc/23-logo-design-deliverable).
 *
 * One receipt records what a bounded comparison of the generated candidate pixels against the
 * project's moodboard references observed. `reference_count` is how many uploaded image files were
 * actually compared; `unchecked_link_count` is how many bookmarked links the board held and were
 * never opened, so a reader can never mistake opaque links for screened pixels. Each entry in
 * `images` carries the candidate's content hash and 9x8 dHash plus its closest reference and the
 * Hamming distance to it, or `null`/`null` when the board held no image files at all.
 *
 * This is near-copy screening, not a trademark clearance or a worldwide-uniqueness guarantee. The
 * parser is pure: no filesystem, no network, no decoder.
 */

export const LOGO_ORIGINALITY_SCHEMA_VERSION = 1 as const;
/** A receipt screens the generated candidates, so it holds at most one entry per candidate. */
export const LOGO_ORIGINALITY_IMAGE_MAX = LOGO_CANDIDATE_COUNT;
export const LOGO_ORIGINALITY_IMAGE_ID_MAX = 80;
/** A 9x8 dHash carries 8x8 = 64 comparison bits, so a distance never exceeds this. */
export const LOGO_ORIGINALITY_FINGERPRINT_BITS = 64;

export type LogoOriginalityImageV1 = {
  readonly id: string;
  readonly sha256: string;
  readonly fingerprint: string;
  /** SHA-256 of the nearest reference, or `null` when the board held no image files. */
  readonly closest_reference_id: string | null;
  /** Hamming distance to the nearest reference, or `null` when the board held no image files. */
  readonly distance: number | null;
};

export type LogoOriginalityReceiptV1 = {
  readonly schema_version: 1;
  readonly moodboard_digest: string;
  readonly reference_count: number;
  readonly unchecked_link_count: number;
  readonly images: readonly LogoOriginalityImageV1[];
  readonly checked_at: number;
};

const SHA256_HEX = /^[0-9a-f]{64}$/;
const FINGERPRINT_HEX = /^[0-9a-f]{16}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;

export function parseLogoOriginalityReceiptV1(input: unknown): LogoOriginalityReceiptV1 {
  const record = decodeContract(input);
  exact(record, ["schema_version", "moodboard_digest", "reference_count", "unchecked_link_count", "images", "checked_at"]);
  if (requiredNumber(record, "schema_version") !== LOGO_ORIGINALITY_SCHEMA_VERSION) invalid("schema_version");
  const moodboardDigest = sha256Hex(record, "moodboard_digest");
  const referenceCount = requiredNumber(record, "reference_count");
  if (referenceCount > MOODBOARD_LIMITS.max_files) invalid("reference_count");
  const uncheckedLinkCount = requiredNumber(record, "unchecked_link_count");
  if (uncheckedLinkCount > MOODBOARD_LIMITS.max_links) invalid("unchecked_link_count");
  const rawImages = requiredArray(record, "images");
  if (rawImages.length < 1 || rawImages.length > LOGO_ORIGINALITY_IMAGE_MAX) invalid("images");
  const images = rawImages.map(parseImage);
  if (new Set(images.map((image) => image.id)).size !== images.length) invalid("images.id");
  // Honest counts: a board with no image files cannot name a closest reference, and a board with at
  // least one image file cannot omit it. The two fields always move together.
  const checked = referenceCount > 0;
  for (const [index, image] of images.entries()) {
    if ((image.closest_reference_id !== null) !== checked) invalid(`images.${index}.closest_reference_id`);
    if ((image.distance !== null) !== checked) invalid(`images.${index}.distance`);
  }
  return {
    schema_version: LOGO_ORIGINALITY_SCHEMA_VERSION,
    moodboard_digest: moodboardDigest,
    reference_count: referenceCount,
    unchecked_link_count: uncheckedLinkCount,
    images,
    checked_at: requiredNumber(record, "checked_at"),
  };
}

function parseImage(value: unknown, index: number): LogoOriginalityImageV1 {
  const path = `images.${index}`;
  if (!isRecord(value)) invalid(path);
  exact(value, ["id", "sha256", "fingerprint", "closest_reference_id", "distance"]);
  const id = requiredString(value, "id").trim();
  if (id.length === 0 || id.length > LOGO_ORIGINALITY_IMAGE_ID_MAX || CONTROL_CHARACTERS.test(id)) invalid(`${path}.id`);
  const sha256 = requiredString(value, "sha256");
  if (!SHA256_HEX.test(sha256)) invalid(`${path}.sha256`);
  const fingerprint = requiredString(value, "fingerprint");
  if (!FINGERPRINT_HEX.test(fingerprint)) invalid(`${path}.fingerprint`);
  return {
    id,
    sha256,
    fingerprint,
    closest_reference_id: nullableSha256(value, "closest_reference_id", `${path}.closest_reference_id`),
    distance: nullableDistance(value, "distance", `${path}.distance`),
  };
}

function nullableSha256(record: UnknownRecord, key: string, path: string): string | null {
  const value = requiredKey(record, key, path);
  if (value === null) return null;
  if (typeof value !== "string" || !SHA256_HEX.test(value)) invalid(path);
  return value;
}

function nullableDistance(record: UnknownRecord, key: string, path: string): number | null {
  const value = requiredKey(record, key, path);
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > LOGO_ORIGINALITY_FINGERPRINT_BITS) invalid(path);
  return value;
}

function requiredKey(record: UnknownRecord, key: string, path: string): unknown {
  if (!(key in record)) throw new UpgradeContractError("missing_required_field", path);
  return record[key];
}

function sha256Hex(record: UnknownRecord, key: string): string {
  const value = requiredString(record, key);
  if (!SHA256_HEX.test(value)) invalid(key);
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
