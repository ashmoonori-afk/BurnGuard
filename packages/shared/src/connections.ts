/** Configuration only: these IDs are not generation backends or providers. */
export const LLM_CONNECTIONS = [
  { id: "gemini", display_name: "Gemini", generation_status: "not_implemented" },
  { id: "deepseek", display_name: "DeepSeek", generation_status: "not_implemented" },
  { id: "xai", display_name: "Grok", generation_status: "not_implemented" },
] as const;

export type LlmConnectionId = typeof LLM_CONNECTIONS[number]["id"];

export interface LlmConnectionSummary {
  id: LlmConnectionId;
  display_name: string;
  /** A stored key is not proof of authentication or connectivity. */
  api_key_set: boolean;
  generation_status: "not_implemented";
}

/** Write-only keys. Omitted IDs are unchanged; null or blank strings clear. */
export type LlmApiKeysPatch = Partial<Record<LlmConnectionId, string | null>>;
