// Worker modes dispatch before any application module loads, so they never touch the profile, database or network.
if (process.argv.includes("--bg-image-palette")) {
  const { runImagePaletteProcess } = await import("./services/image-palette-process");
  await runImagePaletteProcess();
} else if (process.argv.includes("--bg-chromium-probe")) {
  const { runChromiumProbeProcess } = await import("./services/chromium-capability");
  await runChromiumProbeProcess();
} else {
  await import("./main");
}

export {};
