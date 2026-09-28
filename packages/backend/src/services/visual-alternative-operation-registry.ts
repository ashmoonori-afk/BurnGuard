type ActiveVisualAlternativeOperation = {
  readonly generationId: string;
  readonly controller: AbortController;
};

const activeGenerations = new Map<string, ActiveVisualAlternativeOperation>();

export function isVisualAlternativeOperationActive(
  sessionId: string,
): boolean {
  return activeGenerations.has(sessionId);
}

export function activeVisualAlternativeSessions(): Iterable<string> {
  return activeGenerations.keys();
}

/** Callers admit through `admitVisualAlternativeBatch` so turn, hold and capacity checks stay atomic. */
export function beginVisualAlternativeOperation(
  sessionId: string,
  generationId: string,
): AbortController | null {
  if (activeGenerations.has(sessionId)) return null;
  const controller = new AbortController();
  activeGenerations.set(sessionId, { generationId, controller });
  return controller;
}

export function cancelVisualAlternativeOperation(sessionId: string): boolean {
  const operation = activeGenerations.get(sessionId);
  if (operation === undefined) return false;
  operation.controller.abort();
  return true;
}

export function cancelAllVisualAlternativeOperations(): void {
  for (const operation of activeGenerations.values()) operation.controller.abort();
}

export function finishVisualAlternativeOperation(
  sessionId: string,
  generationId: string,
): void {
  if (activeGenerations.get(sessionId)?.generationId === generationId) {
    activeGenerations.delete(sessionId);
  }
}
