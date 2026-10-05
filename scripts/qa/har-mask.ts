#!/usr/bin/env bun
import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Masks a HAR recorded against a running BurnGuard before it is shared: the per-launch capability (header, cookie,
 * bootstrap body and every other place its value appears), authorization headers, cookies, secret-named query, form
 * and JSON body fields, and home paths plus caller-given roots everywhere in the file. Secrets and roots are matched
 * in the forms a HAR carries them: as is, percent-encoded and JSON-escaped (also as JSON nested in JSON strings); roots
 * also double-percent-encoded, with \u escapes, with either path separator, in
 * any letter case and in both Unicode normal forms. The output is verified to contain none of the collected secret
 * values before it is written. Known limit: a home directory name containing a space is masked only up to the space;
 * pass that root with --root.
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
/**
 * A run of backslashes as JSON escaping writes one: doubled by each level, bounded so that adjacent separators cannot
 * backtrack polynomially over a long backslash run (an unbounded run made a UNC root cubic).
 */
const BACKSLASHES = String.raw`\\{1,8}`;
/** A path separator as a HAR carries it: a slash, a backslash (doubled by each level of JSON escaping) or either one percent-encoded once or twice. */
const SEPARATOR = String.raw`(?:/|${BACKSLASHES}|%2F|%252F|(?:%5C){1,8}|(?:%255C){1,8})`;
/** JSON-escaping levels whose forms of a secret are masked; the fail-closed check covers every deeper level. */
const SECRET_ESCAPE_LEVELS = 4;
const REGEXP_SYNTAX = /[\\^$.*+?()[\]{}|/]/gu;

/** A value as it appears inside a JSON string: quotes, backslashes and control characters escaped. */
const jsonEscaped = (value: string): string => JSON.stringify(value).slice(1, -1);
/** A value as an application/x-www-form-urlencoded body writes it: a space becomes "+", unlike encodeURIComponent's "%20". */
const formEncoded = (value: string): string => new URLSearchParams([["", value]]).toString().slice(1);
/**
 * A secret in any mix of literal and percent-encoded characters, a space also as "+": form and query encoders may
 * spell each character either way. Masking rewrites only whole-value spellings; any other spelling fails closed.
 */
const secretSpelling = (secret: string): RegExp => new RegExp([...secret].map(char => {
  const encoded = [...new TextEncoder().encode(char)].map(byte => `%${byte.toString(16).padStart(2, "0")}`).join("").replace(/[a-f]/gu, hex => `[${hex}${hex.toUpperCase()}]`);
  return `(?:${[char.replace(REGEXP_SYNTAX, "\\$&"), encoded, ...(char === " " ? ["\\+"] : [])].join("|")})`;
}).join(""), "gu");
/**
 * The forms a secret takes in a HAR string: as is, percent-encoded (query and form values) and JSON-escaped once per
 * level of JSON nested inside a JSON string, longest first.
 */
const secretForms = (secret: string): string[] => {
  const forms = [secret, encodeURIComponent(secret), formEncoded(secret)];
  for (let level = 0, escaped = secret; level < SECRET_ESCAPE_LEVELS; level += 1) { escaped = jsonEscaped(escaped); forms.push(escaped); }
  return [...new Set(forms)].sort((a, b) => b.length - a.length);
};
/**
 * A value's trace at any JSON-escaping depth: once escaped, each further level only adds backslashes, so with the
 * backslashes removed every depth reads the same.
 */
const escapeTrace = (value: string): string => jsonEscaped(value).replaceAll("\\", "");

/**
 * Matches a caller-given root however the HAR spells it, on any host OS: either separator for "/" and "\", each
 * character as is, percent-encoded once or twice, JSON-escaped or as a \u escape at any JSON nesting level, a space also
 * as "+", any letter case (Windows and macOS file systems ignore case, and so do hex digits) and both Unicode normal
 * forms (macOS reports names in NFD).
 */
export function rootPattern(root: string): RegExp {
  const source = (form: string): string => [...form].map(char => {
    if (char === "/" || char === "\\") return SEPARATOR;
    const encoded = [...new TextEncoder().encode(char)].map(byte => `%${byte.toString(16).padStart(2, "0")}`).join("");
    const forms = new Set([char, encoded, encoded.replaceAll("%", "%25"), jsonEscaped(char), ...(char === " " ? ["+"] : [])]);
    const unicodeEscape = [...Array(char.length).keys()].map(index => `${BACKSLASHES}u${char.charCodeAt(index).toString(16).padStart(4, "0")}`).join("");
    return `(?:${[...[...forms].map(item => item.replace(REGEXP_SYNTAX, "\\$&")), unicodeEscape].join("|")})`;
  }).join("");
  return new RegExp([...new Set([root, root.normalize("NFC"), root.normalize("NFD")])].map(source).join("|"), "giu");
}

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

/** Visit decoded strings and keys in Unicode-escaped JSON; preserve unknown text and unchanged JSON spelling. */
function encodedJson(text: string, transform: (value: string) => string): string {
  if (!text.includes("\\u") && !text.includes("%")) return text;
  let parsed: Json;
  try { parsed = JSON.parse(text) as Json; } catch (error) { if (error instanceof SyntaxError) return text; throw error; }
  const walk = (value: Json): Json => {
    if (typeof value === "string") return transform(value);
    if (Array.isArray(value)) return value.map(walk);
    if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [transform(key), walk(child)]));
    return value;
  };
  const transformed = JSON.stringify(walk(parsed));
  return transformed === JSON.stringify(parsed) ? text : transformed;
}

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
    // A form body may be recorded as raw text only, without a params array.
    if (isObject(postData) && /^application\/x-www-form-urlencoded/iu.test(String(postData["mimeType"] ?? ""))) for (const [name, value] of new URLSearchParams(bodyText(message))) if (SECRET_PARAMS.test(name)) add(value);
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
  const spellings = secrets.map(secretSpelling);
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
  const orderedRoots = [...roots].filter(root => root.path.length > 1).sort((a, b) => b.path.length - a.path.length).map(root => ({ pattern: rootPattern(root.path), placeholder: root.placeholder }));
  const scrubPaths = (text: string): string => {
    let out = text;
    for (const root of orderedRoots) { const next = out.replace(root.pattern, () => root.placeholder); if (next !== out) counts.paths += 1; out = next; }
    for (const pattern of HOME_PATTERNS) { const next = out.replace(pattern, "<home>"); if (next !== out) counts.paths += 1; out = next; }
    // Decode nested JSON instead of enlarging separator quantifiers: UNC patterns must stay bounded.
    if (out.includes("\\".repeat(9))) {
      let parsed: unknown;
      try { parsed = JSON.parse(out); } catch (error) { if (error instanceof SyntaxError) return out; throw error; }
      const nestedPaths = (value: unknown): unknown => {
        if (typeof value === "string") return scrubPaths(value);
        if (Array.isArray(value)) return value.map(nestedPaths);
        if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, nestedPaths(child)]));
        return value;
      };
      const masked = nestedPaths(parsed);
      if (JSON.stringify(masked) !== JSON.stringify(parsed)) out = JSON.stringify(masked);
    }
    return out;
  };
  const scrub = (text: string): string => {
    let out = text;
    for (const secret of secrets) for (const form of secretForms(secret)) out = out.replaceAll(form, MASKED);
    return encodedJson(scrubPaths(out), scrub);
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
    // Base64 text bodies (request and response) are decoded, masked and re-encoded; binary bodies cannot carry a text
    // secret legibly and stay as they are, so the residual check below fails closed on them.
    for (const body of [message["content"], message["postData"]]) {
      if (isObject(body) && body["encoding"] === "base64" && typeof body["text"] === "string" && TEXT_MIME.test(String(body["mimeType"] ?? ""))) {
        body["text"] = Buffer.from(scrub(Buffer.from(body["text"], "base64").toString("utf8")), "utf8").toString("base64");
      }
    }
  }
  const masked = walk(har);
  const serialized = JSON.stringify(masked);
  const decodedBodies = entriesOf(masked as Record<string, Json>)
    .flatMap(entry => [entry["request"], entry["response"]].flatMap(message => isObject(message) ? [message["postData"], message["content"]] : []))
    .flatMap(body => isObject(body) && body["encoding"] === "base64" && typeof body["text"] === "string" ? [Buffer.from(body["text"], "base64").toString("utf8")] : []);
  // Compared by escape trace, a secret is found at any JSON nesting depth, including depths masking does not unescape.
  const traces = [serialized.replaceAll("\\", ""), ...decodedBodies.map(escapeTrace)];
  if (secrets.some(secret => [secret, encodeURIComponent(secret), formEncoded(secret)].some(form => traces.some(trace => trace.includes(escapeTrace(form)))))) throw new HarMaskError("secret_remains");
  // Mixed spellings are checked on every decoding a reader could apply to a value: each string and key of the masked HAR
  // and each decoded base64 body is percent-decoded, form-decoded ("+" as a space) and JSON-unescaped (\uXXXX, \" and
  // the like) repeatedly, JSON found along the way is parsed and its strings and keys checked the same way, and every
  // result is probed. A value that still decodes further at the bound, or nests JSON deeper than it, fails closed.
  const probes = spellings.map(spelling => new RegExp(spelling.source, "u"));
  // Decodes like a forgiving reader (URLSearchParams): invalid UTF-8 becomes U+FFFD instead of hiding the whole run.
  const percentDecoded = (text: string): string => text.replace(/(?:%[0-9a-f]{2})+/giu, sequence => Buffer.from(sequence.slice(1).split("%").map(hex => Number.parseInt(hex, 16))).toString("utf8"));
  const JSON_ESCAPES: Readonly<Record<string, string>> = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
  const jsonUnescaped = (text: string): string => text.replace(/\\(?:u([0-9a-fA-F]{4})|(["\\/bfnrt]))/gu, (_match, hex: string | undefined, char: string | undefined) => hex !== undefined ? String.fromCharCode(Number.parseInt(hex, 16)) : JSON_ESCAPES[char ?? ""] ?? char ?? "");
  const stringsOf = (value: unknown): string[] => typeof value === "string" ? [value] : Array.isArray(value) ? value.flatMap(stringsOf) : isObject(value) ? Object.entries(value).flatMap(([key, child]) => [key, ...stringsOf(child)]) : [];
  const MAX_DECODE_ROUNDS = 6;
  const MAX_DECODINGS = 64;
  const MAX_JSON_DEPTH = 8;
  const exposes = (value: string, depth: number): boolean => {
    const seen = new Set([value]);
    let frontier = [value];
    for (let round = 0; frontier.length > 0; round += 1) {
      const next: string[] = [];
      for (const text of frontier) {
        if (probes.some(probe => probe.test(text))) return true;
        if (/^\s*[[{"]/u.test(text)) {
          let parsed: unknown;
          try { parsed = JSON.parse(text); } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
          if (parsed !== undefined && depth >= MAX_JSON_DEPTH) return true;
          if (parsed !== undefined && stringsOf(parsed).some(child => child !== text && exposes(child, depth + 1))) return true;
        }
        for (const variant of [percentDecoded(text), percentDecoded(text.replaceAll("+", " ")), jsonUnescaped(text)]) {
          if (!seen.has(variant)) { seen.add(variant); next.push(variant); }
        }
      }
      if (next.length > 0 && (round >= MAX_DECODE_ROUNDS || seen.size > MAX_DECODINGS)) {
        // Past the branching bound only JSON unescaping may still make progress, as in a long backslash run: it is the
        // one decoding left, so following it to its fixed point inspects every step. Percent encoding still left at
        // this depth is not inspected further and fails closed.
        return next.some(start => {
          let text = start;
          for (let step = 0; step < 64; step += 1) {
            if (probes.some(probe => probe.test(text))) return true;
            if (percentDecoded(text) !== text) return true;
            const decoded = jsonUnescaped(text);
            if (decoded === text) return false;
            text = decoded;
          }
          return true;
        });
      }
      frontier = next;
    }
    return false;
  };
  if (probes.length > 0 && [...stringsOf(masked), ...decodedBodies].some(text => exposes(text, 0))) throw new HarMaskError("secret_remains");
  // Binary bodies are not rewritten. JSON and the two URL-encoding levels supported for private roots must still fail closed.
  const checkEncoded = (text: string): string => {
    const candidates = [text];
    for (let level = 0, decoded = text; level < 2; level += 1) {
      const next = decoded.replace(/(?:%[0-9a-f]{2})+/gi, sequence => {
        try { return decodeURIComponent(sequence); } catch { return sequence; }
      });
      if (next === decoded) break;
      candidates.push(next);
      decoded = next;
    }
    for (const candidate of candidates) {
      const trace = escapeTrace(candidate);
      if (secrets.some(secret => secretForms(secret).some(form => trace.includes(escapeTrace(form))))) throw new HarMaskError("secret_remains");
      encodedJson(candidate, checkEncoded);
    }
    return text;
  };
  for (const text of [serialized, ...decodedBodies]) checkEncoded(text);
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
