import type { ReactNode } from "react";

export default function CardGrid({ children }: { children: ReactNode }) {
  return (
    <div
      className="grid gap-5"
      style={{
        gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))",
      }}
    >
      {children}
    </div>
  );
}
