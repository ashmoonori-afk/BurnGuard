import { describe, expect, test } from "bun:test";
import { nativeCanvasBinding, nativeModulePackages } from "../src/services/native-binding";

describe("packaged native modules", () => {
  test("Given each shipped platform When the canvas binding is resolved Then the package and .node file match NAPI-RS naming", () => {
    expect(nativeCanvasBinding("win32", "x64")).toEqual({ package: "@napi-rs/canvas-win32-x64-msvc", file: "skia.win32-x64-msvc.node" });
    expect(nativeCanvasBinding("darwin", "arm64")).toEqual({ package: "@napi-rs/canvas-darwin-arm64", file: "skia.darwin-arm64.node" });
    expect(nativeCanvasBinding("darwin", "x64")).toEqual({ package: "@napi-rs/canvas-darwin-x64", file: "skia.darwin-x64.node" });
    expect(nativeCanvasBinding("linux", "arm64")).toBeNull();
  });

  test("Given a target platform When runtime packages are listed Then canvas, its binding and pdf.js are all staged", () => {
    expect(nativeModulePackages("darwin", "arm64")).toEqual(["@napi-rs/canvas", "@napi-rs/canvas-darwin-arm64", "pdfjs-dist"]);
    expect(nativeModulePackages("win32", "x64")).toEqual(["@napi-rs/canvas", "@napi-rs/canvas-win32-x64-msvc", "pdfjs-dist"]);
  });
});
