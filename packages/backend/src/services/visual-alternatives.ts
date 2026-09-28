import type { Database } from "bun:sqlite";
import { rm } from "node:fs/promises";
import { ulid } from "ulid";
import type {
  CreateVisualAlternativesRequest,
  VisualAlternativeList,
} from "@bg/shared";
import {
  createVisualAlternativeGeneration,
  failVisualAlternative,
  finishVisualAlternativeGeneration,
  markVisualAlternativeReady,
  recordVisualAlternativeBase,
  startVisualAlternative,
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
  allowVisualAlternativeMutation,
  cancelVisualAlternativeProject,
  finishVisualAlternativeOperation,
} from "./visual-alternative-operation-registry";
import { admitVisualAlternativeBatch } from "./turns";
import { acquireArtifactProjectLock } from "./artifact-project-lock";
import { removeGenerationEntry } from "./visual-alternative-cleanup";
import {
  holdVisualAlternativeProject,
  recoverProjectVisualAlternatives,
} from "./visual-alternative-recovery";

import {
  VisualAlternativeServiceError,
  type VisualAlternativeTurnInput,
} from "./visual-alternative-types";

export { VisualAlternativeServiceError } from "./visual-alternative-types";
export type { VisualAlternativeTurnInput } from "./visual-alternative-types";

type VisualAlternativeDependencies = {
  readonly runTurn?: (input: VisualAlternativeTurnInput) => Promise<void>;
  readonly materializeBase?: typeof materializeManagedTree;
  readonly restoreBase?: typeof restoreVisualAlternativeBase;
  readonly now?: () => number;
  readonly id?: () => string;
};

type GenerateInput = {
  readonly projectId: string;
  readonly sessionId: string;
  readonly projectDir: string;
  readonly entrypoint: string;
  readonly maxConcurrentTurns: number;
  readonly request: CreateVisualAlternativesRequest;
};

type PlannedAlternative = {
  readonly id: string;
  readonly name: string;
  readonly operationId: string;
};

type Batch = {
  readonly input: GenerateInput;
  readonly generationId: string;
  readonly basePath: string;
  readonly baseDigest: string;
  readonly alternatives: readonly PlannedAlternative[];
  readonly signal: AbortSignal;
};

export class VisualAlternativeService {
  private readonly runTurn: (input: VisualAlternativeTurnInput) => Promise<void>;
  private readonly materializeBase: typeof materializeManagedTree;
  private readonly restoreBase: typeof restoreVisualAlternativeBase;
  private readonly now: () => number;
  private readonly id: () => string;

  constructor(
    private readonly db: Database,
    dependencies: VisualAlternativeDependencies = {},
  ) {
    this.runTurn = dependencies.runTurn ?? runVisualAlternativeTurn;
    this.materializeBase = dependencies.materializeBase ?? materializeManagedTree;
    this.restoreBase = dependencies.restoreBase ?? restoreVisualAlternativeBase;
    this.now = dependencies.now ?? Date.now;
    this.id = dependencies.id ?? ulid;
  }

  async generate(input: GenerateInput): Promise<{
    readonly state: VisualAlternativeList;
    readonly completion: Promise<VisualAlternativeList>;
  }> {
    const generationId = assertSafeName(this.id());
    const admission = admitVisualAlternativeBatch(
      input.sessionId,
      input.projectId,
      generationId,
      input.maxConcurrentTurns,
    );
    if (admission === "capacity_exhausted") {
      throw new VisualAlternativeServiceError("capacity_exhausted");
    }
    if (admission === "session_busy") {
      throw new VisualAlternativeServiceError("generation_active");
    }
    let ownsGeneration = false;
    try {
      // The lease is installed; under the project lock, no operation admitted before it may still commit.
      const releaseLock = await acquireArtifactProjectLock(this.db, input.projectId);
      try {
        const active = this.db.query<{ readonly id: string }, [string]>(
          "SELECT id FROM artifact_operations WHERE project_id=? AND status IN ('pending','working','recovering') LIMIT 1",
        ).get(input.projectId);
        if (active !== null) throw new VisualAlternativeServiceError("generation_active");
      } finally {
        releaseLock();
      }
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
      const alternatives = input.request.names.map((name) => ({
        id: assertSafeName(this.id()),
        name,
        operationId: assertSafeName(this.id()),
      }));
      for (const alternative of alternatives) {
        allowVisualAlternativeMutation(input.sessionId, generationId, alternative.operationId);
      }
      try {
        // The durable owner row exists before any base bytes are staged.
        createVisualAlternativeGeneration(this.db, {
          generationId,
          projectId: input.projectId,
          baseRevision: base.revision,
          baseDigest: base.digest,
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
      ownsGeneration = true;
      const baseManifest = await this.materializeBase(input.projectDir, basePath);
      if (baseManifest.tree_digest !== base.digest) {
        throw new VisualAlternativeServiceError("generation_active");
      }
      recordVisualAlternativeBase(
        this.db,
        generationId,
        JSON.stringify(baseManifest),
        this.now(),
      );
      const state = requiredVisualAlternatives(this.db, input.projectId);
      const completion = this.runBatch({
        input,
        generationId,
        basePath,
        baseDigest: base.digest,
        alternatives,
        signal: admission.signal,
      });
      return { state, completion };
    } catch (error) {
      if (ownsGeneration) {
        finishVisualAlternativeGeneration(this.db, generationId, this.now());
        await removeGenerationTree(input.projectDir, generationId);
      }
      finishVisualAlternativeOperation(input.sessionId, generationId);
      throw error;
    }
  }

  /** Stops a live batch, or retries recovery of a quarantined one. */
  async cancel(projectId: string): Promise<"cancelled" | "recovered" | "recovery_pending" | "not_active"> {
    if (cancelVisualAlternativeProject(projectId)) return "cancelled";
    return recoverProjectVisualAlternatives(this.db, projectId, {
      restoreBase: this.restoreBase,
      now: this.now,
    });
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
    removeVisualAlternative(this.db, projectId, alternativeId, this.now());
  }

  private async runBatch(batch: Batch): Promise<VisualAlternativeList> {
    const { input, generationId } = batch;
    const restored = await this.runItems(batch);
    if (!restored) {
      // The durable 'generating' row now quarantines every artifact mutation of the project, and its
      // sessions are held; cancel (or the next startup) retries recovery and releases both on success.
      finishVisualAlternativeOperation(input.sessionId, generationId);
      holdVisualAlternativeProject(this.db, input.projectId);
      console.warn("[alternatives] base restore failed; project quarantined for recovery", generationId);
      return requiredVisualAlternatives(this.db, input.projectId);
    }
    try {
      finishVisualAlternativeGeneration(this.db, generationId, this.now());
    } finally {
      finishVisualAlternativeOperation(input.sessionId, generationId);
    }
    await removeGenerationTree(input.projectDir, generationId);
    return requiredVisualAlternatives(this.db, input.projectId);
  }

  /** Runs items until done or cancelled; returns false when the base tree could not be restored. */
  private async runItems(batch: Batch): Promise<boolean> {
    const { input } = batch;
    for (const [ordinal, alternative] of batch.alternatives.entries()) {
      if (batch.signal.aborted) return true;
      startVisualAlternative(this.db, alternative.id, this.now());
      try {
        await this.runTurn({
          sessionId: input.sessionId,
          operationId: alternative.operationId,
          ordinal,
          count: batch.alternatives.length,
          name: alternative.name,
          prompt: input.request.prompt,
          entrypoint: input.entrypoint,
          signal: batch.signal,
        });
        if (batch.signal.aborted) {
          throw new VisualAlternativeServiceError("operation_not_active");
        }
        const saved = await visualAlternativeStage(this.db, input.projectDir, {
          projectId: input.projectId,
          operationId: alternative.operationId,
          baseDigest: batch.baseDigest,
        });
        markVisualAlternativeReady(this.db, {
          id: alternative.id,
          projectId: input.projectId,
          operationId: alternative.operationId,
          resultRevision: saved.revision,
          resultDigest: saved.digest,
          now: this.now(),
        });
      } catch {
        failVisualAlternative(this.db, alternative.id, this.now());
      }
      if (!(await this.tryRestore(batch))) return false;
    }
    return true;
  }

  private async tryRestore(batch: Batch): Promise<boolean> {
    const producedBy = new Set(batch.alternatives.map((alternative) => alternative.operationId));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const operationId = assertSafeName(this.id());
      allowVisualAlternativeMutation(batch.input.sessionId, batch.generationId, operationId);
      try {
        await this.restoreBase(
          this.db,
          batch.input.projectId,
          batch.input.projectDir,
          batch.basePath,
          { producedBy, operationId },
        );
        return true;
      } catch (error) {
        if (attempt === 1) {
          console.warn("[alternatives] base restore attempt failed", error instanceof Error ? error.name : "unknown");
        }
      }
    }
    return false;
  }
}

async function removeGenerationTree(projectDir: string, generationId: string): Promise<void> {
  try {
    await removeGenerationEntry(projectDir, generationId);
  } catch {
    // Startup recovery removes trees that no generating row owns.
    console.warn("[alternatives] deferred base tree cleanup");
  }
}
