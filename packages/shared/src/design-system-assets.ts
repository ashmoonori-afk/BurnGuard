import { isRecord, UpgradeContractError } from "./contract-parser";

/** Asset kinds a design system can describe, in canonical display and prompt order. */
export const ASSET_KINDS = ["logo", "icons", "illustrations", "photography", "backgrounds", "patterns", "motion"] as const;
export type DesignSystemAssetKind = (typeof ASSET_KINDS)[number];

export type DesignSystemAssetRule = {
  readonly kind: DesignSystemAssetKind;
  /** Where and how the asset is used: placement, sizing, cropping, clear space, colour treatment, do/don't. */
  readonly usage: string | null;
  /** Ready-to-use image-generation prompt that reproduces the brand style for this kind. */
  readonly prompt: string | null;
  readonly negative: string | null;
};

export type DesignSystemAssetGuide = {
  readonly schema_version: 1;
  readonly rules: readonly DesignSystemAssetRule[];
};

export const ASSET_USAGE_MAX_CHARS = 1200;
export const ASSET_PROMPT_MAX_CHARS = 1200;
export const ASSET_NEGATIVE_MAX_CHARS = 600;

/** README level-2 headings that carry the guide; exported so prompt assembly can avoid inlining them twice. */
export const ASSET_README_HEADINGS = ["Asset usage", "Asset generation prompts"] as const;

const KIND_ALIASES: Readonly<Record<string, DesignSystemAssetKind>> = {
  logo: "logo", logos: "logo", "logo and wordmark": "logo",
  icon: "icons", icons: "icons", iconography: "icons",
  illustration: "illustrations", illustrations: "illustrations",
  photo: "photography", photos: "photography", photography: "photography",
  background: "backgrounds", backgrounds: "backgrounds",
  pattern: "patterns", patterns: "patterns", textures: "patterns", "patterns and textures": "patterns",
  motion: "motion", "3d": "motion", "3d and motion": "motion", "motion and 3d": "motion",
};

function levelTwoSection(readme: string, heading: string): string | null {
  const lines = readme.replace(/\r\n/g, "\n").replace(/```[\s\S]*?```/g, "").split("\n");
  const start = lines.findIndex(line => new RegExp(`^##\\s+${heading}\\s*$`, "i").test(line));
  if (start === -1) return null;
  const end = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

function levelThreeBlocks(body: string): Map<DesignSystemAssetKind, string> {
  const blocks = new Map<DesignSystemAssetKind, string>();
  let kind: DesignSystemAssetKind | undefined;
  let text: string[] = [];
  const flush = () => { if (kind && !blocks.has(kind) && text.join("\n").trim()) blocks.set(kind, text.join("\n").trim()); };
  for (const line of body.split("\n")) {
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading) { flush(); kind = KIND_ALIASES[heading[1]!.toLowerCase()]; text = []; continue; }
    text.push(line);
  }
  flush();
  return blocks;
}

const bounded = (value: string | undefined, max: number): string | null => {
  const text = value?.trim();
  return text ? text.slice(0, max).trim() : null;
};

export function extractDesignSystemAssetGuide(readme: string): DesignSystemAssetGuide {
  const usage = levelThreeBlocks(levelTwoSection(readme, ASSET_README_HEADINGS[0]) ?? "");
  const prompts = levelThreeBlocks(levelTwoSection(readme, ASSET_README_HEADINGS[1]) ?? "");
  const rules = ASSET_KINDS.flatMap((kind): DesignSystemAssetRule[] => {
    const block = prompts.get(kind) ?? "";
    const negativeAt = block.search(/^Negative:/im);
    const promptPart = (negativeAt === -1 ? block : block.slice(0, negativeAt)).replace(/^Prompt:\s*/i, "");
    const negativePart = negativeAt === -1 ? undefined : block.slice(negativeAt).replace(/^Negative:\s*/i, "");
    const rule = {
      kind,
      usage: bounded(usage.get(kind), ASSET_USAGE_MAX_CHARS),
      prompt: bounded(promptPart, ASSET_PROMPT_MAX_CHARS),
      negative: bounded(negativePart, ASSET_NEGATIVE_MAX_CHARS),
    };
    return rule.usage || rule.prompt || rule.negative ? [rule] : [];
  });
  return { schema_version: 1, rules };
}

/** Strict transport parser: unknown fields, kinds, duplicates, empty rules and oversized text are refused. */
export function parseDesignSystemAssetGuide(input: unknown): DesignSystemAssetGuide {
  const invalid = (): never => { throw new UpgradeContractError("invalid_field", "design_system_assets"); };
  if (!isRecord(input) || Object.keys(input).some(key => key !== "schema_version" && key !== "rules") || input.schema_version !== 1 || !Array.isArray(input.rules) || input.rules.length > ASSET_KINDS.length) return invalid();
  const text = (value: unknown, max: number): string | null => value === null ? null : typeof value === "string" && value.length > 0 && value.length <= max ? value : invalid();
  const rules = input.rules.map((rule): DesignSystemAssetRule => {
    if (!isRecord(rule) || Object.keys(rule).length !== 4 || !ASSET_KINDS.some(kind => kind === rule.kind)) return invalid();
    const parsed = {
      kind: rule.kind as DesignSystemAssetKind,
      usage: text(rule.usage, ASSET_USAGE_MAX_CHARS),
      prompt: text(rule.prompt, ASSET_PROMPT_MAX_CHARS),
      negative: text(rule.negative, ASSET_NEGATIVE_MAX_CHARS),
    };
    return parsed.usage || parsed.prompt || parsed.negative ? parsed : invalid();
  });
  if (new Set(rules.map(rule => rule.kind)).size !== rules.length) return invalid();
  return { schema_version: 1, rules };
}
