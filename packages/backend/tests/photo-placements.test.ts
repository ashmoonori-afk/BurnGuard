import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  PHOTO_PLACEMENTS_FILE,
  UpgradeContractError,
  derivePhotoPlacementStatus,
  parsePhotoPlacementsV1,
  type PhotoPlacementV1,
} from "@bg/shared";
import { findReferencePhotoLeaks } from "../src/services/photo-placements";

const HASH = "a".repeat(64);

function placement(overrides: Partial<PhotoPlacementV1> = {}): PhotoPlacementV1 {
  return {
    id: "hero",
    purpose: "Hero photograph of a desk lamp",
    box: { width_px: 1200, height_px: 600 },
    placement_mode: "cover",
    text_safe_region: { x: 0, y: 0, width: 0.5, height: 1 },
    references: [{ url: "https://example.test/lamp", licence: "CC0", local_file: ".meta/references/lamp.png", sha256: HASH }],
    scale_facts: [{ claim: "Lamp is 45 cm tall", status: "verified", source: "https://example.test/spec" }],
    attachment_receipt: "yes",
    candidates: [
      { id: "c1", file: "images/c1.png", rejected_reason: "Shade proportions too wide" },
      { id: "c2", file: "images/c2.png", rejected_reason: null },
    ],
    chosen_candidate: "c2",
    ...overrides,
  };
}

function file(items: readonly unknown[]): unknown {
  return { schema_version: 1, placements: items };
}

describe("derivePhotoPlacementStatus", () => {
  const first = placement().candidates[0];
  if (first === undefined) throw new Error("fixture needs a candidate");
  const rows: readonly [string, PhotoPlacementV1, "reference_verified" | "unverified" | "unsupported", readonly string[]][] = [
    ["Given no reference sources, When derived, Then unverified and names the missing sources", placement({ references: [] }), "unverified", ["reference_sources"]],
    ["Given no attachment receipt, When derived, Then unverified", placement({ attachment_receipt: "no" }), "unverified", ["attachment_receipt"]],
    ["Given a provider that cannot take references, When derived, Then unsupported and never verified", placement({ attachment_receipt: "unsupported" }), "unsupported", ["attachment_receipt"]],
    ["Given a single candidate, When derived, Then unverified", placement({ candidates: [first], chosen_candidate: first.id }), "unverified", ["candidate_comparison"]],
    ["Given sources, a receipt and two candidates, When derived, Then reference_verified", placement(), "reference_verified", []],
  ];
  for (const [name, input, status, missing] of rows) {
    test(name, () => {
      expect(derivePhotoPlacementStatus(input)).toEqual({ status, missing });
    });
  }
});

describe("parsePhotoPlacementsV1", () => {
  test("Given a complete record, When parsed, Then it round-trips", () => {
    const parsed = parsePhotoPlacementsV1(file([placement()]));
    expect(parsed.placements).toEqual([placement()]);
  });

  test("Given a stretch placement mode, When parsed, Then the contract rejects it", () => {
    const stretched = { ...placement(), placement_mode: "stretch" };
    expect(() => parsePhotoPlacementsV1(file([stretched]))).toThrow(UpgradeContractError);
  });

  test("Given a verified scale fact without a source, When parsed, Then the contract rejects it", () => {
    const bad = placement({ scale_facts: [{ claim: "45 cm", status: "verified", source: null }] });
    expect(() => parsePhotoPlacementsV1(file([bad]))).toThrow(UpgradeContractError);
  });

  test("Given a chosen candidate that does not exist, When parsed, Then the contract rejects it", () => {
    expect(() => parsePhotoPlacementsV1(file([placement({ chosen_candidate: "missing" })]))).toThrow(UpgradeContractError);
  });

  test("Given a non-https reference URL, When parsed, Then the contract rejects it", () => {
    const bad = placement({ references: [{ url: "http://example.test/a", licence: "CC0", local_file: ".meta/references/a.png", sha256: HASH }] });
    expect(() => parsePhotoPlacementsV1(file([bad]))).toThrow(UpgradeContractError);
  });
});

describe("findReferencePhotoLeaks", () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

  async function project(files: Readonly<Record<string, Buffer>>, referenceBytes: Buffer): Promise<{ root: string; tree: { path: string; size: number; sha256: string }[] }> {
    const root = await mkdtemp(path.join(tmpdir(), "bg-photo-leak-"));
    roots.push(root);
    const sha256 = createHash("sha256").update(referenceBytes).digest("hex");
    const record = placement({ references: [{ url: "https://example.test/lamp", licence: "CC0", local_file: ".meta/references/lamp.png", sha256 }] });
    await mkdir(path.join(root, ".meta", "references"), { recursive: true });
    await writeFile(path.join(root, ".meta", "references", "lamp.png"), referenceBytes);
    await writeFile(path.join(root, PHOTO_PLACEMENTS_FILE), JSON.stringify(file([record])));
    const tree = [];
    for (const [name, bytes] of Object.entries(files)) tree.push({ path: name, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    return { root, tree };
  }

  test("Given a reference photo copied into the deliverable tree, When checked, Then it is reported as a leak", async () => {
    const reference = Buffer.from("synthetic reference bytes");
    const { root, tree } = await project({ "index.html": Buffer.from("<p>hi</p>"), "images/lamp-copy.png": reference }, reference);
    expect(await findReferencePhotoLeaks(root, tree)).toEqual([{ placement_id: "hero", reference_file: ".meta/references/lamp.png", deliverable_path: "images/lamp-copy.png" }]);
  });

  test("Given only generated images in the deliverable tree, When checked, Then no leak is reported", async () => {
    const { root, tree } = await project({ "index.html": Buffer.from("<p>hi</p>"), "images/c2.png": Buffer.from("generated") }, Buffer.from("synthetic reference bytes"));
    expect(await findReferencePhotoLeaks(root, tree)).toEqual([]);
  });
});
