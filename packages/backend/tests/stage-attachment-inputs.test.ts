import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { inspectCanonicalTree } from "../src/services/canonical-tree-manifest";
import { materializeManagedTree } from "../src/services/artifact-tree-storage";
import { redactPrivateAttachmentPaths, withPrivateAttachmentInputs, type StageAttachment } from "../src/services/stage-attachment-inputs";
import { canCreateSymlink, SYMLINK_SKIP_REASON } from "./helpers/platform";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function fixture(): Promise<{ readonly project: string; readonly operation: string; readonly stage: string; readonly attachments: readonly StageAttachment[] }> {
  const project = await mkdtemp(path.join(tmpdir(), "burnguard-input-project-"));
  const operation = await mkdtemp(path.join(tmpdir(), "burnguard-operation-"));
  const stage = path.join(operation, "stage");
  roots.push(project, operation);
  await mkdir(path.join(project, ".attachments"));
  await writeFile(path.join(project, "index.html"), "base");
  const attachments: StageAttachment[] = [];
  for (const [id, content] of [["attachment-a", "first"], ["attachment-b", "second"]] as const) {
    const filePath = path.join(project, ".attachments", `${id}.pdf`);
    await writeFile(filePath, content);
    await writeFile(`${filePath}.extracted.md`, `text:${content}`);
    attachments.push({ id, file_path: filePath, original_name: "duplicate.pdf", size_bytes: content.length, sha256: createHash("sha256").update(content).digest("hex"), source_role: "ordinary_content" });
  }
  await materializeManagedTree(project, stage);
  return { project, operation, stage, attachments };
}

describe("private attachment inputs", () => {
  test("Given duplicate attachments When materialized Then absolute private paths are stable only for the callback and never enter authored stage", async () => {
    const input = await fixture();
    const captured: string[] = [];
    await withPrivateAttachmentInputs({ operationDir: input.operation, projectDir: input.project, attachments: input.attachments, requestedPaths: input.attachments.map((item) => item.file_path), immutableSnapshots: [] }, async (sources) => {
      expect(sources).toHaveLength(2);
      expect(new Set(sources.map((source) => source.sourcePath)).size).toBe(2);
      for (const source of sources) {
        expect(path.isAbsolute(source.sourcePath)).toBe(true);
        expect(path.relative(input.operation, source.sourcePath).startsWith("inputs-")).toBe(true);
        expect(await readFile(source.sourcePath, "utf8")).toMatch(/first|second/u);
        expect(await readFile(source.extractedTextPath ?? "missing", "utf8")).toMatch(/^text:/u);
        const event = redactPrivateAttachmentPaths({ type: "tool.started", input: { file_path: source.sourcePath, command: `Read ${source.extractedTextPath}` } }, sources);
        expect(JSON.stringify(event)).not.toContain(input.operation);
        expect(JSON.stringify(event)).toContain(`.attachments/${path.basename(source.attachmentPath)}`);
        captured.push(source.sourcePath);
      }
      expect((await inspectCanonicalTree(input.stage)).files.map((file) => file.path)).toEqual(["index.html"]);
    });
    for (const source of captured) await expect(readFile(source)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("Given private paths in nested tool-event keys and values When redacted Then shape survives with deterministic collision-free bounded keys", async () => {
    const input = await fixture();
    await withPrivateAttachmentInputs({ operationDir: input.operation, projectDir: input.project, attachments: input.attachments, requestedPaths: input.attachments.map((item) => item.file_path), immutableSnapshots: [] }, async (sources) => {
      const first = sources[0];
      const second = sources[1];
      if (first === undefined || second === undefined) throw new Error("fixture_source_missing");
      const privateRoot = path.dirname(first.sourcePath);
      const event = {
        type: "tool.started",
        input: [{
          "[private-input-path]": "existing",
          [first.sourcePath]: { [`prefix:${privateRoot}:suffix`]: [first.sourcePath, { [second.sourcePath]: second.extractedTextPath }] },
          [second.sourcePath]: privateRoot,
        }],
      };

      const redacted = redactPrivateAttachmentPaths(event, sources);
      const serialized = JSON.stringify(redacted);
      const redactedInput = redacted.input[0];
      if (redactedInput === undefined) throw new Error("redacted_input_missing");
      expect(serialized).not.toContain(input.operation);
      expect(serialized).not.toContain(privateRoot);
      expect(Object.keys(redactedInput)).toHaveLength(3);
      expect(Object.keys(redactedInput)).toEqual(["[private-input-path]", "[private-input-path:2]", "[private-input-path:3]"]);
      const nested = redactedInput["[private-input-path:2]"];
      expect(nested).toBeObject();
      expect(Object.keys(nested as object)).toEqual(["[private-input-path]"]);
      expect(serialized).toContain(`.attachments/${path.basename(first.attachmentPath)}`);
    });
  });

  for (const alias of ["hardlink", "symlink"] as const) {
  test.skipIf(alias === "symlink" && !canCreateSymlink())(`Given source or extracted sidecar ${alias} swap after open When materialized Then the already-open descriptor supplies the snapshot without touching outside (${alias === "symlink" ? SYMLINK_SKIP_REASON : "actual inode alias"})`, async () => {
    for (const kind of ["source", "extracted"] as const) {
      const input = await fixture();
      const original = kind === "source" ? input.attachments[0]?.file_path ?? "missing" : `${input.attachments[0]?.file_path}.extracted.md`;
      const displaced = `${original}.captured`;
      const outside = path.join(input.project, `${kind}-outside`);
      await writeFile(outside, kind === "source" ? "first" : new Uint8Array(5 * 1024 * 1024 + 1));
      try {
        await expect(withPrivateAttachmentInputs({ operationDir: input.operation, projectDir: input.project, attachments: input.attachments, requestedPaths: [input.attachments[0]?.file_path ?? "missing"], immutableSnapshots: [], hooks: { afterOpen: async (openedKind) => {
          if (openedKind !== kind) return;
          await rename(original, displaced);
          if (alias === "hardlink") await link(outside, original); else await symlink(outside, original);
        } } }, async (sources) => {
          expect(await readFile(sources[0]?.sourcePath ?? "missing", "utf8")).toBe("first");
          expect(await readFile(sources[0]?.extractedTextPath ?? "missing", "utf8")).toBe("text:first");
        })).resolves.toBeUndefined();
        expect((await readFile(outside)).byteLength).toBe(kind === "source" ? 5 : 5 * 1024 * 1024 + 1);
      } finally {
        await rm(original, { force: true });
        await rename(displaced, original).catch(() => undefined);
      }
    }
  });
  }

  test("Given adapter failure When inputs unwind Then the entire private directory is removed", async () => {
    const input = await fixture();
    let source = "";
    await expect(withPrivateAttachmentInputs({ operationDir: input.operation, projectDir: input.project, attachments: input.attachments, requestedPaths: [input.attachments[0]?.file_path ?? "missing"], immutableSnapshots: [] }, async (sources) => { source = sources[0]?.sourcePath ?? ""; throw new Error("adapter_failed"); })).rejects.toThrow("adapter_failed");
    await expect(readFile(source)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await inspectCanonicalTree(input.stage)).files.map((file) => file.path)).toEqual(["index.html"]);
  });
});
