import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import JSZip from "jszip";
import { PROJECT_BUNDLE_MANIFEST_PATH, parseProjectBundleManifest, type ProjectBundleFile, type ProjectBundleManifest } from "@bg/shared";
import { runMigrations } from "../src/db/migrate-local";
import { getSqlite } from "../src/db/sqlite-client";
import { projectsDir, systemsDir } from "../src/lib/paths";
import { getProjectDetail } from "../src/db/project-read-repository";
import { createDesignSystemRecord, createProjectRecord, getDesignSystemDetail } from "../src/db/seed";
import { getContentReceipt, getCurrentSystemContent, getPendingSystemOperation } from "../src/db/catalog-repository";
import { validateCatalogReceiptTree } from "../src/services/catalog-files";
import { projectBundleImportReceiptsDir, projectBundlePayloadStage, projectBundleSystemStage, reconcileProjectBundleImports, writeBundleImportOwnerMarker, writeProjectBundleImportReceipt } from "../src/services/project-bundle-import-receipt";
import { rmdir, symlink, unlink } from "node:fs/promises";
import { canCreateSymlink, SYMLINK_SKIP_REASON } from "./helpers/platform";
import { readdir } from "node:fs/promises";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { exportProjectBundle, importProjectBundleFile } from "../src/services/project-bundle";
import { inspectProjectDesignSystemPin, readProjectDesignSystemPin, refreshProjectDesignSystemPin } from "../src/services/project-design-system-pin";
import { parseCanonicalPinContent, type CanonicalPinSelection } from "@bg/shared/canonical-pin";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { reconcileArtifactState } from "../src/services/artifact-recovery";
import { listSessionAttachments } from "../src/db/attachments";
import { selectContextAttachments } from "../src/services/context";
import { createDefaultPalette, emitPaletteCss, serializePalette } from "@bg/shared/palette";
import { paletteContentEnvironment, readDesignSystemPalette, saveDesignSystemPalette } from "../src/services/design-system-palette";
import { upsertDesignSystemColorToken } from "../src/services/design-system-extract";
import { validateProjectBundleCanonicalFiles } from "../src/services/project-bundle-validation";
import { parseHexColor } from "@bg/shared/color";
import { createDefaultThemeSettings, synthesizeTheme } from "@bg/shared/theme";
import { canonicalFiles, validateCanonicalContent, writeCanonicalCandidate } from "../src/services/canonical-theme-files";
import { readOwnedCanonical } from "../src/services/design-system-canonical";
import { withSystemContentAccess } from "../src/services/system-content-access";
import { contentObservationDigest, observeSystemContent, publishSystemContent, recoverSystemContent } from "../src/services/system-content-publication";
import { parseContentProvenance } from "../src/services/system-content-format";
import { readCanonicalTransfer } from "../src/db/canonical-transfer-repository";
import { reconcileExtractionState } from "../src/services/extraction-recovery";
import { authoringContentEnvironment } from "../src/services/design-system-authoring";
import { withCatalogSnapshot } from "../src/services/catalog-snapshot";
import { isArtifactProjectBusy } from "../src/services/artifact-project-lock";
import { ProjectBundleError } from "../src/services/project-bundle-error";
import { readPaletteTransfer } from "../src/db/palette-transfer-repository";
import legacyEmitter from "./fixtures/palette-emitter-v1.json";

// Bun's `rm` fails with EFAULT on a Windows directory link; remove the link itself (never the target) per platform.
const removeDirectoryLink = (link: string): Promise<void> => (process.platform === "win32" ? rmdir(link) : unlink(link));

const suffix = `${process.pid}-${crypto.randomUUID()}`;
const sourceProjectId = `bundle-source-${suffix}`;
const sourceSessionId = `bundle-session-${suffix}`;
const sourceSystemId = `bundle-system-${suffix}`;
const sourceProjectDir = path.join(projectsDir, sourceProjectId);
const sourceSystemDir = path.join(systemsDir, sourceSystemId);
const createdProjectIds: string[] = [];
const createdSystemIds: string[] = [];

function signal() {
  let resolve = () => {};
  const promise = new Promise<void>(done => { resolve = done; });
  return { resolve, promise };
}

async function bounded<T>(promise: Promise<T>, milliseconds = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Bundle event deadline exceeded")), milliseconds);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

async function exists(target: string): Promise<boolean> {
  return stat(target).then(() => true, error => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  });
}

async function bundleFixture() {
  const exported = await exportProjectBundle(sourceProjectId);
  const restored = await importProjectBundleFile(new File([exported.bytes], exported.filename), "Consumer fixture");
  createdProjectIds.push(restored.id);
  const project = await getProjectDetail(restored.id);
  if (!project?.design_system_id) throw new Error("Missing bundle fixture system");
  createdSystemIds.push(project.design_system_id);
  const system = await getDesignSystemDetail(project.design_system_id);
  if (system === null) throw new Error("Missing bundle fixture row");
  return { project, system };
}

async function manualBundleFixture() {
  const id = `manual-bundle-${crypto.randomUUID()}`;
  const directory = path.join(systemsDir, id);
  await mkdir(directory);
  for (const name of ["README.md", "SKILL.md", "colors_and_type.css"]) {
    await writeFile(path.join(directory, name), await readFile(path.join(sourceSystemDir, name)));
  }
  const system = await createDesignSystemRecord({
    id, name: "Manual portable theme", description: null, status: "published", sourceType: "manual",
    sourceUri: null, dirPath: directory, skillMdPath: path.join(directory, "SKILL.md"),
    tokensCssPath: path.join(directory, "colors_and_type.css"), readmeMdPath: path.join(directory, "README.md"),
    thumbnailPath: null,
  });
  createdSystemIds.push(id);
  if (system === null) throw new Error("Missing manual theme");
  const created = await createProjectRecord({
    name: "Manual theme project", type: "prototype", designSystemId: id, backendId: "codex",
    optionsJson: null, entrypoint: "index.html", thumbnailPath: null,
    initializeArtifact: stage => writeFile(path.join(stage, "index.html"), "<h1>Manual theme</h1>"),
  });
  createdProjectIds.push(created.id);
  const project = await getProjectDetail(created.id);
  if (project === null) throw new Error("Missing manual project");
  return { project, system };
}

async function savedPaletteBundle(canonicalOnly = false) {
  const fixture = canonicalOnly ? await manualBundleFixture() : await bundleFixture();
  const initial = await readDesignSystemPalette(fixture.system.id);
  const state = { ...createDefaultPalette(), curve: { ...createDefaultPalette().curve, amount: 0.413 } };
  await saveDesignSystemPalette(fixture.system.id, { expected_digest: initial.expected_digest, state });
  const archive = await exportProjectBundle(fixture.project.id);
  return { ...fixture, state, archive };
}

async function savedCanonicalBundle(canonicalOnly = false) {
  const fixture = await savedPaletteBundle(canonicalOnly);
  const theme = synthesizeTheme({
    system_id: "portable-bundle-theme", default_mode: "light", palette: fixture.state,
    sources: { brand: { kind: "color", color: parseHexColor("#123456") }, surface: { kind: "scale", id: "neutral" },
      status: { success: parseHexColor("#15803d"), warning: parseHexColor("#a16207"),
        destructive: parseHexColor("#b91c1c"), info: parseHexColor("#0369a1") } },
    settings: { light: createDefaultThemeSettings(), dark: createDefaultThemeSettings() },
  });
  const environment = paletteContentEnvironment();
  await withSystemContentAccess(getSqlite(), systemsDir, [fixture.system.id], async lease => {
    const base = await observeSystemContent(environment, fixture.system.id, lease);
    const head = getCurrentSystemContent(getSqlite(), fixture.system.id);
    if (head === null) throw new Error("Missing palette source receipt");
    const provenance = parseContentProvenance(JSON.parse(head.provenanceJson));
    await publishSystemContent(environment, {
      systemId: fixture.system.id, mode: "replace", expectedDigest: contentObservationDigest(base), lease,
      adapter: {
        provenance: { ...provenance, writer: "canonical" },
        writeSet: () => ["canonical/SKILL.md", "canonical/theme.css", "canonical/theme.json"],
        transform: async stage => { await writeCanonicalCandidate(stage, theme); },
        validate: validateCanonicalContent,
        canonicalTransfer: async () => canonicalFiles(theme).proof,
      },
    });
  });
  return { ...fixture, theme, archive: await exportProjectBundle(fixture.project.id) };
}

async function canonicalPinnedBundle(mode: "light" | "dark") {
  const fixture = await savedCanonicalBundle(true);
  const selection: CanonicalPinSelection = { format: "canonical-v1", mode };
  const current = readProjectDesignSystemPin(fixture.project.id);
  const proposed = await inspectProjectDesignSystemPin(fixture.project.id, {}, selection);
  if (current === null || proposed === null) throw new Error("Missing canonical pin candidate");
  await refreshProjectDesignSystemPin(fixture.project.id, current.digest, proposed.candidate_digest, selection);
  const pin = readProjectDesignSystemPin(fixture.project.id);
  if (pin?.format !== "canonical-v1") throw new Error("Missing canonical pin");
  return { ...fixture, pin };
}

test.each(["light", "dark"] as const)(
  "Given a canonical pin bundle in %s mode and a newer catalog theme When imported Then the older pin and both modes survive owner rebinding",
  async mode => {
    const fixture = await canonicalPinnedBundle(mode);
    const current = await readDesignSystemPalette(fixture.system.id);
    const changed = { ...fixture.theme.palette, curve: { ...fixture.theme.palette.curve, amount: 0.24 } };
    await saveDesignSystemPalette(fixture.system.id, { expected_digest: current.expected_digest, state: changed });
    const exported = await exportProjectBundle(fixture.project.id);
    expect(exported.manifest.design_system.pin).toMatchObject({
      schema_version: 2, format: "canonical-v1", digest: fixture.pin.digest,
    });
    const restored = await importProjectBundleFile(new File([exported.bytes], exported.filename), "Pinned canonical import", {
      getLocalFonts: async () => ({ schema_version: 1, families: [] }),
    });
    createdProjectIds.push(restored.id);
    const project = await getProjectDetail(restored.id);
    if (!project?.design_system_id) throw new Error("Missing rebound canonical system");
    createdSystemIds.push(project.design_system_id);
    const pin = readProjectDesignSystemPin(project.id);
    if (pin === null) throw new Error("Missing imported canonical pin");
    expect(pin).toEqual({ ...fixture.pin, system_id: project.design_system_id });
    expect(parseCanonicalPinContent(pin)).toEqual({ schema_version: 1, mode, theme: fixture.theme });
    expect((await readDesignSystemPalette(project.design_system_id)).state).toEqual(changed);
    const proposed = await inspectProjectDesignSystemPin(project.id);
    expect(proposed).toMatchObject({ format: "canonical-v1", mode, candidate_format: "canonical-v1", candidate_mode: mode });
    expect(proposed?.candidate_digest).not.toBe(pin.digest);
    expect((await exportProjectBundle(project.id)).manifest.design_system.pin).toEqual(exported.manifest.design_system.pin);
  },
);

test.each(["format", "version", "prose", "css", "digest"] as const)(
  "Given a canonical pin bundle with invalid %s When imported Then no project or system is allocated",
  async fault => {
    const fixture = await canonicalPinnedBundle("dark");
    const exported = await exportProjectBundle(fixture.project.id);
    const manifest = exported.manifest;
    const pin = manifest.design_system.pin;
    if (pin?.format !== "canonical-v1") throw new Error("Missing canonical metadata");
    const changed = fault === "format" ? { ...pin, format: "canonical-v2" }
      : fault === "version" ? { ...pin, schema_version: 1 }
      : fault === "prose" ? { ...pin, context: `${pin.context}\nUntrusted instructions` }
      : fault === "css" ? { ...pin, tokens: `${pin.tokens}\n` }
      : { ...pin, digest: "0".repeat(64) };
    const zip = await JSZip.loadAsync(exported.bytes);
    zip.file(PROJECT_BUNDLE_MANIFEST_PATH, JSON.stringify({ ...manifest, design_system: { ...manifest.design_system, pin: changed } }));
    const file = new File([new Uint8Array(await zip.generateAsync({ type: "uint8array" }))], "invalid-canonical-pin.burnguard-project");
    const count = () => [
      getSqlite().query<{ count: number }, []>("SELECT count(*) count FROM projects").get()?.count,
      getSqlite().query<{ count: number }, []>("SELECT count(*) count FROM design_systems").get()?.count,
    ];
    const before = count();
    await expect(importProjectBundleFile(file)).rejects.toMatchObject({ code: "invalid_project_bundle" });
    expect(count()).toEqual(before);
    expect(await readdir(projectBundleImportReceiptsDir())).toEqual([]);
  },
);

test("Given a canonical-only theme When imported after source deletion Then exactly one v2 owner reopens and saves independently", async () => {
  const { project, system, theme, archive } = await savedCanonicalBundle(true);
  expect(archive.manifest.files.some(file => file.path === "design-system/extraction-provenance.json")).toBe(false);
  getSqlite().query("DELETE FROM projects WHERE id=?").run(project.id);
  await rm(project.dir_path, { recursive: true, force: true });
  getSqlite().query("DELETE FROM design_systems WHERE id=?").run(system.id);
  await rm(system.dir_path, { recursive: true, force: true });

  const imported = await importProjectBundleFile(new File([archive.bytes], archive.filename), "Canonical-only import");
  createdProjectIds.push(imported.id);
  const detail = await getProjectDetail(imported.id);
  if (!detail?.design_system_id) throw new Error("Missing canonical-only import");
  const id = detail.design_system_id;
  createdSystemIds.push(id);
  const head = getCurrentSystemContent(getSqlite(), id);
  if (head === null) throw new Error("Missing canonical-only owner");
  expect(head).toMatchObject({ schemaVersion: 2, contentRevision: 1, status: "committed" });
  expect(getSqlite().query("SELECT id FROM design_system_receipts WHERE design_system_id=?").all(id)).toEqual([{ id: head.id }]);
  expect(readCanonicalTransfer(getSqlite(), head.id)).toEqual(canonicalFiles(theme).proof);
  expect(readPaletteTransfer(getSqlite(), head.id)).not.toBeNull();
  expect(await exists(path.join(systemsDir, id, "extraction-provenance.json"))).toBe(false);
  expect(await exists(path.join(systemsDir, id, ".meta", "bundle-import-owner.json"))).toBe(false);
  const reopened = await readDesignSystemPalette(id);
  expect(reopened.state).toEqual(theme.palette);
  const changed = { ...theme.palette, curve: { ...theme.palette.curve, amount: 0.27 } };
  await saveDesignSystemPalette(id, { expected_digest: reopened.expected_digest, state: changed });
  const environment = paletteContentEnvironment();
  const actual = await withSystemContentAccess(getSqlite(), systemsDir, [id], async lease =>
    readOwnedCanonical(environment, await observeSystemContent(environment, id, lease), lease));
  expect(actual?.theme.palette).toEqual(changed);
  expect(actual?.theme.system_id).toBe(theme.system_id);
  expect((await exportProjectBundle(imported.id)).manifest.design_system)
    .toMatchObject({ kind: "custom", canonical_transfer: actual?.proof });
  expect(await readdir(projectBundleImportReceiptsDir())).toEqual([]);
});

test.each(["outer-committed", "owner-removed"] as const)(
  "Given a canonical-only import interrupted at %s When inner then outer recovery run Then only outer reconciliation releases the same v2 owner",
  async boundary => {
    const { archive, theme } = await savedCanonicalBundle(true);
    let id: string | undefined;
    await expect(importProjectBundleFile(new File([archive.bytes], archive.filename), "Canonical-only recovery", {
      atBoundary: async (name, owner) => {
        if (name !== boundary || owner.systemId === null) return;
        id = owner.systemId;
        createdSystemIds.push(id);
        createdProjectIds.push(owner.projectId);
        throw new Error("injected canonical-only interruption");
      },
    })).rejects.toMatchObject({ code: "project_bundle_unavailable" });
    if (id === undefined) throw new Error("Missing interrupted owner");
    const pending = getPendingSystemOperation(getSqlite(), id);
    if (pending === null) throw new Error("Missing prepared owner");
    expect(pending).toMatchObject({ schemaVersion: 2, status: "prepared", contentRevision: 1 });
    const environment = paletteContentEnvironment();
    expect((await recoverSystemContent(environment)).held).toContain(pending.id);
    expect(getCurrentSystemContent(getSqlite(), id)).toBeNull();
    await reconcileProjectBundleImports(getSqlite());
    expect((await recoverSystemContent(environment)).held).not.toContain(pending.id);
    expect(getCurrentSystemContent(getSqlite(), id)).toMatchObject({ id: pending.id, status: "committed" });
    expect(getSqlite().query("SELECT id FROM design_system_receipts WHERE design_system_id=?").all(id)).toEqual([{ id: pending.id }]);
    expect((await readDesignSystemPalette(id)).state).toEqual(theme.palette);
    expect(await exists(path.join(systemsDir, id, ".meta", "bundle-import-owner.json"))).toBe(false);
    expect(await readdir(projectBundleImportReceiptsDir())).toEqual([]);
  },
);

test.each(["system-restored", "before-commit"] as const)(
  "Given a canonical-only import failing at %s When its owned rollback completes Then no local receipt or proof remains",
  async boundary => {
    const { archive } = await savedCanonicalBundle(true);
    let id: string | undefined;
    await expect(importProjectBundleFile(new File([archive.bytes], archive.filename), "Canonical-only rollback", {
      atBoundary: async (name, owner) => {
        if (name !== boundary || owner.systemId === null) return;
        id = owner.systemId;
        expect(getPendingSystemOperation(getSqlite(), id)).toMatchObject({ schemaVersion: 2, contentRevision: 1 });
        throw new Error("injected canonical-only rollback");
      },
    })).rejects.toMatchObject({ code: "invalid_project_bundle" });
    if (id === undefined) throw new Error("Missing rollback owner");
    expect(await getDesignSystemDetail(id)).toBeNull();
    expect(await exists(path.join(systemsDir, id))).toBe(false);
    expect(getSqlite().query("SELECT id FROM design_system_receipts WHERE design_system_id=?").all(id)).toEqual([]);
    expect(await readdir(projectBundleImportReceiptsDir())).toEqual([]);
    await recoverSystemContent(paletteContentEnvironment());
  },
);

test.each(["marker", "private-file", "canonical-file"] as const)(
  "Given a canonical-only import with changed %s after preparation When rollback and recovery run Then divergent bytes and proofs stay held",
  async fault => {
    const { archive } = await savedCanonicalBundle(true);
    let owner: { readonly systemId: string; readonly projectId: string; readonly operationId: string } | undefined;
    let target: string | undefined;
    let original: Buffer | undefined;
    const changed = Buffer.from("unowned changed bytes");
    try {
      await expect(importProjectBundleFile(new File([archive.bytes], archive.filename), "Canonical-only divergent import", {
        atBoundary: async (name, value) => {
          if (name !== "before-commit" || value.systemId === null) return;
          owner = { ...value, systemId: value.systemId };
          createdSystemIds.push(value.systemId);
          createdProjectIds.push(value.projectId);
          const relative = fault === "marker" ? ".meta/bundle-import-owner.json"
            : fault === "private-file" ? ".meta/foreign.txt" : "canonical/theme.css";
          target = path.join(systemsDir, value.systemId, relative);
          if (fault !== "private-file") original = await readFile(target);
          await writeFile(target, changed);
        },
      })).rejects.toMatchObject({ code: "project_bundle_unavailable" });
      if (owner === undefined || target === undefined) throw new Error("Missing divergent import");
      const pending = getPendingSystemOperation(getSqlite(), owner.systemId);
      if (pending === null) throw new Error("Missing held owner");
      const proof = readCanonicalTransfer(getSqlite(), pending.id);
      expect(proof).not.toBeNull();
      await expect(reconcileProjectBundleImports(getSqlite())).rejects.toMatchObject({ code: "system_content_conflict" });
      expect((await recoverSystemContent(paletteContentEnvironment())).held).toContain(pending.id);
      expect(getPendingSystemOperation(getSqlite(), owner.systemId)?.id).toBe(pending.id);
      expect(readCanonicalTransfer(getSqlite(), pending.id)).toEqual(proof);
      expect(await readFile(target)).toEqual(changed);
      expect(await getProjectDetail(owner.projectId)).not.toBeNull();
      expect(await exists(path.join(projectBundleImportReceiptsDir(), `${owner.operationId}.json`))).toBe(true);
    } finally {
      // Restore only the test's injected bytes so the shared fixture can reconcile normally.
      if (target !== undefined) {
        if (original === undefined) await rm(target);
        else await writeFile(target, original);
        await reconcileProjectBundleImports(getSqlite());
        await recoverSystemContent(paletteContentEnvironment());
      }
    }
  },
);

test("Given an owned canonical theme with extraction lineage When imported after source deletion Then the new v1 receipt owns both components", async () => {
  const { project, system, theme, archive } = await savedCanonicalBundle();
  const expected = canonicalFiles(theme);
  expect(archive.manifest.design_system).toMatchObject({ kind: "custom", canonical_transfer: expected.proof });
  getSqlite().query("DELETE FROM projects WHERE id=?").run(project.id);
  await rm(project.dir_path, { recursive: true, force: true });
  getSqlite().query("DELETE FROM design_systems WHERE id=?").run(system.id);
  await rm(system.dir_path, { recursive: true, force: true });

  const imported = await importProjectBundleFile(new File([archive.bytes], archive.filename), "Canonical import");
  createdProjectIds.push(imported.id);
  const detail = await getProjectDetail(imported.id);
  if (!detail?.design_system_id) throw new Error("Missing imported canonical system");
  const id = detail.design_system_id;
  createdSystemIds.push(id);

  const head = getCurrentSystemContent(getSqlite(), id);
  if (head === null) throw new Error("Missing imported owner");
  expect(head).toMatchObject({ schemaVersion: 1, contentRevision: 1, status: "committed" });
  expect(readCanonicalTransfer(getSqlite(), head.id)).toEqual(expected.proof);
  const environment = paletteContentEnvironment();
  const actual = await withSystemContentAccess(getSqlite(), systemsDir, [id], async lease =>
    readOwnedCanonical(environment, await observeSystemContent(environment, id, lease), lease));
  expect(actual).toEqual(expected);
  expect((await readDesignSystemPalette(id)).state).toEqual(theme.palette);
  expect(await getDesignSystemDetail(system.id)).toBeNull();
});

test.each(["outer-committed", "owner-removed"] as const)(
  "Given an owned canonical import interrupted at %s When outer and v1 recovery run Then the same prepared owner commits",
  async boundary => {
    const { archive, theme } = await savedCanonicalBundle();
    const captured: string[] = [];
    await expect(importProjectBundleFile(new File([archive.bytes], archive.filename), "Canonical recovery", {
      atBoundary: async (name, owner) => {
        if (name !== boundary) return;
        if (owner.systemId === null) throw new Error("Missing canonical import owner");
        createdProjectIds.push(owner.projectId);
        createdSystemIds.push(owner.systemId);
        captured.push(owner.systemId);
        throw new Error("injected canonical import interruption");
      },
    })).rejects.toMatchObject({ code: "project_bundle_unavailable" });
    const id = captured[0];
    if (id === undefined) throw new Error("Missing interrupted system");
    const pending = getPendingSystemOperation(getSqlite(), id);
    if (pending === null) throw new Error("Missing prepared canonical receipt");

    await reconcileProjectBundleImports(getSqlite());
    const recovery = await reconcileExtractionState();

    expect(recovery.failed).toBe(0);
    expect(getCurrentSystemContent(getSqlite(), id)?.id).toBe(pending.id);
    expect(readCanonicalTransfer(getSqlite(), pending.id)).toEqual(canonicalFiles(theme).proof);
    const environment = paletteContentEnvironment();
    const actual = await withSystemContentAccess(getSqlite(), systemsDir, [id], async lease =>
      readOwnedCanonical(environment, await observeSystemContent(environment, id, lease), lease));
    expect(actual?.theme).toEqual(theme);
    expect(await readdir(projectBundleImportReceiptsDir())).toEqual([]);
  },
);

test("Given an authenticated saved palette When exported and imported after its source is deleted Then the new owner reopens and saves independently", async () => {
  // Given
  const { project: source, system, state, archive } = await savedPaletteBundle();
  expect(archive.manifest.design_system).toMatchObject({ kind: "custom", palette_transfer: { schema_version: 1 } });
  const originalCss = await readFile(path.join(system.dir_path, "colors_and_type.css"), "utf8");
  getSqlite().prepare("DELETE FROM projects WHERE id=?").run(source.id);
  await rm(source.dir_path, { recursive: true, force: true });
  getSqlite().prepare("DELETE FROM design_systems WHERE id=?").run(system.id);
  await rm(system.dir_path, { recursive: true, force: true });
  // When
  const restored = await importProjectBundleFile(new File([archive.bytes], archive.filename), "Portable palette");
  createdProjectIds.push(restored.id);
  const detail = await getProjectDetail(restored.id);
  if (!detail?.design_system_id) throw new Error("Missing palette import system");
  createdSystemIds.push(detail.design_system_id);
  const imported = await getDesignSystemDetail(detail.design_system_id);
  if (imported === null) throw new Error("Missing palette import row");
  const head = getCurrentSystemContent(getSqlite(), imported.id);
  // Then
  expect(head).toMatchObject({ schemaVersion: 1, contentRevision: 1, status: "committed" });
  if (head === null) throw new Error("Missing transfer receipt");
  expect(readPaletteTransfer(getSqlite(), head.id)).toEqual(
    archive.manifest.design_system.kind === "custom" ? archive.manifest.design_system.palette_transfer ?? null : null,
  );
  const reopened = await readDesignSystemPalette(imported.id);
  expect(reopened.state).toEqual(state);
  expect(reopened.css).toBe(emitPaletteCss(state));
  const changed = { ...state, display: { ...state.display, appearance: "dark" as const } };
  const saved = await saveDesignSystemPalette(imported.id, { expected_digest: reopened.expected_digest, state: changed });
  expect(saved.state).toEqual(changed);
  expect((await readDesignSystemPalette(imported.id)).css).toBe(emitPaletteCss(changed));
  expect(await readFile(path.join(imported.dir_path, "colors_and_type.css"), "utf8")).toBe(originalCss);
  expect(await getDesignSystemDetail(system.id)).toBeNull();
});

test.each(["missing", "null", "unknown", "hash", "partial", "alias", "extra", "emitter"] as const)(
  "Given a palette bundle with %s transfer evidence When imported Then no new project or system is created",
  async fault => {
    const { archive } = await savedPaletteBundle();
    const zip = await JSZip.loadAsync(archive.bytes);
    const manifest = structuredClone(archive.manifest);
    if (manifest.design_system.kind !== "custom" || manifest.design_system.palette_transfer === undefined) throw new Error("Missing proof fixture");
    const proof = manifest.design_system.palette_transfer;
    let descriptor: unknown = manifest.design_system;
    let files = manifest.files;
    if (fault === "missing") {
      const { palette_transfer: _proof, ...unproved } = manifest.design_system;
      descriptor = unproved;
    } else if (fault === "null") descriptor = { ...manifest.design_system, palette_transfer: null };
    else if (fault === "unknown") descriptor = { ...manifest.design_system, palette_transfer: { ...proof, receipt_id: "untrusted-owner" } };
    else if (fault === "hash") descriptor = { ...manifest.design_system, palette_transfer: { ...proof, css: { ...proof.css, sha256: "0".repeat(64) } } };
    else if (fault === "partial") {
      zip.remove("design-system/palette/scales.css");
      files = files.filter(file => file.path !== "design-system/palette/scales.css");
    } else if (fault === "alias") {
      const bytes = await zip.file("design-system/palette/state.json")?.async("uint8array");
      if (bytes === undefined) throw new Error("Missing state fixture");
      zip.remove("design-system/palette/state.json");
      zip.file("design-system/Palette/state.json", bytes);
      files = files.map(file => file.path === "design-system/palette/state.json" ? { ...file, path: "design-system/Palette/state.json" } : file);
    } else if (fault === "extra") {
      zip.file("design-system/palette/extra.txt", "extra");
      files = [...files, { path: "design-system/palette/extra.txt", kind: "design_system", size_bytes: 5, sha256: createHash("sha256").update("extra").digest("hex") }];
    } else descriptor = { ...manifest.design_system, palette_transfer: { ...proof, emitter_version: "unrecognised-emitter" } };
    zip.file(PROJECT_BUNDLE_MANIFEST_PATH, JSON.stringify({ ...manifest, files, design_system: descriptor }));
    const file = new File([new Uint8Array(await zip.generateAsync({ type: "uint8array" }))], "invalid-palette.burnguard-project");
    const db = getSqlite();
    const count = () => [
      db.query<{ count: number }, []>("SELECT count(*) count FROM projects").get()?.count,
      db.query<{ count: number }, []>("SELECT count(*) count FROM design_systems").get()?.count,
      db.query<{ count: number }, []>("SELECT count(*) count FROM design_system_palette_transfers").get()?.count,
    ];
    const before = count();
    await expect(importProjectBundleFile(file)).rejects.toMatchObject({ code: fault === "hash" ? "project_bundle_digest" : "invalid_project_bundle" });
    expect(count()).toEqual(before);
    expect(await readdir(projectBundleImportReceiptsDir())).toEqual([]);
  },
);

const canonicalDeclaration = {
  schema_version: 1,
  emitter_version: "burnguard-canonical-1",
  json: { size_bytes: 1200, sha256: "a".repeat(64) },
  css: { size_bytes: 800, sha256: "b".repeat(64) },
  skill: { size_bytes: 400, sha256: "c".repeat(64) },
} as const;

let canonicalDeclarationBase: Promise<ProjectBundleManifest> | undefined;
async function canonicalDeclarationInput(): Promise<ProjectBundleManifest> {
  // These parser cases need independent values, not a fresh filesystem export for each mutation.
  canonicalDeclarationBase ??= savedPaletteBundle().then(({ archive }) => archive.manifest);
  return structuredClone(await canonicalDeclarationBase);
}

async function canonicalDeclarationManifest(canonical_transfer: unknown, withPalette = true): Promise<unknown> {
  const manifest = await canonicalDeclarationInput();
  if (manifest.design_system.kind !== "custom" || manifest.design_system.palette_transfer === undefined) throw new Error("Missing proof fixture");
  const { palette_transfer, ...rest } = manifest.design_system;
  return { ...manifest, design_system: { ...rest, ...(withPalette ? { palette_transfer } : {}), canonical_transfer } };
}

test("Given a custom descriptor with palette and canonical declarations When parsed Then both machine declarations are preserved and legacy descriptors stay unchanged", async () => {
  const declared = await canonicalDeclarationInput();
  if (declared.design_system.kind !== "custom") throw new Error("Missing custom descriptor");
  const parsed = parseProjectBundleManifest({ ...declared, design_system: { ...declared.design_system, canonical_transfer: canonicalDeclaration } });
  if (parsed.design_system.kind !== "custom") throw new Error("Missing custom descriptor");
  expect(parsed.design_system.canonical_transfer).toEqual(canonicalDeclaration);
  expect(parsed.design_system.palette_transfer).toEqual(declared.design_system.palette_transfer);
  const legacy = parseProjectBundleManifest(JSON.parse(JSON.stringify(declared)));
  if (legacy.design_system.kind !== "custom") throw new Error("Missing legacy descriptor");
  expect("canonical_transfer" in legacy.design_system).toBe(false);
  expect(legacy.design_system.palette_transfer).toEqual(declared.design_system.palette_transfer);
});

test.each([
  "null", "version", "emitter", "short_digest", "upper_digest", "zero_length", "oversized_json", "oversized_css",
  "oversized_skill", "fractional_length", "extra_field", "extra_member_field", "missing_member",
] as const)("Given a canonical declaration with %s When parsed Then the closed schema rejects it", async fault => {
  const bad: Record<typeof fault, unknown> = {
    null: null,
    version: { ...canonicalDeclaration, schema_version: 2 },
    emitter: { ...canonicalDeclaration, emitter_version: "unrecognised-emitter" },
    short_digest: { ...canonicalDeclaration, css: { ...canonicalDeclaration.css, sha256: "b".repeat(63) } },
    upper_digest: { ...canonicalDeclaration, css: { ...canonicalDeclaration.css, sha256: "B".repeat(64) } },
    zero_length: { ...canonicalDeclaration, skill: { ...canonicalDeclaration.skill, size_bytes: 0 } },
    oversized_json: { ...canonicalDeclaration, json: { ...canonicalDeclaration.json, size_bytes: 262145 } },
    oversized_css: { ...canonicalDeclaration, css: { ...canonicalDeclaration.css, size_bytes: 262145 } },
    oversized_skill: { ...canonicalDeclaration, skill: { ...canonicalDeclaration.skill, size_bytes: 65537 } },
    fractional_length: { ...canonicalDeclaration, json: { ...canonicalDeclaration.json, size_bytes: 1.5 } },
    extra_field: { ...canonicalDeclaration, receipt_id: "untrusted-owner" },
    extra_member_field: { ...canonicalDeclaration, json: { ...canonicalDeclaration.json, path: "canonical/theme.json" } },
    missing_member: { schema_version: 1, emitter_version: canonicalDeclaration.emitter_version, json: canonicalDeclaration.json, css: canonicalDeclaration.css },
  };
  const manifest = await canonicalDeclarationManifest(bad[fault]);
  expect(() => parseProjectBundleManifest(manifest)).toThrow("invalid_project_bundle_manifest");
});

test("Given a canonical declaration without a palette declaration When parsed Then the descriptor is rejected", async () => {
  const manifest = await canonicalDeclarationManifest(canonicalDeclaration, false);
  expect(() => parseProjectBundleManifest(manifest)).toThrow("invalid_project_bundle_manifest");
});

test("Given a canonical declaration on a non-custom descriptor When parsed Then the closed descriptor rejects it", async () => {
  const manifest = await canonicalDeclarationManifest(canonicalDeclaration);
  if (typeof manifest !== "object" || manifest === null) throw new Error("Missing manifest fixture");
  for (const descriptor of [
    { kind: "none", pin: null, canonical_transfer: canonicalDeclaration },
    { kind: "builtin", id: "builtin-theme-fixture", pin: null, canonical_transfer: canonicalDeclaration },
  ]) {
    expect(() => parseProjectBundleManifest({ ...manifest, design_system: descriptor })).toThrow("invalid_project_bundle_manifest");
  }
});

test.each(["valid", "unproved", "missing", "extra", "case", "hash", "size", "kind"] as const)(
  "Given canonical file declarations with %s When bound to their proof Then only exact members are accepted",
  async fault => {
    const manifest = parseProjectBundleManifest(await canonicalDeclarationManifest(canonicalDeclaration));
    if (manifest.design_system.kind !== "custom") throw new Error("Missing custom descriptor");
    let system = manifest.design_system;
    let files: ProjectBundleFile[] = [
      { path: "design-system/canonical/theme.json", kind: "design_system", ...canonicalDeclaration.json },
      { path: "design-system/canonical/theme.css", kind: "design_system", ...canonicalDeclaration.css },
      { path: "design-system/canonical/SKILL.md", kind: "design_system", ...canonicalDeclaration.skill },
    ];
    const first = files[0];
    if (first === undefined) throw new Error("Missing canonical file");
    switch (fault) {
      case "valid": break;
      case "unproved": {
        const { canonical_transfer: _proof, ...legacy } = system;
        system = legacy;
        break;
      }
      case "missing": files = files.slice(1); break;
      case "extra": files.push({ ...first, path: "design-system/canonical/extra.json" }); break;
      case "case": files[0] = { ...first, path: "design-system/Canonical/theme.json" }; break;
      case "hash": files[0] = { ...first, sha256: "0".repeat(64) }; break;
      case "size": files[0] = { ...first, size_bytes: first.size_bytes + 1 }; break;
      case "kind": files[0] = { ...first, kind: "project" }; break;
      default: throw new Error("Unexpected declaration case");
    }
    if (fault === "valid") expect(() => validateProjectBundleCanonicalFiles(system, files)).not.toThrow();
    else {
      const code = fault === "hash" || fault === "size" ? "project_bundle_digest" : "invalid_project_bundle";
      expect(() => validateProjectBundleCanonicalFiles(system, files)).toThrow(code);
    }
  },
);

test("Given an unowned deterministic palette lookalike When exporting Then exact bytes alone do not grant transfer authority", async () => {
  const { project, system } = await bundleFixture();
  const state = createDefaultPalette();
  await mkdir(path.join(system.dir_path, "palette"));
  await writeFile(path.join(system.dir_path, "palette", "state.json"), serializePalette(state));
  await writeFile(path.join(system.dir_path, "palette", "scales.css"), emitPaletteCss(state));
  await expect(exportProjectBundle(project.id)).rejects.toMatchObject({ code: "project_bundle_unavailable" });
  expect(getSqlite().query<{ count: number }, [string]>(`SELECT count(*) count FROM design_system_palette_transfers p
    JOIN design_system_receipts r ON r.id=p.receipt_id WHERE r.design_system_id=?`).get(system.id)?.count).toBe(0);
});

test.each(legacyEmitter.cases)(
  "Given an explicitly imported unsigned legacy $name declaration When reopened Then raw pair bytes survive until explicit Save",
  async pair => {
    const { archive } = await savedPaletteBundle();
    const zip = await JSZip.loadAsync(archive.bytes);
    const json = pair.json;
    const file = (name: string, bytes: string) => ({
      path: `design-system/palette/${name}`, kind: "design_system" as const,
      size_bytes: Buffer.byteLength(bytes), sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    const stateFile = file("state.json", json), cssFile = file("scales.css", pair.css);
    if (archive.manifest.design_system.kind !== "custom") throw new Error("Missing custom descriptor");
    const declaration = { schema_version: 1, emitter_version: "burnguard-palette-1",
      state: { size_bytes: stateFile.size_bytes, sha256: stateFile.sha256 },
      css: { size_bytes: cssFile.size_bytes, sha256: cssFile.sha256 } };
    zip.file(stateFile.path, json);
    zip.file(cssFile.path, pair.css);
    zip.file(PROJECT_BUNDLE_MANIFEST_PATH, JSON.stringify({
      ...archive.manifest,
      files: [...archive.manifest.files.filter(file => !file.path.startsWith("design-system/palette/")), stateFile, cssFile],
      design_system: { ...archive.manifest.design_system, palette_transfer: declaration },
    }));
    const imported = await importProjectBundleFile(new File([new Uint8Array(await zip.generateAsync({ type: "uint8array" }))], "legacy.burnguard-project"));
    createdProjectIds.push(imported.id);
    const project = await getProjectDetail(imported.id);
    if (!project?.design_system_id) throw new Error("Missing imported legacy system");
    const id = project.design_system_id;
    createdSystemIds.push(id);
    const reopened = await readDesignSystemPalette(id);
    expect(reopened.css).toBe(pair.css);
    expect(await readFile(path.join(systemsDir, id, "palette/state.json"), "utf8")).toBe(json);
    expect(await readFile(path.join(systemsDir, id, "palette/scales.css"), "utf8")).toBe(pair.css);
    if (reopened.state === null) throw new Error("Missing legacy state");
    const saved = await saveDesignSystemPalette(id, { expected_digest: reopened.expected_digest, state: reopened.state });
    expect(saved.css).toBe(emitPaletteCss(reopened.state));
    expect(saved.css).not.toBe(pair.css);
  },
);

test("Given an imported palette proof before outer commit When import rolls back Then its receipt and proof disappear together", async () => {
  const { archive } = await savedPaletteBundle();
  let target: { readonly systemId: string; readonly receiptId: string; readonly projectId: string } | undefined;
  await expect(importProjectBundleFile(new File([archive.bytes], archive.filename), "Proof rollback", {
    atBoundary: async (boundary, owner) => {
      if (boundary !== "before-commit" || owner.systemId === null) return;
      const receipt = getPendingSystemOperation(getSqlite(), owner.systemId);
      if (receipt === null) throw new Error("Missing prepared transfer");
      target = { systemId: owner.systemId, receiptId: receipt.id, projectId: owner.projectId };
      expect(receipt).toMatchObject({ schemaVersion: 1, contentRevision: 1, status: "prepared" });
      expect(readPaletteTransfer(getSqlite(), receipt.id)).not.toBeNull();
      throw new ProjectBundleError("project_bundle_digest");
    },
  })).rejects.toMatchObject({ code: "project_bundle_digest" });
  if (target === undefined) throw new Error("Missing rollback target");
  expect(await getProjectDetail(target.projectId)).toBeNull();
  expect(await getDesignSystemDetail(target.systemId)).toBeNull();
  expect(readPaletteTransfer(getSqlite(), target.receiptId)).toBeNull();
  expect(await exists(path.join(systemsDir, target.systemId))).toBe(false);
});

test.each(["pair", "proof-hash", "proof-missing"] as const)(
  "Given prepared palette ownership When %s diverges before outer commit Then the incomplete import rolls back",
  async fault => {
    const { archive } = await savedPaletteBundle();
    let systemId: string | undefined;
    await expect(importProjectBundleFile(new File([archive.bytes], archive.filename), "Changed transfer", {
      atBoundary: async (boundary, owner) => {
        if (boundary !== "before-commit" || owner.systemId === null) return;
        systemId = owner.systemId;
        const receipt = getPendingSystemOperation(getSqlite(), owner.systemId);
        if (receipt === null) throw new Error("Missing prepared owner");
        if (fault === "pair") {
          const state = path.join(systemsDir, owner.systemId, "palette/state.json");
          await writeFile(state, `${await readFile(state, "utf8")} `);
        } else if (fault === "proof-hash") {
          getSqlite().query("UPDATE design_system_palette_transfers SET state_sha256=? WHERE receipt_id=?").run("0".repeat(64), receipt.id);
        } else getSqlite().query("DELETE FROM design_system_palette_transfers WHERE receipt_id=?").run(receipt.id);
      },
    })).rejects.toMatchObject({ code: "project_bundle_digest" });
    if (systemId === undefined) throw new Error("Missing rejected import");
    expect(await getDesignSystemDetail(systemId)).toBeNull();
    expect(await exists(path.join(systemsDir, systemId))).toBe(false);
  },
);

beforeAll(async () => {
  await runMigrations();
  await mkdir(path.join(sourceProjectDir, ".attachments"), { recursive: true });
  await mkdir(path.join(sourceProjectDir, ".meta", "checkpoints", "snapshots", "turn-1"), { recursive: true });
  await mkdir(path.join(sourceProjectDir, "assets"), { recursive: true });
  await mkdir(path.join(sourceProjectDir, "docs", "attachments"), { recursive: true });
  await mkdir(path.join(sourceSystemDir, "fonts"), { recursive: true });
  await writeFile(path.join(sourceProjectDir, "index.html"), '<link rel="stylesheet" href="assets/site.css"><h1>portable</h1>');
  await writeFile(path.join(sourceProjectDir, "assets", "site.css"), 'body{font-family:"Bundle Missing Font QA"}');
  await writeFile(path.join(sourceProjectDir, ".attachments", "source.txt"), "retained source");
  await writeFile(path.join(sourceProjectDir, "docs", "attachments", "brief.md"), "# Retained brief");
  await writeFile(path.join(sourceProjectDir, ".meta", "checkpoints", "turn-1.json"), JSON.stringify({ turn_id: "turn-1", created_at: 11 }));
  await writeFile(path.join(sourceProjectDir, ".meta", "checkpoints", "snapshots", "turn-1", "index.html"), "<h1>before</h1>");
  await writeFile(path.join(sourceSystemDir, "SKILL.md"), "# Custom system");
  await writeFile(path.join(sourceSystemDir, "colors_and_type.css"), ':root{--brand:#123456;font-family:"Bundle Missing Font QA"}');
  await writeFile(path.join(sourceSystemDir, "fonts", "custom.woff2"), Buffer.from("wOF2custom"));
  await writeFile(path.join(sourceSystemDir, "README.md"), "# Custom system");
  await writeFile(path.join(sourceSystemDir, "fonts", "fonts.css"), "");
  const sidecarContent = { entries: [{ path: "SKILL.md" }] };
  await writeFile(path.join(sourceSystemDir, "extraction-provenance.json"), JSON.stringify({
    schema_version: 1, digest_algorithm: "sha256", generated_at: 1, content: sidecarContent,
    content_digest: createHash("sha256").update(JSON.stringify(sidecarContent)).digest("hex"),
  }));
  const tree = await inspectCanonicalTree(sourceProjectDir);
  const context = "custom pinned context";
  const tokens = ":root{--brand:#123456}";
  const pinDigest = createHash("sha256").update(JSON.stringify([context, tokens])).digest("hex");
  const db = getSqlite();
  db.prepare("INSERT INTO design_systems(id,name,description,status,source_type,is_template,dir_path,skill_md_path,tokens_css_path,readme_md_path,created_at,updated_at) VALUES (?,?,?,'published','manual',0,?,?,?,NULL,1,1)")
    .run(sourceSystemId, "Custom portable system", "description", sourceSystemDir, path.join(sourceSystemDir, "SKILL.md"), path.join(sourceSystemDir, "colors_and_type.css"));
  db.prepare("INSERT INTO projects(id,name,type,design_system_id,dir_path,entrypoint,backend_id,options_json,created_at,updated_at,current_revision,current_digest) VALUES (?,?,'prototype',?,?,'index.html','codex',NULL,1,1,7,?)")
    .run(sourceProjectId, "Portable source", sourceSystemId, sourceProjectDir, tree.tree_digest);
  db.prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)")
    .run(sourceSessionId, sourceProjectId);
  db.prepare("INSERT INTO attachments(id,session_id,turn_id,file_path,mime_type,original_name,size_bytes,sha256,source_role,source_role_explicit,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,1)")
    .run(`attachment-${suffix}`, sourceSessionId, "turn-1", path.join(sourceProjectDir, ".attachments", "source.txt"), "text/plain", "source.txt", 15, createHash("sha256").update("retained source").digest("hex"), "ordinary_content", 1);
  db.prepare("INSERT INTO project_design_system_pins(project_id,system_id,revision,digest,context,tokens) VALUES (?,?,3,?,?,?)")
    .run(sourceProjectId, sourceSystemId, pinDigest, context, tokens);
  createdProjectIds.push(sourceProjectId);
  createdSystemIds.push(sourceSystemId);
});

afterAll(async () => {
  const db = getSqlite();
  for (const projectId of createdProjectIds) {
    const project = await getProjectDetail(projectId);
    db.prepare("DELETE FROM projects WHERE id=?").run(projectId);
    if (project) await rm(project.dir_path, { recursive: true, force: true });
  }
  for (const systemId of createdSystemIds) {
    const row = db.query<{ dir_path: string }, [string]>("SELECT dir_path FROM design_systems WHERE id=?").get(systemId);
    db.prepare("DELETE FROM design_systems WHERE id=?").run(systemId);
    if (row) await rm(row.dir_path, { recursive: true, force: true });
  }
});

test.each(["collection", "materialized"] as const)(
  "Given bundle %s paused under system access When palette publication queues Then old and following archives contain complete revisions",
  async boundary => {
    // Given
    const originalSource = await inspectCanonicalTree(sourceSystemDir);
    const { project, system } = await bundleFixture();
    const initial = await readDesignSystemPalette(system.id);
    const oldState = createDefaultPalette();
    const old = await saveDesignSystemPalette(system.id, { expected_digest: initial.expected_digest, state: oldState });
    if (old.receipt_id === null) throw new Error("Missing old palette receipt");
    const nextState = { ...oldState, display: { ...oldState.display, appearance: "dark" as const } };
    const pin = readProjectDesignSystemPin(project.id);
    const entered = signal(), release = signal(), queued = signal();
    const pause = async () => {
      expect(isArtifactProjectBusy(getSqlite(), project.id)).toBe(true);
      entered.resolve();
      await release.promise;
    };
    const exporting = exportProjectBundle(project.id, boundary === "collection"
      ? { afterSystemRead: pause } : { onSnapshot: pause });
    let saving: ReturnType<typeof saveDesignSystemPalette> | undefined;
    let confirmation: Promise<ReturnType<typeof getCurrentSystemContent>> | undefined;
    try {
      await bounded(Promise.race([entered.promise, exporting.then(() => { throw new Error("Missing bundle snapshot barrier"); })]));
      // When: a following real scheduler event proves Save has also requested access.
      saving = saveDesignSystemPalette(system.id, { expected_digest: old.expected_digest, state: nextState });
      confirmation = withCatalogSnapshot(getSqlite(), systemsDir, system.id,
        async () => getCurrentSystemContent(getSqlite(), system.id), { onAccessQueued: queued.resolve });
      await bounded(queued.promise);
      expect(getCurrentSystemContent(getSqlite(), system.id)?.id).toBe(old.receipt_id);
    } finally { release.resolve(); }
    const [oldArchive, saved, confirmed] = await bounded(Promise.all([exporting, saving, confirmation]));
    if (saved === undefined || saved.receipt_id === null) throw new Error("Missing palette save");
    expect(confirmed?.id).toBe(saved.receipt_id);
    const following = await exportProjectBundle(project.id);
    // Then: archive bytes were owned before release; neither JSON/CSS pair lazily reopens live paths.
    for (const [archive, state] of [[oldArchive, oldState], [following, nextState]] as const) {
      const zip = await JSZip.loadAsync(archive.bytes);
      expect(await zip.file("design-system/palette/state.json")?.async("text")).toBe(serializePalette(state));
      expect(await zip.file("design-system/palette/scales.css")?.async("text")).toBe(emitPaletteCss(state));
      const portable = archive.manifest.design_system.pin;
      expect(portable).toEqual(pin === null ? null : { revision: pin.revision, digest: pin.digest, context: pin.context, tokens: pin.tokens });
      if (portable !== null) {
        expect(portable.digest).toBe(createHash("sha256").update(JSON.stringify([portable.context, portable.tokens])).digest("hex"));
      }
    }
    expect(await inspectCanonicalTree(sourceSystemDir)).toEqual(originalSource);
    expect(isArtifactProjectBusy(getSqlite(), project.id)).toBe(false);
  },
);

test.each(["metadata", "pin"] as const)(
  "Given bundle bytes collected When external %s changes before confirmation Then export rejects the inconsistent snapshot",
  async kind => {
    const { project, system } = await bundleFixture();
    await expect(exportProjectBundle(project.id, { afterSystemRead: async () => {
      if (kind === "metadata") getSqlite().prepare("UPDATE design_systems SET name=? WHERE id=?").run("Changed metadata", system.id);
      else {
        const pin = readProjectDesignSystemPin(project.id);
        if (pin === null) throw new Error("Missing fixture pin");
        const tokens = `${pin.tokens}\n/* concurrent pin */`;
        const digest = createHash("sha256").update(JSON.stringify([pin.context, tokens])).digest("hex");
        getSqlite().prepare("UPDATE project_design_system_pins SET tokens=?,digest=? WHERE project_id=?").run(tokens, digest, project.id);
      }
    } })).rejects.toMatchObject({ code: "project_bundle_unavailable" });
    expect(isArtifactProjectBusy(getSqlite(), project.id)).toBe(false);
  },
);

test.each(["system-restored", "before-commit", "outer-committed", "owner-removed"] as const)(
  "Given an import paused at %s When an ordinary token writer queues Then only the committed outer import releases its reserved ID",
  async boundary => {
    // Given
    const originalSource = await inspectCanonicalTree(sourceSystemDir);
    const exported = await exportProjectBundle(sourceProjectId);
    const entered = signal(), release = signal(), queued = signal();
    let systemId: string | null = null;
    const importing = importProjectBundleFile(new File([exported.bytes], exported.filename), "Reserved import", {
      atBoundary: async (name, owner) => {
        if (name !== boundary) return;
        systemId = owner.systemId;
        expect(isArtifactProjectBusy(getSqlite(), owner.projectId)).toBe(true);
        entered.resolve();
        await release.promise;
      },
    });
    let editing: ReturnType<typeof upsertDesignSystemColorToken> | undefined;
    let pendingReceiptId: string | undefined;
    try {
      await bounded(Promise.race([entered.promise, importing.then(() => { throw new Error("Missing import reservation barrier"); })]));
      if (systemId === null) throw new Error("Missing reserved ID");
      const pending = getPendingSystemOperation(getSqlite(), systemId);
      expect(pending).toMatchObject({ status: "prepared", schemaVersion: 1, contentRevision: 1 });
      pendingReceiptId = pending?.id;
      // When
      editing = upsertDesignSystemColorToken(systemId, { name: "reserved-brand", value: "#abcdef" }, {
        ...authoringContentEnvironment(), onAccessQueued: queued.resolve,
      });
      await bounded(queued.promise);
      expect(getCurrentSystemContent(getSqlite(), systemId)).toBeNull();
      expect(getPendingSystemOperation(getSqlite(), systemId)?.id).toBe(pendingReceiptId);
    } finally { release.resolve(); }
    const [restored, updated] = await bounded(Promise.all([importing, editing]));
    createdProjectIds.push(restored.id);
    const project = await getProjectDetail(restored.id);
    if (!project?.design_system_id) throw new Error("Missing imported system");
    createdSystemIds.push(project.design_system_id);
    // Then
    expect(updated?.colors).toContainEqual({ name: "reserved-brand", value: "#abcdef" });
    expect(getSqlite().query("SELECT status,schema_version FROM design_system_receipts WHERE id=?").get(pendingReceiptId ?? "missing"))
      .toEqual({ status: "committed", schema_version: 1 });
    expect(getCurrentSystemContent(getSqlite(), project.design_system_id)).toMatchObject({ schemaVersion: 2, contentRevision: 2, status: "committed" });
    const pin = readProjectDesignSystemPin(restored.id);
    expect(pin?.digest).toBe(createHash("sha256").update(JSON.stringify([pin?.context, pin?.tokens])).digest("hex"));
    expect(await exists(path.join(systemsDir, project.design_system_id, ".meta", "bundle-import-owner.json"))).toBe(false);
    expect(await inspectCanonicalTree(sourceSystemDir)).toEqual(originalSource);
  },
);

test("Given a reserved import with failed row cleanup When the request fails Then its prepared v1 owner blocks edits until outer recovery", async () => {
  const exported = await exportProjectBundle(sourceProjectId);
  const originalSource = await inspectCanonicalTree(sourceSystemDir);
  let systemId: string | null = null;
  let operationId: string | null = null;
  let preserved: Awaited<ReturnType<typeof inspectCanonicalTree>> | undefined;
  const db = getSqlite();
  try {
    await expect(importProjectBundleFile(new File([exported.bytes], exported.filename), "Held cleanup", {
      atBoundary: async (name, owner) => {
        if (name !== "before-commit" || owner.systemId === null) return;
        systemId = owner.systemId;
        operationId = owner.operationId;
        preserved = await inspectCanonicalTree(path.join(systemsDir, owner.systemId));
        db.exec(`CREATE TEMP TRIGGER consumer_hold_bundle_cleanup BEFORE DELETE ON design_systems
          WHEN OLD.id='${owner.systemId}' BEGIN SELECT RAISE(ABORT,'fixture cleanup hold'); END`);
        throw new ProjectBundleError("project_bundle_digest");
      },
    })).rejects.toMatchObject({ code: "project_bundle_unavailable" });
    if (systemId === null || operationId === null || preserved === undefined) throw new Error("Missing held import ownership");
    expect(getPendingSystemOperation(db, systemId)).toMatchObject({ schemaVersion: 1, status: "prepared" });
    expect(await inspectCanonicalTree(path.join(systemsDir, systemId))).toEqual(preserved);
    expect(await exists(path.join(projectBundleImportReceiptsDir(), `${operationId}.json`))).toBe(true);
    await expect(upsertDesignSystemColorToken(systemId, { name: "blocked-brand", value: "#abcdef" }))
      .rejects.toMatchObject({ code: "system_content_unavailable" });
  } finally {
    db.exec("DROP TRIGGER IF EXISTS consumer_hold_bundle_cleanup");
    await reconcileProjectBundleImports(db);
  }
  if (systemId === null) throw new Error("Missing recovered ID");
  expect(await getDesignSystemDetail(systemId)).toBeNull();
  expect(await exists(path.join(systemsDir, systemId))).toBe(false);
  expect(await inspectCanonicalTree(sourceSystemDir)).toEqual(originalSource);
});

test("Given a reserved import with a queued editor When publication fails before outer commit Then rollback removes only the new owner", async () => {
  const exported = await exportProjectBundle(sourceProjectId);
  const originalSource = await inspectCanonicalTree(sourceSystemDir);
  const entered = signal(), release = signal(), queued = signal();
  let owner: { readonly systemId: string; readonly projectId: string; readonly operationId: string } | undefined;
  const failing = importProjectBundleFile(new File([exported.bytes], exported.filename), "Rollback import", {
    atBoundary: async (name, value) => {
      if (name !== "before-commit" || value.systemId === null) return;
      owner = { ...value, systemId: value.systemId };
      entered.resolve();
      await release.promise;
      throw new ProjectBundleError("project_bundle_digest");
    },
  }).then(() => { throw new Error("Failed import unexpectedly committed"); }, error => {
    expect(error).toMatchObject({ code: "project_bundle_digest" });
  });
  let editing: Promise<void> | undefined;
  try {
    await bounded(Promise.race([entered.promise, failing.then(() => { throw new Error("Missing rollback barrier"); })]));
    if (owner === undefined) throw new Error("Missing rollback ownership");
    editing = upsertDesignSystemColorToken(owner.systemId, { name: "queued-brand", value: "#abcdef" }, {
      ...authoringContentEnvironment(), onAccessQueued: queued.resolve,
    }).then(() => { throw new Error("Editor entered a rolled-back import"); }, error => {
      expect(error).toMatchObject({ code: "design_system_not_found" });
    });
    await bounded(queued.promise);
    expect(getPendingSystemOperation(getSqlite(), owner.systemId)).toMatchObject({ schemaVersion: 1, status: "prepared" });
  } finally { release.resolve(); }
  await bounded(Promise.all([failing, editing]));
  if (owner === undefined) throw new Error("Missing completed rollback ownership");
  expect(await getProjectDetail(owner.projectId)).toBeNull();
  expect(await getDesignSystemDetail(owner.systemId)).toBeNull();
  expect(getContentReceipt(getSqlite(), owner.systemId)).toBeNull();
  expect(await exists(path.join(projectsDir, owner.projectId))).toBe(false);
  expect(await exists(path.join(systemsDir, owner.systemId))).toBe(false);
  expect(await exists(projectBundleSystemStage(owner.systemId))).toBe(false);
  expect(await exists(path.join(projectBundleImportReceiptsDir(), `${owner.operationId}.json`))).toBe(false);
  expect(await inspectCanonicalTree(sourceSystemDir)).toEqual(originalSource);
});

test("Given an occupied generated destination When import publication reaches it Then rollback preserves the unowned tree", async () => {
  const exported = await exportProjectBundle(sourceProjectId);
  let occupied: string | undefined;
  let reservedId: string | undefined;
  try {
    await expect(importProjectBundleFile(new File([exported.bytes], exported.filename), "Occupied import", {
      atBoundary: async (name, owner) => {
        if (name !== "system-reserved" || owner.systemId === null) return;
        reservedId = owner.systemId;
        occupied = path.join(systemsDir, owner.systemId);
        await mkdir(occupied);
        await writeFile(path.join(occupied, "sentinel.txt"), "unowned bytes\r\n");
      },
    })).rejects.toMatchObject({ code: "project_bundle_unavailable" });
    if (occupied === undefined || reservedId === undefined) throw new Error("Missing collision evidence");
    expect(await readFile(path.join(occupied, "sentinel.txt"), "utf8")).toBe("unowned bytes\r\n");
    expect(await getDesignSystemDetail(reservedId)).toBeNull();
    expect(await exists(projectBundleSystemStage(reservedId))).toBe(false);
  } finally { if (occupied !== undefined) await rm(occupied, { recursive: true, force: true }); }
});

test("Given a durable outer commit When finalization fails Then the imported owner is retained rather than rolled back", async () => {
  const exported = await exportProjectBundle(sourceProjectId);
  let owner: { readonly systemId: string; readonly projectId: string } | undefined;
  let manifest: Awaited<ReturnType<typeof inspectCanonicalTree>> | undefined;
  await expect(importProjectBundleFile(new File([exported.bytes], exported.filename), "Committed finalization", {
    atBoundary: async (name, value) => {
      if (name !== "outer-committed" || value.systemId === null) return;
      owner = { systemId: value.systemId, projectId: value.projectId };
      createdProjectIds.push(value.projectId);
      createdSystemIds.push(value.systemId);
      manifest = await inspectCanonicalTree(path.join(systemsDir, value.systemId));
      throw new ProjectBundleError("project_bundle_unavailable");
    },
  })).rejects.toMatchObject({ code: "project_bundle_unavailable" });
  if (owner === undefined || manifest === undefined) throw new Error("Missing committed ownership");
  await reconcileProjectBundleImports(getSqlite());
  expect(await getProjectDetail(owner.projectId)).not.toBeNull();
  expect(await getDesignSystemDetail(owner.systemId)).not.toBeNull();
  expect(await inspectCanonicalTree(path.join(systemsDir, owner.systemId))).toEqual(manifest);
  expect(getPendingSystemOperation(getSqlite(), owner.systemId)).toMatchObject({ status: "prepared", schemaVersion: 1 });
  await expect(upsertDesignSystemColorToken(owner.systemId, { name: "blocked-brand", value: "#abcdef" }))
    .rejects.toMatchObject({ code: "system_content_unavailable" });
});

test.each((["plain", "palette", "canonical-only"] as const).flatMap(mode =>
  (["system-reserved", "system-restored", "outer-committed", "owner-removed"] as const).map(boundary => ({ mode, boundary }))))(
  "Given a real $mode import stopped at $boundary When its process exits Then outer-first startup recovers only its owned project and single system head",
  async ({ mode, boundary }) => {
    const palette = mode === "canonical-only" ? await savedCanonicalBundle(true)
      : mode === "palette" ? await savedPaletteBundle() : null;
    const exported = palette?.archive ?? await exportProjectBundle(sourceProjectId);
    const originalSource = await inspectCanonicalTree(sourceSystemDir);
    const home = await mkdtemp(path.join(tmpdir(), "bg-bundle-consumer-"));
    const archive = path.join(home, "input.burnguard-project");
    const output = path.join(home, "result.json");
    await writeFile(archive, exported.bytes);
    const probe = path.join(import.meta.dir, "fixtures/bundle-consumer-recovery-probe.ts");
    const environment = Object.fromEntries(["PATH", "TMPDIR", "NODE_PATH"].flatMap(key => {
      const value = process.env[key];
      return value === undefined ? [] : [[key, value]];
    }));
    const env = { ...environment, BG_APP_ROOT: path.join(home, "profile"), HOME: home, USERPROFILE: home, BG_NO_OPEN: "1" };
    const creator = Bun.spawn([process.execPath, probe, "prepare", boundary, archive, output], {
      env, stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    const creatorExit = creator.exited;
    const creatorErrors = new Response(creator.stderr).text();
    const reader = creator.stdout.getReader();
    const run = async (phase: string) => {
      const child = Bun.spawn([process.execPath, probe, phase, boundary, archive, output], { env, stdout: "ignore", stderr: "pipe" });
      const exited = child.exited;
      try {
        const [code, errors] = await bounded(Promise.all([exited, new Response(child.stderr).text()]), 90_000);
        expect(code, errors).toBe(0);
      } finally { child.kill(); await child.exited; }
    };
    try {
      // Given: consume the exact durable event, not a clock or a filesystem poll.
      let event = "";
      while (!event.split(/\r?\n/u).includes("BUNDLE_BOUNDARY")) {
        const chunk = await bounded(reader.read());
        if (chunk.done) throw new Error(`Import ended before its boundary: ${await creatorErrors}`);
        event += new TextDecoder().decode(chunk.value);
      }
      const before: unknown = JSON.parse(await readFile(output, "utf8"));
      if (typeof before !== "object" || before === null || !("system_manifest" in before) ||
        !("project_manifest" in before) || !("pin" in before) || !("sidecar" in before)) {
        throw new Error("Invalid import boundary evidence");
      }
      await run("edit");
      // When: a real exit bypasses the import's catch, owner cleanup and both lock releases.
      creator.stdin.write("exit\n");
      creator.stdin.end();
      expect(await bounded(creatorExit), await creatorErrors).toBe(77);
      await run("edit");
      await run("recover");
      const result: unknown = JSON.parse(await readFile(output, "utf8"));
      // Then
      expect(result).toMatchObject({
        before, pending: null, outer_present: false, payload_present: false, stage_present: false, lock_present: false,
      });
      if (boundary === "system-reserved" || boundary === "system-restored") {
        expect(result).toMatchObject({
          first: { system: null, project: null, head: null, pin: null },
          system: null, project: null, head: null, pin: null,
          system_present: false, project_present: false, system_owner: false, project_owner: false,
          palette: null, palette_transfer: null,
          canonical_transfer: null, receipt_count: 0,
        });
      } else {
        expect(result).toMatchObject({
          first: {
            head: { schemaVersion: mode === "canonical-only" ? 2 : 1, contentRevision: 1, status: "committed" },
            system_manifest: before.system_manifest, project_manifest: before.project_manifest, pin: before.pin,
          },
          head: { schemaVersion: mode === "canonical-only" ? 2 : 1, contentRevision: 1, status: "committed" },
          system_manifest: before.system_manifest, project_manifest: before.project_manifest,
          pin: before.pin, sidecar: before.sidecar, system_present: true, project_present: true,
          // Legacy recovery keeps its markers; v2 excludes and removes only its validated outer marker.
          system_owner: mode !== "canonical-only" && boundary === "outer-committed",
          project_owner: mode !== "canonical-only" && boundary === "outer-committed",
          palette: palette === null ? null : { state: palette.state, css: emitPaletteCss(palette.state) },
          palette_transfer: exported.manifest.design_system.kind === "custom" ? exported.manifest.design_system.palette_transfer ?? null : null,
          canonical_transfer: exported.manifest.design_system.kind === "custom" ? exported.manifest.design_system.canonical_transfer ?? null : null,
          receipt_count: 1,
        });
        if (!("pending" in before) || typeof before.pending !== "object" || before.pending === null ||
          !("id" in before.pending) || typeof before.pending.id !== "string") throw new Error("Missing prepared receipt identity");
        expect(result).toMatchObject({ head: { id: before.pending.id } });
      }
      expect(await inspectCanonicalTree(sourceSystemDir)).toEqual(originalSource);
    } finally {
      creator.kill();
      await creatorExit;
      await reader.cancel();
      reader.releaseLock();
      await creatorErrors;
      await rm(home, { recursive: true, force: true });
    }
  }, 120_000,
);

test("Given a project with retained sources, checkpoints, a custom system, and a pin When bundled and imported Then a new editable project restores every portable part", async () => {
  // Given
  const exported = await exportProjectBundle(sourceProjectId);
  const zip = await JSZip.loadAsync(exported.bytes);
  const manifestEntry = zip.file(PROJECT_BUNDLE_MANIFEST_PATH);
  if (!manifestEntry) throw new Error("missing manifest");
  const manifest = parseProjectBundleManifest(JSON.parse(await manifestEntry.async("text")));

  // When
  const restored = await importProjectBundleFile(new File([exported.bytes], exported.filename), "Restored portable");
  createdProjectIds.push(restored.id);
  const project = await getProjectDetail(restored.id);
  if (!project) throw new Error("missing restored project");
  if (project.design_system_id) createdSystemIds.push(project.design_system_id);

  // Then
  expect(restored.id).not.toBe(sourceProjectId);
  expect(project.name).toBe("Restored portable");
  expect(project.current_revision).toBe(7);
  expect(await readFile(path.join(project.dir_path, "index.html"), "utf8")).toContain("portable");
  expect(await readFile(path.join(project.dir_path, ".attachments", "source.txt"), "utf8")).toBe("retained source");
  expect(await readFile(path.join(project.dir_path, "docs", "attachments", "brief.md"), "utf8")).toBe("# Retained brief");
  expect(await readFile(path.join(project.dir_path, ".meta", "checkpoints", "snapshots", "turn-1", "index.html"), "utf8")).toContain("before");
  expect(project.design_system_id).not.toBe(sourceSystemId);
  const restoredPin = readProjectDesignSystemPin(restored.id);
  expect(restoredPin?.system_id).toBe(project.design_system_id ?? "");
  expect(restoredPin?.context).not.toBe(manifest.design_system.pin?.context);
  expect(manifest.credential_exclusions).toContain("config.json");
  expect(restored.warnings).toContainEqual({ code: "missing_font", reference: "Bundle Missing Font QA" });
  const attachments = await listSessionAttachments(restored.session_id);
  const attachment = attachments[0];
  if (!attachment) throw new Error("missing restored attachment");
  expect(attachment.turn_id).toBe("turn-1");
  expect(selectContextAttachments(attachments, [], "continue")).toContain(attachment.file_path);
});

test("Given a restored bundle When startup reconciliation and a new edit run Then the baseline remains usable and revision history advances", async () => {
  // Given
  const exported = await exportProjectBundle(sourceProjectId);
  const restored = await importProjectBundleFile(new File([exported.bytes], exported.filename), "Restored lifecycle");
  createdProjectIds.push(restored.id);
  const before = await getProjectDetail(restored.id);
  if (!before?.current_digest) throw new Error("missing restored identity");
  if (before.design_system_id) createdSystemIds.push(before.design_system_id);

  // When
  await reconcileArtifactState(getSqlite());
  const operation = await new ArtifactCoordinator(getSqlite()).run({
    projectId: restored.id,
    projectDir: before.dir_path,
    kind: "turn",
    expectedRevision: before.current_revision,
    expectedArtifactDigest: before.current_digest,
    mutate: async (stage) => { await writeFile(path.join(stage, "after-restore.html"), "<h1>editable</h1>"); },
  });

  // Then
  expect(operation.status).toBe("committed");
  expect(operation.resultRevision).toBe(8);
  expect(await readFile(path.join(before.dir_path, "after-restore.html"), "utf8")).toContain("editable");
});

test("Given a bundle that references an unavailable builtin system When imported Then its archived pin stays inert and a warning identifies the missing ID", async () => {
  // Given
  const exported = await exportProjectBundle(sourceProjectId);
  const zip = await JSZip.loadAsync(exported.bytes);
  const manifestEntry = zip.file(PROJECT_BUNDLE_MANIFEST_PATH);
  if (!manifestEntry) throw new Error("missing manifest");
  const original = parseProjectBundleManifest(JSON.parse(await manifestEntry.async("text")));
  const missingId = "builtin-theme-not-installed";
  for (const file of original.files.filter((entry) => entry.kind === "design_system")) zip.remove(file.path);
  const manifest = {
    ...original,
    files: original.files.filter((entry) => entry.kind !== "design_system"),
    design_system: { kind: "builtin" as const, id: missingId, pin: original.design_system.pin },
    fonts: {
      families: original.fonts.families,
      files: original.fonts.files.filter((filePath) => !filePath.startsWith("design-system/")),
    },
  };
  zip.file(PROJECT_BUNDLE_MANIFEST_PATH, JSON.stringify(manifest));
  const file = new File([new Uint8Array(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }))], "missing-system.burnguard-project");

  // When
  const restored = await importProjectBundleFile(file, "Missing builtin");
  createdProjectIds.push(restored.id);

  // Then
  expect(restored.warnings).toContainEqual({ code: "missing_builtin_design_system", reference: missingId });
  expect((await getProjectDetail(restored.id))?.design_system_id).toBeNull();
  expect(readProjectDesignSystemPin(restored.id)).toBeNull();
});

test("Given an external edit during export When the snapshot is confirmed Then the bundle fails instead of mixing revisions", async () => {
  // Given
  const entrypoint = path.join(sourceProjectDir, "index.html");
  const original = await readFile(entrypoint);

  // When / Then
  try {
    await expect(exportProjectBundle(sourceProjectId, {
      afterProjectRead: async () => { await writeFile(entrypoint, "<h1>racing edit</h1>"); },
    })).rejects.toMatchObject({ code: "project_bundle_unavailable" });
  } finally {
    await writeFile(entrypoint, original);
  }
});

async function rewrittenBundle(mutate: (manifest: ProjectBundleManifest, zip: JSZip) => ProjectBundleManifest): Promise<File> {
  const exported = await exportProjectBundle(sourceProjectId);
  const zip = await JSZip.loadAsync(exported.bytes);
  const entry = zip.file(PROJECT_BUNDLE_MANIFEST_PATH);
  if (!entry) throw new Error("missing manifest");
  const manifest = mutate(parseProjectBundleManifest(JSON.parse(await entry.async("text"))), zip);
  zip.file(PROJECT_BUNDLE_MANIFEST_PATH, JSON.stringify(manifest));
  return new File([new Uint8Array(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }))], "rewritten.burnguard-project");
}

test("Given archived options with unknown fields When imported Then only allowlisted project options are stored", async () => {
  const file = await rewrittenBundle((manifest) => ({
    ...manifest,
    project: { ...manifest.project, options_json: JSON.stringify({ copy_as_is: true, provider_api_key: "sk-bundle-secret", cache_dir: "/Users/someone/private" }) },
  }));

  const restored = await importProjectBundleFile(file, "Options allowlist");
  createdProjectIds.push(restored.id);
  const stored = (await getProjectDetail(restored.id))?.options_json ?? "";
  const detail = await getProjectDetail(restored.id);
  if (detail?.design_system_id) createdSystemIds.push(detail.design_system_id);

  expect(JSON.parse(stored).copy_as_is).toBe(true);
  expect(stored).not.toContain("sk-bundle-secret");
  expect(stored).not.toContain("/Users/someone");
});

test("Given a bundle carrying server scratch inputs When imported Then it is rejected", async () => {
  const payload = new TextEncoder().encode("scratch prompt");
  const file = await rewrittenBundle((manifest, zip) => {
    zip.file("project/.burnguard-inputs/prompt.txt", payload);
    return {
      ...manifest,
      files: [...manifest.files, { path: "project/.burnguard-inputs/prompt.txt", kind: "attachment", size_bytes: payload.byteLength, sha256: createHash("sha256").update(payload).digest("hex") }],
    };
  });

  await expect(importProjectBundleFile(file, "Scratch")).rejects.toMatchObject({ code: "invalid_project_bundle" });
});

test("Given archived template and sample provenance for a custom system When imported Then the copy is a plain manual system", async () => {
  const file = await rewrittenBundle((manifest) => manifest.design_system.kind !== "custom" ? manifest : ({
    ...manifest,
    design_system: { ...manifest.design_system, is_template: true, source_type: "sample" },
  }));

  const restored = await importProjectBundleFile(file, "Provenance");
  createdProjectIds.push(restored.id);
  const detail = await getProjectDetail(restored.id);
  if (!detail?.design_system_id) throw new Error("missing restored system");
  createdSystemIds.push(detail.design_system_id);
  const system = await getDesignSystemDetail(detail.design_system_id);

  expect(system?.is_template).toBe(false);
  expect(system?.source_type).toBe("manual");
});

function addBundleFile(manifest: ProjectBundleManifest, zip: JSZip, archivePath: string, text: string): ProjectBundleManifest {
  const bytes = new TextEncoder().encode(text);
  zip.file(archivePath, bytes);
  return { ...manifest, files: [...manifest.files, { path: archivePath, kind: "design_system", size_bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") }] };
}

test("Given a leftover import receipt from a crash When startup reconciliation runs Then the uncommitted project and system are removed", async () => {
  const exported = await exportProjectBundle(sourceProjectId);
  const restored = await importProjectBundleFile(new File([exported.bytes], exported.filename), "Crashed import");
  const detail = await getProjectDetail(restored.id);
  if (!detail?.design_system_id) throw new Error("missing restored system");
  const operationId = "01J00000000000000000000000";
  await mkdir(projectBundlePayloadStage(operationId), { recursive: true });
  await writeBundleImportOwnerMarker(detail.dir_path, operationId);
  const system = await getDesignSystemDetail(detail.design_system_id);
  if (!system) throw new Error("missing restored system row");
  await writeBundleImportOwnerMarker(system.dir_path, operationId);
  await writeProjectBundleImportReceipt({ schema_version: 1, operation_id: operationId, project_id: restored.id, system_id: detail.design_system_id, phase: "pending" });

  const result = await reconcileProjectBundleImports(getSqlite());

  expect(result.rolled_back).toBe(1);
  expect(await getProjectDetail(restored.id)).toBeNull();
  expect(await getDesignSystemDetail(detail.design_system_id)).toBeNull();
  expect(await readdir(projectBundleImportReceiptsDir())).toEqual([]);
});

test("Given a successful import When it completes Then no import receipt or payload stage is left behind", async () => {
  const exported = await exportProjectBundle(sourceProjectId);
  const restored = await importProjectBundleFile(new File([exported.bytes], exported.filename), "Clean import");
  createdProjectIds.push(restored.id);
  const detail = await getProjectDetail(restored.id);
  if (detail?.design_system_id) createdSystemIds.push(detail.design_system_id);

  expect(await readdir(projectBundleImportReceiptsDir())).toEqual([]);
});

test("Given a restored extraction system When imported Then it carries a committed content receipt that validates against its bytes", async () => {
  const exported = await exportProjectBundle(sourceProjectId);
  const restored = await importProjectBundleFile(new File([exported.bytes], exported.filename), "Catalog receipt");
  createdProjectIds.push(restored.id);
  const detail = await getProjectDetail(restored.id);
  if (!detail?.design_system_id) throw new Error("missing restored system");
  createdSystemIds.push(detail.design_system_id);
  const system = await getDesignSystemDetail(detail.design_system_id);
  const receipt = getContentReceipt(getSqlite(), detail.design_system_id);

  expect(receipt?.status).toBe("committed");
  if (!receipt || !system) throw new Error("missing receipt");
  await expect(validateCatalogReceiptTree(system.dir_path, receipt)).resolves.toBeDefined();
});

test("Given a custom system without a verifiable sidecar When imported Then the bundle is rejected and nothing is left behind", async () => {
  const file = await rewrittenBundle((manifest, zip) => {
    zip.remove("design-system/extraction-provenance.json");
    return { ...manifest, files: manifest.files.filter((entry) => entry.path !== "design-system/extraction-provenance.json") };
  });

  await expect(importProjectBundleFile(file, "No sidecar")).rejects.toMatchObject({ code: "invalid_project_bundle" });
  expect(await readdir(projectBundleImportReceiptsDir())).toEqual([]);
});

test("Given a malformed or path-bearing receipt When startup reconciliation runs Then it is quarantined and deletes nothing", async () => {
  const root = projectBundleImportReceiptsDir();
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "01J00000000000000000000001.json"), JSON.stringify({ schema_version: 1, operation_id: "01J00000000000000000000001", project_id: sourceProjectId, system_id: null, phase: "pending", staging_paths: [projectsDir] }));

  const result = await reconcileProjectBundleImports(getSqlite());

  expect(result.quarantined).toBe(1);
  expect(await getProjectDetail(sourceProjectId)).not.toBeNull();
  await rm(path.join(root, "01J00000000000000000000001.json.quarantined"), { force: true });
});

test("Given a project restored with a missing builtin system When exported again Then the builtin reference survives", async () => {
  const file = await rewrittenBundle((manifest, zip) => {
    for (const entry of manifest.files.filter((item) => item.kind === "design_system")) zip.remove(entry.path);
    return {
      ...manifest,
      files: manifest.files.filter((entry) => entry.kind !== "design_system"),
      design_system: { kind: "builtin", id: "builtin-theme-gone", pin: null },
      fonts: { families: manifest.fonts.families, files: manifest.fonts.files.filter((item) => !item.startsWith("design-system/")) },
    };
  });
  const restored = await importProjectBundleFile(file, "Missing builtin round trip");
  createdProjectIds.push(restored.id);

  const again = await exportProjectBundle(restored.id);

  expect(again.manifest.design_system).toEqual({ kind: "builtin", id: "builtin-theme-gone", pin: null });
});

test("Given a pending receipt naming a project it never marked When startup reconciliation runs Then that project is untouched", async () => {
  const operationId = "01J00000000000000000000002";
  const victim = "01J0000000000000000000ABCD";
  const root = path.join(projectsDir, victim);
  await mkdir(root, { recursive: true });
  getSqlite().prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,created_at,updated_at) VALUES (?,?,'prototype',?,'index.html','codex',1,1)").run(victim, "Unrelated", root);
  createdProjectIds.push(victim);
  await writeProjectBundleImportReceipt({ schema_version: 1, operation_id: operationId, project_id: victim, system_id: null, phase: "pending" });

  await reconcileProjectBundleImports(getSqlite());

  expect(await getProjectDetail(victim)).not.toBeNull();
});

test.skipIf(!canCreateSymlink())(`Given a receipt whose project directory is a link to another project When reconciled Then the link is never followed (${SYMLINK_SKIP_REASON})`, async () => {
  const operationId = "01J00000000000000000000003";
  const linked = "01J0000000000000000000WXYZ";
  await writeBundleImportOwnerMarker(sourceProjectDir, operationId);
  await symlink(sourceProjectDir, path.join(projectsDir, linked), "dir");
  await writeProjectBundleImportReceipt({ schema_version: 1, operation_id: operationId, project_id: linked, system_id: null, phase: "pending" });

  await reconcileProjectBundleImports(getSqlite());

  expect(await readFile(path.join(sourceProjectDir, "index.html"), "utf8")).toContain("portable");
  await removeDirectoryLink(path.join(projectsDir, linked));
  await rm(path.join(sourceProjectDir, ".meta", "bundle-import-owner.json"), { force: true });
});

test("Given a torn checkpoint receipt When the project is bundled Then export succeeds and lists only the readable checkpoints", async () => {
  // Given
  const torn = path.join(sourceProjectDir, ".meta", "checkpoints", "turn-torn.json");
  await writeFile(torn, '{"turn_id":"turn-torn","created_');
  const warnings: string[] = [];
  const warn = spyOn(console, "warn").mockImplementation((...args: unknown[]) => { warnings.push(args.map(String).join(" ")); });
  try {
    // When
    const exported = await exportProjectBundle(sourceProjectId);
    const zip = await JSZip.loadAsync(exported.bytes);
    const manifestEntry = zip.file(PROJECT_BUNDLE_MANIFEST_PATH);
    if (!manifestEntry) throw new Error("missing manifest");
    const manifest = parseProjectBundleManifest(JSON.parse(await manifestEntry.async("text")));

    // Then
    expect(manifest.checkpoints.map((checkpoint) => checkpoint.turn_id)).toEqual(["turn-1"]);
    // The warning is path-free: a receipt name is user-derived and must not reach logs.
    expect(warnings.some((line) => line.includes("turn-torn"))).toBe(false);
  } finally {
    warn.mockRestore();
    await rm(torn, { force: true });
  }
});
