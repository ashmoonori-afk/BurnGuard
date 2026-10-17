import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const SIZES = { sm: "h-3.5 w-3.5", md: "h-4 w-4", lg: "h-6 w-6" } as const;

export interface SpinnerProps {
  /** Accessible name announced to assistive technology. Pass an already translated string. */
  label: string;
  size?: keyof typeof SIZES;
  className?: string;
}

export function Spinner({ label, size = "md", className }: SpinnerProps) {
  return (
    <span role="status" data-spinner className={cn("inline-flex items-center text-muted-foreground", className)}>
      <Loader2 aria-hidden="true" className={cn("animate-spin", SIZES[size])} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
