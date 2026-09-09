import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveRepoRoot } from "../lib/paths";
import { nativeCanvasBinding } from "./native-binding";

// Bun's compiled import.meta path is virtual; native bindings need the real package tree.
const root = resolveRepoRoot();
const runtimeRequire = createRequire(path.join(root, "packages/backend/package.json"));
function loadCanvas(): typeof import("@napi-rs/canvas") {
  const previous = process.env.NAPI_RS_NATIVE_LIBRARY_PATH;
  const binding = nativeCanvasBinding(process.platform, process.arch);
  const packaged = binding !== null && existsSync(path.join(root, "burnguard-runtime.json"));
  // Compiled Bun cannot resolve the binding's relative .node import; NAPI-RS accepts an absolute path.
  if (packaged) process.env.NAPI_RS_NATIVE_LIBRARY_PATH = path.resolve(root, "../node_modules", binding.package, binding.file);
  try { return runtimeRequire(runtimeRequire.resolve("@napi-rs/canvas")); }
  finally { if (previous === undefined) delete process.env.NAPI_RS_NATIVE_LIBRARY_PATH; else process.env.NAPI_RS_NATIVE_LIBRARY_PATH = previous; }
}
export const { createCanvas, loadImage } = loadCanvas();
export const { getDocument } = await import(pathToFileURL(runtimeRequire.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href) as typeof import("pdfjs-dist/legacy/build/pdf.mjs");
