/**
 * PT-S3 (D3) — what main's OS opener was handed, as smoke:canvas reads it (testing/smoke-opens.ts): the judge passes a row
 * that offers no act and moved nothing, and a phone's Open Settings that recorded main's ONE fixed address once; it fails,
 * in words, a run with no record, an act that never reached the opener, another address or a second one, and a path
 * revealed — and never prints a UUID. Held in the source (main/index.ts runs at its load, so no unit reaches its wiring):
 * the address restated is main's own, and smoke:canvas is handed the record exactly as the godview smoke is — the one
 * smoke-like modes make, never production's.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  judgeOpens,
  opensMark,
  SCREEN_RECORDING_SETTINGS,
  type ShellOpens,
} from "../src/testing/smoke-opens";

const ROW = "SIM-NO-PERMISSION";
/** What the opener held before the row — the godview-like link row's address, say, from earlier in the run. */
const EARLIER: ShellOpens = { opened: ["https://example.com/"], revealed: [] };
const pressed = (record: ShellOpens, ...opened: string[]): ShellOpens => ({
  opened: [...record.opened, ...opened],
  revealed: record.revealed,
});

describe("PT-S3 (D3) — what main's opener was handed, judged", () => {
  it("passes a row that offers no act and moved nothing — and a phone's Open Settings, main's ONE address once; what came before the mark is not the row's", () => {
    const before = opensMark(EARLIER);
    expect(before).toEqual({ opened: 1, revealed: 0 });
    expect(judgeOpens("SIM-NONE", EARLIER, before, [])).toEqual([]);
    expect(
      judgeOpens(ROW, pressed(EARLIER, SCREEN_RECORDING_SETTINGS), before, [
        SCREEN_RECORDING_SETTINGS,
      ]),
    ).toEqual([]);
    // the address is Screen Recording's, in System Settings
    expect(SCREEN_RECORDING_SETTINGS).toBe(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    );
  });

  it("a run main handed no record proved nothing — what it opens reaches the OS", () => {
    expect(
      judgeOpens(ROW, undefined, { opened: 0, revealed: 0 }, [SCREEN_RECORDING_SETTINGS]),
    ).toEqual([
      `${ROW}: main handed the row no opener record — what it opens reaches the OS; the row proved nothing`,
    ]);
    expect(judgeOpens("SIM-NONE", undefined, { opened: 0, revealed: 0 }, [])).toHaveLength(1);
  });

  it("FAILS an act that never reached the opener, another address, a second press, and anything at all under a row that offers no act", () => {
    const before = opensMark(EARLIER);
    expect(judgeOpens(ROW, EARLIER, before, [SCREEN_RECORDING_SETTINGS])).toEqual([
      `${ROW}: ${JSON.stringify([SCREEN_RECORDING_SETTINGS])} never reached main's opener — the act did not run there`,
    ]);
    expect(
      judgeOpens(ROW, pressed(EARLIER, "x-apple.systempreferences:"), before, [
        SCREEN_RECORDING_SETTINGS,
      ]),
    ).toEqual([
      `${ROW}: main's opener was handed ["x-apple.systempreferences:"], not ${JSON.stringify([SCREEN_RECORDING_SETTINGS])}`,
    ]);
    const twice = pressed(EARLIER, SCREEN_RECORDING_SETTINGS, SCREEN_RECORDING_SETTINGS);
    expect(judgeOpens(ROW, twice, before, [SCREEN_RECORDING_SETTINGS])).toHaveLength(1);
    expect(judgeOpens("SIM-NONE", pressed(EARLIER, SCREEN_RECORDING_SETTINGS), before, [])).toEqual(
      [`SIM-NONE: main's opener was handed ${JSON.stringify([SCREEN_RECORDING_SETTINGS])}, not []`],
    );
  });

  it("fails a path revealed by its count, never the path — and masks a UUID in any address it prints", () => {
    const udid = "1BD54690-0A1B-4C2D-8E3F-0123456789AB";
    const before = opensMark(EARLIER);
    const seen: ShellOpens = {
      opened: [...EARLIER.opened, `x-test://device/${udid.toLowerCase()}`],
      revealed: [`/Users/x/Library/Developer/CoreSimulator/Devices/${udid}`],
    };
    const out = judgeOpens(ROW, seen, before, [SCREEN_RECORDING_SETTINGS]);
    expect(out).toEqual([
      `${ROW}: main's opener was handed ["x-test://device/<uuid>"], not ${JSON.stringify([SCREEN_RECORDING_SETTINGS])}`,
      `${ROW}: main's opener was asked to reveal 1 path(s) — no row of the phone reveals one`,
    ]);
    expect(out.join("\n").toLowerCase()).not.toContain(udid.toLowerCase());
  });

  describe("held in main's source (main/index.ts)", () => {
    const index = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");
    /** A runner's call in main: from `.runSmoke<Name>({` to its `onWindow:` — the options main hands it. */
    const handed = (name: string): string => {
      const start = index.indexOf(`(await testing()).${name}({`);
      if (start < 0) throw new Error(`main calls no ${name}`);
      const end = index.indexOf("onWindow:", start);
      return index.slice(start, end);
    };
    const RECORD = "...(harnessShellOpens === null ? {} : { shellOpens: harnessShellOpens }),";

    it("the address restated is the one main's Open Settings records", () => {
      const url = /openSettings: \(\) => \{\s*const url =\s*"([^"]+)";/u.exec(index)?.[1];
      expect(url).toBe(SCREEN_RECORDING_SETTINGS);
    });

    it("smoke:canvas is handed the opener's record exactly as the godview smoke is", () => {
      expect(handed("runSmokeGodview")).toContain(RECORD);
      expect(handed("runSmokeCanvas")).toContain(RECORD);
    });

    it("the record is made only in a smoke-like mode — production's opener opens, and hands no smoke a record", () => {
      expect(index).toMatch(
        /const harnessShellOpens: \{ opened: string\[\]; revealed: string\[\] \} \| null = isSmokeLike\(MODE\)\s*\? \{ opened: \[\], revealed: \[\] \}\s*: null;/u,
      );
    });
  });
});
