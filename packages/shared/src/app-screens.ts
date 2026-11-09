import { decodeContract, isRecord, UpgradeContractError } from "./contract-parser";

export const APP_SCREEN_FRAMES = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
} as const;
export type AppScreenFramePreset = keyof typeof APP_SCREEN_FRAMES;
export const APP_SCREENS_DEFAULT_PRESET: AppScreenFramePreset = "phone";
export const APP_SCREENS_DEFAULT_FRAME = APP_SCREEN_FRAMES[APP_SCREENS_DEFAULT_PRESET];
export type AppScreenFrame = { readonly width: number; readonly height: number };
export type AppScreen = { readonly file: string; readonly title: string };
export type AppScreenSection = {
  readonly id: string;
  readonly name: string;
  readonly screens: readonly AppScreen[];
};
export type AppScreensManifest = {
  readonly schema_version: 1;
  readonly frame: AppScreenFrame;
  readonly sections: readonly AppScreenSection[];
};

export function parseAppScreenFrame(input: unknown): AppScreenFrame {
  if (!isRecord(input)) throw new UpgradeContractError("invalid_field", "app_screens_frame");
  const { width, height } = input;
  if (typeof width !== "number" || typeof height !== "number" ||
    !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
    width < 1 || height < 1 || width > 4096 || height > 4096) {
    throw new UpgradeContractError("invalid_field", "app_screens_frame");
  }
  return { width, height };
}

/** A missing or damaged stored preference still leaves the board usable. */
export function storedAppScreenFrame(options: string | null): AppScreenFrame {
  if (options === null) return APP_SCREENS_DEFAULT_FRAME;
  try {
    const record = decodeContract(options);
    return record["app_screens_frame"] === undefined ? APP_SCREENS_DEFAULT_FRAME : parseAppScreenFrame(record["app_screens_frame"]);
  } catch (error) {
    if (error instanceof UpgradeContractError) return APP_SCREENS_DEFAULT_FRAME;
    throw error;
  }
}

/** Portable canonical paths only; never normalize a traversal into an accepted path. */
export function isAppScreenPath(file: string): boolean {
  return /^screens\/[^\\?#%:\u0000-\u001f]+\.html$/iu.test(file) &&
    file.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !part.startsWith("."));
}

/** Unknown files are skipped after validating the complete authored inventory. */
export function parseAppScreensManifest(input: unknown, files: readonly string[]): AppScreensManifest {
  const root = decodeContract(input);
  if (root["schema_version"] !== 1 || !Array.isArray(root["sections"])) {
    throw new UpgradeContractError("invalid_field", "screens");
  }
  const seen = new Set<string>();
  const sectionIds = new Set<string>();
  const sections = root["sections"].map((section): AppScreenSection => {
    if (!isRecord(section) || typeof section["id"] !== "string" || !section["id"].trim() ||
      typeof section["name"] !== "string" || !section["name"].trim() || !Array.isArray(section["screens"]) ||
      sectionIds.has(section["id"])) throw new UpgradeContractError("invalid_field", "sections");
    sectionIds.add(section["id"]);
    const screens = section["screens"].flatMap((screen): AppScreen[] => {
      if (!isRecord(screen) || typeof screen["file"] !== "string" || !isAppScreenPath(screen["file"]) ||
        typeof screen["title"] !== "string" || !screen["title"].trim()) {
        throw new UpgradeContractError("invalid_field", "screens.file");
      }
      const key = screen["file"].normalize("NFC").toLowerCase();
      if (seen.has(key)) throw new UpgradeContractError("invalid_field", "screens.duplicate");
      seen.add(key);
      return files.includes(screen["file"]) ? [{ file: screen["file"], title: screen["title"] }] : [];
    });
    return { id: section["id"], name: section["name"], screens };
  });
  return { schema_version: 1, frame: parseAppScreenFrame(root["frame"]), sections };
}

export function fallbackAppScreens(files: readonly string[], frame: AppScreenFrame = APP_SCREENS_DEFAULT_FRAME): AppScreensManifest {
  return {
    schema_version: 1, frame,
    sections: [{
      id: "screens", name: "Screens",
      screens: files.filter(isAppScreenPath).sort().map((file) => ({
        file, title: file.slice("screens/".length, -".html".length),
      })),
    }],
  };
}

export function resolveAppScreensManifest(input: unknown, files: readonly string[], frame: AppScreenFrame = APP_SCREENS_DEFAULT_FRAME): AppScreensManifest {
  try {
    return parseAppScreensManifest(input, files);
  } catch (error) {
    if (error instanceof UpgradeContractError) return fallbackAppScreens(files, frame);
    throw error;
  }
}
