import { Hono } from "hono";
import {
  ProjectFolderError,
  projectFolderDependencies,
  showProjectFolder,
  type ProjectFolderDependencies,
} from "../services/project-folder";

export function createProjectFolderRoutes(overrides: Partial<ProjectFolderDependencies> = {}): Hono {
  const routes = new Hono();
  const dependencies = { ...projectFolderDependencies, ...overrides };
  routes.post("/api/projects/:id/show-folder", async (c) => {
    try {
      await showProjectFolder(c.req.param("id"), dependencies);
      return c.body(null, 204);
    } catch (error) {
      if (error instanceof ProjectFolderError) {
        const status = error.code === "project_not_found" ? 404 : error.code === "project_path_unavailable" ? 409 : 503;
        return c.json({ error: { code: error.code, message: "Project folder could not be opened" } }, status);
      }
      // The HTTP boundary never exposes database or OS diagnostics.
      return c.json({ error: { code: "project_folder_unavailable", message: "Project folder could not be opened" } }, 503);
    }
  });
  return routes;
}
