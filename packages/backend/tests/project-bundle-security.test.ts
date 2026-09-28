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
import { collectProjectBundleEntries, inspectCentralDirectory } from "../src/services/project-bundle-archive";
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
      zip.file("project/index.html", "<h1>SAFE</h1>");
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

function renameAll(archive: Uint8Array, from: string, to: string): Uint8Array {
  const source = new TextEncoder().encode(from);
  const target = new TextEncoder().encode(to);
  if (source.length !== target.length) throw new Error("rename must keep the byte length");
  const out = archive.slice();
  for (let index = 0; index + source.length <= out.length; index += 1) {
    if (source.every((byte, offset) => out[index + offset] === byte)) out.set(target, index);
  }
  return out;
}

function setDeclaredSize(archive: Uint8Array, name: string, size: number): Uint8Array {
  const out = archive.slice();
  const view = new DataView(out.buffer);
  const encoded = new TextEncoder().encode(name);
  for (let offset = 0; offset + 46 < out.length; offset += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    const length = view.getUint16(offset + 28, true);
    const candidate = out.subarray(offset + 46, offset + 46 + length);
    if (length === encoded.length && candidate.every((byte, index) => byte === encoded[index])) view.setUint32(offset + 24, size, true);
  }
  return out;
}

describe("project bundle raw archive validation", () => {
  test("Given raw duplicate or case-colliding entry names When the central directory is inspected Then the archive is rejected before JSZip normalization", async () => {
    const zip = new JSZip();
    zip.file("project/aaaa.txt", "first");
    zip.file("project/bbbb.txt", "second");
    const archive = await zip.generateAsync({ type: "uint8array" });

    expect([...inspectCentralDirectory(archive).values()].filter((entry) => !entry.directory)).toHaveLength(2);
    expect(() => inspectCentralDirectory(renameAll(archive, "project/bbbb.txt", "project/aaaa.txt"))).toThrow();
    expect(() => inspectCentralDirectory(renameAll(archive, "project/bbbb.txt", "project/AAAA.txt"))).toThrow();
    expect(() => inspectCentralDirectory(renameAll(archive, "project/bbbb.txt", "project/../b.txt"))).toThrow();
  });

  test("Given an entry that inflates beyond its declared size When imported Then decompression stops at the declared size", async () => {
    const bytes = new TextEncoder().encode("<h1>".padEnd(4_096, "x"));
    const file = await bundle(bytes, (_zip, value) => {
      value.files[0] = { ...value.files[0]!, size_bytes: 1 };
    });
    const archive = setDeclaredSize(new Uint8Array(await file.arrayBuffer()), "project/index.html", 1);

    await expect(importProjectBundleFile(new File([archive], "inflating.burnguard-project"), "Inflating")).rejects.toMatchObject({
      code: "project_bundle_limit",
    });
  });
});

describe("project bundle raw archive names and records", () => {
  test("Given Windows device, stream or trailing-dot names When the central directory is inspected Then the archive is rejected before staging", async () => {
    for (const name of ["project/CON", "project/a.txt:ads", "project/trail."]) {
      const zip = new JSZip();
      zip.file(name, "x");
      const archive = await zip.generateAsync({ type: "uint8array" });
      expect(() => inspectCentralDirectory(archive)).toThrow();
    }
  });

  test("Given many nested directories When the central directory is inspected Then directory records do not consume the file budget", async () => {
    const zip = new JSZip();
    for (let index = 0; index < 200; index += 1) zip.file(`project/d${index}/f.txt`, "x");
    const archive = await zip.generateAsync({ type: "uint8array" });
    const entries = [...inspectCentralDirectory(archive).values()];
    expect(entries.filter((entry) => entry.directory).length).toBeGreaterThan(64);
  });
});
