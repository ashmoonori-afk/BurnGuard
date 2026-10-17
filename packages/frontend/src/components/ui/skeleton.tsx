import * as React from "react";
import { cn } from "@/lib/utils";

/** Placeholder block for content that is still loading; size it with `className`. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" data-skeleton className={cn("animate-pulse rounded-control bg-muted", className)} {...props} />;
}
