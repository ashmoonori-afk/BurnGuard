import { FIGMA_IMPORT_LIMITS } from "@bg/shared/figma-import";
import { FigmaImportError } from "./figma-import-errors";
import type {
  FigmaImportNode,
  FigmaImportPaint,
  FigmaImportTypography,
  FigmaRectangle,
} from "./figma-import-types";

export function parseNodeFields(
  value: Readonly<Record<string, unknown>>,
): Omit<FigmaImportNode, "id" | "name" | "type" | "children"> {
  const fills = value.fills === undefined
    ? []
    : array(value.fills).map(parsePaint);
  return {
    fills,
    style: value.style === undefined ? null : parseStyle(value.style),
    styles: parseStringMap(value.styles, FIGMA_IMPORT_LIMITS.styleReferences),
    boundVariableIds: parseBoundVariables(value.boundVariables),
    ...optionalTextFields(value),
    ...optionalNodeNumbers(value),
    ...(value.absoluteBoundingBox === undefined
      ? {}
      : { absoluteBoundingBox: parseRectangle(value.absoluteBoundingBox) }),
  };
}

function parsePaint(value: unknown): FigmaImportPaint {
  if (!record(value) || !boundedText(value.type)) fail();
  const color = value.color === undefined ? undefined : parseColor(value.color);
  const visible = value.visible;
  if (visible !== undefined && typeof visible !== "boolean") fail();
  return {
    type: value.type,
    ...(color === undefined ? {} : { color }),
    ...(visible === undefined ? {} : { visible }),
  };
}

function parseColor(value: unknown): FigmaImportPaint["color"] {
  if (!record(value)) fail();
  const red = value.r;
  const green = value.g;
  const blue = value.b;
  const alpha = value.a;
  if (!unitNumber(red) || !unitNumber(green) || !unitNumber(blue)) fail();
  if (alpha !== undefined && !unitNumber(alpha)) fail();
  return {
    r: red,
    g: green,
    b: blue,
    ...(alpha === undefined ? {} : { a: alpha }),
  };
}

function parseStyle(value: unknown): FigmaImportTypography {
  if (!record(value)) fail();
  const result: Record<string, string | number> = {};
  for (const key of [
    "fontFamily",
    "textCase",
    "textDecoration",
  ] as const) {
    const item = value[key];
    if (item !== undefined) {
      if (!boundedText(item)) fail();
      result[key] = item;
    }
  }
  for (const key of [
    "fontWeight",
    "fontSize",
    "lineHeightPx",
    "letterSpacing",
  ] as const) {
    const item = value[key];
    if (item !== undefined) {
      if (!finiteNumber(item) || (key !== "letterSpacing" && item < 0)) fail();
      result[key] = item;
    }
  }
  return result;
}

function optionalTextFields(
  value: Readonly<Record<string, unknown>>,
): Partial<Pick<
  FigmaImportNode,
  | "characters"
  | "layoutMode"
  | "primaryAxisAlignItems"
  | "counterAxisAlignItems"
  | "primaryAxisSizingMode"
  | "counterAxisSizingMode"
>> {
  const output: Record<string, string> = {};
  for (const key of [
    "characters",
    "layoutMode",
    "primaryAxisAlignItems",
    "counterAxisAlignItems",
    "primaryAxisSizingMode",
    "counterAxisSizingMode",
  ] as const) {
    const item = value[key];
    if (item !== undefined) {
      if (!boundedText(item, key === "characters")) fail();
      output[key] = item;
    }
  }
  return output;
}

function optionalNodeNumbers(
  value: Readonly<Record<string, unknown>>,
): Partial<Pick<
  FigmaImportNode,
  | "itemSpacing"
  | "counterAxisSpacing"
  | "paddingTop"
  | "paddingRight"
  | "paddingBottom"
  | "paddingLeft"
  | "cornerRadius"
>> {
  const output: Record<string, number> = {};
  for (const key of [
    "itemSpacing",
    "counterAxisSpacing",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "cornerRadius",
  ] as const) {
    const item = value[key];
    if (item !== undefined) {
      const signed = key === "itemSpacing" || key === "counterAxisSpacing";
      if (!finiteNumber(item) || (!signed && item < 0)) fail();
      output[key] = item;
    }
  }
  return output;
}

function parseRectangle(value: unknown): FigmaRectangle {
  if (!record(value)) fail();
  const x = value.x;
  const y = value.y;
  const width = value.width;
  const height = value.height;
  if (
    !finiteNumber(x) ||
    !finiteNumber(y) ||
    !finiteNumber(width) ||
    !finiteNumber(height) ||
    width < 0 ||
    height < 0
  ) fail();
  return { x, y, width, height };
}

function parseStringMap(
  value: unknown,
  maximum: number,
): Readonly<Record<string, string>> {
  if (value === undefined) return {};
  if (!record(value)) fail();
  const entries = Object.entries(value);
  if (entries.length > maximum) fail();
  const output: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (!boundedText(key) || !boundedIdentifier(item)) fail();
    output[key] = item;
  }
  return output;
}

function parseBoundVariables(
  value: unknown,
): Readonly<Record<string, readonly string[]>> {
  if (value === undefined) return {};
  if (!record(value)) fail();
  const entries = Object.entries(value);
  if (entries.length > FIGMA_IMPORT_LIMITS.boundVariables) fail();
  const output: Record<string, readonly string[]> = {};
  for (const [property, binding] of entries) {
    if (!boundedText(property)) fail();
    const aliases = Array.isArray(binding) ? binding : [binding];
    if (aliases.length > FIGMA_IMPORT_LIMITS.boundVariables) fail();
    output[property] = aliases.map((alias) => {
      if (!record(alias) || alias.type !== "VARIABLE_ALIAS") fail();
      if (!boundedIdentifier(alias.id)) fail();
      return alias.id;
    });
  }
  return output;
}

export function boundedIdentifier(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= FIGMA_IMPORT_LIMITS.idChars &&
    !/[\r\n\0]/u.test(value);
}

export function boundedText(
  value: unknown,
  multiline = false,
): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= FIGMA_IMPORT_LIMITS.stringChars &&
    (multiline ? !/\0/u.test(value) : !/[\r\n\0]/u.test(value));
}

export function record(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) fail();
  return value;
}

function unitNumber(value: unknown): value is number {
  return finiteNumber(value) && value >= 0 && value <= 1;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function fail(): never {
  throw new FigmaImportError("invalid_figma_export");
}
