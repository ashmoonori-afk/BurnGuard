import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  LOGO_ORIGINALITY_IMAGE_MAX,
  UpgradeContractError,
  parseLogoOriginalityReceiptV1,
  type LogoMoodboardV1,
  type LogoOriginalityImageV1,
  type LogoOriginalityReceiptV1,
  type MoodboardFileItemV1,
  type MoodboardItemV1,
  type MoodboardLinkItemV1,
} from "@bg/shared";
import { createCanvas, loadImage } from "../src/services/export-native-modules";
import { moodboardDigest } from "../src/services/logo-moodboard";
import {
  LOGO_ORIGINALITY_MAX_DISTANCE,
  hammingDistance,
  isolatedImageFingerprint,
} from "../src/services/image-fingerprint-process";
import { LogoOriginalityError, screenLogoImages } from "../src/services/logo-originality";

function canvas(size: number) {
  const c = createCanvas(size, size);
  const context = c.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  return { c, context };
}

function markAlpha(size: number): Buffer {
  const { c, context } = canvas(size);
  const scale = size / 256;
  context.fillStyle = "#111111";
  context.beginPath();
  context.arc(96 * scale, 96 * scale, 56 * scale, 0, Math.PI * 2);
  context.fill();
  context.fillRect(170 * scale, 150 * scale, 60 * scale, 20 * scale);
  return c.toBuffer("image/png");
}

function markBeta(size: number): Buffer {
  const { c, context } = canvas(size);
  context.fillStyle = "#111111";
  context.fillRect(size / 2, 0, size / 2, size);
  return c.toBuffer("image/png");
}

async function reencodedJpeg(bytes: Buffer, to: number, quality: number): Promise<Buffer> {
  const { c, context } = canvas(to);
  context.drawImage(await loadImage(bytes), 0, 0, to, to);
  return c.toBuffer("image/jpeg", quality);
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fileItem(bytes: Buffer, name: string): Promise<MoodboardFileItemV1> {
  const id = sha256(bytes);
  return {
    kind: "file",
    id,
    sha256: id,
    mime_type: "image/png",
    size_bytes: bytes.byteLength,
    original_name: name,
    fingerprint: await isolatedImageFingerprint(bytes),
    added_at: 1_700_000_000_000,
  };
}

function linkItem(url: string): MoodboardLinkItemV1 {
  return { kind: "link", id: sha256(Buffer.from(url)), url, added_at: 1_700_000_000_000 };
}

function board(items: readonly MoodboardItemV1[]): LogoMoodboardV1 {
  const revision = items.length === 0 ? 0 : 1;
  return { schema_version: 1, revision, digest: moodboardDigest(revision, items), items };
}

async function settled<T>(run: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  try {
    return { ok: true, value: await run };
  } catch (error) {
    return { ok: false, error };
  }
}

describe("logo originality screening service", () => {
  test("Given a candidate whose bytes are an exact copy of a reference When screened Then it is rejected as copied with a path-free typed error", async () => {
    const reference = markAlpha(256);
    const content = board([await fileItem(reference, "reference.png")]);
    const result = await settled(screenLogoImages([{ id: "candidate-1", bytes: reference }], content));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.error).toBeInstanceOf(LogoOriginalityError);
    expect(result.error).toMatchObject({ code: "logo_originality_rejected", detail: "copied" });
  });

  test("Given a resized and a re-encoded copy of one reference When screened Then both are rejected as similar and the real dHash distance stays within the calibrated bound", async () => {
    const reference = markAlpha(256);
    const content = board([await fileItem(reference, "reference.png")]);
    const referenceFingerprint = await isolatedImageFingerprint(reference);
    const resized = markAlpha(64);
    const reencoded = await reencodedJpeg(reference, 128, 60);
    expect(hammingDistance(referenceFingerprint, await isolatedImageFingerprint(resized))).toBeLessThanOrEqual(LOGO_ORIGINALITY_MAX_DISTANCE);
    expect(hammingDistance(referenceFingerprint, await isolatedImageFingerprint(reencoded))).toBeLessThanOrEqual(LOGO_ORIGINALITY_MAX_DISTANCE);
    for (const bytes of [resized, reencoded]) {
      await expect(screenLogoImages([{ id: "candidate-1", bytes }], content)).rejects.toMatchObject({ code: "logo_originality_rejected", detail: "similar" });
    }
  });

  test("Given a genuinely distinct candidate When screened Then it passes and the receipt records the closest reference with an honest distance", async () => {
    const reference = markAlpha(256);
    const referenceItem = await fileItem(reference, "reference.png");
    const content = board([referenceItem]);
    const candidate = markBeta(256);
    const receipt = await screenLogoImages([{ id: "candidate-1", bytes: candidate }], content);
    expect(receipt).toMatchObject({
      schema_version: 1,
      moodboard_digest: content.digest,
      reference_count: 1,
      unchecked_link_count: 0,
    });
    expect(receipt.images).toHaveLength(1);
    const [image] = receipt.images;
    expect(image).toMatchObject({ id: "candidate-1", sha256: sha256(candidate), closest_reference_id: referenceItem.sha256 });
    expect(image.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(image.distance).toBeGreaterThan(LOGO_ORIGINALITY_MAX_DISTANCE);
    expect(receipt.checked_at).toBeGreaterThan(0);
    expect(parseLogoOriginalityReceiptV1(JSON.parse(JSON.stringify(receipt)))).toEqual(receipt);
  });

  test("Given an undecodable candidate When screened Then it fails closed as decode_failed and the backend keeps working", async () => {
    const content = board([await fileItem(markAlpha(256), "reference.png")]);
    for (const bytes of [Buffer.from("not an image at all"), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])]) {
      await expect(screenLogoImages([{ id: "candidate-1", bytes }], content)).rejects.toMatchObject({
        code: "logo_originality_rejected",
        detail: "decode_failed",
      });
    }
    await expect(screenLogoImages([{ id: "candidate-1", bytes: markBeta(128) }], content)).resolves.toMatchObject({ reference_count: 1 });
  });

  test("Given a board with no files and no links When screened Then it passes with reference_count 0 and null closest fields", async () => {
    const content = board([]);
    const receipt = await screenLogoImages([{ id: "candidate-1", bytes: markAlpha(128) }], content);
    expect(receipt).toMatchObject({ reference_count: 0, unchecked_link_count: 0, moodboard_digest: content.digest });
    expect(receipt.images[0]).toMatchObject({ closest_reference_id: null, distance: null });
    expect(parseLogoOriginalityReceiptV1(receipt)).toEqual(receipt);
  });

  test("Given a link-only board When screened Then it refuses as references_missing because an opaque link has no pixels to compare", async () => {
    const content = board([linkItem("https://www.pinterest.com/pin/123456789/")]);
    await expect(screenLogoImages([{ id: "candidate-1", bytes: markAlpha(128) }], content)).rejects.toMatchObject({
      code: "logo_originality_rejected",
      detail: "references_missing",
    });
  });

  test("Given a board with both a link and a file When screened Then the link is reported unchecked and the file is still compared", async () => {
    const content = board([await fileItem(markAlpha(256), "reference.png"), linkItem("https://example.com/source")]);
    const receipt = await screenLogoImages([{ id: "candidate-1", bytes: markBeta(256) }], content);
    expect(receipt).toMatchObject({ reference_count: 1, unchecked_link_count: 1 });
  });

  test("Given an already-aborted signal When screening starts Then the caller's abort reason is preserved rather than a similarity rejection", async () => {
    const content = board([await fileItem(markAlpha(256), "reference.png")]);
    const controller = new AbortController();
    controller.abort();
    const result = await settled(screenLogoImages([{ id: "candidate-1", bytes: markAlpha(256) }], content, controller.signal));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.error).not.toBeInstanceOf(LogoOriginalityError);
    expect(result.error instanceof DOMException ? result.error.name : "").toBe("AbortError");
  });
});

describe("logo originality receipt parser", () => {
  function validReceipt(): LogoOriginalityReceiptV1 {
    const image: LogoOriginalityImageV1 = {
      id: "candidate-1",
      sha256: "a".repeat(64),
      fingerprint: "0123456789abcdef",
      closest_reference_id: "b".repeat(64),
      distance: 24,
    };
    return {
      schema_version: 1,
      moodboard_digest: "c".repeat(64),
      reference_count: 1,
      unchecked_link_count: 0,
      images: [image],
      checked_at: 1_700_000_000_000,
    };
  }

  test("Given a canonical receipt When parsed Then it round-trips unchanged", () => {
    const receipt = validReceipt();
    expect(parseLogoOriginalityReceiptV1(JSON.parse(JSON.stringify(receipt)))).toEqual(receipt);
  });

  test("Given an unknown key at any level When parsed Then it is refused", () => {
    expect(() => parseLogoOriginalityReceiptV1({ ...validReceipt(), extra: 1 })).toThrow(UpgradeContractError);
    const image = { ...validReceipt().images[0], extra: 1 };
    expect(() => parseLogoOriginalityReceiptV1({ ...validReceipt(), images: [image] })).toThrow(UpgradeContractError);
  });

  test("Given counts beyond the board limits, an empty or oversized image list, or duplicate ids When parsed Then each is refused", () => {
    expect(() => parseLogoOriginalityReceiptV1({ ...validReceipt(), reference_count: 13 })).toThrow(UpgradeContractError);
    expect(() => parseLogoOriginalityReceiptV1({ ...validReceipt(), unchecked_link_count: 17 })).toThrow(UpgradeContractError);
    expect(() => parseLogoOriginalityReceiptV1({ ...validReceipt(), images: [] })).toThrow(UpgradeContractError);
    const image = validReceipt().images[0];
    const tooMany = [image, { ...image, id: "candidate-2" }, { ...image, id: "candidate-3" }, { ...image, id: "candidate-4" }, { ...image, id: "candidate-5" }];
    expect(tooMany).toHaveLength(LOGO_ORIGINALITY_IMAGE_MAX + 1);
    expect(() => parseLogoOriginalityReceiptV1({ ...validReceipt(), images: tooMany })).toThrow(UpgradeContractError);
    expect(() => parseLogoOriginalityReceiptV1({ ...validReceipt(), images: [image, image] })).toThrow(UpgradeContractError);
    expect(() => parseLogoOriginalityReceiptV1({ ...validReceipt(), images: [{ ...image, id: "x".repeat(81) }] })).toThrow(UpgradeContractError);
  });

  test("Given an image whose closest fields disagree with reference_count When parsed Then the honest-counts invariant is refused", () => {
    const image = validReceipt().images[0];
    expect(() => parseLogoOriginalityReceiptV1({ ...validReceipt(), reference_count: 0 })).toThrow(UpgradeContractError);
    expect(() => parseLogoOriginalityReceiptV1({ ...validReceipt(), images: [{ ...image, closest_reference_id: null, distance: null }] })).toThrow(UpgradeContractError);
    const zeroImage = { ...image, closest_reference_id: null, distance: null };
    expect(() => parseLogoOriginalityReceiptV1({ ...validReceipt(), reference_count: 0, images: [{ ...zeroImage, closest_reference_id: "b".repeat(64) }] })).toThrow(UpgradeContractError);
    expect(parseLogoOriginalityReceiptV1({ ...validReceipt(), reference_count: 0, unchecked_link_count: 0, images: [zeroImage] })).toMatchObject({ reference_count: 0 });
  });

  test("Given a bad distance, fingerprint, digest or schema version When parsed Then each is refused", () => {
    const image = validReceipt().images[0];
    expect(() => parseLogoOriginalityReceiptV1({ ...validReceipt(), images: [{ ...image, distance: 65 }] })).toThrow(UpgradeContractError);
    expect(() => parseLogoOriginalityReceiptV1({ ...validReceipt(), images: [{ ...image, fingerprint: "xyz" }] })).toThrow(UpgradeContractError);
    expect(() => parseLogoOriginalityReceiptV1({ ...validReceipt(), moodboard_digest: "short" })).toThrow(UpgradeContractError);
    expect(() => parseLogoOriginalityReceiptV1({ ...validReceipt(), schema_version: 2 })).toThrow(UpgradeContractError);
    expect(() => parseLogoOriginalityReceiptV1({ ...validReceipt(), checked_at: -1 })).toThrow(UpgradeContractError);
  });
});
