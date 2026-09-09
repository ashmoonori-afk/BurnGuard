#!/usr/bin/env bun
/**
 * macOS build (P3.10): produces a .app bundle under `dist/mac/` and,
 * when run ON macOS, packages it into a .dmg under `dist/`.
 *
 * The Bun compile step is cross-platform: `--target=bun-darwin-arm64`
 * works on Windows too. The .app wrapper is pure file ops so it also
 * works anywhere. Only the final `hdiutil create` step needs to run
 * on macOS — on other platforms the script skips it and logs the
 * manual command to run locally.
 *
 * Call paths:
 *   - `bun run build:mac`         → binary + .app
 *   - `bun run build:mac:dmg`     → + dmg (macOS only)
 */
import { $ } from "bun";
import { createHash } from "node:crypto";
import {
  chmodSync,
  createReadStream,
  cpSync,
  existsSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { APP_VERSION } from "../packages/shared/src/app";
import { stageRuntimeAssets } from "./package-runtime";

const ROOT = path.resolve(import.meta.dir, "..");
const DIST_ROOT = path.join(ROOT, "dist");
const MAC_DIR = path.join(DIST_ROOT, "mac");
const APP_NAME = "BurnGuard Design";
const APP_BUNDLE = path.join(MAC_DIR, `${APP_NAME}.app`);
const APP_CONTENTS = path.join(APP_BUNDLE, "Contents");
const APP_MACOS = path.join(APP_CONTENTS, "MacOS");
const APP_RESOURCES = path.join(APP_CONTENTS, "Resources");
const BIN_NAME = "burnguard-design";
const ENTRY = path.join(ROOT, "packages/backend/src/index.ts");
const FRONTEND_DIST = path.join(ROOT, "packages/frontend/dist");
const ICON_SRC = path.join(ROOT, "assets/icon.icns");
const DMG_OUT = path.join(
  DIST_ROOT,
  `${APP_NAME.toLowerCase().replaceAll(" ", "-")}-${APP_VERSION}.dmg`,
);

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>${BIN_NAME}</string>
  <key>CFBundleIdentifier</key>
  <string>com.burnguard.design</string>
  <key>CFBundleName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleDisplayName</key>
  <string>${APP_NAME}</string>
  <key>CFBundleShortVersionString</key>
  <string>${APP_VERSION}</string>
  <key>CFBundleVersion</key>
  <string>${APP_VERSION}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleIconFile</key>
  <string>icon</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>LSApplicationCategoryType</key>
  <string>public.app-category.developer-tools</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`;

async function main() {
  const wantDmg = process.argv.includes("--dmg");

  if (!existsSync(ENTRY)) {
    console.error(`[build-mac] entry not found: ${ENTRY}`);
    process.exit(1);
  }

  if (!existsSync(FRONTEND_DIST)) {
    throw new Error("Frontend build is required before packaging the macOS app");
  }

  mkdirSync(MAC_DIR, { recursive: true });
  mkdirSync(APP_MACOS, { recursive: true });
  mkdirSync(APP_RESOURCES, { recursive: true });

  const binOut = path.join(APP_MACOS, BIN_NAME);
  console.log(`[build-mac] version: ${APP_VERSION}`);
  console.log(`[build-mac] entry:   ${ENTRY}`);
  console.log(`[build-mac] bundle:  ${APP_BUNDLE}`);
  console.log(`[build-mac] target:  bun-darwin-arm64`);

  const startCompile = Date.now();
  // `--external electron`: playwright-core has an optional
  // electron loader module we never reach at runtime (we only
  // drive headless chromium). Leaving it bundled makes bun fail
  // the compile with "Could not resolve electron". Externalising
  // turns the import into a null resolution that throws only if
  // the loader is ever actually called — which it isn't in our
  // code path.
  await $`bun build ${ENTRY} \
    --compile \
    --target=bun-darwin-arm64 \
    --minify \
    --external electron \
    --external chromium-bidi \
    --outfile ${binOut}`.cwd(ROOT);
  console.log(
    `[build-mac] compiled in ${((Date.now() - startCompile) / 1000).toFixed(1)}s`,
  );

  // Mark the binary executable. On Windows this is a no-op but
  // codifies intent; on Unix-like tar users (e.g. zipping the .app
  // before upload) the flag survives.
  try {
    chmodSync(binOut, 0o755);
  } catch {
    // Windows filesystems ignore the mode bits; DMG mounting on
    // macOS re-applies them from the HFS+ metadata in the image.
  }

  writeFileSync(path.join(APP_CONTENTS, "Info.plist"), INFO_PLIST, "utf8");

  if (existsSync(ICON_SRC)) {
    cpSync(ICON_SRC, path.join(APP_RESOURCES, "icon.icns"));
    console.log(`[build-mac] icon:    embedded ${path.basename(ICON_SRC)}`);
  } else {
    console.log(
      `[build-mac] icon:    assets/icon.icns not found — using the macOS default app icon (follow-up slice will add a real icon)`,
    );
  }

  await stageRuntimeAssets(ROOT, APP_MACOS);
  console.log("[build-mac] frontend, migrations, themes, and browser resources staged");

  const signIdentity = process.env.BG_MAC_SIGN_IDENTITY;
  if (signIdentity) {
    console.log(`[build-mac] signing app`);
    await $`codesign --force --deep --options runtime --timestamp --sign ${signIdentity} ${APP_BUNDLE}`;
    await $`codesign --verify --deep --strict --verbose=2 ${APP_BUNDLE}`;
  } else {
    console.log("[build-mac] signing skipped (set BG_MAC_SIGN_IDENTITY)");
  }

  console.log(`[build-mac] .app ready: ${APP_BUNDLE}`);
  const artifacts = [binOut];

  if (!wantDmg) {
    console.log(
      `[build-mac] skipping dmg (pass --dmg or run \`bun run build:mac:dmg\` on macOS)`,
    );
  } else if (process.platform !== "darwin") {
    console.warn(
      `[build-mac] dmg step needs macOS (hdiutil). Current platform: ${process.platform}.`,
    );
    console.warn(
      `[build-mac] run this on Mac to finish packaging:\n  hdiutil create -volname "${APP_NAME}" -srcfolder "${APP_BUNDLE}" -ov -format UDZO "${DMG_OUT}"`,
    );
  } else {
    console.log(`[build-mac] packaging dmg → ${DMG_OUT}`);
    await $`hdiutil create -volname ${APP_NAME} -srcfolder ${APP_BUNDLE} -ov -format UDZO ${DMG_OUT}`;
    console.log(`[build-mac] dmg ready: ${DMG_OUT}`);

    const notaryProfile = process.env.BG_MAC_NOTARY_PROFILE;
    if (notaryProfile) {
      console.log(`[build-mac] notarizing dmg`);
      await $`xcrun notarytool submit ${DMG_OUT} --keychain-profile ${notaryProfile} --wait`;
      await $`xcrun stapler staple ${DMG_OUT}`;
    } else {
      console.log("[build-mac] notarization skipped (set BG_MAC_NOTARY_PROFILE)");
    }
    artifacts.push(DMG_OUT);
  }

  const checksums: string[] = [];
  for (const artifact of artifacts) {
    if (!existsSync(artifact)) continue;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(artifact)) hash.update(chunk);
    const relativePath = path.relative(DIST_ROOT, artifact).split(path.sep).join("/");
    checksums.push(`${hash.digest("hex")}  ${relativePath}`);
  }
  const sumsOut = path.join(DIST_ROOT, "SHA256SUMS");
  writeFileSync(sumsOut, `${checksums.join("\n")}\n`, "utf8");
  console.log(`[build-mac] checksums ready: ${sumsOut}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
