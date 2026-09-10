import { copyBundledFonts } from "../data/bundled-fonts";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, isNull } from "drizzle-orm";
import { ulid } from "ulid";
import type {
  BackendId,
  DesignSystemDetail,
  DesignSystemSourceType,
  DesignSystemSummary,
  ProjectDetail,
  ProjectSummary,
  SessionInfo,
} from "@bg/shared";
import { APP_VERSION } from "@bg/shared";
import {
  bundledDesignSystemId,
  bundledDesignSystems,
} from "../data/bundled-design-systems";
import { homeDesignSystemFixtures, homeProjectFixtures } from "../data/home";
import { projectsDir, systemsDir } from "../lib/paths";
import { DECK_STAGE_JS } from "../runtime/deck-stage";
import { getDb } from "./client";
import { getSqlite } from "./sqlite-client";
import { ArtifactCoordinator } from "../services/artifact-coordinator";
import {
  designSystemsTable,
  metaSchemaTable,
  projectsTable,
  sessionsTable,
  usersTable,
} from "./schema";
import { SEEDED_PROJECT_HTML, SPLASH_TEMPLATE_LANDING_HTML } from "./seeded-project-html";
import { seedSplashDesignSystemFiles } from "./seed-sample-design-systems";
import { PROMPT_SAMPLES, promptSampleDesignSystemId, renderPromptSampleHtml } from "./seed-tutorials";
import { renderInitialArtifact } from "./templates";
import { parseStoredProjectOptions } from "../services/project-options";
import { copyOriginalSample, findOriginalSample, originalSampleFormats, originalGraphicCanvas } from "../data/original-samples";

export { isExampleProject, listHomeProjects } from "./home-project-list";

export async function seedCoreData() {
  const db = getDb();
  const now = Date.now();

  await db
    .insert(usersTable)
    .values({
      id: "local",
      displayName: "You",
      createdAt: now,
    })
    .onConflictDoNothing();

  await db
    .insert(metaSchemaTable)
    .values({ key: "app_version", value: APP_VERSION })
    .onConflictDoUpdate({
      target: metaSchemaTable.key,
      set: { value: APP_VERSION },
    });

  const bundledThemeFixtures = bundledDesignSystems.map(({ slug, name }) => ({
    id: bundledDesignSystemId(slug),
    name,
    status: "published" as const,
    is_template: false,
    thumbnail_path: null,
    updated_at: 1786665600000,
  }));

  for (const system of [...homeDesignSystemFixtures, ...bundledThemeFixtures]) {
    const hasBundledFiles =
      system.id === "northvale-capital" || system.id === "splash" ||
      system.id.startsWith("builtin-theme-");
    const dirPath = path.join(systemsDir, system.id);
    if (system.id === "splash") await seedSplashDesignSystemFiles(dirPath, SPLASH_TEMPLATE_LANDING_HTML);

    await db
      .insert(designSystemsTable)
      .values({
        id: system.id,
        name: system.name,
        description: null,
        status: system.status,
        sourceType: hasBundledFiles ? "sample" : "manual",
        sourceUri: null,
        isTemplate: system.is_template,
        dirPath,
        skillMdPath: hasBundledFiles ? path.join(dirPath, "SKILL.md") : null,
        tokensCssPath: hasBundledFiles
          ? path.join(dirPath, "colors_and_type.css")
          : null,
        readmeMdPath: hasBundledFiles ? path.join(dirPath, "README.md") : null,
        thumbnailPath: system.thumbnail_path,
        createdAt: system.updated_at,
        updatedAt: system.updated_at,
        archivedAt: null,
      })
      .onConflictDoUpdate({
        target: designSystemsTable.id,
        set: {
          name: system.name,
          status: system.status,
          isTemplate: system.is_template,
          dirPath,
          skillMdPath: hasBundledFiles ? path.join(dirPath, "SKILL.md") : null,
          tokensCssPath: hasBundledFiles
            ? path.join(dirPath, "colors_and_type.css")
            : null,
          readmeMdPath: hasBundledFiles ? path.join(dirPath, "README.md") : null,
          thumbnailPath: system.thumbnail_path,
          updatedAt: system.updated_at,
        },
      });
  }

  const existingProjects = await db
    .select({ id: projectsTable.id })
    .from(projectsTable)
    .limit(1);

  if (existingProjects.length > 0) return;

  for (const project of homeProjectFixtures) {
    const dirPath = path.join(projectsDir, project.id);
    await mkdir(path.join(dirPath, ".attachments"), { recursive: true });
    await mkdir(path.join(dirPath, ".meta", "checkpoints"), { recursive: true });

    const entrypoint =
      project.type === "slide_deck" ? "deck.html" : "index.html";

    const html = project.archived_at == null ? SEEDED_PROJECT_HTML[project.id] : undefined;

    await db.insert(projectsTable).values({
      id: project.id,
      name: project.name,
      type: project.type,
      designSystemId: project.design_system_id,
      dirPath,
      entrypoint,
      thumbnailPath: project.thumbnail_path,
      backendId: "claude-code",
      optionsJson: null,
      archivedAt: project.archived_at,
      createdAt: project.updated_at,
      updatedAt: project.updated_at,
    });

    await db.insert(sessionsTable).values({
      id: ulid(),
      projectId: project.id,
      backendId: "claude-code",
      status: "idle",
      createdAt: project.updated_at,
      updatedAt: project.updated_at,
      lastActiveAt: project.updated_at,
    });
    await new ArtifactCoordinator(getSqlite()).initializeProject(project.id, dirPath, async (stage) => {
      await copyBundledFonts(stage);
      if (html === undefined) return;
      await writeFile(path.join(stage, entrypoint), html, "utf8");
      if (project.type === "slide_deck") {
        await mkdir(path.join(stage, "runtime"), { recursive: true });
        await writeFile(path.join(stage, "runtime", "deck-stage.js"), DECK_STAGE_JS, "utf8");
      }
    });
  }
}

export async function listHomeDesignSystems(status: DesignSystemSummary["status"]) {
  const db = getDb();
  const rows = await db
    .select({
      id: designSystemsTable.id,
      name: designSystemsTable.name,
      status: designSystemsTable.status,
      is_template: designSystemsTable.isTemplate,
      thumbnail_path: designSystemsTable.thumbnailPath,
      updated_at: designSystemsTable.updatedAt,
    })
    .from(designSystemsTable)
    .where(
      and(eq(designSystemsTable.status, status), isNull(designSystemsTable.archivedAt)),
    )
    .orderBy(desc(designSystemsTable.updatedAt));

  return rows as DesignSystemSummary[];
}

export async function getDesignSystemDetail(systemId: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: designSystemsTable.id,
      name: designSystemsTable.name,
      description: designSystemsTable.description,
      status: designSystemsTable.status,
      is_template: designSystemsTable.isTemplate,
      thumbnail_path: designSystemsTable.thumbnailPath,
      updated_at: designSystemsTable.updatedAt,
      source_type: designSystemsTable.sourceType,
      source_uri: designSystemsTable.sourceUri,
      dir_path: designSystemsTable.dirPath,
      skill_md_path: designSystemsTable.skillMdPath,
      tokens_css_path: designSystemsTable.tokensCssPath,
      readme_md_path: designSystemsTable.readmeMdPath,
      archived_at: designSystemsTable.archivedAt,
    })
    .from(designSystemsTable)
    .where(eq(designSystemsTable.id, systemId))
    .limit(1);

  return (rows[0] ?? null) as DesignSystemDetail | null;
}

export async function createDesignSystemRecord(input: {
  id: string;
  name: string;
  description: string | null;
  status: DesignSystemSummary["status"];
  sourceType: DesignSystemSourceType;
  sourceUri: string | null;
  isTemplate?: boolean;
  dirPath: string;
  skillMdPath: string | null;
  tokensCssPath: string | null;
  readmeMdPath: string | null;
  thumbnailPath: string | null;
}) {
  const db = getDb();
  const now = Date.now();
  await db.insert(designSystemsTable).values({
    id: input.id,
    name: input.name,
    description: input.description,
    status: input.status,
    sourceType: input.sourceType,
    sourceUri: input.sourceUri,
    isTemplate: input.isTemplate ?? false,
    dirPath: input.dirPath,
    skillMdPath: input.skillMdPath,
    tokensCssPath: input.tokensCssPath,
    readmeMdPath: input.readmeMdPath,
    thumbnailPath: input.thumbnailPath,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  });
  return await getDesignSystemDetail(input.id);
}

export async function updateDesignSystemRecord(
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    status?: DesignSystemSummary["status"];
  },
): Promise<DesignSystemDetail | null> {
  const db = getDb();
  const set: Record<string, unknown> = { updatedAt: Date.now() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.status !== undefined) set.status = patch.status;
  await db
    .update(designSystemsTable)
    .set(set)
    .where(eq(designSystemsTable.id, id));
  return await getDesignSystemDetail(id);
}

export async function deleteDesignSystemRecord(id: string): Promise<void> {
  const db = getDb();
  await db.delete(designSystemsTable).where(eq(designSystemsTable.id, id));
}

export async function listActiveProjectsForDesignSystem(
  designSystemId: string,
): Promise<Array<{ id: string; name: string }>> {
  const db = getDb();
  const rows = await db
    .select({ id: projectsTable.id, name: projectsTable.name })
    .from(projectsTable)
    .where(
      and(
        eq(projectsTable.designSystemId, designSystemId),
        isNull(projectsTable.archivedAt),
      ),
    );
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

export async function createProjectRecord(input: {
  name: string;
  type: ProjectSummary["type"];
  designSystemId: string | null;
  backendId: BackendId;
  optionsJson: string | null;
  entrypoint: string;
  thumbnailPath: string | null;
  initializeArtifact?: (stage: string) => Promise<void>;
}) {
  const db = getDb();
  const now = Date.now();
  const projectId = ulid();
  const sessionId = ulid();
  const dirPath = path.join(projectsDir, projectId);

  const original = findOriginalSample(input.designSystemId);
  const originalFormat = original ? originalSampleFormats.find((format) => format.type === (input.type === "from_template" ? "prototype" : input.type)) : undefined;
  if (originalFormat) {
    input = { ...input, type: originalFormat.type, entrypoint: originalFormat.entrypoint, optionsJson: originalFormat.type === "graphic" ? JSON.stringify({ ...parseStoredProjectOptions(input.optionsJson), graphic_canvas: originalGraphicCanvas }) : input.optionsJson };
  }

  await mkdir(path.join(dirPath, ".attachments"), { recursive: true });
  await mkdir(path.join(dirPath, ".meta", "checkpoints"), { recursive: true });
  const sample = input.type === "from_template" ? PROMPT_SAMPLES.find((item) => promptSampleDesignSystemId(item.slug) === input.designSystemId) : undefined;
  const initialArtifact = input.type === "from_template" && input.designSystemId === "splash" ? SPLASH_TEMPLATE_LANDING_HTML : sample ? renderPromptSampleHtml(sample) : renderInitialArtifact({
    name: input.name,
    type: input.type,
    options: parseStoredProjectOptions(input.optionsJson),
  });

  // Insert project + session atomically — without the transaction a
  // session-insert failure between the two statements would leave the
  // project row dangling, which the home view renders but every
  // session-keyed route (events, status, backend switch) 404s on.
  db.transaction((tx) => {
    tx.insert(projectsTable)
      .values({
        id: projectId,
        name: input.name,
        type: input.type,
        designSystemId: input.designSystemId,
        dirPath,
        entrypoint: input.entrypoint,
        thumbnailPath: input.thumbnailPath,
        backendId: input.backendId,
        optionsJson: input.optionsJson,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      })
      .run();
    tx.insert(sessionsTable)
      .values({
        id: sessionId,
        projectId,
        backendId: input.backendId,
        status: "idle",
        createdAt: now,
        updatedAt: now,
        lastActiveAt: now,
      })
      .run();
  });

  try {
    await new ArtifactCoordinator(getSqlite()).initializeProject(projectId, dirPath, async (stage) => {
      if (input.initializeArtifact) await input.initializeArtifact(stage);
      else if (original && originalFormat) await copyOriginalSample(original.slug, originalFormat.directory, stage);
      else {
        await copyBundledFonts(stage);
        await writeFile(path.join(stage, input.entrypoint), initialArtifact, "utf8");
        if (input.type === "slide_deck") {
          await mkdir(path.join(stage, "runtime"), { recursive: true });
          await writeFile(path.join(stage, "runtime", "deck-stage.js"), DECK_STAGE_JS, "utf8");
        }
      }
    });
  } catch (error) {
    getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
    await rm(dirPath, { recursive: true, force: true });
    throw error;
  }

  return {
    id: projectId,
    session_id: sessionId,
    dir_path: dirPath,
    entrypoint: input.entrypoint,
  };
}

export async function getProjectDetail(projectId: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: projectsTable.id,
      name: projectsTable.name,
      type: projectsTable.type,
      design_system_id: projectsTable.designSystemId,
      design_system_name: designSystemsTable.name,
      thumbnail_path: projectsTable.thumbnailPath,
      updated_at: projectsTable.updatedAt,
      archived_at: projectsTable.archivedAt,
      dir_path: projectsTable.dirPath,
      entrypoint: projectsTable.entrypoint,
      backend_id: projectsTable.backendId,
      options_json: projectsTable.optionsJson,
      current_revision: projectsTable.currentRevision,
      current_digest: projectsTable.currentDigest,
    })
    .from(projectsTable)
    .leftJoin(
      designSystemsTable,
      eq(projectsTable.designSystemId, designSystemsTable.id),
    )
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  return (rows[0] ?? null) as ProjectDetail | null;
}

export async function getLatestProjectSession(projectId: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: sessionsTable.id,
      project_id: sessionsTable.projectId,
      backend_id: sessionsTable.backendId,
      status: sessionsTable.status,
      updated_at: sessionsTable.updatedAt,
      last_active_at: sessionsTable.lastActiveAt,
      input: sessionsTable.usageInputTokens,
      output: sessionsTable.usageOutputTokens,
      cached: sessionsTable.usageCacheRead,
      cache_write: sessionsTable.usageCacheWrite,
    })
    .from(sessionsTable)
    .where(eq(sessionsTable.projectId, projectId))
    .orderBy(desc(sessionsTable.updatedAt))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    project_id: row.project_id,
    backend_id: row.backend_id,
    status: row.status,
    usage: {
      input: row.input,
      output: row.output,
      cached: row.cached,
      cache_write: row.cache_write,
    },
    updated_at: row.updated_at,
    last_active_at: row.last_active_at,
  } satisfies SessionInfo;
}

export async function getSessionInfo(sessionId: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: sessionsTable.id,
      project_id: sessionsTable.projectId,
      backend_id: sessionsTable.backendId,
      status: sessionsTable.status,
      updated_at: sessionsTable.updatedAt,
      last_active_at: sessionsTable.lastActiveAt,
      input: sessionsTable.usageInputTokens,
      output: sessionsTable.usageOutputTokens,
      cached: sessionsTable.usageCacheRead,
      cache_write: sessionsTable.usageCacheWrite,
    })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    project_id: row.project_id,
    backend_id: row.backend_id,
    status: row.status,
    usage: {
      input: row.input,
      output: row.output,
      cached: row.cached,
      cache_write: row.cache_write,
    },
    updated_at: row.updated_at,
    last_active_at: row.last_active_at,
  } satisfies SessionInfo;
}
