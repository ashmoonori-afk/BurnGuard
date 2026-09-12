import { describe, expect, test } from "bun:test";
import { ApiError } from "../src/api/client";
import {
  COMPOSER_ATTACHMENT_LIMITS,
  COMPOSER_SUPPORTED_EXTENSIONS,
  planAttachmentIntake,
  readyAttachmentSources,
  resolveSendOutcome,
  type IntakeItem,
} from "../src/components/chat/attachment-intake";
// The backend owns the truth about which sources its extractor can process.
// Importing it here pins the composer mirror to that authority at test time;
// the composer itself must not import backend code into the browser bundle.
import { inferAttachmentKind } from "../../backend/src/services/upload-kind";

function file(name: string, type = "", sizeBytes = 8): File {
  const value = new File([new Uint8Array(Math.min(sizeBytes, 1024))], name, { type });
  if (sizeBytes > 1024) Object.defineProperty(value, "size", { value: sizeBytes });
  return value;
}

function ready(name: string, sizeBytes = 8): IntakeItem {
  return { id: crypto.randomUUID(), status: "ready", file: file(name, "application/pdf", sizeBytes), role: "ordinary_content" };
}

describe("composer attachment intake", () => {
  test("Given an empty queue When a supported source is added Then it is queued ready for send", () => {
    const items = planAttachmentIntake([], [file("deck.pdf", "application/pdf")]);

    expect(items).toMatchObject([{ status: "ready" }]);
    expect(readyAttachmentSources(items).map((entry) => entry.file.name)).toEqual(["deck.pdf"]);
  });

  test("Given an empty queue When a source kind the extractor cannot process is added Then it is rejected as unsupported and never queued for send", () => {
    const items = planAttachmentIntake([], [file("archive.zip", "application/zip")]);

    expect(items).toMatchObject([{ status: "rejected", reason: "unsupported_kind" }]);
    expect(readyAttachmentSources(items)).toEqual([]);
  });

  test("Given backend-supported text formats When attached Then all remain ready for send", () => {
    const items = planAttachmentIntake([], [
      new File(["Notes"], "notes.txt", { type: "text/plain" }),
      new File(["# Brief"], "brief.md", { type: "text/markdown" }),
      new File(["name,value\nA,1"], "data.csv", { type: "text/csv" }),
    ]);
    expect(readyAttachmentSources(items).map((entry) => entry.file.name)).toEqual(["notes.txt", "brief.md", "data.csv"]);
  });

  test("Given the queue is already at the backend count limit When one more supported source is added Then it is rejected without disturbing the queued files", () => {
    const current = Array.from({ length: COMPOSER_ATTACHMENT_LIMITS.maxCount }, (_, i) => ready(`deck-${i}.pdf`));

    const items = planAttachmentIntake(current, [file("extra.pdf", "application/pdf")]);

    expect(items).toHaveLength(COMPOSER_ATTACHMENT_LIMITS.maxCount + 1);
    expect(items.at(-1)).toMatchObject({ status: "rejected", reason: "count_exceeded" });
    expect(readyAttachmentSources(items)).toHaveLength(COMPOSER_ATTACHMENT_LIMITS.maxCount);
  });

  test("Given a file past the backend per-file limit When it is added Then it is rejected as too large", () => {
    const items = planAttachmentIntake([], [file("huge.pdf", "application/pdf", COMPOSER_ATTACHMENT_LIMITS.maxBytesPerFile + 1)]);

    expect(items).toMatchObject([{ status: "rejected", reason: "too_large" }]);
    expect(readyAttachmentSources(items)).toEqual([]);
  });

  test("Given queued files near the backend total limit When another supported file would cross it Then it is rejected on total size", () => {
    const megabyte = 1024 * 1024;
    const current = [ready("a.pdf", 9 * megabyte), ready("b.pdf", 9 * megabyte)];

    const items = planAttachmentIntake(current, [file("c.pdf", "application/pdf", 9 * megabyte)]);

    expect(items.at(-1)).toMatchObject({ status: "rejected", reason: "total_exceeded" });
    expect(readyAttachmentSources(items).map((entry) => entry.file.name)).toEqual(["a.pdf", "b.pdf"]);
  });

  test("Given the backend extractor's supported kinds When the composer screens the same names Then the composer mirror matches the backend verdict", () => {
    const probes = ["deck.pdf", "deck.PDF", "slides.pptx", "notes.txt", "brief.MD", "data.csv", "photo.png", "archive.zip", "noextension"];

    const composerVerdicts = probes.map((name) => readyAttachmentSources(planAttachmentIntake([], [file(name)])).length === 1);
    const backendVerdicts = probes.map((name) => inferAttachmentKind(name) !== null);

    expect(composerVerdicts).toEqual(backendVerdicts);
    expect([...COMPOSER_SUPPORTED_EXTENSIONS]).toEqual([".pdf", ".pptx", ".docx", ".png", ".jpg", ".jpeg", ".webp", ".txt", ".md", ".csv"]);
  });
});

describe("composer send outcome", () => {
  test("Given a request aborted by the user When the outcome is resolved Then it reports cancellation rather than failure", () => {
    expect(resolveSendOutcome(new DOMException("aborted", "AbortError"))).toMatchObject({ kind: "cancelled" });
  });

  test("Given a typed backend rejection When the outcome is resolved Then it carries the backend error code for retry", () => {
    const outcome = resolveSendOutcome(new ApiError("unsupported_file_kind", "Unsupported source kind", 415, { files: ["notes.txt"] }));

    expect(outcome).toMatchObject({ kind: "failed", code: "unsupported_file_kind" });
  });

  test("Given an untyped transport failure When the outcome is resolved Then it still resolves to a retryable failure", () => {
    expect(resolveSendOutcome(new Error("boom"))).toMatchObject({ kind: "failed", code: "unknown" });
  });
});
