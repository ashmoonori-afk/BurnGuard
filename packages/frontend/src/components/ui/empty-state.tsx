import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  body?: string;
  /** The next step, usually a `Button`. */
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, body, action, className }: EmptyStateProps) {
  return (
    <div
      data-empty-state
      className={cn("flex flex-col items-center gap-3 rounded-card border border-dashed border-border bg-card px-6 py-10 text-center", className)}
    >
      {Icon !== undefined && (
        <span aria-hidden="true" className="grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-5 w-5" />
        </span>
      )}
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {body !== undefined && <p className="max-w-sm text-pretty text-sm text-muted-foreground">{body}</p>}
      {action}
    </div>
  );
}
