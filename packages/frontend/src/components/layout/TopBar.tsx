import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useMatch } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getDesignSystem } from "@/api/design-system-metadata";
import { Tooltip } from "@/components/ui/tooltip";
import { useT } from "@/i18n/t";

/** Only routes that have a real place in the app get a breadcrumb; anything else (the not-found page) renders its own heading. */
export function topBarRoute(pathname: string): "system" | "settings" | null {
  if (/^\/systems\/[^/]+\/?$/.test(pathname)) return "system";
  if (/^\/settings\/?$/.test(pathname)) return "settings";
  return null;
}

export default function TopBar() {
  const t = useT();
  const { pathname } = useLocation();
  const route = topBarRoute(pathname);
  const systemId = useMatch("/systems/:id")?.params.id;
  const systemQuery = useQuery({
    queryKey: ["design-systems", "detail", systemId],
    queryFn: () => getDesignSystem(systemId ?? ""),
    enabled: systemId !== undefined,
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (route === null) return null;
  const system = route === "system";
  const systemName = systemQuery.data?.name ?? t("shell.systemWorkspace");
  return (
    <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-5 sm:px-8">
      <Link to={system ? "/?view=systems" : "/"} className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><ChevronLeft className="h-4 w-4" aria-hidden="true" />{t(system ? "shell.systems" : "shell.work")}</Link>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden="true" />
      {system ? (
        <Tooltip content={systemName} side="bottom" wrapperClassName="min-w-0 max-w-full">
          <span tabIndex={0} aria-current="page" className="block max-w-[min(55vw,32rem)] truncate rounded-control text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card">{systemName}</span>
        </Tooltip>
      ) : <span aria-current="page" className="text-sm font-medium">{t("shell.settings")}</span>}
    </header>
  );
}
