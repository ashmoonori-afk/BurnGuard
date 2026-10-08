import { randomBytes, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

export const BURNGUARD_CAPABILITY_HEADER = "x-burnguard-capability";
export const BURNGUARD_CAPABILITY_COOKIE = "burnguard_capability";
export const BURNGUARD_BOOTSTRAP_HEADER = "x-burnguard-bootstrap";

const PUBLIC_API_PATHS = new Set(["/api/health"]);
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface RequestAuthorityOptions {
  capability: string;
  /**
   * One-time secret the launcher hands to the page it opens (desktop readiness line, browser URL fragment).
   * The first trusted bootstrap must present it; later bootstraps need the launch cookie. Absent: cookie only.
   */
  bootstrapSecret?: string;
  appAuthority: string;
  devAuthority?: string;
}

export function generateLaunchCapability(): string {
  return randomBytes(32).toString("base64url");
}

export function createRequestAuthority(
  options: RequestAuthorityOptions,
): MiddlewareHandler {
  let pendingBootstrapSecret = options.bootstrapSecret;
  const authorities = new Set(
    [options.appAuthority, options.devAuthority].filter(
      (value): value is string => value !== undefined,
    ),
  );

  return async (c, next) => {
    const host = c.req.header("host");
    if (!host || !authorities.has(host)) {
      return c.json(
        { error: { code: "misdirected_request", message: "Invalid authority." } },
        421,
      );
    }

    const expectedOrigin = `http://${host}`;
    const origin = c.req.header("origin");
    const pathname = new URL(c.req.url).pathname;

    if (c.req.method === "OPTIONS") {
      if (origin !== expectedOrigin) {
        return forbidden(c);
      }
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Headers": BURNGUARD_CAPABILITY_HEADER,
          "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "Access-Control-Allow-Origin": expectedOrigin,
          Vary: "Origin",
        },
      });
    }

    if (pathname === "/api/bootstrap") {
      if (c.req.method !== "GET" || !isTrustedBootstrap(c.req.raw, expectedOrigin)) {
        return forbidden(c);
      }
      // Origin headers are forgeable outside a browser, so the capability also needs proof that the caller is the
      // page the launcher opened: the launch cookie (reloads, new tabs) or the unspent one-time secret.
      const reload = matchesCapability(
        readCookie(c.req.header("cookie"), BURNGUARD_CAPABILITY_COOKIE),
        options.capability,
      );
      if (!reload) {
        if (
          pendingBootstrapSecret === undefined ||
          !matchesCapability(c.req.header(BURNGUARD_BOOTSTRAP_HEADER), pendingBootstrapSecret)
        ) {
          return forbidden(c);
        }
        pendingBootstrapSecret = undefined;
      }
      c.header(
        "Set-Cookie",
        `${BURNGUARD_CAPABILITY_COOKIE}=${options.capability}; HttpOnly; SameSite=Strict; Path=/api`,
      );
      c.header("Cache-Control", "no-store");
      return c.json({
        ok: true,
        data: { capability: options.capability },
      });
    }

    if (PUBLIC_API_PATHS.has(pathname)) {
      await next();
      return;
    }

    if (MUTATION_METHODS.has(c.req.method)) {
      if (
        origin !== expectedOrigin ||
        !matchesCapability(
          c.req.header(BURNGUARD_CAPABILITY_HEADER),
          options.capability,
        )
      ) {
        return forbidden(c);
      }
      await next();
      return;
    }

    const cookieCapability = readCookie(
      c.req.header("cookie"),
      BURNGUARD_CAPABILITY_COOKIE,
    );
    if (
      !matchesCapability(
        c.req.header(BURNGUARD_CAPABILITY_HEADER),
        options.capability,
      ) &&
      !matchesCapability(cookieCapability, options.capability)
    ) {
      return forbidden(c);
    }

    await next();
  };
}

function isTrustedBootstrap(request: Request, expectedOrigin: string): boolean {
  const origin = request.headers.get("origin");
  if (origin !== null) {
    return origin === expectedOrigin;
  }

  return (
    request.headers.get("sec-fetch-site") === "same-origin" &&
    request.headers.get("sec-fetch-mode") === "cors"
  );
}

function matchesCapability(
  supplied: string | undefined,
  expected: string,
): boolean {
  if (supplied === undefined) return false;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return (
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  );
}

function readCookie(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim();
    }
  }
  return undefined;
}

function forbidden(c: Parameters<MiddlewareHandler>[0]): Response {
  return c.json(
    { error: { code: "forbidden", message: "Request authority rejected." } },
    403,
  );
}
