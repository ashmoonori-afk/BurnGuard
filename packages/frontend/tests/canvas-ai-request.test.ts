import { afterEach, beforeEach, expect, test } from "bun:test";
import { chartAiRequest, threeSceneAiRequest } from "../src/lib/canvas-ai-request";
import { useLocaleStore } from "../src/i18n/locale";

const original = useLocaleStore.getState().locale;
beforeEach(() => useLocaleStore.setState({ locale: "en" }));
afterEach(() => useLocaleStore.setState({ locale: original }));

test("Given the en locale When the chart AI request is built Then it carries the file, the chart id, the machine tokens and the user's request without Hangul", () => {
  const text = chartAiRequest("index.html", "chart_1", "  make it a line chart ");

  expect(text).toContain('"index.html"');
  expect(text).toContain('"chart_1"');
  expect(text).toContain("data-bg-chart-config");
  expect(text).toContain("ChartV1");
  expect(text.endsWith("\nmake it a line chart")).toBe(true);
  expect(text).not.toMatch(/\p{Script=Hangul}/u);
});

test("Given the en locale When the 3D scene AI request is built Then it carries the file, the machine tokens and the user's request without Hangul", () => {
  const text = threeSceneAiRequest("index.html", "add a red cube");

  expect(text).toContain('"index.html"');
  expect(text).toContain("data-bg-three");
  expect(text).toContain("ThreeSceneV1");
  expect(text.endsWith("\nadd a red cube")).toBe(true);
  expect(text).not.toMatch(/\p{Script=Hangul}/u);
});

test("Given the ko locale When the request templates are built Then the file and chart identities stay JSON-quoted exactly as before", () => {
  useLocaleStore.setState({ locale: "ko" });
  expect(chartAiRequest("a b.html", "chart_1", "x")).toContain('파일 "a b.html"의 차트 "chart_1"를');
  expect(threeSceneAiRequest("a b.html", "x")).toContain('파일 "a b.html"의 data-bg-three');
});
