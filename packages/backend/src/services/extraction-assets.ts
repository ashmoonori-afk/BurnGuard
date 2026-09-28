import type { SourceEvidence } from "./extraction-evidence";

export type AssetGuideInput = {
  readonly brandName: string;
  readonly primary: string;
  readonly action: string;
  readonly colors: readonly string[];
  readonly fontFamilies: readonly string[];
  readonly radii: readonly string[];
  readonly logoPaths: readonly string[];
  readonly evidence: SourceEvidence;
};

const GENERIC_FONT = /^(?:-.*|system-ui|ui-[a-z-]+|sans-serif|serif|monospace|cursive|fantasy|math|emoji|inherit|initial|unset|BlinkMacSystemFont|Segoe UI|Helvetica(?: Neue)?|Arial|Roboto|Apple Color Emoji|Segoe UI Emoji)$/i;

const channel = (value: string, max: number): number | null => {
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(Math.min(255, Math.max(0, value.trim().endsWith("%") ? number * 2.55 : number * (255 / max))));
};

/** Six-digit lowercase hex for #rgb, #rrggbb(aa), rgb()/rgba() and hsl()/hsla(); null for anything else. */
export function toHexColor(color: string): string | null {
  const value = color.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(value)?.[1];
  if (hex) {
    if (hex.length === 3 || hex.length === 4) return `#${[...hex.slice(0, 3)].map(c => c + c).join("")}`;
    return hex.length === 6 || hex.length === 8 ? `#${hex.slice(0, 6)}` : null;
  }
  const parts = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(value);
  if (!parts) return null;
  const args = parts[2]!.split(/[\s,/]+/).filter(Boolean);
  if (args.length < 3) return null;
  let rgb: (number | null)[];
  if (parts[1]!.startsWith("rgb")) rgb = args.slice(0, 3).map(arg => channel(arg, 255));
  else {
    const hue = /^(-?\d*\.?\d+)(deg|turn|rad|grad)?$/.exec(args[0]!);
    if (!hue) return null;
    const scale = { deg: 1, turn: 360, rad: 180 / Math.PI, grad: 0.9 }[hue[2] as "deg" | "turn" | "rad" | "grad" ?? "deg"];
    const h = (((Number(hue[1]) * scale) % 360) + 360) % 360;
    const s = Number.parseFloat(args[1]!) / 100;
    const l = Number.parseFloat(args[2]!) / 100;
    if (![h, s, l].every(Number.isFinite)) return null;
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    rgb = [0, 8, 4].map(n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))));
  }
  if (rgb.some(part => part === null)) return null;
  return `#${rgb.map(part => part!.toString(16).padStart(2, "0")).join("")}`;
}

const brightness = (hex: string) => [1, 3, 5].reduce((sum, index) => sum + Number.parseInt(hex.slice(index, index + 2), 16), 0) / 3;

function medianRadius(radii: readonly string[]): number | null {
  const values = radii.map(value => /^(\d*\.?\d+)px$/.exec(value.trim().split(/\s+/)[0] ?? "")?.[1]).filter((value): value is string => value !== undefined).map(Number).sort((a, b) => a - b);
  return values.length ? values[Math.floor(values.length / 2)]! : null;
}

const observed = (what: string) => `Evidence: observed in the source - ${what}; every other detail below is a default.`;
const DEFAULT = "Evidence: not found in the source; this rule is a default to confirm or replace.";

/**
 * README `## Asset usage` and `## Asset generation prompts` sections. Every kind states whether its
 * style comes from source evidence or is a default, and the text stays surface-neutral: page regions
 * (navigation, hero, footer) belong to the layout sections, not to asset rules. Deterministic, so
 * extraction provenance digests stay stable.
 */
export function buildAssetGuideReadme(input: AssetGuideInput): string {
  const { evidence } = input;
  const primary = toHexColor(input.primary) ?? input.primary.toLowerCase();
  const action = toHexColor(input.action) ?? input.action.toLowerCase();
  const sampled = [...new Set(input.colors.map(toHexColor).filter((color): color is string => color !== null))];
  const accents = sampled.filter(color => color !== primary && color !== action).slice(0, 3);
  const palette = [primary, ...(action !== primary ? [action] : []), ...accents].join(", ");
  const tone = sampled.length === 0 ? null : sampled.reduce((sum, color) => sum + brightness(color), 0) / sampled.length < 110 ? "dark" : "light";
  const ground = tone === "dark" ? "a deep, low-key dark ground" : tone === "light" ? "a bright, airy light ground" : "the brand's neutral surface";
  const radius = medianRadius(input.radii);
  const corners = radius === null ? "simple geometric corners" : radius <= 2 ? "crisp square corners" : radius <= 12 ? "softly rounded corners" : "generously rounded, pill-like shapes";
  const face = input.fontFamilies.find(family => !GENERIC_FONT.test(family.trim()));
  const type = face ? `${face} letterforms` : "clean geometric sans-serif letterforms";
  const iconStyle = evidence.icons.style === "filled" ? "solid filled glyphs" : `line icons with a ${evidence.icons.strokeWidth ? `${evidence.icons.strokeWidth}px` : "2px"} uniform stroke`;
  const motion = evidence.motionMs ? `${evidence.motionMs[0]}-${evidence.motionMs[1]}ms` : "120-320ms";

  const usage = {
    logo: `${input.logoPaths.length ? observed(`logo files ${input.logoPaths.join(", ")} and the palette`) : "Evidence: no logo file was found in the source; supply one before publishing."} Use the supplied files unchanged: never redraw, recolour outside ${primary} or a single-colour ink/white version, stretch, rotate, outline or add effects. Show the logo once per page or frame, never as repeated decoration. Keep clear space on every side equal to the height of the logo mark and never render it below 24px tall on screen. On photos or dark grounds use the single-colour white version over a calm area.`,
    icons: `${evidence.icons.style ? observed(`${evidence.icons.count} inline SVG icons, mostly ${evidence.icons.style}${evidence.icons.strokeWidth ? ` with a ${evidence.icons.strokeWidth}px stroke` : ""}`) : DEFAULT} Use one consistent icon set of ${iconStyle} on a 24px grid at 16, 20 or 24px with ${corners}. Colour icons with the current text ink; use ${action} only for interactive or active states. Pair icons with a text label unless the meaning is universal. Never mix filled and outlined styles or add icons without a function.`,
    illustrations: `${evidence.illustrations ? observed(`${evidence.illustrations} SVG illustration image(s), presence only`) : DEFAULT} Use illustrations only for explanatory moments (empty states, onboarding, concepts), never as filler. Build them from the palette (${palette}) with flat fills, ${corners} and restrained detail, one illustration per content block at most.`,
    photography: `${evidence.photos ? observed(`${evidence.photos} photographic image(s), presence only`) : DEFAULT} Use real, candid photography of people, product and context. Crop with the subject on a rule-of-thirds line and leave calm negative space for text. Grade toward the palette with natural skin tones; never apply heavy filters, off-brand duotones or stock-photo poses. Keep one aspect ratio within a group of images.`,
    backgrounds: `${evidence.gradients || evidence.backgroundImages ? observed(`${evidence.gradients} gradient and ${evidence.backgroundImages} image background(s)`) : tone ? observed(`a ${tone} sampled palette`) : DEFAULT} Default to ${ground} using the surface tokens${evidence.gradients ? `, with soft gradients built only from ${palette}` : ", kept flat"}. Alternate only between the neutral surface tokens and one tinted brand surface and keep text contrast at WCAG AA or better. Full-bleed imagery is reserved for one focal area and never sits behind body text.`,
    patterns: `${evidence.patterns ? observed(`${evidence.patterns} repeating background pattern(s)`) : DEFAULT} Use subtle geometric patterns or textures (fine grids, dots, soft noise) from the palette at low contrast (under 10% difference from the ground), only on decorative areas and never behind dense text or data.`,
    motion: `${evidence.motionMs || evidence.animations ? observed(`transitions of ${motion}${evidence.animations ? ` and ${evidence.animations} animation declaration(s)` : ""}`) : DEFAULT} Keep motion short and purposeful: ${motion} with the --ease-standard curve, moving elements by at most 16px. 3D renders, if used, share the palette and appear once per page or frame at most. Respect prefers-reduced-motion by removing non-essential movement.`,
  };
  const lighting = "soft, diffuse natural light with gentle shadows";

  return `
## Asset usage

### Logo
${usage.logo}

### Icons
${usage.icons}

### Illustrations
${usage.illustrations}

### Photography
${usage.photography}

### Backgrounds
${usage.backgrounds}

### Patterns
${usage.patterns}

### Motion
${usage.motion}

## Asset generation prompts

### Logo
Prompt: Minimal vector logo for ${input.brandName}: a simple monogram or wordmark built from ${type}, flat ${primary} on white, geometric construction, ${corners}, centered with generous clear space, crisp edges, SVG-ready flat artwork.
Negative: gradients, 3D bevel, drop shadow, glow, photographic texture, mockup scene, extra words, tagline, watermark, clip-art

### Icons
Prompt: Consistent set of minimal ${iconStyle} on a 24x24 grid, ${corners}, monochrome dark ink on a transparent background with one accent in ${action}, generous internal padding, pixel-aligned, same visual weight across the set.
Negative: ${evidence.icons.style === "filled" ? "outlined glyphs mixed with fills" : "filled glyphs mixed with outlines"}, gradients, shadows, 3D, skeuomorphic detail, text labels, inconsistent ${evidence.icons.style === "filled" ? "shapes" : "stroke widths"}

### Illustrations
Prompt: Flat editorial illustration of [subject] for ${input.brandName}, limited palette ${palette}, clean vector shapes with ${corners}, subtle grain, calm composition with clear negative space for a headline, ${ground}.
Negative: photorealism, busy backgrounds, off-palette colours, cartoon mascots, text, logos, heavy outlines, clip-art

### Photography
Prompt: Candid, natural photograph of [subject], ${lighting}, colour grade leaning toward ${palette} with natural skin tones, shallow depth of field, rule-of-thirds composition with calm negative space for text, authentic real-world setting, high detail.
Negative: posed stock look, heavy filters, oversaturation, harsh flash, text overlays, watermarks, distorted hands or faces, off-brand colour casts

### Backgrounds
Prompt: Abstract background for ${input.brandName}: ${ground}${evidence.gradients ? ` with a soft gradient from ${palette}` : ` in flat tones from ${palette}`}, gentle depth, very low contrast, large calm areas for overlaid text, high resolution.
Negative: busy detail, hard edges, high-contrast noise, text, logos, recognizable objects, colours outside the palette

### Patterns
Prompt: Seamless tileable pattern of fine geometric shapes echoing ${corners}, colours ${palette} at very low contrast on ${ground}, even spacing, subtle and quiet.
Negative: visible seams, high contrast, busy ornament, text, logos, photographic content

### Motion
Prompt: Clean 3D render of [subject] in the ${input.brandName} style: palette ${palette}, ${corners}, ${lighting}, matte materials with subtle reflections, simple backdrop, centered composition with room for text, suitable for a short ${motion} loop.
Negative: glossy plastic overload, chrome, busy scenes, harsh reflections, off-palette colours, text, logos, lens flares
`;
}
