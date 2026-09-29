#!/usr/bin/env bun
import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Masks a HAR recorded against a running BurnGuard before it is shared: the per-launch capability (header, cookie,
 * bootstrap body and every other place its value appears), authorization headers, cookies, secret-named query, form
 * and JSON body fields, and home paths plus caller-given roots everywhere in the file. The output is verified to
 * contain none of the collected secret values before it is written. Known limit: a home directory name containing a
 * space is masked only up to the space; pass that root with --root.
 */

export const MASKED = "[masked]";
const SECRET_HEADERS = new Set(["x-burnguard-capability", "authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key"]);
const SECRET_PARAMS = /^(?:capability|token|access_token|refresh_token|id_token|api_key|apikey|key|secret|client_secret|password)$|(?:_token|_api_key|_apikey|_secret|_password|_access_key)$/iu;
/** Values shorter than this are not treated as secrets, so masking never rewrites ordinary short words. */
const MIN_SECRET_LENGTH = 8;
const MIN_BODY_SECRET_LENGTH = 16;
/** Body field names too generic to trust at short lengths ("key" can be a route segment). */
const GENERIC_SECRET_NAME = /^(?:key|token)$/iu;
/** Objects or arrays whose every string value is a secret, keyed by connection or provider id. */
const SECRET_CONTAINER = /(?:^|_)(?:api_keys|api_tokens|access_tokens|secrets|credentials|passwords)$/iu;
const HOME_PATTERNS: readonly RegExp[] = [
  /\/(?:home|Users)\/[^/\s"'<>\\]+/giu,
  /\/root(?=\/)/gu,
  /[A-Za-z]:\\{1,2}Users\\{1,2}[^\\\s"'<>]+/giu,
  /%2F(?:home|Users)%2F[^%\s"'&<>]+/giu,
  /[A-Za-z]%3A%5C(?:%5C)?Users%5C(?:%5C)?[^%\s"'&<>]+/giu,
];
const TEXT_MIME = /^(?:text\/|application\/(?:json|javascript|xml|x-www-form-urlencoded|x-ndjson)|image\/svg\+xml)/iu;

export type HarMaskReport = { readonly secret_values: number; readonly headers: number; readonly cookies: number; readonly params: number; readonly paths: number };
export type PrivateRoot = { readonly path: string; readonly placeholder: string };
export class HarMaskError extends Error {
  constructor(readonly code: "invalid_har" | "secret_remains" | "capability_not_found" | "invalid_arguments" | "output_exists" | "input_unreadable") { super(code); }
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
const isObject = (value: unknown): value is Record<string, Json> => typeof value === "object" && value !== null && !Array.isArray(value);
const entriesOf = (har: Record<string, Json>): Record<string, Json>[] => {
  const log = har["log"];
  if (!isObject(log) || !Array.isArray(log["entries"])) throw new HarMaskError("invalid_har");
  return log["entries"].filter(isObject);
};

/** Text of a request or response body, base64 bodies decoded; empty when there is none. */
function bodyText(message: Record<string, Json>): string {
  const body = isObject(message["postData"]) ? message["postData"] : isObject(message["content"]) ? message["content"] : null;
  if (body === null || typeof body["text"] !== "string") return "";
  return body["encoding"] === "base64" ? Buffer.from(body["text"], "base64").toString("utf8") : body["text"];
}

/** String values under secret-named keys anywhere in a JSON body, such as data.capability in /api/bootstrap. */
function jsonBodySecrets(text: string): { readonly value: string; readonly specific: boolean }[] {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return []; }
  const found: { value: string; specific: boolean }[] = [];
  // Inside a secret container such as llm_api_keys every string is a secret, whatever its own key (a connection id).
  const walk = (value: unknown, depth: number, inContainer: boolean): void => {
    if (depth > 32) return;
    if (typeof value === "string") { if (inContainer) found.push({ value, specific: true }); return; }
    if (Array.isArray(value)) { for (const item of value) walk(item, depth + 1, inContainer); return; }
    if (!isObject(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === "string" && (inContainer || SECRET_PARAMS.test(key))) found.push({ value: child, specific: inContainer || !GENERIC_SECRET_NAME.test(key) });
      else walk(child, depth + 1, inContainer || SECRET_CONTAINER.test(key));
    }
  };
  walk(parsed, 0, false);
  return found;
}

const isBootstrap = (entry: Record<string, Json>): boolean => {
  const request = entry["request"];
  if (!isObject(request)) return false;
  try { return new URL(String(request["url"] ?? "")).pathname === "/api/bootstrap"; } catch { return false; }
};

function collectSecrets(entries: readonly Record<string, Json>[]): Set<string> {
  const secrets = new Set<string>();
  // Cookie values may be wrapped in DQUOTEs; the bare value is what appears elsewhere.
  const add = (value: string) => { const trimmed = value.trim().replace(/^"(.*)"$/u, "$1"); if (trimmed.length >= MIN_SECRET_LENGTH) secrets.add(trimmed); };
  for (const entry of entries) for (const side of ["request", "response"] as const) {
    const message = entry[side];
    if (!isObject(message)) continue;
    // Specific secret names and secret containers count from MIN_SECRET_LENGTH; the generic names "key" and "token"
    // (a "key" can be a route segment) only from MIN_BODY_SECRET_LENGTH.
    for (const found of jsonBodySecrets(bodyText(message))) if (found.value.trim().length >= (found.specific ? MIN_SECRET_LENGTH : MIN_BODY_SECRET_LENGTH)) add(found.value);
    const postData = message["postData"];
    for (const param of isObject(postData) && Array.isArray(postData["params"]) ? postData["params"].filter(isObject) : []) if (SECRET_PARAMS.test(String(param["name"] ?? ""))) add(String(param["value"] ?? ""));
    for (const header of Array.isArray(message["headers"]) ? message["headers"].filter(isObject) : []) {
      const name = String(header["name"] ?? "").toLowerCase();
      const value = String(header["value"] ?? "");
      if (!SECRET_HEADERS.has(name)) continue;
      if (name === "cookie") for (const part of value.split(";")) add(part.slice(part.indexOf("=") + 1));
      else if (name === "set-cookie") for (const line of value.split("\n")) { const pair = line.split(";")[0] ?? ""; add(pair.slice(pair.indexOf("=") + 1)); }
      else add(value.replace(/^(?:bearer|basic)\s+/iu, ""));
    }
    for (const cookie of Array.isArray(message["cookies"]) ? message["cookies"].filter(isObject) : []) add(String(cookie["value"] ?? ""));
    for (const param of Array.isArray(message["queryString"]) ? message["queryString"].filter(isObject) : []) if (SECRET_PARAMS.test(String(param["name"] ?? ""))) add(String(param["value"] ?? ""));
  }
  return secrets;
}

/** Returns a masked copy of a parsed HAR and counts what was masked; the report never contains a masked value. */
export function maskHar(input: unknown, roots: readonly PrivateRoot[] = []): { readonly har: unknown; readonly report: HarMaskReport } {
  if (!isObject(input)) throw new HarMaskError("invalid_har");
  const har = JSON.parse(JSON.stringify(input)) as Record<string, Json>;
  const entries = entriesOf(har);
  const secrets = [...collectSecrets(entries)].sort((a, b) => b.length - a.length);
  // The bootstrap response is where the capability is minted. A body there that yields no capability means the
  // format is not understood, so masking fails closed instead of trusting that nothing leaked.
  for (const entry of entries.filter(isBootstrap)) {
    const response = entry["response"];
    const status = isObject(response) ? Number(response["status"]) : 0;
    const text = isObject(response) ? bodyText(response) : "";
    if (status >= 200 && status < 300 && text.trim() !== "" && jsonBodySecrets(text).length === 0) throw new HarMaskError("capability_not_found");
  }
  const counts = { secret_values: secrets.length, headers: 0, cookies: 0, params: 0, paths: 0 };
  // Longer roots first, so a nested root keeps its own placeholder.
  const orderedRoots = [...roots].filter(root => root.path.length > 1).sort((a, b) => b.path.length - a.path.length);
  const scrub = (text: string): string => {
    let out = text;
    for (const secret of secrets) out = out.replaceAll(secret, MASKED).replaceAll(encodeURIComponent(secret), MASKED);
    for (const root of orderedRoots) { const next = out.replaceAll(root.path, root.placeholder); if (next !== out) counts.paths += 1; out = next; }
    for (const pattern of HOME_PATTERNS) { const next = out.replace(pattern, "<home>"); if (next !== out) counts.paths += 1; out = next; }
    return out;
  };
  const walk = (value: Json): Json => {
    if (typeof value === "string") return scrub(value);
    if (Array.isArray(value)) return value.map(walk);
    if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, walk(child)]));
    return value;
  };
  for (const entry of entries) for (const side of ["request", "response"] as const) {
    const message = entry[side];
    if (!isObject(message)) continue;
    const postData = message["postData"];
    for (const param of isObject(postData) && Array.isArray(postData["params"]) ? postData["params"].filter(isObject) : []) if (SECRET_PARAMS.test(String(param["name"] ?? ""))) { param["value"] = MASKED; counts.params += 1; }
    for (const header of Array.isArray(message["headers"]) ? message["headers"].filter(isObject) : []) if (SECRET_HEADERS.has(String(header["name"] ?? "").toLowerCase())) { header["value"] = MASKED; counts.headers += 1; }
    for (const cookie of Array.isArray(message["cookies"]) ? message["cookies"].filter(isObject) : []) { cookie["value"] = MASKED; counts.cookies += 1; }
    for (const param of Array.isArray(message["queryString"]) ? message["queryString"].filter(isObject) : []) if (SECRET_PARAMS.test(String(param["name"] ?? ""))) { param["value"] = MASKED; counts.params += 1; }
    // Base64 text bodies are decoded, masked and re-encoded; binary bodies cannot carry a text secret legibly and stay as they are.
    const content = message["content"];
    if (isObject(content) && content["encoding"] === "base64" && typeof content["text"] === "string" && TEXT_MIME.test(String(content["mimeType"] ?? ""))) {
      content["text"] = Buffer.from(scrub(Buffer.from(content["text"], "base64").toString("utf8")), "utf8").toString("base64");
    }
  }
  const masked = walk(har);
  const serialized = JSON.stringify(masked);
  const decodedBodies = entriesOf(masked as Record<string, Json>).flatMap(entry => { const content = isObject(entry["response"]) ? entry["response"]["content"] : null; return isObject(content) && content["encoding"] === "base64" && typeof content["text"] === "string" ? [Buffer.from(content["text"], "base64").toString("latin1")] : []; });
  if (secrets.some(secret => serialized.includes(secret) || decodedBodies.some(body => body.includes(secret)))) throw new HarMaskError("secret_remains");
  return { har: masked, report: counts };
}

/** CLI: bun scripts/qa/har-mask.ts <input.har> <output.har> [--root <absolute path>=<placeholder>]... */
async function main(argv: readonly string[]): Promise<number> {
  const [input, output, ...rest] = argv;
  const roots: PrivateRoot[] = [];
  for (let index = 0; index < rest.length; index += 2) {
    const spec = rest[index + 1] ?? "";
    const split = spec.lastIndexOf("=");
    if (rest[index] !== "--root" || split <= 0 || !path.isAbsolute(spec.slice(0, split))) throw new HarMaskError("invalid_arguments");
    roots.push({ path: spec.slice(0, split), placeholder: spec.slice(split + 1) });
  }
  if (input === undefined || output === undefined || path.resolve(input) === path.resolve(output)) throw new HarMaskError("invalid_arguments");
  const raw = await Bun.file(input).text().catch(() => { throw new HarMaskError("input_unreadable"); });
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new HarMaskError("invalid_har"); }
  const { har, report } = maskHar(parsed, roots);
  // "wx" never replaces an existing file, so a symlink or hard link to the raw input cannot be overwritten either.
  await writeFile(output, `${JSON.stringify(har, null, 2)}\n`, { mode: 0o600, flag: "wx" }).catch((error: NodeJS.ErrnoException) => { if (error.code === "EEXIST") throw new HarMaskError("output_exists"); throw error; });
  await chmod(output, 0o600);
  process.stdout.write(`${JSON.stringify({ schema_version: 1, output: path.basename(output), ...report })}\n`);
  return 0;
}

if (import.meta.main) {
  try { process.exitCode = await main(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({ error: error instanceof HarMaskError ? error.code : "har_mask_failed" })}\n`);
    process.exitCode = 1;
  }
}
