import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  compareViewport,
  readyCompareAlternatives,
} from "../src/lib/visual-alternative-compare";
import type { VisualAlternativeSummary } from "@bg/shared";

function alternative(
  id: string,
  status: VisualAlternativeSummary["status"],
): VisualAlternativeSummary {
  return {
    id,
    project_id: "project-1",
    generation_id: "generation-1",
    name: id,
    status,
    source_revision: 2,
    source_digest: "a".repeat(64),
    result_revision: status === "ready" ? 3 : null,
    result_digest: status === "ready" ? "b".repeat(64) : null,
    operation_id: `operation-${id}`,
    entrypoint_url: status === "ready"
      ? `/api/projects/project-1/alternatives/${id}/fs/index.html`
      : null,
    created_at: 1,
    updated_at: 2,
  };
}

describe("visual alternative compare", () => {
  test("Given mixed lifecycle entries When compare candidates are derived Then only ready revisions remain in persisted order", () => {
    // Given
    const entries = [
      alternative("quiet", "ready"),
      alternative("broken", "failed"),
      alternative("editorial", "ready"),
      { ...alternative("older", "ready"), generation_id: "generation-0" },
    ];

    // When
    const candidates = readyCompareAlternatives(entries);

    // Then
    expect(candidates.map((item) => item.id)).toEqual(["quiet", "editorial", "older"]);
    expect(readyCompareAlternatives(entries, "generation-1").map((item) => item.id)).toEqual(["quiet", "editorial"]);
  });

  test("Given desktop and mobile choices When viewport geometry is resolved Then every card receives the same bounded dimensions", () => {
    // Given / When
    const desktop = compareViewport("desktop");
    const mobile = compareViewport("mobile");

    // Then
    expect(desktop).toEqual({ width: 1280, height: 720 });
    expect(mobile).toEqual({ width: 390, height: 844 });
    expect(compareViewport("desktop")).toEqual(desktop);
  });

  test("Given the compare component When sandbox policy is inspected Then every artifact frame stays opaque-origin", async () => {
    // Given
    const source = await readFile(
      new URL("../src/components/alternatives/AlternativeFrame.tsx", import.meta.url),
      "utf8",
    );

    // When
    const policies = [...source.matchAll(/sandbox="([^"]+)"/g)]
      .map((match) => match[1]);

    // Then
    expect(policies).toEqual(["allow-scripts"]);
    expect(source).not.toContain("allow-same-origin");
  });
});
