import { expect, test } from "bun:test";
import type { ArtifactTab } from "../src/types/project";
import { nextActiveTabAfterClose } from "../src/lib/artifact-tabs";

const tab = (relPath: string): ArtifactTab => ({ id: relPath, title: relPath, kind: "file", relPath, closeable: true });
const TABS = [tab("a.html"), tab("b.html"), tab("c.html")];

test("Given file tabs a, b, c with b active When b closes Then the tab before it becomes active", () => {
  expect(nextActiveTabAfterClose(TABS, "b.html", "b.html")).toBe("a.html");
});

test("Given the first tab active When it closes Then the tab after it becomes active", () => {
  expect(nextActiveTabAfterClose(TABS, "a.html", "a.html")).toBe("b.html");
});

test("Given a single active tab When it closes Then the design system tab becomes active", () => {
  expect(nextActiveTabAfterClose([tab("a.html")], "a.html", "a.html")).toBe("design-system");
});

test("Given b closes while a is active Then the active tab is unchanged", () => {
  expect(nextActiveTabAfterClose(TABS, "b.html", "a.html")).toBe("a.html");
});
