import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parse } from "node-html-parser";
import { parseThreeScene, type ThreeSceneV1 } from "@bg/shared";
import { resolveRepoRoot } from "../lib/paths";
import { resolveWithin } from "../security/path-boundary";
import { inspectCanonicalTree } from "./canonical-tree-manifest";
import { ArtifactCoordinator, ArtifactOperationError } from "./artifact-coordinator";

export const THREE_RUNTIME_PATH = ".burnguard-three/runtime.js";
let runtime: Promise<{ javascript: string; license: string }> | null = null;
export function getThreeRuntime() {
  runtime ??= (async () => {
    const root = resolveRepoRoot();
    try { return { javascript: await readFile(path.join(root, THREE_RUNTIME_PATH), "utf8"), license: await readFile(path.join(root, ".burnguard-three/LICENSE"), "utf8") }; }
    catch {
      const build = await Bun.build({ entrypoints: [path.join(root, "packages/frontend/src/components/canvas/three-scene-runtime.ts")], target: "browser", format: "iife", minify: true });
      if (!build.success || !build.outputs[0]) throw new Error("three_runtime_unavailable");
      const licensePath = path.join(path.dirname(Bun.resolveSync("three", path.join(root, "packages/frontend"))), "../LICENSE");
      return { javascript: await build.outputs[0].text(), license: await readFile(licensePath, "utf8") };
    }
  })().catch(() => { runtime = null; throw new Error("three_runtime_unavailable"); });
  return runtime;
}

export function readThreeScene(html: string): ThreeSceneV1 | null {
  const roots = parse(html).querySelectorAll("[data-bg-three]");
  if (roots.length === 0) return null;
  if (roots.length !== 1) throw new Error("invalid_three_scene");
  const configs = roots[0]!.querySelectorAll("script[data-bg-three-config]");
  if (configs.length !== 1 || configs[0]!.getAttribute("type") !== "application/json") throw new Error("invalid_three_scene");
  return parseThreeScene(JSON.parse(configs[0]!.textContent));
}

export function applyThreeScene(html: string, relPath: string, input: ThreeSceneV1, javascript?: string): string {
  const scene = parseThreeScene(input);
  const root = parse(html);
  const existing = root.querySelectorAll("[data-bg-three]");
  if (existing.length > 1) throw new Error("invalid_three_scene");
  const runtimeUrl = path.posix.relative(path.posix.dirname(relPath), THREE_RUNTIME_PATH).split("/").map(encodeURIComponent).join("/");
  const script = javascript === undefined ? `<script src="${runtimeUrl}"></script>` : `<script data-bg-three-runtime>${javascript.replace(/<\/script/gi, "<\\/script")}</script>`;
  const section = `<section data-bg-three="1" data-bg-node-id="burnguard-three-scene" style="position:relative;width:100%;height:400px;overflow:hidden"><script type="application/json" data-bg-three-config>${JSON.stringify(scene)}</script>${script}</section>`;
  if (existing[0]) { const [start, end] = existing[0].range; return html.slice(0, start) + section + html.slice(end); }
  const bodyEnd = html.toLowerCase().lastIndexOf("</body>");
  return bodyEnd < 0 ? html + section : html.slice(0, bodyEnd) + section + html.slice(bodyEnd);
}

async function writeRuntime(stage: string) {
  const assets = await getThreeRuntime();
  const runtimeFile = resolveWithin(stage, THREE_RUNTIME_PATH);
  await mkdir(path.dirname(runtimeFile), { recursive: true });
  await writeFile(resolveWithin(stage, ".burnguard-three/LICENSE"), assets.license);
}

export async function saveThreeScene(coordinator: ArtifactCoordinator, input: { projectId: string; projectDir: string; relPath: string; expectedRevision: number; expectedArtifactDigest: string; expectedFileHash: string; scene: ThreeSceneV1 }) {
  const scene = parseThreeScene(input.scene);
  // This patch inserts a section into the document itself; its anchor is the entire file.
  return coordinator.run({ projectId: input.projectId, projectDir: input.projectDir, kind: "patch", expectedRevision: input.expectedRevision, expectedArtifactDigest: input.expectedArtifactDigest, expectedFileHash: input.expectedFileHash, nodeFingerprint: input.expectedFileHash,
    mutate: async (stage) => {
      const target = resolveWithin(stage, input.relPath);
      const source = await readFile(target);
      if (createHash("sha256").update(source).digest("hex") !== input.expectedFileHash) throw new ArtifactOperationError("stale_file_hash", "Expected file hash is stale");
      const html = new TextDecoder("utf8", { fatal: true }).decode(source);
      await writeFile(target, applyThreeScene(html, input.relPath, scene, (await getThreeRuntime()).javascript));
      await writeRuntime(stage);
    },
  });
}

/** Provision offline runtime only for a valid managed scene produced by an AI turn. */
export async function ensureThreeSceneRuntime(stage: string) {
  const manifest = await inspectCanonicalTree(stage);
  let found = false;
  for (const file of manifest.files) {
    if (!/\.html?$/i.test(file.path) || file.size > 16 * 1024 * 1024) continue;
    const target = resolveWithin(stage, file.path);
    const html = await readFile(target, "utf8");
    if (!html.includes("data-bg-three")) continue;
    const scene = readThreeScene(html);
    if (scene) { await writeFile(target, applyThreeScene(html, file.path, scene, (await getThreeRuntime()).javascript)); found = true; }
  }
  if (found) await writeRuntime(stage);
}
