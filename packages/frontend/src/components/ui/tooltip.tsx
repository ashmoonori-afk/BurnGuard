import * as React from "react";
import { cn } from "@/lib/utils";

export type TooltipSide = "top" | "bottom";

export interface TooltipProps {
  /** Short label shown next to the trigger. Pass an already translated string. */
  content: React.ReactNode;
  /** The single focusable trigger; it receives `aria-describedby` while the tooltip is open. */
  children: React.ReactElement<{ "aria-describedby"?: string }>;
  side?: TooltipSide;
  defaultOpen?: boolean;
  className?: string;
  /** Extra classes for the wrapper, e.g. `min-w-0 max-w-full` so a truncating child can shrink. */
  wrapperClassName?: string;
}

/**
 * Dependency-free tooltip. Opens on pointer hover and keyboard focus, closes on
 * leave, blur and Escape, and stays open while the pointer rests on the bubble.
 */
export function Tooltip({ content, children, side = "top", defaultOpen = false, className, wrapperClassName }: TooltipProps) {
  const id = React.useId();
  const [open, setOpen] = React.useState(defaultOpen);
  const describedBy = [children.props["aria-describedby"], open ? id : undefined].filter(Boolean).join(" ");
  return (
    <span
      className={cn("relative inline-flex", wrapperClassName)}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}
    >
      {React.cloneElement(children, describedBy === "" ? {} : { "aria-describedby": describedBy })}
      {open && (
        <span
          role="tooltip"
          id={id}
          data-side={side}
          className={cn(
            "absolute left-1/2 z-50 w-max max-w-xs -translate-x-1/2 rounded-control border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-app-3",
            side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
            className,
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
