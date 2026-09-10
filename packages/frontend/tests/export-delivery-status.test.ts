import { describe, expect, test } from "bun:test";
import type {
  ExportAttempt,
  ExportFinding,
  ExportJob,
  ExportProgressStage,
} from "@bg/shared";
import {
  PACKAGE_PUBLISH_NOTE,
  PACKAGE_READY_LABEL,
  exportDeliveryStage,
  platformFindings,
} from "../src/components/export/export-delivery";
import { platformFixRequest } from "../src/lib/platform-fix-request";

function attempt(overrides: Partial<ExportAttempt> = {}): ExportAttempt {
  return {
    id: "attempt-1",
    job_id: "job-1",
    parent_attempt_id: null,
    status: "running",
    project_revision: 3,
    project_digest: "digest",
    digests: { options: "o", input_closure: null, design_system: null, renderer: "r", capture: "c", output: null, receipt: null },
    progress: { stage: "rendering", completed: 2, total: 6 },
    stop_reason: null,
    findings: [],
    retention: { retained_until: 0, output_available: false },
    cancel_requested_at: null,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

function job(overrides: Partial<ExportJob> = {}): ExportJob {
  return {
    id: "job-1",
    project_id: "project-1",
    format: "cafe24_package",
    status: "running",
    output_path: null,
    error_message: null,
    size_bytes: null,
    options: {},
    latest_attempt: attempt(),
    created_at: 0,
    completed_at: null,
    ...overrides,
  };
}

describe("delivery stage", () => {
  test.each([
    ["queued", "saving"],
    ["snapshotting", "saving"],
    ["rendering", "rendering"],
    ["validating", "validating"],
    ["publishing", "validating"],
    ["complete", "ready"],
  ] as const)(
    "Given a running attempt at a progress stage When the delivery stage is derived Then the user-facing stage follows it",
    (stage: ExportProgressStage, expected: string) => {
      const completed = stage === "complete" ? 6 : ["queued", "snapshotting", "rendering", "validating", "publishing", "complete"].indexOf(stage);
      expect(exportDeliveryStage(job({ latest_attempt: attempt({ progress: { stage, completed, total: 6 } }) }))).toBe(expected);
    },
  );

  test("Given a failed attempt When the delivery stage is derived Then it reports failure regardless of progress", () => {
    expect(exportDeliveryStage(job({
      status: "failed",
      latest_attempt: attempt({ status: "failed", stop_reason: "validation_failed", progress: { stage: "validating", completed: 3, total: 6 } }),
    }))).toBe("failure");
  });

  test("Given a job with no attempt yet When the delivery stage is derived Then the job status carries it", () => {
    expect(exportDeliveryStage(job({ status: "pending", latest_attempt: null }))).toBe("saving");
    expect(exportDeliveryStage(job({ status: "succeeded", latest_attempt: null }))).toBe("ready");
  });
});

describe("package delivery copy", () => {
  test("Given a ready package When labelled Then downloaded is never stated as published", () => {
    expect(PACKAGE_READY_LABEL).toBe("패키지 다운로드됨");
    expect(PACKAGE_READY_LABEL).not.toContain("게시");
    expect(PACKAGE_PUBLISH_NOTE).toContain("게시");
  });
});

describe("platform lint findings", () => {
  const findings: readonly ExportFinding[] = [
    { code: "imweb_image_needs_hosting", path: "pages/about.html" },
    { code: "unresolved_link", path: "pages/contact.html" },
    { code: "some_new_backend_code", path: null },
  ];

  test("Given attempt findings When modeled Then each carries a severity, a page, and a readable message", () => {
    const modeled = platformFindings(job({ latest_attempt: attempt({ status: "failed", stop_reason: "validation_failed", findings }) }));

    expect(modeled.map((finding) => finding.page)).toEqual(["about.html", "contact.html", "전체"]);
    expect(modeled.map((finding) => finding.severity)).toEqual(["warning", "warning", "warning"]);
    expect(modeled[0]?.message).toContain("게시판");
    expect(modeled[2]?.message).toContain("some_new_backend_code");
  });

  test("Given a widget over the platform limit When modeled Then it is an error", () => {
    const modeled = platformFindings(job({
      latest_attempt: attempt({ status: "failed", stop_reason: "validation_failed", findings: [{ code: "imweb_widget_too_large", path: "pages/index.html" }] }),
    }));

    expect(modeled[0]?.severity).toBe("error");
  });

  test("Given no attempt When modeled Then nothing is reported", () => {
    expect(platformFindings(job({ latest_attempt: null }))).toEqual([]);
  });
});

describe("AI fix request for platform findings", () => {
  test("Given lint findings When a fix request is built Then it carries code, page, and message only", () => {
    const request = platformFixRequest(platformFindings(job({
      latest_attempt: attempt({
        status: "failed",
        stop_reason: "validation_failed",
        findings: [{ code: "unresolved_link", path: "pages/contact.html" }],
      }),
    })));

    if (request === null) throw new TypeError("expected a fix request");
    expect(request).toContain("unresolved_link");
    expect(request).toContain("contact.html");
    expect(request).not.toContain("job-1");
    expect(request).not.toContain("digest");
  });

  test("Given more findings than the bound When a fix request is built Then it stays bounded", () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ code: `code_${index}`, path: `pages/p${index}.html` }));
    const request = platformFixRequest(platformFindings(job({
      latest_attempt: attempt({ status: "failed", stop_reason: "validation_failed", findings: many }),
    })));

    if (request === null) throw new TypeError("expected a fix request");
    expect(request).toContain("code_19");
    expect(request).not.toContain("code_20");
  });

  test("Given no findings When a fix request is built Then there is nothing to send", () => {
    expect(platformFixRequest([])).toBeNull();
  });
});
