import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { parseGenerationStyle, UpgradeContractError, type GenerationStyle, type ApiErrorBody, type ApiSuccess, type DesignBriefV1, type ProjectType } from "@bg/shared";
import { getLatestProjectSession, getProjectDetail } from "../db/project-read-repository";
import { projectsDir, resolveManagedPath } from "../lib/paths";
import { PathBoundaryError, assertSafeName } from "../security/path-boundary";
import { isUserTurnRunning } from "../services/turns";
import { getLatestDirectionState } from "../services/design-direction-state";
import { DesignDirectionWorkflow, DesignDirectionWorkflowError, directionPreviewPath } from "../services/design-direction-workflow";
import { parseStoredProjectOptions } from "../services/project-options";

let workflow = new DesignDirectionWorkflow();
export const designDirectionRoutes = new Hono();

export function replaceDesignDirectionWorkflowForTest(replacement: DesignDirectionWorkflow): () => void {
  const previous = workflow;
  workflow = replacement;
  return () => { if (workflow === replacement) workflow = previous; };
}

type RouteContext = { readonly projectId: string; readonly sessionId: string; readonly projectDir: string; readonly projectName: string; readonly projectType: ProjectType; readonly designBrief: DesignBriefV1 | null };
type RouteContextResult = RouteContext | "path_unavailable" | null;

function ok<T>(data: T): ApiSuccess<T> { return { data }; }
function fail(code: string, message: string, details?: unknown): ApiErrorBody { return { error: { code, message, details } }; }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isRevision(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function isText(value: unknown): value is string { return typeof value === "string" && value.length > 0; }

async function context(projectId: string): Promise<RouteContextResult> {
  const [project, session] = await Promise.all([getProjectDetail(projectId), getLatestProjectSession(projectId)]);
  if (project === null || session === null) return null;
  try {
    return { projectId, sessionId: session.id, projectDir: resolveManagedPath(projectsDir, project.dir_path), projectName: project.name, projectType: project.type, designBrief: parseStoredProjectOptions(project.options_json).design_brief };
  } catch (error) {
    if (error instanceof PathBoundaryError) return "path_unavailable";
    throw error;
  }
}

function pathUnavailable(): Response { return Response.json(fail("project_path_unavailable", "Project directory is outside managed storage"), { status: 503 }); }

function routeError(error: DesignDirectionWorkflowError): Response {
  const conflict = error.code === "operation_active" || error.code === "generation_conflict" || error.code === "revision_conflict";
  const status = conflict ? 409 : error.code === "state_not_found" ? 404 : 422;
  return Response.json(fail(error.code, error.message), { status });
}

async function generationContext(projectId: string): Promise<{ readonly value?: RouteContext; readonly response?: Response }> {
  const value = await context(projectId);
  if (value === null) return { response: Response.json(fail("project_session_not_found", "Project or session not found"), { status: 404 }) };
  if (value === "path_unavailable") return { response: pathUnavailable() };
  const session = await getLatestProjectSession(projectId);
  if (session?.status === "running" || isUserTurnRunning(value.sessionId)) return { response: Response.json(fail("session_busy", "Cannot generate directions while a user turn is running"), { status: 409 }) };
  return { value };
}

designDirectionRoutes.get("/api/projects/:projectId/design-directions", async (c) => {
  const value = await context(c.req.param("projectId"));
  if (value === null) return c.json(fail("project_session_not_found", "Project or session not found"), 404);
  if (value === "path_unavailable") return pathUnavailable();
  return c.json(ok(await workflow.recover(value.sessionId)));
});

designDirectionRoutes.post("/api/projects/:projectId/design-directions/generate", async (c) => {
  const result = await generationContext(c.req.param("projectId"));
  if (result.response !== undefined) return result.response;
  const value = result.value;
  if (value === undefined) return c.json(fail("project_session_not_found", "Project or session not found"), 404);
  let preferences: GenerationStyle | undefined;
  try { const text = await c.req.text(); if (text.trim() !== "") preferences = parseGenerationStyle(JSON.parse(text)); }
  catch (error) { if (error instanceof SyntaxError || error instanceof UpgradeContractError) return c.json(fail("invalid_body", "Expected an image style and copy tone preset"), 400); throw error; }
  try { const started = await workflow.generate(value, preferences); void started.completion; return c.json(ok(started.state), 202); }
  catch (error) { if (error instanceof DesignDirectionWorkflowError) return routeError(error); throw error; }
});

designDirectionRoutes.post("/api/projects/:projectId/design-directions/cancel", async (c) => {
  const value = await context(c.req.param("projectId"));
  if (value === null) return c.json(fail("project_session_not_found", "Project or session not found"), 404);
  if (value === "path_unavailable") return pathUnavailable();
  const terminal = await workflow.cancel(value.sessionId);
  if (terminal === null) return c.json(fail("operation_not_active", "No direction operation is active"), 409);
  return c.json(ok(terminal), 202);
});

designDirectionRoutes.post("/api/projects/:projectId/design-directions/retry", async (c) => {
  const result = await generationContext(c.req.param("projectId"));
  if (result.response !== undefined) return result.response;
  const value = result.value;
  if (value === undefined) return c.json(fail("project_session_not_found", "Project or session not found"), 404);
  try { const started = await workflow.retry(value); void started.completion; return c.json(ok(started.state), 202); }
  catch (error) { if (error instanceof DesignDirectionWorkflowError) return routeError(error); throw error; }
});

designDirectionRoutes.post("/api/projects/:projectId/design-directions/select", async (c) => {
  const value = await context(c.req.param("projectId"));
  if (value === null) return c.json(fail("project_session_not_found", "Project or session not found"), 404);
  if (value === "path_unavailable") return pathUnavailable();
  const body = await c.req.json<unknown>().catch(() => null);
  if (!isRecord(body) || !isText(body["generation_id"]) || !isRevision(body["expected_selection_revision"]) || !isText(body["direction_id"])) return c.json(fail("invalid_body", "Expected generation_id, expected_selection_revision, and direction_id"), 400);
  try { return c.json(ok(await workflow.select(value.sessionId, body["generation_id"], body["expected_selection_revision"], body["direction_id"]))); }
  catch (error) { if (error instanceof DesignDirectionWorkflowError) return routeError(error); throw error; }
});

designDirectionRoutes.post("/api/projects/:projectId/design-directions/preferences", async (c) => {
  const result = await generationContext(c.req.param("projectId"));
  if (result.response !== undefined) return result.response;
  const value = result.value;
  if (value === undefined) return c.json(fail("project_session_not_found", "Project or session not found"), 404);
  const body = await c.req.json<unknown>().catch(() => null);
  if (!isRecord(body) || Object.keys(body).some((key) => !["generation_id", "expected_selection_revision", "creative_preferences"].includes(key)) || !isText(body.generation_id) || !isRevision(body.expected_selection_revision)) return c.json(fail("invalid_body", "Expected generation identity and creative preferences"), 400);
  try {
    const preferences = parseGenerationStyle(body.creative_preferences);
    return c.json(ok(await workflow.setPreferences(value.sessionId, body.generation_id, body.expected_selection_revision, preferences)));
  } catch (error) {
    if (error instanceof UpgradeContractError) return c.json(fail("invalid_body", "Unknown image style or copy tone preset"), 400);
    if (error instanceof DesignDirectionWorkflowError) return routeError(error);
    throw error;
  }
});

designDirectionRoutes.post("/api/projects/:projectId/design-directions/undo-selection", async (c) => {
  const value = await context(c.req.param("projectId"));
  if (value === null) return c.json(fail("project_session_not_found", "Project or session not found"), 404);
  if (value === "path_unavailable") return pathUnavailable();
  const body = await c.req.json<unknown>().catch(() => null);
  if (!isRecord(body) || !isText(body["generation_id"]) || !isRevision(body["expected_selection_revision"])) return c.json(fail("invalid_body", "Expected generation_id and expected_selection_revision"), 400);
  try { return c.json(ok(await workflow.undo(value.sessionId, body["generation_id"], body["expected_selection_revision"]))); }
  catch (error) { if (error instanceof DesignDirectionWorkflowError) return routeError(error); throw error; }
});

designDirectionRoutes.get("/api/projects/:projectId/design-directions/:generationId/:directionId/preview", async (c) => {
  const value = await context(c.req.param("projectId"));
  if (value === null) return c.json(fail("project_session_not_found", "Project or session not found"), 404);
  if (value === "path_unavailable") return pathUnavailable();
  try {
    const generationId = assertSafeName(c.req.param("generationId"));
    const directionId = assertSafeName(c.req.param("directionId"));
    const state = await getLatestDirectionState(value.sessionId);
    const slot = state?.generation_id === generationId ? state.directions.find((candidate) => candidate.id === directionId && candidate.status === "ready") : undefined;
    if (slot === undefined) return c.json(fail("preview_not_found", "Preview is not available for the current state"), 404);
    const bytes = await readFile(directionPreviewPath(value.projectDir, generationId, directionId));
    const etag = `"${createHash("sha256").update(bytes).digest("hex")}"`;
    const headers = { "Content-Type": "image/svg+xml", "Cache-Control": "private, no-cache", ETag: etag };
    if (c.req.header("if-none-match") === etag) return c.body(null, 304, headers);
    return c.body(bytes, 200, headers);
  } catch (error) {
    if (error instanceof PathBoundaryError) return c.json(fail("invalid_preview_id", "Preview identifier is invalid"), 400);
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return c.json(fail("preview_missing", "Preview file is missing"), 410);
    throw error;
  }
});
