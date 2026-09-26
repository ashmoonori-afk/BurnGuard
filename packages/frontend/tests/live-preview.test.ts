import { expect, test } from "bun:test";
import type { NormalizedEvent } from "@bg/shared";
import { latestArtifactPreview } from "../src/lib/live-preview";

const preview = (version: number): NormalizedEvent => ({ id: `p${version}`, ts: version, type: "artifact.preview", projectId: "p", previewId: "d", path: "index.html", version, active: true });
const message = (id: string): NormalizedEvent => ({ id, ts: 0, type: "user.message", text: "hi" } as NormalizedEvent);

test("Given a stream with several preview versions When the latest is looked up Then the last preview event is returned without copying the stream (UXW-16)", () => {
  const events = [message("a"), preview(1), message("b"), preview(2), message("c")];
  const reverse = Array.prototype.reverse;
  let reversed = 0;
  Array.prototype.reverse = function (this: unknown[]) { reversed += 1; return reverse.call(this); };
  try {
    expect(latestArtifactPreview(events)).toBe(events[3]!);
    expect(latestArtifactPreview([message("a")])).toBeUndefined();
    expect(latestArtifactPreview([])).toBeUndefined();
  } finally { Array.prototype.reverse = reverse; }
  expect(reversed).toBe(0);
});

test("Given the project view source When scanned Then the latest preview lookup is memoised on the events", async () => {
  const source = await Bun.file(new URL("../src/views/ProjectView.tsx", import.meta.url)).text();
  expect(source).toContain("useMemo(() => latestArtifactPreview(events), [events])");
  expect(source).not.toContain("[...events].reverse()");
});
