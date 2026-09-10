import { create } from "zustand";

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
}));
