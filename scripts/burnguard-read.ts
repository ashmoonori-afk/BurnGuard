#!/usr/bin/env bun
// Read-only view of your local BurnGuard projects for a coding agent. Usage:
//   bun scripts/burnguard-read.ts projects            list active projects
//   bun scripts/burnguard-read.ts project <id>        project brief: directory, standing instructions, design system rules, files
//   bun scripts/burnguard-read.ts project <id> --json same as JSON
// The profile is BG_APP_ROOT or ~/.burnguard. Nothing is written and no network port is opened.
import os from "node:os";
import path from "node:path";
import { listProjects, openProfileReader, readProject, renderProjectBrief } from "../packages/backend/src/cli/project-reader";

const root = process.env.BG_APP_ROOT ?? path.join(os.homedir(), ".burnguard");
const [command, id, flag] = process.argv.slice(2);
const reader = openProfileReader(root);
try {
  if (command === "projects") {
    for (const project of listProjects(reader)) console.log([project.id, project.type, project.name, project.design_system ?? "-"].join("\t"));
  } else if (command === "project" && id) {
    const view = await readProject(reader, id);
    if (!view) { console.error("project not found"); process.exitCode = 2; }
    else console.log(flag === "--json" ? JSON.stringify(view, null, 2) : renderProjectBrief(view));
  } else {
    console.error("usage: burnguard-read.ts projects | project <id> [--json]");
    process.exitCode = 64;
  }
} finally { reader.close(); }
