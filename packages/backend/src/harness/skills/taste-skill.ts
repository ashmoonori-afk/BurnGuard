/**
 * Cross-cutting visual judgement guidance. Project-type skills still own
 * structure; this skill helps the agent avoid recurring generated-design
 * habits without overruling the brief or a selected design system.
 */
export const MAX_TASTE_CHARS = 3000;

export const TASTE_CORE = `# Taste guidance (TASTE_CORE)

The brief, user instructions, selected direction and design system take
priority over this guidance.

## Design read
Before generating, write one working-note line that names the page kind,
audience, intended mood and reference. Infer three working dials from the
brief: variation, motion and density. Keep the design read and dial settings
out of visible artifact copy.

## Defaults to question
Unless the request calls for them, avoid:
- em dashes or en dashes as separators in visible copy;
- an eyebrow on every section, numbered eyebrows, or more than roughly one
  eyebrow per three sections;
- three matching cards as the automatic feature layout;
- ornamental status dots, scroll instructions, or hero version and beta tags;
- two calls to action that lead to the same outcome, or CTA labels that wrap;
- sample identities such as John Doe, Acme, 홍길동, or similar stand-ins;
- empty claims such as "Elevate", "Seamless", "Unleash", "혁신적인",
  "차원이 다른", or "새로운 기준";
- metrics that look exact or neatly rounded without supplied evidence.

## Consistency locks
Use one accent colour role and one coherent corner-radius scale throughout the
artifact. Variation should come from composition and content, not from
inventing a new accent or radius language for each section.
`;

const PROTOTYPE_TASTE = `## Prototype taste (PROTOTYPE_TASTE)

- Do not repeat the same section-layout family back to back. Limit alternating
  image-and-copy rows to two consecutive rows.
- A bento has one cell for each real content item, with no decorative empties.
- Recompose multi-column regions at breakpoints with deliberate
  \`grid-template-areas\`; do not make stacking the only responsive decision.
- Keep hero copy to at most four text elements.
`;

const DECK_TASTE = `## Slide deck taste (DECK_TASTE)

Keep visible copy free of separator dashes, placeholder identities and empty
claims. Hold one accent role and one radius scale across the deck.
`;

const GRAPHIC_TASTE = `## Graphic taste (GRAPHIC_TASTE)

Keep visible copy free of separator dashes, placeholder identities and empty
claims. Hold one accent role and one radius scale across every frame.
`;

export const TASTE_BY_TYPE = {
  prototype: PROTOTYPE_TASTE,
  slide_deck: DECK_TASTE,
  graphic: GRAPHIC_TASTE,
} as const;
