import {
  UpgradeContractError,
  decodeContract,
  requiredArray,
  requiredNumber,
} from "./contract-parser";

export const GRAPHIC_CANVAS_LIMITS = {
  minWidth: 320,
  maxWidth: 4096,
  minHeight: 240,
  maxHeight: 16_384,
  maxPixels: 16_000_000,
} as const;

export type GraphicCanvasV1 = {
  readonly schema_version: 1;
  readonly width: number;
  readonly height: number;
};

export type GraphicSetKind =
  | "single"
  | "card_news"
  | "product_detail"
  | "banner_set"
  | "thumbnail"
  | "print";

export type GraphicFrameV1 = {
  readonly width: number;
  readonly height: number;
  readonly label: string;
};

export type GraphicDetailBriefV1 = {
  readonly persona_pain?: string;
  readonly arrival_scene?: string;
  readonly mechanism?: string;
  readonly evidence?: string;
  readonly journey?: string;
  readonly risk_reducers?: string;
  readonly urgency?: string;
};

export type GraphicSetV1 = {
  readonly schema_version: 1;
  readonly kind: GraphicSetKind;
  readonly frame_count: number;
  readonly frames?: readonly GraphicFrameV1[];
  readonly preset_id?: string;
  readonly detail_brief?: GraphicDetailBriefV1;
};

export const DEFAULT_GRAPHIC_SET = {
  schema_version: 1,
  kind: "single",
  frame_count: 1,
} as const satisfies GraphicSetV1;

export function parseGraphicCanvasV1(input: unknown): GraphicCanvasV1 {
  const record = decodeContract(input);
  requireKeys(record, ["schema_version", "width", "height"]);
  if (requiredNumber(record, "schema_version") !== 1) invalid("schema_version");
  const width = canvasDimension(record, "width", "width");
  const height = canvasDimension(record, "height", "height");
  if (width * height > GRAPHIC_CANVAS_LIMITS.maxPixels) invalid("width");
  return { schema_version: 1, width, height };
}

export function parseGraphicSetV1(input: unknown): GraphicSetV1 {
  const record = decodeContract(input);
  requireKeys(record, ["schema_version", "kind", "frame_count", "frames", "preset_id", "detail_brief"]);
  if (requiredNumber(record, "schema_version") !== 1) invalid("schema_version");
  const kind = graphicSetKind(record["kind"]);
  const frameCount = requiredNumber(record, "frame_count");
  if (frameCount < 1 || frameCount > 40) invalid("frame_count");

  const presetId = optionalBoundedString(record["preset_id"], "preset_id", 80);
  const frames = parseFrames(record, kind, frameCount);
  const detailBrief = parseDetailBrief(record, kind);
  return {
    schema_version: 1,
    kind,
    frame_count: frameCount,
    ...(frames === undefined ? {} : { frames }),
    ...(presetId === undefined ? {} : { preset_id: presetId }),
    ...(detailBrief === undefined ? {} : { detail_brief: detailBrief }),
  };
}

function graphicSetKind(value: unknown): GraphicSetKind {
  if (value === "single" || value === "card_news" || value === "product_detail" || value === "banner_set" || value === "thumbnail" || value === "print") return value;
  return invalid("kind");
}

function parseFrames(
  record: Readonly<Record<string, unknown>>,
  kind: GraphicSetKind,
  frameCount: number,
): readonly GraphicFrameV1[] | undefined {
  if (kind !== "banner_set") {
    if (record["frames"] !== undefined) invalid("frames");
    return undefined;
  }
  const values = requiredArray(record, "frames");
  if (values.length !== frameCount) invalid("frames");
  return values.map((value, index) => {
    const frame = decodeContract(value);
    requireKeys(frame, ["width", "height", "label"], `frames.${index}.`);
    const width = canvasDimension(frame, "width", `frames.${index}.width`);
    const height = canvasDimension(frame, "height", `frames.${index}.height`);
    if (width * height > GRAPHIC_CANVAS_LIMITS.maxPixels) invalid(`frames.${index}.width`);
    const label = optionalBoundedString(frame["label"], `frames.${index}.label`, 80);
    if (label === undefined) invalid(`frames.${index}.label`);
    return { width, height, label };
  });
}

function parseDetailBrief(
  record: Readonly<Record<string, unknown>>,
  kind: GraphicSetKind,
): GraphicDetailBriefV1 | undefined {
  if (kind !== "product_detail") {
    if (record["detail_brief"] !== undefined) invalid("detail_brief");
    return undefined;
  }
  if (record["detail_brief"] === undefined) return undefined;
  const brief = decodeContract(record["detail_brief"]);
  const keys = ["persona_pain", "arrival_scene", "mechanism", "evidence", "journey", "risk_reducers", "urgency"] as const;
  requireKeys(brief, keys, "detail_brief.");
  return Object.fromEntries(keys.flatMap((key) => {
    const value = optionalBoundedString(brief[key], `detail_brief.${key}`, 500);
    return value === undefined ? [] : [[key, value]];
  }));
}

function canvasDimension(
  record: Readonly<Record<string, unknown>>,
  key: "width" | "height",
  path: string,
): number {
  const value = record[key];
  const minimum = key === "width" ? GRAPHIC_CANVAS_LIMITS.minWidth : GRAPHIC_CANVAS_LIMITS.minHeight;
  const maximum = key === "width" ? GRAPHIC_CANVAS_LIMITS.maxWidth : GRAPHIC_CANVAS_LIMITS.maxHeight;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) invalid(path);
  return value;
}

function optionalBoundedString(value: unknown, path: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maximum) invalid(path);
  return value;
}

function requireKeys(
  record: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  prefix = "",
): void {
  for (const key of Object.keys(record)) if (!allowed.includes(key)) invalid(`${prefix}${key}`);
}

function invalid(path: string): never {
  throw new UpgradeContractError("invalid_field", path);
}
