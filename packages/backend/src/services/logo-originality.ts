import { createHash } from "node:crypto";
import {
  LOGO_ORIGINALITY_IMAGE_ID_MAX,
  LOGO_ORIGINALITY_IMAGE_MAX,
  type LogoMoodboardV1,
  type LogoOriginalityImageV1,
  type LogoOriginalityReceiptV1,
  type MoodboardFileItemV1,
} from "@bg/shared";
import {
  LOGO_ORIGINALITY_MAX_DISTANCE,
  hammingDistance,
  isolatedImageFingerprint,
} from "./image-fingerprint-process";

/**
 * Bounded originality screening of generated candidate pixels against a project's moodboard
 * references (doc/23-logo-design-deliverable). Identical bytes are rejected by SHA-256 and
 * resized/re-encoded near-copies by 9x8 dHash Hamming distance; anything the decoder cannot read
 * fails closed. The check never opens a board link and never reads the filesystem: the board's own
 * SHA-256 and dHash values are the reference, so this service returns a receipt-shaped report and
 * writes nothing. It is near-copy screening, not trademark clearance or worldwide uniqueness.
 */

export type LogoOriginalityErrorDetail =
  | "copied"
  | "similar"
  | "references_missing"
  | "decode_failed"
  | "invalid_images";

export class LogoOriginalityError extends Error {
  readonly name = "LogoOriginalityError";
  readonly code = "logo_originality_rejected" as const;
  /** Stable, path-free token naming the rule that refused the candidate. */
  readonly detail: LogoOriginalityErrorDetail;

  constructor(detail: LogoOriginalityErrorDetail) {
    super(detail);
    this.detail = detail;
  }
}

export type LogoOriginalityCandidate = {
  readonly id: string;
  readonly bytes: Buffer;
};

const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * Screens each candidate against every uploaded board image. Rejects the first candidate that is an
 * exact byte copy (`copied`) or within `LOGO_ORIGINALITY_MAX_DISTANCE` of a reference (`similar`);
 * refuses a link-only board because an opaque link has no pixels to compare
 * (`references_missing`); maps any decoder failure to `decode_failed`. An empty board with no links
 * screens nothing and reports `reference_count: 0` honestly. The caller's abort reason is preserved.
 */
export async function screenLogoImages(
  images: readonly LogoOriginalityCandidate[],
  board: LogoMoodboardV1,
  signal?: AbortSignal,
): Promise<LogoOriginalityReceiptV1> {
  signal?.throwIfAborted();
  assertCandidateImages(images);
  const references = board.items.filter((item): item is MoodboardFileItemV1 => item.kind === "file");
  const uncheckedLinkCount = board.items.length - references.length;
  if (references.length === 0 && uncheckedLinkCount > 0) throw new LogoOriginalityError("references_missing");
  const screened: LogoOriginalityImageV1[] = [];
  for (const image of images) {
    signal?.throwIfAborted();
    const sha256 = createHash("sha256").update(image.bytes).digest("hex");
    for (const reference of references) if (sha256 === reference.sha256) throw new LogoOriginalityError("copied");
    const fingerprint = await fingerprintCandidate(image.bytes, signal);
    let closestReferenceId: string | null = null;
    let distance: number | null = null;
    for (const reference of references) {
      const candidateDistance = hammingDistance(fingerprint, reference.fingerprint);
      if (distance === null || candidateDistance < distance) {
        distance = candidateDistance;
        closestReferenceId = reference.sha256;
      }
    }
    if (distance !== null && distance <= LOGO_ORIGINALITY_MAX_DISTANCE) throw new LogoOriginalityError("similar");
    screened.push({ id: image.id, sha256, fingerprint, closest_reference_id: closestReferenceId, distance });
  }
  return {
    schema_version: 1,
    moodboard_digest: board.digest,
    reference_count: references.length,
    unchecked_link_count: uncheckedLinkCount,
    images: screened,
    checked_at: Date.now(),
  };
}

async function fingerprintCandidate(bytes: Buffer, signal?: AbortSignal): Promise<string> {
  try {
    return await isolatedImageFingerprint(bytes, signal);
  } catch {
    signal?.throwIfAborted();
    throw new LogoOriginalityError("decode_failed");
  }
}

function assertCandidateImages(images: readonly LogoOriginalityCandidate[]): void {
  if (!Array.isArray(images) || images.length < 1 || images.length > LOGO_ORIGINALITY_IMAGE_MAX) throw new LogoOriginalityError("invalid_images");
  const ids = new Set<string>();
  for (const image of images) {
    if (typeof image.id !== "string" || !Buffer.isBuffer(image.bytes)) throw new LogoOriginalityError("invalid_images");
    const id = image.id.trim();
    if (id.length === 0 || id.length > LOGO_ORIGINALITY_IMAGE_ID_MAX || CONTROL_CHARACTERS.test(id) || ids.has(id)) throw new LogoOriginalityError("invalid_images");
    ids.add(id);
  }
}
