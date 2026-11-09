import {
  LOGO_GEOMETRY_ARTBOARD_ID,
  LOGO_GEOMETRY_GRID,
  LOGO_GEOMETRY_MAX_DEPTH,
  LOGO_GEOMETRY_MAX_OVERSHOOT,
  LOGO_GEOMETRY_MAX_POLYGON_POINTS,
  LOGO_GEOMETRY_MAX_PRIMITIVES,
  LOGO_GEOMETRY_MAX_RADII,
  LOGO_GEOMETRY_FILE,
  LOGO_GEOMETRY_SNAP,
  LOGO_WORDMARK_MAX_TEXT,
  LOGO_WORDMARK_RANGES,
  type LogoSetV1,
} from "@bg/shared";
import { LOGO_GEOMETRIC_STEP_TAG, type LogoGeometricCapture } from "../services/logo-geometric-turn";
import { GENERIC_MARKS } from "./prompt-logo-set";

/**
 * Prompt context for one step of the geometric logo method (doc/30). The model writes one
 * geometry record; the server compiles it into the mark, so nothing here asks for SVG, images or
 * pages. The machine block carries the brief, the person's answers and any revision note, all
 * untrusted text, so every `<` is escaped and a value cannot close the block.
 */
export function appendLogoGeometricContext(lines: string[], logoSet: LogoSetV1, capture: LogoGeometricCapture): void {
  const { schema_version: _version, ...brief } = logoSet;
  lines.push(`<${LOGO_GEOMETRIC_STEP_TAG}>`);
  lines.push(JSON.stringify(capture.kind === "make"
    ? { schema_version: 1, step: capture.step, record_file: capture.record_file, grid: LOGO_GEOMETRY_GRID, ...brief, answers: capture.answers, note: capture.note, ...(capture.families === undefined ? {} : { families: capture.families }) }
    : { schema_version: 1, step: null, complete: true }).replace(/</g, "\\u003c"));
  lines.push(`</${LOGO_GEOMETRIC_STEP_TAG}>`);
  lines.push(`<burnguard-logo-rules-v1 method="geometric">`);
  const rules = capture.kind !== "make" ? completeRules()
    : capture.step === "wordmark" ? wordmarkRules(capture.record_file, capture.note !== null)
    : symbolRules(capture.record_file, capture.note !== null);
  for (const rule of rules) lines.push(`- ${rule}`);
  lines.push("</burnguard-logo-rules-v1>");
  lines.push("");
}

function completeRules(): readonly string[] {
  return [
    "The person approved the last step, so the geometric logo is complete. Write, change or delete no file this turn.",
    "Reply with one or two sentences that say what was approved and what the person can do next.",
  ];
}

function wordmarkRules(recordFile: string, revising: boolean): readonly string[] {
  const range = (key: keyof typeof LOGO_WORDMARK_RANGES) => `${LOGO_WORDMARK_RANGES[key][0]} to ${LOGO_WORDMARK_RANGES[key][1]}`;
  return [
    `LOGO_GEOMETRIC_WORDMARK: choose how the brand name is set. Write exactly one file, ${recordFile}, and nothing else: no SVG, no image, no HTML. Do not call the image-generation tool. The server sets the letters from the font, measures them and composes the lockup with the symbol itself.`,
    `The record is one JSON object: {"schema_version":1,"text":..,"font":..,"cap_height":..,"stem":..,"tracking":..}. text is the brand name in plain Latin letters, digits and & . ' - with single spaces, at most ${LOGO_WORDMARK_MAX_TEXT} characters. font is exactly one name from families in the machine block.`,
    `cap_height (${range("cap_height")}), stem (${range("stem")}) and tracking (${range("tracking")}) are in the symbol's units on its ${LOGO_GEOMETRY_GRID}-unit canvas, on the ${LOGO_GEOMETRY_SNAP}-unit grid. If ${LOGO_GEOMETRY_FILE} exists, read it: take stem from the symbol's stem weight and size cap_height so the words hold their own beside the mark.`,
    "The server sets each font at its default weight, so the stem you get is the font's own. Choose a family whose capital I is close to the stem you ask for: a light face for a thin stem, a heavy one for a thick stem. Match the direction in the answers and the brand's character; avoid a family that fights the symbol's geometry.",
    revising
      ? `REVISE: the note in the machine block is the person's request about the wordmark they are looking at. Change ${recordFile} to answer it and keep everything the note does not ask to change.`
      : `If ${recordFile} already exists, it is a candidate the person has not approved; the message is their guidance, so rework it rather than starting from nothing unless they ask for something new.`,
  ];
}

function symbolRules(recordFile: string, revising: boolean): readonly string[] {
  return [
    `LOGO_GEOMETRIC_SYMBOL: construct the symbol as geometry. Write exactly one file, ${recordFile}, and nothing else: no SVG, no image, no HTML, and no other file is created, changed or deleted. Do not call the image-generation tool. The server compiles the record into logo.svg, measures it and shows you renders to review.`,
    `The record is one JSON object: {"schema_version":1,"grid":${LOGO_GEOMETRY_GRID},"radii":[...],"primitives":[...],"tree":{...},"optical":[...]}. The canvas is ${LOGO_GEOMETRY_GRID} x ${LOGO_GEOMETRY_GRID} units with y growing downward; the id "${LOGO_GEOMETRY_ARTBOARD_ID}" refers to the whole canvas.`,
    `radii: up to ${LOGO_GEOMETRY_MAX_RADII} named values, {"id":"bowl","value":10}. Every circle names one of them, so a radius used twice is one decision, and every radius is used.`,
    `primitives: up to ${LOGO_GEOMETRY_MAX_PRIMITIVES}, each with a unique id. {"kind":"circle","id":..,"cx":..,"cy":..,"r":"<radius id>"}; {"kind":"rect","id":..,"x":..,"y":..,"width":..,"height":..}; {"kind":"polygon","id":..,"points":[[x,y],...]} with at most ${LOGO_GEOMETRY_MAX_POLYGON_POINTS} points; {"kind":"line","id":..,"from":[x,y],"to":[x,y]}, a half-plane whose inside is to the right of from -> to as drawn on screen. Coordinates snap to ${LOGO_GEOMETRY_SNAP} units, so place them on that grid yourself.`,
    `tree: the mark as a boolean expression over primitive ids, {"ref":"<id>"} or {"op":"union"|"subtract"|"intersect","args":[...]}, at most ${LOGO_GEOMETRY_MAX_DEPTH} levels deep. subtract removes every later argument from the first. Use line half-planes with intersect to cut a circle into a bowl or a terminal.`,
    `optical: named corrections that the construction sheet shows, {"kind":"overshoot","primitive":"<id>","amount":<= ${LOGO_GEOMETRY_MAX_OVERSHOOT}} for a curve that must overshoot a flat edge, {"kind":"notch","primitive":"<id>"} for an acute join that would clog. Leave it empty when nothing needs correcting.`,
    "Follow the answers in the machine block: parts says which pieces the person wants, and direction (sharp_geometric, bold_abstract, auto or their own words) sets the character. Ground the mark in brand_name, niche, character, symbol_keywords and avoid.",
    `Build one visual thesis a stranger could restate in one sentence, carried by one structural decision: a counter, a cut, a shared stroke, a join or a rule that generates the form. Derive every size from a few radii and one stem weight. Keep every counter and gap at least one stem wide so it stays open at 16 px, leave no sliver, and let shapes either touch exactly or stand at least one unit apart. Never present ${GENERIC_MARKS}.`,
    revising
      ? `REVISE: the note in the machine block is the person's request about the record they are looking at. Change ${recordFile} to answer it and keep everything the note does not ask to change.`
      : `If ${recordFile} already exists, it is a candidate the person has not approved; the message is their guidance, so rework it rather than starting from nothing unless they ask for something new.`,
  ];
}
