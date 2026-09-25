import { expect, test } from "bun:test";
import { assertWindowsBuildHost } from "../../../scripts/build-binary";

test("Given a host other than Windows x64 When the Windows backend build starts Then it is rejected before compiling", () => {
  for (const [platform, arch] of [["darwin", "arm64"], ["darwin", "x64"], ["linux", "x64"], ["win32", "arm64"]] as const) {
    expect(() => assertWindowsBuildHost(platform, arch)).toThrow("Windows x64");
  }
});

test("Given a Windows x64 host When checked Then the build may proceed", () => {
  expect(() => assertWindowsBuildHost("win32", "x64")).not.toThrow();
});
