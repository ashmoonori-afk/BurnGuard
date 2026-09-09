import { expect, test } from "bun:test";
import path from "node:path";
import { pathToFileURL } from "node:url";

test("Given BG_PORT When Vite config loads Then IPv4 and both proxies match the launcher", async () => {
  const configUrl = pathToFileURL(
    path.join(import.meta.dir, "../vite.config.ts"),
  ).href;
  const child = Bun.spawn([
    "bun",
    "-e",
    `import config from ${JSON.stringify(configUrl)}; console.log(JSON.stringify(config.server));`,
  ], {
    env: {
      ...process.env,
      BG_PORT: "15070",
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

  expect(exitCode, stderr).toBe(0);
  const server = JSON.parse(stdout);
  expect(server.host).toBe("127.0.0.1");
  expect(server.proxy["/api"].target).toBe("http://127.0.0.1:15070");
  expect(server.proxy["/runtime"].target).toBe("http://127.0.0.1:15070");
});
