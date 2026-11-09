import { Hono } from "hono";
import type { ApiErrorBody, ApiSuccess, LogoGeometricStatusV1 } from "@bg/shared";
import { getProjectDetail } from "../db/project-read-repository";
import { projectsDir, resolveManagedPath } from "../lib/paths";
import { PathBoundaryError } from "../security/path-boundary";
import { logoGeometricEnabled, readLogoGeometricStatus } from "../services/logo-geometric-turn";
import { parseStoredProjectOptions } from "../services/project-options";

/**
 * Read-only status of the geometric logo method for one project (doc/31). Every value is derived from
 * the project files on each request; the person's choices travel as turn sentinels, never through
 * this route, so a turn's checkpoint and history cover them like any other request.
 */
export const logoGeometricRoutes = new Hono();

function fail(code: string, message: string): ApiErrorBody { return { error: { code, message } }; }

logoGeometricRoutes.get("/api/projects/:projectId/logo/geometric", async (c) => {
  const project = await getProjectDetail(c.req.param("projectId"));
  if (project === null || project.type !== "logo") return c.json(fail("project_not_found", "Logo project not found"), 404);
  let dir: string;
  try { dir = resolveManagedPath(projectsDir, project.dir_path); }
  catch (error) {
    if (error instanceof PathBoundaryError) return c.json(fail("project_path_unavailable", "Project directory is outside managed storage"), 503);
    throw error;
  }
  const status = await readLogoGeometricStatus(dir, parseStoredProjectOptions(project.options_json).logo_set, logoGeometricEnabled());
  return c.json({ data: status } satisfies ApiSuccess<LogoGeometricStatusV1>);
});
