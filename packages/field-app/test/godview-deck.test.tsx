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

import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GodviewDeckFacts } from "../src/development-console";
import type { FieldHost } from "../src/host";
import { getHost, setHost } from "../src/host";
import type { RendererLogger } from "../src/logging";
import { setRendererLogger } from "../src/logging";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every runtime the deck has minted, in order. The storm was a runtime-per-
 * event loop, so counting them IS the assertion. */
const runtimes: Array<{ id: number; disposed: boolean }> = [];
/** What the device warm answers. The prewarm's ONLY await since TP-S1, so it is
 * the only place a warm can be held open. */
let deviceWarm: () => Promise<{ backend: string }> = () => Promise.resolve({ backend: "test" });
/** Every workspace initialization, with the props that decided it. */
const workspaceMounts: Array<Record<string, unknown>> = [];

vi.mock("@vibecook/ghosttea-react", () => ({
  createGhostteaTerminalRuntime: () => {
    const runtime = { id: runtimes.length, disposed: false };
    runtimes.push(runtime);
    return {
      // GT-3p: the real runtime is an EventTarget and the deck listens on it
      // for `renderer-status` (the device-ready mark, and the backend the lab
      // reports). The stub answers the surface without ever firing — a fixture
      // that announced a backend would be asserting about its own stub.
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      rendererBackend: "test",
      dispose: () => {
        runtime.disposed = true;
      },
      // TP-S0b: the prewarm path drives these, and it drives them through the
      // POOL now rather than through a second module. A stub without them made
      // the warm fail on every case that started one — and the one-runtime case
      // below then passed because the deck saw a FAULT, not because it inherited
      // anything. A fixture that can only fail proves nothing about a success.
      connect: () => Promise.resolve(),
      startPerformanceMeasurement: () => Promise.resolve(),
      finishPerformanceMeasurement: () => deviceWarm(),
      // TP-S1: a pane is born through fieldd and MOUNTED from the floor's own
      // summary, so the fixture's floor has to be able to answer for it.
      listSessions: () => Promise.resolve(floor.map((row) => ({ id: row.sessionId }))),
      createSession: (options: unknown) => Promise.resolve({ id: `s-${JSON.stringify(options)}` }),
      // GT-D17's two verbs, as the door calls them. `openRemoteSession` answers
      // with a REPLICA — a local session id standing for a peer's — which is
      // the thing the deck has to remember the origin of (GT-5c).
      listRemoteHosts: () => Promise.resolve([]),
      openRemoteSession: (deviceId: string, remoteSessionId: string) =>
        Promise.resolve({ id: `replica-${deviceId}-${remoteSessionId}`, readWrite: true }),
      terminate: () => undefined,
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
  // The real id set, spelled out: the deck's effects projection refuses an id
  // upstream does not know, so a stub that said yes to everything would let a
  // typo'd shader reach the workspace in a test and only fail in James's eye.
  isGhostteaShaderEffect: (id: string) =>
    ["ghosttea:better-crt", "ghosttea:crt", "ghosttea:vhs", "ghosttea:sparks-from-fire"].includes(
      id,
    ),
  TERMINAL_THEMES: {
    daylight: {
      background: [0.925, 0.91, 0.86, 1],
      foreground: [0.12, 0.12, 0.12, 1],
      cursor: [0.12, 0.12, 0.12, 1],
      selection: [0.3, 0.3, 0.3, 1],
      selectionForeground: [1, 1, 1, 1],
    },
    midnight: {
      background: [0.157, 0.173, 0.204, 1],
      foreground: [1, 1, 1, 1],
      cursor: [1, 1, 1, 1],
      selection: [0.3, 0.3, 0.3, 1],
      selectionForeground: [1, 1, 1, 1],
    },
  },
}));

const { disposeTerminalPool, prewarmTerminalPool, terminalPoolSnapshot } = await import(
  "../src/terminal/pool"
);
const { GodviewDeck } = await import("../src/godview/GodviewDeck");
const { paneCwd, readDeviceHost } = await import("../src/godview/deck-restore");
type RemoteSessionDoor = import("../src/godview/monitor/remote-door").RemoteSessionDoor;
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
  // Every level, deliberately. The half-stub this replaced turned the pool's
  // own `info` on a spent prewarm into a TypeError that rejected the warm — and
  // a rejected warm is why the deck built no second runtime in the one-runtime
  // case. A fixture's logger must not be able to change the subject's control
  // flow.
  setRendererLogger({
    child: () =>
      ({
        trace: () => undefined,
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        fatal: () => undefined,
      }) as unknown as RendererLogger,
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

const TICKET = { controlSocket: "/x/control.sock", frameSocket: "/x/frame.sock", token: "tok" };

/** The fieldd client the deck sees.
 *
 * TP-S1 changed every door here. There is no `connectTicket` — a transport is
 * opened FOR a session — so the fixture answers `openTicket` for sessions the
 * floor has, `create` for a birth, and `roster` for the UI's placement-free
 * projection. `terminal.list` is gone from the renderer entirely: it is the
 * TRANSPORT-facing projection and carries the cell tag a UI may not see. */
const fieldd = {
  request: (method: string, params?: unknown): Promise<unknown> => {
    requests.push(method);
    if (method === "terminal.openTicket") {
      const sessionId = (params as { sessionId: string }).sessionId;
      if (!floor.some((row) => row.sessionId === sessionId)) {
        return Promise.reject(new Error(`NOT_FOUND: ${sessionId} is not observed`));
      }
      return Promise.resolve(TICKET);
    }
    if (method === "terminal.create") {
      const sessionId = `born-${floor.length + 1}`;
      floor = [...floor, { sessionId }];
      return Promise.resolve({ sessionId, ticket: TICKET });
    }
    if (method === "terminal.roster") {
      // The contract's key is `items` (`TerminalRosterResult`), not `sessions`.
      return Promise.resolve({
        items: floor.map((row) => ({
          sessionId: row.sessionId,
          workloadClass: "interactive",
          health: "live",
        })),
      });
    }
    return Promise.reject(new Error(`unexpected method ${method}`));
  },
};

vi.mock("@vibefield/fieldd-client/react", () => ({
  useFielddClient: () => fieldd,
}));

/** Mount, and let the two awaited round trips (ticket, then floor) settle.
 * `act` is flushed repeatedly rather than once: the deck's gate is two
 * promises deep, and one flush would assert on a state it has not reached. */
async function mountDeck(theme: "light" | "dark" = "light"): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<GodviewDeck active theme={theme} />);
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
  deviceWarm = () => Promise.resolve({ backend: "test" });
  connects = 0;
  publishStatus = null;
  localStorage.clear();
  resetDeckAppearanceForTest();
  // TP-S0b: the pool is a per-WINDOW module singleton, so a case that opened or
  // warmed one would otherwise hand the next case a transport it never asked
  // for — and the bridge subscription that came with it.
  disposeTerminalPool();
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
      setDeckAppearance({
        ...DEFAULT_DECK_APPEARANCE,
        lightThemeName: "Test Amber",
        opacity: 0.7,
      });
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

  it("keeps the light and dark terminal color-theme choices independent", async () => {
    await mountDeck("dark");
    await act(async () => {
      setDeckAppearance({
        ...DEFAULT_DECK_APPEARANCE,
        lightThemeName: null,
        darkThemeName: "Test Amber",
      });
    });
    await settle();

    expect(latest().glass.themeName).toBe("Test Amber");
    expect(
      (workspaceMounts[workspaceMounts.length - 1]!.theme as { background: number[] })
        .background[0],
    ).toBeCloseTo(0x20 / 255);
  });

  it("passes NO effects prop while no shader is chosen (GT-3f)", async () => {
    // The distinction the whole slice rests on. `undefined` and absent look the
    // same to React, so this asserts the KEY is missing: with the prop absent
    // ghosttea keeps its own config-derived path, and a deck that sent an empty
    // override instead would silently blank a floor-configured shader for
    // anyone whose floor has one.
    await mountDeck();
    const props = workspaceMounts[workspaceMounts.length - 1]!;

    expect("effects" in props, "an unchosen shader is a prop that was never sent").toBe(false);
    expect(latest().effects).toEqual({ shaderEffect: null, animate: false });
  });

  it("hands a chosen shader over live, without re-initializing (GT-3f)", async () => {
    // Same property the theme has, for the prop that arrived at 0.9.1: `effects`
    // is not among the workspace's initialization deps, so picking a shader
    // re-renders the panes rather than claiming sessions and spawning one.
    await mountDeck();
    const before = workspaceMounts[workspaceMounts.length - 1]!;

    await act(async () => {
      setDeckAppearance({
        ...DEFAULT_DECK_APPEARANCE,
        shaderEffect: "ghosttea:crt",
        shaderAnimate: false,
      });
    });
    await settle();

    const after = workspaceMounts[workspaceMounts.length - 1]!;
    expect(after.effects).toEqual({
      postProcess: "none",
      shaderEffects: ["ghosttea:crt"],
      animate: false,
    });
    expect(runtimes, "a shader is a repaint, not a rebuild").toHaveLength(1);
    expect(connects, "nothing re-redeemed a ticket").toBe(1);
    for (const key of ["storageKey", "claimExistingSessions", "initialCwd"] as const) {
      expect(after[key], `${key} moved under the workspace`).toEqual(before[key]);
    }
    // And the marker says what the renderer was told, which is what the smoke
    // reads back out of the real thing.
    expect(latest().effects).toEqual({ shaderEffect: "ghosttea:crt", animate: false });
  });

  it("holds one effects object still across renders the viewer did not cause", async () => {
    // 0.9.1 canonicalizes equal effect objects behind `workspaceEffectsKey`, so
    // a fresh-object-per-render would still draw correctly — and would still be
    // this component asking the library to clean up after a prop it owns. The
    // memo is on the stored selection; an unrelated rerender must not move it.
    await mountDeck();
    await act(async () => {
      setDeckAppearance({ ...DEFAULT_DECK_APPEARANCE, shaderEffect: "ghosttea:vhs" });
    });
    await settle();
    const chosen = workspaceMounts[workspaceMounts.length - 1]!.effects;

    // A republished bridge state: the deck rerenders and changes nothing else.
    await act(async () => publishStatus?.({ state: "bridge-up" }));
    await settle();

    expect(workspaceMounts[workspaceMounts.length - 1]!.effects).toBe(chosen);
  });

  it("keeps feeding the occlusion gate while an animated shader is on (PF6)", async () => {
    // PF6's mechanism is upstream's — a surface that is not visible schedules
    // zero shader frames, and 0.9.1's own suite proves it for prop-fed effects.
    // What is OURS is the gate's INPUT: `active` is how the workspace learns
    // the overlay closed. A deck that stopped reporting it whenever a shader
    // was on would leave upstream's test passing and VHS animating behind the
    // canvas forever.
    await mountDeck();
    await act(async () => {
      setDeckAppearance({
        ...DEFAULT_DECK_APPEARANCE,
        shaderEffect: "ghosttea:vhs",
        shaderAnimate: true,
      });
    });
    await settle();
    expect(workspaceMounts[workspaceMounts.length - 1]!.active).toBe(true);

    await act(async () => {
      root?.render(<GodviewDeck active={false} theme="light" />);
    });
    await settle();

    const hidden = workspaceMounts[workspaceMounts.length - 1]!;
    expect(hidden.active, "the overlay closed and the workspace was told").toBe(false);
    expect(hidden.effects, "the shader stays selected — it just stops animating").toEqual({
      postProcess: "none",
      shaderEffects: ["ghosttea:vhs"],
      animate: true,
    });
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

  it("names FIELDD when only the control plane refused, and says the shells are alive", async () => {
    // The two-plane law, reported as its opposite (GT-5c). field-native holds
    // the PTYs and outlives fieldd by design, so a fieldd that will not mint a
    // ticket says NOTHING about the sessions — and "the deck could not reach
    // its shell" told a user the exact opposite of the property this product
    // sells. Only the mint speaks to fieldd; everything else is transport.
    // TP-S1: the mint the deck reaches for on an empty floor is `create`, and
    // the roster is what the restore gate asks. Both refused, both fieldd's.
    vi.spyOn(fieldd, "request").mockImplementation(() =>
      Promise.reject(new Error("fieldd is not answering")),
    );
    await mountDeck();

    expect(container?.querySelector(".vf-godview-deck-fault-message")?.textContent).toBe(
      "the deck could not reach fieldd",
    );
    expect(container?.textContent).toContain("fieldd is not answering");
    expect(container?.textContent).toContain("your shells are still running");
    expect(latest().errorPlane).toBe("fieldd");
    vi.mocked(fieldd.request).mockRestore();
  });

  it("names the SHELL when the transport itself refused", async () => {
    // The other side of the same split: a bridge that will not connect, where
    // "could not reach its shell" is the honest sentence.
    installHost();
    const host = getHost();
    setHost({
      ...host,
      terminal: {
        connect: () => Promise.reject(new Error("no bridge on this host")),
        onStatus: host.terminal?.onStatus ?? (() => () => undefined),
      },
    } as unknown as FieldHost);
    await mountDeck();

    expect(container?.querySelector(".vf-godview-deck-fault-message")?.textContent).toBe(
      "the deck could not reach its shell",
    );
    expect(container?.textContent).toContain("no bridge on this host");
    expect(container?.textContent).toContain("unreachable from here");
    expect(latest().errorPlane).toBe("transport");
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
      // The ROSTER is what the gate reads now (TP-D4). A roster this window
      // cannot read is the same class of answer the old unreadable inventory
      // was: no trustworthy list of what is alive, so ask nothing and mount.
      if (method === "terminal.roster") return Promise.reject(new Error("roster unreachable"));
      return Promise.resolve({
        controlSocket: "/x/c.sock",
        frameSocket: "/x/f.sock",
        token: "tok",
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

  it("learns this device's host from a LOCAL pane, because no contract carries one", async () => {
    // The renderer is never told its own hostname — main answers the connect
    // with `defaultShell` and `home` and nothing else — so the comparison
    // `paneCwd` makes needs a value learned from a pane the deck knows is ours.
    await mountDeck();
    const paneMeta = workspaceMounts[0]?.["paneMeta"] as (session: unknown) => unknown;
    paneMeta({ id: "local-1", cwd: "file://Jamess-MacBook.local/Users/jamesyong/src" });
    expect(readDeviceHost()).toBe("jamess-macbook.local");
  });

  it("STAMPS A REPLICA WITH ITS PEER, and that is what refuses the local spawn", async () => {
    // The worst finding of the GT review (2a), closed at the one moment the
    // answer is certain rather than reconstructed from a hostname later. The
    // deck attached this replica; it knows whose it is.
    let door: RemoteSessionDoor | null = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <GodviewDeck
          active
          theme="light"
          onRemoteDoor={(next) => {
            door = next;
          }}
        />,
      );
    });
    await settle();

    // The workspace publishes its context through the sidebar slot, which is
    // the only seam an embedder gets — and the door reads `activeSession` from
    // it, so the attach needs a pane to land in.
    const Sidebar = workspaceMounts[0]?.["sidebar"] as ComponentType<{ workspace: unknown }>;
    const probe = document.createElement("div");
    document.body.appendChild(probe);
    const probeRoot = createRoot(probe);
    await act(async () => {
      probeRoot.render(
        <Sidebar
          workspace={{
            activePaneId: "pane-1",
            activeSession: { id: "local-1", cols: 100, rows: 30 },
            panes: [{ id: "pane-1", session: { id: "local-1" } }],
            sessions: [],
            mountSession: () => undefined,
          }}
        />,
      );
    });
    await settle();

    const outcome = await act(async () =>
      door?.attach({
        deviceId: "studio-mini",
        deviceName: "studio-mini",
        remoteSessionId: "s1",
        color: "#ec4899",
      }),
    );
    expect(outcome).toMatchObject({ state: "attached" });

    const paneMeta = workspaceMounts[0]?.["paneMeta"] as (session: unknown) => unknown;
    const meta = paneMeta({
      id: "replica-studio-mini-s1",
      cwd: "file://studio-mini.local/Users/peer/src",
      title: "zsh",
    });
    expect(meta).toMatchObject({ remoteDevice: "studio-mini" });
    // …and the restore that reads it opens no local shell in a peer's folder.
    expect(paneCwd(meta, readDeviceHost())).toBeNull();
    // A peer's cwd must never be mistaken for this device's own name, either.
    expect(readDeviceHost()).not.toBe("studio-mini.local");

    await act(async () => probeRoot.unmount());
    probe.remove();
  });
});

describe("every birth goes through the product door (TP-S1)", () => {
  it("never reaches for the retired sessionless mint, on any path", async () => {
    // The S1 gate row, from the DECK's seat: whatever the deck does — rejoin a
    // saved pane, create a first one, ask the restore question — it asks fieldd
    // by session and never for a connection with no session in it.
    saveLayout(["alive-1"]);
    floor = [{ sessionId: "alive-1" }];
    await mountDeck();

    expect(requests).not.toContain("terminal.connectTicket");
    // ...and it never reads the TRANSPORT-facing inventory either: that
    // projection carries the cell tag, and a UI may not see placement (TP-L-C).
    expect(requests).not.toContain("terminal.list");
    expect(requests).toContain("terminal.openTicket");
    expect(requests).toContain("terminal.roster");
  });

  it("opens by rejoining a saved pane rather than by creating a new shell", async () => {
    // The restore path's whole point: a window that had panes gets its
    // connection back through one of them, and spawns nothing.
    saveLayout(["alive-1", "alive-2"]);
    floor = [{ sessionId: "alive-1" }, { sessionId: "alive-2" }];
    await mountDeck();

    expect(requests, "a rejoin is not a birth").not.toContain("terminal.create");
    expect(latest().panes).toBe(0); // the stub workspace draws none; the deck asked for none
  });

  it("opens on a session the floor ALREADY has rather than creating beside it", async () => {
    // The stranger case: field-native has been running and this window opens
    // onto it with no saved layout. `claimExistingSessions` is about to claim
    // that session, so creating one here would show two panes where one was
    // wanted — and spawn a shell nobody asked for. The roster is read even
    // though the restore gate had nothing to ask about, precisely so this
    // ordering can hold.
    floor = [{ sessionId: "stranger-1" }];
    await mountDeck();

    expect(requests).toContain("terminal.roster");
    expect(requests, "a session that exists is opened, not duplicated").not.toContain(
      "terminal.create",
    );
    expect(requests).toContain("terminal.openTicket");
    expect(connects).toBe(1);
  });

  it("creates its first session through fieldd when there is nothing to rejoin", async () => {
    // An empty floor and no saved layout: the window has to make a session
    // before it can have a transport at all, and the birth is fieldd's —
    // audited, class-placed, capped — not a create down the control connection.
    floor = [];
    await mountDeck();

    expect(requests).toContain("terminal.create");
    expect(requests).not.toContain("terminal.connectTicket");
    expect(connects, "the create's own ticket opened the bridge").toBe(1);
  });

  it("hands the workspace a birth door, so splits and new panes are fieldd's too", async () => {
    // `createSplitSession` is upstream's ONE birth override, and it serves both
    // `splitActive` and `createSessionInActivePane` (Workspace.js:350, :384) —
    // so supplying it is what puts fieldd in front of every interactive pane
    // birth the user can reach.
    floor = [{ sessionId: "alive-1" }];
    saveLayout(["alive-1"]);
    await mountDeck();

    const props = workspaceMounts[workspaceMounts.length - 1]!;
    const createSplit = props["createSplitSession"] as
      | ((session: unknown) => Promise<{ id: string }>)
      | undefined;
    expect(createSplit, "the door is supplied at all").toBeTypeOf("function");

    const before = requests.filter((method) => method === "terminal.create").length;
    const born = await act(async () => createSplit?.({ id: "alive-1", cwd: null }));
    expect(requests.filter((method) => method === "terminal.create").length).toBe(before + 1);
    // ...and what comes back is the FLOOR's summary for that session, not a
    // shape this renderer invented.
    expect(born?.id).toBe("born-2");
  });

  it("rehydrates a dead pane through fieldd as well", async () => {
    saveLayout(["alive-1", "dead-1"]);
    floor = [{ sessionId: "alive-1" }];
    await mountDeck();
    const restore = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "restore",
    );
    await act(async () => restore?.click());
    await settle();

    const rehydrate = workspaceMounts[0]?.["onRehydratePane"] as
      | ((context: { meta: unknown; sessionId: string; paneId: string }) => Promise<unknown>)
      | undefined;
    expect(rehydrate).toBeTypeOf("function");
    const before = requests.filter((method) => method === "terminal.create").length;
    await act(async () =>
      rehydrate?.({ meta: { cwd: "/repo/api" }, sessionId: "dead-1", paneId: "pane-1" }),
    );
    expect(requests.filter((method) => method === "terminal.create").length).toBe(before + 1);
  });
});

describe("the one-runtime law (GT-3p, GT-D14)", () => {
  // The bug this exists for, found in the smoke and not in review: main posts
  // the two MessagePorts EXACTLY ONCE per attach, and
  // `waitForGhostteaRendererPorts` resolves from a `window` message listener —
  // so two runtimes waiting at the same moment both resolve, with the SAME two
  // ports, and then both drain one control channel. The deck that loses sits at
  // `rendererBackend: "starting"` with no panes, forever. It is not a slow
  // deck; it is a dead one.
  //
  // The rule that prevents it: while a prewarm is in flight, the deck waits for
  // THAT runtime instead of building its own.
  it("builds no runtime of its own while a prewarm is still in flight", async () => {
    // A warm that never settles, so "in flight" is the whole of this case.
    //
    // TP-S1 moved where a warm can be held: it no longer redeems a ticket or
    // forks a bridge, so a slow FLOOR cannot hold one open any more. Its one
    // await is the render device, which is also the honest place for this test
    // to grip — the ports wait the law is about is armed by the runtime, and the
    // runtime is what the device warm belongs to.
    let releaseDevice: (value: { backend: string }) => void = () => undefined;
    deviceWarm = () =>
      new Promise((resolve) => {
        releaseDevice = resolve;
      });
    prewarmTerminalPool(fieldd as never);
    await settle();
    // The prewarm owns a runtime and its ports wait.
    expect(runtimes.length).toBe(1);

    await mountDeck();

    // ...and the deck has NOT built a second one. Before this law it did, and
    // the two of them raced for one port delivery.
    expect(runtimes.length).toBe(1);
    expect(workspaceMounts.length).toBe(0);

    // Let the warm finish: the deck inherits that runtime rather than minting.
    // It lands AFTER the claim, which is the case `adopt` has to get right — a
    // claim that tested the pool's phase instead of its runtime would build a
    // second one on top of a perfectly good one.
    releaseDevice({ backend: "test" });
    await settle();
    expect(runtimes.length).toBe(1);
    expect(terminalPoolSnapshot().phase).toBe("open");
    expect(terminalPoolSnapshot().warm, "the open was inherited, not acquired").toBe(true);
    // ...and the inherited runtime is what the workspace was actually handed.
    expect(workspaceMounts.length).toBeGreaterThan(0);
  });

  it("builds exactly one when no prewarm is pending", async () => {
    expect(terminalPoolSnapshot().phase).toBe("cold");
    await mountDeck();
    expect(runtimes.length).toBe(1);
    expect(terminalPoolSnapshot().warm, "nothing was inherited").toBe(false);
  });
});
