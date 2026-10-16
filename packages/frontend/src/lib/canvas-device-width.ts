import { surfaceForProjectType, type ProjectType } from "@bg/shared";

export const CANVAS_DEVICE_PRESETS = ["fit", "desktop", "tablet", "phone"] as const;
export type CanvasDevicePreset = (typeof CANVAS_DEVICE_PRESETS)[number];

const DEVICE_WIDTHS = { fit: undefined, desktop: 1440, tablet: 768, phone: 390 } as const;

/** Fixed artboards never inherit a responsive website viewport. */
export function canvasDeviceWidth(
  projectType: ProjectType,
  preset: CanvasDevicePreset,
): number | undefined {
  return surfaceForProjectType(projectType) === "website" ? DEVICE_WIDTHS[preset] : undefined;
}
