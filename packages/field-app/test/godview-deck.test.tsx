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

import { FielddRpcError } from "@vibefield/fieldd-client";
import { act, type ComponentType, type ReactElement, useSyncExternalStore } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GodviewDeckFacts } from "../src/development-console";
import type { FieldHost } from "../src/host";
import { setHost } from "../src/host";
import type { RendererLogger } from "../src/logging";
import { setRendererLogger } from "../src/logging";
import { bornSummary, routedTicket } from "./routed-terminal-fixture";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every runtime the deck has minted, in order. The storm was a runtime-per-
 * event loop, so counting them IS the assertion. */
const runtimes: Array<{ id: number; disposed: boolean }> = [];
/** What the device warm answers. The prewarm's ONLY await since TP-S1, so it is
 * the only place a warm can be held open. */
let deviceWarm: () => Promise<{ backend: string }> = () => Promise.resolve({ backend: "test" });
/** Every workspace initialization, with the props that decided it. */
const workspaceMounts: Array<Record<string, unknown>> = [];
/** DS-4 — what each provider was handed (the runtime the workspace's surfaces
 * hold), every runtime object the stub minted, and the geometry verbs and focus
 * facts that reached a minted runtime, in order. */
const providerRuntimes: unknown[] = [];
const runtimeObjects: unknown[] = [];
const geometryCalls: unknown[][] = [];
/** DS-4e — the options every runtime was minted with: the routed HOST the pool
 * handed ghosttea rides in them, and a row asks it what the runtime would. */
const runtimeOptionsSeen: Array<{ host?: import("@vibecook/ghosttea-react").GhostteaRoutedHost }> =
  [];
/** DS-4e — the palette's remote opener, which no attach may reach any more. */
const paletteOpens: unknown[][] = [];
/** FR-2 — each session's routed activation as the runtime would answer it
 * (`routedActivation`): the line door's paste asks whether its input is open. */
const routedActivations = new Map<string, { inputAllowed: boolean }>();

vi.mock("@vibecook/ghosttea-react", () => ({
  // QL-2: the deck hands the launch ghosttea's fixed cell metrics.
  CELL_WIDTH: 7.83,
  LINE_HEIGHT: 19,
  ORIGIN_X: 2,
  ORIGIN_Y: 2,
  createGhostteaTerminalRuntime: (options: unknown) => {
    runtimeOptionsSeen.push(options as (typeof runtimeOptionsSeen)[number]);
    const runtime = { id: runtimes.length, disposed: false };
    runtimes.push(runtime);
    const minted = {
      // GT-3p: the real runtime is an EventTarget and the deck listens on it
      // for `renderer-status` (the device-ready mark, and the backend the lab
      // reports). The stub answers the surface without ever firing — a fixture
      // that announced a backend would be asserting about its own stub.
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      // The launcher's gate and the clean-exit handoff ask these of every
      // pane (22e4e16c): this deck's shells never had input and none is a
      // peer's replica.
      sessionHasInput: () => false,
      remoteSession: () => undefined,
      routedActivation: (sessionId: string) => routedActivations.get(sessionId),
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
      registerSession: () => undefined,
      listRemoteHosts: () => Promise.resolve([]),
      openRemoteSession: (deviceId: string, remoteSessionId: string) => {
        paletteOpens.push([deviceId, remoteSessionId]);
        return Promise.resolve({ id: `replica-${deviceId}-${remoteSessionId}`, readWrite: true });
      },
      terminate: () => undefined,
      sessionCreatedHere: () => false,
      // DS-4 — the geometry verbs a surface sends, recorded rather than acted on
      claimResizeControl: (...args: unknown[]) => geometryCalls.push(["claim", ...args]),
      releaseResizeControl: (...args: unknown[]) => geometryCalls.push(["release", ...args]),
      setFocused: (...args: unknown[]) => geometryCalls.push(["focus", ...args]),
    };
    runtimeObjects.push(minted);
    return minted;
  },
  // The one-shot ports wait, as a promise that never settles: in production it
  // resolves when main posts the MessagePorts, and nothing in this fixture
  // posts any. A pending promise is the honest stand-in — the deck must not
  // depend on it having resolved to do any of what is asserted below.
  waitForGhostteaRendererPorts: () => new Promise(() => undefined),
  GhostteaProvider: ({ children, runtime }: { children: unknown; runtime: unknown }) => {
    providerRuntimes.push(runtime);
    return children;
  },
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

const { configureTerminalPool, disposeTerminalPool, prewarmTerminalPool, terminalPoolSnapshot } =
  await import("../src/terminal/pool");
const { GodviewDeck } = await import("../src/godview/GodviewDeck");
// GT-6: the deck reads the window's one fold for the pane frames, so every
// mount here is wrapped in the provider that owns it. With a null door it
// asks nothing and the frames are bare — which is what these cases are about.
const { GodviewAgentsProvider } = await import("../src/godview/monitor/GodviewAgentsProvider");
const { paneCwd, readDeviceHost } = await import("../src/godview/deck-restore");
type RemoteSessionDoor = import("../src/godview/monitor/remote-door").RemoteSessionDoor;
const { getGodviewLineDoor } = await import("../src/frame/line-door");
const { publishDeckWrapperFacts, resetDeckWrapperFactsForTest } = await import(
  "../src/godview/deck-wrapper-witness"
);
type LineViewDoor = import("../src/frame/line-door").LineViewDoor;
const { DEFAULT_DECK_APPEARANCE, resetDeckAppearanceForTest, setDeckAppearance } = await import(
  "../src/godview/deck-appearance"
);

const DECK_STORAGE_KEY = "vf-godview-deck-v1";

/** The deck's own marker, which is also how the smoke reads it. Asserting
 * through the marker rather than through the DOM keeps this fixture and the
 * smoke pointed at the same statement of what the deck is. */
let markers: GodviewDeckFacts[] = [];
/** What `terminal.list` answers. Set per test; the restore gate reads it. */
let floor: Array<{ sessionId: string }> = [];
let requests: string[] = [];
/** DS-4e — every request with its params, in order. */
let calls: Array<[string, unknown]> = [];
/** DS-4e — ANOTHER desktop's floor, as its daemon answers `terminal.sessions
 * {device}` through this window's (the owner's exact summaries), by device. */
let ownerFloors: Record<string, unknown[]> = {};
/** DS-4e — what a mint forwarded to the owner answers (this daemon re-homed
 * the owner's doors onto a loopback pair before the window sees them). */
let ownerMint: (device: string, sessionId: string) => Promise<unknown> = () =>
  Promise.reject(new Error("no owner mint scripted"));
/** DS-4e — the roster the door's `device.subscribe` answers, and the push of a
 * later list onto the standing subscription. */
let rosterList: unknown[] = [];
let pushRoster: ((devices: unknown[]) => void) | null = null;
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
    godview: { set: () => Promise.resolve({ open: false }), onState: () => () => undefined },
  } as unknown as FieldHost);
}

// TP-S3e: the fixture floor answers the ROUTED contract — doors + grants, and
// create carries the REQUIRED birth summary. Both live in
// `routed-terminal-fixture.ts` since GT-6, because the pane-frame fixture
// beside this one asks the same floor the same questions.

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
    calls.push([method, params]);
    // DS-4e — a call routed to ANOTHER desktop: its daemon's answers
    const device = (params as { device?: unknown } | undefined)?.device;
    if (typeof device === "string") {
      if (method === "terminal.sessions") {
        return Promise.resolve({ sessions: ownerFloors[device] ?? [] });
      }
      if (method === "terminal.openTicket") {
        return ownerMint(device, (params as { sessionId: string }).sessionId);
      }
      return Promise.reject(new Error(`unexpected routed method ${method}`));
    }
    if (method === "terminal.openTicket") {
      const sessionId = (params as { sessionId: string }).sessionId;
      if (!floor.some((row) => row.sessionId === sessionId)) {
        return Promise.reject(new Error(`NOT_FOUND: ${sessionId} is not observed`));
      }
      return Promise.resolve(routedTicket(sessionId));
    }
    if (method === "terminal.create") {
      const sessionId = `born-${floor.length + 1}`;
      floor = [...floor, { sessionId }];
      // SB-2: a bound create is answered with the set fieldd applied
      const profileSet = (params as { profileSet?: string } | undefined)?.profileSet;
      return Promise.resolve({
        sessionId,
        session: bornSummary(sessionId),
        ...routedTicket(sessionId),
        ...(profileSet !== undefined ? { profileSet } : {}),
      });
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
  // DS-3/DS-4e — the roster the door reads (`device.subscribe`): a snapshot,
  // then whatever list a row pushes onto the standing subscription
  subscribe: (
    method: string,
    _params: unknown,
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<{ snapshot: unknown; unsubscribe: () => void }> => {
    if (method !== "device.subscribe") {
      return Promise.reject(new Error(`unexpected subscription ${method}`));
    }
    pushRoster = (devices) => onEvent(devices, "delta");
    return Promise.resolve({
      snapshot: rosterList,
      unsubscribe: () => {
        pushRoster = null;
      },
    });
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
    root?.render(
      <GodviewAgentsProvider door={null}>
        <GodviewDeck active theme={theme} />
      </GodviewAgentsProvider>,
    );
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
  providerRuntimes.length = 0;
  runtimeObjects.length = 0;
  geometryCalls.length = 0;
  markers = [];
  resetDeckWrapperFactsForTest();
  requests = [];
  calls = [];
  ownerFloors = {};
  ownerMint = () => Promise.reject(new Error("no owner mint scripted"));
  rosterList = [];
  pushRoster = null;
  runtimeOptionsSeen.length = 0;
  paletteOpens.length = 0;
  routedActivations.clear();
  floor = [];
  deviceWarm = () => Promise.resolve({ backend: "test" });
  localStorage.clear();
  resetDeckAppearanceForTest();
  // TP-S0b: the pool is a per-WINDOW module singleton, so a case that opened or
  // warmed one would otherwise hand the next case a transport it never asked
  // for — and the bridge subscription that came with it.
  disposeTerminalPool();
  // TP-S3e: main's bootstrap is how a window learns it has terminals at all —
  // the routed literal plus the shell policy that used to ride the bridge.
  configureTerminalPool({ transport: "routed", defaultShell: "/bin/zsh", home: "/home/tester" });
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
    expect(workspaceMounts.length).toBeGreaterThan(0);
  });

  it("says the wrapper's facts on its marker, and says them again when they move — with no render of the deck (round 3)", async () => {
    await mountDeck();
    // a deck in no stage that measures it says nothing of a wrapper
    expect(latest().wrapper).toBeUndefined();
    const mounts = workspaceMounts.length;
    const said = markers.length;
    const last = latest();

    // the window's stage measures its own wrapper (`deck-wrapper-witness.ts`)
    // and the deck's line carries what it says
    act(() => publishDeckWrapperFacts({ state: "up", top: 320, bodyResizes: 0 }));
    expect(markers).toHaveLength(said + 1);
    expect(latest()).toEqual({ ...last, wrapper: { state: "up", top: 320, bodyResizes: 0 } });
    // each change of the body's box is one more line, the count only growing
    act(() => publishDeckWrapperFacts({ state: "up", top: 320, bodyResizes: 1 }));
    expect(markers).toHaveLength(said + 2);
    expect(latest().wrapper?.bodyResizes).toBe(1);
    // a publish that moved nothing says nothing
    act(() => publishDeckWrapperFacts({ state: "up", top: 320, bodyResizes: 1 }));
    expect(markers).toHaveLength(said + 2);
    // none of it rendered the deck: the workspace was handed nothing new
    expect(workspaceMounts).toHaveLength(mounts);
    // the stage going away takes the facts off the line
    act(() => publishDeckWrapperFacts(null));
    expect(latest().wrapper).toBeUndefined();
  });

  // ("recovers on the transition — the storm" RETIRED at TP-S3e: its subject
  // was main's bridge-status channel, which died with the bridge. The pool's
  // user-facing recovery door (retryTerminalPool → one replacement runtime) is
  // covered in the pool suites; per-activation recovery is G23's, upstream.)

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
    expect(latest().effects).toEqual({ shaderEffect: null, shaderEffects: [], animate: false });
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
        shaderEffects: ["ghosttea:crt"],
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
    for (const key of ["storageKey", "claimExistingSessions", "initialCwd"] as const) {
      expect(after[key], `${key} moved under the workspace`).toEqual(before[key]);
    }
    // And the marker says what the renderer was told, which is what the smoke
    // reads back out of the real thing.
    expect(latest().effects).toEqual({
      shaderEffect: "ghosttea:crt",
      shaderEffects: ["ghosttea:crt"],
      animate: false,
    });
  });

  it("holds one effects object still across renders the viewer did not cause", async () => {
    // 0.9.1 canonicalizes equal effect objects behind `workspaceEffectsKey`, so
    // a fresh-object-per-render would still draw correctly — and would still be
    // this component asking the library to clean up after a prop it owns. The
    // memo is on the stored selection; an unrelated rerender must not move it.
    await mountDeck();
    await act(async () => {
      setDeckAppearance({ ...DEFAULT_DECK_APPEARANCE, shaderEffects: ["ghosttea:vhs"] });
    });
    await settle();
    const chosen = workspaceMounts[workspaceMounts.length - 1]!.effects;

    // An unrelated re-render (same props): the deck must change nothing else.
    await act(async () => {
      root?.render(
        <GodviewAgentsProvider door={null}>
          <GodviewDeck active theme="light" />
        </GodviewAgentsProvider>,
      );
    });
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
        shaderEffects: ["ghosttea:vhs"],
        shaderAnimate: true,
      });
    });
    await settle();
    expect(workspaceMounts[workspaceMounts.length - 1]!.active).toBe(true);

    await act(async () => {
      root?.render(
        <GodviewAgentsProvider door={null}>
          <GodviewDeck active={false} theme="light" />
        </GodviewAgentsProvider>,
      );
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
    // TP-S3e: the fault that spends a runtime is driven through the birth
    // door; GT-2b's retry has to build a NEW runtime, not re-ask on the corpse.
    floor = [{ sessionId: "alive-1" }];
    saveLayout(["alive-1"]);
    await mountDeck();
    expect(runtimes).toHaveLength(1);
    const props = workspaceMounts[workspaceMounts.length - 1]!;
    const createSplit = props["createSplitSession"] as (session: unknown) => Promise<unknown>;
    vi.spyOn(fieldd, "request").mockImplementation(() =>
      Promise.reject(new Error("fieldd is not answering")),
    );
    await act(async () => {
      await createSplit({ id: "alive-1", cwd: null }).catch(() => undefined);
    });
    await settle();
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
    // TP-S3e: a bare routed mount mints nothing, so the fieldd refusal is
    // driven through the one mint the deck still fronts — the birth door.
    floor = [{ sessionId: "alive-1" }];
    saveLayout(["alive-1"]);
    await mountDeck();
    const props = workspaceMounts[workspaceMounts.length - 1]!;
    const createSplit = props["createSplitSession"] as (session: unknown) => Promise<unknown>;
    vi.spyOn(fieldd, "request").mockImplementation(() =>
      Promise.reject(new Error("fieldd is not answering")),
    );
    await act(async () => {
      await createSplit({ id: "alive-1", cwd: null }).catch(() => undefined);
    });
    await settle();

    expect(container?.querySelector(".vf-godview-deck-fault-message")?.textContent).toBe(
      "the deck could not reach fieldd",
    );
    expect(container?.textContent).toContain("fieldd is not answering");
    expect(container?.textContent).toContain("your shells are still running");
    expect(latest().errorPlane).toBe("fieldd");
    vi.mocked(fieldd.request).mockRestore();
  });

  // ("names the SHELL when the transport itself refused" RETIRED at TP-S3e:
  // its mechanism was the bridge host's connect() rejecting, and the bridge is
  // gone. The transport-plane fault face is exercised by the pool's own tests;
  // the fieldd-plane sibling above keeps the deck's fault-face machinery
  // proven here.)
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

  it("STAMPS A REMOTE PANE WITH ITS PEER, and that is what refuses the local spawn", async () => {
    // The worst finding of the GT review (2a), closed at the one moment the
    // answer is certain rather than reconstructed from a hostname later. The
    // deck attached this session; it knows whose it is. DS-4e: the pane holds
    // the OWNER's own session — its id and its summary, read from the owner —
    // where ghosttea's palette used to hand back a local replica.
    ownerFloors = {
      "studio-mini": [
        bornSummary("s1", {
          handle: "41",
          cwd: "file://studio-mini.local/Users/peer/src",
          title: "zsh",
        }),
      ],
    };
    const store = workspaceProbe({
      panes: [{ id: "pane-1", session: { id: "local-1", cols: 100, rows: 30 } }],
      activePaneId: "pane-1",
    });
    const { door, dispose } = await mountDeckWithDoor(store);

    const outcome = await act(async () =>
      door.attach({
        deviceId: "studio-mini",
        deviceName: "studio-mini",
        remoteSessionId: "s1",
      }),
    );
    expect(outcome).toMatchObject({ state: "attached", sessionId: "s1" });

    const paneMeta = workspaceMounts[0]?.["paneMeta"] as (session: unknown) => unknown;
    const meta = paneMeta({
      id: "s1",
      cwd: "file://studio-mini.local/Users/peer/src",
      title: "zsh",
    });
    expect(meta).toMatchObject({ remoteDevice: "studio-mini" });
    // …and the restore that reads it opens no local shell in a peer's folder.
    expect(paneCwd(meta, readDeviceHost())).toBeNull();
    // A peer's cwd must never be mistaken for this device's own name, either.
    expect(readDeviceHost()).not.toBe("studio-mini.local");

    await dispose();
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
    expect(requests).toContain("terminal.roster");
  });

  it("publishes the floor's live PTYs beside its panes (GT-6b)", async () => {
    // The monitor's terminal rows were the deck's PANES and nothing else, so a
    // session the deck displaced — James's 2026-09-13 shell — left the roster
    // while the floor still held it. The deck now hands the monitor the floor's
    // own list too, placement-free (`terminal.roster`, TP-D4), and the monitor
    // keeps the ones no pane is showing.
    saveLayout(["alive-1"]);
    floor = [{ sessionId: "alive-1" }, { sessionId: "alive-2" }];
    const published: Array<{
      sessionIds: readonly string[];
      floor?: readonly { sessionId: string; workloadClass: string }[];
    }> = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <GodviewAgentsProvider door={null}>
          <GodviewDeck active theme="light" onPanes={(facts) => published.push(facts)} />
        </GodviewAgentsProvider>,
      );
    });
    await settle();

    const last = published[published.length - 1];
    expect(last, "the deck publishes its facts at all").toBeDefined();
    // The stub workspace draws no panes, which is exactly the state the old
    // projection had no answer for: nothing in a pane, two PTYs alive.
    expect(last?.sessionIds).toEqual([]);
    expect(last?.floor?.map((row) => row.sessionId)).toEqual(["alive-1", "alive-2"]);
    expect(last?.floor?.every((row) => row.workloadClass === "interactive")).toBe(true);
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

    // TP-S3e: a bare routed mount asks fieldd NOTHING — no roster (there is no
    // saved layout to gate), no mint, and above all no create. The stranger is
    // claimed by ghosttea's own claimExistingSessions against the SHARED
    // session registry (G22), which the packaged direct proof exercises.
    expect(requests, "a session that exists is claimed, never duplicated").not.toContain(
      "terminal.create",
    );
    expect(requests).toEqual([]);
  });

  // ("creates its first session through fieldd when there is nothing to
  // rejoin" RETIRED at TP-S3e: the empty-workspace birth moved into G23's own
  // initialization through the pool's create adapter (TP-S3-production), so a
  // bare deck mount mints nothing — the birth-door row below is the living
  // witness that every birth goes through fieldd.)

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

  it("asks a bound relaunch again while fieldd cannot read its profiles yet, and drops one whose set is gone — never unbound (SB-3)", async () => {
    saveLayout(["alive-1", "dead-1"]);
    floor = [{ sessionId: "alive-1" }];
    await mountDeck();
    const restore = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "restore",
    );
    await act(async () => restore?.click());
    await settle();
    const answer = fieldd.request;
    let refuse: "for-now" | "gone" = "for-now";
    let refusals = 2;
    const calls = vi
      .spyOn(fieldd, "request")
      .mockImplementation((method: string, params?: unknown): Promise<unknown> => {
        if (method === "terminal.create" && refusals > 0) {
          refusals -= 1;
          return Promise.reject(
            refuse === "for-now"
              ? new FielddRpcError(
                  "UNAVAILABLE",
                  "Agent Profiles cannot be read right now",
                  true,
                  { service: "agents", state: "runtime-unavailable", set: "work" },
                  -32004,
                )
              : new FielddRpcError(
                  "NOT_FOUND",
                  "that profile no longer exists",
                  false,
                  { set: "work" },
                  -32001,
                ),
          );
        }
        return answer(method, params);
      });
    const created = (): unknown[] =>
      calls.mock.calls.filter(([method]) => method === "terminal.create").map(([, p]) => p);
    const rehydrate = workspaceMounts[0]?.["onRehydratePane"] as (context: {
      meta: unknown;
      sessionId: string;
      paneId: string;
    }) => Promise<{ id: string } | null>;
    const bound = { cwd: "/repo/api", workloadClass: "interactive", profileSet: "work" };
    let born: { id: string } | null = null;
    // the startup race: refused for now twice, then born under Work
    await act(async () => {
      born = await rehydrate({
        meta: { cwd: "/repo/api", profileSet: "work" },
        sessionId: "dead-1",
        paneId: "pane-1",
      });
    });
    expect(born).not.toBeNull();
    expect(created()).toEqual([bound, bound, bound]);
    // a set deleted since is the answer: asked once, and the pane goes
    refuse = "gone";
    refusals = 1;
    await act(async () => {
      born = await rehydrate({
        meta: { cwd: "/repo/api", profileSet: "work" },
        sessionId: "dead-1",
        paneId: "pane-1",
      });
    });
    expect(born).toBeNull();
    expect(created()).toHaveLength(4);
    // the retry is the bound relaunch's: an unbound one is not asked again
    refuse = "for-now";
    refusals = 1;
    await act(async () => {
      born = await rehydrate({ meta: { cwd: "/repo/api" }, sessionId: "dead-1", paneId: "pane-1" });
    });
    expect(born).toBeNull();
    expect(created()).toHaveLength(5);
    expect(created().at(-1)).toEqual({ cwd: "/repo/api", workloadClass: "interactive" });
    calls.mockRestore();
  });

  it("relaunches a pane under the Agent Profile its meta names, and the relaunched shell's meta names it again (SB-3)", async () => {
    saveLayout(["alive-1", "dead-1"]);
    floor = [{ sessionId: "alive-1" }];
    await mountDeck();
    const restore = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent === "restore",
    );
    await act(async () => restore?.click());
    await settle();
    const calls = vi.spyOn(fieldd, "request");
    const created = (): unknown[] =>
      calls.mock.calls.filter(([method]) => method === "terminal.create").map(([, p]) => p);
    const rehydrate = workspaceMounts[0]?.["onRehydratePane"] as (context: {
      meta: unknown;
      sessionId: string;
      paneId: string;
    }) => Promise<{ id: string } | null>;
    let born: { id: string } | null = null;
    await act(async () => {
      born = await rehydrate({
        meta: { cwd: "/repo/api", profileSet: "work" },
        sessionId: "dead-1",
        paneId: "pane-1",
      });
    });
    expect(created()).toEqual([
      { cwd: "/repo/api", workloadClass: "interactive", profileSet: "work" },
    ]);
    const paneMeta = workspaceMounts[0]?.["paneMeta"] as (session: unknown) => unknown;
    expect(paneMeta({ id: (born as { id: string } | null)?.id, cwd: "/repo/api" })).toEqual({
      cwd: "/repo/api",
      profileSet: "work",
    });
    // A set id the contract does not admit never reaches fieldd: the viewer's
    // storage holds the layout, and a relaunch is not the place to trust it.
    await act(async () => {
      await rehydrate({
        meta: { cwd: "/repo/api", profileSet: "Not a set!" },
        sessionId: "dead-1",
        paneId: "pane-1",
      });
    });
    expect(created().at(-1)).toEqual({ cwd: "/repo/api", workloadClass: "interactive" });
    calls.mockRestore();
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
    // TP-S3e: an empty routed deck RESTS — dormant, not open; open arrives
    // with the first pane's activation.
    expect(terminalPoolSnapshot().phase).toBe("dormant");
    expect(terminalPoolSnapshot().warm, "the mount was inherited, not acquired").toBe(true);
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

/** A pane in the probe workspace below. */
interface ProbePane {
  id: string;
  /** a born session keeps the floor's whole summary (the deck reads its
   * `activity` when it tends the shells it birthed) */
  session: { id: string; cols: number; rows: number; [fact: string]: unknown };
}

/**
 * The workspace the door actually talks to, with a memory of the order it was
 * driven in (AR-4b).
 *
 * ghosttea's context is the collaborator here, and the fixture reproduces the
 * two properties the replacing mount is built around: `mountSession` lands in
 * whatever pane is ACTIVE at the moment it is called, and an activation is
 * observable only a turn later, through the ref the deck re-reads rather than
 * through the object it was handed. A probe whose mount chose its own pane
 * could not fail the way production did — a resumed agent landing in whichever
 * pane the user happened to be sitting in.
 *
 * GV-D4 — and ghosttea's own SPLIT of the active pane, as its `addSession`
 * and `splitActive` make one (Workspace.tsx at the pin): a session a pane
 * already shows is activated; any other gets a new pane to the RIGHT of the
 * active one, which becomes the active one. The two births (`splitActive`,
 * `createSessionInActivePane`) go through the deck's own `createSplitSession`
 * override, called first and synchronously, as upstream calls it.
 */
function workspaceProbe(initial: {
  panes: readonly ProbePane[];
  activePaneId: string;
  /** false = a pane that never takes focus, so the activation never commits */
  activatable?: boolean;
}) {
  let panes: readonly ProbePane[] = [...initial.panes];
  let activePaneId: string | undefined = initial.activePaneId;
  let version = 0;
  /** panes a split has made, named in order: `beside-1`, `beside-2` */
  let made = 0;
  const listeners = new Set<() => void>();
  /** every verb the door drove, in order: `activate:<session>` · `mount:<session>`
   * · `add:<session>` · `split:<session>` · `create:<session>` */
  const log: string[] = [];
  const changed = (): void => {
    version += 1;
    for (const listener of listeners) listener();
  };
  const mountInActive = (session: { id: string }): void => {
    panes = panes.map((pane) =>
      pane.id === activePaneId ? { ...pane, session: { ...pane.session, ...session } } : pane,
    );
    changed();
  };
  const splitActivePane = (session: { id: string }): void => {
    const existing = panes.find((pane) => pane.session.id === session.id);
    if (existing !== undefined) {
      activePaneId = existing.id;
      changed();
      return;
    }
    made += 1;
    const next: ProbePane = { id: `beside-${made}`, session: { cols: 100, rows: 30, ...session } };
    const at = panes.findIndex((pane) => pane.id === activePaneId);
    panes = [...panes.slice(0, at + 1), next, ...panes.slice(at + 1)];
    activePaneId = next.id;
    changed();
  };
  /** A birth through the deck's own override — fieldd's `terminal.create`. */
  const born = async (): Promise<{ id: string } | undefined> => {
    const create = workspaceMounts[workspaceMounts.length - 1]?.["createSplitSession"] as (
      session: unknown,
      axis: "horizontal" | "vertical",
    ) => Promise<{ id: string }>;
    const active = panes.find((pane) => pane.id === activePaneId);
    if (active === undefined) return undefined;
    try {
      return await create({ ...active.session, cwd: null }, "horizontal");
    } catch {
      return undefined; // upstream swallows the override's throw
    }
  };
  return {
    log,
    get panes(): readonly ProbePane[] {
      return panes;
    },
    get activePaneId(): string | undefined {
      return activePaneId;
    },
    /** the pane showing this session, if one is */
    paneOf(sessionId: string): string | undefined {
      return panes.find((pane) => pane.session.id === sessionId)?.id;
    },
    /** what this pane is showing */
    showing(paneId: string): string | undefined {
      return panes.find((pane) => pane.id === paneId)?.session.id;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getVersion(): number {
      return version;
    },
    mountSession(session: { id: string }): void {
      log.push(`mount:${session.id}`);
      mountInActive(session);
    },
    addSession(session: { id: string }): void {
      log.push(`add:${session.id}`);
      splitActivePane(session);
    },
    async splitActive(): Promise<{ id: string } | undefined> {
      const session = await born();
      if (session === undefined) return undefined;
      log.push(`split:${session.id}`);
      splitActivePane(session);
      return session;
    },
    async createSessionInActivePane(): Promise<{ id: string } | undefined> {
      const session = await born();
      if (session === undefined) return undefined;
      log.push(`create:${session.id}`);
      mountInActive(session);
      return session;
    },
    activateSession(sessionId: string): void {
      log.push(`activate:${sessionId}`);
      if (initial.activatable === false) return;
      const pane = panes.find((candidate) => candidate.session.id === sessionId);
      if (pane === undefined) return;
      activePaneId = pane.id;
      changed();
    },
  };
}

type WorkspaceProbe = ReturnType<typeof workspaceProbe>;

/** The probe rendered THROUGH the deck's own sidebar slot — the only seam an
 * embedder gets, and where the door reads its context from. */
function ProbeSidebar({
  store,
  Sidebar,
}: {
  store: WorkspaceProbe;
  Sidebar: ComponentType<{ workspace: unknown }>;
}): ReactElement {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return (
    <Sidebar
      workspace={{
        activePaneId: store.activePaneId,
        activeSession: store.panes.find((pane) => pane.id === store.activePaneId)?.session,
        panes: store.panes,
        sessions: [],
        mountSession: store.mountSession,
        activateSession: store.activateSession,
        addSession: store.addSession,
        splitActive: store.splitActive,
        createSessionInActivePane: store.createSessionInActivePane,
      }}
    />
  );
}

/** The deck, its door, and a workspace that answers — the three things a mount
 * needs. Returns the door and the teardown for the probe's own root. */
async function mountDeckWithDoor(
  store: WorkspaceProbe,
): Promise<{ door: RemoteSessionDoor; dispose: () => Promise<void> }> {
  const captured: { door: RemoteSessionDoor | null } = { door: null };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <GodviewAgentsProvider door={null}>
        <GodviewDeck
          active
          theme="light"
          onRemoteDoor={(next) => {
            captured.door = next;
          }}
        />
      </GodviewAgentsProvider>,
    );
  });
  await settle();

  const Sidebar = workspaceMounts[0]?.["sidebar"] as ComponentType<{ workspace: unknown }>;
  const probe = document.createElement("div");
  document.body.appendChild(probe);
  const probeRoot = createRoot(probe);
  await act(async () => {
    probeRoot.render(<ProbeSidebar store={store} Sidebar={Sidebar} />);
  });
  await settle();

  const door = captured.door;
  if (door === null) throw new Error("the deck never handed a door over");
  return {
    door,
    dispose: async () => {
      await act(async () => probeRoot.unmount());
      probe.remove();
    },
  };
}

describe("the door's local mount, and the pane a replacement belongs in (AR-4 · AR-4b)", () => {
  it("lands a replacement in the pane that held the replaced PTY, and gives the user their pane back", async () => {
    // THE POINT OF `replacing`. The user is in pane-1; the resumed run's old
    // PTY is in pane-2. A mount that took the active pane would put a stranger
    // in front of the user and leave the dead terminal where it was.
    const store = workspaceProbe({
      panes: [
        { id: "pane-1", session: { id: "user-pty", cols: 100, rows: 30 } },
        { id: "pane-2", session: { id: "old-pty", cols: 100, rows: 30 } },
      ],
      activePaneId: "pane-1",
    });
    floor = [...floor, { sessionId: "new-pty" }];
    const { door, dispose } = await mountDeckWithDoor(store);

    const outcome = await act(async () => door.mountLocal("new-pty", { replacing: "old-pty" }));

    expect(outcome).toEqual({ state: "mounted", sessionId: "new-pty" });
    expect(store.showing("pane-2"), "the replacement missed the pane it belonged in").toBe(
      "new-pty",
    );
    expect(store.showing("pane-1"), "the user's pane was taken").toBe("user-pty");
    // …and the user is back where they were: the hand-over borrowed the focus,
    // it did not keep it.
    expect(store.activePaneId).toBe("pane-1");
    expect(store.log).toEqual(["activate:old-pty", "mount:new-pty", "activate:user-pty"]);

    await dispose();
  });

  it("refuses when no pane shows the replaced PTY, and mounts nothing", async () => {
    // The row the fold cannot know about: the user closed that pane while the
    // resume was in flight. There is no pane to hand the new terminal to, and
    // the active one is NOT a substitute.
    const store = workspaceProbe({
      panes: [{ id: "pane-1", session: { id: "user-pty", cols: 100, rows: 30 } }],
      activePaneId: "pane-1",
    });
    floor = [...floor, { sessionId: "new-pty" }];
    const { door, dispose } = await mountDeckWithDoor(store);

    const outcome = await act(async () => door.mountLocal("new-pty", { replacing: "gone-pty" }));

    expect(outcome).toEqual({
      state: "failed",
      reason: "no pane shows the replaced terminal any more",
    });
    expect(store.log, "something was mounted anyway").toEqual([]);
    expect(store.showing("pane-1")).toBe("user-pty");

    await dispose();
  });

  it("refuses when the pane holding the replaced PTY never takes focus, and still mounts nothing", async () => {
    // The second refusal, and the one with teeth: the pane EXISTS, so the door
    // gets past the lookup, but the workspace never commits the activation. The
    // mount must not fall through into whichever pane the user is in — which is
    // exactly what an unchecked `activateSession` would have done.
    const store = workspaceProbe({
      panes: [
        { id: "pane-1", session: { id: "user-pty", cols: 100, rows: 30 } },
        { id: "pane-2", session: { id: "old-pty", cols: 100, rows: 30 } },
      ],
      activePaneId: "pane-1",
      activatable: false,
    });
    floor = [...floor, { sessionId: "new-pty" }];
    const { door, dispose } = await mountDeckWithDoor(store);

    const outcome = await act(async () => door.mountLocal("new-pty", { replacing: "old-pty" }));

    expect(outcome).toEqual({
      state: "failed",
      reason: "the pane showing the replaced terminal could not be activated",
    });
    expect(store.log.filter((entry) => entry.startsWith("mount:"))).toEqual([]);
    expect(store.showing("pane-1"), "the replacement fell into the user's pane").toBe("user-pty");
    expect(store.showing("pane-2")).toBe("old-pty");
    // the user's own pane is handed back even on the refusal
    expect(store.log.at(-1)).toBe("activate:user-pty");

    await dispose();
  });

  it("serializes two replacements: the second activation waits for the first mount (AR-4b)", async () => {
    // One fold frame can carry two resumed runs. Unserialized, the second
    // activation lands between the first's activation and its mount — and the
    // first replacement is then mounted into the SECOND's pane, because
    // `mountSession` writes wherever the focus has got to.
    const store = workspaceProbe({
      panes: [
        { id: "pane-1", session: { id: "user-pty", cols: 100, rows: 30 } },
        { id: "pane-2", session: { id: "old-a", cols: 100, rows: 30 } },
        { id: "pane-3", session: { id: "old-b", cols: 100, rows: 30 } },
      ],
      activePaneId: "pane-1",
    });
    floor = [...floor, { sessionId: "new-a" }, { sessionId: "new-b" }];
    const { door, dispose } = await mountDeckWithDoor(store);

    // BOTH issued before either has done anything — the setup the ordering
    // assertion below is about. Awaiting the first here would prove nothing:
    // the test would be doing the serializing.
    const first = door.mountLocal("new-a", { replacing: "old-a" });
    const second = door.mountLocal("new-b", { replacing: "old-b" });
    expect(store.log, "the door did work before it was awaited").toEqual([]);
    const outcomes = await act(async () => Promise.all([first, second]));

    expect(outcomes).toEqual([
      { state: "mounted", sessionId: "new-a" },
      { state: "mounted", sessionId: "new-b" },
    ]);
    // each replacement in its OWN pane — the property serialization protects
    expect(store.showing("pane-2")).toBe("new-a");
    expect(store.showing("pane-3")).toBe("new-b");
    expect(store.showing("pane-1")).toBe("user-pty");
    // …and the order says why: nothing of the second's happened until the
    // first's mount had landed.
    expect(store.log.indexOf("activate:old-b")).toBeGreaterThan(store.log.indexOf("mount:new-a"));
    expect(store.log).toEqual([
      "activate:old-a",
      "mount:new-a",
      "activate:user-pty",
      "activate:old-b",
      "mount:new-b",
      "activate:user-pty",
    ]);

    await dispose();
  });

  it("refuses a plain session the floor does not list, and no pane changes hands", async () => {
    // The other half of the door, and the control for the rows below: the same
    // call with a session the floor HAS is placed (GV-D4, the next describe),
    // which is what makes the refusal a statement about the floor's answer
    // rather than about a runtime that was never there.
    const store = workspaceProbe({
      panes: [
        { id: "pane-1", session: { id: "user-pty", cols: 100, rows: 30 } },
        { id: "pane-2", session: { id: "other-pty", cols: 100, rows: 30 } },
      ],
      activePaneId: "pane-1",
    });
    const { door, dispose } = await mountDeckWithDoor(store);

    expect(await act(async () => door.mountLocal("never-born"))).toEqual({
      state: "failed",
      reason: "the floor does not list this session",
    });
    // the refusal is silent in the workspace: no pane changed hands, none came
    expect(store.log).toEqual([]);
    expect(store.panes.map((pane) => pane.id)).toEqual(["pane-1", "pane-2"]);
    expect(store.showing("pane-1")).toBe("user-pty");

    await dispose();
  });
});

// GV-D4 (James, 2026-10-02; DESIGN.md §8, the deck: "A session with no pane").
// Until 2026-10-11 every one of these doors landed in the ACTIVE pane,
// replacing what it showed. The rule itself is `godview-deck-placement.test.ts`;
// these rows are the deck doing each answer with ghosttea's own verbs.
describe("a session with no pane is placed by the rule (GV-D4)", () => {
  const TWO: readonly ProbePane[] = [
    { id: "pane-1", session: { id: "user-pty", cols: 100, rows: 30 } },
    { id: "pane-2", session: { id: "other-pty", cols: 100, rows: 30 } },
  ];
  const THREE: readonly ProbePane[] = [
    ...TWO,
    { id: "pane-3", session: { id: "third-pty", cols: 100, rows: 30 } },
  ];
  const lineDoor = (): LineViewDoor => {
    const door = getGodviewLineDoor();
    if (door === null) throw new Error("the deck published no line door");
    return door;
  };

  it("fewer than three panes: it opens BESIDE the focused pane, which keeps its session", async () => {
    const store = workspaceProbe({ panes: TWO, activePaneId: "pane-1" });
    floor = [...floor, { sessionId: "listed-pty" }];
    const { door, dispose } = await mountDeckWithDoor(store);

    expect(await act(async () => door.mountLocal("listed-pty"))).toEqual({
      state: "mounted",
      sessionId: "listed-pty",
      placement: "beside",
    });
    // ghosttea's own split of the focused pane: the new pane to its right
    expect(store.log).toEqual(["add:listed-pty"]);
    expect(store.panes.map((pane) => [pane.id, pane.session.id])).toEqual([
      ["pane-1", "user-pty"],
      ["beside-1", "listed-pty"],
      ["pane-2", "other-pty"],
    ]);
    // …and it is the focused one now
    expect(store.activePaneId).toBe("beside-1");

    await dispose();
  });

  it("three panes: it takes the FOCUSED pane's place, and no pane is added", async () => {
    const store = workspaceProbe({ panes: THREE, activePaneId: "pane-2" });
    floor = [...floor, { sessionId: "listed-pty" }];
    const { door, dispose } = await mountDeckWithDoor(store);

    expect(await act(async () => door.mountLocal("listed-pty"))).toEqual({
      state: "mounted",
      sessionId: "listed-pty",
      placement: "replace",
    });
    expect(store.log).toEqual(["mount:listed-pty"]);
    expect(store.panes.map((pane) => [pane.id, pane.session.id])).toEqual([
      ["pane-1", "user-pty"],
      ["pane-2", "listed-pty"],
      ["pane-3", "third-pty"],
    ]);
    expect(store.activePaneId).toBe("pane-2");

    await dispose();
  });

  it("four or more panes (made by ⌘D) still replace the focused: the cap is the rule's alone", async () => {
    // ⌘D splits without limit (L4); past three the rule never adds a pane
    const store = workspaceProbe({
      panes: [...THREE, { id: "pane-4", session: { id: "fourth-pty", cols: 100, rows: 30 } }],
      activePaneId: "pane-4",
    });
    floor = [...floor, { sessionId: "listed-pty" }];
    const { door, dispose } = await mountDeckWithDoor(store);

    expect(await act(async () => door.mountLocal("listed-pty"))).toEqual({
      state: "mounted",
      sessionId: "listed-pty",
      placement: "replace",
    });
    expect(store.log).toEqual(["mount:listed-pty"]);
    expect(store.panes).toHaveLength(4);
    expect(store.showing("pane-4")).toBe("listed-pty");
    // …and a new terminal the same
    const born = await act(async () => door.createTerminal());
    expect(born).toMatchObject({ state: "mounted", placement: "replace" });
    expect(store.panes).toHaveLength(4);
    expect(store.showing("pane-4")).toBe((born as { sessionId: string }).sessionId);

    await dispose();
  });

  it("already in a pane: that pane is focused where it is, never mounted twice — and the floor is not asked", async () => {
    // Until GV-D4 a body picked while its session sat in ANOTHER pane was
    // mounted into the active one as well: one PTY in two panes.
    const store = workspaceProbe({ panes: TWO, activePaneId: "pane-1" });
    const { door, dispose } = await mountDeckWithDoor(store);
    const asked = requests.length;

    expect(await act(async () => door.mountLocal("other-pty"))).toEqual({
      state: "mounted",
      sessionId: "other-pty",
      placement: "focus",
    });
    expect(store.log, "the shown session was mounted again").toEqual(["activate:other-pty"]);
    expect(store.activePaneId).toBe("pane-2");
    expect(store.panes.map((pane) => [pane.id, pane.session.id])).toEqual([
      ["pane-1", "user-pty"],
      ["pane-2", "other-pty"],
    ]);
    // a pane shows it, so nothing is read from the floor to place it
    expect(requests.slice(asked)).toEqual([]);

    // …and one already in the FOCUSED pane asks nothing of the workspace either
    expect(await act(async () => door.mountLocal("other-pty"))).toEqual({
      state: "mounted",
      sessionId: "other-pty",
      placement: "focus",
    });
    expect(store.log).toEqual(["activate:other-pty"]);

    await dispose();
  });

  it("a new terminal follows the same rule: beside while fewer than three show, the focused pane's place after", async () => {
    // The door the line's New terminal (⌘T) and the swarm's bloom both use.
    const store = workspaceProbe({
      panes: [{ id: "pane-1", session: { id: "user-pty", cols: 100, rows: 30 } }],
      activePaneId: "pane-1",
    });
    const { door, dispose } = await mountDeckWithDoor(store);

    const first = await act(async () => door.createTerminal());
    expect(first).toMatchObject({ state: "mounted", placement: "beside" });
    const second = await act(async () => door.createTerminal());
    expect(second).toMatchObject({ state: "mounted", placement: "beside" });
    const firstId = (first as { sessionId: string }).sessionId;
    const secondId = (second as { sessionId: string }).sessionId;
    // two births, each ghosttea's own split of the pane that was focused
    expect(store.log).toEqual([`split:${firstId}`, `split:${secondId}`]);
    expect(store.panes.map((pane) => [pane.id, pane.session.id])).toEqual([
      ["pane-1", "user-pty"],
      ["beside-1", firstId],
      ["beside-2", secondId],
    ]);
    expect(store.activePaneId).toBe("beside-2");

    // three show: the third new terminal takes the focused pane's place
    const third = await act(async () => door.createTerminal());
    expect(third).toMatchObject({ state: "mounted", placement: "replace" });
    const thirdId = (third as { sessionId: string }).sessionId;
    expect(store.log.at(-1)).toBe(`create:${thirdId}`);
    expect(store.panes.map((pane) => [pane.id, pane.session.id])).toEqual([
      ["pane-1", "user-pty"],
      ["beside-1", firstId],
      ["beside-2", thirdId],
    ]);
    // every one of them was fieldd's birth
    expect(requests.filter((method) => method === "terminal.create")).toHaveLength(3);

    await dispose();
  });

  it("the line's New terminal and History's Resume say where they landed", async () => {
    const store = workspaceProbe({ panes: TWO, activePaneId: "pane-1" });
    const { dispose } = await mountDeckWithDoor(store);

    // ⌘T with two panes: a third, beside the focused one
    expect(await act(async () => lineDoor().newTerminal())).toEqual({
      state: "opened",
      placement: "beside",
    });
    expect(store.panes).toHaveLength(3);
    expect(store.panes[1]?.id).toBe("beside-1");

    // Resume with three: the resumed agent's terminal takes the focused pane's place
    const terminal = {
      sessionId: "resumed-pty",
      session: bornSummary("resumed-pty"),
      ...routedTicket("resumed-pty"),
    };
    floor = [...floor, { sessionId: "resumed-pty" }];
    expect(await act(async () => lineDoor().place(terminal))).toEqual({
      state: "opened",
      placement: "replace",
    });
    expect(store.panes).toHaveLength(3);
    expect(store.showing("beside-1")).toBe("resumed-pty");

    await dispose();
  });
});

// P3 — History's Jump to reaches the deck through the line's door (the one verb
// it adds there): `reveal` shows the pane a running session is already in, and
// places the session only where no pane shows it (GV-D4's rule, since
// 2026-10-11) — never a second mount.
describe("the line door's reveal, History's Jump to (P3)", () => {
  const lineDoor = (): LineViewDoor => {
    const door = getGodviewLineDoor();
    if (door === null) throw new Error("the deck published no line door");
    return door;
  };

  it("activates the pane already showing the session, and mounts nothing", async () => {
    // The user is in pane-1; the running agent's PTY is in pane-2. Jump to is
    // the pane coming forward — a mount would pull the same PTY into pane-1.
    const store = workspaceProbe({
      panes: [
        { id: "pane-1", session: { id: "user-pty", cols: 100, rows: 30 } },
        { id: "pane-2", session: { id: "agent-pty", cols: 100, rows: 30 } },
      ],
      activePaneId: "pane-1",
    });
    floor = [...floor, { sessionId: "agent-pty" }];
    const { dispose } = await mountDeckWithDoor(store);

    const outcome = await act(async () => lineDoor().reveal("agent-pty"));

    expect(outcome).toEqual({ state: "opened", placement: "focus" });
    expect(store.activePaneId).toBe("pane-2");
    expect(store.log, "the shown session was mounted again").toEqual(["activate:agent-pty"]);
    expect(store.showing("pane-1"), "the user's pane was taken").toBe("user-pty");

    await dispose();
  });

  it("asks nothing of the workspace when the session is already in the active pane", async () => {
    const store = workspaceProbe({
      panes: [{ id: "pane-1", session: { id: "agent-pty", cols: 100, rows: 30 } }],
      activePaneId: "pane-1",
    });
    floor = [...floor, { sessionId: "agent-pty" }];
    const { dispose } = await mountDeckWithDoor(store);

    expect(await act(async () => lineDoor().reveal("agent-pty"))).toEqual({
      state: "opened",
      placement: "focus",
    });
    expect(store.log).toEqual([]);

    await dispose();
  });

  it("places a session no pane shows by the rule, through the door's mount: beside the focused pane", async () => {
    // GV-D4: until 2026-10-11 it took the ACTIVE pane, replacing what it showed.
    const store = workspaceProbe({
      panes: [
        { id: "pane-1", session: { id: "user-pty", cols: 100, rows: 30 } },
        { id: "pane-2", session: { id: "other-pty", cols: 100, rows: 30 } },
      ],
      activePaneId: "pane-1",
    });
    floor = [...floor, { sessionId: "agent-pty" }];
    const { dispose } = await mountDeckWithDoor(store);

    expect(await act(async () => lineDoor().reveal("agent-pty"))).toEqual({
      state: "opened",
      placement: "beside",
    });
    expect(store.showing("pane-1")).toBe("user-pty");
    expect(store.showing("pane-2")).toBe("other-pty");
    expect(store.paneOf("agent-pty")).toBe("beside-1");
    expect(store.activePaneId).toBe("beside-1");
    expect(store.log).toEqual(["add:agent-pty"]);
    // …and one the floor does not list is refused in the door's words
    expect(await act(async () => lineDoor().reveal("never-born"))).toEqual({
      state: "refused",
      reason: "the floor does not list this session",
    });

    await dispose();
  });

  it("refuses when the pane showing the session never takes focus, and mounts nothing", async () => {
    const store = workspaceProbe({
      panes: [
        { id: "pane-1", session: { id: "user-pty", cols: 100, rows: 30 } },
        { id: "pane-2", session: { id: "agent-pty", cols: 100, rows: 30 } },
      ],
      activePaneId: "pane-1",
      activatable: false,
    });
    floor = [...floor, { sessionId: "agent-pty" }];
    const { dispose } = await mountDeckWithDoor(store);

    expect(await act(async () => lineDoor().reveal("agent-pty"))).toEqual({
      state: "refused",
      reason: "the pane showing it could not be made the active one",
    });
    expect(store.log.filter((entry) => entry.startsWith("mount:"))).toEqual([]);
    expect(store.showing("pane-1")).toBe("user-pty");

    await dispose();
  });
});

// FR-2 — the interim send's paste rides the pane's own input, and that input's
// handler claims the paste event whether or not the runtime sent it: while the
// routed activation's input is closed ghosttea drops the paste silently and the
// event still reads as taken. So the door asks the runtime first — a pane that
// would drop the paste is a `false`, and the line copies and says why instead
// of "Pasted into …" (the honest-states rule).
describe("the line door's paste, the interim send (FR-2)", () => {
  const lineDoor = (): LineViewDoor => {
    const door = getGodviewLineDoor();
    if (door === null) throw new Error("the deck published no line door");
    return door;
  };

  /** A pane where ghosttea draws it, under the deck's own element: an input
   * that claims every paste it is handed, as `TerminalSurface`'s does. */
  const drawPane = (paneId: string): { input: HTMLTextAreaElement; pasted: string[] } => {
    const deck = container?.querySelector(".vf-deck-zoom");
    if (deck === null || deck === undefined) throw new Error("the deck drew no zoom host");
    const pane = document.createElement("div");
    pane.setAttribute("data-pane-id", paneId);
    const input = document.createElement("textarea");
    pane.appendChild(input);
    deck.appendChild(pane);
    const pasted: string[] = [];
    input.addEventListener("paste", (event) => {
      pasted.push((event as ClipboardEvent).clipboardData?.getData("text/plain") ?? "");
      event.preventDefault();
    });
    return { input, pasted };
  };

  it("answers false, and hands the pane nothing, while the aimed pane's input is closed", async () => {
    const store = workspaceProbe({
      panes: [{ id: "pane-1", session: { id: "agent-pty", cols: 100, rows: 30 } }],
      activePaneId: "pane-1",
    });
    const { dispose } = await mountDeckWithDoor(store);
    const { input, pasted } = drawPane("pane-1");
    // the pane is back on screen and its activation is still recovering
    routedActivations.set("agent-pty", { inputAllowed: false });

    expect(lineDoor().paste("agent-pty", "run the tests")).toBe(false);
    expect(pasted, "a paste the runtime would drop was handed to the pane").toEqual([]);
    expect(document.activeElement, "a refused paste took the keyboard").not.toBe(input);

    // …and the same pane takes it once its input is open
    routedActivations.set("agent-pty", { inputAllowed: true });
    expect(lineDoor().paste("agent-pty", "run the tests")).toBe(true);
    expect(pasted).toEqual(["run the tests"]);
    expect(document.activeElement).toBe(input);

    await dispose();
  });

  it("answers false for a pane whose session has no routed activation yet", async () => {
    const store = workspaceProbe({
      panes: [{ id: "pane-1", session: { id: "agent-pty", cols: 100, rows: 30 } }],
      activePaneId: "pane-1",
    });
    const { dispose } = await mountDeckWithDoor(store);
    const { pasted } = drawPane("pane-1");

    expect(lineDoor().paste("agent-pty", "run the tests")).toBe(false);
    expect(pasted).toEqual([]);

    await dispose();
  });
});

// DS-4 — DS-D5's note, ruled 2026-09-30: "the latest focused pane takes full
// control include resizing, LWW". The deck is the HOST that asks for the take;
// each surface performs it (ghosttea's `takeGeometryOnFocus`, gt-take).
describe("the deck takes the geometry seat on focus (DS-4)", () => {
  type GeometryVerbs = {
    claimResizeControl(handle: string, viewId: string, cols: number, rows: number): void;
    setFocused(handle: string, viewId: string, focused: boolean, cols: number, rows: number): void;
  };

  it("asks every surface to take on focus, through the workspace", async () => {
    await mountDeck();
    expect(workspaceMounts[workspaceMounts.length - 1]!.takeGeometryOnFocus).toBe(true);
  });

  it("sends no geometry verb of its own: the surfaces hold the runtime itself", async () => {
    // The deck once re-sent a controller's claim on every focus edge for the
    // pinned runtime, which cannot carry overlapping claims (GodviewDeck.tsx
    // says why). This row keeps that road closed.
    await mountDeck();
    expect(providerRuntimes[providerRuntimes.length - 1]).toBe(
      runtimeObjects[runtimeObjects.length - 1],
    );
    const held = providerRuntimes[providerRuntimes.length - 1] as GeometryVerbs;
    held.claimResizeControl("h1", "view-1", 80, 24);
    held.setFocused("h1", "view-1", true, 120, 40);
    expect(geometryCalls).toEqual([
      ["claim", "h1", "view-1", 80, 24],
      ["focus", "h1", "view-1", true, 120, 40],
    ]);
  });
});

// DS-4e (2026-10-01; thinking-desktop-sync-plane.md §6.3) — a terminal on
// ANOTHER desktop, attached from Godview. The deck reads the OWNER's summary
// (`terminal.sessions {device}` — the engine handle a pane mounts by is in no
// other answer, the lead's ruling (B)), places it as any session with no pane
// is (GV-D4: beside the focused pane; until 2026-10-11, in the active one), and from
// there the window's ROUTED HOST asks every ticket of the owner by `device`: the
// answer's doors are the loopback pair this desktop's daemon re-homed, dialled
// as a local cell's. ghosttea's remote palette is not asked at all.
describe("the remote attach rides the routed host (DS-4e)", () => {
  const STUDIO = "dev-studio";
  const LOOPBACK = {
    controlUrl: "ws://127.0.0.1:61234/cell/cell-studio-boot-7/control",
    framesUrl: "ws://127.0.0.1:61234/cell/cell-studio-boot-7/frames",
  };
  const ROSTER_AWAKE = [
    {
      deviceId: "dev-here",
      name: "pro",
      platform: "darwin",
      self: true,
      online: true,
      lastSeenAt: 0,
    },
    {
      deviceId: STUDIO,
      name: "studio",
      platform: "linux",
      self: false,
      online: true,
      lastSeenAt: 0,
      state: "awake",
      link: "dialing",
    },
  ];
  const ownersTicket = (sessionId: string) => ({ ...routedTicket(sessionId), endpoints: LOOPBACK });
  const egress = (): FielddRpcError =>
    new FielddRpcError(
      "UNAVAILABLE",
      "this desktop has no egress route to that desktop's terminal cells yet",
      true,
      { service: "terminal", state: "egress_unavailable", device: STUDIO },
    );
  const routedHost = () => {
    const host = runtimeOptionsSeen.at(-1)?.host;
    if (host === undefined) throw new Error("the pool minted no routed runtime");
    return host;
  };

  /** A pane element where ghosttea would lay one out, under the deck the frames
   * read panes from — put there BEFORE the attach, so the pane change that the
   * attach makes is what finds it (no observer timing). */
  function paneElement(paneId: string): HTMLElement {
    const deck = container?.querySelector<HTMLElement>(".vf-deck-framed");
    if (deck === null || deck === undefined) throw new Error("the deck element is not mounted");
    const pane = document.createElement("div");
    pane.className = "ghostty-pane";
    pane.dataset.paneId = paneId;
    deck.appendChild(pane);
    return pane;
  }

  it("mounts the OWNER's summary, and the host asks its ticket by device — a local pane's ticket stays `{sessionId}`", async () => {
    floor = [{ sessionId: "user-pty" }];
    ownerFloors = { [STUDIO]: [bornSummary("pane-r", { handle: "41" })] };
    ownerMint = (_device, sessionId) => Promise.resolve(ownersTicket(sessionId));
    const store = workspaceProbe({
      panes: [{ id: "pane-1", session: { id: "user-pty", cols: 100, rows: 30 } }],
      activePaneId: "pane-1",
    });
    const { door, dispose } = await mountDeckWithDoor(store);

    const outcome = await act(async () =>
      door.attach({ deviceId: STUDIO, deviceName: "studio", remoteSessionId: "pane-r" }),
    );
    expect(outcome).toEqual({ state: "attached", sessionId: "pane-r", readWrite: true });
    // GV-D4: one pane showing, so the peer's session opens beside it
    expect(store.paneOf("pane-r")).toBe("beside-1");
    expect(store.showing("pane-1")).toBe("user-pty");
    expect(store.activePaneId).toBe("beside-1");
    expect(calls).toContainEqual(["terminal.sessions", { device: STUDIO }]);
    expect(paletteOpens).toEqual([]);

    // the runtime's ask, as ghosttea makes it when the pane mounts
    const ticket = await routedHost().openTicket("pane-r", { reason: "mount" });
    expect(ticket.endpoints).toEqual(LOOPBACK);
    expect(calls).toContainEqual(["terminal.openTicket", { device: STUDIO, sessionId: "pane-r" }]);

    // a session on THIS desktop is asked exactly as it always was
    await routedHost().openTicket("user-pty", { reason: "mount" });
    expect(calls).toContainEqual(["terminal.openTicket", { sessionId: "user-pty" }]);
    await dispose();
  });

  it("an owner that does not list the session is refused in the owner's NAME, and nothing is mounted", async () => {
    ownerFloors = { [STUDIO]: [] };
    const store = workspaceProbe({
      panes: [{ id: "pane-1", session: { id: "user-pty", cols: 100, rows: 30 } }],
      activePaneId: "pane-1",
    });
    const { door, dispose } = await mountDeckWithDoor(store);
    expect(
      await act(async () =>
        door.attach({ deviceId: STUDIO, deviceName: "studio", remoteSessionId: "pane-gone" }),
      ),
    ).toEqual({ state: "failed", reason: "studio does not list that session" });
    expect(store.showing("pane-1")).toBe("user-pty");
    await dispose();
  });

  it("no road yet: the pane says so in the desktop's NAME, asks again ONCE on the roster's next flip for it — never on a timer", async () => {
    ownerFloors = { [STUDIO]: [bornSummary("pane-r", { handle: "41" })] };
    const mints: string[] = [];
    ownerMint = (_device, sessionId) => {
      mints.push(sessionId);
      return mints.length === 1
        ? Promise.reject(egress())
        : Promise.resolve(ownersTicket(sessionId));
    };
    rosterList = ROSTER_AWAKE;
    const store = workspaceProbe({
      panes: [{ id: "pane-1", session: { id: "user-pty", cols: 100, rows: 30 } }],
      activePaneId: "pane-1",
    });
    const { door, dispose } = await mountDeckWithDoor(store);
    // the monitor's ONE roster subscription, held through the door the deck built
    const seen: unknown[] = [];
    const unsubscribe = door.devices?.subscribe((devices) => seen.push(devices));
    await settle();
    expect(seen).toHaveLength(1);
    // the pane the attach is about to open beside the focused one (GV-D4)
    const pane = paneElement("beside-1");

    await act(async () =>
      door.attach({ deviceId: STUDIO, deviceName: "studio", remoteSessionId: "pane-r" }),
    );
    // every timer from the ask on is the test's: none of them may re-ask
    vi.useFakeTimers();
    try {
      let minted: unknown;
      const asking = routedHost()
        .openTicket("pane-r", { reason: "mount" })
        .then((ticket) => {
          minted = ticket;
          return ticket;
        });
      await settle();

      // the honest state, IN the pane, by the roster's name for the desktop
      const face = pane.querySelector(".vf-godview-remote-state");
      expect(face?.getAttribute("role")).toBe("status");
      expect(pane.querySelector(".vf-godview-remote-state-message")?.textContent).toBe(
        "no road to studio yet",
      );
      const detail = pane.querySelector(".vf-godview-remote-state-detail");
      expect(detail?.firstChild?.textContent).toBe(
        "this desktop has no egress route to that desktop's terminal cells yet",
      );
      expect(detail?.querySelector("small")?.textContent).toBe(
        "asks again when studio's status changes",
      );
      expect(pane.textContent).not.toContain(STUDIO);

      // ten minutes pass and nothing is asked — the re-ask is not a timer's
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * 60_000);
      });
      expect(mints).toEqual(["pane-r"]);
      expect(minted).toBeUndefined();

      // the same list again is not a flip; the owner's row moving is
      await act(async () => pushRoster?.(ROSTER_AWAKE));
      expect(mints).toEqual(["pane-r"]);
      await act(async () =>
        pushRoster?.(
          ROSTER_AWAKE.map((device) =>
            device.deviceId === STUDIO ? { ...device, link: "connected" } : device,
          ),
        ),
      );
      await expect(asking).resolves.toMatchObject({ endpoints: LOOPBACK });
      expect(mints).toEqual(["pane-r", "pane-r"]);
      await settle();
      // the road is open: the state leaves the pane
      expect(pane.querySelector(".vf-godview-remote-state")).toBeNull();
      // and the monitor's reader got every list the deck read
      expect(seen).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }

    unsubscribe?.();
    await dispose();
  });
});
