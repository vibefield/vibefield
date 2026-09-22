// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { join } from "node:path";
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

const ME: AccountMe = {
  userId: "01J8Z3K6W9QX2M4N7P5R8T1V3B",
  name: "James",
  face: { emoji: "🦊" },
  waiting: 0,
  detail: "james@example.com",
  detailIsLogin: true,
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
    await act(async () => face().click()); // a pointer click: detail 1 in a real browser
    face().focus();
    await key(document.body, "Escape");
    expect(spies.onOpenChange).toHaveBeenLastCalledWith(false);
    expect(document.activeElement).toBe(face());
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
    await act(async () => item("Work")?.click());
    expect(spies.onSwitch).toHaveBeenCalledWith("01J9B7Q2MXC5D8F3G6H9J2K4N7");

    await act(async () => face().click());
    await act(async () => item("James")?.click());
    expect(spies.onOpenAccount).toHaveBeenCalledTimes(1);

    await act(async () => face().click());
    await act(async () => item("New user…")?.click());
    expect(spies.onNewUser).toHaveBeenCalledTimes(1);
  });

  it("offers Link… only while unlinked, and says offline in words", async () => {
    await mountView(
      { me: { ...ME, detail: "offline · not linked", detailIsLogin: false, canLink: true } },
      true,
    );
    expect(item("Link Tailscale account…")).toBeDefined();
    expect(container?.querySelector(".vf-me-you-detail")?.textContent).toBe("offline · not linked");
    // Offline is the ordinary first-run state, not a fault: nothing turns red.
    expect(container?.querySelector(".vf-me-you-detail")?.className).not.toMatch(/red|danger/);
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

  async function mountController(onOpenSettings = vi.fn()): Promise<typeof onOpenSettings> {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        createElement(
          FielddProvider,
          { client: fieldd() },
          createElement(MeMenu, { open: false, onOpenChange: () => undefined, onOpenSettings }),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    return onOpenSettings;
  }

  it("draws the attached user's face from the roster, dealt when none is written", async () => {
    baseHost({
      usersList: vi.fn(async () => ({
        attachedUserId: "me",
        users: [
          { userId: "me", fuid: 1, name: "James", resident: true, onboarded: true },
          {
            userId: "work",
            fuid: 2,
            name: "Work",
            face: { emoji: "🐙" },
            resident: true,
            onboarded: true,
          },
        ],
      })),
    });
    await mountController();
    const button = container?.querySelector<HTMLButtonElement>(".vf-me-face");
    expect(button?.getAttribute("aria-label")).toBe("James: account menu");
    // Dealt, and never the face another user already wears (I-2).
    expect(button?.textContent?.length).toBeGreaterThan(0);
    expect(button?.textContent).not.toBe("🐙");
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
