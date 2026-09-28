import { describe, expect, test } from "bun:test";
import {
  parseCreateVisualAlternativesRequest,
  parseVisualAlternativeList,
  UpgradeContractError,
} from "@bg/shared";

describe("visual alternative contracts", () => {
  test("Given a bounded request When parsed Then count prompt and names remain typed", () => {
    // Given
    const input = {
      count: 3,
      prompt: "Explore three calmer visual directions.",
      names: ["Quiet", "Editorial", "Dense"],
    };

    // When
    const parsed = parseCreateVisualAlternativesRequest(input);

    // Then
    expect(parsed).toEqual(input);
  });

  test("Given fewer than two or more than four alternatives When parsed Then the boundary rejects", () => {
    // Given
    const requests = [
      { count: 1, prompt: "Too few", names: ["Only"] },
      { count: 5, prompt: "Too many", names: ["A", "B", "C", "D", "E"] },
    ];

    // When / Then
    for (const request of requests) {
      expect(() => parseCreateVisualAlternativesRequest(request)).toThrow(UpgradeContractError);
    }
  });

  test("Given persisted alternatives When parsed Then machine identity and lifecycle fields survive", () => {
    // Given
    const digest = "a".repeat(64);
    const input = {
      schema_version: 1,
      project_id: "project-1",
      generation_id: "generation-1",
      status: "partial",
      alternatives: [
        {
          id: "alternative-1",
          project_id: "project-1",
          generation_id: "generation-1",
          name: "Quiet",
          status: "ready",
          source_revision: 4,
          source_digest: digest,
          result_revision: 5,
          result_digest: "b".repeat(64),
          operation_id: "operation-1",
          entrypoint_url: "/api/projects/project-1/alternatives/alternative-1/fs/index.html",
          created_at: 10,
          updated_at: 20,
        },
        {
          id: "alternative-2",
          project_id: "project-1",
          generation_id: "generation-1",
          name: "Editorial",
          status: "failed",
          source_revision: 4,
          source_digest: digest,
          result_revision: null,
          result_digest: null,
          operation_id: "operation-2",
          entrypoint_url: null,
          created_at: 11,
          updated_at: 21,
        },
      ],
      created_at: 10,
      updated_at: 21,
    };

    // When
    const parsed = parseVisualAlternativeList(input);

    // Then
    expect(parsed).toEqual(input);
  });

  test("Given retained alternatives from earlier generations When parsed Then more than four remain listable", () => {
    // Given
    const sourceDigest = "a".repeat(64);
    const alternatives = Array.from({ length: 5 }, (_, index) => ({
      id: `alternative-${index}`,
      project_id: "project-1",
      generation_id: index < 2 ? "generation-2" : "generation-1",
      name: `Direction ${index}`,
      status: "ready" as const,
      source_revision: index,
      source_digest: sourceDigest,
      result_revision: index + 1,
      result_digest: `${index + 1}`.repeat(64),
      operation_id: `operation-${index}`,
      entrypoint_url: `/api/projects/project-1/alternatives/alternative-${index}/fs/index.html`,
      created_at: index,
      updated_at: index,
    }));

    // When
    const parsed = parseVisualAlternativeList({
      schema_version: 1,
      project_id: "project-1",
      generation_id: "generation-2",
      status: "ready",
      alternatives,
      created_at: 5,
      updated_at: 5,
    });

    // Then
    expect(parsed.alternatives.map((item) => item.generation_id)).toEqual([
      "generation-2",
      "generation-2",
      "generation-1",
      "generation-1",
      "generation-1",
    ]);
  });
});
