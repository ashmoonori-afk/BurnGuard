import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

assert.equal(process.platform, "win32", "This check requires native Windows cmd.exe");
const systemRoot = process.env.SystemRoot;
assert.ok(systemRoot, "Windows must provide SystemRoot");
const system32 = path.join(systemRoot, "System32");
const root = await mkdtemp(path.join(tmpdir(), "bg-launcher-sdk-"));

try {
  for (const [name, sdks, shouldBuild] of [
    ["missing", null, false],
    ["runtime-only", "", false],
    ["other-sdk", "9.0.100 [C:\\fixture\\sdk]", false],
    ["sdk-8", "8.0.100 [C:\\fixture\\sdk]", true],
  ] as const) {
    const directory = path.join(root, name);
    const bin = path.join(directory, "bin");
    await mkdir(bin, { recursive: true });
    await copyFile(path.join(import.meta.dir, "../../Start-BurnGuard.bat"), path.join(directory, "Start-BurnGuard.bat"));
    await writeFile(path.join(bin, "bun.cmd"), "@echo BG_SDK_BUILD_REACHED\r\n@exit /b 1\r\n");
    if (sdks !== null) {
      await writeFile(path.join(bin, "dotnet.cmd"), `@echo off\r\n${sdks === "" ? "" : `echo ${sdks}\r\n`}exit /b 0\r\n`);
    }
    const child = Bun.spawn([path.join(system32, "cmd.exe"), "/d", "/c", "Start-BurnGuard.bat", "--build"], {
      cwd: directory,
      env: { ...process.env, PATH: `${bin};${system32}` },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    });
    child.stdin.write("\r\n");
    child.stdin.end();
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    // The fixture stops at the first build command, so no package or app is built.
    assert.equal(code, 1, `${name}: ${stdout}\n${stderr}`);
    assert.equal(stdout.includes("BG_SDK_BUILD_REACHED"), shouldBuild, name);
    assert.equal(stderr.trim(), "", name);
    console.log(`SDK_GATE_PASS ${name}`);
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
