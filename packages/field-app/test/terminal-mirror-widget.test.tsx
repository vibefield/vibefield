/**
 * TP-S2b-widget — THE BUILT-IN TERMINAL MIRROR WIDGET.
 *
 * TPv3 §17 mark 21, RATIFIED 2026-08-22 as (a): the watch-only mirror becomes a
 * BUILT-IN canvas widget TYPE that the host registers OUTSIDE the plugin SDK.
 * Three things have to be true for that sentence to mean anything, and this
 * file is those three:
 *
 *   1. THE CONTRACT — the type is a real manifest-vocabulary contribution that
 *      reaches the registry, the tray and the engine through the HOST'S door,
 *      owns its type against every plugin, and is durable in a document
 *      (`plugins/note/test/manifest.test.ts` is the template for this half).
 *   2. THE DOOR STAYED SHUT — the SDK is unchanged. If this slice had widened
 *      it, third-party surfaces would be inside the terminal trust boundary
 *      (EL7), which is exactly what mark 21 chose (a) over (b) to avoid.
 *   3. TP-R4a STILL HOLDS IN THE WIDGET FORM — "the mirror cannot take input
 *      focus and issues zero geometry claims BY CONSTRUCTION". The surface was
 *      proven that way at TP-S2 (`terminal-mirror.test.tsx`); a widget is a new
 *      HOST for it, with new input plumbing (a card the user drags, an engine
 *      keymap, a picker with real buttons), so the count is taken again here
 *      under the same hostile treatment — against the REAL registered
 *      component, pulled out of the registry rather than imported, so what is
 *      tested is what the canvas would actually mount.
 */

// @vitest-environment happy-dom

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanvasEngine, Entity, WidgetType } from "@vibecook/ice";
import { EngineProvider } from "@vibecook/ice/react";
import { validatePluginManifest, WidgetContribution } from "@vibefield/contracts";
import type { PluginRegistry } from "@vibefield/plugin-runtime";
import { act, type ComponentType, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldHost } from "../src/host";
import { setHost } from "../src/host";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every call the pool's runtime received. The TP-R4a rows read what is NOT
 * here — the same double, and the same reasoning, as `terminal-mirror.test.tsx`:
 * the surface above it is upstream's REAL component, because the hazards this
 * row exists for are upstream's. */
let runtimeCalls: { verb: string; args: readonly unknown[] }[] = [];
let sessions: unknown[] = [];

const SESSION = {
  id: "session-a",
  handle: "handle-a",
  executable: "/bin/zsh",
  cols: 80,
  rows: 24,
  exited: false,
  readWrite: true,
  title: null,
  cwd: null,
  bellCount: 0,
  pid: 42,
  createdAtMs: 0,
  exitCode: null,
  exitSignal: null,
  requestedTermination: null,
  exitOutcome: null,
};

vi.mock("@vibecook/ghosttea-react", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const record =
    (verb: string) =>
    (...args: unknown[]): undefined => {
      runtimeCalls.push({ verb, args });
      return undefined;
    };
  return {
    ...actual,
    waitForGhostteaRendererPorts: () => new Promise(() => undefined),
    createGhostteaTerminalRuntime: () => ({
      connect: () => Promise.resolve(),
      dispose: record("dispose"),
      rendererBackend: "test",
      listSessions: () => {
        runtimeCalls.push({ verb: "listSessions", args: [] });
        return Promise.resolve(sessions);
      },
      sessionMetadata: () => SESSION,
      mount: (...args: unknown[]) => {
        runtimeCalls.push({ verb: "mount", args });
        return { resize: record("mount.resize"), dispose: record("mount.dispose") };
      },
      resize: record("resize"),
      claimResizeControl: record("claimResizeControl"),
      releaseResizeControl: record("releaseResizeControl"),
      setViewInputPolicy: record("setViewInputPolicy"),
      setFocused: record("setFocused"),
      setTheme: record("setTheme"),
      setSelection: record("setSelection"),
      sendKey: record("sendKey"),
      sendText: record("sendText"),
      paste: record("paste"),
      sendMouse: record("sendMouse"),
      scroll: record("scroll"),
      scrollTo: record("scrollTo"),
      interrupt: record("interrupt"),
      terminate: record("terminate"),
      unregisterSession: record("unregisterSession"),
      copySelection: async () => "",
      setVisible: record("setVisible"),
      setEffects: record("setEffects"),
      setSessionPinned: record("setSessionPinned"),
      scrollbar: () => undefined,
      isMouseTracking: () => false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      startPerformanceMeasurement: () => Promise.resolve(),
      finishPerformanceMeasurement: () => Promise.resolve({ backend: "test" }),
    }),
  };
});

vi.mock("@vibecook/ghosttea-react/terminal-render.worker.js?worker", () => ({
  default: class {},
}));

const pool = await import("../src/terminal/pool");
const { buildRegistry, createFieldEngine } = await import("../src/field-engine");
const { buildCatalog } = await import("../src/hud/tray-catalog");
const {
  TERMINAL_BUILT_IN,
  TERMINAL_MIRROR_CONTRIBUTION,
  TERMINAL_MIRROR_TYPE,
  registerBuiltInTerminalWidgets,
} = await import("../src/terminal/widget");

// ── the fake floor ──────────────────────────────────────────────────────────

const ROSTER = [
  { sessionId: "session-a", workloadClass: "agent", health: "live", title: "agent · build" },
  { sessionId: "session-b", workloadClass: "interactive", health: "exited" },
];

let rosterAnswer: () => Promise<unknown> = () => Promise.resolve({ items: ROSTER });

type PoolClient = Parameters<typeof pool.openTerminalPool>[0];
const fieldd = {
  request: (method: string) =>
    method === "terminal.roster"
      ? rosterAnswer()
      : Promise.resolve({ ticket: { token: "t", controlSocket: "c", frameSocket: "f" } }),
} as unknown as PoolClient;

// ── the mount harness ───────────────────────────────────────────────────────

let root: Root | null = null;
let container: HTMLElement | null = null;
let engine: CanvasEngine | null = null;

/** No layout engine here, so the surface's observer is inert unless a test
 * drives it (the resize row installs a driven one). */
class InertResizeObserver {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

/** The registered widget type — what the ENGINE holds, not what the module
 * exports. Every render below goes through this, so the `withBuiltInFace`
 * wrapper and the host-built prefab are inside the test rather than beside it. */
function registeredComponent(registry: PluginRegistry<WidgetType>): ComponentType<{
  entity: Entity;
  world: CanvasEngine["world"];
}> {
  const widget = registry.allWidgets().get(TERMINAL_MIRROR_TYPE);
  if (widget === undefined) throw new Error("the built-in mirror is not registered");
  return widget.component as ComponentType<{ entity: Entity; world: CanvasEngine["world"] }>;
}

/** The DURABLE props as stored in the document — read through the widget type's
 * own group component (the `${type}:props` strata component a group-less
 * contribution rides), not through component state. Persistence claims are
 * about what is in the doc. */
function storedProps(
  registry: PluginRegistry<WidgetType>,
  ce: CanvasEngine,
  entity: Entity,
): Record<string, unknown> | undefined {
  const widget = registry.allWidgets().get(TERMINAL_MIRROR_TYPE);
  const group = widget?.groups.find((g) => g.name === "props");
  if (group === undefined) throw new Error("the mirror has no props group");
  return ce.world.get(entity, group.component) as Record<string, unknown> | undefined;
}

/** Click a control and let the durable write reach the FACE.
 *
 * `ops.setWidgetProps` commits to the DOCUMENT; `useWidgetProps` reads a
 * strata component through the reactive layer, and that layer fires at
 * `notify()` — inside `step()`, once per frame. The app has the DOM package's
 * rAF loop driving that; a headless test has no loop, so the frame is spelled
 * out here. Without it the write lands in the doc and the face never hears
 * about it, which is a missing tick, not a missing subscription. */
async function clickAndProject(
  ce: CanvasEngine,
  control: HTMLElement | null | undefined,
): Promise<void> {
  await act(async () => {
    control?.click();
    await settle();
  });
  await act(async () => {
    ce.step(performance.now());
    await settle();
  });
}

/** Spawn one mirror card on a live document and render the registered
 * component for it, inside the engine provider the canvas provides. */
async function mountWidget(props: Record<string, unknown> = {}): Promise<{
  ce: CanvasEngine;
  entity: Entity;
  registry: PluginRegistry<WidgetType>;
}> {
  const registry = buildRegistry();
  const ce = createFieldEngine(registry);
  engine = ce;
  ce.docs.create();
  const entity = ce.ops.spawnWidget(TERMINAL_MIRROR_TYPE, {
    x: 0,
    y: 0,
    w: 420,
    h: 280,
    undoable: false,
    props,
  });
  ce.world.sync();
  // Warm the LAZY chunk before rendering. `mount.tsx` loads the widget through
  // `React.lazy` on purpose (the registry must not drag the terminal stack in —
  // see the FINDING there), which means the first mount in a process suspends
  // on a dynamic import that no number of microtask flushes can resolve. This
  // awaits the module the same way the browser eventually would; what the rows
  // below measure is the widget, never chunk latency.
  await import("../src/terminal/widget/TerminalMirrorWidget");
  pool.openTerminalPool(fieldd);
  await act(async () => {
    await settle();
  });
  const Widget = registeredComponent(registry);
  await act(async () => {
    root?.render(
      createElement(
        EngineProvider,
        { engine: ce },
        createElement(Widget, { entity, world: ce.world }),
      ),
    );
    await settle();
  });
  // A SECOND pass, and it is not padding. The widget resolves its session in a
  // chain of effects — the pool publishes its runtime, the mirror rebuilds its
  // facade on that runtime's identity, and only then does `listSessions` run
  // and settle. Each link lands in its own commit, so one act flush reaches
  // "resolving" and stops there. (The surface's own suite needs one pass
  // because it renders directly onto an already-open pool; a widget has the
  // extra layer, and that is the difference this line pays for.)
  await act(async () => {
    await settle();
  });
  return { ce, entity, registry };
}

beforeEach(() => {
  runtimeCalls = [];
  sessions = [SESSION];
  rosterAnswer = () => Promise.resolve({ items: ROSTER });
  pool.disposeTerminalPool();
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = InertResizeObserver;
  setHost({
    terminal: {
      connect: () => Promise.resolve({ defaultShell: "/bin/zsh", home: "/Users/test" }),
      onStatus: () => () => undefined,
    },
  } as unknown as FieldHost);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  engine?.dispose();
  engine = null;
  pool.disposeTerminalPool();
});

// ── 1. the contract ─────────────────────────────────────────────────────────

describe("the built-in contribution", () => {
  it("is manifest-vocabulary data — the same shape a plugin would declare", () => {
    // The point of building this prefab from a `WidgetContribution` rather than
    // a hand-written defineWidget call: the durable contract is validated data,
    // and a built-in is held to the same parse as a plugin's row.
    const parsed = WidgetContribution.safeParse(TERMINAL_MIRROR_CONTRIBUTION);
    expect(parsed.success).toBe(true);
    expect(TERMINAL_MIRROR_CONTRIBUTION.surface).toBe("dom");
    // The address, and the only one (TP-L-C). No placement prop exists to store
    // a fact that expires.
    expect(Object.keys(TERMINAL_MIRROR_CONTRIBUTION.props)).toEqual(["sessionId", "label"]);
    // TP-R4a's manifest half: a widget that claimed the keymap would be
    // ARRANGING for keys to reach a card that must never take input focus.
    expect(TERMINAL_MIRROR_CONTRIBUTION.interaction?.keyboard).toBeUndefined();
  });

  it("is NOT a plugin manifest, and could not be one", () => {
    // §7.1's own invariant: widgets require entries.renderer. A built-in has no
    // renderer artifact, so this is the parse that proves the third registry
    // door is a necessity rather than a preference.
    const asManifest = {
      manifestVersion: 1,
      id: TERMINAL_BUILT_IN.id,
      version: TERMINAL_BUILT_IN.version,
      title: TERMINAL_BUILT_IN.title,
      engines: { app: ">=0.0.0", contracts: "^0.1.0" },
      activation: [],
      capabilities: [],
      contributes: { widgets: [TERMINAL_MIRROR_CONTRIBUTION] },
    };
    const result = validatePluginManifest(asManifest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(" ")).toContain("entries.renderer");
  });

  it("reaches the registry through the HOST's door, owning its type", () => {
    const registry = buildRegistry();
    expect(registry.hasWidget(TERMINAL_MIRROR_TYPE)).toBe(true);
    expect(registry.ownerOf(TERMINAL_MIRROR_TYPE)).toBe(TERMINAL_BUILT_IN.id);
    const row = registry.plugin(TERMINAL_BUILT_IN.id);
    expect(row?.builtIn).toBe(true);
    // Neither existing authority registered it — that is the whole claim.
    expect(row?.v1).toBeUndefined();
    expect(row?.record).toBeUndefined();
    expect(row?.widgetContributions.map((w) => w.type)).toEqual([TERMINAL_MIRROR_TYPE]);
  });

  it("is offered in the tray beside every plugin's widgets", () => {
    // The insertion path is every other widget's: the tray reads the registry,
    // and a tile drag spawns the type. Nothing terminal-specific was added.
    const registry = buildRegistry();
    const entry = buildCatalog(registry).find((row) => row.type === TERMINAL_MIRROR_TYPE);
    expect(entry).toBeDefined();
    expect(entry?.title).toBe("Terminal mirror");
    expect(entry?.category).toBe("Tools");
  });

  it("registers before plugins, so a plugin cannot outrank it", () => {
    const registry = buildRegistry();
    expect(() =>
      registry.registerRecord(
        {
          id: "vibefield.impostor",
          title: "Impostor",
          version: "1.0.0",
          contributions: {
            widgets: [{ ...TERMINAL_MIRROR_CONTRIBUTION }],
            behaviors: [],
            commands: [],
            surfaces: [],
          },
        } as unknown as Parameters<typeof registry.registerRecord>[0],
        { [TERMINAL_MIRROR_TYPE]: {} as WidgetType },
      ),
    ).toThrow(/already owned by plugin vibefield\.terminal/);
  });

  it("refuses a built-in that reaches outside its own namespace", () => {
    const registry = buildRegistry();
    expect(() =>
      registry.registerBuiltIn(
        { id: "vibefield.terminal", title: "Terminal", version: "0.1.0" },
        [{ ...TERMINAL_MIRROR_CONTRIBUTION, type: "vibefield.note" }],
        { "vibefield.note": {} as WidgetType },
      ),
    ).toThrow(/may not contribute widget type vibefield\.note/);
  });

  it("is idempotent across engine generations", () => {
    // ICE's widget catalog is process-global and throws on a duplicate define;
    // a doc switch rebuilds the registry. Both must be true at once.
    const first = buildRegistry();
    const second = buildRegistry();
    expect(second.allWidgets().get(TERMINAL_MIRROR_TYPE)).toBe(
      first.allWidgets().get(TERMINAL_MIRROR_TYPE),
    );
    const fresh = buildRegistry();
    expect(() => registerBuiltInTerminalWidgets(fresh)).toThrow(/already registered/);
  });
});

// ── 2. the door stayed shut ─────────────────────────────────────────────────

describe("the SDK is unchanged (R10 / EL7 — why mark 21 chose (a))", () => {
  const sdkSource = (): string => {
    const dir = join(PACKAGE_ROOT, "..", "plugin-sdk", "src");
    return readdirSync(dir)
      .filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
      .map((file) => readFileSync(join(dir, file), "utf8"))
      .join("\n");
  };

  it("exports no terminal pool, runtime or mirror to plugins", () => {
    // Exporting the window's terminal pool through the SDK would put
    // third-party surfaces inside the terminal trust boundary (EL7 — same-uid
    // agents are the adversary). The built-in exists precisely so that this
    // stays true; a future `terminal.mirror` SDK capability is mark 21 (b) and
    // needs its own capability design, not this slice.
    const source = sdkSource();
    for (const forbidden of [
      "terminal/pool",
      "useTerminalPool",
      "TerminalMirrorSurface",
      "watchOnlyRuntime",
      "ghosttea",
    ]) {
      expect(source, `plugin-sdk must not mention ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("keeps the registration door free of the terminal stack", () => {
    // The FINDING this pins (2026-08-22): a STATIC import of the widget module
    // from the registration door put the terminal pool and
    // `@vibecook/ghosttea-react` into the module registry at `test/setup.ts`
    // time — setup imports `field-engine` for the dev-bundled plugins, and
    // `field-engine` calls the door. Every `vi.mock("@vibecook/ghosttea-react")`
    // in the suite then stopped applying, and `terminal-mirror.test.tsx` went
    // from 18 green to 7 red without a line of it changing. The rule is the
    // layering, not the test: building a widget CATALOG must not construct a
    // terminal runtime. `mount.tsx` may reach the module through `import(…)`
    // inside `lazy`; nobody may reach it with a static one.
    const staticImport = /import\s[^(;]*from\s*["']\.\/TerminalMirrorWidget["']/;
    for (const file of ["index.ts", "mount.tsx"]) {
      const source = readFileSync(join(PACKAGE_ROOT, "src", "terminal", "widget", file), "utf8");
      expect(source, `${file} must not statically import the widget module`).not.toMatch(
        staticImport,
      );
    }
  });

  it("is not imported by the built-in widget either — the host uses the engine directly", () => {
    // IMPORTS, not mentions: these files explain at length WHY they do not go
    // through the SDK, and a substring match would fail on the explanation.
    const dir = join(PACKAGE_ROOT, "src", "terminal", "widget");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, `${file} must not import the plugin SDK`).not.toMatch(
        /(?:from|import)\s*\(?\s*["']@vibefield\/plugin-sdk/,
      );
    }
  });
});

// ── 3. TP-R4a in the widget form ────────────────────────────────────────────

const claimVerbs = ["setFocused", "resize", "claimResizeControl"] as const;
const claims = (): typeof runtimeCalls =>
  runtimeCalls.filter((call) => (claimVerbs as readonly string[]).includes(call.verb));

const mirror = (): HTMLElement => {
  const element = container?.querySelector<HTMLElement>(".vf-terminal-mirror");
  if (element === null || element === undefined) throw new Error("no mirror mounted");
  return element;
};

describe("TP-R4a — the mirror is watch-only in its widget form too", () => {
  it("mounts the session's real surface and reaches the runtime only to WATCH", async () => {
    await mountWidget({ sessionId: "session-a", label: "agent · build" });
    expect(mirror().getAttribute("data-mirror-state")).toBe("watching");
    // It really attached — a card that never mounted would pass every "zero
    // claims" row below by doing nothing at all.
    expect(runtimeCalls.some((call) => call.verb === "mount")).toBe(true);
    expect(claims()).toEqual([]);
  });

  it("issues zero claims under programmatic focus, pointer press, click and keys", async () => {
    await mountWidget({ sessionId: "session-a" });
    const input = container?.querySelector<HTMLTextAreaElement>(".terminal-input");
    expect(input).not.toBeNull();
    expect(input?.readOnly).toBe(true);
    await act(async () => {
      input?.focus();
      // `inert` is not implemented by every DOM, so the focus is DELIVERED by
      // hand: a row that only proved "happy-dom refused" would prove nothing.
      input?.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
      input?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      input?.dispatchEvent(new Event("pointerup", { bubbles: true }));
      input?.dispatchEvent(new Event("click", { bubbles: true }));
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await settle();
    });
    expect(claims()).toEqual([]);
    expect(runtimeCalls.filter((call) => call.verb === "sendKey")).toEqual([]);
    expect(runtimeCalls.filter((call) => call.verb === "sendText")).toEqual([]);
    // And the card never repainted the session for every other viewer
    // (`setTheme` notifies the daemon with a sessionId and no view scope).
    expect(runtimeCalls.filter((call) => call.verb === "setTheme")).toEqual([]);
  });

  it("issues zero claims when the CARD is resized", async () => {
    // The widget is `resizable` — that is the CARD's geometry. The hazard is
    // that a resized card resizes the PTY through the surface's ungated
    // observer, so this drives a real box change through the real path.
    let deliver: ((entries: unknown[]) => void) | null = null;
    let observed: Element | null = null;
    class DrivenResizeObserver {
      constructor(callback: (entries: unknown[]) => void) {
        deliver = callback;
      }
      observe(target: Element): void {
        observed = target;
      }
      disconnect(): void {}
      unobserve(): void {}
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = DrivenResizeObserver;
    await mountWidget({ sessionId: "session-a" });
    expect(observed).not.toBeNull();
    await act(async () => {
      deliver?.([{ target: observed, contentRect: { width: 1200, height: 800 } }]);
      await settle();
    });
    expect(claims()).toEqual([]);
  });

  it("carries no canvas-interactive opt-in over the mirror itself", async () => {
    await mountWidget({ sessionId: "session-a" });
    // The C-2 contract by omission: every pointer event over the mirror belongs
    // to the canvas (drag the card, wheel to zoom). Only the CONTROLS opt in,
    // and there is exactly one on a bound card — the way back off a dead
    // address.
    const interactive = container?.querySelectorAll("[data-canvas-interactive]") ?? [];
    expect(interactive.length).toBe(1);
    expect(interactive[0]?.closest(".vf-terminal-mirror")).toBeNull();
  });

  it("declares live demand while watching and releases it on unmount", async () => {
    await mountWidget({ sessionId: "session-a" });
    expect(pool.terminalPoolLiveSessions()).toEqual(["session-a"]);
    await act(async () => {
      root?.render(null);
      await settle();
    });
    // TP-L-E′: unmount RELEASES that view's declared demand, atomically.
    expect(pool.terminalPoolViewCount()).toBe(0);
    expect(pool.terminalPoolDemand()).toEqual([]);
  });
});

// ── the faces, and the durable address ──────────────────────────────────────

describe("honest faces", () => {
  it("shows the roster picker when nothing has been chosen yet", async () => {
    await mountWidget({});
    const picker = container?.querySelector(".vf-terminal-picker");
    expect(picker?.getAttribute("data-roster-state")).toBe("observed");
    expect(container?.textContent).toContain("agent · build");
    expect(container?.textContent).toContain("session-b");
    // No session is being watched, so nothing is being asked of the floor.
    expect(pool.terminalPoolViewCount()).toBe(0);
  });

  it("says the floor was never observed rather than showing an empty list", async () => {
    const refusal = Object.assign(new Error("unobserved"), {
      kind: "UNAVAILABLE",
      details: { service: "terminal", state: "unobserved" },
    });
    rosterAnswer = () => Promise.reject(refusal);
    await mountWidget({});
    const picker = container?.querySelector(".vf-terminal-picker");
    expect(picker?.getAttribute("data-roster-state")).toBe("unobserved");
    expect(container?.textContent).toContain("has not looked at the terminal floor yet");
  });

  it("says the roster could not be read when this window cannot ask", async () => {
    rosterAnswer = () => Promise.reject(new Error("no daemon"));
    await mountWidget({});
    const picker = container?.querySelector(".vf-terminal-picker");
    expect(picker?.getAttribute("data-roster-state")).toBe("unavailable");
    expect(container?.textContent).toContain("roster unavailable");
  });

  it("offers an empty floor honestly once it HAS been observed", async () => {
    rosterAnswer = () => Promise.resolve({ items: [] });
    await mountWidget({});
    expect(container?.textContent).toContain("no sessions to watch");
  });

  it("says the session is gone rather than showing a blank card", async () => {
    sessions = [];
    await mountWidget({ sessionId: "session-a", label: "agent · build" });
    expect(mirror().getAttribute("data-mirror-state")).toBe("unavailable");
    expect(container?.textContent).toContain("session unavailable");
    expect(pool.terminalPoolViewCount()).toBe(0);
  });
});

describe("the durable address", () => {
  it("writes the picked session into the document's widget props", async () => {
    const { ce, entity, registry } = await mountWidget({});
    const row = container?.querySelector<HTMLButtonElement>(".vf-terminal-picker-row");
    expect(row).not.toBeNull();
    await clickAndProject(ce, row);
    // Persistence is every other widget's: props in the doc.
    const stored = storedProps(registry, ce, entity);
    expect(stored?.["sessionId"]).toBe("session-a");
    expect(stored?.["label"]).toBe("agent · build");
    // And the card is now watching what it was told to watch.
    expect(mirror().getAttribute("data-mirror-state")).toBe("watching");
  });

  it("can be handed back — a card on a dead address is never stuck", async () => {
    const { ce, entity, registry } = await mountWidget({
      sessionId: "session-a",
      label: "agent · build",
    });
    const unbind = container?.querySelector<HTMLButtonElement>(
      ".vf-terminal-mirror-widget-unbind button",
    );
    expect(unbind).not.toBeNull();
    await clickAndProject(ce, unbind);
    expect(storedProps(registry, ce, entity)?.["sessionId"]).toBe("");
    expect(container?.querySelector(".vf-terminal-picker")).not.toBeNull();
  });
});
