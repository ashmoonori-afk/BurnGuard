import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { canvasWriteInvalidations } from "../src/lib/canvas-write-queries";

test("Given cached project and artifact queries When a Style or Edit save invalidates Then the project row is marked stale with the file queries", async () => {
  const client = new QueryClient();
  client.setQueryData(["project", "p"], { current_revision: 1 });
  client.setQueryData(["project", "p", "artifacts"], { current_revision: 1 });
  client.setQueryData(["project", "p", "files"], []);
  client.setQueryData(["project", "p", "fs", "index.html", "undo-info"], null);
  client.setQueryData(["project", "q"], { current_revision: 1 });

  await Promise.all(canvasWriteInvalidations("p", "index.html").map((entry) => client.invalidateQueries({ queryKey: [...entry.queryKey], exact: entry.exact })));

  const stale = (queryKey: readonly unknown[]) => client.getQueryCache().find({ queryKey: [...queryKey] })?.state.isInvalidated;
  expect(stale(["project", "p"])).toBe(true);
  expect(stale(["project", "p", "artifacts"])).toBe(true);
  expect(stale(["project", "p", "files"])).toBe(true);
  expect(stale(["project", "p", "fs", "index.html", "undo-info"])).toBe(true);
  expect(stale(["project", "q"])).toBe(false);
});
