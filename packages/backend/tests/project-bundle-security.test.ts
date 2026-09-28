import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import JSZip from "jszip";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PROJECT_BUNDLE_CREDENTIAL_EXCLUSIONS,
  PROJECT_BUNDLE_FORMAT_VERSION,
  PROJECT_BUNDLE_MANIFEST_PATH,
} from "@bg/shared";
import { importProjectBundleFile } from "../src/services/project-bundle";
import { collectProjectBundleEntries } from "../src/services/project-bundle-archive";
import { projectsDir } from "../src/lib/paths";

function manifest(bytes: Uint8Array) {
  return {
    format: "burnguard-project",
    format_version: PROJECT_BUNDLE_FORMAT_VERSION,
    app_version: "0.5.26",
    exported_at: 1,
    project: {
      name: "Portable",
      type: "prototype",
      entrypoint: "index.html",
      backend_id: "codex",
      options_json: null,
      current_revision: 3,
      current_digest: createHash("sha256").update(bytes).digest("hex"),
    },
    files: [{
      path: "project/index.html",
      kind: "project",
      size_bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    }],
    attachments: [],
    checkpoints: [],
    design_system: { kind: "none", pin: null },
    fonts: { families: [], files: [] },
    credential_exclusions: [...PROJECT_BUNDLE_CREDENTIAL_EXCLUSIONS],
  };
}

async function bundle(
  bytes: Uint8Array,
  mutate?: (zip: JSZip, value: ReturnType<typeof manifest>) => void,
): Promise<File> {
  const zip = new JSZip();
  const value = manifest(bytes);
  zip.file("project/index.html", bytes);
  mutate?.(zip, value);
  zip.file(PROJECT_BUNDLE_MANIFEST_PATH, JSON.stringify(value));
  return new File(
    [await zip.generateAsync({ type: "uint8array", platform: "UNIX", compression: "DEFLATE" })],
    "portable.burnguard-project",
  );
}

describe("project bundle hostile input", () => {
  test("Given a payload whose bytes do not match the manifest When imported Then digest validation rejects it", async () => {
    // Given
    const file = await bundle(new TextEncoder().encode("<h1>safe</h1>"), (zip) => {
      zip.file("project/index.html", "<h1>tampered</h1>");
    });

    // When / Then
    await expect(importProjectBundleFile(file, "Restored")).rejects.toMatchObject({
      code: "project_bundle_digest",
    });
  });

  test("Given traversal, unlisted, or symlink entries When imported Then each archive is rejected before project creation", async () => {
    // Given
    const bytes = new TextEncoder().encode("<h1>safe</h1>");
    const files = [
      await bundle(bytes, (zip) => { zip.file("../escape.txt", "escape"); }),
      await bundle(bytes, (zip) => { zip.file("project/unlisted.txt", "extra"); }),
      await bundle(bytes, (zip) => {
        zip.file("project/link", "outside", { unixPermissions: 0o120777 });
      }),
    ];

    // When / Then
    for (const file of files) {
      await expect(importProjectBundleFile(file, "Restored")).rejects.toMatchObject({
        code: "invalid_project_bundle",
      });
    }
  });

  test("Given a listed credential file When imported Then explicit bundle exclusions still reject it", async () => {
    // Given
    const bytes = new TextEncoder().encode("<h1>safe</h1>");
    const secret = new TextEncoder().encode('{"provider_api_key":"private"}');
    const file = await bundle(bytes, (zip, value) => {
      zip.file("project/config.json", secret);
      value.files.push({
        path: "project/config.json",
        kind: "project",
        size_bytes: secret.byteLength,
        sha256: createHash("sha256").update(secret).digest("hex"),
      });
    });

    // When / Then
    await expect(importProjectBundleFile(file, "Restored")).rejects.toMatchObject({
      code: "invalid_project_bundle",
    });
  });

  test("Given common environment and package credential files When imported Then each is rejected", async () => {
    // Given
    const bytes = new TextEncoder().encode("<h1>safe</h1>");

    // When / Then
    for (const path of ["project/.env.production", "project/.npmrc", "project/vendor/.aws/credentials"]) {
      const secret = new TextEncoder().encode("TOKEN=private");
      const file = await bundle(bytes, (zip, value) => {
        zip.file(path, secret);
        value.files.push({
          path,
          kind: "project",
          size_bytes: secret.byteLength,
          sha256: createHash("sha256").update(secret).digest("hex"),
        });
      });
      await expect(importProjectBundleFile(file, "Restored")).rejects.toMatchObject({
        code: "invalid_project_bundle",
      });
    }
  });

  test("Given protected, agent-control, or cross-platform unsafe paths When imported Then none can enter the new project", async () => {
    // Given
    const bytes = new TextEncoder().encode("<h1>safe</h1>");
    const candidates = [
      { path: "project/.git/config", kind: "project" as const },
      { path: "project/.meta/artifact-baseline/current/index.html", kind: "checkpoint" as const },
      { path: "project/AGENTS.md", kind: "project" as const },
      { path: "project/CON.txt", kind: "project" as const },
      { path: "project/vendor/.git/config", kind: "project" as const },
      { path: "project/.META/artifact-baseline/current/secret", kind: "checkpoint" as const },
      { path: "project/.ATTACHMENTS/secret.txt", kind: "attachment" as const },
    ];

    // When / Then
    for (const candidate of candidates) {
      const payload = new TextEncoder().encode(candidate.path);
      const file = await bundle(bytes, (zip, value) => {
        zip.file(candidate.path, payload);
        value.files.push({
          path: candidate.path,
          kind: candidate.kind,
          size_bytes: payload.byteLength,
          sha256: createHash("sha256").update(payload).digest("hex"),
        });
      });
      await expect(importProjectBundleFile(file, "Restored")).rejects.toMatchObject({
        code: "invalid_project_bundle",
      });
    }
  });

  test("Given a highly compressed oversized payload When imported Then the expansion limit rejects it", async () => {
    // Given
    const oversized = new Uint8Array(128 * 1024 * 1024 + 1);
    const file = await bundle(oversized);

    // When / Then
    await expect(importProjectBundleFile(file, "Restored")).rejects.toMatchObject({
      code: "project_bundle_limit",
    });
  }, 60_000);

  test("Given Windows-unsafe or case-variant app paths When exported Then portability fails before archive creation", async () => {
    // Given
    const candidates = ["CON.txt", ".ATTACHMENTS/secret.txt", ".META/checkpoints/turn.json"];

    // When / Then
    for (const candidate of candidates) {
      const root = `${projectsDir}/bundle-export-path-${process.pid}-${crypto.randomUUID()}`;
      const target = path.join(root, candidate);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, "not portable");
      try {
        await expect(collectProjectBundleEntries(root)).rejects.toMatchObject({
          code: "invalid_project_bundle",
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });
});
