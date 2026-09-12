import { useT, t, type MessageKey } from "@/i18n/t";
import { useEffect, useState } from "react";
import { CHART_TYPES, CHART_THEMES, chartSample, parseChart, parseChartDocument, renderChart, type ChartV1, type ChartDocumentV1, type ChartType } from "@bg/shared";
import { apiFetch } from "@/api/client";
import { chartValidationCopy } from "@/lib/canvas-charts";

const CHART_TYPE_COPY = {
  area: "canvas.chart.type.area", line: "canvas.chart.type.line", bar: "canvas.chart.type.bar",
  composed: "canvas.chart.type.composed", radar: "canvas.chart.type.radar", pie: "canvas.chart.type.pie",
  radial: "canvas.chart.type.radial", sankey: "canvas.chart.type.sankey",
} as const satisfies Record<ChartType, MessageKey>;
const CHART_THEME_COPY = {
  brand: "canvas.chart.theme.brand", paper: "canvas.chart.theme.paper", midnight: "canvas.chart.theme.midnight", mono: "canvas.chart.theme.mono",
} as const satisfies Record<ChartV1["theme"], MessageKey>;

class ChartDataError extends Error {}

// Only the editor's column headings are localized; authored data stays unchanged.
function dataText(chart: ChartV1): string {
  if (chart.type === "sankey") return [t("canvas.chart.sankeyHeader"), ...chart.links.map(link => `${chart.nodes.find(node => node.id === link.source)!.label}\t${chart.nodes.find(node => node.id === link.target)!.label}\t${link.value}`)].join("\n");
  return [[t("canvas.chart.categoryHeader"), ...chart.series.map(series => series.name)].join("\t"), ...chart.categories.map((category, i) => [category, ...chart.series.map(series => series.values[i] ?? "")].join("\t"))].join("\n");
}
function withData(chart: ChartV1, text: string): ChartV1 {
  const rows = text.replace(/[\r\n]+$/, "").split(/\r?\n/).map(row => row.split("\t"));
  const header = rows.shift();
  if (!header || rows.length === 0 || rows.some(row => row.length !== header.length)) throw new ChartDataError(t("canvas.chart.invalidRows"));
  const numeric = (value: string) => { if (!value.trim()) return null; if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) throw new ChartDataError(t("canvas.chart.invalidNumber")); return Number(value); };
  if (chart.type === "sankey") {
    if (header.length !== 3) throw new ChartDataError(t("canvas.chart.invalidSankey"));
    const names = [...new Set(rows.flatMap(row => [row[0]!, row[1]!]))];
    return parseChart({ ...chart, nodes: names.map((label, i) => ({ id: `node_${i}`, label })), links: rows.map(row => ({ source: `node_${names.indexOf(row[0]!)}`, target: `node_${names.indexOf(row[1]!)}`, value: numeric(row[2]!) })) });
  }
  return parseChart({ ...chart, categories: rows.map(row => row[0]!), series: header.slice(1).map((name, i) => ({ name, values: rows.map(row => numeric(row[i + 1]!)), ...(chart.type === "composed" ? { kind: chart.series[i]?.kind ?? (i === 0 ? "bar" : "line") } : {}) })) });
}

export default function ChartPanel({ projectId, relPath, disabled, onSaved, onRequestAI }: { projectId: string; relPath: string; disabled: boolean; onSaved: () => void; onRequestAI: (text: string) => Promise<void> }) {
  const t = useT();
  const [document, setDocument] = useState<ChartDocumentV1 | null>(null);
  const [chart, setChart] = useState<ChartV1>(() => chartSample("bar"));
  const [data, setData] = useState(() => dataText(chart));
  const [pending, setPending] = useState(false), [reload, setReload] = useState(0);
  const [error, setError] = useState<MessageKey | "">(""), [status, setStatus] = useState<MessageKey | "">(""), [request, setRequest] = useState("");
  const url = `/api/projects/${encodeURIComponent(projectId)}/charts?path=${encodeURIComponent(relPath)}`;
  const select = (next: ChartV1) => { setChart(next); setData(dataText(next)); setError(""); setStatus(""); };
  const create = (type: ChartType) => select(chartSample(type, `chart_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`));
  useEffect(() => {
    const controller = new AbortController(); setDocument(null);
    void apiFetch<unknown>(url, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      const next = parseChartDocument(value); setDocument(next);
      select(next.charts.find(item => item.id === chart.id) ?? next.charts[0] ?? chartSample("bar", `chart_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`));
    }).catch(() => { if (!controller.signal.aborted) setError("canvas.chart.loadFailed"); });
    return () => controller.abort();
    // Keep the selected chart after saving; edits do not trigger refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, reload]);
  let parsed: ChartV1 | null = null, validation = "", preview = "";
  try { parsed = withData(chart, data); preview = renderChart(parsed); } catch (error) { validation = error instanceof ChartDataError ? error.message : chartValidationCopy(error); }
  const busy = disabled || pending || !document;
  const save = async (askAI: boolean) => {
    if (!document || !parsed) return;
    setPending(true); setError(""); setStatus("");
    try {
      await apiFetch(url, { method: "PUT", body: JSON.stringify({ chart: parsed, expected_revision: document.revision, expected_artifact_digest: document.artifact_digest, expected_file_hash: document.file_hash }) });
      onSaved(); setReload(value => value + 1);
      if (askAI) await onRequestAI(`파일 ${JSON.stringify(relPath)}의 차트 ${JSON.stringify(parsed.id)}를 다음 요청에 맞게 수정해 주세요. data-bg-chart-config의 원본 데이터를 보존하고 ChartV1 규칙을 적용하세요. 배치도 파일의 목적에 맞게 조정하세요.\n${request.trim()}`);
      setStatus("canvas.chart.saved");
    } catch { setError("canvas.chart.saveFailed"); }
    finally { setPending(false); }
  };
  const field = "w-full rounded border border-border bg-background px-2 py-1.5 text-foreground";
  return <section aria-label={t("canvas.chart.editor")} className="max-h-[60vh] min-h-64 shrink-0 overflow-y-auto border-t border-border bg-background p-3 text-xs">
    <div className="mb-3 flex flex-wrap items-center gap-2"><strong>{t("canvas.chart.new")}</strong>{CHART_TYPES.map(type => <button key={type} type="button" disabled={busy || (document?.charts.length ?? 0) >= 32} onClick={() => create(type)} className="rounded border border-border px-2 py-1.5 capitalize disabled:opacity-50">{t(CHART_TYPE_COPY[type])} +</button>)}<span className="text-muted-foreground">{t("canvas.chart.sampleHint")}</span></div>
    <div className="grid min-w-0 grid-cols-[minmax(250px,1fr)_minmax(270px,1fr)] gap-4 max-[850px]:grid-cols-1">
      <div className="min-w-0"><label>{t("canvas.chart.savedCharts")}<select aria-label={t("canvas.chart.savedCharts")} className={field} disabled={busy} value={document?.charts.some(item => item.id === chart.id) ? chart.id : ""} onChange={event => { const item = document?.charts.find(item => item.id === event.target.value); if (item) select(item); }}><option value="">{t("canvas.chart.newType")}{" "}{t(CHART_TYPE_COPY[chart.type])}</option>{document?.charts.map(item => <option key={item.id} value={item.id}>{item.title} · {t(CHART_TYPE_COPY[item.type])}</option>)}</select></label>
        <div aria-label={t("canvas.chart.preview")} className="mt-2 overflow-hidden rounded border border-border" dangerouslySetInnerHTML={{ __html: preview }} />
        {validation && <p role="alert" className="mt-2 text-destructive">{validation}</p>}
      </div>
      <div className="min-w-0 space-y-2">
        <fieldset disabled={busy} className="space-y-2 disabled:opacity-60">
          <label className="block">{t("canvas.chart.title")}<input aria-label={t("canvas.chart.title")} className={field} maxLength={120} value={chart.title} onChange={event => setChart({ ...chart, title: event.target.value })} /></label>
          <div className="grid grid-cols-2 gap-2"><label>{t("canvas.chart.theme")}<select aria-label={t("canvas.chart.themeLabel")} className={field} value={chart.theme} onChange={event => setChart({ ...chart, theme: event.target.value as ChartV1["theme"] })}>{CHART_THEMES.map(theme => <option key={theme} value={theme}>{t(CHART_THEME_COPY[theme])}</option>)}</select></label><label>{t("canvas.chart.unit")}<input aria-label={t("canvas.chart.unitLabel")} className={field} value={chart.unit} maxLength={20} onChange={event => setChart({ ...chart, unit: event.target.value })} /></label></div>
          <label className="block">{t("canvas.chart.source")}<input aria-label={t("canvas.chart.sourceLabel")} className={field} maxLength={160} value={chart.source} onChange={event => setChart({ ...chart, source: event.target.value })} /></label>
          <label className="block">{t("canvas.chart.pasteData")}<textarea aria-label={t("canvas.chart.data")} className={`${field} mt-1 min-h-32 whitespace-pre font-mono`} spellCheck={false} value={data} maxLength={24000} onChange={event => setData(event.target.value)} onKeyDown={event => { if (event.key !== "Tab" || event.shiftKey) return; event.preventDefault(); const start = event.currentTarget.selectionStart, end = event.currentTarget.selectionEnd; event.currentTarget.setRangeText("\t", start, end, "end"); setData(event.currentTarget.value); }} /></label>
          <p className="text-muted-foreground">{chart.type === "sankey" ? t("canvas.chart.sankeyHelp") : t("canvas.chart.dataHelp")} {" "}{t("canvas.chart.exitData")}</p>
          {chart.type === "radial" && <label className="block">{t("canvas.chart.target")}<input aria-label={t("canvas.chart.targetLabel")} type="number" className={field} value={chart.radial_max} onChange={event => setChart({ ...chart, radial_max: event.currentTarget.valueAsNumber })} /></label>}
          {parsed?.type === "composed" && parsed.series.map((series, i) => <label key={i} className="flex items-center gap-2">{series.name}<select aria-label={t("canvas.chart.seriesKind", { number: i + 1 })} className={field} value={series.kind} onChange={event => { if (parsed?.type === "composed") setChart({ ...parsed, series: parsed.series.map((item, index) => index === i ? { ...item, kind: event.target.value as "bar" | "line" | "area" } : item) }); }}>{(["bar", "line", "area"] as const).map(kind => <option key={kind} value={kind}>{t(CHART_TYPE_COPY[kind])}</option>)}</select></label>)}
          <details><summary className="cursor-pointer">{t("canvas.chart.advanced")}</summary><div className="mt-2 grid grid-cols-2 gap-2">{(["width", "height"] as const).map(key => <label key={key}>{key === "width" ? t("canvas.width") : t("canvas.height")}<input aria-label={t("canvas.chart.dimension", { dimension: key === "width" ? t("canvas.width") : t("canvas.height") })} className={field} type="number" value={chart[key]} onChange={event => setChart({ ...chart, [key]: event.currentTarget.valueAsNumber })} /></label>)}</div><label className="mt-2 block">{t("canvas.chart.description")}<input className={field} value={chart.description} maxLength={300} onChange={event => setChart({ ...chart, description: event.target.value })} /></label><div className="mt-2 flex flex-wrap gap-2">{["#2855d9", "#b44723", "#047566", "#8542b0", "#a56409", "#bd3570"].map((fallback, i) => <input key={i} aria-label={t("canvas.chart.colorNumber", { number: i + 1 })} type="color" value={chart.colors[i] ?? fallback} onChange={event => { const colors = Array.from({ length: 6 }, (_, j) => chart.colors[j] ?? ["#2855d9", "#b44723", "#047566", "#8542b0", "#a56409", "#bd3570"][j]!); colors[i] = event.target.value; setChart({ ...chart, colors }); }} />)}<button type="button" className="underline" onClick={() => setChart({ ...chart, colors: [] })}>{t("canvas.chart.restoreColors")}</button></div></details>
        </fieldset>
        <div className="flex flex-wrap gap-3"><button type="button" disabled={busy || !parsed} className="rounded bg-accent px-3 py-2 text-accent-foreground disabled:opacity-50" onClick={() => void save(false)}>{t("canvas.chart.save")}</button><button type="button" disabled={pending} className="underline" onClick={() => setReload(value => value + 1)}>{t("canvas.reloadSaved")}</button></div>
        <label className="block">{t("canvas.chart.aiRequest")}<input aria-label={t("canvas.chart.aiRequestLabel")} className={field} value={request} onChange={event => setRequest(event.target.value)} placeholder={t("canvas.chart.aiPlaceholder")} /></label>
        <button type="button" disabled={busy || !parsed || !request.trim()} className="rounded border border-border px-2 py-1.5 disabled:opacity-50" onClick={() => void save(true)}>{t("canvas.chart.saveAndRequest")}</button>
        {error && <p role="alert" className="text-destructive">{t(error)}</p>}{status && <p role="status">{t(status)}</p>}
      </div>
    </div>
  </section>;
}
