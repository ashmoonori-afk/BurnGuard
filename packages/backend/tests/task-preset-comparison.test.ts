import { expect, test } from "bun:test";
import type { GenerationOptions } from "@bg/shared";
import { appendModelPromptContext } from "../src/harness/prompt-model-context";
import { parseArgs } from "../../../scripts/qa/task-preset-comparison";
import { CONDITION_IDS, POST_REASONING_BLOCK, planCondition } from "../../../scripts/qa/task-preset-conditions";

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
  // compare with no explicit condition collects every arm
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

test("Given the original arm When planned Then it declares its recovered-source dependency", () => {
  // The pre-P0 assembly cannot be rebuilt from current sources, so this arm must block rather than
  // let the cleanup prompt be reported under the original label.
  expect(planCondition("original-low").requiresArchive).toBe(true);
  expect(planCondition("cleanup-low").requiresArchive).toBeUndefined();
});
