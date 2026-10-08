// Antivirus, cloud sync or a racing rename can fail one project's storage with a raw errno; that must not lock out the profile.
const PROJECT_STORAGE_ERRNO = new Set(["EPERM", "EBUSY", "EACCES", "ENOENT", "ENOTDIR", "EISDIR", "EIO", "EAGAIN", "EMFILE", "ENFILE", "ETXTBSY", "ENOTEMPTY", "EEXIST", "ELOOP", "EROFS", "ENOSPC"]);

/** True for an errno-coded filesystem error scoped to one project's storage (transient or not); anything else is a bug and must surface. */
export function isProjectStorageError(error: unknown): boolean {
  return error instanceof Error && "code" in error && typeof error.code === "string" && PROJECT_STORAGE_ERRNO.has(error.code);
}
