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
  applyAppUpdate,
  checkAppUpdate,
  getAppUpdateStatus,
  waitForAppRestart,
  getPlaywrightInstallStatus,
  getPythonSettings,
  startPlaywrightInstall,
  startPypdfInstall,
} from "@/api/settings";
import { useUIStore } from "@/state/uiStore";
import { apiErrorCopy } from "@/lib/error-copy";
import { appUpdateView } from "@/lib/app-update-state";

import { t, useT, type MessageKey } from "@/i18n/t";
import { LOCALES, useLocaleStore } from "@/i18n/locale";
import ProviderConnections from "./ProviderConnections";

const CHAT_CONTEXT_MODE_LABELS = { compact: "settings.compact", full: "settings.full" } as const;
const THEME_LABELS = { light: "settings.light", dark: "settings.dark", auto: "settings.auto" } as const;
const LANGUAGE_NAMES = { ko: "한국어", en: "English", "zh-CN": "简体中文" } as const;

export default function SettingsModal() {
  const open = useUIStore((s) => s.settingsOpen);
  const setOpen = useUIStore((s) => s.setSettingsOpen);
  return open ? <SettingsDialog onClose={() => setOpen(false)} /> : null;
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const [providerSaving, setProviderSaving] = useState(false);
  const pushToast = useUIStore((s) => s.pushToast);
  const queryClient = useQueryClient();
  const [returnFocusTarget] = useState(() => typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const settingsQuery = useQuery({
    queryKey: ["settings", "dialog"], queryFn: getSettings, gcTime: 0,
  });
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateApplying, setUpdateApplying] = useState(false);
  const [updateError, setUpdateError] = useState<MessageKey | null>(null);
  const updateQuery = useQuery({
    queryKey: ["settings", "updates"], queryFn: getAppUpdateStatus,
    enabled: !updateApplying,
    refetchOnMount: "always", refetchOnWindowFocus: false, refetchOnReconnect: false,
    refetchInterval: (query) => !updateApplying && (updateChecking || (query.state.data && appUpdateView(query.state.data).busy)) ? 1500 : false,
  });
  const updateView = updateQuery.data ? appUpdateView(updateQuery.data) : null;
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
      pushToast({ title: t(value === null ? "settings.keyDeleted" : "settings.keySaved", { name: "CommandCode" }), tone: "success" });
    } catch (error) { pushToast({ title: t("settings.keyFailed", { name: "CommandCode" }), body: apiErrorCopy(error), tone: "error" }); }
    finally { setCommandcodeSaving(false); }
  }

  useEffect(() => {
    // Initialize once; background status/token updates must not replace edits.
    if (!settings && settingsQuery.data && !settingsQuery.isFetching) setSettings(settingsQuery.data);
  }, [settings, settingsQuery.data, settingsQuery.isFetching]);

  async function handleCheckUpdate() {
    setUpdateChecking(true);
    setUpdateError(null);
    try {
      const next = await checkAppUpdate();
      queryClient.setQueryData(["settings", "updates"], next);
    } catch {
      setUpdateError("settings.updateFailed");
    } finally {
      setUpdateChecking(false);
    }
  }

  async function handleApplyUpdate() {
    setUpdateApplying(true);
    setUpdateError(null);
    try {
      await applyAppUpdate();
    } catch {
      setUpdateError("settings.updateScheduleFailed");
      setUpdateApplying(false);
      return;
    }
    try {
      await waitForAppRestart();
      window.location.reload();
    } catch {
      setUpdateError("settings.updateDisconnected");
      setUpdateApplying(false);
    }
  }

  async function handleInstallPlaywright() {
    setPwStarting(true);
    try {
      const next = await startPlaywrightInstall();
      queryClient.setQueryData(["settings", "playwright"], next);
    } catch (err) {
      pushToast({
        title: t("settings.playwrightStartFailed"),
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
        title: t("settings.pypdfStartFailed"),
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
      pushToast({ title: t("settings.saved"), tone: "success" });
      onClose();
    } catch (err) {
      pushToast({
        title: t("settings.saveFailed"),
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
        title: t(value === null ? "settings.figmaDeleted" : "settings.figmaSaved"),
        tone: "success",
      });
    } catch (err) {
      pushToast({
        title: t("settings.figmaFailed"),
        body: apiErrorCopy(err),
        tone: "error",
      });
    } finally {
      setFigmaTokenSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(nextOpen) => { if (!nextOpen && !saving && !figmaTokenSaving && !commandcodeSaving && !providerSaving && !updateApplying) onClose(); }}>
      <DialogContent className="flex h-[min(780px,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0" onCloseAutoFocus={(event) => { if (returnFocusTarget?.isConnected) { event.preventDefault(); returnFocusTarget.focus(); } }}>
        <DialogHeader className="shrink-0 border-b border-border px-5 py-5 pr-12 sm:px-7">
          <DialogTitle className="text-xl">{t("settings.title")}</DialogTitle>
          <DialogDescription>
            {t("settings.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav aria-label={t("settings.sections")} className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-muted/30 p-3 md:w-44 md:flex-col md:border-b-0 md:border-r md:p-4">
            {[{ id: "user", title: t("settings.user"), icon: UserRound }, { id: "generation", title: t("settings.generation"), icon: Sparkles }, { id: "appearance", title: t("settings.appearance"), icon: Monitor }, { id: "files", title: t("settings.files"), icon: FileOutput }, { id: "connections", title: t("settings.connections"), icon: Link2 }].map(({ id, title, icon: Icon }) => <button key={id} type="button" onClick={() => document.getElementById(`settings-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" })} className="flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Icon className="h-4 w-4" aria-hidden="true" />{title}</button>)}
          </nav>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain bg-muted/15 p-4 sm:p-6">
        {!settings && settingsQuery.isError ? (
          <SettingsLoadError title={t("settings.loadFailed")} error={settingsQuery.error} retry={() => void settingsQuery.refetch()} pending={settingsQuery.isFetching} />
        ) : !settings ? (
          <div role="status" className="py-8 text-center text-sm text-muted-foreground">
            {t("settings.loading")}
          </div>
        ) : (
          <fieldset disabled={saving || updateApplying} className="min-w-0 space-y-5">
            <legend className="sr-only">{t("settings.general")}</legend>
            <section id="settings-user" aria-labelledby="settings-user-title" className="scroll-mt-6 space-y-5 rounded-2xl border border-border bg-card p-5">
              <div className="space-y-1"><h2 id="settings-user-title" className="text-base font-semibold">{t("settings.user")}</h2><p className="text-sm leading-6 text-muted-foreground">{t("settings.userHint")}</p></div>
            <div className="space-y-1.5">
              <label
                htmlFor="display-name"
                className="text-xs font-medium text-muted-foreground"
              >
                {t("settings.displayName")}
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
              <div className="space-y-1"><h2 id="settings-generation-title" className="text-base font-semibold">{t("settings.generation")}</h2><p className="text-sm leading-6 text-muted-foreground">{t("settings.generationHint")}</p></div>
            {detectionQuery.data ? <BackendSelector
              value={settings.default_backend}
              onChange={(b) =>
                setSettings({ ...settings, default_backend: b })
              }
              detection={detectionQuery.data}
            /> : detectionQuery.isPending ? <p role="status" className="text-sm text-muted-foreground">{t("settings.backendChecking")}</p> : null}
            {detectionQuery.isError ? <SettingsLoadError title={t("settings.backendFailed")} error={detectionQuery.error} retry={() => void detectionQuery.refetch()} pending={detectionQuery.isFetching} /> : null}
            <GenerationControls backendId={settings.default_backend} value={settings.generation_defaults?.[settings.default_backend] ?? defaultGenerationOptions(settings.default_backend)} onChange={(generation) => setSettings({ ...settings, generation_defaults: { ...settings.generation_defaults, [settings.default_backend]: generation } })} />
            <div className="space-y-2 rounded-xl border border-border p-3">
              <label htmlFor="commandcode-api-key" className="text-sm font-medium">{t("settings.commandcodeKey")}</label>
              <p className="text-xs text-muted-foreground">{t("settings.commandcodeHint")} {t(settings.commandcode_api_key_set ? "settings.keySet" : "settings.keyUnset")}</p>
              <Input id="commandcode-api-key" type="password" autoComplete="new-password" value={commandcodeKey} onChange={(event) => setCommandcodeKey(event.target.value)} placeholder={t("settings.keyInput")} disabled={commandcodeSaving} />
              <div className="flex gap-2"><Button type="button" size="sm" disabled={commandcodeSaving || !commandcodeKey.trim()} onClick={() => void saveCommandcodeKey(commandcodeKey)}>{t("settings.keySave")}</Button><Button type="button" size="sm" variant="outline" disabled={commandcodeSaving || !settings.commandcode_api_key_set} onClick={() => void saveCommandcodeKey(null)}>{t("settings.keyDelete")}</Button></div>
            </div>

            <div className="space-y-1.5">
              <div id="chat-context-label" className="text-xs font-medium text-muted-foreground">
                {t("settings.context")}
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
                    {t(CHAT_CONTEXT_MODE_LABELS[mode])}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("settings.contextHint")}
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="abort-threshold"
                className="text-xs font-medium text-muted-foreground"
              >
                {t("settings.abortThreshold")}
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
                {t("settings.abortHint")}
              </p>
            </div>

            </section>
            <section id="settings-appearance" aria-labelledby="settings-appearance-title" className="scroll-mt-6 space-y-5 rounded-2xl border border-border bg-card p-5">
              <div className="space-y-1"><h2 id="settings-appearance-title" className="text-base font-semibold">{t("settings.appearance")}</h2><p className="text-sm leading-6 text-muted-foreground">{t("settings.appearanceHint")}</p></div>
            <div className="space-y-1.5">
              <div id="theme-label" className="text-xs font-medium text-muted-foreground">
                {t("settings.theme")}
              </div>
              <div role="group" aria-labelledby="theme-label" className="flex flex-wrap gap-2">
                {(["light", "dark", "auto"] as const).map((theme) => (
                  <Button
                    key={theme}
                    aria-pressed={settings.theme === theme}
                    variant={settings.theme === theme ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSettings({ ...settings, theme })}
                  >
                    {t(THEME_LABELS[theme])}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("settings.themeHint")}
              </p>
            </div>
            <div className="space-y-1.5">
              <div id="language-label" className="text-xs font-medium text-muted-foreground">{t("settings.language")}</div>
              <fieldset aria-labelledby="language-label" className="flex flex-wrap gap-2">
                {LOCALES.map((language) => <Button key={language} type="button" lang={language} aria-pressed={locale === language} variant={locale === language ? "default" : "outline"} size="sm" onClick={() => setLocale(language)}>{LANGUAGE_NAMES[language]}</Button>)}
              </fieldset>
              <p className="text-xs text-muted-foreground">{t("settings.languageHint")}</p>
            </div>
            </section>
            <section id="settings-files" aria-labelledby="settings-files-title" className="scroll-mt-6 space-y-5 rounded-2xl border border-border bg-card p-5">
              <div className="space-y-1"><h2 id="settings-files-title" className="text-base font-semibold">{t("settings.files")}</h2><p className="text-sm leading-6 text-muted-foreground">{t("settings.filesHint")}</p></div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t("settings.chromium")}
              </label>
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <PlaywrightStateDot state={pw?.state ?? "idle"} />
                  <span className="text-xs" role="status">
                    {pwQuery.isError ? t("settings.installStatusFailed") : pwLabel(pw)}
                  </span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      aria-label={t("settings.chromiumRefresh")}
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
                      {t(pw?.state === "installing" ? "settings.installing" : pw?.state === "success" ? "settings.reinstall" : "settings.chromiumInstall")}
                    </Button>
                  </div>
                </div>
                {pwQuery.isError ? <SettingsLoadError title={t("settings.chromiumFailed")} error={pwQuery.error} retry={() => void pwQuery.refetch()} pending={pwQuery.isFetching} /> : null}
                {pw?.error && pw.state === "error" && (
                  <p role="alert" className="mt-2 text-xs leading-relaxed text-destructive">
                    {t("settings.chromiumInstallFailed")}
                  </p>
                )}
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {t("settings.chromiumHint")}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {t("settings.python")}
              </label>
              <div className="rounded-md border border-border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <PyStateDot py={py} />
                  <span className="text-xs" role="status">{pyQuery.isError ? t("settings.installStatusFailed") : pyLabel(py)}</span>
                  <div className="ml-auto flex items-center gap-1.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      aria-label={t("settings.pythonRefresh")}
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
                          ? t("settings.pythonRequired")
                          : undefined
                      }
                    >
                      <Download className="h-3 w-3" />
                      {t(py?.install.state === "installing" ? "settings.installing" : py?.health.pypdf.found && !py.health.pypdf.supported ? "settings.pypdfUpdate" : py?.health.pypdf.found ? "settings.pypdfReinstall" : "settings.pypdfInstall")}
                    </Button>
                  </div>
                </div>
                {pyQuery.isError ? <SettingsLoadError title={t("settings.pythonFailed")} error={pyQuery.error} retry={() => void pyQuery.refetch()} pending={pyQuery.isFetching} /> : null}
                {py?.install.error && py.install.state === "error" && (
                  <p role="alert" className="mt-2 text-xs leading-relaxed text-destructive">
                    {t("settings.pythonInstallFailed")}
                  </p>
                )}
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {t("settings.pythonHint")}
                </p>
              </div>
            </div>

            {updateView?.visible !== false ? (
              <section className="space-y-1.5" aria-labelledby="settings-updates-title">
                <h3 id="settings-updates-title" className="text-xs font-medium text-muted-foreground">{t("settings.updates")}</h3>
                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${updateApplying || updateChecking || updateView?.busy ? "bg-amber-500 animate-pulse" : updateError || updateQuery.isError || updateQuery.data?.state === "error" ? "bg-red-500" : updateView?.canApply || (updateQuery.data?.state === "idle" && updateQuery.data.checked_at !== null) ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                    <span className="min-w-0 flex-1 text-xs" role="status">
                      {updateApplying ? t("settings.updateApplying") : updateQuery.isError ? t("settings.updateFailed") : updateView?.label ?? t("settings.loading")}
                    </span>
                    <div className="ml-auto flex w-full flex-wrap items-center justify-end gap-1.5 sm:w-auto">
                      <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={handleCheckUpdate} disabled={!updateView?.canCheck || updateChecking || updateApplying}>
                        <RefreshCw className="h-3 w-3" aria-hidden="true" />{t("settings.updateCheck")}
                      </Button>
                      {updateView?.canApply ? <Button type="button" variant="outline" size="sm" onClick={handleApplyUpdate} disabled={updateChecking || updateApplying}>{t("settings.updateApply")}</Button> : null}
                    </div>
                  </div>
                  {updateError ? <p role="alert" className="mt-2 text-xs leading-relaxed text-destructive">{t(updateError)}</p> : null}
                  {updateQuery.isError && !updateApplying ? <SettingsLoadError title={t("settings.updateStatusFailed")} error={updateQuery.error} retry={() => void updateQuery.refetch()} pending={updateQuery.isFetching} /> : null}
                </div>
              </section>
            ) : null}

            </section>
            <section id="settings-connections" aria-labelledby="settings-connections-title" className="scroll-mt-6 space-y-5 rounded-2xl border border-border bg-card p-5">
              <div className="space-y-1"><h2 id="settings-connections-title" className="text-base font-semibold">{t("settings.connections")}</h2><p className="text-sm leading-6 text-muted-foreground">{t("settings.connectionsHint")}</p></div>
            <div className="space-y-1.5">
              <label htmlFor="figma-token" className="text-xs font-medium text-muted-foreground">
                {t("settings.figma")}
              </label>
              {settings.figma_token_set ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3 py-3 text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                    {t("settings.figmaConnected")}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={figmaTokenSaving}
                    onClick={() => saveFigmaToken(null)}
                  >
                    {t("settings.disconnect")}
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
                    {t(figmaTokenSaving ? "settings.saving" : "settings.save")}
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {t("settings.figmaHint")}
              </p>
            </div>

            <ProviderConnections connections={settings.llm_connections} onSavingChange={setProviderSaving} onSaved={(next) => setSettings((draft) => draft ? { ...draft, llm_connections: next.llm_connections } : next)} />
            </section>
          </fieldset>
        )}

          </div>
        </div>
        <DialogFooter className="shrink-0 flex-row items-center justify-end gap-2 border-t border-border bg-card px-5 py-4 sm:px-7">
          <p className="mr-auto hidden text-xs text-muted-foreground sm:block">{t("settings.saveHint")}</p>
          <Button variant="ghost" onClick={onClose} disabled={saving || figmaTokenSaving || commandcodeSaving || providerSaving || updateApplying}>
            {t("settings.cancel")}
          </Button>
          <Button variant="cta" onClick={save} disabled={saving || figmaTokenSaving || commandcodeSaving || providerSaving || updateApplying || !settings}>
            {t(saving ? "settings.saving" : "settings.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsLoadError({ title, error, retry, pending }: { title: string; error: unknown; retry: () => void; pending: boolean }) {
  const t = useT();
  return <div role="alert" className="space-y-2 rounded-md border border-destructive/30 p-3 text-sm">
    <p>{title}</p>
    <p className="text-xs text-muted-foreground">{apiErrorCopy(error)}</p>
    <Button variant="outline" size="sm" onClick={retry} disabled={pending}>{t(pending ? "settings.checking" : "settings.retry")}</Button>
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
  if (!status) return t("settings.loading");
  switch (status.state) {
    case "installing":
      return t("settings.chromiumInstalling");
    case "success":
      return t("settings.chromiumInstalled");
    case "error":
      return t("settings.lastInstallFailed");
    default:
      return t("settings.notInstalled");
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
  if (!py) return t("settings.loading");
  if (py.install.state === "installing") return t("settings.pypdfInstalling");
  if (!py.health.python.found) {
    return t("settings.pythonMissing");
  }
  if (py.health.pypdf.found && !py.health.pypdf.supported) {
    return t("settings.pypdfUnsupported", { version: py.health.pypdf.version ?? "", required: py.health.pypdf.required_version });
  }
  if (py.health.pypdf.found) {
    const ver = py.health.pypdf.version ? ` ${py.health.pypdf.version}` : "";
    return t("settings.pypdfReady", { version: ver, python: py.health.python.version ?? "Python" });
  }
  if (py.install.state === "error") return t("settings.pypdfLastFailed");
  return t("settings.pypdfMissing");
}
