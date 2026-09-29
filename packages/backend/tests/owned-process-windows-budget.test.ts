import { expect, test } from "bun:test";
import { closeOwnedProcess, spawnOwnedProcess } from "../src/adapters/owned-process";

async function cycle(timeoutMs: number): Promise<{ ms: number; outcome: "ok" | "fail"; reason: string | null }> {
  const owned = spawnOwnedProcess({ cmd: [process.execPath, "-e", "setInterval(() => {}, 1000)"], stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  const started = performance.now();
  let outcome: "ok" | "fail" = "ok";
  let reason: string | null = null;
  try { await closeOwnedProcess(owned, { timeoutMs }); } catch (error) { outcome = "fail"; reason = String((error as { reason?: string }).reason ?? error); }
  const ms = Math.round(performance.now() - started);
  await owned.proc.exited.catch(() => undefined);
  return { ms, outcome, reason };
}

test.skipIf(process.platform !== "win32")("Given repeated launches, then closing an owned job within 3 s and within 10 s reports its timing and reason", async () => {
  const rows: { budget: number; ms: number; outcome: string; reason: string | null }[] = [];
  for (const budget of [3_000, 10_000]) for (let run = 0; run < 12; run += 1) rows.push({ budget, ...(await cycle(budget)) });
  console.log("BUDGET_DIAG " + JSON.stringify(rows));
  expect(rows.length).toBe(24);
}, 240_000);
