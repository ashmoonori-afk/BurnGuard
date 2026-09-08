import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { ProjectType, SettingsSummary } from "@bg/shared";
import { Palette } from "lucide-react";
import { getSettings, listDesignSystems } from "@/api/home";
import NewProjectPanel from "@/components/home/NewProjectPanel";
import { Badge } from "@/components/ui/badge";
import { useUIStore } from "@/state/uiStore";

const TYPES: Array<{ id: ProjectType; label: string }> = [
  { id: "prototype", label: "프로토타입" },
  { id: "slide_deck", label: "슬라이드 덱" },
  { id: "graphic", label: "그래픽" },
  { id: "from_template", label: "템플릿" },
  { id: "other", label: "기타" },
];

/**
 * The seeded default display name is app chrome rather than user data,
 * so it is shown in Korean. Any name the user actually set is rendered
 * verbatim.
 */
const DEFAULT_DISPLAY_NAME = "You";

const FALLBACK_SETTINGS: SettingsSummary = {
  user: { id: "local", display_name: "You" },
  app_version: "0.4.0",
  default_backend: "claude-code",
  theme: "light",
  chat_abort_threshold_ms: 300_000,
  chat_context_mode: "compact",
  figma_token_set: false,
};

export default function Sidebar() {
  const navigate = useNavigate();
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const [activeType, setActiveType] = useState<ProjectType>("slide_deck");

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: getSettings,
  });
  // Shares HomeView's cache key so both views dedupe into a single
  // fetch. The full list is passed down as-is; NewProjectPanel decides
  // what is actually selectable (published only) so a half-finished
  // draft system can never become a new project's brand.
  const systemsQuery = useQuery({
    queryKey: ["design-systems", "all"],
    queryFn: async () => {
      const [draft, review, published] = await Promise.all([
        listDesignSystems("draft"),
        listDesignSystems("review"),
        listDesignSystems("published"),
      ]);
      return [...draft, ...review, ...published].sort(
        (a, b) => b.updated_at - a.updated_at,
      );
    },
  });

  const settings = settingsQuery.data ?? FALLBACK_SETTINGS;
  const systems = systemsQuery.data ?? [];
  const displayName =
    settings.user.display_name === DEFAULT_DISPLAY_NAME
      ? "나"
      : settings.user.display_name;

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-r border-border bg-background max-[900px]:order-2 max-[900px]:w-full max-[900px]:border-b max-[900px]:border-r-0">
      <header className="p-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-accent/15 text-accent">
            <Palette className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[15px] font-semibold leading-none">
              BurnGuard Design
            </div>
            <div className="mt-1 flex items-center gap-1.5">
              <Badge
                variant="outline"
                className="h-4 rounded-sm py-0 text-[10px]"
              >
                로컬
              </Badge>
              <span className="text-[11px] text-foreground/70">
                v{settings.app_version}
              </span>
            </div>
          </div>
        </div>
      </header>

      <nav aria-label="새 프로젝트 유형" className="flex min-h-11 flex-wrap gap-0.5 border-b border-border px-4">
        {TYPES.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={activeType === t.id}
            onClick={() => setActiveType(t.id)}
            className={[
              "min-h-11 shrink-0 whitespace-nowrap px-2.5 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              activeType === t.id
                ? "border-foreground text-foreground"
                : "border-transparent text-foreground/70 hover:text-foreground",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div id="new-project-panel" role="region" aria-label="새 프로젝트 만들기" className="flex-1 scroll-mt-20 overflow-y-auto">
        <NewProjectPanel
          type={activeType}
          designSystems={systems}
          defaultBackend={settings.default_backend}
          systemsLoading={systemsQuery.isPending}
          systemsError={systemsQuery.error}
          onRetrySystems={() => void systemsQuery.refetch()}
          onCreated={(project) => navigate(`/projects/${project.id}`)}
        />
      </div>

      <footer className="border-t border-border p-4">
        <div className="text-xs text-foreground/70">
          사용자{" "}
          <span className="text-foreground">{displayName}</span>
        </div>
        <div className="mt-1 flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="text-xs text-foreground/70 hover:text-foreground"
          >
            설정
          </button>
        </div>
      </footer>
    </aside>
  );
}
