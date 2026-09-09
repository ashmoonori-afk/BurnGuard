/**
 * Native modules the packaged app needs as real files beside its resources:
 * the compiled Bun binary cannot resolve NAPI-RS bindings or PDF.js's worker
 * from its virtual module tree. Shared by the packaging script and the loader.
 */
export type NativeCanvasBinding = { readonly package: string; readonly file: string };

const CANVAS_BINDINGS: Readonly<Record<string, string>> = {
  "win32-x64": "win32-x64-msvc",
  "darwin-arm64": "darwin-arm64",
  "darwin-x64": "darwin-x64",
};

export function nativeCanvasBinding(platform: NodeJS.Platform, arch: NodeJS.Architecture): NativeCanvasBinding | null {
  const suffix = CANVAS_BINDINGS[`${platform}-${arch}`];
  return suffix === undefined ? null : { package: `@napi-rs/canvas-${suffix}`, file: `skia.${suffix}.node` };
}

export function nativeModulePackages(platform: NodeJS.Platform, arch: NodeJS.Architecture): readonly string[] {
  const binding = nativeCanvasBinding(platform, arch);
  return ["@napi-rs/canvas", ...(binding === null ? [] : [binding.package]), "pdfjs-dist"];
}
