import { COPY_TONE_PRESETS, IMAGE_STYLE_PRESETS, type GenerationStyle } from "@bg/shared";

export function appendGenerationStyle(lines: string[], preferences: GenerationStyle | undefined): void {
  if (preferences === undefined) return;
  lines.push("<burnguard-generation-style-v1>", JSON.stringify(preferences), "</burnguard-generation-style-v1>");
  lines.push("## Selected image style and copy tone");
  lines.push(`- Image treatment: ${IMAGE_STYLE_PRESETS[preferences.image_style].prompt}`);
  lines.push(`- Copy tone: ${COPY_TONE_PRESETS[preferences.copy_tone].prompt}`);
  lines.push("- Apply this image treatment to every new image prompt, keeping lighting, materials and visual treatment coherent while using distinct relevant imagery for each placement. Keep Codex image generation and the image-uniqueness checks required by the project; this preset does not select a different image provider.");
  lines.push("- Apply the tone to headings, body copy, captions and calls to action consistently in the requested language. Preserve names, facts, numbers, quotations and any wording the user requires verbatim; tone never authorizes inventing claims or changing meaning. Review tone consistency in the completion pass.");
  lines.push("- These saved choices guide future generation and edits, without automatically regenerating existing assets or rewriting approved copy. Follow the user's explicit request for any exception, preserve the selected brand palette/fonts, and do not combine incompatible image styles unless requested.", "");
}
