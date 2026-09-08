import { readdir } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { AcquisitionLimitError, DEFAULT_ACQUISITION_LIMITS, throwIfAcquisitionAborted, type AcquisitionLimits } from "./extraction-acquisition";
import { isOwnedQaAdapterEntryUrl } from "./extraction-qa-adapter";
import { parseSafeExtractionUrl } from "./extraction-safety";

const BLOCKED_IMPORT_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata",
  "metadata.google.internal",
  "169.254.169.254",
]);
const IGNORE_DIRS = new Set([".git", "node_modules", ".next", ".turbo", "dist", "build", "coverage"]);

export function parseExtractionSourceUrl(sourceUrl: string): URL {
  let candidate: URL;
  try {
    candidate = new URL(sourceUrl);
  } catch {
    return parseSafeExtractionUrl(sourceUrl);
  }
  return isOwnedQaAdapterEntryUrl(candidate) ? candidate : parseSafeExtractionUrl(sourceUrl);
}

export function inferExtractionSourceType(sourceUrl: string): "github" | "website" | "figma" {
  const url = parseExtractionSourceUrl(sourceUrl);
  const host = url.hostname.toLowerCase();
  if (host === "figma.com" || host === "www.figma.com") return "figma";
  if (
    ["github.com", "www.github.com", "gitlab.com", "www.gitlab.com", "bitbucket.org", "www.bitbucket.org"].includes(host) &&
    url.pathname.split("/").filter(Boolean).length >= 2
  ) return "github";
  return "website";
}

export function isUnsafeImportHostname(hostname: string): boolean {
  const host = normalizeImportHostname(hostname);
  if (!host || BLOCKED_IMPORT_HOSTS.has(host)) return true;
  if ([".local", ".internal", ".home", ".lan", ".arpa"].some((suffix) => host.endsWith(suffix))) return true;
  const ipVersion = isIP(host);
  if (ipVersion === 4) {
    const parts = host.split(".").map((part) => Number.parseInt(part, 10));
    const a = parts[0];
    const b = parts[1];
    return a === 10 || a === 127 || a === 0 || a !== undefined && a >= 224 || (a === 169 && b === 254) ||
      (a === 100 && b !== undefined && b >= 64 && b <= 127) ||
      (a === 172 && b !== undefined && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) ||
      (a === 198 && (b === 18 || b === 19));
  }
  if (ipVersion !== 6) return false;
  const canonical = new URL(`http://[${host}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(canonical);
  if (mapped !== null) {
    const high = Number.parseInt(mapped[1]!, 16), low = Number.parseInt(mapped[2]!, 16);
    return isUnsafeImportHostname(`${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`);
  }
  // Only globally routable unicast; excludes unspecified, local, multicast and translation ranges.
  return !/^[23]/.test(canonical) || canonical.startsWith("2001:db8:") || canonical.startsWith("2001:0:") || canonical.startsWith("2002:");
}

export function normalizeImportHostname(hostname: string): string {
  return hostname.trim().replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

export async function listFilesRecursive(
  rootDir: string,
  signal: AbortSignal,
  limits: AcquisitionLimits = DEFAULT_ACQUISITION_LIMITS,
): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > limits.localDepth) throw new AcquisitionLimitError("local_depth", limits.localDepth, depth);
    throwIfAcquisitionAborted(signal);
    const entries = await readdir(dir, { withFileTypes: true });
    throwIfAcquisitionAborted(signal);
    for (const entry of entries) {
      throwIfAcquisitionAborted(signal);
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) await walk(absolute, depth + 1);
      } else if (entry.isFile()) {
        if (out.length >= limits.localFiles) throw new AcquisitionLimitError("local_files", limits.localFiles, out.length + 1);
        out.push(absolute);
      }
    }
  };
  await walk(rootDir, 0);
  return out;
}

export function contentTypeForDesignSystemFile(relativePath: string): string {
  switch (path.extname(relativePath).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".md": return "text/markdown; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    case ".woff2": return "font/woff2";
    case ".ttf": return "font/ttf";
    case ".otf": return "font/otf";
    case ".js":
    case ".jsx":
    case ".ts":
    case ".tsx": return "text/plain; charset=utf-8";
    default: return "application/octet-stream";
  }
}
