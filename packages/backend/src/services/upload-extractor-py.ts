/**
 * Python-based upload extractor for the P4.2 DS ingestion flow.
 *
 * The entire Python source lives here as a `String.raw` template so
 * `bun build --compile` bundles it into the single binary — the same
 * pattern `runtime/deck-stage.ts` uses for the deck runtime JS. At
 * runtime, `runPythonUploadExtractor` in `design-system-extract.ts`
 * writes this string to a temp file next to the upload and spawns
 * `python[3] script.py --input ... --output ...`. No separate `.py`
 * file needs to ship with the bundle.
 *
 * Notes for editors:
 *   - Keep the source free of backticks and `${` — both terminate /
 *     interpolate the template literal. The one original backticked
 *     error message was rewritten with single quotes for this reason.
 *   - `String.raw` preserves backslashes verbatim, so Python regex
 *     patterns (`\b`, `\d`, `\s`, …) keep their original semantics
 *     without further escaping.
 *   - Everything else is a byte-for-byte copy of the original
 *     `design-system-upload-extract.py` source.
 */
import { PYPDF_REQUIRED_VERSION } from "./pypdf-version";

const REQUIRED_PYPDF_TUPLE = PYPDF_REQUIRED_VERSION.split(".").join(", ");

export const UPLOAD_EXTRACTOR_PY = String.raw`#!/usr/bin/env python3
import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path


NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
}

MAX_PPTX_ENTRIES = 10000
# Mirrors PYPDF_REQUIRED_VERSION (pypdf-version.ts): older releases carry
# malformed-PDF resource-exhaustion advisories and are refused before parsing.
REQUIRED_PYPDF = (${REQUIRED_PYPDF_TUPLE})
# Untrusted documents run under a memory and CPU ceiling on POSIX hosts.
MAX_ADDRESS_SPACE_BYTES = 3 * 1024 * 1024 * 1024
MAX_CPU_SECONDS = 120
MAX_XML_BYTES = 8 * 1024 * 1024
MAX_PPTX_EXPANDED_BYTES = 128 * 1024 * 1024


def read_pptx_xml(zf, name):
    if zf.getinfo(name).file_size > MAX_XML_BYTES:
        raise ValueError("PPTX XML entry exceeds extraction limit")
    with zf.open(name) as source:
        data = source.read(MAX_XML_BYTES + 1)
    if len(data) > MAX_XML_BYTES:
        raise ValueError("PPTX XML entry exceeds extraction limit")
    return ET.fromstring(data)


def compact_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def dedupe(values, limit):
    out = []
    seen = set()
    for raw in values:
        value = compact_spaces(str(raw))
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
        if len(out) >= limit:
            break
    return out


def clip(value: str, limit: int) -> str:
    value = compact_spaces(value)
    if len(value) <= limit:
        return value
    return value[: max(0, limit - 3)].rstrip() + "..."


def infer_brand_name(file_path: Path, headings):
    if headings:
        first = headings[0]
        if 2 <= len(first) <= 80:
            return first
    stem = re.sub(r"[_-]+", " ", file_path.stem).strip()
    if stem:
        return stem.title()
    return "Uploaded Design System"


def empty_manifest(kind: str, file_path: Path):
    return {
        "kind": kind,
        "brand_name": infer_brand_name(file_path, []),
        "page_count": 0,
        "fonts": [],
        "colors": [],
        "font_sizes": [],
        "font_weights": [],
        "spacing_values": [],
        "radii": [],
        "shadows": [],
        "notes": [],
        "headings": [],
        "bodies": [],
        "misc_lines": [],
        "pages": [],
    }


def pptx_slide_sort_key(name: str) -> int:
    match = re.search(r"slide(\d+)\.xml$", name)
    return int(match.group(1)) if match else 999999


def parse_theme(zf: zipfile.ZipFile):
    fonts = []
    colors = []
    for name in zf.namelist():
        if not re.match(r"ppt/theme/theme\d+\.xml$", name):
            continue
        root = read_pptx_xml(zf, name)
        for node in root.findall(".//*[@typeface]"):
            typeface = compact_spaces(node.attrib.get("typeface", ""))
            if typeface and typeface not in {
                "+mj-lt",
                "+mn-lt",
                "+mj-ea",
                "+mn-ea",
            }:
                fonts.append(typeface)
        for node in root.findall(".//a:clrScheme/*", NS):
            color = node.find("a:srgbClr", NS)
            if color is None:
                color = node.find("a:sysClr", NS)
            value = "" if color is None else color.attrib.get("lastClr") or color.attrib.get("val", "")
            value = compact_spaces(value).lstrip("#")
            if re.fullmatch(r"[0-9A-Fa-f]{6}", value):
                colors.append(f"#{value.upper()}")
    return dedupe(fonts, 8), dedupe(colors, 24)


def extract_pptx(file_path: Path):
    manifest = empty_manifest("pptx", file_path)
    with zipfile.ZipFile(file_path) as zf:
        entries = zf.infolist()
        if len(entries) > MAX_PPTX_ENTRIES or sum(entry.file_size for entry in entries) > MAX_PPTX_EXPANDED_BYTES:
            raise ValueError("PPTX archive exceeds extraction limit")
        theme_fonts, theme_colors = parse_theme(zf)
        fonts = list(theme_fonts)
        colors = list(theme_colors)
        font_sizes = []
        font_weights = []
        slide_pages = []
        heading_candidates = []
        body_candidates = []
        misc_lines = []

        slide_files = sorted(
            [
                name
                for name in zf.namelist()
                if re.match(r"ppt/slides/slide\d+\.xml$", name)
            ],
            key=pptx_slide_sort_key,
        )

        for index, slide_name in enumerate(slide_files, start=1):
            root = read_pptx_xml(zf, slide_name)
            fragments = []
            for paragraph in root.findall(".//a:p", NS):
                runs = []
                for run in paragraph.findall("./a:r", NS):
                    text = "".join(node.text or "" for node in run.findall("./a:t", NS))
                    text = compact_spaces(text)
                    if text:
                        runs.append(text)
                    rpr = run.find("./a:rPr", NS)
                    if rpr is not None:
                        size = rpr.attrib.get("sz")
                        if size and size.isdigit():
                            font_sizes.append(f"{int(size) / 100:g}pt")
                        if rpr.attrib.get("b") in {"1", "true"}:
                            font_weights.append("700")
                        fill = rpr.find("./a:solidFill/a:srgbClr", NS)
                        if fill is not None:
                            value = compact_spaces(fill.attrib.get("val", "")).lstrip("#")
                            if re.fullmatch(r"[0-9A-Fa-f]{6}", value):
                                colors.append(f"#{value.upper()}")
                paragraph_text = compact_spaces(" ".join(runs))
                if paragraph_text:
                    fragments.append(paragraph_text)

            title = next(
                (frag for frag in fragments if len(frag) <= 90),
                fragments[0] if fragments else "",
            )
            body_lines = [frag for frag in fragments if frag != title]
            summary = body_lines[0] if body_lines else title
            excerpt = "\n".join(fragments[:6])
            slide_pages.append(
                {
                    "index": index,
                    "title": clip(title or f"Slide {index}", 120),
                    "summary": clip(summary or "Compact slide summary", 180),
                    "text_excerpt": clip(excerpt, 640),
                }
            )

            if title:
                heading_candidates.append(title)
            for line in body_lines[:4]:
                if len(line) <= 140:
                    body_candidates.append(line)
                misc_lines.append(line)
            misc_lines.extend(fragments[:6])

        manifest["brand_name"] = infer_brand_name(file_path, heading_candidates)
        manifest["page_count"] = len(slide_pages)
        manifest["fonts"] = dedupe(fonts, 8)
        manifest["colors"] = dedupe(colors, 24)
        manifest["font_sizes"] = dedupe(font_sizes, 16)
        manifest["font_weights"] = dedupe(font_weights, 12)
        manifest["notes"] = [
            "Full deck text was compressed into short slide summaries for token efficiency.",
            "PPTX theme fonts and colors were extracted from OOXML where available.",
        ]
        manifest["headings"] = heading_candidates
        manifest["bodies"] = body_candidates
        manifest["misc_lines"] = misc_lines
        manifest["pages"] = slide_pages
    return manifest


def extract_pdf_fonts(page, page_index, warnings):
    fonts = []
    try:
        resources = page.get("/Resources")
        if resources is None:
            return fonts
        font_map = resources.get("/Font")
        if font_map is None:
            return fonts
        for _, font_ref in font_map.items():
            try:
                font = font_ref.get_object()
                base = str(font.get("/BaseFont", "")).replace("/", "")
                base = compact_spaces(base)
                if base:
                    fonts.append(base)
            except Exception as exc:
                warnings.append(
                    f"Failed to resolve a font reference on page {page_index}: {exc}"
                )
                continue
    except Exception as exc:
        warnings.append(
            f"Failed to inspect font resources on page {page_index}: {exc}"
        )
        return fonts
    return fonts


def extract_pdf(file_path: Path):
    try:
        import pypdf
        from pypdf import PdfReader
    except Exception as exc:
        raise RuntimeError(
            "PDF upload requires the Python package 'pypdf'. Install it with 'py -3 -m pip install pypdf' or 'python -m pip install pypdf'."
        ) from exc

    installed = tuple(int(part) for part in re.findall(r"\d+", getattr(pypdf, "__version__", "0"))[:3])
    if installed < REQUIRED_PYPDF:
        raise RuntimeError(
            "PDF upload requires pypdf %s or newer; found %s. Update it from the app settings or with 'python -m pip install --user pypdf==%s'."
            % (".".join(str(part) for part in REQUIRED_PYPDF), getattr(pypdf, "__version__", "unknown"), ".".join(str(part) for part in REQUIRED_PYPDF))
        )

    manifest = empty_manifest("pdf", file_path)
    reader = PdfReader(str(file_path))
    fonts = []
    headings = []
    bodies = []
    misc_lines = []
    pages = []
    warnings = []

    for index, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        lines = [compact_spaces(line) for line in text.splitlines()]
        lines = [line for line in lines if line]
        title = next(
            (line for line in lines if len(line) <= 90),
            lines[0] if lines else "",
        )
        summary = next((line for line in lines[1:] if len(line) <= 180), title)
        excerpt = "\n".join(lines[:10])
        pages.append(
            {
                "index": index,
                "title": clip(title or f"Page {index}", 120),
                "summary": clip(summary or "Compact page summary", 180),
                "text_excerpt": clip(excerpt, 640),
            }
        )
        if title:
            headings.append(title)
        for line in lines[1:5]:
            bodies.append(line)
        misc_lines.extend(lines[:8])
        fonts.extend(extract_pdf_fonts(page, index, warnings))

    metadata_title = ""
    try:
        metadata_title = compact_spaces(getattr(reader.metadata, "title", "") or "")
    except Exception as exc:
        warnings.append(f"Failed to read PDF metadata title: {exc}")
        metadata_title = ""

    manifest["brand_name"] = metadata_title or infer_brand_name(file_path, headings)
    manifest["page_count"] = len(pages)
    manifest["fonts"] = dedupe(fonts, 8)
    base_notes = [
        "PDF text was compressed into short page summaries for token efficiency.",
        "Color and layout extraction from PDF is intentionally conservative in this first pass.",
    ]
    # Cap warnings so a corrupt PDF with per-page failures doesn't blow
    # up the notes array — the first 5 traces are enough to pick a
    # failure mode apart.
    manifest["notes"] = base_notes + dedupe(warnings, 5)
    manifest["headings"] = headings
    manifest["bodies"] = bodies
    manifest["misc_lines"] = misc_lines
    manifest["pages"] = pages
    return manifest


def apply_resource_limits():
    try:
        import resource
    except ImportError:
        return
    for name, limit in (("RLIMIT_AS", MAX_ADDRESS_SPACE_BYTES), ("RLIMIT_CPU", MAX_CPU_SECONDS)):
        kind = getattr(resource, name, None)
        if kind is None:
            continue
        try:
            soft, hard = resource.getrlimit(kind)
            ceiling = limit if hard == resource.RLIM_INFINITY else min(limit, hard)
            if soft == resource.RLIM_INFINITY or soft > ceiling:
                resource.setrlimit(kind, (ceiling, hard))
        except (ValueError, OSError):
            continue


def main():
    apply_resource_limits()
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    source_path = Path(args.input)
    output_path = Path(args.output)
    suffix = source_path.suffix.lower()

    if suffix == ".pptx":
        manifest = extract_pptx(source_path)
    elif suffix == ".pdf":
        manifest = extract_pdf(source_path)
    else:
        raise RuntimeError(f"Unsupported upload type: {suffix}")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
`;
