import type { BackendId, GenerationOptions } from "@bg/shared";

export function appendModelPromptContext(lines: string[], backendId?: BackendId, generation?: GenerationOptions): void {
  if (!backendId || !generation) return;
  const claude = generation.provider === "commandcode" || backendId === "claude-code";
  const profile = claude
    ? /(?:^|[-/])opus(?:[-/]|$)/i.test(generation.model) ? "claude-opus" : "claude"
    : "codex";
  lines.push('<burnguard-model-guidance-v1>');
  lines.push(JSON.stringify({ schema_version: 1, profile, model: generation.model, provider: generation.provider, effort: generation.effort }));
  lines.push("</burnguard-model-guidance-v1>");
  lines.push("## Execution focus");
  lines.push(claude
    ? "- Work through the artifact in this order: inspect the relevant markup and tokens, apply the requested change, then check the changed result against the delivery rules."
    : "- Target the requested artifact and its acceptance conditions directly. Use the existing structure to choose the smallest complete edit, then verify the result.");
  if (profile === "claude-opus") lines.push("- Settle layout decisions using the selected direction and existing artifact; explore alternatives only when the user requests alternatives.");
  lines.push("- These execution hints do not override the user's requested content, visual direction, or the output-directory and attachment restrictions.");
  lines.push("");
}
