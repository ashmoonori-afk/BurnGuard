import {
  DEFAULT_GRAPHIC_SET,
  parseDesignBriefV1,
  parseGraphicCanvasV1,
  parseGraphicSetV1,
  UpgradeContractError,
  type DesignBriefV1,
  type GraphicCanvasV1,
  type GraphicSetV1,
} from "@bg/shared";
import { isRecord } from "@bg/shared/contract-parser";

export type ProjectOptions = {
  readonly use_speaker_notes: boolean;
  readonly copy_as_is: boolean;
  readonly design_brief: DesignBriefV1 | null;
  readonly graphic_canvas: GraphicCanvasV1 | null;
  readonly graphic_set: GraphicSetV1;
};

const DEFAULT_OPTIONS: ProjectOptions = {
  use_speaker_notes: false,
  copy_as_is: false,
  design_brief: null,
  graphic_canvas: null,
  graphic_set: DEFAULT_GRAPHIC_SET,
};

export function parseProjectOptions(input: unknown): ProjectOptions {
  if (input === undefined || input === null) return DEFAULT_OPTIONS;
  if (!isRecord(input)) {
    throw new UpgradeContractError("expected_object", "options");
  }
  return {
    use_speaker_notes: optionalBoolean(input, "use_speaker_notes"),
    copy_as_is: optionalBoolean(input, "copy_as_is"),
    design_brief:
      input["design_brief"] === undefined || input["design_brief"] === null
        ? null
        : parseDesignBriefV1(input["design_brief"]),
    graphic_canvas:
      input["graphic_canvas"] === undefined || input["graphic_canvas"] === null
        ? null
        : parseGraphicCanvasOption(input["graphic_canvas"]),
    graphic_set:
      input["graphic_set"] === undefined
        ? DEFAULT_GRAPHIC_SET
        : parseGraphicSetOption(input["graphic_set"]),
  };
}

export function parseStoredProjectOptions(
  optionsJson: string | null,
): ProjectOptions {
  if (optionsJson === null) return DEFAULT_OPTIONS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(optionsJson);
  } catch (error) {
    if (error instanceof SyntaxError) return DEFAULT_OPTIONS;
    throw error;
  }
  try {
    return parseProjectOptions(parsed);
  } catch (error) {
    if (error instanceof UpgradeContractError && !error.path.startsWith("options.graphic_set")) return DEFAULT_OPTIONS;
    throw error;
  }
}

function parseGraphicSetOption(input: unknown): GraphicSetV1 {
  try {
    return parseGraphicSetV1(input);
  } catch (error) {
    if (error instanceof UpgradeContractError) {
      throw new UpgradeContractError(error.code, `options.graphic_set.${error.path}`);
    }
    throw error;
  }
}

function parseGraphicCanvasOption(input: unknown): GraphicCanvasV1 {
  try {
    return parseGraphicCanvasV1(input);
  } catch (error) {
    if (error instanceof UpgradeContractError) {
      throw new UpgradeContractError(
        error.code,
        `options.graphic_canvas.${error.path}`,
      );
    }
    throw error;
  }
}

function optionalBoolean(
  record: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  const value = record[key];
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new UpgradeContractError("invalid_field", `options.${key}`);
  }
  return value;
}
