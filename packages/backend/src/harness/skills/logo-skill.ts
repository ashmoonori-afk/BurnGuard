/**
 * Project-type skill injected by `prompt-builder.ts` for logo projects, in both context modes.
 * It carries the professional method (types, value assessment, construction, tests) distilled from
 * the logo master guide; the phase contract, file map and hard gates live in
 * `prompt-logo-set.ts` and the look rules in `LOGO_VISUAL_CRAFT`.
 *
 * Keep this under the exported MAX_SKILL_CHARS budget.
 */
export const LOGO_SKILL_MD = `# Logo design method (LOGO_SKILL_MD)

A logo identifies; it does not sell. Every decision serves recall: one idea, readable in a glance,
recognisable at 16 px and on a sign, in one colour and in full colour.

## Logo types
- wordmark: the full name as the mark (short, distinctive names).
- lettermark: initials (long names, fast recall).
- pictorial: a literal, recognisable icon that can carry the brand alone.
- abstract: a geometric, non-literal symbol (unique, enduring).
- mascot: an illustrated character (playful, community brands).
- combination: symbol + name side by side or stacked (broadest flexibility).
- emblem: name inside a seal or badge (heritage, authority).
Map type to goal: fast name recall -> lettermark; one strong idea -> pictorial/abstract;
legacy and trust -> emblem; flexibility -> combination. A distinctive name may need no symbol.

## Value assessment (score each 1-5 before presenting; one zero is disqualifying)
simplicity, memorability, timelessness, versatility, appropriateness, distinctiveness,
structural integrity. Present only candidates that hold on every criterion.

## Construction
- Build on geometry: concentric circles and tangents, a horizontal/vertical/45-degree axis
  cross, an 8- or 12-unit modular grid, golden-ratio (1:1.618) or Fibonacci sizes, or simple
  ratios (1:1, 2:3, 3:5). Pick one system and derive every diameter, stroke and gap from it.
- The sketch comes first; the grid supports it. Correct optically what the grid gets wrong
  (circle/square parity, overshoot, stroke contrast, letter spacing).
- Use negative space deliberately; hide the second reading inside the first.
- Shape meaning: circle unity and continuity; square stability and order; upward triangle
  growth; diagonals motion; curves warmth; organic forms authenticity. Symbols carry meaning
  (shield protection, mountain achievement, leaf growth, arrow progress, star excellence,
  crown leadership, key access, globe reach); check cultural readings before committing.
- Typography: customise letterforms (weight, tracking, kerning, joins); match the face to the
  brand voice, not the subject cliche; one personality per lockup.

## Evidence base
Published research on logo perception (Henderson and Cote, Journal of Marketing 1998;
figurativeness studies, Journal of Business Research 2023) scores a mark on three
further dimensions: naturalness (how far the form depicts something recognisable),
harmony (symmetry, balance, proportion) and elaborateness (complexity, activeness,
depth). High harmony with moderate elaborateness and some naturalness is the most
liked and best remembered profile; figurative marks are recalled better than purely
abstract ones. With logo_type auto, let this break ties between candidate types.

## Tests every mark must pass
grayscale, 16 px small-size, one-colour (embroidery, foil), upside-down silhouette,
squint/blur, light, dark and photo backgrounds, competitor line-up, fresh eyes.

## Common failures to avoid
clip-art and generic niche icons, dated gradients and 3D, chasing a trend, relying on colour
to work, over-detail that dies at small size, copying a competitor, bad kerning.

## Guidelines document
Cover the mark's anatomy and construction, variations, aspect ratio, minimum size, clear
space as a fraction of the mark, approved colour pairings, palette values (HEX, RGB, CMYK),
typography roles, a visual grid of incorrect uses, applications and the file kit (SVG master,
PDF guidelines, PNG variants). One rule per page, shown on the mark itself.
`;
