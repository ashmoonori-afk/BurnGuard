import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeOwnedProcessTree } from "../src/adapters/owned-process-tree";
import { spawnLaunchProbe } from "../src/services/chromium-capability";
import { chromiumNodeCommand, launchChromiumViaNode } from "../src/services/chromium-node-launch";
import { activeExportBrowserCount } from "../src/services/export-browser-registry";

for (const kind of ["bridge", "probe"] as const) {
  test(`Given an owned Node ${kind} with a child that ignores graceful shutdown When the deadline expires Then both exact processes are terminated`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bg-chromium-tree-"));
    const receipt = path.join(root, "owned-pids.json");
    const script = path.join(root, "stalled.mjs");
    const node = chromiumNodeCommand()?.node;
    if (node === undefined) throw new Error("Node runtime unavailable");
    await writeFile(script, `import {spawn} from "node:child_process";
      import {writeFileSync} from "node:fs";
      const child=spawn(process.execPath,["-e",'process.send("ready");setInterval(()=>{},1000)'],{stdio:["ignore","ignore","ignore","ipc"]});
      child.once("message",()=>{writeFileSync(${JSON.stringify(receipt)},JSON.stringify({parent:process.pid,child:child.pid}));process.stdout.write("invalid bridge response\\n");});
      process.stdin.resume();setInterval(()=>{},1000);`);
    const command = { node, script, cwd: root };
    try {
      if (kind === "bridge") await expect(launchChromiumViaNode({}, AbortSignal.timeout(15000), command)).rejects.toThrow();
      else expect(await spawnLaunchProbe(command, 5000)).toBe(false);
      const ids = JSON.parse(await readFile(receipt, "utf8")) as { parent: number; child: number };
      expect(present(ids.parent)).toBe(false);
      expect(present(ids.child)).toBe(false);
      expect(activeExportBrowserCount()).toBe(0);
    } finally {
      const receiptBytes = await readFile(receipt, "utf8").catch(() => null);
      if (receiptBytes !== null) {
        const ids = JSON.parse(receiptBytes) as { parent: number; child: number };
        if (present(ids.parent)) await closeOwnedProcessTree(ids.parent);
        if (present(ids.child)) process.kill(ids.child);
      }
      await rm(root, { recursive: true, force: true });
    }
  }, 25000);
}

function present(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { if (error instanceof Error && "code" in error && error.code === "ESRCH") return false; throw error; } }
