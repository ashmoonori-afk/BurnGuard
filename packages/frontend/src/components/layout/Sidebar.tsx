import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Clock3, FolderOpen, Layers3, LayoutTemplate, Plus, Settings2 } from "lucide-react";
import { getSettings } from "@/api/home";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/state/uiStore";
import { useT } from "@/i18n/t";

const LINKS = [
  { view: "recent", label: "shell.recent", icon: Clock3 },
  { view: "mine", label: "shell.mine", icon: FolderOpen },
  { view: "examples", label: "shell.examples", icon: LayoutTemplate },
  { view: "systems", label: "shell.systems", icon: Layers3 },
] as const;

export default function Sidebar() {
  const t = useT();
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const openSettings = useUIStore((state) => state.setSettingsOpen);
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const current = pathname.startsWith("/systems/") ? "systems" : pathname === "/" ? params.get("view") ?? "recent" : null;
  const name = settings.data?.user.display_name;
  return (
    <aside className="flex shrink-0 flex-col border-b border-border bg-card lg:sticky lg:top-0 lg:h-dvh lg:w-[224px] lg:border-b-0 lg:border-r" aria-label={t("shell.navigation")}>
      <div className="flex items-center justify-between px-5 py-4 lg:px-6 lg:pb-8 lg:pt-7">
        <Link to="/" className="inline-flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("shell.home")}>
          <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-xl border border-border bg-white p-1.5"><img src="/assets/burnguard-mark.png" alt="" className="h-full w-full object-contain" /></span>
          <span className="text-lg font-bold tracking-tight">BurnGuard<span className="mt-0.5 block text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{t("shell.tagline")}</span></span>
        </Link>
        <button type="button" aria-label={t("shell.settings")} onClick={() => openSettings(true)} className="grid h-11 w-11 place-items-center rounded-xl text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring lg:hidden"><Settings2 className="h-5 w-5" /></button>
      </div>
      <div className="hidden px-4 pb-6 lg:block"><Link to="/?create=slide_deck" className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground shadow-sm transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"><Plus className="h-4 w-4" />{t("shell.create")}</Link></div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:px-4" aria-label={t("shell.menu")}>
        {LINKS.map(({ view, label, icon: Icon }) => <Link key={view} to={`/?view=${view}`} aria-current={current === view ? "page" : undefined} className={cn("flex min-h-11 shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", current === view ? "bg-accent/10 font-semibold text-accent" : "text-muted-foreground hover:bg-muted hover:text-foreground")}><Icon className="h-[18px] w-[18px]" aria-hidden="true" />{t(label)}</Link>)}
      </nav>
      <div className="mt-auto hidden p-4 lg:block">
        <div className="mb-4 rounded-xl border border-border bg-background p-4"><div className="mb-2 flex items-center gap-2 text-xs font-semibold"><span className="h-1.5 w-1.5 rounded-full bg-accent" />{t("shell.local")}</div><p className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">{t("shell.localHint")}</p><Link to="/?view=examples" className="mt-3 inline-flex min-h-9 items-center gap-1 text-xs font-medium text-accent">{t("shell.startExample")}<ArrowUpRight className="h-3.5 w-3.5" /></Link></div>
        <button type="button" aria-label={t("shell.settings")} onClick={() => openSettings(true)} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold">{name && name !== "You" ? name.slice(0, 1) : t("shell.me")}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{name && name !== "You" ? name : t("shell.workspace")}</span><span className="text-xs text-muted-foreground">{t("shell.settingsConnections")}</span></span><Settings2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" /></button>
      </div>
    </aside>
  );
}
