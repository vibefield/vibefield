// @vitest-environment happy-dom
/**
 * The app's ONE theme (One Frame FR-4, FC-D5; DESIGN.md §10) in the renderer:
 * three states — Light · Dark · Auto — and one owner, main's, which this page
 * only mirrors. The Me menu's Theme and Settings → Appearance are two controls
 * of the SAME setting, so they always show the same state; Auto follows the OS
 * (main's `nativeTheme`); nothing moves until the owner answers; the old
 * renderer boolean is handed to the owner once; and Godview reads the app's
 * theme unless Settings → Terminal's one override is set (FC-D7).
 *
 * The owner here is a faithful stand-in for main's (`resolveTheme` over a
 * flippable OS), behind the same host door the preload exposes.
 */
import { resolveTheme, type ThemePreference, type ThemeState } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeMenu } from "../src/account/MeMenu";
import {
  DEFAULT_DECK_APPEARANCE,
  resetDeckAppearanceForTest,
  setDeckAppearance,
} from "../src/godview/deck-appearance";
import { godviewThemeFor, useGodviewTheme } from "../src/godview/godview-theme";
import { type FieldHost, type FieldThemeHost, setHost } from "../src/host";
import { AppearanceSection } from "../src/panels/AppearanceSection";
import { resetAppThemeForTest, setAppTheme, stampInitialTheme, useAppTheme } from "../src/theme";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const logger = {
  child: () => logger,
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  isLevelEnabled: () => false,
} as unknown as FieldHost["logger"];

/** main's owner, as far as a page can tell: one value, Auto over the OS. */
function fakeMain(preference: ThemePreference = "auto", osDark = false) {
  const main = {
    osDark,
    state: { preference, resolved: resolveTheme(preference, osDark) } as ThemeState,
    handlers: new Set<(state: ThemeState) => void>(),
    /** When set, `set` waits for this before answering. */
    gate: null as Promise<void> | null,
    asked: [] as ThemePreference[],
    tell(next: ThemeState) {
      main.state = next;
      for (const fn of main.handlers) fn(next);
    },
    flip(dark: boolean) {
      main.osDark = dark;
      if (main.state.preference === "auto") {
        main.tell({ preference: "auto", resolved: dark ? "dark" : "light" });
      }
    },
  };
  const door: FieldThemeHost = {
    set: async (next) => {
      main.asked.push(next);
      if (main.gate !== null) await main.gate;
      main.tell({ preference: next, resolved: resolveTheme(next, main.osDark) });
      return main.state;
    },
    onState: (handler) => {
      main.handlers.add(handler);
      handler(main.state);
      return () => main.handlers.delete(handler);
    },
  };
  return { main, door };
}

const USERS = [
  { userId: "me", fuid: 1, name: "James", face: { emoji: "🦊" }, resident: true, onboarded: true },
];

function fieldd(): FielddClient {
  return {
    status: "ready",
    onStatusChange: () => () => undefined,
    subscribe: vi.fn(async (method: string) => {
      if (method === "user.link.subscribe") {
        return {
          subId: "user-link",
          snapshot: {
            link: { login: "james@example.com", linkedAt: "2026-10-03T00:00:00Z" },
            meshEnabled: true,
            nodeState: "Running",
            authUrl: null,
            linkState: "linked",
            linkDetail: null,
          },
          unsubscribe: () => undefined,
        };
      }
      throw new Error(`unexpected subscribe: ${method}`);
    }),
    request: vi.fn(),
  } as unknown as FielddClient;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function host(theme?: FieldThemeHost): void {
  setHost({
    logger,
    getConnection: async () => ({ port: 1, token: "t" }),
    onPrepareClose: () => () => undefined,
    completeClose: () => undefined,
    usersList: vi.fn(async () => ({ attachedUserId: "me", users: USERS })),
    ...(theme === undefined ? {} : { theme }),
  });
}

/** The OS's own query, with a way to flip it (the page with no host reads it). */
function stubOs(dark: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const query = {
    matches: dark,
    addEventListener: (_: string, fn: (event: { matches: boolean }) => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: (event: { matches: boolean }) => void) =>
      listeners.delete(fn),
  };
  vi.stubGlobal("matchMedia", () => query);
  window.matchMedia = (() => query) as unknown as typeof window.matchMedia;
  return {
    flip(next: boolean) {
      query.matches = next;
      for (const fn of listeners) fn({ matches: next });
    },
  };
}

beforeEach(() => {
  resetAppThemeForTest();
  resetDeckAppearanceForTest();
  localStorage.clear();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("data-theme");
  stubOs(false);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
});

async function mount(node: ReactElement): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(node);
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** The Me menu (open, on its real controller) and Settings → Appearance, side by side. */
async function mountBoth(): Promise<void> {
  await mount(
    createElement(
      FielddProvider,
      { client: fieldd() },
      createElement(MeMenu, { open: true, onOpenChange: () => undefined, onOpenSettings: vi.fn() }),
      createElement(AppearanceSection),
    ),
  );
}

const pressed = (label: string): string | undefined =>
  Array.from(
    container?.querySelectorAll<HTMLButtonElement>(
      `fieldset[aria-label="${label}"] button[aria-pressed="true"]`,
    ) ?? [],
  ).map((button) => button.textContent ?? "")[0];
const press = async (label: string, option: string): Promise<void> => {
  const button = Array.from(
    container?.querySelectorAll<HTMLButtonElement>(`fieldset[aria-label="${label}"] button`) ?? [],
  ).find((candidate) => candidate.textContent === option);
  await act(async () => {
    button?.click();
    await Promise.resolve();
    await Promise.resolve();
  });
};
const rowGlyph = (): string | null | undefined =>
  container?.querySelector("[data-me-theme] [data-glyph]")?.getAttribute("data-glyph");
const stampedDark = (): boolean => document.documentElement.classList.contains("dark");

describe("the app's one theme — three states, one owner", () => {
  it("shows the same state in the Me menu's Theme and Settings → Appearance, whichever is pressed", async () => {
    const { main, door } = fakeMain("auto");
    host(door);
    await mountBoth();
    expect(pressed("Theme")).toBe("Auto");
    expect(pressed("Appearance")).toBe("Auto");
    expect(container?.querySelector("[data-me-theme] fieldset")?.textContent).toBe("LightDarkAuto");

    await press("Theme", "Dark");
    expect(main.asked).toEqual(["dark"]);
    expect(pressed("Theme")).toBe("Dark");
    expect(pressed("Appearance")).toBe("Dark");
    expect(stampedDark()).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(rowGlyph()).toBe("moon");

    await press("Appearance", "Light");
    expect(main.asked).toEqual(["dark", "light"]);
    expect(pressed("Theme")).toBe("Light");
    expect(pressed("Appearance")).toBe("Light");
    expect(stampedDark()).toBe(false);
    expect(rowGlyph()).toBe("sun");
  });

  it("follows the OS on Auto — main's nativeTheme flipped — and stays put on an explicit choice", async () => {
    const { main, door } = fakeMain("auto");
    host(door);
    await mountBoth();
    await act(async () => main.flip(true));
    expect(pressed("Theme")).toBe("Auto");
    expect(pressed("Appearance")).toBe("Auto");
    expect(stampedDark()).toBe(true);
    expect(rowGlyph()).toBe("moon");
    await act(async () => main.flip(false));
    expect(stampedDark()).toBe(false);

    await press("Theme", "Dark");
    await act(async () => main.flip(false));
    expect(stampedDark()).toBe(true);
  });

  it("moves only when the owner answers — never an optimistic echo", async () => {
    const { main, door } = fakeMain("light");
    host(door);
    let open: () => void = () => undefined;
    main.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    await mountBoth();
    await press("Appearance", "Dark");
    expect(main.asked).toEqual(["dark"]);
    expect(pressed("Theme")).toBe("Light");
    expect(stampedDark()).toBe(false);
    await act(async () => {
      open();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(pressed("Theme")).toBe("Dark");
    expect(stampedDark()).toBe(true);
  });

  it("paints the first frame in the owner's projection, before any message", () => {
    // main sets nativeTheme.themeSource, so the page's prefers-color-scheme IS
    // the owner's theme from the document's first frame.
    stubOs(true);
    const { door } = fakeMain("dark", false);
    host({ set: door.set, onState: () => () => undefined });
    stampInitialTheme();
    expect(stampedDark()).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("hands the old renderer boolean to the owner once, then removes it", async () => {
    localStorage.setItem("vf-dark", "true");
    const { main, door } = fakeMain("auto", false);
    let open: () => void = () => undefined;
    main.gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    host(door);
    stampInitialTheme();
    // The first frame wears the choice it is about to hand over…
    expect(stampedDark()).toBe(true);
    expect(main.asked).toEqual(["dark"]);
    expect(localStorage.getItem("vf-dark")).toBeNull();
    // …and what the owner said before it answered is not drawn over it.
    await act(async () => main.tell({ preference: "auto", resolved: "light" }));
    expect(stampedDark()).toBe(true);
    await act(async () => {
      open();
      await Promise.resolve();
    });
    expect(main.state).toEqual({ preference: "dark", resolved: "dark" });
    expect(stampedDark()).toBe(true);
    // Once: a second page never finds it again.
    resetAppThemeForTest();
    stampInitialTheme();
    expect(main.asked).toEqual(["dark"]);
  });

  it("keeps a stand-in on a page with no host — Auto follows the OS's own query", async () => {
    const os = stubOs(false);
    host();
    function Probe(): ReactElement {
      const theme = useAppTheme();
      return createElement("output", null, `${theme.preference}:${theme.resolved}`);
    }
    await mount(createElement(Probe));
    expect(container?.textContent).toBe("auto:light");
    await act(async () => os.flip(true));
    expect(container?.textContent).toBe("auto:dark");
    await act(async () => setAppTheme("light"));
    expect(container?.textContent).toBe("light:light");
    await act(async () => os.flip(false));
    expect(container?.textContent).toBe("light:light");
  });
});

describe("Godview's light (FC-D7)", () => {
  it("reads the app's theme, unless Settings → Terminal's override is set — then the override wins", async () => {
    const { main, door } = fakeMain("light");
    host(door);
    function Godview(): ReactElement {
      return createElement("output", null, useGodviewTheme());
    }
    await mount(createElement(Godview));
    expect(container?.textContent).toBe("light");
    await act(async () => setAppTheme("dark"));
    expect(main.asked).toEqual(["dark"]);
    expect(container?.textContent).toBe("dark");

    await act(async () => setDeckAppearance({ ...DEFAULT_DECK_APPEARANCE, modeOverride: "light" }));
    expect(container?.textContent).toBe("light");
    await act(async () => main.flip(true));
    expect(container?.textContent).toBe("light");

    await act(async () => setDeckAppearance({ ...DEFAULT_DECK_APPEARANCE, modeOverride: null }));
    expect(container?.textContent).toBe("dark");
  });

  it("is one reading: the override, else the app", () => {
    expect(godviewThemeFor("dark", { modeOverride: null })).toBe("dark");
    expect(godviewThemeFor("light", { modeOverride: null })).toBe("light");
    expect(godviewThemeFor("light", { modeOverride: "dark" })).toBe("dark");
    expect(godviewThemeFor("dark", { modeOverride: "light" })).toBe("light");
  });
});
