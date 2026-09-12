// Owned cancellation fixture. The provider executes this in its operation stage.
// Nothing writes to canonical output; cancellation must discard the entire stage.
const fs = require("node:fs");
const cp = require("node:child_process");
const path = require("node:path");
if (!process.cwd().includes(`${path.sep}.meta${path.sep}artifact-operations${path.sep}`) || path.basename(process.cwd()) !== "stage") {
  throw new Error("Barrier may run only in an owned BurnGuard operation stage");
}
cp.execFileSync("mkfifo", ["qa-generation.fifo"]);
fs.writeFileSync("qa-barrier-ready.tmp", JSON.stringify({ pid: process.pid, cwd: process.cwd() }));
fs.renameSync("qa-barrier-ready.tmp", "qa-barrier-ready.json");
fs.readFileSync("qa-generation.fifo");
throw new Error("Cancellation barrier was unexpectedly released");
