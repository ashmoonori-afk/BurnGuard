import type { MessageKey } from "@/i18n/messages";

export type ToolBadgeState = "running" | "finished" | "error";

const TOOL_NAME_KEYS: Readonly<Record<string, MessageKey>> = {
  command_execution: "chat.tool.command",
  Bash: "chat.tool.command",
  file_change: "chat.tool.fileChange",
  Write: "chat.tool.fileChange",
  Edit: "chat.tool.fileChange",
  MultiEdit: "chat.tool.fileChange",
  NotebookEdit: "chat.tool.fileChange",
  Read: "chat.tool.fileRead",
  Glob: "chat.tool.fileSearch",
  Grep: "chat.tool.fileSearch",
  web_search: "chat.tool.webSearch",
  WebSearch: "chat.tool.webSearch",
  WebFetch: "chat.tool.webFetch",
  mcp_tool_call: "chat.tool.mcpCall",
  custom_tool_call: "chat.tool.customCall",
  image_generation: "chat.tool.imageGeneration",
  image_generation_call: "chat.tool.imageGeneration",
  Agent: "chat.tool.agent",
  Task: "chat.tool.agent",
  TodoWrite: "chat.tool.taskPlan",
  generation_resume_stalled: "chat.tool.resumeStalled",
  generation_resume_incomplete: "chat.tool.resumeIncomplete",
  generation_tool_failed: "chat.tool.providerFailed",
  generation_save: "chat.tool.saveArtifact",
  generation_phase_plan: "chat.tool.phasePlan",
  generation_design_review: "chat.tool.designReview",
  generation_phase_content: "chat.tool.phaseContent",
  generation_deck_review: "chat.tool.deckReview",
  generation_logo_repair: "chat.tool.logoRepair",
  project_import_init: "chat.tool.importInit",
  // Legacy literal names remain in persisted session events.
  "덱 문안·글꼴·이미지·크기 점검": "chat.tool.deckReview",
  "프로젝트 자동 초기화": "chat.tool.importInit",
};

const TOOL_STATE_KEYS = {
  running: "chat.tool.running",
  finished: "chat.tool.finished",
  error: "chat.tool.error",
} as const satisfies Record<ToolBadgeState, MessageKey>;

export function toolBadgeCopy(tool: string, state: ToolBadgeState): {
  readonly nameKey: MessageKey;
  readonly stateKey: MessageKey;
} {
  const nameKey = Object.hasOwn(TOOL_NAME_KEYS, tool)
    ? TOOL_NAME_KEYS[tool]
    : tool.startsWith("mcp__") ? "chat.tool.mcpCall" : "chat.tool.activity";
  return {
    nameKey,
    stateKey: tool === "generation_design_review" && state === "error"
      ? "chat.tool.reviewIncomplete"
      : TOOL_STATE_KEYS[state],
  };
}
