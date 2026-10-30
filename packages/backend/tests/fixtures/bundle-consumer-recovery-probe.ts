import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { bootstrapLocalAppData } from "../../src/bootstrap";
import { runMigrations } from "../../src/db/migrate-local";
import { closeSqlite, getSqlite } from "../../src/db/sqlite-client";
import { getDesignSystemDetail } from "../../src/db/seed";
import { getProjectDetail } from "../../src/db/project-read-repository";
import { getCurrentSystemContent, getPendingSystemOperation } from "../../src/db/catalog-repository";
import { projectsDir, systemsDir } from "../../src/lib/paths";
import { importProjectBundleFile } from "../../src/services/project-bundle-import";
import { inspectCanonicalTree } from "../../src/services/canonical-tree-manifest";
import { readDesignSystemTokens, upsertDesignSystemColorToken } from "../../src/services/design-system-extract";
import { projectBundleImportReceiptsDir, projectBundlePayloadStage, projectBundleSystemStage } from "../../src/services/project-bundle-import-receipt";
import { DesignSystemPinError, inspectProjectDesignSystemPin, readProjectDesignSystemPin } from "../../src/services/project-design-system-pin";
import { readPaletteTransfer } from "../../src/db/palette-transfer-repository";
import { readDesignSystemPalette } from "../../src/services/design-system-palette";

const [phase, boundary, archive, output] = process.argv.slice(2);
if (archive === undefined || output === undefined ||
  (phase !== "prepare" && phase !== "edit" && phase !== "recover") ||
  (boundary !== "system-reserved" && boundary !== "system-restored" && boundary !== "outer-committed" && boundary !== "owner-removed")) {
  throw new TypeError("Expected prepare/edit/recover, import boundary, input archive and output path");
}
const exists = async (file: string): Promise<boolean> => stat(file).then(() => true, error => {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
  throw error;
});

if (phase === "prepare") {
  await mkdir(systemsDir, { recursive: true });
  await mkdir(projectsDir, { recursive: true });
  await runMigrations();
  const release = new Response(Bun.stdin).text();
  await importProjectBundleFile(new File([new Uint8Array(await readFile(archive))], "fixture.burnguard-project"), "Crash fixture", {
    // OS font discovery is unrelated to crash ownership; keep this process fixture deterministic.
    getLocalFonts: async () => ({ schema_version: 1, families: [] }),
    atBoundary: async (name, owner) => {
      if (name !== boundary || owner.systemId === null) return;
      const live = path.join(systemsDir, owner.systemId);
      const present = await exists(live);
      const projectOwner = path.join(projectsDir, owner.projectId, ".meta", "bundle-import-owner.json");
      const systemOwner = path.join(live, ".meta", "bundle-import-owner.json");
      await writeFile(output, JSON.stringify({
        operation_id: owner.operationId, project_id: owner.projectId, system_id: owner.systemId,
        outer: JSON.parse(await readFile(path.join(projectBundleImportReceiptsDir(), `${owner.operationId}.json`), "utf8")),
        pending: getPendingSystemOperation(getSqlite(), owner.systemId),
        project_manifest: await inspectCanonicalTree(path.join(projectsDir, owner.projectId)),
        system_manifest: present ? await inspectCanonicalTree(live) : null,
        sidecar: present ? await readFile(path.join(live, "extraction-provenance.json"), "utf8") : null,
        pin: readProjectDesignSystemPin(owner.projectId),
        project_owner: await exists(projectOwner) ? await readFile(projectOwner, "utf8") : null,
        system_owner: await exists(systemOwner) ? await readFile(systemOwner, "utf8") : null,
      }));
      process.stdout.write("BUNDLE_BOUNDARY\n");
      if ((await release).trim() !== "exit") throw new Error("Missing parent exit command");
      // A real exit leaves the outer receipt, prepared v1 receipt and genuine lock untouched.
      process.exit(77);
    },
  });
  throw new Error("Import boundary was not reached");
}

const before: unknown = JSON.parse(await readFile(output, "utf8"));
if (typeof before !== "object" || before === null ||
  !("system_id" in before) || typeof before.system_id !== "string" ||
  !("project_id" in before) || typeof before.project_id !== "string" ||
  !("operation_id" in before) || typeof before.operation_id !== "string") {
  throw new Error("Invalid import ownership evidence");
}
const systemId = before.system_id, projectId = before.project_id, operationId = before.operation_id;
const live = path.join(systemsDir, systemId);

if (phase === "edit") {
  try {
    await upsertDesignSystemColorToken(systemId, { name: "blocked-brand", value: "#abcdef" });
    throw new Error("Ordinary mutation entered a reserved import");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "system_content_unavailable") throw error;
  }
  const project = await getProjectDetail(projectId);
  if (project !== null && project.design_system_id !== null) {
    try {
      await inspectProjectDesignSystemPin(projectId);
      throw new Error("Ordinary pin inspection entered a reserved import");
    } catch (error) {
      if (!(error instanceof DesignSystemPinError) || error.code !== "pin_unavailable") throw error;
    }
  }
  closeSqlite();
} else if (phase === "recover") {
  // Outer import recovery MUST run before shared-lock and v1 recovery on the same launch.
  await bootstrapLocalAppData();
  const retained = boundary === "outer-committed" || boundary === "owner-removed";
  if (retained) await readDesignSystemTokens(systemId);
  else {
    try {
      await readDesignSystemTokens(systemId);
      throw new Error("Uncommitted imported system survived outer recovery");
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "design_system_not_found") throw error;
    }
  }
  const first = {
    system: await getDesignSystemDetail(systemId), project: await getProjectDetail(projectId),
    head: getCurrentSystemContent(getSqlite(), systemId),
    system_manifest: retained ? await inspectCanonicalTree(live) : null,
    project_manifest: retained ? await inspectCanonicalTree(path.join(projectsDir, projectId)) : null,
    pin: readProjectDesignSystemPin(projectId),
  };
  await bootstrapLocalAppData();
  const head = getCurrentSystemContent(getSqlite(), systemId);
  const paletteTransfer = head === null ? null : readPaletteTransfer(getSqlite(), head.id);
  const palette = paletteTransfer === null ? null : await readDesignSystemPalette(systemId);
  await writeFile(output, JSON.stringify({
    before, first,
    system: await getDesignSystemDetail(systemId), project: await getProjectDetail(projectId),
    head: getCurrentSystemContent(getSqlite(), systemId),
    palette, palette_transfer: paletteTransfer,
    pending: getPendingSystemOperation(getSqlite(), systemId),
    pin: readProjectDesignSystemPin(projectId),
    system_manifest: retained ? await inspectCanonicalTree(live) : null,
    project_manifest: retained ? await inspectCanonicalTree(path.join(projectsDir, projectId)) : null,
    sidecar: retained ? await readFile(path.join(live, "extraction-provenance.json"), "utf8") : null,
    system_present: await exists(live), project_present: await exists(path.join(projectsDir, projectId)),
    project_owner: await exists(path.join(projectsDir, projectId, ".meta", "bundle-import-owner.json")),
    system_owner: await exists(path.join(live, ".meta", "bundle-import-owner.json")),
    outer_present: await exists(path.join(projectBundleImportReceiptsDir(), `${operationId}.json`)),
    payload_present: await exists(projectBundlePayloadStage(operationId)),
    stage_present: await exists(projectBundleSystemStage(systemId)),
    lock_present: await exists(path.join(systemsDir, ".catalog-locks", systemId)),
  }));
  closeSqlite();
}
