import type { Database } from "bun:sqlite";
import { cp, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { ensureConfig } from "./config";
import {
  bundledDesignSystemId,
  bundledDesignSystems,
} from "./data/bundled-design-systems";
import { getDb, getSqlite } from "./db/client";
import { runMigrations } from "./db/migrate-local";
import { reconcilePipelineRows } from "./db/pipeline-repository";
import { seedCoreData } from "./db/seed";
import { seedTutorialsOnce } from "./db/seed-tutorials";
import { seedLearningItems } from "./services/learning-service";
import {
  appRootDir,
  cacheDir,
  dataDir,
  exportsDir,
  logsDir,
  projectsDir,
  resolveRepoRoot,
  systemsDir,
} from "./lib/paths";
import { pruneOldExports } from "./services/export-gc";
import { reconcileExtractionState } from "./services/extraction-recovery";
import { reconcileCatalogState } from "./services/catalog-lifecycle";
import { ensureAllProjectWatchers } from "./services/watchers";
import { reconcileArtifactState } from "./services/artifact-recovery";
import { reconcileProjectDeletions } from "./services/project-deletion";
import { pruneExpiredArtifactOperations } from "./services/artifact-retention";
import { reconcileExportState } from "./services/export-recovery";
import { createProductionResearchRecoveryDependencies } from "./routes/research";
import { reconcileResearchState, type ResearchRecoveryDependencies } from "./services/research-recovery";

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns true when a path inside the bundled sample DS source tree
 * is safe to copy into the runtime systems directory.
 *
 * Currently filters out `uploads/` and everything below it: that
 * folder is a local drop-zone for design references during
 * exploration and is also gitignored at the repo level (P4.7b).
 * If a developer happens to have files there locally, this stops
 * those files from propagating into `~/.burnguard/data/systems/`
 * on first run.
 *
 * `relPath` is the path relative to the source root, normalised
 * to forward-slash separators.
 */
export function isSampleSourcePathAllowed(relPath: string): boolean {
  if (relPath === "" || relPath === ".") return true;
  const normalized = relPath.replace(/\\/g, "/");
  const [first] = normalized.split("/");
  return first !== "uploads";
}

export async function seedBundledDesignSystems(
  repoRoot = resolveRepoRoot(),
  destinationRoot = systemsDir,
): Promise<void> {
  const themesSource = path.join(repoRoot, "design system themes");
  await Promise.all(
    bundledDesignSystems.map(async ({ slug }) => {
      const destination = path.join(
        destinationRoot,
        bundledDesignSystemId(slug),
      );
      if (await exists(destination)) return;
      await cp(path.join(themesSource, slug), destination, { recursive: true });
    }),
  );
}

async function seedSampleDesignSystems(): Promise<void> {
  const repoRoot = resolveRepoRoot();
  const sampleSource = path.join(repoRoot, "design system sample");
  const sampleDestination = path.join(systemsDir, "northvale-capital");

  if (!(await exists(sampleDestination))) {
    await cp(sampleSource, sampleDestination, {
      recursive: true,
      filter: (src) => isSampleSourcePathAllowed(path.relative(sampleSource, src)),
    });
  }

  await seedBundledDesignSystems(repoRoot, systemsDir);
}

export async function reconcileResearchOnStartup(db: Database, researchRecovery = createProductionResearchRecoveryDependencies(db)): Promise<void> {
  for (let pass = 0; pass < 2; pass += 1) {
    const receipt = await reconcileResearchState(db, researchRecovery);
    if (receipt.enqueued === 0) return;
  }
  throw new Error("Research startup recovery did not converge");
}

export async function bootstrapLocalAppData(researchRecovery?: ResearchRecoveryDependencies): Promise<void> {
  await mkdir(appRootDir, { recursive: true });
  await Promise.all([
    mkdir(dataDir, { recursive: true }),
    mkdir(systemsDir, { recursive: true }),
    mkdir(projectsDir, { recursive: true }),
    mkdir(cacheDir, { recursive: true }),
    mkdir(exportsDir, { recursive: true }),
    mkdir(logsDir, { recursive: true }),
  ]);
  await ensureConfig();
  await seedSampleDesignSystems();
  await runMigrations();
  await reconcileProjectDeletions(getSqlite());
  await reconcileResearchOnStartup(getSqlite(), researchRecovery);
  await seedCoreData();
  await seedTutorialsOnce();
  seedLearningItems(getSqlite());
  reconcilePipelineRows(getDb());
  await reconcileCatalogState(getSqlite(), systemsDir);
  await reconcileExtractionState();
  const artifactRecovery = await reconcileArtifactState(getSqlite());
  for (const project of artifactRecovery.unavailableProjects) {
    console.warn("[artifact] project recovery deferred", project.projectId, project.code);
  }
  await pruneExpiredArtifactOperations(getSqlite());
  await reconcileExportState(getSqlite());
  await pruneOldExports();
  await ensureAllProjectWatchers();
}
