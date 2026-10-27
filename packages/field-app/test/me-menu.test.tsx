// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveFaces } from "@vibefield/contracts/user-face";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeMenu, MeMenuView, type MeMenuViewProps } from "../src/account/MeMenu";
import type { AccountMe, AccountPerson } from "../src/account/use-account";
import { type FieldHost, setHost } from "../src/host";

// UA-D19 — the Me menu (DESIGN.md §8). What these pin is the part a user
// feels without reading: the face is the one door, the menu reads bottom-up
// with Settings… nearest, the keyboard reaches everything and Esc gives focus
// back to the face, a click outside folds it, and the corner never goes blank.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ME_CSS = readFileSync(join(process.cwd(), "src/account/MeMenu.css"), "utf8");
const CHROME = readFileSync(join(process.cwd(), "src/field/ChromeLayer.tsx"), "utf8");
const ruleOf = (css: string, selector: string): string => {
  const from = css.indexOf(`${selector} {`);
  return from < 0 ? "" : css.slice(from, css.indexOf("}", from));
};

const ME: AccountMe = {
  userId: "01J8Z3K6W9QX2M4N7P5R8T1V3B",
  name: "James",
  face: { emoji: "🦊" },
  waiting: 0,
  detail: "james@example.com",
  detailIsLogin: true,
  detailTone: "plain",
  canLink: false,
};

const OTHERS: AccountPerson[] = [
  { userId: "01J9B7Q2MXC5D8F3G6H9J2K4N7", name: "Work", face: { emoji: "🐙" }, waiting: 0 },
  { userId: "01JA4T8N5RS1V4W7X9Y2Z5A8B3", name: "Sandbox", face: { emoji: "🧪" }, waiting: 0 },
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

type Spies = {
  onOpenSettings: ReturnType<typeof vi.fn>;
  onOpenAccount: ReturnType<typeof vi.fn>;
  onLink: ReturnType<typeof vi.fn>;
  onSwitch: ReturnType<typeof vi.fn>;
  onNewUser: ReturnType<typeof vi.fn>;
  onOpenChange: ReturnType<typeof vi.fn>;
};

/** The view under a tiny controlled host, the way ChromeLayer holds it. */
async function mountView(
  overrides: Partial<Omit<MeMenuViewProps, "open" | "onOpenChange">> = {},
  initiallyOpen = false,
): Promise<Spies> {
  const spies: Spies = {
    onOpenSettings: vi.fn(),
    onOpenAccount: vi.fn(),
    onLink: vi.fn(),
    onSwitch: vi.fn(),
    onNewUser: vi.fn(),
    onOpenChange: vi.fn(),
  };
  function Harness(): ReactElement {
    const [open, setOpen] = useState(initiallyOpen);
    return createElement(MeMenuView, {
      me: ME,
      others: OTHERS,
      onOpenSettings: spies.onOpenSettings,
      onOpenAccount: spies.onOpenAccount,
      onLink: spies.onLink,
      onSwitch: spies.onSwitch,
      onNewUser: spies.onNewUser,
      ...overrides,
      open,
      onOpenChange: (next: boolean) => {
        spies.onOpenChange(next);
        setOpen(next);
      },
    });
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(createElement(Harness)));
  return spies;
}

const face = (): HTMLButtonElement =>
  container?.querySelector<HTMLButtonElement>(".vf-me-face") as HTMLButtonElement;
const items = (): HTMLElement[] =>
  Array.from(container?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
const item = (label: string): HTMLElement | undefined =>
  items().find((node) => node.textContent?.includes(label));
const menu = (): HTMLElement => container?.querySelector('[role="menu"]') as HTMLElement;
const key = async (target: Element, keyName: string): Promise<void> => {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: keyName, bubbles: true }));
  });
};

describe("MeMenuView", () => {
  it("is the owner's face at rest: named, closed, and nothing in it reachable", async () => {
    await mountView();
    expect(face().getAttribute("aria-haspopup")).toBe("menu");
    expect(face().getAttribute("aria-expanded")).toBe("false");
    expect(face().getAttribute("title")).toBe("James · Account");
    expect(face().getAttribute("aria-label")).toBe("James: account menu");
    // A person has no colour — the only colour in the corner is the emoji.
    expect(face().textContent).toBe("🦊");
    expect(menu().hasAttribute("inert")).toBe(true);
    expect(container?.querySelector(".vf-me-badge")).toBeNull();
  });

  it("opens on the face and reads bottom-up: people, New user…, Settings…, then you", async () => {
    const spies = await mountView();
    await act(async () => face().click());
    expect(spies.onOpenChange).toHaveBeenLastCalledWith(true);
    expect(face().getAttribute("aria-expanded")).toBe("true");
    expect(container?.querySelector(".vf-me")?.hasAttribute("data-open")).toBe(true);
    expect(menu().hasAttribute("inert")).toBe(false);
    const labels = items().map((node) => node.textContent ?? "");
    expect(labels).toHaveLength(5);
    expect(labels[0]).toContain("Work");
    expect(labels[1]).toContain("Sandbox");
    expect(labels[2]).toContain("New user…");
    expect(labels[3]).toContain("Settings…");
    // New user… wears a person, not a plus (One Frame FR-3: one plus on screen).
    expect(item("New user…")?.querySelector("[data-glyph]")?.getAttribute("data-glyph")).toBe(
      "person",
    );
    // You are the row nearest the face: the name, then the login.
    expect(labels[4]).toContain("James");
    expect(labels[4]).toContain("james@example.com");
    // The face never moves: a second click on it folds the menu.
    await act(async () => face().click());
    expect(spies.onOpenChange).toHaveBeenLastCalledWith(false);
    expect(face().getAttribute("aria-expanded")).toBe("false");
  });

  it("opened from the keyboard, lands on Settings…; arrows move; Esc folds and gives focus back", async () => {
    const spies = await mountView();
    // Enter/Space on a button is a click with no pointer detail.
    await act(async () => {
      face().dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    });
    expect(document.activeElement).toBe(item("Settings…"));
    await key(document.activeElement as Element, "ArrowUp");
    expect(document.activeElement).toBe(item("New user…"));
    await key(document.activeElement as Element, "ArrowDown");
    await key(document.activeElement as Element, "ArrowDown");
    expect(document.activeElement).toBe(item("James"));
    await key(document.activeElement as Element, "Escape");
    expect(spies.onOpenChange).toHaveBeenLastCalledWith(false);
    expect(document.activeElement).toBe(face());
  });

  it("folds on Esc even when the pointer opened it and focus never left the face", async () => {
    const spies = await mountView();
    face().focus();
    // A real pointer click carries detail >= 1. happy-dom's click() sends 0 —
    // the keyboard path, which moves focus into the menu — so dispatch the
    // pointer's own.
    await act(async () => {
      face().dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    });
    expect(face().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(face());
    await key(document.body, "Escape");
    expect(spies.onOpenChange).toHaveBeenLastCalledWith(false);
    expect(document.activeElement).toBe(face());
  });

  it("gives focus back to the face when something else folds it (⌘,, the tray)", async () => {
    const props = {
      me: ME,
      others: OTHERS,
      onOpenSettings: vi.fn(),
      onOpenAccount: vi.fn(),
      onLink: vi.fn(),
      onOpenChange: vi.fn(),
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(createElement(MeMenuView, { ...props, open: true })));
    item("Settings…")?.focus();
    expect(document.activeElement).toBe(item("Settings…"));
    // Folded from outside, the rows go inert; Settings will record the face.
    await act(async () => root?.render(createElement(MeMenuView, { ...props, open: false })));
    expect(document.activeElement).toBe(face());
  });

  it("leaves focus to Tab when Tab folds it", async () => {
    await mountView();
    face().focus();
    await key(face(), "ArrowUp");
    const settings = item("Settings…");
    expect(document.activeElement).toBe(settings);
    await key(settings as HTMLElement, "Tab");
    expect(face().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).not.toBe(face());
  });

  it("names your row without a stray comma while the link is still loading", async () => {
    await mountView({ me: { ...ME, detail: "" } }, true);
    expect(item("James")?.getAttribute("aria-label")).toBe("James — account settings");
  });

  it("goes into the menu on an arrow from the face, opening it first", async () => {
    await mountView();
    face().focus();
    await key(face(), "ArrowUp");
    expect(face().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(item("Settings…"));
  });

  it("gives focus back to the face before an act, so Settings can return it there", async () => {
    let focusedAtAct: Element | null = null;
    await mountView(
      {
        onOpenSettings: () => {
          focusedAtAct = document.activeElement;
        },
      },
      true,
    );
    await act(async () => item("Settings…")?.click());
    expect(focusedAtAct).toBe(face());
  });

  it("folds on a click anywhere else", async () => {
    const spies = await mountView({}, true);
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(spies.onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("runs each act and folds first", async () => {
    const spies = await mountView({}, true);
    await act(async () => item("Settings…")?.click());
    expect(spies.onOpenSettings).toHaveBeenCalledTimes(1);
    expect(spies.onOpenChange).toHaveBeenLastCalledWith(false);

    await act(async () => face().click());
    const work = item("Work");
    await act(async () => work?.click());
    // The pressed row rides along: the switch carries its face (DESIGN.md §8).
    expect(spies.onSwitch).toHaveBeenCalledWith("01J9B7Q2MXC5D8F3G6H9J2K4N7", work);

    await act(async () => face().click());
    await act(async () => item("James")?.click());
    expect(spies.onOpenAccount).toHaveBeenCalledTimes(1);

    await act(async () => face().click());
    await act(async () => item("New user…")?.click());
    expect(spies.onNewUser).toHaveBeenCalledTimes(1);
  });

  it("offers Connect your devices… only while unlinked, and says This Mac only in words", async () => {
    await mountView(
      { me: { ...ME, detail: "This Mac only", detailIsLogin: false, canLink: true } },
      true,
    );
    expect(item("Connect your devices…")).toBeDefined();
    expect(container?.querySelector(".vf-me-you-detail")?.textContent).toBe("This Mac only");
    // The ordinary first-run state, not a fault (TS-D2): nothing turns red or
    // orange, and "offline" (which reads as no internet) is gone.
    expect(container?.querySelector(".vf-me-you-detail")?.className).not.toMatch(/red|danger/);
    expect(container?.querySelector(".vf-me-you-detail")?.getAttribute("data-tone")).toBeNull();
  });

  it("says a link state that needs the person in the attention ink (TS-2)", async () => {
    await mountView(
      {
        me: {
          ...ME,
          detail: "Sign-in renews in 6 days",
          detailIsLogin: false,
          detailTone: "attention",
        },
      },
      true,
    );
    const line = container?.querySelector(".vf-me-you-detail");
    expect(line?.textContent).toBe("Sign-in renews in 6 days");
    expect(line?.getAttribute("data-tone")).toBe("attention");
    // and it is not a login, so it is not monospace
    expect(line?.className).not.toContain("vf-ui-mono");
  });

  it("on a one-user machine shows no switch list at all", async () => {
    await mountView({ others: [] }, true);
    expect(container?.textContent).not.toContain("Switch to");
    expect(items().map((node) => node.textContent?.trim())).toEqual([
      "New user…",
      "Settings…⌘,",
      expect.stringContaining("James"),
    ]);
  });

  it("puts another user's waiting count beside the face, never on it, and names it", async () => {
    await mountView({ others: [{ ...OTHERS[0]!, waiting: 2 }, OTHERS[1]!] });
    const badge = container?.querySelector(".vf-me-badge");
    expect(badge?.textContent).toBe("2");
    // Beside: the badge is the face button's sibling, not painted into it (I-5).
    expect(face().contains(badge ?? null)).toBe(false);
    expect(face().getAttribute("aria-label")).toBe(
      "James: account menu, 2 waiting in another user",
    );
    await act(async () => face().click());
    expect(item("Work")?.textContent).toContain("2 waiting");
  });

  it("disables switching while a switch is already reloading the window", async () => {
    await mountView({ busy: true }, true);
    expect((item("Work") as HTMLButtonElement).disabled).toBe(true);
    expect((item("New user…") as HTMLButtonElement).disabled).toBe(true);
    // Settings and your own row stay live — they do not race the reload.
    expect((item("Settings…") as HTMLButtonElement).disabled).toBe(false);
  });

  it("opens ABOVE the line, never around the face, the face staying put beneath it (FC-D14)", async () => {
    await mountView({}, true);
    // The face is the corner's; the menu is a panel of its own above it.
    const panel = container?.querySelector(".vf-me-panel");
    expect(panel?.contains(face())).toBe(false);
    // 8 from the window's left (the face stands at 16) and its foot 8 above the
    // line (the line's top is 80 from the window's foot, the face's 24): from
    // the face, −8 and 56.
    const rule = ruleOf(ME_CSS, ".vf-me-panel");
    expect(rule).toContain("bottom: 56px;");
    expect(rule).toContain("left: -8px;");
    // The rows stand on the panel's foot, so the nearest show first as it grows.
    expect(ruleOf(ME_CSS, ".vf-me-list")).toContain("bottom: 0;");
    // You are the nearest row, inside the menu — and the text › is gone (F9).
    const list = container?.querySelector(".vf-me-list");
    expect(list?.lastElementChild?.classList.contains("vf-me-you")).toBe(true);
    expect(item("James")?.textContent).not.toContain("›");
    // The 56 circle around the face is its hover now, not the menu.
    expect(ME_CSS).toContain(".vf-me:not([data-open]) .vf-me-face:hover::before {");
  });

  it("holds Theme — Light · Dark · Auto — and choosing one keeps the menu open (FC-D5)", async () => {
    const onThemeChange = vi.fn();
    const spies = await mountView(
      { theme: { preference: "auto", resolved: "light" }, onThemeChange },
      true,
    );
    const group = container?.querySelector<HTMLFieldSetElement>("[data-me-theme] fieldset");
    expect(group?.getAttribute("aria-label")).toBe("Theme");
    expect(group?.getAttribute("data-size")).toBe("small");
    const options = Array.from(group?.querySelectorAll("button") ?? []);
    expect(options.map((button) => button.textContent)).toEqual(["Light", "Dark", "Auto"]);
    expect(
      options.find((button) => button.getAttribute("aria-pressed") === "true")?.textContent,
    ).toBe("Auto");
    // Nearest first: Theme stands just above Settings…, the nearest act.
    const rows = Array.from(container?.querySelectorAll(".vf-me-list > *") ?? []);
    const at = (node: Element | null | undefined): number => rows.indexOf(node as Element);
    expect(at(container?.querySelector("[data-me-theme]"))).toBe(at(item("Settings…")) - 1);
    // The row's mark says what Auto resolves to.
    expect(
      container?.querySelector("[data-me-theme] [data-glyph]")?.getAttribute("data-glyph"),
    ).toBe("sun");
    await act(async () => options[1]?.click());
    expect(onThemeChange).toHaveBeenCalledWith("dark");
    expect(spies.onOpenChange).not.toHaveBeenCalledWith(false);
    expect(face().getAttribute("aria-expanded")).toBe("true");
  });

  it("walks Theme once with ↑ ↓, at the theme it holds, and chooses with ← →", async () => {
    const onThemeChange = vi.fn();
    await mountView({ theme: { preference: "dark", resolved: "dark" }, onThemeChange });
    face().focus();
    await key(face(), "ArrowUp");
    expect(document.activeElement).toBe(item("Settings…"));
    await key(document.activeElement as Element, "ArrowUp");
    const held = document.activeElement as HTMLElement;
    expect(held.closest("[data-me-theme]")).not.toBeNull();
    expect(held.textContent).toBe("Dark");
    await key(held, "ArrowRight");
    expect(onThemeChange).toHaveBeenLastCalledWith("auto");
    expect(document.activeElement?.textContent).toBe("Auto");
    await key(document.activeElement as Element, "ArrowLeft");
    expect(onThemeChange).toHaveBeenLastCalledWith("dark");
    await key(document.activeElement as Element, "ArrowUp");
    expect(document.activeElement).toBe(item("New user…"));
  });

  it("leaves Home and End on Theme to its control (R19): they choose its ends, the focus kept on Theme", async () => {
    const onThemeChange = vi.fn();
    await mountView({ theme: { preference: "dark", resolved: "dark" }, onThemeChange });
    face().focus();
    await key(face(), "ArrowUp");
    await key(document.activeElement as Element, "ArrowUp");
    expect((document.activeElement as HTMLElement).textContent).toBe("Dark");
    await key(document.activeElement as Element, "End");
    expect(onThemeChange).toHaveBeenLastCalledWith("auto");
    expect(document.activeElement?.closest("[data-me-theme]")).not.toBeNull();
    expect(document.activeElement?.textContent).toBe("Auto");
    await key(document.activeElement as Element, "Home");
    expect(onThemeChange).toHaveBeenLastCalledWith("light");
    expect(document.activeElement?.textContent).toBe("Light");
  });

  it("keeps the corner the face's alone: on the foot axis, above the cover, no devtools (FR-4)", () => {
    // The 44 button at 16 from the left and 24 from the foot — x 16–60, y
    // 712–756 at 1180 × 780, centred on the line's axis, 734 — in the frame's
    // z (62), above the cover (60) in every view.
    expect(CHROME).toContain('className="hud-flight no-drag absolute bottom-[24px] left-4 z-[62]"');
    // Devtools left the corner for Settings → Advanced (FC-D12).
    expect(CHROME).not.toContain("ICE Devtools");
    expect(CHROME).not.toContain('name="bug"');
  });

  it("is solid chrome, never glass: nothing shows through an open menu", () => {
    const from = ME_CSS.indexOf(".vf-me-panel::before {");
    const rule = ME_CSS.slice(from, ME_CSS.indexOf("}", from));
    expect(rule).toContain("background: var(--vf-chrome-solid);");
    expect(rule).not.toContain("backdrop-filter");
    expect(rule).not.toContain("transparent");
  });

  it("grows on the island curve and, under reduced motion, only fades (M1, M6)", () => {
    expect(ME_CSS).toContain("width 600ms var(--vf-ease-island)");
    expect(ME_CSS).toContain("height 600ms var(--vf-ease-island)");
    const reduced = ME_CSS.slice(ME_CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain("transition: opacity 120ms ease");
    expect(reduced).not.toContain("600ms");
  });
});

describe("MeMenu (controller)", () => {
  const baseHost = (extra: Partial<FieldHost>): void =>
    setHost({
      logger: {
        child: () => baseLogger,
        trace() {},
        debug() {},
        info() {},
        warn() {},
        error() {},
        fatal() {},
        isLevelEnabled: () => false,
      },
      getConnection: async () => ({ port: 1, token: "test" }),
      onPrepareClose: () => () => undefined,
      completeClose: () => undefined,
      ...extra,
    });
  const baseLogger = {
    child: () => baseLogger,
    trace() {},
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {},
    isLevelEnabled: () => false,
  } as unknown as FieldHost["logger"];

  const fieldd = (): FielddClient =>
    ({
      status: "ready",
      onStatusChange: () => () => undefined,
      subscribe: vi.fn(async (method: string) => {
        if (method === "user.link.subscribe") {
          return {
            subId: "user-link",
            snapshot: {
              link: null,
              meshEnabled: false,
              nodeState: null,
              authUrl: null,
              linkState: "offline",
              linkDetail: null,
            },
            unsubscribe: () => undefined,
          };
        }
        throw new Error(`unexpected subscribe: ${method}`);
      }),
      request: vi.fn(),
    }) as unknown as FielddClient;

  async function mountController(
    onOpenSettings = vi.fn(),
    {
      open = false,
      onOpenChange = () => undefined,
    }: {
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    } = {},
  ): Promise<typeof onOpenSettings> {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(
          FielddProvider,
          { client: fieldd() },
          createElement(MeMenu, { open, onOpenChange, onOpenSettings }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    return onOpenSettings;
  }

  /** The controller over a fieldd whose link is OFFLINE (so Link… is offered),
   * with the link act's answer and the subscription's later words in hand. */
  async function mountWith(
    link: {
      request: (...args: unknown[]) => Promise<unknown>;
      onLink?: (push: (s: unknown) => void) => void;
    },
    onOpenSettings: ReturnType<typeof vi.fn>,
    {
      open = false,
      onOpenChange = () => undefined,
    }: { open?: boolean; onOpenChange?: (open: boolean) => void } = {},
  ): Promise<void> {
    const client = {
      status: "ready",
      onStatusChange: () => () => undefined,
      subscribe: vi.fn(
        async (method: string, _params: unknown, onEvent?: (event: unknown) => void) => {
          if (method === "user.link.subscribe") {
            link.onLink?.((status) => onEvent?.(status));
            return {
              subId: `user-link-${Math.random()}`,
              snapshot: {
                link: null,
                meshEnabled: false,
                nodeState: null,
                authUrl: null,
                linkState: "offline",
                linkDetail: null,
              },
              unsubscribe: () => undefined,
            };
          }
          throw new Error(`unexpected subscribe: ${method}`);
        },
      ),
      request: vi.fn((method: string, params: unknown) => link.request(method, params)),
    } as unknown as FielddClient;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(
          FielddProvider,
          { client },
          createElement(MeMenu, { open, onOpenChange, onOpenSettings }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  const USERS = [
    { userId: "me", fuid: 1, name: "James", resident: true, onboarded: true },
    {
      userId: "work",
      fuid: 2,
      name: "Work",
      face: { emoji: "🐙" },
      resident: true,
      onboarded: true,
    },
  ];

  it("draws the attached user's face from the roster, dealt when none is written", async () => {
    baseHost({ usersList: vi.fn(async () => ({ attachedUserId: "me", users: USERS })) });
    await mountController();
    const button = container?.querySelector<HTMLButtonElement>(".vf-me-face");
    expect(button?.getAttribute("aria-label")).toBe("James: account menu");
    // The machine's own deal against everyone — the face main would write —
    // and so never the face another user already wears (I-2).
    const dealt = effectiveFaces(USERS).get("me")?.face.emoji;
    expect(dealt).not.toBe("🐙");
    expect(button?.textContent).toBe(dealt);
  });

  it("says a refused switch where the act was, and reopens to say it", async () => {
    const onOpenChange = vi.fn();
    baseHost({
      usersList: vi.fn(async () => ({ attachedUserId: "me", users: USERS })),
      usersSwitch: vi.fn(async () => {
        throw new Error("a user switch is already in flight");
      }),
    });
    await mountController(vi.fn(), { open: true, onOpenChange });
    await act(async () => {
      item("Work")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const words = "Couldn't switch to Work — a user switch is already in flight.";
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(container?.querySelector(".vf-me-notice")?.textContent).toBe(words);
    expect(container?.querySelector('[role="status"]')?.textContent).toBe(words);
  });

  it("starts from the last roster read on this host, so a new mount never blinks", async () => {
    let reads = 0;
    baseHost({
      usersList: vi.fn(() => {
        reads += 1;
        // The second mount's own read never lands: only the last read can
        // be what it draws.
        return reads === 1
          ? Promise.resolve({ attachedUserId: "me", users: USERS })
          : new Promise<never>(() => undefined);
      }),
    });
    await mountController();
    expect(container?.querySelector(".vf-me-face")).not.toBeNull();
    await act(async () => root?.unmount());
    container?.remove();
    await mountController();
    expect(reads).toBe(2);
    expect(container?.querySelector(".vf-me-face")?.getAttribute("aria-label")).toBe(
      "James: account menu",
    );
  });

  it("starts the link from Connect your devices… — never Account (F16) — and opens the sign-in", async () => {
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    const request = vi.fn(async () => ({
      link: null,
      meshEnabled: false,
      nodeState: "NeedsLogin",
      authUrl: "https://login.tailscale.com/a/abc123",
      linkState: "capturing",
      linkDetail: null,
    }));
    baseHost({ usersList: vi.fn(async () => ({ attachedUserId: "me", users: USERS })) });
    const onOpenSettings = vi.fn();
    const onOpenChange = vi.fn();
    await mountWith({ request }, onOpenSettings, { open: true, onOpenChange });
    await act(async () => {
      item("Connect your devices…")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalledWith("user.link.begin", {});
    expect(onOpenSettings).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(opened).toHaveBeenCalledWith(
      "https://login.tailscale.com/a/abc123",
      "_blank",
      "noopener,noreferrer",
    );
    opened.mockRestore();
  });

  it("opens the sign-in when the node offers it later, and says a refusal where the act was", async () => {
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    let push: ((status: unknown) => void) | null = null;
    const request = vi.fn(async () => ({
      link: null,
      meshEnabled: false,
      nodeState: "Starting",
      authUrl: null,
      linkState: "capturing",
      linkDetail: null,
    }));
    baseHost({ usersList: vi.fn(async () => ({ attachedUserId: "me", users: USERS })) });
    await mountWith(
      {
        request,
        onLink: (next) => {
          push = next;
        },
      },
      vi.fn(),
      { open: true },
    );
    await act(async () => {
      item("Connect your devices…")?.click();
      await Promise.resolve();
    });
    expect(opened).not.toHaveBeenCalled();
    await act(async () =>
      push?.({
        link: null,
        meshEnabled: false,
        nodeState: "NeedsLogin",
        authUrl: "https://login.tailscale.com/a/later",
        linkState: "capturing",
        linkDetail: null,
      }),
    );
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledWith(
      "https://login.tailscale.com/a/later",
      "_blank",
      "noopener,noreferrer",
    );
    opened.mockRestore();

    // A refusal: the daemon's words at the top of the reopened menu.
    root?.unmount();
    container?.remove();
    const onOpenChange = vi.fn();
    await mountWith(
      {
        request: vi.fn(async () => {
          throw new Error("this user is already linked to a tailscale account; unlink first");
        }),
      },
      vi.fn(),
      { open: true, onOpenChange },
    );
    await act(async () => {
      item("Connect your devices…")?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(container?.querySelector(".vf-me-notice")?.textContent).toBe(
      "Couldn't connect to Tailscale — this user is already linked to a tailscale account; unlink first.",
    );
  });

  it("keeps a way into Settings on a host with no account door at all", async () => {
    baseHost({});
    const onOpenSettings = await mountController();
    const gear = container?.querySelector<HTMLButtonElement>('button[title="Settings"]');
    expect(gear).not.toBeNull();
    await act(async () => gear?.click());
    expect(onOpenSettings).toHaveBeenCalledWith("general");
  });
});
