import { cp, copyFile, lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { APP_NAME, APP_VERSION } from "../packages/shared/src/app";

export function isRuntimeSource(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  if (normalized.split("/").some((part) => part === "..") || path.isAbsolute(normalized)) return false;
  return normalized === "LICENSE" || normalized.startsWith("design system themes/") ||
    (normalized.startsWith("design system sample/") && !normalized.startsWith("design system sample/uploads/")) ||
    normalized.startsWith("packages/backend/src/db/migrations/");
}

/** The resource folder is the portable app's data source, never its user-data folder. */
export async function stageRuntimeAssets(repoRoot: string, outputDirectory: string, includeWindowsNode = false): Promise<string> {
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
  if (includeWindowsNode) {
    if (process.platform !== "win32") throw new Error("Windows portable packaging requires a Windows Node runtime");
    const node = Bun.which("node");
    if (!node) throw new Error("Node is required to package the Windows browser renderer");
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
    await copyFile(node, path.join(resources, "node/node.exe"));
    await writeFile(path.join(resources, "node/LICENSE"), license);
  }
  await writeFile(path.join(resources, "burnguard-runtime.json"), JSON.stringify({ schema_version: 1, name: APP_NAME, version: APP_VERSION, nodeVersion, sourceFiles: files }, null, 2));
  return resources;
}
