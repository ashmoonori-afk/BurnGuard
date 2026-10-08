import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const locales = ["ko", "en", "zh"] as const;

async function table(locale: string): Promise<Record<string, string>> {
  return JSON.parse(await readFile(path.join(import.meta.dir, "i18n", `${locale}.json`), "utf8"));
}

describe("Windows shell localized strings", () => {
  test("Given every Strings.Get key in Program.cs, When each locale file is read, Then the key is a non-empty string in all three", async () => {
    const source = await readFile(path.join(import.meta.dir, "Program.cs"), "utf8");
    const keys = [...source.matchAll(/Strings\.Get\("([A-Za-z]+)"\)/g)].map((match) => match[1]);
    expect(keys.length).toBeGreaterThan(0);
    for (const locale of locales) {
      const strings = await table(locale);
      for (const key of keys) {
        expect(typeof strings[key]).toBe("string");
        expect(strings[key]?.trim().length).toBeGreaterThan(0);
      }
    }
  });

  test("Given the three locale files, When their key sets are compared, Then they are identical and keep the port placeholder", async () => {
    const [ko, en, zh] = await Promise.all(locales.map(table));
    expect(Object.keys(en).sort()).toEqual(Object.keys(ko).sort());
    expect(Object.keys(zh).sort()).toEqual(Object.keys(ko).sort());
    for (const strings of [ko, en, zh]) expect(strings.portBusy).toContain("{0}");
  });

  test("Given the csproj, When resources are listed, Then i18n json files are embedded", async () => {
    const csproj = await readFile(path.join(import.meta.dir, "BurnGuard.Desktop.csproj"), "utf8");
    expect(csproj).toMatch(/EmbeddedResource Include="i18n\/\*\.json"/);
  });
});
