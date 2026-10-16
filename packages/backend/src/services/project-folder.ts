import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { getProjectDetail } from "../db/project-read-repository";
import { projectsDir, resolveManagedPath } from "../lib/paths";
import { PathBoundaryError } from "../security/path-boundary";

type ProjectFolderCode = "project_not_found" | "project_path_unavailable" | "project_folder_unavailable";

export class ProjectFolderError extends Error {
  constructor(readonly code: ProjectFolderCode) {
    super(code);
    this.name = "ProjectFolderError";
  }
}

export interface ProjectFolderDependencies {
  readonly projectsRoot: string;
  readonly platform: NodeJS.Platform;
  readonly findProject: (id: string) => Promise<{ readonly dir_path: string } | null>;
  readonly spawn: (argv: readonly [string, string]) => Promise<void>;
}

export const projectFolderDependencies: ProjectFolderDependencies = {
  projectsRoot: projectsDir,
  platform: process.platform,
  findProject: getProjectDetail,
  spawn: ([command, directory]) => new Promise((resolve, reject) => {
    const child = spawn(command, [directory], { shell: false, stdio: "ignore" });
    child.once("error", reject);
    // File managers may remain alive after the handoff. Acknowledge process creation, not window lifetime.
    child.once("spawn", () => { child.unref(); resolve(); });
  }),
};

export async function showProjectFolder(
  id: string,
  dependencies: ProjectFolderDependencies,
): Promise<void> {
  const project = await dependencies.findProject(id);
  if (project === null) throw new ProjectFolderError("project_not_found");
  let directory: string;
  try {
    directory = resolveManagedPath(dependencies.projectsRoot, project.dir_path);
    if (!(await stat(directory)).isDirectory()) throw new ProjectFolderError("project_path_unavailable");
  } catch (error) {
    if (error instanceof PathBoundaryError || (error instanceof Error && "code" in error)) {
      throw new ProjectFolderError("project_path_unavailable");
    }
    throw error;
  }

  let command: string;
  switch (dependencies.platform) {
    case "darwin": command = "open"; break;
    case "win32": command = "explorer.exe"; break;
    case "linux": command = "xdg-open"; break;
    default: throw new ProjectFolderError("project_folder_unavailable");
  }
  try {
    await dependencies.spawn([command, directory]);
  } catch {
    // This boundary deliberately discards OS diagnostics, which can contain the private project path.
    throw new ProjectFolderError("project_folder_unavailable");
  }
}
