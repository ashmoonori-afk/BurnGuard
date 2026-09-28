import path from "node:path";
import { extractDesignSystemAssetGuide, type DesignSystemAssetGuide } from "@bg/shared";
import { readDesignSystemSourceFile, type LayoutSystem } from "./design-system-layout";

/** Asset guide of a system; a README without asset sections (every older system) yields an empty guide. */
export async function readDesignSystemAssetGuide(system: LayoutSystem): Promise<DesignSystemAssetGuide> {
  if (!system.readme_md_path) return { schema_version: 1, rules: [] };
  return extractDesignSystemAssetGuide(await readDesignSystemSourceFile(system.dir_path, path.relative(system.dir_path, system.readme_md_path)));
}
