import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useT } from "@/i18n/t";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

export function ModePanelHeader({ title, description, action, onClose, children }: {
  title: string;
  description?: string;
  action?: ReactNode;
  onClose?: () => void;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <header className="shrink-0 border-b border-border px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground [word-break:keep-all]">{description}</p>}
        </div>
        {(action || onClose) && <div className="flex shrink-0 items-center gap-1">
          {action}
          {onClose && <Tooltip content={t("modes.panel.close")} side="bottom" className="left-auto right-0 translate-x-0">
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8 max-[900px]:h-9 max-[900px]:w-9" aria-label={t("modes.panel.close")} onClick={onClose}><X aria-hidden="true" /></Button>
          </Tooltip>}
        </div>}
      </div>
      {children}
    </header>
  );
}

export function PanelSectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground", className)}>{children}</div>;
}
