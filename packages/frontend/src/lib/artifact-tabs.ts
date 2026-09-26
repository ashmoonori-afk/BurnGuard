import type { ArtifactTab } from "@/types/project";

/**
 * Which tab becomes active after a file tab closes: the neighbour before it, else the one after it,
 * else the design system tab. Closing a tab that is not active leaves the active tab alone.
 */
export function nextActiveTabAfterClose(openFileTabs: readonly ArtifactTab[], closedId: string, activeTabId: string): string {
  if (activeTabId !== closedId) return activeTabId;
  const index = openFileTabs.findIndex((tab) => tab.id === closedId);
  const neighbour = index === -1 ? undefined : openFileTabs[index - 1] ?? openFileTabs[index + 1];
  return neighbour?.id ?? "design-system";
}
