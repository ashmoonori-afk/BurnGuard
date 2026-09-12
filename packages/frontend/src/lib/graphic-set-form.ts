/**
 * Choices the creation panel offers for a graphic set: kinds, platform presets
 * grouped by kind, and the seven product-detail brief questions (doc/14 4.2).
 */
import {
  GRAPHIC_CANVAS_LIMITS,
  PLATFORM_PRESETS,
  type GraphicDetailBriefV1,
  type GraphicSetKind,
  type PlatformPreset,
} from "@bg/shared";
import type { MessageKey } from "@/i18n/t";

export type GraphicKindChoice = {
  readonly value: GraphicSetKind;
  readonly label: MessageKey;
};

export const GRAPHIC_KIND_CHOICES: readonly GraphicKindChoice[] = [
  { value: "single", label: "home.graphic.kind.single" },
  { value: "card_news", label: "home.graphic.kind.card_news" },
  { value: "product_detail", label: "home.graphic.kind.product_detail" },
  { value: "banner_set", label: "home.graphic.kind.banner_set" },
  { value: "thumbnail", label: "home.graphic.kind.thumbnail" },
  { value: "print", label: "home.graphic.kind.print" },
];

export const GRAPHIC_FRAME_COUNT_LIMIT = { minimum: 1, maximum: 40 } as const;

export function defaultFrameCount(kind: GraphicSetKind): number {
  return kind === "card_news" ? 6 : 1;
}

export type PresetChoice = {
  readonly preset: PlatformPreset;
  readonly label: MessageKey;
  /** A preset smaller than the canvas minimum is shown but never resized to fit. */
  readonly available: boolean;
};

export function presetChoicesFor(kind: GraphicSetKind): readonly PresetChoice[] {
  return PLATFORM_PRESETS.filter((preset) => preset.kind === kind).map((preset) => ({
    preset,
    label: `home.preset.${preset.id}`,
    available:
      preset.width >= GRAPHIC_CANVAS_LIMITS.minWidth &&
      preset.height >= GRAPHIC_CANVAS_LIMITS.minHeight &&
      preset.width <= GRAPHIC_CANVAS_LIMITS.maxWidth &&
      preset.height <= GRAPHIC_CANVAS_LIMITS.maxHeight,
  }));
}

export type DetailBriefKey = keyof GraphicDetailBriefV1;

export type DetailBriefField = {
  readonly key: DetailBriefKey;
  readonly label: MessageKey;
  readonly hint: MessageKey;
};

export const DETAIL_BRIEF_MAX_LENGTH = 500;

/** One line per customer question Q1 to Q8 of doc/14 section 4.2. */
export const DETAIL_BRIEF_FIELDS: readonly DetailBriefField[] = [
  { key: "persona_pain", label: "home.detail.persona_pain", hint: "home.detail.persona_painHint" },
  { key: "arrival_scene", label: "home.detail.arrival_scene", hint: "home.detail.arrival_sceneHint" },
  { key: "mechanism", label: "home.detail.mechanism", hint: "home.detail.mechanismHint" },
  { key: "evidence", label: "home.detail.evidence", hint: "home.detail.evidenceHint" },
  { key: "journey", label: "home.detail.journey", hint: "home.detail.journeyHint" },
  { key: "risk_reducers", label: "home.detail.risk_reducers", hint: "home.detail.risk_reducersHint" },
  { key: "urgency", label: "home.detail.urgency", hint: "home.detail.urgencyHint" },
];
