/** One optional toolbar item that may move into the "More" menu when the row is too narrow. */
export interface ToolbarOverflowItem {
  readonly id: string;
  /** Natural width in CSS px. */
  readonly width: number;
  /** Lower numbers stay in the row longest; the highest number moves to "More" first. */
  readonly priority: number;
}

export interface ToolbarOverflowSplit {
  readonly visible: readonly string[];
  readonly overflow: readonly string[];
}

/**
 * Splits optional items between the toolbar row and the "More" menu so the row never wraps.
 * Items keep their display order. When everything fits no "More" button is needed; otherwise
 * room for the button is reserved and the lowest-priority items leave the row until the rest fits.
 */
export function splitToolbarItems(
  items: readonly ToolbarOverflowItem[],
  availableWidth: number,
  gap: number,
  moreButtonWidth: number,
): ToolbarOverflowSplit {
  const rowWidth = (ids: ReadonlySet<string>, reserveMore: boolean): number => {
    const shown = items.filter((item) => ids.has(item.id));
    const widths = shown.reduce((sum, item) => sum + item.width, 0);
    const count = shown.length + (reserveMore ? 1 : 0);
    return widths + (reserveMore ? moreButtonWidth : 0) + Math.max(0, count - 1) * gap;
  };
  const all = new Set(items.map((item) => item.id));
  if (rowWidth(all, false) <= availableWidth) return { visible: items.map((item) => item.id), overflow: [] };

  const keep = new Set(all);
  const removalOrder = [...items].sort((a, b) => b.priority - a.priority);
  for (const item of removalOrder) {
    if (keep.size === 0 || rowWidth(keep, true) <= availableWidth) break;
    keep.delete(item.id);
  }
  return {
    visible: items.filter((item) => keep.has(item.id)).map((item) => item.id),
    overflow: items.filter((item) => !keep.has(item.id)).map((item) => item.id),
  };
}
