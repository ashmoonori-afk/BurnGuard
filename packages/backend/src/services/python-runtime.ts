import { existsSync } from "node:fs";
import path from "node:path";
import { appRootDir } from "../lib/app-paths";

/** Keep upload dependencies out of system, Homebrew and user-site Python installations. */
export const pythonVenvDir = path.join(appRootDir, "runtime", "python");

export function managedPythonExecutable(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32"
    ? path.join(pythonVenvDir, "Scripts", "python.exe")
    : path.join(pythonVenvDir, "bin", "python3");
}

/** Health checks and extraction must use the same environment once it has been created. */
export function pythonCandidates(): string[][] {
  const managed = managedPythonExecutable();
  if (existsSync(managed)) return [[managed]];
  return process.platform === "win32"
    ? [["py", "-3"], ["python3"], ["python"]]
    : [["python3"], ["python"]];
}
