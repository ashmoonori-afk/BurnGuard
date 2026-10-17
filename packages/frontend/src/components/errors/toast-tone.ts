import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from "lucide-react";
import type { Toast } from "@/state/uiStore";

export type ToastTone = NonNullable<Toast["tone"]>;

export interface ToastToneStyle {
  readonly icon: LucideIcon;
  readonly border: string;
  /** Text-safe colour of the tone icon (never a fill token, which fails contrast as text). */
  readonly iconColor: string;
}

const TONES: Readonly<Record<ToastTone, ToastToneStyle>> = {
  info: { icon: Info, border: "border-border", iconColor: "text-accent" },
  success: { icon: CheckCircle2, border: "border-success/50", iconColor: "text-success-text" },
  warn: { icon: AlertTriangle, border: "border-warning", iconColor: "text-warning-text" },
  error: { icon: XCircle, border: "border-destructive/50", iconColor: "text-destructive" },
};

export function toastToneStyle(tone: Toast["tone"]): ToastToneStyle {
  return TONES[tone ?? "info"];
}
