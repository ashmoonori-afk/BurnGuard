import type { Database } from "bun:sqlite";
import { ulid } from "ulid";
import type {
  CreateVisualAlternativesRequest,
  VisualAlternativeList,
} from "@bg/shared";
import {
  createVisualAlternativeGeneration,
  finishVisualAlternativeGeneration,
  latestVisualAlternatives,
  retainVisualAlternativeOperation,
  transitionVisualAlternative,
  VisualAlternativeRepositoryError,
} from "../db/visual-alternative-repository";
import { assertSafeName, resolveWithin } from "../security/path-boundary";
import { ArtifactCoordinator } from "./artifact-coordinator";
import { materializeManagedTree } from "./artifact-tree-storage";
import { visualAlternativeStage } from "./visual-alternative-storage";
import {
  requiredVisualAlternatives,
  restoreVisualAlternativeBase,
  runVisualAlternativeTurn,
  visualAlternativeProjectIdentity,
} from "./visual-alternative-generation";
import {
  listVisualAlternatives,
  promoteVisualAlternative,
  removeVisualAlternative,
} from "./visual-alternative-actions";
import {
  beginVisualAlternativeOperation,
  finishVisualAlternativeOperation,
} from "./visual-alternative-operation-registry";
import { isUserTurnRunning } from "./turns";

import {
  VisualAlternativeServiceError,
  type VisualAlternativeTurnInput,
} from "./visual-alternative-types";

export { VisualAlternativeServiceError } from "./visual-alternative-types";
export type { VisualAlternativeTurnInput } from "./visual-alternative-types";

type VisualAlternativeDependencies = {
  readonly runTurn?: (input: VisualAlternativeTurnInput) => Promise<void>;
  readonly now?: () => number;
  readonly id?: () => string;
};

type GenerateInput = {
  readonly projectId: string;
  readonly sessionId: string;
  readonly projectDir: string;
  readonly entrypoint: string;
  readonly request: CreateVisualAlternativesRequest;
};

export class VisualAlternativeService {
  private readonly runTurn: (input: VisualAlternativeTurnInput) => Promise<void>;
  private readonly now: () => number;
  private readonly id: () => string;

  constructor(
    private readonly db: Database,
    dependencies: VisualAlternativeDependencies = {},
  ) {
    this.runTurn = dependencies.runTurn ?? runVisualAlternativeTurn;
    this.now = dependencies.now ?? Date.now;
    this.id = dependencies.id ?? ulid;
  }

  async generate(input: GenerateInput): Promise<{
    readonly state: VisualAlternativeList;
    readonly completion: Promise<VisualAlternativeList>;
  }> {
    const generationId = assertSafeName(this.id());
    if (
      isUserTurnRunning(input.sessionId) ||
      !beginVisualAlternativeOperation(input.sessionId, generationId)
    ) {
      throw new VisualAlternativeServiceError("generation_active");
    }
    try {
      const coordinator = new ArtifactCoordinator(this.db);
      await coordinator.initialize(input.projectId, input.projectDir);
      const base = visualAlternativeProjectIdentity(this.db, input.projectId);
      const basePath = resolveWithin(
        input.projectDir,
        ".meta",
        "visual-alternatives",
        generationId,
        "base",
      );
      const baseManifest = await materializeManagedTree(input.projectDir, basePath);
      if (baseManifest.tree_digest !== base.digest) {
        throw new VisualAlternativeServiceError("generation_active");
      }
      const alternatives = input.request.names.map((name) => ({
        id: assertSafeName(this.id()),
        name,
        operationId: assertSafeName(this.id()),
      }));
      try {
        createVisualAlternativeGeneration(this.db, {
          generationId,
          projectId: input.projectId,
          baseRevision: base.revision,
          baseDigest: base.digest,
          baseManifestJson: JSON.stringify(baseManifest),
          basePath,
          alternatives,
          now: this.now(),
        });
      } catch (error) {
        if (
          error instanceof VisualAlternativeRepositoryError &&
          error.code === "generation_active"
        ) {
          throw new VisualAlternativeServiceError("generation_active");
        }
        throw error;
      }
      const state = requiredVisualAlternatives(this.db, input.projectId);
      const completion = this.runGeneration(
        input,
        generationId,
        basePath,
        alternatives,
      ).finally(() => finishVisualAlternativeOperation(input.sessionId, generationId));
      return { state, completion };
    } catch (error) {
      finishVisualAlternativeOperation(input.sessionId, generationId);
      throw error;
    }
  }

  list(projectId: string): VisualAlternativeList | null {
    return listVisualAlternatives(this.db, projectId);
  }

  async promote(input: {
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
    return promoteVisualAlternative({ db: this.db, ...input });
  }

  delete(projectId: string, alternativeId: string): void {
    removeVisualAlternative(this.db, projectId, alternativeId);
  }

  private async runGeneration(
    input: GenerateInput,
    generationId: string,
    basePath: string,
    alternatives: readonly {
      readonly id: string;
      readonly name: string;
      readonly operationId: string;
    }[],
  ): Promise<VisualAlternativeList> {
    for (const [ordinal, alternative] of alternatives.entries()) {
      transitionVisualAlternative(this.db, {
        id: alternative.id,
        from: "pending",
        to: "generating",
        now: this.now(),
      });
      try {
        await this.runTurn({
          sessionId: input.sessionId,
          operationId: alternative.operationId,
          ordinal,
          count: alternatives.length,
          name: alternative.name,
          prompt: input.request.prompt,
          entrypoint: input.entrypoint,
        });
        const saved = await visualAlternativeStage(
          this.db,
          input.projectDir,
          alternative.operationId,
        );
        transitionVisualAlternative(this.db, {
          id: alternative.id,
          from: "generating",
          to: "ready",
          resultRevision: saved.revision,
          resultDigest: saved.digest,
          now: this.now(),
        });
        retainVisualAlternativeOperation(this.db, alternative.operationId);
      } catch {
        transitionVisualAlternative(this.db, {
          id: alternative.id,
          from: "generating",
          to: "failed",
          now: this.now(),
        });
      } finally {
        await restoreVisualAlternativeBase(
          this.db,
          input.projectId,
          input.projectDir,
          basePath,
        );
      }
    }
    const current = requiredVisualAlternatives(this.db, input.projectId);
    const currentGeneration = current.alternatives.filter(
      (alternative) => alternative.generation_id === generationId,
    ).length;
    const ready = current.alternatives.filter(
      (alternative) =>
        alternative.generation_id === generationId &&
        alternative.status === "ready",
    ).length;
    const status = ready === currentGeneration
      ? "ready"
      : ready === 0
        ? "failed"
        : "partial";
    finishVisualAlternativeGeneration(
      this.db,
      generationId,
      status,
      this.now(),
    );
    return requiredVisualAlternatives(this.db, input.projectId);
  }
}
