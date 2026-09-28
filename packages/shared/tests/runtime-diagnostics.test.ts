import { expect, test } from "bun:test";
import { parseRuntimeDiagnostics } from "../src/runtime-diagnostics";

const VALID_DIAGNOSTICS = {
  checked_at: 1_700_000_000_000,
  backends: [
    {
      id: "codex",
      cli: { status: "detected", version: "1.2.3" },
      capabilities: ["text_generation", "file_edits", "tool_events", "usage", "image_generation"],
      prompt_transport: "stdin",
      model_catalog: {
        source: "codex_cache",
        fetched_at: 1_699_999_000_000,
      },
    },
  ],
  recent_failures: [
    {
      project_id: "project-1",
      project_name: "Launch page",
      session_id: "session-1",
      backend_id: "codex",
      turn_id: "turn-1",
      failed_at: 1_700_000_000_000,
      stage: "publication",
      code: "publication_failed",
      can_resume: true,
    },
  ],
};

test("Given a runtime diagnostics payload When parsed Then finite machine fields survive", () => {
  const parsed = parseRuntimeDiagnostics(VALID_DIAGNOSTICS);

  expect(parsed.backends[0]).toEqual(VALID_DIAGNOSTICS.backends[0]);
  expect(parsed.recent_failures[0]).toEqual(VALID_DIAGNOSTICS.recent_failures[0]);
});

test("Given provider-native or private fields When parsed Then the payload is rejected", () => {
  const unsafeBackend = structuredClone(VALID_DIAGNOSTICS);
  const backend = unsafeBackend.backends[0];
  if (backend === undefined) throw new Error("Missing backend fixture");
  Object.assign(backend, { binary_path: "/Users/private/bin/codex" });
  const unsafeFailure = structuredClone(VALID_DIAGNOSTICS);
  const failure = unsafeFailure.recent_failures[0];
  if (failure === undefined) throw new Error("Missing failure fixture");
  Object.assign(failure, { message: "token=private" });

  expect(() => parseRuntimeDiagnostics(unsafeBackend)).toThrow("runtime_diagnostics_invalid");
  expect(() => parseRuntimeDiagnostics(unsafeFailure)).toThrow("runtime_diagnostics_invalid");
});
