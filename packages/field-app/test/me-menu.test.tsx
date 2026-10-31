// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { UpdateCheckResult, UpdateConsentWords, UpdateView } from "@vibefield/contracts";
import { effectiveFaces } from "@vibefield/contracts/user-face";
import type { FielddClient } from "@vibefield/fieldd-client";
import { FielddProvider } from "@vibefield/fieldd-client/react";
import { act, createElement, type ReactElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeMenu, type MeMenuUpdate, MeMenuView, type MeMenuViewProps } from "../src/account/MeMenu";
import type { AccountMe, AccountPerson } from "../src/account/use-account";
import { type FieldHost, type FieldUpdatesHost, setHost } from "../src/host";
import { meUpdateRow } from "../src/panels/update-words";

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

// AU-2 — the corner's update (DESIGN.md §8 "The Me menu"; renderer.md §2.2): the row the menu always carries,
// nearest the face, acting in place; the dot beside the face; main's question grown into the panel.
const CURRENT = "0.1.0-nightly.20261027";
const NEXT = "0.1.0-nightly.20261028";
const IDLE: UpdateView = {
  phase: "idle",
  channel: "nightly",
  buildChannel: "nightly",
  enabled: true,
  lastCheckAt: null,
  applyWired: true,
  currentVersion: CURRENT,
};
const STAGED: UpdateView = { ...IDLE, phase: "staged", version: NEXT, sessions: 0 };
const CONSENT: UpdateConsentWords = {
  message: "Updating ends 7 terminal sessions",
  lead: "The Oct 28 nightly replaces the terminal service, which ends:",
  listed: [
    "claude — ~/Projects/vibe-field",
    "codex — ~/Projects/puppeteer",
    "pnpm dev — ~/Projects/vibe-field",
    "zsh — ~/Projects/rosetta",
    "untitled session",
  ],
  more: 2,
  confirm: "End 7 sessions and update",
};
const WAITING: AccountPerson[] = OTHERS.map((person, index) =>
  index === 0 ? { ...person, waiting: 2 } : person,
);
const updateRow = (): HTMLElement | null =>
  container?.querySelector<HTMLElement>("[data-me-update]") ?? null;
const mark = (): Element | null => container?.querySelector(".vf-me-mark") ?? null;
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 0));
/** AU-D6 (§6) — one swap beat (the view's 120ms) and a margin: the face going out is gone. */
const beat = async (): Promise<void> => {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 160));
  });
};

describe("MeMenuView — the update row, the dot and the question (AU-2)", () => {
  /** What the controller hands the view, built by the shipping words. */
  const updateOf = (view: UpdateView | null, extra: Partial<MeMenuUpdate> = {}): MeMenuUpdate => ({
    row: meUpdateRow({ view, local: { kind: "rest" }, now: Date.now() }),
    mark: view?.phase === "staged",
    ...extra,
  });

  type UpdateSpies = Spies & {
    onUpdate: ReturnType<typeof vi.fn>;
    onUpdateConfirm: ReturnType<typeof vi.fn>;
    onUpdateCancel: ReturnType<typeof vi.fn>;
  };
  type Props = { update?: MeMenuUpdate | undefined; others?: AccountPerson[] };
  const hold: { push?: (next: Props) => void } = {};
  /** The view as the controller re-renders it: its update and its people move from outside. */
  async function mountUpdating(
    update: MeMenuUpdate | undefined,
    { open = false, notice = null }: { open?: boolean; notice?: string | null } = {},
  ): Promise<UpdateSpies> {
    const spies: UpdateSpies = {
      onOpenSettings: vi.fn(),
      onOpenAccount: vi.fn(),
      onLink: vi.fn(),
      onSwitch: vi.fn(),
      onNewUser: vi.fn(),
      onOpenChange: vi.fn(),
      onUpdate: vi.fn(),
      onUpdateConfirm: vi.fn(),
      onUpdateCancel: vi.fn(),
    };
    function Harness(): ReactElement {
      const [props, setProps] = useState<Props>({ update, others: OTHERS });
      const [isOpen, setOpen] = useState(open);
      hold.push = (next) => setProps((current) => ({ ...current, ...next }));
      return createElement(MeMenuView, {
        me: ME,
        others: props.others ?? OTHERS,
        open: isOpen,
        onOpenChange: (next: boolean) => {
          spies.onOpenChange(next);
          setOpen(next);
        },
        onOpenSettings: spies.onOpenSettings,
        onOpenAccount: spies.onOpenAccount,
        onLink: spies.onLink,
        onSwitch: spies.onSwitch,
        onNewUser: spies.onNewUser,
        notice,
        update: props.update,
        onUpdate: spies.onUpdate,
        onUpdateConfirm: spies.onUpdateConfirm,
        onUpdateCancel: spies.onUpdateCancel,
      });
    }
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(createElement(Harness)));
    return spies;
  }
  const rerender = async (next: Props): Promise<void> => {
    await act(async () => hold.push?.(next));
  };

  it("carries the row nearest the face, under Settings…, and Return still lands on Settings… (AU-D5)", async () => {
    const spies = await mountUpdating(updateOf(IDLE));
    await act(async () => {
      face().dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    });
    const labels = items().map((node) => node.textContent ?? "");
    expect(labels).toHaveLength(6);
    expect(labels[3]).toContain("Settings…");
    expect(labels[4]).toBe("Check for updatesYou're on the Oct 27 nightly");
    expect(labels[5]).toContain("James");
    const list = container?.querySelector(".vf-me-list");
    expect(list?.lastElementChild?.classList.contains("vf-me-you")).toBe(true);
    // the keyboard lands on Settings… — never the row nearer it, so a double Return never restarts
    expect(document.activeElement).toBe(item("Settings…"));
    await key(document.activeElement as Element, "ArrowDown");
    expect(document.activeElement).toBe(updateRow());
    await key(document.activeElement as Element, "ArrowDown");
    expect(document.activeElement).toBe(item("James"));
    expect(spies.onUpdate).not.toHaveBeenCalled();
    // the act's glyph in the 44px column: reset at rest
    expect(updateRow()?.querySelector("[data-glyph]")?.getAttribute("data-glyph")).toBe("reset");
  });

  it("checks in place: the click asks, and the menu stays open", async () => {
    const spies = await mountUpdating(updateOf(IDLE), { open: true });
    await act(async () => updateRow()?.click());
    expect(spies.onUpdate).toHaveBeenCalledWith("check");
    expect(spies.onOpenChange).not.toHaveBeenCalled();
  });

  it("dims a row that can't act now: aria-disabled, never disabled, and a click does nothing", async () => {
    const spies = await mountUpdating(updateOf(null), { open: true });
    const row = updateRow() as HTMLElement;
    expect(row.textContent).toBe("Check for updatesThis build doesn't update itself");
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(row.hasAttribute("disabled")).toBe(false);
    row.focus();
    await act(async () => row.click());
    expect(spies.onUpdate).not.toHaveBeenCalled();
    expect(spies.onOpenChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(row);
  });

  it("opens Settings → Updates folded first, focus back on the face", async () => {
    const downloading: UpdateView = { ...IDLE, phase: "downloading", version: NEXT, percent: 42 };
    const spies = await mountUpdating(updateOf(downloading), { open: true });
    const bar = updateRow()?.querySelector<HTMLElement>(".vf-me-update-bar > span");
    expect(bar?.style.width).toBe("42%");
    await act(async () => updateRow()?.click());
    expect(spies.onOpenChange).toHaveBeenLastCalledWith(false);
    expect(spies.onUpdate).toHaveBeenCalledWith("open");
    expect(spies.onOpenChange.mock.invocationCallOrder[0]).toBeLessThan(
      spies.onUpdate.mock.invocationCallOrder[0] ?? 0,
    );
    expect(document.activeElement).toBe(face());
  });

  it("opens Settings → Updates at the notes from What's new, folded first (AU-6, LC-7)", async () => {
    const installed: UpdateView = {
      ...IDLE,
      currentVersion: NEXT,
      lastApply: {
        version: NEXT,
        from: CURRENT,
        outcome: "installed",
        at: Date.now() - 60_000,
        notes: {
          version: NEXT,
          body: { kind: "written", since: null, lines: ["Updates wait for you."] },
        },
      },
    };
    const spies = await mountUpdating(updateOf(installed), { open: true });
    expect(updateRow()?.textContent).toMatch(/^What's newUpdated (today|yesterday)$/u);
    await act(async () => updateRow()?.click());
    expect(spies.onOpenChange).toHaveBeenLastCalledWith(false);
    expect(spies.onUpdate).toHaveBeenCalledWith("notes");
    expect(spies.onOpenChange.mock.invocationCallOrder[0]).toBeLessThan(
      spies.onUpdate.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("wears the dot beside the face while an install waits, and a waiting count outranks it (I-5)", async () => {
    await mountUpdating(updateOf(STAGED, { markTitle: "the Oct 28 nightly is ready" }));
    expect(mark()).not.toBeNull();
    expect(face().contains(mark())).toBe(false);
    expect(mark()?.getAttribute("aria-hidden")).toBe("true");
    expect(face().getAttribute("title")).toBe("James · Account · the Oct 28 nightly is ready");
    expect(face().getAttribute("aria-label")).toBe(
      "James: account menu, an update is ready to install",
    );
    await rerender({ others: WAITING });
    expect(container?.querySelector(".vf-me-badge")?.textContent).toBe("2");
    expect(mark()).toBeNull();
    expect(face().getAttribute("aria-label")).toBe(
      "James: account menu, 2 waiting in another user, an update is ready to install",
    );
    // no update waiting: no dot, no clause
    await rerender({ update: updateOf(IDLE), others: OTHERS });
    expect(mark()).toBeNull();
    expect(face().getAttribute("title")).toBe("James · Account");
  });

  it("pops the dot in once — never on the first render, never back from a count — and never pulses", async () => {
    await mountUpdating(updateOf(STAGED));
    expect(mark()?.hasAttribute("data-pop")).toBe(false);
    await rerender({ update: updateOf(IDLE) });
    expect(mark()).toBeNull();
    await rerender({ update: updateOf(STAGED) });
    expect(mark()?.hasAttribute("data-pop")).toBe(true);
    await rerender({ others: WAITING });
    expect(mark()).toBeNull();
    await rerender({ others: OTHERS });
    expect(mark()).not.toBeNull();
    expect(mark()?.hasAttribute("data-pop")).toBe(false);
  });

  it("never pops a dot already waiting when the desktop's state lands after the account (renderer.md §2.2)", async () => {
    // the corner knows the account first: no update yet, so no row and no dot
    await mountUpdating(undefined);
    expect(mark()).toBeNull();
    await rerender({ update: updateOf(STAGED) });
    expect(mark()).not.toBeNull();
    expect(mark()?.hasAttribute("data-pop")).toBe(false);
    // an install that comes to wait later still pops
    await rerender({ update: updateOf(IDLE) });
    await rerender({ update: updateOf(STAGED) });
    expect(mark()?.hasAttribute("data-pop")).toBe(true);
  });

  it("grows into main's question at 320: Cancel first and focused, Esc and Tab keep the menu (AU-D6, LC-9)", async () => {
    const ends = updateOf({ ...STAGED, sessions: 7 });
    const spies = await mountUpdating(ends, { open: true });
    await rerender({ update: { ...ends, ask: { words: CONSENT, busy: false } } });
    // §6 — the panel grows at once, and the rows fade for one beat before the question is drawn
    const list = container?.querySelector<HTMLElement>(".vf-me-list");
    const panel = container?.querySelector<HTMLElement>(".vf-me-panel");
    expect(panel?.style.getPropertyValue("--vf-me-width")).toBe("320px");
    expect(list?.hasAttribute("data-leaving")).toBe(true);
    expect(updateRow()).not.toBeNull();
    expect(container?.querySelector('[role="alertdialog"]')).toBeNull();
    await beat();
    expect(list?.hasAttribute("data-leaving")).toBe(false);
    const dialog = container?.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(dialog?.querySelector(".vf-me-ask-question")?.textContent).toBe(CONSENT.message);
    expect(dialog?.querySelector(".vf-me-ask-lead")?.textContent).toBe(CONSENT.lead);
    expect(Array.from(dialog?.querySelectorAll("li") ?? []).map((li) => li.textContent)).toEqual([
      ...CONSENT.listed,
      "and 2 more",
    ]);
    const acts = Array.from(dialog?.querySelectorAll("button") ?? []);
    expect(acts.map((button) => button.textContent)).toEqual([
      "Cancel",
      "End 7 sessions and update",
    ]);
    expect(acts[1]?.getAttribute("data-variant")).toBe("danger");
    expect(document.activeElement).toBe(acts[0]);
    // a menu holding an alertdialog is no menu
    expect(container?.querySelector('[role="menu"]')).toBeNull();
    expect(panel?.style.getPropertyValue("--vf-me-width")).toBe("320px");
    // Tab walks Cancel ↔ the act and never folds
    acts[1]?.focus();
    await key(acts[1] as HTMLElement, "Tab");
    expect(document.activeElement).toBe(acts[0]);
    expect(spies.onOpenChange).not.toHaveBeenCalled();
    // the act confirms the snapshot it shows
    await act(async () => acts[1]?.click());
    expect(spies.onUpdateConfirm).toHaveBeenCalledTimes(1);
    // Esc goes back to the rows, never folds; focus on the row when they return
    await key(document.activeElement as Element, "Escape");
    expect(spies.onUpdateCancel).toHaveBeenCalledTimes(1);
    expect(spies.onOpenChange).not.toHaveBeenCalled();
    await rerender({ update: ends });
    // Esc reverses it: the question fades for its beat, then the rows rise back
    expect(panel?.style.getPropertyValue("--vf-me-width")).toBe("256px");
    expect(container?.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(list?.hasAttribute("data-leaving")).toBe(true);
    await beat();
    expect(container?.querySelector('[role="alertdialog"]')).toBeNull();
    expect(list?.hasAttribute("data-returning")).toBe(true);
    expect(document.activeElement).toBe(updateRow());
    // a second Esc folds the menu
    await key(document.activeElement as Element, "Escape");
    expect(spies.onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("holds the question while its confirm is in flight: nothing to press, Esc does nothing", async () => {
    const ends = updateOf({ ...STAGED, sessions: 7 });
    const spies = await mountUpdating(ends, { open: true });
    await rerender({ update: { ...ends, ask: { words: CONSENT, busy: true } } });
    await beat();
    const acts = Array.from(
      container?.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button') ?? [],
    );
    expect(acts).toHaveLength(2);
    expect(acts.every((button) => button.disabled)).toBe(true);
    await key(document.body, "Escape");
    expect(spies.onUpdateCancel).not.toHaveBeenCalled();
    expect(spies.onOpenChange).not.toHaveBeenCalled();
  });

  it("says the install that didn't take in the notice row — and a refusal outranks it (AU-D11)", async () => {
    const said =
      "The Oct 28 nightly didn't install when VibeField restarted. It's ready to try again.";
    await mountUpdating(updateOf(STAGED, { notice: said }), { open: true });
    expect(container?.querySelector(".vf-me-notice")?.textContent).toBe(said);
    expect(container?.querySelector('[role="status"]')?.textContent).toBe(said);
    await act(async () => root?.unmount());
    container?.remove();
    const refusal = "VibeField didn't download the update. That version is no longer available.";
    await mountUpdating(updateOf(STAGED, { notice: said }), { open: true, notice: refusal });
    const notices = container?.querySelectorAll(".vf-me-notice");
    expect(notices?.length).toBe(1);
    expect(notices?.[0]?.textContent).toBe(refusal);
  });

  it("draws the dot 10px beside the face, ringed in the ground, popping once and never pulsing", () => {
    const dot = ruleOf(ME_CSS, ".vf-me-mark");
    expect(dot).toContain("top: 1px;");
    expect(dot).toContain("right: -3px;");
    expect(dot).toContain("width: 10px;");
    expect(dot).toContain("background: var(--vf-cyan);");
    expect(dot).toContain("box-shadow: 0 0 0 2px var(--vf-canvas-bg);");
    expect(ME_CSS).not.toMatch(/vf-me-mark[^}]*infinite/u);
    expect(ME_CSS).not.toContain("infinite");
    expect(ruleOf(ME_CSS, ".vf-me[data-open] .vf-me-mark")).toContain("opacity: 0;");
    expect(ruleOf(ME_CSS, ".vf-me-mark[data-pop]")).toContain("280ms var(--vf-ease-pop)");
    const reduced = ME_CSS.slice(ME_CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(ruleOf(reduced, ".vf-me-mark[data-pop]")).toContain("vf-me-fade-in 120ms");
    expect(ruleOf(reduced, ".vf-me-ask > *")).toContain("vf-me-fade-in 120ms");
    // §6 — the face going out fades over 120ms plain `ease` before the other is drawn
    expect(ruleOf(ME_CSS, ".vf-me[data-open] .vf-me-list[data-leaving] > *")).toContain(
      "transition: opacity 120ms ease;",
    );
    // the notice row reads in the attention ink (§2.5; the orange fill until AU-2)
    expect(ruleOf(ME_CSS, ".vf-me-notice")).toContain("color: var(--vf-ink-attention);");
    // the row's end dot ties it to the face's
    expect(ruleOf(ME_CSS, ".vf-me-update-dot")).toContain("background: var(--vf-cyan);");
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

  // AU-2 — the row's acts, run by the controller over the host's update doors (the same prepare and
  // confirm Settings → Updates runs, AU-L4), its flow inside one open, and the dot.
  describe("the update row", () => {
    const TOKEN = "token-0123456789abcdef";
    const ROSTER = (): Promise<{ attachedUserId: string; users: typeof USERS }> =>
      Promise.resolve({ attachedUserId: "me", users: USERS });
    const ENDS: UpdateConsentWords = {
      message: "Updating ends 2 terminal sessions",
      lead: "The Oct 28 nightly replaces the terminal service, which ends:",
      listed: ["claude — ~/Projects/vibe-field", "zsh — ~/Projects/rosetta"],
      more: 0,
      confirm: "End 2 sessions and update",
    };

    type FakeUpdates = FieldUpdatesHost & Record<keyof FieldUpdatesHost, ReturnType<typeof vi.fn>>;
    /** The host's update doors; a test hands its own answers (untyped: what main would answer). */
    function fakeUpdates(over: Partial<Record<keyof FieldUpdatesHost, unknown>> = {}): FakeUpdates {
      return {
        check: vi.fn(async () => ({ outcome: "up-to-date" })),
        setEnabled: vi.fn(async () => undefined),
        setChannel: vi.fn(async () => undefined),
        decline: vi.fn(async () => undefined),
        download: vi.fn(async () => ({ ok: true })),
        prepareRestart: vi.fn(async () => ({
          ok: true,
          token: TOKEN,
          version: NEXT,
          keepsSessions: false,
          sessions: [
            { sessionId: "s1", title: "claude", cwd: "~/Projects/vibe-field" },
            { sessionId: "s2", title: "zsh", cwd: "~/Projects/rosetta" },
          ],
          expiresAt: 1,
          consent: ENDS,
        })),
        confirmRestart: vi.fn(async () => ({ ok: true })),
        doctor: vi.fn(async () => ({ lines: [] })),
        moveToApplications: vi.fn(async () => ({ ok: true, outcome: "proceed" })),
        ...over,
      } as never;
    }

    function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
      let resolve: (value: T) => void = () => undefined;
      const promise = new Promise<T>((done) => {
        resolve = done;
      });
      return { promise, resolve };
    }

    type State = { update?: UpdateView | null | undefined; open?: boolean };
    type Mounted = {
      onOpenSettings: ReturnType<typeof vi.fn>;
      onOpenChange: ReturnType<typeof vi.fn>;
    };
    const hold: { push?: (next: State) => void } = {};
    /** The controller as ChromeLayer holds it: the open state and the desktop's update move from outside. */
    async function mountUpdate(
      update: UpdateView | null | undefined,
      open = true,
    ): Promise<Mounted> {
      const onOpenSettings = vi.fn();
      const onOpenChange = vi.fn();
      const client = fieldd();
      function Harness(): ReactElement {
        const [state, setState] = useState<State>({ update, open });
        hold.push = (next) => setState((current) => ({ ...current, ...next }));
        return createElement(
          FielddProvider,
          { client },
          createElement(MeMenu, {
            open: state.open === true,
            onOpenChange: (next: boolean) => {
              onOpenChange(next);
              setState((current) => ({ ...current, open: next }));
            },
            onOpenSettings,
            update: state.update,
          }),
        );
      }
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      await act(async () => {
        root?.render(createElement(Harness));
        await settle();
      });
      return { onOpenSettings, onOpenChange };
    }
    const set = async (next: State): Promise<void> => {
      await act(async () => {
        hold.push?.(next);
        await settle();
      });
    };
    const click = async (target: HTMLElement | null | undefined): Promise<void> => {
      await act(async () => {
        target?.click();
        await settle();
      });
    };
    const rowText = (): string => updateRow()?.textContent ?? "";

    it("carries no row until the desktop's state is known, and the dimmed row where no updater runs", async () => {
      baseHost({ usersList: vi.fn(ROSTER), updates: fakeUpdates() });
      await mountUpdate(undefined);
      expect(updateRow()).toBeNull();
      await set({ update: null });
      expect(updateRow()?.getAttribute("aria-disabled")).toBe("true");
      expect(rowText()).toBe("Check for updatesThis build doesn't update itself");
    });

    it("reads a host with no updater doors as a build that doesn't update itself", async () => {
      baseHost({ usersList: vi.fn(ROSTER) });
      await mountUpdate(IDLE);
      expect(rowText()).toBe("Check for updatesThis build doesn't update itself");
      expect(updateRow()?.getAttribute("aria-disabled")).toBe("true");
    });

    it("checks in place, answers in place, and the next open reads the resting row (LC-5)", async () => {
      const answer = deferred<UpdateCheckResult>();
      const updates = fakeUpdates({ check: vi.fn(() => answer.promise) });
      baseHost({ usersList: vi.fn(ROSTER), updates });
      const { onOpenChange } = await mountUpdate(IDLE);
      await click(updateRow());
      expect(updates.check).toHaveBeenCalledTimes(1);
      expect(rowText()).toBe("Checking for updates…You're on the Oct 27 nightly");
      expect(updateRow()?.getAttribute("aria-disabled")).toBe("true");
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      await act(async () => {
        answer.resolve({ outcome: "up-to-date" });
        await settle();
      });
      expect(rowText()).toBe("VibeField is up to dateYou're on the Oct 27 nightly");
      expect(container?.querySelector('[role="status"]')?.textContent).toBe(
        "VibeField is up to date",
      );
      await set({ open: false });
      await set({ open: true });
      expect(rowText()).toBe("Check for updatesYou're on the Oct 27 nightly");
    });

    it("never says up to date for a held answer", async () => {
      const updates = fakeUpdates({ check: vi.fn(async () => ({ outcome: "held" })) });
      baseHost({ usersList: vi.fn(ROSTER), updates });
      await mountUpdate(IDLE);
      await click(updateRow());
      expect(rowText()).toBe("Check for updatesYou're on the Oct 27 nightly");
    });

    it("drops an answer that comes after the menu folds (the generation guard)", async () => {
      const answer = deferred<UpdateCheckResult>();
      const updates = fakeUpdates({ check: vi.fn(() => answer.promise) });
      baseHost({ usersList: vi.fn(ROSTER), updates });
      await mountUpdate(IDLE);
      await click(updateRow());
      await set({ open: false });
      await act(async () => {
        answer.resolve({ outcome: "up-to-date" });
        await settle();
      });
      await set({ open: true });
      expect(rowText()).toBe("Check for updatesYou're on the Oct 27 nightly");
    });

    it("shows the download in place when the check finds one", async () => {
      const answer = deferred<UpdateCheckResult>();
      const updates = fakeUpdates({ check: vi.fn(() => answer.promise) });
      baseHost({ usersList: vi.fn(ROSTER), updates });
      await mountUpdate(IDLE);
      await click(updateRow());
      await set({ update: { ...IDLE, phase: "downloading", version: NEXT, percent: 5 } });
      expect(rowText()).toBe("Downloading update5% downloaded");
      await act(async () => {
        answer.resolve({ outcome: "found", version: NEXT });
        await settle();
      });
      expect(rowText()).toBe("Downloading update5% downloaded");
    });

    it("restarts on the one click when nothing ends, and the dot goes with it", async () => {
      const updates = fakeUpdates({
        prepareRestart: vi.fn(async () => ({
          ok: true,
          token: TOKEN,
          version: NEXT,
          keepsSessions: true,
          sessions: [],
          expiresAt: 1,
        })),
      });
      baseHost({ usersList: vi.fn(ROSTER), updates });
      await mountUpdate(STAGED);
      const face = container?.querySelector(".vf-me-face");
      expect(face?.getAttribute("title")).toBe("James · Account · the Oct 28 nightly is ready");
      expect(mark()).not.toBeNull();
      expect(rowText()).toBe("Restart to updateYour sessions keep running");
      await click(updateRow());
      expect(updates.prepareRestart).toHaveBeenCalledTimes(1);
      expect(updates.confirmRestart).toHaveBeenCalledWith(TOKEN);
      expect(rowText()).toBe("Restarting…VibeField opens again");
      expect(mark()).toBeNull();
    });

    it("asks in main's words when the restart ends sessions: Cancel confirms nothing, the act confirms it", async () => {
      const updates = fakeUpdates();
      baseHost({ usersList: vi.fn(ROSTER), updates });
      const { onOpenChange } = await mountUpdate({ ...STAGED, sessions: 2 });
      expect(rowText()).toBe("Restart to update…Ends 2 terminal sessions");
      await click(updateRow());
      // the rows fade for one beat, then the question is drawn (§6)
      await beat();
      const question = (): HTMLElement | null =>
        container?.querySelector<HTMLElement>('[role="alertdialog"]') ?? null;
      const acts = (): HTMLButtonElement[] =>
        Array.from(question()?.querySelectorAll("button") ?? []);
      expect(question()?.textContent).toContain("Updating ends 2 terminal sessions");
      expect(acts().map((button) => button.textContent)).toEqual([
        "Cancel",
        "End 2 sessions and update",
      ]);
      expect(document.activeElement).toBe(acts()[0]);
      await click(acts()[0]);
      await beat();
      expect(question()).toBeNull();
      expect(updates.confirmRestart).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(updateRow());
      await click(updateRow());
      await beat();
      await click(acts()[1]);
      expect(updates.confirmRestart).toHaveBeenCalledWith(TOKEN);
      await beat();
      expect(rowText()).toBe("Restarting…VibeField opens again");
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });

    it("reopened inside the fold, draws its rows and lands on Settings… — never the last open's question (AU-D5)", async () => {
      const updates = fakeUpdates();
      baseHost({ usersList: vi.fn(ROSTER), updates });
      await mountUpdate({ ...STAGED, sessions: 2 });
      await click(updateRow());
      await beat();
      expect(container?.querySelector('[role="alertdialog"]')).not.toBeNull();
      // the face folds the menu on the question, and Return on it reopens it inside the 700ms fold
      const face = container?.querySelector<HTMLButtonElement>(".vf-me-face");
      await act(async () => {
        face?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
        await settle();
      });
      await act(async () => {
        face?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
        await settle();
      });
      expect(container?.querySelector('[role="alertdialog"]')).toBeNull();
      expect(updateRow()).not.toBeNull();
      expect(document.activeElement).toBe(item("Settings…"));
      // nothing moves focus late: a second Return opens Settings, never the restart
      await beat();
      expect(document.activeElement).toBe(item("Settings…"));
      expect(updates.prepareRestart).toHaveBeenCalledTimes(1);
      expect(updates.confirmRestart).not.toHaveBeenCalled();
    });

    it("says a refused prepare at the menu's top in main's words, and stays open (P15)", async () => {
      const words = {
        message: "VibeField didn't install the update",
        detail: "VibeField couldn't reach the update policy. Try again when online.",
      };
      const updates = fakeUpdates({
        prepareRestart: vi.fn(async () => ({ ok: false, reason: "policy-unreachable", words })),
      });
      baseHost({ usersList: vi.fn(ROSTER), updates });
      const { onOpenChange } = await mountUpdate({ ...STAGED, sessions: 2 });
      await click(updateRow());
      expect(container?.querySelector(".vf-me-notice")?.textContent).toBe(
        "VibeField didn't install the update. VibeField couldn't reach the update policy. Try again when online.",
      );
      expect(container?.querySelector('[role="alertdialog"]')).toBeNull();
      expect(rowText()).toBe("Restart to update…Ends 2 terminal sessions");
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });

    it("downloads in place with automatic updates off, and the menu stays open (LC-6)", async () => {
      const updates = fakeUpdates();
      baseHost({ usersList: vi.fn(ROSTER), updates });
      const off: UpdateView = { ...IDLE, enabled: false, phase: "available", version: NEXT };
      const { onOpenChange } = await mountUpdate(off);
      expect(rowText()).toBe("Download updateAutomatic updates are off");
      await click(updateRow());
      expect(updates.download).toHaveBeenCalledWith(NEXT);
      expect(rowText()).toBe("Download updateStarting the download…");
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
      await set({ update: { ...off, phase: "downloading", percent: 1 } });
      expect(rowText()).toBe("Downloading update1% downloaded");
    });

    it("says a Download main refused without words, and the row is the Download row again", async () => {
      const updates = fakeUpdates({
        download: vi.fn(async () => ({ ok: false, reason: "not-available" })),
      });
      baseHost({ usersList: vi.fn(ROSTER), updates });
      await mountUpdate({ ...IDLE, enabled: false, phase: "available", version: NEXT });
      await click(updateRow());
      expect(container?.querySelector(".vf-me-notice")?.textContent).toBe(
        "VibeField didn't download the update. That version is no longer available.",
      );
      expect(rowText()).toBe("Download updateAutomatic updates are off");
    });

    it("opens Settings → Updates at the notes from What's new, folding the menu (AU-6, LC-7)", async () => {
      baseHost({ usersList: vi.fn(ROSTER), updates: fakeUpdates() });
      const { onOpenSettings, onOpenChange } = await mountUpdate({
        ...IDLE,
        currentVersion: NEXT,
        lastApply: {
          version: NEXT,
          from: CURRENT,
          outcome: "installed",
          at: Date.now() - 60_000,
          trigger: "restart",
          notes: {
            version: NEXT,
            body: { kind: "written", since: null, lines: ["Updates wait for you."] },
          },
        },
      });
      expect(rowText()).toMatch(/^What's newUpdated (today|yesterday)$/u);
      await click(updateRow());
      expect(onOpenSettings).toHaveBeenCalledWith("whats-new");
      expect(onOpenSettings).not.toHaveBeenCalledWith("updates");
      expect(onOpenChange).toHaveBeenLastCalledWith(false);
    });

    it("opens Settings → Updates from a download, folding the menu", async () => {
      baseHost({ usersList: vi.fn(ROSTER), updates: fakeUpdates() });
      const { onOpenSettings, onOpenChange } = await mountUpdate({
        ...IDLE,
        phase: "downloading",
        version: NEXT,
        percent: 42,
      });
      await click(updateRow());
      expect(onOpenSettings).toHaveBeenCalledWith("updates");
      expect(onOpenChange).toHaveBeenLastCalledWith(false);
    });

    it("says an install that didn't take once per window, then the ready row stands (AU-G7, LC-8)", async () => {
      baseHost({ usersList: vi.fn(ROSTER), updates: fakeUpdates() });
      await mountUpdate({
        ...STAGED,
        lastApply: {
          version: NEXT,
          from: CURRENT,
          outcome: "not-applied",
          at: Date.now() - 60_000,
          trigger: "restart",
          thisLaunch: true,
        },
      });
      expect(container?.querySelector(".vf-me-notice")?.textContent).toBe(
        "The Oct 28 nightly didn't install when VibeField restarted. It's ready to try again.",
      );
      expect(rowText()).toBe("Restart to updateYour sessions keep running");
      await set({ open: false });
      await set({ open: true });
      expect(container?.querySelector(".vf-me-notice")).toBeNull();
    });
  });
});
