const publishingProjects = new Set<string>();
const publicationWaiters = new Map<string, Set<() => void>>();

export function beginArtifactPublication(projectId: string): void {
  publishingProjects.add(projectId);
}

export function endArtifactPublication(projectId: string): void {
  publishingProjects.delete(projectId);
  for (const resolve of publicationWaiters.get(projectId) ?? []) resolve();
  publicationWaiters.delete(projectId);
}

export async function waitForArtifactPublication(projectId: string): Promise<void> {
  while (publishingProjects.has(projectId)) {
    await new Promise<void>((resolve) => {
      const waiters = publicationWaiters.get(projectId) ?? new Set();
      waiters.add(resolve);
      publicationWaiters.set(projectId, waiters);
    });
  }
}

export function isArtifactPublicationActive(projectId: string): boolean {
  return publishingProjects.has(projectId);
}
