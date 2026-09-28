import type { Database } from "bun:sqlite";
import type { VisualAlternativeList } from "@bg/shared";
import {
  deleteVisualAlternative,
  getVisualAlternative,
  latestVisualAlternatives,
  releaseVisualAlternativeOperation,
  VisualAlternativeRepositoryError,
} from "../db/visual-alternative-repository";
import { ArtifactCoordinator } from "./artifact-coordinator";
import { materializeManagedTree } from "./artifact-tree-storage";
import { visualAlternativeStage } from "./visual-alternative-storage";
import { VisualAlternativeServiceError } from "./visual-alternative-types";

export function listVisualAlternatives(
  db: Database,
  projectId: string,
): VisualAlternativeList | null {
  return latestVisualAlternatives(db, projectId);
}

export async function promoteVisualAlternative(input: {
  readonly db: Database;
  readonly projectId: string;
  readonly projectDir: string;
  readonly alternativeId: string;
  readonly expectedRevision: number;
  readonly expectedDigest: string;
}): Promise<{
  readonly operationId: string;
  readonly resultRevision: number;
  readonly resultDigest: string;
}> {
  const alternative = getVisualAlternative(
    input.db,
    input.projectId,
    input.alternativeId,
  );
  if (alternative === null) {
    throw new VisualAlternativeServiceError("alternative_not_found");
  }
  if (alternative.status !== "ready") {
    throw new VisualAlternativeServiceError("alternative_not_ready");
  }
  const saved = await visualAlternativeStage(
    input.db,
    input.projectDir,
    alternative.operation_id,
  );
  const result = await new ArtifactCoordinator(input.db).run({
    projectId: input.projectId,
    projectDir: input.projectDir,
    kind: "restore",
    expectedRevision: input.expectedRevision,
    expectedArtifactDigest: input.expectedDigest,
    mutate: async (stage) => {
      await materializeManagedTree(saved.path, stage);
    },
  });
  return {
    operationId: result.id,
    resultRevision: result.resultRevision,
    resultDigest: result.resultDigest,
  };
}

export function removeVisualAlternative(
  db: Database,
  projectId: string,
  alternativeId: string,
): void {
  try {
    const operationId = deleteVisualAlternative(db, projectId, alternativeId);
    releaseVisualAlternativeOperation(db, operationId);
  } catch (error) {
    if (error instanceof VisualAlternativeRepositoryError) {
      switch (error.code) {
        case "alternative_not_found":
          throw new VisualAlternativeServiceError("alternative_not_found");
        case "generation_active":
        case "invalid_transition":
          throw new VisualAlternativeServiceError("generation_active");
        case "alternative_not_ready":
        case "corrupt_visual_alternative":
          throw new VisualAlternativeServiceError("alternative_not_ready");
      }
    }
    throw error;
  }
}
