export type CanvasSourceInput = {
  readonly projectId: string | null;
  readonly activeRelPath: string | null;
  readonly indexedRelPaths: readonly string[] | null;
  readonly entrypointUrl: string | null;
};

export function resolveCanvasSource({
  projectId,
  activeRelPath,
  indexedRelPaths,
  entrypointUrl,
}: CanvasSourceInput): string | null {
  if (projectId !== null && activeRelPath !== null) {
    if (indexedRelPaths?.length === 0) return null;
    return `/api/projects/${projectId}/fs/${encodePath(activeRelPath)}`;
  }
  if (!entrypointUrl || /\/fs\/?$/u.test(entrypointUrl)) return null;
  return entrypointUrl;
}

function encodePath(relPath: string): string {
  return relPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** Resolve frame navigation only to indexed HTML inside this project's file boundary. */
export function resolveCanvasNavigation(href: unknown, documentUrl: string, indexedRelPaths: readonly string[]): { relPath: string; url: string } | null {
  if (typeof href !== "string") return null;
  try {
    const document = new URL(documentUrl);
    const root = document.pathname.match(/^\/api\/projects\/[^/]+\/fs\//)?.[0];
    const target = new URL(href, document);
    if (!root || target.origin !== document.origin || target.username || target.password || !target.pathname.startsWith(root) || /%(?:2f|5c)/i.test(target.pathname)) return null;
    const relPath = decodeURIComponent(target.pathname.slice(root.length));
    if (/[\\\x00-\x1f]/.test(relPath) || !/\.html?$/i.test(relPath) || !indexedRelPaths.includes(relPath)) return null;
    return { relPath, url: target.href };
  } catch {
    return null;
  }
}
