import { afterEach, expect, test } from "bun:test";
import { chmod, cp, lstat, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { nativeModulePackages } from "../src/services/native-binding";

const repoRoot = path.resolve(import.meta.dir, "../../..");
const fixtures: string[] = [];

async function run(command: string[], cwd: string) {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const deadline = setTimeout(() => child.kill(), 25_000);
  try {
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    return stdout;
  } finally {
    clearTimeout(deadline);
  }
}

async function unsafeModes(root: string): Promise<string[]> {
  const info = await lstat(root);
  if (info.isSymbolicLink()) return [];
  const unsafe = (info.mode & 0o022) === 0 ? [] : [root];
  if (info.isDirectory()) {
    for (const name of await readdir(root)) unsafe.push(...await unsafeModes(path.join(root, name)));
  }
  return unsafe;
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test.skipIf(process.platform === "win32")("Given writable source dependencies When staging POSIX runtime assets Then only staged modes lose group/world write without following symlinks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "burnguard-package-permissions-"));
  fixtures.push(root);
  const source = path.join(root, "source");
  const output = path.join(root, "output");
  const files = {
    "LICENSE": "fixture license",
    "assets/liquid-glass/tool.sh": "#!/bin/sh\nexit 0\n",
    "packages/frontend/dist/index.html": "<!doctype html>",
    "packages/frontend/src/components/canvas/three-scene-runtime.ts": "export {};",
    "packages/backend/src/services/extraction-css-worker.ts": "export {};",
    "packages/backend/src/services/chromium-node-bridge.mjs": "export {};",
  };
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(source, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  await run(["git", "init", "--quiet", source], root);
  await run(["git", "add", "LICENSE", "assets"], source);

  // Copy the real dependency before making it unsafe; never chmod installed dependencies.
  const modules = path.join(source, "node_modules");
  const canvasRoot = path.dirname(Bun.resolveSync("@napi-rs/canvas/package.json", path.join(repoRoot, "packages/backend")));
  for (const name of ["playwright-core", ...nativeModulePackages(process.platform, process.arch), "three"]) {
    const resolveFrom = name.startsWith("@napi-rs/canvas-") ? canvasRoot : path.join(repoRoot, name === "three" ? "packages/frontend" : "packages/backend");
    const installed = path.dirname(Bun.resolveSync(`${name}/package.json`, resolveFrom));
    const target = path.join(modules, name);
    await mkdir(path.dirname(target), { recursive: true });
    if (name === "playwright-core" || name === "@napi-rs/canvas") {
      await cp(installed, target, { recursive: true, dereference: true });
    } else {
      await symlink(installed, target, "dir");
    }
  }
  const cli = path.join(modules, "playwright-core/cli.js");
  const native = path.join(modules, "@napi-rs/canvas/index.js");
  const frontend = path.join(source, "packages/frontend/dist");
  await chmod(cli, 0o777);
  await chmod(native, 0o666);
  await chmod(frontend, 0o777);
  await chmod(path.join(frontend, "index.html"), 0o666);
  await chmod(path.join(source, "LICENSE"), 0o600);
  await chmod(path.join(source, "assets/liquid-glass/tool.sh"), 0o771);

  const external = path.join(root, "external");
  await mkdir(external);
  await writeFile(path.join(external, "sentinel"), "not a staged file");
  await chmod(external, 0o777);
  await chmod(path.join(external, "sentinel"), 0o777);
  await symlink(external, path.join(frontend, "external-directory"), "dir");
  await symlink(path.join(external, "sentinel"), path.join(frontend, "external-file"));

  // Real staging subprocess: Bun.build must use the fixture entry points' own context.
  await run([process.execPath, "-e", `
    import { stageRuntimeAssets } from "./scripts/package-runtime";
    await stageRuntimeAssets(${JSON.stringify(source)}, ${JSON.stringify(output)});
  `], repoRoot);

  const resources = path.join(output, "resources");
  const mode = async (file: string) => (await lstat(file)).mode & 0o777;
  expect(await mode(path.join(resources, "node_modules/playwright-core/cli.js"))).toBe(0o755);
  expect(await mode(path.join(output, "node_modules/@napi-rs/canvas/index.js"))).toBe(0o644);
  expect(await mode(path.join(resources, "packages/frontend/dist"))).toBe(0o755);
  expect(await mode(path.join(resources, "packages/frontend/dist/index.html"))).toBe(0o644);
  expect(await mode(path.join(resources, "LICENSE"))).toBe(0o600);
  expect(await mode(path.join(resources, "assets/liquid-glass/tool.sh"))).toBe(0o751);
  expect(await unsafeModes(output)).toEqual([]);
  expect(await mode(cli)).toBe(0o777);
  expect(await mode(native)).toBe(0o666);
  expect(await mode(frontend)).toBe(0o777);
  expect(await mode(external)).toBe(0o777);
  expect(await mode(path.join(external, "sentinel"))).toBe(0o777);
  expect((await lstat(path.join(resources, "packages/frontend/dist/external-directory"))).isSymbolicLink()).toBe(true);
  expect((await lstat(path.join(resources, "packages/frontend/dist/external-file"))).isSymbolicLink()).toBe(true);
});
