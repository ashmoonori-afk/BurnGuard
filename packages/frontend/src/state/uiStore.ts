import { create } from "zustand";
import { CANVAS_MAGNET_PREF, readCanvasPref, writeCanvasPref } from "@/lib/canvas-prefs";
import { claimStarPrompt, type StarPromptStorage } from "@/lib/star-prompt";

export type ToastTone = "info" | "success" | "warn" | "error";

export interface Toast {
  id: string;
  title: string;
  body?: string;
  tone: ToastTone;
  action?: { readonly label: string; readonly onSelect: () => void };
}

interface UIState {
  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;

  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;

  cliMissingShown: boolean;
  setCliMissingShown: (shown: boolean) => void;

  starPromptOwed: boolean;
  starPromptOpen: boolean;
  oweStarPrompt: () => void;
  revealStarPrompt: (storage: () => StarPromptStorage, modalOpen: boolean) => void;
  dismissStarPrompt: () => void;

  /** Whether moving and resizing on the canvas lock to nearby lines. On until switched off; remembered on this computer. */
  canvasMagnet: boolean;
  setCanvasMagnet: (on: boolean) => void;

  /** What the element being moved is locked to, in words; the Style panel reads it out. Null when nothing is locked. */
  canvasSnapStatus: string | null;
  setCanvasSnapStatus: (status: string | null) => void;
}

const TOAST_AUTO_DISMISS_MS = 3000;

/**
 * How long a toast should stay before auto-dismissing, by tone.
 * `error` and `warn` toasts often carry an instruction the user still
 * needs to act on — they persist until the user closes them instead of
 * disappearing on a fixed timer. Pure function so it's unit-testable
 * without touching the store's timers.
 */
export function toastDurationMs(tone: ToastTone): number | null {
  return tone === "error" || tone === "warn" ? null : TOAST_AUTO_DISMISS_MS;
}

export const useUIStore = create<UIState>((set, get) => ({
  toasts: [],
  pushToast: (t) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    const duration = toastDurationMs(t.tone);
    if (typeof window !== "undefined" && duration !== null) {
      window.setTimeout(() => {
        get().dismissToast(id);
      }, duration);
    }
  },
  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

  cliMissingShown: false,
  setCliMissingShown: (cliMissingShown) => set({ cliMissingShown }),

  starPromptOwed: false,
  starPromptOpen: false,
  oweStarPrompt: () => set({ starPromptOwed: true }),
  revealStarPrompt: (storage, modalOpen) => {
    if (!get().starPromptOwed || modalOpen) return;
    set({ starPromptOwed: false });
    if (claimStarPrompt(storage)) set({ starPromptOpen: true });
  },
  dismissStarPrompt: () => set({ starPromptOpen: false }),

  canvasMagnet: readCanvasPref(CANVAS_MAGNET_PREF),
  setCanvasMagnet: (canvasMagnet) => {
    writeCanvasPref(CANVAS_MAGNET_PREF, canvasMagnet);
    set({ canvasMagnet });
  },

  canvasSnapStatus: null,
  setCanvasSnapStatus: (canvasSnapStatus) => { if (get().canvasSnapStatus !== canvasSnapStatus) set({ canvasSnapStatus }); },
}));
