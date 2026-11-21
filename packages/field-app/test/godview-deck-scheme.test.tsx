// @vitest-environment happy-dom
/**
 * The deck says the device's terminal scheme (TL-4a).
 *
 * What a program in a pane is told its terminal looks like is the deck's look,
 * said to fieldd. Three properties are held here. The scheme is the opaque
 * ground, ink and cursor of the theme the deck draws with, in the contract's
 * own form. It is said once the look has stood still, so a look being dragged
 * tells fieldd where it came to rest and nothing on the way. And exactly one
 * module says it: a preview that tries a look on must never recolour what every
 * running agent on the device is told. A say fieldd refuses is logged by its
 * code, once, so it is never a silent end.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TerminalScheme } from "@vibefield/contracts";
import { FielddRpcError } from "@vibefield/fieldd-client";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DECK_APPEARANCE } from "../src/godview/deck-appearance";
import {
  DECK_SCHEME_SETTLE_MS,
  type DeckSchemeDoor,
  deckTerminalScheme,
  resetDeckSchemeForTests,
  useSayDeckScheme,
} from "../src/godview/deck-scheme";
import {
  godviewTerminalPalette,
  godviewTerminalTheme,
  type TerminalTheme,
} from "../src/godview/deck-theme";
import { GODVIEW_TERMINAL_LOOK } from "../src/godview/terminal-look";
import { getRendererLogger, type RendererLogger, setRendererLogger } from "../src/logging";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** A deck pane's look as the deck holds it: the theme its panes are handed, and the sixteen its
 * sessions are told (TL-4c). */
interface Look {
  readonly theme: TerminalTheme;
  readonly palette: readonly string[];
}

function lookOf(mode: "light" | "dark", appearance = DEFAULT_DECK_APPEARANCE): Look {
  return {
    theme: godviewTerminalTheme(appearance, mode),
    palette: godviewTerminalPalette(appearance, mode),
  };
}

const light = lookOf("light");
const dark = lookOf("dark");
const schemeOf = (look: Look) => deckTerminalScheme(look.theme, look.palette);

function Probe({ door, look }: { door: DeckSchemeDoor; look: Look }): null {
  useSayDeckScheme(door, look.theme, look.palette);
  return null;
}

describe("the scheme a pane look stands for (TL-4a, TL-4c)", () => {
  it("is the theme's ground, ink and cursor as #rrggbb with the look's sixteen by index, in the contract's form", () => {
    for (const [mode, look] of [
      ["light", light],
      ["dark", dark],
    ] as const) {
      const scheme = schemeOf(look);
      expect(TerminalScheme.parse(scheme)).toEqual(scheme);
      expect(scheme.palette, mode).toEqual(
        GODVIEW_TERMINAL_LOOK[mode].palette.map((color, index) => ({ index, color })),
      );
    }
    expect(schemeOf(light).background).not.toBe(schemeOf(dark).background);
  });

  it("drops the pane's alpha: a glassier pane stands for the same scheme", () => {
    const glassy = lookOf("light", { ...DEFAULT_DECK_APPEARANCE, opacity: 0.4 });
    expect(glassy.theme.background[3]).toBe(0.4);
    expect(schemeOf(glassy)).toEqual(schemeOf(light));
  });

  it("rounds each channel to a byte and keeps it in range", () => {
    const scheme = deckTerminalScheme(
      {
        foreground: [0, 0.5, 1, 1],
        background: [-0.2, 1.7, 0.999, 0.3],
        cursor: [1 / 255, 254 / 255, 0.25, 1],
      },
      [],
    );
    expect(scheme).toEqual({
      foreground: "#0080ff",
      background: "#00ffff",
      cursor: "#01fe40",
      palette: [],
    });
  });

  it("keeps a palette colour only as #rrggbb, lowercase, at its own index: a slot it cannot read follows the configuration", () => {
    const scheme = deckTerminalScheme(light.theme, [
      "#ABCDEF",
      "nope",
      " #123456 ",
      "#1234567",
      "#abc",
    ]);
    expect(scheme.palette).toEqual([
      { index: 0, color: "#abcdef" },
      { index: 2, color: "#123456" },
    ]);
    expect(TerminalScheme.parse(scheme)).toEqual(scheme);
  });
});

describe("the deck says its scheme to fieldd (TL-4a)", () => {
  let container: HTMLDivElement;
  let root: Root;
  let said: Array<[string, unknown]>;
  let door: DeckSchemeDoor;
  let logged: Array<{ event: string; attrs: unknown }>;
  let previousLogger: RendererLogger;

  beforeEach(() => {
    logged = [];
    const logger: RendererLogger = {
      child: () => logger,
      trace: () => undefined,
      debug: () => undefined,
      info: () => undefined,
      warn: (event, _message, attrs) => logged.push({ event, attrs }),
      error: (event, _message, _error, attrs) => logged.push({ event, attrs }),
      fatal: (event, _message, _error, attrs) => logged.push({ event, attrs }),
      isLevelEnabled: () => true,
    };
    previousLogger = getRendererLogger();
    setRendererLogger(logger);
    resetDeckSchemeForTests();
    // the settle timer alone: React's own scheduling stays on the real clock
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    said = [];
    door = {
      request: (method, params) => {
        said.push([method, params]);
        return Promise.resolve({ changed: true, cells: [] });
      },
    };
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    setRendererLogger(previousLogger);
  });

  const draw = async (look: Look, through: DeckSchemeDoor = door): Promise<void> => {
    await act(async () => root.render(<Probe door={through} look={look} />));
  };
  const wait = async (ms: number): Promise<void> => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it("says it once the look has stood still, and not before", async () => {
    await draw(light);
    await wait(DECK_SCHEME_SETTLE_MS - 1);
    expect(said).toEqual([]);
    await wait(1);
    expect(said).toEqual([["terminal.scheme.set", { scheme: schemeOf(light) }]]);
  });

  it("says a look that was dragged once, where it came to rest", async () => {
    await draw(light);
    await wait(DECK_SCHEME_SETTLE_MS - 50);
    await draw(dark);
    await wait(DECK_SCHEME_SETTLE_MS - 50);
    await draw(light);
    await wait(DECK_SCHEME_SETTLE_MS - 50);
    await draw(dark);
    expect(said).toEqual([]);
    await wait(DECK_SCHEME_SETTLE_MS);
    expect(said).toEqual([["terminal.scheme.set", { scheme: schemeOf(dark) }]]);
  });

  it("says a change of mode, and says nothing for a change that is only the pane's alpha", async () => {
    await draw(light);
    await wait(DECK_SCHEME_SETTLE_MS);
    await draw(lookOf("light", { ...DEFAULT_DECK_APPEARANCE, opacity: 0.4 }));
    await wait(DECK_SCHEME_SETTLE_MS * 2);
    expect(said).toHaveLength(1);
    await draw(dark);
    await wait(DECK_SCHEME_SETTLE_MS);
    expect(said.map(([, params]) => params)).toEqual([
      { scheme: schemeOf(light) },
      { scheme: schemeOf(dark) },
    ]);
  });

  it("says a change of the palette alone, and nothing for a new list that names the same colours (TL-4c)", async () => {
    await draw(light);
    await wait(DECK_SCHEME_SETTLE_MS);
    await draw({ theme: light.theme, palette: [...light.palette] });
    await wait(DECK_SCHEME_SETTLE_MS * 2);
    expect(said).toHaveLength(1);
    const picked = lookOf("light", {
      ...DEFAULT_DECK_APPEARANCE,
      lightThemeName: "iTerm2 Solarized Light",
    });
    const repainted: Look = { theme: light.theme, palette: picked.palette };
    expect(repainted.palette).not.toEqual(light.palette);
    await draw(repainted);
    await wait(DECK_SCHEME_SETTLE_MS);
    expect(said.map(([, params]) => params)).toEqual([
      { scheme: schemeOf(light) },
      { scheme: schemeOf(repainted) },
    ]);
  });

  it("says nothing after it is gone", async () => {
    await draw(light);
    await act(async () => root.render(null));
    await wait(DECK_SCHEME_SETTLE_MS * 2);
    expect(said).toEqual([]);
  });

  it("logs a refused say once by its code and never the scheme, and again only after a say has succeeded", async () => {
    let answer: () => Promise<unknown> = () =>
      Promise.reject(new FielddRpcError("UNAVAILABLE", "the terminal scheme could not be kept"));
    const moody: DeckSchemeDoor = {
      request: (method, params) => {
        said.push([method, params]);
        return answer();
      },
    };
    const refusals = (): unknown[] =>
      logged.filter((entry) => entry.event === "renderer.godview.scheme_refused");

    // refused: said to the log once, and the next change is still said to fieldd
    await draw(light, moody);
    await wait(DECK_SCHEME_SETTLE_MS);
    await draw(dark, moody);
    await wait(DECK_SCHEME_SETTLE_MS);
    expect(said).toHaveLength(2);
    expect(refusals()).toEqual([
      { event: "renderer.godview.scheme_refused", attrs: { code: "UNAVAILABLE" } },
    ]);

    // another code is another fact: nothing answered at all
    answer = () => Promise.reject(new Error("socket closed"));
    await draw(light, moody);
    await wait(DECK_SCHEME_SETTLE_MS);
    expect(refusals().map((entry) => (entry as { attrs: unknown }).attrs)).toEqual([
      { code: "UNAVAILABLE" },
      { code: "unreachable" },
    ]);

    // a say that succeeds ends it: the same refusal afterwards is said again
    answer = () => Promise.resolve({ changed: true, cells: [] });
    await draw(dark, moody);
    await wait(DECK_SCHEME_SETTLE_MS);
    answer = () => Promise.reject(new Error("socket closed"));
    await draw(light, moody);
    await wait(DECK_SCHEME_SETTLE_MS);
    expect(refusals()).toHaveLength(3);
    expect(logged, "nothing else was logged").toHaveLength(3);
    expect(JSON.stringify(logged), "no colour reaches the log").not.toMatch(/#[0-9a-f]{6}/i);
  });
});

describe("one caller says the scheme (TL-4a)", () => {
  const modules = (readdirSync(SRC, { recursive: true }) as string[])
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => file.replaceAll("\\", "/"))
    .sort();
  const naming = (needle: string): string[] =>
    modules.filter((file) => readFileSync(join(SRC, file), "utf8").includes(needle));

  it("names terminal.scheme.set in one module of the renderer", () => {
    expect(naming("terminal.scheme.set")).toEqual(["godview/deck-scheme.ts"]);
  });

  it("is used by the deck alone, and the deck is mounted by Godview alone", () => {
    expect(naming("useSayDeckScheme(")).toEqual([
      "godview/GodviewDeck.tsx",
      "godview/deck-scheme.ts",
    ]);
    expect(naming("<GodviewDeck\n").concat(naming("<GodviewDeck "))).toEqual([
      "godview/GodviewOverlay.tsx",
    ]);
  });
});
