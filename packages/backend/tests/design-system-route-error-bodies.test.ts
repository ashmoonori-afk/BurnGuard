import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { createDesignSystemRecord } from "../src/db/seed";
import { getSqlite } from "../src/db/sqlite-client";
import { systemsDir } from "../src/lib/paths";
import { systemRoutes } from "../src/routes/system";

const UNWRITABLE_ID = `route-error-unwritable-${process.pid}`;
const LOCKED_ID = `route-error-locked-${process.pid}`;
const TOKEN_FILE = "colors_and_type.css";
const ERRNO = /\bE[A-Z]{3,}\b/u;

async function createSystem(id: string): Promise<string> {
  const dir = path.join(systemsDir, id);
  const tokenPath = path.join(dir, TOKEN_FILE);
  await fsp.mkdir(dir, { recursive: true });
  await createDesignSystemRecord({ id, name: id, description: null, status: "published", sourceType: "manual", sourceUri: null, dirPath: dir, skillMdPath: null, tokensCssPath: tokenPath, readmeMdPath: null, thumbnailPath: null });
  return tokenPath;
}

type ErrorBody = { readonly error: { readonly code: string; readonly message: string; readonly details?: unknown } };

async function saveColor(id: string): Promise<{ readonly status: number; readonly text: string; readonly body: ErrorBody }> {
  const response = await systemRoutes.fetch(new Request(`http://127.0.0.1:14070/api/design-systems/${id}/colors`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "brand", value: "#112233" }),
  }));
  const text = await response.text();
  return { status: response.status, text, body: JSON.parse(text) as ErrorBody };
}

let lockedTokenPath = "";

beforeAll(async () => {
  lockedTokenPath = await createSystem(LOCKED_ID);
  await fsp.writeFile(lockedTokenPath, ":root { --brand: #000000; }\n");
});

afterAll(async () => {
  for (const id of [UNWRITABLE_ID, LOCKED_ID]) {
    getSqlite().prepare("DELETE FROM design_systems WHERE id=?").run(id);
    await fsp.rm(path.join(systemsDir, id), { recursive: true, force: true });
  }
});

/** Makes the token write fail the way the OS would, with the given errno text, and records what the route logs. */
async function saveColorWhileWriteFails(code: string, reason: string, privatePath: string) {
  const original = fsp.writeFile;
  const write = spyOn(fsp, "writeFile").mockImplementation(async (...args: Parameters<typeof fsp.writeFile>) => {
    if (args[0] !== lockedTokenPath) return original(...args);
    throw Object.assign(new Error(`${code}: ${reason}, open '${privatePath}'`), { code, errno: -1, syscall: "open", path: privatePath });
  });
  const logged: unknown[][] = [];
  const warn = spyOn(console, "warn").mockImplementation((...args: unknown[]) => { logged.push(args); });
  try {
    return { ...(await saveColor(LOCKED_ID)), logged: JSON.stringify(logged) };
  } finally {
    warn.mockRestore();
    write.mockRestore();
  }
}

function expectNoPrivateDiagnostic(result: { readonly status: number; readonly text: string; readonly body: ErrorBody; readonly logged: string }, privatePath: string, fragments: readonly string[]): void {
  expect(result.status).toBe(500);
  expect(result.body.error.code).toBe("design_system_color_update_failed");
  expect(result.body.error.details).toBeUndefined();
  expect(result.body.error.message).not.toContain(privatePath);
  expect(result.body.error.message).not.toMatch(ERRNO);
  for (const fragment of [...fragments, TOKEN_FILE]) {
    expect(result.text).not.toContain(fragment);
    expect(result.logged).not.toContain(fragment);
  }
}

describe("design-system route error bodies", () => {
  test("Given a design system whose token file cannot be written When a color token is saved Then the API error body carries no absolute managed path or raw filesystem diagnostic", async () => {
    // Given: a directory stands where the token file should be, so the write fails on every OS.
    const tokenPath = path.join(systemsDir, UNWRITABLE_ID, TOKEN_FILE);
    await fsp.mkdir(tokenPath, { recursive: true });
    await createSystem(UNWRITABLE_ID);

    // When: the color editor saves a token.
    const result = await saveColor(UNWRITABLE_ID);

    // Then: the failure is a stable code without private paths or errno text.
    expect(result.status).toBe(500);
    expect(result.body.error.code).toBe("design_system_color_update_failed");
    expect(result.body.error.message).not.toContain(systemsDir);
    expect(result.body.error.message).not.toContain(tokenPath);
    expect(result.text).not.toContain(UNWRITABLE_ID);
    expect(result.text).not.toContain(TOKEN_FILE);
    expect(result.text).not.toMatch(ERRNO);
  });

  describe("Windows paths", () => {
    test.each([
      ["a drive-letter profile path held open by another process", "EBUSY", "resource busy or locked", path.win32.join("C:\\Users\\qa\\project", ".burnguard", "data", "systems", "brand", TOKEN_FILE), ["C:", "Users", "qa\\", "project", ".burnguard"]],
      ["a read-only file on a second drive", "EPERM", "operation not permitted", path.win32.join("D:\\Work\\qa", "systems", "brand", TOKEN_FILE), ["D:", "Work", "qa\\"]],
      ["a UNC share that denies access", "EACCES", "permission denied", path.win32.join("\\\\fileserver\\profiles", "qa", "systems", "brand", TOKEN_FILE), ["fileserver", "profiles", "\\\\"]],
    ] as const)("Given %s When the color token write fails Then neither the body nor the log carries the path or errno text", async (_case, code, reason, privatePath, fragments) => {
      // Given / When
      const result = await saveColorWhileWriteFails(code, reason, privatePath);
      // Then
      expect(privatePath).toContain("\\");
      expectNoPrivateDiagnostic(result, privatePath, fragments);
      expect(result.text).not.toMatch(ERRNO);
    });
  });

  describe("POSIX paths", () => {
    test.each([
      ["a Linux home profile path without write permission", "EACCES", "permission denied", path.posix.join("/home/qa/project", ".burnguard", "data", "systems", "brand", TOKEN_FILE), ["/home", "qa/", "project", ".burnguard"]],
      ["a macOS home profile path on a read-only volume", "EROFS", "read-only file system", path.posix.join("/Users/qa/project", "Library", "BurnGuard", "systems", "brand", TOKEN_FILE), ["/Users", "qa/", "project", "Library"]],
      ["a macOS temporary root under /private/var", "ENOSPC", "no space left on device", path.posix.join("/private/var/folders/qa", "systems", "brand", TOKEN_FILE), ["/private", "folders"]],
    ] as const)("Given %s When the color token write fails Then neither the body nor the log carries the path or errno text", async (_case, code, reason, privatePath, fragments) => {
      // Given / When
      const result = await saveColorWhileWriteFails(code, reason, privatePath);
      // Then
      expect(privatePath.startsWith("/")).toBe(true);
      expectNoPrivateDiagnostic(result, privatePath, fragments);
      expect(result.text).not.toMatch(ERRNO);
    });
  });
});
