import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "node-html-parser";
import { CHART_TYPES, chartSample, parseChart, parseChartDocument, renderChart } from "@bg/shared";
import { runMigrationsFrom } from "../src/db/migrate";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { applyChart, ensureCharts, readCharts, saveChart } from "../src/services/charts";
import { CHART_AUTHORING_RULES } from "../src/harness/chart-authoring";
import { classifyApiRoute } from "../src/server";

test("Given all eight original chart types When rendered Then portable SVG, original data and accessible tables round trip", () => {
  for (const type of CHART_TYPES) {
    const chart = chartSample(type), html = renderChart(chart), root = parse(html);
    expect(readCharts(html)).toEqual([chart]);
    expect(root.querySelectorAll('svg[role="img"]')).toHaveLength(1);
    expect(root.querySelector("table")).not.toBeNull();
    expect(html).not.toMatch(/(?:NaN|Infinity|<script src=|<iframe|<image)/);
    expect(root.querySelectorAll("script")).toHaveLength(1);
    expect(root.querySelector("script")!.getAttribute("type")).toBe("application/json");
    expect(CHART_AUTHORING_RULES).toContain(type);
  }
  expect(classifyApiRoute("/api/projects/p/charts", "PUT")).toBe("project");
});

test("Given hostile or malformed chart input When parsed Then code, cyclic flows and false data are rejected", () => {
  const bar = chartSample("bar"), sankey = chartSample("sankey");
  expect(() => parseChart({ ...bar, onclick: "evil()" })).toThrow();
  expect(() => parseChart({ ...bar, id: 'x" onload="evil()' })).toThrow();
  expect(() => parseChart({ ...bar, colors: ["red;position:fixed"] })).toThrow();
  expect(() => parseChart({ ...bar, categories: ["Q1"], series: [{ name: "Bad", values: [NaN] }] })).toThrow();
  expect(() => parseChart({ ...bar, categories: ["Q1"], series: [{ name: "Bad", values: [1, 2] }] })).toThrow();
  expect(() => parseChart({ ...bar, type: "radial", categories: ["Q1"], series: [{ name: "Bad", values: [101] }] })).toThrow();
  expect(() => parseChart({ ...sankey, nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], links: [{ source: "a", target: "b", value: 1 }, { source: "b", target: "a", value: 1 }] })).toThrow();
  expect(() => parseChart({ ...sankey, links: [{ source: "unknown", target: "visit", value: 1 }] })).toThrow();
  expect(() => readCharts(renderChart(bar) + renderChart(bar))).toThrow();
  expect(() => parseChartDocument({ schema_version: 1, charts: [], revision: 0, artifact_digest: "bad", file_hash: "bad" })).toThrow();
  const html = renderChart({ ...bar, title: '</script><img src=x onerror="alert(1)">', source: "<iframe src='https://example.com'>" });
  expect(parse(html).querySelectorAll("img, iframe")).toHaveLength(0);
  expect(readCharts(html)[0]!.title).toBe('</script><img src=x onerror="alert(1)">');
});

test("Given negative, missing, zero and single-value data When rendered Then honest baselines and gaps remain finite", () => {
  const source = chartSample("line");
  for (const type of ["line", "bar", "area"] as const) {
    const chart = parseChart({ ...source, type, categories: ["A", "B", "C"], series: [{ name: "Sample", values: [-10, null, 10] }] });
    const html = renderChart(chart), root = parse(html);
    expect(root.querySelector("tbody")!.textContent).toContain("자료 없음");
    expect(root.querySelectorAll("circle, rect")).toHaveLength(2);
    if (type !== "bar") expect(root.querySelectorAll("path[data-bg-node-id]")).toHaveLength(2);
  }
  for (const type of ["pie", "radial", "bar"] as const) for (const value of [0, 1, 1e-9]) {
    const chart = parseChart({ ...chartSample(type), categories: ["One"], series: [{ name: "One", values: [value] }] });
    expect(renderChart(chart)).not.toMatch(/NaN|Infinity/);
  }
});

test("Given two positioned AI chart placeholders When materialized Then both survive edits, stale writes fail and undo restores bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "burnguard-charts-")), db = new Database(":memory:");
  try {
    await runMigrationsFrom(db, path.join(import.meta.dir, "../src/db/migrations"));
    const first = chartSample("bar", "first"), second = chartSample("sankey", "second");
    const placeholder = (chart: typeof first) => `<figure class="layout-keep" style="max-width:700px" data-bg-chart="${chart.id}"><script type="application/json" data-bg-chart-config>${JSON.stringify(chart)}</script></figure>`;
    await writeFile(path.join(root, "index.html"), `<!doctype html><body><h1>Keep</h1>${placeholder(first)}<hr>${placeholder(second)}</body>`);
    await ensureCharts(root);
    const original = await readFile(path.join(root, "index.html"), "utf8");
    expect(parse(original).querySelectorAll("svg")).toHaveLength(2);
    expect(readCharts(original)).toEqual([first, second]);
    const modified = applyChart(original, { ...first, title: "Changed" });
    expect(modified.split("<hr>")[1]).toBe(original.split("<hr>")[1]);
    expect(parse(modified).querySelector("figure")!.getAttribute("style")).toBe("max-width:700px");
    db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES ('p','P','prototype',?,'index.html','codex',1,1)").run(root);
    db.exec("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES ('s','p','codex','idle',1,1,1)");
    const coordinator = new ArtifactCoordinator(db), base = await coordinator.initialize("p", root);
    const input = { projectId: "p", projectDir: root, relPath: "index.html", expectedRevision: 0, expectedArtifactDigest: base.tree_digest, expectedFileHash: base.files[0]!.sha256, chart: { ...first, title: "Changed" } };
    const saved = await saveChart(coordinator, input);
    expect(saved.status).toBe("committed");
    await expect(saveChart(coordinator, input)).rejects.toMatchObject({ code: "stale_revision" });
    await coordinator.undo({ projectId: "p", projectDir: root, operationId: saved.id, expectedRevision: saved.resultRevision, expectedArtifactDigest: saved.resultDigest });
    expect(await readFile(path.join(root, "index.html"), "utf8")).toBe(original);
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});
