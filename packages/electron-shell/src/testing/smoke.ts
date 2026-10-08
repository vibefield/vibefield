import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  catalogEntry,
  DocListResult,
  type FrameView,
  LAYOUT,
  TerminalConfigDocument,
  TerminalConfigValidation,
  TerminalConfigWriteRefusal,
  TerminalConfigWriteResult,
  TerminalCreateOpenResult,
  TerminalListResult,
  type WindowConnection,
} from "@vibefield/contracts";
import type { FielddHandle, FielddSupervisor } from "@vibefield/fieldd-supervisor";
import {
  app,
  BrowserWindow,
  Menu,
  MessageChannelMain,
  powerSaveBlocker,
  type WebContents,
  webContents,
} from "electron";
import { CLOSE_WINDOW_ITEM_ID, ZOOM_ITEM_IDS } from "../main/app-menu-model";
import { APP_ORIGIN } from "../main/app-protocol";
import type { WindowRendererBoundary } from "../main/bootstrap";
import { BrowserControlTargetRegistry } from "../main/live-surfaces/browser-control-target";
import { ElectronBrowserSurfaceNative } from "../main/live-surfaces/browser-electron-native";
import { BrowserLiveSurfaceRuntime } from "../main/live-surfaces/browser-producer";
import { createElectronLiveSurfaceTextureTransferApi } from "../main/live-surfaces/electron-texture-transfer";
import {
  IosSimulatorLiveSurfaceRuntime,
  IosSimulatorSourceResolver,
  type ResolvedIosSimulatorCapture,
  SimctlDeviceCatalog,
} from "../main/live-surfaces/ios-simulator-producer";
import {
  MacosCaptureHelperSupervisor,
  type MacosCaptureSource,
} from "../main/live-surfaces/macos-capture-helper";
import { loadMacosCaptureNativeAdapter } from "../main/live-surfaces/macos-capture-native";
import type { LiveSurfaceRuntimeAuthority } from "../main/live-surfaces/runtime";
import {
  aggregateLiveSurfaceRuntimeSupport,
  type LiveSurfaceRuntimeSupportSource,
} from "../main/live-surfaces/runtime-support";
import { SckLiveSurfaceRuntime } from "../main/live-surfaces/sck-producer";
import {
  LiveSurfaceTextureForwarder,
  type LiveSurfaceTextureTransferApi,
} from "../main/live-surfaces/texture-forwarder";
import { LiveSurfaceTicketTable } from "../main/live-surfaces/ticket-table";
import { LiveSurfaceWindowHost } from "../main/live-surfaces/window-host";
import type { ElectronLogging } from "../main/logging";
import { sharedProfilePath } from "../main/smoke-profile";
import type { WindowRegistry } from "../main/window-policy";
import { createMainWindow, loadRenderer } from "../main/windows";
import { labProfileProof } from "./godview-lab-profile";
import { LiveSurfaceFixtureRuntime } from "./live-surface-fixture-runtime";
import {
  LIVE_SURFACE_LAB_ALL_TICKETS,
  LIVE_SURFACE_LAB_BROWSER_SURFACE_IDS,
  LIVE_SURFACE_LAB_CLOCK_OFFSET_DATASET,
  LIVE_SURFACE_LAB_CLOCK_UNCERTAINTY_DATASET,
  LIVE_SURFACE_LAB_CONTINUOUS_ACTIVE_DATASET,
  LIVE_SURFACE_LAB_FALLBACK_SURFACE_ID,
  LIVE_SURFACE_LAB_HELPER_CRASH_ACK_DATASET,
  LIVE_SURFACE_LAB_HELPER_CRASH_REQUEST_DATASET,
  LIVE_SURFACE_LAB_RELOAD_READY_DATASET,
  LIVE_SURFACE_LAB_RELOAD_TICKET,
  LIVE_SURFACE_LAB_RESULT_DATASET,
  LIVE_SURFACE_LAB_SCK_SURFACE_IDS,
  LIVE_SURFACE_LAB_TICKET_READY_DATASET,
  LIVE_SURFACE_LAB_TICKETS,
  type LiveSurfaceLabRendererResult,
} from "./live-surface-lab-contract";
import {
  type CountVector,
  countVector,
  type ElectronProcessSample,
  LOG_CENSUS_CEILINGS,
  logCensus,
  loggingCensus,
  PLUGIN_RUNTIME_SOAK_EXACT_KEYS,
  type ProcessResourceSample,
  pidAlive,
  pluginRuntimeSoakConfig,
  sampleElectronProcesses,
  sampleProcessFootprintKb,
  sampleProcessResources,
  vectorMismatches,
} from "./plugin-runtime-physical";
import {
  evaluatePhysicalSoak,
  type PhysicalSoakOptions,
  type PhysicalSoakSample,
} from "./plugin-runtime-soak";
import { coverRows } from "./smoke-covers";
import { removeSmokeRoot, SMOKE_RUN_ENV, stopRunDaemons } from "./smoke-daemons";
import { deskRigRows } from "./smoke-desk-rig";
import { faultRows, peersRows } from "./smoke-peers";
import { pegboardRows } from "./smoke-pegboard";
import { restRows } from "./smoke-rest";
import { selectionBarRows } from "./smoke-selection-bar";
import { sendToRows } from "./smoke-send-to";
import {
  countersOf,
  judgePresenceRest,
  judgeWindow,
  type Moved,
  movedBy,
  PRESENCE_REST,
  STILLNESS_SAMPLE,
  type StillnessSample,
} from "./smoke-stillness";
import { thumbnailRows } from "./smoke-thumb";
import { toolsInHandRows } from "./smoke-tools-in-hand";
import { TRY_FLAG, TRY_SEARCH_KEY, TRY_TYPES_ENV, tryBoardRows, tryTypes } from "./smoke-try";
import { NO_WEBGPU_FLAG, unavailableRows, withoutWebgpu } from "./smoke-unavailable";
import {
  DRAWN_BUDGET_MS,
  hiddenDuring,
  hiddenSinceLoad,
  neverDrawn,
  PAGE_VISIBILITY,
  type PageVisibility,
} from "./smoke-visibility";
import { keepFromPerson, smokeWindow, smokeWindowsFocused } from "./smoke-window";
import {
  leakedVariables,
  readTypedAgentCalls,
  type StagedTypedAgent,
  startupFilesRead,
  TYPED_AGENT_REFUSED_ARGUMENT,
  type TypedAgentCall,
} from "./typed-agent";

// MV-0 — the Godview perf lab rides the same bundle, for the same reason.
export { runGodviewPerfLab } from "./godview-perf-lab";
export { runTerminalDoorProbe } from "./terminal-door-probe";
// TP-S0c — the perf lab rides the SAME test-only bundle every smoke does, so
// main reaches it through the one runtime-external import it already has and no
// second artifact has to be built, excluded from packaging, and kept excluded.
// Its code lives in its own file; only the door is here.
export { runTerminalPerfLab, SCENARIOS as TERMINAL_PERF_SCENARIOS } from "./terminal-perf-lab";
// AR-7 — main stages the godview smoke's typed agent BEFORE the pair boots
// (fieldd composes an agent's executable once, at boot), so the stager is a
// door of this bundle's like the runners are; its code lives in its own file.
export { stageTypedAgent } from "./typed-agent";

// Smoke/spike runners (ESR §5.2.6 / ESR-12): a SEPARATE build artifact
// (dist/testing/smoke.cjs) that the production main bundle never contains —
// index.ts reaches it via a runtime-external dynamic import, and packaging
// omits the file entirely. Everything here is test-only by construction.

/** The text of one `console-message` payload, whichever shape Electron used.
 * The event's arguments changed shape between majors — a string in one, an
 * object carrying `message` in another — so both are read rather than one being
 * assumed and the other silently reading as empty. */
function consoleText(arg: unknown): string {
  if (typeof arg === "string") return arg;
  if (arg !== null && typeof arg === "object" && "message" in arg) {
    return String((arg as { message: unknown }).message);
  }
  return "";
}

/** Resolve when a renderer console line starting with `prefix` arrives.
 *
 * The listener is REMOVED on both settle paths. The godview smoke arms one of
 * these per reload plus one each for the monitor and cold-open lines, and a
 * listener that outlived its promise pushed the window past Node's default cap
 * of ten — so the harness printed `MaxListenersExceededWarning` into its own
 * output, which is a harness teaching its reader to ignore warnings. */
export function waitForConsole(
  win: BrowserWindow,
  prefix: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const listener = (...args: unknown[]): void => {
      for (const a of args) {
        const text = consoleText(a);
        if (text.startsWith(prefix)) {
          settle();
          resolve(text.slice(prefix.length));
          return;
        }
      }
    };
    const settle = (): void => {
      clearTimeout(t);
      win.webContents.off("console-message", listener);
    };
    const t = setTimeout(() => {
      settle();
      reject(new Error(`no "${prefix}" within ${timeoutMs}ms`));
    }, timeoutMs);
    win.webContents.on("console-message", listener);
  });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Stop-owned via the supervisor (adopted daemons survive — ownership law),
 * then — DK-18 (39) — the run's OWN daemons stopped and WAITED for
 * (testing/smoke-daemons.ts: the supervisor never waits for the field-native it
 * signals, and never signals one a restarted fieldd adopted, so the pair outlived
 * every smoke), then remove the root ONLY if this run created it (an injected
 * FIELDD_DATA_DIR is someone else's data) — and, the run green, its whole HOME
 * (the `vf-smoke-*` root above the user root: its logs; a red run keeps them,
 * named by `SMOKE_HOME`). */
async function teardown(
  supervisor: FielddSupervisor,
  root: string,
  beforeExit: () => Promise<void>,
  ok: boolean,
): Promise<void> {
  await supervisor.dispose();
  const daemons = await stopRunDaemons(process.env[SMOKE_RUN_ENV], process.pid);
  console.log(`SMOKE_TEARDOWN ${JSON.stringify(daemons)}`);
  await beforeExit();
  removeSmokeRoot(root, ok);
}

export async function runSmoke(
  handle: FielddHandle,
  supervisor: FielddSupervisor,
  root: string,
  beforeExit: () => Promise<void>,
): Promise<void> {
  const health = (await handle.client.request("system.health")) as {
    nativeConnected: boolean;
    native: { units?: Array<{ unit: string }> } | null;
  };
  const profile = smokeProfileFailures();
  const summary = {
    ok: health.nativeConnected && profile.length === 0,
    port: handle.info.port,
    nativeConnected: health.nativeConnected,
    units: health.native?.units?.map((u) => u.unit) ?? [],
  };
  console.log(`SMOKE ${JSON.stringify(summary)}`);
  await teardown(supervisor, root, beforeExit, summary.ok);
  app.exit(summary.ok ? 0 : 2); // exit is queued; the caller returns without opening a window
}

/** What one `CANVAS_READY {…}` line carries. */
interface CanvasFacts {
  widgetTypes: number;
  plugins: number;
  /** P8b-3 — how many plugins came through the STAGED path (fieldd approval →
   * plugin origin → import map → async activate) rather than merely registering. */
  stagedPlugins: number;
  /** PRC-6c physical census emitted from the actual prepared runtime after
   * layout effects attached the document behavior generation. */
  runtime?: object;
}

/** The census this smoke defends (P8-D2; rewritten at DK-3).
 *
 * `stagedPlugins` is the MECHANISM fact: the dev-bundled fallback can satisfy
 * a registry census on its own, so without this number a renderer that quietly
 * fell back would look exactly like one that staged correctly — the field must
 * be filled the real way. Since DK-8 the staged renderer modules are FOUR: the
 * product's two (`plugins/browser` — its Artifacts panel — and VibeField's own comment
 * pad, `plugins/comment-pad`, bundled, built by build:all through field-app's
 * dependencies) and two dev-linked examples — the behavior-conformance carrier and
 * the desk clock (DK-6: `examples/plugins/desk-clock`), built by build:all through
 * field-app's dev dependencies (the carrier since DK-8 — before that it staged
 * whatever `dist/` its last hand build or the playground's test wrote); kv-service
 * remains service-only and stages no renderer module. The note, field-tools and
 * widgetlab plugins retired with their widgets (DK-8).
 *
 * The PRODUCT fact moved at DK-3 (the plan's retire table: "the 24-type census
 * → the new seed's census"). It was `widgetTypes === 24` — the registry's
 * types, 23 across the five plugins plus the host's terminal mirror, seven of
 * them R3F islands — a count the desk no longer draws a single one of (every
 * VibeField widget type is faceless on the desk until DK-8). What a first-run
 * board must hold now is the DESK's seed (field/desk/desk-seed.ts; DK-8 the
 * product's: ICE's six and the comment pad), read off the open document through
 * `window.__vfDesk.census()` — GPU on or off, since it counts the world, not
 * pixels. `widgetTypes` is still printed, and no longer judged. */
const CANVAS_CENSUS = {
  /** The PRODUCT's first board (DK-8), one object each: ICE's six (`@vibecook/ice/desk/objects`'s ids) and
   * VibeField's own comment pad (`plugins/comment-pad`, staged with the product's plugins). */
  seed: [
    "desk.note",
    "desk.minimat",
    "desk.board",
    "desk.notebook",
    "desk.calendar",
    "desk.photo",
    "vibefield.comment-pad",
  ],
  /** DK-8 — VibeField's own kind: the comment pad, drawn, written in and reopened by the pad rows. */
  commentPad: "vibefield.comment-pad",
  /** DK-6 — THE PARITY WITNESS: the example plugin's clock, a PLUGIN's kind through the SDK's `/desk`
   * door alone. DK-8 (ruling 1): an EXAMPLE, never a user's first board — the seed lays it only where
   * the run asks for the examples, so this smoke loads its renderer with `?deskSeedExamples=1`
   * (field-app `SEED_EXAMPLES`) — the CLOCK row needs it. */
  exampleClock: "vibefield.example.desk-clock",
  // DK-8: 7 → 6 → 5 → 4 — `vibefield.note`, `vibefield.field-tools` and `examples/plugins/widgetlab` retired
  // (ICE's note and mini mat, the comment pad; widgetlab's demos go): the browser's Artifacts panel, the comment
  // pad, the behavior-conformance carrier and the example desk clock stay.
  minStagedPlugins: 4,
  // THE CSS CENSUS RETIRED (DK-8; the plan's retire table — "the CSS census in `smoke:canvas` and
  // `smoke:plugin-restart`", DK-5 kept it for here): it counted the scoped stylesheets of the plugins that
  // drew DOM WIDGETS (note, field-tools, widgetlab — and the browser's), 4 → 3 → 2 as the first two retired;
  // with widgetlab the last DOM widget is gone, and an object kind has no CSS (DK-6). The one plugin
  // stylesheet left is the browser's Artifacts panel — a HUD surface, whose CSS scope stays (the retire
  // table's `plugin-style.ts` row) — and it is no longer counted here.
} as const;

/** Every way the line disagrees with the census, named — a smoke that fails
 * should say what it saw, not that something was wrong. */
function censusFailures(
  facts: CanvasFacts,
  minStaged: number = CANVAS_CENSUS.minStagedPlugins,
): string[] {
  const problems: string[] = [];
  if (facts.stagedPlugins < minStaged) {
    problems.push(
      `${facts.stagedPlugins} staged plugin(s), expected at least ${minStaged} — the renderer did not load through the staged path`,
    );
  }
  return problems;
}

/** A captured still read back in the renderer (field/desk/desk-door.ts `DeskSample`). */
interface DeskSampleFacts {
  readonly width: number;
  readonly height: number;
  readonly colors: number;
  readonly lumaMin: number;
  readonly lumaMax: number;
  readonly lumaMean: number;
}

/** The desk's counters as the door reads them: the frames it drew and the queue's submits. */
interface DeskCounters {
  readonly frames: number;
  readonly submits: number;
}

const DESK_COUNTERS = `(() => {
  const d = globalThis.__vfDesk;
  if (d === undefined) return null;
  return { frames: d.perf().frames, submits: d.submits()?.total ?? -1 };
})()`;

async function deskCounters(win: BrowserWindow): Promise<DeskCounters> {
  const counters = (await win.webContents.executeJavaScript(
    DESK_COUNTERS,
    true,
  )) as DeskCounters | null;
  if (counters === null) throw new Error("window.__vfDesk is not installed");
  return counters;
}

/** DK-10b — one end of a stillness window (testing/smoke-stillness.ts): the counters, the wakes by reason, the outside input. */
async function stillnessSample(win: BrowserWindow): Promise<StillnessSample> {
  const sample = (await win.webContents.executeJavaScript(
    STILLNESS_SAMPLE,
    true,
  )) as StillnessSample | null;
  if (sample === null) throw new Error("window.__vfDesk is not installed");
  return sample;
}

/** DK-11 — the page's visibility and its non-visible transitions so far (testing/smoke-visibility.ts; the first read arms
 * the page's recorder). */
async function pageVisibility(win: BrowserWindow): Promise<PageVisibility> {
  return (await win.webContents.executeJavaScript(PAGE_VISIBILITY, true)) as PageVisibility;
}

/**
 * DK-11 — BEFORE A FRAME-COUNTING ROW'S FIRST SAMPLE: wait for the page to be visible (an occluded page's animation frames are
 * paused — its count is the compositor's zero, not the desk's), up to DRAWN_BUDGET_MS. Answers the reading the row's window
 * is judged from (`hiddenDuring` at its end), or the NAMED cause when the page never became visible. No frame-counting row
 * needs the window's FOCUS — frames need visibility only (the idle row's "focused" is the line's DOM focus, its own check).
 */
async function drawnWindow(
  win: BrowserWindow,
  row: string,
): Promise<{ readonly start: PageVisibility } | { readonly problem: string }> {
  const t0 = Date.now();
  let seen = await pageVisibility(win);
  while (seen.visibility !== "visible" && Date.now() - t0 < DRAWN_BUDGET_MS) {
    await sleep(100);
    seen = await pageVisibility(win);
  }
  return seen.visibility === "visible"
    ? { start: seen }
    : { problem: neverDrawn(row, seen, Date.now() - t0) };
}

/** DK-11 — wait for ONE frame drawn after now (a still's, a theme's): on a page that stays hidden, throw the NAMED cause
 * rather than the frame wait's timeout, which named the symptom ("a frame drawn … did not happen"). */
async function waitForFrameDrawn(win: BrowserWindow, what: string): Promise<void> {
  const drawn = await drawnWindow(win, what);
  if ("problem" in drawn) throw new Error(drawn.problem);
  const from = (await deskCounters(win)).frames;
  await waitForRendererFact(win, what, 10_000, `globalThis.__vfDesk.perf().frames > ${from}`);
}

/** DK-11 — a frame-counting row's window, judged once its last sample is taken: null, or the named cause. */
async function windowHidden(
  win: BrowserWindow,
  row: string,
  drawn: { readonly start: PageVisibility } | { readonly problem: string },
): Promise<string | null> {
  return "problem" in drawn
    ? drawn.problem
    : hiddenDuring(row, drawn.start, await pageVisibility(win));
}

/**
 * DK-10b — THE DESK'S TWO SECONDS AT REST, judged (testing/smoke-stillness.ts): taken once the desk is asleep (`waitAtRest`)
 * and clear of the example clock's minute turn — DK-6: the seed's clock is a MINUTE clock, and its registered wake moves the
 * resting desk at each minute's turn (by its law, a hair before it), by design. A window moved while outside input reached the
 * desk (a person at a shared machine touched the wind) is taken again, up to STILLNESS_TRIES; the last window's counters are
 * the row's, with what moved it when it moved — a red row names its waker. DK-12: the last window's outside input is the
 * row's too (`input` — real motion and a resting pointer's repeats, which wake nothing since ICE's I33), green or red.
 */
async function deskRestWindow(
  win: BrowserWindow,
  waitAtRest: () => Promise<unknown>,
): Promise<{
  rest0: DeskCounters;
  rest1: DeskCounters;
  disturbed: Moved[];
  moved: Moved | null;
  /** DK-11: the named cause when the page was not visible through the two seconds — then their zero proves nothing */
  hidden: string | null;
  /** DK-12: the outside input the last window received — real motion, and a resting pointer's repeats (I33) */
  input: { readonly outside: number; readonly resting: number };
}> {
  const disturbed: Moved[] = [];
  for (let attempt = 1; ; attempt += 1) {
    await waitAtRest();
    const intoMinute = Date.now() % 60_000;
    if (intoMinute < 1_000) await sleep(1_000 - intoMinute);
    else if (intoMinute > 56_000) await sleep(61_000 - intoMinute);
    const drawn = await drawnWindow(win, "the rest window");
    const a = await stillnessSample(win);
    await sleep(2_000);
    const b = await stillnessSample(win);
    const hidden = await windowHidden(win, "the rest window", drawn);
    const { outside, resting } = movedBy(a, b);
    const input = { outside, resting };
    if (hidden !== null)
      return { rest0: countersOf(a), rest1: countersOf(b), disturbed, moved: null, hidden, input };
    const verdict = judgeWindow(a, b, attempt);
    if (verdict.kind === "again") {
      disturbed.push(verdict.moved);
      continue;
    }
    return {
      rest0: countersOf(a),
      rest1: countersOf(b),
      disturbed,
      moved: verdict.kind === "moved" ? verdict.moved : null,
      hidden: null,
      input,
    };
  }
}

/** The open board's census through the door (DK-3): polled until it is the desk seed's six kinds,
 * one each — the seed's print lands once its picture is in the byte store — or the budget runs out. */
async function readDeskCensus(
  win: BrowserWindow,
  timeoutMs = 15_000,
): Promise<{ census: Record<string, number> | null; problems: string[] }> {
  const deadline = Date.now() + timeoutMs;
  let census: Record<string, number> | null = null;
  const wrong = (c: Record<string, number> | null): string[] =>
    c === null
      ? ["window.__vfDesk is not installed"]
      : CANVAS_CENSUS.seed
          .filter((type) => c[type] !== 1)
          .map((type) => `${type} × ${c[type] ?? 0}`);
  while (Date.now() < deadline) {
    census = (await win.webContents.executeJavaScript(
      "globalThis.__vfDesk?.census() ?? null",
      true,
    )) as Record<string, number> | null;
    if (wrong(census).length === 0) break;
    await sleep(100);
  }
  const problems = wrong(census);
  return {
    census,
    problems:
      problems.length === 0
        ? []
        : [`the seeded desk is not one of each kind: ${problems.join(", ")}`],
  };
}

/** The first-run board's census (DK-3): the desk seed's six kinds, one each, in the open document. */
async function deskSeedFailures(win: BrowserWindow, timeoutMs = 15_000): Promise<string[]> {
  const { census, problems } = await readDeskCensus(win, timeoutMs);
  console.log(`SMOKE_CANVAS_SEED ${JSON.stringify(census)}`);
  return problems;
}

/** What the GPU-on half of the clock row reads off the desk. */
interface DrawnClock {
  readonly faults: readonly unknown[];
  readonly picked: { readonly x: number; readonly y: number; readonly part: string } | null;
}

/**
 * DK-6 — THE PARITY WITNESS IN THE PRODUCT: the example plugin's clock — a PLUGIN's kind, built on
 * `@vibefield/plugin-sdk/desk` alone and staged by fieldd like any plugin — in the seed's census beside
 * the six (GPU on or off: it counts the world); and, GPU on, DRAWN: its kind not refused at the desk's
 * mount (`status().faults` names it not — its WGSL compiled on the host's device) and its round face
 * PICKED on the last presented frame, the desk's own pick resolving through the kind's mirror of what
 * it drew (a scan of the view at 16 CSS px). The window's stills hold it beside the six.
 */
async function exampleClockRow(win: BrowserWindow, gpu: boolean): Promise<string[]> {
  const type = CANVAS_CENSUS.exampleClock;
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const count = async (): Promise<number> =>
    (await js<Record<string, number> | null>("globalThis.__vfDesk?.census() ?? null"))?.[type] ?? 0;
  const deadline = Date.now() + 15_000;
  let census = await count();
  while (census !== 1 && Date.now() < deadline) {
    await sleep(100);
    census = await count();
  }
  const problems: string[] = [];
  if (census !== 1) {
    problems.push(
      `the example clock is not on the desk (${type} × ${census}) — examples/plugins/desk-clock built and staged?`,
    );
  }
  let drawn: DrawnClock | null = null;
  if (gpu) {
    drawn = await js<DrawnClock>(`(() => {
      const d = globalThis.__vfDesk;
      const el = document.querySelector("[data-desk]");
      const box = el === null ? { width: innerWidth, height: innerHeight } : el.getBoundingClientRect();
      let picked = null;
      for (let y = 8; y < box.height && picked === null; y += 16)
        for (let x = 8; x < box.width && picked === null; x += 16) {
          const hit = d.pick({ x, y });
          if (hit !== null && hit.type === ${JSON.stringify(type)}) picked = { x, y, part: hit.part };
        }
      return { faults: d.status().faults ?? [], picked };
    })()`);
    const refused = (drawn?.faults ?? []).some(
      (fault) => (fault as { kind?: unknown }).kind === type,
    );
    if (refused)
      problems.push(`the desk refused the example clock's kind (${JSON.stringify(drawn)})`);
    if (drawn?.picked === null)
      problems.push("the example clock was not picked on the drawn frame");
  }
  console.log(`SMOKE_CANVAS_CLOCK ${JSON.stringify({ type, census, ...(drawn ?? {}) })}`);
  return problems;
}

/** The URL door the first board's examples are asked through (field-app `field/desk/desk-seed.ts`
 * `SEED_EXAMPLES` — restated: the shell imports no field-app module here). */
const SEED_EXAMPLES = "deskSeedExamples";

/** The line the pad row writes, a character at a time, through the desk's one editor. */
const PAD_LINE = "dk-8: a line on the comment pad";

/** Where the pad lies on screen — its picked box (CSS px, window coordinates) and a point to tap that the
 * desk itself receives (no chrome over it) — or null when no pick answers the pad. */
interface PadOnScreen {
  readonly box: {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
  };
  readonly tap: { readonly x: number; readonly y: number } | null;
}

/** Scan the drawn frame for the pad (the desk's own pick, 8 CSS px apart) — its box, and the lowest point of
 * it the desk's own element receives (`elementFromPoint` inside `[data-desk]`): a tap there is the desk's. */
async function padOnScreen(win: BrowserWindow): Promise<PadOnScreen | null> {
  return (await win.webContents.executeJavaScript(
    `(() => {
      const d = globalThis.__vfDesk;
      const el = document.querySelector("[data-desk]");
      if (d === undefined || el === null) return null;
      const r = el.getBoundingClientRect();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, tap = null;
      for (let y = 4; y < r.height; y += 8)
        for (let x = 4; x < r.width; x += 8) {
          const hit = d.pick({ x, y });
          if (hit === null || hit.type !== ${JSON.stringify(CANVAS_CENSUS.commentPad)}) continue;
          const wx = r.left + x, wy = r.top + y;
          x0 = Math.min(x0, wx); y0 = Math.min(y0, wy); x1 = Math.max(x1, wx); y1 = Math.max(y1, wy);
          const under = document.elementFromPoint(wx, wy);
          if (under !== null && el.contains(under) && (tap === null || wy > tap.y)) tap = { x: wx, y: wy };
        }
      return x0 === Infinity ? null : { box: { x0, y0, x1, y1 }, tap };
    })()`,
    true,
  )) as PadOnScreen | null;
}

/** The pad's props on the open board, read through the door (`__vfDesk.objects`). */
async function padProps(win: BrowserWindow): Promise<Record<string, unknown>[] | null> {
  return (await win.webContents.executeJavaScript(
    `globalThis.__vfDesk?.objects(${JSON.stringify(CANVAS_CENSUS.commentPad)}).map((o) => o.props) ?? null`,
    true,
  )) as Record<string, unknown>[] | null;
}

/** A point of BARE MAT nearest the window's middle — no object picked there, and the desk's own element under it (no
 * chrome): where a drag pans the desk. */
async function bareMatPoint(win: BrowserWindow): Promise<{ x: number; y: number } | null> {
  return (await win.webContents.executeJavaScript(
    `(() => {
      const d = globalThis.__vfDesk;
      const el = document.querySelector("[data-desk]");
      if (d === undefined || el === null) return null;
      const r = el.getBoundingClientRect();
      const cx = innerWidth / 2, cy = innerHeight / 2;
      let best = null, bestD = Infinity;
      for (let y = 12; y < r.height; y += 12)
        for (let x = 12; x < r.width; x += 12) {
          const wx = r.left + x, wy = r.top + y;
          if (d.pick({ x, y }) !== null) continue;
          const under = document.elementFromPoint(wx, wy);
          if (under === null || !el.contains(under)) continue;
          const dd = Math.hypot(wx - cx, wy - cy);
          if (dd < bestD) { bestD = dd; best = { x: wx, y: wy }; }
        }
      return best;
    })()`,
    true,
  )) as { x: number; y: number } | null;
}

/** A drag by the primary button from `from` by `by` — pressed, moved in steps with the button held, let go. */
async function dragFrom(
  win: BrowserWindow,
  from: { x: number; y: number },
  by: { dx: number; dy: number },
): Promise<void> {
  win.webContents.sendInputEvent({ type: "mouseMove", x: from.x, y: from.y });
  await sleep(60);
  win.webContents.sendInputEvent({
    type: "mouseDown",
    x: from.x,
    y: from.y,
    button: "left",
    clickCount: 1,
  });
  await sleep(60);
  for (const k of [0.15, 0.35, 0.55, 0.75, 0.9, 1]) {
    win.webContents.sendInputEvent({
      type: "mouseMove",
      x: Math.round(from.x + by.dx * k),
      y: Math.round(from.y + by.dy * k),
      button: "left",
      modifiers: ["leftbuttondown"],
    });
    await sleep(40);
  }
  const to = { x: Math.round(from.x + by.dx), y: Math.round(from.y + by.dy) };
  win.webContents.sendInputEvent({
    type: "mouseUp",
    x: to.x,
    y: to.y,
    button: "left",
    clickCount: 1,
  });
  await sleep(500); // the camera settles
}

/** GPU off: the pad counts the world, so its census holds even where the desk cannot draw. */
async function commentPadCensusRow(win: BrowserWindow): Promise<string[]> {
  const props = await padProps(win);
  console.log(`SMOKE_CANVAS_PAD ${JSON.stringify({ census: props?.length ?? 0 })}`);
  return props?.length === 1
    ? []
    : [`the comment pad is not on the board (× ${props?.length ?? 0})`];
}

/**
 * DK-8 (DK-D14) — VIBEFIELD'S OWN KIND IN THE PRODUCT: the comment pad (`plugins/comment-pad`, a plugin kind through
 * `@vibefield/plugin-sdk/desk` alone, staged with the product's plugins) — on the first board (its census, 1); DRAWN
 * (its kind not refused at the desk's mount — its WGSL compiled on the host's device — and its block picked on the
 * drawn frame); the view wheeled in over it (the plain wheel zooms about the pointer); then A LINE TYPED: a tap where
 * the desk receives it puts the desk's one editor on the pad (its text part — the editor's focus is the lease's),
 * the line goes in a character at a time (`char` events — an editor types from `char`), and the session's end (1 s
 * without input) lands it in the pad's `ink` cell — read back through the door — and the board's save is
 * acknowledged (`board()`), so the reopen after the retry row's reload reads what fieldd holds. The window's stills
 * (`dk-8-pad-{light,dark}.png`) are the pad with its line and its caret, by day and by night. Escape lets it go.
 */
async function commentPadRow(
  win: BrowserWindow,
  shotDir: string | undefined,
): Promise<{ problems: string[]; typed: boolean }> {
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const problems: string[] = [];
  const type = CANVAS_CENSUS.commentPad;
  const census = (await padProps(win))?.length ?? 0;
  const faults = await js<readonly unknown[]>("globalThis.__vfDesk.status().faults ?? []");
  const refused = faults.some((fault) => (fault as { kind?: unknown }).kind === type);
  let seen = await padOnScreen(win);
  const facts: Record<string, unknown> = { census, refused, picked: seen?.box ?? null };
  if (census !== 1) problems.push(`the comment pad is not on the board (× ${census})`);
  if (refused) problems.push(`the desk refused the comment pad's kind (${JSON.stringify(faults)})`);
  if (seen === null || seen.tap === null) {
    problems.push(
      "the comment pad was not picked on the drawn frame where the desk receives a tap",
    );
    console.log(`SMOKE_CANVAS_PAD ${JSON.stringify(facts)}`);
    return { problems, typed: false };
  }
  // THE PAD BROUGHT TO THE MIDDLE AND WHEELED IN, by the desk's own input: a drag on the bare mat pans it (the select
  // tool pans the bare mat, DK-D29) until the pad's centre is the window's — at the arrival a pad may lie under the
  // head's strip — then the plain wheel, about the pad's centre (it zooms about the pointer), a step at a time until
  // the pad is about two thirds of the window tall. Chromium's wheel sign is the reverse of the DOM's: the row reads
  // the pad's box after its first step and turns the wheel the other way if the pad got smaller.
  const view = await js<{ w: number; h: number }>("({ w: innerWidth, h: innerHeight })");
  const centreOf = (s: PadOnScreen) => ({
    x: (s.box.x0 + s.box.x1) / 2,
    y: (s.box.y0 + s.box.y1) / 2,
  });
  const height = (s: PadOnScreen | null): number => (s === null ? 0 : s.box.y1 - s.box.y0);
  const pans: {
    from: { x: number; y: number };
    by: { dx: number; dy: number };
    padAfter?: { x: number; y: number };
  }[] = [];
  for (let i = 0; i < 3 && seen !== null; i += 1) {
    const c = centreOf(seen);
    const by = { dx: view.w / 2 - c.x, dy: view.h / 2 - c.y };
    if (Math.hypot(by.dx, by.dy) < 24) break;
    const from = await bareMatPoint(win);
    if (from === null) break;
    await dragFrom(win, from, by);
    seen = await padOnScreen(win);
    pans.push({ from, by, ...(seen === null ? {} : { padAfter: centreOf(seen) }) });
  }
  facts.panned = pans;
  if (seen === null) {
    problems.push("the comment pad left the view when the mat was panned");
    console.log(`SMOKE_CANVAS_PAD ${JSON.stringify(facts)}`);
    return { problems, typed: false };
  }
  const at = centreOf(seen);
  const step = async (dir: number): Promise<PadOnScreen | null> => {
    win.webContents.sendInputEvent({
      type: "mouseWheel",
      x: at.x,
      y: at.y,
      deltaX: 0,
      deltaY: 120 * dir,
    });
    await sleep(300); // the camera settles (its spring)
    return padOnScreen(win);
  };
  const before = height(seen);
  const target = view.h * 0.66;
  let after = await step(1);
  let steps = 1;
  const dir = height(after) >= before ? 1 : -1;
  if (dir < 0) {
    after = await step(-1);
    steps += 1;
  }
  while (after !== null && height(after) < target && steps < 16) {
    after = await step(dir);
    steps += 1;
  }
  facts.zoomed = { before, after: height(after), steps };
  if (after === null) {
    problems.push("the comment pad left the view when it was wheeled in over");
    console.log(`SMOKE_CANVAS_PAD ${JSON.stringify(facts)}`);
    return { problems, typed: false };
  }
  seen = after;
  if (height(seen) <= before)
    problems.push(`the wheel did not zoom in over the pad (${JSON.stringify(facts.zoomed)})`);
  // A TAP on the pad's first writing line (under its binding — pad units 24 + 8 + the hand's 17, of its 280), where
  // the desk receives it: the editor is lent to the pad's text part, the caret where the tap fell
  const tap = {
    x: (seen.box.x0 + seen.box.x1) / 2,
    y: seen.box.y0 + ((24 + 8 + 12) / 284.5) * (seen.box.y1 - seen.box.y0),
  };
  facts.tap = tap;
  win.webContents.sendInputEvent({
    type: "mouseDown",
    x: tap.x,
    y: tap.y,
    button: "left",
    clickCount: 1,
  });
  win.webContents.sendInputEvent({
    type: "mouseUp",
    x: tap.x,
    y: tap.y,
    button: "left",
    clickCount: 1,
  });
  await waitForRendererFact(
    win,
    "the desk's editor lent to the comment pad",
    10_000,
    `document.activeElement?.hasAttribute("data-desk-editor") === true && document.activeElement.getAttribute("aria-label") === "write on the comment pad"`,
    `({ active: document.activeElement?.tagName ?? null, label: document.activeElement?.getAttribute("aria-label") ?? null })`,
  );
  // THE LINE, a character at a time — an editor types from `char`
  for (const ch of PAD_LINE) {
    win.webContents.sendInputEvent({ type: "char", keyCode: ch });
    await sleep(15);
  }
  // the session's end: 1 s without input commits ONE transaction — the line in the pad's cell
  await waitForRendererFact(
    win,
    "the typed line landing in the comment pad's ink cell",
    15_000,
    `globalThis.__vfDesk.objects(${JSON.stringify(type)})[0]?.props.text === ${JSON.stringify(PAD_LINE)}`,
    `globalThis.__vfDesk.objects(${JSON.stringify(type)}).map((o) => o.props.text)`,
  );
  const landedAt = await js<number>("Date.now()");
  // …and saved: the board's last acknowledged save is after the line landed (the reopen reads fieldd's)
  await waitForRendererFact(
    win,
    "the board's save after the line",
    20_000,
    `(() => { const b = globalThis.__vfDesk.board(); return b.state === "live" && (b.lastSavedAt ?? 0) >= ${landedAt}; })()`,
    "globalThis.__vfDesk.board()",
  );
  facts.typed = PAD_LINE;
  facts.saved = await js("globalThis.__vfDesk.board()");
  // THE STILLS: the pad with its line and its caret, by day and by night (the window, cut to the pad)
  for (const name of ["light", "dark"] as const) {
    await js(`globalThis.vibefield.theme.set(${JSON.stringify(name)})`);
    await waitForRendererFact(
      win,
      `the desk dressed ${name}`,
      10_000,
      `globalThis.__vfDesk.theme() === ${JSON.stringify(name)}`,
    );
    await waitForFrameDrawn(win, `a frame drawn ${name}`);
    await sleep(400);
    if (shotDir !== undefined) {
      const m = 40;
      const rect = {
        x: Math.max(0, Math.floor(seen.box.x0 - m)),
        y: Math.max(0, Math.floor(seen.box.y0 - m)),
        width: Math.ceil(seen.box.x1 - seen.box.x0 + 2 * m),
        height: Math.ceil(seen.box.y1 - seen.box.y0 + 2 * m),
      };
      mkdirSync(shotDir, { recursive: true });
      writeFileSync(join(shotDir, `dk-8-pad-${name}.png`), (await win.capturePage(rect)).toPNG());
    }
  }
  // let it go: Escape is the lease's (the keymap stands down while the editor holds the focus)
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await waitForRendererFact(
    win,
    "the desk's editor let go",
    10_000,
    `document.activeElement?.hasAttribute("data-desk-editor") !== true`,
  );
  console.log(`SMOKE_CANVAS_PAD ${JSON.stringify(facts)}`);
  return { problems, typed: true };
}

/**
 * DK-8 — THE PAD'S LINE SURVIVES A REOPEN: after the retry row's reload (the renderer REPLACED — the window
 * reopens its own board from fieldd, `vf-window-doc`), the comment pad is on the board once and its cell holds
 * the line the pad row typed — what fieldd kept, not what the old renderer held.
 */
async function commentPadReopenRow(win: BrowserWindow): Promise<string[]> {
  const type = CANVAS_CENSUS.commentPad;
  try {
    await waitForRendererFact(
      win,
      "the comment pad's line after the reopen",
      20_000,
      `globalThis.__vfDesk?.objects(${JSON.stringify(type)})[0]?.props.text === ${JSON.stringify(PAD_LINE)}`,
      `globalThis.__vfDesk?.objects(${JSON.stringify(type)}).map((o) => o.props.text) ?? null`,
    );
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  const props = await padProps(win);
  console.log(
    `SMOKE_CANVAS_PAD_REOPEN ${JSON.stringify({ census: props?.length ?? 0, text: props?.[0]?.text ?? null })}`,
  );
  return props?.length === 1 ? [] : [`the reopened board holds ${props?.length ?? 0} comment pads`];
}

/** The stage's unavailable card (DESIGN.md §8 "When the desk can't draw") — what every GPU-OFF
 * smoke now asserts where the desk cannot draw (DK-3; r6b risk 1): the card in the DOM, its words
 * and ICE's message, and the window still alive. Returns the card's account of itself. */
export async function expectDeskUnavailableCard(
  win: BrowserWindow,
  timeoutMs = 30_000,
): Promise<{ kind: string; title: string; detail: string | null; reload: boolean }> {
  await waitForRendererFact(
    win,
    "the desk's unavailable card",
    timeoutMs,
    'document.querySelector("[data-desk-unavailable]") !== null',
    '({ desk: document.querySelector("[data-desk]")?.getAttribute("data-desk") ?? null, status: globalThis.__vfDesk?.status() ?? null })',
  );
  return (await win.webContents.executeJavaScript(
    `(() => {
      const card = document.querySelector("[data-desk-unavailable]");
      return {
        kind: card.getAttribute("data-desk-unavailable"),
        title: card.querySelector("strong")?.textContent ?? "",
        detail: card.querySelector(".vf-ui-unavailable-state__detail")?.textContent ?? null,
        reload: [...card.querySelectorAll("button")].some((b) => b.textContent === "Reload"),
      };
    })()`,
    true,
  )) as { kind: string; title: string; detail: string | null; reload: boolean };
}

/** Full spine + real renderer: pass iff the canvas reports in WITH its census AND the desk
 * gives its verdict (DK-3). GPU ON (the default since DK-3 — main keeps hardware acceleration
 * for this mode): DESK_READY (device, passes, first frame presented) after CANVAS_READY, a
 * NON-UNIFORM still read back through the capture door, the seed's census, the plates and the
 * faces loaded under the packaged CSP with no violation said, the theme flipping the desk, and a
 * cover PARKING it (`submits()` and `perf().frames` unmoved while the desk was made busy first).
 * DK-4: the desk IDLE at zero submits with the frame's chrome over it (the line focused), and the
 * fields explorer showing the board's STILL — a `blob:` image the packaged CSP now admits.
 * GPU OFF (`--disable-gpu`, the smokes' mode): the unavailable card, in ICE's words, and the
 * window alive. `VF_SMOKE_SHOT_DIR` keeps the window's stills (`dk-3-desk-{light,dark}.png`,
 * `dk-4-explorer-{light,dark}.png`). DK-5: on the run's OWN profile (`smokeProfileFailures`) —
 * what the rows write (the theme file, the stills, the print's bytes) is never put back.
 * Teardown runs on EVERY path — the old failure path leaked the spawned daemons (slice-0
 * finding 3). */
export async function runSmokeCanvas(opts: {
  handle: FielddHandle;
  supervisor: FielddSupervisor;
  root: string;
  registry: WindowRegistry;
  preloadPath: string;
  viteUrl: string;
  beforeExit: () => Promise<void>;
  onWindow?: (window: BrowserWindow) => void;
}): Promise<void> {
  const gpu = !process.argv.includes("--disable-gpu");
  // DK-16: the GPU kept and the page given no `navigator.gpu` (`--smoke-no-webgpu`, as a remote desktop has none —
  // smoke-unavailable.ts `withoutWebgpu`): the desk's NO-WEBGPU card, never retried — a run of its own beside
  // `--disable-gpu`'s no-adapter card
  const noWebgpu = process.argv.includes(NO_WEBGPU_FLAG);
  const shotDir = process.env["VF_SMOKE_SHOT_DIR"];
  // DK-9: a run staged with the fault fixture (`smoke:kind-faults`) runs the kind-fault rows
  const faultRun = process.env["VF_SMOKE_KIND_FAULTS"] === "1";
  // Shown with the GPU on: a still of the window (the desk under the frame) is the grader's, and
  // a shown window is what the desk's frame loop and the capture door are made for. DK-18 (36): shown
  // inactive and click-through — kept from the person's input (smoke-window.ts).
  const win = smokeWindow({
    mode: "smoke-canvas",
    preloadPath: opts.preloadPath,
    show: gpu,
  });
  opts.registry.adopt(win); // the bootstrap sender policy admits only registered windows
  opts.onWindow?.(win);
  // The godview smoke has had this since GT-2; the canvas smoke wanted it the
  // first time its renderer failed to report (P8b-3). Without it a boot-time
  // renderer error reads only as "no CANVAS_READY within 45s", which names the
  // symptom and hides every cause.
  if (process.env["VF_SMOKE_DEBUG"]) {
    win.webContents.on("console-message", (...args: unknown[]) => {
      console.log(`[renderer] ${args.map((a) => JSON.stringify(a)).join(" ")}`);
    });
  }
  // The packaged CSP is this mode's too (main/security-policy.ts: every non-dev mode), and a
  // refusal is said on the console — so anything that took a forbidden road shows here: the desk's
  // plates (`connect-src`, a fetch), its faces (`font-src`), its bundled modules (`script-src`),
  // and since DK-4 the explorer's stills (`img-src`, the renderer's own `blob:` URLs — admitted
  // deliberately). EVERY refusal fails the run: none is left to be noted and judged elsewhere.
  const cspViolations: string[] = [];
  win.webContents.on("console-message", (...args: unknown[]) => {
    for (const a of args) {
      const text = consoleText(a);
      if (!text.includes("Content Security Policy")) continue;
      cspViolations.push(text.replace(/blob:[^'"\s]+/gu, "blob:…").slice(0, 240));
    }
  });
  // The desk's verdicts in the order said (DK-5): GPU-less, the boot's no-adapter is retried ONCE
  // (the relaunch heal) before the card — DESK_RETRY, then DESK_UNAVAILABLE.
  const deskSaid = deskMarkerLog(win);
  let ok = false;
  if (process.argv.includes(TRY_FLAG)) {
    // DK-10 — THE TRY BOARD (`vibefield-plugin try`, `pnpm smoke:plugin`): a plugin author's kinds alone on a fresh
    // board, each held DRAWN, the stills theirs (smoke-try.ts) — none of the canvas witnesses below
    try {
      const { types, from } = tryTypes(process.env);
      if (types.length === 0) {
        throw new Error(
          from === "env"
            ? `${TRY_TYPES_ENV} names no object type`
            : "no object type to try: FIELDD_PLUGIN_DEV_ROOTS holds no plugin whose manifest declares contributes.objects",
        );
      }
      console.log(`SMOKE_TRY ${JSON.stringify({ types, from, gpu })}`);
      const canvasReady = waitForConsole(win, "CANVAS_READY ", 45_000);
      const deskVerdict = waitForConsole(win, gpu ? "DESK_READY " : "DESK_UNAVAILABLE ", 60_000);
      await loadRenderer(win, "smoke-canvas", opts.viteUrl, { [TRY_SEARCH_KEY]: types.join(",") });
      console.log(`SMOKE_CANVAS ${await canvasReady}`);
      const problems = [...smokeProfileFailures()];
      const verdict = await deskVerdict;
      console.log(`SMOKE_CANVAS_DESK ${gpu ? "DESK_READY" : "DESK_UNAVAILABLE"} ${verdict}`);
      deskSaid.stop();
      if (!gpu)
        problems.push("the try board needs the GPU: a kind draws only on the host's device");
      else problems.push(...(await tryBoardRows(win, types, shotDir, (line) => console.log(line))));
      if (cspViolations.length > 0) problems.push(`CSP refused: ${cspViolations.join(" | ")}`);
      if (problems.length > 0) throw new Error(problems.join(" · "));
      ok = true;
      console.log("SMOKE_TRY_OK");
    } catch (e) {
      console.error(`SMOKE_TRY failed: ${e instanceof Error ? e.message : e}`);
    }
    await teardown(opts.supervisor, opts.root, opts.beforeExit, ok);
    app.exit(ok ? 0 : 2);
    return;
  }
  try {
    const canvasReady = waitForConsole(win, "CANVAS_READY ", 45_000);
    const drawing = gpu && !noWebgpu;
    const deskVerdict = waitForConsole(win, drawing ? "DESK_READY " : "DESK_UNAVAILABLE ", 60_000);
    // the first board lays the examples where the run asks (DK-8, ruling 1): the CLOCK row needs its clock. DK-16: the
    // window is loaded with the smokes' two doors of its own — the presence relay (`presenceRelay`: the PEERS rows play the
    // mesh between this window and a second) and the GPU faults (`deskFaults`: the BANNER and LOST rows)
    if (noWebgpu) await withoutWebgpu(win);
    await loadRenderer(win, "smoke-canvas", opts.viteUrl, {
      [SEED_EXAMPLES]: "1",
      presenceRelay: "1",
      deskFaults: "1",
    });
    // DK-11: the page's visibility recorder armed as the window loads — the occluded row asks whether it EVER went hidden
    await pageVisibility(win);
    const raw = await canvasReady;
    console.log(`SMOKE_CANVAS ${raw}`);
    const problems = [...smokeProfileFailures(), ...censusFailures(JSON.parse(raw) as CanvasFacts)];
    const verdict = await deskVerdict;
    console.log(`SMOKE_CANVAS_DESK ${drawing ? "DESK_READY" : "DESK_UNAVAILABLE"} ${verdict}`);
    if (drawing) problems.push(...(await deskBootRow(win, [...deskSaid.said])));
    problems.push(...(await deskSeedFailures(win)));
    problems.push(...(await exampleClockRow(win, drawing)));
    if (noWebgpu) {
      // DK-16 — NO WEBGPU AT ALL: the card said ONCE with no retry (a page with no WebGPU cannot grow one), in the canon's
      // words with NO Reload; a cover over the desk that never drew; the card standing again (testing/smoke-unavailable.ts)
      problems.push(...(await commentPadCensusRow(win)));
      await expectDeskUnavailableCard(win);
      console.log(`SMOKE_CANVAS_MARKERS ${JSON.stringify(deskSaid.said)}`);
      deskSaid.stop();
      if (deskSaid.said.join(" ") !== "DESK_UNAVAILABLE")
        problems.push(
          `no WebGPU was said ${deskSaid.said.join(" → ")}, not the card once with no retry`,
        );
      problems.push(
        ...(await unavailableRows({
          win,
          kind: "no-webgpu",
          shot: "dk-16-card-nogpu.png",
          shotDir,
          say: (line) => console.log(line),
        })),
      );
      if (win.webContents.isCrashed()) problems.push("the renderer crashed");
    } else if (gpu) {
      problems.push(...(await deskWitnesses(win, shotDir)));
      console.log(`SMOKE_CANVAS_MARKERS ${JSON.stringify(deskSaid.said)}`);
      deskSaid.stop();
      if (faultRun) {
        // DK-9: the fault fixture's run (`smoke:kind-faults`) — the witnesses above ran with the broken kind
        // refused at the boot; the fault rows lay the broken clocks beside a drawn one. The pad's, the retry's
        // and the refusal's rows are smoke:canvas's own run.
        const fixtures = kindFixtures();
        if (fixtures?.mode !== "faults") {
          problems.push(
            "VF_SMOKE_KIND_FAULTS without the staged fault fixture (packaging/stage-kind-fixtures.mjs faults)",
          );
        } else {
          problems.push(...(await kindFaultRows(win, fixtures, shotDir)));
        }
      } else {
        // DK-11: the selection bar, its grown menu, right-click and the status line — over the first board at its
        // arrival fit, before the pad row moves the camera (testing/smoke-selection-bar.ts)
        try {
          problems.push(
            ...(await selectionBarRows({
              win,
              plugins: {
                disable: (id) => opts.handle.client.request("plugins.disable", { id }),
                enable: (id) => opts.handle.client.request("plugins.enable", { id }),
              },
              shotDir,
              say: (line) => console.log(line),
            })),
          );
        } catch (error) {
          problems.push(`DK-11: ${error instanceof Error ? error.message : String(error)}`);
        }
        // DK-12: the tools in hand — each specimen picked up, its tools used, put down; the travel's own timing
        // (testing/smoke-tools-in-hand.ts) — still at the arrival fit, before the pad row moves the camera
        try {
          problems.push(
            ...(await toolsInHandRows({ win, shotDir, say: (line) => console.log(line) })),
          );
        } catch (error) {
          problems.push(`DK-12: ${error instanceof Error ? error.message : String(error)}`);
        }
        // DK-13: the pegboard behind the line — the create and B, the filters, the keyboard's insert, the refusals, the
        // bar hidden under the board, a plugin's category off (testing/smoke-pegboard.ts)
        try {
          problems.push(
            ...(await pegboardRows({
              win,
              plugins: {
                disable: (id) => opts.handle.client.request("plugins.disable", { id }),
                enable: (id) => opts.handle.client.request("plugins.enable", { id }),
              },
              shotDir,
              say: (line) => console.log(line),
            })),
          );
        } catch (error) {
          problems.push(`DK-13: ${error instanceof Error ? error.message : String(error)}`);
        }
        // DK-18: the product desk rig's missing acts — every kind the board hangs taken off it by the pointer and dropped where
        // nothing picks, its face drawn there, one undo step back; the take's landing timed by the K-H discipline
        // (testing/smoke-desk-rig.ts)
        try {
          problems.push(...(await deskRigRows({ win, shotDir, say: (line) => console.log(line) })));
        } catch (error) {
          problems.push(`DK-18 TAKE: ${error instanceof Error ? error.message : String(error)}`);
        }
        // DK-14: Send to… — the bar's pill, the grown menu's row and the tools in hand's pill each drafting ONE chip into
        // the line: its face by kind, the flight, the @ typed, the still, the bar aside, reduced motion
        // (testing/smoke-send-to.ts) — still at the arrival fit, before the pad row moves the camera
        try {
          problems.push(
            ...(await sendToRows({
              win,
              plugins: {
                disable: (id) => opts.handle.client.request("plugins.disable", { id }),
                enable: (id) => opts.handle.client.request("plugins.enable", { id }),
              },
              shotDir,
              say: (line) => console.log(line),
            })),
          );
        } catch (error) {
          problems.push(`DK-14: ${error instanceof Error ? error.message : String(error)}`);
        }
        // DK-17b: the explorer's thumbnail taken while a selection stands is the desk without its marks (ICE I40's
        // purpose; testing/smoke-thumb.ts) — an object moved, its still owed and taken, read back; the move undone
        try {
          problems.push(...(await thumbnailRows({ win, say: (line) => console.log(line) })));
        } catch (error) {
          problems.push(`DK-17b THUMB: ${error instanceof Error ? error.message : String(error)}`);
        }
        // DK-18 (plan (24)): the desk's long wake after an act named — the ambient wind, the canon's 20 s and its 2 s ease,
        // and nothing else (testing/smoke-rest.ts): with the wind stilled the desk rests at once after a move, with it by
        // the canon; a cover lowered over a still wind rests at once
        try {
          problems.push(...(await restRows({ win, say: (line) => console.log(line) })));
        } catch (error) {
          problems.push(`DK-18 REST: ${error instanceof Error ? error.message : String(error)}`);
        }
        // DK-15: the covers over the desk — Godview and History each rising over the LIVE desk, its still captured, blurred
        // once and swapped in, the canvas hidden, THEN the freeze: zero frames and zero submits for ≥ 3 s; the recede; taken
        // again on a theme change and a resize; thaw first on the way back; the lost device's ground; reduced motion
        // (testing/smoke-covers.ts)
        try {
          problems.push(...(await coverRows({ win, shotDir, say: (line) => console.log(line) })));
        } catch (error) {
          problems.push(`DK-15: ${error instanceof Error ? error.message : String(error)}`);
        }
        // DK-16: the peers on the mat — a second window's real pointer drawn in this one by face, at its place, hidden
        // idle 8 s, under the board, under a cover and when it leaves its window, the smoke playing the mesh between them;
        // then the desk's faults on its own device — a degraded desk's banner, a lost device's card, each Reload a remount
        // that draws again (testing/smoke-peers.ts)
        try {
          problems.push(
            ...(await peersRows({
              win,
              openPeer: async () => {
                const peer = smokeWindow({
                  mode: "smoke-canvas",
                  preloadPath: opts.preloadPath,
                  show: true,
                });
                opts.registry.adoptAuxiliary(peer);
                const ready = waitForConsole(peer, "DESK_READY ", 60_000);
                await loadRenderer(peer, "smoke-canvas", opts.viteUrl, { presenceRelay: "1" });
                await ready;
                await sleep(800);
                return peer;
              },
              shotDir,
              say: (line) => console.log(line),
            })),
          );
        } catch (error) {
          problems.push(`DK-16 PEERS: ${error instanceof Error ? error.message : String(error)}`);
        }
        try {
          problems.push(...(await faultRows({ win, shotDir, say: (line) => console.log(line) })));
        } catch (error) {
          problems.push(`DK-16 FAULTS: ${error instanceof Error ? error.message : String(error)}`);
        }
        // DK-8: VibeField's own kind — drawn, picked, a line typed through the desk's one editor, the board
        // saved; then the retry row REPLACES the renderer (a reload) and the pad's line must come back with it
        const pad = await commentPadRow(win, shotDir);
        problems.push(...pad.problems);
        problems.push(...(await deskRetryRow(win, opts.viteUrl)));
        if (pad.typed) problems.push(...(await commentPadReopenRow(win)));
        // DK-9: last — it leaves the desk on its card
        problems.push(...(await deskRefusalRow(win, opts.viteUrl)));
      }
    } else {
      problems.push(...(await commentPadCensusRow(win)));
      const card = await expectDeskUnavailableCard(win);
      console.log(`SMOKE_CANVAS_CARD ${JSON.stringify(card)}`);
      console.log(`SMOKE_CANVAS_MARKERS ${JSON.stringify(deskSaid.said)}`);
      // DK-9: the heal's rule — a missing adapter (no GPU at all) is retried THREE times over ~2 s,
      // each said with its attempt, then the card said once, last; ONE stage (no transient generation),
      // so four desks mounted in all
      const said = deskSaid.said;
      const retries = deskSaid.facts.filter((_, index) => said[index] === "DESK_RETRY");
      const mounts = (
        (await win.webContents.executeJavaScript(DOOR_MOUNTS, true)) as { mounts: number } | null
      )?.mounts;
      console.log(`SMOKE_CANVAS_HEAL ${JSON.stringify({ said, retries, mounts })}`);
      if (said.join(" ") !== "DESK_RETRY DESK_RETRY DESK_RETRY DESK_UNAVAILABLE") {
        problems.push(
          `the boot's no-adapter was not retried three times before the card (${said.join(" → ")})`,
        );
      }
      if (
        retries.some(
          (retry, index) =>
            retry["kind"] !== "no-adapter" || retry["attempt"] !== index + 1 || retry["of"] !== 3,
        )
      ) {
        problems.push(`the retries were ${JSON.stringify(retries)}, not no-adapter 1…3 of 3`);
      }
      if (mounts !== 4) problems.push(`the heal mounted ${mounts} desks, not 4 (the boot and 3)`);
      if (card.title.length === 0) problems.push("the unavailable card has no words");
      if (card.detail === null || card.detail.length === 0) {
        problems.push("the unavailable card does not carry ICE's message");
      }
      // DK-16: the card in the canon's words with no Reload; a cover over the desk that never drew; the card again
      problems.push(
        ...(await unavailableRows({
          win,
          kind: "no-adapter",
          shot: null,
          shotDir,
          say: (line) => console.log(line),
        })),
      );
      if (win.webContents.isCrashed()) problems.push("the renderer crashed");
    }
    // DK-18 (36): how often a smoke window became the key window — said, never judged: no row focuses one (the source row in
    // smoke-window.test.ts holds that), but the OS activates the app when another app quits, and a person may click it
    const focused = smokeWindowsFocused();
    console.log(`SMOKE_CANVAS_ISOLATION ${JSON.stringify(focused)}`);
    if (focused.times > 0)
      console.log(
        `SMOKE_CANVAS_ISOLATION_NOTE a smoke window became the key window ${focused.times} time(s) — not by a row; keys typed then could have reached it`,
      );
    if (cspViolations.length > 0) problems.push(`CSP refused: ${cspViolations.join(" | ")}`);
    if (problems.length > 0) throw new Error(problems.join(" · "));
    ok = true;
  } catch (e) {
    console.error(`SMOKE_CANVAS failed: ${e instanceof Error ? e.message : e}`);
  }
  await teardown(opts.supervisor, opts.root, opts.beforeExit, ok);
  app.exit(ok ? 0 : 2);
}

/**
 * DK-5 — THE SMOKE'S OWN PROFILE, said and held: Electron's `userData` for this run is the one
 * `main/smoke-profile.ts` gave it — handed by `packaging/run-smoke.mjs` as a fresh `--user-data-dir`
 * under the OS temp, or minted there — and never the app's shared profile, where the owner's own app
 * keeps its theme file, its renderer storage and the desk's byte store. What a smoke writes (a
 * theme, a still, a cleared localStorage) is the run's, and leaves with the profile.
 */
function smokeProfileFailures(): string[] {
  const userData = app.getPath("userData");
  const shared = sharedProfilePath(app.getPath("appData"), app.getName());
  const real = (path: string): string => (existsSync(path) ? realpathSync(path) : path);
  const underTemp = `${real(userData)}/`.startsWith(`${real(tmpdir())}/`);
  console.log(`SMOKE_PROFILE ${JSON.stringify({ userData, underTemp, shared })}`);
  return real(userData) === real(shared)
    ? [`the smoke ran on the app's shared profile (${shared})`]
    : [];
}

/** The GPU-on rows (DK-3, DK-4), each a fact read off the desk through `window.__vfDesk`. */
async function deskWitnesses(win: BrowserWindow, shotDir: string | undefined): Promise<string[]> {
  const problems: string[] = [];
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;

  // A PIXEL: the last presented frame read back through the capture door — the mat, its rulers
  // and the seeded kinds are anything but one colour.
  const sample = await js<DeskSampleFacts | null>("globalThis.__vfDesk.sample()");
  console.log(`SMOKE_CANVAS_PIXEL ${JSON.stringify(sample)}`);
  if (sample === null) problems.push("the capture door answered nothing");
  else if (sample.colors < 2 || sample.lumaMax <= sample.lumaMin) {
    problems.push(`the desk's still is uniform (${JSON.stringify(sample)})`);
  }

  // THE PACKAGED CSP: the plates set and every face loaded by the roads it admits.
  const assets = await js<{ plates: boolean; faces: Record<string, boolean>; blobs: string }>(
    `(async () => {
      const d = globalThis.__vfDesk;
      const deadline = Date.now() + 10000;
      let a = await d.assets();
      while (!a.plates && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 100)); a = await d.assets(); }
      return a;
    })()`,
  );
  console.log(`SMOKE_CANVAS_ASSETS ${JSON.stringify(assets)}`);
  if (!assets.plates) problems.push("the gobo plates never reached the mat");
  const unloaded = Object.entries(assets.faces).filter(([, loaded]) => !loaded);
  if (unloaded.length > 0) {
    problems.push(`faces not loaded: ${unloaded.map(([name]) => name).join(", ")}`);
  }

  // THE THEME: the app's one owner (main) moves, and the desk is re-dressed — its still changes,
  // darker by night. The window's stills are kept here for the grader. Nothing is put back: the
  // theme file main writes is this run's own profile's (DK-5), and leaves with it.
  const dressed = async (name: "light" | "dark"): Promise<DeskSampleFacts | null> => {
    await js(`globalThis.vibefield.theme.set(${JSON.stringify(name)})`);
    await waitForRendererFact(
      win,
      `the desk dressed ${name}`,
      10_000,
      `globalThis.__vfDesk.theme() === ${JSON.stringify(name)}`,
    );
    await waitForFrameDrawn(win, `a frame drawn ${name}`);
    await sleep(400);
    if (shotDir !== undefined) {
      mkdirSync(shotDir, { recursive: true });
      writeFileSync(join(shotDir, `dk-3-desk-${name}.png`), (await win.capturePage()).toPNG());
    }
    return js<DeskSampleFacts | null>("globalThis.__vfDesk.sample()");
  };
  const light = await dressed("light");
  const dark = await dressed("dark");
  console.log(`SMOKE_CANVAS_THEME ${JSON.stringify({ light, dark })}`);
  if (light === null || dark === null) problems.push("no still to compare the themes by");
  else if (dark.lumaMean >= light.lumaMean) {
    problems.push(`the desk did not darken by night (${light.lumaMean} → ${dark.lumaMean})`);
  }

  // THE FREEZE UNDER A COVER (FR-1's `engine.frame.freeze("cover")`): the wind made to blow first
  // (`ambient("live")`), so the desk is BUSY and frames move — then a covered view parks it: not one
  // frame, not one submit, for a whole second. Back to Canvas, it draws again.
  // DK-11: each counted second judged on a VISIBLE page (smoke-visibility.ts) — never read through an occluded blink
  const busyDrawn = await drawnWindow(win, "the freeze row's busy second");
  await js(`globalThis.__vfDesk.ambient("live")`);
  const busy0 = await deskCounters(win);
  await sleep(500);
  const busy1 = await deskCounters(win);
  const busyHidden = await windowHidden(win, "the freeze row's busy second", busyDrawn);
  await js(`globalThis.vibefield.view.set("history")`);
  await waitForRendererFact(
    win,
    "the cover over the canvas",
    10_000,
    `document.querySelector('.field-scene[data-covered="true"]') !== null`,
  );
  // the freeze walks its settle, then PARKS (ICE frame-control): the parked second starts AT the park — the gate's own
  // word, never a fixed delay after the cover shows, which a late freeze (its passive effect behind a slow paint) or a
  // stalled frame outlasts (DK-10b, grade 2: the settle step landed inside the second — one frame, one submit) — and
  // since DK-17b the word as the gate ANNOUNCES it (ICE I41, `frame.onParked`: as the settle walk's last step ENDS)
  await waitForPark(win, "the desk parked under the cover", 10_000);
  const parkedDrawn = await drawnWindow(win, "the freeze row's parked second");
  const parkedA = await stillnessSample(win);
  await sleep(1000);
  const parkedB = await stillnessSample(win);
  const parkedHidden = await windowHidden(win, "the freeze row's parked second", parkedDrawn);
  const parked0 = countersOf(parkedA);
  const parked1 = countersOf(parkedB);
  await js(`globalThis.vibefield.view.set("canvas")`);
  const thawDrawn = await drawnWindow(win, "the freeze row's thaw");
  await sleep(700);
  const thawed = await deskCounters(win);
  const thawHidden = await windowHidden(win, "the freeze row's thaw", thawDrawn);
  await js(`globalThis.__vfDesk.ambient("idle")`);
  // what reached the parked desk in its second — a presence tick, a world write — and drew nothing (DK-10b)
  const parkedWakes = movedBy(parkedA, parkedB).wakes;
  const freeze = { busy0, busy1, parked0, parked1, parkedWakes, thawed };
  console.log(`SMOKE_CANVAS_FREEZE ${JSON.stringify(freeze)}`);
  if (busyHidden !== null) problems.push(busyHidden);
  else if (busy1.frames <= busy0.frames) problems.push("the desk was not busy before the cover");
  if (parkedHidden !== null) problems.push(parkedHidden);
  else if (parked1.frames !== parked0.frames || parked1.submits !== parked0.submits) {
    problems.push(
      `a cover did not park the desk (${JSON.stringify({ parked0, parked1, movedBy: movedBy(parkedA, parkedB) })})`,
    );
  }
  if (thawHidden !== null) problems.push(thawHidden);
  else if (thawed.frames <= parked1.frames)
    problems.push("the desk did not draw again after the cover");

  // the explorer's still FIRST: a still is owed after the board's save and taken at the desk's first
  // rest or at a cover's edge — here as the freeze row's cover rose, never under the parked cover
  // (DK-10b) — and its capture submits GPU work, so the idle row waits until it has been taken
  problems.push(...(await explorerStillRow(win, shotDir)));
  problems.push(...(await deskIdleRow(win)));
  // DK-17b (ICE I43): the lone desk at rest, ≥ 6.2 s — no presence wake (before the peers' rows open a second window)
  problems.push(...(await presenceRestRow(win)));
  // the desk at rest: both captures below read the same last frame
  problems.push(...(await quarterStillRow(win)));
  // DK-11: last, with the wind — a window laid over ours, on purpose, and the desk still drawing
  const occluded = await occludedRow(win);
  console.log(`SMOKE_CANVAS_OCCLUDED ${JSON.stringify(occluded.facts)}`);
  problems.push(...occluded.problems);
  return problems;
}

/**
 * DK-11 — A COVERED WINDOW KEEPS DRAWING (the grade's fix 2, its permanent witness): another window laid over ours — as
 * another lane's windows land on a shared screen — on purpose: an opaque, frameless, never-focused window over the smoke
 * window's frame and a margin, the wind blowing. The page must stay VISIBLE — not one non-visible transition in the covered
 * window, nor at any time since the window loaded (the recorder is armed at the load) — and the desk keep drawing (≥ 10 frames
 * in 1.5 s). The gated modes keep the page visible whole (`mainWindowPreferences`). Without that, DK-9's switches alone let a
 * new window's page blink `hidden` for about a second ONCE, early in its life, covered or not (measured on Electron 43.1.1:
 * a later cover no longer blinks) — the blink a frame-counting row read as zero one run in two; this row asks for the whole
 * life, so it fails with the named cause every time.
 */
async function occludedRow(win: BrowserWindow): Promise<{ facts: object; problems: string[] }> {
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const row = "the occluded row";
  const drawn = await drawnWindow(win, row);
  if ("problem" in drawn) return { facts: { drawn: false }, problems: [drawn.problem] };
  const under = win.getBounds();
  const margin = 24;
  const occluder = new BrowserWindow({
    x: under.x - margin,
    y: under.y - margin,
    width: under.width + 2 * margin,
    height: under.height + 2 * margin,
    show: false,
    frame: false,
    focusable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: "#000000",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  // DK-18 (36): the person's pointer passes through the black square too
  keepFromPerson(occluder);
  try {
    await js(`globalThis.__vfDesk.ambient("live")`);
    occluder.showInactive();
    // the window server lays the occlusion down a moment after the show (measured: ~0.3 s)
    await sleep(300);
    const over = occluder.getBounds();
    const covers =
      occluder.isVisible() &&
      over.x <= under.x &&
      over.y <= under.y &&
      over.x + over.width >= under.x + under.width &&
      over.y + over.height >= under.y + under.height;
    const a = await deskCounters(win);
    await sleep(1_500);
    const b = await deskCounters(win);
    const end = await pageVisibility(win);
    const frames = b.frames - a.frames;
    const hidden = hiddenDuring(row, drawn.start, end) ?? hiddenSinceLoad(row, end);
    const problems: string[] = [];
    if (!covers)
      problems.push(
        `${row}: the occluder did not cover the window (${JSON.stringify({ under, over, visible: occluder.isVisible() })})`,
      );
    if (hidden !== null) problems.push(hidden);
    else if (frames < 10)
      problems.push(
        `${row}: a covered window drew ${frames} frames in 1.5 s with the wind blowing`,
      );
    return {
      facts: { covers, under, over, visibility: { start: drawn.start, end }, frames },
      problems,
    };
  } finally {
    occluder.destroy();
    await js(`globalThis.__vfDesk.ambient("idle")`);
  }
}

/** The desk's verdict markers (`DESK_RETRY`, `DESK_READY`, `DESK_UNAVAILABLE`) as a window says
 * them, in order — the marker names only; `stop()` ends the listening. */
function deskMarkerLog(win: BrowserWindow): {
  readonly said: string[];
  /** Each marker's payload, in the order said (DK-9: a retry's `kind`, `attempt` and `of`). */
  readonly facts: Record<string, unknown>[];
  stop(): void;
} {
  const said: string[] = [];
  const facts: Record<string, unknown>[] = [];
  const listen = (...args: unknown[]): void => {
    // ONE line per event: Electron hands both the event (carrying `message`) and the positional
    // message, so reading every argument would count each line twice
    const text = args.map(consoleText).find((candidate) => candidate.length > 0) ?? "";
    const match = /^(DESK_(?:RETRY|READY|UNAVAILABLE)) (.*)$/su.exec(text);
    if (match?.[1] === undefined) return;
    said.push(match[1]);
    try {
      facts.push(JSON.parse(match[2] ?? "{}") as Record<string, unknown>);
    } catch {
      facts.push({});
    }
  };
  win.webContents.on("console-message", listen);
  return { said, facts, stop: () => win.webContents.off("console-message", listen) };
}

/** The desks this renderer mounted (DK-9 — `window.__vfDesk.mounts()`), and the mounted one's facts. */
const DOOR_MOUNTS =
  "(() => { const d = globalThis.__vfDesk; return d === undefined ? null : { mounts: d.mounts(), generation: d.generation, mount: d.mount, boot: d.perf().boot }; })()";

/**
 * DK-9 — ONE DESK PER LAUNCH (the plan's Phase 3 input (1)): the stage WAITS for the board, so the
 * launch mounts no desk for the transient generation 0 — no device acquired and dropped, no retry said
 * for a stage that never held a board — and `perf().boot` is counted ONCE: the desk that said
 * DESK_READY is this renderer's first and only (generation 1, mount 0).
 */
async function deskBootRow(win: BrowserWindow, said: readonly string[]): Promise<string[]> {
  const facts = (await win.webContents.executeJavaScript(DOOR_MOUNTS, true)) as {
    mounts: number;
    generation: number;
    mount: number;
    boot: Record<string, number>;
  } | null;
  console.log(`SMOKE_CANVAS_BOOT ${JSON.stringify({ ...facts, said })}`);
  if (facts === null) return ["no desk door after DESK_READY"];
  const problems: string[] = [];
  if (facts.mounts !== 1) {
    problems.push(
      `the launch mounted ${facts.mounts} desks — the stage must wait for the board (one per launch)`,
    );
  }
  if (facts.generation !== 1 || facts.mount !== 0) {
    problems.push(
      `the launch's desk is generation ${facts.generation} mount ${facts.mount}, not 1/0`,
    );
  }
  if (said.join(" ") !== "DESK_READY") {
    problems.push(`the launch said ${said.join(" → ")}, not one DESK_READY`);
  }
  return problems;
}

/**
 * DK-9 — THE HEAL'S ONCE (the plan's Phase 3 input (7)): a REFUSED device — an adapter lost
 * mid-request — is retried ONCE, then the card. The window reloads with the door that makes the first
 * TWO mounts' `requestDevice` reject (field/desk/desk-gpu.ts `deskRefuseDevice`): the stage must say
 * one DESK_RETRY (`refused`, attempt 1 of 1), then DESK_UNAVAILABLE with the refused card and its
 * Reload — two desks mounted, never a third.
 */
async function deskRefusalRow(win: BrowserWindow, viteUrl: string): Promise<string[]> {
  const log = deskMarkerLog(win);
  const problems: string[] = [];
  try {
    const unavailable = waitForConsole(win, "DESK_UNAVAILABLE ", 60_000);
    await loadRenderer(win, "smoke-canvas", viteUrl, { deskRefuseDevice: "2" });
    await unavailable;
    const card = await expectDeskUnavailableCard(win);
    // the retry's budget is spent at the card: wait out one more retry's length — nothing more is said
    await sleep(1_500);
    const facts = (await win.webContents.executeJavaScript(DOOR_MOUNTS, true)) as {
      mounts: number;
    } | null;
    const retries = log.facts.filter((_, index) => log.said[index] === "DESK_RETRY");
    console.log(
      `SMOKE_CANVAS_REFUSED ${JSON.stringify({ said: log.said, retries, card, mounts: facts?.mounts ?? null })}`,
    );
    if (log.said.join(" ") !== "DESK_RETRY DESK_UNAVAILABLE") {
      problems.push(`a refused device said ${log.said.join(" → ")}, not one retry then the card`);
    }
    const retry = retries[0];
    if (retry?.["kind"] !== "refused" || retry["attempt"] !== 1 || retry["of"] !== 1) {
      problems.push(`the refused device's retry was ${JSON.stringify(retry)}, not refused 1 of 1`);
    }
    if (card.kind !== "refused" || !card.reload) {
      problems.push(`the refused card was ${JSON.stringify(card)}, not refused with its Reload`);
    }
    if (facts?.mounts !== 2) problems.push(`a refused device made ${facts?.mounts} mounts, not 2`);
  } finally {
    log.stop();
  }
  return problems;
}

/**
 * DK-5 — THE RELAUNCH HEAL, forced (the plan's T8): a desk whose device never arrived at boot is
 * retried once by the stage, a second later — Chromium's GPU process can be late — before any
 * card. The window reloads with the door that makes the boot's FIRST adapter request answer null
 * (field/desk/desk-gpu.ts `deskRefuseFirstDevice`): the stage must say DESK_RETRY, say no card,
 * and draw on its retry's mount (DESK_READY with `mount: 1`).
 */
async function deskRetryRow(win: BrowserWindow, viteUrl: string): Promise<string[]> {
  const log = deskMarkerLog(win);
  const problems: string[] = [];
  try {
    const ready = waitForConsole(win, "DESK_READY ", 60_000);
    await loadRenderer(win, "smoke-canvas", viteUrl, { deskRefuseFirstDevice: "1" });
    const facts = JSON.parse(await ready) as { mount: number; boot: Record<string, number> };
    const card = (await win.webContents.executeJavaScript(
      'document.querySelector("[data-desk-unavailable]") !== null',
      true,
    )) as boolean;
    console.log(`SMOKE_CANVAS_RETRY ${JSON.stringify({ said: log.said, ready: facts, card })}`);
    if (log.said[0] !== "DESK_RETRY") {
      problems.push(`the refused boot was not retried first (${log.said.join(" → ")})`);
    }
    if (log.said.includes("DESK_UNAVAILABLE")) problems.push("the card was said before the retry");
    if (facts.mount !== 1) problems.push(`the desk drew on mount ${facts.mount}, not the retry's`);
    if (card) problems.push("the unavailable card is in the DOM after the retry drew");
  } finally {
    log.stop();
  }
  return problems;
}

/** The composer line's editor — the frame's chrome a person types into over the desk. */
const LINE_INPUT = ".vf-line-input";

/**
 * DK-6 — THE EXPLORER'S QUARTER STILL IS THE DESK, SMALLER (ICE petition I29, fixed in 0.15.0-desk.2):
 * the capture door at the explorer's own ask (`scale: 0.25`, a device ratio of 0.5 at dpr 2) held to
 * the 1× still brought down to the same size — at desk.1 the quarter dropped every card kind (the note,
 * the mini mat, the whiteboard, the print: whole regions of mat where they lie); now the two agree but
 * for resampling. Both read the same last frame (the desk at rest), compared in the renderer as numbers:
 * the mean of each pixel's largest channel difference, and the share of pixels that differ by more
 * than a quarter of the range.
 */
async function quarterStillRow(win: BrowserWindow): Promise<string[]> {
  const facts = (await win.webContents.executeJavaScript(
    `(async () => {
      const d = globalThis.__vfDesk;
      const quarter = await d.capture({ scale: 0.25 });
      const whole = await d.capture({ scale: 1 });
      if (quarter === undefined || whole === undefined) { quarter?.close(); whole?.close(); return null; }
      const w = quarter.width, h = quarter.height, wholeSize = [whole.width, whole.height];
      const read = (bitmap) => {
        const c = new OffscreenCanvas(w, h);
        const x = c.getContext("2d");
        x.imageSmoothingQuality = "high";
        x.drawImage(bitmap, 0, 0, w, h);
        return x.getImageData(0, 0, w, h).data;
      };
      const a = read(quarter), b = read(whole);
      quarter.close(); whole.close();
      let sum = 0, far = 0;
      for (let i = 0; i < a.length; i += 4) {
        const diff = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
        sum += diff;
        if (diff > 64) far += 1;
      }
      return { size: [w, h], whole: wholeSize, meanDiff: sum / (w * h), farShare: far / (w * h) };
    })()`,
    true,
  )) as { size: number[]; whole: number[]; meanDiff: number; farShare: number } | null;
  console.log(`SMOKE_CANVAS_QUARTER ${JSON.stringify(facts)}`);
  if (facts === null) return ["the capture door gave no quarter or no whole still"];
  return facts.meanDiff > QUARTER_STILL.meanDiff || facts.farShare > QUARTER_STILL.farShare
    ? [`the quarter still is not the desk brought down (${JSON.stringify(facts)})`]
    : [];
}

/** How far the quarter still may stand from the 1× still brought down — resampling's own difference
 * (measured on this desk: see the commit), well under a card kind missing from it. */
const QUARTER_STILL = { meanDiff: 6, farShare: 0.02 } as const;

/**
 * DK-4 — THE DESK IDLES AT ZERO SUBMITS with the frame's chrome over it (plan §9 Phase 2's witness):
 * the line focused (its caret is the DOM's, never the desk's), the wind let settle, the engine's loop
 * at rest — then not one submit and not one frame for two whole seconds, the line still focused.
 */
async function deskIdleRow(win: BrowserWindow): Promise<string[]> {
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const focused = await js<boolean>(
    `(() => { const line = document.querySelector(${JSON.stringify(LINE_INPUT)}); line?.focus(); return line !== null && document.activeElement === line; })()`,
  );
  // the two seconds are taken clear of the example clock's minute turn (DK-6), so the zero is still the whole
  // witness: not a frame, not a submit, between the wakes — and a window a person's input moved is taken again (DK-10b)
  const { rest0, rest1, disturbed, moved, hidden, input } = await deskRestWindow(win, () =>
    waitForRendererFact(
      win,
      "the desk at rest",
      45_000,
      "globalThis.__vfDesk.rest().asleep === true",
      "globalThis.__vfDesk.rest()",
    ),
  );
  const stillFocused = await js<boolean>(
    `document.activeElement === document.querySelector(${JSON.stringify(LINE_INPUT)})`,
  );
  const outside = disturbed.length > 0 ? { disturbed } : {};
  console.log(
    `SMOKE_CANVAS_IDLE ${JSON.stringify({ focused, stillFocused, rest0, rest1, input, ...outside })}`,
  );
  const problems: string[] = [];
  if (!focused || !stillFocused) problems.push("the line was not focused over the resting desk");
  if (hidden !== null) problems.push(hidden);
  else if (moved !== null) {
    problems.push(
      `the desk did not idle at zero submits (${JSON.stringify({ rest0, rest1, movedBy: moved, ...outside })})`,
    );
  }
  return problems;
}

/**
 * DK-17b (ICE I43) — THE LONE DESK'S PRESENCE AT REST (testing/smoke-stillness.ts `judgePresenceRest`): the desk asleep, its
 * presence session live, no other window in its room — then ≥ 6.2 s with NO `presence` wake (DK-16 counted 2 in 6.2 s before
 * desk.6: Loro's empty timeout sweep every ttl/2, heard as a peer's arrival). The store's keepalives in the window are counted
 * off the smokes' relay door (`presenceTap`, its outbound payloads) — the proof its timers ran; the other wakes are printed.
 */
async function presenceRestRow(win: BrowserWindow): Promise<string[]> {
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const TAP = "globalThis.__vfDesk?.presenceTap?.()?.length ?? null";
  await waitForRendererFact(
    win,
    "the desk at rest",
    45_000,
    "globalThis.__vfDesk.rest().asleep === true",
    "globalThis.__vfDesk.rest()",
  );
  await js<number | null>(TAP); // what went out before the window is not the window's
  const session = await js<boolean>("globalThis.__vfDesk.peers().said !== null");
  const a = await stillnessSample(win);
  const t0 = Date.now();
  await sleep(PRESENCE_REST.windowMs);
  const b = await stillnessSample(win);
  const windowMs = Date.now() - t0;
  const keepalives = await js<number | null>(TAP);
  const moved = movedBy(a, b);
  console.log(
    `SMOKE_CANVAS_PRESENCE_REST ${JSON.stringify({ windowMs, session, keepalives, wakes: moved.wakes, rest: [countersOf(a), countersOf(b)] })}`,
  );
  return judgePresenceRest(moved, windowMs, { session, keepalives }).map(
    (p) => `PRESENCE REST: ${p}`,
  );
}

/** The open board's tile in the fields explorer — its picture, when it has one. */
const CURRENT_STILL = `.vf-head-explorer .vf-head-doc[aria-current="true"] img`;

/**
 * DK-4 — THE EXPLORER SHOWS THE DESK (DK-D27): the open board's tile wears the still its desk took
 * at rest (the capture door at a quarter scale, PNG bytes on the renderer's byte store's keyed
 * shelf), an <img> on a `blob:` URL the packaged CSP admits — the window kept, light and dark, for
 * the grader (`dk-4-explorer-{light,dark}.png`). The stills stay on the shelf: it is this run's own
 * profile's (DK-5), and they leave with it.
 */
async function explorerStillRow(
  win: BrowserWindow,
  shotDir: string | undefined,
): Promise<string[]> {
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const problems: string[] = [];
  await js(`document.querySelector('.vf-head-chev[aria-expanded="false"]')?.click()`);
  await waitForRendererFact(
    win,
    "the fields explorer open",
    10_000,
    `document.querySelector('.vf-head-chev[aria-expanded="true"]') !== null`,
  );
  await waitForRendererFact(
    win,
    "the board's still in the explorer",
    45_000,
    `[...document.querySelectorAll(${JSON.stringify(CURRENT_STILL)})].some((img) => img.src.startsWith("blob:") && img.complete && img.naturalWidth > 0)`,
    `(() => { const img = document.querySelector(${JSON.stringify(CURRENT_STILL)}); return img === null ? { img: null, tiles: document.querySelectorAll(".vf-head-doc-tile").length, rest: globalThis.__vfDesk?.rest() } : { src: img.src.slice(0, 5), complete: img.complete, width: img.naturalWidth }; })()`,
  );
  const still = await js<{ scheme: string; width: number; height: number }>(
    `(() => { const img = document.querySelector(${JSON.stringify(CURRENT_STILL)}); return { scheme: img.src.slice(0, 5), width: img.naturalWidth, height: img.naturalHeight }; })()`,
  );
  console.log(`SMOKE_CANVAS_EXPLORER ${JSON.stringify(still)}`);
  for (const name of ["light", "dark"] as const) {
    await js(`globalThis.vibefield.theme.set(${JSON.stringify(name)})`);
    await waitForRendererFact(
      win,
      `the window dressed ${name}`,
      10_000,
      `document.documentElement.getAttribute("data-theme") === ${JSON.stringify(name)} && globalThis.__vfDesk.theme() === ${JSON.stringify(name)}`,
    );
    await sleep(800); // the chrome's own transitions
    if (shotDir !== undefined) {
      mkdirSync(shotDir, { recursive: true });
      writeFileSync(join(shotDir, `dk-4-explorer-${name}.png`), (await win.capturePage()).toPNG());
    }
  }
  await js(`document.querySelector('.vf-head-chev[aria-expanded="true"]')?.click()`);
  if (still.scheme !== "blob:" || still.width <= 0) {
    problems.push(`the explorer's still is not a loaded blob: image (${JSON.stringify(still)})`);
  }
  return problems;
}

/** Poll a renderer-side expression until it answers true. On timeout the
 * FAILURE carries the last value of `diagnose` — the smoke's whole job is to
 * name where the chain stopped, not that it stopped. */
async function waitForRendererFact(
  win: BrowserWindow,
  label: string,
  timeoutMs: number,
  expression: string,
  diagnose?: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await win.webContents.executeJavaScript(expression, true)) === true) return;
    await sleep(100);
  }
  const detail =
    diagnose === undefined
      ? ""
      : ` — ${JSON.stringify(await win.webContents.executeJavaScript(diagnose, true))}`;
  throw new Error(`${label} did not happen within ${timeoutMs}ms${detail}`);
}

/** DK-17b (ICE I41) — wait for the PARK as the gate announces it (the door's `whenParked`, over `frame.onParked`), never a
 * poll of the gate's state: resolved as the settle walk's last step ends, or at once when the gate already is parked. */
async function waitForPark(win: BrowserWindow, label: string, timeoutMs: number): Promise<void> {
  const park = (await win.webContents.executeJavaScript(
    `globalThis.__vfDesk.whenParked(${timeoutMs})`,
    true,
  )) as { parked: boolean; already: boolean };
  if (park.parked) return;
  const detail = JSON.stringify(
    await win.webContents.executeJavaScript("globalThis.__vfDesk.rest()", true),
  );
  throw new Error(`${label} did not happen within ${timeoutMs}ms — ${detail}`);
}

async function waitForCondition(
  label: string,
  timeoutMs: number,
  predicate: () => boolean,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(`${label} did not happen within ${timeoutMs}ms`);
}

async function rendererConnection(win: BrowserWindow): Promise<WindowConnection> {
  return (await win.webContents.executeJavaScript(
    "globalThis.vibefield.getConnection()",
    true,
  )) as WindowConnection;
}

function waitForReplacementHandle(
  subscribe: (listener: (handle: FielddHandle) => void) => () => void,
  oldBootId: string,
  timeoutMs: number,
): Promise<FielddHandle> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stop = (): void => undefined;
    const timeout = setTimeout(() => {
      settled = true;
      stop();
      reject(new Error(`fieldd was not automatically replaced within ${timeoutMs}ms`));
    }, timeoutMs);
    stop = subscribe((candidate) => {
      if (candidate.info.bootId === oldBootId) return;
      settled = true;
      clearTimeout(timeout);
      stop();
      resolve(candidate);
    });
    // onHandle may synchronously deliver an already-current replacement.
    if (settled) stop();
  });
}

interface PluginRuntimeHealth {
  readonly fieldd: { readonly pid: number };
  readonly nativePid: number | null;
  readonly logging: Parameters<typeof loggingCensus>[1][number];
  readonly pluginLogging: Parameters<typeof loggingCensus>[1][number];
  readonly pluginRuntime: unknown;
}

interface SettledPluginRuntimeHealth {
  readonly health: PluginRuntimeHealth;
  readonly vector: CountVector;
}

interface PluginRuntimePhysicalSample extends PhysicalSoakSample {
  readonly phase: "restart" | "terminal";
  readonly bootId: string;
  readonly fielddPid: number;
  readonly nativePid: number;
  readonly rendererPids: readonly number[];
  readonly raw: Readonly<Record<string, unknown>>;
}

const PLUGIN_RUNTIME_SOAK_MAX_SAMPLE_GAP_MS = 5 * 60 * 1_000;

function rendererRuntimeVector(canvas: readonly CanvasFacts[]): CountVector {
  const windows: Record<string, unknown> = {};
  for (const [index, facts] of canvas.entries()) {
    if (facts.runtime === undefined) {
      throw new Error(`window ${index + 1} emitted no renderer runtime census`);
    }
    windows[`window${index + 1}`] = facts.runtime;
  }
  return countVector(windows, "rendererRuntime");
}

function pluginRuntimeHealth(raw: unknown): PluginRuntimeHealth {
  if (raw === null || typeof raw !== "object") throw new Error("fieldd health is not an object");
  const candidate = raw as Partial<PluginRuntimeHealth>;
  if (
    candidate.fieldd === undefined ||
    !Number.isSafeInteger(candidate.fieldd.pid) ||
    candidate.fieldd.pid <= 0 ||
    candidate.pluginRuntime === undefined
  ) {
    throw new Error("fieldd health omitted its process/runtime census");
  }
  return candidate as PluginRuntimeHealth;
}

function remoteLoggingIdle(health: PluginRuntimeHealth): boolean {
  for (const row of [health.logging, health.pluginLogging]) {
    if (row === null || row === undefined) return false;
    if ((row.queue?.records ?? -1) !== 0 || (row.queue?.bytes ?? -1) !== 0) return false;
  }
  return true;
}

async function settlePluginRuntimeHealth(
  handle: FielddHandle,
  expected?: CountVector,
): Promise<SettledPluginRuntimeHealth> {
  const deadline = Date.now() + 10_000;
  let lastFingerprint = "";
  let stableSince = Date.now();
  let last: SettledPluginRuntimeHealth | null = null;
  while (Date.now() < deadline) {
    const health = pluginRuntimeHealth(await handle.client.request("system.health"));
    const vector = countVector(health.pluginRuntime, "fieldd.pluginRuntime");
    last = { health, vector };
    const fingerprint = JSON.stringify(vector);
    if (fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint;
      stableSince = Date.now();
    }
    const expectedReached = expected === undefined || vectorMismatches(expected, vector) === 0;
    if (expectedReached && remoteLoggingIdle(health) && Date.now() - stableSince >= 500)
      return last;
    await sleep(100);
  }
  if (last === null) throw new Error("fieldd emitted no runtime health sample");
  return last;
}

interface SettledPhysicalResources {
  readonly main: ProcessResourceSample;
  readonly fieldd: ProcessResourceSample;
  readonly native: ProcessResourceSample;
  readonly electron: ElectronProcessSample;
  readonly observationWindows: number;
  readonly ranges: Readonly<Record<string, { readonly minimum: number; readonly maximum: number }>>;
}

interface PhysicalResourceObservation {
  readonly main: ProcessResourceSample;
  readonly fieldd: ProcessResourceSample;
  readonly native: ProcessResourceSample;
  readonly electron: ElectronProcessSample;
}

function medianPresent(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (present.length === 0) return null;
  return present[Math.floor(present.length / 2)]!;
}

function resourceMedian(samples: readonly ProcessResourceSample[]): ProcessResourceSample {
  return {
    pid: samples[0]!.pid,
    alive: samples.every((sample) => sample.alive),
    fds: medianPresent(samples.map((sample) => sample.fds)),
    networkSockets: medianPresent(samples.map((sample) => sample.networkSockets)),
    threads: medianPresent(samples.map((sample) => sample.threads)),
    physicalFootprintKb: null,
  };
}

function noteRange(
  ranges: Record<string, { minimum: number; maximum: number }>,
  key: string,
  values: readonly (number | null)[],
): void {
  const present = values.filter((value): value is number => value !== null);
  if (present.length > 0)
    ranges[key] = { minimum: Math.min(...present), maximum: Math.max(...present) };
}

async function samplePhysicalResourceWindow(
  windows: readonly BrowserWindow[],
  fielddPid: number,
  nativePid: number,
): Promise<SettledPhysicalResources> {
  const deadline = Date.now() + 10_000;
  let observationWindows = 0;
  let lastFingerprints: readonly string[] = [];
  while (Date.now() < deadline) {
    observationWindows += 1;
    const observations: PhysicalResourceObservation[] = [];
    for (let index = 0; index < 7; index += 1) {
      const [main, fieldd, native, electron] = await Promise.all([
        sampleProcessResources(process.pid, false),
        sampleProcessResources(fielddPid, false),
        sampleProcessResources(nativePid, false),
        sampleElectronProcesses(windows),
      ]);
      observations.push({ main, fieldd, native, electron });
      if (index < 6) await sleep(125);
    }
    const electronFingerprints = new Set(
      observations.map(({ electron }) =>
        JSON.stringify({
          processCount: electron.processCount,
          rendererPids: electron.rendererPids,
          roster: Object.entries(electron.roster).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        }),
      ),
    );
    lastFingerprints = [...electronFingerprints];
    if (electronFingerprints.size !== 1) {
      await sleep(125);
      continue;
    }
    const ranges: Record<string, { minimum: number; maximum: number }> = {};
    for (const owner of ["main", "fieldd", "native"] as const) {
      const samples = observations.map((observation) => observation[owner]);
      noteRange(
        ranges,
        `${owner}Fds`,
        samples.map((sample) => sample.fds),
      );
      noteRange(
        ranges,
        `${owner}Threads`,
        samples.map((sample) => sample.threads),
      );
      noteRange(
        ranges,
        `${owner}NetworkSockets`,
        samples.map((sample) => sample.networkSockets),
      );
    }
    const electron = observations[3]!.electron;
    return {
      main: resourceMedian(observations.map((observation) => observation.main)),
      fieldd: resourceMedian(observations.map((observation) => observation.fieldd)),
      native: resourceMedian(observations.map((observation) => observation.native)),
      electron: {
        ...electron,
        processCount: medianPresent(
          observations.map((observation) => observation.electron.processCount),
        )!,
        workingSetKb: medianPresent(
          observations.map((observation) => observation.electron.workingSetKb),
        )!,
        rendererWorkingSetKb: medianPresent(
          observations.map((observation) => observation.electron.rendererWorkingSetKb),
        )!,
      },
      observationWindows,
      ranges: Object.freeze(ranges),
    };
  }
  throw new Error(
    `Electron process roster did not settle within 10000ms: ${JSON.stringify(lastFingerprints)}`,
  );
}

function plantedMainListenerCount(): number {
  let count = 0;
  for (const event of process.eventNames()) {
    if (typeof event === "string" && event.startsWith("vf:prc6:planted:")) {
      count += process.listenerCount(event);
    }
  }
  return count;
}

function physicalSoakOptions(
  config: ReturnType<typeof pluginRuntimeSoakConfig>,
): PhysicalSoakOptions {
  const long = config.claim === "24h";
  const osMetricsAvailable = process.platform === "darwin" || process.platform === "linux";
  const requireOsMetrics = long || osMetricsAvailable;
  const noSlopeGate = Number.MAX_SAFE_INTEGER;
  const MiB = 1024 * 1024;
  return {
    warmupSamples: config.warmupSamples,
    minimumGradedSamples: config.minimumGradedSamples,
    ...(long ? { minimumDurationMs: 24 * 60 * 60 * 1_000 } : {}),
    ...(config.durationMs !== null
      ? { maximumSampleGapMs: PLUGIN_RUNTIME_SOAK_MAX_SAMPLE_GAP_MS }
      : {}),
    exactZero: PLUGIN_RUNTIME_SOAK_EXACT_KEYS,
    plateau: {
      electronProcessCount: {
        maximumAboveBaseline: 1,
        maximumGrowth: 0,
        maximumSlopePerHour: noSlopeGate,
      },
      mainFds: {
        required: requireOsMetrics,
        maximumAboveBaseline: 4,
        maximumGrowth: 2,
        maximumSlopePerHour: noSlopeGate,
      },
      mainThreads: {
        required: requireOsMetrics,
        maximumAboveBaseline: 6,
        maximumGrowth: 3,
        maximumSlopePerHour: noSlopeGate,
      },
      fielddFds: {
        required: requireOsMetrics,
        maximumAboveBaseline: 2,
        maximumGrowth: 1,
        maximumSlopePerHour: noSlopeGate,
      },
      fielddThreads: {
        required: requireOsMetrics,
        maximumAboveBaseline: 2,
        maximumGrowth: 1,
        maximumSlopePerHour: noSlopeGate,
      },
      nativeFds: {
        required: requireOsMetrics,
        maximumAboveBaseline: 2,
        maximumGrowth: 1,
        maximumSlopePerHour: noSlopeGate,
      },
      nativeThreads: {
        required: requireOsMetrics,
        maximumAboveBaseline: 2,
        maximumGrowth: 1,
        maximumSlopePerHour: noSlopeGate,
      },
      mainNetworkSockets: {
        required: requireOsMetrics,
        maximumAboveBaseline: 2,
        maximumGrowth: 1,
        maximumSlopePerHour: noSlopeGate,
      },
      fielddNetworkSockets: {
        required: requireOsMetrics,
        maximumAboveBaseline: 2,
        maximumGrowth: 1,
        maximumSlopePerHour: noSlopeGate,
      },
      nativeNetworkSockets: {
        required: requireOsMetrics,
        maximumAboveBaseline: 2,
        maximumGrowth: 1,
        maximumSlopePerHour: noSlopeGate,
      },
    },
    trend: {
      mainHeapUsedBytes: {
        maximumGrowth: long ? 32 * MiB : Number.MAX_SAFE_INTEGER,
        maximumSlopePerHour: long ? 4 * MiB : Number.MAX_SAFE_INTEGER,
      },
      mainExternalBytes: {
        maximumGrowth: long ? 32 * MiB : Number.MAX_SAFE_INTEGER,
        maximumSlopePerHour: long ? 4 * MiB : Number.MAX_SAFE_INTEGER,
      },
      electronWorkingSetKb: {
        maximumGrowth: long ? 128 * 1024 : Number.MAX_SAFE_INTEGER,
        maximumSlopePerHour: long ? 16 * 1024 : Number.MAX_SAFE_INTEGER,
      },
      rendererWorkingSetKb: {
        maximumGrowth: long ? 64 * 1024 : Number.MAX_SAFE_INTEGER,
        maximumSlopePerHour: long ? 8 * 1024 : Number.MAX_SAFE_INTEGER,
      },
      mainPhysicalFootprintKb: {
        required: long && config.footprint && process.platform === "darwin",
        maximumGrowth: long ? 64 * 1024 : Number.MAX_SAFE_INTEGER,
        maximumSlopePerHour: long ? 8 * 1024 : Number.MAX_SAFE_INTEGER,
      },
      fielddPhysicalFootprintKb: {
        required: long && config.footprint && process.platform === "darwin",
        maximumGrowth: long ? 32 * 1024 : Number.MAX_SAFE_INTEGER,
        maximumSlopePerHour: long ? 4 * 1024 : Number.MAX_SAFE_INTEGER,
      },
      nativePhysicalFootprintKb: {
        required: long && config.footprint && process.platform === "darwin",
        maximumGrowth: long ? 16 * 1024 : Number.MAX_SAFE_INTEGER,
        maximumSlopePerHour: long ? 2 * 1024 : Number.MAX_SAFE_INTEGER,
      },
    },
    ceiling: {
      systemLogBytes: { maximum: LOG_CENSUS_CEILINGS.systemBytes },
      systemLogFiles: { maximum: LOG_CENSUS_CEILINGS.systemFiles },
      pluginLogBytes: { maximum: LOG_CENSUS_CEILINGS.pluginBytes },
      pluginLogFiles: { maximum: LOG_CENSUS_CEILINGS.pluginFiles },
    },
  };
}

/** One window's desk as the door tells it (field-app field/desk/desk-door.ts `window.__vfDesk`): the
 * mount it is, its status, its boot — ms since the mount, `device`, `compiled`, `presented` (ICE I25
 * `perf().boot`) — its frames and its census. Null while no desk is mounted. */
interface DoorDesk {
  readonly generation: number;
  readonly mount: number;
  /** The desks this renderer has mounted, this one included (DK-9). */
  readonly mounts: number;
  readonly state: string;
  /** The kinds the desk draws as missing, contained (ICE I24) — absent while none. */
  readonly faults: readonly { readonly kind: string; readonly reason: string }[];
  readonly boot: Readonly<Record<string, number>>;
  readonly frames: number;
  readonly census: Record<string, number>;
}

const DOOR_DESK = `(() => {
  const d = globalThis.__vfDesk;
  if (d === undefined) return null;
  const perf = d.perf();
  const status = d.status();
  return { generation: d.generation, mount: d.mount, mounts: d.mounts(), state: status.state, faults: status.faults ?? [], boot: perf.boot, frames: perf.frames, census: d.census() };
})()`;

/** Where a window stands when it shows no desk — the stage, the document's load, the card. */
const SCENE_DIAGNOSIS = `({
  desk: document.querySelector("[data-desk]")?.getAttribute("data-desk") ?? null,
  loading: document.querySelector(".field-scene")?.getAttribute("data-doc-loading") ?? null,
  card: document.querySelector("[data-desk-unavailable]")?.getAttribute("data-desk-unavailable") ?? null,
})`;

/** DK-5 — one window's DESK across the plugin-restart soak: the board open in it (its own
 * `vf-window-doc`, sessionStorage — the window's, outliving its renderer), and the desk that holds
 * it, as its door tells it. */
interface WindowDesk {
  readonly docId: string | null;
  readonly desk: DoorDesk | null;
}

/** Each window's desk HOLDING THE SEED'S SIX — drawn (`ready`, a frame presented) and one of each
 * kind — read through the door, not the first DESK_READY line: a booting window can mount a desk
 * for the transient generation before its board opens (a warm device presents before the open
 * lands), and that desk is not the one that holds the board. */
async function windowDesks(
  windows: readonly BrowserWindow[],
  timeoutMs = 60_000,
  /** What window `index`'s board must hold (DK-9: a window's OWN census, carried across a restart); absent,
   * the seed's six, one each. */
  holds?: (index: number, census: Readonly<Record<string, number>>) => boolean,
): Promise<{ desks: WindowDesk[]; problems: string[] }> {
  const desks: WindowDesk[] = [];
  const problems: string[] = [];
  for (const [index, win] of windows.entries()) {
    const holdsTheSeed = (desk: DoorDesk | null): desk is DoorDesk =>
      desk !== null &&
      desk.state === "ready" &&
      desk.frames >= 1 &&
      desk.boot["presented"] !== undefined &&
      (holds === undefined
        ? CANVAS_CENSUS.seed.every((type) => desk.census[type] === 1)
        : holds(index, desk.census));
    const js = <T>(expression: string): Promise<T> =>
      win.webContents.executeJavaScript(expression, true) as Promise<T>;
    const deadline = Date.now() + timeoutMs;
    let desk = await js<DoorDesk | null>(DOOR_DESK);
    while (!holdsTheSeed(desk) && Date.now() < deadline) {
      await sleep(100);
      desk = await js<DoorDesk | null>(DOOR_DESK);
    }
    const docId = await js<string | null>('sessionStorage.getItem("vf-window-doc")');
    desks.push({ docId, desk });
    if (!holdsTheSeed(desk)) {
      problems.push(
        `window ${index + 1}: no desk holding ${holds === undefined ? "the seed's six" : "its board's census"} within ${timeoutMs}ms (${JSON.stringify(
          desk ?? (await js<unknown>(SCENE_DIAGNOSIS)),
        )})`,
      );
    }
  }
  return { desks, problems };
}

/** DK-9 — the plugin fixtures this run was staged with (`packaging/stage-kind-fixtures.mjs`), or null when
 * the run was not staged (the soak's lab runner: no runtime rows, only the restarts). */
interface KindFixtures {
  readonly mode: "restart" | "faults";
  readonly root: string;
  readonly clock?: string;
  readonly clockRoot?: string;
  readonly clockV2?: string;
  /** the plugin NEW to the renderers for the ENABLE row, and its one object type (a minute dial) */
  readonly fresh?: string;
  readonly freshType?: string;
  readonly broken?: readonly string[];
}

function kindFixtures(): KindFixtures | null {
  const raw = process.env["VF_KIND_FIXTURES"];
  return raw === undefined || raw.length === 0 ? null : (JSON.parse(raw) as KindFixtures);
}

/** One object type's box on the drawn frame (the desk's own pick every 8 CSS px of the view), the entity
 * and part the last pick on it answered, and how many picks it took — each one runs the kind's `hit`. */
interface ObjectBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly entity: number;
  readonly part: string;
  readonly picks: number;
}

async function objectBox(
  win: BrowserWindow,
  type: string,
  /** One object of the type (what `__vfFieldSmoke.spawnWidget` answered); absent, every object of it. */
  entity?: string,
): Promise<ObjectBox | null> {
  return (await win.webContents.executeJavaScript(
    `(() => {
      const d = globalThis.__vfDesk;
      const el = document.querySelector("[data-desk]");
      if (d === undefined || el === null) return null;
      const r = el.getBoundingClientRect();
      const only = ${JSON.stringify(entity ?? null)};
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, entity = -1, part = "", picks = 0;
      for (let y = 4; y < r.height; y += 8)
        for (let x = 4; x < r.width; x += 8) {
          const hit = d.pick({ x, y });
          if (hit === null || hit.type !== ${JSON.stringify(type)}) continue;
          if (only !== null && String(hit.entity) !== only) continue;
          picks += 1;
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
          entity = hit.entity; part = hit.part;
        }
      return x0 === Infinity ? null : { x0, y0, x1, y1, entity, part, picks };
    })()`,
    true,
  )) as ObjectBox | null;
}

/** A window's desk once it is DRAWN (ready, a frame presented) and `want` holds of it — through the door,
 * polled; a renderer mid-replacement answers nothing for a moment, which is waited out. */
async function deskWhere(
  win: BrowserWindow,
  label: string,
  want: (desk: DoorDesk) => boolean,
  timeoutMs = 60_000,
): Promise<DoorDesk> {
  const deadline = Date.now() + timeoutMs;
  let desk: DoorDesk | null = null;
  for (;;) {
    desk = await (
      win.webContents.executeJavaScript(DOOR_DESK, true) as Promise<DoorDesk | null>
    ).catch(() => null);
    if (
      desk !== null &&
      desk.state === "ready" &&
      desk.frames >= 1 &&
      desk.boot["presented"] !== undefined &&
      want(desk)
    ) {
      return desk;
    }
    if (Date.now() > deadline) {
      const scene = await (
        win.webContents.executeJavaScript(SCENE_DIAGNOSIS, true) as Promise<unknown>
      ).catch(() => null);
      throw new Error(`${label}: not within ${timeoutMs}ms (${JSON.stringify(desk ?? scene)})`);
    }
    await sleep(100);
  }
}

/** The bar's words for an object type through the door (DK-9; DK-11's five words — the bar prints them). */
async function deskWords(
  win: BrowserWindow,
  type: string,
): Promise<{ title: string; state: string | null; label: string } | null> {
  return (await win.webContents.executeJavaScript(
    `globalThis.__vfDesk?.words(${JSON.stringify(type)}) ?? null`,
    true,
  )) as { title: string; state: string | null; label: string } | null;
}

/** A rect of the view, CSS px (ICE's `CaptureRect`). */
interface ViewRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The rect a box's picks span — inside the object, every point of it picked as its type. */
const rectOf = (box: ObjectBox): ViewRect => ({
  x: box.x0,
  y: box.y0,
  width: Math.max(8, box.x1 - box.x0),
  height: Math.max(8, box.y1 - box.y0),
});

/** A rect of the last presented frame read back (the capture door at its rect): the sample's numbers and its
 * pixels' FNV-1a hash — two reads of ONE rect are the same pixels or not. */
interface BoxPixels extends DeskSampleFacts {
  readonly hash: string;
}

async function boxPixels(win: BrowserWindow, rect: ViewRect): Promise<BoxPixels | null> {
  return (await win.webContents.executeJavaScript(
    `(async () => {
      const d = globalThis.__vfDesk;
      if (d === undefined) return null;
      const bitmap = await d.capture({ rect: ${JSON.stringify(rect)} });
      if (bitmap === undefined) return null;
      const { width, height } = bitmap;
      const ctx = new OffscreenCanvas(width, height).getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const data = ctx.getImageData(0, 0, width, height).data;
      const colors = new Set();
      let h = 0x811c9dc5, min = 255, max = 0, sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i], g = data[i + 1], b = data[i + 2];
        h = Math.imul(h ^ r, 0x01000193);
        h = Math.imul(h ^ g, 0x01000193);
        h = Math.imul(h ^ b, 0x01000193);
        colors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (luma < min) min = luma;
        if (luma > max) max = luma;
        sum += luma;
      }
      const n = Math.max(1, width * height);
      return { width, height, hash: (h >>> 0).toString(16), colors: colors.size, lumaMin: Math.round(min), lumaMax: Math.round(max), lumaMean: Math.round(sum / n) };
    })()`,
    true,
  )) as BoxPixels | null;
}

/**
 * DK-9 — A FROZEN DESK CONSUMES NO RENDER TIME, AT REST OR UNDER A COVER (DK-D25; the plan's soak row "the
 * idle row still"): the wind made to blow first (`ambient("live")`) so frames move, then a covered view
 * PARKS the desk — not one frame, not one submit, for a second — then, back on Canvas and the wind still,
 * the desk at REST idles at zero for two seconds (clear of the example clock's minute turn).
 */
async function deskStillness(win: BrowserWindow): Promise<{ facts: object; problems: string[] }> {
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const problems: string[] = [];
  // DK-11: each counted window judged on a VISIBLE page (smoke-visibility.ts)
  const busyDrawn = await drawnWindow(win, "the stillness row's busy second");
  await js(`globalThis.__vfDesk.ambient("live")`);
  const busy0 = await deskCounters(win);
  await sleep(400);
  const busy1 = await deskCounters(win);
  const busyHidden = await windowHidden(win, "the stillness row's busy second", busyDrawn);
  await js(`globalThis.vibefield.view.set("history")`);
  await waitForRendererFact(
    win,
    "the cover over the canvas",
    10_000,
    `document.querySelector('.field-scene[data-covered="true"]') !== null`,
  );
  // the freeze walks its settle, then PARKS (ICE frame-control): the parked second starts AT the park — the gate's own
  // word, never a fixed delay after the cover shows, which a late freeze (its passive effect behind a slow paint) or a
  // stalled frame outlasts (DK-10b, grade 2: the settle step landed inside the second — one frame, one submit) — and
  // since DK-17b the word as the gate ANNOUNCES it (ICE I41, `frame.onParked`: as the settle walk's last step ENDS)
  await waitForPark(win, "the desk parked under the cover", 10_000);
  const parkedDrawn = await drawnWindow(win, "the stillness row's parked second");
  const parkedA = await stillnessSample(win);
  await sleep(1_000);
  const parkedB = await stillnessSample(win);
  const parkedHidden = await windowHidden(win, "the stillness row's parked second", parkedDrawn);
  const parked0 = countersOf(parkedA);
  const parked1 = countersOf(parkedB);
  await js(`globalThis.vibefield.view.set("canvas")`);
  await js(`globalThis.__vfDesk.ambient("idle")`);
  const waitAtRest = async (): Promise<void> => {
    try {
      await waitForRendererFact(
        win,
        "the desk at rest",
        45_000,
        "globalThis.__vfDesk.rest().asleep === true",
        "globalThis.__vfDesk.rest().asleep",
      );
    } catch (error) {
      // WHY it is awake: the frame loop's wakes that grew over a second, and the desk's registered wake taken apart
      type Rest = { wakes: Record<string, number>; timed: number; steps: number; due: unknown };
      const a = await js<Rest>("globalThis.__vfDesk.rest()");
      await sleep(1_000);
      const b = await js<Rest>("globalThis.__vfDesk.rest()");
      const grew = Object.fromEntries(
        Object.entries(b.wakes)
          .map(([reason, n]) => [reason, n - (a.wakes[reason] ?? 0)] as const)
          .filter(([, n]) => n > 0),
      );
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} — awake by ${JSON.stringify({ wakesInASecond: grew, timedInASecond: b.timed - a.timed, stepsInASecond: b.steps - a.steps, due: b.due })}`,
      );
    }
  };
  const { rest0, rest1, disturbed, moved, hidden, input } = await deskRestWindow(win, waitAtRest);
  const outside = disturbed.length > 0 ? { disturbed } : {};
  if (busyHidden !== null) problems.push(busyHidden);
  else if (busy1.frames <= busy0.frames) problems.push("the desk was not busy before the cover");
  if (parkedHidden !== null) problems.push(parkedHidden);
  else if (parked1.frames !== parked0.frames || parked1.submits !== parked0.submits) {
    problems.push(
      `a cover did not park the desk (${JSON.stringify({ parked0, parked1, movedBy: movedBy(parkedA, parkedB) })})`,
    );
  }
  if (hidden !== null) problems.push(hidden);
  else if (moved !== null) {
    problems.push(
      `the desk did not idle at zero (${JSON.stringify({ rest0, rest1, movedBy: moved, ...outside })})`,
    );
  }
  const parkedWakes = movedBy(parkedA, parkedB).wakes;
  return {
    facts: { busy0, busy1, parked0, parked1, parkedWakes, rest0, rest1, input, ...outside },
    problems,
  };
}

/** What `plugins.reload` was answered, as a fact: null when it reloaded, its refusal's words otherwise. */
async function reloadAnswer(handle: FielddHandle, id: string): Promise<string | null> {
  try {
    await handle.client.request("plugins.reload", { id });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * DK-9 — THE RUNTIME WITH KINDS, IN THE PRODUCT (the plan's addendum (13)–(15); ICE I25), over fieldd with the
 * two windows, each on its own board — the plugin set changed mid-session and each window's desk REMOUNTED,
 * measured by `perf().boot`:
 *   ENABLE (a plugin these renderers never staged — the fixture's minute dial, off since before the windows
 *     opened): staged, each board REOPENS on a new engine (a new generation), its pack stamped (no other
 *     desktop holds the boards) and its kind PLACED at once in each window;
 *   DISABLE the clock: each desk remounts on its engine WITHOUT its kind — the clock keeps its data and wears
 *     ICE's MISSING face, picked by its box, the bar's words "Clock · plugin off" (`dk-9-missing-face.png`);
 *   ENABLE it again: each desk remounts with its kind — drawn again: OFF, its box drew the missing face (at
 *     least 15 colours fewer and less contrast than the same box ON);
 *   UPDATE it (v1 → v2, `schemaVersion` 2, a `migrate` chain): each window saves its board and its renderer
 *     is REPLACED — it reopens ITS board with the v2 kind, the chain run on each clock it carries;
 *   REGRESS it (`schemaVersion` 1 over v2): fieldd refuses (§18.5) and the renderers are untouched.
 * Returns the problems, each row's facts, and the renderers' CANVAS_READY after the update (the soak's base).
 */
async function kindRuntimeRows(opts: {
  windows: readonly BrowserWindow[];
  handle: FielddHandle;
  fixtures: KindFixtures;
  shotDir: string | undefined;
}): Promise<{ problems: string[]; facts: Record<string, unknown>; canvas: CanvasFacts[] | null }> {
  const { windows, handle, fixtures, shotDir } = opts;
  const problems: string[] = [];
  const facts: Record<string, unknown> = {};
  const clock = fixtures.clock ?? "";
  const fresh = fixtures.fresh ?? "";
  const freshType = fixtures.freshType ?? "";
  const at = (win: BrowserWindow) => windows.indexOf(win) + 1;
  const before = await Promise.all(
    windows.map((win) =>
      deskWhere(win, `window ${at(win)}: the desk before the runtime rows`, () => true),
    ),
  );

  // ENABLE — a plugin new to these renderers: staged, and each board reopens on a NEW ENGINE
  await handle.client.request("plugins.enable", { id: fresh });
  const enabled = await Promise.all(
    windows.map((win, i) =>
      deskWhere(
        win,
        `window ${at(win)}: the board reopened on a new engine with the new plugin's kind`,
        (desk) => desk.generation > (before[i]?.generation ?? 0),
        90_000,
      ),
    ),
  );
  const placed: unknown[] = [];
  for (const [i, win] of windows.entries()) {
    const entity = await win.webContents
      .executeJavaScript(
        `globalThis.__vfFieldSmoke.spawnWidget(${JSON.stringify(freshType)}, { x: ${900 + 40 * i}, y: 300, w: 150, h: 150, props: { seconds: false } })`,
        true,
      )
      .then(
        (value: unknown) => value,
        (error: unknown) => ({ refused: error instanceof Error ? error.message : String(error) }),
      );
    placed.push(entity);
  }
  const freshCensus = await Promise.all(
    windows.map(
      async (win) =>
        (
          await deskWhere(
            win,
            `window ${at(win)}: the new plugin's dial placed`,
            (d) => (d.census[freshType] ?? 0) >= 1,
            10_000,
          ).catch(() => null)
        )?.census[freshType] ?? 0,
    ),
  );
  facts["enable"] = {
    plugin: fresh,
    remounts: enabled.map((d) => ({
      generation: d.generation,
      mount: d.mount,
      mounts: d.mounts,
      boot: d.boot,
    })),
    placed,
    census: freshCensus,
  };
  console.log(`SMOKE_PLUGIN_KINDS_ENABLE ${JSON.stringify(facts["enable"])}`);
  for (const [i, d] of enabled.entries()) {
    if (d.mount !== 0)
      problems.push(`window ${i + 1}: the enable's new generation is mount ${d.mount}, not 0`);
    if ((freshCensus[i] ?? 0) < 1)
      problems.push(
        `window ${i + 1}: the new plugin's kind was not placed (${JSON.stringify(placed[i])})`,
      );
  }

  // DK-16: the kinds' pixel rows below are judged BY THE SUN, whatever the machine's appearance. By the Moon the clock's
  // dial reads as dark and as flat as the missing face — desk.5, window 2: OFF 53 colours over luma 39–143 against the
  // clock's 59 over 21–92, I39 having put the face's outline inside the picked box — and by the Sun the clock is 347–525
  // colours over 231–238 of luma against the face's 26–36 over 56–59.
  for (const win of windows) {
    await win.webContents.executeJavaScript(`globalThis.vibefield.theme.set("light")`, true);
    const deadline = Date.now() + 10_000;
    while (
      (await win.webContents.executeJavaScript(`globalThis.__vfDesk?.theme?.() ?? null`, true)) !==
      "light"
    ) {
      if (Date.now() > deadline)
        throw new Error(`window ${at(win)}: the desk did not dress light within 10000ms`);
      await sleep(100);
    }
  }
  await sleep(400);

  // DISABLE the clock — the desk remounts WITHOUT its kind: the missing face, the bar's words
  await handle.client.request("plugins.disable", { id: clock });
  const off = await Promise.all(
    windows.map((win, i) =>
      deskWhere(
        win,
        `window ${at(win)}: the desk remounted without the clock's kind`,
        (desk) =>
          desk.generation === enabled[i]?.generation && desk.mount > (enabled[i]?.mount ?? 0),
      ),
    ),
  );
  await sleep(400);
  const offWords = await Promise.all(windows.map((win) => deskWords(win, clock)));
  const offBoxes = await Promise.all(windows.map((win) => objectBox(win, clock)));
  const offSamples = await Promise.all(
    windows.map((win, i) => {
      const box = offBoxes[i];
      return box === null || box === undefined
        ? Promise.resolve(null)
        : boxPixels(win, rectOf(box));
    }),
  );
  if (shotDir !== undefined && windows[0] !== undefined) {
    mkdirSync(shotDir, { recursive: true });
    writeFileSync(join(shotDir, "dk-9-missing-face.png"), (await windows[0].capturePage()).toPNG());
  }
  facts["disable"] = {
    plugin: clock,
    remounts: off.map((d) => ({ generation: d.generation, mount: d.mount, boot: d.boot })),
    words: offWords,
    picked: offBoxes,
    sample: offSamples,
    census: off.map((d) => d.census[clock] ?? 0),
  };
  console.log(`SMOKE_PLUGIN_KINDS_DISABLE ${JSON.stringify(facts["disable"])}`);
  for (const [i, words] of offWords.entries()) {
    if (words?.label !== "Clock · plugin off")
      problems.push(
        `window ${i + 1}: the bar's words for an off clock were ${JSON.stringify(words)}`,
      );
    if (offBoxes[i] === null)
      problems.push(`window ${i + 1}: the off clock's missing face was not picked by its box`);
    if ((off[i]?.census[clock] ?? 0) < 1)
      problems.push(`window ${i + 1}: the off clock's data left the board`);
  }

  // ENABLE it again — the desk remounts WITH its kind
  await handle.client.request("plugins.enable", { id: clock });
  const on = await Promise.all(
    windows.map((win, i) =>
      deskWhere(
        win,
        `window ${at(win)}: the desk remounted with the clock's kind`,
        (desk) => desk.generation === off[i]?.generation && desk.mount > (off[i]?.mount ?? 0),
      ),
    ),
  );
  await sleep(400);
  const onWords = await Promise.all(windows.map((win) => deskWords(win, clock)));
  const onSamples = await Promise.all(
    windows.map((win, i) => {
      const box = offBoxes[i];
      return box === null || box === undefined
        ? Promise.resolve(null)
        : boxPixels(win, rectOf(box));
    }),
  );
  facts["reenable"] = {
    remounts: on.map((d) => ({ generation: d.generation, mount: d.mount, boot: d.boot })),
    words: onWords,
    sample: onSamples,
  };
  console.log(`SMOKE_PLUGIN_KINDS_REENABLE ${JSON.stringify(facts["reenable"])}`);
  for (const [i, words] of onWords.entries()) {
    if (words?.state !== null)
      problems.push(`window ${i + 1}: the clock enabled again still says ${JSON.stringify(words)}`);
    const a = offSamples[i];
    const b = onSamples[i];
    if (a === null || a === undefined || b === null || b === undefined) {
      problems.push(
        `window ${i + 1}: the clock's box was not read back off and on (${JSON.stringify({ a, b })})`,
      );
    } else if (a.colors + 15 > b.colors || a.lumaMax - a.lumaMin >= b.lumaMax - b.lumaMin) {
      // the box OFF is ICE's missing face — a wash and a hatch of one ink: at least 15 colours fewer, and less
      // contrast, than the same box drawn by the clock's kind (its dial, numerals and hands). A hash cannot
      // tell them apart: two mounts of one scene differ by a pixel or two.
      problems.push(
        `window ${i + 1}: the clock's box OFF is not the missing face — it draws what it draws ON (${JSON.stringify({ off: a, on: b })})`,
      );
    }
  }

  // UPDATE it — v2 (schemaVersion 2, a migrate chain): each renderer REPLACED, each board reopened with v2
  const docIds = await Promise.all(
    windows.map(
      (win) =>
        win.webContents.executeJavaScript(
          'sessionStorage.getItem("vf-window-doc")',
          true,
        ) as Promise<string | null>,
    ),
  );
  const ready = windows.map((win) => waitForConsole(win, "CANVAS_READY ", 120_000));
  const root = fixtures.clockRoot ?? "";
  const v2 = fixtures.clockV2 ?? "";
  writeFileSync(
    join(root, "vibefield.plugin.json"),
    readFileSync(join(v2, "vibefield.plugin.json")),
  );
  writeFileSync(join(root, "dist", "renderer.js"), readFileSync(join(v2, "dist", "renderer.js")));
  const updateAnswer = await reloadAnswer(handle, clock);
  console.log(
    `SMOKE_PLUGIN_KINDS_UPDATE_ANSWER ${JSON.stringify({ plugin: clock, answer: updateAnswer })}`,
  );
  if (updateAnswer !== null) {
    for (const wait of ready) void wait.catch(() => undefined);
    problems.push(`the clock's update was refused: ${updateAnswer}`);
    return { problems, facts, canvas: null };
  }
  const canvas = (await Promise.all(ready)).map((raw) => JSON.parse(raw) as CanvasFacts);
  const updated = await Promise.all(
    windows.map((win) =>
      deskWhere(
        win,
        `window ${at(win)}: the replaced renderer drew its board with v2`,
        (desk) => desk.mounts === 1,
        120_000,
      ),
    ),
  );
  const reopened = await Promise.all(
    windows.map(
      (win) =>
        win.webContents.executeJavaScript(
          'sessionStorage.getItem("vf-window-doc")',
          true,
        ) as Promise<string | null>,
    ),
  );
  const migrated = await Promise.all(
    windows.map(
      (win) =>
        win.webContents.executeJavaScript(
          `globalThis.__vfDesk?.objects(${JSON.stringify(clock)}).map((o) => ({ style: o.props.style, stamp: o.props.stamp })) ?? null`,
          true,
        ) as Promise<{ style: unknown; stamp: unknown }[] | null>,
    ),
  );
  facts["update"] = {
    plugin: clock,
    answer: updateAnswer,
    boards: { before: docIds, after: reopened },
    remounts: updated.map((d) => ({
      generation: d.generation,
      mount: d.mount,
      mounts: d.mounts,
      boot: d.boot,
    })),
    migrated,
  };
  console.log(`SMOKE_PLUGIN_KINDS_UPDATE ${JSON.stringify(facts["update"])}`);
  for (const [i, clocks] of migrated.entries()) {
    if (reopened[i] !== docIds[i])
      problems.push(`window ${i + 1} reopened ${reopened[i]}, not its own ${docIds[i]}`);
    if (clocks === null || clocks.length === 0)
      problems.push(`window ${i + 1}: no clock after the update`);
    else if (!clocks.every((c) => c.stamp === "migrated-from-v1" && c.style === "station")) {
      problems.push(
        `window ${i + 1}: the migrate chain did not run on its clocks (${JSON.stringify(clocks)})`,
      );
    }
  }

  // REGRESS it — schemaVersion 1 over v2: refused by fieldd (§18.5), the renderers untouched
  const v1 = JSON.parse(readFileSync(join(v2, "vibefield.plugin.json"), "utf8")) as {
    version: string;
    contributes: { objects: { schemaVersion: number }[] };
  };
  v1.version = "0.3.0";
  for (const row of v1.contributes.objects) row.schemaVersion = 1;
  writeFileSync(join(root, "vibefield.plugin.json"), `${JSON.stringify(v1, null, 2)}\n`);
  const pids = windows.map((win) => win.webContents.getOSProcessId());
  const heard: string[] = [];
  const listeners = windows.map((win) => {
    const listen = (...args: unknown[]): void => {
      const text = args.map(consoleText).find((candidate) => candidate.length > 0) ?? "";
      if (text.startsWith("CANVAS_READY ")) heard.push(`window ${at(win)}`);
    };
    win.webContents.on("console-message", listen);
    return () => win.webContents.off("console-message", listen);
  });
  const regressAnswer = await reloadAnswer(handle, clock);
  await sleep(3_000);
  for (const off of listeners) off();
  const still = await Promise.all(
    windows.map((win) =>
      deskWhere(win, `window ${at(win)}: the desk after the refusal`, () => true),
    ),
  );
  facts["regress"] = {
    answer: regressAnswer,
    reloaded: heard,
    desks: still.map((d) => ({ generation: d.generation, mount: d.mount, mounts: d.mounts })),
    pidsSame: windows.map((win, i) => win.webContents.getOSProcessId() === pids[i]),
  };
  console.log(`SMOKE_PLUGIN_KINDS_REGRESS ${JSON.stringify(facts["regress"])}`);
  if (regressAnswer === null || !regressAnswer.includes("regresses schemaVersion 2 → 1")) {
    problems.push(`a regressing schemaVersion was not refused by fieldd (${regressAnswer})`);
  }
  if (heard.length > 0) problems.push(`a refused update replaced a renderer (${heard.join(", ")})`);
  // the LIVE version stays v2: its manifest goes back on disk, so a fieldd restarted below reads v2, not the
  // refused v1 (a v1 row would hold every migrated board read-only — the doc's packs newer than its kind)
  writeFileSync(
    join(root, "vibefield.plugin.json"),
    readFileSync(join(v2, "vibefield.plugin.json")),
  );
  return { problems, facts, canvas };
}

/** A rect of the view beside `box` where no object is picked — what the desk draws under the objects there (the
 * mat, or a pad the objects lie on): at its height (or width) and 48 px more below, above, right or left of it,
 * the first wholly inside the view that no pick answers at its corners or centre; null when none is. */
async function rectBeside(win: BrowserWindow, box: ObjectBox): Promise<ViewRect | null> {
  const r = rectOf(box);
  return (await win.webContents.executeJavaScript(
    `(() => {
      const d = globalThis.__vfDesk;
      const el = document.querySelector("[data-desk]");
      if (d === undefined || el === null) return null;
      const view = el.getBoundingClientRect();
      const r = ${JSON.stringify(r)};
      const candidates = [
        { ...r, y: r.y + r.height + 48 },
        { ...r, y: r.y - r.height - 48 },
        { ...r, x: r.x + r.width + 48 },
        { ...r, x: r.x - r.width - 48 },
      ];
      for (const c of candidates) {
        if (c.x < 0 || c.y < 0 || c.x + c.width > view.width || c.y + c.height > view.height) continue;
        const points = [
          [c.x, c.y], [c.x + c.width, c.y], [c.x, c.y + c.height], [c.x + c.width, c.y + c.height],
          [c.x + c.width / 2, c.y + c.height / 2],
        ];
        if (points.every(([x, y]) => d.pick({ x, y }) === null)) return c;
      }
      return null;
    })()`,
    true,
  )) as ViewRect | null;
}

/**
 * DK-9 — A PLUGIN'S KIND FAULTS, CONTAINED IN THE RUNNING PRODUCT (the plan's addendum (16), DK-7's note; ICE I24),
 * on a run staged with DK-7's fault fixture (`stage-kind-fixtures.mjs faults` — the clock declaring its two broken
 * kinds beside its own row, through `FIELDD_PLUGIN_DEV_ROOTS` for this run alone, never under `examples/plugins`):
 *   BOOT — the broken clock's WGSL does not compile: the desk REFUSED its kind at create and booted without it,
 *     `status().faults` naming it ("refused at create — …") and nothing else;
 *   QUARANTINE — a faulty clock laid (its `record` throws from its third call, its `hit` on every pick): three
 *     strikes and the desk quarantines it, `status().faults` naming it second, the desk's state still `ready`;
 *   FACES — each broken clock wears ICE's MISSING face where it lies: picked as its type by its box (the face
 *     is pickable), its pixels not what the desk draws beside it, its contrast below a drawn clock's; the bar's words
 *     "Broken clock · can't draw", "Faulty clock · can't draw" (DK-11: R24's word for a faulted kind);
 *   THE REST DRAWS — a seconds clock laid beside them ticks on its own (its box's pixels change over a second
 *     and a half), its words its title alone, no other kind in `faults`; and the frame rate with the wind
 *     blowing HOLDS through the quarantine (at least 75% of the rate before it). The still is
 *     `dk-9-fault-faces.png`.
 */
async function kindFaultRows(
  win: BrowserWindow,
  fixtures: KindFixtures,
  shotDir: string | undefined,
): Promise<string[]> {
  const js = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const problems: string[] = [];
  const clock = fixtures.clock ?? CANVAS_CENSUS.exampleClock;
  const [broken, faulty] = fixtures.broken ?? [];
  if (broken === undefined || faulty === undefined) {
    return [`the fault fixture named no broken kinds (${JSON.stringify(fixtures)})`];
  }
  type Status = { state: string; faults: { kind: string; reason: string }[] };
  const status = (): Promise<Status> =>
    js(
      "(() => { const s = globalThis.__vfDesk.status(); return { state: s.state, faults: s.faults ?? [] }; })()",
    );
  /** Frames a second with the wind blowing (a busy desk draws every frame), over two seconds — on a VISIBLE page (DK-11:
   * a window hidden inside the two seconds has no rate to give; its named cause stands in the rows' problems). */
  const rateHidden: string[] = [];
  const frameRate = async (): Promise<number> => {
    await js(`globalThis.__vfDesk.ambient("live")`);
    await sleep(300);
    const drawn = await drawnWindow(win, "the frame rate's two seconds");
    const a = await deskCounters(win);
    const t0 = performance.now();
    await sleep(2_000);
    const b = await deskCounters(win);
    const rate = ((b.frames - a.frames) * 1_000) / (performance.now() - t0);
    const hidden = await windowHidden(win, "the frame rate's two seconds", drawn);
    if (hidden !== null) rateHidden.push(hidden);
    await js(`globalThis.__vfDesk.ambient("idle")`);
    return Math.round(rate * 10) / 10;
  };

  // BOOT — the broken kind refused at create, from the first frame
  const atBoot = await status();
  const refused = atBoot.faults.find((fault) => fault.kind === broken);
  if (refused === undefined || !refused.reason.startsWith("refused at create")) {
    problems.push(`the desk did not refuse the broken clock at create (${JSON.stringify(atBoot)})`);
  }
  const others = atBoot.faults.filter((fault) => fault.kind !== broken);
  if (others.length > 0)
    problems.push(`the desk booted with other faults (${JSON.stringify(others)})`);
  const rateBefore = await frameRate();

  // three clocks in a row, on the calendar pad: one that draws (a SECONDS clock — it ticks on its own), the broken, the faulty
  const lay = (type: string, x: number, props: object): Promise<string> =>
    js(
      `globalThis.__vfFieldSmoke.spawnWidget(${JSON.stringify(type)}, { x: ${x}, y: 960, w: 150, h: 150, props: ${JSON.stringify(props)} })`,
    );
  const ticking = await lay(clock, 760, { seconds: true });
  const brokenAt = await lay(broken, 960, {});
  const faultyAt = await lay(faulty, 1160, {});

  // QUARANTINE — three strikes from its own records, no pick asked; a pick's strikes only if the records never come
  const isOut = (s: Status): boolean => s.faults.some((fault) => fault.kind === faulty);
  let after = await status();
  const deadline = Date.now() + 20_000;
  while (!isOut(after) && Date.now() < deadline) {
    await sleep(200);
    after = await status();
  }
  const pickedToStrike = !isOut(after);
  if (pickedToStrike) {
    await objectBox(win, faulty, faultyAt); // every pick on it throws: a strike each
    await sleep(200);
    after = await status();
  }
  const quarantined = after.faults.find((fault) => fault.kind === faulty);
  if (quarantined === undefined)
    problems.push(`the faulty clock was not quarantined (${JSON.stringify(after)})`);
  if (after.state !== "ready")
    problems.push(`a kind's fault moved the desk's state to ${after.state}`);
  const strangers = after.faults.filter((fault) => fault.kind !== broken && fault.kind !== faulty);
  if (strangers.length > 0)
    problems.push(`a kind that draws was named missing (${JSON.stringify(strangers)})`);

  // FACES — the missing face where each broken clock lies, picked; the seconds clock drawn and ticking
  await sleep(300);
  const boxes = {
    ticking: await objectBox(win, clock, ticking),
    broken: await objectBox(win, broken, brokenAt),
    faulty: await objectBox(win, faulty, faultyAt),
  };
  const words = {
    clock: await deskWords(win, clock),
    broken: await deskWords(win, broken),
    faulty: await deskWords(win, faulty),
  };
  const beside = boxes.broken === null ? null : await rectBeside(win, boxes.broken);
  const pixels = {
    ticking: boxes.ticking === null ? null : await boxPixels(win, rectOf(boxes.ticking)),
    broken: boxes.broken === null ? null : await boxPixels(win, rectOf(boxes.broken)),
    faulty: boxes.faulty === null ? null : await boxPixels(win, rectOf(boxes.faulty)),
    beside: beside === null ? null : await boxPixels(win, beside),
  };
  await sleep(1_500);
  const tickedOn = boxes.ticking === null ? null : await boxPixels(win, rectOf(boxes.ticking));
  const rateAfter = await frameRate();
  if (shotDir !== undefined) {
    mkdirSync(shotDir, { recursive: true });
    writeFileSync(join(shotDir, "dk-9-fault-faces.png"), (await win.capturePage()).toPNG());
  }
  console.log(
    `SMOKE_CANVAS_FAULTS ${JSON.stringify({
      atBoot,
      after,
      pickedToStrike,
      laid: { ticking, broken: brokenAt, faulty: faultyAt },
      boxes,
      words,
      beside,
      pixels,
      tickedOn,
      frameRate: { before: rateBefore, after: rateAfter },
    })}`,
  );
  for (const [name, type, box, px] of [
    ["broken", broken, boxes.broken, pixels.broken],
    ["faulty", faulty, boxes.faulty, pixels.faulty],
  ] as const) {
    if (box === null) {
      problems.push(`the ${name} clock's missing face was not picked as ${type}`);
      continue;
    }
    const label = words[name]?.label;
    const title = name === "broken" ? "Broken clock" : "Faulty clock";
    if (label !== `${title} · can't draw`)
      problems.push(`the bar's words for the ${name} clock were ${JSON.stringify(words[name])}`);
    if (px === null) problems.push(`the ${name} clock's box was not read back`);
    else {
      if (
        pixels.beside !== null &&
        px.lumaMean === pixels.beside.lumaMean &&
        px.colors === pixels.beside.colors
      ) {
        problems.push(
          `the ${name} clock's box draws what lies beside it — no face (${JSON.stringify({ px, beside: pixels.beside })})`,
        );
      }
      const drawn = pixels.ticking;
      if (drawn !== null && px.lumaMax - px.lumaMin >= drawn.lumaMax - drawn.lumaMin) {
        problems.push(
          `the ${name} clock's box is as contrasty as a drawn clock's — not the missing face (${JSON.stringify({ px, drawn })})`,
        );
      }
    }
  }
  if (pixels.beside === null) problems.push("no unpicked rect beside the broken clock to read");
  if (boxes.ticking === null) problems.push("the seconds clock beside the faults was not picked");
  if (words.clock?.state !== null)
    problems.push(`the clock's words carry a state (${JSON.stringify(words.clock)})`);
  if (pixels.ticking === null || tickedOn === null || pixels.ticking.hash === tickedOn.hash) {
    problems.push(
      `the seconds clock beside the faults did not tick on (${JSON.stringify({ was: pixels.ticking, now: tickedOn })})`,
    );
  }
  if (rateHidden.length > 0) problems.push(...rateHidden);
  else if (rateAfter < rateBefore * 0.75) {
    problems.push(
      `the frame rate fell through the quarantine (${rateBefore} → ${rateAfter} frames a second)`,
    );
  }
  return problems;
}

/** Before a restart (DK-5): each window's board SAVED at fieldd — listed with its schema and its
 * bytes, and its `updatedAt` steady for two seconds (the autosave debounces at 800 ms) — so the
 * board the recovered windows reopen is the one they drew. */
async function boardsSettledAtFieldd(
  handle: FielddHandle,
  docIds: readonly string[],
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  let steady = 0;
  while (Date.now() < deadline) {
    const { docs } = DocListResult.parse(await handle.client.request("doc.list", {}));
    const rows = docIds.map((id) => docs.find((doc) => doc.docId === id));
    const saved = rows.every(
      (doc) => doc !== undefined && doc.engineSchema !== null && doc.sizeBytes > 0,
    );
    const stamp = JSON.stringify(rows.map((doc) => doc?.updatedAt ?? null));
    steady = saved && stamp === last ? steady + 1 : 0;
    last = stamp;
    if (steady >= 8) return;
    await sleep(250);
  }
  throw new Error(`the boards did not settle at fieldd within ${timeoutMs}ms (${last})`);
}

/** PRC-5g/PRC-6c2 physical witness: two real sandboxed renderer documents
 * load the production custom origin. The bounded soak mode repeats the exact
 * supervisor crash/boot-fence path inside one Electron owner and emits a
 * machine-readable structural + OS sample after every quiescent cycle.
 *
 * DK-5 — WITH THE DESK (the plan's T8 soak rig): GPU on (`keepsGpu`; shown windows, for the
 * desk's frame loop), each window's desk says DESK_READY and holds the seed's six; a restart
 * REPLACES each renderer, and one engine per document generation REMOUNTS the desk (ICE I25):
 * each window says DESK_READY again — its `boot` is the remount's cost, recorded — and reopens
 * the SAME board (`vf-last-doc`) with its six kinds, which proves they survived rather than were
 * re-seeded. GPU off (`--disable-gpu`), the windows assert the desk's card as before. The
 * per-widget CSS census is DROPPED: the desk scopes no CSS per widget (the HUD surface scope
 * stays, and `smoke:canvas` still counts its stylesheets). On the run's own profile. */
export async function runSmokePluginRestart(opts: {
  handle: FielddHandle;
  onHandle: (listener: (handle: FielddHandle) => void) => () => void;
  supervisor: FielddSupervisor;
  rendererBoundary: WindowRendererBoundary;
  logging: ElectronLogging;
  root: string;
  registry: WindowRegistry;
  preloadPath: string;
  viteUrl: string;
  beforeExit: () => Promise<void>;
  onWindow?: (window: BrowserWindow) => void;
}): Promise<void> {
  const config = pluginRuntimeSoakConfig();
  const gpu = !process.argv.includes("--disable-gpu");
  // Shown with the GPU on: a hidden window presents no frames, and DESK_READY waits for one. DK-18 (36):
  // shown inactive and click-through — kept from the person's input (smoke-window.ts).
  const primary = smokeWindow({
    mode: "smoke-plugin-restart",
    preloadPath: opts.preloadPath,
    show: gpu,
  });
  const auxiliary = smokeWindow({
    mode: "smoke-plugin-restart",
    preloadPath: opts.preloadPath,
    show: gpu,
  });
  opts.registry.adopt(primary);
  opts.registry.adoptAuxiliary(auxiliary);
  opts.onWindow?.(primary);
  opts.onWindow?.(auxiliary);
  const windows = [primary, auxiliary] as const;
  const localLogSinks = [
    opts.logging.desktop,
    opts.logging.renderer,
    opts.logging.utility,
    opts.logging.pluginRenderer,
  ] as const;
  const plantedEvents: string[] = [];
  let powerSaveBlockerId: number | null = null;
  if (process.env["VF_SMOKE_DEBUG"]) {
    windows.forEach((win, index) => {
      win.webContents.on("console-message", (...args: unknown[]) => {
        console.log(`[renderer-${index + 1}] ${args.map((arg) => JSON.stringify(arg)).join(" ")}`);
      });
    });
  }
  let ok = false;
  try {
    // A duration claim must not be earned while the app is idle-suspended.
    // The display may still sleep, and every physical sample below proves the
    // blocker remained active for the observed interval.
    if (config.durationMs !== null) {
      powerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    }
    // DK-9 — the runtime rows' fixtures (packaging/stage-kind-fixtures.mjs), when the run was staged: the
    // fixture's dial plugin is turned OFF before any window opens, so its enable below is a plugin new to
    // the renderers (the product's and the dev set's plugins are staged as every dev run stages them)
    const fixtures = gpu ? kindFixtures() : null;
    if (fixtures?.fresh !== undefined) {
      await opts.handle.client.request("plugins.disable", { id: fixtures.fresh });
    }
    // DK-9 — THE LAUNCH (the plan's Phase 3 input (2)): window 1 opens the first board (the examples on it,
    // the clock among them) and holds it; THEN window 2 opens — a NEW window while another holds the last
    // board: the most recent board no window holds, else a new one, never the degraded in-memory session
    const launch = async (
      win: BrowserWindow,
      search: Record<string, string>,
    ): Promise<CanvasFacts> => {
      const ready = waitForConsole(win, "CANVAS_READY ", 60_000);
      await loadRenderer(win, "smoke-plugin-restart", opts.viteUrl, search);
      const facts = JSON.parse(await ready) as CanvasFacts;
      if (gpu) await deskWhere(win, "the launched window's desk", () => true);
      return facts;
    };
    let currentCanvas = [
      await launch(primary, { [SEED_EXAMPLES]: "1" }),
      await launch(auxiliary, {}),
    ];
    console.log(`SMOKE_PLUGIN_RESTART_INITIAL ${JSON.stringify(currentCanvas)}`);
    const initialProblems = [
      ...smokeProfileFailures(),
      ...currentCanvas.flatMap((facts, index) =>
        censusFailures(facts).map((problem) => `window ${index + 1}: ${problem}`),
      ),
    ];
    let desks: WindowDesk[] = [];
    const remounts: Readonly<Record<string, number>>[][] = [];
    /** Each window's board's census after the launch's rows — what every restart must reopen (DK-9). */
    let baseline: Readonly<Record<string, number>>[] = [];
    if (gpu) {
      const boards = await Promise.all(
        windows.map(
          (win) =>
            win.webContents.executeJavaScript(
              '({ docId: sessionStorage.getItem("vf-window-doc"), board: globalThis.__vfDesk?.board() ?? null, name: document.querySelector(".vf-head-name")?.textContent ?? null })',
              true,
            ) as Promise<{
              docId: string | null;
              board: { state: string } | null;
              name: string | null;
            }>,
        ),
      );
      console.log(`SMOKE_PLUGIN_RESTART_LAUNCH ${JSON.stringify(boards)}`);
      const [first, second] = boards;
      if (first?.docId === null || second?.docId === null || first?.docId === second?.docId) {
        initialProblems.push(
          `the second window did not open a board of its own (${JSON.stringify(boards)})`,
        );
      }
      if (second?.board?.state === "detached" || second?.name === "In memory") {
        initialProblems.push(
          `the second window opened the degraded session (${JSON.stringify(second)})`,
        );
      }
      // window 2's board holds VibeField's kinds too: the comment pad, a minute clock and a note
      for (const [type, x, y, w, h, props] of [
        [CANVAS_CENSUS.commentPad, 120, 120, 220, 280, {}],
        [CANVAS_CENSUS.exampleClock, 420, 140, 150, 150, { seconds: false }],
        ["desk.note", 640, 140, 200, 200, {}],
      ] as const) {
        await auxiliary.webContents.executeJavaScript(
          `globalThis.__vfFieldSmoke.spawnWidget(${JSON.stringify(type)}, { x: ${x}, y: ${y}, w: ${w}, h: ${h}, props: ${JSON.stringify(props)} })`,
          true,
        );
      }
      if (fixtures !== null) {
        const rows = await kindRuntimeRows({
          windows,
          handle: opts.handle,
          fixtures,
          shotDir: process.env["VF_SMOKE_SHOT_DIR"],
        });
        initialProblems.push(...rows.problems);
        if (rows.canvas !== null) currentCanvas = rows.canvas; // the renderers the update replaced
      } else {
        console.log("SMOKE_PLUGIN_KINDS skipped — the run was not staged (no VF_KIND_FIXTURES)");
      }
      const first2 = await windowDesks([primary]);
      const second2 = await windowDesks([auxiliary], 60_000, (_index, census) =>
        [CANVAS_CENSUS.commentPad, CANVAS_CENSUS.exampleClock, "desk.note"].every(
          (type) => (census[type] ?? 0) >= 1,
        ),
      );
      desks = [...first2.desks, ...second2.desks];
      baseline = desks.map((desk) => desk.desk?.census ?? {});
      initialProblems.push(...first2.problems, ...second2.problems);
      console.log(
        `SMOKE_PLUGIN_RESTART_DESK ${JSON.stringify({ phase: "initial", windows: desks })}`,
      );
    } else {
      // DK-3: GPU-less, each window's desk says it cannot draw — its card, in ICE's words
      const initialCards = await Promise.all(windows.map((win) => expectDeskUnavailableCard(win)));
      console.log(`SMOKE_PLUGIN_RESTART_DESK_CARDS ${JSON.stringify(initialCards)}`);
    }
    if (initialProblems.length > 0) throw new Error(initialProblems.join(" · "));

    const expectedBootstrap = countVector(
      {
        generations: 2,
        hookedSenders: 2,
        windowIdentities: 2,
        documentIdentities: 2,
        retirements: 0,
        replacementsRequested: 0,
        staleBootReapers: 1,
      },
      "expectedBootstrap",
    );
    const initialBootstrap = countVector(opts.rendererBoundary.state(), "bootstrap");
    if (vectorMismatches(expectedBootstrap, initialBootstrap) !== 0) {
      throw new Error(`initial bootstrap census was ${JSON.stringify(initialBootstrap)}`);
    }
    const expectedRendererRuntime = rendererRuntimeVector(currentCanvas);
    let currentHandle = opts.handle;
    let currentConnections = await Promise.all(windows.map(rendererConnection));
    const initialFieldd = await settlePluginRuntimeHealth(currentHandle);
    const expectedFielddRuntime = initialFieldd.vector;
    /** The fieldd runtime counters a sample disagrees on, by name — the verdict counts them; this says which. */
    const fielddDrift = (
      vector: CountVector,
    ): Record<string, { expected: number; sampled: number }> =>
      Object.fromEntries(
        [...new Set([...Object.keys(expectedFielddRuntime), ...Object.keys(vector)])]
          .filter((key) => (expectedFielddRuntime[key] ?? 0) !== (vector[key] ?? 0))
          .map((key) => [
            key,
            { expected: expectedFielddRuntime[key] ?? 0, sampled: vector[key] ?? 0 },
          ]),
      );
    const nativePid = initialFieldd.health.nativePid;
    if (nativePid === null || !pidAlive(nativePid)) {
      throw new Error("restart smoke requires one live field-native process");
    }
    const startedAt = performance.now();
    const deadline = config.durationMs === null ? null : startedAt + config.durationMs;
    const samples: PluginRuntimePhysicalSample[] = [];
    const oldBootIds: string[] = [];
    let cycle = 0;

    const collectSample = async (
      phase: PluginRuntimePhysicalSample["phase"],
      settled: SettledPluginRuntimeHealth,
      oldFielddPids: readonly number[],
      oldRendererPids: readonly number[],
    ): Promise<PluginRuntimePhysicalSample> => {
      await Promise.all(localLogSinks.map((sink) => sink.flush()));
      const resources = await samplePhysicalResourceWindow(
        windows,
        settled.health.fieldd.pid,
        nativePid,
      );
      const [mainFootprint, fielddFootprint, nativeFootprint] = await Promise.all([
        sampleProcessFootprintKb(process.pid, config.footprint),
        sampleProcessFootprintKb(settled.health.fieldd.pid, config.footprint),
        sampleProcessFootprintKb(nativePid, config.footprint),
      ]);
      const mainResources = { ...resources.main, physicalFootprintKb: mainFootprint };
      const fielddResources = { ...resources.fieldd, physicalFootprintKb: fielddFootprint };
      const nativeResources = { ...resources.native, physicalFootprintKb: nativeFootprint };
      const electron = resources.electron;
      const logs = logCensus(opts.logging.logRoot);
      const logging = loggingCensus(localLogSinks, [
        settled.health.logging,
        settled.health.pluginLogging,
      ]);
      const bootstrap = countVector(opts.rendererBoundary.state(), "bootstrap");
      const rendererRuntime = rendererRuntimeVector(currentCanvas);
      const memory = process.memoryUsage();
      const rendererPids = electron.rendererPids.filter((pid) => pid > 0);
      const sample: PluginRuntimePhysicalSample = {
        phase,
        cycle,
        elapsedMs: performance.now() - startedAt,
        bootId: currentHandle.info.bootId,
        fielddPid: settled.health.fieldd.pid,
        nativePid,
        rendererPids,
        exact: {
          bootstrapVectorMismatches: vectorMismatches(expectedBootstrap, bootstrap),
          rendererRuntimeVectorMismatches: vectorMismatches(
            expectedRendererRuntime,
            rendererRuntime,
          ),
          fielddRuntimeVectorMismatches: vectorMismatches(expectedFielddRuntime, settled.vector),
          oldFielddProcesses: oldFielddPids.filter(pidAlive).length,
          oldRendererProcesses: oldRendererPids.filter(pidAlive).length,
          rendererProcessCountDeviation:
            Math.abs(new Set(rendererPids).size - windows.length) +
            rendererPids.filter((pid) => pid <= 0).length,
          fielddHandleDeviation:
            currentHandle.ownership === "spawned" &&
            currentHandle.childPid === settled.health.fieldd.pid
              ? 0
              : 1,
          // A replacement fieldd adopts the floor and intentionally reports
          // null (it cannot vouch that it spawned that PID). The original
          // positive owner is sampled directly above; only a conflicting
          // positive claim is structural residue here.
          nativePidDeviation:
            settled.health.nativePid === null || settled.health.nativePid === nativePid ? 0 : 1,
          sampledProcessDeaths:
            Number(!mainResources.alive) +
            Number(!fielddResources.alive) +
            Number(!nativeResources.alive),
          loggingQueueRecords: logging.queueRecords,
          loggingQueueBytes: logging.queueBytes,
          unexplainedLogDrops: logging.unexplainedDrops,
          plantedMainListeners: plantedMainListenerCount(),
          powerSaveBlockerDeviation:
            config.durationMs === null ||
            (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId))
              ? 0
              : 1,
        },
        series: {
          electronProcessCount: electron.processCount,
          mainFds: mainResources.fds,
          mainThreads: mainResources.threads,
          mainNetworkSockets: mainResources.networkSockets,
          mainPhysicalFootprintKb: mainResources.physicalFootprintKb,
          fielddFds: fielddResources.fds,
          fielddThreads: fielddResources.threads,
          fielddNetworkSockets: fielddResources.networkSockets,
          fielddPhysicalFootprintKb: fielddResources.physicalFootprintKb,
          nativeFds: nativeResources.fds,
          nativeThreads: nativeResources.threads,
          nativeNetworkSockets: nativeResources.networkSockets,
          nativePhysicalFootprintKb: nativeResources.physicalFootprintKb,
          mainHeapUsedBytes: memory.heapUsed,
          mainExternalBytes: memory.external,
          electronWorkingSetKb: electron.workingSetKb,
          rendererWorkingSetKb: electron.rendererWorkingSetKb,
          systemLogBytes: logs.systemBytes,
          systemLogFiles: logs.systemFiles,
          pluginLogBytes: logs.pluginBytes,
          pluginLogFiles: logs.pluginFiles,
        },
        raw: {
          bootstrap,
          rendererRuntime,
          fielddRuntime: settled.vector,
          reportedNativePid: settled.health.nativePid,
          electronRoster: electron.roster,
          mainResources,
          fielddResources,
          nativeResources,
          osObservationWindows: resources.observationWindows,
          osObservationRanges: resources.ranges,
          logs,
          logging,
          powerSaveBlocker: {
            enabled: powerSaveBlockerId !== null,
            active: powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId),
          },
        },
      };
      samples.push(sample);
      if ((sample.exact.fielddRuntimeVectorMismatches ?? 0) > 0) {
        console.log(
          `SMOKE_PLUGIN_RESTART_FIELDD_DRIFT ${JSON.stringify({ cycle, drift: fielddDrift(settled.vector) })}`,
        );
      }
      console.log(`PLUGIN_RUNTIME_SOAK_SAMPLE ${JSON.stringify(sample)}`);
      cycle += 1;
      return sample;
    };

    while (
      cycle < 10_000 &&
      (config.cycles !== null ? cycle < config.cycles : performance.now() < (deadline ?? 0))
    ) {
      const childPid = currentHandle.childPid;
      if (currentHandle.ownership !== "spawned" || childPid === undefined) {
        throw new Error("restart smoke requires the isolated supervisor to own fieldd");
      }
      const oldHandle = currentHandle;
      const oldRendererPids = windows.map((window) => window.webContents.getOSProcessId());
      // DK-5: what the recovered windows must reopen is SAVED before fieldd dies
      if (gpu) {
        await boardsSettledAtFieldd(currentHandle, [
          ...new Set(desks.flatMap((desk) => (desk.docId === null ? [] : [desk.docId]))),
        ]);
      }
      const replacementReady = windows.map((win) => waitForConsole(win, "CANVAS_READY ", 60_000));
      const replacementHandle = waitForReplacementHandle(
        opts.onHandle,
        oldHandle.info.bootId,
        15_000,
      );
      process.kill(childPid, "SIGKILL");
      await waitForCondition("owned fieldd handle retirement", 10_000, () => {
        return oldHandle.client.status === "closed";
      });
      currentHandle = await replacementHandle;
      if (currentHandle.info.bootId === oldHandle.info.bootId) {
        throw new Error("supervisor recovery returned the dead daemon boot id");
      }
      oldBootIds.push(oldHandle.info.bootId);

      currentCanvas = (await Promise.all(replacementReady)).map(
        (raw) => JSON.parse(raw) as CanvasFacts,
      );
      console.log(`SMOKE_PLUGIN_RESTART_RECOVERED ${JSON.stringify(currentCanvas)}`);
      const replacementProblems = currentCanvas.flatMap((facts, index) =>
        censusFailures(facts).map((problem) => `window ${index + 1}: ${problem}`),
      );
      if (gpu) {
        // the desk REMOUNTED in each replaced renderer, on the SAME board it drew (its own
        // `vf-window-doc`), every kind it held intact (DK-9: each window's own census — the seed's six and
        // the clock in one, the pad, a clock and a note in the other, and what the runtime rows laid)
        const read = await windowDesks(windows, 60_000, (index, census) =>
          Object.entries(baseline[index] ?? {}).every(([type, count]) => census[type] === count),
        );
        console.log(
          `SMOKE_PLUGIN_RESTART_DESK ${JSON.stringify({ phase: "recovered", cycle, windows: read.desks })}`,
        );
        replacementProblems.push(...read.problems);
        for (const [index, desk] of read.desks.entries()) {
          const before = desks[index]?.docId ?? null;
          if (desk.docId === null || desk.docId !== before) {
            replacementProblems.push(
              `window ${index + 1} reopened ${desk.docId ?? "no board"}, not its own ${before ?? "(none)"}`,
            );
          }
          // DK-9: no fault rows — every kind the board holds is drawn by its kind
          if ((desk.desk?.faults.length ?? 0) > 0) {
            replacementProblems.push(
              `window ${index + 1}: the recovered desk names faults ${JSON.stringify(desk.desk?.faults)}`,
            );
          }
          // DK-9: one desk per launch — the replaced renderer mounted ONE
          if (desk.desk !== null && desk.desk.mounts !== 1) {
            replacementProblems.push(
              `window ${index + 1}: the replaced renderer mounted ${desk.desk.mounts} desks, not one`,
            );
          }
        }
        // DK-9 (DK-D25): the desk consumes no render time at rest and under a cover, cycle after cycle
        const stillness: (object | null)[] = [];
        for (const [index, win] of windows.entries()) {
          try {
            const still = await deskStillness(win);
            stillness.push(still.facts);
            replacementProblems.push(
              ...still.problems.map((problem) => `window ${index + 1}: ${problem}`),
            );
          } catch (error) {
            stillness.push(null);
            replacementProblems.push(
              `window ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        console.log(`SMOKE_PLUGIN_RESTART_STILL ${JSON.stringify({ cycle, windows: stillness })}`);
        remounts.push(read.desks.map((desk) => desk.desk?.boot ?? {}));
        desks = read.desks;
      } else {
        const recoveredCards = await Promise.all(
          windows.map((win) => expectDeskUnavailableCard(win)),
        );
        console.log(`SMOKE_PLUGIN_RESTART_RECOVERED_DESK_CARDS ${JSON.stringify(recoveredCards)}`);
      }
      if (replacementProblems.length > 0) throw new Error(replacementProblems.join(" · "));
      const newConnections = await Promise.all(windows.map(rendererConnection));
      for (let index = 0; index < windows.length; index += 1) {
        const oldIdentity = currentConnections[index]?.rendererParticipant;
        const newIdentity = newConnections[index]?.rendererParticipant;
        if (oldIdentity === undefined || newIdentity === undefined) {
          throw new Error(`window ${index + 1} has no renderer participant identity`);
        }
        if (newIdentity.participantId !== oldIdentity.participantId) {
          throw new Error(`window ${index + 1} lost its stable participant id`);
        }
        if (newIdentity.incarnation === oldIdentity.incarnation) {
          throw new Error(`window ${index + 1} reused its dead document incarnation`);
        }
      }
      currentConnections = newConnections;
      await waitForCondition("old fieldd process death", 10_000, () => !pidAlive(childPid));
      await waitForCondition("old renderer process death", 10_000, () =>
        oldRendererPids.every((pid) => !pidAlive(pid)),
      );
      const settled = await settlePluginRuntimeHealth(currentHandle, expectedFielddRuntime);
      if (config.injection === "main-listener" && cycle >= config.warmupSamples) {
        const event = `vf:prc6:planted:${cycle}`;
        process.on(event, () => undefined);
        plantedEvents.push(event);
      }
      await collectSample("restart", settled, [childPid], oldRendererPids);
      if (config.cycleDelayMs > 0) {
        const remaining = deadline === null ? config.cycleDelayMs : deadline - performance.now();
        if (remaining > 0) await sleep(Math.min(config.cycleDelayMs, remaining));
      }
    }

    if (deadline !== null && samples.at(-1)!.elapsedMs < config.durationMs!) {
      const remaining = deadline - performance.now();
      if (remaining > 0) await sleep(remaining);
      const settled = await settlePluginRuntimeHealth(currentHandle, expectedFielddRuntime);
      await collectSample("terminal", settled, [], []);
    }

    const verdict = evaluatePhysicalSoak(samples, physicalSoakOptions(config));
    console.log(
      `PLUGIN_RUNTIME_SOAK ${JSON.stringify({
        claim: config.claim,
        claimSatisfied: config.claim === "24h" && verdict.verdict === "pass",
        injection: config.injection,
        config,
        verdict,
      })}`,
    );
    console.log(
      `SMOKE_PLUGIN_RESTART ${JSON.stringify({
        windows: windows.length,
        cycles: oldBootIds.length,
        oldBootIds,
        newBootId: currentHandle.info.bootId,
        stableParticipants: true,
        freshIncarnations: true,
        widgetTypes: currentCanvas.map((facts) => facts.widgetTypes),
        stagedPlugins: currentCanvas.map((facts) => facts.stagedPlugins),
        // DK-5: each restart's desk REMOUNT, per window, ms since its mount (I25 `perf().boot`)
        deskRemounts: gpu ? remounts : "GPU off — the desk's card",
        soakVerdict: verdict.verdict,
      })}`,
    );
    ok = verdict.verdict === "pass";
  } catch (error) {
    console.error(
      `SMOKE_PLUGIN_RESTART failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  for (const event of plantedEvents) process.removeAllListeners(event);
  try {
    await teardown(opts.supervisor, opts.root, opts.beforeExit, ok);
  } finally {
    if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlocker.stop(powerSaveBlockerId);
    }
  }
  app.exit(ok ? 0 : 2);
}

/** The serviceName `GhostteaElectronBridge` forks its utilityProcess under.
 * Upstream's default, restated here because this harness kills by name. */
const BRIDGE_SERVICE_NAME = "ghosttea-terminal-bridge";

/** Find a bridge utilityProcess, if any survives — the direct-proof asserts
 * NONE does. (killTerminalBridge retired with row 12 at TP-S3e; this finder
 * stays as the absence witness.) */
function terminalBridgePid(): number | null {
  const metric = app
    .getAppMetrics()
    .find(
      (m) =>
        m.type === "Utility" &&
        m.name === BRIDGE_SERVICE_NAME &&
        m.serviceName === "node.mojom.NodeService",
    );
  if (metric === undefined) return null;
  return metric.pid;
}

// ---- GT-2: the Godview smoke -------------------------------------------------

/** One `GODVIEW_DECK {…}` line, as the deck published it. */
interface DeckFacts {
  active: boolean;
  panes: number;
  sessions: number;
  sessionIds: string[];
  rendererBackend: string;
  poolPhase: string;
  rosterState: string;
  error?: string;
  /** present ONLY while the GT-3 restore consent face is up */
  consent?: { saved: number; alive: number; dead: number };
  /** panes showing an ended session */
  exitedSessionIds?: string[];
  /** the pane the deck's own affordances act on */
  activeSessionId?: string;
  /** GT-3v: the alpha the RENDERER was handed, and whose palette it came from */
  glass: { paneBackgroundAlpha: number; opacityCells: boolean; themeName: string | null };
  /** GT-3f: the shader the renderer was handed. Null means the deck passed no
   * `effects` prop at all, which is how an unchosen shader is spelled. */
  effects: { shaderEffect: string | null; animate: boolean };
  /** TP-S2 / TP-R3: where a zoom gesture is, and how many LAYOUT COMMITS the
   * deck has performed since it mounted.
   *
   * A commit is the only thing that can move the zoomed pane's box, so this
   * count is the CEILING on the PTY resizes a zoom can have caused — which is
   * why row 4c reads it as one half of the proof and measures the pane boxes
   * themselves as the other. Optional here and only here: a deck built before
   * the field existed publishes no `zoom`, and a harness that threw on its
   * absence would be failing on a stale bundle rather than on a behaviour. */
  zoom?: { phase: "idle" | "entering" | "zoomed" | "leaving"; commits: number };
}

interface DirectTerminalFacts {
  sessionId: string;
  activationId: string;
  phase: string;
  presentationReady: boolean;
  inputAllowed: boolean;
  unavailableReason?: string;
  controlAttached?: boolean;
  framesAttached?: boolean;
  framesOutcome?: string;
  framesState?: string;
  protocolReason?: string;
}

/** The renderer-local home of the viewer's appearance (GT-D12). Named here so
 * the smoke seeds the same key the deck reads, and so a rename of that key
 * fails this harness rather than silently seeding nothing. */
const GODVIEW_APPEARANCE_STORAGE_KEY = "vf-godview-appearance-v1";
/** The port the smoke selects — a `GHOSTTEA_SHADER_OPTIONS` id, static by
 * choice (see row 5b). */
const SMOKE_SHADER_EFFECT = "ghosttea:crt";
/** The alpha row 11 writes into the DEVICE config document.
 *
 * Named because two rows need the same number for opposite reasons: row 11
 * writes it, and row 11b asserts the VIEWER's glass is not it. That second use
 * is the negative control the two-homes proof was missing — a before/after
 * comparison alone passes on a data dir where the deck already holds this
 * value, which is exactly the state a merged home would leave behind. */
const SMOKE_CONFIG_BACKGROUND_OPACITY = 0.62;

/** One `GODVIEW_MONITOR {…}` line, as the monitor stage published it. */
interface MonitorFacts {
  viewId: string;
  agents: number;
  agentBacked: number;
  /** AR-3: the local chip's sentence, null with no managed agents. */
  localClaim: string | null;
  /** The split, counted — how many rows each source contributed. */
  localAgents: number;
  terminals: number;
  /** `no-door` · `live` · `unavailable`; `live` is what makes an empty fold
   * distinguishable from a fold nobody asked. */
  localState: string;
  localReason?: string;
  remoteSessions: number;
  remoteHosts: number;
  /** `no-door` · `serving` · `unavailable`; the second is what makes an empty
   * mesh distinguishable from a mesh nobody asked. */
  remoteState: string;
  remoteReason?: string;
  swarmPhysics: string;
  /** AR-5: `webgpu` · `unavailable` · `starting`; `none` off the swarm view. */
  swarmRenderer: string;
  /** AR-5: the usage column's tiles; -1 while no column is mounted. */
  usageTiles: number;
  /** AR-5: `open` · `closed`. */
  findSheet: string;
  /** AR-7: the fold's rows, by run, as the stage received them — optional:
   * a stage built before the field existed publishes none, and the typed-agent
   * rows then fail on it by name rather than on a TypeError. */
  runs?: MonitorRunFacts[];
}

/** AR-7: one run of the fold on the monitor's marker (`GodviewMonitorRunFacts`
 * in field-app's development-console.ts, which this process cannot import). */
interface MonitorRunFacts {
  run: string;
  provider: string;
  /** the floor session the run's PTY is, when a pane here can show it */
  terminal?: string;
  /** `app` · `user-shell` (open) */
  spawnedBy: string;
  status: string;
  /** held as an EXITED row (MF-1f) */
  exited: boolean;
  /** the provider has spoken: what the pane frame's mark is drawn from */
  observed: boolean;
  /** a body in the swarm */
  drawn: boolean;
}

/** A running tail of one marker channel, armed BEFORE the load so a fast page
 * cannot report into a gap. Every wait is a predicate over the LATEST line,
 * because these surfaces say what they are on every change and the interesting
 * states are transient.
 *
 * Generic since GT-4: the monitor needs the same tail the deck has had since
 * GT-2 — a wait armed once and re-read after a gesture — and two copies of this
 * class would be two answers to "what did it last say".
 */
class MarkerWatch<T> {
  private latest: T | null = null;
  private seen: T[] = [];
  private readonly waiters = new Set<() => void>();

  constructor(
    win: BrowserWindow,
    private readonly prefix: string,
  ) {
    win.webContents.on("console-message", (...args: unknown[]) => {
      for (const arg of args) {
        const text = consoleText(arg);
        if (!text.startsWith(this.prefix)) continue;
        try {
          this.latest = JSON.parse(text.slice(this.prefix.length)) as T;
        } catch {
          continue;
        }
        this.seen.push(this.latest);
        for (const notify of [...this.waiters]) notify();
      }
    });
  }

  current(): T | null {
    return this.latest;
  }

  /** EVERY marker since the last `reset()`, oldest first.
   *
   * A predicate over the LATEST line cannot answer a question about a face that
   * was up and is gone. The restore consent prompt is exactly that: it is
   * published with zero panes and replaced the moment it is answered or the
   * moment the workspace mounts without it — so "no prompt appeared" is a claim
   * about the whole window between the reload and the restored deck, and asking
   * the last line is asking about the one moment the answer is always no. */
  history(): readonly T[] {
    return this.seen;
  }

  /** Forget what the deck last said. Called immediately before a renderer
   * reload: `until` answers from the latest marker it has, so a pre-reload
   * state would satisfy a post-reload question — and every assertion about
   * what the deck did on COMING BACK would be about the deck that left. */
  reset(): void {
    this.latest = null;
    this.seen = [];
  }

  /** Resolve on the first marker satisfying `predicate`, including one already
   * seen — a state reached before the wait began is still the state. */
  async until(predicate: (facts: T) => boolean, what: string, timeoutMs: number) {
    if (this.latest !== null && predicate(this.latest)) return this.latest;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(notify);
        reject(
          new Error(
            `timed out waiting for ${what} (last: ${JSON.stringify(this.latest)}) after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);
      const notify = (): void => {
        if (this.latest === null || !predicate(this.latest)) return;
        clearTimeout(timer);
        this.waiters.delete(notify);
        resolve(this.latest);
      };
      this.waiters.add(notify);
    });
  }
}

/** The accelerator the LIVE application menu binds to Close Window, read out of
 * Electron's own installed menu rather than out of the template that built it —
 * and the difference between those two readings is the whole point.
 *
 * THE ⌘W ARBITRATION, what a smoke can prove about it, and what this reading
 * found the moment it was first taken (GT-5a).
 *
 * ⌘W means "close this window" in macOS and "close this pane" inside a terminal
 * deck; an application accelerator always wins, so with the overlay open the
 * close item must GIVE ⌘W UP or the deck's panes can never answer it.
 * `app-menu-model`'s `closeWindowItem` implements that handover by OMITTING the
 * accelerator while the overlay is open, and `installAppMenu` rebuilds the menu
 * on every toggle to make the omission take effect. Until GT-5a that function
 * ran after the godview harness returned, so the smoke pressed ⌘W with no
 * application menu installed at all and none of this was ever observed.
 *
 * MEASURED, on Electron 43.1.1, once it was: an omitted accelerator on a
 * `role`-bearing item is NOT an absent one. `MenuItem.accelerator` resolves to
 * `explicit ?? roleDefault`, and `role: "close"` carries a default of
 * `CommandOrControl+W` — so the item reports and binds ⌘W in BOTH overlay
 * states, and the handover releases nothing. An explicit accelerator does
 * override (a probe with `CommandOrControl+K` reported ⌘K), and an item with no
 * role at all reports null; `accelerator: null` and `registerAccelerator: false`
 * both still resolve to the role default.
 *
 * FIXED 2026-08-10 on exactly that measurement: the model now DROPS the role
 * while the overlay is open (the only spelling this probe found that reports
 * null), and supplies the role's close behaviour as an action. The two verdict
 * fields below stop being a record and become the ASSERTION — they are supposed
 * to differ, and this smoke now fails if they ever read alike again.
 *
 * What the smoke asserts: an application menu is INSTALLED while it presses ⌘W,
 * which is the gap the review named and the precondition for any of the rest.
 *
 * What it still cannot reach: whether macOS DELIVERS the chord to the page.
 * `sendInputEvent` injects synthesized events into Chromium's input pipeline,
 * below AppKit's key-equivalent dispatch, so a menu accelerator can neither
 * swallow nor pass the harness's ⌘W the way it would a real one. Row 6's
 * closing pane is honest evidence that the PANE answers ⌘W; it is not evidence
 * about what the menu would do to a keystroke from a keyboard. That step needs
 * a human at the machine — the repo's own lesson, that a chord needs a delivery
 * probe, and this chord has none. */
function closeWindowAccelerator(): string | null {
  const menu = Menu.getApplicationMenu();
  if (menu === null) return null;
  const item = menu.getMenuItemById(CLOSE_WINDOW_ITEM_ID);
  if (item === null) return null;
  return item.accelerator ?? null;
}

/** Press a chord the way a keyboard does: down, then up, with the character
 * Chromium expects. `sendInputEvent` injects at the browser's input layer, so
 * the workspace's own keydown listener and its Ghostty binding table decide
 * what happens — the harness presses keys and asserts nothing about routing. */
function pressChord(win: BrowserWindow, key: string, shift = false): void {
  const modifiers: ("meta" | "control" | "shift")[] = [
    process.platform === "darwin" ? "meta" : "control",
  ];
  if (shift) modifiers.push("shift");
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: key, modifiers });
  win.webContents.sendInputEvent({ type: "char", keyCode: key, modifiers });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: key, modifiers });
}

/** The zoom chord: ⌘⇧Enter on darwin, ctrl+shift+Enter elsewhere (TP-S2).
 *
 * Separate from `pressChord` because it needs SHIFT and because Return carries
 * no character — sending a `char` event for it would be a keystroke into the
 * shell, which is exactly what this row must not do. Ghosttea routes this
 * chord through its window capture listener and `workspaceOwnsHotkey` gate;
 * the row first focuses a terminal inside the workspace.
 *
 * DELIVERY IS NOT ASSUMED. `sendInputEvent` injects below AppKit's
 * key-equivalent dispatch (see `closeWindowAccelerator` for the ⌘W version of
 * this caveat), so the row treats a chord that produces no phase change as an
 * unproven DELIVERY rather than a broken zoom, and tries the pane frame's
 * fullscreen verb — recording which path it took. */
function pressZoomChord(win: BrowserWindow): void {
  const modifiers: ("meta" | "control" | "shift")[] = [
    process.platform === "darwin" ? "meta" : "control",
    "shift",
  ];
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return", modifiers });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return", modifiers });
}

/** Every pane's laid-out box, keyed by ghosttea's own `data-pane-id`.
 *
 * THE MEASUREMENT TP-R3 ACTUALLY WANTS. The floor's inventory carries no
 * geometry — `ObservedTerminal` is `{sessionId, pid, createdAt, persistence,
 * title, cwd, cell}` (`contracts/src/mgmt.ts:93-108`) — so there is no
 * daemon-side cols×rows for a harness to diff, and the deck's commit counter
 * alone would only bound the resizes from above. What CAN be measured is the
 * thing a resize is caused BY: a pane's layout box. `TerminalSurface` derives
 * its grid from `entry.contentRect` and commits a PTY resize only when that
 * derived grid moves, so a pane whose box is identical before and after a
 * gesture cannot have resized its session — and that is the half of the row
 * about the panes NOBODY zoomed.
 *
 * Rounded to whole pixels: sub-pixel layout jitter is not a resize (a change
 * below one 7.83px cell does not move the derived grid at all), and an
 * exact-float comparison would make this row fail on a fraction nothing can
 * see. `visibility: hidden` panes are still measured, deliberately — the
 * committed zoom hides its siblings that way precisely BECAUSE it keeps their
 * boxes, and this is the assertion that says so. */
async function paneBoxes(win: BrowserWindow): Promise<Record<string, string>> {
  return (await win.webContents.executeJavaScript(
    `(() => {
      const boxes = {};
      for (const pane of document.querySelectorAll("[data-pane-id]")) {
        const rect = pane.getBoundingClientRect();
        boxes[pane.getAttribute("data-pane-id")] =
          Math.round(rect.width) + "x" + Math.round(rect.height);
      }
      return boxes;
    })()`,
  )) as Record<string, string>;
}

/** Which pane ids changed box between two readings. The row's whole assertion
 * is about the SIZE of this set: exactly one on a zoom, zero everywhere else. */
function resizedPanes(before: Record<string, string>, after: Record<string, string>): string[] {
  return Object.keys(before).filter((paneId) => after[paneId] !== before[paneId]);
}

/** Pane boxes once they have been STABLE for `stableMs` — the quiescence read
 * a box-exactness row starts from now that metadata facts (title/cwd, TP-S3f)
 * arrive asynchronously and settle the chrome once shortly after birth. */
async function settledPaneBoxes(
  win: BrowserWindow,
  stableMs: number,
  timeoutMs: number,
): Promise<Record<string, string>> {
  const deadline = Date.now() + timeoutMs;
  let last = await paneBoxes(win);
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    await sleep(250);
    const now = await paneBoxes(win);
    if (resizedPanes(last, now).length > 0 || resizedPanes(now, last).length > 0) {
      last = now;
      stableSince = Date.now();
      continue;
    }
    if (Date.now() - stableSince >= stableMs) return now;
  }
  throw new Error(`pane boxes never settled within ${timeoutMs}ms (last: ${JSON.stringify(last)})`);
}

/** The SPLIT chord, which is not one chord. The workspace resolves Ghostty's
 * own binding table against the platform we hand it (`GodviewDeck` passes the
 * real `getHost().platform`), and Ghostty binds the split differently off
 * macOS: `cmd+d` there, `ctrl+shift+o` on Windows and Linux, where `ctrl+d` is
 * the shell's EOF and cannot be spent on a pane operation.
 *
 * The harness pressed ⌘D's KEY with the platform's modifier — `ctrl+d` on
 * Windows — which is a chord the deck does not bind and the shell does. So the
 * row timed out against a working deck. Asserting the mac chord everywhere
 * tests the harness's assumption, not the product. */
/** The CLOSE-PANE chord, or NULL where the platform binds none.
 *
 * Read from upstream's own fixtures rather than guessed: `super+w` is
 * `close_surface` in `keybinds-macos-default.json`, and
 * `keybinds-linux-default.json` — what a win32 workspace resolves — has no
 * `close_surface` binding at all. Its `ctrl+shift+w` is `close_tab:this`, a
 * different verb. Guessing that chord is exactly the mistake this constant
 * now prevents. */
const CLOSE_PANE_CHORD: { key: string; shift: boolean; label: string } | null =
  process.platform === "darwin" ? { key: "w", shift: false, label: "⌘W" } : null;

const SPLIT_CHORD: { key: string; shift: boolean; label: string } =
  process.platform === "darwin"
    ? { key: "d", shift: false, label: "⌘D" }
    : { key: "o", shift: true, label: "Ctrl+Shift+O" };

/** Put keyboard focus in the workspace's active terminal.
 *
 * Workspace shortcuts act on its active pane. Focusing a different textarea
 * relies on a focus event to activate that pane, which a background document
 * may not dispatch. Keep DOM focus on the already-active pane so zoom does not
 * hide the input that must receive the return gesture. */
async function focusDeck(win: BrowserWindow): Promise<void> {
  win.focus();
  win.webContents.focus();
  // Focus is PLACED, not clicked into. `sendInputEvent` injects events but does
  // not run Chromium's default actions for them, so a synthesized mousedown on
  // the terminal does not focus it — it blurs whatever was focused, which is
  // the opposite of what a real click does. Asking the page to focus the
  // surface reproduces the state a real click leaves behind.
  //
  // What is under test starts AFTER this: the key events below are real, and
  // everything they reach — ghosttea's binding table, the workspace's command
  // routing, `createSplitSession`, fieldd — runs exactly as it does for a user.
  const focused = (await win.webContents.executeJavaScript(
    `(() => { const t = document.querySelector(".ghostty-pane.is-active .terminal-input"); if (!t) return "no active surface";
      const r = t.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return "surface has no size";
      t.focus();
      return document.activeElement === t ? "ok" : "focus refused"; })()`,
  )) as string;
  if (focused !== "ok") throw new Error(`the deck could not take keyboard focus: ${focused}`);
  await sleep(150);
}

/** Type through the focused production TerminalSurface, one real key pair at a
 * time. No automation/UDS side door participates in this command. */
async function typeTerminalLine(win: BrowserWindow, line: string): Promise<void> {
  for (const character of line) {
    const keyCode = character === " " ? "Space" : character;
    // A capital must CARRY shift: a bare keyDown synthesizes the UNSHIFTED
    // key, and the shell quietly receives the lowercase twin. Invisible for
    // as long as every typed string was lowercase; caught the first time this
    // ladder typed a mixed-case path (row 9's mkdtemp scratch dir landed as
    // its lowercase spelling — the cd still succeeded on case-insensitive
    // APFS, which is what made the drop silent instead of loud).
    const modifiers: Array<"shift"> = character !== character.toLowerCase() ? ["shift"] : [];
    win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await sleep(3);
  }
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
}

async function waitForShellMarker(
  path: string,
  timeoutMs = 15_000,
  marker?: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const content = readFileSync(path, "utf8");
      if (marker === undefined || content.includes(marker)) return;
    } catch {
      /* not yet */
    }
    await sleep(25);
  }
  throw new Error(`the routed pane did not create ${path}`);
}

/** What has DOM focus, for a failure message. Diagnostic only — no assertion
 * reads it, so the harness never passes on the strength of its own probe. */
async function focusReport(win: BrowserWindow): Promise<string> {
  try {
    return String(
      await win.webContents.executeJavaScript(
        // biome-ignore lint/suspicious/noTemplateCurlyInString: this is renderer-side source text.
        "`hasFocus=${document.hasFocus()} active=${document.activeElement?.tagName}.${document.activeElement?.className}`",
      ),
    );
  } catch (error) {
    return `unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** The `UNAVAILABLE` fieldd answers `terminal.list` with before its first
 * snapshot from the floor has applied, if it answers one at all.
 *
 * An UNARMED inventory is not an empty one, and until fieldd learned to say so
 * it answered `[]` — indistinguishable from "no terminals here", which is how a
 * restore came to offer to delete a layout whose sessions were alive (GT §9
 * finding 2). A harness must read the refusal the way the deck does: as a state
 * with a name, meaning ASK AGAIN, not as a failure. Recognised structurally
 * rather than by message text, and tolerated whether or not the fieldd on the
 * other end has learned to send it yet. */
function unobservedRefusal(error: unknown): string | null {
  if (!(error instanceof Error) || !("kind" in error) || error.kind !== "UNAVAILABLE") return null;
  const details = (error as { details?: unknown }).details;
  const state =
    details !== null && typeof details === "object" && "state" in details
      ? String((details as { state: unknown }).state)
      : "unstated";
  return state;
}

const listTerminals = async (handle: FielddHandle): Promise<TerminalListResult["terminals"]> =>
  TerminalListResult.parse(await handle.client.request("terminal.list", {})).terminals;

/** `terminal.list`, retried through an honest refusal. Every read of the floor
 * in this harness goes through here or through `untilFloor`, which does the
 * same: a row that failed because fieldd had not looked yet would be reporting
 * on the clock rather than on the product. */
async function listTerminalsWhenObserved(
  handle: FielddHandle,
  timeoutMs = 20_000,
): Promise<TerminalListResult["terminals"]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await listTerminals(handle);
    } catch (error) {
      if (unobservedRefusal(error) === null || Date.now() >= deadline) throw error;
      await sleep(150);
    }
  }
}

/** Poll `terminal.list` until it agrees.
 *
 * `terminal.list` reports fieldd's OBSERVED inventory, which is one management
 * round trip behind the floor — GT-0 measured 62–117ms for a session to appear
 * after its birth, and GT-1 answered it for CREATE by returning the ticket
 * inline rather than by making the observation faster. The lag is still real
 * for anyone reading the list, so a harness that reads once is asserting on the
 * clock. Polling asks the question the test actually means: does the floor come
 * to list this session. */
async function untilFloor(
  handle: FielddHandle,
  predicate: (terminals: TerminalListResult["terminals"]) => boolean,
  what: string,
  timeoutMs: number,
): Promise<TerminalListResult["terminals"]> {
  const deadline = Date.now() + timeoutMs;
  let last: TerminalListResult["terminals"] = [];
  let refusals = 0;
  let lastRefusal = "";
  while (Date.now() < deadline) {
    try {
      last = await listTerminals(handle);
    } catch (error) {
      // An unarmed inventory is fieldd declining to guess, which is the whole
      // point of the refusal — so it is a reason to ask again, never a failure.
      const state = unobservedRefusal(error);
      if (state === null) throw error;
      refusals += 1;
      lastRefusal = state;
      await sleep(150);
      continue;
    }
    if (predicate(last)) return last;
    await sleep(150);
  }
  const refused =
    refusals > 0 ? `; ${refusals} refusal(s), last UNAVAILABLE {state:"${lastRefusal}"}` : "";
  throw new Error(
    `the floor never ${what} within ${timeoutMs}ms (saw ${last.length} terminals${refused})`,
  );
}

/** Every persistence value the floor was ever seen to hold for one session, in
 * the order they were observed.
 *
 * The flip rows (GT-D11) assert that field-native RE-GOVERNS a workspace birth
 * from `terminate-with-app` to `keep-until-exit`. Waiting for the destination
 * alone cannot tell a working flip from a door that never needed one: if a
 * ghosttea upgrade started defaulting workspace panes to `keep-until-exit`, the
 * native flip could be dead code and the rows would stay green. So the harness
 * records what it SAW, and the row says out loud whether the precondition was
 * ever observable — the sampler runs from the toggle, ahead of the birth, which
 * is the earliest any observed inventory can be asked. */
class PersistenceSampler {
  private readonly observed = new Map<string, string[]>();
  private stopped = false;
  /** How many times the floor actually ANSWERED, and how many times it did not.
   *
   * An empty trail means one of two very different things — the session was
   * never listed, or the sampler never got to look — and a guard that cannot
   * tell them apart is reporting on itself. Measured 2026-08-21: under load a
   * poll cycle costs ~1.7s, not the nominal 50ms, so "the sampler has not looked
   * since that session was born" is a real state and not a hypothetical one. */
  polls = 0;
  refusals = 0;
  readonly running: Promise<void>;

  constructor(handle: FielddHandle, intervalMs = 50) {
    this.running = (async () => {
      while (!this.stopped) {
        try {
          const rows = await listTerminals(handle);
          this.polls += 1;
          for (const row of rows) {
            const seen = this.observed.get(row.sessionId) ?? [];
            const persistence = row.persistence ?? "unstated";
            if (seen.at(-1) !== persistence) seen.push(persistence);
            this.observed.set(row.sessionId, seen);
          }
        } catch {
          /* a refusal or a blip is not this sampler's business to report */
          this.refusals += 1;
        }
        await sleep(intervalMs);
      }
    })();
  }

  /** Every session this sampler has ever seen listed. */
  seen(): string[] {
    return [...this.observed.keys()];
  }

  /** What this session was observed to be, oldest first. Empty means the
   * sampler never saw the session at all. */
  trail(sessionId: string): readonly string[] {
    return this.observed.get(sessionId) ?? [];
  }

  /**
   * Wait until this sampler has actually LOOKED at a session.
   *
   * The reason it exists (measured 2026-08-21): a trail read straight after
   * `untilFloor` confirms the floor lists a session can still be empty, because
   * `untilFloor` returns the instant the inventory answers and the sampler's own
   * next poll is up to a cycle away — 35 polls across a whole run under load.
   * Reading then measures the sampler's cadence, not the floor. Waiting here
   * moves the reading back onto the floor.
   */
  async untilSeen(sessionId: string, timeoutMs = 20_000): Promise<readonly string[]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const trail = this.trail(sessionId);
      if (trail.length > 0) return trail;
      await sleep(100);
    }
    return this.trail(sessionId);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.running;
  }
}

/** Ask the ACTIVE pane what `expression` evaluates to, and prove it ran.
 *
 * TP-S3e: this types through the RENDERER (the product path — DOM key events
 * into the focused TerminalSurface, over the routed SendInput verb) instead of
 * a second UDS automation client riding the retired legacy ticket. One line
 * carries both proofs: the SIDE EFFECT (the marker only lands if the shell
 * executed the line) and the answer file. The caller must have the target
 * pane ACTIVE (focusDeck for the first pane). */
async function askPane(
  win: BrowserWindow,
  answerPath: string,
  expression: string,
): Promise<{ marker: string; value: string }> {
  const marker = `godview-${Math.random().toString(36).slice(2, 10)}`;
  const markerPath = `${answerPath}.marker`;
  await typeLineUntilMarker(
    win,
    `printf '%s' "${expression}" > ${answerPath}; echo ${marker} > ${markerPath}`,
    markerPath,
    marker,
  );
  const value = readFileSync(answerPath, "utf8").trim();
  return { marker, value };
}

/** Type a line into the ACTIVE pane and wait for its marker, retyping a
 * bounded number of times: the routed activation may still be opening when the
 * first attempt lands, and a line suppressed before `InputAllowed` never
 * reaches the PTY — so a retype cannot double-run anything. Each attempt
 * re-places focus first. */
async function typeLineUntilMarker(
  win: BrowserWindow,
  line: string,
  markerPath: string,
  marker: string,
): Promise<void> {
  let lastFailure: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await focusDeck(win);
    await typeTerminalLine(win, line);
    try {
      await waitForShellMarker(markerPath, 10_000, marker);
      return;
    } catch (failure) {
      lastFailure = failure;
    }
  }
  throw lastFailure instanceof Error ? lastFailure : new Error(String(lastFailure));
}

/** Run one line in the ACTIVE pane and wait for the shell to have finished it.
 * Used to move a pane's cwd — the thing GT-3's restore has to carry across a
 * death. TP-S3e: typed through the RENDERER (the routed SendInput product
 * path); the caller must have the target pane active. */
async function runInPane(win: BrowserWindow, markerPath: string, line: string): Promise<void> {
  const marker = `godview-${Math.random().toString(36).slice(2, 10)}`;
  await typeLineUntilMarker(win, `${line}; echo ${marker} > ${markerPath}`, markerPath, marker);
}

/** Click a button in the deck's own chrome by its visible text.
 *
 * `element.click()` and not a synthesized mouse event: `sendInputEvent` injects
 * at the browser's input layer but skips Chromium's default actions, so a
 * synthesized mousedown on a button does not activate it (GT-2 finding 4, the
 * reason the deck is focused page-side). A DOM click dispatches a real,
 * bubbling click event, which is what React's root listener is waiting for. */
async function clickDeckButton(win: BrowserWindow, label: string): Promise<void> {
  // Polled, not asserted-on-arrival: a marker says what the deck WAS at the
  // moment it published, and a face can still be a render away. A harness that
  // demands an affordance exist the instant it looks for it is testing its own
  // timing, so this waits for the button the way a person would.
  const deadline = Date.now() + 20_000;
  let seen = "";
  while (Date.now() < deadline) {
    const clicked = (await win.webContents.executeJavaScript(
      `(() => {
        const buttons = [...document.querySelectorAll("button")];
        const button = buttons.find(
          (candidate) => candidate.textContent.trim() === ${JSON.stringify(label)},
        );
        if (!button) return "absent: " + buttons.map((b) => b.textContent.trim()).join("|");
        button.click();
        return "ok";
      })()`,
    )) as string;
    if (clicked === "ok") return;
    seen = clicked;
    await sleep(200);
  }
  throw new Error(`no "${label}" button appeared within 20s (${seen})`);
}

/** GT-7: a thrown RPC refusal's kind and details — structural, like
 * `unobservedRefusal`, because the error crosses the supervisor's client. */
function rpcRefusal(error: unknown): { kind: string; details: unknown } | null {
  if (!(error instanceof Error) || !("kind" in error)) return null;
  return {
    kind: String((error as { kind: unknown }).kind),
    details: (error as { details?: unknown }).details,
  };
}

/** Evaluate `expression` in the renderer until it answers "ok"; a timeout says
 * what it answered last, which is the fact a reader needs. */
async function untilRenderer(
  win: BrowserWindow,
  label: string,
  expression: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let seen = "";
  while (Date.now() < deadline) {
    const answer = (await win.webContents.executeJavaScript(expression)) as string;
    if (answer === "ok") return;
    seen = answer;
    await sleep(200);
  }
  throw new Error(`${label} did not happen within ${timeoutMs}ms (${seen})`);
}

/** `untilRenderer` for a value (One Frame FR-2's row 11h): poll until `accept`
 * takes what the page answers, and hand that answer back. */
async function untilRendererValue(
  win: BrowserWindow,
  label: string,
  expression: string,
  timeoutMs: number,
  accept: (value: string) => boolean,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let seen = "";
  while (Date.now() < deadline) {
    const answer = (await win.webContents.executeJavaScript(expression)) as string;
    if (accept(answer)) return answer;
    seen = answer;
    await sleep(200);
  }
  throw new Error(`${label} did not happen within ${timeoutMs}ms (${seen})`);
}

/** Click the first button inside `scope` whose text or accessible name is
 * `label` — polled, like `clickDeckButton`, and scoped, because a settings
 * page and the deck behind it can both hold a "Save" or a "Terminal". */
async function clickIn(win: BrowserWindow, scope: string, label: string): Promise<void> {
  await untilRenderer(
    win,
    `a "${label}" button in ${scope}`,
    `(() => {
      const root = document.querySelector(${JSON.stringify(scope)});
      if (!root) return "no ${scope.replaceAll('"', "'")}";
      const button = [...root.querySelectorAll("button")].find(
        (candidate) =>
          candidate.textContent.trim() === ${JSON.stringify(label)} ||
          candidate.getAttribute("aria-label") === ${JSON.stringify(label)},
      );
      if (!button) return "absent";
      if (button.disabled) return "disabled";
      button.click();
      return "ok";
    })()`,
    20_000,
  );
}

/** GT-D21's chords as a keyboard presses them — down, then up, and NO `char`
 * event: a command chord types nothing, and a stray character reaching the
 * shell is the very leak row 11e watches for. */
function pressProductChord(win: BrowserWindow, keyCode: string): void {
  const modifiers: ("meta" | "control")[] = [process.platform === "darwin" ? "meta" : "control"];
  win.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
}

/** One Frame FR-1 — the view keys as a keyboard presses them: ⌘1–⌘4 on darwin,
 * Ctrl+1–4 elsewhere, through `pressProductChord`. This is the road a person
 * takes to a view, so the harness takes it too rather than asking main's view
 * owner directly (the old `toggleGodview` handed it main's own action). */
const VIEW_DIGIT: Readonly<Record<FrameView, string>> = {
  canvas: "1",
  godview: "2",
  history: "3",
  assistant: "4",
};

function pressViewKey(win: BrowserWindow, view: FrameView): void {
  pressProductChord(win, VIEW_DIGIT[view]);
}

/** The window's view as the frame draws it (the views track's `data-view`). */
const VIEW_NOW = `(document.querySelector(".vf-views-line")?.getAttribute("data-view") ?? "absent")`;

/** Row 11e's ear at the pane: a target-phase keydown listener on every deck
 * input, beside ghosttea's own. A key that reaches the pane at all is heard
 * here — ghosttea stops PROPAGATION, never the listeners on its own target. */
const CHORD_PROBE = `(() => {
  const inputs = [...document.querySelectorAll(".vf-godview-terminal-deck .terminal-input")];
  if (inputs.length === 0) return "no pane input";
  window.__vfChordProbe = [];
  for (const input of inputs) {
    if (input.__vfChordProbed) continue;
    input.__vfChordProbed = true;
    input.addEventListener("keydown", (event) => {
      window.__vfChordProbe.push((event.metaKey ? "meta+" : "") + (event.ctrlKey ? "ctrl+" : "") + event.key);
    });
  }
  return "ok";
})()`;

/** Whether the element a pointer would hit at `selector`'s centre belongs to
 * it — the check that catches a surface opened BEHIND Godview's stage, which
 * the DOM alone would call open. */
function onTop(selector: string): string {
  return `(() => {
    const surface = document.querySelector(${JSON.stringify(selector)});
    if (!surface) return "absent";
    const box = surface.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + Math.min(box.height / 2, 40));
    return surface.contains(hit) ? "ok" : "under " + (hit?.closest("[class]")?.className ?? "nothing");
  })()`;
}

async function chordProbeHeard(win: BrowserWindow): Promise<string[]> {
  return (await win.webContents.executeJavaScript(
    `[...(window.__vfChordProbe ?? [])]`,
  )) as string[];
}

/**
 * Click a verb on the record's PANE FRAME, by its accessible name (GT-6a).
 *
 * A separate helper from `clickDeckButton` because the frame's verbs are
 * glyphs: they carry no text to match on, and their whole vocabulary is the
 * `aria-label` the package writes (`views/src/deck/PaneFrame.tsx`). Pointer-only
 * by design — the record shows the verbs under the pointer — which a DOM
 * `click()` reaches anyway, the same way `clickDeckButton` reaches a chip that
 * CSS has faded to 0.45 opacity.
 *
 * A failure here says what the DOM DID hold, because the commonest cause is not
 * a missed render: it is a pane the package draws no verbs on at all (a bare
 * shell, where `model.verb` is undefined), and a bare "not found" would send
 * the reader hunting for a timing bug that is not there.
 */
async function clickPaneFrameVerb(win: BrowserWindow, ariaLabel: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  let seen = "";
  while (Date.now() < deadline) {
    const clicked = (await win.webContents.executeJavaScript(
      `(() => {
        const verbs = [...document.querySelectorAll(".vf-pane-frame .vf-pane-verb")];
        const verb = verbs.find(
          (candidate) => candidate.getAttribute("aria-label") === ${JSON.stringify(ariaLabel)},
        );
        if (!verb) {
          const frames = document.querySelectorAll(".vf-pane-frame").length;
          return "absent: frames=" + frames + " verbs=" + verbs
            .map((v) => v.getAttribute("aria-label") ?? v.className)
            .join("|");
        }
        verb.click();
        return "ok";
      })()`,
    )) as string;
    if (clicked === "ok") return;
    seen = clicked;
    await sleep(200);
  }
  throw new Error(
    `no pane-frame verb labelled "${ariaLabel}" appeared within 20s (${seen}) — a frame with no verbs is a pane the package draws none on (a bare shell: \`model.verb\` undefined in views' pane-frame.ts)`,
  );
}

/**
 * Click a bubble on the MONITOR stage, by CSS selector (GT-4).
 *
 * A DOM click for `clickDeckButton`'s reason (GT-2 finding 4: a synthesized
 * mousedown skips Chromium's default actions and blurs a terminal on the way
 * past), and selected by class rather than by text because a bubble's words are
 * a project name — the fact under test is which SOURCE the row came from, and
 * that is what the class says.
 *
 * Returns the bubble's accessible name, so the verdict records what was
 * actually clicked instead of asserting that something was.
 */
async function clickMonitorBubble(win: BrowserWindow, selector: string): Promise<string> {
  const deadline = Date.now() + 20_000;
  let seen = "";
  while (Date.now() < deadline) {
    const clicked = (await win.webContents.executeJavaScript(
      `(() => {
        const bubble = document.querySelector(${JSON.stringify(selector)});
        if (!bubble) return "absent";
        const label = bubble.getAttribute("aria-label") ?? "";
        bubble.click();
        return "ok:" + label;
      })()`,
    )) as string;
    if (clicked.startsWith("ok:")) return clicked.slice(3);
    seen = clicked;
    await sleep(200);
  }
  throw new Error(`no monitor bubble matched ${selector} within 20s (${seen})`);
}

/**
 * Wait until the deck has published nothing new for `quietMs` (GT-4).
 *
 * A before/after comparison needs a BEFORE that is not still moving. This row's
 * predecessor is the bridge kill, and a recovered deck goes on working after it
 * reports: a new runtime remounts the workspace, which re-reads the saved
 * layout, which rehydrates the pane whose session the kill row ended — a birth
 * that lands a second or two later and has nothing to do with the click under
 * test. The first version of this row sampled into that window and blamed a
 * mock agent for it (measured, not imagined: the id it saw replaced was
 * `killedSession`).
 *
 * Quiescence rather than a fixed sleep, because the settling time is the
 * machine's, not ours.
 */
async function deckSettled(
  deck: MarkerWatch<DeckFacts>,
  quietMs: number,
  timeoutMs: number,
): Promise<DeckFacts> {
  const deadline = Date.now() + timeoutMs;
  let last = JSON.stringify(deck.current());
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    await sleep(250);
    const now = JSON.stringify(deck.current());
    if (now !== last) {
      last = now;
      quietSince = Date.now();
      continue;
    }
    const facts = deck.current();
    if (facts !== null && Date.now() - quietSince >= quietMs) return facts;
  }
  throw new Error(`the deck never settled for ${quietMs}ms within ${timeoutMs}ms (last: ${last})`);
}

/** What the stage last said out loud about a gesture. The acknowledgement is
 * the monitor's honest confirmation, and reading it is how the harness checks
 * the WORDS a person would have read rather than only the state behind them. */
async function readMonitorAck(win: BrowserWindow): Promise<string> {
  return (await win.webContents.executeJavaScript(
    `(document.querySelector(".vf-monitor-ack")?.textContent ?? "").trim()`,
  )) as string;
}

/** AR-3's claim, as a person can read it: the words in the local chip
 * ELEMENT, and whether it is actually on screen.
 *
 * The stage's own marker carries the same sentence, but it carries the pure
 * function's return value — so deleting the `<span>`, or hiding it, or letting
 * a layout push it out of the viewport, would leave the marker honest while the
 * screen disclosed nothing. Absent is an empty string and not a throw: an empty
 * disclosure is the failure this row exists to name, and it should be named in
 * the row's own words rather than as a TypeError from the harness.
 *
 * Polled for `readMonitorAck`'s reason and `clickDeckButton`'s: a marker says
 * what the stage WAS when it published, and a chip can still be a render away. */
interface PaneFrameFacts {
  framed: boolean;
  frames: number;
  frameInPane: boolean;
  name: string;
  narrow: number;
}

/**
 * The deck's pane frames, POLLED (GT-6 review).
 *
 * The frames are mounted by a mutation observer whose sync is a `setTimeout 0`,
 * so they land a macrotask after the panes they portal into: a single read at
 * the moment the deck reports its panes samples the instant before the chrome
 * exists and calls it a missing frame. Same deadline-poll shape as the local
 * chip above rather than `MarkerWatch.until`, because a frame publishes no
 * marker — the DOM is the only thing that can be asked.
 */
async function readPaneFrameFacts(win: BrowserWindow, timeoutMs: number): Promise<PaneFrameFacts> {
  const deadline = Date.now() + timeoutMs;
  let seen: PaneFrameFacts = { framed: false, frames: 0, frameInPane: false, name: "", narrow: 0 };
  while (Date.now() < deadline) {
    seen = (await win.webContents.executeJavaScript(
      `(() => {
         const deck = document.querySelector(".vf-godview-terminal-deck .vf-deck-zoom");
         const pane = document.querySelector(".vf-godview-terminal-deck .ghostty-pane.is-active")
           ?? document.querySelector(".vf-godview-terminal-deck .ghostty-pane");
         const frame = pane?.querySelector(".vf-pane-frame") ?? null;
         return {
           framed: deck?.classList.contains("vf-deck-framed") === true,
           frames: document.querySelectorAll(".vf-godview-terminal-deck .vf-pane-frame").length,
           frameInPane: frame !== null,
           name: frame?.querySelector(".vf-pane-name")?.textContent ?? "",
           narrow: document.querySelectorAll(".vf-godview-terminal-deck .ghostty-pane[data-vf-narrow]").length,
         };
       })()`,
    )) as PaneFrameFacts;
    // The badge is the last of the three to exist, so a named frame means the
    // whole chrome is up; everything else is asserted on what this returns.
    if (seen.framed && seen.frameInPane && seen.name !== "") return seen;
    await sleep(200);
  }
  return seen;
}

async function readMonitorLocalChip(win: BrowserWindow, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let seen = "";
  while (Date.now() < deadline) {
    seen = (await win.webContents.executeJavaScript(
      `(() => {
        const chip = document.querySelector(".vf-monitor-local-chip");
        if (!chip) return "";
        const box = chip.getBoundingClientRect();
        // On screen at a readable size, or it is not a disclosure. A zero-box
        // or off-viewport chip reads to a person exactly like no chip at all.
        if (box.width < 1 || box.height < 1) return "";
        if (box.bottom < 0 || box.right < 0) return "";
        if (box.top > window.innerHeight || box.left > window.innerWidth) return "";
        return (chip.textContent ?? "").trim();
      })()`,
    )) as string;
    if (seen !== "") return seen;
    await sleep(200);
  }
  return seen;
}

/** The deck's saved layout, as the page holds it. Read so the smoke can assert
 * what `paneMeta` actually persisted rather than trusting that it did. */
async function readDeckLayout(win: BrowserWindow): Promise<string | null> {
  return (await win.webContents.executeJavaScript(`localStorage.getItem("vf-godview-deck-v1")`)) as
    | string
    | null;
}

/** Close the overlay, reload the renderer, open it again — the GT-2e claim
 * row's idiom, minus the `localStorage.clear()`. This is how a restore is
 * staged: the document dies and comes back while the FLOOR does not. */
async function reopenAfterReload(opts: {
  win: BrowserWindow;
  deck: MarkerWatch<DeckFacts>;
  viteUrl: string;
}): Promise<void> {
  pressViewKey(opts.win, "canvas");
  await opts.deck.until((facts) => !facts.active, "the overlay to close", 20_000);
  const reloaded = waitForConsole(opts.win, "CANVAS_READY ", 60_000);
  reloaded.catch(() => undefined);
  opts.deck.reset();
  await loadRenderer(opts.win, "smoke-godview", opts.viteUrl);
  await reloaded;
  opts.win.focus();
  opts.win.webContents.focus();
  pressViewKey(opts.win, "godview");
}

/** Report-only keystroke-echo latency — SKIPPED since TP-S3e: the probe
 * staged its line through the UDS automation door, which retired with the
 * legacy ticket. The AR-lane automation surface (fieldd-brokered) is the named
 * follow-up; until then the number is honestly unmeasured rather than
 * measured through a resurrected credential. Never gated anything. */
async function measureKeystrokeEcho(
  _win: BrowserWindow,
  _handle: FielddHandle,
  _sessionId: string,
  _markerPath: string,
): Promise<{ ms: number } | { skipped: string }> {
  return { skipped: "s3e-instrument-debt: the UDS staging door retired with the bridge" };
}

/** The shell name a path names, with the login-shell `-` convention allowed
 * for: a login shell reports `$0` as `-zsh`, and it is the same zsh. */
const shellName = (path: string): string => (path.split("/").pop() ?? path).replace(/^-/, "");

/** Main's resolution, mirrored — deliberately NOT imported from
 * `main/login-shell.ts`. Importing it would make this row assert that main
 * agrees with itself; writing the ladder out means the row fails if main's
 * answer ever stops being the user's shell. */
function expectedLoginShell(): string {
  const nonEmpty = (value: string | undefined | null): string | undefined => {
    const trimmed = value?.trim();
    return trimmed !== undefined && trimmed !== "" ? trimmed : undefined;
  };
  if (process.platform === "win32") return nonEmpty(process.env["COMSPEC"]) ?? "powershell.exe";
  return nonEmpty(process.env["SHELL"]) ?? nonEmpty(userInfo().shell) ?? "/bin/zsh";
}

/** A reported cwd as a filesystem path.
 *
 * The floor reports whatever the shell announced over OSC 7, verbatim — which
 * is a `file://host/path` URL. Written out here rather than imported from the
 * deck's own `paneCwd` on purpose: this is the harness's independent reading of
 * the same wire value, so a decoder that quietly stopped decoding would fail
 * this row instead of agreeing with itself. */
function cwdPath(reported: string | null | undefined): string | null {
  if (typeof reported !== "string" || reported === "") return null;
  if (reported.startsWith("/")) return reported;
  try {
    return decodeURIComponent(new URL(reported).pathname);
  } catch {
    return null;
  }
}

/** One path with its symlinks resolved, or the path itself when they cannot be.
 *
 * `realpathSync`, DELIBERATELY NOT `realpathSync.native`. The JS implementation
 * resolves symlinks while preserving the caller's spelling of every real
 * component; `.native` (`realpath(3)`) additionally folds case to the on-disk
 * truth. On case-insensitive APFS that folding would quietly make a path typed
 * with a DROPPED SHIFT compare equal to the one intended — which is the exact
 * silent drop `typeTerminalLine`'s modifier ladder exists to catch (see its
 * comment: row 9's mkdtemp scratch dir once landed as its lowercase spelling and
 * the `cd` still succeeded). The rows below must keep failing on that, so the
 * canonicalisation stops at symlinks and goes no further.
 *
 * An unresolvable path comes back verbatim rather than throwing: these run
 * inside poll predicates, where an exception is a harness crash rather than a
 * "not yet". `samePlace` keeps a raw-string arm, so an unresolvable pair still
 * answers honestly. */
function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** THE harness's one reading of "this pane is sitting in that directory".
 *
 * macOS hands out every temp root behind a SYMLINK, and the two spellings are
 * not interchangeable in a string compare: `/tmp` → `/private/tmp`, and the
 * DEFAULT `$TMPDIR` (`/var/folders/<hash>/T`) → `/private/var/folders/<hash>/T`.
 * A shell announces whichever spelling its own `$PWD` holds, and both are
 * reachable in one run: zsh's `cd` keeps the LOGICAL path it was handed, while a
 * freshly spawned shell inherits the PHYSICAL one from `getcwd(3)`. So a pane's
 * cwd legitimately comes back in either, and the expected side has to be
 * canonicalised rather than trusted.
 *
 * Both spellings are MEASURED, not assumed — one green run reports both at once
 * (2026-09-13, under `TMPDIR=/tmp` and under the macOS default alike):
 *   recordedCwd    file://<host>/tmp/vf-smoke-godview-o3xiDp/work
 *   rehydratedCwd  file://<host>/private/tmp/vf-smoke-godview-o3xiDp/work
 *
 * This was a local closure guarding ONE row — the rehydrated read, whose comment
 * already knew about the pair — while the two readings before it (the `inWorkdir`
 * wait and the layout's substring search) compared raw strings. Those two held
 * only because zsh's `cd` keeps the LOGICAL path it was handed, so the typed
 * line's echo happens to match a logical expectation: a property of the user's
 * shell, not of the product, and one a `setopt chaselinks` or a `${PWD:A}` in an
 * integration would take away. Hoisting the closure removes that dependence.
 *
 * HONEST SCOPE (QA 2026-09-13, finding 3c): this is NOT the demonstrated cause of
 * that report's red under the default `$TMPDIR`. That red did not reproduce here
 * — both roots pass, and they pass with the raw comparison too, because the
 * recorded reading comes back logical under `/var/folders/…` exactly as it does
 * under `/tmp`. What is fixed here is a latent asymmetry, not a witnessed
 * failure. One helper, every cwd row. */
function samePlace(announced: string | null | undefined, expected: string): boolean {
  if (typeof announced !== "string" || announced === "") return false;
  return announced === expected || canonicalPath(announced) === canonicalPath(expected);
}

// NO sun_path FAIL-FAST ROW HERE, and that is a measured decision rather than an
// omission (QA 2026-09-13, finding 3c asked for one).
//
// 1. The class already fails fast, EARLIER than this file can reach. A data root
//    whose sockets would blow the ~104-byte `sun_path` ceiling is refused by
//    `assertDataRootUsable` inside the supervisor (fieldd-supervisor
//    `supervisor.ts`), which runs while `fielddReady` is awaited — i.e. before
//    `runSmokeGodview` is even called, before a window, and nowhere near a cwd
//    row. Measured: `FIELDD_DATA_DIR` at an 83-byte root (termframe → 108) exits
//    the smoke in ~4s. A guard here could not fire.
// 2. Canonicalising the root for that budget would be WRONG, which is the
//    non-obvious half. `realpath` belongs on a cwd COMPARISON (below) and not on
//    a socket MEASUREMENT: field-native binds the literal string it is handed,
//    and `sun_path` counts that string. Measured on this machine — a 75-byte
//    `/tmp` root bound mgmt, meshdata and both cells' termctl/termframe without
//    complaint, though its `/private/tmp` spelling reaches 110 bytes. Measuring
//    the realpath would refuse roots that work.
//
// What is genuinely missing is one line of PROSE, not one of measurement: the
// shell's top-level catch prints `VibeField shell failed before logging
// initialized` and drops the SupervisorError detail, which already names the
// socket and its byte count. That line lives in main, not in the harness.

/** How the floor governs one session's retention, or undefined if it is gone. */
const persistenceOf = (
  terminals: TerminalListResult["terminals"],
  sessionId: string,
): string | undefined => terminals.find((t) => t.sessionId === sessionId)?.persistence;

// ---- AR-7: the typed agent ---------------------------------------------------

/** Ask `read` until it answers, bounded; a timeout names what was awaited. */
async function untilRead<T>(
  what: string,
  timeoutMs: number,
  read: () => T | undefined | Promise<T | undefined>,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await sleep(150);
  }
  throw new Error(`${what} did not happen within ${timeoutMs}ms`);
}

const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** The selector for the frame the deck portals into the pane showing a session
 * — the frame names its session (`data-vf-pane-frame`, views' PaneFrame). */
const frameOf = (sessionId: string): string =>
  `.vf-godview-terminal-deck [data-vf-pane-frame="${sessionId}"]`;

/** Put the caret in ONE pane — the one showing `sessionId` — the way
 * `focusDeck` does for the first: placed, not clicked (its comment says why).
 * The pane is found through its frame, polled because the frames land a
 * macrotask after the panes they portal into. */
async function focusPane(win: BrowserWindow, sessionId: string): Promise<void> {
  win.focus();
  win.webContents.focus();
  const deadline = Date.now() + 20_000;
  let seen = "";
  while (Date.now() < deadline) {
    seen = (await win.webContents.executeJavaScript(
      `(() => {
        const frame = document.querySelector(${JSON.stringify(frameOf(sessionId))});
        if (!frame) return "no frame names the session";
        const input = frame.closest(".ghostty-pane")?.querySelector(".terminal-input");
        if (!input) return "the frame's pane has no input";
        const r = input.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return "the input has no size";
        input.focus();
        return document.activeElement === input ? "ok" : "focus refused";
      })()`,
    )) as string;
    if (seen === "ok") {
      await sleep(150);
      return;
    }
    await sleep(200);
  }
  throw new Error(`the pane showing ${sessionId} could not take keyboard focus: ${seen}`);
}

/** `typeLineUntilMarker` for ONE pane: a line that is safe to type twice,
 * retyped until its marker lands, focus placed in that pane each time. */
async function typeInPaneUntilMarker(
  win: BrowserWindow,
  sessionId: string,
  line: string,
  markerPath: string,
  marker: string,
): Promise<void> {
  let lastFailure: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await focusPane(win, sessionId);
    await typeTerminalLine(win, line);
    try {
      await waitForShellMarker(markerPath, 10_000, marker);
      return;
    } catch (failure) {
      lastFailure = failure;
    }
  }
  throw lastFailure instanceof Error ? lastFailure : new Error(String(lastFailure));
}

/** One read of a pane's launch, for the launch rows. */
interface LaunchSample {
  ms: number;
  launch: string | null;
  held: string | null;
  caption: string | null;
}

/**
 * THE LAUNCH (QL-2, the Minimal Pane Frame's pass 4 §27, look C · Cells). A
 * fresh pane's launcher launches the smoke's stub — the one agent installed
 * here, every other agent's install being absent — and the launch is read
 * from the click to the stub's first frame:
 *   1. in the click's frame (after React's commit, before any animation frame):
 *      the launch is in the pane, the launcher is leaving, and the badge's own
 *      mark is held (C1, C6);
 *   2. it waits as the contract says: no indicator before 320ms (C5), and it
 *      lets the pane go only once the stub runs there and has drawn (C3);
 *   3. let go, the pane is the stub's, the attribute is off, and the frame
 *      wears the stub's mark, visible (C6).
 * The stub is then sent `exit`, so the rows after this one meet the deck as
 * they would have. The phase times are reported, never budgeted: they move
 * with the machine's load.
 */
async function launchRows(ctx: {
  win: BrowserWindow;
  deck: MarkerWatch<DeckFacts>;
  verdict: Record<string, unknown>;
}): Promise<void> {
  const { win, deck, verdict } = ctx;
  const evaluate = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const fail = (what: string, facts?: unknown): Error =>
    new Error(`the launch: ${what}${facts === undefined ? "" : ` — ${JSON.stringify(facts)}`}`);

  // A pane of its own, born now through the deck's door: a fresh shell.
  const before = await deckSettled(deck, 1_500, 60_000);
  await focusDeck(win);
  pressChord(win, SPLIT_CHORD.key, SPLIT_CHORD.shift);
  const split = await deck.until(
    (facts) => facts.panes === before.panes + 1,
    `${SPLIT_CHORD.label} to open a pane for the launch`,
    45_000,
  );
  const shell = split.sessionIds.find((id) => !before.sessionIds.includes(id));
  if (shell === undefined) throw fail("the split pane carries no new session");
  const hostSelector = JSON.stringify(`[data-vf-pane-launcher="${shell}"]`);

  const offered = await untilRead(
    "the fresh pane's launcher, with an agent it can launch",
    30_000,
    async () => {
      const read = await evaluate<
        { index: number; label: string; paneId: string } | { offered: number } | null
      >(
        `(() => {
        const host = document.querySelector(${hostSelector});
        if (!host) return null;
        const rows = [...host.querySelectorAll(".vf-pane-launcher-agent")];
        const index = rows.findIndex((row) => !row.classList.contains("is-off"));
        if (index < 0) return { offered: rows.length };
        return {
          index,
          label: rows[index].querySelector(".vf-pane-launcher-nm")?.textContent ?? "",
          paneId: host.closest("[data-pane-id]")?.getAttribute("data-pane-id") ?? "",
        };
      })()`,
      );
      return read === null ? undefined : read;
    },
  );
  if (!("index" in offered)) throw fail("no agent can launch from this launcher", offered);
  const paneSelector = JSON.stringify(`[data-pane-id="${offered.paneId}"]`);

  // 1. The click's frame: read after React's commit (a microtask), before any frame.
  const first = await evaluate<{
    launch: string | null;
    leaving: boolean | null;
    held: string | null;
    framePassed: boolean;
  }>(
    `(async () => {
      const pane = document.querySelector(${paneSelector});
      let framePassed = false;
      requestAnimationFrame(() => { framePassed = true; });
      pane.querySelector(${hostSelector}).querySelectorAll(".vf-pane-launcher-agent")[${offered.index}].click();
      window.__vfLaunchClickAt = performance.now();
      await Promise.resolve();
      await Promise.resolve();
      return {
        launch: pane.querySelector("[data-vf-pane-launch]")?.className ?? null,
        leaving: pane.querySelector(".vf-pane-launcher")?.classList.contains("is-leaving") ?? null,
        held: pane.getAttribute("data-vf-launching"),
        framePassed,
      };
    })()`,
  );
  if (first.framePassed) throw fail("an animation frame passed before the first read", first);
  if (first.launch === null || !first.launch.includes("is-depart")) {
    throw fail("C1: the launch was not in the pane in the click's frame", first);
  }
  if (first.leaving !== true) throw fail("C1: the launcher did not leave with the click", first);
  if (first.held !== "held") throw fail("C6: the badge's mark was not held", first);

  // 2. Every phase, until the pane is let go.
  const phases: Array<{ ms: number; launch: string | null; held: string | null }> = [];
  const captions: string[] = [];
  const deadline = Date.now() + 60_000;
  let landed: LaunchSample | undefined;
  while (landed === undefined) {
    const now = await evaluate<LaunchSample>(
      `(() => {
        const pane = document.querySelector(${paneSelector});
        return {
          ms: performance.now() - window.__vfLaunchClickAt,
          launch: pane?.querySelector("[data-vf-pane-launch]")?.className ?? null,
          held: pane?.getAttribute("data-vf-launching") ?? null,
          caption: pane?.querySelector(".vf-pane-launch-caption span")?.textContent ?? null,
        };
      })()`,
    );
    const last = phases.at(-1);
    if (last === undefined || last.launch !== now.launch || last.held !== now.held) {
      phases.push({ ms: Math.round(now.ms), launch: now.launch, held: now.held });
    }
    if (now.caption !== null && captions.at(-1) !== now.caption) captions.push(now.caption);
    if (now.launch === null) landed = now;
    else if (Date.now() > deadline) throw fail("the launch never let the pane go", phases);
    else await sleep(40);
  }
  const waiting = phases.find((phase) => phase.launch?.includes("is-waiting") === true);
  if (waiting !== undefined && waiting.ms < 300) {
    throw fail("C5: the indicator came before 320ms", phases);
  }
  if (landed.held !== null)
    throw fail("C6: the pane kept data-vf-launching after the launch", landed);
  // It went home on the agent's first frame: it never turned back (a refusal)
  // or let go as if its agent had left the pane before drawing.
  const astray = phases.find((phase) => /\bis-(refused|left)\b/.test(phase.launch ?? ""));
  if (astray !== undefined || !phases.some((phase) => phase.launch?.includes("is-home") === true)) {
    throw fail("the launch did not go home on the agent's first frame", phases);
  }

  // 3. Let go: the pane shows the stub's session, and its frame wears the mark.
  const agent = await untilRead("the launched stub's session in the pane", 30_000, async () => {
    const read = await evaluate<{ session: string | null; mark: string | null }>(
      `(() => {
        const pane = document.querySelector(${paneSelector});
        const frame = pane?.querySelector("[data-vf-pane-frame]");
        const mark = frame?.querySelector(".vf-pane-mark");
        return {
          session: frame?.getAttribute("data-vf-pane-frame") ?? null,
          mark: mark ? getComputedStyle(mark).visibility : null,
        };
      })()`,
    );
    return read.session !== null && read.session !== shell && read.mark !== null ? read : undefined;
  });
  if (agent.mark !== "visible")
    throw fail("C6: the frame's mark stayed hidden after the launch", agent);

  const line = {
    agent: offered.label,
    first,
    phases,
    captions: captions.slice(0, 12),
    landedMs: Math.round(landed.ms),
    indicator: waiting === undefined ? "none (drawn before 320ms)" : `from ${waiting.ms}ms`,
  };
  console.log(`SMOKE_GODVIEW_LAUNCH ${JSON.stringify(line)}`);
  verdict["launch"] = line;

  // The stub leaves as a person would leave it.
  const session = agent.session as string;
  await focusPane(win, session);
  await typeTerminalLine(win, "exit");
  await deck.until(
    (facts) =>
      !facts.sessionIds.includes(session) || facts.exitedSessionIds?.includes(session) === true,
    "the launched stub to leave its pane",
    30_000,
  );
}

/** What the pane showing `sessionId` wears: whether the deck framed it, and
 * whether the frame carries an agent's MARK — the badge's `.vf-pane-mark`,
 * which the frame draws only from an agent's facts (field-app's
 * `pane-frame-facts.ts`: a run whose provider has said nothing yields none). */
async function paneFrameMark(
  win: BrowserWindow,
  sessionId: string,
): Promise<{ framed: boolean; mark: boolean }> {
  return (await win.webContents.executeJavaScript(
    `(() => {
      const frame = document.querySelector(${JSON.stringify(frameOf(sessionId))});
      return { framed: frame !== null, mark: frame?.querySelector(".vf-pane-mark") != null };
    })()`,
  )) as { framed: boolean; mark: boolean };
}

/** The launcher the gateway wrote for `agentId`, read where puppeteer's
 * spawn-through kit keeps it (its layout under the launchers' home: the
 * provider table `launch-providers.json`, one launcher per name in `bin/`) —
 * the command name a person types, and the REAL executable behind it.
 * Undefined until the gateway has written it (it starts in the background of
 * fieldd's boot). Read, never written: the kit's files are the kit's. */
function typedLauncher(
  home: string,
  agentId: string,
): { name: string; executable: string; path: string } | undefined {
  let table: unknown;
  try {
    table = JSON.parse(readFileSync(join(home, "launch-providers.json"), "utf8"));
  } catch {
    return undefined;
  }
  if (!Array.isArray(table)) return undefined;
  for (const provider of table as Array<{
    id?: unknown;
    nativeInvocation?: { commands?: Array<{ name?: unknown; executable?: unknown }> };
  }>) {
    if (provider.id !== agentId) continue;
    const command = provider.nativeInvocation?.commands?.[0];
    if (typeof command?.name !== "string" || typeof command.executable !== "string") continue;
    return {
      name: command.name,
      executable: command.executable,
      path: join(home, "bin", command.name),
    };
  }
  return undefined;
}

/**
 * 14. THE TYPED AGENT (AR-7, R1 — "type it"; the plan's §9 names this row).
 *
 * R1 as the plan states it: in a Godview pane's shell, type the agent's name;
 * the fold has a row for it, the pane wears the record's frame with the
 * agent's mark, the swarm has its body — exactly as for a session the SPAWN
 * button started — and when the agent quits, the row leaves and the pane is a
 * shell again. fieldd's own suites prove everything below the renderer on the
 * real floor (agent-gateway*.test.ts); what only this harness can prove is the
 * PRODUCT: that the deck and the monitor show a typed run as they show a
 * spawned one.
 *
 * The agent is the smoke's own stub (testing/typed-agent.ts): main staged it,
 * its person and its install record before the pair booted, so no vendor's
 * binary runs and nothing of the machine owner's is read. The step types into
 * a pane of its OWN, split open after the gateway's launcher stands — a pane
 * born earlier may have been born before the gateway was up, and the
 * integration is given at birth.
 *
 * Five items, each its own `SMOKE_GODVIEW_TYPED` line and its own verdict key
 * (`typedAgent1`…`typedAgent5`), and a failure names its item:
 *   1. the pane is born integrated — the launcher leads its PATH, the name is
 *      a command (no alias or function of anyone's), and the person's startup
 *      files ran (ZDOTDIR was given back);
 *   2. typed, the name is a managed run: the monitor's marker has a run whose
 *      terminal is THAT pane and whose provenance is `user-shell`, the swarm
 *      draws it, the pane's frame wears the mark, and the stub received the
 *      managed launch — the recipe's own flags, none of the kit's or
 *      VibeField's private variables, the pane's shell its parent;
 *   3. quit, its row LEAVES — never held as an exited row — and the pane
 *      answers at its prompt;
 *   4. `<name> --version` is not a session: the stub runs as typed, no row;
 *   5. `<name> --bare` is refused: VibeField's sentence naming the argument,
 *      the kit's refused status, the stub never ran, no row.
 *
 * What a harness cannot read here, said rather than faked: a pane's cells.
 * The refusal is read from the same stderr bytes zsh copies to the screen and
 * to a file (MULTIOS), and "the pane answers" is a marker file its shell
 * writes — the idiom of every row above.
 */
async function typedAgentRows(ctx: {
  win: BrowserWindow;
  handle: FielddHandle;
  /** the run's user root: the launchers' home hangs off it */
  userRoot: string;
  staged: StagedTypedAgent;
  deck: MarkerWatch<DeckFacts>;
  monitorWatch: MarkerWatch<MonitorFacts>;
  verdict: Record<string, unknown>;
}): Promise<void> {
  const { win, handle, staged, deck, monitorWatch, verdict } = ctx;
  const work = staged.work;
  const nonce = (): string => `typed-${Math.random().toString(36).slice(2, 10)}`;
  const say = (item: number, name: string, facts: Record<string, unknown>): void => {
    const line = { item, name, ...facts };
    console.log(`SMOKE_GODVIEW_TYPED ${JSON.stringify(line)}`);
    verdict[`typedAgent${item}`] = line;
  };
  const item = async <T>(n: number, name: string, body: () => Promise<T>): Promise<T> => {
    try {
      return await body();
    } catch (error) {
      throw new Error(
        `typed agent, item ${n} (${name}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const callsSince = (from: number): TypedAgentCall[] =>
    readTypedAgentCalls(staged.calls).slice(from);
  /** Every run the monitor showed in `pane` since the marker at `from`. */
  const runsInPaneSince = (from: number, pane: string): MonitorRunFacts[] =>
    monitorWatch
      .history()
      .slice(from)
      .flatMap((facts) => facts.runs ?? [])
      .filter((run) => run.terminal === pane);
  const readIn = (file: string): string => readFileSync(join(work, file), "utf8").trim();
  const home = join(ctx.userRoot, ...LAYOUT.AGENT_SHIMS_DIR);
  /** fieldd's own fold, asked over the harness's own client — for a failure
   * message, never for a pass: it says whether a missing row is the daemon's
   * or the renderer's. */
  const foldNow = async (): Promise<string> => {
    try {
      const listed = (await handle.client.request("agent.list", {})) as {
        sessions?: Array<{
          runtimeRunId?: string;
          spawnedBy?: string;
          terminal?: { hosted?: string; runtimeSessionId?: string };
        }>;
      };
      return JSON.stringify(
        (listed.sessions ?? []).map((row) => ({
          run: row.runtimeRunId,
          spawnedBy: row.spawnedBy ?? "app",
          terminal: row.terminal?.runtimeSessionId ?? row.terminal?.hosted ?? null,
        })),
      );
    } catch (error) {
      return `unread (${error instanceof Error ? error.message : String(error)})`;
    }
  };

  // ── 1. born integrated ──
  const { pane, shellPid, launcher } = await item(1, "born-integrated", async () => {
    // The launcher stands, and its real executable is the STUB: what a person
    // types can reach nothing of the owner's, managed or falling through.
    const launcher = await untilRead("the gateway's launcher for the typed agent", 90_000, () =>
      typedLauncher(home, staged.agentId),
    );
    if (canonicalPath(launcher.executable) !== canonicalPath(staged.stub)) {
      throw new Error(
        `the launcher's real executable is ${launcher.executable}, not the smoke's stub — the name could reach an install that is not the smoke's`,
      );
    }
    // A pane of its own, born now — after the launcher, so born with it.
    const before = await deckSettled(deck, 1_500, 60_000);
    await focusDeck(win);
    pressChord(win, SPLIT_CHORD.key, SPLIT_CHORD.shift);
    const split = await deck.until(
      (facts) => facts.panes === before.panes + 1,
      `${SPLIT_CHORD.label} to open a pane for the typed agent`,
      45_000,
    );
    const pane = split.sessionIds.find((id) => !before.sessionIds.includes(id));
    if (pane === undefined) throw new Error("the split pane carries no new session");
    const listed = await untilFloor(
      handle,
      (terminals) => terminals.some((t) => t.sessionId === pane && typeof t.pid === "number"),
      `list the typed agent's pane ${pane} with its shell's pid`,
      20_000,
    );
    const shellPid = listed.find((t) => t.sessionId === pane)?.pid as number;
    // The typing reaches THIS pane: its own shell answers with its pid.
    const m0 = nonce();
    await typeInPaneUntilMarker(
      win,
      pane,
      `cd ${work}; echo $$ > pid; echo ${m0} > m0`,
      join(work, "m0"),
      m0,
    );
    if (Number(readIn("pid")) !== shellPid) {
      throw new Error(`the typing reached shell ${readIn("pid")}, not the pane's own ${shellPid}`);
    }
    const m1 = nonce();
    await typeInPaneUntilMarker(
      win,
      pane,
      `whence -p ${launcher.name} > p; whence -w ${launcher.name} > w; echo $PATH > path; echo z=$ZDOTDIR > z; echo ${m1} > m1`,
      join(work, "m1"),
      m1,
    );
    const resolved = readIn("p");
    const kind = readIn("w");
    const lead = readIn("path").split(":")[0] ?? "";
    const zdotdir = readIn("z");
    if (canonicalPath(resolved) !== canonicalPath(launcher.path)) {
      throw new Error(
        `at the prompt ${launcher.name} is ${resolved}, not the launcher ${launcher.path}`,
      );
    }
    if (kind !== `${launcher.name}: command`) {
      throw new Error(
        `at the prompt ${launcher.name} is "${kind}" — only a command reaches the launcher`,
      );
    }
    if (canonicalPath(lead) !== canonicalPath(dirname(launcher.path))) {
      throw new Error(
        `the pane's PATH leads with ${lead}, not the launchers' ${dirname(launcher.path)}`,
      );
    }
    // The person has no ZDOTDIR of their own, and the kit's is theirs only
    // for the shell's birth: it must be given back before their files run.
    if (zdotdir !== "z=") throw new Error(`ZDOTDIR is still set in the pane (${zdotdir})`);
    const read = startupFilesRead(staged.ran, shellPid);
    if (!read.includes(".zshenv") || !read.includes(".zshrc")) {
      throw new Error(
        `the person's startup files did not all run in the pane's shell (read: ${JSON.stringify(read)}) — ZDOTDIR was not given back`,
      );
    }
    say(1, "born-integrated", {
      pane,
      shellPid,
      command: launcher.name,
      launcherLeadsPath: true,
      zdotdir: "the person's (none)",
      startupFiles: read,
    });
    return { pane, shellPid, launcher };
  });

  // ── 2. typed, a managed run — shown as a spawned one is ──
  const { run, stub } = await item(2, "type-it", async () => {
    const from = readTypedAgentCalls(staged.calls).length;
    const deckBefore = await deckSettled(deck, 1_500, 60_000);
    const markersBefore = monitorWatch.history().length;
    await focusPane(win, pane);
    // ONCE: a name typed twice is a second launch, so no retyping here.
    await typeTerminalLine(win, launcher.name);
    const arrived = await monitorWatch
      .until(
        (facts) => (facts.runs ?? []).some((run) => run.terminal === pane),
        `the monitor to show a run in the pane ${pane}`,
        90_000,
      )
      .catch(async (error: unknown) => {
        throw new Error(
          `${error instanceof Error ? error.message : String(error)} — fieldd's fold holds ${await foldNow()}; the monitor published ${monitorWatch.history().length - markersBefore} marker(s) since the name was typed`,
        );
      });
    const run = arrived.runs?.find((candidate) => candidate.terminal === pane) as MonitorRunFacts;
    if (run.spawnedBy !== "user-shell") {
      throw new Error(`the run in the pane says spawnedBy "${run.spawnedBy}", not "user-shell"`);
    }
    if (run.provider !== staged.agentId) {
      throw new Error(`the run in the pane is ${run.provider}'s, not the typed agent's`);
    }
    if (run.exited) throw new Error("the run arrived held as an exited row");
    // the stub received the MANAGED launch: the recipe's own flags, in the
    // pane's terminal, the pane's shell its parent (one pid from the prompt)
    const stub = await untilRead("the stub to be launched as a managed session", 60_000, () =>
      callsSince(from).find((call) => call.tty && call.argv.includes("--session-id")),
    );
    for (const flag of ["--session-id", "--settings"]) {
      if (!stub.argv.includes(flag)) {
        throw new Error(`the managed launch carried no ${flag}: ${JSON.stringify(stub.argv)}`);
      }
    }
    const leaked = leakedVariables(stub);
    if (leaked.length > 0) {
      throw new Error(`the agent was handed variables it must never see: ${leaked.join(", ")}`);
    }
    if (stub.ppid !== shellPid) {
      throw new Error(`the agent's parent is ${stub.ppid}, not the pane's shell ${shellPid}`);
    }
    // the swarm draws it: a body, as a spawned run has
    const drawn = await monitorWatch.until(
      (facts) => (facts.runs ?? []).some((each) => each.run === run.run && each.drawn),
      "the swarm to draw the typed run",
      20_000,
    );
    const bodies = (await win.webContents.executeJavaScript(
      `document.querySelectorAll('.vf-monitor-swarm-list button[data-agent-bubble-source="agent"]').length`,
    )) as number;
    if (bodies < 1)
      throw new Error("the marker says the run is drawn and the swarm lists no agent body");
    // the pane wears the agent's frame: its mark, drawn from the agent's facts
    const frame = await untilRead("the pane's frame to wear the agent's mark", 30_000, async () => {
      const seen = await paneFrameMark(win, pane);
      return seen.mark ? seen : undefined;
    }).catch(async (error: unknown) => {
      const latest = monitorWatch.current()?.runs?.find((each) => each.run === run.run);
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} (frame: ${JSON.stringify(await paneFrameMark(win, pane))}; the provider has ${latest?.observed === true ? "" : "NOT "}spoken for the run)`,
      );
    });
    // the deck: the same pane, no other, and not an ended one
    const deckNow = deck.current();
    if (
      deckNow === null ||
      deckNow.panes !== deckBefore.panes ||
      !deckNow.sessionIds.includes(pane)
    ) {
      throw new Error(
        `the deck changed shape under a typed run (${deckBefore.panes} → ${deckNow?.panes ?? "?"} panes)`,
      );
    }
    if (deckNow.exitedSessionIds?.includes(pane) === true) {
      throw new Error("the deck shows the typed run's pane as an ended session");
    }
    const latest = drawn.runs?.find((each) => each.run === run.run) ?? run;
    say(2, "type-it", {
      run: run.run,
      spawnedBy: run.spawnedBy,
      status: latest.status,
      observed: latest.observed,
      drawn: latest.drawn,
      bodies,
      mark: frame.mark,
      flags: stub.argv.filter((argument) => argument.startsWith("-")),
      parentIsTheShell: true,
    });
    return { run, stub };
  });

  // ── 3. quit: the row LEAVES, and the pane is a shell again ──
  await item(3, "quit-it", async () => {
    const from = monitorWatch.history().length;
    await focusPane(win, pane);
    await typeTerminalLine(win, "exit");
    await monitorWatch.until(
      (facts) =>
        facts.localState === "live" && !(facts.runs ?? []).some((each) => each.run === run.run),
      "the typed run's row to leave the monitor",
      60_000,
    );
    // Asked of EVERY marker since the quit, not of the last: an exited row
    // that came and went would be gone from the latest line too.
    const held = monitorWatch
      .history()
      .slice(from)
      .some((facts) => (facts.runs ?? []).some((each) => each.run === run.run && each.exited));
    if (held) {
      throw new Error(
        "the fold held the typed run as an EXITED row before it left — a typed run's pane is a shell, never a husk",
      );
    }
    await untilRead("the stub's process to end", 20_000, () =>
      processAlive(stub.pid) ? undefined : true,
    );
    // the pane answers at its prompt
    const m3 = nonce();
    await typeInPaneUntilMarker(win, pane, `echo ${m3} > m3`, join(work, "m3"), m3);
    await untilRead("the pane's frame to put the agent's mark down", 20_000, async () =>
      (await paneFrameMark(win, pane)).mark ? undefined : true,
    );
    const deckNow = deck.current();
    if (deckNow?.exitedSessionIds?.includes(pane) === true) {
      throw new Error("the deck shows the pane as an ended session: its shell is alive");
    }
    say(3, "quit-it", { rowLeft: true, heldExited: false, paneAnswers: true, mark: false });
  });

  // ── 4. not a session: runs as typed, and no row ──
  await item(4, "not-a-session", async () => {
    const from = readTypedAgentCalls(staged.calls).length;
    const marks = monitorWatch.history().length;
    const m4 = nonce();
    await typeInPaneUntilMarker(
      win,
      pane,
      `${launcher.name} --version; echo ${m4} > m4`,
      join(work, "m4"),
      m4,
    );
    const ran = callsSince(from).filter((call) => call.tty);
    if (!ran.some((call) => call.argv.length === 1 && call.argv[0] === "--version")) {
      throw new Error(
        `the stub did not run as typed (runs since: ${JSON.stringify(ran.map((call) => call.argv))})`,
      );
    }
    if (ran.some((call) => call.argv.includes("--session-id"))) {
      throw new Error("a version query was launched as a managed session");
    }
    // an absence, so it is given time to be wrong in
    await sleep(2_000);
    const rows = runsInPaneSince(marks, pane);
    if (rows.length > 0) {
      throw new Error(`the monitor showed a row for a version query: ${JSON.stringify(rows)}`);
    }
    say(4, "not-a-session", { argv: ["--version"], ranAsTyped: true, rows: 0 });
  });

  // ── 5. refused: VibeField's sentence, and nothing ran ──
  await item(5, "refused", async () => {
    const from = readTypedAgentCalls(staged.calls).length;
    const marks = monitorWatch.history().length;
    const m5 = nonce();
    // `2> e5 2>&1`: zsh copies the launcher's stderr to the pane AND to a file
    // (MULTIOS), and its input and output stay the terminal — the launch is
    // interactive, which is what a refusal is for.
    await typeInPaneUntilMarker(
      win,
      pane,
      `${launcher.name} ${TYPED_AGENT_REFUSED_ARGUMENT} 2> e5 2>&1; echo status=$? > s5; echo ${m5} > m5`,
      join(work, "m5"),
      m5,
    );
    const status = readIn("s5");
    const said = await untilRead("the refusal's words", 10_000, () => {
      const text = readIn("e5");
      return text.includes("was not started") ? text : undefined;
    });
    const sentence = said.split("\n").find((line) => line.includes("was not started")) ?? said;
    if (!sentence.includes(TYPED_AGENT_REFUSED_ARGUMENT)) {
      throw new Error(`the refusal does not name ${TYPED_AGENT_REFUSED_ARGUMENT}: ${sentence}`);
    }
    // the kit's refused status (EX_TEMPFAIL): refused, not failed
    if (status !== "status=75") throw new Error(`the refused launch left ${status}, not status=75`);
    const ran = callsSince(from);
    if (ran.length > 0) {
      throw new Error(
        `the stub ran for a refused launch: ${JSON.stringify(ran.map((call) => call.argv))}`,
      );
    }
    await sleep(2_000);
    const rows = runsInPaneSince(marks, pane);
    if (rows.length > 0) {
      throw new Error(`the monitor showed a row for a refused launch: ${JSON.stringify(rows)}`);
    }
    say(5, "refused", { status: 75, sentence, stubRan: false, rows: 0 });
  });
}

/** SB-3 — the managed Agent Profile the spawn bloom row makes, by its label. */
const BLOOM_PROFILE_LABEL = "Smoke Work";

/** What the bloom says about itself, for a failure's evidence. */
const BLOOM_DIAGNOSIS = `(() => {
  const bloom = document.querySelector(".vf-bloom");
  return JSON.stringify({
    state: bloom?.getAttribute("data-bloom-state") ?? null,
    mode: bloom?.getAttribute("data-bloom-mode") ?? null,
    target: bloom?.getAttribute("data-bloom-target") ?? null,
    buds: [...document.querySelectorAll("[data-bloom-bud-kind]")].map(
      (bud) => bud.getAttribute("data-bloom-bud-kind") + ":" + bud.getAttribute("data-bloom-bud-id"),
    ),
  });
})()`;

/** fieldd's roster, as the UI reads it (TP-D4): ids, and the set a shell was
 * born under (SB-2). */
async function bloomRoster(
  handle: FielddHandle,
): Promise<Array<{ sessionId: string; profileSet?: string }>> {
  const answer = (await handle.client.request("terminal.roster", {})) as {
    items?: Array<{ sessionId: string; profileSet?: string }>;
  };
  return answer.items ?? [];
}

/**
 * A point on the swarm's EMPTY ground, found the way a person's pointer finds
 * it: moved there, no body answers (the swarm's hover title stays away), and
 * the point is the swarm's own (no chrome over it). The swarm's bodies drift
 * on a canvas this harness cannot read, so the ground is probed, never assumed;
 * lower points first, leaving the arc room to open up.
 */
async function swarmEmptyGround(win: BrowserWindow): Promise<{ x: number; y: number }> {
  const field = (await win.webContents.executeJavaScript(
    `(() => {
      const swarm = document.querySelector(".vf-godview-monitor-stage .vf-monitor-swarm");
      if (!swarm) return null;
      const r = swarm.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    })()`,
    true,
  )) as { left: number; top: number; width: number; height: number } | null;
  if (field === null) throw new Error("the stage shows no swarm to hold on");
  for (const fy of [0.72, 0.6, 0.84, 0.5]) {
    for (const fx of [0.5, 0.36, 0.64, 0.22, 0.78]) {
      const at = {
        x: Math.round(field.left + field.width * fx),
        y: Math.round(field.top + field.height * fy),
      };
      win.webContents.sendInputEvent({ type: "mouseMove", x: at.x, y: at.y });
      await sleep(160);
      const empty = (await win.webContents.executeJavaScript(
        `document.querySelector(".vf-monitor-swarm-tooltip") === null &&
          document.elementFromPoint(${at.x}, ${at.y})?.closest(".vf-monitor-swarm") != null`,
        true,
      )) as boolean;
      if (empty) return at;
    }
  }
  throw new Error(
    `no empty ground on a ${Math.round(field.width)}×${Math.round(field.height)} swarm`,
  );
}

/**
 * THE SPAWN BLOOM (SB-3). A hold on the swarm's empty ground blooms this
 * desktop's Agent Profiles, and letting go on one births a shell UNDER it —
 * the host's whole chain, against the real pair:
 *   1. a managed Agent Profile made through the door (`agents.profileSets.create`)
 *      reaches the stage: its tab;
 *   2. pressed and held on empty ground (Electron input events into this
 *      window, never the OS's), the swarm blooms; moved onto the profile's bud
 *      and let go, a shell is born there: fieldd's roster names the set, the
 *      deck shows it in the active pane (its shape unchanged), the stage says
 *      "opened under <set>", and the swarm lists it;
 *   3. its pane's launcher reads `Under <set>`, and the typed agent — the
 *      smoke's stub, the one agent installed — reads `no sign-in` there;
 *   4. typed in that pane, the agent is refused in VibeField's sentence
 *      (SB-D7): the profile holds no sign-in for it — the kit's refused status,
 *      and the stub never ran.
 * What a harness cannot read here, said rather than faked: the body PAINTED at
 * the release point. The smoke window may have no WebGPU (`swarmRenderer`
 * unavailable), and the swarm's positions live on a canvas either way; the
 * swarm's row for the born shell is the witness.
 */
async function spawnBloomRows(ctx: {
  win: BrowserWindow;
  handle: FielddHandle;
  /** the run's user root: the typed agent's launchers hang off it */
  userRoot: string;
  staged: StagedTypedAgent | undefined;
  deck: MarkerWatch<DeckFacts>;
  verdict: Record<string, unknown>;
}): Promise<void> {
  const { win, handle, staged, deck, verdict } = ctx;
  const evaluate = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const say = (item: number, name: string, facts: Record<string, unknown>): void => {
    const line = { item, name, ...facts };
    console.log(`SMOKE_GODVIEW_BLOOM ${JSON.stringify(line)}`);
    verdict[`spawnBloom${item}`] = line;
  };
  const item = async <T>(n: number, name: string, body: () => Promise<T>): Promise<T> => {
    try {
      return await body();
    } catch (error) {
      throw new Error(
        `the spawn bloom, item ${n} (${name}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  // ── 1. a profile made through the door reaches the stage ──
  const set = await item(1, "profile-made", async () => {
    const answer = (await handle.client.request("agents.profileSets.create", {
      label: BLOOM_PROFILE_LABEL,
      glyph: "briefcase",
    })) as { set?: { id?: unknown } };
    const id = answer.set?.id;
    if (typeof id !== "string") {
      throw new Error(`agents.profileSets.create answered no set: ${JSON.stringify(answer)}`);
    }
    await waitForRendererFact(
      win,
      `the profile tabs to offer ${BLOOM_PROFILE_LABEL}`,
      30_000,
      `document.querySelector('[data-profile-tab=${JSON.stringify(id)}]') !== null`,
      `JSON.stringify([...document.querySelectorAll("[data-profile-tab]")].map((tab) => tab.getAttribute("data-profile-tab")))`,
    );
    say(1, "profile-made", { set: id, label: BLOOM_PROFILE_LABEL });
    return { id, label: BLOOM_PROFILE_LABEL };
  });

  // ── 2. held, reached, let go: a shell born under it ──
  const born = await item(2, "hold-reach-let-go", async () => {
    const before = await deckSettled(deck, 1_500, 60_000);
    const listed = new Set((await bloomRoster(handle)).map((row) => row.sessionId));
    const ground = await swarmEmptyGround(win);
    // pressed where the pointer already rests (a far move and a press with no
    // pause can coalesce), and held past the 520 ms the swarm waits for
    win.webContents.sendInputEvent({
      type: "mouseDown",
      x: ground.x,
      y: ground.y,
      button: "left",
      clickCount: 1,
    });
    await sleep(700);
    await waitForRendererFact(
      win,
      "the hold to bloom",
      10_000,
      `document.querySelector(".vf-bloom")?.getAttribute("data-bloom-state") === "open"`,
      BLOOM_DIAGNOSIS,
    );
    // a new ring ignores the pointer for 90 ms: a hand still moving picks wrong
    await sleep(150);
    const bud = await evaluate<{ x: number; y: number } | null>(
      `(() => {
        const bud = document.querySelector('[data-bloom-bud-kind="profile"][data-bloom-bud-id=${JSON.stringify(set.id)}]');
        if (!bud) return null;
        const r = bud.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      })()`,
    );
    if (bud === null) {
      throw new Error(
        `the bloom offers no bud for ${set.label}: ${await evaluate(BLOOM_DIAGNOSIS)}`,
      );
    }
    // toward it with the button still down, crossing the dead zone in one move
    for (const k of [0.4, 0.75, 1]) {
      win.webContents.sendInputEvent({
        type: "mouseMove",
        x: Math.round(ground.x + (bud.x - ground.x) * k),
        y: Math.round(ground.y + (bud.y - ground.y) * k),
        button: "left",
        modifiers: ["leftbuttondown"],
      });
      await sleep(80);
    }
    await waitForRendererFact(
      win,
      `the bloom to point at ${set.label}`,
      5_000,
      `document.querySelector(".vf-bloom")?.getAttribute("data-bloom-target") === ${JSON.stringify(`profile:${set.id}`)}`,
      BLOOM_DIAGNOSIS,
    );
    win.webContents.sendInputEvent({
      type: "mouseUp",
      x: bud.x,
      y: bud.y,
      button: "left",
      clickCount: 1,
    });
    // fieldd's own record of the birth: a new shell, bound to the set
    const bound = await untilRead(
      `fieldd's roster to name a new shell born under ${set.label}`,
      30_000,
      async () =>
        (await bloomRoster(handle)).find(
          (row) => row.profileSet === set.id && !listed.has(row.sessionId),
        ),
    );
    const shown = await deck.until(
      (facts) => facts.activeSessionId === bound.sessionId,
      "the deck to show the born shell in the active pane",
      30_000,
    );
    if (shown.panes !== before.panes) {
      throw new Error(
        `the birth changed the deck's shape (${before.panes} → ${shown.panes} panes)`,
      );
    }
    const ack = await untilRead("the stage to say where the terminal opened", 10_000, async () => {
      const text = await readMonitorAck(win);
      return text.includes("opened") ? text : undefined;
    });
    if (ack !== `terminal opened under ${set.label} in the active pane`) {
      throw new Error(`the stage said "${ack}", not that it opened under ${set.label}`);
    }
    // …and the swarm has it: the born shell's own row. A door birth keeps its
    // own id as its visual (only a launcher's hand-over passes a body on), and
    // the fresh shell it displaced is reaped — so a count of terminal rows can
    // stay level, and only the row itself is the witness.
    const bornRow = `.vf-monitor-swarm-list button[data-agent-bubble-id="${bound.sessionId}"]`;
    await waitForRendererFact(
      win,
      "the swarm to list the born shell",
      20_000,
      `document.querySelector(${JSON.stringify(bornRow)}) !== null`,
      `JSON.stringify([...document.querySelectorAll(".vf-monitor-swarm-list button")].map((row) => [row.getAttribute("data-agent-bubble-id"), row.getAttribute("data-agent-bubble-source")]))`,
    );
    say(2, "hold-reach-let-go", {
      heldAt: ground,
      letGoAt: bud,
      sessionId: bound.sessionId,
      profileSet: bound.profileSet,
      ack,
      listedInSwarm: true,
    });
    return bound.sessionId;
  });

  // ── 3. its pane's launcher: Under <set>, and the typed agent no sign-in ──
  const agentLabel =
    staged === undefined ? undefined : (catalogEntry(staged.agentId)?.label ?? staged.agentId);
  await item(3, "launcher-under", async () => {
    const host = JSON.stringify(`[data-vf-pane-launcher="${born}"]`);
    const read = await untilRead(
      `the born pane's launcher to say it is under ${set.label}`,
      30_000,
      async () => {
        const facts = await evaluate<{
          caption: string;
          rows: Array<{ title: string; off: boolean }>;
        } | null>(
          `(() => {
            const host = document.querySelector(${host});
            if (!host) return null;
            return {
              caption: host.querySelector(".vf-pane-launcher-cap-under")?.textContent ?? "",
              rows: [...host.querySelectorAll(".vf-pane-launcher-agent")].map((row) => ({
                title: row.getAttribute("title") ?? "",
                off: row.classList.contains("is-off"),
              })),
            };
          })()`,
        );
        return facts?.caption.includes(`Under ${set.label}`) === true ? facts : undefined;
      },
    );
    if (agentLabel !== undefined) {
      const row = read.rows.find((candidate) => candidate.title === `${agentLabel} · no sign-in`);
      if (row === undefined || !row.off) {
        throw new Error(
          `${agentLabel} is not "no sign-in" under ${set.label}: ${JSON.stringify(read.rows)}`,
        );
      }
    }
    say(3, "launcher-under", {
      caption: read.caption,
      noSignIn: agentLabel ?? "unavailable: nothing was staged",
    });
  });

  // ── 4. typed there: refused in VibeField's sentence (SB-D7) ──
  if (staged === undefined) {
    say(4, "typed-refused", {
      unavailable: "nothing was staged — an injected FIELDD_DATA_DIR is someone else's root",
    });
    return;
  }
  await item(4, "typed-refused", async () => {
    const home = join(ctx.userRoot, ...LAYOUT.AGENT_SHIMS_DIR);
    const launcher = await untilRead("the gateway's launcher for the typed agent", 30_000, () =>
      typedLauncher(home, staged.agentId),
    );
    // The pane first: its shell answers from the work folder (the fresh
    // pane's launcher gives way as the typing reaches the shell), so the
    // line below is typed into a settled prompt.
    const settled = `bloom-${Math.random().toString(36).slice(2, 10)}`;
    await typeInPaneUntilMarker(
      win,
      born,
      `cd ${staged.work}; echo ${settled} > m8`,
      join(staged.work, "m8"),
      settled,
    );
    const from = readTypedAgentCalls(staged.calls).length;
    const marker = `bloom-${Math.random().toString(36).slice(2, 10)}`;
    // `2> e9 2>&1`: zsh copies the launcher's stderr to the pane AND to a file
    // (MULTIOS) — the idiom the typed agent's own refusal row reads it by
    await typeInPaneUntilMarker(
      win,
      born,
      `${launcher.name} 2> e9 2>&1; echo status=$? > s9; echo ${marker} > m9`,
      join(staged.work, "m9"),
      marker,
    );
    const inWork = (): string => JSON.stringify(readdirSync(staged.work));
    const said = await untilRead("the refusal's words", 10_000, () => {
      const file = join(staged.work, "e9");
      if (!existsSync(file)) return undefined;
      const text = readFileSync(file, "utf8");
      return text.includes("was not started") ? text : undefined;
    }).catch((error: unknown) => {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)} (the work folder holds ${inWork()})`,
      );
    });
    const status = readFileSync(join(staged.work, "s9"), "utf8").trim();
    const sentence = said.split("\n").find((line) => line.includes("was not started")) ?? said;
    // either reading of SB-D7: no sign-in in the profile, or one it cannot hold
    if (
      !sentence.includes(`${set.label} has no `) &&
      !sentence.includes(`${set.label} cannot hold `)
    ) {
      throw new Error(`the refusal is not about ${set.label} (SB-D7): ${sentence}`);
    }
    if (status !== "status=75") throw new Error(`the refused launch left ${status}, not status=75`);
    const ran = readTypedAgentCalls(staged.calls).slice(from);
    if (ran.length > 0) {
      throw new Error(
        `the stub ran for a refused launch: ${JSON.stringify(ran.map((call) => call.argv))}`,
      );
    }
    say(4, "typed-refused", { status: 75, sentence, stubRan: false });
  });
}

/**
 * MV-7 — THE SPEND VIEW in VibeField's host, the fifth view of the registry.
 * Chosen on the bar it MOUNTS (the monitor's marker names it, and its element
 * sits in the slot that wears `mv-spend`), it PAINTS (its canvas holds a
 * picture, read back from its 2D context), and its KEYS STAY ON ITS ROOT
 * (MV-D8): with the root focused, ↓ and End are the view's — ↓ focuses a row of
 * its list when it lists one, and neither reaches a pane (the pane ear hears
 * nothing) or moves the window's or the monitor's view; with the focus outside
 * the view, ↓ moves nothing in it. The smoke's world may hold no row the view
 * lists (its typed runs have ended by here): `rows` says so, and the leak check
 * stands either way. The swarm is chosen again after, so the rows below see the
 * stage they always saw.
 */
async function spendViewRow(ctx: {
  win: BrowserWindow;
  monitorWatch: MarkerWatch<MonitorFacts>;
  verdict: Record<string, unknown>;
}): Promise<void> {
  const { win, monitorWatch, verdict } = ctx;
  const evaluate = <T>(expression: string): Promise<T> =>
    win.webContents.executeJavaScript(expression, true) as Promise<T>;
  const choose = async (label: string, id: string): Promise<void> => {
    const pressed = await evaluate<boolean>(
      `(() => {
        const control = document.querySelector('[role="group"][aria-label="Monitor view"] button[aria-label=${JSON.stringify(`${label} view`)}]');
        if (!(control instanceof HTMLButtonElement)) return false;
        control.click();
        return true;
      })()`,
    );
    if (!pressed) throw new Error(`the bar offers no ${label} view`);
    await monitorWatch.until((facts) => facts.viewId === id, `the monitor to show ${id}`, 20_000);
  };
  const ROOT = `document.querySelector(".mv-spend .vf-monitor-spend")`;
  const FOCUSED = `(${ROOT}?.querySelector(".vf-monitor-spend-row.is-focus")?.getAttribute("data-id") ?? null)`;
  const press = (keyCode: string): void => {
    win.webContents.sendInputEvent({ type: "keyDown", keyCode });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode });
  };
  // the swarm is chosen again whatever happens, and the row's own failure is the one said
  let failure: unknown;
  try {
    await choose("SPEND", "spend");
    await waitForRendererFact(
      win,
      "the spend view to mount in its slot",
      20_000,
      `${ROOT} !== null`,
    );
    // painted: the canvas's bytes spread (one ground everywhere would read 0)
    const SPREAD = `(() => {
      const canvas = ${ROOT}?.querySelector("canvas.vf-monitor-spend-canvas");
      if (!(canvas instanceof HTMLCanvasElement) || canvas.width === 0) return -1;
      const context = canvas.getContext("2d");
      if (context === null) return -2;
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let min = 255, max = 0;
      for (let index = 0; index < data.length; index += 97) {
        const value = data[index];
        if (value < min) min = value;
        if (value > max) max = value;
      }
      return max - min;
    })()`;
    await waitForRendererFact(
      win,
      "the spend view to paint its canvas",
      20_000,
      `${SPREAD} > 0`,
      SPREAD,
    );
    const spread = await evaluate<number>(SPREAD);
    const rows = await evaluate<number>(
      `${ROOT}?.querySelectorAll(".vf-monitor-spend-row:not([hidden])").length ?? 0`,
    );
    // its keys, on its root: focused there, ↓ focuses a row (when it lists one),
    // and neither ↓ nor End reaches a pane or moves a view of the product's
    const ear = await evaluate<string>(CHORD_PROBE);
    const windowView = await evaluate<string>(VIEW_NOW);
    await evaluate<void>(`${ROOT}?.focus()`);
    const onRoot = await evaluate<boolean>(`document.activeElement === ${ROOT}`);
    if (!onRoot) throw new Error("the spend view's root would not take the focus");
    press("Down");
    const focused =
      rows === 0
        ? null
        : await untilRead("↓ on the spend view's root to focus a row", 10_000, async () => {
            const id = await evaluate<string | null>(FOCUSED);
            return id === null ? undefined : id;
          });
    press("End");
    await sleep(300);
    const heard = ear === "ok" ? await chordProbeHeard(win) : [];
    if (heard.length > 0) {
      throw new Error(`a key on the spend view's root reached a pane: ${heard.join(", ")}`);
    }
    const viewAfter = await evaluate<string>(VIEW_NOW);
    if (viewAfter !== windowView) {
      throw new Error(
        `a key on the spend view's root moved the window's view (${windowView} → ${viewAfter})`,
      );
    }
    if (monitorWatch.current()?.viewId !== "spend") {
      throw new Error(
        `a key on the spend view's root moved the monitor to ${monitorWatch.current()?.viewId}`,
      );
    }
    // …and outside it, ↓ is not the view's: nothing in it moves
    await evaluate<void>(`${ROOT}?.blur()`);
    const away = await evaluate<boolean>(
      `document.activeElement === null || !${ROOT}?.contains(document.activeElement)`,
    );
    if (!away) throw new Error("the focus would not leave the spend view");
    const before = await evaluate<string | null>(FOCUSED);
    press("Down");
    await sleep(300);
    const after = await evaluate<string | null>(FOCUSED);
    if (after !== before) {
      throw new Error(`↓ outside the spend view moved its focus (${before} → ${after})`);
    }
    const line = {
      mounted: true,
      painted: spread,
      rows,
      focusedOnRoot: focused,
      paneEar: ear,
      paneHeard: heard,
      windowView,
      outsideMoved: false,
    };
    console.log(`SMOKE_GODVIEW_SPEND ${JSON.stringify(line)}`);
    verdict["spendView"] = line;
  } catch (error) {
    failure = error;
  }
  try {
    await choose("SWARM", "swarm");
  } catch (error) {
    failure ??= error;
  }
  if (failure !== undefined) throw failure;
}

/** GT-2/GT-2e: the product Godview, end to end, against the real pair.
 *
 * Everything the deck does here it does because a user asked: the overlay opens
 * through the accelerator's own action, and panes are born, split and closed
 * through the WORKSPACE's own doors (GT-D10) — the harness never asks fieldd
 * for a session except to plant the stranger the claim row needs. It presses
 * things and reads two sources of truth: the floor's inventory for what exists
 * and how it is governed, the deck's own marker for what is on screen.
 *
 * The window is SHOWN, unlike the canvas smoke's. Ghosttea gives its terminal
 * input focus only when `document.hasFocus()`, and the workspace routes a hotkey
 * only when focus is inside it, so a hidden window can be looked at but never
 * typed into — and closing a pane is reachable no other way in 0.8.0 (the
 * workspace context exposes split but no close). */
export async function runSmokeGodview(opts: {
  handle: FielddHandle;
  supervisor: FielddSupervisor;
  root: string;
  registry: WindowRegistry;
  preloadPath: string;
  viteUrl: string;
  beforeExit: () => Promise<void>;
  /** Short, gated G22/G23 proof selected by --terminal-direct-proof. */
  terminalDirectProof?: boolean;
  /** GT-8b: what main's OS opener was handed — a harness records instead of
   * opening (main's `harnessShellOpens`). The link row reads it. */
  shellOpens?: { readonly opened: readonly string[]; readonly revealed: readonly string[] };
  /** AR-7: what main staged for the typed-agent rows before the pair booted
   * (`stageTypedAgent`); absent when it staged nothing — an injected root. */
  typedAgent?: StagedTypedAgent;
  onWindow?: (window: BrowserWindow) => void;
}): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), "vf-smoke-godview-"));
  const verdict: Record<string, unknown> = { ok: false };
  const finish = async (): Promise<void> => {
    console.log(`SMOKE_GODVIEW ${JSON.stringify(verdict)}`);
    rmSync(scratch, { recursive: true, force: true });
    await teardown(opts.supervisor, opts.root, opts.beforeExit, verdict["ok"] === true);
    app.exit(verdict["ok"] === true ? 0 : 2);
  };
  try {
    // DK-5: its own profile — the `localStorage.clear()` rows below clear THIS run's storage,
    // never the owner's app's (they cleared the shared profile's until DK-5).
    const profileProblems = smokeProfileFailures();
    if (profileProblems.length > 0) throw new Error(profileProblems.join(" · "));
    // MV: the isolated Chromium profile's proof — Electron's effective paths are the launcher's own
    const requestedProfile = app.commandLine.getSwitchValue("user-data-dir");
    const profilePaths = {
      userData: app.getPath("userData"),
      sessionData: app.getPath("sessionData"),
    };
    labProfileProof(requestedProfile, profilePaths);
    const win = createMainWindow({
      mode: "smoke-godview",
      preloadPath: opts.preloadPath,
      show: true,
    });
    // DK-18 (36): click-through — a real pointer passes beneath; its typed rows keep the window's focus (smoke-window.ts)
    keepFromPerson(win);
    opts.registry.adopt(win);
    verdict["profile"] = labProfileProof(requestedProfile, {
      ...profilePaths,
      storagePath: win.webContents.session.getStoragePath(),
    });
    opts.onWindow?.(win);
    if (process.env["VF_SMOKE_DEBUG"]) {
      win.webContents.on("console-message", (...args: unknown[]) => {
        console.log(`[renderer] ${args.map((a) => JSON.stringify(a)).join(" ")}`);
      });
    }
    const deck = new MarkerWatch<DeckFacts>(win, "GODVIEW_DECK ");
    const direct = new MarkerWatch<DirectTerminalFacts>(win, "GODVIEW_DIRECT_TERMINAL ");
    // GT-4: the monitor's own tail, armed with the deck's and for the same
    // reason — the door rows below re-read the stage AFTER a click, and a
    // one-shot line wait can only ever answer about the mount.
    const monitorWatch = new MarkerWatch<MonitorFacts>(win, "GODVIEW_MONITOR ");
    const canvas = waitForConsole(win, "CANVAS_READY ", 60_000);
    canvas.catch(() => undefined);
    await loadRenderer(win, "smoke-godview", opts.viteUrl);
    await canvas;
    // DK-3: this smoke runs GPU-less, so the Canvas view's desk cannot draw — it must say so in
    // its card (DESIGN.md §8 "When the desk can't draw"), not crash and not go blank.
    const deskCard = await expectDeskUnavailableCard(win);
    console.log(`SMOKE_GODVIEW_DESK_CARD ${JSON.stringify(deskCard)}`);
    win.focus();
    win.webContents.focus();

    const before = await listTerminalsWhenObserved(opts.handle);
    if (before.length > 0) {
      throw new Error(
        `the init-door row needs an EMPTY floor; found ${before.length} session(s) already`,
      );
    }
    // Row 1 needs a first open in BOTH planes. The runner gives this process
    // a fresh Chromium profile, verified before navigation above: clearing
    // localStorage here would be too late for preferences read at module init.

    // GT-3m: armed BEFORE the toggle, because the monitor stage mounts WITH the
    // overlay and its field is already populated at tick 0 — a wait placed after
    // the open would be racing a line that has already been printed.
    const monitorLine = waitForConsole(win, "GODVIEW_MONITOR ", 90_000);
    monitorLine.catch(() => undefined);
    // GT-3p: the cold open's phase breakdown, armed for the same reason. The
    // renderer publishes it once, when the first open reaches a presented
    // frame, so a wait armed after the toggle could miss it outright.
    const coldOpenLine = waitForConsole(win, "GODVIEW_COLD_OPEN ", 90_000);
    coldOpenLine.catch(() => undefined);

    // 1. ⌘2 — the frame's key to Godview (One Frame FR-1; until FR-1 this row
    //    called ⇧⇧'s own action). Godview opens, the deck redeems a ticket for
    //    the CONNECTION — no session — and the workspace then creates its own
    //    first pane through its own door (GT-D10). Nothing outside it asked for
    //    a shell; there is one because the workspace decided there should be.
    //
    //    The persistence sampler starts HERE, before the key, because the fact
    //    the flip rows below need is the state a session was born in and that
    //    state is gone within one management round trip. Started after the
    //    birth, a sampler can only ever record the destination.
    const persistence = new PersistenceSampler(opts.handle);
    pressViewKey(win, "godview");
    const opened = await deck.until(
      (facts) => facts.active && facts.panes >= 1,
      "the overlay to open with the workspace's own first pane",
      90_000,
    );
    const freeShell = opened.sessionIds[0]!;
    // "React mounted a workspace" and "the deck draws" are different claims,
    // and only the second is worth recording — the render worker names its
    // backend only once it has stood a renderer up against a mounted surface.
    // Bounded and non-fatal: the sessions are the pass condition, the backend
    // is evidence about HOW it drew.
    verdict["rendererBackend"] = await deck
      .until(
        (facts) => facts.rendererBackend !== "starting",
        "the render worker to name its backend",
        20_000,
      )
      .then((facts) => facts.rendererBackend)
      .catch(() => opened.rendererBackend);

    if (opts.terminalDirectProof === true) {
      try {
        const ready = await direct.until(
          (facts) =>
            facts.sessionId === freeShell &&
            ((facts.presentationReady && facts.inputAllowed) ||
              (facts.phase === "unavailable" &&
                (facts.unavailableReason !== "protocol" || facts.protocolReason !== undefined))),
          "G23 to apply a routed frame and admit input for the first pane",
          45_000,
        );
        if (!ready.presentationReady || !ready.inputAllowed) {
          throw new Error(`the G23 activation became unavailable: ${JSON.stringify(ready)}`);
        }
        await focusDeck(win);
        const markerPath = `/private/tmp/vftp-${process.pid}-${Date.now()}.ok`;
        try {
          await typeTerminalLine(win, `touch ${markerPath}`);
          await waitForShellMarker(markerPath);
        } finally {
          rmSync(markerPath, { force: true });
        }
        const bridgePid = terminalBridgePid();
        if (bridgePid !== null) {
          throw new Error(`the direct path forked the retired bridge utility (pid ${bridgePid})`);
        }
        const coldOpen = JSON.parse(await coldOpenLine) as Record<string, unknown>;
        const shotPath = process.env["VF_TERMINAL_DIRECT_PROOF_SHOT"];
        if (shotPath !== undefined && shotPath !== "") {
          writeFileSync(shotPath, (await win.capturePage()).toPNG());
        }
        verdict["directTerminal"] = {
          sessionId: ready.sessionId,
          activationId: ready.activationId,
          phase: ready.phase,
          presentationReady: ready.presentationReady,
          inputAllowed: ready.inputAllowed,
          typedShellSideEffect: true,
          legacyBridgePid: null,
          coldOpen,
        };
        verdict["ok"] = true;
      } finally {
        await persistence.stop();
      }
      await finish();
      return;
    }

    // 1b. THE MONITOR ROW (GT-3m). The stage above the deck, on the registry's
    //     default view, with the fold's rows and the deck's panes on it.
    //
    //     The label is the assertion that earns this row. Everything the monitor
    //     draws is invented, and GT-D13 makes saying so a law rather than a
    //     courtesy — so the smoke fails if the words are missing, exactly as it
    //     would for a pane that lied about its shell. The other two facts are
    //     structure, not pixels: which view mounted, and that it has rows. What
    //     it LOOKS like is James's eye, as with the glass.
    const firstMonitor = JSON.parse(await monitorLine) as MonitorFacts;
    // AR-3: the stage's FIRST frame is empty by construction — the door, the
    // fold's snapshot and the deck's pane facts all arrive after the mount —
    // so this row waits for the field to settle: the fold live, and the deck's
    // own pane on the stage as a row. What used to be the mock's tick-0 frame
    // is now an honest empty field for a few frames, and asserting rows on it
    // would be asserting on the wrong instant.
    const monitor = await monitorWatch
      .until(
        (facts) => facts.localState === "live" && facts.agents > 0,
        "the monitor's field to settle (fold live, the deck's pane on the stage)",
        20_000,
      )
      .catch(() => monitorWatch.current() ?? firstMonitor);
    verdict["monitorView"] = monitor.viewId;
    verdict["monitorAgents"] = monitor.agents;
    if (monitor.viewId !== "swarm") {
      throw new Error(`the monitor opened on "${monitor.viewId}", not the default swarm`);
    }
    if (!(monitor.agents > 0)) {
      throw new Error("the monitor stage mounted with no agents on it");
    }
    // AR-3: the local half of the field is fieldd's fold, and it must be
    // READABLE — `unavailable` here is the honest-states law firing (the window
    // token lacks agent.observe, the daemon refused) and a red row, never a
    // quiet empty stage. `live` with zero managed agents is the ordinary state
    // of a fresh smoke: the rows on the stage are the deck's own panes.
    verdict["monitorLocalState"] = monitor.localState;
    verdict["monitorLocalAgents"] = monitor.localAgents;
    verdict["monitorTerminals"] = monitor.terminals;
    if (monitor.localState !== "live") {
      throw new Error(
        `the monitor's local field is ${JSON.stringify(monitor.localState)} (${monitor.localReason ?? "no reason"}) — fieldd's fold could not be read`,
      );
    }
    // The claim is read OFF THE SCREEN, not off the marker: a chip deleted
    // from the DOM, or moved off-screen, or rendered empty, would leave the
    // marker saying the right sentence while the stage said nothing at all.
    // With no managed agents the chip is ABSENT, and that is the law too —
    // quiet is the honesty when there are no facts.
    const localChip = await readMonitorLocalChip(win, 2_000);
    verdict["monitorLocalChip"] = localChip;
    verdict["monitorLocalClaim"] = monitor.localClaim;
    if (monitor.localAgents > 0 && !localChip.includes("managed")) {
      throw new Error(
        `the monitor is showing ${monitor.localAgents} managed agents without saying so on screen (chip: ${JSON.stringify(localChip)}, marker said: ${JSON.stringify(monitor.localClaim)})`,
      );
    }
    if (monitor.localAgents === 0 && localChip !== "") {
      throw new Error(
        `the monitor claims agents it does not have (chip: ${JSON.stringify(localChip)})`,
      );
    }
    // GT-D13's mock is GONE (AR-3): the word must be absent from the stage.
    const stageText = (await win.webContents.executeJavaScript(
      `(document.querySelector(".vf-godview-monitor-stage")?.textContent ?? "").toLowerCase()`,
    )) as string;
    if (stageText.includes("mock")) {
      throw new Error('the monitor stage still says "mock" — the invented field is back');
    }
    // GT-3c: the substrate, pinned. The swarm's physics has an honest fallback
    // for a renderer that cannot start a worker (a fixture under happy-dom is
    // one), and a fallback that shipped would look EXACTLY like the slice
    // working while undoing it. This row is the only thing standing between
    // those two states, so it asserts rather than reports. MV-5: the worker is
    // the view's own (MV-D7) and the word is its report, which can land a frame
    // after the field settles — so the row waits for the word, then judges it.
    const simulated = await monitorWatch
      .until(
        (facts) => facts.swarmPhysics !== "none",
        "the swarm to say where its physics run (its report)",
        10_000,
      )
      .catch(() => monitorWatch.current() ?? monitor);
    verdict["swarmPhysics"] = simulated.swarmPhysics;
    if (simulated.swarmPhysics !== "worker") {
      throw new Error(
        `the swarm is simulating "${simulated.swarmPhysics}", not in its worker — GT-D16's whole point is that this runs off the main thread`,
      );
    }
    // AR-5: what the swarm PAINTED with. WebGPU is a fact of this host's GPU,
    // not of the slice, so both answers are accepted — but the unavailable one
    // must be SAID on the stage (the honest-states law), and a stage still
    // "starting" after the field settled is a renderer that never answered.
    const painted = await monitorWatch
      .until(
        (facts) => facts.swarmRenderer === "webgpu" || facts.swarmRenderer === "unavailable",
        "the swarm's renderer to answer (webgpu or the honest unavailable line)",
        10_000,
      )
      .catch(() => monitorWatch.current() ?? monitor);
    verdict["swarmRenderer"] = painted.swarmRenderer;
    if (painted.swarmRenderer !== "webgpu" && painted.swarmRenderer !== "unavailable") {
      throw new Error(
        `the swarm's renderer never answered — the marker says ${JSON.stringify(painted.swarmRenderer)}`,
      );
    }
    if (painted.swarmRenderer === "unavailable") {
      // MV-5: the word is the view's report (the marker above); what the stage
      // SAYS is the view's own honest line, its status notice on the field
      const said = (await win.webContents.executeJavaScript(
        `(document.querySelector('.vf-monitor-swarm .vf-monitor-swarm-empty[role="status"]')?.textContent ?? "").toUpperCase()`,
      )) as string;
      if (!said.includes("WEBGPU")) {
        throw new Error("the swarm has no WebGPU here and the stage does not say so");
      }
    }
    // AR-5: the usage column is MOUNTED in the stage's chrome slot and the
    // marker counts its tiles. The count is reported, not judged: a fresh
    // daemon's batch is whatever accounts its providers know, and zero of
    // them is an honest answer. What is asserted is that the column exists —
    // a slot that rendered nothing would leave the marker at -1.
    const usageFacts = await monitorWatch
      .until(
        (facts) => facts.usageTiles >= 0,
        "the usage column to mount in the chrome slot",
        10_000,
      )
      .catch(() => monitorWatch.current() ?? painted);
    verdict["usageTiles"] = usageFacts.usageTiles;
    const usageColumnMounted = (await win.webContents.executeJavaScript(
      `document.querySelector(".vf-godview-monitor-stage .vf-usage-column") !== null`,
    )) as boolean;
    verdict["usageColumnMounted"] = usageColumnMounted;
    if (!usageColumnMounted || usageFacts.usageTiles < 0) {
      throw new Error(
        `the usage column is not on the stage (marker: ${usageFacts.usageTiles} tiles, DOM: ${usageColumnMounted})`,
      );
    }
    // 1c. THE PANE FRAME (GT-6, record §07). The frame is the views package's
    //     (PU-14) and is tested upstream and in the field-app fixture; what
    //     only a real deck can answer is whether it reaches the pane at all —
    //     the portal is into GHOSTTEA'S element, and the deck that owns those
    //     elements needs a GPU, a floor and a shell to exist.
    //
    //     Three facts, read off the screen rather than off a marker: the deck
    //     carries the class the package's stylesheet keys every pane rule on
    //     (without it a frame draws over a pane with no safe areas), the
    //     active pane holds a frame, and that frame's badge names the pane's
    //     FOLDER — which for the smoke's free shell is the shell's own cwd,
    //     never a terminal title. The narrow tier is asserted ABSENT: the
    //     smoke's window is wide, and a frame that thought otherwise would be
    //     hiding the readout on every pane in the deck.
    //
    //     THE ABSENCE IS NOT SELF-PROVING, and its other half is deliberately
    //     elsewhere (GT-6 review): only the views package writes
    //     `data-vf-narrow`, so a rename upstream would leave this selector
    //     matching nothing and this row green over a claim about nothing.
    //     `field-app/test/godview-pane-frame-narrow.test.tsx` is the witness:
    //     it asserts the package's own `PANE_NARROW_ATTRIBUTE` against the
    //     literal below (this process cannot import a browser package to ask),
    //     and that the package sets it by MEASURING the pane rather than by a
    //     fixture asserting it.
    const paneFrame = await readPaneFrameFacts(win, 10_000);
    verdict["paneFrame"] = paneFrame;
    if (!paneFrame.framed) {
      throw new Error(
        "the deck is not marked vf-deck-framed — the package's pane rules (the safe areas, the radius, the line) apply to nothing",
      );
    }
    if (!paneFrame.frameInPane || paneFrame.frames < 1) {
      throw new Error(`the active pane wears no frame (frames in the deck: ${paneFrame.frames})`);
    }
    if (paneFrame.name === "") {
      throw new Error("the pane frame's badge is empty — a pane always has a folder to name");
    }
    verdict["paneFrameName"] = paneFrame.name;
    verdict["paneFrameNarrow"] = paneFrame.narrow;
    if (paneFrame.narrow > 0) {
      throw new Error(
        `${paneFrame.narrow} pane(s) took the narrow tier in a full-width deck — the readout is hidden for nobody`,
      );
    }
    // AR-5 (D6): ⌘F summons the find sheet over the stage, Escape dismisses it.
    // The chord is pressed the way the zoom chord is — into Chromium's input
    // pipeline, never OS injection — and both edges are read off the marker,
    // with the sheet's own element checked while it says open. Focus is read
    // before and after: the sheet takes it on open, and a sheet that kept it
    // on close would leave the user's cursor nowhere — which the very next
    // row (typing into the pane) would then fail on for the wrong reason.
    const focusBeforeFind = await focusReport(win);
    pressChord(win, "f");
    const findOpened = await monitorWatch.until(
      (facts) => facts.findSheet === "open",
      "the find sheet to open on ⌘F",
      10_000,
    );
    verdict["findSheet"] = findOpened.findSheet;
    const findSheetMounted = (await win.webContents.executeJavaScript(
      `document.querySelector("#vf-find-sheet") !== null`,
    )) as boolean;
    if (!findSheetMounted) {
      throw new Error("the marker says the find sheet is open and the DOM has no sheet");
    }
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
    const findClosed = await monitorWatch.until(
      (facts) => facts.findSheet === "closed",
      "the find sheet to close on Escape",
      10_000,
    );
    verdict["findSheetAfterEscape"] = findClosed.findSheet;
    const focusAfterFind = await focusReport(win);
    verdict["focusAroundFind"] = `${focusBeforeFind} → ${focusAfterFind}`;
    if (focusAfterFind !== focusBeforeFind) {
      throw new Error(
        `the find sheet did not give focus back (before ⌘F: ${focusBeforeFind}; after Escape: ${focusAfterFind})`,
      );
    }
    // Focus is necessary, not sufficient. The pane's input is a routed
    // activation that reopens when focus returns, and a line typed into that
    // window is delivered in PART — the head suppressed, the tail run. Seen
    // twice before this row existed: an empty `$0` answer, then an answer
    // file that never appeared while its marker did. So the row also proves
    // the pane is typeable again, with the helper that retypes a whole line
    // until its marker lands — the wait a person never notices at a keyboard
    // and a harness typing at 3 ms a key has to make explicit.
    const typeableMarker = `godview-${Math.random().toString(36).slice(2, 10)}`;
    const typeablePath = join(scratch, "after-find.marker");
    await typeLineUntilMarker(
      win,
      `echo ${typeableMarker} > ${typeablePath}`,
      typeablePath,
      typeableMarker,
    );
    verdict["paneTypeableAfterFind"] = true;

    // The pane is a FLOOR session, not a renderer's idea of one.
    const afterOpen = await untilFloor(
      opts.handle,
      (terminals) => terminals.some((terminal) => terminal.sessionId === freeShell),
      `listed the pane the workspace created for itself (${freeShell})`,
      15_000,
    );
    verdict["freeShellCreated"] = afterOpen.length > before.length;

    // 2. THE TOMBSTONE ROW. Type into that pane and ask it what it is. Before
    //    GT-2e the deck handed the workspace `defaultShell: "/bin/sh"` for a
    //    door it believed was never taken — the door WAS taken, and James's
    //    first real look at the deck found an `sh-3.2$` prompt. `$0` now has to
    //    name the user's actual shell, resolved by main and delivered on the
    //    connect.
    // `$0` is the shell's own name in sh; cmd.exe has no such notion, so win32
    // asks for `%COMSPEC%`. It still DISCRIMINATES, which is what this row is
    // for: only cmd expands a `%VAR%`, so a pane that had regressed to
    // PowerShell (or anything else) writes the literal `%COMSPEC%` and fails
    // the comparison below exactly as an `sh` pane would. (WIN-11's finding;
    // askPane itself types sh-syntax through the renderer since TP-S3e, so the
    // win32 leg of this row still owes that helper a cmd.exe form.)
    const shellProbe = process.platform === "win32" ? "%COMSPEC%" : "$0";
    await focusDeck(win);
    const asked = await askPane(win, join(scratch, "echo.txt"), shellProbe);
    const expected = expectedLoginShell();
    verdict["echo"] = asked.marker;
    verdict["paneShell"] = asked.value;
    verdict["expectedShell"] = expected;
    if (shellName(asked.value) !== shellName(expected)) {
      throw new Error(
        `the workspace's own door spawned ${asked.value}, not the user's shell ${expected}`,
      );
    }
    if (shellName(asked.value) === "sh") {
      throw new Error("the deck is back to /bin/sh — the sh-3.2$ pane has returned");
    }

    // 3. THE FLIP ROW (GT-D11). That pane was born through a workspace door,
    //    and those doors hardcode `terminate-with-app` — the opposite of this
    //    product's daemon-lifetime promise. field-native watches
    //    `session-created` and re-governs ownerless births to keep-until-exit.
    //    Polling past the observed-inventory lag proves the WHOLE chain: the
    //    G9 event, the native flip, and the observed roundtrip fieldd reports.
    await untilFloor(
      opts.handle,
      (terminals) => persistenceOf(terminals, freeShell) === "keep-until-exit",
      `re-govern the workspace's own pane ${freeShell} to keep-until-exit`,
      20_000,
    );
    verdict["firstPaneRegoverned"] = true;
    // …and the PRECONDITION, which the destination alone cannot prove. If a
    // ghosttea upgrade started defaulting workspace panes to keep-until-exit,
    // the native flip would be dead code and every row above would stay green.
    //
    // MEASURED (GT-5a) and reported rather than asserted, because the
    // measurement says asserting it is not possible from here: sampling
    // `terminal.list` every 50ms from BEFORE this pane was born — the earliest
    // any observed inventory can be asked — caught `terminate-with-app` zero
    // times, for either pane. field-native re-governs the birth on its own
    // `session-created` event, inside the floor, and fieldd's observed
    // inventory is a management round trip behind that; the pre-flip state is
    // over before the plane that could report it has heard of the session. So
    // the trail is `["keep-until-exit"]` on a working flip AND on a dead one,
    // and a row that failed on it would fail always. The trails are in the
    // verdict so the fact is on the record every run, and the residual is named
    // where it belongs: this smoke proves the DESTINATION, not the flip.

    // 4. Split — the workspace's own ⌘D, through the workspace's OWN create
    //    door now that the deck no longer intercepts it. The new session is a
    //    floor session, and it is re-governed exactly like the first.
    await focusDeck(win);
    verdict["focusAtSplit"] = await focusReport(win);
    const panesBeforeSplit = opened.panes;
    pressChord(win, SPLIT_CHORD.key, SPLIT_CHORD.shift);
    // ONE MORE than there were, not "at least two". The deck opens with one
    // pane today, so the two readings agree by accident — and an accident is
    // exactly what a harness must not rest on: a deck that came up with two
    // panes would satisfy `>= 2` before the key was ever pressed.
    const split = await deck.until(
      (facts) => facts.panes === panesBeforeSplit + 1,
      `${SPLIT_CHORD.label} to split the deck's ${panesBeforeSplit} pane(s) into ${panesBeforeSplit + 1} (focus: ${String(verdict["focusAtSplit"])})`,
      45_000,
    );
    const splitSession = split.sessionIds.find((id) => id !== freeShell);
    if (splitSession === undefined) throw new Error("the split pane carries no new session");
    await untilFloor(
      opts.handle,
      (terminals) => persistenceOf(terminals, splitSession) === "keep-until-exit",
      `list the split session ${splitSession} re-governed to keep-until-exit`,
      20_000,
    );
    verdict["splitCreated"] = true;
    verdict["splitRegoverned"] = true;
    // Read only once the sampler has actually LOOKED at this session. Reading
    // straight off `untilFloor` measured the sampler's cadence instead of the
    // floor: `untilFloor` returns the instant the inventory answers, and under
    // load the sampler's next poll is up to a cycle away (measured: 35 polls
    // across a whole run, zero refusals, the split session in none of them).
    verdict["splitPaneTrail"] = await persistence.untilSeen(splitSession);
    verdict["firstPaneTrail"] = await persistence.untilSeen(freeShell);

    // 4a. THE EMPTY PANE LAUNCHER (QL-1). The split is a shell the deck's own
    //     new-pane door opened, with no input yet, so its pane shows the
    //     launcher; ⌥↵ opens the field (and asks `index.recent`), ⎋ closes it,
    //     a second ⎋ puts the launcher away so the rows below meet the shell
    //     exactly as before. Keys are DOM events dispatched in the page at the
    //     pane's own textarea — the launcher's window capture listener is what
    //     is under test, not the OS's delivery (and nothing reaches the OS).
    //     Every press includes its release: the launcher keeps consumed codes
    //     until keyup, so an unmatched keydown can swallow a later gesture's
    //     release after the launcher has already disappeared.
    {
      const launcher = `document.querySelector('[data-vf-pane-launcher="${splitSession}"]')`;
      const press = (code: string, key: string, altKey: boolean): Promise<unknown> =>
        win.webContents.executeJavaScript(
          `(() => {
            const pane = ${launcher}?.closest('.ghostty-pane');
            const target = pane?.querySelector('textarea') ?? pane;
            if (!target) return false;
            for (const type of ['keydown', 'keyup']) {
              target.dispatchEvent(new KeyboardEvent(type, {
                code: ${JSON.stringify(code)}, key: ${JSON.stringify(key)}, altKey: ${altKey},
                bubbles: true, cancelable: true,
              }));
            }
            return true;
          })()`,
          true,
        );
      const launcherState = `(() => {
        const host = ${launcher};
        const block = host?.querySelector('.vf-pane-launcher');
        return {
          shown: block != null,
          open: block?.classList.contains('is-open') ?? false,
          agents: host?.querySelectorAll('.vf-pane-launcher-agent').length ?? 0,
          focusInField: document.activeElement?.closest('.vf-pane-launcher') != null,
        };
      })()`;
      await waitForRendererFact(
        win,
        `the split pane ${splitSession} to show the empty pane launcher`,
        20_000,
        `${launcher}?.querySelector('.vf-pane-launcher') != null`,
        launcherState,
      );
      await press("Enter", "Enter", true);
      await waitForRendererFact(
        win,
        "⌥↵ to open the launcher's field and take the keyboard into it",
        10_000,
        `(() => { const s = ${launcherState}; return s.open && s.focusInField; })()`,
        launcherState,
      );
      await press("Escape", "Escape", false);
      await waitForRendererFact(
        win,
        "⎋ to close the launcher's field",
        10_000,
        `(() => { const s = ${launcherState}; return s.shown && !s.open; })()`,
        launcherState,
      );
      await press("Escape", "Escape", false);
      await waitForRendererFact(
        win,
        "a second ⎋ to put the launcher away",
        10_000,
        `${launcher} == null`,
        launcherState,
      );
      verdict["launcherShown"] = true;
      verdict["launcherFieldOpened"] = true;
      verdict["launcherDismissed"] = true;
    }

    // 4b. THE FLIP ITSELF (GT-D11), on the birth class that still has one.
    //
    //     Deck panes stopped being that class at TP-S1r: they are born through
    //     fieldd's `terminal.create`, which asks for keep-until-exit directly
    //     (`contracts/src/terminal.ts:113-115`), so there is nothing to
    //     re-govern and no flip to catch. The rows above therefore assert what
    //     is now TRUE OF THEM — born correct, never seen in the pre-flip state —
    //     and the flip's witness moves to a session this harness births itself,
    //     ownerless and `terminate-with-app`, which is exactly what GT-D11
    //     governs for every client that is not the deck (iOS, agents, ghosttea's
    //     own doors). Losing the witness quietly is the one outcome not on the
    //     table.
    // TP-S3e INSTRUMENT DEBT, stated loudly rather than lost quietly: the flip
    // witness birthed through ghosttea's UDS automation door, addressed by the
    // retired legacy ticket. The GT-D11 flip itself is still unit-covered
    // upstream and in cell_lifecycle.rs; the END-TO-END witness resumes when
    // the AR-lane automation surface (fieldd-brokered) lands — the named
    // follow-up. This verdict field turning silently green is the outcome the
    // original comment forbade, so it reports the debt, not a pass.
    verdict["flipWitness"] = "s3e-instrument-debt";
    // TP-S3f: `rehydrated-cwd` left this list — the relaunched shell announces
    // its cwd over OSC 7 on its first prompt, so the floor read is the witness
    // and no named-pane typing is needed (row 9).
    verdict["s3eInstrumentDebt"] = [
      "flip-witness (GT-D11 e2e)",
      "keystroke-echo latency (report-only)",
    ];
    verdict["flipObserved"] = true;

    // The DECK's panes, stated as the fact they now are rather than as an
    // absence: born keep-until-exit, and never once observed in the pre-flip
    // state. `flipPreconditionObserved` stays in the verdict because its value
    // is the thing that changed — it was the old rows' honest "could not see
    // it", and it is now "there was nothing to see".
    const caughtPreFlip = [freeShell, splitSession].some((id) =>
      persistence.trail(id).includes("terminate-with-app"),
    );
    verdict["flipPreconditionObserved"] = caughtPreFlip;
    await persistence.stop();
    // The instrumentation's own anti-vacuity guard, and it is STRICT: a trail
    // that is empty means the sampler never looked, and a measurement that
    // reads the same whether or not it ran is not one. The counters are in the
    // message because "never saw it" and "never looked" are different failures
    // and the reader should not have to run it again to tell them apart.
    for (const [name, id] of [
      ["the workspace's first pane", freeShell],
      ["the split pane", splitSession],
    ] as const) {
      if (persistence.trail(id).length === 0) {
        throw new Error(
          `the persistence sampler never saw ${name} (${id}) at all, so its trail proves nothing` +
            ` [polls=${persistence.polls} refusals=${persistence.refusals} seen=${JSON.stringify(persistence.seen())}]`,
        );
      }
      if (persistence.trail(id).includes("terminate-with-app")) {
        throw new Error(
          `${name} (${id}) was observed as terminate-with-app — a deck pane is born keep-until-exit through fieldd since TP-S1r, so something is creating panes through the workspace's own door again`,
        );
      }
    }

    // 4c. THE ZOOM ROW (TP-S2; TP-R3 "zoom = exactly one PTY resize each way").
    //
    //     Two measurements, because the row's claim has two halves and neither
    //     alone is the claim:
    //
    //       COMMITS — the deck publishes `zoom.commits`, the number of layout
    //         commits it has performed. A commit is the only thing that can
    //         move the zoomed pane's box, so 0 → 1 → 2 across one gesture each
    //         way is the CEILING on the resizes: at most one per direction.
    //       BOXES — the ceiling is not the floor. What proves the other panes
    //         were left alone is their laid-out boxes, read from the page
    //         before and after: exactly ONE pane's box may move on a zoom, and
    //         it must be the pane the deck marked. `TerminalSurface` commits a
    //         PTY resize only when its box moves the derived grid, so a pane
    //         with an identical box did not resize its session.
    //
    //     The floor cannot answer this: its inventory carries no geometry
    //     (`ObservedTerminal`, `contracts/src/mgmt.ts:93-108`), which is why
    //     the measurement is renderer-side and says so rather than implying a
    //     daemon-side witness it does not have.
    //
    //     Runs HERE because row 4 has just made a second pane. With one pane a
    //     zoom is a no-op — the pane already fills the host, no box moves, and
    //     every assertion below would pass without the feature existing.
    await focusDeck(win);
    const zoomBaseline = await deck.until(
      (facts) => facts.zoom !== undefined,
      "the deck to publish its zoom state (a bundle without it predates TP-S2)",
      20_000,
    );
    if (zoomBaseline.zoom?.commits !== 0) {
      throw new Error(
        `the deck had already committed ${String(zoomBaseline.zoom?.commits)} zoom layout(s) before this row pressed anything — the 0 → 1 → 2 count below would be measuring something else`,
      );
    }
    // TP-S3f: the deck's pane chrome became FACT-DRIVEN — the routed metadata
    // refresh (G24) lands the sessions' real title/cwd shortly after birth,
    // and the deck settles a few pixels once when those facts arrive (measured
    // ~5×4 px per pane, one-time; both this row's failures reproduced it at
    // different instants of the round trip). TP-R3 is a claim about the ZOOM
    // GESTURE, so the row runs on the QUIESCENT deck: boxes stable across ten
    // refresh cadences before the first snapshot. If boxes ever oscillate
    // under a steady metadata stream, this wait times out — that would be a
    // real product bug, not smoke weather.
    const boxesBeforeZoom = await settledPaneBoxes(win, 2_000, 30_000);
    if (Object.keys(boxesBeforeZoom).length < 2) {
      throw new Error(
        `the zoom row needs at least two panes to prove the others are left alone; saw ${JSON.stringify(boxesBeforeZoom)}`,
      );
    }

    // The chord first, because that is the gesture a user makes — but its
    // DELIVERY is not assumed (the repo's own lesson, and the same caveat
    // `closeWindowAccelerator` documents for ⌘W: `sendInputEvent` injects below
    // AppKit's key-equivalent dispatch). A chord that produces no phase change
    // is recorded as an unproven delivery and the row drives the pointer path
    // instead, so the invariant is still measured and the reader is told which
    // path ran.
    //
    // THE POINTER PATH CHANGED AT GT-6a. It used to be the deck's own `zoom
    // pane` chip, and that branch had been exercised on purpose by suppressing
    // the press for one run. The chip is retired (the record's frame owns a
    // pane's chrome, §07), so the fallback is now the frame's own ⤢ verb, by
    // its accessible name. NAMED GAP, upstream's: the package draws that verb
    // only on a pane whose frame has a stop-or-resume verb beside it, and these
    // are bare shells — so on a machine where the chord is not delivered this
    // row FAILS and says so, rather than reporting a zoom nobody could reach.
    // On this machine the chord IS delivered (`zoomDriver: "chord"`).
    pressZoomChord(win);
    let zoomDriver = "chord";
    let zoomedFacts = await deck
      .until((facts) => facts.zoom?.phase === "zoomed", "⌘⇧Enter to zoom the active pane", 6_000)
      .catch(() => null);
    if (zoomedFacts === null) {
      zoomDriver = "frame-verb";
      await clickPaneFrameVerb(win, "Fullscreen the pane");
      zoomedFacts = await deck.until(
        (facts) => facts.zoom?.phase === "zoomed",
        "the frame's fullscreen verb to zoom the active pane",
        20_000,
      );
    }
    verdict["zoomDriver"] = zoomDriver;
    verdict["zoomCommitsIn"] = zoomedFacts.zoom?.commits ?? null;
    if (zoomedFacts.zoom?.commits !== 1) {
      throw new Error(
        `zooming in committed ${String(zoomedFacts.zoom?.commits)} layouts, not exactly 1 (TP-R3) [driver=${zoomDriver}]`,
      );
    }

    const boxesZoomed = await paneBoxes(win);
    const grew = resizedPanes(boxesBeforeZoom, boxesZoomed);
    if (grew.length !== 1) {
      throw new Error(
        `zooming moved ${grew.length} pane boxes (${grew.join(", ") || "none"}), not exactly 1 — TP-R3 is a claim about the whole deck, not just the zoomed pane [before=${JSON.stringify(boxesBeforeZoom)} zoomed=${JSON.stringify(boxesZoomed)}]`,
      );
    }
    // …and it is the pane the deck MARKED, not merely some pane. Counting alone
    // would pass if the zoom grew a neighbour and left the subject alone.
    const markedPane = (await win.webContents.executeJavaScript(
      `document.querySelector("[data-vf-zoom-pane]")?.getAttribute("data-pane-id") ?? null`,
    )) as string | null;
    if (markedPane === null || markedPane !== grew[0]) {
      throw new Error(
        `the pane whose box moved (${String(grew[0])}) is not the pane the deck marked as zoomed (${String(markedPane)})`,
      );
    }
    verdict["zoomedPaneGrew"] = `${boxesBeforeZoom[grew[0]]} → ${boxesZoomed[grew[0]]}`;
    verdict["zoomLeftUntouched"] = Object.keys(boxesBeforeZoom).length - 1;

    // And back. One commit, one box moved, and the deck returns to the layout
    // it started in — the last of which is what makes this a round trip rather
    // than two unrelated gestures.
    if (zoomDriver === "chord") pressZoomChord(win);
    else await clickPaneFrameVerb(win, "Restore the pane");
    const restoredFacts = await deck.until(
      (facts) => facts.zoom?.phase === "idle",
      "the zoom to return the pane to its split",
      20_000,
    );
    verdict["zoomCommitsOut"] = restoredFacts.zoom?.commits ?? null;
    if (restoredFacts.zoom?.commits !== 2) {
      throw new Error(
        `the zoom round trip committed ${String(restoredFacts.zoom?.commits)} layouts, not exactly 2 (TP-R3: one each way) [driver=${zoomDriver}]`,
      );
    }
    const boxesRestored = await paneBoxes(win);
    const shrank = resizedPanes(boxesZoomed, boxesRestored);
    if (shrank.length !== 1 || shrank[0] !== grew[0]) {
      throw new Error(
        `restoring moved ${shrank.length} pane boxes (${shrank.join(", ") || "none"}) — expected only ${String(grew[0])} [zoomed=${JSON.stringify(boxesZoomed)} restored=${JSON.stringify(boxesRestored)}]`,
      );
    }
    const notReturned = resizedPanes(boxesBeforeZoom, boxesRestored);
    if (notReturned.length !== 0) {
      throw new Error(
        `the deck did not return to its pre-zoom layout: ${notReturned.join(", ")} [before=${JSON.stringify(boxesBeforeZoom)} restored=${JSON.stringify(boxesRestored)}]`,
      );
    }
    verdict["zoomRoundTripped"] = true;

    // 5. Claim. `claimExistingSessions` is first-run-only upstream (gated on
    //    there being no saved workspace), so this stages a genuine first run:
    //    a session born on the floor outside the deck, the deck's saved layout
    //    cleared, and a fresh document. That is the real scenario — a machine
    //    where field-native has been running and the app is opened onto it.
    const stranger = TerminalCreateOpenResult.parse(
      await opts.handle.client.request("terminal.create", {}),
    ).sessionId;
    pressViewKey(win, "canvas"); // ⌘1: back to the canvas, so the reload comes up with the deck unmounted
    await deck.until((facts) => !facts.active, "the overlay to close", 20_000);
    // The arbitration's OTHER state, read here because this is the one moment
    // the overlay is closed with the menu installed and the deck still
    // reporting. Read together with `closeAcceleratorWhileGodviewOpen`, the two
    // fields are the whole claim — and since 2026-08-10 they are asserted, not
    // merely recorded. See `closeWindowAccelerator`.
    const closedAccel = closeWindowAccelerator();
    verdict["closeAcceleratorWhileGodviewClosed"] = closedAccel;
    if (closedAccel !== "CommandOrControl+W") {
      throw new Error(
        `the close item must HOLD ⌘W while the overlay is closed, but the live menu reports ${String(closedAccel)}`,
      );
    }
    // The two-state comparison lives at the OPEN reading below, which happens
    // later in this run — comparing here would grade against a field that does
    // not exist yet and pass for that reason alone.
    await win.webContents.executeJavaScript("localStorage.clear()");
    // 5b. GT-3f: seed the VIEWER's shader the way a returning user's would
    //     already be sitting there. The appearance store reads localStorage
    //     synchronously at module init, so the fresh document below comes up
    //     with the port chosen — the real production path, and it rides the
    //     reload this row was already doing rather than adding one.
    //
    //     A NON-animated port deliberately: the claim under test is that a
    //     viewer-local selection reached the renderer, and an animated one
    //     would make that fact depend on frame timing. Whether CRT LOOKS right
    //     is James's eye; that its id crossed is what a harness can hold.
    await win.webContents.executeJavaScript(
      `localStorage.setItem(${JSON.stringify(GODVIEW_APPEARANCE_STORAGE_KEY)}, ${JSON.stringify(
        JSON.stringify({ shaderEffect: SMOKE_SHADER_EFFECT }),
      )})`,
    );
    const reloaded = waitForConsole(win, "CANVAS_READY ", 60_000);
    reloaded.catch(() => undefined);
    deck.reset();
    await loadRenderer(win, "smoke-godview", opts.viteUrl);
    await reloaded;
    win.focus();
    win.webContents.focus();
    pressViewKey(win, "godview"); // ⌘2: the fresh document's FIRST open
    const claimed = await deck.until(
      (facts) => facts.active && facts.sessionIds.includes(stranger),
      "the workspace to claim the floor session nothing in this deck created",
      90_000,
    );
    // DESIGN.md §10's review ritual asks UI changes for a screenshot, and this
    // is the one moment the deck is fully itself: three panes, one adopted, all
    // live. `VF_SMOKE_SHOT=<path>` takes it; the settle is for the render worker,
    // which draws when it is ready and not when a harness asks.
    const shotPath = process.env["VF_SMOKE_SHOT"];
    if (shotPath !== undefined && shotPath !== "") {
      await sleep(5_000);
      writeFileSync(shotPath, (await win.capturePage()).toPNG());
    }
    verdict["claimedExisting"] = true;
    verdict["panesAfterClaim"] = claimed.panes;

    // 6. Close a pane — and watch the session go on living (GT-D5).
    //
    // WINDOWS HAS NO CHORD FOR THIS, and that is upstream's default keymap
    // rather than our harness: `keybinds-macos-default.json` binds
    // `super+w` to `close_surface`, while `keybinds-linux-default.json` —
    // which is what a win32 workspace resolves — binds no `close_surface`
    // at ALL (`ctrl+shift+w` is `close_tab:this`, a different verb that
    // would take every pane in the tab with it). The ⌘W ARBITRATION this
    // row is mostly about is likewise a macOS-only contest: on Windows the
    // application menu owns `CommandOrControl+W` and the deck claims
    // nothing, so there is no chord for the two to fight over.
    //
    // Recorded, not silently skipped: closing a split pane BY KEYBOARD is
    // unreachable for a Windows user on stock bindings. That is a WIN-5
    // keyboard-cluster finding, not a test defect, and it needs either a
    // shipped binding of ours or an upstream default before this row can
    // mean anything here.
    let closed = claimed;
    if (CLOSE_PANE_CHORD === null) {
      verdict["closePaneChord"] = "unbound on this platform (upstream default keymap)";
    } else {
      await focusDeck(win);
      const panesBeforeClose = claimed.panes;
      // THE ARBITRATION, read where it matters: the overlay is open, so this is
      // the state in which the close item is supposed to have released ⌘W. See
      // `closeWindowAccelerator` for what this proves, what it found, and what it
      // cannot reach.
      if (Menu.getApplicationMenu() === null) {
        throw new Error(
          "no application menu is installed, so the ⌘W arbitration this row is about is not in place — which is exactly the state this smoke was in before GT-5a",
        );
      }
      const openAccel = closeWindowAccelerator();
      verdict["closeAcceleratorWhileGodviewOpen"] = openAccel;
      // THE HANDOVER, asserted rather than recorded (2026-08-10). The closed
      // reading is taken earlier in this same run, so both fields are real by now.
      // An item still holding a chord here is the defect this row exists for; an
      // item reporting the SAME thing in both states is that defect's signature.
      const closedReading = verdict["closeAcceleratorWhileGodviewClosed"];
      if (openAccel !== null) {
        throw new Error(
          `the close item must RELEASE ⌘W while the overlay is open, but the live menu reports ${openAccel} — a role-bearing item inherits CommandOrControl+W no matter what the model omits`,
        );
      }
      if (openAccel === closedReading) {
        throw new Error(
          `the ⌘W handover released nothing: the live menu reports ${String(openAccel)} in BOTH overlay states — the defect measured on Electron 43.1.1 and fixed by dropping the role`,
        );
      }
      pressChord(win, CLOSE_PANE_CHORD.key, CLOSE_PANE_CHORD.shift);
      closed = await deck.until(
        (facts) => facts.panes === panesBeforeClose - 1,
        `${CLOSE_PANE_CHORD.label} to close one pane`,
        45_000,
      );
      const detached = claimed.sessionIds.find((id) => !closed.sessionIds.includes(id));
      if (detached === undefined) throw new Error("no pane actually left the deck");
      // A settle long enough for a kill to have travelled, then the only question
      // that matters. The lag runs both ways: an inventory that has not yet
      // NOTICED a death would read as survival, so this waits well past the
      // observed round trip before believing the good news.
      await sleep(2_000);
      const afterClose = await listTerminalsWhenObserved(opts.handle);
      const survivor = afterClose.find((terminal) => terminal.sessionId === detached);
      if (survivor === undefined) {
        throw new Error(`closing a pane KILLED session ${detached} — GT-D5 broken`);
      }
      if (survivor.exited === true) {
        throw new Error(`closing a pane ended session ${detached} — GT-D5 broken`);
      }
      verdict["closedPaneSurvived"] = detached;
      verdict["panesAfterClose"] = closed.panes;
    }

    // 7. RESTORE, the silent case (GT-3). The document dies and comes back
    //    while the floor does not: same panes, same session ids, and — the
    //    assertion that is about a face NOT being drawn — no consent prompt.
    //    Nothing was lost, so there is nothing to ask, and a prompt here would
    //    be the deck training its user to dismiss the one that matters.
    const beforeReload = [...closed.sessionIds];
    await reopenAfterReload({
      win,
      deck,
      viteUrl: opts.viteUrl,
    });
    const restored = await deck.until(
      (facts) => facts.active && facts.panes === closed.panes,
      "the deck to come back with the panes it had",
      90_000,
    );
    // The prompt that must not have been drawn, asked of the WHOLE reopen
    // window rather than of the line that happened to be last. Reading
    // `restored.consent` was unreachable code: consent is published with zero
    // panes and the wait above only returns on `panes === closed.panes`, so the
    // marker in hand could never be a consent marker — the face could have been
    // up, answered and gone, and this row would have read the deck that came
    // after it. `deck.history()` starts at the reset inside `reopenAfterReload`,
    // which is exactly the window this claim is about.
    const promptedDuringRestore = deck.history().filter((facts) => facts.consent !== undefined);
    if (promptedDuringRestore.length > 0) {
      throw new Error(
        `an all-alive restore asked for consent it did not need: ${JSON.stringify(
          promptedDuringRestore.map((facts) => facts.consent),
        )}`,
      );
    }
    const rejoined = beforeReload.every((id) => restored.sessionIds.includes(id));
    if (!rejoined) {
      throw new Error(
        `panes did not rejoin their sessions: had ${beforeReload.join(",")}, got ${restored.sessionIds.join(",")}`,
      );
    }
    verdict["restoredSilently"] = true;
    verdict["restoredSessionIds"] = restored.sessionIds;

    // 8. THE LATENCY PROBE (report-only). A number the v0.3 review asked for,
    //    with no threshold attached — see `measureKeystrokeEcho` for exactly
    //    what the interval spans, because the name alone would over-promise.
    await focusDeck(win);
    const probe = await measureKeystrokeEcho(
      win,
      opts.handle,
      restored.sessionIds[0]!,
      join(scratch, "latency.txt"),
    );
    if ("ms" in probe) verdict["keystrokeEchoMs"] = probe.ms;
    else verdict["keystrokeEchoMs"] = { unmeasured: probe.skipped };

    // 9. THE DEGRADE ROW (GT-3, GT-D8) — SKIPPED ON WIN32, and the reason is a
    //    product finding rather than a harness one.
    //
    //    Every assertion in this row rests on the floor KNOWING a pane's cwd,
    //    and a pane's cwd is only ever what its shell announced over OSC 7 —
    //    the spawn directory is never reported. zsh and bash announce it on
    //    every prompt. **cmd.exe emits no OSC 7 at all**, so on Windows the
    //    floor cannot learn where a pane is sitting, `paneMeta` persists no
    //    cwd, and a restored pane comes back at HOME instead of in its folder.
    //
    //    That is the GT-3 restore promise degrading on Windows — recorded, not
    //    silently skipped. It needs a shell that announces (PowerShell can be
    //    made to) or an upstream/ConPTY-side answer before this row can mean
    //    anything here; until then asserting it would only prove cmd.exe is
    //    cmd.exe.
    //
    //    ERRATA (2026-09-25, GT-8b): "the spawn directory is never reported"
    //    stopped being true at ghosttea 0.12.0, which reports a local session's
    //    spawn directory from creation, as a plain path, until its shell's first
    //    OSC 7 replaces it. That does not rescue this row on Windows: what it
    //    asserts is where a `cd` MOVED a pane, and only an announcement says
    //    that. (A Windows pane now persists its spawn directory, but `paneCwd`
    //    takes no drive path, so it still restores at home.)
    if (process.platform === "win32") {
      verdict["cwdRestore"] =
        "unavailable: cmd.exe announces no OSC 7, so the floor never learns where a cd moved a pane";
    } else {
      //    A plain `cd` is all it takes, and that is itself the finding: a
      //    session's cwd comes ONLY from what the shell announces over OSC 7 (the
      //    spawn directory is never reported), and this user's zsh announces it
      //    on every prompt. What the floor then reports is that announcement
      //    VERBATIM — a `file://host/path` URL, not a path — which is why the
      //    deck decodes it before spawning anything. (ERRATA 2026-09-25, GT-8b:
      //    since ghosttea 0.12.0 the spawn directory IS reported, as a plain
      //    path, until the first announcement replaces it. Where a `cd` lands
      //    still comes only from OSC 7, and that is what this row asserts.)
      //    (ERRATA 2026-09-28, AR-7: "this user's zsh" was the machine owner's
      //    own login zsh, startup files and history included. The pair now runs
      //    as the smoke's PERSON (testing/typed-agent.ts), and the announcement
      //    is their zshrc's: a precmd hook that prints OSC 7, as a terminal
      //    app's own zshrc does. The row's claim about the FLOOR is unchanged.)
      const workdir = join(scratch, "work");
      mkdirSync(workdir, { recursive: true });
      // TP-S3f: this row is BACK in full after two eras of honest gap-marks.
      // The instrument half resolved by scoping, not by new machinery: the
      // retired UDS door could type into a NAMED pane; the renderer path types
      // into the ACTIVE one — so the row moves whichever pane holds focus and
      // dooms THAT pane, instead of picking a session first and needing to reach
      // it. The product half is G24 consumed: the landed `cd` reaches `paneMeta`
      // through the routed metadata refresh (host `getSession` off frame
      // commits), which is exactly what `paneMetaPersisted` witnesses.
      await focusDeck(win);
      await runInPane(win, join(scratch, "cd.txt"), `cd ${workdir}`);
      // The typed line lands in whichever pane HOLDS FOCUS, and that pane is
      // discovered by its EFFECT — the OSC 7 announcement reaching the floor —
      // not assumed from the deck's active marker: after a reload the marker and
      // the focused textarea can diverge (run 3 of this ladder witnessed it),
      // and the row's subject is "the pane that moved", whichever one that is.
      // Compared through `samePlace`, never by string: the announcement and the
      // directory this harness made have two legal spellings on macOS and which
      // one arrives is the shell's business, not this row's subject.
      const inWorkdir = (terminals: TerminalListResult["terminals"]): string | undefined =>
        restored.sessionIds.find((id) =>
          samePlace(cwdPath(terminals.find((t) => t.sessionId === id)?.cwd), workdir),
        );
      const withCwd = await untilFloor(
        opts.handle,
        (terminals) => inWorkdir(terminals) !== undefined,
        `report a deck pane sitting in ${workdir} (where a cd lands is only ever what the shell announces over OSC 7)`,
        20_000,
      ).catch(async (failure) => {
        // The marker DID land (typeLineUntilMarker throws otherwise), so a shell
        // ran the cd — say which sessions the floor sees and what they announce,
        // so a mismatch names its suspect instead of just its timeout.
        const now = await listTerminalsWhenObserved(opts.handle);
        const facts = deck.current();
        throw new Error(
          `${failure instanceof Error ? failure.message : String(failure)} [terminals=${JSON.stringify(
            now.map((t) => ({ id: t.sessionId, cwd: t.cwd ?? null, exited: t.exited })),
          )} deckPanes=${JSON.stringify(facts?.sessionIds ?? [])} active=${facts?.activeSessionId ?? "?"} restored=${JSON.stringify(restored.sessionIds)}]`,
        );
      });
      const doomed = inWorkdir(withCwd)!;
      verdict["recordedCwd"] = withCwd.find((t) => t.sessionId === doomed)?.cwd;
      // The layout has to have PERSISTED that cwd before the session dies —
      // otherwise the restore below would be reading a meta this run never
      // wrote. This wait is the G24 consumption witness: the ONLY route from
      // the floor's cwd to the renderer's layout is the routed summary refresh.
      // The layout carries the floor's reading VERBATIM, so this substring
      // search has the same two-spellings problem the rows above do — and no
      // path to compare, only a serialized blob to look inside. Both spellings
      // are therefore searched for.
      const workdirSpellings =
        canonicalPath(workdir) === workdir ? [workdir] : [workdir, canonicalPath(workdir)];
      const layoutDeadline = Date.now() + 15_000;
      let persisted = false;
      while (Date.now() < layoutDeadline && !persisted) {
        const layout = (await readDeckLayout(win)) ?? "";
        persisted = workdirSpellings.some((spelling) => layout.includes(spelling));
        if (!persisted) await sleep(200);
      }
      if (!persisted) throw new Error(`paneMeta never persisted the cwd ${workdir}`);
      verdict["paneMetaPersisted"] = true;

      // The kill is the FLOOR's, not the deck's — this row is about restore, and
      // the deck's own kill affordance gets its own row below.
      await opts.handle.client.request("terminal.terminate", { sessionId: doomed });
      await untilFloor(
        opts.handle,
        (terminals) => {
          const row = terminals.find((t) => t.sessionId === doomed);
          return row === undefined || row.exited === true;
        },
        `let ${doomed} go`,
        20_000,
      );
      // THE DEATH-BLINDNESS WITNESS (TP-S3f / G24 consumed). This kill is the
      // floor's — the renderer did NOT cause it through its own runtime, so the
      // only way this pane's face can learn the death is the cell's
      // `SessionEvent` riding the negotiated control leg into
      // `applySessionEvent`. Waited for BEFORE the reload on purpose: after a
      // reload, restore consent would mask whether the event ever arrived. (The
      // deck's OWN kill below cannot witness this — see that row for why.)
      await deck.until(
        (facts) =>
          (facts.exitedSessionIds ?? []).includes(doomed) || !facts.sessionIds.includes(doomed),
        "the killed pane to admit a death it did not cause",
        30_000,
      );
      verdict["killedPaneFace"] = "exited";

      await reopenAfterReload({
        win,
        deck,
        viteUrl: opts.viteUrl,
      });
      const asking = await deck.until(
        (facts) => facts.active && facts.consent !== undefined,
        "the deck to ask before relaunching a dead pane",
        90_000,
      );
      verdict["consentShown"] = asking.consent;
      if (asking.consent?.dead !== 1 || asking.consent.saved !== closed.panes) {
        throw new Error(`the consent face miscounted: ${JSON.stringify(asking.consent)}`);
      }
      if (asking.panes !== 0) {
        throw new Error("the workspace mounted before the question was answered");
      }
      await clickDeckButton(win, "restore");
      const relaunched = await deck.until(
        (facts) => facts.consent === undefined && facts.panes === closed.panes,
        "the restored deck to come up with every pane filled",
        90_000,
      );
      const replacement = relaunched.sessionIds.find((id) => !beforeReload.includes(id));
      if (replacement === undefined) {
        throw new Error("no new session was created for the dead pane");
      }
      verdict["rehydratedSession"] = replacement;
      // `openTicket` gates on the OBSERVED inventory, a mgmt round trip behind
      // the spawn (GT-0's measured 62-117ms) — and this session was born through
      // the WORKSPACE's door, which has no ticket to answer with the way
      // `terminal.create` does. So the wait is real and belongs here.
      await untilFloor(
        opts.handle,
        (terminals) => terminals.some((t) => t.sessionId === replacement),
        `list the relaunched session ${replacement}`,
        20_000,
      );
      // TP-S3f: the relaunched shell is its own witness — zsh announces its cwd
      // over OSC 7 on the FIRST prompt, so if the deck relaunched the pane where
      // it was, the floor reports `workdir` without this harness typing a thing.
      // This closes the row's last gap: no named-pane instrument required.
      // Compared by REALPATH on both sides (this row's own long-standing
      // discipline, now the file's): a freshly spawned shell announces the
      // PHYSICAL path (`/private/tmp/…`) while the typed `cd` above kept the
      // logical one (`/tmp/…`) — same directory, two spellings.
      const rehydrated = await untilFloor(
        opts.handle,
        (terminals) =>
          samePlace(cwdPath(terminals.find((t) => t.sessionId === replacement)?.cwd), workdir),
        `report the relaunched ${replacement} back in ${workdir}`,
        20_000,
      );
      verdict["rehydratedCwd"] = rehydrated.find((t) => t.sessionId === replacement)?.cwd;
    }

    // 10. THE KILL ROW (GT-D5) — WITHDRAWN 2026-09-13 (GT-6a), not moved.
    //
    //     It drove the deck's own two-step `kill session` chip and proved
    //     both planes: the floor ended the named session, and the chip had
    //     asked first. The chip is gone — the record's frame (§07) owns a
    //     pane's chrome and no kill is in it — and Godview now offers no
    //     end-a-session gesture at all, so there is no affordance left for
    //     this row to drive. It is NOT rewritten to call `terminal.terminate`
    //     through the door: row 9 above already does exactly that and takes
    //     the stronger witness with it (the pane admitting a death it did not
    //     cause). A smoke row that drives the door and calls it a UI witness
    //     would be the green-washing the old row's own comment warned about.
    //     When an end-a-session gesture comes back, this row comes back with
    //     it — it is in this file's history at 522065df.
    verdict["deckKillAffordance"] =
      "withdrawn at GT-6a (record §07); no product gesture ends a session";

    // 11. THE CONFIG ROW (GT-3 rider). A real write through the product door,
    //     the floor's own reload verdict, and the one property that matters
    //     more than any restyle: nothing died for a settings change.
    const beforeConfig = await listTerminalsWhenObserved(opts.handle);
    const document = TerminalConfigDocument.parse(
      await opts.handle.client.request("terminal.config.read", {}),
    );
    verdict["configPath"] = document.path;
    verdict["configExisted"] = document.exists;
    // THE SHADER-LEAK CAPTURE, and it has to happen HERE — before the write.
    //
    // The viewer chose its shader at row 5b, many rows ago. Row 11c used to
    // prove "no leak" by reading the file back AFTER this write and comparing
    // it to the bytes this write put there — but the write below OVERWRITES the
    // whole document, so a genuine leak from 5b was destroyed by the very row
    // that then certified its absence. These are the bytes that carry the
    // answer: everything the appearance path could have written since 5b is in
    // them, and nothing this harness wrote is.
    const configBeforeWrite = document.exists ? document.text : "";
    verdict["configBytesBeforeWrite"] = configBeforeWrite.length;
    // GT-3v: the written text now carries an APPEARANCE-class key. It is the
    // interesting case for this document precisely because 0.9.0 gave the same
    // concept a second, viewer-local home — so the write proves the device file
    // still owns its key, and the deck's own glass (asserted below) proves the
    // two homes do not leak into one another.
    const configText = `# written by pnpm smoke:godview\nfont-size = 13\nbackground-opacity = ${SMOKE_CONFIG_BACKGROUND_OPACITY}\n`;
    const glassBefore = deck.current()?.glass;
    if (glassBefore === undefined) {
      throw new Error("the deck reported no glass before the config write");
    }
    const wrote = TerminalConfigWriteResult.parse(
      await opts.handle.client.request("terminal.config.write", {
        text: configText,
        revision: document.revision,
      }),
    );
    verdict["configOk"] = wrote.ok;
    verdict["configEffectiveChanged"] = wrote.effectiveChanged;
    // The messages and not just a count: "1 diagnostic" is a number nobody can
    // act on, and the loader's own words are the only honest record of what it
    // made of the file.
    verdict["configDiagnostics"] = wrote.diagnostics.map(
      (diagnostic) => `${diagnostic.severity}: ${diagnostic.code} — ${diagnostic.message}`,
    );
    if (!wrote.ok) {
      throw new Error(`the floor refused a benign config: ${JSON.stringify(wrote.diagnostics)}`);
    }
    if (readFileSync(document.path, "utf8") !== configText) {
      throw new Error(`the config file does not hold what was written: ${document.path}`);
    }
    // `effectiveChanged` is the floor's own verdict that the reload moved its
    // effective configuration — which for an appearance key is the round trip
    // worth naming: the document authority accepted it, the loader read it, and
    // it landed somewhere real rather than being parsed and dropped.
    if (!wrote.effectiveChanged) {
      throw new Error("background-opacity reached the file but changed no effective configuration");
    }
    // A settings change must not be a kill. Read PAST the observed round trip
    // before believing the good news, the same way row 6 does.
    await sleep(2_000);
    const afterConfig = await listTerminalsWhenObserved(opts.handle);
    const lost = beforeConfig
      .filter((row) => row.exited !== true)
      .filter(
        (row) => !afterConfig.some((now) => now.sessionId === row.sessionId && now.exited !== true),
      );
    if (lost.length > 0) {
      throw new Error(`a config reload ended ${lost.map((row) => row.sessionId).join(",")}`);
    }
    verdict["configSurvivors"] = afterConfig.length;

    // 11b. THE GLASS ROW (GT-3v / GT-D12). Structure, not pixels — whether the
    //      result looks right is James's eye; that a non-opaque background
    //      reached the RENDERER is a fact, and so is which home it came from.
    const glassAfter = deck.current()?.glass;
    if (glassAfter === undefined) throw new Error("the deck stopped reporting its glass");
    verdict["glassPaneAlpha"] = glassAfter.paneBackgroundAlpha;
    verdict["glassThemeName"] = glassAfter.themeName;
    if (!(glassAfter.paneBackgroundAlpha < 1)) {
      throw new Error(
        `the deck handed the renderer an opaque pane background (${glassAfter.paneBackgroundAlpha})`,
      );
    }
    // The other direction, and the one a regression would take: appearance is
    // the VIEWER's (GT-D12), so the value just written into the DEVICE file must
    // not have moved this deck. If these ever agree, the two homes have merged
    // and GT-5's phone would inherit this desktop's glass.
    if (glassAfter.paneBackgroundAlpha !== glassBefore.paneBackgroundAlpha) {
      throw new Error(
        `the device config moved the viewer's appearance: ${glassBefore.paneBackgroundAlpha} → ${glassAfter.paneBackgroundAlpha}`,
      );
    }
    // THE NEGATIVE CONTROL, and without it the row above proves nothing on a
    // machine that has run this smoke before. "Did not change" is satisfied by
    // a deck that was ALREADY holding the device file's value — a fully merged
    // home on a persisted data dir looks identical to two separate ones. So the
    // claim is also stated positively: the viewer's alpha is not the number the
    // device document holds.
    for (const [when, alpha] of [
      ["before", glassBefore.paneBackgroundAlpha],
      ["after", glassAfter.paneBackgroundAlpha],
    ] as const) {
      if (alpha === SMOKE_CONFIG_BACKGROUND_OPACITY) {
        throw new Error(
          `the viewer's glass ${when} the write IS the device file's background-opacity (${alpha}) — the two homes have merged, or this deck inherited the device value from a previous run`,
        );
      }
    }

    // 11c. THE EFFECTS ROW (GT-3f / petition G11). The same two-homes law as
    //      the glass, now for the third of appearance that could not be
    //      viewer-local until 0.9.1 — and it is proven in both directions,
    //      because one direction alone is what a regression would satisfy.
    //
    //      Direction one: the port this viewer chose reached the renderer. The
    //      deck reads this off the object it actually handed the workspace, so
    //      the line is what the panes were told and not what the store holds.
    const effects = deck.current()?.effects;
    if (effects === undefined) throw new Error("the deck stopped reporting its effects");
    verdict["shaderEffect"] = effects.shaderEffect;
    verdict["shaderAnimate"] = effects.animate;
    if (effects.shaderEffect !== SMOKE_SHADER_EFFECT) {
      throw new Error(
        `the viewer's shader never reached the renderer: expected ${SMOKE_SHADER_EFFECT}, deck reported ${String(effects.shaderEffect)}`,
      );
    }
    // Direction two: choosing it wrote NOTHING into the device document — and
    // the bytes that answer that are the ones captured BEFORE row 11's write.
    //
    // This row used to read the file back afterwards and compare it to the
    // exact text row 11 had just written, which cannot fail for the reason it
    // claims: the write replaces the whole document, so a genuine leak from row
    // 5b was erased by the write and the read-back could only ever agree with
    // itself. `configBeforeWrite` is the document as it stood after the viewer
    // had chosen a shader and before this harness touched it, so a
    // `custom-shader` key, a managed block, or the port id in any spelling is
    // still in it if the appearance path put one there.
    //
    // Named weakness, measured: on a fresh data dir the document does not exist
    // yet, so these bytes are empty and the check passes easily. Not vacuous —
    // a leak has to CREATE or extend that file, and creating it is exactly what
    // is being watched for — but a weaker pass than it looks, and `configExisted`
    // is in the verdict so a reader can tell which of the two runs they had.
    const shaderLeak = [SMOKE_SHADER_EFFECT, SMOKE_SHADER_EFFECT.split(":").pop() ?? "", "shader"]
      .filter((needle) => needle !== "")
      .filter((needle) => configBeforeWrite.includes(needle));
    if (shaderLeak.length > 0) {
      throw new Error(
        `the viewer's shader leaked into the device config document (${shaderLeak.join(", ")} present before this harness wrote anything): ${JSON.stringify(configBeforeWrite)}`,
      );
    }
    // …and it did not appear between that read and now either. Cheap, and it
    // covers the window this harness itself opened.
    const configAfterShader = readFileSync(document.path, "utf8");
    if (configAfterShader !== configText) {
      throw new Error(
        `the device config document changed under the smoke after its write: ${JSON.stringify(configAfterShader)}`,
      );
    }
    verdict["shaderLeftConfigAlone"] = true;

    // 11d. THE DRY RUN, AGAINST THE REAL LOADER (GT-7, GT-D20). fieldd's suite
    //      pins the port against a fake floor; only a real field-native can say
    //      that ghosttea 0.11.1's validator answers the way the port assumed —
    //      the line a diagnostic names, the path it names, which texts block.
    //      Nothing here writes: every text in this row is a question, and the
    //      one write it attempts must be refused before the disk moves.
    const configAsked = TerminalConfigDocument.parse(
      await opts.handle.client.request("terminal.config.read", {}),
    );
    if (configAsked.config === undefined) {
      throw new Error("terminal.config.read carried no loader snapshot (GT-7a)");
    }
    verdict["configLoader"] =
      `Ghostty ${configAsked.config.ghosttyVersion} · ${configAsked.config.knownKeyCount} keys`;
    const validate = async (text: string) =>
      TerminalConfigValidation.parse(
        await opts.handle.client.request("terminal.config.validate", { text }),
      );
    // A clean edit: the CANDIDATE's snapshot carries it — the loader read the
    // draft, not the file.
    const cleanDraft = `${configAsked.text}scrollback-limit = 25000000\n`;
    const clean = await validate(cleanDraft);
    if (clean.blocking.length > 0 || clean.config?.scrollbackBytes !== 25_000_000) {
      throw new Error(
        `the loader did not read a clean draft as written: ${JSON.stringify({ blocking: clean.blocking, scrollbackBytes: clean.config?.scrollbackBytes })}`,
      );
    }
    // An error of the draft's own blocks, on the line and in the file the page
    // will mark: Settings places a diagnostic by `line` in `source`.
    const brokenDraft = `${configAsked.text}background = #12\n`;
    const brokenLine = brokenDraft.split("\n").length - 1;
    const broken = await validate(brokenDraft);
    const own = broken.blocking.find((diagnostic) => diagnostic.key === "background");
    if (own === undefined) {
      throw new Error(`the loader blocked nothing in a bad colour: ${JSON.stringify(broken)}`);
    }
    verdict["configBlocking"] = `${own.code} · line ${String(own.line)} · ${String(own.source)}`;
    if (own.line !== brokenLine || own.source !== configAsked.path) {
      throw new Error(
        `the loader placed the error at ${String(own.source)}:${String(own.line)}, not ${configAsked.path}:${brokenLine} — the page would mark the wrong line`,
      );
    }
    // …and the door refuses the same text before the disk moves.
    let writeRefused: { kind: string; details: unknown } | null = null;
    try {
      await opts.handle.client.request("terminal.config.write", {
        text: brokenDraft,
        revision: configAsked.revision,
      });
    } catch (error) {
      writeRefused = rpcRefusal(error);
      if (writeRefused === null) throw error;
    }
    const refusal =
      writeRefused === null ? null : TerminalConfigWriteRefusal.safeParse(writeRefused.details);
    if (
      writeRefused?.kind !== "PRECONDITION_FAILED" ||
      refusal?.success !== true ||
      refusal.data.reason !== "blocking-errors"
    ) {
      throw new Error(
        `the door did not refuse a text its loader blocks: ${JSON.stringify(writeRefused)}`,
      );
    }
    if (readFileSync(configAsked.path, "utf8") !== configAsked.text) {
      throw new Error("a refused write moved config.ghostty");
    }
    verdict["configRefused"] = refusal.data.reason;
    // The includes rule: a draft that ADDS an include is judged before any
    // loader runs, so validation can never be a door to reading another file.
    const included = await validate(
      `config-file = ${join(tmpdir(), "vf-smoke-absent-include")}\n${configAsked.text}`,
    );
    if (included.includesAllowed || included.config !== undefined) {
      throw new Error(
        `a draft that adds an include was judged as a load: ${JSON.stringify(included)}`,
      );
    }
    verdict["configIncludesKept"] = true;

    // 11e. THE PAGE, END TO END (GT-7: GT-D18, GT-D20, GT-D21). The chain a
    //      person drives: the product's chords over a FOCUSED pane, Settings →
    //      Terminal, one control, the loader's verdict in the bar, Save, the
    //      bytes on disk, the floor's reload. Clicks are DOM clicks and keys
    //      are `sendInputEvent` into this window — nothing reaches the OS.
    //      Delivery of these chords by macOS predates GT-7 (the palette and
    //      the settings chord shipped before it); what GT-7 changed, and what
    //      this row measures, is who hears them once a pane has focus.
    await focusDeck(win);
    await untilRenderer(win, "the chord probe", CHORD_PROBE, 5_000);
    // The POSITIVE CONTROL: a key the pane should hear reaches it, so a silent
    // probe below is routing, not a deaf probe.
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Shift", modifiers: ["shift"] });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Shift", modifiers: [] });
    await untilRenderer(
      win,
      "the control key reaching the pane",
      `(window.__vfChordProbe ?? []).includes("Shift") ? "ok" : JSON.stringify(window.__vfChordProbe)`,
      5_000,
    );
    const PALETTE = `document.querySelector('[role="dialog"][aria-label="Command palette"]')`;
    await untilRenderer(win, "the probe reset", CHORD_PROBE, 5_000);
    pressProductChord(win, "k");
    await untilRenderer(
      win,
      "⌘K opening the palette over a focused pane",
      `${PALETTE} ? "ok" : "closed"`,
      10_000,
    );
    const heardK = await chordProbeHeard(win);
    if (heardK.some((key) => key.toLowerCase().endsWith("+k"))) {
      throw new Error(`the pane heard ⌘K too (Ghostty's clear_screen): ${JSON.stringify(heardK)}`);
    }
    await untilRenderer(
      win,
      "the palette on top of Godview",
      onTop('[role="dialog"][aria-label="Command palette"]'),
      5_000,
    );
    pressProductChord(win, "k");
    await untilRenderer(win, "⌘K closing the palette", `${PALETTE} ? "open" : "ok"`, 10_000);
    verdict["chordPalette"] = "opened on top of a focused pane; the pane never heard ⌘K";
    await focusDeck(win);
    await untilRenderer(win, "the probe reset", CHORD_PROBE, 5_000);
    pressProductChord(win, ",");
    const SETTINGS_NAV = `nav[aria-label="Settings categories"]`;
    await untilRenderer(
      win,
      "⌘, opening Settings over a focused pane",
      `document.querySelector(${JSON.stringify(SETTINGS_NAV)}) ? "ok" : "closed"`,
      10_000,
    );
    const heardComma = await chordProbeHeard(win);
    if (heardComma.some((key) => key.endsWith("+,"))) {
      throw new Error(
        `the pane heard ⌘, too (Ghostty's open_config): ${JSON.stringify(heardComma)}`,
      );
    }
    await untilRenderer(win, "Settings on top of Godview", onTop(SETTINGS_NAV), 5_000);
    verdict["chordSettings"] = "opened on top of a focused pane; the pane never heard ⌘,";
    // Settings → Terminal → Behavior: one step more history, through the page.
    await clickIn(win, SETTINGS_NAV, "Terminal");
    await clickIn(win, ".vf-ts-page", "Behavior");
    // The stepper exists once the page has READ the document; before that the
    // tab says it is reading, and a value read then is the loading state's.
    const STEPPER = `(document.querySelector(".vf-ts-stepper output")?.textContent ?? "")`;
    await untilRenderer(
      win,
      "the page reading config.ghostty",
      `${STEPPER} !== "" ? "ok" : "reading"`,
      20_000,
    );
    const shownBefore = (await win.webContents.executeJavaScript(STEPPER)) as string;
    await clickIn(win, ".vf-ts-page", "More scrollback");
    const BAR = `(document.querySelector(".vf-ts-savebar")?.textContent ?? "")`;
    await untilRenderer(
      win,
      "the loader's verdict in the save bar",
      `${BAR}.includes("reloads when you save") ? "ok" : ${BAR}`,
      30_000,
    );
    await clickIn(win, ".vf-ts-savebar", "Save");
    await untilRenderer(win, "the save", `${BAR}.includes("Saved.") ? "ok" : ${BAR}`, 30_000);
    const pageSaved = TerminalConfigDocument.parse(
      await opts.handle.client.request("terminal.config.read", {}),
    );
    const block =
      /# >>> Ghosttea common settings[^\n]*\n(?:[^\n]*\n)*?scrollback-limit = (\d+)\n(?:[^\n]*\n)*?# <<< Ghosttea common settings/u.exec(
        pageSaved.text,
      );
    if (block === null) {
      throw new Error(`the page's save holds no managed block: ${JSON.stringify(pageSaved.text)}`);
    }
    const pageBytes = Number(block[1]);
    // Every line the user wrote survives byte for byte (GT-D20): the block is
    // appended to row 11's text, never woven into it.
    if (!pageSaved.text.startsWith(configAsked.text)) {
      throw new Error(
        `the page rewrote lines outside its block: ${JSON.stringify(pageSaved.text)}`,
      );
    }
    if (readFileSync(pageSaved.path, "utf8") !== pageSaved.text) {
      throw new Error("the page's save is not what the file holds");
    }
    // The floor RELOADED with it: the effective snapshot is the page's number.
    if (pageSaved.config?.scrollbackBytes !== pageBytes) {
      throw new Error(
        `the floor did not take the page's scrollback: file ${pageBytes}, effective ${String(pageSaved.config?.scrollbackBytes)}`,
      );
    }
    // What the page shows now is the SAVED document's value, read back — the
    // same number the floor reloaded with, in the page's words.
    const shownAfter = (await win.webContents.executeJavaScript(STEPPER)) as string;
    if (shownAfter === shownBefore) {
      throw new Error(`the page still shows ${shownBefore} after saving ${pageBytes} bytes`);
    }
    verdict["settingsPageSaved"] =
      `${shownBefore} → ${shownAfter} (${pageBytes} bytes); own lines kept; the floor reloaded`;
    await clickIn(win, ".vf-ts-savebar", "OK");
    pressProductChord(win, ",");
    await untilRenderer(
      win,
      "⌘, closing Settings",
      `document.querySelector(${JSON.stringify(SETTINGS_NAV)}) ? "open" : "ok"`,
      10_000,
    );

    // ⇧⌘V OVER A FOCUSED PANE (One Frame FR-4's exit; GT-D21) — 11e's form for
    //      the clipboard's chord, which had no row of its own: the pin reaches
    //      the frame's ONE owner from inside a pane — the left edge's drawer
    //      open over the cover, where its notch rests as a sliver — and the
    //      pane never hears it, so ghostty's paste_from_selection never runs.
    //      ⇧⌘V again puts it away.
    await focusDeck(win);
    await untilRenderer(win, "the probe reset", CHORD_PROBE, 5_000);
    const CLIPBOARD_TRAY = `document.querySelector('.vf-edge-tray[data-side="left"]')`;
    const pressClipboardChord = (): void => {
      const modifiers: ("meta" | "control" | "shift")[] = [
        process.platform === "darwin" ? "meta" : "control",
        "shift",
      ];
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "V", modifiers });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "V", modifiers });
    };
    pressClipboardChord();
    await untilRenderer(
      win,
      "⇧⌘V pinning the clipboard over a focused pane",
      `(() => { const tray = ${CLIPBOARD_TRAY}; if (!tray) return "no clipboard tray";
        return tray.dataset.pinned === "true" && tray.dataset.open === "true"
          ? "ok" : JSON.stringify({ ...tray.dataset }); })()`,
      10_000,
    );
    const heardV = await chordProbeHeard(win);
    if (heardV.some((key) => key.toLowerCase().endsWith("+v"))) {
      throw new Error(
        `the pane heard ⇧⌘V too (Ghostty's paste_from_selection): ${JSON.stringify(heardV)}`,
      );
    }
    pressClipboardChord();
    await untilRenderer(
      win,
      "⇧⌘V putting the clipboard away",
      `${CLIPBOARD_TRAY}?.dataset.pinned === "false" ? "ok" : "still pinned"`,
      10_000,
    );
    verdict["chordClipboard"] =
      "⇧⌘V pinned the clipboard over a focused pane (its drawer open over Godview) and put it away; the pane never heard it";

    // 11g. THE VIEW KEYS, DELIVERED FROM A FOCUSED PANE (One Frame FR-1,
    //      FC-D4) — the probe each of ⌘1–⌘4 owes before it ships (⌘⎋ never
    //      arrived: app-menu-model's VIEW_KEYS_ROAD), in 11e's form: a pane
    //      holds focus, the ear listens at every pane input, and each key is
    //      pressed the way a keyboard presses it. Three facts per key: the
    //      FRAME heard it (its VIEW_KEY line says what it did), the PANE never
    //      did (ghostty's goto_tab), and the window ends in the view the key
    //      names. ⌘2 and ⌘4 move nothing a screen shows from here — the window
    //      is already in Godview, and the Assistant waits — so for them the
    //      frame's own line is the proof of delivery. `sendInputEvent`, like
    //      11e's keys: below AppKit's key-equivalent dispatch, so this is the
    //      page's road; the View menu's darwin accelerators stand behind it and
    //      are not what this row measures.
    const viewKeyFromPane = async (
      view: FrameView,
      want: { outcome: "moved" | "stayed" | "waits"; endsIn: FrameView },
    ): Promise<string> => {
      const digit = VIEW_DIGIT[view];
      await focusDeck(win);
      await untilRenderer(win, "the probe reset", CHORD_PROBE, 5_000);
      const heard = waitForConsole(win, "VIEW_KEY ", 10_000);
      pressViewKey(win, view);
      const facts = JSON.parse(await heard) as { view: string; from: string; outcome: string };
      if (facts.view !== view || facts.outcome !== want.outcome) {
        throw new Error(
          `the frame heard key ${digit} as ${JSON.stringify(facts)}, not ${view} · ${want.outcome}`,
        );
      }
      await untilRenderer(
        win,
        `the window in ${want.endsIn} after key ${digit}`,
        `${VIEW_NOW} === ${JSON.stringify(want.endsIn)} ? "ok" : ${VIEW_NOW}`,
        10_000,
      );
      const paneHeard = await chordProbeHeard(win);
      if (paneHeard.some((key) => key.endsWith(`+${digit}`))) {
        throw new Error(
          `the pane heard view key ${digit} too (ghostty's goto_tab): ${JSON.stringify(paneHeard)}`,
        );
      }
      return `${facts.from} → ${want.endsIn} (${facts.outcome}); the pane never heard it`;
    };
    const viewKeys: Record<string, string> = {};
    viewKeys["4"] = await viewKeyFromPane("assistant", { outcome: "waits", endsIn: "godview" });
    await untilRenderer(
      win,
      "the Assistant's note over its cell",
      `(document.querySelector(".vf-views-note")?.textContent ?? "").includes("not built yet") ? "ok" : "no note"`,
      5_000,
    );
    viewKeys["2"] = await viewKeyFromPane("godview", { outcome: "stayed", endsIn: "godview" });
    viewKeys["3"] = await viewKeyFromPane("history", { outcome: "moved", endsIn: "history" });
    // A view that is not showing is INERT: under History the pane has let go of
    // the keyboard, so nothing typed there reaches a hidden shell.
    await untilRenderer(
      win,
      "the pane letting go of the keyboard under History",
      `document.activeElement?.classList.contains("terminal-input") ? "still focused" : "ok"`,
      5_000,
    );
    // THE HISTORY RUNG (AR-8c): ⌘3 shows rosetta's room on the cover's glass —
    //      mounted in History's slot as a HOST surface, holding either its
    //      columns or an honest state said in words (which one is this run's
    //      index: the pair runs as a throwaway person, so an index here has
    //      found nothing of the machine owner's), never a blank — and ⌘2 out and
    //      ⌘3 back keeps the SAME room: marked before, found marked after.
    const HISTORY_ROOM = `document.querySelector('[data-cover-view="history"] .vf-history .ah-frame')`;
    const historyFace = await untilRendererValue(
      win,
      "History's room in the cover",
      `(() => {
        const room = ${HISTORY_ROOM};
        if (!room) return "no room";
        return JSON.stringify({
          surface: room.getAttribute("data-ah-surface"),
          columns: room.querySelector(".ah-cols") !== null,
          projects: room.querySelectorAll(".ah-project-list-item").length,
          words: (room.textContent ?? "").replace(/\\s+/g, " ").trim().slice(0, 240),
        });
      })()`,
      30_000,
      (answer) => {
        if (answer === "no room") return false;
        const face = JSON.parse(answer) as { surface: string; columns: boolean; words: string };
        return face.surface === "host" && (face.columns || face.words.length > 0);
      },
    );
    await win.webContents.executeJavaScript(`(${HISTORY_ROOM}).dataset.smokeKept = "yes"`);
    pressViewKey(win, "godview");
    await untilRenderer(
      win,
      "⌘2 out of History",
      `${VIEW_NOW} === "godview" ? "ok" : ${VIEW_NOW}`,
      10_000,
    );
    pressViewKey(win, "history");
    await untilRenderer(
      win,
      "⌘3 back into History",
      `${VIEW_NOW} === "history" ? "ok" : ${VIEW_NOW}`,
      10_000,
    );
    await untilRenderer(
      win,
      "History's room kept across ⌘2 and ⌘3 (no remount)",
      `${HISTORY_ROOM}?.dataset.smokeKept === "yes" ? "ok" : "remounted"`,
      5_000,
    );
    verdict["history"] = { ...(JSON.parse(historyFace) as object), kept: true };
    pressViewKey(win, "godview");
    await untilRenderer(
      win,
      "⌘2 back to Godview",
      `${VIEW_NOW} === "godview" ? "ok" : ${VIEW_NOW}`,
      10_000,
    );
    viewKeys["1"] = await viewKeyFromPane("canvas", { outcome: "moved", endsIn: "canvas" });
    await deck.until((facts) => !facts.active, "the deck going quiet on the canvas", 20_000);
    verdict["viewKeys"] = viewKeys;

    // ⇧⇧ RETIRED (FC-D4): two Shift taps open nothing from the canvas, and close
    // nothing from a focused pane — main's detector and its toggle are gone,
    // and nothing in the page took their place. An absence can only be watched
    // for a while: the detector it replaces answered within one tap's 300ms, so
    // a second and a half is a generous window, not a guess at a race.
    const tapShiftTwice = async (): Promise<void> => {
      for (let tap = 0; tap < 2; tap++) {
        win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Shift", modifiers: ["shift"] });
        win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Shift", modifiers: [] });
        await sleep(60);
      }
      await sleep(1_500);
    };
    await tapShiftTwice();
    const afterCanvasTaps = (await win.webContents.executeJavaScript(VIEW_NOW)) as string;
    if (afterCanvasTaps !== "canvas") {
      throw new Error(`⇧⇧ still moves the window: canvas → ${afterCanvasTaps}`);
    }
    pressViewKey(win, "godview");
    await deck.until((facts) => facts.active && facts.panes >= 1, "⌘2 back to the deck", 30_000);
    await focusDeck(win);
    await tapShiftTwice();
    const afterPaneTaps = (await win.webContents.executeJavaScript(VIEW_NOW)) as string;
    if (afterPaneTaps !== "godview") {
      throw new Error(`⇧⇧ over a focused pane still moves the window: godview → ${afterPaneTaps}`);
    }
    verdict["doubleShift"] = "retired: two Shift taps moved no view, from the canvas or a pane";
    await focusDeck(win);

    // 11f. THE LINK ROW (GT-8, GT-D22). ghosttea 0.12.0 finds links in a
    //      pane's output. A ⌘-click hands the runtime platform's `openExternal`
    //      the URL; the deck's opener asks fieldd's `terminal.link.open`; the
    //      policy admits a web link; main's `shell.openLink` gives it to the OS
    //      opener — which RECORDS in a harness (main's `harnessShellOpens`), so
    //      this run never touches the user's browser. The hover is witnessed
    //      first: the input names the link under a ⌘-held pointer
    //      (`data-terminal-link`) only once the frames carry link targets, which
    //      is the floor applying `link-url`. A file path is found too, and the
    //      deck does NOT ask for it (GT-8b: ghosttea's hook names no session, so
    //      a path cannot be told from a peer's): nothing reaches main. Pointer
    //      events are `sendInputEvent` into this window, like 11e's keys.
    //
    //      Every row of the pane shows the link, so the click needs no screen
    //      geometry beyond the cell size: it lands mid-pane, a few columns in.
    //      The harness WRITES the printing loop into a script and types only
    //      `sh <script>`: it types key by key, and a 260-key line under load
    //      lost a key and never ran (the first attempt at this row).
    const shellOpens = opts.shellOpens;
    if (shellOpens === undefined) throw new Error("main handed the link row no opener record");
    const nonce = Math.random().toString(36).slice(2, 10);
    const webLink = `https://example.com/vf-gt8-${nonce}`;
    const fileLink = join(scratch, `gt8-${nonce}.txt`);
    writeFileSync(fileLink, "gt8\n");
    const printEveryRow = (line: string, name: string): string => {
      const script = join(scratch, `${name}-${nonce}.sh`);
      writeFileSync(script, `i=0; while [ $i -lt 60 ]; do echo ${line}; i=$((i + 1)); done\n`);
      return `sh ${script}`;
    };
    const LINK_INPUT = `(document.activeElement?.classList.contains("terminal-input") ? document.activeElement : null)`;
    /** Where the middle row's fifth column is, by ghosttea's own cell geometry
     * (`renderers/types.ts`: 7.83 × 19 px cells from a 2 px origin). */
    const midCell = async (): Promise<{ x: number; y: number }> => {
      const cell = (await win.webContents.executeJavaScript(`(() => {
        const input = ${LINK_INPUT};
        if (!input) return null;
        const r = input.getBoundingClientRect();
        const rows = Math.floor((r.height - 2) / 19);
        return { x: Math.round(r.left + 2 + 5.5 * 7.83), y: Math.round(r.top + 2 + (Math.floor(rows / 2) + 0.5) * 19) };
      })()`)) as { x: number; y: number } | null;
      if (cell === null) throw new Error("no focused pane input to click links in");
      return cell;
    };
    /** Hover with ⌘ held until the input names `want`'s link; the last name
     * seen is the failure's evidence. */
    const hoverLink = async (at: { x: number; y: number }, want: string): Promise<string> => {
      const deadline = Date.now() + 15_000;
      let seen = "";
      while (Date.now() < deadline) {
        win.webContents.sendInputEvent({
          type: "mouseMove",
          x: at.x,
          y: at.y,
          modifiers: ["meta"],
        });
        await sleep(150);
        seen = (await win.webContents.executeJavaScript(
          `${LINK_INPUT}?.getAttribute("data-terminal-link") ?? ""`,
        )) as string;
        if (seen.includes(want)) return seen;
      }
      throw new Error(
        `no link under a ⌘-held pointer naming ${want} (last: ${JSON.stringify(seen)})`,
      );
    };
    const commandClick = (at: { x: number; y: number }): void => {
      for (const type of ["mouseDown", "mouseUp"] as const) {
        win.webContents.sendInputEvent({
          type,
          x: at.x,
          y: at.y,
          button: "left",
          clickCount: 1,
          modifiers: ["meta"],
        });
      }
    };
    await focusDeck(win);
    await runInPane(win, join(scratch, "links.txt"), printEveryRow(webLink, "gt8-web"));
    const webAt = await midCell();
    const hovered = await hoverLink(webAt, webLink);
    const openedBefore = shellOpens.opened.length;
    commandClick(webAt);
    const openDeadline = Date.now() + 15_000;
    while (Date.now() < openDeadline && !shellOpens.opened.slice(openedBefore).includes(webLink)) {
      await sleep(100);
    }
    if (!shellOpens.opened.slice(openedBefore).includes(webLink)) {
      throw new Error(
        `a ⌘-clicked ${webLink} never reached main's opener (it recorded ${JSON.stringify(shellOpens.opened.slice(openedBefore))})`,
      );
    }
    verdict["linkOpened"] =
      `${hovered} → terminal.link.open → shell.openLink (recorded, not opened)`;

    await focusDeck(win);
    await runInPane(win, join(scratch, "files.txt"), printEveryRow(fileLink, "gt8-file"));
    const fileAt = await midCell();
    const fileHovered = await hoverLink(fileAt, `gt8-${nonce}.txt`);
    const handedBefore = shellOpens.opened.length + shellOpens.revealed.length;
    commandClick(fileAt);
    // An absence, so it is given time to be wrong in; the web click above is
    // the control that the same gesture does reach main when it should.
    await sleep(2_000);
    if (shellOpens.opened.length + shellOpens.revealed.length !== handedBefore) {
      throw new Error(
        `a ⌘-clicked file link reached main: opened ${JSON.stringify(shellOpens.opened)}, revealed ${JSON.stringify(shellOpens.revealed)}`,
      );
    }
    verdict["fileLinkNotAsked"] = `${fileHovered} found; the deck asked nothing (GT-8b)`;

    // 12. RETIRED AT TP-S3e. This row SIGKILLed the ghosttea bridge utility
    //    and watched the deck rebuild — a failure mode that no longer has a
    //    process to express it: the routed transport terminates inside
    //    field-native beside the sessions themselves, so nothing can sever
    //    transport while sessions survive the way the bridge's death did. Its
    //    guarantees live on in three witnesses: leg-death revocation and
    //    re-attach in field-native's tp_activation suite; the routed runtime's
    //    bounded recovery ladder (G23, upstream-tested); and the NF kill
    //    matrix for the floor-death case (sessions die WITH the floor — the
    //    honest ceiling). The direct-proof mode separately asserts no bridge
    //    process exists at all.
    verdict["bridgeKillRow"] = "retired-at-s3e";

    // ── 13. THE GT-4 DOOR ROWS (GT-D17) ───────────────────────────────────
    //
    // Placed after the recovery deliberately: an attach REPLACES what the
    // active pane is showing, and every row above asserts about the sessions
    // this deck was holding. Nothing below them asserts anything.
    //
    // 13a. THE LOCAL-ROUTING ROW (AR-3 — GT-4's split-honesty row, re-fed):
    //      a LOCAL bubble is one of the deck's own panes (no managed agent runs
    //      in a smoke), and selecting it goes through the door's local verb —
    //      mount in the active pane. The pane it names IS the active pane, so
    //      the stage acknowledges that in words and the deck does not move.
    //
    //      The claim is asserted two ways, and NEITHER is "the pane ids did not
    //      change" — the first draft of GT-4's row said that and failed twice
    //      on a truth about the deck rather than about the click: the pane
    //      whose session row 10 killed rehydrates into a fresh shell some
    //      seconds after the recovery above reports, and the id it replaces is
    //      exactly `killedSession`. What holds regardless:
    //
    //        · the pane COUNT is unchanged (a mount that split would raise it)
    //        · every pane holds a session THE FLOOR KNOWS
    const beforeLocalClick = await deckSettled(deck, 2_000, 60_000);
    // AR-5: the swarm's bodies are drawn on a canvas; each has a button in
    // the swarm's list (the package's reachability rule), which is what a
    // click lands on here. `data-agent-bubble-source` names the row's kind.
    const localClicked = await clickMonitorBubble(
      win,
      '.vf-monitor-swarm-list button:not([data-agent-bubble-source="remote"])',
    );
    verdict["localBubbleClicked"] = localClicked;
    // Quiescence, not a stopwatch. The BEFORE of this comparison already waits
    // for the deck to stop moving and for exactly the right reason (the pane
    // the kill row ended rehydrates seconds later, on the machine's schedule
    // and not ours) — so an AFTER read off a fixed 1.5s sleep was sampling
    // into the same window the BEFORE was written to avoid. If a local click
    // DID mount something new, the deck moves and this waits for it to finish
    // moving; the assertions below then read a settled deck either way.
    const afterLocalClick = await deckSettled(deck, 1_500, 45_000);
    const localAck = await readMonitorAck(win);
    verdict["localAck"] = localAck;
    // The words a person would have read: the row is the active pane's own
    // session, so the stage says it is there — or, if the click landed on
    // another pane's session, that it was mounted. Either is the door's local
    // verb answering; silence is the failure.
    if (!localAck.includes("active pane")) {
      throw new Error(
        `selecting a local row did not answer through the door's local verb: ${JSON.stringify(localAck)}`,
      );
    }
    if (afterLocalClick.panes !== beforeLocalClick.panes) {
      throw new Error(
        `selecting a local row changed the deck's shape (${beforeLocalClick.panes} → ${afterLocalClick.panes} panes)`,
      );
    }
    // NOTHING IS CARVED OUT of this check any more (GT-6a). It used to exclude
    // row 10's own-kill target, whose pane stayed mounted holding its last
    // summary — ghosttea's terminate drops the local registration, so no exited
    // face follows a deliberate local kill — while the floor listed that id
    // `exited`. Row 10 is withdrawn with the kill chip it drove, so no pane
    // here holds a dead session id, and the liveness claim can be made about
    // EVERY pane: anything a local click could have invented must be
    // floor-known and alive.
    const paneSessions = afterLocalClick.sessionIds;
    await untilFloor(
      opts.handle,
      (terminals) =>
        paneSessions.every((id) => terminals.some((t) => t.sessionId === id && t.exited !== true)),
      `list every session the deck's panes hold after a local click (${JSON.stringify(paneSessions)}) — a row that mounted would put an id here the floor never created`,
      20_000,
    );
    verdict["localRoutingHeld"] = true;
    verdict["localPaneSessions"] = paneSessions.length;

    // 13b. THE DOOR ROW. A peer's session is a bubble in the swarm, and
    //      CLICKING it attaches the active pane to it — no palette anywhere in
    //      this path (⌘⇧O stays off; GT-D7's amendment).
    //
    //      Behind an honest capability check, because a peer is not something
    //      this harness can conjure: the mesh floor is GT-4's other half, and
    //      two floors on a tailnet are not stageable here yet. With no peer the
    //      row REPORTS `unavailable` with the monitor's own state — it never
    //      fakes a host, and it never passes silently as though it had run.
    //
    //      R-L8 (TM review, 2026-09-14) — AND THERE IS A SECOND REASON the
    //      paragraph above does not name. The monitor's host list comes from
    //      `runtime.listRemoteHosts()` (GodviewDeck.tsx), whose VibeField
    //      answerer TM-1 deleted along with the in-process serve and
    //      `STORES.TERMINAL_HOSTS`. So `remotePeer: "unavailable"` today is not
    //      "no peer was staged" but "nothing is left to answer" — still honest,
    //      still never a silent pass, and still REPORTED rather than asserted.
    //      The call site carries the same date and the reason it stays.
    //      *Correction 2026-09-30 (DS-3):* the monitor's remote rows come from
    //      the MESH BOARD now (`agent.subscribe {scope: "mesh"}` through the
    //      deck's fieldd client), not `listRemoteHosts`, which is gone from the
    //      deck. On a single-desktop smoke the board answers with this desktop
    //      alone, so `remoteSessions` is 0 and this row still reports
    //      `unavailable` (no peer staged). A board row is not attachable until
    //      DS-4 lands; were one staged, the click below would be answered with
    //      that sentence and no attach — this row must learn DS-4's path first.
    const monitorNow = monitorWatch.current();
    verdict["remoteState"] = monitorNow?.remoteState ?? "unreported";
    verdict["remoteSessions"] = monitorNow?.remoteSessions ?? 0;
    verdict["remoteHosts"] = monitorNow?.remoteHosts ?? 0;
    if (monitorNow?.remoteReason !== undefined) verdict["remoteReason"] = monitorNow.remoteReason;
    if (monitorNow === null || monitorNow === undefined || monitorNow.remoteSessions === 0) {
      // The monitor asked and got nothing, or had nobody to ask. Both are
      // states with names, and neither is a remote session.
      verdict["remotePeer"] = "unavailable";
    } else {
      verdict["remotePeer"] = "available";
      const beforeAttach = deck.current();
      if (beforeAttach === null) throw new Error("the deck said nothing before the attach");
      const attachedLabel = await clickMonitorBubble(
        win,
        '.vf-monitor-swarm-list button[data-agent-bubble-source="remote"]',
      );
      verdict["remoteBubbleClicked"] = attachedLabel;
      const attached = await deck.until(
        (facts) =>
          facts.activeSessionId !== undefined &&
          !beforeAttach.sessionIds.includes(facts.activeSessionId),
        "the active pane to be showing the peer's session",
        30_000,
      );
      verdict["remoteAttachedSessionId"] = attached.activeSessionId ?? null;
      verdict["remoteAttachAck"] = await readMonitorAck(win);
      // The pane COUNT is unchanged: GT-D17 attaches the pane the user is in,
      // it does not split one open. That is the difference between our door
      // and upstream's palette, and it is worth asserting rather than assuming.
      if (attached.panes !== beforeAttach.panes) {
        throw new Error(
          `the attach changed the deck's shape (${beforeAttach.panes} → ${attached.panes} panes); GT-D17 attaches the ACTIVE pane`,
        );
      }
    }

    // ── 14. THE TYPED AGENT (AR-7, R1 — "type it") ───────────────────────
    //
    // Placed after the door rows for the reason 13 is placed after the
    // recovery: it opens a pane of its own and runs an agent in it, and every
    // row above asserts about the panes and the fold this deck had before.
    if (opts.typedAgent === undefined) {
      // Honest, never a silent pass: the rows need their person and stub, and
      // main stages them only into a root this run created.
      verdict["typedAgent"] =
        "unavailable: nothing was staged — an injected FIELDD_DATA_DIR is someone else's root";
    } else {
      await typedAgentRows({
        win,
        handle: opts.handle,
        userRoot: opts.root,
        staged: opts.typedAgent,
        deck,
        monitorWatch,
        verdict,
      });
      // ── 14b. THE LAUNCH (QL-2) — the same stub, launched from a fresh pane's launcher.
      await launchRows({ win, deck, verdict });
    }

    // ── 15. THE SPAWN BLOOM (SB-3) — a hold's bloom, a shell born under a
    // profile, its launcher, and the typed agent it refuses. After the typed
    // rows, so the pane it births is born with the gateway's launcher standing.
    await spawnBloomRows({
      win,
      handle: opts.handle,
      userRoot: opts.root,
      staged: opts.typedAgent,
      deck,
      verdict,
    });

    // ── 15b. THE SPEND VIEW (MV-7) — the registry's fifth view mounts, paints
    // and keeps its keys on its root. After the bloom, so the rows the typed
    // agents and the birth left are on its list; the swarm is chosen again after.
    await spendViewRow({ win, monitorWatch, verdict });

    // ── GT-3p, REPORT-ONLY ────────────────────────────────────────────────
    // Everything below records numbers and asserts nothing. A performance row
    // that could fail this smoke would be a budget nobody has agreed to yet
    // (the `keystrokeEchoMs` precedent, GT-3), and these numbers move with
    // machine load — the same load that already makes the reload rows flaky.
    //
    // THE COLD OPEN, and it is genuinely cold even though the prewarm is on:
    // row 1 presses ⇧⇧ the moment the canvas reports, which is well inside the
    // 2s idle window the prewarm is scheduled in — so `openTerminalPool`'s
    // SYNCHRONOUS claim lands first, the idle callback then finds the pool
    // already claimed and does nothing (GT-D14's second half, TP-S0b), and the
    // first open of this harness takes the cold path by construction.
    // `prewarmed: false` in this object is the proof rather than a
    // disappointment. It is the BEFORE number, measured on the same run as the
    // after. (The name here used to be `claimWarmTransport`, which was never on
    // the deck's path at all — the deck always waited for a warm in FLIGHT, and
    // the pool still does.)
    verdict["coldOpen"] = await coldOpenLine
      .then((raw) => JSON.parse(raw) as Record<string, unknown>)
      .catch((error) => ({ unmeasured: error instanceof Error ? error.message : String(error) }));

    // The steady-state frame cost, sampled from the page itself while the
    // overlay is open with the swarm running and a pane focused. One second of
    // rAF intervals; the median is the honest summary of a sample this short.
    //
    // GT-3c crosses the cadence with LoAF, which is `frame-stats.ts`'s own pairing
    // (its module note: neither source alone is a diagnosis, their disagreement
    // is). Cadence says whether frames are late; `blockingMs` says how much of
    // the lateness the main thread owes. A slice that moves work OFF the main
    // thread is supposed to leave the first number alone and shrink the second —
    // and LoAF reporting zero in both directions is itself a finding, not a
    // failure, because a swarm this small may never build a 50ms frame to be
    // seen. Still report-only: it asserts nothing.
    verdict["frameMs"] = await win.webContents
      .executeJavaScript(
        `new Promise((resolve) => {
          const intervals = [];
          const loaf = [];
          let observer = null;
          try {
            observer = new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                loaf.push({
                  duration: entry.duration,
                  blocking: entry.blockingDuration ?? 0,
                  script: entry.scriptDuration ?? 0,
                });
              }
            });
            observer.observe({ type: "long-animation-frame", buffered: false });
          } catch {
            // An engine without LoAF reports null rather than a silent zero —
            // "unobservable" and "nothing blocked" are different answers.
            observer = null;
          }
          let last = performance.now();
          const tick = (now) => {
            intervals.push(now - last);
            last = now;
            if (now - start < 1000) requestAnimationFrame(tick);
            else {
              observer?.disconnect();
              const sorted = intervals.slice(1).sort((a, b) => a - b);
              const round = (value) => Math.round(value * 10) / 10;
              resolve(sorted.length === 0 ? null : {
                frames: sorted.length,
                p50: round(sorted[Math.floor(sorted.length * 0.5)]),
                p95: round(sorted[Math.floor(sorted.length * 0.95)]),
                loafFrames: observer === null ? null : loaf.length,
                loafBlockingMs:
                  observer === null
                    ? null
                    : round(loaf.reduce((total, entry) => total + entry.blocking, 0)),
                loafScriptMs:
                  observer === null
                    ? null
                    : round(loaf.reduce((total, entry) => total + entry.script, 0)),
                loafWorstMs:
                  observer === null
                    ? null
                    : round(loaf.reduce((worst, entry) => Math.max(worst, entry.duration), 0)),
              });
            }
          };
          const start = performance.now();
          requestAnimationFrame(tick);
        })`,
      )
      .catch((error) => ({ unmeasured: error instanceof Error ? error.message : String(error) }));

    // 11i. THE HEAD'S KEYS, FROM A FOCUSED PANE (One Frame FR-3, DK-D24) — the
    //      probe ⌘+ ⌘− ⌘0 ⇧1 owe before they ship, in 11h's form: a pane holds
    //      focus, each key is pressed the way a keyboard presses it, and the
    //      HEAD says what it took (its ZOOM_KEY line). They are Canvas's keys,
    //      not the product's chords — heard on the window's bubble phase — so a
    //      pane that holds the keyboard keeps them, and the head takes NOTHING:
    //      no ZOOM_KEY line, the canvas's readout under the cover unchanged, the
    //      window still in Godview. The positive control has two ears, because
    //      the pane takes the two kinds of key at two places: ghostty's app
    //      binds (⌘+ ⌘− ⌘0, its font sizes) are taken by ghosttea's WORKSPACE on
    //      the window's capture phase, prevented and stopped before the input
    //      ever sees them — so an ear on the window's capture phase records that
    //      each ARRIVED and was TAKEN (its final defaultPrevented, read once the
    //      dispatch is over); ⇧1 is typed — the input's ear hears its "!", and a
    //      Backspace takes it back out of the shell. Then the canvas, with
    //      nothing focused: each key moves the zoom and says so. Then ⇧1 typed
    //      into the line's draft stays a "!" — never a fit. ⌘K's probe is 11e's,
    //      unchanged. Before 11h, which must stay last (its ⌘T leaves a fresh
    //      shell whose launcher holds the keys).
    //
    //      THE VIEW MENU'S ZOOM (FR-4, 3b) rides the same rows: under Godview
    //      the LIVE menu's Zoom In (main redraws it on every change of view) is
    //      disabled, and invoked the way the native menu invokes an item — with
    //      the focused window and its page, which is all Electron's page-zoom
    //      role needed to scale the whole window — it changes nothing: no act,
    //      the canvas's readout, the page's zoom level, the view. On the canvas
    //      the same item is enabled and the HEAD answers it (its ZOOM_MENU
    //      line): the canvas zooms by the step, Actual Size brings it back, and
    //      the page's zoom level never moves. The menu is driven, not keyed:
    //      `sendInputEvent` enters below AppKit's key-equivalent dispatch (the
    //      ⌘W note above), so a synthesized ⌘+ can never reach a menu item.
    const headKeys: Record<string, string> = {};
    const zoomTaken: string[] = [];
    const zoomMenuTaken: string[] = [];
    const hearHead = (...args: unknown[]): void => {
      for (const arg of args) {
        const text = consoleText(arg);
        if (text.startsWith("ZOOM_KEY ")) zoomTaken.push(text.slice("ZOOM_KEY ".length));
        if (text.startsWith("ZOOM_MENU ")) zoomMenuTaken.push(text.slice("ZOOM_MENU ".length));
      }
    };
    /** A View menu zoom item as the live menu holds it now. */
    const zoomItem = (id: string): ReturnType<Menu["getMenuItemById"]> =>
      Menu.getApplicationMenu()?.getMenuItemById(id) ?? null;
    /** Invoke an item the way the native menu does: the event, the focused
     * window, its page. A role item answers through those two (Electron's
     * `roles.execute`); ours ignore them and ask main's subject themselves. */
    const invokeMenuItem = (item: NonNullable<ReturnType<Menu["getMenuItemById"]>>): void => {
      (item.click as (event: unknown, window: BrowserWindow, contents: WebContents) => void)(
        undefined,
        win,
        win.webContents,
      );
    };
    const READOUT = `(document.querySelector(".vf-head-zoom")?.textContent ?? "absent")`;
    /** The page's ear: every keydown as the window's capture phase first sees
     * it, and whether anyone had taken it by the end of its dispatch. */
    const PAGE_EAR = `(() => {
      window.__vfPageEar = [];
      if (!window.__vfPageEarOn) {
        window.__vfPageEarOn = true;
        window.addEventListener("keydown", (event) => {
          const entry = {
            key: (event.metaKey ? "meta+" : "") + (event.ctrlKey ? "ctrl+" : "") + event.key,
            taken: false,
          };
          window.__vfPageEar.push(entry);
          setTimeout(() => { entry.taken = event.defaultPrevented; }, 0);
        }, true);
      }
      return "ok";
    })()`;
    /** The zoom's keys as a keyboard presses them: ⌘ (Ctrl) with = − 0, and
     * ⇧1. A terminal types from the KEY, so into a pane ⇧1 is down and up (as
     * 11h types its b) — a char event as well would type a second "!", and a
     * stray "!" left in the shell turns 11h's sent line into a history
     * expansion; an editor inserts the CHARACTER, so into the draft it is down,
     * the character, up. */
    const pressZoomKey = (key: "=" | "-" | "0" | "!", into: "pane" | "editor" = "pane"): void => {
      if (key !== "!") {
        pressProductChord(win, key);
        return;
      }
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "1", modifiers: ["shift"] });
      if (into === "editor") {
        win.webContents.sendInputEvent({ type: "char", keyCode: "!", modifiers: ["shift"] });
      }
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "1", modifiers: ["shift"] });
    };
    type ZoomFacts = { key: string; act: string; view: string; from: number; to: number };
    const zoomFromCanvas = async (key: "=" | "-" | "0" | "!"): Promise<ZoomFacts> => {
      const heard = waitForConsole(win, "ZOOM_KEY ", 10_000);
      pressZoomKey(key);
      return JSON.parse(await heard) as ZoomFacts;
    };
    win.webContents.on("console-message", hearHead);
    try {
      await focusDeck(win);
      await untilRenderer(win, "the probe reset", CHORD_PROBE, 5_000);
      await untilRenderer(win, "the page's ear", PAGE_EAR, 5_000);
      const readoutBefore = (await win.webContents.executeJavaScript(READOUT)) as string;
      for (const key of ["=", "-", "0", "!"] as const) {
        pressZoomKey(key);
        await sleep(150);
      }
      // An absence can only be watched for a while (⇧⇧'s rule): the head
      // answers a key in its own handler, inside one frame.
      await sleep(1_500);
      const paneHeard = await chordProbeHeard(win);
      const pageHeard = (await win.webContents.executeJavaScript(
        `[...(window.__vfPageEar ?? [])]`,
      )) as { key: string; taken: boolean }[];
      const mod = process.platform === "darwin" ? "meta+" : "ctrl+";
      // The POSITIVE CONTROL: every key arrived, and the pane took it — the
      // chords at its workspace, the "!" at its input — so the head's silence
      // is routing, not a deaf probe.
      for (const want of [`${mod}=`, `${mod}-`, `${mod}0`]) {
        const arrived = pageHeard.find((entry) => entry.key === want);
        if (arrived === undefined || !arrived.taken) {
          throw new Error(
            `the focused pane never took ${want}: page ${JSON.stringify(pageHeard)} · ` +
              `pane ${JSON.stringify(paneHeard)}`,
          );
        }
      }
      if (!paneHeard.includes("!")) {
        throw new Error(`the focused pane never typed ⇧1's "!": ${JSON.stringify(paneHeard)}`);
      }
      if (zoomTaken.length > 0) {
        throw new Error(`the head took a zoom key from a focused pane: ${zoomTaken.join(" · ")}`);
      }
      const readoutAfter = (await win.webContents.executeJavaScript(READOUT)) as string;
      if (readoutAfter !== readoutBefore) {
        throw new Error(
          `the canvas zoomed under a focused pane: ${readoutBefore} → ${readoutAfter}`,
        );
      }
      const stayed = (await win.webContents.executeJavaScript(VIEW_NOW)) as string;
      if (stayed !== "godview") throw new Error(`the zoom keys moved the window: ${stayed}`);
      win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Backspace" });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Backspace" });
      headKeys["from a focused pane"] =
        `godview: the pane took ${mod}= ${mod}- ${mod}0 at its workspace (ghostty's font sizes) ` +
        `and typed ⇧1's "!" at its input; the head took nothing; the canvas stayed at ${readoutBefore}`;

      // The View menu's Zoom In under Godview changes nothing (FR-4, 3b).
      const coveredIn = zoomItem(ZOOM_ITEM_IDS.in);
      if (coveredIn === null) throw new Error("the View menu has no Zoom In item");
      if (coveredIn.enabled) throw new Error("the View menu's Zoom In is enabled under Godview");
      const levelUnderCover = win.webContents.getZoomLevel();
      const menuHeardBefore = zoomMenuTaken.length;
      invokeMenuItem(coveredIn);
      await sleep(1_500);
      if (zoomMenuTaken.length > menuHeardBefore || zoomTaken.length > 0) {
        throw new Error(
          `the View menu's Zoom In zoomed under Godview: ${[...zoomMenuTaken, ...zoomTaken].join(" · ")}`,
        );
      }
      const levelAfterMenu = win.webContents.getZoomLevel();
      if (levelAfterMenu !== levelUnderCover) {
        // Put the window back before saying so: Chromium keeps a page zoom per
        // origin in the PROFILE, which this smoke shares with the app on the
        // machine, so a regression must not leave every later window zoomed.
        // (This row's own red-proof did, 2026-10-03: "shell" at 0.5.)
        win.webContents.setZoomLevel(levelUnderCover);
        throw new Error(
          `the View menu's Zoom In zoomed the whole window under Godview: page zoom level ${levelUnderCover} → ${levelAfterMenu}`,
        );
      }
      const readoutAfterMenu = (await win.webContents.executeJavaScript(READOUT)) as string;
      if (readoutAfterMenu !== readoutBefore) {
        throw new Error(
          `the View menu's Zoom In zoomed the canvas under Godview: ${readoutBefore} → ${readoutAfterMenu}`,
        );
      }
      const stayedAfterMenu = (await win.webContents.executeJavaScript(VIEW_NOW)) as string;
      if (stayedAfterMenu !== "godview") {
        throw new Error(`the View menu's Zoom In moved the window: ${stayedAfterMenu}`);
      }
      headKeys["the View menu under Godview"] =
        `Zoom In (${coveredIn.accelerator ?? "no key"}) disabled; invoked as the menu invokes it, ` +
        `it changed nothing: no act, the canvas still ${readoutAfterMenu}, the page zoom level ${levelAfterMenu}`;

      pressViewKey(win, "canvas");
      await untilRenderer(
        win,
        "⌘1 to the canvas",
        `${VIEW_NOW} === "canvas" ? "ok" : ${VIEW_NOW}`,
        10_000,
      );
      // Nothing focused: whatever held the keyboard lets go of it.
      await win.webContents.executeJavaScript(`document.activeElement?.blur?.(); "ok"`);
      const zoomIn = await zoomFromCanvas("=");
      const zoomOut = await zoomFromCanvas("-");
      const fit = await zoomFromCanvas("!");
      const actual = await zoomFromCanvas("0");
      const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1;
      if (zoomIn.act !== "in" || !near(zoomIn.to, zoomIn.from * 1.25)) {
        throw new Error(`⌘+ on the canvas was heard as ${JSON.stringify(zoomIn)}`);
      }
      if (zoomOut.act !== "out" || !near(zoomOut.to, zoomOut.from / 1.25)) {
        throw new Error(`⌘− on the canvas was heard as ${JSON.stringify(zoomOut)}`);
      }
      if (fit.act !== "fit")
        throw new Error(`⇧1 on the canvas was heard as ${JSON.stringify(fit)}`);
      if (actual.act !== "actual" || actual.to !== 100) {
        throw new Error(`⌘0 on the canvas was heard as ${JSON.stringify(actual)}`);
      }
      await untilRenderer(
        win,
        "the readout saying 100% after ⌘0",
        `${READOUT} === "100%" ? "ok" : ${READOUT}`,
        5_000,
      );
      headKeys["on the canvas"] =
        `nothing focused: ⌘+ ${zoomIn.from} → ${zoomIn.to} · ⌘− ${zoomOut.from} → ${zoomOut.to} · ` +
        `⇧1 fit ${fit.from} → ${fit.to} · ⌘0 ${actual.from} → ${actual.to}; the readout said each`;

      // …and on the canvas the same item is enabled and the HEAD answers it.
      const canvasIn = zoomItem(ZOOM_ITEM_IDS.in);
      if (canvasIn === null || !canvasIn.enabled) {
        throw new Error("the View menu's Zoom In is not enabled on the canvas");
      }
      const levelOnCanvas = win.webContents.getZoomLevel();
      const menuIn = waitForConsole(win, "ZOOM_MENU ", 10_000);
      invokeMenuItem(canvasIn);
      const answeredIn = JSON.parse(await menuIn) as ZoomFacts;
      if (answeredIn.act !== "in" || !near(answeredIn.to, answeredIn.from * 1.25)) {
        throw new Error(
          `the View menu's Zoom In on the canvas was heard as ${JSON.stringify(answeredIn)}`,
        );
      }
      const canvasActual = zoomItem(ZOOM_ITEM_IDS.actual);
      if (canvasActual === null || !canvasActual.enabled) {
        throw new Error("the View menu's Actual Size is not enabled on the canvas");
      }
      const menuActual = waitForConsole(win, "ZOOM_MENU ", 10_000);
      invokeMenuItem(canvasActual);
      const answeredActual = JSON.parse(await menuActual) as ZoomFacts;
      if (answeredActual.act !== "actual" || answeredActual.to !== 100) {
        throw new Error(
          `the View menu's Actual Size on the canvas was heard as ${JSON.stringify(answeredActual)}`,
        );
      }
      await untilRenderer(
        win,
        "the readout saying 100% after Actual Size",
        `${READOUT} === "100%" ? "ok" : ${READOUT}`,
        5_000,
      );
      const levelAfterCanvasMenu = win.webContents.getZoomLevel();
      if (levelAfterCanvasMenu !== levelOnCanvas) {
        win.webContents.setZoomLevel(levelOnCanvas); // the profile's, as above
        throw new Error(
          `the View menu zoomed the whole window on the canvas: page zoom level ${levelOnCanvas} → ${levelAfterCanvasMenu}`,
        );
      }
      headKeys["the View menu on the canvas"] =
        `Zoom In answered by the head ${answeredIn.from} → ${answeredIn.to} · Actual Size ` +
        `${answeredActual.from} → ${answeredActual.to}; the page zoom level stayed ${levelAfterCanvasMenu}`;

      const placed = (await win.webContents.executeJavaScript(
        `(() => { const field = document.querySelector(".vf-line-input"); if (!field) return "no draft";
          field.focus(); return document.activeElement === field ? "ok" : "focus refused"; })()`,
      )) as string;
      if (placed !== "ok") throw new Error(`the line's draft could not take focus: ${placed}`);
      const takenBefore = zoomTaken.length;
      pressZoomKey("!", "editor");
      await sleep(1_500);
      if (zoomTaken.length > takenBefore) {
        throw new Error(
          `⇧1 typed into the draft zoomed: ${zoomTaken.slice(takenBefore).join(" · ")}`,
        );
      }
      const typed = (await win.webContents.executeJavaScript(
        `document.querySelector(".vf-line-input")?.textContent ?? "no draft"`,
      )) as string;
      if (!typed.includes("!")) throw new Error(`⇧1 typed nothing into the draft: ${typed}`);
      // Clear the draft through the editing pipeline (its input event is what
      // the line reads back). Not a Backspace: on the Mac a synthesized keyDown
      // carries no Cocoa edit command, so it deletes nothing in an editor — and
      // a "!" left here rides 11h's sent line into the shell.
      const cleared = (await win.webContents.executeJavaScript(
        `(() => { const field = document.querySelector(".vf-line-input"); if (!field) return "no draft";
          field.focus(); document.execCommand("selectAll"); document.execCommand("delete");
          return (field.textContent ?? "") === "" ? "ok" : "left " + JSON.stringify(field.textContent); })()`,
      )) as string;
      if (cleared !== "ok") throw new Error(`the draft kept the probe's typing: ${cleared}`);
      headKeys["typing"] = `⇧1 into the line's draft typed "${typed}" and fit nothing`;
      await win.webContents.executeJavaScript(`document.activeElement?.blur?.(); "ok"`);
      pressViewKey(win, "godview");
      await deck.until((facts) => facts.active, "⌘2 back to the deck", 30_000);
    } finally {
      win.webContents.off("console-message", hearHead);
    }
    verdict["headKeys"] = headKeys;

    // 11h. THE LINE'S KEYS, DELIVERED FROM A FOCUSED PANE (One Frame FR-2,
    //      §11) — the probes B and ⌘T owe before they ship, in 11g's form: a
    //      pane holds focus, the ear listens at every pane input, each key is
    //      pressed the way a keyboard presses it, and the LINE says what it
    //      took (its LINE_KEY line). Last among the deck's rows on purpose: ⌘T
    //      leaves a fresh shell in the active pane, and a fresh shell shows its
    //      launcher, which holds the keys the rows above type into a shell.
    //
    //      B is a letter, and a pane that holds the keyboard keeps its letters:
    //      the PANE hears it and the LINE takes nothing — no LINE_KEY line,
    //      Objects shut, the window still in Godview — an absence, watched for
    //      a while as ⇧⇧'s is; a Backspace then takes the b back out of the
    //      shell. The interim send (four-views §11) goes next, end to end: @
    //      typed into the line, Return takes the nearest pane (the active one),
    //      a line typed and sent is PASTED into that pane — and the shell runs
    //      it only when the harness presses Return there, because the send
    //      never presses it. ⌘T is the line's in Godview: the LINE asked the
    //      deck, the PANE never heard it (ghostty's new_tab), and the deck
    //      shows a session it did not before. Then B on the canvas with
    //      nothing focused raises Objects behind the line, and B puts it away.
    const lineKeys: Record<string, string> = {};
    const lineTaken: string[] = [];
    const hearLine = (...args: unknown[]): void => {
      for (const arg of args) {
        const text = consoleText(arg);
        if (text.startsWith("LINE_KEY ")) lineTaken.push(text.slice("LINE_KEY ".length));
      }
    };
    /** Type into whatever holds focus as a keyboard does — a key down, the
     * character it types, the key up — which is what an editor needs (a
     * terminal reads the key; a contenteditable inserts the character). */
    const typeChars = async (text: string): Promise<void> => {
      for (const character of text) {
        const keyCode = character === " " ? "Space" : character;
        win.webContents.sendInputEvent({ type: "keyDown", keyCode });
        win.webContents.sendInputEvent({ type: "char", keyCode });
        win.webContents.sendInputEvent({ type: "keyUp", keyCode });
        await sleep(3);
      }
    };
    const pressKey = (keyCode: string): void => {
      win.webContents.sendInputEvent({ type: "keyDown", keyCode });
      win.webContents.sendInputEvent({ type: "keyUp", keyCode });
    };
    // DK-18: Objects is the desk's pegboard since DK-13 (the tray island and its `data-tray-open` are gone), and this smoke
    // runs GPU-less — no desk, so no board can rise here (smoke:canvas's BOARD rows hold the board itself). What B moves
    // here is the LINE's own: the frame's Objects surface, read off the line's create (`aria-expanded`, its ✕)
    const objectsNow = `(document.querySelector(".vf-line-create")?.getAttribute("aria-expanded") === "true" ? "open" : "shut")`;
    win.webContents.on("console-message", hearLine);
    try {
      await focusDeck(win);
      await untilRenderer(win, "the probe reset", CHORD_PROBE, 5_000);
      pressKey("b");
      await sleep(1_500);
      const paneHeardB = await chordProbeHeard(win);
      if (!paneHeardB.includes("b")) {
        throw new Error(`the focused pane never heard B: ${JSON.stringify(paneHeardB)}`);
      }
      if (lineTaken.length > 0) {
        throw new Error(`the line took B from a focused pane: ${lineTaken.join(" · ")}`);
      }
      if ((await win.webContents.executeJavaScript(objectsNow)) !== "shut") {
        throw new Error("B from a focused pane opened Objects");
      }
      const afterB = (await win.webContents.executeJavaScript(VIEW_NOW)) as string;
      if (afterB !== "godview")
        throw new Error(`B from a focused pane moved the window: ${afterB}`);
      pressKey("Backspace");
      lineKeys["B"] = "godview, a pane focused: the pane typed it; the line took nothing";

      if (process.platform !== "win32") {
        const nonce = `fr2${Math.random().toString(36).slice(2, 10)}`;
        const sentPath = `/tmp/${nonce}.txt`;
        const placed = (await win.webContents.executeJavaScript(
          `(() => { const field = document.querySelector(".vf-line-input"); if (!field) return "no draft";
            field.focus(); return document.activeElement === field ? "ok" : "focus refused"; })()`,
        )) as string;
        if (placed !== "ok") throw new Error(`the line's draft could not take focus: ${placed}`);
        await typeChars("@");
        const aimedAt = await untilRendererValue(
          win,
          "@'s list, the active pane hot",
          `document.querySelector(".vf-at-menu .vf-at-row.is-aim[data-hot] b")?.textContent ?? "no list"`,
          5_000,
          (value) => value !== "no list",
        );
        pressKey("Return");
        await untilRenderer(
          win,
          "the aim leading the draft",
          `document.querySelector('.vf-line-chip[data-chip="aim"]') ? "ok" : "unaimed"`,
          5_000,
        );
        await typeChars(`echo ${nonce} > ${sentPath}`);
        pressKey("Return");
        const said = await untilRendererValue(
          win,
          "the line saying where the send went",
          `document.querySelector(".vf-line-note")?.textContent ?? "no note"`,
          5_000,
          (value) => value !== "no note",
        );
        if (!said.startsWith("Pasted into")) throw new Error(`the send did not paste: ${said}`);
        await sleep(400);
        if (existsSync(sentPath)) {
          throw new Error("the send pressed Return for the pane — the shell ran it unasked");
        }
        pressKey("Return");
        await waitForShellMarker(sentPath, 10_000, nonce);
        lineKeys["send"] =
          `aimed at ${aimedAt}: ${said}; the shell ran it on the pane's own Return`;
      }

      await focusDeck(win);
      await untilRenderer(win, "the probe reset", CHORD_PROBE, 5_000);
      const sessionsBefore = new Set(deck.current()?.sessionIds ?? []);
      const heardT = waitForConsole(win, "LINE_KEY ", 10_000);
      pressProductChord(win, "t");
      const tFacts = JSON.parse(await heardT) as { key: string; view: string; outcome: string };
      if (tFacts.view !== "godview" || tFacts.outcome !== "new-terminal") {
        throw new Error(`the line heard ⌘T as ${JSON.stringify(tFacts)}`);
      }
      const grown = await deck.until(
        (facts) => facts.sessionIds.some((id) => !sessionsBefore.has(id)),
        "⌘T's new terminal in the deck",
        30_000,
      );
      const paneHeardT = await chordProbeHeard(win);
      if (paneHeardT.some((key) => /\+t$/iu.test(key))) {
        throw new Error(`the pane heard ⌘T too (ghostty's new_tab): ${JSON.stringify(paneHeardT)}`);
      }
      // A new terminal takes the ACTIVE pane (the deck's `createTerminal`, the
      // swarm's hold's door): a session the deck did not show, in a pane it had.
      const born = grown.sessionIds.find((id) => !sessionsBefore.has(id)) ?? "?";
      lineKeys["⌘T"] =
        `godview, a pane focused: the line asked the deck; a new shell ${born.slice(0, 8)}… in the ` +
        `active pane (${grown.panes} panes); the pane never heard it`;

      pressViewKey(win, "canvas");
      await untilRenderer(
        win,
        "⌘1 to the canvas",
        `${VIEW_NOW} === "canvas" ? "ok" : ${VIEW_NOW}`,
        10_000,
      );
      const opened = waitForConsole(win, "LINE_KEY ", 10_000);
      pressKey("b");
      const openFacts = JSON.parse(await opened) as { view: string; outcome: string };
      if (openFacts.view !== "canvas" || openFacts.outcome !== "opened") {
        throw new Error(`B on the canvas was heard as ${JSON.stringify(openFacts)}`);
      }
      await untilRenderer(
        win,
        "Objects behind the line",
        `${objectsNow} === "open" ? "ok" : "shut"`,
        5_000,
      );
      const closed = waitForConsole(win, "LINE_KEY ", 10_000);
      pressKey("b");
      const closeFacts = JSON.parse(await closed) as { outcome: string };
      if (closeFacts.outcome !== "closed")
        throw new Error(`B again: ${JSON.stringify(closeFacts)}`);
      await untilRenderer(
        win,
        "Objects put away",
        `${objectsNow} === "shut" ? "ok" : "open"`,
        5_000,
      );
      lineKeys["B on the canvas"] =
        "nothing focused: Objects rose behind the line; B again put it away";
      pressViewKey(win, "godview");
      await deck.until((facts) => facts.active, "⌘2 back to the deck", 30_000);
    } finally {
      win.webContents.off("console-message", hearLine);
    }
    verdict["lineKeys"] = lineKeys;

    // THE WARM OPEN — the AFTER number, and the row that actually tests GT-D14.
    //
    // A renderer reload resets the page's module state, so the next open is a
    // first open again; the difference from the row above is that this one WAITS
    // for the idle prewarm to land before pressing the key, which is the case a
    // real user is in (the app has been sitting there since login). The wait is
    // a plain sleep because the warm state lives in a module the page does not
    // publish — and the resulting line's own `prewarmed` field says whether the
    // transport was actually inherited, so a wait that was too short reports as
    // an honest `prewarmed: false` rather than a mislabelled number.
    //
    // The consent face is expected here: an earlier row killed a pane, so the
    // saved layout names a session the floor no longer has, and GT-3's gate asks
    // before the workspace may mount. Answering it is part of the path being
    // measured — this is the returning-user road to a pane, prompt and all.
    try {
      const warmLine = waitForConsole(win, "GODVIEW_COLD_OPEN ", 60_000);
      warmLine.catch(() => undefined);
      pressViewKey(win, "canvas");
      await deck.until((facts) => !facts.active, "the overlay to close", 20_000);
      const reloaded = waitForConsole(win, "CANVAS_READY ", 60_000);
      reloaded.catch(() => undefined);
      deck.reset();
      await loadRenderer(win, "smoke-godview", opts.viteUrl);
      await reloaded;
      win.focus();
      win.webContents.focus();
      // Long enough for the idle callback (2s ceiling) plus a ticket, a bridge
      // fork and a device request on a loaded machine.
      await sleep(5_000);
      pressViewKey(win, "godview");
      const asked = await deck.until(
        (facts) => facts.active && (facts.panes >= 1 || facts.consent !== undefined),
        "the warm open to reach a pane or the restore question",
        60_000,
      );
      if (asked.consent !== undefined) await clickDeckButton(win, "restore");
      await deck.until((facts) => facts.panes >= 1, "the warm open's first pane", 60_000);
      verdict["coldOpenWarm"] = JSON.parse(await warmLine) as Record<string, unknown>;
    } catch (error) {
      verdict["coldOpenWarm"] = {
        unmeasured: error instanceof Error ? error.message : String(error),
      };
    }

    verdict["ok"] = true;
  } catch (error) {
    verdict["reason"] = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`SMOKE_GODVIEW failed: ${verdict["reason"]}`);
  }
  await finish();
}

async function waitForLiveSurfaceLabResult(
  win: BrowserWindow,
  timeoutMs: number,
): Promise<LiveSurfaceLabRendererResult> {
  const resultExpression =
    `document.documentElement.dataset[${JSON.stringify(LIVE_SURFACE_LAB_RESULT_DATASET)}]` +
    ` ?? ""`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const raw = (await win.webContents.executeJavaScript(resultExpression, true)) as unknown;
    if (typeof raw === "string" && raw !== "") {
      return JSON.parse(raw) as LiveSurfaceLabRendererResult;
    }
    await sleep(25);
  }
  throw new Error(`the Live Surfaces renderer did not report within ${timeoutMs}ms`);
}

async function startLiveSurfacePageServer(): Promise<{
  readonly origin: string;
  close(): Promise<void>;
}> {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#07110d}canvas{width:100%;height:100%;display:block}#probe{position:fixed;z-index:2;left:4px;top:4px;width:100px;height:24px;opacity:.01}</style>
</head><body><input id="probe" aria-label="input probe"><canvas width="320" height="180"></canvas><script>
const probe=document.querySelector('#probe');window.__vfInputProof={mouseDown:0,keyDown:0};
probe.addEventListener('mousedown',()=>window.__vfInputProof.mouseDown++);
probe.addEventListener('keydown',()=>window.__vfInputProof.keyDown++);
const canvas=document.querySelector('canvas');const ctx=canvas.getContext('2d');let frame=0;
function draw(now){frame++;const hue=(frame*3+location.pathname.length*17)%360;
const gradient=ctx.createLinearGradient(0,0,320,180);gradient.addColorStop(0,'hsl('+hue+' 72% 42%)');gradient.addColorStop(1,'hsl('+((hue+110)%360)+' 78% 18%)');
ctx.fillStyle=gradient;ctx.fillRect(0,0,320,180);ctx.fillStyle='rgba(255,255,255,.9)';ctx.fillRect((frame*5)%300,28,20,124);
ctx.font='600 18px system-ui';ctx.fillText(location.pathname.slice(-12),18,28);ctx.font='12px monospace';ctx.fillText(String(Math.round(now)),18,164);requestAnimationFrame(draw)}requestAnimationFrame(draw);
</script></body></html>`;
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    response.end(html);
  });
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address() as AddressInfo | null;
  if (address === null) throw new Error("the Browser lab HTTP server did not bind");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

interface LiveSurfaceBrowserInputProof {
  readonly focused: boolean;
  readonly value: string;
  readonly mouseDown: number;
  readonly keyDown: number;
}

async function proveLiveSurfaceBrowserInput(
  runtime: BrowserLiveSurfaceRuntime,
  controlTargets: BrowserControlTargetRegistry,
  timeoutMs = 15_000,
): Promise<LiveSurfaceBrowserInputProof> {
  const deadline = Date.now() + timeoutMs;
  let lastFailure = "source did not become input-ready";
  while (Date.now() < deadline) {
    try {
      const summary = runtime.summary;
      const binding = controlTargets.lookupPrivate(runtime.surfaceId);
      if (summary.state !== "live" || summary.geometry === undefined || binding === null) {
        await sleep(10);
        continue;
      }
      const contents = binding.contents as WebContents;
      const probeReady = (await contents.executeJavaScript(
        `document.querySelector("#probe") !== null`,
        true,
      )) as boolean;
      if (!probeReady) {
        await sleep(10);
        continue;
      }
      await contents.executeJavaScript(
        `(() => { const probe = document.querySelector("#probe"); probe.value = ""; window.__vfInputProof = { mouseDown: 0, keyDown: 0 }; })()`,
        true,
      );
      const revision = runtime.summary.geometry?.revision;
      if (revision === undefined) continue;
      for (const type of ["down", "up"] as const) {
        await runtime.dispatchInput({
          kind: "mouse",
          geometryRevision: revision,
          type,
          x: 12,
          y: 12,
          button: "left",
          clickCount: 1,
        });
      }
      for (const type of ["down", "up"] as const) {
        await runtime.dispatchInput({
          kind: "key",
          geometryRevision: revision,
          type,
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
        });
      }
      await runtime.dispatchInput({
        kind: "text",
        geometryRevision: revision,
        text: "vf",
      });
      await sleep(20);
      const proof = (await contents.executeJavaScript(
        `(() => ({ focused: document.activeElement?.id === "probe", value: document.querySelector("#probe")?.value ?? "", mouseDown: window.__vfInputProof?.mouseDown ?? 0, keyDown: window.__vfInputProof?.keyDown ?? 0 }))()`,
        true,
      )) as LiveSurfaceBrowserInputProof;
      if (proof.focused && proof.value === "vf" && proof.mouseDown >= 1 && proof.keyDown >= 1) {
        return proof;
      }
      lastFailure = JSON.stringify(proof);
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await sleep(10);
  }
  throw new Error(`Browser target-scoped input proof failed: ${lastFailure}`);
}

interface LiveSurfaceSckLabBase {
  readonly helperPath: string;
  readonly adapterPath: string;
}

interface LiveSurfaceSckFixtureLab extends LiveSurfaceSckLabBase {
  readonly kind: "fixture";
  readonly fixturePath: string;
  readonly sessionCount: number;
}

interface LiveSurfaceSimulatorLab extends LiveSurfaceSckLabBase {
  readonly kind: "simulator";
  readonly udid: string;
  readonly developerDir?: string;
  readonly rotate: boolean;
  readonly requireInactiveSpace: boolean;
}

interface LiveSurfaceMixedSckLab extends LiveSurfaceSckLabBase {
  readonly kind: "mixed";
  readonly fixturePath: string;
  readonly fixtureCount: number;
  readonly udid: string;
  readonly developerDir?: string;
  readonly rotate: boolean;
  readonly requireInactiveSpace: boolean;
}

type LiveSurfaceSckLab =
  | LiveSurfaceSckFixtureLab
  | LiveSurfaceSimulatorLab
  | LiveSurfaceMixedSckLab;

interface LiveSurfaceSckFixture {
  readonly pid: number;
  readonly title: string;
  dispose(): Promise<void>;
}

class LiveSurfaceHelperProcessHarness {
  #current: ChildProcessWithoutNullStreams | null = null;

  readonly spawnHelper = (
    helperPath: string,
    args: readonly string[],
  ): ChildProcessWithoutNullStreams => {
    const child = spawn(helperPath, [...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      windowsHide: true,
    });
    this.#current = child;
    const clear = (): void => {
      if (this.#current === child) this.#current = null;
    };
    child.once("error", clear);
    child.once("exit", clear);
    return child;
  };

  get current(): ChildProcessWithoutNullStreams | null {
    return this.#current;
  }
}

interface LiveSurfaceHelperCrashProof {
  readonly requested: number;
  readonly completed: number;
  readonly helperExits: number;
  readonly helperLeasesReleasedByTeardown: number;
}

async function driveLiveSurfaceHelperCrashes(
  win: BrowserWindow,
  supervisor: MacosCaptureHelperSupervisor,
  harness: LiveSurfaceHelperProcessHarness,
  requested: number,
  timeoutMs: number,
): Promise<LiveSurfaceHelperCrashProof> {
  const stateExpression = `({ request: document.documentElement.dataset[${JSON.stringify(
    LIVE_SURFACE_LAB_HELPER_CRASH_REQUEST_DATASET,
  )}] ?? "", result: document.documentElement.dataset[${JSON.stringify(
    LIVE_SURFACE_LAB_RESULT_DATASET,
  )}] ?? "" })`;
  const deadline = Date.now() + timeoutMs;
  let completed = 0;
  while (completed < requested) {
    const expected = completed + 1;
    let observed = false;
    while (!observed && Date.now() < deadline) {
      const state = (await win.webContents.executeJavaScript(stateExpression, true)) as {
        readonly request: string;
        readonly result: string;
      };
      observed = state.request === String(expected);
      if (!observed && state.result.length > 0) {
        throw new Error(`renderer completed before requesting helper crash ${expected}`);
      }
      if (!observed) await sleep(10);
    }
    if (!observed) throw new Error(`renderer did not request helper crash ${expected}`);
    const child = harness.current;
    if (child === null || child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`helper crash ${expected} had no live process target`);
    }
    if (supervisor.stats.helperLeasesOutstanding === 0) {
      throw new Error(`helper crash ${expected} was not requested with a retained frame lease`);
    }
    const priorExits = supervisor.stats.helperExits;
    if (!child.kill("SIGKILL")) throw new Error(`helper crash ${expected} could not signal helper`);
    while (supervisor.stats.helperExits === priorExits && Date.now() < deadline) await sleep(10);
    if (supervisor.stats.helperExits === priorExits) {
      throw new Error(`helper crash ${expected} did not observe process teardown`);
    }
    completed = expected;
    await win.webContents.executeJavaScript(
      `document.documentElement.dataset[${JSON.stringify(
        LIVE_SURFACE_LAB_HELPER_CRASH_ACK_DATASET,
      )}] = ${JSON.stringify(String(completed))}`,
      true,
    );
  }
  const stats = supervisor.stats;
  return {
    requested,
    completed,
    helperExits: stats.helperExits,
    helperLeasesReleasedByTeardown: stats.helperLeasesReleasedByTeardown,
  };
}

async function startLiveSurfaceSckFixture(path: string): Promise<LiveSurfaceSckFixture> {
  const child = spawn(path, [], { stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.end();
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer | string) => {
    if (stderr.length < 4_096) stderr += String(chunk).slice(0, 4_096 - stderr.length);
  });
  const ready = await new Promise<{ pid: number; title: string }>((resolve, reject) => {
    let stdout = Buffer.alloc(0);
    let settled = false;
    const finish = (error?: Error, value?: { pid: number; title: string }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error !== undefined) reject(error);
      else if (value !== undefined) resolve(value);
    };
    const onData = (chunk: Buffer | string): void => {
      stdout = Buffer.concat([stdout, Buffer.from(chunk)]);
      if (stdout.byteLength > 4_096) {
        finish(new Error("SCK fixture readiness output exceeded its bound"));
        return;
      }
      const newline = stdout.indexOf(0x0a);
      if (newline < 0) return;
      try {
        const value: unknown = JSON.parse(stdout.subarray(0, newline).toString("utf8"));
        if (
          typeof value !== "object" ||
          value === null ||
          !("ok" in value) ||
          value.ok !== true ||
          !("pid" in value) ||
          !Number.isSafeInteger(value.pid) ||
          value.pid !== child.pid ||
          !("title" in value) ||
          typeof value.title !== "string" ||
          value.title.length === 0 ||
          value.title.length > 512
        ) {
          throw new Error("SCK fixture returned invalid readiness metadata");
        }
        finish(undefined, { pid: value.pid as number, title: value.title });
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    };
    const onError = (error: Error): void => finish(error);
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void =>
      finish(
        new Error(
          `SCK fixture exited before ready (${code ?? signal ?? "unknown"})${
            stderr.length === 0 ? "" : `: ${stderr.trim()}`
          }`,
        ),
      );
    const timer = setTimeout(
      () => finish(new Error("SCK fixture did not become ready within 5s")),
      5_000,
    );
    child.stdout.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  }).catch((error) => {
    if (child.exitCode === null) child.kill("SIGTERM");
    throw error;
  });

  return {
    ...ready,
    dispose: async () => {
      if (child.exitCode !== null) return;
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(forceTimer);
          clearTimeout(finalTimer);
          resolve();
        };
        const forceTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
        const finalTimer = setTimeout(finish, 3_000);
        child.once("exit", () => {
          finish();
        });
        if (!child.kill("SIGTERM") && child.exitCode !== null) finish();
      });
    },
  };
}

async function findSckFixtureSources(
  supervisor: MacosCaptureHelperSupervisor,
  fixtures: readonly LiveSurfaceSckFixture[],
): Promise<readonly MacosCaptureSource[]> {
  const deadline = Date.now() + 10_000;
  let lastSourceCount = 0;
  while (Date.now() < deadline) {
    const sources = await supervisor.enumerateWindows(true);
    lastSourceCount = sources.length;
    const matches = fixtures.map((fixture) =>
      sources.find(
        (candidate) => candidate.ownerPid === fixture.pid && candidate.title === fixture.title,
      ),
    );
    if (matches.every((source): source is MacosCaptureSource => source !== undefined)) {
      return matches;
    }
    await sleep(50);
  }
  throw new Error(
    `${fixtures.length} SCK fixture window(s) were not all enumerated among ${lastSourceCount} sources`,
  );
}

async function clickSimulatorRotate(): Promise<void> {
  const script = [
    'tell application "Simulator" to activate',
    "delay 0.5",
    'tell application "System Events"',
    '  tell process "Simulator"',
    "    repeat with candidate in windows",
    "      try",
    '        set controls to (every button of toolbar 1 of candidate whose description is "Rotate")',
    "        if (count of controls) > 0 then",
    "          click item 1 of controls",
    "          return",
    "        end if",
    "      end try",
    "    end repeat",
    "  end tell",
    "end tell",
    'error "Simulator rotate control was unavailable"',
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "/usr/bin/osascript",
      script.flatMap((line) => ["-e", line]),
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer | string) => {
      if (stderr.length < 4_096) stderr += String(chunk).slice(0, 4_096 - stderr.length);
    });
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error === undefined) resolve();
      else reject(error);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("Simulator rotation command timed out"));
    }, 5_000);
    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => {
      if (code === 0) finish();
      else {
        finish(
          new Error(
            `Simulator rotation command failed (${code ?? signal ?? "unknown"})${
              stderr.length === 0 ? "" : `: ${stderr.trim()}`
            }`,
          ),
        );
      }
    });
  });
}

interface LiveSurfaceSimulatorRotationProof {
  readonly initialEpoch: number;
  readonly finalEpoch: number;
  readonly initialLogicalSize: { readonly width: number; readonly height: number };
  readonly finalLogicalSize: { readonly width: number; readonly height: number };
  readonly sessionRestarts: number;
}

async function proveSimulatorRotation(
  runtime: IosSimulatorLiveSurfaceRuntime,
): Promise<LiveSurfaceSimulatorRotationProof> {
  const readyDeadline = Date.now() + 90_000;
  while (
    (runtime.stats.framesReceived < 3 || runtime.summary.geometry === undefined) &&
    Date.now() < readyDeadline
  ) {
    await sleep(25);
  }
  const initial = runtime.summary;
  if (runtime.stats.framesReceived < 3 || initial.geometry === undefined) {
    throw new Error("Simulator runtime produced no stable pre-rotation geometry");
  }
  await clickSimulatorRotate();
  const changedDeadline = Date.now() + 20_000;
  let final = runtime.summary;
  while (
    (final.producerEpoch <= initial.producerEpoch ||
      final.geometry === undefined ||
      (final.geometry.logicalSize.width === initial.geometry.logicalSize.width &&
        final.geometry.logicalSize.height === initial.geometry.logicalSize.height)) &&
    Date.now() < changedDeadline
  ) {
    await sleep(25);
    final = runtime.summary;
  }
  if (
    final.producerEpoch <= initial.producerEpoch ||
    final.geometry === undefined ||
    (final.geometry.logicalSize.width === initial.geometry.logicalSize.width &&
      final.geometry.logicalSize.height === initial.geometry.logicalSize.height)
  ) {
    throw new Error("Simulator runtime did not rebind after orientation changed");
  }
  return {
    initialEpoch: initial.producerEpoch,
    finalEpoch: final.producerEpoch,
    initialLogicalSize: initial.geometry.logicalSize,
    finalLogicalSize: final.geometry.logicalSize,
    sessionRestarts: runtime.stats.sessionRestarts,
  };
}

/**
 * LSF-2/3/4 standalone lab: retains the CPU/device-loss regression, then proves
 * real guarded Browser OSR through one surface, observed CPU fallback, and ten
 * concurrent shared-texture surfaces. The optional macOS phase then drives a
 * deterministic window through the production helper/adapter and same store.
 */
class LiveSurfaceImportDurationHistogram {
  static readonly maximumBucketUs = 10_000;
  readonly #buckets = new Uint32Array(LiveSurfaceImportDurationHistogram.maximumBucketUs + 2);
  #count = 0;
  #maximumMs = 0;

  observe(durationNs: bigint): void {
    const durationMs = Number(durationNs) / 1_000_000;
    const durationUs = Math.ceil(durationMs * 1_000);
    const bucket = Math.min(
      LiveSurfaceImportDurationHistogram.maximumBucketUs + 1,
      Math.max(0, durationUs),
    );
    this.#buckets[bucket] = (this.#buckets[bucket] ?? 0) + 1;
    this.#count += 1;
    this.#maximumMs = Math.max(this.#maximumMs, durationMs);
  }

  snapshot(): {
    readonly count: number;
    readonly p95Ms: number | null;
    readonly p95Overflow: boolean;
    readonly maximumMs: number;
  } {
    if (this.#count === 0) {
      return { count: 0, p95Ms: null, p95Overflow: false, maximumMs: 0 };
    }
    const rank = Math.ceil(this.#count * 0.95);
    let seen = 0;
    let p95Bucket = 0;
    for (const [bucket, count] of this.#buckets.entries()) {
      seen += count;
      if (seen >= rank) {
        p95Bucket = bucket;
        break;
      }
    }
    const p95Overflow = p95Bucket > LiveSurfaceImportDurationHistogram.maximumBucketUs;
    return {
      count: this.#count,
      p95Ms: p95Bucket / 1_000,
      p95Overflow,
      maximumMs: Math.round(this.#maximumMs * 1_000) / 1_000,
    };
  }
}

class LiveSurfaceMainDutyMeter {
  #active = false;
  #startedAtUs = 0n;
  #busyUs = 0n;
  #maximumWorkItemUs = 0n;
  #paintCallbacks = 0;
  #captureCallbacks = 0;
  #textureSends = 0;

  begin(): void {
    this.#active = true;
    this.#startedAtUs = process.hrtime.bigint() / 1_000n;
    this.#busyUs = 0n;
    this.#maximumWorkItemUs = 0n;
    this.#paintCallbacks = 0;
    this.#captureCallbacks = 0;
    this.#textureSends = 0;
  }

  observePaint(durationUs: bigint): void {
    this.observe(durationUs);
    if (this.#active && durationUs >= 0n) this.#paintCallbacks += 1;
  }

  observeCapture(durationUs: bigint): void {
    this.observe(durationUs);
    if (this.#active && durationUs >= 0n) this.#captureCallbacks += 1;
  }

  observeTextureSend(durationUs: bigint): void {
    this.observe(durationUs);
    if (this.#active && durationUs >= 0n) this.#textureSends += 1;
  }

  private observe(durationUs: bigint): void {
    if (!this.#active || durationUs < 0n) return;
    this.#busyUs += durationUs;
    this.#maximumWorkItemUs =
      durationUs > this.#maximumWorkItemUs ? durationUs : this.#maximumWorkItemUs;
  }

  finish(): {
    readonly paintCallbacks: number;
    readonly captureCallbacks: number;
    readonly textureSends: number;
    readonly elapsedMs: number;
    readonly busyMs: number;
    readonly ratio: number;
    readonly maximumWorkItemMs: number;
  } {
    if (!this.#active) throw new Error("main callback duty meter was not active");
    this.#active = false;
    const elapsedUs = process.hrtime.bigint() / 1_000n - this.#startedAtUs;
    const elapsedMs = Number(elapsedUs) / 1_000;
    const busyMs = Number(this.#busyUs) / 1_000;
    return {
      paintCallbacks: this.#paintCallbacks,
      captureCallbacks: this.#captureCallbacks,
      textureSends: this.#textureSends,
      elapsedMs: Math.round(elapsedMs),
      busyMs: Math.round(busyMs * 1_000) / 1_000,
      ratio: elapsedMs === 0 ? 0 : Math.round((busyMs / elapsedMs) * 100_000) / 100_000,
      maximumWorkItemMs: Number(this.#maximumWorkItemUs) / 1_000,
    };
  }
}

async function measureLiveSurfaceMainDuty(
  win: BrowserWindow,
  meter: LiveSurfaceMainDutyMeter,
  timeoutMs: number,
): Promise<ReturnType<LiveSurfaceMainDutyMeter["finish"]>> {
  const activeExpression = `document.documentElement.dataset[${JSON.stringify(
    LIVE_SURFACE_LAB_CONTINUOUS_ACTIVE_DATASET,
  )}] ?? ""`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const active = await win.webContents.executeJavaScript(activeExpression, true);
    if (active === "1") {
      meter.begin();
      while (Date.now() < deadline) {
        await sleep(10);
        const current = await win.webContents.executeJavaScript(activeExpression, true);
        if (current !== "1") return meter.finish();
      }
      break;
    }
    await sleep(10);
  }
  throw new Error("continuous renderer window did not expose a bounded main-duty interval");
}

const MAXIMUM_CONTINUOUS_PRESENTATION_GAP_MS = 2_000;
const MINIMUM_CONTINUOUS_BUDGET_SAMPLE_MS = 60_000;

function browserReferenceRasterSize(index: number): { width: number; height: number } {
  if (index === 0) return { width: 1280, height: 800 };
  if (index <= 3) return { width: 640, height: 480 };
  return { width: 320, height: 240 };
}

export async function runLiveSurfacesLab(opts: {
  root: string;
  registry: WindowRegistry;
  preloadPath: string;
  beforeExit: () => Promise<void>;
  readonly continuousSoakMs?: number;
  readonly helperCrashCount?: number;
  readonly sck?: LiveSurfaceSckLab;
}): Promise<void> {
  const { LIVE_SURFACE_FOUNDATION_SOAK_BUDGETS } = await import("@vibefield/live-surfaces/testing");
  const monitorUncaught: NodeJS.UncaughtExceptionListener = (error, origin) => {
    console.error(
      `LIVE_SURFACES_UNCAUGHT ${JSON.stringify({
        origin,
        message: error.message,
        stack: error.stack,
      })}`,
    );
  };
  // Electron's default uncaught-exception path is a native modal on macOS.
  // Observe it without changing that default so a headless lab failure remains
  // diagnosable instead of looking like a frozen frame deadline.
  process.on("uncaughtExceptionMonitor", monitorUncaught);
  const authority = new LiveSurfaceFixtureRuntime();
  let tokenIndex = 0;
  const tickets = new LiveSurfaceTicketTable<LiveSurfaceRuntimeAuthority>({
    randomToken: () => {
      const ticket = LIVE_SURFACE_LAB_ALL_TICKETS[tokenIndex];
      tokenIndex += 1;
      if (ticket === undefined) throw new Error("the Browser lab exhausted its ticket tokens");
      return ticket.token;
    },
  });
  const win = createMainWindow({
    mode: "live-surfaces-lab",
    preloadPath: opts.preloadPath,
    show: process.env["VF_LIVE_SURFACES_LAB_HEADLESS"] !== "1",
  });
  opts.registry.adopt(win);
  const textureForwarders: LiveSurfaceTextureForwarder[] = [];
  const importDurations = new LiveSurfaceImportDurationHistogram();
  const mainDutyMeter = new LiveSurfaceMainDutyMeter();
  const host = new LiveSurfaceWindowHost(
    win,
    tickets,
    () => new MessageChannelMain(),
    undefined,
    (surfaceId, attachmentId, budget) => {
      const transferApi = createElectronLiveSurfaceTextureTransferApi(win.webContents);
      const measuredTransferApi: LiveSurfaceTextureTransferApi = {
        importTexture: (textureInfo, allReferencesReleased) => {
          const startedAt = process.hrtime.bigint();
          try {
            return transferApi.importTexture(textureInfo, allReferencesReleased);
          } finally {
            importDurations.observe(process.hrtime.bigint() - startedAt);
          }
        },
        sendTexture: (imported, envelope) => {
          const startedAt = process.hrtime.bigint();
          try {
            return transferApi.sendTexture(imported, envelope);
          } finally {
            mainDutyMeter.observeTextureSend((process.hrtime.bigint() - startedAt) / 1_000n);
          }
        },
      };
      const forwarder = new LiveSurfaceTextureForwarder(
        surfaceId,
        attachmentId,
        measuredTransferApi,
        2,
        budget,
      );
      textureForwarders.push(forwarder);
      return forwarder;
    },
  ).install();
  const native = new ElectronBrowserSurfaceNative();
  const controlTargets = new BrowserControlTargetRegistry({
    resolveTarget: (targetId) => webContents.fromDevToolsTargetId(targetId),
  });
  const browserRuntimes: BrowserLiveSurfaceRuntime[] = [];
  let fallbackRuntime: BrowserLiveSurfaceRuntime | null = null;
  const sckFixtures: LiveSurfaceSckFixture[] = [];
  const sckRuntimes: Array<SckLiveSurfaceRuntime | IosSimulatorLiveSurfaceRuntime> = [];
  const sckSources: MacosCaptureSource[] = [];
  const sckKinds: Array<"fixture" | "simulator"> = [];
  let sckSupervisor: MacosCaptureHelperSupervisor | null = null;
  let helperHarness: LiveSurfaceHelperProcessHarness | null = null;
  let simulatorRuntime: IosSimulatorLiveSurfaceRuntime | null = null;
  let simulatorResolution: ResolvedIosSimulatorCapture | null = null;
  let simulatorRotation: LiveSurfaceSimulatorRotationProof | null = null;
  let clockCalibration: {
    readonly roundTripMs: number;
    readonly uncertaintyMs: number;
  } | null = null;
  let pageServer: Awaited<ReturnType<typeof startLiveSurfacePageServer>> | null = null;
  let exitCode = 2;
  let verdict: Record<string, unknown> = { ok: false };
  try {
    const helperCrashCount = opts.helperCrashCount ?? 0;
    if (!Number.isSafeInteger(helperCrashCount) || helperCrashCount < 0 || helperCrashCount > 2) {
      throw new Error("the helper crash count must be an integer from zero through two");
    }
    if (helperCrashCount > 0 && (opts.sck === undefined || opts.continuousSoakMs === undefined)) {
      throw new Error("active helper crash recovery requires SCK and a continuous soak");
    }
    pageServer = await startLiveSurfacePageServer();
    for (const [index, surfaceId] of LIVE_SURFACE_LAB_BROWSER_SURFACE_IDS.entries()) {
      const logicalViewport =
        opts.continuousSoakMs === undefined
          ? { width: 320, height: 180 }
          : browserReferenceRasterSize(index);
      browserRuntimes.push(
        new BrowserLiveSurfaceRuntime({
          surfaceId,
          source: {
            kind: "browser",
            initialUrl: `${pageServer.origin}/surface/${index + 1}`,
            profile: { mode: "memory", ref: "live-surfaces-browser-lab" },
            logicalViewport,
            deviceScaleFactor: 1,
          },
          native,
          controlTargets,
          onPaintCallbackDurationUs: (durationUs) => mainDutyMeter.observePaint(durationUs),
        }),
      );
    }
    fallbackRuntime = new BrowserLiveSurfaceRuntime({
      surfaceId: LIVE_SURFACE_LAB_FALLBACK_SURFACE_ID,
      source: {
        kind: "browser",
        initialUrl: `${pageServer.origin}/surface/fallback`,
        profile: { mode: "memory", ref: "live-surfaces-browser-fallback-lab" },
        logicalViewport: { width: 320, height: 180 },
        deviceScaleFactor: 1,
      },
      native,
      controlTargets,
      requestSharedTexture: false,
      onPaintCallbackDurationUs: (durationUs) => mainDutyMeter.observePaint(durationUs),
    });
    if (opts.sck !== undefined) {
      const captureAdapter = loadMacosCaptureNativeAdapter(opts.sck.adapterPath);
      helperHarness = new LiveSurfaceHelperProcessHarness();
      sckSupervisor = new MacosCaptureHelperSupervisor({
        helperPath: opts.sck.helperPath,
        adapter: captureAdapter,
        spawnHelper: helperHarness.spawnHelper,
        onDiagnostic: (message) => console.error(`LIVE_SURFACES_SCK_HELPER ${message}`),
      });
      const fixtureCount =
        opts.sck.kind === "fixture"
          ? opts.sck.sessionCount
          : opts.sck.kind === "mixed"
            ? opts.sck.fixtureCount
            : 0;
      if (fixtureCount > LIVE_SURFACE_LAB_SCK_SURFACE_IDS.length) {
        throw new Error("the SCK lab requested too many fixture sessions");
      }
      const fixturePath = opts.sck.kind === "simulator" ? null : opts.sck.fixturePath;
      for (let index = 0; index < fixtureCount; index += 1) {
        if (fixturePath === null) throw new Error("fixture sessions require a fixture executable");
        const fixture = await startLiveSurfaceSckFixture(fixturePath);
        sckFixtures.push(fixture);
      }
      const fixtureSources = await findSckFixtureSources(sckSupervisor, sckFixtures);
      for (const [index, source] of fixtureSources.entries()) {
        sckSources.push(source);
        sckKinds.push("fixture");
        sckRuntimes.push(
          new SckLiveSurfaceRuntime({
            surfaceId: LIVE_SURFACE_LAB_SCK_SURFACE_IDS[index]!,
            source: {
              kind: "sck-window",
              sourceRef: source.sourceRef,
              crop: { mode: "none" },
              captureCursor: false,
            },
            client: sckSupervisor,
            onFrameCallbackDurationUs: (durationUs) => mainDutyMeter.observeCapture(durationUs),
          }),
        );
      }
      if (opts.sck.kind === "simulator" || opts.sck.kind === "mixed") {
        const simulatorIndex = sckRuntimes.length;
        if (simulatorIndex >= LIVE_SURFACE_LAB_SCK_SURFACE_IDS.length) {
          throw new Error("the mixed SCK lab exceeded its four-session bound");
        }
        const simulatorSource = {
          kind: "ios-simulator" as const,
          udid: opts.sck.udid,
          crop: { mode: "auto" as const },
        };
        const resolver = new IosSimulatorSourceResolver({
          devices: new SimctlDeviceCatalog({
            ...(opts.sck.developerDir === undefined ? {} : { developerDir: opts.sck.developerDir }),
          }),
          windows: sckSupervisor,
          viewport: captureAdapter,
        });
        simulatorResolution = await resolver.resolve(simulatorSource);
        sckSources.push(simulatorResolution.window);
        sckKinds.push("simulator");
        if (opts.sck.requireInactiveSpace && simulatorResolution.window.onScreen) {
          throw new Error("Simulator window must begin the cross-Space lab off the active Space");
        }
        simulatorRuntime = new IosSimulatorLiveSurfaceRuntime({
          surfaceId: LIVE_SURFACE_LAB_SCK_SURFACE_IDS[simulatorIndex]!,
          source: simulatorSource,
          resolver,
          delegate: sckSupervisor,
          revalidateIntervalMs: 250,
          onFrameCallbackDurationUs: (durationUs) => mainDutyMeter.observeCapture(durationUs),
        });
        sckRuntimes.push(simulatorRuntime);
      }
    }
    const sckQuery =
      sckRuntimes.length === 0 || opts.sck === undefined
        ? ""
        : `&sck=${opts.sck.kind}&sckModes=${sckKinds.join(",")}${
            (opts.sck.kind === "simulator" || opts.sck.kind === "mixed") && opts.sck.rotate
              ? "&rotate=1"
              : ""
          }${opts.helperCrashCount === undefined ? "" : `&helperCrashes=${opts.helperCrashCount}`}`;
    const soakQuery = opts.continuousSoakMs === undefined ? "" : `&soakMs=${opts.continuousSoakMs}`;
    await win.loadURL(
      `${APP_ORIGIN}/spike-live-surfaces-lab.html?phase=reload${sckQuery}${soakQuery}`,
    );
    const reloadFromGeneration = host.rendererGeneration;
    const reloadTicket = host.issue({
      surfaceId: browserRuntimes[0]!.surfaceId,
      sourceKind: "browser",
      operations: ["view"],
      principalId: "live-surfaces-foundation-reload-lab",
      authority: browserRuntimes[0]!,
    });
    if (reloadTicket.token !== LIVE_SURFACE_LAB_RELOAD_TICKET.token) {
      throw new Error("test-only reload ticket did not match its renderer rendezvous");
    }
    await win.webContents.executeJavaScript(
      `document.documentElement.dataset[${JSON.stringify(
        LIVE_SURFACE_LAB_TICKET_READY_DATASET,
      )}] = "1"`,
      true,
    );
    const reloadReadyDeadline = Date.now() + 15_000;
    let reloadReady = false;
    while (!reloadReady && Date.now() < reloadReadyDeadline) {
      reloadReady =
        (await win.webContents.executeJavaScript(
          `document.documentElement.dataset[${JSON.stringify(
            LIVE_SURFACE_LAB_RELOAD_READY_DATASET,
          )}] === "1"`,
          true,
        )) === true;
      if (!reloadReady) await sleep(10);
    }
    if (!reloadReady) throw new Error("renderer never held a frame for the reload probe");
    win.webContents.reload();
    const reloadDeadline = Date.now() + 20_000;
    while (host.rendererGeneration <= reloadFromGeneration && Date.now() < reloadDeadline) {
      await sleep(10);
    }
    if (host.rendererGeneration <= reloadFromGeneration) {
      throw new Error("renderer reload did not finish within 20s");
    }
    await host.whenDrained();
    const reloadForwarders = textureForwarders.filter(
      (forwarder) => forwarder.surfaceId === browserRuntimes[0]!.surfaceId,
    );
    const reloadDrain = {
      forwarders: reloadForwarders.length,
      outstanding: reloadForwarders.reduce(
        (total, forwarder) => total + forwarder.stats.outstanding,
        0,
      ),
      timedOut: reloadForwarders.reduce((total, forwarder) => total + forwarder.stats.timedOut, 0),
      completed: reloadForwarders.reduce(
        (total, forwarder) => total + forwarder.stats.completed,
        0,
      ),
    };
    if (opts.continuousSoakMs !== undefined) {
      const hostBeforeUs = process.hrtime.bigint() / 1_000n;
      const rendererNowMs = await win.webContents.executeJavaScript("performance.now()", true);
      const hostAfterUs = process.hrtime.bigint() / 1_000n;
      if (typeof rendererNowMs !== "number" || !Number.isFinite(rendererNowMs)) {
        throw new Error("renderer did not return a finite monotonic clock sample");
      }
      const hostMidpointUs = (hostBeforeUs + hostAfterUs) / 2n;
      const hostClockOffsetUs = hostMidpointUs - BigInt(Math.round(rendererNowMs * 1_000));
      const roundTripUs = hostAfterUs - hostBeforeUs;
      const uncertaintyUs = (roundTripUs + 1n) / 2n;
      clockCalibration = {
        roundTripMs: Number(roundTripUs) / 1_000,
        uncertaintyMs: Number(uncertaintyUs) / 1_000,
      };
      await win.webContents.executeJavaScript(
        `document.documentElement.dataset[${JSON.stringify(
          LIVE_SURFACE_LAB_CLOCK_OFFSET_DATASET,
        )}] = ${JSON.stringify(hostClockOffsetUs.toString())}; document.documentElement.dataset[${JSON.stringify(
          LIVE_SURFACE_LAB_CLOCK_UNCERTAINTY_DATASET,
        )}] = ${JSON.stringify(uncertaintyUs.toString())}`,
        true,
      );
    }
    const authorities: LiveSurfaceRuntimeAuthority[] = [
      authority,
      ...browserRuntimes,
      fallbackRuntime,
      ...sckRuntimes,
    ];
    const sckKindByRuntime = new Map<LiveSurfaceRuntimeAuthority, "fixture" | "simulator">(
      sckRuntimes.map((runtime, index) => [runtime, sckKinds[index]!] as const),
    );
    for (const [index, runtime] of authorities.entries()) {
      const sckKind = sckKindByRuntime.get(runtime);
      const ticket = host.issue({
        surfaceId: runtime.surfaceId,
        // Native source identity remains main-private. Every token is still
        // one-use and generation-bound regardless of the source specialization.
        sourceKind: sckKind === "simulator" ? "ios-simulator" : sckKind ? "sck-window" : "browser",
        operations:
          index === 0
            ? ["view"]
            : sckKind !== undefined
              ? ["view", "crop"]
              : ["view", "pointer", "keyboard"],
        principalId: "live-surfaces-foundation-lab",
        authority: runtime,
      });
      if (ticket.token !== LIVE_SURFACE_LAB_TICKETS[index]?.token) {
        throw new Error(`test-only ticket ${index} did not match its renderer rendezvous`);
      }
    }
    await win.webContents.executeJavaScript(
      `document.documentElement.dataset[${JSON.stringify(
        LIVE_SURFACE_LAB_TICKET_READY_DATASET,
      )}] = "1"`,
      true,
    );

    const browserInputProof = proveLiveSurfaceBrowserInput(browserRuntimes[0]!, controlTargets);
    const simulatorRotationProof =
      (opts.sck?.kind === "simulator" || opts.sck?.kind === "mixed") &&
      opts.sck.rotate &&
      simulatorRuntime !== null
        ? proveSimulatorRotation(simulatorRuntime)
        : Promise.resolve(null);
    const mainCpuStartedAt = process.cpuUsage();
    const mainDutyStartedAt = process.hrtime.bigint();
    const mainSurfaceDutyPromise =
      opts.continuousSoakMs === undefined
        ? Promise.resolve(null)
        : measureLiveSurfaceMainDuty(win, mainDutyMeter, 90_000 + opts.continuousSoakMs);
    const helperCrashProofPromise =
      helperCrashCount === 0 || sckSupervisor === null || helperHarness === null
        ? Promise.resolve<LiveSurfaceHelperCrashProof>({
            requested: helperCrashCount,
            completed: 0,
            helperExits: 0,
            helperLeasesReleasedByTeardown: 0,
          })
        : driveLiveSurfaceHelperCrashes(
            win,
            sckSupervisor,
            helperHarness,
            helperCrashCount,
            90_000 + (opts.continuousSoakMs ?? 0),
          );
    const [renderer, helperCrashProof] = await Promise.all([
      waitForLiveSurfaceLabResult(win, 90_000 + (opts.continuousSoakMs ?? 0)),
      helperCrashProofPromise,
    ]);
    const mainSurfaceDuty = await mainSurfaceDutyPromise;
    const mainCpu = process.cpuUsage(mainCpuStartedAt);
    const mainDutyElapsedMs = Number(process.hrtime.bigint() - mainDutyStartedAt) / 1_000_000;
    const mainCpuMs = (mainCpu.user + mainCpu.system) / 1_000;
    const mainProcessCpu = {
      elapsedMs: Math.round(mainDutyElapsedMs),
      cpuMs: Math.round(mainCpuMs),
      ratio:
        mainDutyElapsedMs === 0
          ? 0
          : Math.round((mainCpuMs / mainDutyElapsedMs) * 100_000) / 100_000,
    };
    const browserInput = await browserInputProof;
    simulatorRotation = await simulatorRotationProof;
    const offeredAtRendererDone = authority.stats.offered;
    const referenceDeadline = Date.now() + 3_000;
    while (
      Date.now() < referenceDeadline &&
      (browserRuntimes.some(
        (runtime) => runtime.stats.importedReferencesReleased !== runtime.stats.sharedFramesOffered,
      ) ||
        textureForwarders.some((forwarder) => forwarder.stats.outstanding !== 0))
    ) {
      await sleep(25);
    }
    await sleep(250);
    const source = authority.stats;
    const problems: string[] = [];
    const textureTransfers = {
      forwarders: textureForwarders.length,
      outstanding: textureForwarders.reduce(
        (total, forwarder) => total + forwarder.stats.outstanding,
        0,
      ),
      peakOutstandingPerSurface: textureForwarders.reduce(
        (peak, forwarder) => Math.max(peak, forwarder.stats.peakOutstanding),
        0,
      ),
      timedOut: textureForwarders.reduce((total, forwarder) => total + forwarder.stats.timedOut, 0),
      sendFailures: textureForwarders.reduce(
        (total, forwarder) => total + forwarder.stats.sendFailures,
        0,
      ),
      releaseFaults: textureForwarders.reduce(
        (total, forwarder) => total + forwarder.stats.releaseFaults,
        0,
      ),
      importDuration: importDurations.snapshot(),
    };
    const primaryCpuPixelConversions = browserRuntimes.reduce(
      (total, runtime) => total + runtime.stats.cpuFramesOffered,
      0,
    );
    let sckEvidence: Record<string, unknown> | null = null;
    if (!renderer.ok) problems.push(renderer.error ?? "renderer returned a failed verdict");
    if (!renderer.rendererReloadObserved)
      problems.push("renderer did not observe its reload phase");
    if (
      reloadDrain.forwarders !== 1 ||
      reloadDrain.outstanding !== 0 ||
      reloadDrain.completed + reloadDrain.timedOut < 1
    ) {
      problems.push(
        `renderer reload did not reconcile its held texture within the bounded drain: ${JSON.stringify(reloadDrain)}`,
      );
    }
    if (source.attachments !== 1) problems.push(`source attached ${source.attachments} times`);
    if (source.demandUpdates < 2) problems.push("source did not receive live and paused demand");
    if (source.offered < 12) problems.push(`source offered only ${source.offered} frames`);
    if (source.accepted !== source.offered) {
      problems.push(`${source.offered - source.accepted} CPU frame(s) were refused by the host`);
    }
    if (source.offered !== offeredAtRendererDone) {
      problems.push("the fixture kept producing after paused demand");
    }
    if (textureTransfers.outstanding !== 0) {
      problems.push(`${textureTransfers.outstanding} shared texture transfer(s) survived drain`);
    }
    if (
      textureTransfers.peakOutstandingPerSurface >
      LIVE_SURFACE_FOUNDATION_SOAK_BUDGETS.mainOutstandingTransfersPerSurfaceMax
    ) {
      problems.push(
        `one surface reached ${textureTransfers.peakOutstandingPerSurface} outstanding transfers`,
      );
    }
    if (textureTransfers.sendFailures !== 0 || textureTransfers.releaseFaults !== 0) {
      problems.push("shared texture transfer faults occurred during the lab");
    }
    if (primaryCpuPixelConversions !== 0) {
      problems.push("a primary Browser source emitted CPU pixels");
    }
    if (opts.continuousSoakMs === undefined) {
      if (renderer.continuousSoak !== null) {
        problems.push("the renderer ran an unrequested continuous soak");
      }
    } else {
      const soak = renderer.continuousSoak;
      if (
        soak === null ||
        soak.requestedDurationMs !== opts.continuousSoakMs ||
        soak.elapsedMs < opts.continuousSoakMs ||
        soak.browserPresented.length !== 10 ||
        soak.browserPresented.some((count) => count <= 0) ||
        soak.browserMaximumPresentationGapMs.length !== 10 ||
        soak.browserMaximumPresentationGapMs.some(
          (gapMs) => gapMs > MAXIMUM_CONTINUOUS_PRESENTATION_GAP_MS,
        ) ||
        (opts.sck !== undefined &&
          (soak.sckPresented <= 0 ||
            soak.sckPresentedPerSurface.length !== sckRuntimes.length ||
            soak.sckPresentedPerSurface.some((count) => count <= 0) ||
            soak.sckMaximumPresentationGapMs === null ||
            soak.sckMaximumPresentationGapMs > MAXIMUM_CONTINUOUS_PRESENTATION_GAP_MS ||
            soak.sckMaximumPresentationGapMsPerSurface.length !== sckRuntimes.length ||
            soak.sckMaximumPresentationGapMsPerSurface.some(
              (gapMs) => gapMs > MAXIMUM_CONTINUOUS_PRESENTATION_GAP_MS,
            ))) ||
        soak.activeFrameAgeSamples.length !== 10 + sckRuntimes.length ||
        soak.activeFrameAgeSamples.some((count) => count <= 0) ||
        soak.activeRasterSizes.length !== 10 + sckRuntimes.length ||
        soak.activeRasterSizes.slice(0, 10).some((size, index) => {
          const expected = browserReferenceRasterSize(index);
          return size?.width !== expected.width || size.height !== expected.height;
        }) ||
        soak.rendererPendingPerSurfaceMax >
          LIVE_SURFACE_FOUNDATION_SOAK_BUDGETS.rendererPendingPerSurfaceMax ||
        soak.rendererInFlightPerSurfaceMax >
          LIVE_SURFACE_FOUNDATION_SOAK_BUDGETS.rendererInFlightPerSurfaceMax ||
        mainSurfaceDuty === null ||
        mainSurfaceDuty.paintCallbacks <= 0 ||
        (opts.sck !== undefined && mainSurfaceDuty.captureCallbacks <= 0) ||
        mainSurfaceDuty.textureSends <= 0 ||
        clockCalibration === null ||
        clockCalibration.uncertaintyMs > 5 ||
        soak.activeDeviceRecoveries !== (opts.continuousSoakMs >= 30_000 ? 2 : 1) ||
        soak.helperCrashRequests !== helperCrashCount ||
        soak.sckDemandChanges !== (sckRuntimes.length > 0 ? 2 : 0) ||
        helperCrashProof.requested !== helperCrashCount ||
        helperCrashProof.completed !== helperCrashCount
      ) {
        problems.push("the continuous renderer workload did not remain live and bounded");
      }
      if (opts.continuousSoakMs >= MINIMUM_CONTINUOUS_BUDGET_SAMPLE_MS) {
        if (
          soak !== null &&
          soak.worstActiveFrameAgeP95Ms >
            LIVE_SURFACE_FOUNDATION_SOAK_BUDGETS.worstActiveFrameAgeP95Ms
        ) {
          problems.push(`active frame-age p95 exceeded 50ms: ${soak.worstActiveFrameAgeP95Ms}`);
        }
        if (
          mainSurfaceDuty !== null &&
          mainSurfaceDuty.ratio > LIVE_SURFACE_FOUNDATION_SOAK_BUDGETS.electronMainDutyRatioMax
        ) {
          problems.push(`Electron main duty exceeded 10%: ${mainSurfaceDuty.ratio}`);
        }
        const imports = textureTransfers.importDuration;
        if (
          imports.p95Ms === null ||
          imports.p95Overflow ||
          imports.p95Ms > LIVE_SURFACE_FOUNDATION_SOAK_BUDGETS.sharedTextureImportP95Ms
        ) {
          problems.push(`shared texture import p95 exceeded 0.30ms: ${imports.p95Ms}`);
        }
      }
    }
    if (sckRuntimes.length > 0 && sckSupervisor !== null) {
      const reconciliationDeadline = Date.now() + 5_000;
      while (Date.now() < reconciliationDeadline) {
        const helperStats = sckSupervisor.stats;
        if (
          helperStats.activeSessions === 0 &&
          helperStats.helperLeasesOutstanding === 0 &&
          helperStats.native?.outstanding === 0 &&
          sckRuntimes.every(
            (runtime) =>
              runtime.stats.framesReceived === runtime.stats.localReferencesReleased &&
              runtime.stats.framesReceived ===
                runtime.stats.helperLeasesReleased + runtime.stats.helperLeasesQuarantined,
          )
        ) {
          break;
        }
        await sleep(25);
      }
      const helperStats = sckSupervisor.stats;
      const sckKind = opts.sck?.kind ?? "fixture";
      const simulatorLab =
        opts.sck?.kind === "simulator" || opts.sck?.kind === "mixed" ? opts.sck : null;
      sckEvidence = {
        kind: sckKind,
        sources: sckSources.map((source, index) => ({
          kind: sckKinds[index],
          applicationName: source.applicationName,
          title: source.title,
          ownerPid: source.ownerPid,
          onScreen: source.onScreen,
          logicalSize:
            sckKinds[index] === "simulator" && simulatorResolution !== null
              ? simulatorResolution.geometry.logicalSize
              : { width: source.frame.width, height: source.frame.height },
        })),
        simulator:
          simulatorResolution === null
            ? null
            : {
                device: simulatorResolution.device,
                resolvedSource: simulatorResolution.source,
                resolvedGeometry: simulatorResolution.geometry,
                rotation: simulatorRotation,
              },
        runtimes: sckRuntimes.map((runtime, index) => ({
          kind: sckKinds[index],
          summary: runtime.summary,
          stats: runtime.stats,
        })),
        helperCrash: helperCrashProof,
        helper: helperStats,
      };
      if (
        !renderer.sckEnabled ||
        renderer.sckMode !== sckKind ||
        renderer.sckSurfaceCount !== sckRuntimes.length ||
        renderer.sckModes.length !== sckKinds.length ||
        renderer.sckModes.some((kind, index) => kind !== sckKinds[index]) ||
        renderer.sckPresentedPerSurface.length !== sckRuntimes.length ||
        renderer.sckPresentedPerSurface.some((count) => count < 3) ||
        renderer.sckTransport !== "shared-texture" ||
        renderer.sckPixelFormat !== "bgra" ||
        (sckKinds.includes("fixture") &&
          (!renderer.sckExact ||
            renderer.sckRedPureRatio !== 1 ||
            renderer.sckBluePureRatio !== 1)) ||
        (simulatorLab?.rotate === true && !renderer.sckRebound)
      ) {
        problems.push(
          sckKinds.every((kind) => kind === "fixture")
            ? "the renderer did not prove exact SCK BGRA stripes"
            : "the renderer did not present every SCK/Simulator viewport",
        );
      }
      for (const [index, runtime] of sckRuntimes.entries()) {
        const stats = runtime.stats;
        const summary = runtime.summary;
        const rotationRestarts = sckKinds[index] === "simulator" && simulatorLab?.rotate ? 1 : 0;
        const minimumRestarts = helperCrashCount + rotationRestarts;
        if (
          summary.state !== "hibernated" ||
          summary.transport !== "shared-texture" ||
          stats.sessionsStarted < minimumRestarts + 1 ||
          stats.sessionRestarts < minimumRestarts ||
          stats.framesReceived < 3
        ) {
          problems.push(`${runtime.surfaceId} did not complete its recovered SCK session(s)`);
        }
        if (
          stats.framesReceived !== stats.localReferencesReleased ||
          stats.framesReceived !== stats.helperLeasesReleased ||
          stats.helperLeasesQuarantined !== 0
        ) {
          problems.push(`${runtime.surfaceId} did not reconcile every local/helper frame lease`);
        }
      }
      if (
        simulatorLab !== null &&
        (simulatorResolution === null ||
          simulatorResolution.geometry.cropState !== "applied" ||
          simulatorRuntime?.summary.geometry?.cropState !== "applied" ||
          (simulatorLab.rotate && simulatorRotation === null))
      ) {
        problems.push("the Simulator runtime did not preserve proven cropped geometry");
      }
      const totalRuntimeFrames = sckRuntimes.reduce(
        (total, runtime) => total + runtime.stats.framesReceived,
        0,
      );
      const totalSessionsStarted = sckRuntimes.reduce(
        (total, runtime) => total + runtime.stats.sessionsStarted,
        0,
      );
      const staleSessionFrames = helperStats.framesReceived - totalRuntimeFrames;
      const helperFrameAccounting =
        staleSessionFrames >= 0 &&
        staleSessionFrames === helperStats.framesRejected &&
        helperStats.framesRejected <= totalSessionsStarted * 2;
      if (
        helperStats.activeSessions !== 0 ||
        helperStats.helperLeasesOutstanding !== 0 ||
        helperStats.helperLeasesPeakPerSession >
          LIVE_SURFACE_FOUNDATION_SOAK_BUDGETS.helperOutstandingLeasesPerSessionMax ||
        helperStats.nativeOutstandingPeak >
          LIVE_SURFACE_FOUNDATION_SOAK_BUDGETS.helperOutstandingLeasesPerSessionMax *
            sckRuntimes.length ||
        !helperFrameAccounting ||
        helperStats.releaseCommands + helperStats.helperLeasesReleasedByTeardown !==
          helperStats.framesReceived ||
        helperStats.helperStarts !== helperCrashCount + 1 ||
        helperStats.helperExits !== helperCrashCount ||
        helperStats.helperLeasesReleasedByTeardown < helperCrashCount * sckRuntimes.length ||
        helperCrashProof.helperExits !== helperCrashCount ||
        helperCrashProof.helperLeasesReleasedByTeardown < helperCrashCount * sckRuntimes.length ||
        helperStats.native === null ||
        helperStats.native.accepted !==
          helperStats.framesReceived + helperStats.nativeReferencesReleasedByTeardown ||
        helperStats.native.outstanding !== 0 ||
        helperStats.native.rejectedIdentity !== 0 ||
        helperStats.native.rejectedCapability !== 0 ||
        helperStats.native.rejectedProtocol !== 0
      ) {
        problems.push("the SCK helper/native ownership counters did not reconcile");
      }
    } else if (opts.sck !== undefined) {
      problems.push("the requested SCK lab did not create its capture runtime");
    } else if (renderer.sckEnabled) {
      problems.push("the renderer enabled SCK without a main-process capture authority");
    }
    for (const [index, runtime] of browserRuntimes.entries()) {
      const stats = runtime.stats;
      const summary = runtime.summary;
      const control = controlTargets.status(runtime.surfaceId);
      const expectedStarts = index === 0 ? 2 : 1;
      if (stats.producersStarted !== expectedStarts) {
        problems.push(`${runtime.surfaceId} started ${stats.producersStarted} producers`);
      }
      if (stats.texturePaints < 3 || stats.sharedFramesAccepted < 3) {
        problems.push(`${runtime.surfaceId} did not deliver enough shared Browser frames`);
      }
      if (stats.producerTextureReleases !== stats.texturePaints) {
        problems.push(`${runtime.surfaceId} leaked an Electron OSR texture wrapper`);
      }
      if (stats.importedReferencesReleased !== stats.sharedFramesOffered) {
        problems.push(`${runtime.surfaceId} retained imported renderer references`);
      }
      if (summary.state !== "hibernated" || summary.transport !== "shared-texture") {
        problems.push(`${runtime.surfaceId} did not end as hibernated shared transport`);
      }
      if (control.bound || control.controlBindingRevision < 2) {
        problems.push(`${runtime.surfaceId} did not bind and revoke its private control target`);
      }
    }
    if (fallbackRuntime === null) {
      problems.push("the explicit Browser fallback runtime was not created");
    } else {
      const stats = fallbackRuntime.stats;
      const summary = fallbackRuntime.summary;
      const control = controlTargets.status(fallbackRuntime.surfaceId);
      if (stats.cpuPaints < 3 || stats.cpuFramesAccepted < 3) {
        problems.push("the Browser CPU fallback did not deliver enough observed frames");
      }
      if (
        summary.state !== "hibernated" ||
        summary.transport !== "cpu-bgra" ||
        summary.error?.code !== "transport-degraded"
      ) {
        problems.push("the Browser CPU fallback was not explicit in its final summary");
      }
      if (control.bound || control.controlBindingRevision < 2) {
        problems.push("the Browser CPU fallback did not bind and revoke its control target");
      }
    }
    if (tickets.size !== 0) problems.push("one or more one-use presentation tickets survived");
    const supportSources: LiveSurfaceRuntimeSupportSource[] = [
      ...browserRuntimes,
      ...(fallbackRuntime === null ? [] : [fallbackRuntime]),
      ...sckRuntimes,
    ];
    verdict = {
      ok: problems.length === 0,
      renderer,
      source,
      browserSources: browserRuntimes.map((runtime) => ({
        surfaceId: runtime.surfaceId,
        summary: runtime.summary,
        stats: runtime.stats,
        control: controlTargets.status(runtime.surfaceId),
      })),
      browserFallback:
        fallbackRuntime === null
          ? null
          : {
              summary: fallbackRuntime.summary,
              stats: fallbackRuntime.stats,
              control: controlTargets.status(fallbackRuntime.surfaceId),
            },
      browserInput,
      sck: sckEvidence,
      reloadDrain,
      hardening: {
        continuousSoakRequestedMs: opts.continuousSoakMs ?? null,
        clockCalibration,
        mainSurfaceDuty,
        mainProcessCpu,
        textureTransfers,
        helperOutstandingLeasesPeakPerSession: sckSupervisor?.stats.helperLeasesPeakPerSession ?? 0,
        helperCrash: helperCrashProof,
        primaryCpuPixelConversions,
        worstActiveFrameAgeP95Ms: renderer.continuousSoak?.worstActiveFrameAgeP95Ms ?? null,
      },
      runtimeSupport: aggregateLiveSurfaceRuntimeSupport(supportSources),
      rendererGeneration: host.rendererGeneration,
      ticketTableSize: tickets.size,
      ...(problems.length === 0 ? {} : { problems }),
    };
    exitCode = problems.length === 0 ? 0 : 2;
  } catch (error) {
    verdict = {
      ok: false,
      reason: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      source: authority.stats,
      browserSources: browserRuntimes.map((runtime) => ({
        surfaceId: runtime.surfaceId,
        summary: runtime.summary,
        stats: runtime.stats,
      })),
      textureForwarders: textureForwarders.map((forwarder) => ({
        surfaceId: forwarder.surfaceId,
        attachmentId: forwarder.attachmentId,
        stats: forwarder.stats,
      })),
      sck:
        sckRuntimes.length === 0 || sckSupervisor === null
          ? null
          : {
              runtimes: sckRuntimes.map((runtime, index) => ({
                kind: sckKinds[index],
                summary: runtime.summary,
                stats: runtime.stats,
              })),
              helper: sckSupervisor.stats,
            },
      rendererGeneration: host.rendererGeneration,
    };
  } finally {
    process.off("uncaughtExceptionMonitor", monitorUncaught);
    host.dispose();
    for (const runtime of browserRuntimes) runtime.dispose();
    fallbackRuntime?.dispose();
    for (const runtime of sckRuntimes) runtime.dispose();
    await sckSupervisor?.dispose().catch(() => undefined);
    for (const fixture of sckFixtures) await fixture.dispose().catch(() => undefined);
    controlTargets.clear();
    await pageServer?.close().catch(() => undefined);
    if (!win.isDestroyed()) win.destroy();
    console.log(`LIVE_SURFACES_LAB ${JSON.stringify(verdict)}`);
    await opts.beforeExit();
    if (!process.env["FIELDD_DATA_DIR"]) rmSync(opts.root, { recursive: true, force: true });
    app.exit(exitCode);
  }
}

/** B1 spike: load the spike page over file:// in a sandboxed window and report
 * the renderer's own verdict. No daemons involved. Built only when the spike
 * entry is requested (VITE_SPIKE=1) — never part of the production renderer. */
export async function runSpikeLoro(opts: {
  root: string;
  beforeExit: () => Promise<void>;
}): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    // dist/testing → dist/renderer: the shell's own renderer output (ESR 3a)
    await win.loadFile(join(__dirname, "..", "renderer", "spike-loro.html"));
    const raw = await waitForConsole(win, "SPIKE_LORO ", 30_000);
    const result = JSON.parse(raw) as { ok: boolean };
    console.log(`SPIKE_LORO ${raw}`);
    await opts.beforeExit();
    if (!process.env["FIELDD_DATA_DIR"]) rmSync(opts.root, { recursive: true, force: true });
    app.exit(result.ok ? 0 : 2);
  } catch (e) {
    console.error(`SPIKE_LORO failed: ${e instanceof Error ? e.message : e}`);
    await opts.beforeExit();
    if (!process.env["FIELDD_DATA_DIR"]) rmSync(opts.root, { recursive: true, force: true });
    app.exit(2);
  }
}
