import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { parse } from "node-html-parser";
import type { NormalizedEvent } from "@bg/shared";
import { needsGenerationPhases, runGenerationPhases } from "../src/services/turn-phases";

test("Given a five-unit deck and a failed final batch, then phases run sequentially and only that batch resumes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-phases-"));
  const events: NormalizedEvent[] = [];
  const calls: number[] = [];
  let retried = false;
  try {
    const result = await runGenerationPhases({ sessionId: "s", turnId: "t", projectDir: dir, binaryPath: "fixture", prompt: "Create 5 slides", userEvent: { type: "user.message", text: "Create 5 slides" }, onEvent: async e => { events.push(e); } }, "deck.html", async input => {
      const phase = events.filter(e => e.type === "tool.started" && e.tool.startsWith("generation_phase_")).at(-1);
      if (phase?.type !== "tool.started") throw new Error("missing phase");
      const progress = phase.input as { from: number; to: number; total: number };
      calls.push(progress.from);
      expect(events.filter(e => e.type === "status.idle")).toHaveLength(0);
      if (phase.tool === "generation_phase_plan") {
        const plan = input.prompt.match(/\.burnguard-inputs\/phases-[A-Z0-9]+\/plan\.json/)![0];
        await writeFile(path.join(dir, plan), JSON.stringify({ units: ["A", "B", "C", "D", "E"] }));
        await writeFile(path.join(dir, "deck.html"), Array.from({ length: 5 }, (_, i) => `<section data-slide data-bg-unit="${i + 1}">Pending</section>`).join(""));
      } else {
        const root = parse(await readFile(path.join(dir, "deck.html"), "utf8"));
        if (progress.from === 5) {
          expect(root.querySelectorAll('[data-bg-complete="true"]')).toHaveLength(4);
          if (!retried) { retried = true; await writeFile(path.join(dir, "image.png"), "keep"); return { exitCode: 1 }; }
          expect(await readFile(path.join(dir, "image.png"), "utf8")).toBe("keep");
        }
        for (let i = progress.from; i <= progress.to; i++) root.querySelector(`[data-bg-unit="${i}"]`)!.setAttribute("data-bg-complete", "true");
        await writeFile(path.join(dir, "deck.html"), root.toString());
      }
      return { exitCode: 0 };
    });
    expect(result.exitCode).toBe(0);
    expect(calls).toEqual([0, 1, 5, 5]);
    expect(events.filter(e => e.type === "status.idle")).toHaveLength(1);
    expect(parse(await readFile(path.join(dir, "deck.html"), "utf8")).querySelectorAll('[data-bg-complete="true"]')).toHaveLength(5);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Given an invalid plan, then the server bounds retries and never starts content phases", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-phase-limit-"));
  let calls = 0;
  try {
    const result = await runGenerationPhases({ sessionId: "s", turnId: "t", projectDir: dir, binaryPath: "fixture", prompt: "task", userEvent: { type: "user.message", text: "task" }, onEvent: async () => {} }, "deck.html", async input => {
      calls++;
      const plan = input.prompt.match(/\.burnguard-inputs\/phases-[A-Z0-9]+\/plan\.json/)![0];
      await writeFile(path.join(dir, plan), JSON.stringify({ units: Array(81).fill("slide") }));
      return { exitCode: 0 };
    });
    expect(calls).toBe(3);
    expect(result.exitCode).toBe(1);
  } finally { await rm(dir, { recursive: true, force: true }); }
  expect(needsGenerationPhases("slide_deck", "소개서", true)).toBe(true);
  expect(needsGenerationPhases("slide_deck", "제목만 수정", false)).toBe(false);
  expect(needsGenerationPhases("prototype", "여러 페이지로 만들어")).toBe(true);
  expect(needsGenerationPhases("prototype", "제목만 수정")).toBe(false);
});
