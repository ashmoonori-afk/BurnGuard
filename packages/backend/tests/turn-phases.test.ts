import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { parse } from "node-html-parser";
import type { NormalizedEvent } from "@bg/shared";
import { needsGenerationPhases, runGenerationPhases } from "../src/services/turn-phases";

test("Given two authoritative source pages When the planner invents a third slide Then content generation is blocked", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-phase-source-count-"));
  let contentCalls = 0;
  let planning = true;
  try {
    const result = await runGenerationPhases({
      sessionId: "s", turnId: "t", projectDir: dir, binaryPath: "fixture",
      prompt: "Keep source pages one-to-one",
      userEvent: { type: "user.message", text: "Keep source pages one-to-one" },
      onEvent: async event => {
        if (event.type === "tool.started" && event.tool.startsWith("generation_phase_")) planning = event.tool === "generation_phase_plan";
      },
    }, "deck.html", async input => {
      if (!planning) { contentCalls++; return { exitCode: 1 }; }
      const plan = input.prompt.match(/\.burnguard-inputs\/phases-[A-Z0-9]+\/plan\.json/)?.[0];
      if (!plan) throw new Error("missing plan path");
      await writeFile(path.join(dir, plan), JSON.stringify({ units: ["One", "Two", "Invented split"] }));
      await writeFile(path.join(dir, "deck.html"), [1, 2, 3].map(unit =>
        `<section class="deck-slide" data-slide data-bg-unit="${unit}" data-bg-source-attachment="source" data-bg-source-page="${unit}">Pending</section>`
      ).join("") + '<script src="runtime/deck-stage.js"></script>');
      return { exitCode: 0 };
    }, "slide_deck", [{ attachmentId: "source", page: 1 }, { attachmentId: "source", page: 2 }]);
    expect(contentCalls).toBe(0);
    expect(result.exitCode).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Given a plan with reversed slide order When validating the scaffold Then content generation never starts", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-phase-order-"));
  let plans = 0;
  let contentCalls = 0;
  let currentPhase = "";
  try {
    const result = await runGenerationPhases({
      sessionId: "s", turnId: "t", projectDir: dir, binaryPath: "fixture",
      prompt: "Create two slides in source order",
      userEvent: { type: "user.message", text: "Create two slides in source order" },
      onEvent: async event => {
        if (event.type === "tool.started" && event.tool.startsWith("generation_phase_")) currentPhase = event.tool;
      },
    }, "deck.html", async input => {
      if (currentPhase !== "generation_phase_plan") {
        contentCalls++;
        return { exitCode: 1 };
      }
      plans++;
      const plan = input.prompt.match(/\.burnguard-inputs\/phases-[A-Z0-9]+\/plan\.json/)?.[0];
      if (!plan) throw new Error("missing plan path");
      await writeFile(path.join(dir, plan), JSON.stringify({ units: ["First source page", "Second source page"] }));
      await writeFile(path.join(dir, "deck.html"), [2, 1].map(unit =>
        `<section class="deck-slide" data-slide data-bg-unit="${unit}" data-bg-placeholder>Pending</section>`
      ).join("") + '<script src="runtime/deck-stage.js"></script>');
      return { exitCode: 0 };
    }, "slide_deck");
    expect(contentCalls).toBe(0);
    expect(plans).toBe(3);
    expect(result.exitCode).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

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
        await writeFile(path.join(dir, "deck.html"), Array.from({ length: 5 }, (_, i) => `<section class="deck-slide" data-slide data-bg-unit="${i + 1}">Pending</section>`).join("") + '<script src="runtime/deck-stage.js"></script>');
      } else {
        const root = parse(await readFile(path.join(dir, "deck.html"), "utf8"));
        if (progress.from === 5) {
          expect(root.querySelectorAll('[data-bg-complete="true"]')).toHaveLength(4);
          if (!retried) { retried = true; await writeFile(path.join(dir, "image.png"), "keep"); return { exitCode: 1 }; }
          expect(await readFile(path.join(dir, "image.png"), "utf8")).toBe("keep");
        }
        for (let i = progress.from; i <= progress.to; i++) {
          const node = root.querySelector(`[data-bg-unit="${i}"]`)!;
          node.setAttribute("data-bg-complete", "true");
          node.set_content(`<h1>Completed content ${i}</h1>`);
        }
        await writeFile(path.join(dir, "deck.html"), root.toString());
      }
      return { exitCode: 0 };
    }, "slide_deck");
    expect(result.exitCode).toBe(0);
    expect(calls).toEqual([0, 1, 5, 5]);
    expect(events.filter(e => e.type === "status.idle")).toHaveLength(1);
    expect(parse(await readFile(path.join(dir, "deck.html"), "utf8")).querySelectorAll('[data-bg-complete="true"]')).toHaveLength(5);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("Given a plan saved with a UTF-8 BOM and CRLF When the plan phase checks it Then content phases start", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-phase-bom-"));
  let planCalls = 0;
  let contentCalls = 0;
  let currentPhase = "";
  try {
    const result = await runGenerationPhases({ sessionId: "s", turnId: "t", projectDir: dir, binaryPath: "fixture", prompt: "Create 1 slide", userEvent: { type: "user.message", text: "Create 1 slide" }, onEvent: async event => {
      if (event.type === "tool.started" && event.tool.startsWith("generation_phase_")) currentPhase = event.tool;
    } }, "deck.html", async input => {
      const file = path.join(dir, "deck.html");
      if (currentPhase === "generation_phase_plan") {
        planCalls++;
        const plan = input.prompt.match(/\.burnguard-inputs\/phases-[A-Z0-9]+\/plan\.json/)![0];
        await writeFile(path.join(dir, plan), `\uFEFF${JSON.stringify({ units: ["Overview"] })}\r\n`);
        expect([...(await readFile(path.join(dir, plan))).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
        await writeFile(file, '<section class="deck-slide" data-slide data-bg-unit="1" data-bg-placeholder>Pending</section><script src="/runtime/deck-stage.js"></script>');
      } else {
        contentCalls++;
        await writeFile(file, '<section class="deck-slide" data-slide data-bg-unit="1" data-bg-complete="true"><h1>Our product overview</h1></section><script src="/runtime/deck-stage.js"></script>');
      }
      return { exitCode: 0 };
    }, "slide_deck");
    expect(result.exitCode).toBe(0);
    expect(planCalls).toBe(1);
    expect(contentCalls).toBe(1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test.each([
  ["the refreshed relative path", () => "../runtime/deck-stage.js"],
  ["the runtime path named by the phase prompt", (prompt: string) => /<generation_phase>[\s\S]*?<script src="([^"]+)"/.exec(prompt)?.[1] ?? "missing"],
] as const)("Given a deck entrypoint in a subfolder When the model writes %s Then the phases complete", async (_label, runtimeSrc) => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-phase-subfolder-"));
  let currentPhase = "";
  try {
    await mkdir(path.join(dir, "slides"));
    const result = await runGenerationPhases({ sessionId: "s", turnId: "t", projectDir: dir, binaryPath: "fixture", prompt: "Create 1 slide", userEvent: { type: "user.message", text: "Create 1 slide" }, onEvent: async event => {
      if (event.type === "tool.started" && event.tool.startsWith("generation_phase_")) currentPhase = event.tool;
    } }, "slides/deck.html", async input => {
      const runtime = `<script src="${runtimeSrc(input.prompt)}" defer></script>`;
      const file = path.join(dir, "slides", "deck.html");
      if (currentPhase === "generation_phase_plan") {
        const plan = input.prompt.match(/\.burnguard-inputs\/phases-[A-Z0-9]+\/plan\.json/)![0];
        await writeFile(path.join(dir, plan), JSON.stringify({ units: ["Overview"] }));
        await writeFile(file, `<section class="deck-slide" data-slide data-bg-unit="1" data-bg-placeholder>Pending</section>${runtime}`);
      } else await writeFile(file, `<section class="deck-slide" data-slide data-bg-unit="1" data-bg-complete="true"><h1>Our product overview</h1></section>${runtime}`);
      return { exitCode: 0 };
    }, "slide_deck");
    expect(result.exitCode).toBe(0);
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

test.each([
  ["slide_deck", "3페이지 제목만 수정해줘", false, false],
  ["slide_deck", "2장 슬라이드 오타 고쳐줘", false, false],
  ["slide_deck", "fix the typo on 2 slides", false, false],
  ["prototype", "대형 폰트로 바꿔줘", false, false],
  ["logo", "대형 병원 로고 만들어줘", false, false],
  ["logo", "Create a large multi-page logo set", true, false],
  ["slide_deck", "10페이지짜리 덱 만들어줘", false, true],
  ["prototype", "여러 페이지로 만들어", false, true],
  ["slide_deck", "Create a large slide deck", false, true],
  ["prototype", "Create 29 slides", false, true],
  ["slide_deck", "소개서", true, true],
  ["slide_deck", "제목만 수정", true, true],
  ["prototype", "전체 다시 구성해줘", false, true],
  ["prototype", "Please rebuild the site", false, true],
  ["slide_deck", "3페이지에 표 만들어줘", false, false],
  ["slide_deck", "3페이지 배경을 파란색으로 만들어줘", false, false],
  ["slide_deck", "2장 슬라이드에 이미지 생성해줘", false, false],
  ["slide_deck", "Make the titles on the last 2 slides shorter", false, false],
  ["prototype", "Make the hero text large", false, false],
  ["prototype", "대형 배너로 만들어줘", false, false],
  ["prototype", "Make page 2 hero larger", false, false],
  ["slide_deck", "20장의 슬라이드를 만들어줘", false, true],
  ["slide_deck", "5장 슬라이드 만들어줘", false, true],
  ["slide_deck", "10페이지로 만들어줘", false, true],
  ["slide_deck", "Make a 10-slide deck", false, true],
  ["slide_deck", "Create a deck in 10 slides", false, true],
  ["prototype", "전체 톤을 다시 봐줘", false, false],
  ["prototype", "전체적으로 다시 확인해줘", false, false],
  ["prototype", "전체 색상 다시 검토해줘", false, false],
  ["slide_deck", "전체 슬라이드의 제목 크기를 키워줘", false, false],
  ["prototype", "update the whole hero copy", false, false],
  ["prototype", "Could you rebuild the trust I had in this hero image", false, false],
  ["prototype", "전체를 다시 만들어줘", false, true],
  ["slide_deck", "전체 슬라이드를 다시 작성해줘", false, true],
  ["slide_deck", "Regenerate the whole deck", false, true],
] as const)("Given a %s request %p (starter=%p) When deciding phases Then phased generation is %p", (projectType, request, starter, expected) => {
  expect(needsGenerationPhases(projectType, request, starter)).toBe(expected);
});

test("Given malformed slides and falsely completed placeholders, then neither can advance the phase", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bg-phase-content-"));
  const events: NormalizedEvent[] = [];
  let plans = 0;
  let batches = 0;
  try {
    const result = await runGenerationPhases({ sessionId: "s", turnId: "t", projectDir: dir, binaryPath: "fixture", prompt: "deck", userEvent: { type: "user.message", text: "deck" }, onEvent: async event => { events.push(event); } }, "deck.html", async input => {
      const phase = events.filter(event => event.type === "tool.started" && event.tool.startsWith("generation_phase_")).at(-1);
      if (phase?.type !== "tool.started") throw new Error("missing phase");
      const file = path.join(dir, "deck.html");
      if (phase.tool === "generation_phase_plan") {
        plans++;
        const plan = input.prompt.match(/\.burnguard-inputs\/phases-[A-Z0-9]+\/plan\.json/)![0];
        await writeFile(path.join(dir, plan), JSON.stringify({ units: ["Overview"] }));
        await writeFile(file, `<section ${plans === 1 ? "" : 'class="deck-slide"'} data-slide data-bg-unit="1">1 / 1</section><script src="runtime/deck-stage.js"></script>`);
      } else {
        batches++;
        const root = parse(await readFile(file, "utf8"));
        const node = root.querySelector("[data-bg-unit]")!;
        node.setAttribute("data-bg-complete", "true");
        if (batches > 1) node.set_content("<h1>Our product overview</h1>");
        await writeFile(file, root.toString());
      }
      return { exitCode: 0 };
    }, "slide_deck");
    expect(result.exitCode).toBe(0);
    expect(plans).toBe(2);
    expect(batches).toBe(2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
