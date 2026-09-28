import { parseDesignSystemPageCoverage, type DesignSystemPageCoverage } from "@bg/shared";
import { readDesignSystemSourceFile, type LayoutSystem } from "./design-system-layout";

/** The system's pages.json, or null when it has none (every non-website or older system). */
export async function readDesignSystemPageCoverage(system: LayoutSystem): Promise<DesignSystemPageCoverage | null> {
  const text = await readDesignSystemSourceFile(system.dir_path, "pages.json");
  return text ? parseDesignSystemPageCoverage(JSON.parse(text)) : null;
}
