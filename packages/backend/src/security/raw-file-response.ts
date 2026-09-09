import { artifactContentSecurityPolicy } from "@bg/shared/security";
import { buildContentDisposition } from "../services/export-naming";

export type RawFileDescriptor = { readonly contentType: string; readonly filename: string };

/** MIME types a browser would execute as a document when rendered inline. */
const ACTIVE_CONTENT_TYPES = new Set(["text/html", "application/xhtml+xml", "image/svg+xml", "text/xml", "application/xml"]);

/**
 * Headers for project and design-system files served from the application
 * origin. Those bytes are written by CLIs, imports and users, so they are never
 * allowed to become a same-origin top-level document: a navigation
 * (`Sec-Fetch-Dest: document`) downloads the file instead of rendering it,
 * while the sandboxed canvas, present overlay and preview frames keep loading
 * it inline under the artifact Content-Security-Policy.
 */
export function rawFileHeaders(request: Request, file: RawFileDescriptor): Record<string, string> {
  const headers: Record<string, string> = { "X-Content-Type-Options": "nosniff" };
  if (request.headers.get("sec-fetch-dest") === "document") {
    headers["Content-Disposition"] = buildContentDisposition(file.filename);
    return headers;
  }
  const mediaType = file.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (ACTIVE_CONTENT_TYPES.has(mediaType)) {
    headers["Content-Security-Policy"] = artifactContentSecurityPolicy(new URL(request.url).origin);
  }
  return headers;
}
