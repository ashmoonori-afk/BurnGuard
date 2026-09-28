import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RuntimeDiagnostics } from "@bg/shared";
import { RuntimeDiagnosticsPanel } from "../src/components/settings/RuntimeDiagnostics";

const diagnostics: RuntimeDiagnostics = {
  checked_at: 1_700_000_000_000,
  backends: [
    {
      id: "claude-code",
      cli: { status: "missing", version: null },
      capabilities: ["text_generation", "file_edits", "tool_events", "usage"],
      prompt_transport: "stdin",
      model_catalog: { source: "bundled", fetched_at: null },
    },
    {
      id: "codex",
      cli: { status: "detected", version: "1.2.3" },
      capabilities: ["text_generation", "file_edits", "tool_events", "usage", "image_generation"],
      prompt_transport: "stdin",
      model_catalog: { source: "codex_cache", fetched_at: 1_699_999_000_000 },
    },
  ],
  recent_failures: [
    {
      project_id: "project-ready",
      project_name: "Ready project",
      session_id: "session-ready",
      backend_id: "codex",
      turn_id: "turn-ready",
      failed_at: 1_700_000_000_000,
      stage: "publication",
      code: "publication_failed",
      can_resume: true,
    },
    {
      project_id: "project-blocked",
      project_name: "Blocked project",
      session_id: "session-blocked",
      backend_id: "claude-code",
      turn_id: "turn-blocked",
      failed_at: 1_699_999_000_000,
      stage: "generation",
      code: "turn_failed",
      can_resume: false,
    },
  ],
};

test("Given runtime diagnostics When rendered Then machine status, transport, capabilities and freshness remain inspectable", () => {
  const html = renderToStaticMarkup(createElement(RuntimeDiagnosticsPanel, {
    diagnostics,
    pending: false,
    error: null,
    resumingProjectId: null,
    resumedProjectId: null,
    onRefresh() {},
    onResume() {},
  }));

  expect(html).toContain('data-backend-id="codex"');
  expect(html).toContain('data-cli-status="detected"');
  expect(html).toContain('data-prompt-transport="stdin"');
  expect(html).toContain('data-capability="image_generation"');
  expect(html).toContain('data-model-source="codex_cache"');
  expect(html).not.toContain("binary_path");
});

test("Given recent failures When rendered Then only eligible projects expose resume and recovered projects expose navigation", () => {
  const html = renderToStaticMarkup(createElement(RuntimeDiagnosticsPanel, {
    diagnostics,
    pending: false,
    error: null,
    resumingProjectId: null,
    resumedProjectId: "project-ready",
    onRefresh() {},
    onResume() {},
  }));

  expect(html).toContain('data-resume-project-id="project-ready"');
  expect(html).not.toContain('data-resume-project-id="project-blocked"');
  expect(html).toContain('href="/projects/project-ready"');
  expect(html).toContain('data-failure-stage="publication"');
  expect(html).toContain('data-failure-code="publication_failed"');
});
