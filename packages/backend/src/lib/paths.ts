import path from "node:path";
import { existsSync } from "node:fs";
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

export function resolveRepoRoot(fromDir = import.meta.dir, executablePath = process.execPath): string {
  const resources = path.join(path.dirname(executablePath), "resources");
  if (existsSync(path.join(resources, "burnguard-runtime.json"))) return resources;
  return path.resolve(fromDir, "../../../..");
}
