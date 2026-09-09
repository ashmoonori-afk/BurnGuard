import { useEffect, useState } from "react";
import { Download, RefreshCw, UserRound, Sparkles, Monitor, FileOutput, Link2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  PlaywrightInstallStatus,
  PythonSettings,
  SettingsSummary,
} from "@bg/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import BackendSelector from "./BackendSelector";
import GenerationControls from "./GenerationControls";
import { defaultGenerationOptions } from "@bg/shared";
import { detectBackends, getSettings, patchSettings } from "@/api/home";
import {
  getPlaywrightInstallStatus,
  getPythonSettings,
  startPlaywrightInstall,
  startPypdfInstall,
} from "@/api/settings";
import { useUIStore } from "@/state/uiStore";
import { apiErrorCopy } from "@/lib/error-copy";

const CHAT_CONTEXT_MODE_LABELS = {
  compact: "간단",
  full: "전체",
} as const;

const THEME_LABELS = {
  light: "밝게",
  dark: "어둡게",
  auto: "시스템 설정",
} as const;

export default function SettingsModal() {
  const open = useUIStore((s) => s.settingsOpen);
  const setOpen = useUIStore((s) => s.setSettingsOpen);
  return open ? <SettingsDialog onClose={() => setOpen(false)} /> : null;
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const pushToast = useUIStore((s) => s.pushToast);
  const queryClient = useQueryClient();
  const [returnFocusTarget] = useState(() => typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const settingsQuery = useQuery({
    queryKey: ["settings", "dialog"], queryFn: getSettings, gcTime: 0,
  });
  const detectionQuery = useQuery({ queryKey: ["backends", "detect"], queryFn: detectBackends });
  const pwQuery = useQuery({
    queryKey: ["settings", "playwright"], queryFn: getPlaywrightInstallStatus,
    refetchInterval: (query) => query.state.data?.state === "installing" ? 1500 : false,
  });
  const pyQuery = useQuery({
    queryKey: ["settings", "python"], queryFn: getPythonSettings,
    refetchInterval: (query) => query.state.data?.install.state === "installing" ? 1500 : false,
  });
  const [settings, setSettings] = useState<SettingsSummary | null>(null);
  const [saving, setSaving] = useState(false);
  const pw = pwQuery.data ?? null;
  const py = pyQuery.data ?? null;
  const [pwStarting, setPwStarting] = useState(false);
  const [pyStarting, setPyStarting] = useState(false);
  // The Figma PAT input is a separate write-only path: GET /api/settings
  // never returns the value, only a figma_token_set boolean. The user
  // types a token here, hits Save, and the field clears.
  const [figmaTokenInput, setFigmaTokenInput] = useState("");
  const [figmaTokenSaving, setFigmaTokenSaving] = useState(false);
  const [commandcodeKey, setCommandcodeKey] = useState("");
  const [commandcodeSaving, setCommandcodeSaving] = useState(false);

  async function saveCommandcodeKey(value: string | null) {
    setCommandcodeSaving(true);
    try {
      const next = await patchSettings({ commandcode_api_key: value });
      setSettings((draft) => draft ? { ...draft, commandcode_api_key_set: next.commandcode_api_key_set } : next);
      queryClient.setQueryData(["settings"], next);
      setCommandcodeKey("");
      pushToast({ title: value === null ? "CommandCode 키를 지웠어요" : "CommandCode 키를 저장했어요", tone: "success" });
    } catch (error) { pushToast({ title: "CommandCode 키를 저장하지 못했어요", body: apiErrorCopy(error), tone: "error" }); }
    finally { setCommandcodeSaving(false); }
  }

  useEffect(() => {
    // Initialize once; background status/token updates must not replace edits.
    if (!settings && settingsQuery.data && !settingsQuery.isFetching) setSettings(settingsQuery.data);
  }, [settings, settingsQuery.data, settingsQuery.isFetching]);

  async function handleInstallPlaywright() {
    setPwStarting(true);
    try {
      const next = await startPlaywrightInstall();
      queryClient.setQueryData(["settings", "playwright"], next);
    } catch (err) {
      pushToast({
        title: "Playwright 설치를 시작하지 못했어요",
        body: apiErrorCopy(err),
        tone: "error",
      });
    } finally {
      setPwStarting(false);
    }
  }

  async function handleInstallPypdf() {
    setPyStarting(true);
    try {
      const next = await startPypdfInstall();
      queryClient.setQueryData(["settings", "python"], next);
    } catch (err) {
      pushToast({
        title: "pypdf 설치를 시작하지 못했어요",
        body: apiErrorCopy(err),
        tone: "error",
      });
    } finally {
      setPyStarting(false);
    }
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const next = await patchSettings({
        default_backend: settings.default_backend,
        generation_defaults: settings.generation_defaults,
        theme: settings.theme,
        chat_abort_threshold_ms: settings.chat_abort_threshold_ms,
        chat_context_mode: settings.chat_context_mode,
        user: settings.user,
      });
      queryClient.setQueryData(["settings"], next);
      pushToast({ title: "설정을 저장했어요", tone: "success" });
      onClose();
    } catch (err) {
      pushToast({
        title: "설정을 저장하지 못했어요",
        body: apiErrorCopy(err),
        tone: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function saveFigmaToken(value: string | null) {
    setFigmaTokenSaving(true);
    try {
      const next = await patchSettings({ figma_personal_access_token: value });
      setSettings((draft) => draft ? { ...draft, figma_token_set: next.figma_token_set } : next);
      queryClient.setQueryData(["settings"], next);
      setFigmaTokenInput("");
      pushToast({
        title: value === null ? "Figma 토큰을 지웠어요" : "Figma 토큰을 저장했어요",
        tone: "success",
      });
    } catch (err) {
      pushToast({
        title: "Figma 토큰을 저장하지 못했어요",
        body: apiErrorCopy(err),
        tone: "error",
      });
    } finally {
      setFigmaTokenSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(nextOpen) => { if (!nextOpen && !saving && !figmaTokenSaving && !commandcodeSaving) onClose(); }}>
      <DialogContent className="flex h-[min(780px,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0" onCloseAutoFocus={(event) => { if (returnFocusTarget?.isConnected) { event.preventDefault(); returnFocusTarget.focus(); } }}>
        <DialogHeader className="shrink-0 border-b border-border px-5 py-5 pr-12 sm:px-7">
          <DialogTitle className="text-xl">설정</DialogTitle>
          <DialogDescription>
            이 컴퓨터에 저장되는 설정이에요. 일반 설정은 아래 저장 버튼으로 적용해요.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav aria-label="설정 섹션" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-muted/30 p-3 md:w-44 md:flex-col md:border-b-0 md:border-r md:p-4">
            {[{ id: "user", title: "사용자", icon: UserRound }, { id: "generation", title: "생성 도구", icon: Sparkles }, { id: "appearance", title: "화면", icon: Monitor }, { id: "files", title: "파일 변환", icon: FileOutput }, { id: "connections", title: "외부 연결", icon: Link2 }].map(({ id, title, icon: Icon }) => <button key={id} type="button" onClick={() => document.getElementById(`settings-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" })} className="flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Icon className="h-4 w-4" aria-hidden="true" />{title}</button>)}
          </nav>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-muted/15 p-4 sm:p-6">
        {!settings && settingsQuery.isError ? (
          <SettingsLoadError title="설정을 불러오지 못했어요" error={settingsQuery.error} retry={() => void settingsQuery.refetch()} pending={settingsQuery.isFetching} />
        ) : !settings ? (
          <div role="status" className="py-8 text-center text-sm text-muted-foreground">
            불러오는 중…
          </div>
        ) : (
          <fieldset disabled={saving} className="min-w-0 space-y-5">
            <legend className="sr-only">일반 설정과 연동</legend>
            <section id="settings-user" aria-labelledby="settings-user-title" className="scroll-mt-6 space-y-5 rounded-2xl border border-border bg-card p-5">
              <div className="space-y-1"><h2 id="settings-user-title" className="text-base font-semibold">사용자</h2><p className="text-sm leading-6 text-muted-foreground">프로젝트에서 사용할 이름을 정해요.</p></div>
            <div className="space-y-1.5">
              <label
                htmlFor="display-name"
                className="text-xs font-medium text-muted-foreground"
              >
                표시 이름
              </label>
              <Input
                id="display-name"
                value={settings.user.display_name}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    user: { ...settings.user, display_name: e.target.value },
                  })
                }
              />
            </div>

            </section>
            <section id="settings-generation" aria-labelledby="settings-generation-title" className="scroll-mt-6 space-y-5 rounded-2xl border border-border bg-card p-5">
              <div className="space-y-1"><h2 id="settings-generation-title" className="text-base font-semibold">생성 도구</h2><p className="text-sm leading-6 text-muted-foreground">프로젝트를 만드는 도구와 대화 방식을 설정해요.</p></div>
            {detectionQuery.data ? <BackendSelector
              value={settings.default_backend}
              onChange={(b) =>
                setSettings({ ...settings, default_backend: b })
              }
              detection={detectionQuery.data}
            /> : detectionQuery.isPending ? <p role="status" className="text-sm text-muted-foreground">사용할 수 있는 백엔드를 확인하는 중이에요.</p> : null}
            {detectionQuery.isError ? <SettingsLoadError title="백엔드 상태를 확인하지 못했어요" error={detectionQuery.error} retry={() => void detectionQuery.refetch()} pending={detectionQuery.isFetching} /> : null}
            <GenerationControls backendId={settings.default_backend} value={settings.generation_defaults?.[settings.default_backend] ?? defaultGenerationOptions(settings.default_backend)} onChange={(generation) => setSettings({ ...settings, generation_defaults: { ...settings.generation_defaults, [settings.default_backend]: generation } })} />
            <div className="space-y-2 rounded-xl border border-border p-3">
              <label htmlFor="commandcode-api-key" className="text-sm font-medium">CommandCode API 키</label>
              <p className="text-xs text-muted-foreground">Claude Code 설치가 필요해요. CommandCode의 Claude 모델로 생성하며 API 사용량이 발생해요. {settings.commandcode_api_key_set ? "키가 저장되어 있어요." : "저장된 키가 없어요."}</p>
              <Input id="commandcode-api-key" type="password" autoComplete="new-password" value={commandcodeKey} onChange={(event) => setCommandcodeKey(event.target.value)} placeholder="새 API 키 입력" disabled={commandcodeSaving} />
              <div className="flex gap-2"><Button type="button" size="sm" disabled={commandcodeSaving || !commandcodeKey.trim()} onClick={() => void saveCommandcodeKey(commandcodeKey)}>키 저장</Button><Button type="button" size="sm" variant="outline" disabled={commandcodeSaving || !settings.commandcode_api_key_set} onClick={() => void saveCommandcodeKey(null)}>키 삭제</Button></div>
            </div>

            <div className="space-y-1.5">
              <div id="chat-context-label" className="text-xs font-medium text-muted-foreground">
                채팅 컨텍스트
              </div>
              <div role="group" aria-labelledby="chat-context-label" className="flex gap-2">
                {(["compact", "full"] as const).map((mode) => (
                  <Button
                    key={mode}
                    aria-pressed={settings.chat_context_mode === mode}
                    variant={
                      settings.chat_context_mode === mode ? "default" : "outline"
                    }
                    size="sm"
                    onClick={() =>
                      setSettings({ ...settings, chat_context_mode: mode })
                    }
                  >
                    {CHAT_CONTEXT_MODE_LABELS[mode]}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                간단 모드는 필요한 파일을 참조해 대화를 가볍게 유지해요. 전체 모드는 프로젝트와 디자인 시스템 내용을 매번 함께 전달해요.
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="abort-threshold"
                className="text-xs font-medium text-muted-foreground"
              >
                중단 버튼이 나타나기까지 (초)
              </label>
              <Input
                id="abort-threshold"
                type="number"
                min={0}
                max={3600}
                step={30}
                value={Math.round(settings.chat_abort_threshold_ms / 1000)}
                onChange={(e) => {
                  const raw = Number.parseInt(e.target.value, 10);
                  const clamped = Number.isFinite(raw)
                    ? Math.max(0, Math.min(3600, raw))
                    : 300;
                  setSettings({
                    ...settings,
                    chat_abort_threshold_ms: clamped * 1000,
                  });
                }}
              />
              <p className="text-xs text-muted-foreground">
                생성이 오래 이어지면 직접 중단할 수 있어요. 기본값은 300초(5분)예요.
              </p>
            </div>

            </section>
            <section id="settings-appearance" aria-labelledby="settings-appearance-title" className="scroll-mt-6 space-y-5 rounded-2xl border border-border bg-card p-5">
              <div className="space-y-1"><h2 id="settings-appearance-title" className="text-base font-semibold">화면</h2><p className="text-sm leading-6 text-muted-foreground">작업하기 편한 화면 밝기를 선택해요.</p></div>
            <div className="space-y-1.5">
              <div id="theme-label" className="text-xs font-medium text-muted-foreground">
                테마
              </div>
              <div role="group" aria-labelledby="theme-label" className="flex flex-wrap gap-2">
                {(["light", "dark", "auto"] as const).map((t) => (
                  <Button
                    key={t}
                    aria-pressed={settings.theme === t}
                    variant={settings.theme === t ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSettings({ ...settings, theme: t })}
                  >
                    {THEME_LABELS[t]}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                시스템 설정을 선택하면 이 컴퓨터의 밝은 화면·어두운 화면 설정을 따라가요.
              </p>
            </div>
            </section>
            <section id="settings-files" aria-labelledby="settings-files-title" className="scroll-mt-6 space-y-5 rounded-2xl border border-border bg-card p-5">
              <div className="space-y-1"><h2 id="settings-files-title" className="text-base font-semibold">파일 변환</h2><p className="text-sm leading-6 text-muted-foreground">PDF 업로드와 결과물 내보내기에 필요한 도구를 확인해요.</p></div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                내보내기용 Chromium
              </label>
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <PlaywrightStateDot state={pw?.state ?? "idle"} />
                  <span className="text-xs" role="status">
                    {pwQuery.isError ? "설치 상태를 확인하지 못했어요." : pwLabel(pw)}
                  </span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      aria-label="Chromium 상태 다시 확인"
                      disabled={pwQuery.isFetching}
                      onClick={() => void pwQuery.refetch()}
                    >
                      <RefreshCw className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={handleInstallPlaywright}
                      disabled={
                        pwStarting || !pw || pwQuery.isError || pw?.state === "installing"
                      }
                    >
                      <Download className="h-3 w-3" />
                      {pw?.state === "installing"
                        ? "설치하는 중…"
                        : pw?.state === "success"
                          ? "다시 설치"
                          : "Chromium 설치"}
                    </Button>
                  </div>
                </div>
                {pwQuery.isError ? <SettingsLoadError title="Chromium 상태 조회 실패" error={pwQuery.error} retry={() => void pwQuery.refetch()} pending={pwQuery.isFetching} /> : null}
                {pw?.error && pw.state === "error" && (
                  <p role="alert" className="mt-2 text-xs leading-relaxed text-destructive">
                    설치하지 못했어요. 인터넷 연결과 저장 공간을 확인한 뒤 다시 설치해 주세요.
                  </p>
                )}
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  PDF·PPTX를 만들기 위한 브라우저예요. 처음 설치할 때 인터넷 연결과 충분한 저장 공간이 필요해요.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                업로드용 Python
              </label>
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <PyStateDot py={py} />
                  <span className="text-xs" role="status">{pyQuery.isError ? "설치 상태를 확인하지 못했어요." : pyLabel(py)}</span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      aria-label="Python 상태 다시 확인"
                      disabled={pyQuery.isFetching}
                      onClick={() => void pyQuery.refetch()}
                    >
                      <RefreshCw className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={handleInstallPypdf}
                      disabled={
                        pyStarting || !py || pyQuery.isError ||
                        py?.install.state === "installing" ||
                        py?.health.python.found === false
                      }
                      title={
                        py?.health.python.found === false
                          ? "먼저 Python 3.10 이상을 설치해 주세요"
                          : undefined
                      }
                    >
                      <Download className="h-3 w-3" />
                      {py?.install.state === "installing"
                        ? "설치하는 중…"
                        : py?.health.pypdf.found && !py.health.pypdf.supported
                          ? "pypdf 업데이트"
                          : py?.health.pypdf.found
                            ? "pypdf 다시 설치"
                            : "pypdf 설치"}
                    </Button>
                  </div>
                </div>
                {pyQuery.isError ? <SettingsLoadError title="Python 상태 조회 실패" error={pyQuery.error} retry={() => void pyQuery.refetch()} pending={pyQuery.isFetching} /> : null}
                {py?.install.error && py.install.state === "error" && (
                  <p role="alert" className="mt-2 text-xs leading-relaxed text-destructive">
                    설치하지 못했어요. Python과 인터넷 연결을 확인한 뒤 다시 설치해 주세요.
                  </p>
                )}
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  업로드한 PDF를 읽는 데 필요한 도구예요. Python이 준비되면 pypdf 설치를 눌러 주세요.
                </p>
              </div>
            </div>

            </section>
            <section id="settings-connections" aria-labelledby="settings-connections-title" className="scroll-mt-6 space-y-5 rounded-2xl border border-border bg-card p-5">
              <div className="space-y-1"><h2 id="settings-connections-title" className="text-base font-semibold">외부 연결</h2><p className="text-sm leading-6 text-muted-foreground">Figma의 색상과 텍스트 스타일을 가져와요.</p></div>
            <div className="space-y-1.5">
              <label htmlFor="figma-token" className="text-xs font-medium text-muted-foreground">
                Figma 연동
              </label>
              {settings.figma_token_set ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3 py-3 text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                    연결됨 — Figma 개인 액세스 토큰이 설정돼 있어요.
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={figmaTokenSaving}
                    onClick={() => saveFigmaToken(null)}
                  >
                    연결 해제
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    id="figma-token"
                    type="password"
                    disabled={figmaTokenSaving}
                    autoComplete="off"
                    placeholder="figd_..."
                    value={figmaTokenInput}
                    onChange={(e) => setFigmaTokenInput(e.target.value)}
                    className="flex-1 font-mono text-xs"
                  />
                  <Button
                    size="sm"
                    disabled={
                      figmaTokenSaving || figmaTokenInput.trim().length === 0
                    }
                    onClick={() => saveFigmaToken(figmaTokenInput.trim())}
                  >
                    {figmaTokenSaving ? "저장하는 중…" : "저장"}
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Figma 파일에서 공개된 색·텍스트 스타일을 가져올 때 사용해요.
                토큰은 Figma → Settings → Personal access tokens에서 만들 수
                있어요. 토큰 저장과 연결 해제는 즉시 적용되며, 아래 취소 버튼으로 되돌릴 수 없어요. 토큰은 이 컴퓨터에만 저장되고 화면에 다시 표시되지 않아요.
              </p>
            </div>

            </section>
          </fieldset>
        )}

          </div>
        </div>
        <DialogFooter className="shrink-0 flex-row items-center justify-end gap-2 border-t border-border bg-card px-5 py-4 sm:px-7">
          <p className="mr-auto hidden text-xs text-muted-foreground sm:block">일반 설정은 저장 후 적용돼요.</p>
          <Button variant="ghost" onClick={onClose} disabled={saving || figmaTokenSaving}>
            취소
          </Button>
          <Button variant="cta" onClick={save} disabled={saving || figmaTokenSaving || !settings}>
            {saving ? "저장하는 중…" : "저장"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsLoadError({ title, error, retry, pending }: { title: string; error: unknown; retry: () => void; pending: boolean }) {
  return <div role="alert" className="space-y-2 rounded-md border border-destructive/30 p-3 text-sm">
    <p>{title}</p>
    <p className="text-xs text-muted-foreground">{apiErrorCopy(error)}</p>
    <Button variant="outline" size="sm" onClick={retry} disabled={pending}>{pending ? "확인하는 중…" : "다시 시도"}</Button>
  </div>;
}

function PlaywrightStateDot({
  state,
}: {
  state: PlaywrightInstallStatus["state"];
}) {
  const color =
    state === "success"
      ? "bg-emerald-500"
      : state === "installing"
        ? "bg-amber-500 animate-pulse"
        : state === "error"
          ? "bg-red-500"
          : "bg-muted-foreground/40";
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function pwLabel(status: PlaywrightInstallStatus | null): string {
  if (!status) return "불러오는 중…";
  switch (status.state) {
    case "installing":
      return "Chromium을 설치하는 중이에요…";
    case "success":
      return "Chromium 설치를 마쳤어요.";
    case "error":
      return "지난 설치가 실패했어요.";
    default:
      return "설치되어 있지 않아요(또는 상태를 알 수 없어요).";
  }
}

function PyStateDot({ py }: { py: PythonSettings | null }) {
  // Collapse the compound (python + pypdf + install) state into the
  // same three colours the Chromium row uses so the two cards read
  // the same at a glance.
  let color = "bg-muted-foreground/40";
  if (py) {
    if (py.install.state === "installing") {
      color = "bg-amber-500 animate-pulse";
    } else if (!py.health.python.found) {
      color = "bg-red-500";
    } else if (py.health.pypdf.found && py.health.pypdf.supported) {
      color = "bg-emerald-500";
    } else if (py.health.pypdf.found) {
      color = "bg-amber-500";
    } else if (py.install.state === "error") {
      color = "bg-red-500";
    } else {
      color = "bg-muted-foreground/40";
    }
  }
  return <span className={`inline-block h-2 w-2 rounded-full ${color}`} />;
}

function pyLabel(py: PythonSettings | null): string {
  if (!py) return "불러오는 중…";
  if (py.install.state === "installing") return "pypdf를 설치하는 중이에요…";
  if (!py.health.python.found) {
    return "Python을 찾지 못했어요 — Python 3.10 이상을 설치해 주세요.";
  }
  if (py.health.pypdf.found && !py.health.pypdf.supported) {
    return `pypdf ${py.health.pypdf.version ?? ""}은(는) 지원하지 않는 버전이에요 — ${py.health.pypdf.required_version} 이상으로 업데이트해 주세요.`;
  }
  if (py.health.pypdf.found) {
    const ver = py.health.pypdf.version ? ` ${py.health.pypdf.version}` : "";
    return `사용할 수 있어요 — pypdf${ver} (${py.health.python.version ?? "Python"}).`;
  }
  if (py.install.state === "error") return "지난 pypdf 설치가 실패했어요.";
  return "pypdf가 아직 설치되지 않았어요.";
}
