import { existsSync } from "node:fs";
import path from "node:path";
import { PathBoundaryError, resolveWithin } from "../security/path-boundary";
export * from "./app-paths";

/** Resolves a DB-sourced absolute path against its managed storage root. */
export function resolveManagedPath(root: string, target: string): string {
  const relative = path.relative(root, target);
  if (!relative) {
    throw new PathBoundaryError("outside_root", "Managed storage root is not a record path");
  }
  return resolveWithin(root, relative);
}

export function resolveRepoRoot(fromDir = import.meta.dir): string {
  return path.resolve(fromDir, "../../../..");
}

export function resolveRuntimeRoot(
  fromDir = import.meta.dir,
  executablePath = process.execPath,
): string {
  const resources = path.resolve(
    path.dirname(executablePath),
    "..",
    "Resources",
  );
  return existsSync(path.join(resources, "packages"))
    ? resources
    : resolveRepoRoot(fromDir);
}
