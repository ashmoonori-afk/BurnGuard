export type CanvasWriteInvalidation = { readonly queryKey: readonly string[]; readonly exact: boolean };

/**
 * A Style/Edit PATCH bumps `projects.current_revision` with the file, so the
 * project row is refetched too; otherwise the UX review compares a fresh
 * artifact revision against a stale project revision and locks itself.
 */
export function canvasWriteInvalidations(id: string, relPath: string): readonly CanvasWriteInvalidation[] {
  return [
    { queryKey: ["project", id], exact: true },
    { queryKey: ["project", id, "files"], exact: false },
    { queryKey: ["project", id, "artifacts"], exact: false },
    { queryKey: ["project", id, "fs", relPath, "undo-info"], exact: false },
  ];
}
