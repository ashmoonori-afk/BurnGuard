export type CanvasSourceInput = {
  readonly projectId: string | null;
  readonly activeRelPath: string | null;
  readonly indexedRelPaths: readonly string[] | null;
  readonly entrypointUrl: string | null;
};

type CanvasPageTarget = { readonly relPath: string; readonly url: string };

export function isSafeCanvasPagePath(relPath: string): boolean {
  return /^(?:[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*\/)*[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*\.html$/iu.test(relPath);
}

export function resolveCanvasSource({ projectId, activeRelPath, indexedRelPaths, entrypointUrl }: CanvasSourceInput): string | null {
  if (projectId !== null && activeRelPath !== null) {
    if (indexedRelPaths?.length === 0) return null;
    return `/api/projects/${projectId}/fs/${encodePath(activeRelPath)}`;
  }
  if (!entrypointUrl || /\/fs\/?$/u.test(entrypointUrl)) return null;
  return entrypointUrl;
}

function encodePath(relPath: string): string {
  return relPath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

/** Parse a frame href into a safe local HTML target without trusting its existence. */
export function resolveCanvasPageTarget(href: unknown, documentUrl: string): CanvasPageTarget | null {
  if (typeof href !== "string") return null;
  try {
    const document = new URL(documentUrl);
    const root = document.pathname.match(/^\/api\/projects\/[^/]+\/fs\//u)?.[0];
    const target = new URL(href, document);
    if (!root || target.origin !== document.origin || target.username || target.password || !target.pathname.startsWith(root) || /%(?:2f|5c)/iu.test(target.pathname)) return null;
    const decodedPath = decodeURIComponent(target.pathname.slice(root.length));
    if (decodedPath.includes("\\") || [...decodedPath].some((character) => character.charCodeAt(0) < 32)) return null;
    const hasHtmlExtension = /\.html?$/iu.test(decodedPath);
    const lastSegment = decodedPath.replace(/\/$/u, "").split("/").at(-1) ?? "";
    if (!hasHtmlExtension && lastSegment.includes(".")) return null;
    const relPath = hasHtmlExtension ? decodedPath : `${decodedPath.replace(/\/$/u, "")}/index.html`;
    if (relPath === "index.html" && decodedPath === "") return null;
    if (relPath !== decodedPath) target.pathname = `${root}${encodePath(relPath)}`;
    return { relPath, url: target.href };
  } catch {
    return null;
  }
}

/** Resolve frame navigation only to indexed HTML inside this project's file boundary. */
export function resolveCanvasNavigation(href: unknown, documentUrl: string, indexedRelPaths: readonly string[]): CanvasPageTarget | null {
  const target = resolveCanvasPageTarget(href, documentUrl);
  return target !== null && indexedRelPaths.includes(target.relPath) ? target : null;
}
