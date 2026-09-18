import {
  UpgradeContractError,
  decodeContract,
  isRecord,
  requiredArray,
  requiredNumber,
  requiredString,
  stringArray,
  type UnknownRecord,
} from "./contract-parser";

/**
 * Logo-design deliverable contract (doc/23-logo-design-deliverable-2026-09-18.md).
 *
 * A logo project runs in two phases inside ordinary turns. `explore` generates exactly
 * LOGO_CANDIDATE_COUNT raster candidates with the image tool and records them in the manifest;
 * `finalize` vectorises the one candidate the user selected into the master SVG and authors the
 * brand guidelines. The phase is never stored: it is derived from the manifest and the action
 * sentinel carried by the user's message, so a stale project directory cannot lie about it.
 */
export const LOGO_TYPES = [
  "auto",
  "wordmark",
  "lettermark",
  "pictorial",
  "abstract",
  "mascot",
  "combination",
  "emblem",
] as const;
export type LogoType = (typeof LOGO_TYPES)[number];
/** A candidate always has a concrete type; only the brief may say "auto". */
export type LogoCandidateType = Exclude<LogoType, "auto">;

export const LOGO_CANDIDATE_COUNT = 4;
export const LOGO_MAX_ROUNDS = 10;
export const LOGO_PAGE = { width: 1920, height: 1080 } as const;
export const LOGO_FILES = {
  logo: "logo.svg",
  explorations: "explorations",
  manifest: "explorations/manifest.json",
  guidelines: "index.html",
  design_system_patch: "design-system-patch.json",
} as const;
/** Attribute on the root <svg> naming the generated candidate the vector reproduces. */
export const LOGO_SOURCE_ATTRIBUTE = "data-bg-source-exploration";
export const LOGO_ACTION_TAG = "burnguard-logo-action-v1";

export type LogoSetV1 = {
  readonly schema_version: 1;
  readonly brand_name: string;
  readonly niche: string;
  readonly character: readonly string[];
  readonly logo_type: LogoType;
  readonly symbol_keywords?: readonly string[];
  readonly avoid?: string;
};

export type LogoCandidateV1 = {
  readonly id: string;
  readonly file: string;
  readonly logo_type: LogoCandidateType;
  readonly prompt: string;
  readonly rationale: string;
};

export type LogoRoundV1 = {
  readonly round: number;
  readonly candidates: readonly LogoCandidateV1[];
};

export type LogoManifestV1 = {
  readonly schema_version: 1;
  readonly rounds: readonly LogoRoundV1[];
  readonly selected: { readonly round: number; readonly candidate_id: string } | null;
};

export type LogoActionV1 =
  | { readonly action: "regenerate" }
  | { readonly action: "select"; readonly round: number; readonly candidate_id: string };

export type LogoPhase = "explore" | "finalize";

export type LogoDesignSystemPatchV1 = {
  readonly schema_version: 1;
  readonly colors: readonly { readonly name: string; readonly value: string }[];
  readonly readme_section: string;
  readonly logo_asset: typeof LOGO_FILES.logo;
};

const CANDIDATE_ID = /^candidate-[1-4]$/;
const CANDIDATE_FILE = /^explorations\/round-\d{1,2}\/candidate-[1-4]\.png$/;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const TOKEN_NAME = /^[a-z][a-z0-9-]{0,63}$/;

export function parseLogoSetV1(input: unknown): LogoSetV1 {
  const record = decodeContract(input);
  exact(record, ["schema_version", "brand_name", "niche", "character", "logo_type"], ["symbol_keywords", "avoid"]);
  if (requiredNumber(record, "schema_version") !== 1) invalid("schema_version");
  const character = boundedStrings(record, "character", 1, 7, 40);
  const symbolKeywords = record.symbol_keywords === undefined ? undefined : boundedStrings(record, "symbol_keywords", 0, 8, 40);
  const avoid = record.avoid === undefined ? undefined : boundedString(record, "avoid", 300);
  return {
    schema_version: 1,
    brand_name: boundedString(record, "brand_name", 80),
    niche: boundedString(record, "niche", 200),
    character,
    logo_type: logoType(requiredString(record, "logo_type")),
    ...(symbolKeywords === undefined ? {} : { symbol_keywords: symbolKeywords }),
    ...(avoid === undefined ? {} : { avoid }),
  };
}

export function parseLogoManifestV1(input: unknown): LogoManifestV1 {
  const record = decodeContract(input);
  exact(record, ["schema_version", "rounds", "selected"]);
  if (requiredNumber(record, "schema_version") !== 1) invalid("schema_version");
  const rawRounds = requiredArray(record, "rounds");
  if (rawRounds.length < 1 || rawRounds.length > LOGO_MAX_ROUNDS) invalid("rounds");
  const rounds = rawRounds.map((value, index) => parseRound(value, index));
  for (const [index, round] of rounds.entries()) if (round.round !== index + 1) invalid(`rounds.${index}.round`);
  const selected = parseSelected(record.selected, rounds);
  return { schema_version: 1, rounds, selected };
}

function parseRound(value: unknown, index: number): LogoRoundV1 {
  if (!isRecord(value)) invalid(`rounds.${index}`);
  exact(value, ["round", "candidates"]);
  const round = requiredNumber(value, "round");
  if (!Number.isSafeInteger(round) || round < 1) invalid(`rounds.${index}.round`);
  const rawCandidates = requiredArray(value, "candidates");
  if (rawCandidates.length !== LOGO_CANDIDATE_COUNT) invalid(`rounds.${index}.candidates`);
  const candidates = rawCandidates.map((candidate, position) => parseCandidate(candidate, `rounds.${index}.candidates.${position}`, round, position));
  return { round, candidates };
}

function parseCandidate(value: unknown, path: string, round: number, position: number): LogoCandidateV1 {
  if (!isRecord(value)) invalid(path);
  exact(value, ["id", "file", "logo_type", "prompt", "rationale"]);
  const id = requiredString(value, "id");
  if (!CANDIDATE_ID.test(id) || id !== `candidate-${position + 1}`) invalid(`${path}.id`);
  const file = requiredString(value, "file");
  if (!CANDIDATE_FILE.test(file) || file !== `${LOGO_FILES.explorations}/round-${round}/${id}.png`) invalid(`${path}.file`);
  const type = logoType(requiredString(value, "logo_type"));
  if (type === "auto") invalid(`${path}.logo_type`);
  return {
    id,
    file,
    logo_type: type,
    prompt: boundedString(value, "prompt", 2000),
    rationale: boundedString(value, "rationale", 500),
  };
}

function parseSelected(value: unknown, rounds: readonly LogoRoundV1[]): LogoManifestV1["selected"] {
  if (value === null) return null;
  if (!isRecord(value)) invalid("selected");
  exact(value, ["round", "candidate_id"]);
  const round = requiredNumber(value, "round");
  const candidateId = requiredString(value, "candidate_id");
  if (!rounds.some((entry) => entry.round === round && entry.candidates.some((candidate) => candidate.id === candidateId))) invalid("selected");
  return { round, candidate_id: candidateId };
}

/**
 * Finds the action sentinel in a user message. Malformed sentinels are treated as absent rather
 * than thrown: the message is untrusted text and a broken tag must not fail the turn admission.
 */
export function parseLogoAction(text: string): LogoActionV1 | null {
  const match = new RegExp(`<${LOGO_ACTION_TAG}>([\\s\\S]*?)</${LOGO_ACTION_TAG}>`).exec(text);
  if (match === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]!);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.action === "regenerate" && Object.keys(parsed).length === 1) return { action: "regenerate" };
  if (
    parsed.action === "select"
    && Object.keys(parsed).length === 3
    && typeof parsed.round === "number" && Number.isSafeInteger(parsed.round) && parsed.round >= 1
    && typeof parsed.candidate_id === "string" && CANDIDATE_ID.test(parsed.candidate_id)
  ) return { action: "select", round: parsed.round, candidate_id: parsed.candidate_id };
  return null;
}

/** The phase a turn runs in. Only a select action on an existing candidate finalizes. */
export function resolveLogoPhase(manifest: LogoManifestV1 | null, action: LogoActionV1 | null): LogoPhase {
  if (action?.action !== "select" || manifest === null) return "explore";
  const exists = manifest.rounds.some((round) => round.round === action.round && round.candidates.some((candidate) => candidate.id === action.candidate_id));
  return exists ? "finalize" : "explore";
}

export function parseLogoDesignSystemPatchV1(input: unknown): LogoDesignSystemPatchV1 {
  const record = decodeContract(input);
  exact(record, ["schema_version", "colors", "readme_section", "logo_asset"]);
  if (requiredNumber(record, "schema_version") !== 1) invalid("schema_version");
  const rawColors = requiredArray(record, "colors");
  if (rawColors.length > 12) invalid("colors");
  const colors = rawColors.map((value, index) => {
    if (!isRecord(value)) invalid(`colors.${index}`);
    exact(value, ["name", "value"]);
    const name = requiredString(value, "name");
    if (!TOKEN_NAME.test(name)) invalid(`colors.${index}.name`);
    const color = requiredString(value, "value");
    if (!HEX_COLOR.test(color)) invalid(`colors.${index}.value`);
    return { name, value: color.toUpperCase() };
  });
  if (new Set(colors.map((color) => color.name)).size !== colors.length) invalid("colors");
  const readmeSection = boundedString(record, "readme_section", 4000);
  if (!readmeSection.startsWith("## Logo")) invalid("readme_section");
  // One section only: a second top-level heading would be merged into the README verbatim and
  // duplicated on every re-apply.
  const body = readmeSection.includes("\n") ? readmeSection.slice(readmeSection.indexOf("\n") + 1) : "";
  if (/^#{1,2}(?:\s|$)/m.test(body)) invalid("readme_section");
  if (record.logo_asset !== LOGO_FILES.logo) invalid("logo_asset");
  return { schema_version: 1, colors, readme_section: readmeSection, logo_asset: LOGO_FILES.logo };
}

function logoType(value: string): LogoType {
  const found = LOGO_TYPES.find((type) => type === value);
  return found ?? invalid("logo_type");
}

function boundedString(record: UnknownRecord, key: string, maximum: number): string {
  const value = requiredString(record, key).trim();
  if (value.length === 0 || value.length > maximum) invalid(key);
  return value;
}

function boundedStrings(record: UnknownRecord, key: string, minimum: number, maximum: number, itemMax: number): readonly string[] {
  const values = stringArray(record, key).map((value) => value.trim());
  if (values.length < minimum || values.length > maximum || values.some((value) => value.length === 0 || value.length > itemMax)) invalid(key);
  return values;
}

function exact(record: UnknownRecord, keys: readonly string[], optional: readonly string[] = []): void {
  const allowed = new Set([...keys, ...optional]);
  for (const key of Object.keys(record)) if (!allowed.has(key)) invalid(key);
  for (const key of keys) if (!(key in record)) throw new UpgradeContractError("missing_required_field", key);
}

function invalid(path: string): never {
  throw new UpgradeContractError("invalid_field", path);
}
