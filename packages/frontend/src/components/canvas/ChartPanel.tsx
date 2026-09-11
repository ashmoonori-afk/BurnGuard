import { useEffect, useState } from "react";
import { CHART_TYPES, CHART_THEMES, chartSample, parseChart, parseChartDocument, renderChart, type ChartV1, type ChartDocumentV1, type ChartType } from "@bg/shared";
import { apiFetch } from "@/api/client";

function dataText(chart: ChartV1): string {
  if (chart.type === "sankey") return ["출발\t도착\t값", ...chart.links.map(link => `${chart.nodes.find(node => node.id === link.source)!.label}\t${chart.nodes.find(node => node.id === link.target)!.label}\t${link.value}`)].join("\n");
  return [["항목", ...chart.series.map(series => series.name)].join("\t"), ...chart.categories.map((category, i) => [category, ...chart.series.map(series => series.values[i] ?? "")].join("\t"))].join("\n");
}
function withData(chart: ChartV1, text: string): ChartV1 {
  const rows = text.replace(/[\r\n]+$/, "").split(/\r?\n/).map(row => row.split("\t"));
  const header = rows.shift();
  if (!header || rows.length === 0 || rows.some(row => row.length !== header.length)) throw new Error("첫 줄은 항목·계열 이름, 다음 줄은 같은 열 수의 데이터로 입력해 주세요. 열은 탭으로 구분합니다.");
  const numeric = (value: string) => { if (!value.trim()) return null; if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) throw new Error("값은 숫자만 입력해 주세요. 결측값은 빈칸으로 두세요."); return Number(value); };
  if (chart.type === "sankey") {
    if (header.length !== 3) throw new Error("Sankey는 출발·도착·값 3개 열을 입력해 주세요.");
    const names = [...new Set(rows.flatMap(row => [row[0]!, row[1]!]))];
    return parseChart({ ...chart, nodes: names.map((label, i) => ({ id: `node_${i}`, label })), links: rows.map(row => ({ source: `node_${names.indexOf(row[0]!)}`, target: `node_${names.indexOf(row[1]!)}`, value: numeric(row[2]!) })) });
  }
  return parseChart({ ...chart, categories: rows.map(row => row[0]!), series: header.slice(1).map((name, i) => ({ name, values: rows.map(row => numeric(row[i + 1]!)), ...(chart.type === "composed" ? { kind: chart.series[i]?.kind ?? (i === 0 ? "bar" : "line") } : {}) })) });
}

export default function ChartPanel({ projectId, relPath, disabled, onSaved, onRequestAI }: { projectId: string; relPath: string; disabled: boolean; onSaved: () => void; onRequestAI: (text: string) => Promise<void> }) {
  const [document, setDocument] = useState<ChartDocumentV1 | null>(null);
  const [chart, setChart] = useState<ChartV1>(() => chartSample("bar"));
  const [data, setData] = useState(() => dataText(chart));
  const [pending, setPending] = useState(false), [reload, setReload] = useState(0);
  const [error, setError] = useState(""), [status, setStatus] = useState(""), [request, setRequest] = useState("");
  const url = `/api/projects/${encodeURIComponent(projectId)}/charts?path=${encodeURIComponent(relPath)}`;
  const select = (next: ChartV1) => { setChart(next); setData(dataText(next)); setError(""); setStatus(""); };
  const create = (type: ChartType) => select(chartSample(type, `chart_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`));
  useEffect(() => {
    const controller = new AbortController(); setDocument(null);
    void apiFetch<unknown>(url, { signal: controller.signal }).then(value => {
      if (controller.signal.aborted) return;
      const next = parseChartDocument(value); setDocument(next);
      select(next.charts.find(item => item.id === chart.id) ?? next.charts[0] ?? chartSample("bar", `chart_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`));
    }).catch(() => { if (!controller.signal.aborted) setError("차트를 불러오지 못했어요. 저장본을 다시 불러와 주세요."); });
    return () => controller.abort();
    // Keep the selected chart after saving; edits do not trigger refetches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, reload]);
  let parsed: ChartV1 | null = null, validation = "", preview = "";
  try { parsed = withData(chart, data); preview = renderChart(parsed); } catch (error) { validation = error instanceof Error ? error.message : "차트 데이터를 확인해 주세요."; }
  const busy = disabled || pending || !document;
  const save = async (askAI: boolean) => {
    if (!document || !parsed) return;
    setPending(true); setError(""); setStatus("");
    try {
      await apiFetch(url, { method: "PUT", body: JSON.stringify({ chart: parsed, expected_revision: document.revision, expected_artifact_digest: document.artifact_digest, expected_file_hash: document.file_hash }) });
      onSaved(); setReload(value => value + 1);
      if (askAI) await onRequestAI(`파일 ${JSON.stringify(relPath)}의 차트 ${JSON.stringify(parsed.id)}를 다음 요청에 맞게 수정해 주세요. data-bg-chart-config의 원본 데이터를 보존하고 ChartV1 규칙을 적용하세요. 배치도 파일의 목적에 맞게 조정하세요.\n${request.trim()}`);
      setStatus("차트를 HTML에 저장했어요. 실행 취소로 되돌릴 수 있어요.");
    } catch { setError("저장 또는 AI 요청을 완료하지 못했어요. 다른 변경이 있다면 저장본을 다시 불러온 뒤 수정해 주세요."); }
    finally { setPending(false); }
  };
  const field = "w-full rounded border border-border bg-background px-2 py-1.5 text-foreground";
  return <section aria-label="차트 편집기" className="max-h-[60vh] min-h-64 shrink-0 overflow-y-auto border-t border-border bg-background p-3 text-xs">
    <div className="mb-3 flex flex-wrap items-center gap-2"><strong>새 차트</strong>{CHART_TYPES.map(type => <button key={type} type="button" disabled={busy || (document?.charts.length ?? 0) >= 32} onClick={() => create(type)} className="rounded border border-border px-2 py-1.5 capitalize disabled:opacity-50">{type} +</button>)}<span className="text-muted-foreground">예시 데이터로 시작해요.</span></div>
    <div className="grid min-w-0 grid-cols-[minmax(250px,1fr)_minmax(270px,1fr)] gap-4 max-[850px]:grid-cols-1">
      <div className="min-w-0"><label>저장된 차트<select aria-label="저장된 차트" className={field} disabled={busy} value={document?.charts.some(item => item.id === chart.id) ? chart.id : ""} onChange={event => { const item = document?.charts.find(item => item.id === event.target.value); if (item) select(item); }}><option value="">새 차트 · {chart.type}</option>{document?.charts.map(item => <option key={item.id} value={item.id}>{item.title} · {item.type}</option>)}</select></label>
        <div aria-label="차트 미리보기" className="mt-2 overflow-hidden rounded border border-border" dangerouslySetInnerHTML={{ __html: preview }} />
        {validation && <p role="alert" className="mt-2 text-destructive">{validation}</p>}
      </div>
      <div className="min-w-0 space-y-2">
        <fieldset disabled={busy} className="space-y-2 disabled:opacity-60">
          <label className="block">차트 제목<input aria-label="차트 제목" className={field} maxLength={120} value={chart.title} onChange={event => setChart({ ...chart, title: event.target.value })} /></label>
          <div className="grid grid-cols-2 gap-2"><label>테마<select aria-label="차트 테마" className={field} value={chart.theme} onChange={event => setChart({ ...chart, theme: event.target.value as ChartV1["theme"] })}>{CHART_THEMES.map(theme => <option key={theme}>{theme}</option>)}</select></label><label>단위<input aria-label="차트 단위" className={field} value={chart.unit} maxLength={20} onChange={event => setChart({ ...chart, unit: event.target.value })} /></label></div>
          <label className="block">데이터 출처<input aria-label="차트 출처" className={field} maxLength={160} value={chart.source} onChange={event => setChart({ ...chart, source: event.target.value })} /></label>
          <label className="block">데이터 · 스프레드시트에서 붙여넣기<textarea aria-label="차트 데이터" className={`${field} mt-1 min-h-32 whitespace-pre font-mono`} spellCheck={false} value={data} maxLength={24000} onChange={event => setData(event.target.value)} onKeyDown={event => { if (event.key !== "Tab" || event.shiftKey) return; event.preventDefault(); const start = event.currentTarget.selectionStart, end = event.currentTarget.selectionEnd; event.currentTarget.setRangeText("\t", start, end, "end"); setData(event.currentTarget.value); }} /></label>
          <p className="text-muted-foreground">{chart.type === "sankey" ? "첫 줄: 출발·도착·값. 이후 한 줄에 한 연결을 입력하세요. 순환 연결은 지원하지 않아요." : "첫 줄: 항목·계열 이름. 이후 한 줄에 한 항목을 입력하세요. 열은 탭으로 구분하며 빈 값은 결측으로 표시해요."} Shift+Tab으로 입력란을 나갈 수 있어요.</p>
          {chart.type === "radial" && <label className="block">목표값<input aria-label="차트 목표값" type="number" className={field} value={chart.radial_max} onChange={event => setChart({ ...chart, radial_max: event.currentTarget.valueAsNumber })} /></label>}
          {parsed?.type === "composed" && parsed.series.map((series, i) => <label key={i} className="flex items-center gap-2">{series.name}<select aria-label={`계열 ${i + 1} 표현`} className={field} value={series.kind} onChange={event => { if (parsed?.type === "composed") setChart({ ...parsed, series: parsed.series.map((item, index) => index === i ? { ...item, kind: event.target.value as "bar" | "line" | "area" } : item) }); }}>{["bar", "line", "area"].map(kind => <option key={kind}>{kind}</option>)}</select></label>)}
          <details><summary className="cursor-pointer">고급 · 크기, 설명, 색상</summary><div className="mt-2 grid grid-cols-2 gap-2">{(["width", "height"] as const).map(key => <label key={key}>{key === "width" ? "가로" : "세로"}<input aria-label={`차트 ${key}`} className={field} type="number" value={chart[key]} onChange={event => setChart({ ...chart, [key]: event.currentTarget.valueAsNumber })} /></label>)}</div><label className="mt-2 block">설명<input className={field} value={chart.description} maxLength={300} onChange={event => setChart({ ...chart, description: event.target.value })} /></label><div className="mt-2 flex flex-wrap gap-2">{["#2855d9", "#b44723", "#047566", "#8542b0", "#a56409", "#bd3570"].map((fallback, i) => <input key={i} aria-label={`차트 색상 ${i + 1}`} type="color" value={chart.colors[i] ?? fallback} onChange={event => { const colors = Array.from({ length: 6 }, (_, j) => chart.colors[j] ?? ["#2855d9", "#b44723", "#047566", "#8542b0", "#a56409", "#bd3570"][j]!); colors[i] = event.target.value; setChart({ ...chart, colors }); }} />)}<button type="button" className="underline" onClick={() => setChart({ ...chart, colors: [] })}>테마 색상 복원</button></div></details>
        </fieldset>
        <div className="flex flex-wrap gap-3"><button type="button" disabled={busy || !parsed} className="rounded bg-accent px-3 py-2 text-accent-foreground disabled:opacity-50" onClick={() => void save(false)}>차트 저장</button><button type="button" disabled={pending} className="underline" onClick={() => setReload(value => value + 1)}>저장본 다시 불러오기</button></div>
        <label className="block">AI에 차트 수정 요청<input aria-label="AI 차트 요청" className={field} value={request} onChange={event => setRequest(event.target.value)} placeholder="이 차트를 첫 섹션에 배치하고 핵심 수치를 강조해 주세요" /></label>
        <button type="button" disabled={busy || !parsed || !request.trim()} className="rounded border border-border px-2 py-1.5 disabled:opacity-50" onClick={() => void save(true)}>저장 후 AI에 요청</button>
        {error && <p role="alert" className="text-destructive">{error}</p>}{status && <p role="status">{status}</p>}
      </div>
    </div>
  </section>;
}
