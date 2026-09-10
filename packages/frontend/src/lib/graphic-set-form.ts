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

export type GraphicKindChoice = {
  readonly value: GraphicSetKind;
  readonly label: string;
};

export const GRAPHIC_KIND_CHOICES: readonly GraphicKindChoice[] = [
  { value: "single", label: "낱장 이미지" },
  { value: "card_news", label: "카드뉴스" },
  { value: "product_detail", label: "상세페이지" },
  { value: "banner_set", label: "배너 세트" },
  { value: "thumbnail", label: "썸네일" },
  { value: "print", label: "인쇄물" },
];

export const GRAPHIC_FRAME_COUNT_LIMIT = { minimum: 1, maximum: 40 } as const;

export function defaultFrameCount(kind: GraphicSetKind): number {
  return kind === "card_news" ? 6 : 1;
}

export type PresetChoice = {
  readonly preset: PlatformPreset;
  /** A preset smaller than the canvas minimum is shown but never resized to fit. */
  readonly available: boolean;
};

export function presetChoicesFor(kind: GraphicSetKind): readonly PresetChoice[] {
  return PLATFORM_PRESETS.filter((preset) => preset.kind === kind).map((preset) => ({
    preset,
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
  readonly label: string;
  readonly hint: string;
};

export const DETAIL_BRIEF_MAX_LENGTH = 500;

/** One line per customer question Q1 to Q8 of doc/14 section 4.2. */
export const DETAIL_BRIEF_FIELDS: readonly DetailBriefField[] = [
  { key: "persona_pain", label: "고객의 고민 장면", hint: "이게 내 얘기인가? 제품 이름 대신 고객이 겪는 구체적인 상황을 적어 주세요." },
  { key: "arrival_scene", label: "도착 장면", hint: "사면 뭘 얻나? 실제로 만들어 줄 수 있는 결과 장면을 적어 주세요." },
  { key: "mechanism", label: "방식과 차별점", hint: "왜 이 방법인가? 기존 방식의 문제와 이 방식이 푸는 원리를 적어 주세요." },
  { key: "evidence", label: "근거", hint: "정말 되나? 숫자, 후기, 실제 화면 등 보여 줄 수 있는 증거를 적어 주세요." },
  { key: "journey", label: "받는 과정", hint: "정확히 뭘 받나? 무엇이 먼저 오고 다음에 무엇이 오는지 순서대로 적어 주세요." },
  { key: "risk_reducers", label: "불안 제거", hint: "실패하면? 환불 규정과 지원 범위를 정확히 적어 주세요." },
  { key: "urgency", label: "지금 사야 할 이유", hint: "왜 지금? 마감, 수량, 가격 변경 같은 구체적인 이유를 적어 주세요." },
];
