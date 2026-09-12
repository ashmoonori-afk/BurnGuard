#!/usr/bin/env node
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const path = require("node:path");

// All processes execute this copied fixture inside the test's private directory.
if (process.argv[2] === "child") {
  process.on("message", () => {});
  process.send({ ready: true });
} else if (process.argv[2] === "control") {
  process.stdin.resume();
  console.log(process.pid);
} else {
  const child = spawn(process.execPath, [__filename, "child"], {
    cwd: process.cwd(), detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const receipt = { parent: process.pid, child: child.pid };
  writeFileSync(path.join(process.cwd(), "owned-pids.json"), JSON.stringify(receipt));
  child.once("message", () => console.log(JSON.stringify(receipt)));
}
