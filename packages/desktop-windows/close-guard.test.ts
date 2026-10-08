import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const source = await readFile(path.join(import.meta.dir, "Program.cs"), "utf8");
const project = await readFile(path.join(import.meta.dir, "BurnGuard.Desktop.csproj"), "utf8");

/** The brace-balanced body that follows the first occurrence of `signature` in Program.cs. */
function body(signature: string): string {
  const start = source.indexOf(signature);
  if (start < 0) throw new Error(`Missing ${signature}`);
  const open = source.indexOf("{", start);
  for (let index = open, depth = 0; index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return source.slice(open, index + 1);
  }
  throw new Error(`Unbalanced ${signature}`);
}

async function shellTables(shell: string): Promise<Record<string, Record<string, string>>> {
  const directory = path.join(import.meta.dir, "..", shell, "i18n");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).sort();
  return Object.fromEntries(await Promise.all(files.map(async (file) => [file.slice(0, -".json".length), JSON.parse(await readFile(path.join(directory, file), "utf8"))])));
}

const HANGUL = /\p{Script=Hangul}/u;

describe("Windows close guard while a generation runs (B3-5)", () => {
  test("Given a user close When the window is closing Then it asks the backend before sending shutdown and Keep working cancels it", () => {
    const closing = body("private async void OnClosing(");
    const ask = closing.indexOf("await ActiveTurnCountAsync() > 0 && !ConfirmCloseDuringTurn()");
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(closing.indexOf('WriteLineAsync("shutdown")'));
    expect(ask).toBeLessThan(closing.indexOf("closing = true"));
    expect(closing).toContain("if (report == null && Program.ExitCode == 0 && args.CloseReason == CloseReason.UserClosing)");
    expect(closing).toContain("{ restartForUpdate = false; return; }");
    expect(closing).toContain("if (closing || confirmingClose) return;");
  });

  test("Given the active-turn query When it is sent Then it uses the private stdin pipe and a missing answer counts as idle", () => {
    const query = body("private async Task<int> ActiveTurnCountAsync()");
    expect(query).toContain('await service.StandardInput.WriteLineAsync("active-turns")');
    expect(query).toContain("if (origin == null || service == null || service.HasExited) return 0;");
    expect(query).toContain("return await Task.WhenAny(reply.Task, Task.Delay(2000)) == reply.Task ? reply.Task.Result : 0;");
    const output = body("service.OutputDataReceived += (_, args) =>");
    const reply = output.indexOf('(kind as string) == "active-turns"');
    expect(reply).toBeGreaterThan(-1);
    expect(reply).toBeLessThan(output.indexOf('Convert.ToInt32(data["pid"]) != service.Id'));
    expect(output).toContain('activeTurnsReply?.TrySetResult(Convert.ToInt32(data["count"]));');
  });

  test("Given the confirm dialog When it is built Then every string comes from the shell table and Keep working is the default and the cancel answer", () => {
    const dialog = body("private bool ConfirmCloseDuringTurn()");
    for (const key of ["closeRunning.message", "closeRunning.close", "closeRunning.keep"]) expect(dialog).toContain(`ShellText.Get("${key}")`);
    expect(dialog).toContain("dialog.AcceptButton = keep; dialog.CancelButton = keep;");
    expect(dialog).toContain("return dialog.ShowDialog(this) == DialogResult.OK;");
  });

  test("Given the shell string tables When the shell is built Then they are embedded under the name ShellText loads", () => {
    expect(project).toContain('<EmbeddedResource Include="i18n/*.json" LogicalName="BurnGuard.Desktop.i18n.%(Filename).json" />');
    expect(body("private static Dictionary<string, string> Load(string language)")).toContain('GetManifestResourceStream("BurnGuard.Desktop.i18n." + language + ".json")');
    const language = body("internal static string Language(CultureInfo culture)");
    expect(language).toContain('if (culture.TwoLetterISOLanguageName == "ko") return "ko";');
    expect(language).toContain('if (name.Contains("hans")) return "zh";');
  });
});

describe("desktop shell string tables", () => {
  test("Given both shells When their tables are compared Then each ships en, ko and zh with the same keys and identical text", async () => {
    const windows = await shellTables("desktop-windows");
    const mac = await shellTables("desktop-mac");
    expect(Object.keys(windows)).toEqual(["en", "ko", "zh"]);
    expect(mac).toEqual(windows);
    const keys = Object.keys(windows.en ?? {}).sort();
    expect(keys).toContain("closeRunning.message");
    for (const table of Object.values(windows)) {
      expect(Object.keys(table).sort()).toEqual(keys);
      for (const value of Object.values(table)) expect(value.trim().length).toBeGreaterThan(0);
    }
  });

  test("Given the tables When scanned Then Hangul appears only in the ko table", async () => {
    const windows = await shellTables("desktop-windows");
    for (const [language, table] of Object.entries(windows)) {
      for (const value of Object.values(table)) expect(HANGUL.test(value)).toBe(language === "ko");
    }
  });
});
