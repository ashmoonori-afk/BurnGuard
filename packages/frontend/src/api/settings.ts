import type { AppUpdateStatus, PlaywrightInstallStatus, PythonSettings } from "@bg/shared";
import { apiFetch } from "./client";

export async function getAppUpdateStatus(): Promise<AppUpdateStatus> {
  return apiFetch<AppUpdateStatus>("/api/settings/updates");
}

export async function checkAppUpdate(): Promise<AppUpdateStatus> {
  return apiFetch<AppUpdateStatus>("/api/settings/updates/check", { method: "POST" });
}

export async function applyAppUpdate(): Promise<{ accepted: true }> {
  return apiFetch<{ accepted: true }>("/api/settings/updates/apply", { method: "POST" });
}

export function waitForAppRestart(): Promise<void> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let inFlight = false;
    const finish = (error?: Error) => {
      clearInterval(interval);
      clearTimeout(deadline);
      controller.abort();
      if (error) reject(error);
      else resolve();
    };
    const deadline = setTimeout(() => finish(new Error("업데이트가 적용되는 동안 연결이 끊겼어요. BurnGuard를 다시 열어 주세요.")), 120_000);
    const interval = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        // Relaunch replaces API authority; health is public and must bypass apiFetch.
        const response = await fetch("/api/health", {
          cache: "no-store",
          credentials: "omit",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2000)]),
        });
        if (response.ok) finish();
      } catch {
        // Connection failures are expected during replacement; the deadline reports failure.
      } finally {
        inFlight = false;
      }
    }, 2000);
  });
}

export async function getPlaywrightInstallStatus(): Promise<PlaywrightInstallStatus> {
  return apiFetch<PlaywrightInstallStatus>("/api/settings/playwright");
}

export async function startPlaywrightInstall(): Promise<PlaywrightInstallStatus> {
  return apiFetch<PlaywrightInstallStatus>(
    "/api/settings/playwright/install",
    { method: "POST" },
  );
}

export async function getPythonSettings(): Promise<PythonSettings> {
  return apiFetch<PythonSettings>("/api/settings/python");
}

export async function startPypdfInstall(): Promise<PythonSettings> {
  return apiFetch<PythonSettings>("/api/settings/python/install", {
    method: "POST",
  });
}
