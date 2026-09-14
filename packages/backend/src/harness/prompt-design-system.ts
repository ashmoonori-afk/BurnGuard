import type { buildSessionContext } from "../services/context";
import { readOptional } from "./prompt-file-reader";

type SessionContext = NonNullable<
  Awaited<ReturnType<typeof buildSessionContext>>
>;
type DesignSystem = NonNullable<SessionContext["designSystem"]>;

export const MAX_SKILL_CHARS = 5000;
const MAX_TOKENS_CSS_LINES = 150;
const MAX_README_LINES = 120;

export async function appendDesignSystemContext(
  lines: string[],
  designSystem: DesignSystem,
  contextMode: "compact" | "full",
): Promise<void> {
  lines.push("## Design system");
  lines.push(`- name: ${designSystem.name}`);
  lines.push(`- directory: ${designSystem.dir_path}`);
  if (designSystem.skill_md_path) {
    lines.push(`- skill: ${designSystem.skill_md_path}`);
  }
  if (designSystem.tokens_css_path) {
    lines.push(`- tokens: ${designSystem.tokens_css_path}`);
  }
  if (designSystem.readme_md_path) {
    lines.push(`- readme: ${designSystem.readme_md_path}`);
  }
  lines.push("- Preserve display/body/mono font tokens and Korean fallbacks. Link the existing fonts/fonts.css: it points to the app's shared font store. Do not copy bundled font binaries into projects or replace shared font URLs; export bundles include the required fonts automatically. No font CDNs. Use bundled DM Sans / Space Grotesk with Pretendard fallback and IBM Plex Mono when no brand face is specified. Keep supplied brand font files intact.");
  lines.push("- Fonts (BUNDLED_FONT_REFERENCE): when the design system leaves a role unspecified, Read fonts/fonts.md in the project before picking a bundled family; it records traits, Korean coverage and pairings for every family in fonts/fonts.css.");
  lines.push("- Shared font handling above supersedes older theme instructions to copy bundled fonts/ into each output. Only user-supplied brand fonts belong in a project's font directory.");
  lines.push("- Liquid glass (BUNDLED_LIQUID_GLASS_REFERENCE): for a circular element that should read as physical glass over a visible background, Read liquid-glass/liquid-glass.md before using liquid-glass/liquid-glass.js; it records the options, the radial bands and the refraction limit past which straight lines break. It needs real pixels behind it, so skip it on a flat background where a plain border is honest and cheaper.");
  lines.push("");

  const tokensCss = (designSystem.tokens_css_path ? await readOptional(designSystem.tokens_css_path) : "") ?? "";
  const layoutTokens = Object.fromEntries([...tokensCss.matchAll(/--((?:layout|family)-[a-z0-9-]+)\s*:\s*([^;{}]+);/gi)]
    .slice(0, 64).map(match => [`--${match[1]}`, match[2]!.trim().slice(0, 160)]));
  if (Object.keys(layoutTokens).length) {
    lines.push("<selected_design_system_layout>");
    lines.push(JSON.stringify({ schema_version: 1, tokens: layoutTokens }));
    lines.push("</selected_design_system_layout>");
    lines.push("- REQUIRED: read this system's Layout, Family tokens and Composition rules before editing. Apply its grid, measure, margins, gutter, section rhythm, hero proportions and family structure using the supplied CSS variables. Do not replace the selected layout with a generic arrangement. Adapt only where the output format or viewport requires it; preserve the system's hierarchy and verify the rendered layout before completion. User-requested overrides take precedence.");
    lines.push("");
  }

  if (contextMode === "compact") {
    lines.push("### Compact design-system handling");
    lines.push(
      "- Use the design-system paths above as source of truth. Read SKILL.md, tokens, or README only when exact brand rules or token names are needed for this request.",
    );
    lines.push(
      "- Prefer targeted Grep/Read ranges over loading full design-system files. Reuse existing CSS variables instead of inventing new palettes or type stacks.",
    );
    lines.push("");
    return;
  }

  if (designSystem.skill_md_path) {
    const content = await readOptional(designSystem.skill_md_path);
    if (content) {
      lines.push("### SKILL.md");
      lines.push("```markdown");
      lines.push(content.slice(0, MAX_SKILL_CHARS));
      lines.push("```");
      lines.push("");
    }
  }
  if (designSystem.tokens_css_path) {
    const content = tokensCss;
    if (content) {
      lines.push("### colors_and_type.css (excerpt)");
      lines.push("```css");
      lines.push(
        content.split("\n").slice(0, MAX_TOKENS_CSS_LINES).join("\n"),
      );
      lines.push("```");
      lines.push("");
    }
  }
  if (designSystem.readme_md_path) {
    const content = await readOptional(designSystem.readme_md_path);
    if (content) {
      lines.push("### README.md (excerpt)");
      lines.push("```markdown");
      lines.push(content.split("\n").slice(0, MAX_README_LINES).join("\n"));
      lines.push("```");
      lines.push("");
    }
  }
}
