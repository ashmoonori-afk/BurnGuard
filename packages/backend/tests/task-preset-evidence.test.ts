import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { parseExampleReviewReceipt, promotionRejections } from "../../../scripts/qa/task-preset-evidence";
import { REVIEWED_TASK_EXAMPLES } from "../src/harness/task-preset-examples";
import { TASK_PRESET_REGISTRY } from "../src/harness/prompt-task-presets";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

/** A machine fixture that satisfies every promotion condition. No live model is involved. */
function completeReceipt(): Record<string, unknown> {
  return {
    schema_version: 1,
    evidence_id: `ex-${sha("case")}`,
    case_id: "case-prototype-01",
    split: "development",
    source: {
      route: "codex/native",
      model: "gpt-6-astra",
      effort: "high",
      cli_version: "1.2.3",
      source_revision: "a".repeat(40),
      prompt_sha256: sha("prompt"),
      invocation_hashes: [sha("invocation")],
    },
    target: {
      route: "codex/native",
      preset_id: "codex/native/gpt-5.6-luna/v1",
      effort: "low",
      deliverable: "prototype",
    },
    example: { id: "example-prototype-01", text_sha256: sha("example text") },
    artifact: { tree_sha256: sha("tree"), archive_sha256: sha("archive"), object_id: "obj-1" },
    validation: {
      run_id: "run-1",
      terminal: "completed",
      audit_policy_version: "1",
      audit_object_sha256: sha("audit"),
      observations_sha256: sha("observations"),
      screenshots_sha256: [sha("shot")],
      mandatory: [{ check_id: "dimensions", status: "pass", evidence_sha256: sha("dimensions") }],
      human: { reviewer_id: "reviewer-1", verdict: "approved", reviewed_at: "2026-09-14T00:00:00.000Z", rubric_version: 1 },
    },
  };
}

test("Given a complete machine fixture When parsed Then it is accepted without a live model", () => {
  const parsed = parseExampleReviewReceipt(completeReceipt());
  expect(parsed.ok).toBe(true);
  expect(promotionRejections(completeReceipt())).toEqual([]);
});

test("Given a run that did not finish cleanly When parsed Then promotion is refused", () => {
  for (const terminal of ["failed", "cancelled", "skipped", "unmeasurable", "running"]) {
    const receipt = completeReceipt();
    (receipt.validation as Record<string, unknown>).terminal = terminal;
    expect(promotionRejections(receipt).length).toBeGreaterThan(0);
  }
});

test("Given a missing or unapproved human review When parsed Then promotion is refused", () => {
  const noHuman = completeReceipt();
  delete (noHuman.validation as Record<string, unknown>).human;
  expect(promotionRejections(noHuman).length).toBeGreaterThan(0);

  const rejected = completeReceipt();
  ((rejected.validation as Record<string, unknown>).human as Record<string, unknown>).verdict = "rejected";
  expect(promotionRejections(rejected).length).toBeGreaterThan(0);
});

test("Given a mandatory check that did not pass When parsed Then promotion is refused", () => {
  for (const status of ["fail", "skipped", "unmeasurable"]) {
    const receipt = completeReceipt();
    (receipt.validation as Record<string, unknown>).mandatory = [{ check_id: "dimensions", status, evidence_sha256: sha("d") }];
    expect(promotionRejections(receipt).length).toBeGreaterThan(0);
  }
  const empty = completeReceipt();
  (empty.validation as Record<string, unknown>).mandatory = [];
  expect(promotionRejections(empty).length).toBeGreaterThan(0);
});

test("Given malformed, unknown-key or non-holdout input When parsed Then it is rejected", () => {
  expect(parseExampleReviewReceipt(null).ok).toBe(false);
  expect(parseExampleReviewReceipt({}).ok).toBe(false);

  const extra = completeReceipt();
  extra.unexpected_key = "value";
  expect(parseExampleReviewReceipt(extra).ok).toBe(false);

  const holdout = completeReceipt();
  holdout.split = "holdout";
  expect(promotionRejections(holdout).length).toBeGreaterThan(0);

  const badHash = completeReceipt();
  (badHash.example as Record<string, unknown>).text_sha256 = "not-a-hash";
  expect(parseExampleReviewReceipt(badHash).ok).toBe(false);

  const missingCli = completeReceipt();
  delete (missingCli.source as Record<string, unknown>).cli_version;
  expect(parseExampleReviewReceipt(missingCli).ok).toBe(false);
});

test("Given a private path or credential in the receipt When parsed Then it is rejected", () => {
  for (const leak of ["C:/Users/someone/project", "/Users/someone/project", "\\\\host\\share", "sk-livesecrettoken"]) {
    const receipt = completeReceipt();
    (receipt.artifact as Record<string, unknown>).object_id = leak;
    expect(parseExampleReviewReceipt(receipt).ok).toBe(false);
  }
});

test("Given the shipped corpus When inspected Then it claims no unreviewed example", () => {
  // P1 ships no reviewed example yet; the machinery lands without pretending evidence exists.
  expect(REVIEWED_TASK_EXAMPLES).toEqual({});
  expect(TASK_PRESET_REGISTRY.examples).toEqual({});
});
