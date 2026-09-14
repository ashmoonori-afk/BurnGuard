import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { designSystemLayoutPreview, type DesignSystemLayout, type DesignDirectionLayout } from "@bg/shared";

export type DirectionRenderInput = {
  readonly systemLayout?: DesignSystemLayout;
  readonly layout: DesignDirectionLayout;
  readonly title: string;
  readonly summary: string;
  readonly outline: readonly string[];
  readonly outputPath: string;
  readonly signal: AbortSignal;
};

export interface DesignDirectionRenderer {
  render(input: DirectionRenderInput): Promise<void>;
}

const graphemeSegmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });

export class SvgDesignDirectionRenderer implements DesignDirectionRenderer {
  async render(input: DirectionRenderInput): Promise<void> {
    input.signal.throwIfAborted();
    const svg = renderSvg(input);
    await mkdir(path.dirname(input.outputPath), { recursive: true });
    input.signal.throwIfAborted();
    await writeFile(input.outputPath, svg, { encoding: "utf8", signal: input.signal });
  }
}

function renderSvg(input: DirectionRenderInput): string {
  if (input.systemLayout) return renderSystemSvg(input, input.systemLayout);
  const point0 = input.outline[0] ?? "핵심 문제";
  const point1 = input.outline[1] ?? "해결 방향";
  const point2 = input.outline[2] ?? "다음 단계";
  switch (input.layout) {
    case "editorial": {
      const title = escapeXml(ellipsize(input.title, 13));
      const summary = escapeXml(ellipsize(input.summary, 37));
      const points = [escapeXml(ellipsize(`01  ${point0}`, 27)), escapeXml(ellipsize(`02  ${point1}`, 27)), escapeXml(ellipsize(`03  ${point2}`, 27))];
      return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#F4EBDD"/><rect x="34" y="28" width="8" height="304" fill="#D64933"/><text data-run="title" data-width-budget="500" x="70" y="86" fill="#161411" font-family="serif" font-size="42" font-weight="700">${title}</text><text data-run="summary" data-width-budget="500" x="72" y="122" fill="#61594F" font-family="sans-serif" font-size="15">${summary}</text><line x1="72" y1="154" x2="594" y2="154" stroke="#161411"/><text data-run="point0" data-width-budget="500" x="72" y="205" fill="#161411" font-family="serif" font-size="20">${points[0]}</text><text data-run="point1" data-width-budget="500" x="72" y="255" fill="#161411" font-family="serif" font-size="20">${points[1]}</text><text data-run="point2" data-width-budget="500" x="72" y="305" fill="#D64933" font-family="serif" font-size="20">${points[2]}</text></svg>`;
    }
    case "modular": {
      const title = escapeXml(ellipsize(input.title, 24));
      const summary = escapeXml(ellipsize(input.summary, 17));
      const points = [escapeXml(ellipsize(point0, 11)), escapeXml(ellipsize(point1, 11)), escapeXml(ellipsize(point2, 11))];
      return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#0C1B33"/><text data-run="title" data-width-budget="560" x="32" y="52" fill="#F7FAFF" font-family="sans-serif" font-size="25" font-weight="700">${title}</text><rect x="32" y="76" width="368" height="108" rx="12" fill="#1E3A5F"/><text x="54" y="112" fill="#75E6DA" font-family="sans-serif" font-size="13">OVERVIEW</text><text data-run="summary" data-width-budget="320" x="54" y="151" fill="#FFFFFF" font-family="sans-serif" font-size="20">${summary}</text><rect x="416" y="76" width="192" height="252" rx="12" fill="#75E6DA"/><text data-run="point0" data-width-budget="148" x="438" y="116" fill="#0C1B33" font-family="sans-serif" font-size="14">${points[0]}</text><text data-run="point1" data-width-budget="148" x="438" y="176" fill="#0C1B33" font-family="sans-serif" font-size="14">${points[1]}</text><text data-run="point2" data-width-budget="148" x="438" y="236" fill="#0C1B33" font-family="sans-serif" font-size="14">${points[2]}</text><rect x="32" y="200" width="176" height="128" rx="12" fill="#F05D5E"/><rect x="224" y="200" width="176" height="128" rx="12" fill="#F7FAFF"/></svg>`;
    }
    case "narrative": {
      const title = escapeXml(ellipsize(input.title, 15));
      const summary = escapeXml(ellipsize(input.summary, 37));
      const points = [escapeXml(ellipsize(point0, 11)), escapeXml(ellipsize(point1, 11)), escapeXml(ellipsize(point2, 12))];
      return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><defs><linearGradient id="sky" x2="1" y2="1"><stop stop-color="#FFF5D6"/><stop offset="1" stop-color="#FFD4B8"/></linearGradient></defs><rect width="640" height="360" fill="url(#sky)"/><circle cx="520" cy="74" r="82" fill="#FF7A59" opacity=".8"/><path d="M64 270 C180 180 300 318 578 166" fill="none" stroke="#553C9A" stroke-width="7"/><circle cx="92" cy="250" r="15" fill="#553C9A"/><circle cx="310" cy="264" r="15" fill="#553C9A"/><circle cx="552" cy="177" r="15" fill="#553C9A"/><text data-run="title" data-width-budget="500" x="44" y="62" fill="#30264A" font-family="sans-serif" font-size="36" font-weight="800">${title}</text><text data-run="summary" data-width-budget="500" x="46" y="94" fill="#6B5876" font-family="sans-serif" font-size="15">${summary}</text><text data-run="point0" data-width-budget="150" x="52" y="320" fill="#30264A" font-family="sans-serif" font-size="14">${points[0]}</text><text data-run="point1" data-width-budget="150" x="245" y="294" fill="#30264A" font-family="sans-serif" font-size="14">${points[1]}</text><text data-run="point2" data-width-budget="160" x="430" y="235" fill="#30264A" font-family="sans-serif" font-size="14">${points[2]}</text></svg>`;
    }
  }
}

function ellipsize(value: string, maximumGraphemes: number): string {
  const graphemes = Array.from(graphemeSegmenter.segment(value), (part) => part.segment);
  return graphemes.length <= maximumGraphemes ? value : `${graphemes.slice(0, maximumGraphemes - 1).join("")}…`;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function renderSystemSvg(input: DirectionRenderInput, layout: DesignSystemLayout): string {
  const preview = designSystemLayoutPreview(layout);
  const emphasis = input.layout === "editorial" ? "message" : input.layout === "modular" ? "media" : "support";
  const grid = Array.from({ length: preview.columns }, (_, index) => `<rect x="${preview.x + index * (preview.unit + preview.gap)}" y="64" width="${preview.unit}" height="244" fill="#e2e8f0" opacity=".45"/>`).join("");
  const blocks = preview.blocks.map(block => `<rect data-role="${block.role}" x="${block.x}" y="${block.y}" width="${block.width}" height="${block.height}" fill="${block.role === emphasis ? "#64748b" : "#cbd5e1"}" stroke="#475569" stroke-width="1"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><title>${escapeXml(input.title)}</title><rect width="640" height="360" fill="#f8fafc"/><text data-run="title" data-width-budget="560" x="32" y="40" fill="#0f172a" font-family="sans-serif" font-size="20">${escapeXml(ellipsize(input.title, 26))}</text>${grid}${blocks}<text x="32" y="340" fill="#475569" font-family="sans-serif" font-size="12">${escapeXml(ellipsize(input.summary, 48))}</text></svg>`;
}
