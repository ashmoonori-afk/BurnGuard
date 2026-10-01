import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as researchRepository from "../src/db/research-repository";
import { getSqlite } from "../src/db/sqlite-client";
import { catalogRoutes } from "../src/routes/catalog";
import { learningRoutes } from "../src/routes/learning";
import { createResearchRoutes } from "../src/routes/research";
import * as catalogService from "../src/services/catalog-service";
import { DesignSystemExtractError, runPythonUploadExtractor } from "../src/services/design-system-extract";
import * as learningService from "../src/services/learning-service";
import * as pythonRuntime from "../src/services/python-runtime";

const ERRNO = /\bE[A-Z]{3,}\b/u;

type PrivateCase = readonly [label: string, errno: string, reason: string, privatePath: string, fragments: readonly string[]];

const WINDOWS_CASES: readonly PrivateCase[] = [
  ["a drive-letter profile path held open by another process", "EBUSY", "resource busy or locked", path.win32.join("C:\\Users\\qa\\project", ".burnguard", "data", "systems", "brand", "manifest.json"), ["C:", "Users", "qa\\", ".burnguard"]],
  ["a UNC share that denies access", "EACCES", "permission denied", path.win32.join("\\\\fileserver\\profiles", "qa", "learning", "item.json"), ["fileserver", "profiles", "\\\\"]],
];
const POSIX_CASES: readonly PrivateCase[] = [
  ["a Linux home profile path without write permission", "EACCES", "permission denied", path.posix.join("/home/qa/project", ".burnguard", "data", "systems", "brand", "manifest.json"), ["/home", "qa/", ".burnguard"]],
  ["a macOS temporary root under /private/var", "ENOSPC", "no space left on device", path.posix.join("/private/var/folders/qa", "research", "run.json"), ["/private", "folders"]],
];

function errnoError(errno: string, reason: string, privatePath: string): Error {
  return Object.assign(new Error(`${errno}: ${reason}, open '${privatePath}'`), { code: errno, errno: -1, syscall: "open", path: privatePath });
}

type ErrorBody = { readonly error: { readonly code: string; readonly message: string; readonly details?: unknown } };

/** Calls the route while `failing` throws the OS error, and records what the route logs. */
async function callWhileFailing(failing: () => { mockRestore(): void }, call: () => Promise<Response>) {
  const logged: unknown[][] = [];
  const warn = spyOn(console, "warn").mockImplementation((...args: unknown[]) => { logged.push(args); });
  const spy = failing();
  try {
    const response = await call();
    const text = await response.text();
    return { status: response.status, text, body: JSON.parse(text) as ErrorBody, logged: JSON.stringify(logged) };
  } finally {
    spy.mockRestore();
    warn.mockRestore();
  }
}

function expectNoPrivateDiagnostic(result: { readonly status: number; readonly text: string; readonly body: ErrorBody; readonly logged: string }, code: string, privatePath: string, fragments: readonly string[]): void {
  expect(result.status).toBe(500);
  expect(result.body.error.code).toBe(code);
  expect(result.body.error.message).not.toContain(privatePath);
  expect(result.text).not.toMatch(ERRNO);
  for (const fragment of fragments) {
    expect(result.text).not.toContain(fragment);
    expect(result.logged).not.toContain(fragment);
  }
}

const research = createResearchRoutes({ db: getSqlite() });

const ROUTES = [
  {
    name: "catalog list",
    code: "catalog_operation_failed",
    fail: (error: Error) => spyOn(catalogService, "listCatalogSystems").mockRejectedValue(error),
    call: () => catalogRoutes.fetch(new Request("http://127.0.0.1:14070/api/design-systems")),
  },
  {
    name: "learning seed",
    code: "learning_operation_failed",
    fail: (error: Error) => spyOn(learningService, "seedLearningItems").mockImplementation(() => { throw error; }),
    call: () => learningRoutes.fetch(new Request("http://127.0.0.1:14070/api/learning/seed", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })),
  },
  {
    name: "research run read",
    code: "research_operation_failed",
    fail: (error: Error) => spyOn(researchRepository, "getResearchRun").mockImplementation(() => { throw error; }),
    call: () => research.routes.fetch(new Request("http://127.0.0.1:14070/api/research/runs/run-205")),
  },
] as const;

describe("route fallback error bodies", () => {
  for (const route of ROUTES) {
    for (const [flavor, cases] of [["Windows", WINDOWS_CASES], ["POSIX", POSIX_CASES]] as const) {
      test.each(cases)(`Given ${flavor} %s When the ${route.name} route hits that filesystem error Then neither the body nor the log carries the path or errno text`, async (_label, errno, reason, privatePath, fragments) => {
        // Given / When
        const result = await callWhileFailing(() => route.fail(errnoError(errno, reason, privatePath)), route.call);
        // Then
        expect(flavor === "Windows" ? privatePath.includes("\\") : privatePath.startsWith("/")).toBe(true);
        expectNoPrivateDiagnostic(result, route.code, privatePath, fragments);
      });
    }
  }
});

describe("upload extractor failure messages", () => {
  let root = "";
  let fixture = "";

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "bg-extractor-205-"));
    fixture = path.join(root, "fake-python.js");
    // Stands in for the Python interpreter on every OS: prints the given diagnostic plus the private
    // input path to stderr and exits non-zero, the way a Python traceback would.
    await writeFile(fixture, "const input = process.argv[process.argv.indexOf('--input') + 1];\nconsole.error(`${process.argv[2]} '${input}'`);\nprocess.exit(1);\n");
  });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });

  async function extractWith(prefix: string[], sourcePath: string): Promise<DesignSystemExtractError> {
    const candidates = spyOn(pythonRuntime, "pythonCandidates").mockReturnValue([prefix]);
    try {
      await runPythonUploadExtractor({ sourcePath, manifestPath: path.join(root, "manifest.json") });
    } catch (error) {
      if (error instanceof DesignSystemExtractError) return error;
      throw error;
    } finally {
      candidates.mockRestore();
    }
    throw new Error("extractor fixture unexpectedly succeeded");
  }

  for (const [flavor, cases] of [["Windows", WINDOWS_CASES], ["POSIX", POSIX_CASES]] as const) {
    test.each(cases)(`Given ${flavor} %s When the extractor fails on that input Then the error carries the upload code without the path or errno text`, async (_label, errno, reason, privatePath, fragments) => {
      // Given / When
      const error = await extractWith([process.execPath, fixture, `FileNotFoundError: [Errno 2] ${errno}: ${reason}:`], privatePath);
      // Then
      expect(error.code).toBe("upload_extract_failed");
      expect(error.message).not.toContain(privatePath);
      expect(error.message).not.toContain(root);
      expect(error.message).not.toMatch(ERRNO);
      expect(error.message).not.toContain("Errno");
      for (const fragment of fragments) expect(error.message).not.toContain(fragment);
    });

    test.each(cases)(`Given ${flavor} %s When pypdf is missing for that input Then the error keeps the pdf_support_missing code without the path`, async (_label, _errno, _reason, privatePath, fragments) => {
      // Given / When
      const error = await extractWith([process.execPath, fixture, "PDF upload requires the Python package 'pypdf'."], privatePath);
      // Then
      expect(error.code).toBe("pdf_support_missing");
      expect(error.message).not.toContain(privatePath);
      for (const fragment of fragments) expect(error.message).not.toContain(fragment);
    });
  }

  test.each([
    ["Windows", path.win32.join("C:\\Users\\qa\\AppData\\Local\\Programs\\Python", "python.exe"), ["C:", "Users", "AppData"]],
    ["POSIX", path.posix.join("/home/qa/.pyenv/versions/3.12.0/bin", "python3"), ["/home", "qa/", ".pyenv"]],
  ] as const)("Given a %s interpreter path that cannot be spawned When the extractor runs Then the error carries no interpreter path", async (_flavor, interpreter, fragments) => {
    // Given / When
    const error = await extractWith([interpreter], path.join(root, "missing.pdf"));
    // Then
    expect(error.code).toBe("upload_extract_failed");
    expect(error.message).not.toContain(interpreter);
    expect(error.message).not.toContain(root);
    for (const fragment of fragments) expect(error.message).not.toContain(fragment);
  });
});
