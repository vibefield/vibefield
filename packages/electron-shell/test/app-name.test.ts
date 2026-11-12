import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Item 340 (2026-11-12) — the name every packaged VibeField keeps its cookie key under. Electron 43.1.1 names the
// keychain item once, after the main script's synchronous run (`ElectronBrowserMainParts::PostCreateMainMessageLoop`):
// `app_name + " Safe Storage"`, from `Browser::GetName()`, which returns `app.setName`'s value first. A packaged
// app's key exists because the EnableCookieEncryption fuse is on (`apps/desktop/packaging/fuse-matrix.mjs`); this
// file holds the NAME: main calls `app.setName` once, at module scope, before the boot that awaits `whenReady` and
// before any top-level `await`, with the frozen productName. Changing it would hand every installed copy a new,
// empty item, and their stored cookies would no longer open.

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const INDEX = join(SRC, "main", "index.ts");
const IDENTITY = fileURLToPath(
  new URL("../../../apps/desktop/packaging/release-identity.json", import.meta.url),
);

/** What a main source says about its `app.setName` call. */
interface SetNameReading {
  /** every `app.setName(` in the source */
  readonly calls: number;
  /** the one call's literal, when it is a module-scope statement `app.setName("…");` at column 0 */
  readonly value: string | null;
  /** its line is above the boot's module-scope gate (`const hasInstanceLock = `) */
  readonly beforeBoot: boolean;
  /** no module-scope `await` comes before it */
  readonly noAwaitBefore: boolean;
}

function readSetName(source: string): SetNameReading {
  const lines = source.split("\n");
  const calls = (source.match(/\bapp\.setName\(/g) ?? []).length;
  const at = lines.findIndex((line) => /^app\.setName\("[^"]+"\);$/.test(line));
  const boot = lines.findIndex((line) => line.startsWith("const hasInstanceLock = "));
  const firstAwait = lines.findIndex((line) => /^await\b/.test(line));
  return {
    calls,
    value: at === -1 ? null : (/^app\.setName\("([^"]+)"\);$/.exec(lines[at] ?? "")?.[1] ?? null),
    beforeBoot: at !== -1 && boot !== -1 && at < boot,
    noAwaitBefore: at !== -1 && (firstAwait === -1 || firstAwait > at),
  };
}

const sourcesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourcesUnder(path);
    return /\.(ts|tsx|mts)$/.test(entry.name) ? [path] : [];
  });

describe("the app's name, which names its keychain item (item 340)", () => {
  const identity = JSON.parse(readFileSync(IDENTITY, "utf8")) as {
    fields: { productName: { status: string; value: string } };
  };
  const reading = readSetName(readFileSync(INDEX, "utf8"));

  it("is set once in all of electron-shell's source, in main/index.ts", () => {
    const callers = sourcesUnder(SRC).filter((path) =>
      /\bapp\.setName\(/.test(readFileSync(path, "utf8")),
    );
    expect(callers).toEqual([INDEX]);
    expect(reading.calls).toBe(1);
  });

  it("is a module-scope statement above the boot and above any top-level await", () => {
    expect(reading.value).not.toBeNull();
    expect(reading.beforeBoot).toBe(true);
    expect(reading.noAwaitBefore).toBe(true);
  });

  it('is the frozen productName, so the item is "VibeField Safe Storage"', () => {
    expect(identity.fields.productName.status).toBe("frozen");
    expect(reading.value).toBe(identity.fields.productName.value);
    expect(`${reading.value} Safe Storage`).toBe("VibeField Safe Storage");
  });

  // The reader bites (VF-PM 10:15:10Z): each shape below is one the real file must never take, and each is caught.
  const ok =
    'import { app } from "electron";\napp.setName("VibeField");\nconst hasInstanceLock = true;\n';
  const call = 'app.setName("VibeField");';
  const held = (source: string): boolean => {
    const r = readSetName(source);
    return r.calls === 1 && r.value === "VibeField" && r.beforeBoot && r.noAwaitBefore;
  };
  it.each([
    ["indented, inside a block", ok.replace(call, `{\n  ${call}\n}`)],
    ["made twice", `${ok}app.setName("VibeField");\n`],
    ["below the boot", `const hasInstanceLock = true;\n${call}\n`],
    ["after a top-level await", ok.replace(call, `await import("node:os");\n${call}`)],
    ["another literal", ok.replace(call, 'app.setName("VibeField Dev");')],
    ["behind a condition", ok.replace(call, `if (app.isPackaged) ${call}`)],
    ["named by a variable", ok.replace(call, "app.setName(NAME);")],
  ])("refuses a source where the call is %s", (_shape, source) => {
    expect(held(source)).toBe(false);
  });

  it("reads the good shape as good", () => {
    expect(readSetName(ok)).toEqual({
      calls: 1,
      value: "VibeField",
      beforeBoot: true,
      noAwaitBefore: true,
    });
  });
});
