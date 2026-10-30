// @vitest-environment happy-dom

import type {
  DesktopShellState,
  UpdateConfirmResult,
  UpdateDownloadResult,
  UpdateMoveResult,
  UpdatePrepareResult,
  UpdateView,
} from "@vibefield/contracts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type FieldHost, type FieldUpdatesHost, setHost } from "../src/host";
import { UpdatesDoctorSection, UpdatesSection } from "../src/panels/UpdatesSection";

// WP12d (L3c-ii; build-wp12-updater.md §13 C2/C3/C4, the PM's ruling 2026-10-15 18:17Z) — the Settings card on its real
// controller over a fake host. The card IS the consent from Settings: Restart takes ONE snapshot (prepare), the red
// second click acts on THAT token (confirm), and a release that ends nothing asks nothing more — no apply asks twice.
// A lower channel says EDP-36's sentence before it takes.
// AU-3 — the card became Settings → Updates: the head's exact version and its Copy, one primary act per state,
// Download and Download anyway through AU-1's door, the install that didn't take, and the foot's diagnostics.
// AU-7 — where the app runs: a copy macOS won't let replace itself moves first, through main's quit gate; a writable
// copy elsewhere carries one quiet line with the move beside it.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noopLogger: FieldHost["logger"] = {
  child: () => noopLogger,
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
  isLevelEnabled: () => false,
};

const TOKEN = "t".repeat(32);
const VERSION = "1.2.0";
const CONSENT = {
  message: "Updating ends 2 terminal sessions",
  lead: `VibeField ${VERSION} replaces the terminal service, which ends:`,
  listed: ["claude — ~/Projects/vibe-field", "zsh — ~/Projects/rosetta"],
  more: 0,
  confirm: "End 2 sessions and update",
};
const BASE: UpdateView = {
  phase: "idle",
  channel: "nightly",
  buildChannel: "nightly",
  enabled: true,
  lastCheckAt: null,
  applyWired: true,
};
const STAGED: UpdateView = { ...BASE, phase: "staged", version: VERSION, sessions: 2 };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root !== null) act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
});

function fakeUpdates(
  answers: {
    prepare?: UpdatePrepareResult;
    confirm?: UpdateConfirmResult;
    download?: UpdateDownloadResult;
    doctor?: () => Promise<{ lines: string[] }>;
    move?: () => Promise<UpdateMoveResult>;
  } = {},
): FieldUpdatesHost & { [K in keyof FieldUpdatesHost]: ReturnType<typeof vi.fn> } {
  return {
    // AU-1 — the check answers when it settles; the card does not read the answer
    check: vi.fn(async () => ({ outcome: "up-to-date" })),
    setEnabled: vi.fn(async () => undefined),
    setChannel: vi.fn(async () => undefined),
    decline: vi.fn(async () => undefined),
    download: vi.fn(async () => answers.download ?? { ok: true }),
    prepareRestart: vi.fn(
      async () =>
        answers.prepare ?? {
          ok: true,
          token: TOKEN,
          version: VERSION,
          keepsSessions: false,
          sessions: [
            { sessionId: "s1", title: "claude", cwd: "~/Projects/vibe-field" },
            { sessionId: "s2", title: "zsh", cwd: "~/Projects/rosetta" },
          ],
          expiresAt: 1,
          consent: CONSENT,
        },
    ),
    confirmRestart: vi.fn(async () => answers.confirm ?? { ok: true }),
    doctor: vi.fn(answers.doctor ?? (async () => ({ lines: ["updates: idle · channel nightly"] }))),
    // AU-7 — the quit gate's answer: proceed (the app quits and moves) unless a test says otherwise
    moveToApplications: vi.fn(answers.move ?? (async () => ({ ok: true, outcome: "proceed" }))),
  } as never;
}

function host(
  updates: FieldUpdatesHost | null,
  diagnostics?: FieldHost["diagnostics"] | undefined,
): void {
  setHost({
    logger: noopLogger,
    getConnection: async () => ({ port: 1, token: "test" }),
    onPrepareClose: () => () => undefined,
    completeClose: () => undefined,
    ...(updates === null ? {} : { updates }),
    ...(diagnostics === undefined ? {} : { diagnostics }),
  });
}

const desktop = (update: UpdateView | undefined): DesktopShellState =>
  ({
    tray: {
      availability: "available",
      placement: "visible",
      backgroundShellEffective: false,
      issue: null,
    },
    ...(update === undefined ? {} : { update }),
  }) as DesktopShellState;

async function mount(
  update: UpdateView | undefined,
  onOpenDiagnostics?: () => void,
): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      createElement(UpdatesSection, { desktopState: desktop(update), onOpenDiagnostics }),
    );
  });
}

async function rerender(update: UpdateView | undefined): Promise<void> {
  await act(async () => {
    root?.render(createElement(UpdatesSection, { desktopState: desktop(update) }));
  });
}

const text = (): string => container?.textContent ?? "";
const button = (label: string): HTMLButtonElement => {
  const found = [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (found === undefined) throw new Error(`no button "${label}" in: ${text()}`);
  return found;
};
const click = async (label: string): Promise<void> => {
  await act(async () => {
    button(label).click();
  });
};

describe("Settings → Updates", () => {
  it("says no updater runs where none does — a build without a release identity", async () => {
    host(null);
    await mount(undefined);
    expect(text()).toContain("This build doesn't update itself");
    expect(container?.querySelector('[data-updates-phase="absent"]')).not.toBeNull();
  });

  it("the card is the consent: Restart takes ONE snapshot, the red second click acts on THAT token", async () => {
    const updates = fakeUpdates();
    host(updates);
    await mount(STAGED);
    expect(text()).toContain(`VibeField ${VERSION} is ready — restart to finish updating`);
    expect(text()).toContain("Restarting ends 2 terminal sessions. You choose when.");

    await click("Restart to update…");
    expect(updates.prepareRestart).toHaveBeenCalledTimes(1);
    expect(updates.confirmRestart).not.toHaveBeenCalled();
    const consent = container?.querySelector("[data-updates-consent]");
    expect(consent?.textContent).toContain("Updating ends 2 terminal sessions");
    expect(consent?.textContent).toContain("claude — ~/Projects/vibe-field");
    expect(consent?.textContent).toContain("zsh — ~/Projects/rosetta");
    // red text, and Cancel holds focus — Cancel is the tray box's default: nothing ends by accident; it leads, and
    // the act trails (LC-9, LC-44)
    expect(button("End 2 sessions and update").dataset.variant).toBe("danger");
    expect(document.activeElement).toBe(button("Cancel"));
    const acts = [...(consent?.querySelectorAll("button") ?? [])].map((act) => act.textContent);
    expect(acts).toEqual(["Cancel", "End 2 sessions and update"]);

    await click("End 2 sessions and update");
    expect(updates.confirmRestart).toHaveBeenCalledWith(TOKEN);
    expect(text()).toContain("Restarting VibeField…");
  });

  it("Cancel and Escape drop the snapshot: nothing is confirmed", async () => {
    const updates = fakeUpdates();
    host(updates);
    await mount(STAGED);
    await click("Restart to update…");
    await click("Cancel");
    expect(container?.querySelector("[data-updates-consent]")).toBeNull();
    // the question took focus with it: it comes back to the head's act, never to the page's body (LC-9)
    expect(document.activeElement).toBe(button("Restart to update…"));

    await click("Restart to update…");
    await act(async () => {
      container
        ?.querySelector("[data-updates-consent]")
        ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(container?.querySelector("[data-updates-consent]")).toBeNull();
    expect(document.activeElement).toBe(button("Restart to update…"));
    expect(updates.confirmRestart).not.toHaveBeenCalled();
  });

  it("a release that ends nothing asks nothing more: one click prepares and confirms", async () => {
    const updates = fakeUpdates({
      prepare: {
        ok: true,
        token: TOKEN,
        version: VERSION,
        keepsSessions: true,
        sessions: [],
        expiresAt: 1,
      },
    });
    host(updates);
    await mount({ ...STAGED, keepsSessions: true });
    expect(text()).toContain("Your terminal sessions keep running.");
    await click("Restart to update");
    expect(updates.confirmRestart).toHaveBeenCalledWith(TOKEN);
    expect(container?.querySelector("[data-updates-consent]")).toBeNull();
  });

  it("says main's own words when the apply does not start — at prepare, and an expired snapshot at confirm", async () => {
    const refused = fakeUpdates({
      prepare: {
        ok: false,
        reason: "policy-unreachable",
        words: {
          message: "VibeField didn't install the update",
          detail:
            "VibeField checks the update policy before installing and couldn't reach it; try again when online.",
        },
      },
    });
    host(refused);
    await mount(STAGED);
    await click("Restart to update…");
    expect(container?.querySelector('[role="alert"]')?.textContent).toBe(
      "VibeField didn't install the update. VibeField checks the update policy before installing and couldn't reach it; try again when online.",
    );
    expect(refused.confirmRestart).not.toHaveBeenCalled();
    act(() => root?.unmount());
    root = null;
    container?.remove();

    const expired = fakeUpdates({
      confirm: {
        ok: false,
        reason: "expired",
        words: {
          message: "VibeField didn't install the update",
          detail:
            "The list of sessions it would end may have changed while you decided. Nothing changed; choose Restart to Update again.",
        },
      },
    });
    host(expired);
    await mount(STAGED);
    await click("Restart to update…");
    await click("End 2 sessions and update");
    expect(container?.querySelector('[role="alert"]')?.textContent).toContain(
      "choose Restart to Update again",
    );
    // the next Restart takes a fresh snapshot
    await click("Restart to update…");
    expect(expired.prepareRestart).toHaveBeenCalledTimes(2);
  });

  it("drops a consent whose staged version went — the card never shows a stale list", async () => {
    host(fakeUpdates());
    await mount(STAGED);
    await click("Restart to update…");
    expect(container?.querySelector("[data-updates-consent]")).not.toBeNull();
    await rerender({ ...BASE, phase: "idle" });
    expect(container?.querySelector("[data-updates-consent]")).toBeNull();
  });

  it("asks through the doors: Check for updates while up to date", async () => {
    const updates = fakeUpdates();
    host(updates);
    await mount(BASE);
    await click("Check for updates");
    expect(updates.check).toHaveBeenCalledTimes(1);
  });

  it("asks through the doors while an update is ready: the switch, skip — and the head offers the restart alone", async () => {
    const updates = fakeUpdates();
    host(updates);
    await mount(STAGED);
    expect(() => button("Check for updates")).toThrow();
    await act(async () => {
      container?.querySelector<HTMLButtonElement>('[role="switch"]')?.click();
    });
    expect(updates.setEnabled).toHaveBeenCalledWith(false);
    await click("Skip this version");
    expect(updates.decline).toHaveBeenCalledWith(VERSION);
  });

  it("says EDP-36's sentence before a lower channel takes; a higher one takes at once", async () => {
    const updates = fakeUpdates();
    host(updates);
    await mount(BASE); // a nightly build on nightly
    await act(async () => {
      container?.querySelector<HTMLButtonElement>('button[data-id="stable"]')?.click();
    });
    expect(updates.setChannel).not.toHaveBeenCalled();
    expect(container?.querySelector('[data-updates-downgrade="stable"]')?.textContent).toContain(
      "Return to stable — reinstalls the latest stable release.",
    );
    await click("Return to stable");
    expect(updates.setChannel).toHaveBeenCalledWith("stable");

    act(() => root?.unmount());
    root = null;
    container?.remove();
    const upward = fakeUpdates();
    host(upward);
    await mount({ ...BASE, channel: "stable", buildChannel: "stable" });
    await act(async () => {
      container?.querySelector<HTMLButtonElement>('button[data-id="beta"]')?.click();
    });
    expect(upward.setChannel).toHaveBeenCalledWith("beta");
    expect(container?.querySelector("[data-updates-downgrade]")).toBeNull();
  });

  it("shows real progress with its number, and the advisory line as a sentence, never a block", async () => {
    host(fakeUpdates());
    await mount({
      ...BASE,
      phase: "downloading",
      version: VERSION,
      percent: 42,
      unsupportedBelow: "1.1.0",
    });
    const bar = container?.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("42");
    expect(text()).toContain(`Downloading VibeField ${VERSION} · 42%`);
    expect(text()).toContain("It installs when you restart VibeField.");
    expect(text()).toContain("older than the oldest one its publisher supports (1.1.0)");
    // nothing to do while it downloads: the head offers no act
    expect(() => button("Check for updates")).toThrow();
    expect(container?.querySelector('[data-updates-head] [data-variant="primary"]')).toBeNull();
  });

  it("heads the page with the exact version, and Copy puts it on the clipboard (AU-G4)", async () => {
    const copyText = vi.fn(async () => undefined);
    host(fakeUpdates(), { copyText } as never);
    await mount({ ...BASE, currentVersion: "0.1.0-nightly.20261027" });
    const head = container?.querySelector("[data-updates-head]");
    expect(head?.querySelector("code")?.textContent).toBe("0.1.0-nightly.20261027");
    // the channel's word alone: no build day before AU-6, no app mark (LC-18, LC-22)
    expect(head?.textContent).toContain("Nightly");
    expect(head?.textContent).not.toContain("built");
    await click("Copy");
    expect(copyText).toHaveBeenCalledWith("0.1.0-nightly.20261027");
    expect(button("Copied")).toBeDefined();
  });

  it("drops the version line when main says none (an older main)", async () => {
    host(fakeUpdates());
    await mount(BASE);
    expect(container?.querySelector("[data-updates-version]")).toBeNull();
    expect(() => button("Copy")).toThrow();
  });

  it("offers Download with updates off, and Download anyway after a skip — both through AU-1's door", async () => {
    const off = fakeUpdates();
    host(off);
    await mount({ ...BASE, enabled: false, phase: "available", version: VERSION });
    expect(text()).toContain("Automatic updates are off, so it waits for you.");
    await click("Download");
    expect(off.download).toHaveBeenCalledWith(VERSION);
    act(() => root?.unmount());
    root = null;
    container?.remove();

    const skipped = fakeUpdates();
    host(skipped);
    await mount({ ...BASE, phase: "available", version: VERSION, declined: true });
    expect(text()).toContain(`You skipped VibeField ${VERSION}`);
    await click("Download anyway");
    expect(skipped.download).toHaveBeenCalledWith(VERSION);
  });

  it("says main's words when a Download is refused, and its own when main sent none", async () => {
    host(
      fakeUpdates({
        download: {
          ok: false,
          reason: "not-available",
          words: {
            message: "VibeField didn't download the update",
            detail: "The nightly channel has moved past that version.",
          },
        },
      }),
    );
    await mount({ ...BASE, phase: "available", version: VERSION, declined: true });
    await click("Download anyway");
    expect(container?.querySelector('[role="alert"]')?.textContent).toBe(
      "VibeField didn't download the update. The nightly channel has moved past that version.",
    );
    act(() => root?.unmount());
    root = null;
    container?.remove();

    host(fakeUpdates({ download: { ok: false, reason: "busy" } }));
    await mount({ ...BASE, phase: "available", version: VERSION, declined: true });
    await click("Download anyway");
    expect(container?.querySelector('[role="alert"]')?.textContent).toBe(
      "VibeField didn't download the update. VibeField is busy with another update step.",
    );
  });

  it("says what the switch and the chosen channel mean", async () => {
    host(fakeUpdates());
    await mount({ ...BASE, channel: "stable", buildChannel: "stable" });
    expect(text()).toContain("Download updates in the background.");
    expect(text()).toContain("Tested releases.");
    act(() => root?.unmount());
    root = null;
    container?.remove();

    host(fakeUpdates());
    await mount({ ...BASE, enabled: false });
    expect(text()).toContain(
      "VibeField checks only when you choose Check for updates, and downloads only when you choose Download.",
    );
    expect(text()).toContain("Every night's build: the newest, and the least tested.");
  });

  it("says a channel with nothing published quietly, and still offers Check for updates (LC-31)", async () => {
    host(fakeUpdates());
    await mount({ ...BASE, channel: "beta", phase: "failed", unavailable: "channel-unresolved" });
    expect(text()).toContain("No beta release yet");
    expect(button("Check for updates")).toBeDefined();
    expect(() => button("Check again")).toThrow();
    expect(() => button("Diagnostics →")).toThrow();
  });

  it("says an install that didn't take on the launch that found it, with Diagnostics beside it (AU-G7)", async () => {
    const openDiagnostics = vi.fn();
    host(fakeUpdates());
    await mount(
      {
        ...STAGED,
        version: "0.1.0-nightly.20261028",
        sessions: 0,
        currentVersion: "0.1.0-nightly.20261027",
        lastApply: {
          version: "0.1.0-nightly.20261028",
          from: "0.1.0-nightly.20261027",
          outcome: "not-applied",
          at: 1,
          thisLaunch: true,
        },
      },
      openDiagnostics,
    );
    expect(container?.querySelector("[data-updates-not-applied]")?.textContent).toBe(
      "The last restart didn't install the Oct 28 nightly. VibeField came back on the Oct 27 nightly, and the update is ready to try again.",
    );
    await click("Diagnostics →");
    expect(openDiagnostics).toHaveBeenCalledTimes(1);
  });

  it("marks the ready line with the dot, and the foot opens the updater's diagnostics", async () => {
    const openDiagnostics = vi.fn();
    host(fakeUpdates());
    await mount(STAGED, openDiagnostics);
    const dot = container?.querySelector('[data-updates-phase="staged"] .vf-updates-dot');
    expect(dot).not.toBeNull();
    expect(text()).toContain("Plugins update from Settings → Plugins.");
    await click("Updater diagnostics →");
    expect(openDiagnostics).toHaveBeenCalledTimes(1);
    act(() => root?.unmount());
    root = null;
    container?.remove();

    host(fakeUpdates());
    await mount({ ...STAGED, applyWired: false });
    expect(container?.querySelector(".vf-updates-dot")).toBeNull();
  });
});

describe("Settings → Updates — where the app runs (AU-7; AU-G8, LC-10, LC-40)", () => {
  it("says a copy macOS won't let replace itself in the attention ink, with Move to Applications… its primary", async () => {
    let answer: (result: UpdateMoveResult) => void = () => undefined;
    const updates = fakeUpdates({
      move: () =>
        new Promise<UpdateMoveResult>((resolve) => {
          answer = resolve;
        }),
    });
    host(updates);
    await mount({ ...STAGED, sessions: 0, location: "read-only" });
    expect(text()).toContain("VibeField can't update itself from here");
    expect(text()).toContain(
      "macOS won't let VibeField replace itself where it is. Move it to Applications and it updates as usual.",
    );
    // the ready update it can't install: no dot, no Restart, no Skip
    expect(container?.querySelector(".vf-updates-dot")).toBeNull();
    expect(() => button("Restart to update")).toThrow();
    expect(() => button("Skip this version")).toThrow();
    expect(button("Move to Applications…").dataset.variant).toBe("primary");

    await click("Move to Applications…");
    expect(updates.moveToApplications).toHaveBeenCalledTimes(1);
    expect(updates.prepareRestart).not.toHaveBeenCalled();
    expect(text()).toContain("Moving VibeField to Applications…");
    expect(button("Move to Applications…").disabled).toBe(true);

    // the quit gate's Cancel: the page comes back to rest
    await act(async () => {
      answer({ ok: true, outcome: "cancel" });
    });
    expect(text()).not.toContain("Moving VibeField to Applications…");
    expect(button("Move to Applications…").disabled).toBe(false);
  });

  it("keeps the moving line while the quit proceeds — the window closes under it", async () => {
    const updates = fakeUpdates();
    host(updates);
    await mount({ ...BASE, location: "read-only" });
    await click("Move to Applications…");
    expect(text()).toContain("Moving VibeField to Applications…");
  });

  it("says main's words when the move is refused, and its own when main sent none", async () => {
    host(
      fakeUpdates({
        move: async () => ({
          ok: false,
          reason: "busy",
          words: { message: "VibeField is restarting", detail: "Move it once it opens again." },
        }),
      }),
    );
    await mount({ ...BASE, location: "read-only" });
    await click("Move to Applications…");
    expect(container?.querySelector('[role="alert"]')?.textContent).toBe(
      "VibeField is restarting. Move it once it opens again.",
    );
    expect(text()).not.toContain("Moving VibeField to Applications…");
    act(() => root?.unmount());
    root = null;
    container?.remove();

    host(fakeUpdates({ move: async () => ({ ok: false, reason: "busy" }) }));
    await mount({ ...BASE, location: "read-only" });
    await click("Move to Applications…");
    expect(container?.querySelector('[role="alert"]')?.textContent).toBe(
      "VibeField didn't move to Applications. VibeField is already quitting or updating.",
    );
  });

  it("says the bridge's failure under the page and comes back to rest", async () => {
    host(
      fakeUpdates({
        move: async () => {
          throw new Error("No handler registered");
        },
      }),
    );
    await mount({ ...BASE, location: "read-only" });
    await click("Move to Applications…");
    expect(text()).toContain("VibeField couldn't reach its updater: No handler registered.");
    expect(text()).not.toContain("Moving VibeField to Applications…");
  });

  it("a writable copy outside Applications updates as usual: one quiet line, the move beside it", async () => {
    const updates = fakeUpdates();
    host(updates);
    await mount({ ...STAGED, location: "elsewhere" });
    // the state's own act and words stand; the dot still marks the ready line
    expect(button("Restart to update…").dataset.variant).toBe("primary");
    expect(container?.querySelector(".vf-updates-dot")).not.toBeNull();
    expect(text()).not.toContain("can't update itself");
    const line = container?.querySelector('[data-updates-location="elsewhere"]');
    expect(line?.textContent).toContain("VibeField runs outside Applications");
    expect(button("Move to Applications…").dataset.variant).not.toBe("primary");

    await click("Move to Applications…");
    expect(updates.moveToApplications).toHaveBeenCalledTimes(1);
    expect(text()).toContain("Moving VibeField to Applications…");
  });

  it("says nothing of the location in Applications, or where main doesn't say", async () => {
    host(fakeUpdates());
    await mount({ ...BASE, location: "applications" });
    expect(container?.querySelector("[data-updates-location]")).toBeNull();
    expect(() => button("Move to Applications…")).toThrow();
    act(() => root?.unmount());
    root = null;
    container?.remove();

    host(fakeUpdates());
    await mount(BASE);
    expect(container?.querySelector("[data-updates-location]")).toBeNull();
    expect(() => button("Move to Applications…")).toThrow();
  });
});

describe("the updater block (Settings › Diagnostics)", () => {
  it("renders the doctor's lines as the panel's key and value rows, and Refresh reads again", async () => {
    const updates = fakeUpdates({
      doctor: async () => ({
        lines: ["updates: staged · channel nightly", "update cache: 186.4 MB"],
      }),
    });
    host(updates);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(UpdatesDoctorSection));
    });
    expect(container.querySelector('[data-updates-doctor="ready"]')?.textContent).toBe(
      "updatesstaged · channel nightlyupdate cache186.4 MB",
    );
    await click("Refresh");
    expect(updates.doctor).toHaveBeenCalledTimes(2);
  });

  it("says when no updater runs, and when it does not answer", async () => {
    host(null);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(UpdatesDoctorSection));
    });
    expect(text()).toContain("No updater runs in this build.");
    act(() => root?.unmount());
    root = null;
    container.remove();

    host(
      fakeUpdates({
        doctor: async () => {
          throw new Error("the bridge is gone");
        },
      }),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(createElement(UpdatesDoctorSection));
    });
    expect(text()).toContain(
      "The updater didn't answer: the bridge is gone. Refresh to ask again.",
    );
  });
});
