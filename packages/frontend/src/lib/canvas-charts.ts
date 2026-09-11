import { parseChart, renderChart } from "@bg/shared";

/** Render partial AI output as soon as its complete JSON arrives, inside the existing sandbox. */
export function hydrateCanvasCharts(html: string): string {
  if (!html.includes("data-bg-chart")) return html;
  const doc = new DOMParser().parseFromString(html, "text/html"), roots = [...doc.querySelectorAll("[data-bg-chart]")];
  const ids = new Set<string>();
  for (const root of roots) {
    try {
      if (roots.length > 32 || root.tagName !== "FIGURE" || root.querySelector("[data-bg-chart]")) throw new Error("invalid_chart");
      const configs = root.querySelectorAll('script[data-bg-chart-config][type="application/json"]');
      if (configs.length !== 1) throw new Error("incomplete_chart");
      const chart = parseChart(JSON.parse(configs[0]!.textContent ?? ""));
      if (root.getAttribute("data-bg-chart") !== chart.id || ids.has(chart.id)) throw new Error("invalid_chart_identity");
      ids.add(chart.id);
      const rendered = new DOMParser().parseFromString(renderChart(chart), "text/html").querySelector("figure")!;
      root.replaceChildren(...rendered.childNodes);
    } catch {
      root.replaceChildren(doc.createTextNode("차트 데이터를 확인하는 중이에요. 완성된 데이터가 저장되면 표시됩니다."));
    }
  }
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
