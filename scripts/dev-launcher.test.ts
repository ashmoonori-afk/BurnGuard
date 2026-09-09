import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");

test("Given BurnGuard already owns the backend port When launcher preflights Then it identifies BurnGuard", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 14070,
    fetch(request) {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/api/health") {
        return Response.json({
          ok: true,
          name: "BurnGuard Design",
          version: "0.4.0",
        });
      }
      return Response.json(
        { error: { code: "forbidden", message: "Request authority rejected." } },
        { status: 403 },
      );
    },
  });
  try {
    const child = Bun.spawn(["bun", "run", "scripts/dev-launcher.ts"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        BG_LAUNCHER_NO_OPEN: "1",
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    expect(exitCode).toBe(1);
    expect(`${stdout}\n${stderr}`).toContain(
      "BurnGuard backend is already running on 14070.",
    );
  } finally {
    await server.stop(true);
  }
});

test("Given BG_PORT When launcher starts Then preflight and backend use that port", async () => {
  const occupiedDefault = Bun.serve({
    hostname: "127.0.0.1",
    port: 14070,
    fetch: () => new Response("other", { status: 503 }),
  });
  const home = await mkdtemp(path.join(tmpdir(), "burnguard-launcher-port-"));
  let child: ReturnType<typeof Bun.spawn> | null = null;
  try {
    child = Bun.spawn(["bun", "run", "scripts/dev-launcher.ts"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        BG_PORT: "15070",
        BG_LAUNCHER_NO_OPEN: "1",
        HOME: home,
        USERPROFILE: home,
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(
      await outputIncludes(
        child.stdout,
        "[launcher] waiting for backend on 15070...",
        child.exited,
      ),
    ).toBe(true);
  } finally {
    if (child?.exitCode === null) child.kill("SIGTERM");
    if (child !== null) await child.exited;
    await occupiedDefault.stop(true);
    await rm(home, { recursive: true, force: true });
  }
});

test("Given scan mode without BG_PORT When launcher starts Then it rejects the ambiguous proxy target", async () => {
  const occupiedDefault = Bun.serve({
    hostname: "127.0.0.1",
    port: 14070,
    fetch: () => new Response("other", { status: 503 }),
  });
  try {
    const child = Bun.spawn(["bun", "run", "scripts/dev-launcher.ts"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        BG_SCAN_PORT: "1",
        BG_LAUNCHER_NO_OPEN: "1",
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    expect(exitCode).toBe(1);
    expect(`${stdout}\n${stderr}`).toContain(
      "BG_SCAN_PORT=1 requires BG_PORT when using the launcher.",
    );
  } finally {
    await occupiedDefault.stop(true);
  }
});

async function outputIncludes(
  stream: ReadableStream<Uint8Array>,
  needle: string,
  exited: Promise<number>,
): Promise<boolean> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), 10_000);
  });
  const match = (async () => {
    while (true) {
      const next = await reader.read();
      if (next.done) return false;
      output += decoder.decode(next.value, { stream: true });
      if (output.includes(needle)) return true;
    }
  })();
  try {
    return await Promise.race([
      match,
      exited.then(() => false),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    await reader.cancel();
  }
}
