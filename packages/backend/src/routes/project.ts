import { Hono } from "hono";
import type { ApiErrorBody, ApiSuccess, ProjectDetail, SessionInfo } from "@bg/shared";
import { getSqlite } from "../db/sqlite-client";
import { deleteProject, ProjectDeletionError } from "../services/project-deletion";
import { getLatestProjectSession, getProjectDetail } from "../db/project-read-repository";
import { parseStoredProjectOptions } from "../services/project-options";
import { processProjectFilesystemSignal } from "../services/watchers";
import { designDirectionRoutes } from "./design-directions";
import { chartRoutes } from "./charts";
import { DesignSystemPinError, inspectProjectDesignSystemPin, refreshProjectDesignSystemPin } from "../services/project-design-system-pin";
import { exportProjectBundle, ProjectBundleError } from "../services/project-bundle";
import { figmaImportRoutes } from "./figma-import";
import { createProjectFolderRoutes } from "./project-folder";
import { appendProjectInstruction, ProjectInstructionsError, readProjectInstructions, replaceProjectInstructions } from "../services/project-instructions";

function ok<T>(data: T): ApiSuccess<T> {
  return { data };
}

function fail(
  code: string,
  message: string,
  details?: unknown,
): ApiErrorBody {
  return { error: { code, message, details } };
}

export const projectRoutes = new Hono();
projectRoutes.route("/", designDirectionRoutes);
projectRoutes.route("/", chartRoutes);
projectRoutes.route("/", figmaImportRoutes);
projectRoutes.route("/", createProjectFolderRoutes());

function instructionsFailure(error: ProjectInstructionsError) {
  const status = error.code === "project_not_found" ? 404 : error.code === "instructions_conflict" ? 409 : 400;
  return [fail(error.code, "Project instructions could not be saved"), status] as const;
}

projectRoutes.get("/api/projects/:id/instructions", (c) => {
  try { return c.json(ok(readProjectInstructions(c.req.param("id")))); }
  catch (error) { if (error instanceof ProjectInstructionsError) return c.json(...instructionsFailure(error)); throw error; }
});

projectRoutes.put("/api/projects/:id/instructions", async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return c.json(fail("invalid_body", "Expected a JSON object body"), 400);
  try { return c.json(ok(replaceProjectInstructions(c.req.param("id"), Reflect.get(body, "text")))); }
  catch (error) { if (error instanceof ProjectInstructionsError) return c.json(...instructionsFailure(error)); throw error; }
});

projectRoutes.post("/api/projects/:id/instructions/lines", async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return c.json(fail("invalid_body", "Expected a JSON object body"), 400);
  try { return c.json(ok(appendProjectInstruction(c.req.param("id"), Reflect.get(body, "line")))); }
  catch (error) { if (error instanceof ProjectInstructionsError) return c.json(...instructionsFailure(error)); throw error; }
});

projectRoutes.get("/api/projects/:id/bundle", async (c) => {
  try {
    const bundle = await exportProjectBundle(c.req.param("id"));
    return new Response(Buffer.from(bundle.bytes), {
      headers: {
        "Content-Type": "application/vnd.burnguard.project+zip",
        "Content-Disposition": `attachment; filename="BurnGuard-project.burnguard-project"; filename*=UTF-8''${encodeURIComponent(bundle.filename)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ProjectBundleError) {
      const status = error.code === "project_bundle_not_found" ? 404 :
        error.code === "project_bundle_limit" ? 413 : 409;
      return c.json(fail(error.code, "Project bundle could not be exported"), status);
    }
    throw error;
  }
});

projectRoutes.get("/api/projects/:id/print-preflight", async (c) => {
  const { buildPrintPreflight, PrintPreflightError } = await import("../services/print-preflight-service");
  try { return c.json(ok(await buildPrintPreflight(c.req.param("id"), c.req.raw.signal))); }
  catch (error) {
    if (error instanceof PrintPreflightError) return c.json(fail(error.code, "Project not found"), 404);
    throw error;
  }
});

projectRoutes.get("/api/projects/:id/design-system-pin", async (c) => {
  try { return c.json(ok(await inspectProjectDesignSystemPin(c.req.param("id")))); }
  catch (error) {
    if (error instanceof DesignSystemPinError) return c.json(fail(error.code, "Design system version unavailable"), 409);
    throw error;
  }
});
projectRoutes.post("/api/projects/:id/design-system-pin", async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Object.keys(body).length !== 2 ||
    !("expected_digest" in body) || typeof body.expected_digest !== "string" || !/^[a-f0-9]{64}$/.test(body.expected_digest) ||
    !("candidate_digest" in body) || typeof body.candidate_digest !== "string" || !/^[a-f0-9]{64}$/.test(body.candidate_digest)) return c.json(fail("invalid_body", "Expected version identities"), 400);
  try {
    await refreshProjectDesignSystemPin(c.req.param("id"), body.expected_digest, body.candidate_digest);
    return c.json(ok(await inspectProjectDesignSystemPin(c.req.param("id"))));
  } catch (error) {
    if (error instanceof DesignSystemPinError) return c.json(fail(error.code, "Design system version changed or project is busy"), 409);
    throw error;
  }
});

projectRoutes.get("/api/projects/:id", async (c) => {
  const id = c.req.param("id");
  const project = await getProjectDetail(id);
  if (!project) {
    return c.json(fail("project_not_found", "Project not found", { id }), 404);
  }
  return c.json(ok({ ...project, options_json: JSON.stringify(parseStoredProjectOptions(project.options_json)) } satisfies ProjectDetail));
});

projectRoutes.get("/api/projects/:id/session", async (c) => {
  const id = c.req.param("id");
  const session = await getLatestProjectSession(id);
  if (!session) {
    return c.json(fail("session_not_found", "Session not found", { project_id: id }), 404);
  }
  return c.json(ok(session satisfies SessionInfo));
});

projectRoutes.post("/api/projects/:id/qa/filesystem-signal", async (c) => {
  const id = c.req.param("id");
  if (process.env.BG_ARTIFACT_QA !== "1" || c.req.header("x-burnguard-qa-operation") !== process.env.BG_ARTIFACT_TURN_OPERATION_ID) return c.json(fail("not_found", "Not found"), 404);
  const project = await getProjectDetail(id);
  if (project === null) return c.json(fail("project_not_found", "Project not found", { id }), 404);
  const operation = await processProjectFilesystemSignal(id, project.dir_path);
  return c.json(ok({ operation_id: operation?.id ?? null, status: operation?.status ?? "unchanged" }));
});

projectRoutes.delete("/api/projects/:id", async (c) => {
  const id = c.req.param("id");
  const project = await getProjectDetail(id);
  if (!project) {
    return c.json(fail("project_not_found", "Project not found", { id }), 404);
  }

  try {
    await deleteProject(getSqlite(), id);
  } catch (error) {
    if (error instanceof ProjectDeletionError) return c.json(fail(error.code, error.code === "project_in_use" ? "Project has retained learning or active work" : "Project deletion did not complete"), error.code === "project_not_found" ? 404 : 409);
    throw error;
  }

  return c.body(null, 204);
});
