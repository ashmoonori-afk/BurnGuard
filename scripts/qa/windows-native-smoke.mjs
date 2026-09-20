#!/usr/bin/env node
// Real packaged WebView2 window and product canvas/export flow in an isolated profile.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const release = process.argv[2] === "--release";
if (process.argv.length > (release ? 3 : 2))
	throw new Error(
		"Usage: node scripts/qa/windows-native-smoke.mjs [--release]",
	);
if (process.platform !== "win32")
	throw new Error("Windows and the WebView2 Runtime are required.");
const parent = await realpath(tmpdir());
const fixture = await mkdtemp(path.join(parent, "burnguard-native-"));
const app = path.join(fixture, "한글 native app");
const profile = path.join(fixture, "profile");
const evidence = path.join(repo, ".omo/evidence/windows-native-2026-09-09");
const port = 14175;
const checks = [];
let child;
let guard;
let receipt;
const env = {
	...process.env,
	BG_APP_ROOT: profile,
	BG_PORT: String(port),
	BG_NO_OPEN: "1",
};
try {
	await mkdir(evidence, { recursive: true });
	if (release) {
		await mkdir(app);
		const archive = path.join(repo, "dist/releases/BurnGuard-win-Portable.zip");
		assert.ok((await stat(archive)).size > 0, "release ZIP must exist and contain bytes");
		const extractor = path.join(fixture, "extract-portable.ps1");
		await writeFile(extractor, "param([string]$Archive,[string]$Destination)\n$ErrorActionPreference='Stop'\nExpand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force\n");
		const extract = spawn(
			"pwsh.exe",
			[
				"-NoLogo",
				"-NoProfile",
				"-NonInteractive",
				"-ExecutionPolicy",
				"Bypass",
				"-File",
				extractor,
				archive,
				app,
			],
			{ windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
		);
		const extractError = [];
		extract.stderr.on("data", (chunk) => extractError.push(chunk));
		const [extractCode] = await bounded(once(extract, "exit"), 180_000, () => extract.kill());
		assert.equal(extractCode, 0, `release ZIP extraction must succeed: ${Buffer.concat(extractError).toString("utf8").trim()}`);
		const version = JSON.parse(
			await readFile(path.join(repo, "package.json"), "utf8"),
		).version;
		assert.ok(
			(await readFile(path.join(app, "current/sq.version"), "utf8")).includes(
				`<version>${version}</version>`,
			),
		);
		checks.push("velopack-portable-layout");
	} else
		await cp(path.join(repo, "dist/windows-native"), app, { recursive: true });
	await mkdir(profile);
	const report = path.join(fixture, "smoke.json");
	guard = createServer();
	guard.listen(port, "127.0.0.1");
	await once(guard, "listening");
	assert.equal(
		await run(report, "collision-probe"),
		1,
		"an occupied port must refuse startup",
	);
	assert.equal(JSON.parse(await readFile(report, "utf8")).ok, false);
	await assert.rejects(readFile(path.join(profile, "burnguard.db")), {
		code: "ENOENT",
	});
	checks.push("port-collision-refuses-before-profile-mutation");
	await new Promise((resolve) => guard.close(resolve));
	guard = null;

	const seeded = await seedLogoFixture();
	checks.push("owned-provider-free-logo-fixture");
	await rm(report, { force: true });
	const nativeExit = await run(report, seeded.projectId);
	receipt = JSON.parse(await readFile(report, "utf8"));
	assert.equal(nativeExit, 0, "real native smoke must exit successfully");
	assert.equal(receipt.ok, true);
	assert.equal(receipt.dom.origin, `http://127.0.0.1:${port}`);
	assert.equal(receipt.dom.projectId, seeded.projectId);
	assert.equal(receipt.dom.canvasReady, true);
	assert.equal(receipt.dom.savePersisted, true);
	assert.equal(receipt.dom.reloadPersisted, true);
	assert.equal(receipt.dom.exportsCompleted, true);
	assert.equal(receipt.dom.savedRevision, receipt.dom.baseRevision + 1);
	assert.equal(receipt.dom.reloadedRevision, receipt.dom.savedRevision);
	checks.push("actual-product-canvas-save-reload");

	const svg = await validateArtifact(
		receipt.artifacts.svg,
		"svg",
		receipt.dom.exports.svg.sha256,
	);
	const pdf = await validateArtifact(
		receipt.artifacts.pdf,
		"pdf",
		receipt.dom.exports.pdf.sha256,
	);
	assert.equal(receipt.dom.exports.svg.bytes, svg.bytes);
	assert.equal(receipt.dom.exports.pdf.bytes, pdf.bytes);
	checks.push("actual-svg-and-pdf-export-native-download-format-hash");
	assert.ok((await readFile(path.join(profile, "burnguard.db"))).length > 0);
	assert.throws(
		() => process.kill(receipt.servicePid, 0),
		{ code: "ESRCH" },
		"owned service must exit with the native window",
	);
	guard = createServer();
	guard.listen(port, "127.0.0.1");
	await once(guard, "listening");
	checks.push("window-close-stops-owned-service-and-releases-port");

	await cp(receipt.screenshot, path.join(evidence, "native-window.png"));
	await cp(
		receipt.artifacts.svg.path,
		path.join(evidence, "native-export.svg"),
	);
	await cp(
		receipt.artifacts.pdf.path,
		path.join(evidence, "native-export.pdf"),
	);
	const result = {
		ok: true,
		release,
		checks,
		startupElapsedMs: receipt.startupElapsedMs,
		webViewVersion: receipt.webViewVersion,
		dom: receipt.dom,
		artifacts: { svg, pdf },
		fixture: { providerExecuted: false, projectType: "logo" },
	};
	await writeFile(
		path.join(
			evidence,
			release ? "release-native-smoke.json" : "native-smoke.json",
		),
		JSON.stringify(result, null, 2),
	);
	console.log(JSON.stringify(result));
} catch (error) {
	const failure = { ok: false, checks, error: error.message, native: receipt };
	await writeFile(
		path.join(
			evidence,
			release
				? "release-native-smoke-failure.json"
				: "native-smoke-failure.json",
		),
		JSON.stringify(failure, null, 2),
	);
	console.error(JSON.stringify(failure));
	process.exitCode = 1;
} finally {
	if (guard?.listening) await new Promise((resolve) => guard.close(resolve));
	if (child?.exitCode === null) {
		const exited = once(child, "exit");
		child.kill(); // The native Windows job owns cleanup of its service children.
		await bounded(exited, 15_000);
	}
	const owned = await realpath(fixture);
	assert.equal(path.dirname(owned), parent);
	assert.ok(path.basename(owned).startsWith("burnguard-native-"));
	await rm(owned, {
		recursive: true,
		force: true,
		maxRetries: 10,
		retryDelay: 300,
	});
}

async function seedLogoFixture() {
	const seedPath = path.join(fixture, "seed-native-logo.ts");
	const seedModule = pathToFileURL(
		path.join(repo, "packages/backend/src/db/seed.ts"),
	).href;
	const migrateModule = pathToFileURL(
		path.join(repo, "packages/backend/src/db/migrate-local.ts"),
	).href;
	const sqliteModule = pathToFileURL(
		path.join(repo, "packages/backend/src/db/sqlite-client.ts"),
	).href;
	const pages = Array.from(
		{ length: 8 },
		(_, index) =>
			`<section data-graphic-artboard style="width:1920px;height:1080px;background:${index % 2 ? "#172554" : "#fff7ed"};color:${index % 2 ? "#fff7ed" : "#172554"}">${index === 0 ? '<h1 data-bg-node-id="native-windows-title">NATIVE_WINDOWS_BASELINE</h1>' : `<h2>Native guideline ${index + 1}</h2>`}<p>Deterministic Windows package acceptance ${index + 1}</p></section>`,
	).join("");
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Native Windows logo acceptance</title><style>*{box-sizing:border-box}html,body{margin:0}body{font-family:Arial,sans-serif}[data-graphic-artboard]{position:relative;overflow:hidden;padding:128px;display:grid;place-content:center;gap:24px}h1{position:absolute;inset:0;margin:0;display:grid;place-items:center;font-size:104px}h2{margin:0;font-size:96px}p{font-size:28px}</style></head><body>${pages}</body></html>`;
	const logo =
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><title>Native Windows QA mark</title><rect x="48" y="48" width="416" height="416" rx="96" fill="#172554"/><path d="M144 320 L256 128 L368 320 Z" fill="#f97316"/><circle cx="256" cy="320" r="48" fill="#fff7ed"/></svg>';
	await writeFile(
		seedPath,
		`
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createProjectRecord } from ${JSON.stringify(seedModule)};
import { runMigrations } from ${JSON.stringify(migrateModule)};
import { closeSqlite } from ${JSON.stringify(sqliteModule)};
await runMigrations();
const created = await createProjectRecord({
  name: "Native Windows Logo Acceptance", type: "logo", designSystemId: null, backendId: "codex",
  optionsJson: JSON.stringify({ logo_set: { schema_version: 1, brand_name: "Native Windows Logo Acceptance", niche: "Release QA", character: ["deterministic", "native"], logo_type: "combination", symbol_keywords: ["shield", "signal"] } }),
  entrypoint: "index.html", thumbnailPath: null,
  initializeArtifact: async stage => { await mkdir(stage, { recursive: true }); await writeFile(path.join(stage, "index.html"), ${JSON.stringify(html)}); await writeFile(path.join(stage, "logo.svg"), ${JSON.stringify(logo)}); }
});
closeSqlite();
console.log(JSON.stringify({ projectId: created.id, providerExecuted: false }));
`,
	);
	const seeded = spawn("bun", ["run", seedPath], {
		cwd: fixture,
		env,
		windowsHide: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	const stdout = [];
	const stderr = [];
	seeded.stdout.on("data", (chunk) => stdout.push(chunk));
	seeded.stderr.on("data", (chunk) => stderr.push(chunk));
	const [code] = await bounded(once(seeded, "exit"), 60_000, () =>
		seeded.kill(),
	);
	assert.equal(
		code,
		0,
		`fixture seed failed: ${Buffer.concat(stderr).toString("utf8")}`,
	);
	const lines = Buffer.concat(stdout).toString("utf8").trim().split(/\r?\n/);
	const result = JSON.parse(lines.at(-1));
	assert.match(result.projectId, /^[0-9A-HJKMNP-TV-Z]{26}$/);
	assert.equal(result.providerExecuted, false);
	return result;
}

async function validateArtifact(artifact, format, expectedDigest) {
	assert.equal(artifact.format, format);
	assert.equal(
		path.dirname(await realpath(artifact.path)),
		await realpath(fixture),
	);
	const bytes = await readFile(artifact.path);
	assert.ok(bytes.length > 0, `${format} download must not be empty`);
	if (format === "svg") {
		const text = bytes.toString("utf8");
		assert.match(text, /<svg\b/i);
		assert.match(text, /xmlns=["']http:\/\/www\.w3\.org\/2000\/svg["']/i);
	} else {
		assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-");
		assert.match(
			bytes.subarray(Math.max(0, bytes.length - 2048)).toString("latin1"),
			/%%EOF/,
		);
	}
	const sha256 = createHash("sha256").update(bytes).digest("hex");
	assert.equal(artifact.bytes, bytes.length);
	assert.equal(artifact.sha256, sha256);
	assert.equal(
		expectedDigest,
		sha256,
		`${format} backend receipt and downloaded bytes must match`,
	);
	return { format, bytes: bytes.length, sha256 };
}

async function run(report, projectId) {
	child = spawn(
		path.join(app, release ? "current/BurnGuard.exe" : "BurnGuard.exe"),
		["--smoke-test", "--smoke-report", report, "--smoke-project", projectId],
		{ cwd: fixture, env, windowsHide: false, stdio: "ignore" },
	);
	const [code] = await bounded(once(child, "exit"), 420_000);
	return code;
}

async function bounded(promise, timeoutMs, onTimeout = () => {}) {
	let timer;
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(() => {
					onTimeout();
					reject(new Error("native smoke deadline"));
				}, timeoutMs);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}
