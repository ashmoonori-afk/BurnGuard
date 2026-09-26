import { expect, test } from "bun:test";
import { DEFAULT_DISPLAY_NAME } from "@bg/shared";
import { sidebarIdentity } from "../src/components/layout/Sidebar";
import { t } from "../src/i18n/t";

test("Given the seeded display name When the sidebar identity is derived Then the localized workspace label is shown", () => {
  expect(sidebarIdentity(DEFAULT_DISPLAY_NAME, t)).toEqual({ initial: t("shell.me"), label: t("shell.workspace") });
  expect(sidebarIdentity(undefined, t)).toEqual({ initial: t("shell.me"), label: t("shell.workspace") });
  expect(sidebarIdentity("", t)).toEqual({ initial: t("shell.me"), label: t("shell.workspace") });
});

test("Given a chosen display name When the sidebar identity is derived Then the name and its initial are shown", () => {
  expect(sidebarIdentity("Ada", t)).toEqual({ initial: "A", label: "Ada" });
});

test("Given the sidebar source When scanned Then the seed sentinel comes from the shared contract, not a literal", async () => {
  const source = await Bun.file(new URL("../src/components/layout/Sidebar.tsx", import.meta.url)).text();
  expect(source).not.toContain('"You"');
  expect(source).toContain("DEFAULT_DISPLAY_NAME");
});
