import { realpathSync } from "node:fs";
import path from "node:path";

export type PathBoundaryErrorCode = "invalid_name" | "outside_root" | "invalid_path";

export class PathBoundaryError extends Error {
  readonly code: PathBoundaryErrorCode;

  constructor(code: PathBoundaryErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PathBoundaryError";
    this.code = code;
  }
}

const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])(?:\.|$)/i;
const WINDOWS_INVALID_CHARACTER = /[<>:"/\\|?*]/;

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) <= 31);
}

/** Validates a value that will be used as exactly one path component. */
export function assertSafeName(name: string): string {
  if (
    name.length === 0 ||
    name === "." ||
    name === ".." ||
    path.isAbsolute(name) ||
    path.win32.isAbsolute(name) ||
    /^[A-Za-z]:/.test(name) ||
    WINDOWS_INVALID_CHARACTER.test(name) ||
    hasControlCharacter(name) ||
    /[ .]$/.test(name) ||
    WINDOWS_RESERVED_NAME.test(name)
  ) {
    throw new PathBoundaryError(
      "invalid_name",
      `Unsafe path component: ${JSON.stringify(name)}`,
    );
  }
  return name;
}

function resolveExistingPrefix(candidate: string): string {
  let current = candidate;
  const missing: string[] = [];

  for (;;) {
    try {
      return path.resolve(realpathSync(current), ...missing);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw new PathBoundaryError(
          "invalid_path",
          `Could not resolve path: ${candidate}`,
          { cause: error },
        );
      }

      const parent = path.dirname(current);
      if (parent === current) {
        throw new PathBoundaryError(
          "invalid_path",
          `Path has no existing ancestor: ${candidate}`,
          { cause: error },
        );
      }
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Resolves a path through junctions/symlinks, including paths whose final
 * components do not exist yet, and verifies that it remains below `root`.
 */
export function resolveWithin(root: string, ...segments: string[]): string {
  for (const segment of segments) {
    if (
      path.isAbsolute(segment) ||
      path.win32.isAbsolute(segment) ||
      /^[A-Za-z]:/.test(segment)
    ) {
      throw new PathBoundaryError(
        "outside_root",
        `Absolute path segment is not allowed: ${segment}`,
      );
    }
  }

  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch (error) {
    throw new PathBoundaryError(
      "invalid_path",
      `Could not resolve boundary root: ${root}`,
      { cause: error },
    );
  }

  const candidate = path.resolve(root, ...segments);
  const resolved = resolveExistingPrefix(candidate);
  const comparisonRoot = process.platform === "win32" ? realRoot.toLowerCase() : realRoot;
  const comparisonResolved =
    process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const relative = path.relative(comparisonRoot, comparisonResolved);

  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new PathBoundaryError(
      "outside_root",
      `Resolved path is outside boundary root: ${resolved}`,
    );
  }

  // macOS exposes temporary directories through both `/var` and its
  // canonical `/private/var` spelling. Preserve the public path spelling
  // callers used while retaining the realpath-based containment check. A
  // root the caller already spelled under `/private/` keeps that spelling:
  // stripping it there would move the result out of the caller's root.
  if (
    process.platform === "darwin" &&
    resolved.startsWith("/private/") &&
    !path.resolve(root).startsWith("/private/")
  ) {
    return resolved.slice("/private".length);
  }
  return resolved;
}
