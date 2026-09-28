import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  failVisualAlternative,
  finishVisualAlternativeGeneration,
  markVisualAlternativeReady,
  repairVisualAlternativeRetention,
} from "../db/visual-alternative-repository";
import { projectsDir, resolveManagedPath } from "../lib/paths";
import { PathBoundaryError, resolveWithin } from "../security/path-boundary";
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
    projectDir = resolveManagedPath(dependencies.root, text(row.dir_path));
  } catch (error) {
    if (!(error instanceof PathBoundaryError)) throw error;
    // Never touch files outside managed storage; settle the rows only.
    finishVisualAlternativeGeneration(db, generationId, dependencies.now());
    return true;
  }
  const generationPath = resolveWithin(projectDir, ".meta", "visual-alternatives", generationId);
  const basePath = resolveWithin(projectDir, ".meta", "visual-alternatives", generationId, "base");
  let baseDigest: string;
  try {
    baseDigest = digest(row.base_digest);
    if (path.resolve(text(row.base_path)) !== basePath) throw new CorruptVisualAlternative();
    if (row.base_manifest_json === null) {
      // Crashed while staging the base: the project tree was never changed.
      finishVisualAlternativeGeneration(db, generationId, dependencies.now());
      await rm(generationPath, { recursive: true, force: true });
      return true;
    }
    const manifest = parseCanonicalTreeManifest(parseJson(row.base_manifest_json));
    if (manifest.tree_digest !== baseDigest) throw new CorruptVisualAlternative();
    await validateCanonicalTree(basePath, manifest);
  } catch (error) {
    if (error instanceof PathBoundaryError) throw error;
    console.warn("[alternatives] corrupt generation base; generation failed", generationId);
    finishVisualAlternativeGeneration(db, generationId, dependencies.now());
    return true;
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
  try {
    await dependencies.restoreBase(db, projectId, projectDir, basePath);
  } catch {
    const sessions = db.query<{ readonly id: string }, [string]>(
      "SELECT id FROM sessions WHERE project_id=?",
    ).all(projectId);
    // Keep the generation durable and its sessions held until a later startup restores the base.
    holdSessionsForRecovery(sessions.map((session) => session.id));
    console.warn("[alternatives] base restore deferred; sessions held", generationId);
    return false;
  }
  finishVisualAlternativeGeneration(db, generationId, dependencies.now());
  await rm(generationPath, { recursive: true, force: true });
  return true;
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
    let container: string;
    try {
      container = resolveWithin(
        resolveManagedPath(root, project.dir_path),
        ".meta",
        "visual-alternatives",
      );
    } catch (error) {
      if (error instanceof PathBoundaryError) continue;
      throw error;
    }
    if (!existsSync(container)) continue;
    for (const entry of await readdir(container, { withFileTypes: true })) {
      if (owned.has(entry.name)) continue;
      await rm(resolveWithin(container, entry.name), { recursive: true, force: true });
    }
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
