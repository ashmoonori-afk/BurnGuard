import { isVisualAlternativeOperationActive } from "./visual-alternative-operation-registry";

type ActiveDirectionOperation = {
  readonly generationId: string;
  readonly controller: AbortController;
};

const MAX_ACTIVE_OPERATIONS = 64;
const activeOperations = new Map<string, ActiveDirectionOperation>();

export function isDirectionOperationActive(sessionId: string): boolean {
  return activeOperations.has(sessionId);
}

export function activeDirectionGeneration(sessionId: string): string | null {
  return activeOperations.get(sessionId)?.generationId ?? null;
}

export function activeDirectionSignal(sessionId: string, generationId: string): AbortSignal | null {
  const operation = activeOperations.get(sessionId);
  return operation?.generationId === generationId ? operation.controller.signal : null;
}

export function beginDirectionOperation(sessionId: string, generationId: string): AbortController | null {
  if (activeOperations.has(sessionId) || isVisualAlternativeOperationActive(sessionId) || activeOperations.size >= MAX_ACTIVE_OPERATIONS) return null;
  const controller = new AbortController();
  activeOperations.set(sessionId, { generationId, controller });
  return controller;
}

export function cancelDirectionOperation(sessionId: string): boolean {
  const operation = activeOperations.get(sessionId);
  if (operation === undefined) return false;
  operation.controller.abort();
  return true;
}

export function finishDirectionOperation(sessionId: string, generationId: string): void {
  if (activeOperations.get(sessionId)?.generationId === generationId) activeOperations.delete(sessionId);
}
