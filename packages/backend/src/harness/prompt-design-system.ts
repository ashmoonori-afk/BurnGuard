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
  lines.push("- Preserve display/body/mono font tokens and Korean fallbacks. Copy local fonts and licenses into artifact fonts/ and link fonts/fonts.css; no font CDNs. Use bundled DM Sans / Space Grotesk with Pretendard fallback and IBM Plex Mono when no brand face is specified. Keep supplied brand font files intact.");
  lines.push("- Fonts (BUNDLED_FONT_REFERENCE): when the design system leaves a role unspecified, Read fonts/fonts.md in the project before picking a bundled family; it records traits, Korean coverage and pairings for every family in fonts/fonts.css.");
  lines.push("");

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
    const content = await readOptional(designSystem.tokens_css_path);
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
