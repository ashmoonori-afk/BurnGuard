#!/usr/bin/env bun
/**
 * Flake-pattern guard for the browser launch path (doc/os-matrix.md, "Hardening log", 2026-09-30). It reads
 * packages/backend/src as syntax trees and rejects the code shapes behind the two CI failures of that day:
 *
 *   raw_timeout_signal_in_launch_call  an AbortSignal.timeout() signal handed to a launch-path entry point without
 *                                      AbortSignal.any([...]) or keepAbortSignalArmed (lib/abort-signal.ts)
 *   launch_module_signal_not_armed     a module that loads Playwright removes an "abort" listener from a signal and
 *                                      never calls keepAbortSignalArmed (Bun 1.3.14 then cancels the caller's timer)
 *   playwright_timeout_option          launch, launchServer or connect given Playwright's own `timeout` option
 *                                      (playwright-core 1.59.1 does not apply launchServer's)
 *   launch_server_without_deadline     launchServer called outside launchWithin or probeChannels, the bridge's own
 *                                      enforced deadline
 *
 *   bun scripts/qa/check-flake-patterns.ts        exit 1 on any problem
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

export const SOURCE_ROOT = "packages/backend/src";
const ARMING_HELPER = "keepAbortSignalArmed";
const DEADLINE_WRAPPERS = new Set(["launchWithin", "probeChannels"]);
const PLAYWRIGHT_LAUNCH_METHODS = new Set(["launch", "launchServer", "launchPersistentContext", "connect", "connectOverCDP"]);
const PLAYWRIGHT_RECEIVER = /\b(?:chromium|firefox|webkit|playwright|browserType)\b/i;
const PLAYWRIGHT_MODULE = /(?:^|\/)playwright(?:-core|-runtime)?$/;

export type FlakeProblemCode = "raw_timeout_signal_in_launch_call" | "launch_module_signal_not_armed" | "playwright_timeout_option" | "launch_server_without_deadline";
export type FlakeProblem = { readonly code: FlakeProblemCode; readonly path: string; readonly line: number };
export type SourceText = { readonly path: string; readonly text: string };

const repoPath = (spelling: string): string => spelling.replaceAll("\\", "/").replace(/^(?:\.\/)+/, "");

const parsed = new WeakMap<SourceText, ts.SourceFile>();
function parse(source: SourceText): ts.SourceFile {
  const known = parsed.get(source);
  if (known !== undefined) return known;
  const kind = /\.[cm]?js$/.test(source.path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const file = ts.createSourceFile(source.path, source.text, ts.ScriptTarget.Latest, true, kind);
  parsed.set(source, file);
  return file;
}

function calleeName(call: ts.CallExpression): string | null {
  if (ts.isIdentifier(call.expression)) return call.expression.text;
  if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text;
  return null;
}

function isAbortSignalCall(node: ts.Node, method: "timeout" | "any"): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === "AbortSignal" && node.expression.name.text === method;
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => { walk(child, visit); });
}

/** Raw means its timer can be cancelled by a listener removal: AbortSignal.any([...]) signals are not affected. */
function rawTimeoutSignals(node: ts.Node): ts.CallExpression[] {
  const found: ts.CallExpression[] = [];
  const visit = (current: ts.Node): void => {
    if (isAbortSignalCall(current, "any")) return;
    if (isAbortSignalCall(current, "timeout")) found.push(current);
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false);
}

function callsHelper(file: ts.SourceFile): boolean {
  let found = false;
  walk(file, (node) => { if (ts.isCallExpression(node) && calleeName(node) === ARMING_HELPER) found = true; });
  return found;
}

/** The entry points of the launch path are whatever the modules that arm the caller's signal export. */
export function launchEntryPoints(sources: readonly SourceText[]): Set<string> {
  const names = new Set<string>();
  for (const source of sources) {
    const file = parse(source);
    if (!callsHelper(file)) continue;
    for (const statement of file.statements) {
      if (!hasExportModifier(statement)) continue;
      if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) names.add(statement.name.text);
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
    }
  }
  names.delete(ARMING_HELPER);
  return names;
}

function loadsPlaywright(file: ts.SourceFile): boolean {
  let found = false;
  walk(file, (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && PLAYWRIGHT_MODULE.test(node.moduleSpecifier.text)) {
      const clause = node.importClause;
      const typeOnly = clause !== undefined && (clause.isTypeOnly || (clause.name === undefined && clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.every((element) => element.isTypeOnly)));
      if (!typeOnly) found = true;
    }
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || calleeName(node) === "require")) {
      const [specifier] = node.arguments;
      if (specifier !== undefined && ts.isStringLiteralLike(specifier) && PLAYWRIGHT_MODULE.test(specifier.text)) found = true;
    }
  });
  return found;
}

function checkFile(source: SourceText, entryPoints: ReadonlySet<string>): FlakeProblem[] {
  const file = parse(source);
  const problems: FlakeProblem[] = [];
  const report = (code: FlakeProblemCode, node: ts.Node): void => {
    problems.push({ code, path: repoPath(source.path), line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1 });
  };

  const rawVariables = new Set<string>();
  const armedVariables = new Set<string>();
  let firstAbortListenerRemoval: ts.Node | null = null;
  walk(file, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined && rawTimeoutSignals(node.initializer).length > 0) rawVariables.add(node.name.text);
    if (!ts.isCallExpression(node)) return;
    const [first] = node.arguments;
    if (calleeName(node) === ARMING_HELPER && first !== undefined && ts.isIdentifier(first)) armedVariables.add(first.text);
    if (calleeName(node) === "removeEventListener" && first !== undefined && ts.isStringLiteralLike(first) && first.text === "abort") firstAbortListenerRemoval ??= node;
  });
  if (firstAbortListenerRemoval !== null && loadsPlaywright(file) && !callsHelper(file)) report("launch_module_signal_not_armed", firstAbortListenerRemoval);

  const enclosingCalls: string[] = [];
  const visit = (node: ts.Node): void => {
    if (!ts.isCallExpression(node)) { ts.forEachChild(node, visit); return; }
    const name = calleeName(node);
    if (name !== null && entryPoints.has(name)) {
      for (const argument of node.arguments) {
        for (const raw of rawTimeoutSignals(argument)) report("raw_timeout_signal_in_launch_call", raw);
        walk(argument, (inner) => { if (ts.isIdentifier(inner) && rawVariables.has(inner.text) && !armedVariables.has(inner.text) && !(ts.isPropertyAssignment(inner.parent) && inner.parent.name === inner)) report("raw_timeout_signal_in_launch_call", inner); });
      }
    }
    if (name !== null && PLAYWRIGHT_LAUNCH_METHODS.has(name) && ts.isPropertyAccessExpression(node.expression) && PLAYWRIGHT_RECEIVER.test(node.expression.expression.getText(file))) {
      for (const argument of node.arguments) {
        if (!ts.isObjectLiteralExpression(argument)) continue;
        for (const property of argument.properties) if ((ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) && property.name.getText(file) === "timeout") report("playwright_timeout_option", property);
      }
      if (name === "launchServer" && !enclosingCalls.some((call) => DEADLINE_WRAPPERS.has(call))) report("launch_server_without_deadline", node);
    }
    enclosingCalls.push(name ?? "");
    ts.forEachChild(node, visit);
    enclosingCalls.pop();
  };
  visit(file);
  return problems;
}

export function checkSources(sources: readonly SourceText[]): FlakeProblem[] {
  const entryPoints = launchEntryPoints(sources);
  return sources.flatMap((source) => checkFile(source, entryPoints))
    .sort((left, right) => left.path === right.path ? left.line - right.line : left.path < right.path ? -1 : 1);
}

export async function readSources(root: string): Promise<SourceText[]> {
  const base = path.join(root, ...SOURCE_ROOT.split("/"));
  const sources: SourceText[] = [];
  for await (const file of new Bun.Glob("**/*.{ts,mts,cts,js,mjs,cjs}").scan({ cwd: base, onlyFiles: true })) {
    if (/\.d\.[cm]?ts$/.test(file)) continue;
    sources.push({ path: repoPath(`${SOURCE_ROOT}/${file}`), text: await readFile(path.join(base, file), "utf8") });
  }
  return sources.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

const HELP: Record<FlakeProblemCode, string> = {
  raw_timeout_signal_in_launch_call: "pass AbortSignal.any([...]) or arm the signal with keepAbortSignalArmed (lib/abort-signal.ts) before it reaches the launch path",
  launch_module_signal_not_armed: "this module loads Playwright and removes an abort listener: call keepAbortSignalArmed on the caller's signal first",
  playwright_timeout_option: "do not rely on Playwright's timeout option: race the call against an owned deadline (launchWithin, settleLaunch)",
  launch_server_without_deadline: "launchServer has no working deadline of its own: call it through launchWithin or probeChannels",
};

if (import.meta.main) {
  const root = path.resolve(import.meta.dir, "..", "..");
  const sources = await readSources(root);
  const problems = checkSources(sources);
  for (const problem of problems) console.error(`${problem.code}\t${problem.path}:${problem.line}\t${HELP[problem.code]}`);
  console.log(`flake patterns: ${sources.length} source files under ${SOURCE_ROOT}, ${launchEntryPoints(sources).size} launch entry points, ${problems.length} problems`);
  process.exit(problems.length === 0 ? 0 : 1);
}
