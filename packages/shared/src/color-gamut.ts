// Private inverse gamut model and continuous Bernstein certificate.
// Proof and floating-point budget: .omo/evidence/bg-themes-1028/a-core/color-standard-alignment.md.
export type ColorGamut = "srgb" | "display-p3";
export type ColorVector = readonly [number, number, number];
export type Matrix = readonly [ColorVector, ColorVector, ColorVector];

// Closed interval arithmetic encloses each binary64 rounding, including subnormals.
// Source decimal rounding, inversion, coefficient arithmetic and subdivision are enclosed.
type Interval = readonly [number, number];
type Polynomial = readonly Interval[];
type Net = readonly Polynomial[];
const ZERO: Interval = [0, 0];
const point = (x: number): Interval => [x, x];
function outward(lo: number, hi: number): Interval {
  return [lo - (Math.abs(lo) * Number.EPSILON + Number.MIN_VALUE),
    hi + (Math.abs(hi) * Number.EPSILON + Number.MIN_VALUE)];
}
function add(a: Interval, b: Interval): Interval { return outward(a[0] + b[0], a[1] + b[1]); }
function multiply(a: Interval, b: Interval): Interval {
  const p = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]];
  return outward(Math.min(...p), Math.max(...p));
}
const negate = (a: Interval): Interval => [-a[1], -a[0]];
function divide(a: Interval, b: Interval): Interval {
  // Only fixed, nonsingular standard matrices reach this operation.
  return multiply(a, outward(1 / b[1], 1 / b[0]));
}
type Triple<T> = readonly [T, T, T];
type IntervalMatrix = Triple<Triple<Interval>>;
const triple = <T>(f: (i: number) => T): Triple<T> => [f(0), f(1), f(2)];
function matrixProduct(a: IntervalMatrix, b: IntervalMatrix): IntervalMatrix {
  return triple(i => triple(j => a[i].reduce((s, x, k) => add(s, multiply(x, b[k][j])), ZERO)));
}
function inverse(a: IntervalMatrix): IntervalMatrix {
  const adj = triple(i => triple(j => add(
    multiply(a[(j + 1) % 3][(i + 1) % 3], a[(j + 2) % 3][(i + 2) % 3]),
    negate(multiply(a[(j + 1) % 3][(i + 2) % 3], a[(j + 2) % 3][(i + 1) % 3])))));
  const det = a[0].reduce((s, x, i) => add(s, multiply(x, adj[i][0])), ZERO);
  return triple(i => triple(j => divide(adj[i][j], det)));
}
function enclose(a: Matrix): IntervalMatrix { return triple(i => triple(j => outward(a[i][j], a[i][j]))); }
function midpoint(a: IntervalMatrix): Matrix { return triple(i => triple(j => (a[i][j][0] + a[i][j][1]) / 2)); }
// Exact printed W3C forward decimals, enclosed BEFORE inversion; no normalized axes.
export const ROOT_LAB = [[0.2104542683093140, 0.7936177747023054, -0.0040720430116193],
  [1.9779985324311684, -2.4285922420485799, 0.4505937096174110],
  [0.0259040424655478, 0.7827717124575296, -0.8086757549230774]] as const;
const XYZ_LMS = enclose([[0.8190224379967030, 0.3619062600528904, -0.1288737815209879],
  [0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
  [0.0481771893596242, 0.2642395317527308, 0.6335478284694309]]);
// Rational forward RGB-to-XYZ matrices derived from the specified xy primaries and D65.
const fraction = (n: number, d: number): Interval => divide(point(n), point(d));
const XYZ: Readonly<Record<ColorGamut, IntervalMatrix>> = {
  srgb: [[fraction(506752, 1228815), fraction(87881, 245763), fraction(12673, 70218)],
    [fraction(87098, 409605), fraction(175762, 245763), fraction(12673, 175545)],
    [fraction(7918, 409605), fraction(87881, 737289), fraction(1001167, 1053270)]],
  "display-p3": [[fraction(608311, 1250200), fraction(189793, 714400), fraction(198249, 1000160)],
    [fraction(35783, 156275), fraction(247089, 357200), fraction(198249, 2500400)],
    [ZERO, fraction(32229, 714400), fraction(5220557, 5000800)]],
};
const ROOT = inverse(enclose(ROOT_LAB));
const CHANNELS: Readonly<Record<ColorGamut, IntervalMatrix>> = {
  srgb: matrixProduct(inverse(XYZ.srgb), inverse(XYZ_LMS)),
  "display-p3": matrixProduct(inverse(XYZ["display-p3"]), inverse(XYZ_LMS)),
};
export const LAB_ROOT = midpoint(ROOT);
export const INVERSE = { srgb: midpoint(CHANNELS.srgb), "display-p3": midpoint(CHANNELS["display-p3"]) } as const;
export const RGB_LMS = { srgb: midpoint(matrixProduct(XYZ_LMS, XYZ.srgb)),
  "display-p3": midpoint(matrixProduct(XYZ_LMS, XYZ["display-p3"])) } as const;
function polynomialProduct(a: Polynomial, b: Polynomial): Polynomial {
  const result: Interval[] = Array.from({ length: a.length + b.length - 1 }, () => ZERO);
  a.forEach((x, i) => b.forEach((y, j) => { result[i + j] = add(result[i + j], multiply(x, y)); }));
  return result;
}
function choose(n: number, k: number): number {
  let result = 1;
  for (let i = 1; i <= k; i++) result = result * (n - i + 1) / i;
  return result;
}
function bernstein(power: Polynomial, degree: number): Polynomial {
  return Array.from({ length: degree + 1 }, (_, i) =>
    power.slice(0, i + 1).reduce((sum, p, j) =>
      add(sum, multiply(p, outward(choose(i, j) / choose(degree, j), choose(i, j) / choose(degree, j)))), ZERO));
}
// The coefficient of each radial power is itself a polynomial in the circle parameter.
function channelPowers(denominator: Polynomial, directions: readonly Polynomial[], row: Triple<Interval>): Net {
  const den2 = polynomialProduct(denominator, denominator);
  const den3 = polynomialProduct(den2, denominator);
  const sums: Interval[][] = [[], [], [], []];
  directions.forEach((direction, index) => {
    const q = ROOT[index][0], q2 = multiply(q, q);
    const factors = [multiply(q2, q), multiply(point(3), q2), multiply(point(3), q), point(1)];
    let power: Polynomial = [point(1)];
    for (let k = 0; k <= 3; k++) {
      power.forEach((coefficient, j) => {
        sums[k][j] = add(sums[k][j] ?? ZERO, multiply(multiply(row[index], factors[k]), coefficient));
      });
      power = polynomialProduct(power, direction);
    }
  });
  // First entry is D^3, NOT the channel's constant coefficient.
  return [den3, polynomialProduct(den3, sums[0]), polynomialProduct(den2, sums[1]),
    polynomialProduct(denominator, sums[2]), sums[3]]
    .map(p => bernstein(p, den3.length - 1));
}
function splitLine(line: Polynomial): readonly [Polynomial, Polynomial] {
  const left: Interval[] = [line[0]], right: Interval[] = [line[line.length - 1]];
  let level = line;
  while (level.length > 1) {
    level = level.slice(1).map((p, i) => multiply(point(0.5), add(level[i], p)));
    left.push(level[0]); right.unshift(level[level.length - 1]);
  }
  return [left, right];
}
function positive(net: Net): boolean {
  const stack = [{ net, depth: 0 }];
  let visited = 0;
  while (stack.length) {
    const node = stack.pop();
    if (!node) break;
    if (node.net.every(row => row.every(p => p[0] >= 0))) continue;
    const last = node.net.length - 1, end = node.net[0].length - 1;
    if ([node.net[0][0], node.net[0][end], node.net[last][0], node.net[last][end]].some(p => p[1] < 0)) return false;
    // An exhausted certificate fails closed. It never approves an unexamined interval.
    if (++visited > 8192 || node.depth >= 48) return false;
    const radial = end === 0 || node.depth % 2 === 0;
    const lines = radial ? node.net[0].map((_, i) => node.net.map(row => row[i])) : node.net;
    const halves = lines.map(splitLine);
    for (const side of [0, 1] as const) {
      const rows = halves.map(pair => pair[side]);
      const child = radial ? rows[0].map((_, i) => rows.map(row => row[i])) : rows;
      stack.push({ net: child, depth: node.depth + 1 });
    }
  }
  return true;
}
function certifies(l: number, k: number, patches: readonly Net[]): boolean {
  const ceiling = Math.min(65536, (1 / (l * l * l)) * (1 - 16 * Number.EPSILON));
  const radius = 1 + k;
  const margin = 16384 * Number.EPSILON * radius * radius * radius;
  const powers = [point(1), point(k), multiply(point(k), point(k)),
    multiply(multiply(point(k), point(k)), point(k))];
  return patches.every(patch => {
    const net = Array.from({ length: 4 }, (_, i) => patch[0].map((_, j) =>
      patch.slice(1, i + 2).reduce((sum, row, p) => {
        const ratio = choose(i, p) / choose(3, p);
        return add(sum, multiply(multiply(row[j], powers[p]), outward(ratio, ratio)));
      }, ZERO)));
    return [true, false].every(lower => positive(net.map(row => row.map((p, j) => {
      const limit = lower ? point(-margin) : add(point(ceiling), point(-margin));
      const edge = multiply(patch[0][j], limit);
      return add(edge, lower ? p : negate(p));
    }))));
  });
}
function certifiedBound(l: number, patches: readonly Net[]): number {
  // Below this floor, a zero bound avoids subnormal cancellation (error < 8e-100 C).
  if (l < 1e-100 || l === 1) return 0;
  let lo = 0, hi = 8;
  for (let iteration = 0; iteration < 32; iteration++) {
    const k = (lo + hi) / 2;
    if (certifies(l, k, patches)) lo = k; else hi = k;
  }
  // Multiplication must round inward too; safety margin covers conversion arithmetic.
  return Math.max(0, l * lo * (1 - 4 * Number.EPSILON));
}
function rayPatches(direction: readonly [number, number], gamut: ColorGamut): readonly Net[] {
  const [x, y] = direction;
  const directions = ROOT.map(([, a, b]) => [add(multiply(a, point(x)), multiply(b, point(y)))]);
  return CHANNELS[gamut].map(row => channelPowers([point(1)], directions, row));
}
/** Conservative membership certifies the entire prefix, including the mapper's passthrough path. */
export function certifiedMember(l: number, ray: { readonly c: number; readonly direction: readonly [number, number] },
  gamut: ColorGamut): boolean {
  if (ray.c === 0) return l >= 0 && l <= 1; // Explicit achromatic semantics.
  if (l < 1e-100 || l >= 1) return false;
  const k = ray.c / l;
  return k >= 0 && k <= 8 && certifies(l, k, rayPatches(ray.direction, gamut));
}
/** A direction certifies one radial prefix; null certifies the full disk. Inputs are parsed by color.ts. */
export function certifiedChroma(l: number, direction: readonly [number, number] | null, gamut: ColorGamut): number {
  if (direction !== null) {
    return certifiedBound(l, rayPatches(direction, gamut));
  }
  const patches: Net[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const directions = ROOT.map(([, a, b]) => [multiply(point(sx), a), multiply(point(2 * sy), b), multiply(point(-sx), a)]);
    for (const row of CHANNELS[gamut]) patches.push(channelPowers([point(1), ZERO, point(1)], directions, row));
  }
  return certifiedBound(l, patches);
}
