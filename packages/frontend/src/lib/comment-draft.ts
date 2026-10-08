/**
 * An unsaved comment edit survives a closed tab or window: the textarea
 * stores every change keyed by comment id and restores it on the next mount.
 * The stored copy is dropped once the server body matches it.
 */
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function COMMENT_DRAFT_KEY(commentId: string): string {
  return `bg.comment-draft.${commentId}`;
}

function browserStorage(): DraftStorage {
  return window.localStorage;
}

/** Storage is a boundary: a blocked or missing store costs the draft, never the panel. */
export function readCommentDraft(commentId: string, storage: () => DraftStorage = browserStorage): string | null {
  try {
    return storage().getItem(COMMENT_DRAFT_KEY(commentId));
  } catch {
    return null;
  }
}

/** A draft equal to the saved body is not a draft; it clears the stored copy. */
export function writeCommentDraft(commentId: string, body: string, serverBody: string, storage: () => DraftStorage = browserStorage): void {
  try {
    if (body === serverBody) storage().removeItem(COMMENT_DRAFT_KEY(commentId));
    else storage().setItem(COMMENT_DRAFT_KEY(commentId), body);
  } catch {
    /* the textarea keeps working without a saved draft */
  }
}

/** The text a remounted editor starts from, and whether it still needs saving. */
export function restoredCommentDraft(stored: string | null, serverBody: string): { body: string; dirty: boolean } {
  return stored === null || stored === serverBody ? { body: serverBody, dirty: false } : { body: stored, dirty: true };
}
