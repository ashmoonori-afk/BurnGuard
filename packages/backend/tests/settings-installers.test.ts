import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const roots: string[] = [];
const services = path.resolve(import.meta.dir, "../src/services");

afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

// Bun.which reads the PATH a process started with, so each case runs in a child whose PATH holds only its fixture directory.
async function inIsolatedChild(body: string, python?: string): Promise<unknown> {
  const root = await mkdtemp(path.join(tmpdir(), "bg-installer-start-"));
  roots.push(root);
  if (python !== undefined) { await writeFile(path.join(root, "python3"), python); await chmod(path.join(root, "python3"), 0o700); }
  const worker = path.join(root, "request.ts");
  await writeFile(worker, `
import { rmSync } from "node:fs";
import { settingsRoutes } from ${JSON.stringify(path.resolve(import.meta.dir, "../src/routes/settings.ts"))};
import { chromiumNodeCommand } from ${JSON.stringify(path.join(services, "chromium-node-launch.ts"))};
import { getPlaywrightInstallStatus, startPlaywrightInstall } from ${JSON.stringify(path.join(services, "playwright-install.ts"))};
import { checkPythonRuntime, getPypdfInstallStatus } from ${JSON.stringify(path.join(services, "python-health.ts"))};
// Precondition: the real installers can never start a download from these cases.
if (chromiumNodeCommand() !== null) throw new Error("node_runtime_present");
const fixture = ${JSON.stringify(path.join(root, "python3"))};
${body}
`);
  const child = Bun.spawn([process.execPath, worker], { env: { ...process.env, PATH: root, BG_APP_ROOT: path.join(root, "app") }, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 20_000 });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
  return JSON.parse(stdout);
}

describe("installer start failures", () => {
  test("Given the installer command cannot be built When a Chromium install is started Then it reports spawn_failed and the status is error", async () => {
    const result = await inIsolatedChild(`const started = startPlaywrightInstall(() => { throw new Error("unavailable"); });
console.log(JSON.stringify({ started, state: getPlaywrightInstallStatus().state }));`);

    expect(result).toEqual({ started: { started: false, reason: "spawn_failed" }, state: "error" });
  });

  test("Given no Node runtime When a Chromium install is requested Then the route answers install_start_failed instead of install_in_progress", async () => {
    const result = await inIsolatedChild(`const response = await settingsRoutes.request("http://local/api/settings/playwright/install", { method: "POST" });
console.log(JSON.stringify({ status: response.status, code: (await response.json()).error?.code, state: getPlaywrightInstallStatus().state }));`);

    expect(result).toEqual({ status: 500, code: "install_start_failed", state: "error" });
  });

  // The fixture interpreter is a POSIX executable script, not a Windows .exe.
  test.skipIf(process.platform === "win32")("Given the probed Python disappears When a pypdf install is requested Then the route answers install_start_failed instead of install_in_progress", async () => {
    const result = await inIsolatedChild(`const probed = (await checkPythonRuntime()).python.executable;
rmSync(fixture);
const response = await settingsRoutes.request("http://local/api/settings/python/install", { method: "POST" });
console.log(JSON.stringify({ probed, status: response.status, code: (await response.json()).error?.code, state: getPypdfInstallStatus().state }));`, `#!${process.execPath}\nif (process.argv[2] === "--version") console.log("Python 3.14.4"); else process.exit(1);\n`);

    expect(result).toEqual({ probed: ["python3"], status: 500, code: "install_start_failed", state: "error" });
  });
});
