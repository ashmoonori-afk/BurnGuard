import { copyBundledFonts } from "./data/bundled-fonts";
import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { cp, mkdir, rename, rm, stat } from "node:fs/promises";
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
import { seedOriginalSamplesOnce } from "./db/seed-original-samples";
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
import { reconcileArtifactState } from "./services/artifact-recovery";
import { purgeExpiredProjectDeletions, reconcileProjectDeletions } from "./services/project-deletion";
import { reconcileProjectBundleImports } from "./services/project-bundle-import-receipt";
import { pruneExpiredArtifactOperations } from "./services/artifact-retention";
import { reconcileExportState } from "./services/export-recovery";
import { createProductionResearchRecoveryDependencies } from "./routes/research";
import { reconcileResearchState, type ResearchRecoveryDependencies } from "./services/research-recovery";
import { recoverVisualAlternatives } from "./services/visual-alternative-recovery";
import { bundledAdditionValidator, bundledThemeHistory, recoverBundledTheme, refreshBundledTheme, type BundledThemeHistory, type BundledThemeRefresh } from "./services/bundled-theme-refresh";
import { reapPersistedSessionProcesses } from "./services/session-process-recovery";
import { repairNorthvalePreviews } from "./services/northvale-preview-repair";
import { canCreateSeedSystem, preserveSystemFromSeed } from "./services/startup-system-seed-guard";
import { reconcileSystemContentLocks } from "./services/system-content-access";
import { recoverSystemContent } from "./services/system-content-publication";
import { paletteContentEnvironment } from "./services/design-system-palette";
import { authoringContentValidators } from "./services/design-system-authoring";

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
  themeHistory: BundledThemeHistory = bundledThemeHistory,
  refresh: BundledThemeRefresh = refreshBundledTheme,
  pass: "all" | "create-missing" | "refresh-existing" = "all",
): Promise<void> {
  const themesSource = path.join(repoRoot, "design system themes");
  await Promise.all(
    bundledDesignSystems.map(async ({ slug }) => {
      const destination = path.join(
        destinationRoot,
        bundledDesignSystemId(slug),
      );
      try {
        const id = bundledDesignSystemId(slug);
        // Legacy leftovers predate receipts. Never restore them over journal-owned storage.
        if (!(await preserveSystemFromSeed(id, destinationRoot))) await recoverBundledTheme(destination);
        if (await exists(destination)) {
          // Refresh only app-owned additions; legacy bytes must survive until old projects pin them.
          const source = path.join(themesSource, slug);
          if (pass !== "create-missing") await refresh(id, source, destination, themeHistory);
          return;
        }
      } catch (error) {
        // Recovery and upgrade are optional; retain the previous copy and retry on the next launch.
        console.warn("[seed] bundled theme upgrade skipped", slug, error instanceof Error && "code" in error ? String(error.code) : "unknown");
        return;
      }
      if (pass === "refresh-existing" || !(await canCreateSeedSystem(bundledDesignSystemId(slug), destinationRoot))) return;
      // Publish only a complete theme; startup extraction recovery removes a stage left by a killed first launch.
      const stage = path.join(destinationRoot, `.${bundledDesignSystemId(slug)}.staging-${randomUUID()}`);
      try {
        await cp(path.join(themesSource, slug), stage, { recursive: true });
        await copyBundledFonts(stage, repoRoot);
        await rename(stage, destination);
      } finally {
        await rm(stage, { recursive: true, force: true });
      }
    }),
  );
}

export async function seedSampleDesignSystems(
  repoRoot = resolveRepoRoot(),
  destinationRoot = systemsDir,
): Promise<void> {
  const sampleSource = path.join(repoRoot, "design system sample");
  const sampleDestination = path.join(destinationRoot, "northvale-capital");

  if (await canCreateSeedSystem("northvale-capital", destinationRoot)) {
    const stage = path.join(destinationRoot, `.northvale-capital.staging-${randomUUID()}`);
    try {
      await cp(sampleSource, stage, {
        recursive: true,
        filter: (src) => isSampleSourcePathAllowed(path.relative(sampleSource, src)),
      });
      await rename(stage, sampleDestination);
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }

  await seedBundledDesignSystems(repoRoot, destinationRoot, bundledThemeHistory, refreshBundledTheme, "create-missing");
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
  await runMigrations();
  await reconcileProjectBundleImports(getSqlite());
  await reapPersistedSessionProcesses(getSqlite());
  await reconcileProjectDeletions(getSqlite());
  await purgeExpiredProjectDeletions(getSqlite());
  await reconcileResearchOnStartup(getSqlite(), researchRecovery);
  reconcilePipelineRows(getDb());
  await reconcileSystemContentLocks(getSqlite(), systemsDir);
  const contentEnvironment = paletteContentEnvironment();
  await recoverSystemContent({
    ...contentEnvironment,
    validators: { ...contentEnvironment.validators, ...authoringContentValidators, "bundled-addition": bundledAdditionValidator() },
  });
  for (const { slug } of bundledDesignSystems) {
    const id = bundledDesignSystemId(slug);
    if (await preserveSystemFromSeed(id)) continue;
    try { await recoverBundledTheme(path.join(systemsDir, id)); }
    catch (error) {
      if (!(error instanceof Error)) throw error;
      console.warn("[seed] bundled theme recovery deferred", slug, "code" in error ? String(error.code) : "unknown");
    }
  }
  await reconcileCatalogState(getSqlite(), systemsDir);
  await reconcileExtractionState();
  // Legacy create owners can be released only after their v1 recovery has settled.
  await reconcileSystemContentLocks(getSqlite(), systemsDir);
  await seedSampleDesignSystems();
  await seedCoreData();
  await seedTutorialsOnce();
  await seedOriginalSamplesOnce();
  seedLearningItems(getSqlite());
  await seedBundledDesignSystems(resolveRepoRoot(), systemsDir, bundledThemeHistory, refreshBundledTheme, "refresh-existing");
  const northvaleRepair = await repairNorthvalePreviews(getSqlite(), {
    systemsRoot: systemsDir,
    sourceRoot: path.join(resolveRepoRoot(), "design system sample"),
  });
  if (northvaleRepair.preserved.length > 0) {
    console.warn("[seed] Northvale preview repair partial", northvaleRepair.reason, northvaleRepair.preserved.length);
  }
  const artifactRecovery = await reconcileArtifactState(getSqlite());
  for (const project of artifactRecovery.unavailableProjects) {
    console.warn("[artifact] project recovery deferred", project.projectId, project.code);
  }
  await recoverVisualAlternatives(getSqlite());
  await pruneExpiredArtifactOperations(getSqlite());
  await reconcileExportState(getSqlite());
  await pruneOldExports();
  // Project watchers start in `main.ts` once the listener is up (`startProjectWatchers`).
}
