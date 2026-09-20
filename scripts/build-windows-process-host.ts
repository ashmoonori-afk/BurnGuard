#!/usr/bin/env bun
import { copyFile, mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { $ } from "bun";

const root = path.resolve(import.meta.dir, "..");

export async function buildWindowsProcessHost(): Promise<string> {
	if (process.platform !== "win32")
		throw new Error(
			"The Windows process host must be built on Windows with the .NET 8 SDK.",
		);
	if (!Bun.which("dotnet"))
		throw new Error(
			"The .NET 8 SDK is required to build the Windows process host.",
		);
	await mkdir(path.join(root, "dist"), { recursive: true });
	const distribution = await realpath(path.join(root, "dist"));
	const output = path.join(distribution, "windows-process-host");
	if (
		path.dirname(output) !== distribution ||
		path.basename(output) !== "windows-process-host"
	)
		throw new Error("Invalid process host output directory");
	await rm(output, { recursive: true, force: true });
	await mkdir(output);
	await $`dotnet build ${path.join(root, "packages/windows-process-host/BurnGuard.ProcessHost.csproj")} -c Release -o ${output} --nologo`.cwd(
		root,
	);
	const executable = path.join(output, "burnguard-windows-process-host.exe");
	const configuration = `${executable}.config`;
	const portable = path.join(distribution, "windows");
	await mkdir(portable, { recursive: true });
	await copyFile(
		executable,
		path.join(portable, "burnguard-windows-process-host.exe"),
	);
	await copyFile(
		configuration,
		path.join(portable, "burnguard-windows-process-host.exe.config"),
	);
	return executable;
}

if (import.meta.main) {
	const executable = await buildWindowsProcessHost();
	console.log(`[process-host] ${executable}`);
}
