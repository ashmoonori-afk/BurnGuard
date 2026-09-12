import { useT } from "@/i18n/t";
import { useRef } from "react";
import type { ExportFormat } from "@bg/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { platformGuideView } from "./platform-guide";

function Section({ title, items }: { readonly title: string; readonly items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-semibold text-foreground">{title}</h3>
      <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="text-pretty break-keep">{item}</li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Renders the static shared guide text (doc/14 section 9.1). Radix Dialog owns
 * the focus trap and Escape handling.
 */
export default function PlatformGuideDialog({
  format,
  open,
  onOpenChange,
}: {
  readonly format: ExportFormat;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const openerRef = useRef<HTMLElement | null>(null);
  const guide = platformGuideView(format);
  if (guide === null) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="!z-[110] max-h-[85vh] max-w-lg overflow-y-auto"
        overlayClassName="!z-[110]"
        onOpenAutoFocus={() => {
          // The status-row button is outside DialogTrigger; capture it before
          // Radix moves focus into the guide, leaving its focus trap intact.
          const opener = document.activeElement;
          openerRef.current = opener instanceof HTMLElement ? opener : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          openerRef.current?.focus({ preventScroll: true });
        }}
      >
        <DialogHeader className="pr-8">
          <DialogTitle>{guide.title}</DialogTitle>
          <DialogDescription className="text-pretty break-keep">{guide.summary}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Section title={t("export.guide.prerequisites")} items={guide.prerequisites} />
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-foreground">{t("export.guide.steps")}</h3>
            <ol className="space-y-2">
              {guide.steps.map((step) => (
                <li key={step.title} className="space-y-1 rounded-md border border-border p-2">
                  <div className="flex items-start gap-2">
                    <span className="flex-1 text-xs font-medium text-foreground">{step.title}</span>
                    <span
                      className={
                        step.badge === t("export.guide.unverified")
                          ? "rounded-full bg-warning/20 px-2 py-0.5 text-[10px] text-foreground"
                          : "rounded-full bg-accent-soft px-2 py-0.5 text-[10px] text-accent"
                      }
                    >
                      {step.badge}
                    </span>
                  </div>
                  <p className="text-pretty break-keep text-xs leading-relaxed text-muted-foreground">{step.body}</p>
                </li>
              ))}
            </ol>
          </section>
          <Section title={t("export.guide.rollback")} items={guide.rollback} />
          <Section title={t("export.guide.unsupported")} items={guide.unsupported} />
          <p className="text-pretty break-keep rounded-md bg-muted/50 p-2 text-[11px] leading-relaxed text-muted-foreground">
            {guide.verificationNote} {t("export.guide.checkedOn", { name: guide.checkedOn })}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
