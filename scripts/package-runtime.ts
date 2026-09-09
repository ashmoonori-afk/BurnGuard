import { chmod, cp, copyFile, lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { APP_NAME, APP_VERSION } from "../packages/shared/src/app";
import { nativeModulePackages } from "../packages/backend/src/services/native-binding";

export function isRuntimeSource(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  if (normalized.split("/").some((part) => part === "..") || path.isAbsolute(normalized)) return false;
  return normalized === "LICENSE" || normalized === "NOTICE" || normalized.startsWith("assets/fonts/") || normalized.startsWith("design system themes/") || normalized.startsWith("samples/original/") ||
    (normalized.startsWith("design system sample/") && !normalized.startsWith("design system sample/uploads/")) ||
    normalized.startsWith("packages/backend/src/db/migrations/");
}

/** The resource folder is the portable app's data source, never its user-data folder. */
export async function stageRuntimeAssets(repoRoot: string, outputDirectory: string, includeNode = false): Promise<string> {
  await mkdir(outputDirectory, { recursive: true });
  const destinationParent = await realpath(outputDirectory);
  const resources = path.join(destinationParent, "resources");
  if (path.dirname(resources) !== destinationParent || path.basename(resources) !== "resources") throw new Error("Invalid package resource destination");
  await rm(resources, { recursive: true, force: true });
  await mkdir(resources);
  const listing = Bun.spawn(["git", "ls-files", "-z"], { cwd: repoRoot, stdout: "pipe", stderr: "pipe" });
  const listDeadline = setTimeout(() => listing.kill(), 30_000);
  const [code, output] = await Promise.all([listing.exited, new Response(listing.stdout).text(), new Response(listing.stderr).text()]).finally(() => clearTimeout(listDeadline));
  if (code !== 0) throw new Error("Could not identify tracked runtime resources");
  const realRoot = await realpath(repoRoot);
  const files = output.split("\0").filter(isRuntimeSource).sort();
  for (const relative of files) {
    const source = path.join(repoRoot, relative);
    const info = await lstat(source);
    const realRelative = path.relative(realRoot, await realpath(source));
    if (!info.isFile() || realRelative.startsWith("..") || path.isAbsolute(realRelative)) throw new Error("Unsafe package resource");
    const target = path.join(resources, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  const frontend = path.join(repoRoot, "packages/frontend/dist");
  await readFile(path.join(frontend, "index.html"));
  await cp(frontend, path.join(resources, "packages/frontend/dist"), { recursive: true });
  const playwright = path.dirname(Bun.resolveSync("playwright-core/package.json", path.join(repoRoot, "packages/backend")));
  await cp(playwright, path.join(resources, "node_modules/playwright-core"), { recursive: true, dereference: true });
  // Native canvas bindings and PDF.js's relative worker must remain real files on every platform.
  const canvasRoot = path.dirname(Bun.resolveSync("@napi-rs/canvas/package.json", path.join(repoRoot, "packages/backend")));
  for (const name of nativeModulePackages(process.platform, process.arch)) {
    const source = path.dirname(Bun.resolveSync(`${name}/package.json`, name.startsWith("@napi-rs/canvas-") ? canvasRoot : path.join(repoRoot, "packages/backend")));
    await cp(source, path.join(destinationParent, "node_modules", name), { recursive: true, dereference: true });
  }
  await copyFile(path.join(repoRoot, "packages/backend/src/services/chromium-node-bridge.mjs"), path.join(resources, "chromium-node-bridge.mjs"));
  const worker = await Bun.build({
    entrypoints: [path.join(repoRoot, "packages/backend/src/services/extraction-css-worker.ts")],
    outdir: resources, target: "bun", minify: true,
  });
  if (!worker.success) throw new AggregateError(worker.logs, "CSS worker packaging failed");
  const threeDirectory = path.join(resources, ".burnguard-three");
  await mkdir(threeDirectory);
  const threeRuntime = await Bun.build({ entrypoints: [path.join(repoRoot, "packages/frontend/src/components/canvas/three-scene-runtime.ts")], target: "browser", format: "iife", minify: true });
  if (!threeRuntime.success || !threeRuntime.outputs[0]) throw new Error("Three.js runtime packaging failed");
  await writeFile(path.join(threeDirectory, "runtime.js"), await threeRuntime.outputs[0].text());
  const threeEntry = Bun.resolveSync("three", path.join(repoRoot, "packages/frontend"));
  await copyFile(path.resolve(path.dirname(threeEntry), "../LICENSE"), path.join(threeDirectory, "LICENSE"));
  let nodeVersion: string | null = null;
  // The packaged app drives Chromium from a Node child (chromium-node-bridge.mjs) because
  // Bun's in-process Playwright launch stalls on Windows and macOS.
  const node = includeNode ? await packagableNode() : null;
  if (node !== null) {
    const versionProbe = Bun.spawn([node, "--version"], { stdout: "pipe", stderr: "pipe" });
    const versionDeadline = setTimeout(() => versionProbe.kill(), 10_000);
    const [exitCode, version] = await Promise.all([versionProbe.exited, new Response(versionProbe.stdout).text(), new Response(versionProbe.stderr).text()]).finally(() => clearTimeout(versionDeadline));
    if (exitCode !== 0 || !/^v\d+\.\d+\.\d+$/.test(version.trim())) throw new Error("Could not identify the packaged Node runtime");
    nodeVersion = version.trim();
    const licenseCache = path.join(repoRoot, ".bun", `node-${nodeVersion}-LICENSE`);
    let license: string;
    try {
      license = await readFile(licenseCache, "utf8");
    } catch {
      const response = await fetch(`https://raw.githubusercontent.com/nodejs/node/${nodeVersion}/LICENSE`, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error("Could not obtain the matching Node redistribution license");
      license = await response.text();
      if (!license.includes("Node.js") || !license.includes("Permission is hereby granted")) throw new Error("Invalid Node redistribution license");
      await mkdir(path.dirname(licenseCache), { recursive: true });
      await writeFile(licenseCache, license);
    }
    if (!license.includes("Node.js") || !license.includes("Permission is hereby granted")) throw new Error("Invalid cached Node redistribution license");
    await mkdir(path.join(resources, "node"));
    const target = path.join(resources, "node", process.platform === "win32" ? "node.exe" : "node");
    await copyFile(node, target);
    if (process.platform !== "win32") await chmod(target, 0o755);
    await writeFile(path.join(resources, "node/LICENSE"), license);
  }
  await writeFile(path.join(resources, "burnguard-runtime.json"), JSON.stringify({ schema_version: 1, name: APP_NAME, version: APP_VERSION, nodeVersion, sourceFiles: files }, null, 2));
  return resources;
}

/**
 * The Node binary to ship, or null when this build cannot carry one. Windows requires it.
 * On macOS a Homebrew node links Homebrew dylibs (@rpath, /opt/homebrew) and would not run on
 * another machine, so only a self-contained build (nodejs.org, actions/setup-node) is staged;
 * without one the app falls back to a Node on the user's PATH at runtime.
 */
async function packagableNode(): Promise<string | null> {
  if (process.platform !== "win32" && process.platform !== "darwin") throw new Error("Portable packaging with a Node runtime supports Windows and macOS only");
  const node = Bun.which("node");
  if (!node) {
    if (process.platform === "win32") throw new Error("Node is required to package the Windows browser renderer");
    console.warn("[package] no Node on PATH: the macOS bundle will use the user's Node for Chromium rendering");
    return null;
  }
  if (process.platform === "darwin") {
    const otool = Bun.spawn(["otool", "-L", node], { stdout: "pipe", stderr: "pipe" });
    const deadline = setTimeout(() => otool.kill(), 10_000);
    const [exitCode, listing] = await Promise.all([otool.exited, new Response(otool.stdout).text(), new Response(otool.stderr).text()]).finally(() => clearTimeout(deadline));
    if (exitCode !== 0) throw new Error("Could not inspect the Node runtime's linked libraries");
    const foreign = listing.split("\n").slice(1).map((line) => line.trim().split(" ")[0] ?? "").filter((library) => library !== "" && !library.startsWith("/usr/lib/") && !library.startsWith("/System/"));
    if (foreign.length > 0) {
      console.warn(`[package] ${node} links ${foreign.length} non-system libraries and is not relocatable; the macOS bundle will use the user's Node for Chromium rendering`);
      return null;
    }
  }
  return node;
}
