import type { Database } from "bun:sqlite";
import path from "node:path";
import { ulid } from "ulid";
import {
  failVisualAlternative,
  finishVisualAlternativeGeneration,
  markVisualAlternativeReady,
  repairVisualAlternativeRetention,
} from "../db/visual-alternative-repository";
import { projectsDir, resolveManagedPath } from "../lib/paths";
import { assertSafeName, PathBoundaryError } from "../security/path-boundary";
import {
  realGenerationDirectory,
  removeGenerationEntry,
  removeUnownedGenerationEntries,
} from "./visual-alternative-cleanup";
import { allowVisualAlternativeRecovery } from "./visual-alternative-operation-registry";
import {
  parseCanonicalTreeManifest,
  validateCanonicalTree,
} from "./canonical-tree-manifest";
import { restoreVisualAlternativeBase } from "./visual-alternative-generation";
import { visualAlternativeStage } from "./visual-alternative-storage";
import { holdSessionsForRecovery } from "./turns";

type GenerationRecoveryRow = {
  readonly id: unknown;
  readonly project_id: unknown;
  readonly dir_path: unknown;
  readonly base_digest: unknown;
  readonly base_manifest_json: unknown;
  readonly base_path: unknown;
};

type AlternativeRecoveryRow = {
  readonly id: unknown;
  readonly status: unknown;
  readonly operation_id: unknown;
};

type RecoveryDependencies = {
  readonly root?: string;
  readonly restoreBase?: typeof restoreVisualAlternativeBase;
  readonly now?: () => number;
};

class CorruptVisualAlternative extends Error {
  readonly name = "CorruptVisualAlternative";
}

export type VisualAlternativeRecovery = {
  readonly recovered: number;
  readonly held: readonly string[];
};

export async function recoverVisualAlternatives(
  db: Database,
  dependencies: RecoveryDependencies = {},
): Promise<VisualAlternativeRecovery> {
  const root = dependencies.root ?? projectsDir;
  const now = dependencies.now ?? Date.now;
  const generations = db.query<GenerationRecoveryRow, []>(
    `SELECT g.id,g.project_id,p.dir_path,g.base_digest,g.base_manifest_json,g.base_path
      FROM visual_alternative_generations g
      JOIN projects p ON p.id=g.project_id
      WHERE g.status='generating'
      ORDER BY g.created_at,g.id`,
  ).all();
  const held: string[] = [];
  for (const generation of generations) {
    const converged = await recoverGeneration(db, generation, {
      root,
      restoreBase: dependencies.restoreBase ?? restoreVisualAlternativeBase,
      now,
    });
    if (!converged) held.push(text(generation.id));
  }
  await removeUnownedGenerationTrees(db, root);
  repairVisualAlternativeRetention(db, now());
  return { recovered: generations.length, held };
}

async function recoverGeneration(
  db: Database,
  row: GenerationRecoveryRow,
  dependencies: Required<RecoveryDependencies>,
): Promise<boolean> {
  const generationId = text(row.id);
  const projectId = text(row.project_id);
  let projectDir: string;
  try {
    assertSafeName(generationId);
    projectDir = resolveManagedPath(dependencies.root, text(row.dir_path));
  } catch (error) {
    if (!(error instanceof PathBoundaryError)) throw error;
    // Never derive paths from unsafe ids or touch files outside managed storage; settle the rows only.
    finishVisualAlternativeGeneration(db, generationId, dependencies.now());
    releaseVisualAlternativeProject(projectId);
    return true;
  }
  const basePath = path.join(projectDir, ".meta", "visual-alternatives", generationId, "base");
  let baseDigest: string;
  try {
    baseDigest = digest(row.base_digest);
    if (path.resolve(text(row.base_path)) !== basePath) throw new CorruptVisualAlternative();
    if (row.base_manifest_json === null) {
      // Crashed while staging the base: the project tree was never changed.
      finishVisualAlternativeGeneration(db, generationId, dependencies.now());
      await removeGenerationEntry(projectDir, generationId);
      return true;
    }
    // A symlinked container or generation entry is never followed.
    if (await realGenerationDirectory(projectDir, generationId) === null) throw new CorruptVisualAlternative();
    const manifest = parseCanonicalTreeManifest(parseJson(row.base_manifest_json));
    if (manifest.tree_digest !== baseDigest) throw new CorruptVisualAlternative();
    await validateCanonicalTree(basePath, manifest);
  } catch (error) {
    if (error instanceof PathBoundaryError) throw error;
    const current = db.query<{ readonly current_digest: string | null }, [string]>(
      "SELECT current_digest FROM projects WHERE id=?",
    ).get(projectId);
    if (current !== null && current.current_digest === row.base_digest) {
      // The project already holds the original base; only the staged copy is unusable.
      finishVisualAlternativeGeneration(db, generationId, dependencies.now());
      await removeGenerationEntry(projectDir, generationId);
      releaseVisualAlternativeProject(projectId);
      return true;
    }
    holdVisualAlternativeProject(db, projectId);
    console.warn("[alternatives] corrupt generation base; project quarantined", generationId);
    return false;
  }
  const alternatives = db.query<AlternativeRecoveryRow, [string, string]>(
    "SELECT id,status,operation_id FROM visual_alternatives WHERE generation_id=? AND project_id=? ORDER BY ordinal",
  ).all(generationId, projectId);
  for (const alternative of alternatives) {
    if (alternative.status !== "pending" && alternative.status !== "generating") {
      continue;
    }
    const id = text(alternative.id);
    const operationId = text(alternative.operation_id);
    try {
      const saved = await visualAlternativeStage(db, projectDir, {
        projectId,
        operationId,
        baseDigest,
      });
      markVisualAlternativeReady(db, {
        id,
        projectId,
        operationId,
        resultRevision: saved.revision,
        resultDigest: saved.digest,
        now: dependencies.now(),
      });
    } catch {
      failVisualAlternative(db, id, dependencies.now());
    }
  }
  const restoreOperationId = ulid();
  const disallow = allowVisualAlternativeRecovery(projectId, restoreOperationId);
  try {
    await dependencies.restoreBase(db, projectId, projectDir, basePath, {
      producedBy: new Set(alternatives.map((alternative) => text(alternative.operation_id))),
      operationId: restoreOperationId,
    });
  } catch {
    // The durable row keeps quarantining the project; cancel or the next startup retries.
    holdVisualAlternativeProject(db, projectId);
    console.warn("[alternatives] base restore deferred; project quarantined", generationId);
    return false;
  } finally {
    disallow();
  }
  finishVisualAlternativeGeneration(db, generationId, dependencies.now());
  await removeGenerationEntry(projectDir, generationId);
  releaseVisualAlternativeProject(projectId);
  return true;
}

const projectHolds = new Map<string, Map<string, () => void>>();

/** Holds every session of the project against new turns until its quarantine is resolved. */
export function holdVisualAlternativeProject(db: Database, projectId: string): void {
  const holds = projectHolds.get(projectId) ?? new Map<string, () => void>();
  projectHolds.set(projectId, holds);
  const sessions = db.query<{ readonly id: string }, [string]>(
    "SELECT id FROM sessions WHERE project_id=?",
  ).all(projectId);
  for (const session of sessions) {
    if (holds.has(session.id)) continue;
    const release = holdSessionsForRecovery([session.id]);
    if (release !== null) holds.set(session.id, release);
  }
}

function releaseVisualAlternativeProject(projectId: string): void {
  for (const release of projectHolds.get(projectId)?.values() ?? []) release();
  projectHolds.delete(projectId);
}

/** Retries recovery of the project's quarantined generation, if any. */
export async function recoverProjectVisualAlternatives(
  db: Database,
  projectId: string,
  dependencies: RecoveryDependencies = {},
): Promise<"recovered" | "recovery_pending" | "not_active"> {
  const rows = db.query<GenerationRecoveryRow, [string]>(
    `SELECT g.id,g.project_id,p.dir_path,g.base_digest,g.base_manifest_json,g.base_path
      FROM visual_alternative_generations g
      JOIN projects p ON p.id=g.project_id
      WHERE g.status='generating' AND g.project_id=?`,
  ).all(projectId);
  if (rows.length === 0) return "not_active";
  let converged = true;
  for (const row of rows) {
    converged = await recoverGeneration(db, row, {
      root: dependencies.root ?? projectsDir,
      restoreBase: dependencies.restoreBase ?? restoreVisualAlternativeBase,
      now: dependencies.now ?? Date.now,
    }) && converged;
  }
  return converged ? "recovered" : "recovery_pending";
}

async function removeUnownedGenerationTrees(db: Database, root: string): Promise<void> {
  const projects = db.query<{ readonly id: string; readonly dir_path: string }, []>(
    "SELECT id,dir_path FROM projects",
  ).all();
  const owned = new Set(
    db.query<{ readonly id: string }, []>(
      "SELECT id FROM visual_alternative_generations WHERE status='generating'",
    ).all().map((row) => row.id),
  );
  for (const project of projects) {
    let projectDir: string;
    try {
      projectDir = resolveManagedPath(root, project.dir_path);
    } catch (error) {
      if (error instanceof PathBoundaryError) continue;
      throw error;
    }
    await removeUnownedGenerationEntries(projectDir, owned);
  }
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") throw new CorruptVisualAlternative();
  try {
    return JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) throw new CorruptVisualAlternative();
    throw error;
  }
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CorruptVisualAlternative();
  }
  return value;
}

function digest(value: unknown): string {
  const result = text(value);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new CorruptVisualAlternative();
  return result;
}
