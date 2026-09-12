import { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import { useT } from "@/i18n/t";

export default function AppShell({ children }: { children: ReactNode }) {
  const t = useT();
  const location = useLocation();
  const isHome = location.pathname === "/";
  const isProject = location.pathname.startsWith("/projects/");

  // The project route is an app surface, not a document: it is capped to the
  // viewport so the top bar and every panel header stay put and each pane owns
  // its own scrollport. Document-shaped routes (home, settings, systems) keep
  // page scrolling.
  return (
    <div
      className={cn(
        "bg-background text-foreground flex flex-col",
        isProject ? "h-dvh overflow-hidden" : "min-h-screen",
      )}
    >
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-lg focus:bg-accent focus:px-4 focus:py-3 focus:text-accent-foreground">{t("shell.skip")}</a>
      <div
        className={cn(
          "flex min-h-0 flex-1 max-lg:flex-col",
          isProject && "overflow-hidden",
        )}
      >
        {!isProject && <Sidebar />}
        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            "min-w-0 flex-1 flex flex-col outline-none",
            isProject && "min-h-0 overflow-hidden",
          )}
        >
          {!isHome && !isProject && <TopBar />}
          {children}
        </main>
      </div>
    </div>
  );
}
