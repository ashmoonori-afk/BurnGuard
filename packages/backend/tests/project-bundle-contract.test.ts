import { describe, expect, test } from "bun:test";
import {
  PROJECT_BUNDLE_CREDENTIAL_EXCLUSIONS,
  PROJECT_BUNDLE_FORMAT_VERSION,
  parseProjectBundleManifest,
} from "@bg/shared";

const SHA256 = "a".repeat(64);

function manifest() {
  return {
    format: "burnguard-project",
    format_version: PROJECT_BUNDLE_FORMAT_VERSION,
    app_version: "0.5.26",
    exported_at: 1,
    project: {
      name: "Portable project",
      type: "prototype",
      entrypoint: "index.html",
      backend_id: "codex",
      options_json: null,
      current_revision: 4,
      current_digest: SHA256,
    },
    files: [
      {
        path: "project/index.html",
        kind: "project",
        size_bytes: 12,
        sha256: SHA256,
      },
    ],
    attachments: [],
    checkpoints: [],
    design_system: { kind: "none", pin: null },
    fonts: { families: [], files: [] },
    credential_exclusions: [...PROJECT_BUNDLE_CREDENTIAL_EXCLUSIONS],
  };
}

describe("project bundle manifest contract", () => {
  test("Given a canonical version-one manifest When parsed Then typed project identity and exclusions survive", () => {
    // Given
    const input = manifest();

    // When
    const parsed = parseProjectBundleManifest(input);

    // Then
    expect(parsed.project.current_revision).toBe(4);
    expect(parsed.files[0]?.path).toBe("project/index.html");
    expect(parsed.credential_exclusions).toEqual(PROJECT_BUNDLE_CREDENTIAL_EXCLUSIONS);
  });

  test("Given an archive path traversal When parsed Then the manifest is rejected", () => {
    // Given
    const input = manifest();
    const original = input.files[0];
    if (!original) throw new Error("missing fixture file");
    input.files[0] = { ...original, path: "project/../config.json" };

    // When / Then
    expect(() => parseProjectBundleManifest(input)).toThrow();
  });

  test("Given an unknown manifest field When parsed Then canonical identity is rejected", () => {
    // Given
    const input = { ...manifest(), unexpected: true };

    // When / Then
    expect(() => parseProjectBundleManifest(input)).toThrow();
  });
});
