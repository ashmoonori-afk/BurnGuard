export type VisualAlternativeTurnInput = {
  readonly sessionId: string;
  readonly operationId: string;
  readonly ordinal: number;
  readonly count: number;
  readonly name: string;
  readonly prompt: string;
  readonly entrypoint: string;
};

export class VisualAlternativeServiceError extends Error {
  readonly name = "VisualAlternativeServiceError";
  constructor(
    readonly code:
      | "alternative_not_found"
      | "alternative_not_ready"
      | "generation_active"
      | "project_not_found"
      | "session_busy",
  ) {
    super(code);
  }
}
