<!-- BUNDLED_LIQUID_GLASS_REFERENCE -->

# Liquid glass ring

A refracting glass ring for circular elements — avatars, icons, thumbnails. The background shows
through it **and bends**, which is what separates it from a glassmorphism panel.

Bundled at `liquid-glass/liquid-glass.js`. Framework-free, no build step, runs in the browser and in
Node because it only touches `{ data, width, height }`.

**Load it in a page with a plain `<script src>`, never `type="module"`.** A browser refuses module
imports over `file://`, so an exported artifact that a user opens by double-clicking would render
nothing at all. The classic script publishes `LiquidGlass` on the global and works from both
`file://` and `http://`. In Node or a bundler, import the wrapper beside it, `liquid-glass.mjs`,
which re-exports the same functions by name.

## When to use it

Use it when a circular element needs to read as physical glass over a visible background: a profile
ring, a feature icon over imagery, a play button on a thumbnail.

Do **not** reach for it when the background is flat and uniform — refraction has nothing to bend
there, and a plain border is both cheaper and more honest. It also needs real pixels behind it, so
it cannot sit over pure CSS gradients painted by the browser after this runs.

## Usage

```html
<canvas id="ring" width="520" height="520"></canvas>
<script src="./liquid-glass/liquid-glass.js"></script>
<script>
  const { renderLiquidGlassRing } = LiquidGlass;

  const canvas = document.getElementById("ring");
  const ctx = canvas.getContext("2d");
  // Paint the background and the circular content first: the ring refracts what is already there.
  drawBackgroundAndAvatar(ctx);

  const bg = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const out = renderLiquidGlassRing(bg, { cx: 260, cy: 260, rp: 120 });
  ctx.putImageData(new ImageData(out.data, out.width, out.height), 0, 0);
</script>
```

## Options

| Option | Default | Meaning |
|---|---|---|
| `cx`, `cy` | required | Centre of the circular element, in pixels |
| `rp` | required | Radius of the content the ring surrounds, in pixels |
| `ringOuter` | `1.42` | Outer edge of the glass band, in units of `rp`. Wider reads richer, narrower reads sharper |
| `refraction` | `0.3` | Strength of the bend. **Above 0.42 the remap folds** and straight lines break into loops |
| `see` | `0.88` | Transparency of the band. Raise toward `0.92` on dark backgrounds |
| `glass` | `[71, 60, 57]` | Glass body colour, warm charcoal. Keep the channels slightly unequal or it reads as plastic |

## Radial bands

With `u = r / rp`:

| Band | Treatment |
|---|---|
| `u < 1.00` | The content itself, untouched |
| `1.00 ≤ u < 1.42` | Glass: refraction, attenuation and rim glow |
| `1.42 ≤ u < 1.60` | Outer shadow: attenuation only, no refraction |
| `u ≥ 1.60` | Untouched |

## Tuning order

`refraction` first — it is whether the effect exists at all. Then `see`. Then `ringOuter`. Rim
strength last; overdoing it makes the ring read as a plate edge rather than glass.

A bright, detailed background shows refraction best. On a dark flat background, raise the glow
rather than `refraction` — pushing the bend harder on a background with no detail to bend just
softens the element.

## Verifying it

Put a 24px grid behind one ring and look at it:

- lines bend smoothly inside the band → correct
- lines do not bend at all → refraction is not reaching the pixels; check `rp` and the band mask
- lines break or curl into loops → `refraction` is too high, back below 0.42
- lines bend **outside** the ring → the mask is leaking, which makes the element look like it is
  floating
