/**
 * The creation panel is a draft (doc/14 T55): what the user typed survives
 * navigation and reload, and a failed create never clears it. Anything stored
 * by an older build is read field by field, so an unknown or impossible value
 * falls back to the empty form instead of throwing.
 */
import type { GraphicDetailBriefV1, GraphicFrameV1, ProjectType } from "@bg/shared";
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
    sectionCount: sameShape(record["sectionCount"], INITIAL_BRIEF_FORM.sectionCount),
    pages: stringList(record["pages"], INITIAL_BRIEF_FORM.pages),
    graphicKind: sameShape(record["graphicKind"], INITIAL_BRIEF_FORM.graphicKind),
    frameCount: sameShape(record["frameCount"], INITIAL_BRIEF_FORM.frameCount),
    frames: frames(record["frames"], INITIAL_BRIEF_FORM.frames),
    presetId: typeof record["presetId"] === "string" ? record["presetId"] : INITIAL_BRIEF_FORM.presetId,
    detailBrief: detailBrief(record["detailBrief"]),
  };
}
