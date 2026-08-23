// THE PERF LAB — TP-S0c, §19.3's `--terminal-perf-lab`.
//
// vibefield-terminal-perf-lab-only
//
// A scenario is `fixture x layout x generator x duration`. This runs one in the
// REAL window — the production window factory, the real daemon pair against an
// isolated data root, panes born through the workspace's own doors — puts the
// TP-S0a sampler in `metrics` mode, and emits JSONL plus a markdown RESULTS.
//
// IT REUSES THE GODVIEW SMOKE'S DRIVING PATTERN AND NOT ITS ASSERTIONS. The
// smoke presses keys and checks rows; the lab presses the same keys and reads
// numbers. Where a helper here looks like one in `smoke.ts`, that is the point:
// a lab that drove the deck by some private door would be measuring a path no
// user takes. The two files stay separate because their FAILURE modes differ —
// a smoke row that cannot run is a red build, a lab arm that cannot run is a
// missing number in a report that still publishes what it did get.
//
// WHAT IT DOES NOT DO. It never asserts a budget. §18's numbers are hypotheses
// until this rig measures them (§18.1's note), so the lab publishes histograms
// and the normative budgets get written afterwards, from them. A lab that
// failed a run against a provisional number would be enforcing a guess.
//
// THE A/B DISCIPLINE (TC §9, §19.4). The host is always loaded. So: arms are
// INTERLEAVED inside one launch — same window, same panes, same daemon, same
// generator, only the sampler mode moving — the estimate is the MEDIAN across
// rotations, and a tail claim requires the null arm (an arm that changes
// nothing) to have moved less than the difference being claimed.

import { spawnSync } from "node:child_process";
import {
  type Dirent,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { cpus, loadavg, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import type { FielddHandle, FielddSupervisor } from "@vibefield/fieldd-supervisor";
import { buildLabReport, parseLabJsonl } from "@vibefield/terminal-perf/lab-report";
import { findStrays } from "@vibefield/terminal-perf/reap";
import { app, type BrowserWindow, contentTracing, screen } from "electron";
import type { WindowRegistry } from "../main/window-policy";
import { createMainWindow, loadRenderer } from "../main/windows";
import {
  type ElectronProcessSample,
  type ProcessResourceSample,
  sampleElectronProcesses,
  sampleProcessResources,
} from "./plugin-runtime-physical";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The echo fixture's JSONL, tolerant of the truncated last line a killed run
 * leaves. Deliberately not shared with `native-control.ts`'s parser: that one
 * runs in the driver, this one is bundled into the testing artifact, and one
 * five-line function is cheaper than a dependency between the two. */
function parseEchoJsonl(text: string): { kind: string; [key: string]: unknown }[] {
  const out: { kind: string; [key: string]: unknown }[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      out.push(JSON.parse(line) as { kind: string });
    } catch {
      /* truncated tail */
    }
  }
  return out;
}

// ---- the scenario table ------------------------------------------------------

/** What a layout asks of the deck, and whether the deck can give it today.
 *
 * `hostable: false` is a FIRST-CLASS result. §15 asks S0c for `multi-view` and
 * `wall-100`; the honest answer at S0c is that one of them has no host in the
 * product yet and the other has never been tried, and a rig that quietly
 * substituted something else would publish a number under the wrong name. */
export interface LayoutPlan {
  readonly panes: number;
  readonly viewsPerSession: number;
  readonly hostable: boolean;
  readonly why?: string;
}

export interface GeneratorPlan {
  /** Which panes carry load, by index. */
  readonly hotPanes: readonly number[];
  readonly kind: "none" | "flood" | "scroll-storm" | "resize-storm" | "focus-alternation";
  readonly shape?: "scroll" | "repaint" | "unicode";
  readonly bytesPerSecond?: number;
  /** wheel events/s for scroll, resizes/s for resize, focus swaps/s for focus. */
  readonly eventsPerSecond?: number;
}

export interface ScenarioPlan {
  readonly name: string;
  readonly layout: LayoutPlan;
  readonly generator: GeneratorPlan;
  readonly note: string;
  /** The scenario exists to FIND the ceiling, so hitting one is the result and
   * not a failed run. Without this, `wall-probe` — whose entire deliverable is
   * "the deck stopped at N" — would exit non-zero every time it worked. */
  readonly ceilingIsTheAnswer?: boolean;
}

const FLOOD_RATE = 8 * 1024 * 1024;

export const SCENARIOS: Readonly<Record<string, ScenarioPlan>> = {
  "single-pane": {
    name: "single-pane",
    layout: { panes: 1, viewsPerSession: 1, hostable: true },
    generator: { hotPanes: [], kind: "none" },
    note: "one pane, no generator — the idle floor the other scenarios are read against",
  },
  "deck-4": {
    name: "deck-4",
    layout: { panes: 4, viewsPerSession: 1, hostable: true },
    generator: { hotPanes: [0], kind: "flood", shape: "repaint", bytesPerSecond: 1024 * 1024 },
    note: "the shipping layout: four panes, one of them repainting — the deck a person uses",
  },
  flood: {
    name: "flood",
    layout: { panes: 1, viewsPerSession: 1, hostable: true },
    generator: { hotPanes: [0], kind: "flood", shape: "scroll", bytesPerSecond: FLOOD_RATE },
    note: "one pane taking a rate-controlled scrolling flood (§18.4)",
  },
  "flood-in-a-deck": {
    name: "flood-in-a-deck",
    layout: { panes: 4, viewsPerSession: 1, hostable: true },
    generator: { hotPanes: [0], kind: "flood", shape: "scroll", bytesPerSecond: FLOOD_RATE },
    note: "TP-R11's shape: one pane floods while three others must stay responsive",
  },
  "fan-out": {
    name: "fan-out",
    layout: { panes: 8, viewsPerSession: 1, hostable: true },
    generator: {
      hotPanes: [0, 1],
      kind: "flood",
      shape: "repaint",
      bytesPerSecond: 1024 * 1024,
    },
    note: "N sessions, K hot, all visible (§19.2) — the density case the deck can host today",
  },
  "scroll-storm": {
    name: "scroll-storm",
    layout: { panes: 4, viewsPerSession: 1, hostable: true },
    generator: { hotPanes: [0], kind: "scroll-storm", eventsPerSecond: 60 },
    note: "TP-D17/TP-R16: wheel events into the active pane, round-trip scroll",
  },
  "resize-storm": {
    name: "resize-storm",
    layout: { panes: 4, viewsPerSession: 1, hostable: true },
    generator: { hotPanes: [0], kind: "resize-storm", eventsPerSecond: 30 },
    note: "TP-D18/TP-R17: the window resized at the throttle rate a divider drag would hit",
  },
  "focus-alternation": {
    name: "focus-alternation",
    layout: { panes: 4, viewsPerSession: 1, hostable: true },
    generator: { hotPanes: [0, 1], kind: "focus-alternation", eventsPerSecond: 2 },
    note: "TP-R4/R9's shape at S0c's scale — focus moving between panes under load",
  },
  "echo-probe": {
    name: "echo-probe",
    layout: { panes: 1, viewsPerSession: 1, hostable: true },
    generator: { hotPanes: [], kind: "none" },
    note: "TP-D19's raw-mode echo fixture in one pane — the VibeField half of the native control",
  },
  "multi-view": {
    name: "multi-view",
    layout: {
      panes: 1,
      viewsPerSession: 4,
      hostable: false,
      why:
        "no product surface binds a SECOND view to a session at S0c. The pool's door exists " +
        "(`bindTerminalSessionView`, exported from `terminal/pool/index.ts`) and nothing outside " +
        "the pool calls it — the deck binds one view per pane and the mirror/thumbnail host is " +
        "TP-S2. The rig will not synthesise a view the product cannot make: that would publish a " +
        "multi-view number for a multi-view nobody can reach.",
    },
    generator: { hotPanes: [0], kind: "flood", shape: "repaint", bytesPerSecond: 1024 * 1024 },
    note: "1 session x {authority, fullscreen, mirror, thumbnail} — awaiting TP-S2",
  },
  "wall-100": {
    name: "wall-100",
    // HOSTABLE, corrected. The first version of this rig declared it unhostable
    // on the strength of a "the deck tops out at 11 panes" measurement that was
    // its own probe's bug (`focusDeck` read the FIRST `.terminal-input`, which
    // at density is legitimately 0x0 while every other pane is fine). With the
    // probe fixed the deck reached 64 panes three times out of three, so the
    // honest thing is to ask for a hundred and report what happens.
    //
    // Note what this is NOT: §19.2's thumbnail wall is 100 VIEWS of existing
    // sessions, and the deck makes one SESSION per pane — so this is a hundred
    // ptys and a hundred shells, which is a heavier fixture than TP-R12's and
    // will meet the fd ceiling before it meets a rendering one.
    layout: { panes: 100, viewsPerSession: 1, hostable: true },
    generator: { hotPanes: [0], kind: "flood", shape: "repaint", bytesPerSecond: 512 * 1024 },
    note: "100 panes = 100 sessions (NOT §19.2's 100 views of one) — the heavy form of the wall",
    ceilingIsTheAnswer: true,
  },
  "wall-probe": {
    name: "wall-probe",
    // 100, so the probe asks the same question `wall-100` does and differs only
    // in carrying no generator: how far does the deck split when nothing else
    // is competing for the machine.
    layout: { panes: 100, viewsPerSession: 1, hostable: true },
    generator: { hotPanes: [], kind: "none" },
    note: "split until it stops working and REPORT the ceiling — the honest answer to wall-100",
    ceilingIsTheAnswer: true,
  },
};

// ---- the renderer bridge, as main sees it -----------------------------------

interface LabProbeRecord {
  probeId: string;
  domKeydownMs: number;
  domKeydownWallMs: number;
  eventTimeStampMs: number;
  target: string;
  nextRafMs: number | null;
}

interface LabSnapshot {
  mode: string;
  sourceAttached: boolean;
  rendererBackend: string | null;
  framesRunning: boolean;
  samples: readonly Record<string, unknown>[];
  frames: readonly Record<string, unknown>[];
  probes: readonly LabProbeRecord[];
  counters: Record<string, number>;
  dropped: Record<string, number>;
  visibility: { state: string; focused: boolean; hiddenTransitions: number };
}

/** Call the renderer bridge. Every lab read goes through here so a page that
 * never installed the bridge fails with the reason rather than with
 * `undefined is not a function` fifty frames later. */
async function lab<T>(win: BrowserWindow, expression: string): Promise<T> {
  const wrapped = `(() => {
    const lab = window.__vfTerminalPerfLab;
    if (!lab) return { __labMissing: true };
    return { value: (${expression}) };
  })()`;
  const result = (await win.webContents.executeJavaScript(wrapped)) as
    | { __labMissing: true }
    | { value: T };
  if ("__labMissing" in result) {
    throw new Error(
      "the perf-lab renderer bridge is not installed — the renderer was not built with " +
        "`vite build --mode terminal-perf-lab` (run `pnpm perf:terminal` rather than electron directly)",
    );
  }
  return result.value;
}

/** One `GODVIEW_DECK` line, reduced to what the lab steers on. */
interface DeckFacts {
  active: boolean;
  panes: number;
  sessions: number;
  sessionIds: string[];
  rendererBackend: string;
  activeSessionId?: string;
  error?: string;
}

const consoleText = (arg: unknown): string => {
  if (typeof arg === "string") return arg;
  if (arg !== null && typeof arg === "object" && "message" in arg) {
    return String((arg as { message: unknown }).message);
  }
  return "";
};

/** A running tail of one marker channel, armed before the load. Same shape as
 * the smoke's `MarkerWatch` and separate from it on purpose — importing across
 * two harnesses would couple a lab run's steering to a smoke row's timeouts. */
class MarkerTail<T> {
  #latest: T | null = null;
  readonly #waiters = new Set<() => void>();

  constructor(win: BrowserWindow, prefix: string) {
    win.webContents.on("console-message", (...args: unknown[]) => {
      for (const arg of args) {
        const text = consoleText(arg);
        if (!text.startsWith(prefix)) continue;
        try {
          this.#latest = JSON.parse(text.slice(prefix.length)) as T;
        } catch {
          continue;
        }
        for (const waiter of [...this.#waiters]) waiter();
      }
    });
  }

  current(): T | null {
    return this.#latest;
  }

  async until(predicate: (value: T) => boolean, what: string, timeoutMs: number): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const latest = this.#latest;
      if (latest !== null && predicate(latest)) return latest;
      if (Date.now() >= deadline) {
        throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}`);
      }
      await new Promise<void>((resolve) => {
        const waiter = (): void => {
          this.#waiters.delete(waiter);
          resolve();
        };
        this.#waiters.add(waiter);
        setTimeout(() => {
          this.#waiters.delete(waiter);
          resolve();
        }, 200);
      });
    }
  }
}

// ---- driving the deck --------------------------------------------------------

/** Put the caret in a terminal the way the godview smoke does — page-side, not
 * by a synthesized mousedown (which injects the event but skips Chromium's
 * default action, so it blurs rather than focuses; GT-2 finding 4). */
async function focusDeck(win: BrowserWindow): Promise<string> {
  win.focus();
  win.webContents.focus();
  // ANY surface with a size, not the FIRST surface. `querySelector` returns the
  // first `.terminal-input` in document order, and at pane counts past a handful
  // that one can genuinely be 0x0 while every other pane is laid out fine — so
  // the single-element probe reported "surface has no size" and the layout
  // builder recorded a ceiling that was not there. It cost a wrong headline:
  // "the deck tops out at 11 panes", measured five times, while a sixth run with
  // the same command reached all 64. The deck's capacity and the harness's
  // choice of element are different questions and this asks the second one
  // correctly.
  const focused = (await win.webContents.executeJavaScript(
    `(() => { const all = [...document.querySelectorAll(".terminal-input")];
      if (all.length === 0) return "no surface";
      const sized = all.filter((t) => { const r = t.getBoundingClientRect(); return r.width >= 1 && r.height >= 1; });
      if (sized.length === 0) return "no surface has a size (" + all.length + " present)";
      const t = sized[0];
      t.focus();
      return document.activeElement === t ? "ok" : "focus refused"; })()`,
  )) as string;
  await sleep(120);
  return focused;
}

function pressChord(win: BrowserWindow, key: string): void {
  const modifiers: ("meta" | "control")[] = [process.platform === "darwin" ? "meta" : "control"];
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: key, modifiers });
  win.webContents.sendInputEvent({ type: "char", keyCode: key, modifiers });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: key, modifiers });
}

/** Split until the deck shows `target` panes, through the workspace's own ⌘D.
 *
 * Returns what it actually reached. A layout that cannot be built is a REPORTED
 * ceiling and not a thrown error: "the deck stopped at 37 panes" is the finding
 * `wall-100` exists to produce, and a rig that threw would lose it. */
async function buildLayout(
  win: BrowserWindow,
  deck: MarkerTail<DeckFacts>,
  target: number,
): Promise<{ panes: number; ceiling: string | null }> {
  let current = deck.current()?.panes ?? 1;
  for (let attempt = current; attempt < target; attempt += 1) {
    const before = current;
    // Retry the focus, and this is a CORRECTION rather than caution. The first
    // version took one reading and reported "surface has no size" as a ceiling —
    // which conflated "the deck cannot split further" with "the harness looked
    // while the deck was relaying out". It showed: three runs at 1180x748 all
    // said 11, but five runs at 1728x998 said 11, 11, 11, 14 and 24. A geometric
    // limit does not vary by a factor of two on the same window. Retrying turns
    // the transient into what it is and leaves only real ceilings.
    let focus = await focusDeck(win);
    for (let retry = 0; retry < 8 && focus !== "ok"; retry += 1) {
      await sleep(400);
      focus = await focusDeck(win);
    }
    if (focus !== "ok") return { panes: current, ceiling: `focus: ${focus} at ${current} panes` };
    pressChord(win, "d");
    try {
      const grown = await deck.until(
        (facts) => facts.panes > before,
        `⌘D to grow the deck past ${before} panes`,
        // Generous early (a cold pane is a whole session birth) and the same
        // afterwards: a slow 40th pane is a finding, not a reason to give up.
        30_000,
      );
      current = grown.panes;
    } catch (error) {
      return {
        panes: current,
        ceiling: `${error instanceof Error ? error.message : String(error)} (stopped at ${current})`,
      };
    }
  }
  return { panes: current, ceiling: null };
}

/** TP-S3e INSTRUMENT DEBT: this rig used to run setup lines through the UDS
 * automation door, addressed by the product ticket's legacy trio — both are
 * retired (the routed ticket carries WS doors + grants, deliberately not the
 * floor's socket/token). The sanctioned instrument door is the AR-lane
 * automation surface (fieldd-brokered `automation_input`), which does not
 * exist yet; until it does, scenarios that need pane setup fail LOUDLY here
 * rather than ride a resurrected credential. */
async function runInPane(_handle: FielddHandle, sessionId: string, line: string): Promise<void> {
  throw new Error(
    `s3e-instrument-debt: cannot run ${JSON.stringify(line)} in ${sessionId} — the lab's UDS ` +
      "automation door retired with the bridge (TP-S3e); the AR-lane automation surface is the " +
      "named follow-up",
  );
}

/** The node the generators run as. `process.execPath` is Electron; with
 * `ELECTRON_RUN_AS_NODE=1` it IS node, and using it means the fixtures need no
 * node on the pane's PATH and no version agreement with the host's. */
function fixtureCommand(script: string, args: readonly string[]): string {
  const quoted = args.map((a) => `'${a.replace(/'/gu, "'\\''")}'`).join(" ");
  return `ELECTRON_RUN_AS_NODE=1 '${process.execPath}' '${script}' ${quoted}`;
}

function fixturePath(name: string): string {
  // dist/testing -> packages/electron-shell -> packages -> repo root
  return join(__dirname, "..", "..", "..", "..", "tooling", "terminal-perf", "fixture", name);
}

// ---- generators --------------------------------------------------------------

interface RunningGenerator {
  stop(): void;
  readonly kind: string;
  readonly detail: Record<string, unknown>;
}

async function startGenerator(opts: {
  win: BrowserWindow;
  handle: FielddHandle;
  plan: GeneratorPlan;
  sessionIds: readonly string[];
  seconds: number;
}): Promise<RunningGenerator> {
  const { win, plan, sessionIds } = opts;
  const targets = plan.hotPanes
    .map((index) => sessionIds[index])
    .filter((id): id is string => id !== undefined);

  if (plan.kind === "none" || targets.length === 0) {
    return { stop: () => undefined, kind: "none", detail: { targets: targets.length } };
  }

  if (plan.kind === "flood") {
    const rate = plan.bytesPerSecond ?? FLOOD_RATE;
    for (const sessionId of targets) {
      await runInPane(
        opts.handle,
        sessionId,
        fixtureCommand(fixturePath("flood.mjs"), [
          "--rate",
          String(rate),
          "--seconds",
          // Outlive the run: a generator that stopped mid-arm would make the
          // last rotation a different fixture from the first, which is exactly
          // the uncontrolled variable interleaving exists to remove.
          String(opts.seconds + 60),
          "--shape",
          plan.shape ?? "scroll",
        ]),
      );
    }
    return {
      // The fixture exits on its own deadline; the pane dies with the run. A
      // SIGTERM would need the child's pid through a door the lab does not have.
      stop: () => undefined,
      kind: "flood",
      detail: { rate, shape: plan.shape ?? "scroll", sessions: targets.length },
    };
  }

  if (plan.kind === "scroll-storm") {
    const hz = plan.eventsPerSecond ?? 60;
    let events = 0;
    const bounds = win.getContentBounds();
    const timer = setInterval(
      () => {
        events += 1;
        win.webContents.sendInputEvent({
          type: "mouseWheel",
          x: Math.round(bounds.width / 2),
          y: Math.round(bounds.height / 2),
          deltaX: 0,
          // Alternating so the viewport oscillates around one anchor instead of
          // walking to the top of the scrollback and then measuring nothing.
          deltaY: events % 2 === 0 ? -120 : 120,
          canScroll: true,
        } as Parameters<typeof win.webContents.sendInputEvent>[0]);
      },
      Math.max(1, Math.round(1000 / hz)),
    );
    return {
      stop: () => clearInterval(timer),
      kind: "scroll-storm",
      detail: {
        hz,
        get events() {
          return events;
        },
      },
    };
  }

  if (plan.kind === "resize-storm") {
    const hz = plan.eventsPerSecond ?? 30;
    const base = win.getBounds();
    let step = 0;
    const timer = setInterval(
      () => {
        step += 1;
        // ±80px around the starting width: a divider drag's amplitude, at the
        // throttle rate TP-D18 designs for. The window resize is the closest
        // thing to a drag the rig can drive without the deck's own divider.
        const delta = (step % 2 === 0 ? 1 : -1) * 80;
        win.setBounds({ ...base, width: Math.max(600, base.width + delta) });
      },
      Math.max(1, Math.round(1000 / hz)),
    );
    return {
      stop: () => {
        clearInterval(timer);
        win.setBounds(base);
      },
      kind: "resize-storm",
      detail: {
        hz,
        get resizes() {
          return step;
        },
      },
    };
  }

  // focus-alternation
  const hz = plan.eventsPerSecond ?? 2;
  let swaps = 0;
  const timer = setInterval(
    () => {
      swaps += 1;
      // ⌘] is the workspace's next-pane binding in the deck's table; if it is not
      // bound the keys are simply ignored and `swaps` still counts what was sent,
      // which is why the report carries both the count and the deck's own
      // activeSessionId trail rather than assuming the focus moved.
      pressChord(win, "]");
    },
    Math.max(1, Math.round(1000 / hz)),
  );
  return {
    stop: () => clearInterval(timer),
    kind: "focus-alternation",
    detail: {
      hz,
      get swaps() {
        return swaps;
      },
    },
  };
}

// ---- the echo probe (TP-D19's VibeField half) --------------------------------

const PROBE_ALPHABET = "abcdefghijklmnopqrstuvwxyz012345";

interface InjectedKey {
  index: number;
  probeId: string;
  /** `process.hrtime.bigint()` at the instant before `sendInputEvent`. */
  injectedNs: string;
  injectedWallMs: number;
}

/** Inject N keystrokes into the focused pane, one at a time, with a gap.
 *
 * The gap is not politeness: two keys inside one frame are indistinguishable
 * downstream, and the whole point is one probe per frame at most. 40ms at 120Hz
 * is ~5 display intervals, which also keeps the injections asynchronous to
 * vsync — so the sample is spread across the frame phase instead of landing at
 * the same offset every time and measuring one point of the latch. */
async function injectKeys(
  win: BrowserWindow,
  count: number,
  gapMs: number,
): Promise<InjectedKey[]> {
  const injected: InjectedKey[] = [];
  for (let index = 0; index < count; index += 1) {
    const probeId = PROBE_ALPHABET[index % PROBE_ALPHABET.length] as string;
    const injectedNs = process.hrtime.bigint();
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: probeId });
    win.webContents.sendInputEvent({ type: "char", keyCode: probeId });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: probeId });
    injected.push({
      index,
      probeId,
      injectedNs: injectedNs.toString(),
      injectedWallMs: Date.now(),
    });
    await sleep(gapMs);
  }
  return injected;
}

// ---- what survived -----------------------------------------------------------

/** This worktree's floors, cells, fieldd and lab Electrons that are still
 * running — EXCLUDING this app's own processes.
 *
 * That exclusion is the whole subtlety. Electron is multi-process: main,
 * renderer, GPU and utility all run the SAME binary with the same argv[0], so a
 * census that excluded only `process.pid` counted the live run's own helpers as
 * survivors and reported "3 surviving lab Electrons" on a run that leaked
 * nothing — the shell's own check, outside the process, said 0.
 * `getAppMetrics()` enumerates exactly this app's processes, which is the
 * precise answer and one this file already uses for the resource formula.
 *
 * The repo root is derived the way `fixturePath` derives it: `__dirname` is
 * `packages/electron-shell/dist/testing`. */
function ownStrays(): { pid: number; kind: string }[] {
  const repoRoot = join(__dirname, "..", "..", "..", "..");
  const listing = spawnSync("/bin/ps", ["-axwwo", "pid=,command="], { encoding: "utf8" });
  if (listing.status !== 0 || typeof listing.stdout !== "string") return [];
  const mine = new Set<number>([process.pid, ...app.getAppMetrics().map((metric) => metric.pid)]);
  return findStrays(listing.stdout, repoRoot, [...mine]).map((stray) => ({
    pid: stray.pid,
    kind: stray.kind,
  }));
}

// ---- leaving, unconditionally -------------------------------------------------

/**
 * Exit, and mean it.
 *
 * THIS IS THE BUG THAT MATTERED MOST. The first teardown ended in
 * `writeFileSync(...); await opts.beforeExit(); app.exit(code)` with nothing
 * guarding the path to that last call — and the machine's disk was at 100% for
 * part of that window, so the first statement was throwing ENOSPC and the exit
 * never ran. The Electron then sat there with a shown, always-on-top window and
 * nothing to make it quit, holding its DETACHED floor and every cell and shell
 * under it. Forty-five accumulated, aged up to 1h11, and took the machine to 527
 * ptys against a system-wide ceiling of 511 — which fails every terminal test
 * and every new shell on the box, for everyone.
 *
 * So leaving is no longer the last statement of a happy path:
 *
 *   - the watchdog is armed BEFORE the run rather than after it, so a hang
 *     anywhere — including inside teardown itself — still ends the process;
 *   - `process.exit` sits behind `app.exit`, because `app.exit` runs Electron's
 *     own shutdown and can itself be blocked, while `process.exit` cannot;
 *   - the timer is unref'd, so it never keeps a finished process alive.
 */
function armExitWatchdog(afterMs: number, reason: string): () => void {
  const timer = setTimeout(() => {
    process.stderr.write(
      `terminal-perf-lab: ${reason} — forcing exit after ${afterMs}ms so this process ` +
        "cannot outlive its scenario and hold its floor\n",
    );
    process.exit(3);
  }, afterMs);
  timer.unref();
  return () => clearTimeout(timer);
}

/** `app.exit`, with `process.exit` behind it on a short fuse. */
function leave(code: number): void {
  const fuse = setTimeout(() => process.exit(code), 5_000);
  fuse.unref();
  try {
    app.exit(code);
  } catch {
    process.exit(code);
  }
}

// ---- the pty census ----------------------------------------------------------

/** How many ptys exist on this machine RIGHT NOW.
 *
 * `kern.tty.ptmx_max` is 511 on macOS and it is SYSTEM-WIDE: a scenario that
 * leaks ptys does not degrade itself, it takes every terminal test, every
 * godview smoke and every new shell on the machine down with it — which is
 * exactly what this lab did before it learned to tear down (15 floors, 86 cells,
 * 509 ptys, and `resource_governance::fd_exhaustion` reds on clean main for
 * everybody). So the count is taken before and after every run, it goes in the
 * artifact, and a run that does not give its ptys back says so.
 *
 * Counting `/dev/ttys*` rather than parsing `sysctl`: the entries are the
 * allocated slave devices, which is the resource that runs out. */
function ptyCount(): number {
  try {
    return readdirSync("/dev").filter((entry) => entry.startsWith("ttys")).length;
  } catch {
    return -1;
  }
}

/** One audited action fieldd performed during the run, as the ledger recorded
 * it: the attempt's timestamp, and how long the effect between the two records
 * took. `sequence` is the order the action's ATTEMPT was written in, so the
 * cold open's first `terminal.session.create` is recognisable as the first one
 * rather than by guessing from a duration. */
interface AuditActionTiming {
  readonly action: string;
  readonly sequence: number;
  readonly attemptAt: number;
  readonly effectMs: number;
  readonly outcome: string;
}

/** Pair every audited action's `attempt` with its `outcome` by `operationId`.
 *
 * TP-S1m's server-side instrument, and it adds nothing to the daemon: the two
 * records are already written (attempt BEFORE the effect, outcome after), so
 * the interval between their `time` fields IS the handler's own duration —
 * `terminal.session.create`'s covers the class-cell wait, the per-cell control
 * dial and the spawn; `terminal.ticket.mint`'s covers the mint alone.
 *
 * The whole audit tree is walked because the ledger's location under a data
 * root is the daemon's business (a per-user root nests it), and a hard-coded
 * path would silently report nothing the day that changes. Bounded by the
 * directory's own size and read once, at teardown. */
function auditDurations(root: string): AuditActionTiming[] {
  const files: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 6) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, depth + 1);
      else if (entry.name.endsWith(".jsonl") && dir.split("/").includes("audit")) files.push(path);
    }
  };
  walk(root, 0);
  const attempts = new Map<string, { action: string; time: number; sequence: number }>();
  const timings: AuditActionTiming[] = [];
  let sequence = 0;
  for (const file of files) {
    let lines: string[];
    try {
      lines = readFileSync(file, "utf8").split("\n");
    } catch {
      continue;
    }
    for (const line of lines) {
      if (line.trim() === "") continue;
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue; // a torn last line is not a reason to lose the rest
      }
      const operationId = record["operationId"];
      const action = record["action"];
      const time = record["time"];
      if (typeof operationId !== "string" || typeof action !== "string") continue;
      if (typeof time !== "number") continue;
      if (record["phase"] === "attempt") {
        sequence += 1;
        attempts.set(operationId, { action, time, sequence });
        continue;
      }
      const opened = attempts.get(operationId);
      if (opened === undefined) continue;
      attempts.delete(operationId);
      timings.push({
        action,
        sequence: opened.sequence,
        attemptAt: opened.time,
        effectMs: Math.round((time - opened.time) * 10) / 10,
        outcome: typeof record["outcome"] === "string" ? record["outcome"] : "unknown",
      });
    }
  }
  return timings.sort((left, right) => left.sequence - right.sequence);
}

/** The count once the kernel has finished taking them back.
 *
 * `/dev/ttys*` nodes ARE removed when a pty is released — but LAZILY, and later
 * than every process holding one has exited. Measured on this host: a `deck-4`
 * run whose floor, cells and fieldd were all confirmed dead still read 61
 * against a baseline of 57 immediately after teardown, and was back to 57 within
 * half a minute with nothing else happening.
 *
 * So the question this asks is RETURN, not stability. An early version stopped
 * on three identical reads, saw 61 three times in four seconds, and reported a
 * four-pty leak on a run that had leaked nothing — and a census that cries leak
 * on a clean run teaches its reader to ignore it, which is worse than no census.
 *
 * Waits for `<= baseline`, or gives up at the deadline and says so. Giving up is
 * a real answer: it means the ptys were still out after 45 seconds, which on a
 * machine with a 511 ceiling is worth a line in the report. */
async function settledPtyCount(
  baseline: number,
  timeoutMs = 45_000,
): Promise<{ count: number; returned: boolean }> {
  const deadline = Date.now() + timeoutMs;
  let current = ptyCount();
  if (baseline < 0) return { count: current, returned: true };
  while (Date.now() < deadline) {
    if (current <= baseline) return { count: current, returned: true };
    await sleep(1_000);
    current = ptyCount();
  }
  return { count: current, returned: current <= baseline };
}

// ---- resources ---------------------------------------------------------------

interface ResourceReading {
  readonly at: number;
  readonly electron: ElectronProcessSample;
  readonly processes: readonly (ProcessResourceSample & { role: string })[];
}

async function readResources(
  handle: FielddHandle,
  windows: readonly BrowserWindow[],
): Promise<ResourceReading> {
  const electron = await sampleElectronProcesses(windows);
  const roles: { pid: number; role: string }[] = [
    { pid: process.pid, role: "electron-main" },
    ...electron.rendererPids.map((pid) => ({ pid, role: "renderer" })),
  ];
  if (handle.childPid !== undefined) roles.push({ pid: handle.childPid, role: "fieldd" });
  const processes = await Promise.all(
    roles.map(async ({ pid, role }) => ({
      ...(await sampleProcessResources(pid, true)),
      role,
    })),
  );
  return { at: Date.now(), electron, processes };
}

// ---- tracing -----------------------------------------------------------------

/** §19's self-describing rule: every artifact records what was REQUESTED and
 * what `getCategories()` reported at each end. The two differ, and the doc says
 * why — `getCategories()` reports what is AVAILABLE, which grows as code paths
 * are first reached, so it is not a list of what a recording enabled. */
const TRACE_CATEGORIES = [
  "benchmark",
  "input",
  "latencyInfo",
  "viz",
  "cc",
  "gpu",
  "blink.user_timing",
  "disabled-by-default-devtools.timeline.frame",
];

// ---- the run -----------------------------------------------------------------

interface ArmRecord {
  readonly arm: string;
  readonly rotation: number;
  readonly requestedMode: string;
  readonly effectiveMode: string;
  readonly startedAt: number;
  readonly durationMs: number;
  readonly snapshot: LabSnapshot;
  readonly injected?: readonly InjectedKey[];
}

const envNumber = (name: string, fallback: number): number => {
  const raw = process.env[name];
  const value = raw === undefined ? Number.NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

export async function runTerminalPerfLab(opts: {
  handle: FielddHandle;
  supervisor: FielddSupervisor;
  root: string;
  registry: WindowRegistry;
  preloadPath: string;
  viteUrl: string;
  toggleGodview: () => void;
  beforeExit: () => Promise<void>;
  onWindow?: (window: BrowserWindow) => void;
}): Promise<void> {
  const scenarioName = process.env["VF_PERF_SCENARIO"] ?? "deck-4";
  const scenario = SCENARIOS[scenarioName];
  const outDir = process.env["VF_PERF_OUT"] ?? mkdtempSync(join(tmpdir(), "vf-perf-lab-"));
  const armNames = (process.env["VF_PERF_ARMS"] ?? "metrics").split(",").filter((a) => a !== "");
  const rotations = Math.max(1, envNumber("VF_PERF_ROTATIONS", 3));
  const armMs = Math.max(1_000, envNumber("VF_PERF_ARM_MS", 10_000));
  const tracing = process.env["VF_PERF_TRACE"] === "1";
  const probeKeys = Math.max(0, envNumber("VF_PERF_PROBE_KEYS", 0));
  const probeGapMs = Math.max(5, envNumber("VF_PERF_PROBE_GAP_MS", 40));
  /**
   * `window` (default) injects with `sendInputEvent`, which enters at Chromium's
   * own input layer and touches nothing outside this process — safe on any
   * machine, and the right instrument for everything the lab measures alone.
   *
   * `os` means the DRIVER will post real CGEvents through the window server
   * while this arm runs, because that is the only injection a foreign terminal
   * can receive and therefore the only one an A-vs-A control may use. The lab
   * then injects NOTHING itself and simply holds the pane focused for the arm's
   * duration; it prints a ready line the driver waits on. Two injectors firing
   * at one window would be two experiments in one measurement.
   */
  const probeInjection = process.env["VF_PERF_PROBE_INJECT"] === "os" ? "os" : "window";

  mkdirSync(outDir, { recursive: true });
  // THE OUTER DEADLINE, armed before a single process is spawned. Every arm, wait
  // and teardown step below has its own bound; this is the one that holds when
  // one of those bounds is the thing that broke.
  const disarmWatchdog = armExitWatchdog(
    Math.max(120_000, armNames.length * rotations * armMs + 15 * 60_000),
    "the scenario exceeded its total budget",
  );
  // Taken BEFORE anything is spawned, so the closing census has a baseline that
  // predates this run's own floor.
  const startingPtys = ptyCount();
  const jsonl: string[] = [];
  const emit = (record: Record<string, unknown>): void => {
    jsonl.push(JSON.stringify({ scenario: scenarioName, ...record }));
  };
  const failures: string[] = [];

  emit({
    kind: "run",
    at: Date.now(),
    node: process.versions["node"],
    electron: process.versions["electron"],
    chrome: process.versions["chrome"],
    platform: process.platform,
    arch: process.arch,
    ptysAtStart: startingPtys,
    arms: armNames,
    rotations,
    armMs,
    tracing,
    probeInjection,
    scenarioKnown: scenario !== undefined,
    plan: scenario ?? null,
  });

  try {
    if (scenario === undefined) {
      throw new Error(
        `unknown scenario "${scenarioName}"; known: ${Object.keys(SCENARIOS).join(", ")}`,
      );
    }
    if (!scenario.layout.hostable) {
      // NOT a throw: the run publishes a record saying precisely why the
      // scenario has no host, which is the deliverable for `multi-view` and
      // `wall-100`. A silent substitution would be worse than no number.
      emit({
        kind: "not-hostable",
        at: Date.now(),
        layout: scenario.layout,
        why: scenario.layout.why,
      });
      writeFileSync(join(outDir, "lab.jsonl"), `${jsonl.join("\n")}\n`);
      disarmWatchdog();
      armExitWatchdog(30_000, "the not-hostable teardown did not finish");
      await opts.supervisor.dispose().catch(() => undefined);
      await opts.beforeExit().catch(() => undefined);
      leave(0);
      return;
    }

    const win = createMainWindow({
      mode: "terminal-perf-lab",
      preloadPath: opts.preloadPath,
      show: true,
    });
    opts.registry.adopt(win);
    // Above everything, for the same reason as the backgrounding switches: the
    // machine a lab runs on may have other windows on it, and a measurement
    // taken behind one of them is a measurement of Chromium's occlusion policy.
    win.setAlwaysOnTop(true, "floating");
    opts.onWindow?.(win);

    // The renderer's console, passed through when asked. A lab that could not
    // say WHY a deck never opened would send its operator back to the smoke to
    // find out, and the two runs are not the same run.
    if (process.env["VF_PERF_DEBUG"] === "1") {
      win.webContents.on("console-message", (...args: unknown[]) => {
        process.stdout.write(
          `[renderer] ${args.map((a) => consoleText(a) || JSON.stringify(a)).join(" ")}\n`,
        );
      });
      win.webContents.on("render-process-gone", (_event, details) => {
        process.stdout.write(`[renderer gone] ${JSON.stringify(details)}\n`);
      });
    }
    // §19.1 row 13 — the cold-open stations, published once per app life when
    // the first open reaches a presented frame. Armed BEFORE the toggle for the
    // reason the godview smoke arms it there: the line is printed once and a
    // wait placed after the open would miss it outright.
    const coldOpen = new MarkerTail<{
      totalMs: number;
      phases: Record<string, number>;
      warm: string[];
      prewarmed: boolean;
      rendererBackend: string;
    }>(win, "GODVIEW_COLD_OPEN ");
    const deck = new MarkerTail<DeckFacts>(win, "GODVIEW_DECK ");
    const bridge = new MarkerTail<{ installed: boolean }>(win, "TERMINAL_PERF_LAB ");
    const canvas = new MarkerTail<Record<string, unknown>>(win, "CANVAS_READY ");

    await loadRenderer(win, "terminal-perf-lab", opts.viteUrl);
    await canvas.until(() => true, "the renderer to report CANVAS_READY", 90_000);
    await bridge.until((v) => v.installed, "the perf-lab renderer bridge to install", 30_000);
    win.focus();
    win.webContents.focus();
    await win.webContents.executeJavaScript("localStorage.clear()");

    // Trace BEFORE the deck opens when tracing is on, so the cold open is in the
    // recording: `open -> first pane paint` (§18.7) is one of the five
    // sensations and it happens exactly once per process.
    let availableAtStart: string[] = [];
    if (tracing) {
      availableAtStart = await contentTracing.getCategories();
      await contentTracing.startRecording({ included_categories: TRACE_CATEGORIES });
    }

    // TP-S1m — the main thread's own account of the open, OFF by default.
    // Armed immediately before the toggle so the entries it collects belong to
    // the open rather than to the canvas coming up, and opt-in so a before/after
    // comparison is never also an A/B on the presence of an observer.
    // TP-S1m — the monitor stage, removed for the run when the rig asks. The
    // cold open mounts the deck and the monitor in one commit, so the only way
    // to say what the monitor costs the OPEN is to open once without it. A run
    // that does not set this is the shipping path unchanged.
    if (process.env["VF_PERF_NO_MONITOR"] === "1") {
      const monitor = (await win.webContents.executeJavaScript(
        "window.__vfTerminalPerfLab.setMonitorEnabled(false)",
      )) as boolean;
      emit({ kind: "lab-switches", at: Date.now(), monitor });
    }

    const watchLongFrames = process.env["VF_PERF_LONGTASKS"] === "1";
    if (watchLongFrames) {
      const armed = (await win.webContents.executeJavaScript(
        "window.__vfTerminalPerfLab.captureLongFrames()",
      )) as boolean;
      emit({ kind: "long-frames-armed", at: Date.now(), armed });
    }

    opts.toggleGodview();
    const opened = await deck.until(
      (facts) => facts.active && facts.panes >= 1,
      "the overlay to open with its first pane",
      120_000,
    );
    emit({ kind: "opened", at: Date.now(), panes: opened.panes, backend: opened.rendererBackend });
    // Non-fatal and bounded: the stations are evidence about HOW the open went,
    // never the reason a run passes or fails.
    void coldOpen
      .until(() => true, "the cold-open stations", 30_000)
      .then(async (facts) => {
        emit({ kind: "cold-open", at: Date.now(), ...facts });
        if (!watchLongFrames) return;
        // Drained AFTER the trace is complete, so every stretch the open spent
        // is already recorded. The entries carry the page clock the cold-open
        // stations are stamped in, which is what lets a reader place a slow
        // reply inside a specific blocked frame instead of inferring it.
        const frames = (await win.webContents.executeJavaScript(
          "window.__vfTerminalPerfLab.takeLongFrames()",
        )) as Array<{ startMs: number; durationMs: number; blockingMs: number }>;
        emit({ kind: "long-frames", at: Date.now(), frames });
      })
      .catch(() => emit({ kind: "cold-open", at: Date.now(), missing: true }));

    // A pane ceiling is GEOMETRY before it is resources: the deck splits until a
    // surface has no room left, and on the factory's default 1180x780 window
    // that happened at eleven panes. Measuring density in a small window would
    // report the window rather than the deck, so any layout past a handful gets
    // the whole work area first — and the size is recorded beside the ceiling,
    // because "11 panes" means nothing without it.
    // `workarea` (the default past a handful of panes) or `default` to keep the
    // factory's 1180x780 — a knob rather than a rule, because the ceiling is a
    // function of the window and the only way to say so is to measure both.
    const windowMode =
      process.env["VF_PERF_WINDOW"] ?? (scenario.layout.panes > 8 ? "workarea" : "default");
    if (windowMode === "workarea") {
      win.setBounds(screen.getPrimaryDisplay().workArea);
      await sleep(600);
    }
    const bounds = win.getContentBounds();
    const built = await buildLayout(win, deck, scenario.layout.panes);
    emit({
      kind: "layout",
      at: Date.now(),
      requested: scenario.layout.panes,
      reached: built.panes,
      ceiling: built.ceiling,
      ceilingIsTheAnswer: scenario.ceilingIsTheAnswer === true,
      windowMode,
      windowContentSize: { width: bounds.width, height: bounds.height },
      devicePixelRatio: screen.getPrimaryDisplay().scaleFactor,
    });
    if (built.ceiling !== null && scenario.ceilingIsTheAnswer !== true) {
      failures.push(`layout ceiling: ${built.ceiling}`);
    }

    const settled = await deck.until(
      (facts) => facts.panes === built.panes && facts.sessionIds.length === built.panes,
      "the deck to settle with a session per pane",
      60_000,
    );

    const totalSeconds = Math.ceil((armNames.length * rotations * armMs) / 1000) + 30;

    // The echo fixture goes into pane 0 for the probe scenario, before the arms
    // start, so every arm types into the same raw-mode program.
    let echoOut: string | null = null;
    if (scenarioName === "echo-probe" && settled.sessionIds[0] !== undefined) {
      echoOut = join(outDir, "echo-fixture.jsonl");
      await runInPane(
        opts.handle,
        settled.sessionIds[0],
        fixtureCommand(fixturePath("echo-probe.mjs"), [
          "--out",
          echoOut,
          "--seconds",
          String(totalSeconds),
        ]),
      );
      await sleep(1_500); // let the fixture reach its read loop
      emit({ kind: "echo-fixture", at: Date.now(), out: echoOut, seconds: totalSeconds });
    }

    const generator = await startGenerator({
      win,
      handle: opts.handle,
      plan: scenario.generator,
      sessionIds: settled.sessionIds,
      seconds: totalSeconds,
    });
    emit({ kind: "generator", at: Date.now(), which: generator.kind, detail: generator.detail });

    // Focus the pane the probes type into, and start the bridge's collectors.
    const focus = await focusDeck(win);
    emit({ kind: "focus", at: Date.now(), result: focus });
    await lab(win, "lab.startFrames(4)");
    await lab(win, "lab.startProbes()");
    await lab(win, 'lab.start("off")');

    emit({ kind: "resources", phase: "before", ...(await readResources(opts.handle, [win])) });

    // Let the generator reach steady state before the first arm. A flood's
    // first second is its ramp, and putting the ramp inside rotation 1 arm A
    // would give arm A a systematically different fixture from arm B.
    await sleep(3_000);

    const records: ArmRecord[] = [];
    for (let rotation = 0; rotation < rotations; rotation += 1) {
      // Rotate the ARM ORDER each time. Interleaving alone still gives arm A
      // every odd slot; alternating the order removes any drift that tracks
      // position-in-run rather than the arm.
      const order = rotation % 2 === 0 ? armNames : [...armNames].reverse();
      for (const arm of order) {
        const requestedMode = arm === "null" ? "off" : arm;
        const effectiveMode = await lab<string>(
          win,
          `lab.setMode(${JSON.stringify(requestedMode)})`,
        );
        // TWO drains with a settle between them, and this is not belt-and-
        // braces. The sampler opens a `metrics` window for a full second and
        // closes it on idle-or-deadline, so a window that was already open when
        // the mode flipped to `off` still CLOSES afterwards and publishes — into
        // the next arm's drain. The lab's first deck-4 A/B recorded exactly
        // that: the `off` arm reported one window with stage histograms in it,
        // in a mode that opens no windows. Settling past the sampler's own
        // period and draining again attributes that straggler to nobody.
        await lab(win, "lab.drain()");
        await sleep(1_400);
        await lab(win, "lab.drain()");
        const startedAt = Date.now();
        // The driver watches for this line and posts its CGEvents against it, so
        // it names the arm it is opening — an injector that fired against the
        // wrong arm would be attributing keystrokes to the wrong condition.
        if (probeInjection === "os") {
          process.stdout.write(
            `TERMINAL_PERF_LAB_ARM_READY ${JSON.stringify({ arm, rotation, ms: armMs })}\n`,
          );
        }
        const injected =
          probeInjection === "window" && probeKeys > 0
            ? await injectKeys(win, probeKeys, probeGapMs)
            : undefined;
        const spent = Date.now() - startedAt;
        if (spent < armMs) await sleep(armMs - spent);
        const snapshot = await lab<LabSnapshot>(win, "lab.drain()");
        const record: ArmRecord = {
          arm,
          rotation,
          requestedMode,
          effectiveMode,
          startedAt,
          durationMs: Date.now() - startedAt,
          snapshot,
          ...(injected === undefined ? {} : { injected }),
        };
        records.push(record);
        emit({ kind: "arm", ...record });
      }
    }

    generator.stop();
    await lab(win, "lab.stopFrames()");
    await lab(win, "lab.stopProbes()");
    emit({ kind: "resources", phase: "after", ...(await readResources(opts.handle, [win])) });

    if (tracing) {
      const availableAtEnd = await contentTracing.getCategories();
      const tracePath = await contentTracing.stopRecording(join(outDir, "trace.json"));
      emit({
        kind: "trace",
        at: Date.now(),
        path: tracePath,
        requestedTraceConfig: { included_categories: TRACE_CATEGORIES },
        availableCategoriesAtStart: availableAtStart,
        availableCategoriesAtEnd: availableAtEnd,
      });
    }

    if (echoOut !== null) emit({ kind: "echo-out", at: Date.now(), path: echoOut });
    emit({ kind: "done", at: Date.now(), arms: records.length, failures });
  } catch (error) {
    emit({
      kind: "failed",
      at: Date.now(),
      error: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error),
    });
    failures.push(error instanceof Error ? error.message : String(error));
  } finally {
    // TEARDOWN, and the reason this function exists rather than a bare
    // `app.exit()`.
    //
    // Every smoke in this file's neighbour calls `teardown(supervisor, root,
    // beforeExit)` and the FIRST thing it does is `supervisor.dispose()` —
    // stop-owned, which SIGTERMs the fieldd this run spawned AND the
    // field-native it recorded. The lab shipped without that call, and because
    // field-native is spawned DETACHED and outlives its parent by design (the
    // two-plane law), every run left a floor behind: its cells, its shells and
    // one pty per session. `wall-100` creates a hundred sessions. Fifteen runs
    // later the machine was at 527 ptys against a system-wide ceiling of 511,
    // and every terminal test on it — ours and everybody else's — was failing
    // while SPAWNING.
    //
    // Ordered, awaited, and bounded: `app.exit()` is a hard exit that runs no
    // quit handlers, so anything that must happen has to happen above it. The
    // bound matters because a wedged daemon must not hang the lab forever; what
    // survives the bound is named in the record and reaped by the driver's
    // `--reap`, which matches on this worktree's path.
    // Every step below is individually guarded and the exit is UNCONDITIONAL.
    // `guard` is the rule in one function: nothing in here may prevent leaving.
    disarmWatchdog();
    const teardownWatchdog = armExitWatchdog(90_000, "teardown did not finish");
    const guard = async (what: string, step: () => Promise<void> | void): Promise<string> => {
      try {
        await step();
        return "ok";
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`terminal-perf-lab: ${what} failed: ${message}\n`);
        return message;
      }
    };

    // TP-S1m — THE SERVER'S OWN RECORD OF THE COLD OPEN, read before the
    // scratch root is removed.
    //
    // The renderer's trace can time a mint only from the outside: `mintAsk` to
    // `ticket` covers the socket, fieldd's queue, its handler and the floor
    // together, and TP-S0c read that whole interval as "minting the ticket".
    // fieldd already writes the inside of it down — every audited action lands
    // an `attempt` record before its effect and an `outcome` record after (EL7,
    // and the reason `terminal.create` composes TWO audited actions). Pairing
    // those by `operationId` gives each handler's own duration with no new
    // instrument in the daemon at all, and the ledger is durable, so this is a
    // read rather than a measurement that perturbs what it measures.
    //
    // Diagnostics only, and never a reason a run fails: a root with no ledger
    // (an early failure, an injected FIELDD_DATA_DIR elsewhere) reports nothing.
    await guard("reading the audit ledger", () => {
      const actions = auditDurations(opts.root);
      if (actions.length > 0) emit({ kind: "audit-timings", at: Date.now(), actions });
    });

    const ptysBefore = startingPtys;
    let teardownNote = "clean";
    // The daemons first: they are what outlives this process if it does not.
    const disposed = await guard("supervisor.dispose()", async () => {
      let timedOut = false;
      await Promise.race([
        opts.supervisor.dispose(),
        sleep(20_000).then(() => {
          timedOut = true;
        }),
      ]);
      if (timedOut) throw new Error("did not finish within 20s");
    });
    if (disposed !== "ok") teardownNote = `supervisor.dispose(): ${disposed}`;
    // The scratch root, but ONLY if this run made it: an injected
    // FIELDD_DATA_DIR is somebody else's data (the smokes' rule, kept).
    if (process.env["FIELDD_DATA_DIR"] === undefined) {
      await guard("removing the scratch root", () => {
        rmSync(opts.root, { recursive: true, force: true });
      });
    }
    // Ptys are freed asynchronously as the cells die, so this WAITS for the
    // count to settle rather than sleeping a guessed interval — see
    // `settledPtyCount` for the run that proved a fixed sleep lies.
    let settled = { count: ptyCount(), returned: true };
    await guard("the pty census", async () => {
      settled = await settledPtyCount(ptysBefore);
    });
    const ptysAfter = settled.count;
    // WHOSE ptys are still out? The count alone cannot say: this machine is
    // shared, and another agent opening three shells during a run leaves the
    // number above its baseline through no fault of ours. So the AUTHORITATIVE
    // signal is whether any of THIS worktree's own floors, cells or fieldd
    // survived teardown — the pty count is the corroborating evidence, reported
    // either way. (The same matcher the driver's `--reap` uses, and the same one
    // `reap.test.ts` pins against its decoys.)
    let survivors: { pid: number; kind: string }[] = [];
    await guard("counting survivors", () => {
      survivors = ownStrays();
    });
    emit({
      kind: "pty-census",
      at: Date.now(),
      before: ptysBefore,
      after: ptysAfter,
      returned: ptysBefore >= 0 && ptysAfter >= 0 ? ptysBefore - ptysAfter : null,
      leaked: ptysBefore >= 0 && ptysAfter > ptysBefore ? ptysAfter - ptysBefore : 0,
      ceiling: 511,
      settled: settled.returned,
      // Zero is the claim that matters; the pty delta above may be somebody
      // else's shells on a shared machine.
      survivingProcesses: survivors.length,
      survivingKinds: survivors.map((stray) => stray.kind),
      // Named separately because it is the one that took the machine down and
      // the first thing a reader will look for.
      survivingLabElectrons: survivors.filter((stray) => stray.kind === "electron").length,
      note: teardownNote,
    });
    if (survivors.length > 0) {
      failures.push(
        `${survivors.length} process(es) of this worktree survived teardown ` +
          `(${survivors.map((s) => s.kind).join(", ")}; ${teardownNote}) — ` +
          "run `pnpm perf:terminal --reap`",
      );
    }

    const jsonlText = `${jsonl.join("\n")}\n`;
    await guard("writing lab.jsonl", () => {
      writeFileSync(join(outDir, "lab.jsonl"), jsonlText);
    });
    // The RESULTS is written HERE rather than by the driver, so a run that the
    // driver never got to read (a crash, a kill, a hung build) still leaves a
    // readable report beside its raw lines. The reducer is pure and lives in
    // `@vibefield/terminal-perf`, with its own suite — the lab does not own the
    // arithmetic, only the decision to run it before exiting.
    await guard("writing RESULTS.md", () => {
      // The fixture's side channel, when this scenario ran one. Read at the very
      // end so it carries the whole run; a missing or unreadable file simply
      // means no §4b table, never a failed report.
      let echo: ReturnType<typeof parseEchoJsonl> | undefined;
      try {
        const path = join(outDir, "echo-fixture.jsonl");
        if (existsSync(path)) echo = parseEchoJsonl(readFileSync(path, "utf8"));
      } catch {
        echo = undefined;
      }
      const report = buildLabReport({
        scenario: scenarioName,
        ...(echo === undefined ? {} : { echo }),
        records: parseLabJsonl(jsonlText),
        host: {
          host: `${process.platform}/${process.arch}`,
          "host load (1/5/15m)": loadavg()
            .map((value) => value.toFixed(2))
            .join(" / "),
          cpus: cpus().length,
          "total memory": `${(totalmem() / 1024 ** 3).toFixed(0)} GiB`,
        },
      });
      writeFileSync(join(outDir, "RESULTS.md"), `${report.markdown}\n`);
      writeFileSync(
        join(outDir, "report.json"),
        `${JSON.stringify(
          {
            scenario: report.scenario,
            arms: report.arms,
            ab: report.ab,
            attribution: report.attribution,
            echoPairing: report.echoPairing,
          },
          null,
          2,
        )}\n`,
      );
    });

    // The path on stdout is the driver's handshake: it reads this rather than
    // guessing where a run that failed early wrote its partial record.
    await guard("the driver handshake", () => {
      process.stdout.write(`TERMINAL_PERF_LAB_OUT ${outDir}\n`);
    });
    await guard("beforeExit", () => opts.beforeExit());
    teardownWatchdog();
    leave(failures.length > 0 ? 1 : 0);
  }
}
