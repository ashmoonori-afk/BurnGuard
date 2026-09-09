import { Hono } from "hono";
import { getLocalFonts } from "../services/local-fonts";
import type {
  ApiErrorBody,
  ApiSuccess,
  PlaywrightInstallStatus,
  PythonSettings,
} from "@bg/shared";
import {
  getPlaywrightInstallStatus,
  startPlaywrightInstall,
} from "../services/playwright-install";
import {
  checkPythonRuntime,
  getCachedPythonHealth,
  getPypdfInstallStatus,
  startPypdfInstall,
} from "../services/python-health";
import { PYPDF_REQUIRED_VERSION } from "../services/pypdf-version";

function ok<T>(data: T): ApiSuccess<T> {
  return { data };
}

function fail(code: string, message: string, details?: unknown): ApiErrorBody {
  return { error: { code, message, details } };
}

export const settingsRoutes = new Hono();

settingsRoutes.get("/api/settings/local-fonts", async (c) => {
  try { return c.json(ok(await getLocalFonts())); }
  catch { return c.json(fail("local_fonts_unavailable", "Local font listing is unavailable"), 503); }
});

settingsRoutes.get("/api/settings/playwright", (c) => {
  return c.json(ok(getPlaywrightInstallStatus() satisfies PlaywrightInstallStatus));
});

settingsRoutes.post("/api/settings/playwright/install", (c) => {
  const result = startPlaywrightInstall();
  if (!result.started) {
    return c.json(
      fail("install_in_progress", "A Playwright install is already running"),
      409,
    );
  }
  return c.json(
    ok(getPlaywrightInstallStatus() satisfies PlaywrightInstallStatus),
    202,
  );
});

settingsRoutes.get("/api/settings/python", async (c) => {
  // Refresh unless an install is running (we don't want to race a
  // probe with the subprocess it just upgraded). On first boot this
  // kicks off the probe synchronously so the UI doesn't need to poll
  // for an initial value.
  const install = getPypdfInstallStatus();
  const health =
    install.state === "installing"
      ? (getCachedPythonHealth() ?? (await checkPythonRuntime()))
      : await checkPythonRuntime();
  return c.json(ok({ health, install } satisfies PythonSettings));
});

settingsRoutes.post("/api/settings/python/install", (c) => {
  const result = startPypdfInstall();
  if (!result.started) {
    if (result.reason === "python_not_found") {
      return c.json(
        fail(
          "python_not_found",
          "Install Python 3.10+ before installing pypdf",
        ),
        409,
      );
    }
    return c.json(
      fail(
        "install_in_progress",
        result.reason === "install_in_progress"
          ? "A pypdf install is already running"
          : "Could not spawn pip install",
      ),
      409,
    );
  }
  return c.json(
    ok({
      health: getCachedPythonHealth() ?? {
        python: { found: false, executable: null, version: null },
        pypdf: { found: false, version: null, supported: false, required_version: PYPDF_REQUIRED_VERSION },
        checked_at: Date.now(),
      },
      install: getPypdfInstallStatus(),
    } satisfies PythonSettings),
    202,
  );
});
