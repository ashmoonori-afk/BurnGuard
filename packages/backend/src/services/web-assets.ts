import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import {
  APP_VERSION,
  WEB_ASSET_CREDITS_FILE,
  WEB_ASSET_DIR,
  WEB_ASSET_KINDS,
  type WebAssetCandidate,
  type WebAssetCredit,
  type WebAssetCreditsV1,
  type WebAssetKind,
} from "@bg/shared";
import { resolveWithin } from "../security/path-boundary";

/**
 * Searches keyless open-licence providers and imports a chosen asset into a project stage. Every request goes to
 * one of two fixed HTTPS hosts with redirects refused, so a provider response can never steer a download to an
 * arbitrary or private address. Licence metadata is always re-read from the provider at import time; the caller
 * supplies only the candidate id.
 */

export type WebAssetErrorCode =
  | "invalid_request"
  | "network_unavailable"
  | "provider_error"
  | "not_found"
  | "license_not_allowed"
  | "invalid_asset"
  | "too_large";

export class WebAssetError extends Error {
  constructor(readonly code: WebAssetErrorCode) {
    super(code);
    this.name = "WebAssetError";
  }
}

export type WebAssetFetch = (
  url: string,
  init: { readonly signal: AbortSignal; readonly redirect: "manual"; readonly headers: Readonly<Record<string, string>> },
) => Promise<Response>;

export interface WebAssetDependencies {
  readonly fetch?: WebAssetFetch;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
}

const OPENVERSE_HOST = "api.openverse.org";
const ICONIFY_HOST = "api.iconify.design";
const ALLOWED_HOSTS: ReadonlySet<string> = new Set([OPENVERSE_HOST, ICONIFY_HOST]);
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_SVG_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_WEB_ASSET_RESULTS = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ICON_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Icon-set licences that allow commercial use and modification without share-alike terms. */
const ICON_LICENSES: ReadonlySet<string> = new Set(["MIT", "Apache-2.0", "ISC", "CC0-1.0", "CC-BY-3.0", "CC-BY-4.0", "OFL-1.1", "BSD-2-Clause", "BSD-3-Clause", "Unlicense"]);

async function request(url: URL, maxBytes: number, deps: WebAssetDependencies): Promise<{ readonly bytes: Uint8Array; readonly contentType: string }> {
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) throw new WebAssetError("invalid_request");
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(url.href, {
      signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      redirect: "manual",
      headers: { accept: "application/json, image/*", "user-agent": `BurnGuard/${APP_VERSION}` },
    });
  } catch {
    throw new WebAssetError("network_unavailable");
  }
  if (response.status === 404) throw new WebAssetError("not_found");
  if (response.status !== 200) throw new WebAssetError("provider_error");
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new WebAssetError("too_large");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    const reader = response.body?.getReader();
    while (reader !== undefined) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new WebAssetError("too_large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof WebAssetError) throw error;
    throw new WebAssetError("network_unavailable");
  }
  return { bytes: Buffer.concat(chunks), contentType: (response.headers.get("content-type") ?? "").toLowerCase() };
}

async function requestJson(url: URL, deps: WebAssetDependencies): Promise<unknown> {
  const { bytes } = await request(url, MAX_JSON_BYTES, deps);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new WebAssetError("provider_error");
  }
}

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, max = 200): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max) : null;
const httpsUrl = (value: unknown): string | null => {
  const raw = text(value, 500);
  if (raw === null) return null;
  try {
    return new URL(raw).protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
};

export function parseWebAssetQuery(input: unknown): { readonly query: string; readonly kind: WebAssetKind; readonly limit: number } {
  const source = record(input);
  const query = typeof source.query === "string" ? source.query.trim() : "";
  if (query.length === 0 || query.length > 100 || /[\u0000-\u001f\u007f]/.test(query)) throw new WebAssetError("invalid_request");
  const kind = WEB_ASSET_KINDS.find((candidate) => candidate === source.kind);
  if (kind === undefined) throw new WebAssetError("invalid_request");
  const limit = source.limit === undefined ? 6 : source.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_WEB_ASSET_RESULTS) throw new WebAssetError("invalid_request");
  return { query, kind, limit };
}

function openverseLicense(item: Record<string, unknown>): { readonly license: string; readonly attribution_required: boolean } | null {
  const version = text(item.license_version, 10) ?? "";
  switch (item.license) {
    case "cc0": return { license: "CC0 1.0", attribution_required: false };
    case "pdm": return { license: "Public Domain Mark 1.0", attribution_required: false };
    case "by": return { license: `CC BY ${version}`.trim(), attribution_required: true };
    case "by-sa": return { license: `CC BY-SA ${version}`.trim(), attribution_required: true };
    default: return null;
  }
}

function openverseCandidate(input: unknown, kind: WebAssetKind): WebAssetCandidate | null {
  const item = record(input);
  const id = typeof item.id === "string" && UUID.test(item.id) ? item.id : null;
  const license = openverseLicense(item);
  const source = httpsUrl(item.foreign_landing_url) ?? (id === null ? null : `https://openverse.org/image/${id}`);
  if (id === null || license === null || source === null) return null;
  return {
    id: `openverse:${id}`,
    kind,
    provider: "openverse",
    title: text(item.title) ?? "Untitled",
    creator: text(item.creator),
    source_url: source,
    license: license.license,
    license_url: httpsUrl(item.license_url),
    attribution_required: license.attribution_required,
  };
}

function iconCandidate(prefix: string, name: string, collection: unknown): WebAssetCandidate | null {
  if (!ICON_SEGMENT.test(prefix) || !ICON_SEGMENT.test(name)) return null;
  const info = record(collection);
  const license = record(info.license);
  const spdx = typeof license.spdx === "string" ? license.spdx : "";
  if (!ICON_LICENSES.has(spdx)) return null;
  return {
    id: `iconify:${prefix}:${name}`,
    kind: "icon",
    provider: "iconify",
    title: `${text(info.name) ?? prefix}: ${name}`,
    creator: text(record(info.author).name),
    source_url: `https://icon-sets.iconify.design/${prefix}/${name}/`,
    license: spdx,
    license_url: httpsUrl(license.url),
    attribution_required: spdx.startsWith("CC-BY"),
  };
}

export async function searchWebAssets(input: unknown, deps: WebAssetDependencies = {}): Promise<readonly WebAssetCandidate[]> {
  const { query, kind, limit } = parseWebAssetQuery(input);
  if (kind === "icon") {
    const url = new URL(`https://${ICONIFY_HOST}/search`);
    url.searchParams.set("query", query);
    url.searchParams.set("limit", "64");
    const body = record(await requestJson(url, deps));
    const collections = record(body.collections);
    const icons = Array.isArray(body.icons) ? body.icons : [];
    const results: WebAssetCandidate[] = [];
    for (const icon of icons) {
      if (typeof icon !== "string") continue;
      const [prefix = "", name = ""] = icon.split(":");
      const candidate = iconCandidate(prefix, name, collections[prefix]);
      if (candidate !== null) results.push(candidate);
      if (results.length === limit) break;
    }
    return results;
  }
  const url = new URL(`https://${OPENVERSE_HOST}/v1/images/`);
  url.searchParams.set("q", query);
  // Only licences that permit both commercial use and modification: CC0, PDM, BY and BY-SA.
  url.searchParams.set("license_type", "commercial,modification");
  url.searchParams.set("category", kind === "photo" ? "photograph" : "illustration,digitized_artwork");
  url.searchParams.set("mature", "false");
  url.searchParams.set("page_size", String(limit));
  const body = record(await requestJson(url, deps));
  const results = Array.isArray(body.results) ? body.results : [];
  return results.map((item) => openverseCandidate(item, kind)).filter((item): item is WebAssetCandidate => item !== null).slice(0, limit);
}

function imageExtension(bytes: Uint8Array): "jpg" | "png" | "webp" | "gif" | null {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
  if (ascii(0, 4) === "GIF8") return "gif";
  return null;
}

/** Iconify serves static path data; anything able to run code or load a resource is refused rather than cleaned. */
function safeSvg(bytes: Uint8Array): string {
  const svg = new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
  if (!svg.startsWith("<svg") || !svg.endsWith("</svg>")) throw new WebAssetError("invalid_asset");
  if (/<script|<foreignobject|<iframe|<image|<use\b|\bon[a-z]+\s*=|javascript:|(?:href|src)\s*=|url\s*\(|@import/i.test(svg)) throw new WebAssetError("invalid_asset");
  return svg;
}

function slug(value: string): string {
  const cleaned = value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
  return cleaned === "" ? "asset" : cleaned;
}

async function writeAtomically(target: string, data: string | Uint8Array): Promise<void> {
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { flag: "wx" });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

function parseCredit(input: unknown): WebAssetCredit | null {
  const item = record(input);
  const fields = ["id", "kind", "provider", "title", "source_url", "license", "file", "retrieved_at"] as const;
  if (fields.some((field) => typeof item[field] !== "string") || typeof item.attribution_required !== "boolean") return null;
  if (!WEB_ASSET_KINDS.some((kind) => kind === item.kind) || (item.provider !== "openverse" && item.provider !== "iconify")) return null;
  return {
    id: item.id as string,
    kind: item.kind as WebAssetKind,
    provider: item.provider,
    title: item.title as string,
    creator: typeof item.creator === "string" ? item.creator : null,
    source_url: item.source_url as string,
    license: item.license as string,
    license_url: typeof item.license_url === "string" ? item.license_url : null,
    attribution_required: item.attribution_required,
    file: item.file as string,
    retrieved_at: item.retrieved_at as string,
  };
}

export async function readWebAssetCredits(stageDir: string): Promise<WebAssetCreditsV1> {
  try {
    const parsed = record(JSON.parse(await readFile(resolveWithin(stageDir, ...WEB_ASSET_CREDITS_FILE.split("/")), "utf8")));
    const assets = Array.isArray(parsed.assets) ? parsed.assets.map(parseCredit).filter((item): item is WebAssetCredit => item !== null) : [];
    return { schema_version: 1, assets };
  } catch {
    return { schema_version: 1, assets: [] };
  }
}

export function attributionLine(credit: WebAssetCandidate): string {
  return `"${credit.title}"${credit.creator === null ? "" : ` by ${credit.creator}`}, ${credit.license}${credit.license_url === null ? "" : ` (${credit.license_url})`}, via ${credit.source_url}`;
}

async function fetchOpenverse(uuid: string, deps: WebAssetDependencies): Promise<{ readonly candidate: WebAssetCandidate; readonly bytes: Uint8Array; readonly extension: string }> {
  const detail = record(await requestJson(new URL(`https://${OPENVERSE_HOST}/v1/images/${uuid}/`), deps));
  const kind: WebAssetKind = detail.category === "photograph" ? "photo" : "illustration";
  if (openverseLicense(detail) === null) throw new WebAssetError("license_not_allowed");
  const candidate = openverseCandidate(detail, kind);
  if (candidate === null || candidate.id !== `openverse:${uuid}`) throw new WebAssetError("provider_error");
  const { bytes } = await request(new URL(`https://${OPENVERSE_HOST}/v1/images/${uuid}/thumb/?full_size=true`), MAX_IMAGE_BYTES, deps);
  const extension = imageExtension(bytes);
  if (extension === null) throw new WebAssetError("invalid_asset");
  return { candidate, bytes, extension };
}

async function fetchIconify(prefix: string, name: string, deps: WebAssetDependencies): Promise<{ readonly candidate: WebAssetCandidate; readonly bytes: string; readonly extension: string }> {
  const collectionsUrl = new URL(`https://${ICONIFY_HOST}/collections`);
  collectionsUrl.searchParams.set("prefixes", prefix);
  const collections = record(await requestJson(collectionsUrl, deps));
  if (!(prefix in collections)) throw new WebAssetError("not_found");
  const candidate = iconCandidate(prefix, name, collections[prefix]);
  if (candidate === null) throw new WebAssetError("license_not_allowed");
  const { bytes } = await request(new URL(`https://${ICONIFY_HOST}/${prefix}/${name}.svg`), MAX_SVG_BYTES, deps);
  return { candidate, bytes: safeSvg(bytes), extension: "svg" };
}

/**
 * Downloads one candidate into `assets/web/` of the stage and records it in `assets/web/credits.json`. Importing
 * the same id again replaces the file and its credit instead of duplicating either.
 */
export async function importWebAsset(stageDir: string, input: unknown, deps: WebAssetDependencies = {}): Promise<{ readonly credit: WebAssetCredit; readonly attribution: string }> {
  const id = typeof record(input).id === "string" ? (record(input).id as string).trim() : "";
  const [provider, first = "", second = "", ...rest] = id.split(":");
  let fetched: { readonly candidate: WebAssetCandidate; readonly bytes: Uint8Array | string; readonly extension: string };
  let base: string;
  if (provider === "openverse" && UUID.test(first) && second === "") {
    fetched = await fetchOpenverse(first, deps);
    base = `openverse-${slug(fetched.candidate.title)}-${first.slice(0, 8)}`;
  } else if (provider === "iconify" && ICON_SEGMENT.test(first) && ICON_SEGMENT.test(second) && rest.length === 0) {
    fetched = await fetchIconify(first, second, deps);
    base = `iconify-${first}-${second}`;
  } else {
    throw new WebAssetError("invalid_request");
  }
  const directory = resolveWithin(stageDir, ...WEB_ASSET_DIR.split("/"));
  await mkdir(directory, { recursive: true });
  const fileName = `${base}.${fetched.extension}`;
  await writeAtomically(resolveWithin(directory, fileName), fetched.bytes);
  const credit: WebAssetCredit = {
    ...fetched.candidate,
    file: `${WEB_ASSET_DIR}/${fileName}`,
    retrieved_at: (deps.now ?? (() => new Date()))().toISOString(),
  };
  const current = await readWebAssetCredits(stageDir);
  const assets = [...current.assets.filter((item) => item.id !== credit.id), credit].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const credits: WebAssetCreditsV1 = { schema_version: 1, assets };
  await writeAtomically(resolveWithin(stageDir, ...WEB_ASSET_CREDITS_FILE.split("/")), `${JSON.stringify(credits, null, 2)}\n`);
  return { credit, attribution: attributionLine(credit) };
}
