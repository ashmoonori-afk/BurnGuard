import type { Database } from "bun:sqlite";
import path from "node:path";
import {
  finishVisualAlternativeGeneration,
  retainVisualAlternativeOperation,
  transitionVisualAlternative,
} from "../db/visual-alternative-repository";
import { resolveWithin } from "../security/path-boundary";
import {
  parseCanonicalTreeManifest,
  validateCanonicalTree,
} from "./canonical-tree-manifest";
import { restoreVisualAlternativeBase } from "./visual-alternative-generation";
import { visualAlternativeStage } from "./visual-alternative-storage";

type GenerationRecoveryRow = {
  readonly id: unknown;
  readonly project_id: unknown;
  readonly dir_path: unknown;
  readonly base_manifest_json: unknown;
  readonly base_path: unknown;
};

type AlternativeRecoveryRow = {
  readonly id: unknown;
  readonly status: unknown;
  readonly operation_id: unknown;
};

export async function recoverVisualAlternatives(db: Database): Promise<number> {
  const generations = db.query<GenerationRecoveryRow, []>(
    `SELECT g.id,g.project_id,p.dir_path,g.base_manifest_json,g.base_path
      FROM visual_alternative_generations g
      JOIN projects p ON p.id=g.project_id
      WHERE g.status='generating'
      ORDER BY g.created_at,g.id`,
  ).all();
  for (const generation of generations) {
    await recoverGeneration(db, generation);
  }
  return generations.length;
}

async function recoverGeneration(
  db: Database,
  row: GenerationRecoveryRow,
): Promise<void> {
  const generationId = text(row.id);
  const projectId = text(row.project_id);
  const projectDir = text(row.dir_path);
  const basePath = path.resolve(text(row.base_path));
  const expectedBasePath = resolveWithin(
    projectDir,
    ".meta",
    "visual-alternatives",
    generationId,
    "base",
  );
  if (basePath !== expectedBasePath) {
    throw new Error("corrupt_visual_alternative");
  }
  const manifest = parseCanonicalTreeManifest(parseJson(row.base_manifest_json));
  await validateCanonicalTree(basePath, manifest);
  const alternatives = db.query<AlternativeRecoveryRow, [string]>(
    "SELECT id,status,operation_id FROM visual_alternatives WHERE generation_id=? ORDER BY ordinal",
  ).all(generationId);
  for (const alternative of alternatives) {
    if (
      alternative.status !== "pending" &&
      alternative.status !== "generating"
    ) {
      continue;
    }
    const id = text(alternative.id);
    const operationId = text(alternative.operation_id);
    try {
      const saved = await visualAlternativeStage(db, projectDir, operationId);
      transitionVisualAlternative(db, {
        id,
        from: alternative.status,
        to: "ready",
        resultRevision: saved.revision,
        resultDigest: saved.digest,
        now: Date.now(),
      });
      retainVisualAlternativeOperation(db, operationId);
    } catch {
      transitionVisualAlternative(db, {
        id,
        from: alternative.status,
        to: "failed",
        now: Date.now(),
      });
    }
  }
  await restoreVisualAlternativeBase(db, projectId, projectDir, basePath);
  const statuses = db.query<{ readonly status: string }, [string]>(
    "SELECT status FROM visual_alternatives WHERE generation_id=? ORDER BY ordinal",
  ).all(generationId);
  const ready = statuses.filter((item) => item.status === "ready").length;
  finishVisualAlternativeGeneration(
    db,
    generationId,
    ready === statuses.length ? "ready" : ready === 0 ? "failed" : "partial",
    Date.now(),
  );
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") throw new Error("corrupt_visual_alternative");
  try {
    return JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("corrupt_visual_alternative");
    }
    throw error;
  }
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("corrupt_visual_alternative");
  }
  return value;
}
