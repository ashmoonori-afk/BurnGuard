import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "../../..");
const fixtures: string[] = [];

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "burnguard-package-node-"));
  fixtures.push(root);
  return root;
}

// Run the packaging entry point outside bun:test so Bun.build uses each entry's tsconfig.
async function stage(output: string, includeNode: boolean, options: { hideNode?: boolean; path?: string; source?: string } = {}) {
  const child = Bun.spawn([process.execPath, "-e", `
    import { stageRuntimeAssets } from "./scripts/package-runtime";
    if (${options.hideNode ?? false}) {
      const which = Bun.which.bind(Bun);
      Bun.which = (command, options) => command === "node" ? null : which(command, options);
    }
    await stageRuntimeAssets(${JSON.stringify(options.source ?? repoRoot)}, ${JSON.stringify(output)}, ${includeNode});
  `], { cwd: repoRoot, env: { ...process.env, ...(options.path === undefined ? {} : { PATH: options.path }) }, stdout: "pipe", stderr: "pipe" });
  const deadline = setTimeout(() => child.kill(), 25_000);
  try {
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, stdout, stderr };
  } finally {
    clearTimeout(deadline);
  }
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("required packaged Node runtime", () => {
  test.skipIf(process.platform !== "darwin" && process.platform !== "win32")("Given no Node When packaging requires it Then staging rejects before replacing resources", async () => {
    const output = await fixture();
    const resources = path.join(output, "resources");
    await mkdir(resources);
    await writeFile(path.join(resources, "existing-resource"), "preserve");

    const result = await stage(output, true, { hideNode: true });
    expect(result.code).toBe(1);
    expect(await readFile(path.join(resources, "existing-resource"), "utf8")).toBe("preserve");
    expect(existsSync(path.join(resources, "burnguard-runtime.json"))).toBe(false);
  });

  for (const library of ["@rpath/libnode.dylib", "/opt/homebrew/opt/icu/lib/libicuuc.dylib"]) {
    test.skipIf(process.platform !== "darwin")(`Given Node linked to ${library} When packaging requires it Then staging rejects before creating output`, async () => {
      const root = await fixture();
      const tools = path.join(root, "bin");
      await mkdir(tools);
      await symlink(process.execPath, path.join(tools, "node"));
      // Exercise the real inspection subprocess with a deterministic dependency listing.
      await writeFile(path.join(tools, "otool"), `#!/bin/sh\nprintf '%s\\n' 'node:' '    ${library} (compatibility version 1.0.0)'\n`);
      await chmod(path.join(tools, "otool"), 0o755);
      const output = path.join(root, "output");

      const result = await stage(output, true, { path: `${tools}${path.delimiter}${process.env.PATH ?? ""}` });
      expect(result.code).toBe(1);
      expect(existsSync(output)).toBe(false);
    });
  }

  test("Given Node is not requested When Node is absent Then resource staging proceeds past Node preflight", async () => {
    const root = await fixture();
    const output = path.join(root, "output");
    // An absent checkout stops staging after preflight, without requiring a frontend build.
    const result = await stage(output, false, { hideNode: true, source: path.join(root, "absent-checkout") });
    expect(result.code).toBe(1);
    expect(existsSync(path.join(output, "resources"))).toBe(true);
    expect(existsSync(path.join(output, "resources/burnguard-runtime.json"))).toBe(false);
  });
});
