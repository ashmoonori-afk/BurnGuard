import { afterEach, expect, mock, test } from "bun:test";
import type { ExportAttempt, ExportJob } from "@bg/shared";
import { exportJobState } from "../src/components/export/export-job-state";
import { readExportDownload, retryExport } from "../src/api/export";
import { ApiError, bootstrapApiAuthority } from "../src/api/client";

const attempt: ExportAttempt = { id: "attempt", job_id: "job", parent_attempt_id: null, status: "validated", project_revision: 1, project_digest: "digest", digests: { options: "options", input_closure: null, design_system: null, renderer: "renderer", capture: null, output: "output", receipt: "receipt" }, progress: { stage: "complete", completed: 6, total: 6 }, stop_reason: null, findings: [], retention: { retained_until: 1000, output_available: true }, cancel_requested_at: null, created_at: 1, updated_at: 1 };
const job: ExportJob = { id: "job", project_id: "project", format: "pdf", status: "succeeded", output_path: null, error_message: null, size_bytes: 4, options: { pdf_paper: "letter" }, latest_attempt: attempt, created_at: 1, completed_at: 2 };

test("Given cancelled corrupt expired exports When presenting actions Then unavailable files cannot be downloaded and remain retryable", () => {
  expect(exportJobState(job).canDownload).toBe(true);
  for (const status of ["cancelled", "corrupt", "expired"] as const) {
    const state = exportJobState({ ...job, latest_attempt: { ...attempt, status } });
    expect(state.canDownload).toBe(false);
    expect(state.canRetry).toBe(true);
  }
  expect(exportJobState({ ...job, status: "failed", latest_attempt: { ...attempt, status: "cancelled", stop_reason: "user_cancelled" } }).label).toBe("취소됨");
});

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
test("Given a failed letter-size export When retrying Then the existing job retry endpoint gets current artifact identity", async () => {
  let retryBody: unknown;
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/bootstrap") return Response.json({ data: { capability: "test" } });
    if (String(input) === "/api/projects/project") return Response.json({ data: { current_revision: 4, current_digest: "latest" } });
    expect(String(input)).toBe("/api/exports/job/retry");
    retryBody = JSON.parse(String(init?.body));
    return Response.json({ data: job });
  }) as typeof fetch;
  await bootstrapApiAuthority();
  await retryExport(job);
  expect(retryBody).toEqual({ project_revision: 4, project_digest: "latest" });
});

test("Given a download integrity failure When fetching Then the UI receives a typed failure instead of navigating to JSON", async () => {
  globalThis.fetch = mock(async (input: RequestInfo | URL) => String(input) === "/api/bootstrap"
    ? Response.json({ data: { capability: "test" } })
    : Response.json({ error: { code: "export_corrupt", message: "private-path" } }, { status: 410 })) as typeof fetch;
  await bootstrapApiAuthority();
  const error = await readExportDownload("job").catch((value: unknown) => value);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ code: "export_corrupt", status: 410 });
  expect(String(error)).not.toContain("private-path");
});
