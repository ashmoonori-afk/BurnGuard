import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LogoMoodboardV1, MoodboardItemV1 } from "@bg/shared";
import { moodboardDigest } from "../src/services/logo-moodboard";
import {
  LOGO_ADOPTION_FILE,
  LOGO_IDEA_DIRECTIONS_FILE,
  LOGO_IDEA_RECEIPT_FILE,
  logoRoundReceiptFile,
  parseLogoAdoptionV1,
  readLogoAdoptionForPrompt,
  readLogoAdoptionState,
  readLogoDirectionsState,
  resolveLogoAdoption,
  scanLogoReceiptHashes,
  serializeLogoAdoption,
  writeLogoAdoption,
  type LogoAdoptionRead,
  type LogoDirectionsState,
} from "../src/services/logo-pipeline-state";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function stage(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "burnguard-logo-pipeline-"));
  directories.push(directory);
  return directory;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function directionsJson(): Record<string, unknown> {
  const primitives = ["circle", "square", "triangle"];
  return {
    schema_version: 1,
    brand_name: "Northstar",
    directions: [1, 2, 3].map((position) => ({
      id: `direction-${position}`,
      name: `Direction ${position}`,
      logo_type: "combination",
      color: { hero: "#112233", support: ["#445566"], ground: "#FFFFFF" },
      shape: { primitive: primitives[position - 1], construction: "one geometric unit" },
      mood: ["calm"],
      rationale: "reads cleanly at small sizes",
      sketch: { file: `ideas/sketch-direction-${position}.svg`, kind: "svg" },
    })),
  };
}

function board(items: readonly MoodboardItemV1[] = []): LogoMoodboardV1 {
  const revision = items.length === 0 ? 0 : 1;
  return { schema_version: 1, revision, digest: moodboardDigest(revision, items), items };
}

function otherBoard(): LogoMoodboardV1 {
  const item: MoodboardItemV1 = { kind: "link", id: "a".repeat(64), url: "https://example.com/source", added_at: 1 };
  return board([item]);
}

function adoptionRecord(directionsText: string, moodboard: LogoMoodboardV1): Record<string, unknown> {
  return {
    schema_version: 1,
    directions_sha256: sha256(directionsText),
    moodboard_digest: moodboard.digest,
    picks: [{ direction_id: "direction-1", take: ["name", "color"] }, { direction_id: "direction-3", take: ["mood"] }],
  };
}

async function writeJson(dir: string, relative: string, value: unknown): Promise<string> {
  const target = path.join(dir, ...relative.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  const text = typeof value === "string" ? value : JSON.stringify(value);
  await writeFile(target, text, "utf8");
  return text;
}

describe("logo directions state reader", () => {
  test("Given no directions file When read Then it is absent", async () => {
    expect(await readLogoDirectionsState(await stage())).toEqual({ kind: "absent" });
  });

  test("Given an invalid directions file When read Then the contract path is reported without throwing", async () => {
    const dir = await stage();
    await writeJson(dir, LOGO_IDEA_DIRECTIONS_FILE, "{ not json");
    expect(await readLogoDirectionsState(dir)).toEqual({ kind: "invalid", detail: "json" });
    const broken = directionsJson();
    (broken.directions as unknown[])[1] = (broken.directions as unknown[])[0];
    await writeJson(dir, LOGO_IDEA_DIRECTIONS_FILE, broken);
    expect(await readLogoDirectionsState(dir)).toMatchObject({ kind: "invalid" });
  });

  test("Given a valid directions file When read Then its bytes identity is reported", async () => {
    const dir = await stage();
    const text = await writeJson(dir, LOGO_IDEA_DIRECTIONS_FILE, directionsJson());
    const read = await readLogoDirectionsState(dir);
    expect(read.kind).toBe("present");
    if (read.kind !== "present") throw new Error("expected directions");
    expect(read.state.sha256).toBe(sha256(text));
    expect(read.state.directions.directions).toHaveLength(3);
  });
});

describe("logo adoption record", () => {
  test("Given a valid record When parsed Then it round-trips through canonical bytes", () => {
    const parsed = parseLogoAdoptionV1(adoptionRecord("directions", board()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("expected a valid record");
    expect(serializeLogoAdoption(parsed.adoption)).toBe(JSON.stringify(adoptionRecord("directions", board())));
    expect(parseLogoAdoptionV1(JSON.parse(serializeLogoAdoption(parsed.adoption)))).toEqual(parsed);
  });

  test.each([
    ["an unknown key", (record: Record<string, unknown>) => { record.extra = 1; }, "keys"],
    ["a wrong schema version", (record: Record<string, unknown>) => { record.schema_version = 2; }, "schema_version"],
    ["a short directions digest", (record: Record<string, unknown>) => { record.directions_sha256 = "short"; }, "directions_sha256"],
    ["a short board digest", (record: Record<string, unknown>) => { record.moodboard_digest = "short"; }, "moodboard_digest"],
    ["no picks", (record: Record<string, unknown>) => { record.picks = []; }, "picks"],
    ["an unknown direction id", (record: Record<string, unknown>) => { record.picks = [{ direction_id: "direction-9", take: ["name"] }]; }, "picks.0.direction_id"],
    ["an unknown part", (record: Record<string, unknown>) => { record.picks = [{ direction_id: "direction-1", take: ["type"] }]; }, "picks.0.take"],
  ])("Given %s When parsed Then it is refused", (_label, mutate, detail) => {
    const record = adoptionRecord("directions", board());
    mutate(record);
    expect(parseLogoAdoptionV1(record)).toEqual({ ok: false, detail });
  });

  test("Given no adoption file When read Then it is absent", async () => {
    expect(await readLogoAdoptionState(await stage())).toEqual({ kind: "absent" });
  });

  test("Given a written adoption When read back Then the bytes identity matches", async () => {
    const dir = await stage();
    const adoption = {
      schema_version: 1 as const,
      directions_sha256: "a".repeat(64),
      moodboard_digest: "b".repeat(64),
      picks: [{ direction_id: "direction-2" as const, take: ["shape" as const] }],
    };
    await writeLogoAdoption(dir, adoption);
    const read = await readLogoAdoptionState(dir);
    expect(read.kind).toBe("present");
    if (read.kind !== "present") throw new Error("expected an adoption");
    expect(read.state.adoption).toEqual(adoption);
    expect(read.state.sha256).toBe(sha256(await readFile(path.join(dir, ...LOGO_ADOPTION_FILE.split("/")), "utf8")));
  });
});

describe("logo adoption resolution", () => {
  async function directionsFor(dir: string): Promise<LogoDirectionsState> {
    const read = await readLogoDirectionsState(dir);
    if (read.kind !== "present") throw new Error("expected directions");
    return read.state;
  }

  async function store(dir: string, record: Record<string, unknown>): Promise<LogoAdoptionRead> {
    await writeJson(dir, LOGO_ADOPTION_FILE, record);
    return await readLogoAdoptionState(dir);
  }

  test("Given no record When resolved Then the state is none", async () => {
    const dir = await stage();
    const text = await writeJson(dir, LOGO_IDEA_DIRECTIONS_FILE, directionsJson());
    const state: LogoDirectionsState = { directions: (await directionsFor(dir)).directions, bytes: text, sha256: sha256(text) };
    expect(resolveLogoAdoption({ kind: "absent" }, board(), state)).toEqual({ kind: "none" });
  });

  test("Given a record for other directions or another board When resolved Then it is stale", async () => {
    const dir = await stage();
    const text = await writeJson(dir, LOGO_IDEA_DIRECTIONS_FILE, directionsJson());
    const state = await directionsFor(dir);
    const record = await store(dir, adoptionRecord(text, board()));
    expect(resolveLogoAdoption(record, board(), { ...state, sha256: "c".repeat(64) })).toEqual({ kind: "stale", detail: "directions_sha256" });
    expect(resolveLogoAdoption(record, otherBoard(), state)).toEqual({ kind: "stale", detail: "moodboard_digest" });
  });

  test("Given an exact record When resolved Then it is valid", async () => {
    const dir = await stage();
    const text = await writeJson(dir, LOGO_IDEA_DIRECTIONS_FILE, directionsJson());
    const state = await directionsFor(dir);
    const record = await store(dir, adoptionRecord(text, board()));
    expect(resolveLogoAdoption(record, board(), state)).toMatchObject({ kind: "valid" });
  });

  test("Given no directions When resolved Then a record is stale rather than applied", async () => {
    const dir = await stage();
    const record = await store(dir, adoptionRecord("directions", board()));
    expect(resolveLogoAdoption(record, board(), null)).toEqual({ kind: "stale", detail: "no_directions" });
  });
});

describe("logo adoption prompt reader", () => {
  test("Given directions and a matching record When read for the prompt Then the picks are returned", async () => {
    const dir = await stage();
    const text = await writeJson(dir, LOGO_IDEA_DIRECTIONS_FILE, directionsJson());
    await writeJson(dir, LOGO_ADOPTION_FILE, adoptionRecord(text, board()));
    const directions = await readLogoDirectionsState(dir);
    if (directions.kind !== "present") throw new Error("expected directions");
    expect(await readLogoAdoptionForPrompt(dir, board(), directions.state.directions)).toEqual([
      { direction_id: "direction-1", take: ["name", "color"] },
      { direction_id: "direction-3", take: ["mood"] },
    ]);
  });

  test("Given stale, absent, or malformed state When read for the prompt Then null is returned", async () => {
    const dir = await stage();
    const text = await writeJson(dir, LOGO_IDEA_DIRECTIONS_FILE, directionsJson());
    const directions = await readLogoDirectionsState(dir);
    if (directions.kind !== "present") throw new Error("expected directions");
    expect(await readLogoAdoptionForPrompt(dir, board(), directions.state.directions)).toBeNull();
    await writeJson(dir, LOGO_ADOPTION_FILE, "{ nope");
    expect(await readLogoAdoptionForPrompt(dir, board(), directions.state.directions)).toBeNull();
    await writeJson(dir, LOGO_ADOPTION_FILE, adoptionRecord(text, board()));
    expect(await readLogoAdoptionForPrompt(dir, board(), directions.state.directions)).toHaveLength(2);
    expect(await readLogoAdoptionForPrompt(dir, otherBoard(), directions.state.directions)).toBeNull();
    expect(await readLogoAdoptionForPrompt(dir, board(), null)).toBeNull();
  });
});

describe("logo receipt scanning", () => {
  test("Given ideation and round receipts When scanned Then every receipt is hashed by its project-relative path", async () => {
    const dir = await stage();
    await writeJson(dir, LOGO_IDEA_RECEIPT_FILE, { schema_version: 1 });
    await writeJson(dir, logoRoundReceiptFile(1), { schema_version: 1 });
    await writeJson(dir, logoRoundReceiptFile(2), { schema_version: 1 });
    await writeJson(dir, "explorations/round-1/candidate-1.png", "not a receipt");
    const hashes = await scanLogoReceiptHashes(dir);
    expect([...hashes.keys()].sort()).toEqual([
      logoRoundReceiptFile(1),
      logoRoundReceiptFile(2),
      LOGO_IDEA_RECEIPT_FILE,
    ]);
    expect(hashes.get(logoRoundReceiptFile(2))).toMatch(/^[0-9a-f]{64}$/);
    expect(await scanLogoReceiptHashes(await stage())).toEqual(new Map());
  });
});
