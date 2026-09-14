import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseExampleReviewReceipt, promotionRejections, validateExampleEvidence, REQUIRED_EXAMPLE_CHECKS, TASK_PRESET_AUDIT_POLICY } from "../../../scripts/qa/task-preset-evidence";
import { REVIEWED_TASK_EXAMPLES, MAX_REVIEWED_EXAMPLE_CHARS } from "../src/harness/task-preset-examples";
import { TASK_PRESET_REGISTRY } from "../src/harness/prompt-task-presets";
import { selectTaskPreset } from "../src/harness/prompt-model-context";
import { resolveWithin } from "../src/security/path-boundary";

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
      audit_policy_version: TASK_PRESET_AUDIT_POLICY,
      audit_object_sha256: sha("audit"),
      observations_sha256: sha("observations"),
      screenshots_sha256: [sha("shot")],
      mandatory: REQUIRED_EXAMPLE_CHECKS.prototype.map((check_id) => ({ check_id, status: "pass", evidence_sha256: sha(check_id) })),
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
    (receipt.validation as Record<string, unknown>).mandatory = REQUIRED_EXAMPLE_CHECKS.prototype.map((check_id) => ({
      check_id, status: check_id === "dimensions" ? status : "pass", evidence_sha256: sha(check_id),
    }));
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

test("Given the shipped corpus When CI checks it Then every entry has matching reviewed evidence bytes", async () => {
  expect(TASK_PRESET_REGISTRY.examples).toBe(REVIEWED_TASK_EXAMPLES);
  const root = fileURLToPath(new URL("../../../doc/evidence/task-presets/examples/", import.meta.url));
  for (const route of ["codex/native", "claude-code/native", "claude-code/commandcode"] as const) {
    const routeRegistry = TASK_PRESET_REGISTRY.routes[route];
    for (const [preset_id, entries] of Object.entries(REVIEWED_TASK_EXAMPLES[route] ?? {})) {
      const model = Object.entries(routeRegistry.models).find(([, preset]) => preset.id === preset_id)?.[0];
      expect(model !== undefined || routeRegistry.fallback.id === preset_id).toBe(true);
      for (const deliverable of ["prototype", "slide_deck", "graphic", "diagram", "generic"] as const) {
        const example = entries[deliverable];
        if (!example) continue;
        expect(example.text.length).toBeLessThanOrEqual(MAX_REVIEWED_EXAMPLE_CHARS);
        expect(example.reviewEvidenceId).toMatch(/^ex-[0-9a-f]{64}$/u);
        const receipt: unknown = JSON.parse(await readFile(resolveWithin(root, `${example.reviewEvidenceId}.json`), "utf8"));
        expect(await validateExampleEvidence(example, { route, preset_id, deliverable }, receipt,
          (digest) => readFile(resolveWithin(root, "objects", digest)))).toEqual([]);
        const selected = selectTaskPreset(route === "codex/native" ? "codex" : "claude-code", {
          model: model ?? "unregistered-review-fixture", effort: "low", vanilla: false,
          provider: route === "claude-code/commandcode" ? "commandcode" : "native",
        }, deliverable, { ...TASK_PRESET_REGISTRY, adoptions: {}, developmentExamplesEnabled: true });
        expect(selected.example).toEqual(example);
      }
    }
  }
});

test("Given a review policy When checks are missing duplicated unknown or unsupported Then promotion fails", () => {
  for (const deliverable of ["prototype", "slide_deck", "graphic"] as const) {
    const receipt = completeReceipt();
    const validation = receipt.validation as Record<string, unknown>;
    (receipt.target as Record<string, unknown>).deliverable = deliverable;
    const mandatory = REQUIRED_EXAMPLE_CHECKS[deliverable].map((check_id) => ({ check_id, status: "pass", evidence_sha256: sha(check_id) }));
    validation.mandatory = mandatory;
    expect(promotionRejections(receipt)).toEqual([]);
    for (const missing of mandatory) {
      validation.mandatory = mandatory.filter((check) => check !== missing);
      expect(promotionRejections(receipt)).toContain(`validation.mandatory.${missing.check_id}: missing`);
    }
    validation.mandatory = [...mandatory, mandatory[0]];
    expect(promotionRejections(receipt)).toContain("validation.mandatory: duplicate check");
    validation.mandatory = [...mandatory, { check_id: "unrelated-check", status: "pass", evidence_sha256: sha("x") }];
    expect(promotionRejections(receipt)).toContain("validation.mandatory: unknown check");
    validation.mandatory = mandatory;
    validation.screenshots_sha256 = [];
    expect(promotionRejections(receipt)).toContain("validation.screenshots_sha256: missing visual evidence");
    validation.screenshots_sha256 = [sha("shot")];
    validation.audit_policy_version = "future-policy";
    expect(promotionRejections(receipt)).toContain("validation.audit_policy_version: unsupported");
  }
  const receipt = completeReceipt();
  (receipt.target as Record<string, unknown>).deliverable = "generic";
  expect(promotionRejections(receipt)).toContain("target.deliverable: unsupported policy");
});

test("Given a corpus entry When validating its receipt Then identities content and referenced bytes must match", async () => {
  const receipt = completeReceipt();
  const example = { id: "example-prototype-01", text: "example text", reviewEvidenceId: `ex-${sha("case")}` };
  const target = { route: "codex/native", preset_id: "codex/native/gpt-5.6-luna/v1", deliverable: "prototype" };
  const objects = new Map(["tree", "archive", "audit", "observations", "shot", ...REQUIRED_EXAMPLE_CHECKS.prototype]
    .map((text) => [sha(text), Buffer.from(text)]));
  const readObject = async (digest: string) => {
    const bytes = objects.get(digest);
    if (!bytes) throw new Error("fixture_object_missing");
    return bytes;
  };
  expect(await validateExampleEvidence(example, target, receipt, readObject)).toEqual([]);
  for (const changed of [{ ...example, text: "changed" }, { ...example, id: "wrong" }, { ...example, reviewEvidenceId: `ex-${sha("wrong")}` }]) {
    expect((await validateExampleEvidence(changed, target, receipt, readObject)).length).toBeGreaterThan(0);
  }
  for (const changed of [{ ...target, route: "claude-code/native" }, { ...target, preset_id: "wrong" }, { ...target, deliverable: "graphic" }]) {
    expect(await validateExampleEvidence(example, changed, receipt, readObject)).toContain("example.target: mismatch");
  }
  expect(await validateExampleEvidence(example, target, receipt, async () => { throw new Error("missing"); }))
    .toContain("evidence_object: unavailable");
  expect(await validateExampleEvidence(example, target, receipt, async () => Buffer.from("tampered")))
    .toContain("evidence_object: digest mismatch");
});
