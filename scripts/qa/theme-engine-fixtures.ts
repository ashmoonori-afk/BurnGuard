#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

export const CORPUS_ROOT = path.resolve(import.meta.dir, "../../packages/backend/tests/fixtures/theme-engine");
export const MANIFEST = "manifest.json";

type Entry = {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
};

export class CorpusError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CorpusError";
  }
}

async function inventory(root: string): Promise<readonly Entry[]> {
  if (!(await lstat(root)).isDirectory()) throw new CorpusError("INVALID_ROOT");
  const files: Entry[] = [];
  async function visit(directory: string, prefix: string): Promise<void> {
    for (const name of (await readdir(directory)).sort()) {
      // Forward-slash paths are portable even when the host uses backslashes.
      if (name.includes("\\") || name.includes(":")) throw new CorpusError("NONPORTABLE_PATH");
      const relative = prefix + name;
      const absolute = path.join(directory, name);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) throw new CorpusError("SYMLINK");
      if (stat.isDirectory()) {
        await visit(absolute, `${relative}/`);
      } else if (stat.isFile()) {
        if (relative === MANIFEST) continue;
        if (name === "validation.json") throw new CorpusError("PRIVATE_EVIDENCE");
        const bytes = await readFile(absolute);
        files.push({ path: relative, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
      } else {
        throw new CorpusError("NONREGULAR_INPUT");
      }
    }
  }
  await visit(root, "");
  if (files.length === 0) throw new CorpusError("EMPTY_CORPUS");
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

export async function runCorpus(command: "freeze" | "verify", root = CORPUS_ROOT): Promise<number> {
  const files = await inventory(root);
  const manifest = { schema_version: 1, algorithm: "sha256", files };
  const target = path.join(root, MANIFEST);
  switch (command) {
    case "freeze":
      // Exclusive creation also refuses dangling links and concurrent freeze attempts.
      await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx", mode: 0o444 });
      break;
    case "verify": {
      const frozen: unknown = JSON.parse(await readFile(target, "utf8"));
      // Compare data, never resolve or open paths supplied by a manifest.
      if (!isDeepStrictEqual(frozen, manifest)) throw new CorpusError("CORPUS_MISMATCH");
      break;
    }
  }
  return files.length;
}

export async function main(args: readonly string[]): Promise<number> {
  const [command, flag, root] = args;
  if ((command !== "freeze" && command !== "verify")
    || (args.length !== 1 && (args.length !== 3 || flag !== "--root" || !root))) {
    console.error(JSON.stringify({ status: "FAIL", code: "USAGE" }));
    return 1;
  }
  try {
    const count = await runCorpus(command, root ? path.resolve(root) : CORPUS_ROOT);
    console.log(JSON.stringify({ status: "PASS", command, files: count }));
    return 0;
  } catch (error) {
    // Only machine codes cross the CLI boundary; filesystem messages contain host paths.
    const code = error instanceof CorpusError ? error.code
      : error instanceof SyntaxError ? "INVALID_MANIFEST"
      : error instanceof Error && "code" in error && typeof error.code === "string" ? error.code
      : "IO_FAILURE";
    console.error(JSON.stringify({ status: "FAIL", code }));
    return 1;
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
