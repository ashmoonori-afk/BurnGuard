import {
  resolveModelCapabilityProfile,
  WEB_ASSET_CREDITS_FILE,
  WEB_ASSET_DIR,
  WEB_ASSET_MCP_SERVER,
  WEB_ASSET_TOOL_NAMES,
  type BackendId,
  type GenerationOptions,
  type ModelCapabilityProfile,
} from "@bg/shared";
import { CSS_LOGO_MAX_COLORS, CSS_LOGO_MAX_SHAPES } from "../services/css-logo-check";
import type { Deliverable } from "./prompt-task-presets";

export type WebAssetToolState = "available" | "unavailable" | "not_applicable";

export interface ModelProfileSelection {
  readonly profile: ModelCapabilityProfile;
  readonly css_logo: boolean;
  readonly web_asset_tools: WebAssetToolState;
}

const tool = (name: string): string => `mcp__${WEB_ASSET_MCP_SERVER}__${name}`;

export const CSS_LOGO_RULES = [
  `LOGO_FORM: build the mark from basic shapes (circle, square, triangle); use at most ${CSS_LOGO_MAX_SHAPES} shapes, and prefer 3.`,
  "LOGO_LINE: use one stroke weight throughout (monoline). Make every corner either rounded or sharp, never a mix.",
  "LOGO_NEGATIVE_SPACE: hide exactly one second meaning, a letter or an object, in the negative space.",
  "LOGO_GRID: place every point on a grid; run edges at 0, 45 or 90 degrees wherever possible.",
  "LOGO_COUNTERS: keep a minimum clearance so small counters never close up; the thinnest stroke and every gap stay at least 1 px when the mark is drawn 16 px tall.",
  `LOGO_COLOR: use at most ${CSS_LOGO_MAX_COLORS} colours from the design-system tokens; the mark must still work in solid black on white and white on black.`,
  "LOGO_SIMPLIFY: the mark must stay recognisable at 16 px. If removing a detail keeps it recognisable, remove it.",
] as const;

const CSS_LOGO_BLOCK = [
  "- CSS_LOGO_AUTHORING: when neither the project nor the design system supplies a logo file, design the logo yourself in HTML/CSS and inline SVG instead of setting the name as plain text. A supplied logo file is still reused unchanged; this replaces only the plain-text wordmark default in the visual craft guidance above.",
  "- Draw the mark as one inline <svg data-bg-css-logo role=\"img\" aria-label=\"<brand name>\" viewBox=\"0 0 N N\"> using only circle, ellipse, rect, polygon, polyline, line or path elements, with fill and stroke taken from design-system CSS variables or currentColor. Set any wordmark beside it as live HTML text in the display font token. Reuse the same mark wherever the logo appears. Never imitate another organisation's mark.",
  "- Follow every construction rule below. BurnGuard measures LOGO_FORM, LOGO_LINE, LOGO_GRID, LOGO_COUNTERS and LOGO_COLOR from the data-bg-css-logo markup after the turn.",
  ...CSS_LOGO_RULES.map((rule) => `  - ${rule}`),
  "- REQUIRED SELF-CHECK before finishing: go through the rule ids above one by one against the authored mark, including the black-and-white and 16 px checks, fix every miss, and name the hidden second meaning in the closing summary.",
];

const WEB_ASSET_BLOCK = [
  `- WEB_ASSET_SOURCING: this model has no image-generation tool, so where the image production rules above call for generated imagery, use real assets from the web instead. ${tool(WEB_ASSET_TOOL_NAMES.search)} takes a short English query and a kind (photo, illustration or icon) and returns openly licensed candidates; ${tool(WEB_ASSET_TOOL_NAMES.import)} takes one candidate id, downloads the file into ${WEB_ASSET_DIR}/ and records its source URL and licence in ${WEB_ASSET_CREDITS_FILE}.`,
  "- Reference only the imported project-local file. Never hotlink a remote URL and never invent one. Choose candidates whose subject, palette, light and treatment fit the design system's imagery rules; a stock photo is illustration, not evidence about the product.",
  "- When an import reports attribution_required true, show its attribution line in a visible credits line, caption or footer. Keep using the bundled Lucide icons for interface icons and source icons only for subjects Lucide lacks.",
  "- When a tool returns an error such as network_unavailable, continue with supplied images, bundled icons or CSS/SVG compositions, and name the placements that still need a real image in the closing summary.",
];

const WEB_ASSET_OFF_BLOCK = [
  "- WEB_ASSET_SOURCING_OFF: web asset search is turned off in settings or unavailable on this route, and this model has no image-generation tool. Do not fetch assets from the network. Use supplied images, the bundled Lucide icons and CSS/SVG compositions, and name the placements that still need a real image in the closing summary.",
];

const GENERATE_BLOCK = [
  "- ASSET_GENERATION: this model family generates imagery with its built-in image tool. Produce the imagery the design needs that way, following the image production rules above; do not search the web for stock assets.",
];

export function selectModelProfile(
  backendId: BackendId,
  generation: GenerationOptions,
  deliverable: Deliverable,
  webAssetTools: boolean,
): ModelProfileSelection {
  const profile = resolveModelCapabilityProfile(backendId, generation);
  return {
    profile,
    // A logo project has its own image-generation contract, which this never overrides.
    css_logo: profile.logo_authoring === "css_svg" && deliverable !== "logo",
    web_asset_tools: profile.asset_strategy !== "web_search" ? "not_applicable" : webAssetTools ? "available" : "unavailable",
  };
}

/**
 * Emits the per-profile design guidance: a machine-readable envelope, then only the blocks the profile enables.
 * Nothing is emitted when no generation was selected.
 */
export function appendModelProfileContext(
  lines: string[],
  backendId: BackendId | undefined,
  generation: GenerationOptions | undefined,
  deliverable: Deliverable,
  webAssetTools: boolean,
): ModelProfileSelection | null {
  if (!backendId || !generation) return null;
  const selection = selectModelProfile(backendId, generation, deliverable, webAssetTools);
  lines.push("## Model capability profile");
  lines.push("<burnguard-model-profile-v1>");
  lines.push(JSON.stringify({
    schema_version: 1,
    profile: selection.profile.id,
    logo_authoring: selection.css_logo ? "css_svg" : "supplied_or_text",
    asset_strategy: selection.profile.asset_strategy,
    web_asset_tools: selection.web_asset_tools,
  }));
  lines.push("</burnguard-model-profile-v1>");
  if (selection.css_logo) lines.push(...CSS_LOGO_BLOCK);
  if (selection.web_asset_tools === "available") lines.push(...WEB_ASSET_BLOCK);
  if (selection.web_asset_tools === "unavailable") lines.push(...WEB_ASSET_OFF_BLOCK);
  if (selection.profile.asset_strategy === "generate") lines.push(...GENERATE_BLOCK);
  lines.push("");
  return selection;
}
