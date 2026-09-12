import { Link, useLocation } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useT } from "@/i18n/t";

export default function TopBar() {
  const t = useT();
  const { pathname } = useLocation();
  const system = pathname.startsWith("/systems/");
  return (
    <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-5 sm:px-8">
      <Link to={system ? "/?view=systems" : "/"} className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><ChevronLeft className="h-4 w-4" aria-hidden="true" />{t(system ? "shell.systems" : "shell.work")}</Link>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden="true" />
      <span className="text-sm font-medium">{t(system ? "shell.systemWorkspace" : "shell.settings")}</span>
    </header>
  );
}
