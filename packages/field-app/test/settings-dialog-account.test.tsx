// @vitest-environment happy-dom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type SettingsAccountHead,
  SettingsDialog,
  type SettingsFinishSetup,
  type SettingsPage,
} from "../src/panels/SettingsDialog";
import { finishSetupRows } from "../src/setup/ledger";

// UA-D19 — Settings, headed by you. The account card replaces the gear tile
// and the word "Settings"; the Account nav group folds into it; the other users
// sit under it as faces. Without an account (a browser harness) the dialog
// keeps its gear head AND the Account item, so the page is never unreachable.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

const ACCOUNT = (onSwitch = vi.fn()): SettingsAccountHead => ({
  me: {
    userId: "01J8Z3K6W9QX2M4N7P5R8T1V3B",
    name: "James",
    face: { emoji: "🦊" },
    detail: "james@example.com",
    detailIsLogin: true,
  },
  others: [
    { userId: "01J9B7Q2MXC5D8F3G6H9J2K4N7", name: "Work", face: { emoji: "🐙" }, waiting: 2 },
  ],
  onSwitch,
});

async function mount(
  account: SettingsAccountHead | undefined,
  activePage: SettingsPage = "general",
  finish?: SettingsFinishSetup,
): Promise<ReturnType<typeof vi.fn>> {
  const onSelectPage = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      createElement(SettingsDialog, {
        activePage,
        onSelectPage,
        onClose: () => undefined,
        onUndo: () => undefined,
        onRedo: () => undefined,
        historyBusy: false,
        undoAvailable: false,
        redoAvailable: false,
        account,
        finish,
        children: createElement("p", null, "page"),
      }),
    ),
  );
  return onSelectPage;
}

const navLabels = (): string[] =>
  Array.from(container?.querySelectorAll(".vf-settings-nav-group") ?? []).map(
    (node) => node.textContent ?? "",
  );

describe("SettingsDialog head (UA-D19)", () => {
  it("is headed by the account, and the Account group folds into that head", async () => {
    const onSelectPage = await mount(ACCOUNT());
    const card = container?.querySelector<HTMLButtonElement>(".vf-settings-account-card");
    expect(card?.textContent).toContain("James");
    expect(card?.textContent).toContain("james@example.com");
    expect(container?.querySelector('[role="img"]')).toBeNull(); // decorative beside the name
    expect(navLabels()).not.toContain("Account");
    expect(navLabels()).toContain("Preferences");
    await act(async () => card?.click());
    expect(onSelectPage).toHaveBeenCalledWith("account");
  });

  it("stays a dialog named Settings to assistive tech", async () => {
    await mount(ACCOUNT());
    const dialog = container?.querySelector('[role="dialog"]');
    const title = document.getElementById(dialog?.getAttribute("aria-labelledby") ?? "");
    expect(title?.textContent).toBe("Settings");
  });

  it("marks the card as the current page while Account is open", async () => {
    await mount(ACCOUNT(), "account");
    expect(
      container?.querySelector(".vf-settings-account-card")?.getAttribute("aria-current"),
    ).toBe("page");
  });

  it("offers the other users as faces, with their waiting count beside them", async () => {
    const onSwitch = vi.fn();
    await mount(ACCOUNT(onSwitch));
    const other = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Switch to Work, 2 waiting"]',
    );
    expect(other?.textContent).toContain("🐙");
    expect(other?.querySelector(".vf-settings-account-waiting")?.textContent).toBe("2");
    await act(async () => other?.click());
    // The pressed face rides along: the switch carries it (DESIGN.md §8).
    expect(onSwitch).toHaveBeenCalledWith("01J9B7Q2MXC5D8F3G6H9J2K4N7", other);
  });

  it("says a refused switch under the faces, in main's words", async () => {
    await mount({
      ...ACCOUNT(),
      notice: "Couldn't switch to Work — a user switch is already in flight.",
    });
    expect(container?.querySelector('.vf-settings-account-notice[role="alert"]')?.textContent).toBe(
      "Couldn't switch to Work — a user switch is already in flight.",
    );
  });

  it("names the card without a stray comma while the link is still loading", async () => {
    const account = ACCOUNT();
    await mount({ ...account, me: { ...account.me, detail: "" } });
    expect(container?.querySelector(".vf-settings-account-card")?.getAttribute("aria-label")).toBe(
      "James — account settings",
    );
  });

  it("without an account keeps the gear head and the Account item", async () => {
    await mount(undefined);
    expect(container?.querySelector(".vf-settings-account-card")).toBeNull();
    expect(container?.textContent).toContain("Settings");
    expect(navLabels()).toContain("Account");
    expect(container?.querySelector('button[aria-label="Account settings"]')).not.toBeNull();
  });
});

// AO-D10 (track AO, AO-2) — Finish setting up: what the Setup Assistant was told
// "Not now", under the account card, until it is answered or hidden. Never a
// badge or a count; a no is never listed; a link answers Devices by itself.
describe("Finish setting up (AO-D10)", () => {
  const LEDGER = (steps: Record<string, unknown>, hidden = false) => ({
    format: 1 as const,
    steps,
    hidden,
  });
  const LATER = { state: "later", at: "2026-10-27T05:41:34.000Z" };

  it("lists a step put off while it still is, and nothing once it is answered or hidden", () => {
    const none = { linked: false, historyToBringIn: false };
    expect(finishSetupRows(LEDGER({ devices: LATER }), none)).toEqual([
      { step: "devices", glyph: "mesh", label: "Connect your devices" },
    ]);
    // a link answers Devices, wherever it was made
    expect(finishSetupRows(LEDGER({ devices: LATER }), { ...none, linked: true })).toEqual([]);
    // a no is never listed; a step never put off is not either
    expect(finishSetupRows(LEDGER({ devices: { state: "answered", at: LATER.at } }), none)).toEqual(
      [],
    );
    expect(finishSetupRows(LEDGER({}), none)).toEqual([]);
    // hidden by the person: no tile at all; and nothing guessed before the read
    expect(finishSetupRows(LEDGER({ devices: LATER }, true), none)).toEqual([]);
    expect(finishSetupRows(null, none)).toEqual([]);
  });

  it("lists History while something on this Mac is left to bring in, in the assistant's order (AO-3, AO-D12)", () => {
    const toBringIn = { linked: false, historyToBringIn: true };
    const history = { step: "history", glyph: "history", label: "Bring in your past sessions" };
    // put off, and history found that is not brought in
    expect(finishSetupRows(LEDGER({ history: LATER, devices: LATER }), toBringIn)).toEqual([
      history,
      { step: "devices", glyph: "mesh", label: "Connect your devices" },
    ]);
    // someone who set up before the chapter existed: no row, history found (AO-D12)
    expect(finishSetupRows(LEDGER({}), toBringIn)).toEqual([history]);
    // answered — yes or no — never listed; nothing left to bring in, never listed
    expect(
      finishSetupRows(LEDGER({ history: { state: "answered", at: LATER.at } }), toBringIn),
    ).toEqual([]);
    expect(
      finishSetupRows(LEDGER({ history: LATER }), { linked: false, historyToBringIn: false }),
    ).toEqual([]);
  });

  it("sits under the account card with its rows, Continue setup and Hide", async () => {
    const onContinue = vi.fn();
    const onHide = vi.fn();
    await mount(ACCOUNT(), "general", {
      rows: [{ step: "devices", glyph: "mesh", label: "Connect your devices" }],
      onContinue,
      onHide,
    });
    const head = container?.querySelector(".vf-settings-account");
    const tile = container?.querySelector(".vf-settings-finish");
    expect(tile?.previousElementSibling).toBe(head);
    expect(tile?.getAttribute("aria-labelledby")).toBe("vf-settings-finish-title");
    expect(tile?.textContent).toContain("Finish setting up");
    expect(tile?.textContent).toContain("Connect your devices");
    // no count anywhere in it
    expect(tile?.textContent).not.toMatch(/\d/);
    const buttons = Array.from(tile?.querySelectorAll("button") ?? []);
    expect(buttons.map((button) => button.textContent)).toEqual(["Continue setup", "Hide"]);
    await act(async () => buttons[0]?.click());
    await act(async () => buttons[1]?.click());
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("draws nothing when nothing was put off", async () => {
    await mount(ACCOUNT(), "general", { rows: [], onContinue: vi.fn(), onHide: vi.fn() });
    expect(container?.querySelector(".vf-settings-finish")).toBeNull();
  });
});
