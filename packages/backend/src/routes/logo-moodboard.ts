import { Hono } from "hono";
import { MOODBOARD_LIMITS, type ApiErrorBody, type ApiSuccess, type ProjectType } from "@bg/shared";
import { getLatestProjectSession, getProjectDetail } from "../db/project-read-repository";
import { projectsDir, resolveManagedPath } from "../lib/paths";
import { PathBoundaryError } from "../security/path-boundary";
import { rawFileHeaders } from "../security/raw-file-response";
import { isUserTurnRunning } from "../services/turns";
import {
  LogoMoodboardError,
  addMoodboardFiles,
  addMoodboardLink,
  readLogoMoodboard,
  readMoodboardFile,
  removeMoodboardItem,
  type LogoMoodboardErrorCode,
} from "../services/logo-moodboard";
import { isolatedImageFingerprint } from "../services/image-fingerprint-process";

/**
 * Logo moodboard transport (doc/23). Bounded project-local list of immutable reference images and
 * bookmarked HTTPS links; links are metadata only and are never fetched. Every mutation carries the
 * `expected_revision` it was built against, accepts only known fields, and requires a logo project
 * resolved beneath managed storage. Storage owns identity, limits and atomic publication; this
 * module owns parsing and stable, sanitized envelopes (no filesystem path ever reaches a response).
 */

type Fingerprint = (bytes: Buffer, signal?: AbortSignal) => Promise<string>;

let fingerprintImage: Fingerprint = isolatedImageFingerprint;

/** Test seam: swaps the child-process image fingerprint without touching the storage contract. */
export function replaceMoodboardFingerprintForTest(replacement: Fingerprint): () => void {
  const previous = fingerprintImage;
  fingerprintImage = replacement;
  return () => { if (fingerprintImage === replacement) fingerprintImage = previous; };
}

export const logoMoodboardRoutes = new Hono();

function ok<T>(data: T): ApiSuccess<T> { return { data }; }
function fail(code: string, message: string, details?: unknown): ApiErrorBody { return { error: { code, message, details } }; }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === "object" && value !== null && !Array.isArray(value); }

type ProjectContext = { readonly projectDir: string; readonly sessionId: string; readonly sessionStatus: string; readonly type: ProjectType };
type ContextResult = ProjectContext | "not_found" | "not_logo" | "path_unavailable";

async function projectContext(projectId: string): Promise<ContextResult> {
  const [project, session] = await Promise.all([getProjectDetail(projectId), getLatestProjectSession(projectId)]);
  if (project === null || session === null) return "not_found";
  if (project.type !== "logo") return "not_logo";
  try {
    return { projectDir: resolveManagedPath(projectsDir, project.dir_path), sessionId: session.id, sessionStatus: session.status, type: project.type };
  } catch (error) {
    if (error instanceof PathBoundaryError) return "path_unavailable";
    throw error;
  }
}

function contextFailure(result: "not_found" | "not_logo" | "path_unavailable"): Response {
  if (result === "path_unavailable") return Response.json(fail("project_path_unavailable", "Project directory is outside managed storage"), { status: 503 });
  if (result === "not_logo") return Response.json(fail("moodboard_not_found", "This project has no logo moodboard"), { status: 404 });
  return Response.json(fail("project_session_not_found", "Project or session not found"), { status: 404 });
}

type MutationContext = { readonly value: ProjectContext } | { readonly response: Response };

async function mutationContext(projectId: string): Promise<MutationContext> {
  const result = await projectContext(projectId);
  if (typeof result === "string") return { response: contextFailure(result) };
  if (result.sessionStatus === "running" || isUserTurnRunning(result.sessionId)) {
    return { response: Response.json(fail("session_busy", "Cannot change the moodboard while a user turn is running"), { status: 409 }) };
  }
  return { value: result };
}

const MOODBOARD_STATUS: Readonly<Record<LogoMoodboardErrorCode, number>> = {
  moodboard_invalid: 400,
  moodboard_image_invalid: 400,
  moodboard_conflict: 409,
  moodboard_corrupt: 409,
  moodboard_not_found: 404,
  moodboard_limit: 413,
};

const MOODBOARD_MESSAGE: Readonly<Record<LogoMoodboardErrorCode, string>> = {
  moodboard_invalid: "The moodboard request is invalid",
  moodboard_image_invalid: "The reference image is not a supported PNG, JPEG or WebP",
  moodboard_conflict: "The moodboard changed; reload the latest revision",
  moodboard_corrupt: "The moodboard data cannot be read",
  moodboard_not_found: "Moodboard item not found",
  moodboard_limit: "The moodboard has reached its limit",
};

function moodboardFailure(error: LogoMoodboardError): Response {
  return Response.json(fail(error.code, MOODBOARD_MESSAGE[error.code] ?? "Moodboard request failed"), { status: MOODBOARD_STATUS[error.code] ?? 500 });
}

function jsonRevision(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function formRevision(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function hasOnlyKeys(body: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(body);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

logoMoodboardRoutes.get("/api/projects/:projectId/logo/moodboard", async (c) => {
  const result = await projectContext(c.req.param("projectId"));
  if (typeof result === "string") return contextFailure(result);
  try { return c.json(ok(await readLogoMoodboard(result.projectDir))); }
  catch (error) { if (error instanceof LogoMoodboardError) return moodboardFailure(error); throw error; }
});

logoMoodboardRoutes.post("/api/projects/:projectId/logo/moodboard/files", async (c) => {
  const context = await mutationContext(c.req.param("projectId"));
  if ("response" in context) return context.response;
  const form = await c.req.formData().catch(() => null);
  if (form === null) return c.json(fail("invalid_body", "Expected a multipart/form-data body with files and expected_revision"), 400);
  const revision = formRevision(form.get("expected_revision"));
  const entries = form.getAll("files");
  const unknownField = [...form.keys()].some((key) => key !== "files" && key !== "expected_revision");
  if (revision === null || unknownField || entries.length === 0 || entries.some((entry) => !(entry instanceof File))) {
    return c.json(fail("invalid_body", "Expected files and a non-negative integer expected_revision"), 400);
  }
  const files = entries.filter((entry): entry is File => entry instanceof File);
  if (files.length > MOODBOARD_LIMITS.max_files) return moodboardFailure(new LogoMoodboardError("moodboard_limit"));
  try {
    const inputs = await Promise.all(files.map(async (file) => ({ name: file.name, mime_type: file.type, bytes: Buffer.from(await file.arrayBuffer()) })));
    return c.json(ok(await addMoodboardFiles(context.value.projectDir, inputs, revision, { signal: c.req.raw.signal, fingerprint: fingerprintImage })));
  } catch (error) { if (error instanceof LogoMoodboardError) return moodboardFailure(error); throw error; }
});

logoMoodboardRoutes.post("/api/projects/:projectId/logo/moodboard/links", async (c) => {
  const context = await mutationContext(c.req.param("projectId"));
  if ("response" in context) return context.response;
  const body: unknown = await c.req.json<unknown>().catch(() => null);
  const revision = isRecord(body) ? jsonRevision(body["expected_revision"]) : null;
  if (!isRecord(body) || !hasOnlyKeys(body, ["url", "expected_revision"]) || typeof body["url"] !== "string" || revision === null) {
    return c.json(fail("invalid_body", "Expected url and a non-negative integer expected_revision"), 400);
  }
  try { return c.json(ok(await addMoodboardLink(context.value.projectDir, body["url"], revision))); }
  catch (error) { if (error instanceof LogoMoodboardError) return moodboardFailure(error); throw error; }
});

logoMoodboardRoutes.delete("/api/projects/:projectId/logo/moodboard/items/:itemId", async (c) => {
  const context = await mutationContext(c.req.param("projectId"));
  if ("response" in context) return context.response;
  const body: unknown = await c.req.json<unknown>().catch(() => null);
  const revision = isRecord(body) ? jsonRevision(body["expected_revision"]) : null;
  if (!isRecord(body) || !hasOnlyKeys(body, ["expected_revision"]) || revision === null) {
    return c.json(fail("invalid_body", "Expected a non-negative integer expected_revision"), 400);
  }
  try { return c.json(ok(await removeMoodboardItem(context.value.projectDir, c.req.param("itemId"), revision))); }
  catch (error) { if (error instanceof LogoMoodboardError) return moodboardFailure(error); throw error; }
});

logoMoodboardRoutes.get("/api/projects/:projectId/logo/moodboard/files/:itemId", async (c) => {
  const result = await projectContext(c.req.param("projectId"));
  if (typeof result === "string") return contextFailure(result);
  try {
    const content = await readMoodboardFile(result.projectDir, c.req.param("itemId"));
    const headers = {
      "Content-Type": content.item.mime_type,
      "Cache-Control": "private, no-cache",
      ...rawFileHeaders(c.req.raw, { contentType: content.item.mime_type, filename: content.item.original_name }),
    };
    return c.body(new Uint8Array(content.bytes), 200, headers);
  } catch (error) { if (error instanceof LogoMoodboardError) return moodboardFailure(error); throw error; }
});
