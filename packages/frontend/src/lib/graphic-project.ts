import {
  UpgradeContractError,
  decodeContract,
  parseGraphicCanvasV1,
  parseGraphicSetV1,
  type GraphicCanvasV1,
  type GraphicSetV1,
  type ProjectType,
} from "@bg/shared";

/**
 * The stored set is absent for graphics created before graphic kinds landed;
 * callers fall back to `DEFAULT_GRAPHIC_SET`.
 */
export function parseProjectGraphicSet(
  projectType: ProjectType,
  optionsJson: string | null,
): GraphicSetV1 | null {
  if (projectType !== "graphic") return null;
  try {
    const stored = decodeContract(optionsJson)["graphic_set"];
    return stored === undefined || stored === null ? null : parseGraphicSetV1(stored);
  } catch (error) {
    if (error instanceof UpgradeContractError) return null;
    throw error;
  }
}

export function parseProjectGraphicCanvas(
  projectType: ProjectType,
  optionsJson: string | null,
): GraphicCanvasV1 | null {
  if (projectType !== "graphic") return null;
  try {
    return parseGraphicCanvasV1(decodeContract(optionsJson)["graphic_canvas"]);
  } catch (error) {
    if (error instanceof UpgradeContractError) return null;
    throw error;
  }
}
