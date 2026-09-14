# HALIDE — design system skill

An invented optics studio. Every circular element carries a refracting glass ring; the ring is the
brand, so the backdrop always has to be worth looking through.

## Non-negotiable

- Circular avatars, lenses and badges use the bundled ring from `liquid-glass/liquid-glass.js`.
  Call `renderLiquidGlassRing(imageData, { cx, cy, rp })` on a canvas. Never substitute a CSS
  `backdrop-filter` blur with a translucent white fill and a 1px border: that has no refraction and
  does not read as glass.
- Put structure behind every ring — the measured grid, the amber horizon, or an image. A ring over a
  flat fill has nothing to bend and looks like a grey donut.
- Keep `refraction` at or below `0.42`. Past that the radial remap folds and straight lines break
  into loops.
- Load type from `fonts/fonts.css`. No font CDN, no remote image, no external script.

## Palette

Ground in `--ink` and `--surface`. `--accent` (amber) is the horizon line and the primary action.
`--accent-cool` (mint) is the meridian and secondary marks. `--plum` appears only inside lens
content. Body copy is `--paper` on dark; never place `--muted` on `--ink` for anything readable.

## Type

`Bebas Neue` for display, set wide and upper case, tracking about `0.04em`. `DM Sans` for body at
17px with generous line height. `IBM Plex Mono` for measurements, coordinates and captions — this is
an optics brand, so numbers are part of the visual language.

## Composition

Asymmetric. Place the primary lens off-centre and let the horizon line cross behind it so the
refraction is visible at a glance. Leave the grid unbroken outside the ring: the contrast between a
bent interior and a straight exterior is the whole effect.
