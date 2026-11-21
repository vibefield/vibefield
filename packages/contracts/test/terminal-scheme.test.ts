import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { METHODS } from "../src/methods";
import { LAYOUT, TAILNET_GUEST_SCOPES, TAILNET_SCOPES } from "../src/registries";
import { TerminalScheme, TerminalSchemeSetParams, TerminalSchemeSetResult } from "../src/terminal";

// TL-4a — the terminal scheme's wire shape and who may say it.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

const scheme = TerminalScheme.parse(fixture("terminal-scheme.valid.json"));

describe("the terminal scheme (TL-4a)", () => {
  it("reads a whole scheme: ground, ink, cursor and sixteen palette slots", () => {
    expect(scheme.background).toBe("#ece8dc");
    expect(scheme.palette.map((entry) => entry.index)).toEqual(
      Array.from({ length: 16 }, (_, index) => index),
    );
  });

  it("refuses a colour that is not #rrggbb, wherever it stands", () => {
    for (const color of ["ece8dc", "#ece8d", "#ece8dcff", "#gggggg", "rgb(1,2,3)", "", 0]) {
      expect(TerminalScheme.safeParse({ ...scheme, background: color }).success).toBe(false);
      expect(TerminalScheme.safeParse({ ...scheme, foreground: color }).success).toBe(false);
      expect(TerminalScheme.safeParse({ ...scheme, cursor: color }).success).toBe(false);
      expect(TerminalScheme.safeParse({ ...scheme, palette: [{ index: 1, color }] }).success).toBe(
        false,
      );
    }
  });

  it("refuses a palette that names an index twice, an index past 255, or more than 256 slots", () => {
    const slot = (index: number) => ({ index, color: "#000000" });
    expect(TerminalScheme.safeParse({ ...scheme, palette: [slot(3), slot(3)] }).success).toBe(
      false,
    );
    expect(TerminalScheme.safeParse({ ...scheme, palette: [slot(256)] }).success).toBe(false);
    expect(TerminalScheme.safeParse({ ...scheme, palette: [slot(-1)] }).success).toBe(false);
    expect(TerminalScheme.safeParse({ ...scheme, palette: [slot(1.5)] }).success).toBe(false);
    const every = Array.from({ length: 256 }, (_, index) => slot(index));
    expect(TerminalScheme.safeParse({ ...scheme, palette: every }).success).toBe(true);
    expect(TerminalScheme.safeParse({ ...scheme, palette: [...every, slot(0)] }).success).toBe(
      false,
    );
  });

  it("takes an empty palette, and keeps a field it has never heard of", () => {
    const parsed = TerminalSchemeSetParams.parse({
      scheme: { ...scheme, palette: [], later: "kept" },
    });
    expect(parsed.scheme.palette).toEqual([]);
    expect((parsed.scheme as Record<string, unknown>).later).toBe("kept");
  });

  it("says each cell's state, and reads a state it does not know", () => {
    const result = TerminalSchemeSetResult.parse(
      fixture("terminal-scheme-set-result.down-cell.json"),
    );
    expect(result.cells.map((cell) => cell.state)).toEqual(["told", "unavailable"]);
    const later = TerminalSchemeSetResult.parse({
      changed: true,
      cells: [{ state: "a-later-state", sessions: 0 }],
    });
    expect(later.cells[0]?.state).toBe("a-later-state");
    // TL-4b (2026-11-18): the third state fieldd says, a cell one of whose
    // live sessions refused the scheme; `sessions` counts the ones told
    const refused = TerminalSchemeSetResult.parse({
      changed: true,
      cells: [{ cellBootId: "cell-i", state: "refused", sessions: 1 }],
    });
    expect(refused.cells[0]).toMatchObject({ state: "refused", sessions: 1 });
  });

  it("is said on settings.manage, on this device only, and no tailnet caller holds that scope", () => {
    const row = METHODS.filter((method) => method.method.startsWith("terminal.scheme."));
    expect(
      row.map((method) => ({
        method: method.method,
        surface: method.surface,
        scope: method.scope,
        idempotent: method.idempotent,
        locality: method.locality,
      })),
    ).toEqual([
      {
        method: "terminal.scheme.set",
        surface: "product",
        scope: "settings.manage",
        idempotent: true,
        locality: "local",
      },
    ]);
    expect(TAILNET_SCOPES as readonly string[]).not.toContain("settings.manage");
    expect(TAILNET_GUEST_SCOPES as readonly string[]).not.toContain("settings.manage");
  });

  it("is kept in fieldd's own folder", () => {
    expect(LAYOUT.TERMINAL_SCHEME_FILE).toEqual(["fieldd", "terminal-scheme.json"]);
  });
});
