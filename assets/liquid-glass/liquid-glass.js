/**
 * Liquid glass ring - high-transparency refracting glass around a circular element.
 *
 * One shared core for both runtimes: it only reads and writes `{ data, width, height }`, which is
 * the shape of a browser `ImageData` and of a `@napi-rs/canvas` ImageData alike, so the same file
 * runs in a page and in Node with no build step and no framework.
 *
 * 2D image operations only - radial remap, centre-scaled warp, small Gaussian blur. No shader.
 * Deliberately not a glassmorphism preset: a blur plus a translucent white fill and a 1px border
 * has no refraction, so it never reads as glass.
 *
 * Usage in a page:
 *   const ctx = canvas.getContext("2d");
 *   const bg = ctx.getImageData(0, 0, canvas.width, canvas.height);
 *   const out = renderLiquidGlassRing(bg, { cx: 260, cy: 260, rp: 120 });
 *   ctx.putImageData(new ImageData(out.data, out.width, out.height), 0, 0);
 */

/** Outer edge of the glass band, in units of the content radius. */
export const RING_OUTER = 1.42;
/** Beyond this the pixel is returned untouched. */
export const SHADOW_OUTER = 1.6;
/** Warm charcoal. The channels differ on purpose - a neutral grey reads as plastic. */
export const GLASS_COLOR = [71, 60, 57];
/**
 * Displacement scale in units of the content radius, calibrated so the radial remap stays
 * monotonic up to refraction 0.42 and folds past it. Beyond that the remap self-intersects and
 * straight lines break into loops instead of bending.
 */
const REFRACT_SCALE = 0.0931;
/**
 * The gradient of sin(pi t)^1.55 rises like t^0.55, so its slope is unbounded at both band edges
 * and the remap folds there at any strength. Tapering both ends gives it finite slope.
 */
const BAND_TAPER = 0.18;
const H_PRIME_PEAK = 2.942;
const REFRACT_EDGE = RING_OUTER * 1.03;
const FALLOFF = 0.06;
const MAGNIFY = 1.04;
const BLUR_SIGMA = 0.45;
const RIM_WIDTH = 0.03;
const RIM_INNER = 0.11;
const RIM_OUTER = 0.075;

/** Opacity of the glass against u = r/rp. Its shape is the silhouette; do not straighten it. */
const OPACITY_CURVE = [
  [1.0, 0.82], [1.05, 0.79], [1.15, 0.42], [1.25, 0.26],
  [1.35, 0.17], [1.45, 0.08], [1.55, 0.02], [1.6, 0.0],
];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (edge0, edge1, x) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

function opacityAt(u) {
  if (u <= OPACITY_CURVE[0][0]) return OPACITY_CURVE[0][1];
  for (let i = 1; i < OPACITY_CURVE.length; i++) {
    const [u1, a1] = OPACITY_CURVE[i];
    if (u <= u1) {
      const [u0, a0] = OPACITY_CURVE[i - 1];
      return a0 + ((a1 - a0) * (u - u0)) / (u1 - u0);
    }
  }
  return 0;
}

/** Gradient of the convex-lens height field h(t) = sin(pi t)^exponent. */
function heightGradient(t, exponent) {
  const s = Math.sin(Math.PI * t);
  if (s <= 0) return 0;
  return exponent * Math.PI * Math.pow(s, exponent - 1) * Math.cos(Math.PI * t);
}

/**
 * Normalised lens profile across a band, tapered at both ends.
 *
 * Its sign is what makes the ring read as glass: positive on the inner half, so the sample radius
 * moves inward and the background is pushed outward; negative on the outer half, pulling the
 * background inward. Both halves converge on the ring centreline.
 */
export function lensProfile(t) {
  const taper = smoothstep(0, BAND_TAPER, t) * (1 - smoothstep(1 - BAND_TAPER, 1, t));
  return (heightGradient(t, 1.55) / H_PRIME_PEAK) * taper;
}

/** Sample radius for a given pixel radius. Exported so a caller can assert monotonicity. */
export function refractedRadius(r, options) {
  const rp = options.rp;
  const ringOuter = options.ringOuter ?? RING_OUTER;
  const K = options.refraction ?? 0.3;
  const u = r / rp;
  if (u < 1) return r;
  const mask = 1 - smoothstep(REFRACT_EDGE - FALLOFF, REFRACT_EDGE, u);
  if (mask <= 0) return r;
  const primary = lensProfile(clamp01((u - 1) / (ringOuter - 1)));
  const secondary = lensProfile(clamp01((u - 1) / (SHADOW_OUTER - 1)));
  return r - (K * primary + K * 0.35 * secondary) * REFRACT_SCALE * rp * mask;
}

function sample(img, x, y, out) {
  const px = Math.min(Math.max(x, 0), img.width - 1);
  const py = Math.min(Math.max(y, 0), img.height - 1);
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(x0 + 1, img.width - 1);
  const y1 = Math.min(y0 + 1, img.height - 1);
  const fx = px - x0;
  const fy = py - y0;
  const i00 = (y0 * img.width + x0) * 4;
  const i10 = (y0 * img.width + x1) * 4;
  const i01 = (y1 * img.width + x0) * 4;
  const i11 = (y1 * img.width + x1) * 4;
  for (let c = 0; c < 3; c++) {
    const top = img.data[i00 + c] * (1 - fx) + img.data[i10 + c] * fx;
    const bottom = img.data[i01 + c] * (1 - fx) + img.data[i11 + c] * fx;
    out[c] = top * (1 - fy) + bottom * fy;
  }
}

/** Separable Gaussian blur. Small sigma only - a large one turns the ring into frosted glass. */
function blur(img, sigma) {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(w);
    sum += w;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  const pass = (src, horizontal) => {
    const data = new Uint8ClampedArray(src.data.length);
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        let r = 0, g = 0, b = 0;
        for (let k = -radius; k <= radius; k++) {
          const sx = horizontal ? Math.min(Math.max(x + k, 0), src.width - 1) : x;
          const sy = horizontal ? y : Math.min(Math.max(y + k, 0), src.height - 1);
          const idx = (sy * src.width + sx) * 4;
          const w = kernel[k + radius];
          r += src.data[idx] * w;
          g += src.data[idx + 1] * w;
          b += src.data[idx + 2] * w;
        }
        const o = (y * src.width + x) * 4;
        data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
      }
    }
    return { data, width: src.width, height: src.height };
  };
  return pass(pass(img, true), false);
}

/**
 * Composite the glass ring over `background`.
 *
 * Composition order is fixed: refract, magnify, blur, attenuate through the glass body, then add
 * the rim glow. Reordering it changes the result.
 */
export function renderLiquidGlassRing(background, options) {
  const { cx, cy, rp } = options;
  const ringOuter = options.ringOuter ?? RING_OUTER;
  const see = options.see ?? 0.88;
  const glass = options.glass ?? GLASS_COLOR;

  const blurred = blur(background, BLUR_SIGMA);
  const out = new Uint8ClampedArray(background.data);
  const direct = new Float64Array(3);
  const magnified = new Float64Array(3);
  const soft = new Float64Array(3);

  for (let y = 0; y < background.height; y++) {
    for (let x = 0; x < background.width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = Math.hypot(dx, dy);
      const u = r / rp;
      if (u < 1 || u >= SHADOW_OUTER) continue;

      const idx = (y * background.width + x) * 4;
      const ux = r === 0 ? 0 : dx / r;
      const uy = r === 0 ? 0 : dy / r;
      // Refraction, magnification and blur live only inside this mask, so background outside the
      // ring is never disturbed and the element does not look like it is floating.
      const mask = 1 - smoothstep(REFRACT_EDGE - FALLOFF, REFRACT_EDGE, u);
      const sampleR = refractedRadius(r, options);

      sample(background, cx + ux * sampleR, cy + uy * sampleR, direct);

      if (mask > 0) {
        sample(background, cx + (ux * sampleR) / MAGNIFY, cy + (uy * sampleR) / MAGNIFY, magnified);
        sample(blurred, cx + ux * sampleR, cy + uy * sampleR, soft);
        for (let c = 0; c < 3; c++) {
          direct[c] = direct[c] * (1 - 0.5 * mask) + magnified[c] * (0.5 * mask);
          direct[c] = direct[c] * (1 - 0.35 * mask) + soft[c] * (0.35 * mask);
        }
      }

      // Attenuation through a coloured translucent medium: a mix toward the glass colour, never a
      // multiply. A multiply has no constant term and cannot render a tinted body.
      let alpha = opacityAt(u);
      // Thin the glass inside the band only. Past the band the curve is untouched, so the outer
      // shadow keeps its silhouette. Clear inside, dark outside is the whole design.
      const inBand = 1 - smoothstep(ringOuter - 0.08, ringOuter, u);
      alpha *= 1 - see * inBand;

      const rim = RIM_INNER * Math.exp(-(((u - 1) / RIM_WIDTH) ** 2))
        + RIM_OUTER * Math.exp(-(((u - ringOuter) / RIM_WIDTH) ** 2));
      const glow = rim * 255;

      out[idx] = direct[0] * (1 - alpha) + glass[0] * alpha + glow;
      out[idx + 1] = direct[1] * (1 - alpha) + glass[1] * alpha + glow;
      out[idx + 2] = direct[2] * (1 - alpha) + glass[2] * alpha + glow;
      out[idx + 3] = 255;
    }
  }
  return { data: out, width: background.width, height: background.height };
}
