import { describe, expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { appRootDir } from "../src/lib/app-paths";
import { resolveRepoRoot } from "../src/lib/paths";
import { isRuntimeSource } from "../../../scripts/package-runtime";
import { nativeModulePackages } from "../src/services/native-binding";

describe("portable package resources", () => {
  test("Given a relocated executable When its resource marker exists Then cwd and source checkout are unnecessary", async () => {
    const executable = path.join(appRootDir, "한글 portable app", "burnguard-design.exe");
    const resources = path.join(path.dirname(executable), "resources");
    await mkdir(resources, { recursive: true });
    await writeFile(path.join(resources, "burnguard-runtime.json"), "{}");
    expect(resolveRepoRoot("unrelated/source/path", executable)).toBe(resources);
  });

  test("Given repository resources and a private upload When selecting package files Then only shipped resources are selected", () => {
    const paths = ["design system sample/tokens.json", "design system sample/uploads/private.pptx", "design system themes/light/tokens.json", "packages/backend/src/db/migrations/0001_initial.sql", "LICENSE", "../private.json", ".env", "packages/backend/src/config.ts", "design system themes/previews/light.html", "design system themes/previews/media/light.webp"];
    expect(paths.filter(isRuntimeSource)).toEqual([paths[0], paths[2], paths[3], paths[4], paths[8], paths[9]]);
    expect(isRuntimeSource("design system themes/previews/thumbnails/light.webp")).toBe(true);
    expect(isRuntimeSource("design system sample\\uploads\\private.pptx")).toBe(false);
    expect(isRuntimeSource("assets/liquid-glass/liquid-glass.js")).toBe(false);
    expect(isRuntimeSource("assets/fonts/../../private.json")).toBe(false);
    for (const flavor of [path.posix, path.win32]) {
      expect(isRuntimeSource(flavor.join("assets", "fonts", "PretendardVariable.woff2"))).toBe(true);
      expect(isRuntimeSource(flavor.join("assets", "fonts", "Pretendard-OFL.txt"))).toBe(true);
    }
  });

  test("Given the built frontend and bundled font When staging portable resources Then app and artifact fonts retain their original bytes and license", async () => {
    const repo = path.resolve(import.meta.dir, "../../..");
    const root = await mkdtemp(path.join(tmpdir(), "burnguard-app-font-package-"));
    const source = path.join(root, "source");
    const output = path.join(root, "output");
    async function run(command: string[], cwd: string): Promise<void> {
      const child = Bun.spawn(command, { cwd, env: { ...process.env, GIT_MASTER: "1" }, stdout: "pipe", stderr: "pipe" });
      const timer = setTimeout(() => child.kill(), 25_000);
      try {
        const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "", stderr: "" });
      } finally { clearTimeout(timer); }
    }
    try {
      const font = await readFile(path.join(repo, "assets/fonts/PretendardVariable.woff2"));
      const license = await readFile(path.join(repo, "assets/fonts/Pretendard-OFL.txt"));
      const files = {
        "assets/fonts/PretendardVariable.woff2": font,
        "assets/fonts/Pretendard-OFL.txt": license,
        "packages/backend/src/services/chromium-node-bridge.mjs": "export {};",
        "packages/backend/src/services/extraction-css-worker.ts": "export {};",
        "packages/frontend/src/components/canvas/three-scene-runtime.ts": "export {};",
      };
      for (const [relative, bytes] of Object.entries(files)) {
        const target = path.join(source, relative);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, bytes);
      }
      await cp(path.join(repo, "packages/frontend/dist"), path.join(source, "packages/frontend/dist"), { recursive: true });
      await run(["git", "init", "--quiet", source], root);
      await run(["git", "-c", "core.autocrlf=false", "add", "assets"], source);
      // Unrelated renderer dependencies are small stand-ins; the staging code and font bytes are real.
      for (const name of ["playwright-core", ...nativeModulePackages(process.platform, process.arch), "three"]) {
        const directory = path.join(source, "node_modules", name);
        await mkdir(path.join(directory, "build"), { recursive: true });
        await writeFile(path.join(directory, "package.json"), JSON.stringify({ name, main: "build/index.cjs" }));
        await writeFile(path.join(directory, "build/index.cjs"), "module.exports = {};");
        await writeFile(path.join(directory, "LICENSE"), "fixture dependency license");
      }
      await run([process.execPath, "-e", `
        import { stageRuntimeAssets } from "./scripts/package-runtime";
        await stageRuntimeAssets(${JSON.stringify(source)}, ${JSON.stringify(output)});
      `], repo);
      const resources = path.join(output, "resources");
      expect(await readFile(path.join(resources, "assets/fonts/PretendardVariable.woff2"))).toEqual(font);
      expect(await readFile(path.join(resources, "assets/fonts/Pretendard-OFL.txt"))).toEqual(license);
      const stagedAssets = path.join(resources, "packages/frontend/dist/assets");
      const names = await readdir(stagedAssets);
      const fonts = names.filter(name => name.startsWith("PretendardVariable-") && name.endsWith(".woff2"));
      expect(fonts).toHaveLength(1);
      const stagedFont = fonts[0];
      if (!stagedFont) throw new Error("packaged_app_font_missing");
      expect(await readFile(path.join(stagedAssets, stagedFont))).toEqual(font);
      const css = (await Promise.all(names.filter(name => name.endsWith(".css")).map(name => readFile(path.join(stagedAssets, name), "utf8")))).join("\n");
      expect(css).toContain(`/assets/${stagedFont}`);
      const marker: unknown = JSON.parse(await readFile(path.join(resources, "burnguard-runtime.json"), "utf8"));
      expect(marker).toMatchObject({ sourceFiles: ["assets/fonts/Pretendard-OFL.txt", "assets/fonts/PretendardVariable.woff2"] });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
