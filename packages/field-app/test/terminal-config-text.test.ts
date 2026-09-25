/**
 * GT-7 — config.ghostty as Settings → Terminal reads and writes it. The page
 * rewrites ONE region, ghosttea's managed block, and these cases hold the two
 * promises that make that safe: every line outside the block survives byte for
 * byte, and a save-then-clear returns the user's own file. The block's markers
 * are ghosttea's own, so its editor and this page recognize each other's block.
 */
import { describe, expect, it } from "vitest";
import {
  changedKeyCount,
  EMPTY_MANAGED_VALUES,
  formatBytes,
  MANAGED_BLOCK_END,
  MANAGED_BLOCK_START,
  MalformedManagedBlockError,
  type ManagedValues,
  managedBlockState,
  paletteIndicesSet,
  parseConfigLines,
  parsePaletteValue,
  preferredNewline,
  readManagedValues,
  writeManagedValues,
} from "../src/panels/terminal/config-text";

const NOTE =
  "# Settings → Terminal writes the lines in this block. Everything outside it is yours.";

const VALUES: ManagedValues = {
  palette: new Map([
    [4, "#81A1C1"],
    [1, "#e06c75"],
  ]),
  scrollbackLimit: 25_000_000,
  linkUrl: false,
  keybinds: ["ctrl+super+k=clear_screen", "super+k=unbind"],
  clearDefaults: false,
};

describe("the managed block", () => {
  it("is appended after one blank line, in a fixed order, leaving the user's lines alone", () => {
    const own = "# mine\ncursor-style = bar\nfont-thicken = true\n";
    expect(writeManagedValues(own, VALUES)).toBe(
      [
        "# mine",
        "cursor-style = bar",
        "font-thicken = true",
        "",
        MANAGED_BLOCK_START,
        NOTE,
        "palette = 1=#e06c75",
        "palette = 4=#81a1c1",
        "scrollback-limit = 25000000",
        "link-url = false",
        "keybind = ctrl+super+k=clear_screen",
        "keybind = super+k=unbind",
        MANAGED_BLOCK_END,
        "",
      ].join("\n"),
    );
  });

  it("reads back exactly what it wrote", () => {
    const written = writeManagedValues("cursor-style = bar\n", VALUES);
    const read = readManagedValues(written);
    expect(read.scrollbackLimit).toBe(25_000_000);
    expect(read.linkUrl).toBe(false);
    expect(read.keybinds).toEqual(["ctrl+super+k=clear_screen", "super+k=unbind"]);
    expect(read.clearDefaults).toBe(false);
    expect([...(read.palette ?? new Map()).entries()]).toEqual([
      [1, "#e06c75"],
      [4, "#81a1c1"],
    ]);
  });

  it("returns the user's own bytes when every value is cleared again", () => {
    for (const own of ["", "cursor-style = bar\n", "a = 1\n\n\n", "no-newline = at-end"]) {
      const written = writeManagedValues(own, VALUES);
      const cleared = writeManagedValues(written, EMPTY_MANAGED_VALUES);
      // A file that ended in blank lines, or in none, comes back without them
      // or with one: the block is removed with its one separator.
      expect(cleared.trimEnd()).toBe(own.trimEnd());
      expect(managedBlockState(cleared)).toBe("absent");
    }
    expect(writeManagedValues(writeManagedValues("x = 1\n", VALUES), EMPTY_MANAGED_VALUES)).toBe(
      "x = 1\n",
    );
  });

  it("rewrites in place, keeping lines after the block where they were", () => {
    const text = [
      "before = 1",
      "",
      MANAGED_BLOCK_START,
      NOTE,
      "scrollback-limit = 1000000",
      MANAGED_BLOCK_END,
      "after = 2",
      "",
    ].join("\n");
    const next = writeManagedValues(text, { ...EMPTY_MANAGED_VALUES, scrollbackLimit: 5_000_000 });
    expect(next).toBe(text.replace("scrollback-limit = 1000000", "scrollback-limit = 5000000"));
  });

  it("keeps a CRLF file CRLF", () => {
    const next = writeManagedValues("a = 1\r\nb = 2\r\n", {
      ...EMPTY_MANAGED_VALUES,
      scrollbackLimit: 1_000_000,
    });
    expect(preferredNewline(next)).toBe("\r\n");
    expect(next.replaceAll("\r\n", "")).not.toContain("\n");
    expect(next.endsWith("\r\n")).toBe(true);
  });

  it("writes `keybind = clear` ahead of the page's bindings", () => {
    const next = writeManagedValues("", {
      ...EMPTY_MANAGED_VALUES,
      keybinds: ["super+t=new_tab"],
      clearDefaults: true,
    });
    const lines = next.split("\n");
    expect(lines.indexOf("keybind = clear")).toBeLessThan(
      lines.indexOf("keybind = super+t=new_tab"),
    );
    expect(readManagedValues(next)).toMatchObject({
      keybinds: ["super+t=new_tab"],
      clearDefaults: true,
    });
  });

  it("reads `clear` as the loader does — the bindings above it are gone too", () => {
    const text = [
      MANAGED_BLOCK_START,
      "keybind = super+a=select_all",
      "keybind = clear",
      "keybind = super+b=new_tab",
      MANAGED_BLOCK_END,
    ].join("\n");
    expect(readManagedValues(text)).toMatchObject({
      keybinds: ["super+b=new_tab"],
      clearDefaults: true,
    });
  });

  it("reads only the block: the same keys set by hand elsewhere stay the user's", () => {
    const text = [
      "palette = 2=#112233",
      "scrollback-limit = 99",
      "link-url = false",
      "keybind = super+x=cut",
      MANAGED_BLOCK_START,
      "palette = 1=#445566",
      MANAGED_BLOCK_END,
    ].join("\n");
    const read = readManagedValues(text);
    expect([...(read.palette ?? new Map()).keys()]).toEqual([1]);
    expect(read.scrollbackLimit).toBeNull();
    expect(read.linkUrl).toBeNull();
    expect(read.keybinds).toBeNull();
  });

  it("GT-8a: writes link-url after scrollback and before the shortcuts, and reads it back", () => {
    const on = writeManagedValues("", {
      ...EMPTY_MANAGED_VALUES,
      scrollbackLimit: 1_000_000,
      linkUrl: true,
      keybinds: ["super+t=new_tab"],
    });
    const lines = on.split("\n");
    expect(lines.indexOf("link-url = true")).toBe(lines.indexOf("scrollback-limit = 1000000") + 1);
    expect(lines.indexOf("keybind = super+t=new_tab")).toBe(lines.indexOf("link-url = true") + 1);
    expect(readManagedValues(on).linkUrl).toBe(true);
    // a block that says nothing about it says nothing: the layers below decide
    expect(
      readManagedValues(writeManagedValues("", { ...EMPTY_MANAGED_VALUES, linkUrl: false })),
    ).toMatchObject({ linkUrl: false, scrollbackLimit: null });
    expect(
      readManagedValues(writeManagedValues("", { ...EMPTY_MANAGED_VALUES, scrollbackLimit: 1 }))
        .linkUrl,
    ).toBeNull();
    expect(EMPTY_MANAGED_VALUES.linkUrl).toBeNull();
    expect(writeManagedValues("x = 1\n", { ...EMPTY_MANAGED_VALUES, linkUrl: null })).toBe(
      "x = 1\n",
    );
  });

  it("GT-8a: reads link-url the way the loader does — an unreadable value says nothing", () => {
    const block = (...values: string[]): string =>
      [MANAGED_BLOCK_START, ...values.map((value) => `link-url =${value}`), MANAGED_BLOCK_END].join(
        "\n",
      );
    expect(readManagedValues(block(" false")).linkUrl).toBe(false);
    expect(readManagedValues(block(" true")).linkUrl).toBe(true);
    // the loader's error to report, not a value to show
    expect(readManagedValues(block(" maybe")).linkUrl).toBeNull();
    expect(readManagedValues(block(" FALSE")).linkUrl).toBeNull();
    expect(readManagedValues(block(" 0")).linkUrl).toBeNull();
    // the last readable line wins; an unreadable one after it changes nothing
    expect(readManagedValues(block(" true", " false", " maybe")).linkUrl).toBe(false);
    // an empty value resets the key to its default, which is on
    expect(readManagedValues(block(" false", "")).linkUrl).toBe(true);
  });

  it("refuses to rewrite a block whose markers are missing, repeated or reversed", () => {
    const malformed = [
      `${MANAGED_BLOCK_START}\nscrollback-limit = 1\n`,
      `scrollback-limit = 1\n${MANAGED_BLOCK_END}\n`,
      `${MANAGED_BLOCK_END}\n${MANAGED_BLOCK_START}\n`,
      `${MANAGED_BLOCK_START}\n${MANAGED_BLOCK_START}\n${MANAGED_BLOCK_END}\n`,
    ];
    for (const text of malformed) {
      expect(managedBlockState(text)).toBe("malformed");
      expect(readManagedValues(text)).toBe(EMPTY_MANAGED_VALUES);
      expect(() => writeManagedValues(text, VALUES)).toThrow(MalformedManagedBlockError);
    }
  });

  it("finds the markers with the indentation a hand edit might add", () => {
    expect(managedBlockState(`  ${MANAGED_BLOCK_START}\n${MANAGED_BLOCK_END}  \n`)).toBe("present");
  });
});

describe("reading lines", () => {
  it("classifies every line, unquotes values and flags the block's markers", () => {
    const lines = parseConfigLines(
      [
        'font-family = "Berkeley Mono"',
        "# a comment",
        "",
        "bare-key",
        MANAGED_BLOCK_START,
        "scrollback-limit = 1",
        MANAGED_BLOCK_END,
      ].join("\n"),
    );
    expect(lines.map((line) => [line.number, line.kind, line.managed])).toEqual([
      [1, "setting", false],
      [2, "comment", false],
      [3, "blank", false],
      [4, "bare", false],
      [5, "comment", true],
      [6, "setting", true],
      [7, "comment", true],
    ]);
    expect(lines[0]).toMatchObject({ key: "font-family", value: "Berkeley Mono" });
    expect(lines[3]).toMatchObject({ key: "bare-key" });
    expect(lines[4]?.marker).toBe("start");
    expect(lines[6]?.marker).toBe("end");
  });

  it("parses a palette entry only for the first sixteen colours, in hex", () => {
    expect(parsePaletteValue("1=#AbCdEf")).toEqual([1, "#abcdef"]);
    expect(parsePaletteValue(" 2 = 112233 ")).toEqual([2, "#112233"]);
    expect(parsePaletteValue("15=#ffffff")).toEqual([15, "#ffffff"]);
    expect(parsePaletteValue("16=#000000")).toBeNull();
    expect(parsePaletteValue("3=red")).toBeNull();
    expect(parsePaletteValue("#123456")).toBeNull();
  });

  it("counts the palette indices a document sets anywhere, and `palette =` resets them", () => {
    expect([
      ...paletteIndicesSet("palette = 1=#ffffff\npalette = 2=#000000\npalette = 9=nope\n"),
    ]).toEqual([1, 2]);
    expect([...paletteIndicesSet("palette = 1=#ffffff\npalette =\npalette = 3=#123456\n")]).toEqual(
      [3],
    );
  });
});

describe("the save bar's words", () => {
  it("counts changed settings by key, ignoring comments and blank lines", () => {
    const saved = "# old comment\nfont-size = 13\nkeybind = a=b\n";
    expect(changedKeyCount(saved, saved)).toBe(0);
    expect(changedKeyCount(saved, "# new comment\n\nfont-size = 13\nkeybind = a=b\n")).toBe(0);
    expect(
      changedKeyCount(saved, "font-size = 14\nkeybind = a=b\nkeybind = c=d\nkeybind = e=f\n"),
    ).toBe(2);
  });

  it("says bytes the way the page does", () => {
    expect(formatBytes(999)).toBe("999 bytes");
    expect(formatBytes(1_500)).toBe("2 KB");
    expect(formatBytes(2_500_000)).toBe("2.5 MB");
    expect(formatBytes(10_000_000)).toBe("10 MB");
    expect(formatBytes(1_000_000_000)).toBe("1.0 GB");
  });
});
