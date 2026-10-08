import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

assert.equal(process.platform, "win32", "This check requires native Windows cmd.exe");
const systemRoot = process.env.SystemRoot;
assert.ok(systemRoot, "Windows must provide SystemRoot");
const system32 = path.join(systemRoot, "System32");
const root = await mkdtemp(path.join(tmpdir(), "bg-launcher-sdk-"));

try {
  for (const { name, sdks, shouldBuild } of [
    { name: "missing", sdks: null, shouldBuild: false },
    { name: "runtime-only", sdks: "", shouldBuild: false },
    { name: "other-sdk", sdks: "9.0.100 [C:\\fixture\\sdk]", shouldBuild: false },
    { name: "sdk-8", sdks: "8.0.100 [C:\\fixture\\sdk]", shouldBuild: true },
  ]) {
    const directory = path.join(root, name);
    const bin = path.join(directory, "bin");
    await mkdir(bin, { recursive: true });
    await copyFile(path.join(import.meta.dirname, "../../Start-BurnGuard.bat"), path.join(directory, "Start-BurnGuard.bat"));
    await writeFile(path.join(bin, "bun.cmd"), "@echo BG_SDK_BUILD_REACHED\r\n@exit /b 1\r\n");
    if (sdks !== null) {
      await writeFile(path.join(bin, "dotnet.cmd"), `@echo off\r\n${sdks === "" ? "" : `echo ${sdks}\r\n`}exit /b 0\r\n`);
    }
    // Let cmd set its case-insensitive PATH, and use its own command quoting
    // rather than the C-runtime argument quoting used by spawn by default.
    const launcher = path.join(directory, "Start-BurnGuard.bat");
    const command = `"set "PATH=${bin};${system32}" && call "${launcher}" --build"`;
    const child = spawn(path.join(system32, "cmd.exe"), ["/d", "/s", "/c", command], {
      cwd: directory,
      windowsVerbatimArguments: true,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", text => { stdout += text; });
    child.stderr.setEncoding("utf8").on("data", text => { stderr += text; });
    const closed = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    child.stdin.end("\r\n");
    const code = await closed;
    // The fixture stops at the first build command, so no package or app is built.
    assert.equal(code, 1, `${name}: ${stdout}\n${stderr}`);
    assert.equal(stdout.includes("BG_SDK_BUILD_REACHED"), shouldBuild, name);
    assert.equal(stderr.trim(), "", name);
    console.log(`SDK_GATE_PASS ${name}`);
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
