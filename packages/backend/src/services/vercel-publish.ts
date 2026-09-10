import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import type { VercelDeployment } from "@bg/shared";
import { getExportJob } from "../db/exports";
import { getProjectDetail } from "../db/project-read-repository";
import { verifyExportDownload } from "./export-download";
import { validateHtmlArchive, type HtmlArchiveManifest } from "./export-html-validation";
import { sha256 } from "./export-receipt";

export class VercelPublishError extends Error {
  constructor(readonly code: string) { super(code); }
}

// Only browser assets are public; never upload package/config files or archive metadata.
export function isPublicAsset(name: string): boolean {
  const parts = name.split("/");
  return !parts.some((part, index) => {
    if (!part || part.startsWith(".") || /^(?:attachments?|references?|node_modules|private)$/i.test(part)) return true;
    if (index === parts.length - 1 && part.toLowerCase() === "tokens.css") return false;
    return /(?:^|[._ -])(?:secrets?|tokens?|credentials?|passwords?|api[._ -]*keys?|(?:access|refresh|auth|bearer)[._ -]*tokens?|private[._ -]*keys?)(?:[._ -]|$)/i.test(part.replace(/([a-z0-9])([A-Z])/g, "$1-$2"));
  })
    && !/[\\:%\x00-\x1f]/.test(name)
    && (/\.(?:html?|css|js|mjs|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|mp4|webm|mp3|wav)$/i.test(name) || /^fonts\/[a-z0-9_-]+-OFL\.txt$/i.test(name))
    && !/(?:^|\/)(?:[^/]*config[^/]*|credentials[^/]*)$/i.test(name);
}

export async function deploymentFiles(bytes: Uint8Array, expected: Omit<HtmlArchiveManifest, "entries">) {
  const manifest = await validateHtmlArchive(bytes, expected);
  if (!isPublicAsset(manifest.entrypoint)) throw new VercelPublishError("publish_unsafe_asset");
  const publicEntries = manifest.entries.filter((file) => isPublicAsset(file.path));
  if (publicEntries.reduce((n, file) => n + file.size, 0) > 100_000_000) throw new VercelPublishError("publish_size_limit");
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const files = await Promise.all(publicEntries.map(async ({ path }) => ({ file: path, data: await zip.file(path)!.async("uint8array") })));
  // Keep nested entrypoints in place so relative asset URLs retain their meaning.
  if (manifest.entrypoint !== "index.html") {
    if (manifest.entries.some((entry) => entry.path === "index.html")) throw new VercelPublishError("publish_entrypoint_conflict");
    const destination = manifest.entrypoint.split("/").map(encodeURIComponent).join("/");
    files.push({ file: "index.html", data: new TextEncoder().encode(`<html><head><meta http-equiv="refresh" content="0;url=/${destination}"></head><body><a href="/${destination}">Open</a></body></html>`) });
  }
  return files;
}

export async function publishExport(jobId: string, token: string, teamId: string | undefined, signal: AbortSignal): Promise<VercelDeployment> {
  const verified = await verifyExportDownload(jobId);
  const job = await getExportJob(jobId);
  const project = await getProjectDetail(verified.projectId);
  const attempt = job?.latest_attempt;
  if (verified.format !== "html_zip" || !project || !attempt || !attempt.digests.input_closure) throw new VercelPublishError("publish_export_required");
  const bytes = new Uint8Array(await readFile(verified.path));
  if (sha256(bytes) !== attempt.digests.output) throw new VercelPublishError("publish_export_changed");
  const files = await deploymentFiles(bytes, { schema_version: 1, entrypoint: project.entrypoint, project_revision: attempt.project_revision, project_digest: attempt.project_digest, input_closure_digest: attempt.digests.input_closure });
  signal.throwIfAborted();
  return requestVercel("/v13/deployments", token, teamId, signal, {
    name: `burnguard-${jobId.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40)}`,
    target: "production", files: await uploadDeploymentFiles(files, token, teamId, signal),
    projectSettings: { framework: null, buildCommand: "", installCommand: "", outputDirectory: null },
  });
}

export async function uploadDeploymentFiles(files: readonly { file: string; data: Uint8Array }[], token: string, teamId: string | undefined, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const references: { file: string; sha: string; size: number }[] = [];
  for (const file of files) {
    signal.throwIfAborted();
    const sha = createHash("sha1").update(file.data).digest("hex");
    const response = await fetcher(`https://api.vercel.com/v2/files${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ""}`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream", "Content-Length": String(file.data.byteLength), "x-vercel-digest": sha },
      body: Buffer.from(file.data), signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]), redirect: "error",
    });
    if (!response.ok) throw new VercelPublishError(response.status === 401 || response.status === 403 ? "publish_auth_failed" : response.status === 429 ? "publish_rate_limit" : "publish_provider_failed");
    await response.body?.cancel();
    references.push({ file: file.file, sha, size: file.data.byteLength });
  }
  return references;
}

export async function requestVercel(endpoint: string, token: string, teamId: string | undefined, signal: AbortSignal, body?: unknown, fetcher: typeof fetch = fetch): Promise<VercelDeployment> {
  const response = await fetcher(`https://api.vercel.com${endpoint}${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ""}`, {
    method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]), redirect: "error",
  });
  if (!response.ok) throw new VercelPublishError(response.status === 401 || response.status === 403 ? "publish_auth_failed" : response.status === 429 ? "publish_rate_limit" : "publish_provider_failed");
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || !("id" in value) || typeof value.id !== "string" || !/^dpl_[a-zA-Z0-9]+$/.test(value.id) || !("url" in value) || typeof value.url !== "string" || !/^[a-zA-Z0-9-]+\.vercel\.app$/.test(value.url)) throw new VercelPublishError("publish_provider_failed");
  const state = "readyState" in value ? value.readyState : "status" in value ? value.status : undefined;
  if (state === "ERROR" || state === "CANCELED") throw new VercelPublishError("publish_build_failed");
  const alias = state === "READY" && "alias" in value && Array.isArray(value.alias)
    ? value.alias.find((item: unknown): item is string => typeof item === "string" && /^[a-zA-Z0-9-]+\.vercel\.app$/.test(item)) : undefined;
  return { schema_version: 1, id: value.id, url: `https://${alias ?? value.url}`, ready: state === "READY" };
}
