import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveManagedPath, resolveRepoRoot } from "../src/lib/paths";
import {
  PathBoundaryError,
  assertSafeName,
  resolveWithin,
} from "../src/security/path-boundary";
import { assertAcquirableSourceMarkup, assertInertSourceMarkup, assertSafeBundleRelativePath, removeSourceMarkupReferences, safeSourceReference } from "../src/services/extraction-safety";
import { isOwnedQaAdapterEntryUrl, isOwnedQaAdapterResourceUrl, qaAdapterConfiguration, qaAdapterRequestHeaders } from "../src/services/extraction-qa-adapter";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("managed roots", () => {
  test("Given a source directory When repository root resolves Then it is absolute", () => {
    // Given / When / Then
    expect(path.isAbsolute(resolveRepoRoot(import.meta.dir))).toBe(true);
  });
});

describe("resolveWithin", () => {
  test("resolves a contained existing path", () => {
    const root = makeTempDir("bg-path-root-");
    const child = path.join(root, "child");
    mkdirSync(child);

    expect(resolveWithin(root, "child")).toBe(child);
  });

  test("keeps a root spelled under macOS /private when resolving below it", () => {
    if (process.platform !== "darwin") return;
    // Given: the canonical spelling of a temporary root, as realpath() returns it.
    const root = realpathSync(makeTempDir("bg-path-root-"));
    expect(root.startsWith("/private/")).toBe(true);
    mkdirSync(path.join(root, "child"));

    // When / Then: the result stays inside the root the caller passed.
    expect(resolveWithin(root, "child")).toBe(path.join(root, "child"));
    expect(resolveWithin(root, "new", "artifact.zip")).toBe(path.join(root, "new", "artifact.zip"));
  });

  test("rejects parent traversal", () => {
    const root = makeTempDir("bg-path-root-");
    expect(() => resolveWithin(root, "..", "victim.txt")).toThrow(
      PathBoundaryError,
    );
  });

  test("rejects an absolute path segment", () => {
    const root = makeTempDir("bg-path-root-");
    const outside = makeTempDir("bg-path-outside-");
    expect(() => resolveWithin(root, outside)).toThrow(PathBoundaryError);
  });

  test("rejects backslash traversal on Windows", () => {
    if (process.platform !== "win32") return;
    const root = makeTempDir("bg-path-root-");
    expect(() => resolveWithin(root, "..\\victim.txt")).toThrow(
      PathBoundaryError,
    );
  });

  test("allows a not-yet-existing leaf below an existing root", () => {
    const root = makeTempDir("bg-path-root-");
    expect(resolveWithin(root, "new", "artifact.zip")).toBe(
      path.join(root, "new", "artifact.zip"),
    );
  });

  test("rejects an escape through a junction or symlink", () => {
    const root = makeTempDir("bg-path-root-");
    const outside = makeTempDir("bg-path-outside-");
    const link = path.join(root, "linked");
    symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");

    expect(() => resolveWithin(root, "linked", "victim.txt")).toThrow(
      PathBoundaryError,
    );
  });
});

describe("inert extraction boundaries", () => {
  test("Given complete inert HTML When validated Then no execution surface is accepted", () => {
    // Given / When / Then
    expect(() => assertInertSourceMarkup("<html><body><a href='#local'>Local</a></body></html>", "html")).not.toThrow();
  });

  test("Given relative acquisition references When stored Then references are removed before inert validation", () => {
    // Given
    const source = "<html><head><link rel='stylesheet' href='/styles.css'></head><body><img src='/logo.svg'></body></html>";

    // When
    assertAcquirableSourceMarkup(source, "html");
    const stored = removeSourceMarkupReferences(source);

    // Then
    expect(stored).not.toContain("/styles.css");
    expect(stored).not.toContain("/logo.svg");
    expect(() => assertInertSourceMarkup(stored, "html")).not.toThrow();
  });

  test("Given an HTTPS source with query metadata When persisted Then query and fragment are removed", () => {
    // Given / When / Then
    expect(safeSourceReference("https://example.com/design?token=secret#part")).toBe("https://example.com/design");
  });
});

describe("DB-derived and extraction asset paths", () => {
  test("Given an out-of-root DB path When resolved for mutation Then it is rejected", () => {
    // Given
    const root = makeTempDir("bg-managed-root-");
    const outside = path.join(makeTempDir("bg-managed-outside-"), "system");

    // When / Then
    expect(() => resolveManagedPath(root, outside)).toThrow(PathBoundaryError);
  });

  test.each(["../logo.svg", "/tmp/logo.svg", "C:\\logo.svg", "assets//logo.svg"])(
    "Given unsafe asset path %s When normalized Then it is rejected",
    (assetPath) => {
      // Given / When / Then
      expect(() => assertSafeBundleRelativePath(assetPath)).toThrow();
    },
  );
});

describe("owned extraction adapter boundary", () => {
  test("Given exact loopback adapter configuration When compared Then payload variants cannot enable or widen it", () => {
    // Given
    const source = "http://127.0.0.1:43123/source";
    const stall = "http://127.0.0.1:43123/stall";
    const config = qaAdapterConfiguration({
      BG_EXTRACTION_QA_ADAPTER_SOURCE_URL: source,
      BG_EXTRACTION_QA_ADAPTER_STALL_URL: stall,
      BG_EXTRACTION_QA_ADAPTER_RESOURCE_URLS: `${source},${stall},http://127.0.0.1:43123/styles.css`,
      BG_EXTRACTION_QA_ADAPTER_SECRET: "service-owned-adapter-secret-000001",
    });

    // When / Then
    expect(isOwnedQaAdapterEntryUrl(new URL(source), config)).toBe(true);
    expect(isOwnedQaAdapterEntryUrl(new URL(stall), config)).toBe(true);
    expect(isOwnedQaAdapterResourceUrl(new URL("http://127.0.0.1:43123/styles.css"), config)).toBe(true);
    expect(qaAdapterRequestHeaders(new URL(source), config)).toEqual({ "x-burnguard-qa-adapter-secret": "service-owned-adapter-secret-000001" });
    expect(qaAdapterRequestHeaders(new URL("https://example.com"), config)).toEqual({});
    expect(isOwnedQaAdapterEntryUrl(new URL(`${source}?token=forged`), config)).toBe(false);
    expect(isOwnedQaAdapterEntryUrl(new URL("http://localhost:43123/source"), config)).toBe(false);
    expect(isOwnedQaAdapterEntryUrl(new URL("http://127.0.0.1:43123/styles.css"), config)).toBe(false);
    expect(isOwnedQaAdapterEntryUrl(new URL(source), null)).toBe(false);
  });

  test.each([
    {},
    { BG_EXTRACTION_QA_ADAPTER_SOURCE_URL: "not-a-url" },
    {
      BG_EXTRACTION_QA_ADAPTER_SOURCE_URL: "http://127.0.0.1:43123/source?secret=x",
      BG_EXTRACTION_QA_ADAPTER_STALL_URL: "http://127.0.0.1:43123/stall",
      BG_EXTRACTION_QA_ADAPTER_RESOURCE_URLS: "http://127.0.0.1:43123/source,http://127.0.0.1:43123/stall",
      BG_EXTRACTION_QA_ADAPTER_SECRET: "service-owned-adapter-secret-000001",
    },
    {
      BG_EXTRACTION_QA_ADAPTER_SOURCE_URL: "http://127.0.0.1:43123/source",
      BG_EXTRACTION_QA_ADAPTER_STALL_URL: "http://127.0.0.1:43124/stall",
      BG_EXTRACTION_QA_ADAPTER_RESOURCE_URLS: "http://127.0.0.1:43123/source,http://127.0.0.1:43124/stall",
      BG_EXTRACTION_QA_ADAPTER_SECRET: "service-owned-adapter-secret-000001",
    },
  ])("Given incomplete or widened adapter configuration When parsed Then QA loopback remains disabled", (env) => {
    // Given / When / Then
    expect(qaAdapterConfiguration(env)).toBeNull();
  });
});

describe("assertSafeName", () => {
  test("returns a safe single path component", () => {
    expect(assertSafeName("project-01_abc")).toBe("project-01_abc");
  });

  test.each(["", "..", "../victim", "..\\victim", "C:relative", "NUL"])(
    "rejects unsafe component %p",
    (name) => {
      expect(() => assertSafeName(name)).toThrow(PathBoundaryError);
    },
  );
});
