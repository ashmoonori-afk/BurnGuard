import { parseDesignSystemMeasuredLayout, type DesignSystemMeasuredLayout } from "@bg/shared";
import { readDesignSystemSourceFile, type LayoutSystem } from "./design-system-layout";

/** The system's layout-measured.json, or null when it has none (non-website, older, or unmeasured systems). */
export async function readDesignSystemMeasuredLayout(system: LayoutSystem): Promise<DesignSystemMeasuredLayout | null> {
  const text = await readDesignSystemSourceFile(system.dir_path, "layout-measured.json");
  return text ? parseDesignSystemMeasuredLayout(JSON.parse(text)) : null;
}
