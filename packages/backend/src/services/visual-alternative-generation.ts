import type { Database } from "bun:sqlite";
import type { UserEvent, VisualAlternativeList } from "@bg/shared";
import { latestVisualAlternatives } from "../db/visual-alternative-repository";
import { ArtifactCoordinator } from "./artifact-coordinator";
import { materializeManagedTree } from "./artifact-tree-storage";
import { inspectCanonicalTree } from "./canonical-tree-manifest";
import { interruptUserTurn, startVisualAlternativeTurn } from "./turns";
import {
  VisualAlternativeServiceError,
  type VisualAlternativeTurnInput,
} from "./visual-alternative-types";

export async function runVisualAlternativeTurn(
  input: VisualAlternativeTurnInput,
): Promise<void> {
  if (input.signal.aborted) {
    throw new VisualAlternativeServiceError("operation_not_active");
  }
  const payload: Extract<UserEvent, { type: "user.message" }> = {
    type: "user.message",
    text: input.prompt,
    active_rel_path: input.entrypoint,
  };
  const modelText = `<burnguard_visual_alternative>${JSON.stringify({
    schema_version: 1,
    ordinal: input.ordinal,
    count: input.count,
    name: input.name,
  })}</burnguard_visual_alternative>\n${input.prompt}`;
  const started = startVisualAlternativeTurn(
    input.sessionId,
    payload,
    input.operationId,
    { modelText },
  );
  if (started === null) {
    throw new VisualAlternativeServiceError("session_busy");
  }
  const interrupt = () => {
    interruptUserTurn(input.sessionId);
  };
  input.signal.addEventListener("abort", interrupt, { once: true });
  try {
    await started.promise;
  } finally {
    input.signal.removeEventListener("abort", interrupt);
  }
}

export async function restoreVisualAlternativeBase(
  db: Database,
  projectId: string,
  projectDir: string,
  basePath: string,
  options: {
    /** Operations the batch committed; any other current revision is foreign and is never overwritten. */
    readonly producedBy: ReadonlySet<string>;
    readonly operationId?: string;
  },
): Promise<void> {
  const identity = visualAlternativeProjectIdentity(db, projectId);
  const coordinator = new ArtifactCoordinator(db);
  await coordinator.initialize(projectId, projectDir);
  const base = await inspectCanonicalTree(basePath);
  if (identity.digest === base.tree_digest) return;
  const producer = db.query<{ readonly id: string }, [string, number, string]>(
    "SELECT id FROM artifact_operations WHERE project_id=? AND status='committed' AND result_revision=? AND result_digest=?",
  ).get(projectId, identity.revision, identity.digest);
  if (producer === null || !options.producedBy.has(producer.id)) {
    throw new VisualAlternativeServiceError("base_diverged");
  }
  await coordinator.run({
    projectId,
    projectDir,
    operationId: options.operationId,
    kind: "restore",
    expectedRevision: identity.revision,
    expectedArtifactDigest: identity.digest,
    mutate: async (stage) => {
      await materializeManagedTree(basePath, stage);
    },
  });
}

export function visualAlternativeProjectIdentity(
  db: Database,
  projectId: string,
): { readonly revision: number; readonly digest: string } {
  const row = db.query<{
    readonly current_revision: number;
    readonly current_digest: string | null;
  }, [string]>(
    "SELECT current_revision,current_digest FROM projects WHERE id=?",
  ).get(projectId);
  if (row === null || row.current_digest === null) {
    throw new VisualAlternativeServiceError("project_not_found");
  }
  return { revision: row.current_revision, digest: row.current_digest };
}

export function requiredVisualAlternatives(
  db: Database,
  projectId: string,
): VisualAlternativeList {
  const state = latestVisualAlternatives(db, projectId);
  if (state === null) {
    throw new VisualAlternativeServiceError("project_not_found");
  }
  return state;
}
