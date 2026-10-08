import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BACKEND_IDS, type BackendDetectionResult } from "@bg/shared";
import { DetectionList } from "../src/components/errors/CliMissingModal";
import BackendSelector from "../src/components/settings/BackendSelector";
import { BACKEND_INSTALL_URLS, BACKEND_LABELS, BACKEND_PROBE_COMMANDS, backendProbeState } from "../src/lib/backend-display";
import { t } from "../src/i18n/t";

test("Given every backend missing When the CLI detection rows render Then each row carries the product display name rather than its raw id", () => {
  const detection: BackendDetectionResult = {
    backends: BACKEND_IDS.map((id) => ({ id, found: false, install_hint: `Install from https://example.test/${id}` })),
  };

  const html = renderToStaticMarkup(createElement(DetectionList, { detection }));

  for (const id of BACKEND_IDS) expect(html).toContain(BACKEND_LABELS[id]);
  expect(html).not.toContain(">gemini<");
  expect(html).not.toContain(">copilot<");
  expect(html).not.toContain(">claude code<");
  expect(html).not.toContain("capitalize");
});

test("Given found, probe-failed and missing backends When classified Then each maps to its own state", () => {
  expect(backendProbeState({ found: true })).toBe("ready");
  expect(backendProbeState({ found: true, probe_failed: true })).toBe("probe_failed");
  expect(backendProbeState({ found: false })).toBe("missing");
});

test("Given a found CLI whose probe failed When the detection row renders Then it shows the probe-failed message and install link, not the installed label", () => {
  const detection: BackendDetectionResult = { backends: [{ id: "claude-code", found: true, probe_failed: true, binary_path: "/x/claude" }] };

  const html = renderToStaticMarkup(createElement(DetectionList, { detection }));

  expect(html).toContain('data-probe-state="probe_failed"');
  expect(html).toContain(t("errors.probeFailed", { command: BACKEND_PROBE_COMMANDS["claude-code"] }));
  expect(html).toContain(BACKEND_INSTALL_URLS["claude-code"]);
  expect(html).not.toContain(t("errors.installed", { version: t("errors.healthy") }));
});

test("Given a verified CLI When the detection row renders Then it is ready with no install link", () => {
  const detection: BackendDetectionResult = { backends: [{ id: "codex", found: true, version: "1.2.3" }] };

  const html = renderToStaticMarkup(createElement(DetectionList, { detection }));

  expect(html).toContain('data-probe-state="ready"');
  expect(html).not.toContain(BACKEND_INSTALL_URLS.codex);
});

test("Given a probe-failed CLI When the backend selector renders Then it is the third state and offers the install link", () => {
  const detection: BackendDetectionResult = { backends: [{ id: "gemini", found: true, probe_failed: true }, { id: "copilot", found: false, install_hint: "ignored" }] };

  const html = renderToStaticMarkup(createElement(BackendSelector, { value: "codex", onChange: () => {}, detection }));

  expect(html).toContain('data-probe-state="probe_failed"');
  expect(html).toContain('data-probe-state="missing"');
  expect(html).toContain(t("settings.backendProbeFailed", { command: BACKEND_PROBE_COMMANDS.gemini }));
  expect(html).toContain(BACKEND_INSTALL_URLS.gemini);
  expect(html).toContain(BACKEND_INSTALL_URLS.copilot);
  expect(html).not.toContain(t("settings.backendInstalled"));
});
