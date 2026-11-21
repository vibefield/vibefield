// TL-4a (2026-11-18) — the terminal scheme fieldd keeps and tells every local
// session (`terminal-scheme.ts`): the bytes a colour is told as, which grounds
// are light (the `COLORFGBG` a birth is given), when two schemes tell a session
// the same thing, and the store that keeps the scheme across a restart. The
// service that tells it and the door that sets it are terminal-service.test.ts's.
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type TerminalScheme, TerminalSchemeFile } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import { afterEach, describe, expect, it } from "vitest";
import {
  SCHEME_HINT_VARIABLE,
  sameScheme,
  schemeColorFgBg,
  schemeColors,
  schemeColorsWithoutPalette,
  schemeGroundIsLight,
  TerminalSchemeStore,
  withSchemeHint,
} from "../src/terminal-scheme";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A user root of the test's own, and where the scheme lives under it (LAYOUT
 * `TERMINAL_SCHEME_FILE`). fieldd's folder is not there yet: the first keep
 * makes it. */
function schemeFile(): string {
  const root = mkdtempSync(join(tmpdir(), "vf-scheme-"));
  roots.push(root);
  return join(root, "fieldd", "terminal-scheme.json");
}

/** A logger that keeps each event's name and attributes. */
function captured(events: Array<{ event: string; attrs?: unknown }>): Logger {
  const logger: Logger = {
    child: () => logger,
    trace: (event, _message, attrs) => events.push({ event, attrs }),
    debug: (event, _message, attrs) => events.push({ event, attrs }),
    info: (event, _message, attrs) => events.push({ event, attrs }),
    warn: (event, _message, attrs) => events.push({ event, attrs }),
    error: (event, _message, _error, attrs) => events.push({ event, attrs }),
    fatal: (event, _message, _error, attrs) => events.push({ event, attrs }),
    isLevelEnabled: () => true,
  };
  return logger;
}

/** A light scheme (the deck's paper ground, two palette slots) and a dark one. */
const LIGHT: TerminalScheme = {
  foreground: "#1e2227",
  background: "#ece8dc",
  cursor: "#2b6aa6",
  palette: [
    { index: 1, color: "#a34d49" },
    { index: 4, color: "#2b6aa6" },
  ],
};
const DARK: TerminalScheme = {
  foreground: "#abb2bf",
  background: "#282c34",
  cursor: "#528bff",
  palette: [],
};

/** DARK on another ground: the one field the light-or-dark answer reads. */
const ground = (background: string): TerminalScheme => ({ ...DARK, background });

/** TL-4b (2026-11-18) — LIGHT's two palette slots as a session is told them. */
const LIGHT_SLOTS = [
  [1, [163, 77, 73]],
  [4, [43, 106, 166]],
];

describe("the terminal scheme's colours (TL-4a)", () => {
  // TL-4b (2026-11-18): a session is told the palette with the three colours,
  // so each answer here names it: LIGHT's two slots, none for a scheme with none
  it("turns #rrggbb, in either case, into the bytes a session is told: the three colours and each palette slot", () => {
    expect(schemeColors(LIGHT)).toEqual({
      foreground: [30, 34, 39],
      background: [236, 232, 220],
      cursor: [43, 106, 166],
      palette: LIGHT_SLOTS,
    });
    const mixed = { ...LIGHT, foreground: "#ABB2BF", background: "#ECE8DC", cursor: "#0a0B0c" };
    expect(schemeColors(mixed)).toEqual({
      foreground: [171, 178, 191],
      background: [236, 232, 220],
      cursor: [10, 11, 12],
      palette: LIGHT_SLOTS,
    });
    const edges = { ...DARK, foreground: "#ffffff", background: "#000000", cursor: "#ff0080" };
    expect(schemeColors(edges)).toEqual({
      foreground: [255, 255, 255],
      background: [0, 0, 0],
      cursor: [255, 0, 128],
      palette: [],
    });
  });

  it("names the palette in index order, whatever order the scheme names it in (TL-4b)", () => {
    const reversed: TerminalScheme = { ...LIGHT, palette: [...LIGHT.palette].reverse() };
    expect(schemeColors(reversed)).toEqual({
      foreground: [30, 34, 39],
      background: [236, 232, 220],
      cursor: [43, 106, 166],
      palette: LIGHT_SLOTS,
    });
    const scattered: TerminalScheme = {
      ...DARK,
      palette: [
        { index: 255, color: "#FFFFFF" },
        { index: 0, color: "#000000" },
        { index: 16, color: "#0a0B0c" },
      ],
    };
    expect(schemeColors(scattered)).toEqual({
      foreground: [171, 178, 191],
      background: [40, 44, 52],
      cursor: [82, 139, 255],
      palette: [
        [0, [0, 0, 0]],
        [16, [10, 11, 12]],
        [255, [255, 255, 255]],
      ],
    });
  });

  it("without the palette, for a floor that reads none: the three colours and no palette key at all (TL-4b)", () => {
    expect(schemeColorsWithoutPalette(LIGHT)).toStrictEqual({
      foreground: [30, 34, 39],
      background: [236, 232, 220],
      cursor: [43, 106, 166],
    });
    expect(schemeColorsWithoutPalette(DARK)).not.toHaveProperty("palette");
  });

  it("reads a ground as light when black ink out-contrasts white on it, at both sides of the threshold", () => {
    // #757575 and #767676: the two greys either side of the line
    expect(schemeGroundIsLight([117, 117, 117])).toBe(false);
    expect(schemeGroundIsLight([118, 118, 118])).toBe(true);
    for (const [background, light, hint] of [
      ["#757575", false, "15;0"],
      ["#767676", true, "0;15"],
      ["#282c34", false, "15;0"],
      ["#ece8dc", true, "0;15"],
      ["#000000", false, "15;0"],
      ["#ffffff", true, "0;15"],
      // the channels weigh what the eye weighs: a pure blue is dark, a pure green light
      ["#0000ff", false, "15;0"],
      ["#00ff00", true, "0;15"],
    ] as const) {
      const bytes = schemeColors(ground(background)).background;
      expect(schemeGroundIsLight(bytes), background).toBe(light);
      expect(schemeColorFgBg(ground(background)), background).toBe(hint);
    }
    // the case a colour is written in is no part of the answer
    expect(schemeColorFgBg(ground("#ECE8DC"))).toBe("0;15");
    expect(schemeColorFgBg(ground("#282C34"))).toBe("15;0");
    expect(SCHEME_HINT_VARIABLE).toBe("COLORFGBG");
  });

  it("holds two schemes the same when they tell a session the same thing: colours without case, the palette by index whatever its order", () => {
    expect(sameScheme(LIGHT, LIGHT)).toBe(true);
    expect(sameScheme(LIGHT, { ...LIGHT, palette: [...LIGHT.palette] })).toBe(true);
    const shouted: TerminalScheme = {
      foreground: "#1E2227",
      background: "#ECE8DC",
      cursor: "#2B6AA6",
      palette: [
        { index: 1, color: "#A34D49" },
        { index: 4, color: "#2B6AA6" },
      ],
    };
    expect(sameScheme(LIGHT, shouted)).toBe(true);
    expect(sameScheme(shouted, LIGHT)).toBe(true);
    const reordered: TerminalScheme = { ...LIGHT, palette: [...LIGHT.palette].reverse() };
    expect(sameScheme(LIGHT, reordered)).toBe(true);
    expect(sameScheme(reordered, LIGHT)).toBe(true);
    expect(sameScheme(DARK, { ...DARK, palette: [] })).toBe(true);
  });

  it("holds them different for any colour, any slot or any count that differs", () => {
    const differs: Array<[string, TerminalScheme]> = [
      ["the foreground", { ...LIGHT, foreground: "#1e2228" }],
      ["the background", { ...LIGHT, background: "#ece8dd" }],
      ["the cursor", { ...LIGHT, cursor: "#2b6aa7" }],
      [
        "a slot's colour",
        {
          ...LIGHT,
          palette: [
            { index: 1, color: "#a34d49" },
            { index: 4, color: "#2b6aa7" },
          ],
        },
      ],
      [
        "a slot missing, another named in its place",
        {
          ...LIGHT,
          palette: [
            { index: 1, color: "#a34d49" },
            { index: 5, color: "#2b6aa6" },
          ],
        },
      ],
      ["one slot fewer", { ...LIGHT, palette: [{ index: 1, color: "#a34d49" }] }],
      ["one slot more", { ...LIGHT, palette: [...LIGHT.palette, { index: 9, color: "#000000" }] }],
      ["no palette at all", { ...LIGHT, palette: [] }],
    ];
    for (const [what, other] of differs) {
      expect(sameScheme(LIGHT, other), what).toBe(false);
      expect(sameScheme(other, LIGHT), what).toBe(false);
    }
  });
});

describe("the hint a session is born with (TL-4a)", () => {
  const born = {
    executable: "/bin/zsh",
    args: [],
    cols: 80,
    rows: 24,
    persistence: "keep-until-explicit-close" as const,
  };

  it("adds nothing before a scheme is ever set: the floor writes its own, as it always did", () => {
    const shell = { ...born, environment: { mode: "inherit" as const, overrides: { A: "1" } } };
    expect(withSchemeHint(shell, null)).toBe(shell);
    expect(withSchemeHint(born, null)).toBe(born);
  });

  it("names the kept scheme's ground in whichever environment the birth names", () => {
    expect(
      withSchemeHint({ ...born, environment: { mode: "inherit", overrides: { A: "1" } } }, LIGHT),
    ).toEqual({
      ...born,
      environment: { mode: "inherit", overrides: { A: "1", COLORFGBG: "0;15" } },
    });
    expect(withSchemeHint({ ...born, environment: { mode: "inherit" } }, DARK)).toEqual({
      ...born,
      environment: { mode: "inherit", overrides: { COLORFGBG: "15;0" } },
    });
    expect(
      withSchemeHint({ ...born, environment: { mode: "clean", variables: { A: "1" } } }, LIGHT),
    ).toEqual({
      ...born,
      environment: { mode: "clean", variables: { A: "1", COLORFGBG: "0;15" } },
    });
    expect(withSchemeHint({ ...born, env: { A: "1" } }, DARK)).toEqual({
      ...born,
      env: { A: "1", COLORFGBG: "15;0" },
    });
    expect(withSchemeHint(born, LIGHT)).toEqual({ ...born, env: { COLORFGBG: "0;15" } });
  });

  it("keeps a value the birth names itself, in each of the three", () => {
    const own = { COLORFGBG: "7;0" };
    for (const options of [
      { ...born, environment: { mode: "inherit" as const, overrides: own } },
      { ...born, environment: { mode: "clean" as const, variables: own } },
      { ...born, env: own },
    ]) {
      expect(withSchemeHint(options, LIGHT)).toBe(options);
    }
  });

  it("leaves the birth it was given untouched", () => {
    const overrides = { A: "1" };
    const options = { ...born, environment: { mode: "inherit" as const, overrides } };
    withSchemeHint(options, LIGHT);
    expect(overrides).toEqual({ A: "1" });
    expect(options.environment.overrides).toBe(overrides);
  });
});

describe("the kept terminal scheme (TL-4a)", () => {
  it("before a scheme is ever set there is none, with no file and with a file not written yet", () => {
    expect(new TerminalSchemeStore().get()).toBeNull();
    expect(new TerminalSchemeStore({ file: schemeFile() }).get()).toBeNull();
  });

  it("is kept on disk at once, in the contract's shape and owner-only, and a new store over the file (fieldd restarted) reads it back", () => {
    const file = schemeFile();
    const first = new TerminalSchemeStore({ file });
    first.keep(LIGHT);
    expect(first.get()).toEqual(LIGHT);
    expect(TerminalSchemeFile.parse(JSON.parse(readFileSync(file, "utf8")))).toEqual({
      version: 1,
      scheme: LIGHT,
    });
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    // no temp file is left beside it
    expect(readdirSync(dirname(file)).filter((name) => name.endsWith(".tmp"))).toEqual([]);

    const restarted = new TerminalSchemeStore({ file });
    expect(restarted.get()).toEqual(LIGHT);
    // a later scheme replaces it whole, and that one survives a restart too
    restarted.keep(DARK);
    expect(new TerminalSchemeStore({ file }).get()).toEqual(DARK);
    expect(TerminalSchemeFile.parse(JSON.parse(readFileSync(file, "utf8"))).scheme).toEqual(DARK);
  });

  it("with no file the scheme is kept in memory alone, and a new store starts with none", () => {
    const store = new TerminalSchemeStore();
    store.keep(LIGHT);
    expect(store.get()).toEqual(LIGHT);
    expect(new TerminalSchemeStore().get()).toBeNull();
  });

  it("the tolerant reader: a file that is not the contract's reads as never set and says so; a field it has never heard of is kept; the next scheme replaces what was there", () => {
    const file = schemeFile();
    mkdirSync(dirname(file), { recursive: true });
    for (const text of [
      "not json",
      "[]",
      '{"version":1}',
      '{"version":2,"scheme":{"foreground":"#000000","background":"#ffffff","cursor":"#000000","palette":[]}}',
      JSON.stringify({ version: 1, scheme: { ...DARK, background: "red" } }),
    ]) {
      writeFileSync(file, text);
      const seen: Array<{ event: string; attrs?: unknown }> = [];
      const store = new TerminalSchemeStore({ file, logger: captured(seen) });
      expect(store.get(), text).toBeNull();
      expect(
        seen.map((entry) => entry.event),
        text,
      ).toEqual(["fieldd.terminal.scheme_not_read"]);
    }

    const later = { version: 1, scheme: { ...DARK, later: true }, later: 1 };
    writeFileSync(file, JSON.stringify(later));
    expect(new TerminalSchemeStore({ file }).get()).toMatchObject(DARK);

    writeFileSync(file, "not json");
    new TerminalSchemeStore({ file }).keep(LIGHT);
    expect(new TerminalSchemeStore({ file }).get()).toEqual(LIGHT);
  });

  it("a file it cannot read is never set too, and says so rather than throwing", () => {
    const file = schemeFile();
    // a folder where the file would be
    mkdirSync(file, { recursive: true });
    const seen: Array<{ event: string; attrs?: unknown }> = [];
    expect(new TerminalSchemeStore({ file, logger: captured(seen) }).get()).toBeNull();
    expect(seen.map((entry) => entry.event)).toEqual(["fieldd.terminal.scheme_unreadable"]);
  });

  it("throws when the scheme cannot be written, and keeps answering the scheme it last kept", () => {
    const file = schemeFile();
    const store = new TerminalSchemeStore({ file });
    store.keep(DARK);
    // fieldd's folder is a regular file now: nothing can be written beneath it
    rmSync(dirname(file), { recursive: true, force: true });
    writeFileSync(dirname(file), "not a folder");
    expect(() => store.keep(LIGHT)).toThrow();
    expect(store.get(), "what a restart would restore is what sessions were told").toEqual(DARK);

    // a store that has never kept one: no scheme before the failure, none after
    const fresh = new TerminalSchemeStore({ file });
    expect(fresh.get()).toBeNull();
    expect(() => fresh.keep(LIGHT)).toThrow();
    expect(fresh.get()).toBeNull();
  });
});
