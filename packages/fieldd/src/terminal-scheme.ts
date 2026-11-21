import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { GhostteaAutomationClient } from "@vibecook/ghosttea-client";
import { type TerminalScheme, TerminalSchemeFile } from "@vibefield/contracts";
import { createNoopLogger, durableRenameSync, type Logger } from "@vibefield/logging";

// TL-4a (2026-11-18) — WHAT A SESSION IS TOLD ITS TERMINAL LOOKS LIKE. A program
// asks its terminal what the ground is (OSC 10 and 11, the colour-scheme
// report, `COLORFGBG`) and picks its dark or its light design from the answer.
// The answer is the session's, not a pane's, so fieldd says it: the scheme the
// device's deck last set is kept here, and the terminal service tells it to
// every local session, in every cell, pane or no pane.
//
// Everything a session is told is built here from a PARSED scheme. A caller's
// string never reaches the floor.

/** One colour as the floor takes it. */
export type SchemeRgb = [number, number, number];

/** What a session is told, as the floor's client takes it (ghosttea's
 * `SessionColors`): the ground, the ink and the cursor, and a palette of
 * `[index, colour]` slots. TL-4b (2026-11-18): the palette is told to a floor
 * that reads one, which is ghosttea protocol 1.20; an older floor is told the
 * three colours alone (`schemeColorsWithoutPalette`). */
export type SchemeColors = Parameters<GhostteaAutomationClient["setColors"]>[1];

function rgbOf(color: string): SchemeRgb {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** No slot a person set: what a caller with no configuration to hold to passes. */
const NO_SLOTS: ReadonlySet<number> = new Set();

/** The scheme as a session is told it: the three colours, and the palette slot
 * by slot in index order, so two schemes that tell the same thing tell the
 * same bytes. A scheme that names no slot says an EMPTY palette, never none:
 * on the floor that leaves every slot to the configuration, and it takes back
 * the slots an earlier scheme named.
 *
 * Item 590 (2026-11-19): `theirs` are the slots the session's own
 * configuration sets (a `palette =` line in a Ghostty file). They are left
 * out, so a colour a person set stays theirs and the scheme fills the rest. */
export function schemeColors(
  scheme: TerminalScheme,
  theirs: ReadonlySet<number> = NO_SLOTS,
): SchemeColors {
  return {
    ...schemeColorsWithoutPalette(scheme),
    palette: [...scheme.palette]
      .filter((entry) => !theirs.has(entry.index))
      .sort((left, right) => left.index - right.index)
      .map((entry): [number, SchemeRgb] => [entry.index, rgbOf(entry.color)]),
  };
}

/** The slots a configuration sets, from the snapshot a cell reports: the
 * renderer's palette, or the terminal's where an older floor sends only that,
 * as `projectConfigSnapshot` reads them. Item 590 (2026-11-19). */
export function configuredSlots(snapshot: {
  readonly renderer: { readonly palette?: readonly { readonly index: number }[] };
  readonly terminal: { readonly palette?: readonly { readonly index: number }[] };
}): ReadonlySet<number> {
  const palette = snapshot.renderer.palette ?? snapshot.terminal.palette ?? [];
  return new Set(palette.map((entry) => entry.index));
}

/** The three colours and no palette: all a floor before ghosttea protocol 1.20
 * reads, and all the client lets through to one. */
export function schemeColorsWithoutPalette(scheme: TerminalScheme): SchemeColors {
  return {
    foreground: rgbOf(scheme.foreground),
    background: rgbOf(scheme.background),
    cursor: rgbOf(scheme.cursor),
  };
}

/** Whether a ground is light, by ghosttea's own rule (`background_is_light` in
 * its session.rs, which matches the terminal's colour-scheme answer): light
 * when black text out-contrasts white text on it, which is a WCAG relative
 * luminance above about 0.179. `#757575` is dark and `#767676` is light. */
export function schemeGroundIsLight(background: SchemeRgb): boolean {
  const linear = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance =
    0.2126 * linear(background[0]) +
    0.7152 * linear(background[1]) +
    0.0722 * linear(background[2]);
  return (luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05);
}

/** The variable a program reads at startup for its terminal's ground. */
export const SCHEME_HINT_VARIABLE = "COLORFGBG";

/** `COLORFGBG` for a scheme, in the rxvt `fg;bg` palette-index convention a
 * program reads at startup: `0;15` on a light ground, `15;0` on a dark one.
 * THE ONE PLACE fieldd derives it. The floor would write its own from the
 * configuration's ground; fieldd's value wins there, because the floor keeps a
 * value its caller set. */
export function schemeColorFgBg(scheme: TerminalScheme): "0;15" | "15;0" {
  return schemeGroundIsLight(rgbOf(scheme.background)) ? "0;15" : "15;0";
}

/** What a session is born with, as the floor's client takes it. */
export type SchemeBirthOptions = Parameters<GhostteaAutomationClient["createSession"]>[0];

/** A birth's options with `COLORFGBG` from the kept scheme, set in whichever
 * environment the birth names. A birth that names its own value keeps it (no
 * birth fieldd composes does: the agent environment's allow-list does not
 * carry the variable), and with no kept scheme nothing is added: the floor
 * then writes its own from the configuration's ground, as it always did. */
export function withSchemeHint(
  options: SchemeBirthOptions,
  scheme: TerminalScheme | null,
): SchemeBirthOptions {
  if (scheme === null) return options;
  const hint = { [SCHEME_HINT_VARIABLE]: schemeColorFgBg(scheme) };
  const { environment } = options;
  if (environment === undefined) {
    if (options.env?.[SCHEME_HINT_VARIABLE] !== undefined) return options;
    return { ...options, env: { ...options.env, ...hint } };
  }
  if (environment.mode === "inherit") {
    if (environment.overrides?.[SCHEME_HINT_VARIABLE] !== undefined) return options;
    return {
      ...options,
      environment: { ...environment, overrides: { ...environment.overrides, ...hint } },
    };
  }
  if (environment.variables[SCHEME_HINT_VARIABLE] !== undefined) return options;
  return {
    ...options,
    environment: { ...environment, variables: { ...environment.variables, ...hint } },
  };
}

/** Whether two schemes tell a session the same thing: colours compared without
 * case, the palette by index whatever its order. */
export function sameScheme(left: TerminalScheme, right: TerminalScheme): boolean {
  const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
  if (
    !same(left.foreground, right.foreground) ||
    !same(left.background, right.background) ||
    !same(left.cursor, right.cursor) ||
    left.palette.length !== right.palette.length
  ) {
    return false;
  }
  const slots = new Map(left.palette.map((entry) => [entry.index, entry.color]));
  return right.palette.every((entry) => {
    const color = slots.get(entry.index);
    return color !== undefined && same(color, entry.color);
  });
}

export interface TerminalSchemeStoreOptions {
  /** `<user root>/fieldd/terminal-scheme.json` (LAYOUT `TERMINAL_SCHEME_FILE`);
   * absent = the scheme is kept in memory only */
  file?: string | undefined;
  logger?: Logger | undefined;
}

/** FIELDD'S KEPT SCHEME. On disk (0600, written whole and renamed durably)
 * because a session can be born with the app closed, and fieldd tells it the
 * scheme with no deck to ask. Before a deck has ever said one there is none,
 * and fieldd then tells a session nothing: it follows the floor's
 * configuration, as every session did before TL-4a. A file that is not the
 * contract's is logged and read as "never set"; the next scheme replaces it. */
export class TerminalSchemeStore {
  private scheme: TerminalScheme | null = null;
  private readonly logger: Logger;

  constructor(private readonly opts: TerminalSchemeStoreOptions = {}) {
    this.logger = opts.logger ?? createNoopLogger();
    this.scheme = this.load();
  }

  /** The kept scheme, or null when none was ever set. */
  get(): TerminalScheme | null {
    return this.scheme;
  }

  /** Keep `scheme`. THROWS when it cannot be written: the caller then tells no
   * session, so what a restart restores is what the sessions were told. */
  keep(scheme: TerminalScheme): void {
    const file = this.opts.file;
    if (file !== undefined) {
      const record: TerminalSchemeFile = { version: 1, scheme };
      const tmp = `${file}.${randomUUID()}.tmp`;
      try {
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
        writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: "wx" });
        durableRenameSync(tmp, file);
        if (process.platform !== "win32" && (statSync(file).mode & 0o777) !== 0o600)
          chmodSync(file, 0o600);
      } catch (error) {
        rmSync(tmp, { force: true });
        throw error;
      }
    }
    this.scheme = scheme;
  }

  private load(): TerminalScheme | null {
    const file = this.opts.file;
    if (file === undefined) return null;
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      this.logger.warn(
        "fieldd.terminal.scheme_unreadable",
        "The kept terminal scheme could not be read; sessions follow the configuration until one is set",
        { error: error instanceof Error ? error.message : String(error) },
      );
      return null;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      raw = undefined;
    }
    const parsed = TerminalSchemeFile.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(
        "fieldd.terminal.scheme_not_read",
        "The kept terminal scheme is not one this fieldd reads; sessions follow the configuration until one is set",
        { issues: parsed.error.issues.map((issue) => issue.path.join(".")) },
      );
      return null;
    }
    return parsed.data.scheme;
  }
}
