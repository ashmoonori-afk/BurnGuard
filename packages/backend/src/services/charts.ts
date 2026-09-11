import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parse } from "node-html-parser";
import { parseChart, renderChart, type ChartV1 } from "@bg/shared";
import { resolveWithin } from "../security/path-boundary";
import { inspectCanonicalTree } from "./canonical-tree-manifest";
import { ArtifactCoordinator, ArtifactOperationError } from "./artifact-coordinator";

function chartRoots(html: string) {
  const roots = parse(html).querySelectorAll("[data-bg-chart]");
  if (roots.length > 32 || roots.some(root => root.tagName !== "FIGURE" || root.querySelector("[data-bg-chart]"))) throw new Error("invalid_chart_container");
  return roots;
}
export function readCharts(html: string): ChartV1[] {
  const ids = new Set<string>();
  return chartRoots(html).map(root => {
    const scripts = root.querySelectorAll("script[data-bg-chart-config]");
    if (scripts.length !== 1 || scripts[0]!.getAttribute("type") !== "application/json") throw new Error("invalid_chart_config");
    const chart = parseChart(JSON.parse(scripts[0]!.textContent));
    if (root.getAttribute("data-bg-chart") !== chart.id || ids.has(chart.id)) throw new Error("invalid_chart_identity");
    ids.add(chart.id); return chart;
  });
}
export function applyChart(html: string, input: ChartV1): string {
  const chart = parseChart(input), charts = readCharts(html), root = chartRoots(html).find(root => root.getAttribute("data-bg-chart") === chart.id);
  const rendered = renderChart(chart);
  if (root) {
    // Keep the user's layout attributes and every byte outside this figure.
    root.set_content(parse(rendered).querySelector("figure")!.innerHTML);
    const [start, end] = root.range;
    return html.slice(0, start) + root.outerHTML + html.slice(end);
  }
  if (charts.length >= 32) throw new Error("too_many_charts");
  const end = html.toLowerCase().lastIndexOf("</body>");
  return end < 0 ? html + rendered : html.slice(0, end) + rendered + html.slice(end);
}
export async function saveChart(coordinator: ArtifactCoordinator, input: { projectId: string; projectDir: string; relPath: string; expectedRevision: number; expectedArtifactDigest: string; expectedFileHash: string; chart: ChartV1 }) {
  const chart = parseChart(input.chart);
  return coordinator.run({ projectId: input.projectId, projectDir: input.projectDir, kind: "patch", expectedRevision: input.expectedRevision, expectedArtifactDigest: input.expectedArtifactDigest, expectedFileHash: input.expectedFileHash, nodeFingerprint: input.expectedFileHash,
    mutate: async stage => {
      const target = resolveWithin(stage, input.relPath), source = await readFile(target);
      if (createHash("sha256").update(source).digest("hex") !== input.expectedFileHash) throw new ArtifactOperationError("stale_file_hash", "Expected file hash is stale");
      await writeFile(target, applyChart(new TextDecoder("utf8", { fatal: true }).decode(source), chart));
    },
  });
}
/** Persist SVG before publication so HTML and image/PDF exports never need a chart runtime. */
export async function ensureCharts(stage: string) {
  const manifest = await inspectCanonicalTree(stage);
  for (const file of manifest.files) {
    if (!/\.html?$/i.test(file.path) || file.size > 16 * 1024 * 1024) continue;
    const target = resolveWithin(stage, file.path), html = await readFile(target, "utf8");
    if (!html.includes("data-bg-chart")) continue;
    let rendered = html;
    const charts = readCharts(html), roots = chartRoots(html);
    for (let i = roots.length - 1; i >= 0; i--) {
      const root = roots[i]!, [start, end] = root.range;
      root.set_content(parse(renderChart(charts[i]!)).querySelector("figure")!.innerHTML);
      rendered = rendered.slice(0, start) + root.outerHTML + rendered.slice(end);
    }
    if (rendered !== html) await writeFile(target, rendered);
  }
}
