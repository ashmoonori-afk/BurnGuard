// Worker modes dispatch before any application module loads, so they never touch the profile, database or network.
if (process.argv.includes("--bg-image-palette")) {
  const { runImagePaletteProcess } = await import("./services/image-palette-process");
  await runImagePaletteProcess();
} else if (process.argv.includes("--bg-image-fingerprint")) {
  const { runImageFingerprintProcess } = await import("./services/image-fingerprint-process");
  await runImageFingerprintProcess();
} else if (process.argv.includes("--bg-chromium-probe")) {
  const { runChromiumProbeProcess } = await import("./services/chromium-capability");
  await runChromiumProbeProcess();
} else if (process.argv.includes("--bg-web-assets-mcp")) {
  const { runWebAssetsMcpServer } = await import("./services/web-assets-mcp");
  await runWebAssetsMcpServer();
} else {
  await import("./main");
}

export {};
