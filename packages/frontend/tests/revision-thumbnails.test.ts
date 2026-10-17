import { describe, expect, test } from "bun:test";
import type { ArtifactHistoryEntry, ArtifactHistoryV1 } from "@bg/shared";
import { comparisonThumbnailUrls, revisionThumbnailUrls } from "../src/components/canvas/revision-thumbnail-source";
import { resolveThumbnailSource } from "../src/components/home/thumbnail-source";

const entry = (revision: number, operationId: string, available = true): ArtifactHistoryEntry => ({
  revision, operation_id: operationId, available, created_at: 1, kind: "turn", files: ["index.html"],
});
const history: ArtifactHistoryV1 = {
  schema_version: 1, current_revision: 4, current_digest: "d".repeat(64), undo_operation_id: "edit-four",
  entries: [entry(3, "edit-four"), entry(2, "edit-three"), entry(1, "edit-two")],
  external_captures: [], review_failed_drafts: [],
  latest_comparison: { schema_version: 1, comparison: "source", base_digest: "c".repeat(64), result_digest: "d".repeat(64), scope: { mode: "image_only" }, findings: [], pages: [] },
};

describe("revision thumbnail selection", () => {
  test("Given a retained revision, When URLs are selected, Then both sides name that operation rather than the live thumbnail", () => {
    const urls = revisionThumbnailUrls("project one", entry(2, "edit/three"));
    expect(urls).toEqual({
      before: "/api/projects/project%20one/thumbnail?operation=edit%2Fthree&side=before",
      after: "/api/projects/project%20one/thumbnail?operation=edit%2Fthree&side=after",
    });
  });

  test("Given unordered retained revisions, When the current comparison is selected, Then it uses the operation that produced the current revision", () => {
    const urls = comparisonThumbnailUrls("p", { ...history, entries: [...history.entries].reverse() });
    expect(urls).toEqual(revisionThumbnailUrls("p", entry(3, "edit-four")));
  });

  test("Given missing or unavailable retained content, When URLs are selected, Then neither side substitutes current artwork", () => {
    expect(revisionThumbnailUrls("p", undefined)).toEqual({ before: null, after: null });
    expect(revisionThumbnailUrls("p", entry(2, "expired", false))).toEqual({ before: null, after: null });
    expect(comparisonThumbnailUrls("p", { ...history, entries: [] })).toEqual({ before: null, after: null });
  });

  test("Given a refused edit, When the comparison is selected, Then committed artwork is not shown as its result", () => {
    const comparison = history.latest_comparison;
    if (!comparison) throw new Error("Fixture requires a comparison");
    const refused = { ...history, scope_violation: { operation_id: "refused", comparison } };
    expect(comparisonThumbnailUrls("p", refused)).toEqual({ before: null, after: null });
  });

  test("Given a failed thumbnail URL, When another revision is selected, Then the existing source resolver permits its different URL", () => {
    const first = revisionThumbnailUrls("p", entry(1, "first"));
    const second = revisionThumbnailUrls("p", entry(2, "second"));
    expect(resolveThumbnailSource(first.before, first.before)).toBeNull();
    expect(resolveThumbnailSource(second.before, first.before)).toBe(second.before);
    expect(resolveThumbnailSource(null, null)).toBeNull();
  });
});
