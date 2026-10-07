import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import {
  LOGO_DIRECTION_IDS,
  LOGO_DIRECTION_PARTS,
  UpgradeContractError,
  parseLogoDirectionsV1,
  type LogoAdoptPick,
  type LogoDirectionId,
  type LogoDirectionPart,
  type LogoDirectionsV1,
  type LogoMoodboardV1,
  type LogoOriginalityReceiptV1,
} from "@bg/shared";
import { PathBoundaryError, resolveWithin } from "../security/path-boundary";

/**
 * Backend-owned pipeline state for the logo deliverable (doc/23-logo-design-deliverable).
 *
 * The ideate stage writes `ideas/directions.json` and three rough sketches; the person then adopts
 * one to three of those directions, and the backend — never the model — records that choice in the
 * canonical `ideas/adoption.json`. The file binds the pick to the exact directions bytes and the
 * exact moodboard revision it was made against, so a later regenerate can tell a live selection
 * from a stale one. Originality receipts authored by the backend live beside their stage output
 * (`ideas/originality.json`, `explorations/round-N/originality.json`) and are immutable once a
 * later turn has seen them.
 *
 * Every read is contained beneath the project root, treats a malformed file as absent state, and
 * never throws for model-authored content: the gate decides, from the returned shape, what to
 * refuse. This module holds no network, no decoder and no publication authority.
 */

export const LOGO_IDEA_DIRECTIONS_FILE = "ideas/directions.json";
export const LOGO_ADOPTION_FILE = "ideas/adoption.json";
export const LOGO_IDEA_RECEIPT_FILE = "ideas/originality.json";
export const LOGO_ADOPTION_SCHEMA_VERSION = 1 as const;
/** A rough idea sketch is a bounded draft, not a finished master vector. */
export const LOGO_IDEA_SKETCH_MAX_BYTES = 256 * 1024;

export function logoRoundReceiptFile(round: number): string {
  return `explorations/round-${round}/originality.json`;
}

export type LogoDirectionsState = {
  readonly directions: LogoDirectionsV1;
  readonly bytes: string;
  readonly sha256: string;
};

export type LogoAdoptionV1 = {
  readonly schema_version: 1;
  readonly directions_sha256: string;
  readonly moodboard_digest: string;
  readonly picks: readonly LogoAdoptPick[];
};

export type LogoAdoptionState = {
  readonly adoption: LogoAdoptionV1;
  readonly bytes: string;
  readonly sha256: string;
};

export type LogoDirectionsRead =
  | { readonly kind: "absent" }
  | { readonly kind: "invalid"; readonly detail: string }
  | { readonly kind: "present"; readonly state: LogoDirectionsState };

export type LogoAdoptionRead =
  | { readonly kind: "absent" }
  | { readonly kind: "invalid"; readonly detail: string }
  | { readonly kind: "present"; readonly state: LogoAdoptionState };

export type LogoAdoptionResolution =
  | { readonly kind: "none" }
  | { readonly kind: "invalid"; readonly detail: string }
  | { readonly kind: "stale"; readonly detail: string }
  | { readonly kind: "valid"; readonly state: LogoAdoptionState };

const SHA256_HEX = /^[0-9a-f]{64}$/;
const REVISION_FILE = /^round-\d{1,2}$/;
const ORIGINALITY_FILE = "originality.json";

function sha256Hex(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function safePath(dir: string, relative: string): string {
  return resolveWithin(dir, ...relative.split("/"));
}

async function readTextFile(target: string): Promise<string | null> {
  const info = await lstat(target).catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (info === null) return null;
  if (!info.isFile() || info.nlink !== 1 || info.size > 256 * 1024) return null;
  return await readFile(target, "utf8");
}

/** A name that escapes the project boundary is reported as absent state, never as a raw throw. */
async function readStateText(dir: string, relative: string): Promise<string | null> {
  try {
    return await readTextFile(safePath(dir, relative));
  } catch (error) {
    if (isBoundary(error)) return null;
    throw error;
  }
}

async function hashStateFile(dir: string, relative: string): Promise<string | null> {
  try {
    return await hashFileIfPresent(safePath(dir, relative));
  } catch (error) {
    if (isBoundary(error)) return null;
    throw error;
  }
}

async function hashFileIfPresent(target: string): Promise<string | null> {
  const info = await lstat(target).catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (info === null || !info.isFile() || info.nlink !== 1 || info.size === 0 || info.size > 256 * 1024) return null;
  return sha256Hex(await readFile(target));
}

function isMissing(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error) || typeof error.code !== "string") return false;
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}

function isBoundary(error: unknown): boolean {
  return error instanceof PathBoundaryError;
}

export async function readLogoDirectionsState(dir: string): Promise<LogoDirectionsRead> {
  const text = await readStateText(dir, LOGO_IDEA_DIRECTIONS_FILE);
  if (text === null) return { kind: "absent" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error instanceof SyntaxError) return { kind: "invalid", detail: "json" };
    throw error;
  }
  try {
    const directions = parseLogoDirectionsV1(parsed);
    return { kind: "present", state: { directions, bytes: text, sha256: sha256Hex(text) } };
  } catch (error) {
    if (error instanceof UpgradeContractError) return { kind: "invalid", detail: error.path };
    throw error;
  }
}

export async function readLogoAdoptionState(dir: string): Promise<LogoAdoptionRead> {
  const text = await readStateText(dir, LOGO_ADOPTION_FILE);
  if (text === null) return { kind: "absent" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error instanceof SyntaxError) return { kind: "invalid", detail: "json" };
    throw error;
  }
  const result = parseLogoAdoptionV1(parsed);
  if (!result.ok) return { kind: "invalid", detail: result.detail };
  return { kind: "present", state: { adoption: result.adoption, bytes: text, sha256: sha256Hex(text) } };
}

/**
 * Strict parser for the backend-authored adoption record. Picks reference the positional direction
 * ids and the four mixable parts; nothing here is trusted from model output, and an unknown
 * key/value is a stable refusal path rather than a permissive record.
 */
export function parseLogoAdoptionV1(input: unknown): { readonly ok: true; readonly adoption: LogoAdoptionV1 } | { readonly ok: false; readonly detail: string } {
  if (!isRecord(input)) return { ok: false, detail: "root" };
  if (!exact(input, ["schema_version", "directions_sha256", "moodboard_digest", "picks"])) return { ok: false, detail: "keys" };
  if (input.schema_version !== LOGO_ADOPTION_SCHEMA_VERSION) return { ok: false, detail: "schema_version" };
  if (typeof input.directions_sha256 !== "string" || !SHA256_HEX.test(input.directions_sha256)) return { ok: false, detail: "directions_sha256" };
  if (typeof input.moodboard_digest !== "string" || !SHA256_HEX.test(input.moodboard_digest)) return { ok: false, detail: "moodboard_digest" };
  if (!Array.isArray(input.picks) || input.picks.length < 1 || input.picks.length > LOGO_DIRECTION_IDS.length) return { ok: false, detail: "picks" };
  const picks: LogoAdoptPick[] = [];
  for (const [index, value] of input.picks.entries()) {
    if (!isRecord(value) || !exact(value, ["direction_id", "take"])) return { ok: false, detail: `picks.${index}` };
    const directionId = LOGO_DIRECTION_IDS.find((candidate) => candidate === value.direction_id);
    if (directionId === undefined || picks.some((pick) => pick.direction_id === directionId)) return { ok: false, detail: `picks.${index}.direction_id` };
    if (!Array.isArray(value.take) || value.take.length < 1 || value.take.length > LOGO_DIRECTION_PARTS.length) return { ok: false, detail: `picks.${index}.take` };
    const take: LogoDirectionPart[] = [];
    for (const part of value.take) {
      const found = LOGO_DIRECTION_PARTS.find((candidate) => candidate === part);
      if (found === undefined || take.includes(found)) return { ok: false, detail: `picks.${index}.take` };
      take.push(found);
    }
    picks.push({ direction_id: directionId, take });
  }
  return {
    ok: true,
    adoption: {
      schema_version: LOGO_ADOPTION_SCHEMA_VERSION,
      directions_sha256: input.directions_sha256,
      moodboard_digest: input.moodboard_digest,
      picks,
    },
  };
}

export function serializeLogoAdoption(adoption: LogoAdoptionV1): string {
  return JSON.stringify({
    schema_version: LOGO_ADOPTION_SCHEMA_VERSION,
    directions_sha256: adoption.directions_sha256,
    moodboard_digest: adoption.moodboard_digest,
    picks: adoption.picks.map((pick) => ({ direction_id: pick.direction_id, take: [...pick.take] })),
  });
}

export async function writeLogoAdoption(dir: string, adoption: LogoAdoptionV1): Promise<void> {
  const target = safePath(dir, LOGO_ADOPTION_FILE);
  await mkdir(resolveWithin(dir, "ideas"), { recursive: true });
  await writeFile(target, serializeLogoAdoption(adoption), "utf8");
}

export async function removeLogoAdoption(dir: string): Promise<void> {
  await rm(safePath(dir, LOGO_ADOPTION_FILE), { force: true });
}

export async function writeLogoOriginalityReceipt(dir: string, relative: string, receipt: LogoOriginalityReceiptV1): Promise<void> {
  const target = safePath(dir, relative);
  await mkdir(safePath(dir, relative.split("/").slice(0, -1).join("/")), { recursive: true });
  await writeFile(target, JSON.stringify(receipt), "utf8");
}

export async function scanLogoReceiptHashes(dir: string): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  const ideaReceipt = await hashStateFile(dir, LOGO_IDEA_RECEIPT_FILE);
  if (ideaReceipt !== null) hashes.set(LOGO_IDEA_RECEIPT_FILE, ideaReceipt);
  const rounds = await readdir(resolveWithin(dir, "explorations"), { withFileTypes: true }).catch((error: unknown) => {
    if (isMissing(error) || isBoundary(error)) return null;
    throw error;
  });
  for (const round of rounds ?? []) {
    if (!round.isDirectory() || !REVISION_FILE.test(round.name)) continue;
    const relative = `explorations/${round.name}/${ORIGINALITY_FILE}`;
    const sha256 = await hashStateFile(dir, relative);
    if (sha256 !== null) hashes.set(relative, sha256);
  }
  return hashes;
}

/**
 * Whether a saved adoption still applies to the directions and board in hand. Stale is the honest
 * report when the directions bytes moved or the board revision changed: the pick described a
 * different comparison, so the gate refuses rather than reusing it silently.
 */
export function resolveLogoAdoption(
  read: LogoAdoptionRead,
  board: LogoMoodboardV1,
  directions: LogoDirectionsState | null,
): LogoAdoptionResolution {
  if (read.kind === "absent") return { kind: "none" };
  if (read.kind === "invalid") return { kind: "invalid", detail: read.detail };
  if (directions === null) return { kind: "stale", detail: "no_directions" };
  if (read.state.adoption.directions_sha256 !== directions.sha256) return { kind: "stale", detail: "directions_sha256" };
  if (read.state.adoption.moodboard_digest !== board.digest) return { kind: "stale", detail: "moodboard_digest" };
  const known = new Set(directions.directions.directions.map((direction) => direction.id as LogoDirectionId));
  if (read.state.adoption.picks.some((pick) => !known.has(pick.direction_id))) return { kind: "invalid", detail: "picks.direction_id" };
  return { kind: "valid", state: read.state };
}

/**
 * Prompt-facing adoption reader for the G-turn: the person's saved picks, or null when there are no
 * directions, no saved adoption, or a saved adoption that no longer matches the current directions
 * bytes or board revision. It never throws for model-authored state.
 */
export async function readLogoAdoptionForPrompt(
  dir: string,
  board: LogoMoodboardV1,
  directions: LogoDirectionsV1 | null,
): Promise<readonly LogoAdoptPick[] | null> {
  if (directions === null) return null;
  const read = await readLogoAdoptionState(dir);
  const directionsRead = await readLogoDirectionsState(dir);
  const resolved = resolveLogoAdoption(read, board, directionsRead.kind === "present" ? directionsRead.state : null);
  return resolved.kind === "valid" ? resolved.state.adoption.picks : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  for (const key of Object.keys(record)) if (!allowed.has(key)) return false;
  for (const key of keys) if (!(key in record)) return false;
  return true;
}
