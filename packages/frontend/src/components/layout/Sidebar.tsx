import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Clock3, FolderOpen, Layers3, LayoutTemplate, Settings2 } from "lucide-react";
import { DEFAULT_DISPLAY_NAME } from "@bg/shared";
import { getSettings } from "@/api/home";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/state/uiStore";
import { useT, type t } from "@/i18n/t";

const LINKS = [
  { view: "recent", label: "shell.recent", icon: Clock3 },
  { view: "mine", label: "shell.mine", icon: FolderOpen },
  { view: "examples", label: "shell.examples", icon: LayoutTemplate },
  { view: "systems", label: "shell.systems", icon: Layers3 },
] as const;

/** The seeded display name means "no name set", so the footer falls back to the localized workspace label. */
export function sidebarIdentity(name: string | undefined, translate: typeof t): { readonly initial: string; readonly label: string } {
  return name && name !== DEFAULT_DISPLAY_NAME
    ? { initial: name.slice(0, 1), label: name }
    : { initial: translate("shell.me"), label: translate("shell.workspace") };
}

export default function Sidebar() {
  const t = useT();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const openSettings = useUIStore((state) => state.setSettingsOpen);
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const current = pathname.startsWith("/systems/") ? "systems" : pathname === "/" ? params.get("view") ?? "recent" : null;
  const identity = sidebarIdentity(settings.data?.user.display_name, t);
  return (
    <aside className="flex shrink-0 flex-col border-b border-border bg-card lg:sticky lg:top-0 lg:h-dvh lg:w-[224px] lg:border-b-0 lg:border-r" aria-label={t("shell.navigation")}>
      <div className="flex items-center justify-between px-5 py-4 lg:px-6 lg:pb-8 lg:pt-7">
        <Link to="/" className="inline-flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("shell.home")}>
          <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-white p-1.5"><img src="/assets/burnguard-mark.png" alt="" className="h-full w-full object-contain" /></span>
          <span className="min-w-0 whitespace-nowrap text-lg font-bold leading-tight tracking-tight">BurnGuard<span className="block truncate text-xs font-medium text-muted-foreground">{t("shell.tagline")}</span></span>
        </Link>
        <button type="button" aria-label={t("shell.settings")} onClick={() => openSettings(true)} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring lg:hidden"><Settings2 className="h-5 w-5" /></button>
      </div>
      <nav className="grid grid-cols-2 gap-1 px-3 pb-3 sm:grid-cols-4 lg:flex lg:flex-col lg:px-4" aria-label={t("shell.menu")}>
        {LINKS.map(({ view, label, icon: Icon }) => <Link key={view} to={`/?view=${view}`} aria-current={current === view ? "page" : undefined} className={cn("flex min-h-11 min-w-0 items-center gap-2.5 whitespace-nowrap rounded-xl px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", current === view ? "bg-accent/10 font-semibold text-accent" : "text-muted-foreground hover:bg-muted hover:text-foreground")}><Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" /><span className="min-w-0 truncate">{t(label)}</span></Link>)}
      </nav>
      <div className="mt-auto hidden p-4 lg:block">
        <button type="button" aria-label={t("shell.settings")} title={t("shell.settingsConnections")} onClick={() => openSettings(true)} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold">{identity.initial}</span><span className="min-w-0 flex-1 truncate whitespace-nowrap text-sm font-medium">{identity.label}</span><Settings2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" /></button>
      </div>
    </aside>
  );
}
