export type AssetGuideInput = {
  readonly brandName: string;
  readonly primary: string;
  readonly action: string;
  readonly colors: readonly string[];
  readonly fontFamilies: readonly string[];
  readonly radii: readonly string[];
  readonly shadows: readonly string[];
  readonly logoPaths: readonly string[];
};

const HEX = /^#(?:[0-9a-f]{6}|[0-9a-f]{3})$/i;
const GENERIC_FONT = /^(?:-.*|system-ui|ui-[a-z-]+|sans-serif|serif|monospace|cursive|fantasy|math|emoji|inherit|initial|unset|BlinkMacSystemFont|Segoe UI|Helvetica(?: Neue)?|Arial|Roboto|Apple Color Emoji|Segoe UI Emoji)$/i;

function brightness(hex: string): number {
  const full = hex.length === 4 ? `#${[...hex.slice(1)].map(c => c + c).join("")}` : hex;
  return [1, 3, 5].reduce((sum, index) => sum + Number.parseInt(full.slice(index, index + 2), 16), 0) / 3;
}

function medianRadius(radii: readonly string[]): number | null {
  const values = radii.map(value => /^(\d*\.?\d+)px$/.exec(value.trim().split(/\s+/)[0] ?? "")?.[1]).filter((value): value is string => value !== undefined).map(Number).sort((a, b) => a - b);
  return values.length ? values[Math.floor(values.length / 2)]! : null;
}

/**
 * README `## Asset usage` and `## Asset generation prompts` sections derived from the extracted palette,
 * typography, corner radii, elevation and logo inventory. Deterministic: the same analysis always yields
 * the same text, so extraction provenance digests stay stable.
 */
export function buildAssetGuideReadme(input: AssetGuideInput): string {
  const primary = input.primary.toLowerCase();
  const action = input.action.toLowerCase();
  const accents = [...new Set(input.colors.map(color => color.toLowerCase()).filter(color => HEX.test(color) && color !== primary && color !== action))].slice(0, 3);
  const palette = [primary, ...(action !== primary ? [action] : []), ...accents].join(", ");
  const sampled = input.colors.filter(color => HEX.test(color));
  const dark = sampled.length > 0 && sampled.reduce((sum, color) => sum + brightness(color), 0) / sampled.length < 110;
  const ground = dark ? "a deep, low-key dark ground" : "a bright, airy light ground";
  const radius = medianRadius(input.radii);
  const corners = radius === null || radius <= 2 ? "crisp square corners" : radius <= 12 ? "softly rounded corners" : "generously rounded, pill-like shapes";
  const flat = input.shadows.every(shadow => /^none$/i.test(shadow.trim()));
  const depth = flat ? "flat, shadowless surfaces" : "soft, low elevation shadows";
  const lighting = flat ? "even, diffuse studio lighting with minimal cast shadows" : "soft directional key light from the upper left with gentle contact shadows";
  const brandFace = input.fontFamilies.find(family => !GENERIC_FONT.test(family.trim()));
  const type = brandFace ? `${brandFace} letterforms` : "clean geometric sans-serif letterforms";
  const logos = input.logoPaths.length ? input.logoPaths.join(", ") : "no logo file was found during extraction; supply one before publishing";
  const style = `palette ${palette} on ${ground}, ${corners}, ${depth}`;

  return `
## Asset usage

### Logo
Files: ${logos}. Use the supplied files unchanged: never redraw, recolor outside ${primary} or a single-colour ink/white version, stretch, rotate, outline or add effects. Place the primary lockup top-left in navigation and once in the footer. Keep clear space on every side equal to the height of the logo mark, and never render it below 24px tall on screen. On photos or dark grounds use the single-colour white version over a calm area.

### Icons
Use one consistent line icon set on a 24px grid at 16, 20 or 24px with a single stroke weight (1.5-2px) and ${corners}. Colour icons with the current text ink; use ${action} only for interactive or active states. Pair icons with a text label unless the meaning is universal. Do not mix filled and outlined styles or add decorative icons without a function.

### Illustrations
Use illustrations only for explanatory moments (empty states, onboarding, concept diagrams), never as filler. Build them from the brand palette (${palette}) with flat fills, ${corners} and restrained detail. Keep one illustration per section at most and align it to the grid columns.

### Photography
Use real, candid photography of people, product and context. Crop with the subject on a rule-of-thirds line and leave calm negative space for text. Grade toward the brand palette with natural skin tones; never apply heavy filters, duotones in off-brand colours or stock-photo poses. Keep the same aspect ratio within one row of images.

### Backgrounds
Default to ${ground} using the surface tokens. Alternate section backgrounds only between the neutral surface tokens and one tinted brand surface; keep text contrast at WCAG AA or better. Full-bleed imagery belongs to the hero or one feature band, never behind body text.

### Patterns
Use subtle geometric patterns or textures (fine grids, dots, soft noise) derived from the palette at low contrast (under 10% difference from the ground). Use them only for decorative bands, cards or empty areas; never behind dense text or data.

### Motion
Keep motion short and purposeful: 120-320ms with the --ease-standard curve, fading and shifting elements by at most 16px. 3D renders, if used, share the palette and the lighting below and appear once per page at most. Respect prefers-reduced-motion by removing non-essential movement.

## Asset generation prompts

### Logo
Prompt: Minimal vector logo for ${input.brandName}: a simple monogram or wordmark built from ${type}, flat ${primary} on white, geometric construction, ${corners}, centered with generous clear space, crisp edges, SVG-ready flat artwork.
Negative: gradients, 3D bevel, drop shadow, glow, photographic texture, mockup scene, extra words, tagline, watermark, clip-art

### Icons
Prompt: Consistent set of minimal line icons on a 24x24 grid, 2px uniform stroke, ${corners}, monochrome dark ink on a transparent background with one accent in ${action}, generous internal padding, pixel-aligned, same visual weight across the set.
Negative: filled glyphs mixed with outlines, gradients, shadows, 3D, skeuomorphic detail, text labels, inconsistent stroke widths

### Illustrations
Prompt: Flat editorial illustration of [subject] for ${input.brandName}, limited palette ${palette}, clean vector shapes with ${corners}, subtle grain, calm composition with clear negative space for a headline, ${ground}, modern and trustworthy mood.
Negative: photorealism, busy backgrounds, off-palette colours, cartoon mascots, text, logos, heavy outlines, clip-art

### Photography
Prompt: Candid, natural photograph of [subject], ${lighting}, colour grade leaning toward ${palette} with natural skin tones, shallow depth of field, rule-of-thirds composition with calm negative space for text, authentic real-world setting, high detail.
Negative: posed stock look, heavy filters, oversaturation, harsh flash, text overlays, watermarks, distorted hands or faces, off-brand colour casts

### Backgrounds
Prompt: Abstract background for ${input.brandName}: ${ground} with a soft gradient mesh from ${palette}, gentle depth, very low contrast, large calm areas suitable for overlaid text, high resolution.
Negative: busy detail, hard edges, high contrast noise, text, logos, recognizable objects, neon colours outside the palette

### Patterns
Prompt: Seamless tileable pattern of fine geometric shapes echoing ${corners}, colours ${palette} at very low contrast on ${ground}, even spacing, subtle and quiet, suitable as a decorative band.
Negative: visible seams, high contrast, busy ornament, text, logos, photographic content

### Motion
Prompt: Clean 3D render of [subject] in the ${input.brandName} style: ${style}, ${lighting}, matte materials with subtle soft reflections, simple studio backdrop, centered composition with room for text, suitable as a short looping hero animation.
Negative: glossy plastic overload, chrome, busy scenes, harsh reflections, off-palette colours, text, logos, lens flares
`;
}
