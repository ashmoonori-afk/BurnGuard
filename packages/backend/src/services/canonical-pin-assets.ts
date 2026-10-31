import { mkdir, writeFile } from "node:fs/promises";
import { canonicalPinStylesheet, parseCanonicalPinContent } from "@bg/shared/canonical-pin";
import { emitArtifactThemeModeCss } from "@bg/shared/theme";
import type { DesignSystemPin } from "./project-design-system-pin";
import { pathStat, readPreservedFile, safeContentChild } from "./system-content-tree";
import { SystemContentError } from "./system-content-format";

/** Immutable per-pin paths never replace CSS already linked by saved artwork. */
export async function provisionCanonicalPinStylesheet(stage: string, pin: DesignSystemPin): Promise<string | null> {
  if (pin.format !== "canonical-v1") return null;
  parseCanonicalPinContent(pin);
  const relative = canonicalPinStylesheet(pin.digest);
  const target = await safeContentChild(stage, ...relative.split("/"));
  if (await pathStat(target) !== null) {
    if ((await readPreservedFile(stage, relative, undefined, 262_144)).toString("utf8") !== pin.tokens) {
      throw new SystemContentError("system_content_conflict");
    }
    return relative;
  }
  await mkdir(await safeContentChild(stage, "design-system"), { recursive: true });
  await writeFile(target, pin.tokens, { flag: "wx" });
  return relative;
}

/** Review gets the explicit pinned mode, not whichever CSS block happens to come first. */
export function selectedPinnedThemeCss(pin: DesignSystemPin): string {
  if (pin.format !== "canonical-v1") return pin.tokens;
  const selected = parseCanonicalPinContent(pin);
  return emitArtifactThemeModeCss(selected.theme, selected.mode);
}
