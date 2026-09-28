const activeGenerations = new Map<string, string>();

export function isVisualAlternativeOperationActive(
  sessionId: string,
): boolean {
  return activeGenerations.has(sessionId);
}

export function beginVisualAlternativeOperation(
  sessionId: string,
  generationId: string,
): boolean {
  if (activeGenerations.has(sessionId)) return false;
  activeGenerations.set(sessionId, generationId);
  return true;
}

export function finishVisualAlternativeOperation(
  sessionId: string,
  generationId: string,
): void {
  if (activeGenerations.get(sessionId) === generationId) {
    activeGenerations.delete(sessionId);
  }
}
