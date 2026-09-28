/**
 * Cross-cutting visual judgement guidance. Project-type skills still own
 * structure; this skill helps the agent avoid recurring generated-design
 * habits without overruling the brief or a selected design system.
 *
 * Adapted from StyleGallery by IYEN (docs CC BY 4.0, code MIT),
 * https://github.com/changeroa/StyleGallery, revision e67b440; changes made.
 */
export const MAX_TASTE_CHARS = 3000;

export const TASTE_CORE = `# Taste guidance (TASTE_CORE)

The brief, user instructions, selected direction, design system and existing
catalog context take priority. Reuse those references rather than inventing a
parallel pattern catalog.

## Design read
Before generating, write one private line naming the artifact kind, audience,
task, intended mood, reference and observable that will show the design works.
Infer three working dials from the brief: variation, motion and density. Keep
the design read and dial settings out of visible artifact copy.

## Evidence boundary
Accessibility, semantic order, focus order and task completion outrank visual
preference. Never trade them away for polish. Review the rendered artifact with
real content at its target widths, including an empty state, a long label and
an unbroken string when relevant. Treat screenshots and automated findings as
evidence for review, not proof of beauty or usability.

## Defaults to question
Unless the request calls for them, avoid:
- em dashes or en dashes as separators in visible copy;
- an eyebrow on every section, numbered eyebrows, or more than roughly one
  eyebrow per three sections;
- three matching cards as the automatic feature layout;
- ornamental status dots, scroll instructions, or hero version and beta tags;
- two calls to action that lead to the same outcome, or CTA labels that wrap;
- sample identities such as John Doe, Acme, generic Korean placeholder names,
  or similar stand-ins;
- empty claims such as "Elevate", "Seamless", "Unleash", or generic Korean
  claims about innovation, differentiation, or a new standard;
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
- Keep primary CTA labels on one line; shorten the label before shrinking type.
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
