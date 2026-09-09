import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CanonicalTreeManifestError, inspectCanonicalTree, parseCanonicalTreeManifest, validateCanonicalTree,
} from "../src/services/canonical-tree-manifest";
import {
  ExtractionPublicationError,
  completeExtractionPublication,
  publishExtractionBundle,
  reconcileExtractionPublications,
  reserveExtractionBundle,
  rollbackExtractionPublication,
  validateExtractionBundle,
  type ExtractionReservation,
} from "../src/services/extraction-publication";
import { buildExtractionProvenance } from "../src/services/extraction-provenance";
import { ExtractionSafetyError, assertInertSourceMarkup } from "../src/services/extraction-safety";
import { ExtractionAcquisitionError } from "../src/services/extraction-acquisition";
import { extractHtmlComponentSamples } from "../src/services/extraction-html";
import { analyzeLocalTree } from "../src/services/extraction-local-tree";
import { listFilesRecursive } from "../src/services/extraction-path";
import { readUploadManifest } from "../src/services/extraction-upload";
import { classifyExtractionRecovery } from "../src/services/extraction-recovery-state";
import { canCreateSymlink } from "./helpers/platform";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function root(): Promise<string> {
  const value = await mkdtemp(path.join(tmpdir(), "bg-extraction-publication-"));
  roots.push(value);
  return value;
}

async function awaitBounded<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("bounded child exit deadline exceeded")), 10_000);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function writeValidBundle(reservation: ExtractionReservation): Promise<void> {
  await mkdir(path.join(reservation.stagingDir, "fonts"), { recursive: true });
  await Promise.all([
    writeFile(path.join(reservation.stagingDir, "README.md"), "# Fixture\n"),
    writeFile(path.join(reservation.stagingDir, "SKILL.md"), "---\nname: fixture\n---\n"),
    writeFile(path.join(reservation.stagingDir, "colors_and_type.css"), ":root {}\n"),
    writeFile(path.join(reservation.stagingDir, "fonts", "fonts.css"), ":root {}\n"),
    writeFile(
      path.join(reservation.stagingDir, "extraction-provenance.json"),
      JSON.stringify(buildExtractionProvenance([], 1)),
    ),
  ]);
}

describe("bounded extraction acquisition", () => {
  test("Given a local tree When traversal analyzes text files Then production CSS signals are collected", async () => {
    // Given
    const directory = await root();
    await mkdir(path.join(directory, "nested"), { recursive: true });
    await writeFile(path.join(directory, "nested", "tokens.css"), ":root{--brand:#123456;}.card{padding:8px;font-family:Inter,sans-serif;}");
    const controller = new AbortController();

    // When
    const analysis = await analyzeLocalTree(directory, "Fixture", controller.signal);

    // Then
    expect(analysis.cssVars.get("brand")).toBe("#123456");
    expect(analysis.spacingValues).toContain("8px");
    expect(analysis.fontFamilies).toContain("Inter");
  });

  test("Given an exhausted budget When traversal starts Then it rejects before reading directories", async () => {
    // Given
    const controller = new AbortController();
    controller.abort(new ExtractionAcquisitionError("acquisition_timeout"));

    // When / Then
    await expect(listFilesRecursive(await root(), controller.signal)).rejects.toMatchObject({ code: "acquisition_timeout" });
  });

  test("Given an exhausted budget When local analysis starts Then it rejects before reading files", async () => {
    // Given
    const controller = new AbortController();
    controller.abort(new ExtractionAcquisitionError("acquisition_timeout"));

    // When / Then
    await expect(analyzeLocalTree(await root(), "Fixture", controller.signal)).rejects.toMatchObject({ code: "acquisition_timeout" });
  });

  test("Given an exhausted budget When upload parsing starts Then it rejects before reading the manifest", async () => {
    // Given
    const controller = new AbortController();
    controller.abort(new ExtractionAcquisitionError("acquisition_timeout"));

    // When / Then
    await expect(readUploadManifest("unused.json", controller.signal)).rejects.toMatchObject({ code: "acquisition_timeout" });
  });

  test("Given an exhausted budget When HTML parsing starts Then it rejects before parsing markup", () => {
    // Given
    const controller = new AbortController();
    controller.abort(new ExtractionAcquisitionError("acquisition_timeout"));

    // When / Then
    expect(() => extractHtmlComponentSamples("<p>Fixture</p>", controller.signal)).toThrow(ExtractionAcquisitionError);
  });
});

describe("seeded extraction restart reconciliation", () => {
  test("Given real migrated crash rows When startup reconciliation runs Then rows, markers, receipts, and sentinels converge", async () => {
    // Given
    const home = await root();
    const outputPath = path.join(home, "recovery-result.json");
    const environment = Object.fromEntries(
      ["PATH", "TMPDIR", "NODE_PATH"].flatMap((key) => {
        const value = process.env[key];
        return value === undefined ? [] : [[key, value]];
      }),
    );
    const child = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixtures/extraction-recovery-probe.ts"), outputPath], {
      env: { ...environment, HOME: home, USERPROFILE: home }, stdout: "ignore", stderr: "pipe",
    });
    const exactExit = child.exited;
    const [stderr, exitCode] = await Promise.all([
      new Response(child.stderr).text(), awaitBounded(exactExit),
    ]);

    // When
    // Assert the exit code before parsing: a crashed probe writes nothing to
    // its receipt, and parsing a missing file would hide the child's stderr behind an
    // "Unexpected EOF" syntax error.
    expect(exitCode, stderr).toBe(0);
    const result: unknown = JSON.parse(await readFile(outputPath, "utf8"));

    // Then
    expect(result).toMatchObject({
      orphan_row_removed: true,
      orphan_staging_removed: true,
      orphan_reservation_removed: true,
      committed_marker_removed: true,
      committed_files_preserved: true,
      sidecar_digest_stable: true,
      legacy_preserved: true,
      outside_row_preserved: true,
      outside_sentinel: "outside\n",
      receipt: { status: "committed" },
    });
  });
});

describe("extraction crash classification", () => {
  test("Given an extraction row without receipt or bytes When startup reconciles Then only the orphan row is removed", () => {
    // Given / When
    const actions = classifyExtractionRecovery([
      { id: "orphan", hasReceipt: false, destinationExists: false, receiptStatus: null, markerExists: false },
      { id: "baseline", hasReceipt: false, destinationExists: true, receiptStatus: null, markerExists: false },
    ]);

    // Then
    expect(actions).toEqual([{ kind: "remove_orphan_row", id: "orphan" }]);
  });

  test("Given committed receipt and publication marker When startup reconciles Then marker finalization is selected", () => {
    // Given / When
    const actions = classifyExtractionRecovery([
      { id: "committed", hasReceipt: true, destinationExists: true, receiptStatus: "committed", markerExists: true },
    ]);

    // Then
    expect(actions).toEqual([{ kind: "finalize_committed", id: "committed" }]);
  });
});

describe("safe extraction publication", () => {
  test("Given canonical bytes When a tree manifest is parsed and validated Then exact paths sizes hashes and aggregate digest agree", async () => {
    const systemsRoot = await root();
    const reservation = await reserveExtractionBundle(systemsRoot, "manifest");
    await writeValidBundle(reservation);
    const manifest = await inspectCanonicalTree(reservation.stagingDir);

    const parsed = parseCanonicalTreeManifest(JSON.parse(JSON.stringify(manifest)));
    const validated = await validateCanonicalTree(reservation.stagingDir, parsed);

    expect(validated).toEqual(manifest);
    expect(manifest.files.every((entry) => entry.path.length > 0 && entry.size >= 0 && /^[0-9a-f]{64}$/.test(entry.sha256))).toBe(true);
  });

  test("Given legacy duplicate or inconsistent manifest entries When parsed Then lifecycle trust is rejected", () => {
    const entry = { path: "README.md", size: 1, sha256: "0".repeat(64) };
    const invalid = [
      { files: ["README.md"] },
      { schema_version: 1, digest_algorithm: "sha256", tree_digest: "0".repeat(64), files: [entry, entry], publication_state: "validated" },
      { schema_version: 1, digest_algorithm: "sha256", tree_digest: "0".repeat(64), files: [{ ...entry, path: "../README.md" }], publication_state: "validated" },
    ];

    for (const manifest of invalid) expect(() => parseCanonicalTreeManifest(manifest)).toThrow(CanonicalTreeManifestError);
  });

  test("Given a manifest-listed file changes When its tree is validated Then byte identity fails", async () => {
    const systemsRoot = await root();
    const reservation = await reserveExtractionBundle(systemsRoot, "changed");
    await writeValidBundle(reservation);
    const manifest = await inspectCanonicalTree(reservation.stagingDir);
    await writeFile(path.join(reservation.stagingDir, "README.md"), "changed\n");

    await expect(validateCanonicalTree(reservation.stagingDir, manifest)).rejects.toMatchObject({ code: "tree_mismatch" });
  });

  test("Given two same-ID requests When both reserve publication Then exactly one can own the ID", async () => {
    // Given
    const systemsRoot = await root();

    // When
    const results = await Promise.allSettled([
      reserveExtractionBundle(systemsRoot, "same-id"),
      reserveExtractionBundle(systemsRoot, "same-id"),
    ]);

    // Then
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  test("Given an existing canonical destination When publication runs Then it never clobbers managed bytes", async () => {
    // Given
    const systemsRoot = await root();
    const reservation = await reserveExtractionBundle(systemsRoot, "occupied");
    await writeValidBundle(reservation);
    await mkdir(reservation.destinationDir);
    const sentinel = path.join(reservation.destinationDir, "sentinel.txt");
    await writeFile(sentinel, "external");

    // When
    const publication = publishExtractionBundle(reservation);

    // Then
    await expect(publication).rejects.toBeInstanceOf(ExtractionPublicationError);
    await rollbackExtractionPublication(reservation);
    expect(await readFile(sentinel, "utf8")).toBe("external");
  });

  test("Given DB failure after publication When rollback runs Then owned bytes disappear and retry is available", async () => {
    // Given
    const systemsRoot = await root();
    const reservation = await reserveExtractionBundle(systemsRoot, "recoverable");
    await writeValidBundle(reservation);
    await validateExtractionBundle(reservation);
    await publishExtractionBundle(reservation);

    // When
    await rollbackExtractionPublication(reservation);
    const retry = await reserveExtractionBundle(systemsRoot, "recoverable");

    // Then
    expect(retry.id).toBe("recoverable");
  });

  test("Given committed publication When completion runs Then canonical files remain and reservation is released", async () => {
    // Given
    const systemsRoot = await root();
    const reservation = await reserveExtractionBundle(systemsRoot, "committed");
    await writeValidBundle(reservation);
    await validateExtractionBundle(reservation);
    await publishExtractionBundle(reservation);

    // When
    await completeExtractionPublication(reservation);

    // Then
    expect(await readFile(path.join(reservation.destinationDir, "README.md"), "utf8")).toBe("# Fixture\n");
    const next = reserveExtractionBundle(systemsRoot, "committed");
    await expect(next).rejects.toBeInstanceOf(ExtractionPublicationError);
  });

  test.each([
    ["html", "<html><body><script>fetch('https://evil.test')</script></body></html>"],
    ["html", "<html><body><img src=x onerror=alert(1)></body></html>"],
    ["html", "<html><body><form action='https://evil.test'></form></body></html>"],
    ["html", "<html><body><img src='/tracker.gif'></body></html>"],
    ["html", "<html><body><style>.x{background:url('/tracker.gif')}</style></body></html>"],
    ["html", "<html><body><meta http-equiv='refresh' content='0;url=https://evil.test'></body></html>"],
    ["svg", "<svg><script>alert(1)</script></svg>"],
    ["svg", "<svg><image href='https://evil.test/a.png'/></svg>"],
  ] as const)("Given active %s When source markup is validated Then execution is rejected", (_kind, markup) => {
    // Given / When
    const validate = () => assertInertSourceMarkup(markup, _kind);

    // Then
    expect(validate).toThrow(ExtractionSafetyError);
  });

  test("Given malformed HTML When source markup is validated Then it is rejected", () => {
    // Given / When
    const validate = () => assertInertSourceMarkup("<html><body><div>", "html");

    // Then
    expect(validate).toThrow(ExtractionSafetyError);
  });

  test.skipIf(!canCreateSymlink())("Given a symlink asset escape When bundle is validated Then publication is rejected", async () => {
    // Given
    const systemsRoot = await root();
    const outside = await root();
    const reservation = await reserveExtractionBundle(systemsRoot, "linked");
    await writeValidBundle(reservation);
    await symlink(outside, path.join(reservation.stagingDir, "escaped"), "dir");

    // When
    const validation = validateExtractionBundle(reservation);

    // Then
    await expect(validation).rejects.toBeInstanceOf(ExtractionPublicationError);
  });

  test("Given orphan staging and reservation When reconciliation runs Then only owned control bytes are removed", async () => {
    // Given
    const systemsRoot = await root();
    await reserveExtractionBundle(systemsRoot, "orphan");
    const sentinel = path.join(systemsRoot, "external.txt");
    await writeFile(sentinel, "keep");

    // When
    const receipt = await reconcileExtractionPublications(systemsRoot);

    // Then
    expect(receipt).toEqual({ removed_staging: 1, removed_reservations: 1 });
    expect(await readFile(sentinel, "utf8")).toBe("keep");
  });
});
