import type { ApiErrorBody, ApiSuccess } from "@bg/shared";

const BURNGUARD_CAPABILITY_HEADER = "x-burnguard-capability";
const BURNGUARD_BOOTSTRAP_HEADER = "x-burnguard-bootstrap";
/** The launcher opens the app at `#bg-bootstrap:<secret>`; the backend accepts that secret for one bootstrap. */
const BOOTSTRAP_FRAGMENT_PREFIX = "#bg-bootstrap:";
let launchCapability: string | null = null;
let pendingBootstrapSecret: string | null = null;
/**
 * Dev only: `bun --watch` restarts the backend on every save with a fresh capability but the launcher's unchanged
 * secret, so the tab keeps that secret for this session to re-bootstrap once the old cookie is rejected.
 * Release builds compile this out and keep the secret in memory only.
 */
const DEV_BOOTSTRAP_SECRET_KEY = "burnguard.dev-bootstrap-secret";

function devSessionStorage(): Storage | null {
  const devBuild = typeof __BG_DEV__ !== "undefined" && __BG_DEV__ === true;
  return devBuild && typeof sessionStorage !== "undefined" ? sessionStorage : null;
}

/** Moves the launch secret out of the address bar; it is kept in memory until a bootstrap succeeds. */
function takeLaunchBootstrapSecret(): void {
  if (typeof location === "undefined" || !location.hash.startsWith(BOOTSTRAP_FRAGMENT_PREFIX)) return;
  const secret = location.hash.slice(BOOTSTRAP_FRAGMENT_PREFIX.length);
  if (/^[A-Za-z0-9_-]+$/.test(secret)) {
    pendingBootstrapSecret = secret;
    devSessionStorage()?.setItem(DEV_BOOTSTRAP_SECRET_KEY, secret);
  }
  if (typeof history !== "undefined") history.replaceState(history.state, "", location.pathname + location.search);
}

function fetchBootstrap(secret: string | null, signal: AbortSignal): Promise<Response> {
  const headers = new Headers({ accept: "application/json" });
  if (secret !== null) headers.set(BURNGUARD_BOOTSTRAP_HEADER, secret);
  return fetch("/api/bootstrap", { credentials: "same-origin", headers, signal });
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

export class BootstrapError extends Error {
  constructor(readonly kind: "denied" | "network" | "other", readonly status = 0) {
    super("BurnGuard API authority bootstrap failed.");
    this.name = "BootstrapError";
  }
}

let authorityExpired = false;
const authorityStateListeners = new Set<() => void>();

export function isAuthorityExpired(): boolean { return authorityExpired; }

export function subscribeAuthorityState(listener: () => void): () => void {
  authorityStateListeners.add(listener);
  return () => { authorityStateListeners.delete(listener); };
}

function setAuthorityExpired(expired: boolean): void {
  if (authorityExpired === expired) return;
  authorityExpired = expired;
  for (const listener of authorityStateListeners) listener();
}

export function isAuthorityDenied(error: unknown): boolean {
  return (error instanceof ApiError && error.status === 403 && error.code === "forbidden") ||
    (error instanceof BootstrapError && error.kind === "denied");
}

export function rejectLaunchAuthority(): void {
  if (authorityExpired) return;
  setAuthorityExpired(true);
  for (const listener of authorityRejectedListeners) listener();
}

/** A backend that accepts the connection but never answers must not wedge every later Reconnect on one request. */
const BOOTSTRAP_TIMEOUT_MS = 15_000;

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
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(new Error("BurnGuard API authority bootstrap timed out.")),
    BOOTSTRAP_TIMEOUT_MS,
  );
  try {
    await runBootstrap(timeout.signal);
  } catch (error) {
    if (error instanceof BootstrapError) throw error;
    // Fetch failures and the bounded request deadline are connectivity failures, not proof of rejection.
    if (timeout.signal.aborted || error instanceof TypeError || error instanceof DOMException) {
      throw new BootstrapError("network");
    }
    throw new BootstrapError("other");
  } finally {
    clearTimeout(timer);
  }
}

async function runBootstrap(signal: AbortSignal): Promise<void> {
  launchCapability = null;
  takeLaunchBootstrapSecret();
  // Reloads and new tabs carry no secret; the backend accepts the launch cookie for them.
  let res = await fetchBootstrap(pendingBootstrapSecret, signal);
  const devSecret = pendingBootstrapSecret === null ? devSessionStorage()?.getItem(DEV_BOOTSTRAP_SECRET_KEY) : null;
  if (res.status === 403 && devSecret) res = await fetchBootstrap(devSecret, signal);
  if (res.status === 403) {
    pendingBootstrapSecret = null;
    rejectLaunchAuthority();
    throw new BootstrapError("denied", res.status);
  }
  if (!res.ok) throw new BootstrapError("other", res.status);
  const body: unknown = await res.json().catch(() => null);
  if (
    typeof body !== "object" || body === null ||
    "error" in body ||
    !("data" in body) || typeof body.data !== "object" || body.data === null ||
    !("capability" in body.data) ||
    typeof body.data.capability !== "string" ||
    body.data.capability.length === 0
  ) {
    throw new BootstrapError("other", res.status);
  }
  launchCapability = body.data.capability;
  pendingBootstrapSecret = null;
  setAuthorityExpired(false);
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
  if (authorityExpired) throw new ApiError("forbidden", "Request authority rejected.", 403);
  if (!launchCapability) {
    throw new Error("BurnGuard API authority is not initialized.");
  }
  const requestCapability = launchCapability;
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
  headers.set(BURNGUARD_CAPABILITY_HEADER, requestCapability);
  const res = await fetch(path, { ...init, credentials: "same-origin", headers });
  if (res.status === 403) await reportAuthorityRejection(res, requestCapability);
  return res;
}

const authorityRejectedListeners = new Set<() => void>();

/**
 * The request-authority gate answers a stale launch capability with 403 `forbidden`: the backend
 * restarted and minted a new one. Listeners preserve the workspace and offer normal-launch guidance.
 */
export function onAuthorityRejected(listener: () => void): () => void {
  authorityRejectedListeners.add(listener);
  return () => { authorityRejectedListeners.delete(listener); };
}

async function reportAuthorityRejection(res: Response, requestCapability: string): Promise<void> {
  const body: unknown = await res.clone().json().catch(() => null);
  const code = typeof body === "object" && body !== null && "error" in body && typeof body.error === "object" && body.error !== null && "code" in body.error ? body.error.code : null;
  if (code !== "forbidden" || requestCapability !== launchCapability) return;
  rejectLaunchAuthority();
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
