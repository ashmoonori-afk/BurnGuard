/**
 * The creation panel is a draft (doc/14 T55): what the user typed survives
 * navigation and reload, and a failed create never clears it. Anything stored
 * by an older build is read field by field, so an unknown or impossible value
 * falls back to the empty form instead of throwing.
 */
import { LOGO_TYPES, type GraphicDetailBriefV1, type GraphicFrameV1, type LogoType, type ProjectType } from "@bg/shared";
import { DETAIL_BRIEF_FIELDS } from "@/lib/graphic-set-form";
import { INITIAL_BRIEF_FORM, type BriefForm } from "@/lib/project-creation";

export function CREATION_DRAFT_KEY(type: ProjectType): string {
  return `bg.new-project.${type}`;
}

function sameShape<T>(value: unknown, fallback: T): T {
  return typeof value === typeof fallback && value !== null ? (value as T) : fallback;
}

function stringList(value: unknown, fallback: readonly string[]): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as readonly string[])
    : fallback;
}

function frames(value: unknown, fallback: readonly GraphicFrameV1[]): readonly GraphicFrameV1[] {
  if (!Array.isArray(value)) return fallback;
  const parsed = value.filter((item): item is GraphicFrameV1 =>
    typeof item === "object" && item !== null &&
    typeof (item as GraphicFrameV1).width === "number" &&
    typeof (item as GraphicFrameV1).height === "number" &&
    typeof (item as GraphicFrameV1).label === "string");
  return parsed.length === value.length ? parsed : fallback;
}

function detailBrief(value: unknown): GraphicDetailBriefV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    DETAIL_BRIEF_FIELDS.flatMap((field) => {
      const answer = record[field.key];
      return typeof answer === "string" ? [[field.key, answer]] : [];
    }),
  );
}

/** A logo type retired by a later build must not travel into the create request. */
function logoType(value: unknown): LogoType {
  return LOGO_TYPES.find((type) => type === value) ?? INITIAL_BRIEF_FORM.logoType;
}

export function serializeCreationDraft(form: BriefForm): string {
  return JSON.stringify(form);
}

/** Storage is a boundary: a blocked or full store costs the draft, never the panel. */
export function readCreationDraft(type: ProjectType): BriefForm {
  try {
    return parseCreationDraft(window.localStorage.getItem(CREATION_DRAFT_KEY(type)));
  } catch {
    return INITIAL_BRIEF_FORM;
  }
}

export function writeCreationDraft(type: ProjectType, form: BriefForm): void {
  try {
    window.localStorage.setItem(CREATION_DRAFT_KEY(type), serializeCreationDraft(form));
  } catch {
    /* the panel keeps working without a saved draft */
  }
}

/** A successful create consumes the draft; the panel unmounts before its own write effect could reset it. */
export function clearCreationDraft(type: ProjectType): void {
  try {
    window.localStorage.removeItem(CREATION_DRAFT_KEY(type));
  } catch {
    /* a stale draft is the cost of blocked storage, never a broken panel */
  }
}

export function parseCreationDraft(raw: string | null): BriefForm {
  if (raw === null) return INITIAL_BRIEF_FORM;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) return INITIAL_BRIEF_FORM;
    throw error;
  }
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return INITIAL_BRIEF_FORM;
  const record = stored as Record<string, unknown>;
  const graphicKind = sameShape(record["graphicKind"], INITIAL_BRIEF_FORM.graphicKind);
  const restoredFrames = frames(record["frames"], INITIAL_BRIEF_FORM.frames);
  // A cleared count field stores NaN as null; the banner frames the user
  // already sized are the count, so the draft builds instead of being refused.
  const frameCount = Number.isSafeInteger(record["frameCount"])
    ? (record["frameCount"] as number)
    : graphicKind === "banner_set" && restoredFrames.length > 0 ? restoredFrames.length : INITIAL_BRIEF_FORM.frameCount;
  return {
    ...INITIAL_BRIEF_FORM,
    name: sameShape(record["name"], INITIAL_BRIEF_FORM.name),
    audience: sameShape(record["audience"], INITIAL_BRIEF_FORM.audience),
    objective: sameShape(record["objective"], INITIAL_BRIEF_FORM.objective),
    contentSource: sameShape(record["contentSource"], INITIAL_BRIEF_FORM.contentSource),
    visualMood: sameShape(record["visualMood"], INITIAL_BRIEF_FORM.visualMood),
    density: sameShape(record["density"], INITIAL_BRIEF_FORM.density),
    outputSize: sameShape(record["outputSize"], INITIAL_BRIEF_FORM.outputSize),
    graphicWidth: sameShape(record["graphicWidth"], INITIAL_BRIEF_FORM.graphicWidth),
    graphicHeight: sameShape(record["graphicHeight"], INITIAL_BRIEF_FORM.graphicHeight),
    useSpeakerNotes: sameShape(record["useSpeakerNotes"], INITIAL_BRIEF_FORM.useSpeakerNotes),
    copyAsIs: sameShape(record["copyAsIs"], INITIAL_BRIEF_FORM.copyAsIs),
    sourcePageMapping: record["sourcePageMapping"] === "restructure" ? "restructure" : "one_to_one",
    sectionCount: sameShape(record["sectionCount"], INITIAL_BRIEF_FORM.sectionCount),
    pages: stringList(record["pages"], INITIAL_BRIEF_FORM.pages),
    graphicKind,
    frameCount,
    frames: restoredFrames,
    presetId: typeof record["presetId"] === "string" ? record["presetId"] : INITIAL_BRIEF_FORM.presetId,
    detailBrief: detailBrief(record["detailBrief"]),
    logoBrandName: sameShape(record["logoBrandName"], INITIAL_BRIEF_FORM.logoBrandName),
    logoNiche: sameShape(record["logoNiche"], INITIAL_BRIEF_FORM.logoNiche),
    logoCharacter: stringList(record["logoCharacter"], INITIAL_BRIEF_FORM.logoCharacter),
    logoType: logoType(record["logoType"]),
    logoSymbolKeywords: stringList(record["logoSymbolKeywords"], INITIAL_BRIEF_FORM.logoSymbolKeywords),
    logoAvoid: sameShape(record["logoAvoid"], INITIAL_BRIEF_FORM.logoAvoid),
  };
}
