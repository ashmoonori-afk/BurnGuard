import { t, type MessageKey } from "@/i18n/t";
import { parseChart, renderChart } from "@bg/shared";

// The shared chart validator currently returns prose rather than error codes.
// Adapt only its known validation messages; never display arbitrary exception text.
const VALIDATION_COPY: Record<string, MessageKey> = {
  "지원하지 않는 차트 설정입니다.": "canvas.chart.validation.settings",
  "항목·계열 이름에는 탭이나 줄바꿈을 넣을 수 없어요.": "canvas.chart.validation.label",
  "차트 ID 형식을 확인해 주세요.": "canvas.chart.validation.id",
  "지원하지 않는 차트 종류입니다.": "canvas.chart.validation.type",
  "지원하지 않는 차트 테마입니다.": "canvas.chart.validation.theme",
  "색상은 6자리 HEX로 입력해 주세요.": "canvas.chart.validation.color",
  "노드 ID가 중복됩니다.": "canvas.chart.validation.duplicateNode",
  "흐름의 연결 노드나 중복 연결을 확인해 주세요.": "canvas.chart.validation.links",
  "연결되지 않은 노드를 확인해 주세요.": "canvas.chart.validation.disconnected",
  "계열 표현 방식을 확인해 주세요.": "canvas.chart.validation.seriesKind",
  "복합 차트에는 계열별 표현 방식이 필요해요.": "canvas.chart.validation.composed",
  "목표값은 모든 데이터 값 이상이어야 해요.": "canvas.chart.validation.target",
  "Sankey 차트는 순환 연결을 지원하지 않아요.": "canvas.chart.validation.cycles",
  "차트 파일 정보를 확인할 수 없어요.": "canvas.chart.validation.file",
  "차트 ID가 중복됩니다.": "canvas.chart.validation.duplicateChart",
};

export function chartValidationCopy(error: unknown): string {
  if (!(error instanceof Error)) return t("canvas.chart.invalidData");
  const key = VALIDATION_COPY[error.message];
  if (key) return t(key);
  const text = /^텍스트를 (\d+)자 이내로 입력해 주세요\.$/.exec(error.message);
  if (text) return t("canvas.chart.validation.textLength", { max: Number(text[1]) });
  const number = /^숫자는 (.+)부터 (.+)까지 입력할 수 있어요\.$/.exec(error.message);
  if (number) return t("canvas.chart.validation.numberRange", { min: Number(number[1]), max: Number(number[2]) });
  const list = /^항목 수는 (\d+)–(\d+)개여야 해요\.$/.exec(error.message);
  if (list) return t("canvas.chart.validation.itemCount", { min: Number(list[1]), max: Number(list[2]) });
  return t("canvas.chart.invalidData");
}

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
      root.replaceChildren(doc.createTextNode(t("canvas.chart.pendingData")));
    }
  }
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
