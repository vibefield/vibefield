// @vitest-environment happy-dom
/**
 * The deck, MOUNTED (GT-3 — the test debt GT-2c named).
 *
 * GT-2c closed the remount-storm class in the deck's code and said so honestly:
 * "the class is closed, but the dev sequence is unreproduced in a harness."
 * This is that harness. It stubs the three things the deck cannot have here —
 * the bridge (main's IPC), the floor (fieldd), and the GPU (ghosttea's runtime
 * and workspace) — and then asserts on what the deck DOES with them: how many
 * runtimes it mints, how many times the workspace initializes, and which face
 * it shows before it lets a workspace exist at all.
 *
 * What is deliberately NOT here: anything that needs a real pane. A workspace
 * that claims sessions, a shell that echoes, a bridge that dies — those are
 * `pnpm smoke:godview`'s, against the real library and the real pair. This
 * fixture exists for the class a smoke cannot see, which is a React feedback
 * loop driven by event ORDER.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GodviewDeckFacts } from "../src/development-console";
import type { FieldHost } from "../src/host";
import { setHost } from "../src/host";
import type { RendererLogger } from "../src/logging";
import { setRendererLogger } from "../src/logging";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every runtime the deck has minted, in order. The storm was a runtime-per-
 * event loop, so counting them IS the assertion. */
const runtimes: Array<{ id: number; disposed: boolean }> = [];
/** Every workspace initialization, with the props that decided it. */
const workspaceMounts: Array<Record<string, unknown>> = [];

vi.mock("@vibecook/ghosttea-react", () => ({
  createGhostteaTerminalRuntime: () => {
    const runtime = { id: runtimes.length, disposed: false };
    runtimes.push(runtime);
    return {
      rendererBackend: "test",
      dispose: () => {
        runtime.disposed = true;
      },
      createSession: (options: unknown) => Promise.resolve({ id: `s-${JSON.stringify(options)}` }),
    };
  },
  // The one-shot ports wait, as a promise that never settles: in production it
  // resolves when main posts the MessagePorts, and nothing in this fixture
  // posts any. A pending promise is the honest stand-in — the deck must not
  // depend on it having resolved to do any of what is asserted below.
  waitForGhostteaRendererPorts: () => new Promise(() => undefined),
  GhostteaProvider: ({ children }: { children: unknown }) => children,
}));

vi.mock("@vibecook/ghosttea-react/terminal-render.worker.js?worker", () => ({
  default: class {},
}));

vi.mock("@vibecook/ghosttea-react/workspace", () => ({
  GhostteaWorkspace: (props: Record<string, unknown>) => {
    workspaceMounts.push(props);
    return null;
  },
  // 0.9.0's pinned color catalog, as the two entries these tests select
  // between. Stubbed rather than real because the fixture's whole point is to
  // hold the library still: a 602-entry catalog would make an assertion about
  // "the theme the deck handed over" depend on upstream's data.
  GHOSTTY_COLOR_THEMES: [
    {
      name: "Test Amber",
      background: "#201000",
      foreground: "#ffcc66",
      cursor: "#ffcc66",
      cursorText: "#201000",
      selection: "#553300",
      selectionForeground: "#ffffff",
      palette: [],
    },
  ],
}));

const { GodviewDeck } = await import("../src/godview/GodviewDeck");
const { DEFAULT_DECK_APPEARANCE, resetDeckAppearanceForTest, setDeckAppearance } = await import(
  "../src/godview/deck-appearance"
);

const DECK_STORAGE_KEY = "vf-godview-deck-v1";

/** The deck's own marker, which is also how the smoke reads it. Asserting
 * through the marker rather than through the DOM keeps this fixture and the
 * smoke pointed at the same statement of what the deck is. */
let markers: GodviewDeckFacts[] = [];
let publishStatus: ((status: { state: string }) => void) | null = null;
let connects = 0;
/** What `terminal.list` answers. Set per test; the restore gate reads it. */
let floor: Array<{ sessionId: string }> = [];
let requests: string[] = [];
let root: Root | null = null;
let container: HTMLElement | null = null;

function installHost(): void {
  setRendererLogger({
    child: () => ({ error: () => undefined, warn: () => undefined }) as unknown as RendererLogger,
  } as unknown as RendererLogger);
  setHost({
    logger: {} as RendererLogger,
    getConnection: () => Promise.resolve({ port: 1, token: "t" }),
    onPrepareClose: () => () => undefined,
    completeClose: () => undefined,
    platform: "darwin",
    terminal: {
      connect: () => {
        connects += 1;
        return Promise.resolve({ attached: true, defaultShell: "/bin/zsh", home: "/home/tester" });
      },
      onStatus: (handler: (status: { state: string }) => void) => {
        publishStatus = handler as (status: { state: string }) => void;
        return () => {
          publishStatus = null;
        };
      },
    },
    godview: { set: () => Promise.resolve({ open: false }), onState: () => () => undefined },
  } as unknown as FieldHost);
}

/** The fieldd client the deck sees. Only two methods are ever asked for. */
const fieldd = {
  request: (method: string): Promise<unknown> => {
    requests.push(method);
    if (method === "terminal.connectTicket") {
      return Promise.resolve({
        ticket: { controlSocket: "/x/control.sock", frameSocket: "/x/frame.sock", token: "tok" },
      });
    }
    if (method === "terminal.list") return Promise.resolve({ terminals: floor });
    return Promise.reject(new Error(`unexpected method ${method}`));
  },
};

vi.mock("@vibefield/fieldd-client/react", () => ({
  useFielddClient: () => fieldd,
}));

/** Mount, and let the two awaited round trips (ticket, then floor) settle.
 * `act` is flushed repeatedly rather than once: the deck's gate is two
 * promises deep, and one flush would assert on a state it has not reached. */
async function mountDeck(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<GodviewDeck active />);
  });
  await settle();
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  runtimes.length = 0;
  workspaceMounts.length = 0;
  markers = [];
  requests = [];
  floor = [];
  connects = 0;
  publishStatus = null;
  localStorage.clear();
  resetDeckAppearanceForTest();
  installHost();
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    if (typeof line === "string" && line.startsWith("GODVIEW_DECK ")) {
      markers.push(JSON.parse(line.slice("GODVIEW_DECK ".length)) as GodviewDeckFacts);
    }
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

/** A saved layout in the shape ghosttea persists, holding these sessions. */
function saveLayout(sessionIds: readonly string[]): void {
  const panes = sessionIds.map((sessionId, index) => ({
    kind: "pane",
    id: `pane-${index}`,
    sessionId,
    meta: { cwd: `/repo/${sessionId}` },
  }));
  const root =
    panes.length === 1
      ? panes[0]
      : {
          kind: "split",
          id: "split-1",
          axis: "horizontal",
          ratio: 0.5,
          first: panes[0],
          second: panes[1],
        };
  localStorage.setItem(
    DECK_STORAGE_KEY,
    JSON.stringify({ version: 1, root, activePaneId: "pane-0", zoomedPaneId: null }),
  );
}

const latest = (): GodviewDeckFacts => markers[markers.length - 1]!;

describe("the deck's mount, against stubs (GT-2c's named debt)", () => {
  it("mints exactly one runtime for a first mount", async () => {
    await mountDeck();
    expect(runtimes).toHaveLength(1);
    expect(connects).toBe(1);
    expect(workspaceMounts.length).toBeGreaterThan(0);
  });

  it("recovers on the transition, and ignores every republish of it — the storm", async () => {
    // GT-2c's dev sequence, in a harness at last. Main publishes on EVERY set,
    // including unchanged (its own contract test pins that), and the storm was
    // the deck treating each republish as news: a runtime and a generation per
    // event, each generation re-asking, until React's max update depth.
    //
    // The order here is production's. `bridge-up` is published ONLY after a
    // completed rebuild (terminal-backend.ts), never on a first attach, so a
    // deck that has heard nothing yet hears a DEATH first.
    await mountDeck();
    await act(async () => publishStatus?.({ state: "bridge-down" }));
    await settle();
    expect(runtimes, "a death mints nothing; it only reports").toHaveLength(1);
    expect(latest().error).toBe("the terminal bridge died — rebuilding");

    await act(async () => publishStatus?.({ state: "bridge-up" }));
    await settle();
    // Exactly one: zero would never recover (the old runtime's one-shot ports
    // wait is spent), and more than one is the storm in miniature.
    expect(runtimes).toHaveLength(2);
    expect(connects, "the new runtime re-asks for its ports").toBe(2);
    // Retired after commit, never inside an updater — each runtime owns a
    // render worker and the ports, and a leaked one is a leaked thread.
    expect(runtimes[0]?.disposed).toBe(true);
    expect(runtimes[1]?.disposed).toBe(false);

    const mountsAfterRecovery = workspaceMounts.length;
    for (let i = 0; i < 5; i++) {
      await act(async () => publishStatus?.({ state: "bridge-up" }));
    }
    await settle();
    expect(runtimes, "a republished state is not a transition").toHaveLength(2);
    expect(connects).toBe(2);
    expect(workspaceMounts.length).toBe(mountsAfterRecovery);
  });

  it("re-themes an OPEN deck without re-initializing it (GT-3v)", async () => {
    // The property GT-D12's live-apply rests on. The workspace keys its
    // initialization on `storageKey ∥ defaultShell ∥ claimExistingSessions ∥
    // initialCwd ∥ runtime` — `theme` is deliberately not among them — so an
    // appearance change must reach the panes as a new prop and NOTHING else.
    // The failure this guards is not cosmetic: a re-initialization here claims
    // sessions and creates a pane, so a user sliding an opacity control would
    // spawn shells.
    await mountDeck();
    const before = workspaceMounts[workspaceMounts.length - 1]!;
    expect((before.theme as { background: number[] }).background[3]).toBeCloseTo(
      DEFAULT_DECK_APPEARANCE.opacity,
    );

    await act(async () => {
      setDeckAppearance({ ...DEFAULT_DECK_APPEARANCE, opacity: 0.5 });
    });
    await settle();

    const after = workspaceMounts[workspaceMounts.length - 1]!;
    expect((after.theme as { background: number[] }).background[3]).toBeCloseTo(0.5);
    expect(runtimes, "a repaint is not a rebuild").toHaveLength(1);
    expect(connects, "nothing re-redeemed a ticket").toBe(1);
    // The init key, field by field: identical across the change is the whole
    // claim. Comparing the values (not the props object) is deliberate — the
    // deck rebuilds its platform object every render by design, and only
    // `defaultShell` off it is read by the library's initialization.
    for (const key of ["storageKey", "claimExistingSessions", "initialCwd"] as const) {
      expect(after[key], `${key} moved under the workspace`).toEqual(before[key]);
    }
    expect((after.platform as { defaultShell: string }).defaultShell).toBe(
      (before.platform as { defaultShell: string }).defaultShell,
    );
  });

  it("carries a named catalog theme through to the renderer's palette", async () => {
    await mountDeck();
    await act(async () => {
      setDeckAppearance({ ...DEFAULT_DECK_APPEARANCE, themeName: "Test Amber", opacity: 0.7 });
    });
    await settle();

    const theme = workspaceMounts[workspaceMounts.length - 1]!.theme as {
      background: number[];
      foreground: number[];
    };
    // The chosen palette is taken WHOLE — its own foreground, not this app's
    // white — while the viewer's alpha still rides on its background.
    expect(theme.background[3]).toBeCloseTo(0.7);
    expect(theme.foreground[0]).toBeCloseTo(1);
    expect(theme.foreground[1]).toBeCloseTo(0xcc / 255);
    expect(theme.foreground[2]).toBeCloseTo(0x66 / 255);
    expect(latest().glass.themeName).toBe("Test Amber");
  });

  it("mints a fresh runtime on retry, because the spent wait can never resolve", async () => {
    // A failed connect leaves a runtime whose one-shot ports wait is used up.
    // GT-2b's retry has to build a new one, not re-ask on the corpse.
    const failing = { ...fieldd, request: () => Promise.reject(new Error("no bridge")) };
    vi.spyOn(fieldd, "request").mockImplementation(failing.request);
    await mountDeck();
    expect(runtimes).toHaveLength(1);
    const button = container?.querySelector<HTMLButtonElement>(".vf-godview-deck-fault-retry");
    expect(button?.textContent).toBe("retry");
    vi.mocked(fieldd.request).mockRestore();
    await act(async () => button?.click());
    await settle();
    expect(runtimes).toHaveLength(2);
  });
});

describe("the restore consent gate (GT-3)", () => {
  it("mounts silently when every saved pane is still alive", async () => {
    saveLayout(["alive-1", "alive-2"]);
    floor = [{ sessionId: "alive-1" }, { sessionId: "alive-2" }];
    await mountDeck();
    expect(latest().consent, "nothing is at stake, so nothing is asked").toBeUndefined();
    expect(workspaceMounts.length).toBeGreaterThan(0);
    expect(container?.querySelector('[role="dialog"]')).toBeNull();
  });

  it("mounts silently with no saved layout, and never asks the floor", async () => {
    floor = [{ sessionId: "somebody-elses" }];
    await mountDeck();
    expect(latest().consent).toBeUndefined();
    expect(requests, "a first run has nothing to compare").not.toContain("terminal.list");
  });

  it("asks, with honest counts, when a saved pane would be relaunched", async () => {
    saveLayout(["alive-1", "dead-1"]);
    floor = [{ sessionId: "alive-1" }];
    await mountDeck();
    expect(latest().consent).toEqual({ saved: 2, alive: 1, dead: 1 });
    // The workspace does not exist yet — that is the point of a gate.
    expect(workspaceMounts, "nothing may spawn before the answer").toHaveLength(0);
    expect(container?.textContent).toContain("this deck had 2 panes last time");
    expect(container?.textContent).toContain("1 pane is still running and rejoin");
    expect(container?.textContent).toContain("1 pane ended");
  });

  it("restore mounts the workspace with rehydration armed, layout intact", async () => {
    saveLayout(["alive-1", "dead-1"]);
    floor = [{ sessionId: "alive-1" }];
    await mountDeck();
    const restore = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "restore",
    );
    await act(async () => restore?.click());
    await settle();
    expect(workspaceMounts).toHaveLength(1);
    expect(workspaceMounts[0]?.["onRehydratePane"]).toBeTypeOf("function");
    expect(localStorage.getItem(DECK_STORAGE_KEY), "the layout is kept").not.toBeNull();
  });

  it("start clean forgets the layout and mounts unarmed", async () => {
    saveLayout(["alive-1", "dead-1"]);
    floor = [{ sessionId: "alive-1" }];
    await mountDeck();
    const clean = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "start clean",
    );
    await act(async () => clean?.click());
    await settle();
    expect(localStorage.getItem(DECK_STORAGE_KEY), "an answer that does not stick").toBeNull();
    expect(workspaceMounts).toHaveLength(1);
    expect(
      workspaceMounts[0]?.["onRehydratePane"],
      "declining means the library's own drop-and-collapse",
    ).toBeUndefined();
  });

  it("mounts anyway when the floor cannot be listed, rather than guessing", async () => {
    // Guessing that every saved pane is dead would be the one answer certain
    // to be wrong: the floor outlives the shell precisely so they are not.
    saveLayout(["alive-1"]);
    vi.spyOn(fieldd, "request").mockImplementation((method: string): Promise<unknown> => {
      if (method === "terminal.list") return Promise.reject(new Error("floor unreachable"));
      return Promise.resolve({
        ticket: { controlSocket: "/x/c.sock", frameSocket: "/x/f.sock", token: "tok" },
      });
    });
    await mountDeck();
    expect(latest().consent).toBeUndefined();
    expect(workspaceMounts.length).toBeGreaterThan(0);
  });

  it("treats a malformed saved layout as no layout, silently (GT-D8)", async () => {
    localStorage.setItem(DECK_STORAGE_KEY, "{ not json");
    floor = [{ sessionId: "whatever" }];
    await mountDeck();
    expect(latest().consent).toBeUndefined();
    expect(workspaceMounts.length).toBeGreaterThan(0);
  });
});

describe("paneMeta, the durable half of restore (GT-D8 as amended)", () => {
  it("carries cwd and title, and omits what the session did not have", async () => {
    await mountDeck();
    const paneMeta = workspaceMounts[0]?.["paneMeta"] as (session: unknown) => unknown;
    expect(paneMeta({ cwd: "/repo/api", title: "vim" })).toEqual({
      cwd: "/repo/api",
      title: "vim",
    });
    expect(paneMeta({ cwd: null, title: null })).toEqual({});
    expect(paneMeta({ cwd: "/repo", title: "" })).toEqual({ cwd: "/repo" });
  });
});
