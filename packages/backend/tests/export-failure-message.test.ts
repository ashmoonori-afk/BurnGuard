import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseExportOptions, type SequencedEventEnvelope } from "@bg/shared";
import { runMigrations } from "../src/db/migrate-local";
import { getExportJob } from "../src/db/exports";
import { getSqlite } from "../src/db/sqlite-client";
import { artifactRoutes } from "../src/routes/artifacts";
import { exportsDir, projectsDir } from "../src/lib/paths";
import { ArtifactCoordinator } from "../src/services/artifact-coordinator";
import { sequencedBroker } from "../src/services/broker";
import { RenderSessionError } from "../src/services/export-render-session";
import { cancelProjectExport, enqueueProjectExport, type ExportHooks } from "../src/services/exports";

const ERRNO = /\bE[A-Z]{3,}\b/u;
const created: string[] = [];

async function createProject(kind: string, type: "prototype" | "slide_deck", files: Readonly<Record<string, string>>): Promise<{ readonly projectId: string; readonly sessionId: string }> {
  const projectId = `export-failure-${kind}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const sessionId = `${projectId}-session`;
  const projectDir = path.join(projectsDir, projectId);
  await mkdir(projectDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) await writeFile(path.join(projectDir, name), content);
  const db = getSqlite();
  db.prepare("INSERT INTO projects(id,name,type,dir_path,entrypoint,backend_id,options_json,created_at,updated_at) VALUES (?,?,?,?,'index.html','codex',NULL,1,1)").run(projectId, `Export failure ${kind}`, type, projectDir);
  db.prepare("INSERT INTO sessions(id,project_id,backend_id,status,created_at,updated_at,last_active_at) VALUES (?,?,'codex','idle',1,1,1)").run(sessionId, projectId);
  await new ArtifactCoordinator(db).initialize(projectId, projectDir);
  created.push(projectId);
  return { projectId, sessionId };
}

function terminalStatus(sessionId: string): Promise<string> {
  return new Promise((resolve) => {
    const deadline = setTimeout(() => { unsubscribe(); resolve("timeout"); }, 20_000);
    const unsubscribe = sequencedBroker.subscribe(sessionId, (item: SequencedEventEnvelope) => {
      if (item.event.type === "export.attempt" && ["failed", "cancelled", "validated"].includes(item.event.status)) {
        clearTimeout(deadline); unsubscribe(); resolve(item.event.status);
      }
    });
  });
}

/** Fails the render right after the snapshot so runExport settles the attempt with the given error. */
const failAfterSnapshot = (error: Error, beforeFailure: (attemptId: string) => void = () => {}): ExportHooks => ({
  phase: (attemptId, phase) => { if (phase !== "after_snapshot") return; beforeFailure(attemptId); throw error; },
});

const fsError = (code: string, reason: string, privatePath: string): Error =>
  Object.assign(new Error(`${code}: ${reason}, open '${privatePath}'`), { code, errno: -1, syscall: "open", path: privatePath });

let prototype: { readonly projectId: string; readonly sessionId: string };

async function persistedAfter(hooks: ExportHooks): Promise<{ readonly status: string; readonly message: string }> {
  const settled = terminalStatus(prototype.sessionId);
  const job = await enqueueProjectExport(prototype.projectId, "html_zip", {}, hooks);
  const status = await settled;
  return { status, message: (await getExportJob(job!.id))?.error_message ?? "" };
}

function expectNoPrivateDiagnostic(message: string, privatePath: string, fragments: readonly string[]): void {
  expect(message).not.toBe("");
  expect(message).not.toContain(privatePath);
  expect(message).not.toMatch(ERRNO);
  for (const fragment of fragments) expect(message).not.toContain(fragment);
}

beforeAll(async () => {
  await runMigrations();
  prototype = await createProject("prototype", "prototype", { "index.html": "<!doctype html><html><head><title>Failure</title></head><body><main>Failure</main></body></html>" });
});

afterAll(async () => {
  for (const projectId of created) {
    getSqlite().prepare("DELETE FROM projects WHERE id=?").run(projectId);
    await rm(path.join(projectsDir, projectId), { recursive: true, force: true });
  }
});

const WINDOWS_STAGE = path.win32.join("C:\\Users\\qa\\project", ".burnguard", "cache", "exports", ".staging", "01ATTEMPT", "render", "index.html");
const WINDOWS_UNC = path.win32.join("\\\\fileserver\\profiles", "qa", "data", "projects", "deck", "assets", "logo.svg");
const WINDOWS_CHROME = path.win32.join("C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe");
const LINUX_STAGE = path.posix.join("/home/qa/project", ".burnguard", "cache", "exports", ".staging", "01ATTEMPT", "render", "index.html");
const MAC_PROJECT = path.posix.join("/Users/qa/project", "Library", "BurnGuard", "data", "projects", "deck", "assets", "logo.svg");
const MAC_CHROME = path.posix.join("/Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome");

describe("export failure message", () => {
  test("Given a slide deck whose entrypoint file is missing When an HTML export fails Then the persisted job error_message carries no absolute private path", async () => {
    // Given: the deck entrypoint index.html was renamed away, only a stylesheet remains.
    const { projectId, sessionId } = await createProject("missing-entrypoint", "slide_deck", { "styles.css": "body{margin:0}" });
    const settled = terminalStatus(sessionId);
    // When
    const job = await enqueueProjectExport(projectId, "html_zip", {});
    expect(await settled).toBe("failed");
    const persisted = await getExportJob(job!.id);
    // Then: the DTO served by GET /api/exports/:id must not expose the profile layout.
    const message = persisted?.error_message ?? "";
    expect(persisted?.latest_attempt?.stop_reason).toBe("render_failed");
    expect(message).not.toBe("");
    expect(message).not.toContain(exportsDir);
    expect(message).not.toContain(projectsDir);
    expect(message).not.toMatch(/[\\/]\.staging[\\/]/u);
    expect(message).not.toContain("index.html");
    expect(message).not.toMatch(ERRNO);
  });

  describe("Windows paths", () => {
    test.each([
      ["a staged entrypoint under a drive-letter profile", fsError("ENOENT", "no such file or directory", WINDOWS_STAGE), WINDOWS_STAGE, ["C:", "Users", "qa\\", ".burnguard", ".staging", "01ATTEMPT"]],
      ["a locked project asset on a UNC share", fsError("EBUSY", "resource busy or locked", WINDOWS_UNC), WINDOWS_UNC, ["fileserver", "profiles", "\\", "logo.svg"]],
    ] as const)("Given a render failure naming %s When the attempt settles Then the persisted error_message carries no path or errno text", async (_case, error, privatePath, fragments) => {
      // When
      const { status, message } = await persistedAfter(failAfterSnapshot(error));
      // Then
      expect(status).toBe("failed");
      expect(privatePath).toContain("\\");
      expectNoPrivateDiagnostic(message, privatePath, fragments);
    });

    test("Given a Chromium launch timeout whose detail names the Windows browser executable When the attempt settles Then the message keeps the error code and drops the path", async () => {
      // Given
      const error = new RenderSessionError("chromium_launch_timeout", `chromium_launch_timeout: Chromium did not finish launching\ntried channels: chrome\nchrome: spawn ${WINDOWS_CHROME} EPERM`);
      // When
      const { status, message } = await persistedAfter(failAfterSnapshot(error));
      // Then
      expect(status).toBe("failed");
      expect(message).toContain("chromium_launch_timeout");
      expectNoPrivateDiagnostic(message, WINDOWS_CHROME, ["Program Files", "chrome.exe", "\\"]);
    });

    test("Given a cancelled attempt whose abort error names a drive-letter stage path When the attempt settles Then the persisted error_message carries no path", async () => {
      // When
      const { status, message } = await persistedAfter(failAfterSnapshot(fsError("EPERM", "operation not permitted", WINDOWS_STAGE), (attemptId) => { cancelProjectExport(attemptId); }));
      // Then
      expect(status).toBe("cancelled");
      expectNoPrivateDiagnostic(message, WINDOWS_STAGE, ["C:", "Users", ".staging"]);
    });
  });

  describe("POSIX paths", () => {
    test.each([
      ["a staged entrypoint under a Linux home profile", fsError("ENOENT", "no such file or directory", LINUX_STAGE), LINUX_STAGE, ["/home", "qa/", ".burnguard", ".staging", "01ATTEMPT"]],
      ["an unreadable project asset under a macOS home profile", fsError("EACCES", "permission denied", MAC_PROJECT), MAC_PROJECT, ["/Users", "qa/", "Library", "logo.svg"]],
    ] as const)("Given a render failure naming %s When the attempt settles Then the persisted error_message carries no path or errno text", async (_case, error, privatePath, fragments) => {
      // When
      const { status, message } = await persistedAfter(failAfterSnapshot(error));
      // Then
      expect(status).toBe("failed");
      expect(privatePath.startsWith("/")).toBe(true);
      expectNoPrivateDiagnostic(message, privatePath, fragments);
    });

    test("Given a missing Chromium whose detail names the macOS browser executable When the attempt settles Then the message keeps the error code and drops the path", async () => {
      // Given
      const error = new RenderSessionError("chromium_not_installed", `chromium_not_installed: Chromium could not be launched\ntried channels: chrome\nchrome: spawn ${MAC_CHROME} ENOENT`);
      // When
      const { status, message } = await persistedAfter(failAfterSnapshot(error));
      // Then
      expect(status).toBe("failed");
      expect(message).toContain("chromium_not_installed");
      expectNoPrivateDiagnostic(message, MAC_CHROME, ["/Applications", "Google Chrome", "MacOS"]);
    });

    test("Given a cancelled attempt whose abort error names a Linux stage path When the attempt settles Then the persisted error_message carries no path", async () => {
      // When
      const { status, message } = await persistedAfter(failAfterSnapshot(fsError("EACCES", "permission denied", LINUX_STAGE), (attemptId) => { cancelProjectExport(attemptId); }));
      // Then
      expect(status).toBe("cancelled");
      expectNoPrivateDiagnostic(message, LINUX_STAGE, ["/home", "qa/", ".staging"]);
    });
  });
});

describe("legacy export rows", () => {
  /** Inserts a failed row the way builds before #202 persisted it: the raw exception text as error_message. */
  function seedLegacyRow(message: string): string {
    const id = `legacy-export-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
    getSqlite().prepare("INSERT INTO exports(id,project_id,format,status,output_path,error_message,size_bytes,options_json,created_at,completed_at) VALUES (?,?,'html_zip','failed',NULL,?,NULL,?,1,2)").run(id, prototype.projectId, message, JSON.stringify(parseExportOptions("html_zip", {})));
    return id;
  }

  async function apiText(url: string): Promise<{ readonly status: number; readonly text: string }> {
    const response = await artifactRoutes.fetch(new Request(`http://127.0.0.1:14070${url}`));
    return { status: response.status, text: await response.text() };
  }

  test.each([
    ["Windows", `ENOENT: no such file or directory, open '${WINDOWS_STAGE}'`, "Export failed", WINDOWS_STAGE, ["C:", "Users", "qa\\", ".burnguard", ".staging", "01ATTEMPT"]],
    ["Windows UNC", `EBUSY: resource busy or locked, open '${WINDOWS_UNC}'`, "Export failed", WINDOWS_UNC, ["fileserver", "profiles", "logo.svg"]],
    ["POSIX", `EACCES: permission denied, open '${LINUX_STAGE}'`, "Export failed", LINUX_STAGE, ["/home", "qa/", ".burnguard", ".staging", "01ATTEMPT"]],
    ["macOS", `chromium_not_installed: Chromium could not be launched\nchrome: spawn ${MAC_CHROME} ENOENT`, "Export failed: chromium_not_installed", MAC_CHROME, ["/Applications", "Google Chrome", "MacOS"]],
  ] as const)("Given a %s legacy row whose error_message is raw exception text When the export is read through the API Then neither the job nor the project list carries the path or errno text", async (_flavor, legacyMessage, expected, privatePath, fragments) => {
    // Given
    const id = seedLegacyRow(legacyMessage);
    try {
      // When
      const job = await apiText(`/api/exports/${id}`);
      const list = await apiText(`/api/projects/${prototype.projectId}/exports`);
      // Then
      expect([job.status, list.status]).toEqual([200, 200]);
      const served = (JSON.parse(job.text) as { readonly data: { readonly error_message: string | null } }).data.error_message;
      expect(served).toBe(expected);
      const listed = (JSON.parse(list.text) as { readonly data: ReadonlyArray<{ readonly id: string; readonly error_message: string | null }> }).data.find((row) => row.id === id);
      expect(listed?.error_message).toBe(expected);
      for (const text of [job.text, list.text]) {
        expect(text).not.toContain(privatePath);
        expect(text).not.toMatch(ERRNO);
        for (const fragment of fragments) expect(text).not.toContain(fragment);
      }
    } finally {
      getSqlite().prepare("DELETE FROM exports WHERE id=?").run(id);
    }
  });

  test.each([
    "Export failed",
    "Export failed: chromium_launch_timeout",
    "Export cancelled",
    "Export recovery found no owned output",
    "Export receipt or output is corrupt",
    "Legacy export has no validated receipt",
    "Export retention expired",
  ])("Given a row whose error_message is the fixed copy %p When it is read through the API Then the copy is served unchanged", async (fixed) => {
    // Given
    const id = seedLegacyRow(fixed);
    try {
      // When
      const job = await apiText(`/api/exports/${id}`);
      // Then
      expect((JSON.parse(job.text) as { readonly data: { readonly error_message: string | null } }).data.error_message).toBe(fixed);
    } finally {
      getSqlite().prepare("DELETE FROM exports WHERE id=?").run(id);
    }
  });
});
