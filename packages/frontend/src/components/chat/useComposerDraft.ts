import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { VISUAL_SOURCE_ROLES } from "@bg/shared";
import { planAttachmentIntake, type IntakeItem } from "./attachment-intake";

export type ComposerDraft = { text: string; items: readonly IntakeItem[] };
const memoryDrafts = new Map<string, ComposerDraft>();
let database: Promise<IDBDatabase> | undefined;

function draftsDatabase(): Promise<IDBDatabase> {
  return database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("burnguard-composer", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onblocked = () => { database = undefined; reject(new Error("draft_storage_blocked")); };
  });
}

export function parseComposerDraft(value: unknown): ComposerDraft | null {
  if (!value || typeof value !== "object" || !("text" in value) || typeof value.text !== "string" || !("items" in value) || !Array.isArray(value.items)) return null;
  let items: readonly IntakeItem[] = [];
  for (const item of value.items) {
    if (!item || typeof item !== "object" || !(item.file instanceof File) || item.status !== "ready") continue;
    const next = planAttachmentIntake(items, [item.file]);
    const added = next.at(-1);
    if (added?.status === "ready") items = [...items, { ...added, role: VISUAL_SOURCE_ROLES.includes(item.role) ? item.role : "ordinary_content" }];
  }
  return { text: value.text, items };
}

async function readDraft(id: string): Promise<ComposerDraft | null> {
  const db = await draftsDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction("drafts").objectStore("drafts").get(id);
    request.onsuccess = () => resolve(parseComposerDraft(request.result));
    request.onerror = () => reject(request.error);
  });
}

async function writeDraft(id: string, draft: ComposerDraft): Promise<void> {
  const db = await draftsDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("drafts", "readwrite");
    const store = transaction.objectStore("drafts");
    if (!draft.text && draft.items.length === 0) store.delete(id);
    else store.put({ text: draft.text, items: draft.items.filter((item) => item.status === "ready") }, id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** Files use IndexedDB structured cloning; drafts remain local and keyed by session. */
export function useComposerDraft(sessionId: string, initialText: string) {
  const [draft, setDraft] = useState<ComposerDraft>({ text: initialText, items: [] });
  const current = useRef(draft);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    let active = true;
    setReady(false);
    setStorageError(false);
    void (async () => {
      let restored = memoryDrafts.get(sessionId);
      try { restored ??= await readDraft(sessionId) ?? undefined; }
      catch { if (active) setStorageError(true); }
      if (!active) return;
      current.current = restored ?? { text: initialText, items: [] };
      setDraft(current.current);
      setReady(true);
    })();
    return () => { active = false; };
  }, [sessionId, initialText]);
  const update = useCallback((next: ComposerDraft) => {
    current.current = next;
    memoryDrafts.set(sessionId, next);
    setDraft(next);
    void writeDraft(sessionId, next).catch(() => setStorageError(true));
  }, [sessionId]);
  return {
    ...draft, ready, storageError,
    setText: (text: string) => update({ ...current.current, text }),
    setItems: (items: SetStateAction<readonly IntakeItem[]>) => update({ ...current.current, items: typeof items === "function" ? items(current.current.items) : items }),
    clear: () => update({ text: "", items: [] }),
  };
}
