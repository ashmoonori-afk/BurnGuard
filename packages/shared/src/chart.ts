export const CHART_TYPES = ["area", "line", "bar", "composed", "radar", "pie", "radial", "sankey"] as const;
export type ChartType = typeof CHART_TYPES[number];
export const CHART_THEMES = ["brand", "paper", "midnight", "mono"] as const;
export interface ChartSeries { name: string; values: (number | null)[]; kind?: "bar" | "line" | "area" }
interface ChartBase { schema_version: 1; id: string; title: string; description: string; source: string; unit: string; width: number; height: number; theme: typeof CHART_THEMES[number]; colors: string[] }
export interface DataChart extends ChartBase { type: Exclude<ChartType, "sankey">; categories: string[]; series: ChartSeries[]; radial_max: number }
export interface SankeyChart extends ChartBase { type: "sankey"; nodes: { id: string; label: string }[]; links: { source: string; target: string; value: number }[] }
export type ChartV1 = DataChart | SankeyChart;
export interface ChartDocumentV1 { schema_version: 1; charts: ChartV1[]; revision: number; artifact_digest: string; file_hash: string }

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error("지원하지 않는 차트 설정입니다.");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, empty = false): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim())) throw new Error(`텍스트를 ${max}자 이내로 입력해 주세요.`);
  return value;
}
function dataLabel(value: unknown): string {
  const label = text(value, 60);
  if (/[\t\r\n]/.test(label)) throw new Error("항목·계열 이름에는 탭이나 줄바꿈을 넣을 수 없어요.");
  return label;
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`숫자는 ${min}부터 ${max}까지 입력할 수 있어요.`);
  return value;
}
function list(value: unknown, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`항목 수는 ${min}–${max}개여야 해요.`);
  return value;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(value)) throw new Error("차트 ID 형식을 확인해 주세요.");
  return value;
}
export function parseChart(input: unknown): ChartV1 {
  const keys = ["schema_version", "id", "type", "title", "description", "source", "unit", "width", "height", "theme", "colors"];
  const raw = object(input, [...keys, "categories", "series", "radial_max", "nodes", "links"]);
  if (raw.schema_version !== 1 || !CHART_TYPES.includes(raw.type as ChartType)) throw new Error("지원하지 않는 차트 종류입니다.");
  const theme = raw.theme ?? "brand";
  if (!CHART_THEMES.includes(theme as ChartV1["theme"])) throw new Error("지원하지 않는 차트 테마입니다.");
  const colors = list(raw.colors ?? [], 0, 6).map(value => {
    if (typeof value !== "string" || !/^#[a-f0-9]{6}$/i.test(value)) throw new Error("색상은 6자리 HEX로 입력해 주세요.");
    return value;
  });
  const base: ChartBase = { schema_version: 1, id: id(raw.id), title: text(raw.title, 120), description: text(raw.description ?? "", 300, true), source: text(raw.source ?? "", 160, true), unit: text(raw.unit ?? "", 20, true), width: number(raw.width ?? 960, 320, 2400), height: number(raw.height ?? 540, 300, 1600), theme: theme as ChartV1["theme"], colors };
  if (raw.type === "sankey") {
    object(input, [...keys, "nodes", "links"]);
    const nodes = list(raw.nodes, 2, 16).map(value => { const node = object(value, ["id", "label"]); return { id: id(node.id), label: dataLabel(node.label) }; });
    const ids = new Set(nodes.map(node => node.id));
    if (ids.size !== nodes.length) throw new Error("노드 ID가 중복됩니다.");
    const edges = new Set<string>();
    const links = list(raw.links, 1, 32).map(value => {
      const link = object(value, ["source", "target", "value"]);
      const source = id(link.source), target = id(link.target), weight = number(link.value, 1e-9, 1e12);
      const key = `${source}:${target}`;
      if (!ids.has(source) || !ids.has(target) || source === target || edges.has(key)) throw new Error("흐름의 연결 노드나 중복 연결을 확인해 주세요.");
      edges.add(key); return { source, target, value: weight };
    });
    const chart: SankeyChart = { ...base, type: "sankey", nodes, links };
    sankeyLevels(chart); // Reject cycles before rendering or saving.
    if (nodes.some(node => !links.some(link => link.source === node.id || link.target === node.id))) throw new Error("연결되지 않은 노드를 확인해 주세요.");
    return chart;
  }
  object(input, [...keys, "categories", "series", "radial_max"]);
  const type = raw.type as DataChart["type"];
  const categories = list(raw.categories, type === "radar" ? 3 : 1, type === "pie" ? 12 : type === "radial" ? 8 : 36).map(dataLabel);
  const series = list(raw.series, 1, type === "pie" || type === "radial" ? 1 : 6).map(value => {
    const item = object(value, ["name", "values", "kind"]);
    if (item.kind !== undefined && !["bar", "line", "area"].includes(String(item.kind))) throw new Error("계열 표현 방식을 확인해 주세요.");
    if (type === "composed" && item.kind === undefined) throw new Error("복합 차트에는 계열별 표현 방식이 필요해요.");
    return { name: dataLabel(item.name), values: list(item.values, categories.length, categories.length).map(value => value === null && !["radar", "pie", "radial"].includes(type) ? null : number(value, ["radar", "pie", "radial"].includes(type) ? 0 : -1e12, 1e12)), ...(item.kind ? { kind: item.kind as ChartSeries["kind"] } : {}) };
  });
  const radial_max = number(raw.radial_max ?? 100, 1e-9, 1e12);
  if (type === "radial" && series[0]!.values.some(value => value! > radial_max)) throw new Error("목표값은 모든 데이터 값 이상이어야 해요.");
  return { ...base, type, categories, series, radial_max };
}

export function sankeyLevels(chart: SankeyChart): Map<string, number> {
  const degrees = new Map(chart.nodes.map(node => [node.id, chart.links.filter(link => link.target === node.id).length]));
  const queue = chart.nodes.filter(node => degrees.get(node.id) === 0).map(node => node.id);
  const levels = new Map(queue.map(id => [id, 0]));
  for (let i = 0; i < queue.length; i++) for (const link of chart.links.filter(link => link.source === queue[i])) {
    levels.set(link.target, Math.max(levels.get(link.target) ?? 0, levels.get(link.source)! + 1));
    degrees.set(link.target, degrees.get(link.target)! - 1);
    if (degrees.get(link.target) === 0) queue.push(link.target);
  }
  if (queue.length !== chart.nodes.length) throw new Error("Sankey 차트는 순환 연결을 지원하지 않아요.");
  return levels;
}

export function parseChartDocument(input: unknown): ChartDocumentV1 {
  const raw = object(input, ["schema_version", "charts", "revision", "artifact_digest", "file_hash"]);
  if (raw.schema_version !== 1 || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0 || typeof raw.artifact_digest !== "string" || !/^[a-f0-9]{64}$/.test(raw.artifact_digest) || typeof raw.file_hash !== "string" || !/^[a-f0-9]{64}$/.test(raw.file_hash)) throw new Error("차트 파일 정보를 확인할 수 없어요.");
  const charts = list(raw.charts, 0, 32).map(parseChart);
  if (new Set(charts.map(chart => chart.id)).size !== charts.length) throw new Error("차트 ID가 중복됩니다.");
  return { schema_version: 1, charts, revision: raw.revision as number, artifact_digest: raw.artifact_digest, file_hash: raw.file_hash };
}

export function chartSample(type: ChartType, chartId = "chart_sample"): ChartV1 {
  const base = { schema_version: 1, id: chartId, type, title: "분기별 변화", source: "예시 데이터 · 실제 실적이 아닙니다", theme: "brand" };
  if (type === "sankey") return parseChart({ ...base, title: "유입부터 전환까지", nodes: [{ id: "search", label: "검색" }, { id: "direct", label: "직접 방문" }, { id: "visit", label: "방문" }, { id: "order", label: "구매" }, { id: "leave", label: "탐색 종료" }], links: [{ source: "search", target: "visit", value: 60 }, { source: "direct", target: "visit", value: 40 }, { source: "visit", target: "order", value: 35 }, { source: "visit", target: "leave", value: 65 }] });
  return parseChart({ ...base, title: type === "radial" ? "목표 달성률" : type === "pie" ? "제품별 구성" : type === "radar" ? "경험 지표" : base.title, categories: type === "radar" ? ["명확성", "속도", "접근성", "일관성", "편의성"] : type === "pie" || type === "radial" ? ["A", "B", "C", "D"] : ["1분기", "2분기", "3분기", "4분기"], series: [{ name: "제품 A", values: type === "radar" ? [72, 84, 68, 90, 78] : [28, 42, 35, 64], ...(type === "composed" ? { kind: "bar" } : {}) }, ...(["pie", "radial"].includes(type) ? [] : [{ name: "제품 B", values: type === "radar" ? [86, 65, 88, 72, 82] : [18, 32, 48, 55], ...(type === "composed" ? { kind: "line" } : {}) }])] });
}
