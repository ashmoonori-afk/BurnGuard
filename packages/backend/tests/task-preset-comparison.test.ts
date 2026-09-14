import { expect, test } from "bun:test";
import type { GenerationOptions } from "@bg/shared";
import { appendModelPromptContext } from "../src/harness/prompt-model-context";
import { parseArgs } from "../../../scripts/qa/task-preset-comparison";
import { CONDITION_IDS, POST_REASONING_BLOCK, planCondition } from "../../../scripts/qa/task-preset-conditions";
import { appendModelPromptContext as appendBaseline } from "./fixtures/task-preset-baseline-model-context";

const options = (effort: GenerationOptions["effort"]): GenerationOptions =>
  ({ model: "gpt-5.6-luna", effort, provider: "native", vanilla: false });

const assemble = (id: (typeof CONDITION_IDS)[number]) => {
  const plan = planCondition(id);
  const lines: string[] = [];
  const observation = appendModelPromptContext(lines, "codex", options(plan.effort), "prototype", plan.guidance);
  return { text: lines.join("\n"), observation, plan };
};

test("Given each comparison arm When assembled Then the arms are actually distinguishable", () => {
  const cleanup = assemble("cleanup-low");
  const task = assemble("task-low");
  const post = assemble("post-low");
  const high = assemble("same-model-high");

  // Cleanup keeps the legacy envelope and carries no task guidance at all.
  expect(cleanup.text).toContain("<burnguard-model-guidance-v1>");
  expect(cleanup.text).not.toContain("<burnguard-task-guidance-v1>");
  expect(cleanup.observation).toBeNull();

  // Task adds the envelope; post is task plus exactly the experimental block.
  expect(task.text).toContain("<burnguard-task-guidance-v1>");
  expect(task.text).not.toContain(POST_REASONING_BLOCK);
  expect(post.text).toContain("<burnguard-task-guidance-v1>");
  expect(post.text).toContain(POST_REASONING_BLOCK);

  // The HIGH reference differs from task-low only by effort, so their guidance hashes differ.
  expect(high.observation?.effort).toBe("high");
  expect(task.observation?.effort).toBe("low");
  expect(high.observation?.block_sha256).not.toBe(task.observation?.block_sha256);
});

test("Given a post block outside the post arm When assembling Then it is refused", () => {
  expect(() => appendModelPromptContext([], "codex", options("low"), "prototype", { mode: "task", postBlock: "x" }))
    .toThrow("post_block_not_permitted");
  expect(() => appendModelPromptContext([], "codex", options("low"), "prototype", { mode: "post" }))
    .toThrow("post_block_required");
});

test("Given CLI arguments When parsed Then unsupported combinations are refused before anything runs", () => {
  expect(parseArgs(["--mode", "compare", "--condition", "task-low"])).toMatchObject({ ok: true });
  // compare with no explicit condition plans every arm
  const all = parseArgs(["--mode", "compare"]);
  expect(all.ok && all.args.conditions.length).toBe(CONDITION_IDS.length);

  for (const argv of [
    [] as string[],
    ["--mode", "nonsense"],
    ["--mode", "compare", "--condition", "made-up"],
    ["--mode", "compare", "--condition", "task-low", "--condition", "task-low"],
    ["--mode", "examples", "--condition", "task-low"],
    ["--mode"],
    ["--oops", "value"],
  ]) {
    expect(parseArgs(argv).ok).toBe(false);
  }
});

test("Given cleanup LOW When assembled on each route Then archived model guidance remains byte-identical", () => {
  for (const backend of ["codex", "claude-code"] as const) {
    for (const model of backend === "codex" ? ["gpt-5.6-luna"] : ["sonnet", "opus", "claude-opus-4-6"]) {
      for (const provider of backend === "codex" ? ["native"] as const : ["native", "commandcode"] as const) {
        const generation = { ...options("low"), model, provider };
        const baseline: string[] = [];
        const cleanup: string[] = [];
        appendBaseline(baseline, backend, generation);
        appendModelPromptContext(cleanup, backend, generation, "prototype", { mode: "cleanup" });
        expect(cleanup).toEqual(baseline);
      }
    }
  }
});

test("Given the real planner CLI When invoked Then planning never reports collected artifacts", () => {
  const cases = [
    { gate: "0", args: ["--mode", "compare"], status: "skipped", exit: 0 },
    { gate: "1", args: ["--mode", "examples"], status: "blocked", exit: 2 },
    { gate: "1", args: ["--mode", "compare"], status: "blocked", exit: 2 },
    { gate: "1", args: ["--mode", "compare", "--condition", "task-low", "--condition", "post-low"], status: "planned", exit: 0 },
  ];
  for (const item of cases) {
    const child = Bun.spawnSync([process.execPath, "scripts/qa/task-preset-comparison.ts", ...item.args], {
      env: { ...process.env, BG_TASK_PRESET_SMOKE: item.gate }, stdout: "pipe", stderr: "pipe", timeout: 10000,
    });
    expect(child.exitCode).toBe(item.exit);
    const result = JSON.parse(child.stdout.toString());
    expect(result.status).toBe(item.status);
    expect(result.status).not.toBe("collected");
    if (item.status === "planned") {
      expect(result.execution_status).toBe("not_run");
      expect(result.conditions.map((condition: { id: string }) => condition.id)).toEqual(["task-low", "post-low"]);
    }
  }
});

test("Given the original arm When planned Then it declares its recovered-source dependency", () => {
  // The pre-P0 assembly cannot be rebuilt from current sources, so this arm must block rather than
  // let the cleanup prompt be reported under the original label.
  expect(planCondition("original-low").requiresArchive).toBe(true);
  expect(planCondition("cleanup-low").requiresArchive).toBeUndefined();
});
