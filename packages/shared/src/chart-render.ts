import { parseChart, sankeyLevels, type ChartV1, type SankeyChart } from "./chart";

const escape = (value: string | number) => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const n = (value: number) => Number(value.toFixed(4));
const fmt = (value: number) => new Intl.NumberFormat("en", { maximumSignificantDigits: 4 }).format(value);
const short = (value: string, limit = 18) => value.length > limit ? value.slice(0, limit - 1) + "…" : value;
const palettes = {
  brand: ["#2855d9", "#b44723", "#047566", "#8542b0", "#a56409", "#bd3570"],
  paper: ["#23625c", "#9c4b31", "#615b99", "#8a631b", "#277998", "#a82c60"],
  midnight: ["#85b8ff", "#ffb385", "#62dbc0", "#c5a2ff", "#f4da7c", "#f497c4"],
  mono: ["#182230", "#455568", "#627185", "#7f8b9e", "#9ba4b2", "#b8c0cc"],
};

/** Pure, portable SVG. Data is escaped; no remote assets, runtime scripts or callbacks. */
export function renderChart(input: ChartV1): string {
  const chart = parseChart(input), w = chart.width, h = chart.height;
  const font = Math.max(12, w / 65), left = Math.max(76, w * .09), top = 24, right = w - 32, bottom = h - font * 5;
  const color = (i: number) => chart.colors[i % chart.colors.length] ?? (chart.theme === "brand" ? `var(--bg-chart-${i % 6 + 1},${palettes.brand[i % 6]})` : palettes[chart.theme][i % 6]!);
  const title = (value: string) => `<title>${escape(value)}</title>`;
  const label = (x: number, y: number, value: string, anchor = "middle", attrs = "") => `<text x="${n(x)}" y="${n(y)}" text-anchor="${anchor}" ${attrs}>${escape(value)}</text>`;
  const line = (x1: number, y1: number, x2: number, y2: number) => `<path d="M${n(x1)},${n(y1)}L${n(x2)},${n(y2)}" fill="none" stroke="currentColor" opacity=".14"/>`;
  const tooltip = (name: string, value: number | null) => `${name}: ${value === null ? "자료 없음" : fmt(value)}${value === null ? "" : chart.unit}`;
  let marks = "", legend = "";
  const tableRows: string[][] = [];
  const heading = chart.type === "sankey" ? ["출발", "도착", `값${chart.unit ? ` (${chart.unit})` : ""}`] : ["항목", ...chart.series.map(series => `${series.name}${chart.unit ? ` (${chart.unit})` : ""}`)];
  if (chart.type === "sankey") {
    marks = renderSankey(chart, { left, right, top, bottom, color, label, title, tooltip });
    chart.links.forEach(link => tableRows.push([chart.nodes.find(node => node.id === link.source)!.label, chart.nodes.find(node => node.id === link.target)!.label, String(link.value)]));
  } else {
    chart.categories.forEach((category, i) => tableRows.push([category, ...chart.series.map(series => series.values[i] === null ? "자료 없음" : String(series.values[i]))]));
    if (["area", "line", "bar", "composed"].includes(chart.type)) {
      const values = chart.series.flatMap(series => series.values.filter((v): v is number => v !== null));
      const min = Math.min(0, ...values), rawMax = Math.max(0, ...values), max = rawMax === min ? min + 1 : rawMax;
      const y = (value: number) => bottom - (value - min) / (max - min) * (bottom - top);
      const step = (right - left) / chart.categories.length, x = (i: number) => left + step * (i + .5);
      for (let i = 0; i <= 4; i++) {
        const v = min + (max - min) * i / 4;
        marks += line(left, y(v), right, y(v)) + label(left - 12, y(v) + font / 3, fmt(v), "end");
      }
      marks += line(left, y(0), right, y(0));
      chart.categories.forEach((category, i) => {
        // ponytail: dense axes label a subset; every original label remains in the accessible data table.
        if (i % Math.max(1, Math.ceil(chart.categories.length / 8)) === 0) marks += label(x(i), bottom + font * 1.7, short(category, 12));
      });
      const bars = chart.series.filter(series => (chart.type === "composed" ? series.kind : chart.type) === "bar");
      chart.series.forEach((series, index) => {
        const kind = chart.type === "composed" ? series.kind : chart.type;
        if (kind === "bar") {
          const size = step * .7 / bars.length, offset = bars.indexOf(series);
          series.values.forEach((value, i) => { if (value !== null) marks += `<rect data-bg-node-id="${chart.id}-s${index}-v${i}" x="${n(x(i) - step * .35 + size * offset)}" y="${n(Math.min(y(value), y(0)))}" width="${n(size * .88)}" height="${n(Math.abs(y(value) - y(0)))}" rx="2" fill="${color(index)}">${title(tooltip(`${series.name} · ${chart.categories[i]}`, value))}</rect>`; });
        } else {
          const segments: { i: number; value: number }[][] = [[]];
          series.values.forEach((value, i) => { if (value === null) { if (segments.at(-1)!.length) segments.push([]); } else segments.at(-1)!.push({ i, value }); });
          segments.filter(segment => segment.length).forEach(segment => {
            const d = segment.map((point, i) => `${i ? "L" : "M"}${n(x(point.i))},${n(y(point.value))}`).join("");
            if (kind === "area") marks += `<path d="${d}L${n(x(segment.at(-1)!.i))},${n(y(0))}L${n(x(segment[0]!.i))},${n(y(0))}Z" fill="${color(index)}" opacity=".14"/>`;
            marks += `<path data-bg-node-id="${chart.id}-s${index}-line-${segment[0]!.i}" d="${d}" stroke="${color(index)}" stroke-width="3" fill="none" stroke-linejoin="round"/>`;
          });
          series.values.forEach((value, i) => { if (value !== null) marks += `<circle data-bg-node-id="${chart.id}-s${index}-v${i}" cx="${n(x(i))}" cy="${n(y(value))}" r="4" fill="${color(index)}">${title(tooltip(`${series.name} · ${chart.categories[i]}`, value))}</circle>`; });
        }
      });
    } else if (chart.type === "radar") {
      const cx = w / 2, cy = (top + bottom) / 2, radius = Math.min(w * .29, (bottom - top) * .38);
      const max = Math.max(1e-9, ...chart.series.flatMap(series => series.values as number[]));
      const point = (i: number, value: number) => [cx + Math.sin(i * Math.PI * 2 / chart.categories.length) * radius * value, cy - Math.cos(i * Math.PI * 2 / chart.categories.length) * radius * value];
      for (let ring = 1; ring <= 4; ring++) marks += `<polygon points="${chart.categories.map((_, i) => point(i, ring / 4).map(n).join(",")).join(" ")}" fill="none" stroke="currentColor" opacity=".16"/>`;
      chart.categories.forEach((category, i) => { const p = point(i, 1), end = point(i, 1.2); marks += line(cx, cy, p[0]!, p[1]!) + label(end[0]!, end[1]! + font / 3, short(category, 12)); });
      marks += label(left, top + font, `0 – ${fmt(max)}${chart.unit}`, "start");
      chart.series.forEach((series, index) => { marks += `<polygon data-bg-node-id="${chart.id}-s${index}" points="${series.values.map((v, i) => point(i, v! / max).map(n).join(",")).join(" ")}" fill="${color(index)}" fill-opacity=".12" stroke="${color(index)}" stroke-width="2.5">${title(series.name)}</polygon>`; series.values.forEach((v, i) => { const p = point(i, v! / max); marks += `<circle cx="${n(p[0]!)}" cy="${n(p[1]!)}" r="4" fill="${color(index)}">${title(tooltip(`${series.name} · ${chart.categories[i]}`, v))}</circle>`; }); });
    } else if (chart.type === "pie") {
      const total = chart.series[0]!.values.reduce<number>((sum, value) => sum + value!, 0), radius = Math.min(w * .33, (bottom - top) * .43), cx = w / 2, cy = (top + bottom) / 2;
      let angle = -Math.PI / 2;
      if (!total) marks += label(cx, cy, "표시할 값이 없습니다 (합계 0)");
      chart.series[0]!.values.forEach((value, i) => {
        if (!value || !total) return;
        const span = value / total * Math.PI * 2, end = angle + span, tip = title(`${tooltip(chart.categories[i]!, value)} · ${fmt(value / total * 100)}%`);
        marks += span >= Math.PI * 2 - 1e-10 ? `<circle cx="${cx}" cy="${cy}" r="${n(radius)}" fill="${color(i)}">${tip}</circle>` : `<path data-bg-node-id="${chart.id}-v${i}" d="M${cx},${cy}L${n(cx + Math.cos(angle) * radius)},${n(cy + Math.sin(angle) * radius)}A${n(radius)},${n(radius)} 0 ${span > Math.PI ? 1 : 0} 1 ${n(cx + Math.cos(end) * radius)},${n(cy + Math.sin(end) * radius)}Z" fill="${color(i)}" stroke="var(--bg-chart-background)" stroke-width="2">${tip}</path>`;
        if (span > .38) marks += label(cx + Math.cos(angle + span / 2) * radius * .68, cy + Math.sin(angle + span / 2) * radius * .68, `${Math.round(value / total * 100)}%`, "middle", 'fill="white" stroke="#182230" stroke-width="3" paint-order="stroke"');
        angle = end;
      });
    } else {
      const radius = Math.min(w * .32, (bottom - top) * .43), cx = w / 2, cy = (top + bottom) / 2, size = radius / (chart.categories.length + 2);
      chart.series[0]!.values.forEach((value, i) => {
        const r = radius - size * i, circumference = 2 * Math.PI * r;
        marks += `<circle cx="${cx}" cy="${cy}" r="${n(r)}" fill="none" stroke="currentColor" opacity=".1" stroke-width="${n(size * .62)}"/>`;
        marks += `<circle data-bg-node-id="${chart.id}-v${i}" cx="${cx}" cy="${cy}" r="${n(r)}" fill="none" stroke="${color(i)}" stroke-width="${n(size * .62)}" stroke-dasharray="${n(circumference * value! / chart.radial_max)} ${n(circumference)}" transform="rotate(-90 ${cx} ${cy})">${title(`${tooltip(chart.categories[i]!, value)} / ${fmt(chart.radial_max)}${chart.unit}`)}</circle>`;
      });
      marks += label(cx, cy + font / 3, `목표 ${fmt(chart.radial_max)}${chart.unit}`);
    }
    const items = ["pie", "radial"].includes(chart.type) ? chart.categories.map((name, i) => `${name} · ${fmt(chart.series[0]!.values[i]!)}${chart.unit}`) : chart.series.map(series => series.name);
    legend = `<div style="display:flex;flex-wrap:wrap;gap:8px 20px;font-size:14px;margin:8px 0">${items.map((item, i) => `<span><span aria-hidden="true" style="display:inline-block;width:10px;height:10px;margin-right:7px;background:${color(i)};border-radius:2px"></span>${escape(item)}</span>`).join("")}</div>`;
  }
  const bg = chart.theme === "midnight" ? "#101b2b" : chart.theme === "paper" ? "#f7f8fa" : "#ffffff", fg = chart.theme === "midnight" ? "#e7edf8" : "#233044";
  const config = JSON.stringify(chart).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  return `<figure data-bg-chart="${chart.id}" data-bg-node-id="${chart.id}" style="margin:0;width:100%;min-width:0"><script type="application/json" data-bg-chart-config>${config}</script><div data-bg-chart-render style="--bg-chart-background:${bg};color:${fg};background:${bg};padding:24px;border-radius:12px;font-family:var(--font-body,system-ui,sans-serif)"><div role="heading" aria-level="3" style="font-size:20px;font-weight:700;line-height:1.4">${escape(chart.title)}</div>${chart.description ? `<p style="font-size:14px;line-height:1.5;opacity:.8">${escape(chart.description)}</p>` : ""}<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="${chart.id}-title ${chart.id}-desc" style="display:block;width:100%;height:auto;font-size:${font}px;fill:currentColor"><title id="${chart.id}-title">${escape(chart.title)}</title><desc id="${chart.id}-desc">${escape(chart.description || chart.title)}. ${escape(chart.type)}. 아래 데이터 표에서 모든 값을 확인할 수 있습니다.</desc>${marks}</svg>${legend}${chart.source ? `<p style="font-size:12px;opacity:.8">${escape(chart.source)}</p>` : ""}<details style="font-size:13px"><summary style="cursor:pointer">데이터 보기</summary><div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;text-align:left"><caption>${escape(chart.title)}${chart.unit ? ` · ${escape(chart.unit)}` : ""}</caption><thead><tr>${heading.map(value => `<th scope="col" style="padding:8px;border-bottom:1px solid currentColor">${escape(value)}</th>`).join("")}</tr></thead><tbody>${tableRows.map(row => `<tr>${row.map((value, i) => `<${i ? "td" : 'th scope="row"'} style="padding:8px;border-bottom:1px solid #8884">${escape(value)}</${i ? "td" : "th"}>`).join("")}</tr>`).join("")}</tbody></table></div></details></div></figure>`;
}

function renderSankey(chart: SankeyChart, draw: { left: number; right: number; top: number; bottom: number; color: (i: number) => string; label: (x: number, y: number, value: string, anchor?: string) => string; title: (value: string) => string; tooltip: (name: string, value: number) => string }): string {
  const { left, right, top, bottom, color, label, title, tooltip } = draw, levels = sankeyLevels(chart), last = Math.max(...levels.values());
  const values = new Map(chart.nodes.map(node => [node.id, { incoming: chart.links.filter(link => link.target === node.id).reduce((sum, link) => sum + link.value, 0), outgoing: chart.links.filter(link => link.source === node.id).reduce((sum, link) => sum + link.value, 0) }]));
  const columns = Array.from({ length: last + 1 }, (_, level) => chart.nodes.filter(node => levels.get(node.id) === level));
  const gap = Math.min(24, (bottom - top) / 32);
  const scale = Math.min(...columns.filter(column => column.length).map(column => (bottom - top - gap * (column.length - 1)) / column.reduce((sum, node) => sum + Math.max(values.get(node.id)!.incoming, values.get(node.id)!.outgoing), 0)));
  const positions = new Map<string, { x: number; y: number; h: number; input: number; output: number }>();
  columns.forEach((column, level) => {
    const height = column.reduce((sum, node) => sum + Math.max(values.get(node.id)!.incoming, values.get(node.id)!.outgoing) * scale, 0) + gap * (column.length - 1);
    let y = top + (bottom - top - height) / 2;
    column.forEach(node => { const flow = values.get(node.id)!, h = Math.max(flow.incoming, flow.outgoing) * scale; positions.set(node.id, { x: left + (right - left - 18) * level / last, y, h, input: 0, output: 0 }); y += h + gap; });
  });
  let output = "";
  chart.links.forEach((link, i) => {
    const source = positions.get(link.source)!, target = positions.get(link.target)!, thickness = link.value * scale, x1 = source.x + 18, x2 = target.x, y1 = source.y + source.output + thickness / 2, y2 = target.y + target.input + thickness / 2, mid = (x1 + x2) / 2;
    output += `<path data-bg-node-id="${chart.id}-link${i}" d="M${n(x1)},${n(y1)}C${n(mid)},${n(y1)} ${n(mid)},${n(y2)} ${n(x2)},${n(y2)}" fill="none" stroke="${color(chart.nodes.findIndex(node => node.id === link.source))}" stroke-width="${n(thickness)}" opacity=".38">${title(tooltip(`${chart.nodes.find(node => node.id === link.source)!.label} → ${chart.nodes.find(node => node.id === link.target)!.label}`, link.value))}</path>`;
    source.output += thickness; target.input += thickness;
  });
  chart.nodes.forEach((node, i) => {
    const p = positions.get(node.id)!, flow = values.get(node.id)!, end = levels.get(node.id) === last;
    output += `<rect data-bg-node-id="${chart.id}-${node.id}" x="${n(p.x)}" y="${n(p.y)}" width="18" height="${n(p.h)}" rx="3" fill="${color(i)}">${title(`${node.label} · 유입 ${fmt(flow.incoming)} / 유출 ${fmt(flow.outgoing)}${chart.unit}`)}</rect>`;
    output += label(end ? p.x - 8 : p.x + 26, p.y + p.h / 2, short(node.label, 14), end ? "end" : "start");
  });
  return output;
}
