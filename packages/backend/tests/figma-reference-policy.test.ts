import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { appendFigmaReferenceContext } from "../src/harness/prompt-figma-references";
import { stageFigmaExport, parseFigmaImportDocument } from "../src/services/figma-import";
import {
  allowedFigmaReferencePaths,
  loadFigmaReferencePolicy,
} from "../src/services/figma-reference-policy";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function documentFixture(): unknown {
  return {
    name: "Reference",
    version: "3",
    lastModified: "2026-09-28T01:00:00Z",
    document: {
      id: "0:0",
      name: "Document",
      type: "DOCUMENT",
      children: [{
        id: "1:0",
        name: "Page",
        type: "CANVAS",
        children: [{
          id: "1:2",
          name: "Hero",
          type: "FRAME",
        }],
      }],
    },
  };
}

describe("Figma immutable reference policy", () => {
  test("Given a staged import When the policy is loaded Then every manifest and node path has a durable allowed hash path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-figma-policy-"));
    roots.push(root);
    await stageFigmaExport({
      stage_dir: root,
      source_file_name: "reference.json",
      document: parseFigmaImportDocument(documentFixture()),
      node_ids: ["1:2"],
      assets: [],
      pinned_tokens_css: "",
      imported_at: "2026-09-28T02:00:00Z",
      signal: new AbortController().signal,
    });

    const policy = await loadFigmaReferencePolicy(root);
    const allowed = allowedFigmaReferencePaths(policy);

    expect(policy.files.map((file) => file.path)).toEqual([
      expect.stringMatching(/^references\/figma\/.+\/manifest\.json$/u),
      expect.stringMatching(/^references\/figma\/.+\/nodes\/1-2\.json$/u),
    ]);
    expect([...allowed.values()].every((paths) => paths.size === 1)).toBe(true);
  });

  test("Given imported references When prompt context is assembled Then bounded untrusted metadata exposes relative source paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-figma-prompt-"));
    roots.push(root);
    await stageFigmaExport({
      stage_dir: root,
      source_file_name: "reference.json",
      document: parseFigmaImportDocument(documentFixture()),
      node_ids: ["1:2"],
      assets: [],
      pinned_tokens_css: "",
      imported_at: "2026-09-28T02:00:00Z",
      signal: new AbortController().signal,
    });
    const lines: string[] = [];

    await appendFigmaReferenceContext(lines, root);
    const opening = lines.indexOf("<burnguard-untrusted-figma-references-v1>");
    const payload = opening < 0 ? null : JSON.parse(lines[opening + 1] ?? "null");

    expect(payload).toEqual(expect.objectContaining({
      schema_version: 1,
      trust: "untrusted",
      references: [expect.objectContaining({
        source_file_name: "reference.json",
        nodes: [expect.objectContaining({
          name: "Hero",
          node_type: "FRAME",
          node_path: expect.stringMatching(/^references\/figma\//u),
        })],
      })],
    }));
  });

  test("Given a malformed authored Figma manifest When prompt context is assembled Then it is ignored as untrusted data", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-figma-invalid-prompt-"));
    roots.push(root);
    const directory = path.join(root, "references", "figma", "forged");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "manifest.json"), "{}");
    const lines: string[] = [];

    await appendFigmaReferenceContext(lines, root);

    expect(lines).toEqual([]);
  });
});
