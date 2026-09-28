type ActiveVisualAlternativeOperation = {
  readonly generationId: string;
  readonly projectId: string;
  readonly controller: AbortController;
  /** Artifact operations the batch itself may commit while it leases the project. */
  readonly operationIds: Set<string>;
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

function projectOperation(projectId: string): ActiveVisualAlternativeOperation | undefined {
  for (const operation of activeGenerations.values()) {
    if (operation.projectId === projectId) return operation;
  }
  return undefined;
}

export function isVisualAlternativeProjectLeased(projectId: string): boolean {
  return projectOperation(projectId) !== undefined;
}

/** Whether an artifact mutation must wait: a batch leases the project and the operation is not its own. */
export function isArtifactMutationBlockedByAlternatives(
  projectId: string,
  operationId: string,
): boolean {
  const operation = projectOperation(projectId);
  return operation !== undefined && !operation.operationIds.has(operationId);
}

/** Callers admit through `admitVisualAlternativeBatch` so turn, hold and capacity checks stay atomic. */
export function beginVisualAlternativeOperation(
  sessionId: string,
  projectId: string,
  generationId: string,
): AbortController | null {
  if (activeGenerations.has(sessionId) || isVisualAlternativeProjectLeased(projectId)) return null;
  const controller = new AbortController();
  activeGenerations.set(sessionId, { generationId, projectId, controller, operationIds: new Set() });
  return controller;
}

export function allowVisualAlternativeMutation(
  sessionId: string,
  generationId: string,
  operationId: string,
): void {
  const operation = activeGenerations.get(sessionId);
  if (operation?.generationId !== generationId) {
    throw new Error("visual_alternative_operation_not_active");
  }
  operation.operationIds.add(operationId);
}

export function cancelVisualAlternativeProject(projectId: string): boolean {
  const operation = projectOperation(projectId);
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
