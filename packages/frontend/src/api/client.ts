import type { ApiErrorBody, ApiSuccess } from "@bg/shared";

const BURNGUARD_CAPABILITY_HEADER = "x-burnguard-capability";
const BURNGUARD_BOOTSTRAP_HEADER = "x-burnguard-bootstrap";
/** The launcher opens the app at `#bg-bootstrap:<secret>`; the backend accepts that secret for one bootstrap. */
const BOOTSTRAP_FRAGMENT_PREFIX = "#bg-bootstrap:";
let launchCapability: string | null = null;
let pendingBootstrapSecret: string | null = null;

/** Moves the launch secret out of the address bar; it is kept in memory until a bootstrap succeeds. */
function takeLaunchBootstrapSecret(): void {
  if (typeof location === "undefined" || !location.hash.startsWith(BOOTSTRAP_FRAGMENT_PREFIX)) return;
  const secret = location.hash.slice(BOOTSTRAP_FRAGMENT_PREFIX.length);
  if (/^[A-Za-z0-9_-]+$/.test(secret)) pendingBootstrapSecret = secret;
  if (typeof history !== "undefined") history.replaceState(history.state, "", location.pathname + location.search);
}

export class ApiError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly status: number;

  constructor(
    code: string,
    message: string,
    status: number,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

let inflightBootstrap: Promise<void> | null = null;

/**
 * Concurrent callers (React StrictMode runs the bootstrap effect twice in dev) share one request, so the
 * single-use secret is sent once. The request is not tied to any caller's signal; each caller only stops waiting.
 */
export function bootstrapApiAuthority(signal?: AbortSignal): Promise<void> {
  inflightBootstrap ??= requestBootstrap().finally(() => {
    inflightBootstrap = null;
  });
  const shared = inflightBootstrap;
  if (!signal) return shared;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    shared.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function requestBootstrap(): Promise<void> {
  launchCapability = null;
  takeLaunchBootstrapSecret();
  const headers = new Headers({ accept: "application/json" });
  // Reloads and new tabs carry no secret; the backend accepts the launch cookie for them.
  if (pendingBootstrapSecret !== null) headers.set(BURNGUARD_BOOTSTRAP_HEADER, pendingBootstrapSecret);
  const res = await fetch("/api/bootstrap", {
    credentials: "same-origin",
    headers,
  });
  const body = (await res.json().catch(() => null)) as
    | ApiSuccess<{ capability: string }>
    | ApiErrorBody
    | null;
  if (
    !res.ok ||
    !body ||
    "error" in body ||
    !("data" in body) || !body.data ||
    typeof body.data.capability !== "string" ||
    body.data.capability.length === 0
  ) {
    throw new Error("BurnGuard API authority bootstrap failed.");
  }
  launchCapability = body.data.capability;
  pendingBootstrapSecret = null;
}

/**
 * Raw authorized fetch. Attaches the launch capability and returns the
 * untouched Response so callers can read headers (artifact identity) or a
 * non-JSON body. Prefer `apiFetch` for envelope endpoints.
 */
export async function authorizedFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  if (!launchCapability) {
    throw new Error("BurnGuard API authority is not initialized.");
  }
  let target: URL;
  const appLocation =
    typeof location === "undefined"
      ? new URL("http://burnguard.invalid/")
      : location;
  try {
    target = new URL(path, appLocation.href);
  } catch {
    throw new Error("BurnGuard API requests must stay on the app origin.");
  }
  if (target.origin !== appLocation.origin) {
    throw new Error("BurnGuard API requests must stay on the app origin.");
  }
  const headers = new Headers(init?.headers ?? {});
  headers.set(BURNGUARD_CAPABILITY_HEADER, launchCapability);
  const res = await fetch(path, { ...init, credentials: "same-origin", headers });
  if (res.status === 403) await reportAuthorityRejection(res);
  return res;
}

const authorityRejectedListeners = new Set<() => void>();

/**
 * The request-authority gate answers a stale launch capability with 403 `forbidden`: the backend
 * restarted and minted a new one. Listeners ask the user to reload; nothing re-bootstraps here.
 */
export function onAuthorityRejected(listener: () => void): () => void {
  authorityRejectedListeners.add(listener);
  return () => { authorityRejectedListeners.delete(listener); };
}

async function reportAuthorityRejection(res: Response): Promise<void> {
  const body: unknown = await res.clone().json().catch(() => null);
  const code = typeof body === "object" && body !== null && "error" in body && typeof body.error === "object" && body.error !== null && "code" in body.error ? body.error.code : null;
  if (code !== "forbidden") return;
  for (const listener of authorityRejectedListeners) listener();
}

/**
 * Thin typed wrapper over fetch that unwraps the shared API envelope and
 * throws a typed ApiError on either HTTP failure or `{error:...}` body.
 *
 * Used by the api/* modules. The seam where codex swaps stub implementations
 * for real calls.
 */
export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (!(init?.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const res = await authorizedFetch(path, { ...init, headers });

  // 204 No Content (project delete) carries no envelope; an empty body on a
  // successful response is a valid `void` result, not a network failure.
  const raw = await res.text();
  if (res.ok && raw.trim().length === 0) {
    return undefined as T;
  }
  let body: ApiSuccess<T> | ApiErrorBody | null = null;
  try {
    body = JSON.parse(raw) as ApiSuccess<T> | ApiErrorBody;
  } catch {
    body = null;
  }

  if (!res.ok || !body || "error" in body) {
    const err =
      body && "error" in body
        ? body.error
        : { code: "network_error", message: res.statusText };
    throw new ApiError(err.code, err.message, res.status, (err as { details?: unknown }).details);
  }

  return (body as ApiSuccess<T>).data;
}
