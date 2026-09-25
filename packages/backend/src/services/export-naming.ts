/**
 * Helpers for the export download route.
 *
 * Two related fixes from the export audit:
 *   - Every download was served with `Content-Type: application/zip`
 *     regardless of format, which mis-typed PDF and PPTX downloads.
 *     Some clients (mail, Slack preview, archive scanners) infer from
 *     MIME, not extension.
 *   - The download filename was the internal staging name
 *     `<projectId>-<jobId>.zip`, which is illegible. Friendly names
 *     give the user a self-describing artifact.
 *
 * Pure / data-only so the helpers can be unit-tested without the route.
 */
import type { ExportFormat, ExportJob, ProjectType } from "@bg/shared";

export function formatExtension(format: ExportFormat): string {
  switch (format) {
    case "pdf":
      return "pdf";
    case "png":
      return "png";
    case "svg":
      return "svg";
    case "pptx":
      return "pptx";
    case "html_zip":
    case "handoff":
    case "cafe24_package":
    case "imweb_package":
    case "png_zip":
      return "zip";
  }
}

export function formatMime(format: ExportFormat): string {
  switch (format) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "svg":
      return "image/svg+xml";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "html_zip":
    case "handoff":
    case "cafe24_package":
    case "imweb_package":
    case "png_zip":
      return "application/zip";
  }
}

/**
 * Human-readable suffix that goes in the filename body. Mirrors the
 * Export menu labels in the UI so the file the user opens looks like
 * the menu item they clicked, not the internal enum value.
 */
export function formatFilenameTag(format: ExportFormat): string {
  switch (format) {
    case "pdf":
      return "deck";
    case "png":
      return "png";
    case "svg":
      return "logo";
    case "pptx":
      return "deck";
    case "html_zip":
      return "html";
    case "handoff":
      return "handoff";
    case "cafe24_package":
      return "cafe24";
    case "imweb_package":
      return "imweb";
    case "png_zip":
      return "frames";
  }
}

/**
 * A logo project ships a different deliverable under the same formats: its PDF is the brand
 * guidelines rather than a deck, and its HTML archive is the guidelines site. The tag therefore
 * depends on the (format, project type) pair, not on the format alone.
 */
function filenameTag(format: ExportFormat, projectType: ProjectType | undefined): string {
  if (projectType === "logo") {
    if (format === "pdf") return "guidelines";
    if (format === "html_zip") return "guidelines-html";
  }
  return formatFilenameTag(format);
}

const FILENAME_MAX_LEN = 80;

/**
 * Slugifies a project name into a filesystem-friendly fragment.
 * Keeps Unicode letters and digits (so Korean / Japanese names survive)
 * but strips control chars, path separators, and reserved Windows
 * characters. Collapses whitespace into single hyphens. Falls back to
 * "export" when the input slugifies to nothing.
 */
export function slugifyProjectName(name: string): string {
  const stripped = [...name]
    .map((character) => character.charCodeAt(0) <= 31 ? " " : character)
    .join("")
    // Forbidden filename characters across major OSes.
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Drop a high surrogate orphaned by the code-unit cut; encodeURIComponent rejects it.
  const truncated = stripped.slice(0, FILENAME_MAX_LEN).replace(/[\uD800-\uDBFF]$/u, "");
  return truncated.length > 0 ? truncated : "export";
}

/**
 * Builds the user-facing download filename:
 *   `<project-slug>-<tag>-<YYYY-MM-DD>.<ext>`
 * Date comes from the job's completion timestamp when available, else
 * the creation timestamp.
 */
export function buildDownloadFilename(input: {
  readonly projectName: string | null;
  readonly revision: number;
  readonly format: ExportFormat;
  readonly projectType?: ProjectType | undefined;
} | {
  readonly projectName: string | null;
  readonly job: Pick<ExportJob, "format" | "completed_at" | "created_at">;
  readonly projectType?: ProjectType | undefined;
}): string {
  const slug = slugifyProjectName(input.projectName ?? "export");
  if ("revision" in input) {
    return `${slug}-${filenameTag(input.format, input.projectType)}-r${input.revision}.${formatExtension(input.format)}`;
  }
  const tag = filenameTag(input.job.format, input.projectType);
  const ts = input.job.completed_at ?? input.job.created_at;
  return `${slug}-${tag}-${formatDate(ts)}.${formatExtension(input.job.format)}`;
}

function formatDate(ts: number | null | undefined): string {
  const date = new Date(typeof ts === "number" ? ts : Date.now());
  // ISO YYYY-MM-DD (UTC) — stable across runs and timezones; the file
  // is a one-time artifact so calendar-day precision is plenty.
  return date.toISOString().slice(0, 10);
}

/**
 * Encodes the filename for an HTTP `Content-Disposition` header.
 *
 * Emits both the legacy ASCII `filename=` parameter (with non-ASCII
 * characters replaced) and the RFC 5987 `filename*` parameter
 * (UTF-8 percent-encoded), so modern browsers preserve Unicode names
 * and older clients still get a sane fallback. Inner double-quotes
 * are escaped per RFC 6266.
 */
export function buildContentDisposition(filename: string): string {
  const asciiSafe = filename
    // Replace anything outside printable ASCII with underscore.
    // Drop double-quotes too — they would terminate the quoted-string.
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/"/g, "_");
  const utf8 = encodeURIComponent(filename);
  return `attachment; filename="${asciiSafe}"; filename*=UTF-8''${utf8}`;
}
