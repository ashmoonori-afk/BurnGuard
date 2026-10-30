#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
# How to run: python3 scripts/qa/theme-engine-max-chroma.py <calibration.json>
# Supply [{"id": "...", "color": {"l": ..., "c": ..., "h": ...}}, ...] on stdin.
# Windows: py -3 scripts/qa/theme-engine-max-chroma.py <calibration.json>
"""Independent W3C forward-matrix inversion and six-face interval certificate."""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from decimal import Context, Decimal as D, DecimalException, ROUND_CEILING, ROUND_FLOOR, localcontext
from hashlib import sha256
from pathlib import Path
from typing import Callable, Final

DOWN: Final = Context(prec=90, rounding=ROUND_FLOOR)
UP: Final = Context(prec=90, rounding=ROUND_CEILING)
ONE: Final = D(1)
WIDTH: Final = D("1e-20")
type Json = None | bool | str | int | D | list[Json] | dict[str, Json]
type Vector = tuple[Interval, ...]
type Matrix = tuple[Vector, ...]

class MaximumError(Exception):
    """An undecidable enclosure or invalid input; no private diagnostics."""

def require(condition: bool) -> None:
    if not condition:
        raise MaximumError()

@dataclass(frozen=True, slots=True)
class Interval:
    lo: D
    hi: D

    def __add__(self, other: Interval) -> Interval:
        return Interval(DOWN.add(self.lo, other.lo), UP.add(self.hi, other.hi))

    def __neg__(self) -> Interval:
        return Interval(self.hi.copy_negate(), self.lo.copy_negate())

    def __sub__(self, other: Interval) -> Interval:
        return self + (-other)

    def __mul__(self, other: Interval) -> Interval:
        pairs = [(a, b) for a in (self.lo, self.hi) for b in (other.lo, other.hi)]
        return Interval(min(DOWN.multiply(a, b) for a, b in pairs), max(UP.multiply(a, b) for a, b in pairs))

    def __truediv__(self, other: Interval) -> Interval:
        require(other.hi < 0 or other.lo > 0)
        return self * Interval(DOWN.divide(ONE, other.hi), UP.divide(ONE, other.lo))

    def __pow__(self, exponent: int) -> Interval:
        result = point(1)
        for _ in range(exponent):
            result = result * self
        return result

    def sqrt(self) -> Interval:
        require(self.lo > 0)
        return Interval(DOWN.next_minus(DOWN.sqrt(self.lo)), UP.next_plus(UP.sqrt(self.hi)))

def point(value: str | int | D) -> Interval:
    return Interval(D(value), D(value))

def dot(a: Vector, b: Vector) -> Interval:
    return sum((x * y for x, y in zip(a, b, strict=True)), point(0))

def multiply(a: Matrix, b: Matrix) -> Matrix:
    return tuple(tuple(dot(row, column) for column in zip(*b, strict=True)) for row in a)

def inverse(matrix: Matrix) -> Matrix:
    """Local Gauss-Jordan scratch rows; no supplied inverse coefficients."""
    rows = [list(row) + [point(int(i == j)) for j in range(3)] for i, row in enumerate(matrix)]
    for col in range(3):
        pivot = max(range(col, 3), key=lambda i: abs(rows[i][col].lo + rows[i][col].hi))
        rows[col], rows[pivot] = rows[pivot], rows[col]
        divisor = rows[col][col]
        rows[col] = [value / divisor for value in rows[col]]
        for i in range(3):
            if i != col:
                factor = rows[i][col]
                rows[i] = [x - factor * y for x, y in zip(rows[i], rows[col], strict=True)]
    return tuple(tuple(row[3:]) for row in rows)

def atan_reciprocal(n: int) -> Interval:
    x = point(1) / point(n)
    term, total = x, point(0)
    for k in range(160):
        total = total + term / point(2 * k + 1)
        term = -term * x * x
    return total + Interval(D("-1e-220"), D("1e-220"))

def trig(hue: Interval) -> tuple[Interval, Interval]:
    pi = point(16) * atan_reciprocal(5) - point(4) * atan_reciprocal(239)
    angle = (hue - point(360) if hue.lo > 180 else hue) * pi / point(180)
    sine, cosine, st, ct = point(0), point(0), angle, point(1)
    for k in range(160):
        sine, cosine = sine + st, cosine + ct
        st = -st * angle * angle / point((2 * k + 2) * (2 * k + 3))
        ct = -ct * angle * angle / point((2 * k + 1) * (2 * k + 2))
    tail = Interval(D("-1e-220"), D("1e-220"))
    return cosine + tail, sine + tail

def matrix(text: str) -> Matrix:
    return tuple(tuple(point(x) for x in row.split()) for row in text.split(";"))

# Published W3C forward coefficients define this method's exact finite decimals.
XYZ_LMS: Final = matrix("0.8190224379967030 0.3619062600528904 -0.1288737815209879;0.0329836539323885 0.9292868615863434 0.0361446663506424;0.0481771893596242 0.2642395317527308 0.6335478284694309")
ROOT_LAB: Final = matrix("0.2104542683093140 0.7936177747023054 -0.0040720430116193;1.9779985324311684 -2.4285922420485799 0.4505937096174110;0.0259040424655478 0.7827717124575296 -0.8086757549230774")
PRIMARIES: Final = {"srgb": matrix(".64 .33;.30 .60;.15 .06"), "display-p3": matrix(".68 .32;.265 .69;.15 .06")}

@dataclass(frozen=True, slots=True)
class Conversion:
    rgb_xyz: Matrix
    lms_rgb: Matrix
    lab_root: Matrix

    def ray(self, color: Vector) -> Matrix:
        l, _, h = color
        co, si = trig(h)
        u = tuple(dot(row, (l, point(0), point(0))) for row in self.lab_root)
        v = tuple(dot(row, (point(0), co, si)) for row in self.lab_root)
        terms = tuple((a**3, point(3)*a*a*b, point(3)*a*b*b, b**3) for a, b in zip(u, v, strict=True))
        return multiply(self.lms_rgb, terms)

def conversion(gamut: str) -> Conversion:
    columns = tuple((x / y, point(1), (point(1) - x - y) / y) for x, y in PRIMARIES[gamut])
    basis = tuple(tuple(columns[j][i] for j in range(3)) for i in range(3))
    white = (point(".3127") / point(".3290"), point(1), point(".3583") / point(".3290"))
    scale = tuple(dot(row, white) for row in inverse(basis))
    rgb_xyz = tuple(tuple(x * s for x, s in zip(row, scale, strict=True)) for row in basis)
    return Conversion(rgb_xyz, multiply(inverse(rgb_xyz), inverse(XYZ_LMS)), inverse(ROOT_LAB))

def evaluate(poly: Vector, x: Interval) -> Interval:
    result = poly[-1]
    for coefficient in reversed(poly[:-1]):
        result = result * x + coefficient
    return result

def sign(value: Interval) -> int:
    require(value.hi < 0 or value.lo > 0)
    return 1 if value.lo > 0 else -1

def member(channels: Vector) -> bool:
    if any(x.hi < 0 or x.lo > 1 for x in channels):
        return False
    require(all(x.lo >= 0 and x.hi <= 1 for x in channels))
    return True

def scan(poly: Vector) -> tuple[D, Vector]:
    """Isolate all positive face roots between certified derivative extrema."""
    _ = sign(poly[3])
    lead = min(abs(poly[3].lo), abs(poly[3].hi))
    bound = UP.add(ONE, max(UP.divide(max(abs(x.lo), abs(x.hi)), lead) for x in poly[:3]))
    a, b, c = point(3)*poly[3], point(2)*poly[2], poly[1]
    discriminant = b*b - point(4)*a*c
    critical: Vector = ()
    if sign(discriminant) > 0:
        radical = discriminant.sqrt()
        candidates = ((-b-radical)/(point(2)*a), (-b+radical)/(point(2)*a))
        require(all(r.hi < 0 or r.lo > 0 for r in candidates))
        critical = tuple(sorted((r for r in candidates if r.lo > 0), key=lambda r: r.lo))
        require(all(r.hi < bound for r in critical))
    cuts = (point(0), *critical, point(bound))
    roots: list[Interval] = []
    for left, right in zip(cuts, cuts[1:]):
        require(left.hi < right.lo)
        left_sign, right_sign = sign(evaluate(poly, left)), sign(evaluate(poly, right))
        if left_sign != right_sign:
            lo, hi = left.hi, right.lo
            while UP.subtract(hi, lo) > WIDTH:
                middle = (lo + hi) / 2
                if sign(evaluate(poly, point(middle))) == left_sign:
                    lo = middle
                else:
                    hi = middle
            roots.append(Interval(lo, hi))
    return bound, tuple(roots)

def certificate(ray: Matrix) -> Interval:
    scans = [scan((p[0]-point(face), *p[1:])) for p in ray for face in (0, 1)]
    roots = sorted((root for _, group in scans for root in group), key=lambda r: r.lo)
    require(bool(roots) and all(a.hi < b.lo for a, b in zip(roots, roots[1:])))
    cuts = [point(0), *roots, point(max(bound for bound, _ in scans))]
    states = [member(tuple(evaluate(p, point((a.hi+b.lo)/2)) for p in ray)) for a, b in zip(cuts, cuts[1:])]
    require(states[0] and not any(states[1:]))
    edge = roots[0]
    require(member(tuple(evaluate(p, point(edge.lo)) for p in ray)))
    require(not member(tuple(evaluate(p, point(edge.hi)) for p in ray)))
    return edge

def controls(model: Conversion, gamut: str) -> int:
    for level in ("0", ".5", "1"):
        channels = tuple(evaluate(p, point(0)) for p in model.ray((point(level), point(0), point(0))))
        require(all(max(abs(x.lo-D(level)**3), abs(x.hi-D(level)**3)) < D("1e-12") for x in channels))
    for i, (x, y) in enumerate(PRIMARIES[gamut]):
        xyz = tuple(row[i] for row in model.rgb_xyz)
        total = sum(xyz, point(0))
        require(all(v.lo <= e.lo <= v.hi and v.hi-v.lo < D("1e-70") for v, e in zip((xyz[0]/total, xyz[1]/total), (x, y), strict=True)))
    for i, lab in enumerate(matrix(".450 1.236 -.019;.922 -.671 .263;.153 -1.415 -.449")):
        box = tuple(x + Interval(D("-.0005"), D(".0005")) for x in lab)
        lms = tuple(dot(row, box)**3 for row in model.lab_root)
        rgb = tuple(dot(row, lms) for row in model.lms_rgb)
        xyz = tuple(dot(row, rgb) for row in model.rgb_xyz)
        require(all(x.lo <= int(i == j) <= x.hi for j, x in enumerate(xyz)))
    return 9

def color(raw: Json) -> Vector:
    match raw:
        case {"l": D() as l, "c": D() as c, "h": D() as h}:
            require(all(x.is_finite() for x in (l, c, h)) and 0 < l < 1 and 0 <= c <= 1 and 0 <= h <= 360)
            return tuple(map(point, (l, c, h)))
        case _:
            raise MaximumError()

def run(decode: Callable[[str], Json]) -> None:
    require(sys.version_info >= (3, 12) and len(sys.argv) == 2)
    raw = Path(sys.argv[1]).read_bytes()
    production = sys.stdin.buffer.read(65537)
    require(len(raw) <= 65536 and len(production) <= 65536)
    data = decode(raw.decode("utf-8"))
    outputs = decode(production.decode("utf-8"))
    match data, outputs:
        case {"cases": list() as cases, "tolerance": dict() as tolerance}, list() as rows:
            require(len(cases) == 13 and len(rows) == 12)
            require(tolerance == {"lightness": D("1e-9"), "chroma": D("1e-7"), "retention_ratio": D("1e-6"), "hue_degrees": D("1e-5")})
        case _:
            raise MaximumError()
    models = {g: conversion(g) for g in PRIMARIES}
    checks = {g: controls(m, g) for g, m in models.items()}
    result: list[dict[str, Json]] = []
    fresh = [c for c in cases if isinstance(c, dict) and c.get("comparison") is True]
    require(len(fresh) == 12)
    for captured, produced in zip(fresh, rows, strict=True):
        match captured, produced:
            case {"id": str() as name, "gamut": str() as gamut, "requested": requested, "delivered": delivered}, {"id": str() as produced_id, "color": output}:
                require(name == produced_id and gamut in models)
                request, original, actual = color(requested), color(delivered), color(output)
                model = models[gamut]
                edge = certificate(model.ray(request))
                inside = member(tuple(evaluate(p, original[1]) for p in model.ray(original)))
                actual_inside = member(tuple(evaluate(p, actual[1]) for p in model.ray(actual)))
                result.append({"id": name, "gamut": gamut, "captured_c": str(original[1].lo),
                    "independent_max_c": str(edge.lo), "bracket": {"lo": str(edge.lo), "hi": str(edge.hi)},
                    "production_c": str(actual[1].lo), "delta_c": str(actual[1].lo-edge.lo),
                    "captured_member": inside, "production_member": actual_inside})
            case _:
                raise MaximumError()
    print(json.dumps({"schema_version": 1, "method": "decimal-outward-90-six-face-v1",
        "input_sha256": sha256(raw).hexdigest(), "production_sha256": sha256(production).hexdigest(),
        "controls": checks, "rows": result}, allow_nan=False, sort_keys=True))

if __name__ == "__main__":
    try:
        with localcontext() as context:
            context.prec = 110
            run(json.JSONDecoder(parse_float=D, parse_int=D, parse_constant=D).decode)
    except (MaximumError, OSError, ValueError, KeyError, TypeError, DecimalException):
        print('{"schema_version":1,"code":"MAXIMUM_FAILED"}')
        sys.exit(1)
