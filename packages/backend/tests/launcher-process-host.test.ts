import { expect, test } from "bun:test";
import path from "node:path";
import { windowsProcessHostPreflight } from "../../../scripts/dev-launcher";

const distHost = path.resolve(import.meta.dir, "../../../dist/windows-process-host/burnguard-windows-process-host.exe");
const dotnet = path.join("C:", "dotnet", "dotnet.exe");

test.each([
  ["a non-Windows host", "linux", {}, [], null, "ready"],
  ["BG_WINDOWS_PROCESS_HOST set", "win32", { BG_WINDOWS_PROCESS_HOST: path.join("C:", "ci", "host.exe") }, [], null, "ready"],
  ["a dist build of the helper", "win32", {}, [distHost], null, "ready"],
  ["no dist build and dotnet on PATH", "win32", {}, [], dotnet, "build"],
  ["no dist build and no dotnet", "win32", {}, [], null, "missing_sdk"],
] as const)("Given %s When the dev launcher checks the Windows process host Then the preflight is %p", (_label, platform, env, present, dotnetPath, expected) => {
  expect(windowsProcessHostPreflight({ platform, env, exists: (candidate) => new Set<string>(present).has(candidate), dotnet: dotnetPath })).toBe(expected);
});
