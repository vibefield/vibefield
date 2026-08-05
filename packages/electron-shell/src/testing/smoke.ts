import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { GhostteaAutomationClient } from "@vibecook/ghosttea-client";
import {
  TerminalConfigDocument,
  TerminalConfigWriteResult,
  TerminalCreateResult,
  TerminalListResult,
  TerminalTicket,
} from "@vibefield/contracts";
import type { FielddHandle, FielddSupervisor } from "@vibefield/fieldd-supervisor";
import { app, BrowserWindow } from "electron";
import type { WindowRegistry } from "../main/window-policy";
import { createMainWindow, loadRenderer } from "../main/windows";

// Smoke/spike runners (ESR §5.2.6 / ESR-12): a SEPARATE build artifact
// (dist/testing/smoke.cjs) that the production main bundle never contains —
// index.ts reaches it via a runtime-external dynamic import, and packaging
// omits the file entirely. Everything here is test-only by construction.

/** Resolve when a renderer console line starting with `prefix` arrives. */
export function waitForConsole(
  win: BrowserWindow,
  prefix: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`no "${prefix}" within ${timeoutMs}ms`)),
      timeoutMs,
    );
    win.webContents.on("console-message", (...args: unknown[]) => {
      for (const a of args) {
        const text =
          typeof a === "string"
            ? a
            : a && typeof a === "object" && "message" in a
              ? String((a as { message: unknown }).message)
              : "";
        if (text.startsWith(prefix)) {
          clearTimeout(t);
          resolve(text.slice(prefix.length));
          return;
        }
      }
    });
  });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Stop-owned via the supervisor (adopted daemons survive — ownership law),
 * then remove the root ONLY if this run created it (an injected
 * FIELDD_DATA_DIR is someone else's data). */
async function teardown(
  supervisor: FielddSupervisor,
  root: string,
  beforeExit: () => Promise<void>,
): Promise<void> {
  await supervisor.dispose();
  await beforeExit();
  if (!process.env["FIELDD_DATA_DIR"]) rmSync(root, { recursive: true, force: true });
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
  const summary = {
    ok: health.nativeConnected,
    port: handle.info.port,
    nativeConnected: health.nativeConnected,
    units: health.native?.units?.map((u) => u.unit) ?? [],
  };
  console.log(`SMOKE ${JSON.stringify(summary)}`);
  await teardown(supervisor, root, beforeExit);
  app.exit(summary.ok ? 0 : 2); // exit is queued; the caller returns without opening a window
}

/** Full spine + real renderer, hidden: pass iff the canvas reports in.
 * Teardown runs on EVERY path — the old failure path leaked the spawned
 * daemons (slice-0 finding 3). */
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
  const win = createMainWindow({
    mode: "smoke-canvas",
    preloadPath: opts.preloadPath,
    show: false,
  });
  opts.registry.adopt(win); // the bootstrap sender policy admits only registered windows
  opts.onWindow?.(win);
  let ok = false;
  try {
    await loadRenderer(win, "smoke-canvas", opts.viteUrl);
    const raw = await waitForConsole(win, "CANVAS_READY ", 45_000);
    console.log(`SMOKE_CANVAS ${raw}`);
    ok = true;
  } catch (e) {
    console.error(`SMOKE_CANVAS failed: ${e instanceof Error ? e.message : e}`);
  }
  await teardown(opts.supervisor, opts.root, opts.beforeExit);
  app.exit(ok ? 0 : 2);
}

/** The serviceName `GhostteaElectronBridge` forks its utilityProcess under.
 * Upstream's default, restated here because this harness kills by name. */
const BRIDGE_SERVICE_NAME = "ghosttea-terminal-bridge";

/** SIGKILL the bridge's utility process — the only honest way to test
 * `unexpected-exit`, since `Backend.stop()` is an ORDERLY stop that emits
 * nothing. Neither Backend nor Bridge exposes its child, so the process is
 * found through Electron's own metrics.
 *
 * `fork`'s `serviceName` option surfaces as the metric's `name`; the metric's
 * OWN `serviceName` is the mojo interface (`node.mojom.NodeService`), which
 * every utilityProcess shares. Matching the mojo name would find the logging
 * utility just as happily, so both fields are checked for what they actually
 * mean. Returns the pid it killed so the verdict can say what died. */
function killTerminalBridge(): number | null {
  const metric = app
    .getAppMetrics()
    .find(
      (m) =>
        m.type === "Utility" &&
        m.name === BRIDGE_SERVICE_NAME &&
        m.serviceName === "node.mojom.NodeService",
    );
  if (metric === undefined) return null;
  process.kill(metric.pid, "SIGKILL");
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
}

/** The renderer-local home of the viewer's appearance (GT-D12). Named here so
 * the smoke seeds the same key the deck reads, and so a rename of that key
 * fails this harness rather than silently seeding nothing. */
const GODVIEW_APPEARANCE_STORAGE_KEY = "vf-godview-appearance-v1";
/** The port the smoke selects — a `GHOSTTEA_SHADER_OPTIONS` id, static by
 * choice (see row 5b). */
const SMOKE_SHADER_EFFECT = "ghosttea:crt";

/** A running tail of the deck's markers, armed BEFORE the load so a fast deck
 * cannot report into a gap. Every wait is a predicate over the LATEST line,
 * because the deck says what it is on every change and the interesting states
 * are transient. */
class DeckWatch {
  private latest: DeckFacts | null = null;
  private readonly waiters = new Set<() => void>();

  constructor(win: BrowserWindow) {
    win.webContents.on("console-message", (...args: unknown[]) => {
      for (const arg of args) {
        const text =
          typeof arg === "string"
            ? arg
            : arg && typeof arg === "object" && "message" in arg
              ? String((arg as { message: unknown }).message)
              : "";
        if (!text.startsWith("GODVIEW_DECK ")) continue;
        try {
          this.latest = JSON.parse(text.slice("GODVIEW_DECK ".length)) as DeckFacts;
        } catch {
          continue;
        }
        for (const notify of [...this.waiters]) notify();
      }
    });
  }

  current(): DeckFacts | null {
    return this.latest;
  }

  /** Forget what the deck last said. Called immediately before a renderer
   * reload: `until` answers from the latest marker it has, so a pre-reload
   * state would satisfy a post-reload question — and every assertion about
   * what the deck did on COMING BACK would be about the deck that left. */
  reset(): void {
    this.latest = null;
  }

  /** Resolve on the first marker satisfying `predicate`, including one already
   * seen — a state reached before the wait began is still the state. */
  async until(predicate: (facts: DeckFacts) => boolean, what: string, timeoutMs: number) {
    if (this.latest !== null && predicate(this.latest)) return this.latest;
    return new Promise<DeckFacts>((resolve, reject) => {
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

/** Press a chord the way a keyboard does: down, then up, with the character
 * Chromium expects. `sendInputEvent` injects at the browser's input layer, so
 * the workspace's own keydown listener and its Ghostty binding table decide
 * what happens — the harness presses keys and asserts nothing about routing. */
function pressChord(win: BrowserWindow, key: string): void {
  const modifiers: ("meta" | "control")[] = [process.platform === "darwin" ? "meta" : "control"];
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: key, modifiers });
  win.webContents.sendInputEvent({ type: "char", keyCode: key, modifiers });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: key, modifiers });
}

/** Put the caret in a terminal, by clicking one — which is how a user does it.
 *
 * The workspace answers a hotkey only when focus is inside it
 * (`workspaceOwnsHotkey` checks `event.target` and `document.activeElement`
 * against its own root), and ghosttea's surface takes focus by itself only when
 * `document.hasFocus()` happened to be true at mount. A click needs neither: a
 * real pointer-down on the surface's input lands focus there the way Chromium
 * lands it anywhere. */
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
    `(() => { const t = document.querySelector(".terminal-input"); if (!t) return "no surface";
      const r = t.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return "surface has no size";
      t.focus();
      return document.activeElement === t ? "ok" : "focus refused"; })()`,
  )) as string;
  if (focused !== "ok") throw new Error(`the deck could not take keyboard focus: ${focused}`);
  await sleep(150);
}

/** What has DOM focus, for a failure message. Diagnostic only — no assertion
 * reads it, so the harness never passes on the strength of its own probe. */
async function focusReport(win: BrowserWindow): Promise<string> {
  try {
    return String(
      await win.webContents.executeJavaScript(
        "`hasFocus=${document.hasFocus()} active=${document.activeElement?.tagName}.${document.activeElement?.className}`",
      ),
    );
  } catch (error) {
    return `unavailable: ${error instanceof Error ? error.message : String(error)}`;
  }
}

const listTerminals = async (handle: FielddHandle): Promise<TerminalListResult["terminals"]> =>
  TerminalListResult.parse(await handle.client.request("terminal.list", {})).terminals;

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
  while (Date.now() < deadline) {
    last = await listTerminals(handle);
    if (predicate(last)) return last;
    await sleep(150);
  }
  throw new Error(`the floor never ${what} within ${timeoutMs}ms (saw ${last.length} terminals)`);
}

/** Ask a real pane what shell it is, and prove it ran the question.
 *
 * `GhostteaAutomationClient` is ghosttea's Node door onto a session — the same
 * socket and token the deck's bridge dialed, redeemed through the same
 * `terminal.openTicket` any attach uses. `pasteAndSubmit` writes into the real
 * PTY, so what runs is the user's real shell interpreting a real command.
 *
 * One line carries both proofs. The SIDE EFFECT is the first: the marker only
 * reaches the file if the process on the other end actually executed the line,
 * which a screen scrape could never show. `$0` is the second: it is the shell's
 * own name for itself, so it answers what the workspace's own create door
 * spawned — the question GT-2e exists to settle. */
async function askPane(
  handle: FielddHandle,
  sessionId: string,
  markerPath: string,
  expression: string,
): Promise<{ marker: string; value: string }> {
  const marker = `godview-${Math.random().toString(36).slice(2, 10)}`;
  const ticket = TerminalTicket.parse(
    await handle.client.request("terminal.openTicket", { sessionId }),
  );
  const automation = new GhostteaAutomationClient(
    { controlSocket: ticket.controlSocket, authToken: ticket.token },
    { clientBuild: "vibefield-smoke-godview" },
  );
  try {
    await automation.connect();
    await automation.pasteAndSubmit(sessionId, `echo "${marker}:${expression}" > ${markerPath}\n`);
    // Matched rather than merely "contains": a half-written file must read as
    // not-yet, not as an empty answer.
    const written = new RegExp(`${marker}:(\\S+)`);
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        const found = written.exec(readFileSync(markerPath, "utf8"));
        if (found?.[1] !== undefined) return { marker, value: found[1] };
      } catch {
        /* the shell has not written it yet */
      }
      await sleep(150);
    }
    throw new Error(`the shell never wrote ${marker} to ${markerPath}`);
  } finally {
    automation.dispose();
  }
}

/** Run one line in a pane and wait for the shell to have finished it, without
 * asking for a value back. Used to move a pane's cwd — the thing GT-3's restore
 * has to carry across a death. */
async function runInPane(
  handle: FielddHandle,
  sessionId: string,
  markerPath: string,
  line: string,
): Promise<void> {
  const marker = `godview-${Math.random().toString(36).slice(2, 10)}`;
  const ticket = TerminalTicket.parse(
    await handle.client.request("terminal.openTicket", { sessionId }),
  );
  const automation = new GhostteaAutomationClient(
    { controlSocket: ticket.controlSocket, authToken: ticket.token },
    { clientBuild: "vibefield-smoke-godview" },
  );
  try {
    await automation.connect();
    await automation.pasteAndSubmit(sessionId, `${line}; echo ${marker} > ${markerPath}\n`);
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        if (readFileSync(markerPath, "utf8").includes(marker)) return;
      } catch {
        /* not yet */
      }
      await sleep(100);
    }
    throw new Error(`the shell never finished "${line}"`);
  } finally {
    automation.dispose();
  }
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
  deck: DeckWatch;
  toggleGodview: () => void;
  viteUrl: string;
}): Promise<void> {
  opts.toggleGodview();
  await opts.deck.until((facts) => !facts.active, "the overlay to close", 20_000);
  const reloaded = waitForConsole(opts.win, "CANVAS_READY ", 60_000);
  reloaded.catch(() => undefined);
  opts.deck.reset();
  await loadRenderer(opts.win, "smoke-godview", opts.viteUrl);
  await reloaded;
  opts.win.focus();
  opts.win.webContents.focus();
  opts.toggleGodview();
}

/** REPORT-ONLY (GT-3): how long a real keystroke takes to become an observable
 * effect. No threshold is asserted and nothing fails on it — the v0.3 review
 * asked for a number, and a number that gates a smoke would be a budget nobody
 * has agreed to yet.
 *
 * What it measures, stated exactly, because the name is a promise: the command
 * is STAGED with a control-plane paste and left unsubmitted, then Enter is
 * pressed as a real key event. The clock runs from that keypress to the moment
 * the shell's file side effect is visible to this process — so it spans the
 * renderer's input handling, the bridge, the floor, the PTY, the shell's own
 * execution of the line, and this harness's filesystem poll. It is NOT frame
 * paint, and it is NOT a floor round trip in isolation.
 *
 * Never fatal: it returns null with a reason rather than failing the smoke,
 * because a measurement that can fail a gate is an assertion in disguise. */
async function measureKeystrokeEcho(
  win: BrowserWindow,
  handle: FielddHandle,
  sessionId: string,
  markerPath: string,
): Promise<{ ms: number } | { skipped: string }> {
  const marker = `latency-${Math.random().toString(36).slice(2, 10)}`;
  const ticket = TerminalTicket.parse(
    await handle.client.request("terminal.openTicket", { sessionId }),
  );
  const automation = new GhostteaAutomationClient(
    { controlSocket: ticket.controlSocket, authToken: ticket.token },
    { clientBuild: "vibefield-smoke-godview" },
  );
  try {
    await automation.connect();
    // Staged WITHOUT a newline: the line sits on the shell's edit buffer and
    // nothing has run, so the only thing left between here and the side effect
    // is the keypress below.
    await automation.paste(sessionId, `echo ${marker} > ${markerPath}`);
    await sleep(500); // let the paste settle onto the line before timing starts
    const started = Date.now();
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
    win.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
    const deadline = started + 10_000;
    while (Date.now() < deadline) {
      try {
        if (readFileSync(markerPath, "utf8").includes(marker)) {
          return { ms: Date.now() - started };
        }
      } catch {
        /* not yet */
      }
      await sleep(2); // the poll IS the resolution floor, so it is small
    }
    return { skipped: "the pane never ran the staged line on a Return keypress" };
  } catch (error) {
    return { skipped: error instanceof Error ? error.message : String(error) };
  } finally {
    automation.dispose();
  }
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

/** How the floor governs one session's retention, or undefined if it is gone. */
const persistenceOf = (
  terminals: TerminalListResult["terminals"],
  sessionId: string,
): string | undefined => terminals.find((t) => t.sessionId === sessionId)?.persistence;

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
  toggleGodview: () => void;
  beforeExit: () => Promise<void>;
  onWindow?: (window: BrowserWindow) => void;
}): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), "vf-smoke-godview-"));
  const verdict: Record<string, unknown> = { ok: false };
  try {
    const win = createMainWindow({
      mode: "smoke-godview",
      preloadPath: opts.preloadPath,
      show: true,
    });
    opts.registry.adopt(win);
    opts.onWindow?.(win);
    if (process.env["VF_SMOKE_DEBUG"]) {
      win.webContents.on("console-message", (...args: unknown[]) => {
        console.log(`[renderer] ${args.map((a) => JSON.stringify(a)).join(" ")}`);
      });
    }
    const deck = new DeckWatch(win);
    const canvas = waitForConsole(win, "CANVAS_READY ", 60_000);
    canvas.catch(() => undefined);
    await loadRenderer(win, "smoke-godview", opts.viteUrl);
    await canvas;
    win.focus();
    win.webContents.focus();

    const before = await listTerminals(opts.handle);
    if (before.length > 0) {
      throw new Error(
        `the init-door row needs an EMPTY floor; found ${before.length} session(s) already`,
      );
    }
    // …and an empty DECK. Row 1 is about a first open, and both planes have to
    // be first: the renderer origin's localStorage outlives this process, so a
    // previous run's saved layout is still sitting there — and since GT-3 that
    // layout is not silently dropped, it is a QUESTION (every session it names
    // died with the last run's floor). Clearing here rather than reloading
    // because nothing has mounted yet: the deck is not built until ⌘⎋.
    await win.webContents.executeJavaScript("localStorage.clear()");

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

    // 1. ⌘⎋'s own action. The overlay opens, the deck redeems a ticket for the
    //    CONNECTION — no session — and the workspace then creates its own first
    //    pane through its own door (GT-D10). Nothing outside it asked for a
    //    shell; there is one because the workspace decided there should be.
    opts.toggleGodview();
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

    // 1b. THE MONITOR ROW (GT-3m). The stage above the deck, on the registry's
    //     default view, with the mock field on it and WEARING ITS LABEL.
    //
    //     The label is the assertion that earns this row. Everything the monitor
    //     draws is invented, and GT-D13 makes saying so a law rather than a
    //     courtesy — so the smoke fails if the words are missing, exactly as it
    //     would for a pane that lied about its shell. The other two facts are
    //     structure, not pixels: which view mounted, and that it has rows. What
    //     it LOOKS like is James's eye, as with the glass.
    const monitor = JSON.parse(await monitorLine) as {
      viewId: string;
      agents: number;
      agentBacked: number;
      mockLabel: string;
    };
    verdict["monitorView"] = monitor.viewId;
    verdict["monitorAgents"] = monitor.agents;
    verdict["monitorMockLabel"] = monitor.mockLabel;
    if (monitor.viewId !== "swarm") {
      throw new Error(`the monitor opened on "${monitor.viewId}", not the default swarm`);
    }
    if (!(monitor.agents > 0)) {
      throw new Error("the monitor stage mounted with no agents on it");
    }
    if (!monitor.mockLabel.includes("mock")) {
      throw new Error(
        `the monitor is showing ${monitor.agents} invented agents without saying so (label: ${JSON.stringify(monitor.mockLabel)})`,
      );
    }

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
    const asked = await askPane(opts.handle, freeShell, join(scratch, "echo.txt"), "$0");
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

    // 4. Split — the workspace's own ⌘D, through the workspace's OWN create
    //    door now that the deck no longer intercepts it. The new session is a
    //    floor session, and it is re-governed exactly like the first.
    await focusDeck(win);
    verdict["focusAtSplit"] = await focusReport(win);
    pressChord(win, "d");
    const split = await deck.until(
      (facts) => facts.panes >= 2,
      `⌘D to split the deck into a second pane (focus: ${String(verdict["focusAtSplit"])})`,
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

    // 5. Claim. `claimExistingSessions` is first-run-only upstream (gated on
    //    there being no saved workspace), so this stages a genuine first run:
    //    a session born on the floor outside the deck, the deck's saved layout
    //    cleared, and a fresh document. That is the real scenario — a machine
    //    where field-native has been running and the app is opened onto it.
    const stranger = TerminalCreateResult.parse(
      await opts.handle.client.request("terminal.create", {}),
    ).sessionId;
    opts.toggleGodview(); // closed, so the reload comes up with the deck unmounted
    await deck.until((facts) => !facts.active, "the overlay to close", 20_000);
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
    opts.toggleGodview(); // the fresh document's FIRST open
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

    // 6. Close a pane — and watch the session go on living (GT-D5). The deck
    //    detaches; nothing kills. Ghosttea's own closePane removes the pane
    //    from the layout and sends the floor nothing at all, which is the law
    //    this asserts rather than assumes.
    await focusDeck(win);
    const panesBeforeClose = claimed.panes;
    pressChord(win, "w");
    const closed = await deck.until(
      (facts) => facts.panes === panesBeforeClose - 1,
      "⌘W to close one pane",
      45_000,
    );
    const detached = claimed.sessionIds.find((id) => !closed.sessionIds.includes(id));
    if (detached === undefined) throw new Error("no pane actually left the deck");
    // A settle long enough for a kill to have travelled, then the only question
    // that matters. The lag runs both ways: an inventory that has not yet
    // NOTICED a death would read as survival, so this waits well past the
    // observed round trip before believing the good news.
    await sleep(2_000);
    const afterClose = await listTerminals(opts.handle);
    const survivor = afterClose.find((terminal) => terminal.sessionId === detached);
    if (survivor === undefined) {
      throw new Error(`closing a pane KILLED session ${detached} — GT-D5 broken`);
    }
    if (survivor.exited === true) {
      throw new Error(`closing a pane ended session ${detached} — GT-D5 broken`);
    }
    verdict["closedPaneSurvived"] = detached;
    verdict["panesAfterClose"] = closed.panes;

    // 7. RESTORE, the silent case (GT-3). The document dies and comes back
    //    while the floor does not: same panes, same session ids, and — the
    //    assertion that is about a face NOT being drawn — no consent prompt.
    //    Nothing was lost, so there is nothing to ask, and a prompt here would
    //    be the deck training its user to dismiss the one that matters.
    const beforeReload = [...closed.sessionIds];
    await reopenAfterReload({
      win,
      deck,
      toggleGodview: opts.toggleGodview,
      viteUrl: opts.viteUrl,
    });
    const restored = await deck.until(
      (facts) => facts.active && facts.panes === closed.panes,
      "the deck to come back with the panes it had",
      90_000,
    );
    if (restored.consent !== undefined) {
      throw new Error(
        `an all-alive restore asked for consent it did not need: ${JSON.stringify(restored.consent)}`,
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

    // 9. THE DEGRADE ROW (GT-3, GT-D8). Move a pane into a distinctive folder,
    //    kill its session out from under the deck, and reopen: the deck must
    //    ASK, with honest counts, and a restore must relaunch that pane WHERE
    //    IT WAS. The cwd is the whole point of `paneMeta` — a shell reborn at
    //    `$HOME` is a shell that lost the work it was next to.
    //
    //    A plain `cd` is all it takes, and that is itself the finding: a
    //    session's cwd comes ONLY from what the shell announces over OSC 7 (the
    //    spawn directory is never reported), and this user's zsh announces it
    //    on every prompt. What the floor then reports is that announcement
    //    VERBATIM — a `file://host/path` URL, not a path — which is why the
    //    deck decodes it before spawning anything.
    const workdir = join(scratch, "work");
    mkdirSync(workdir, { recursive: true });
    const doomed = restored.sessionIds[0]!;
    await runInPane(opts.handle, doomed, join(scratch, "cd.txt"), `cd ${workdir}`);
    const withCwd = await untilFloor(
      opts.handle,
      (terminals) => cwdPath(terminals.find((t) => t.sessionId === doomed)?.cwd) === workdir,
      `report ${doomed} sitting in ${workdir} (a pane's cwd is only ever what its shell announced over OSC 7)`,
      20_000,
    );
    const recorded = withCwd.find((t) => t.sessionId === doomed)?.cwd;
    verdict["recordedCwd"] = recorded;
    // The layout has to have PERSISTED that cwd before the session dies —
    // otherwise the restore below would be reading a meta this run never wrote.
    const layoutDeadline = Date.now() + 15_000;
    let persisted = false;
    while (Date.now() < layoutDeadline && !persisted) {
      persisted = ((await readDeckLayout(win)) ?? "").includes(workdir);
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

    await reopenAfterReload({
      win,
      deck,
      toggleGodview: opts.toggleGodview,
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
    // The claim, proven by the pane itself: a real shell, running in the folder
    // the dead one recorded.
    const where = await askPane(opts.handle, replacement, join(scratch, "pwd.txt"), "$PWD");
    verdict["rehydratedCwd"] = where.value;
    // Compared through `realpath` because macOS answers the same directory two
    // ways: the ORIGINAL pane's zsh reported the logical `/var/folders/…` it
    // was told to `cd` into, while the relaunched one was spawned with that
    // path and reports the physical `/private/var/folders/…` the symlink
    // resolves to. Same folder, two spellings — and a string compare would call
    // a working restore a failure.
    if (realpathSync(where.value) !== realpathSync(workdir)) {
      throw new Error(`the relaunched pane came up in ${where.value}, not ${workdir}`);
    }

    // 10. THE KILL ROW (GT-D5). Closing a pane detaches (row 6); killing is a
    //     separate, audited, confirmed act. Driven through the deck's own
    //     affordance — two clicks, because one would be the bug.
    await focusDeck(win);
    // The chip acts on the ACTIVE pane and names no session on screen, so the
    // target is read from the deck rather than chosen here — asserting about a
    // session the chip was never pointed at would be a test of nothing.
    const active = await deck.until(
      (facts) => facts.panes === closed.panes && facts.activeSessionId !== undefined,
      "the deck to name its active pane",
      20_000,
    );
    const killTarget = active.activeSessionId!;
    await clickDeckButton(win, "kill session");
    await clickDeckButton(win, "kill");
    // Two proofs, one for each plane. The floor: the session ends. The
    // renderer: the pane ADMITS it, which no floor query can show.
    await untilFloor(
      opts.handle,
      (terminals) => {
        const row = terminals.find((t) => t.sessionId === killTarget);
        return row === undefined || row.exited === true;
      },
      `end ${killTarget} on the deck's own kill`,
      20_000,
    );
    verdict["killedSession"] = killTarget;
    const degraded = await deck.until(
      (facts) =>
        (facts.exitedSessionIds ?? []).includes(killTarget) ||
        !facts.sessionIds.includes(killTarget),
      "the killed pane to degrade honestly",
      30_000,
    );
    verdict["killedPaneFace"] = (degraded.exitedSessionIds ?? []).includes(killTarget)
      ? "exited"
      : "pane dropped";

    // 11. THE CONFIG ROW (GT-3 rider). A real write through the product door,
    //     the floor's own reload verdict, and the one property that matters
    //     more than any restyle: nothing died for a settings change.
    const beforeConfig = await listTerminals(opts.handle);
    const document = TerminalConfigDocument.parse(
      await opts.handle.client.request("terminal.config.read", {}),
    );
    verdict["configPath"] = document.path;
    verdict["configExisted"] = document.exists;
    // GT-3v: the written text now carries an APPEARANCE-class key. It is the
    // interesting case for this document precisely because 0.9.0 gave the same
    // concept a second, viewer-local home — so the write proves the device file
    // still owns its key, and the deck's own glass (asserted below) proves the
    // two homes do not leak into one another.
    const configText = `# written by pnpm smoke:godview\nfont-size = 13\nbackground-opacity = 0.62\n`;
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
    const afterConfig = await listTerminals(opts.handle);
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
    // the VIEWER's (GT-D12), so the 0.62 just written into the DEVICE file must
    // not have moved this deck. If these ever agree, the two homes have merged
    // and GT-5's phone would inherit this desktop's glass.
    if (glassAfter.paneBackgroundAlpha !== glassBefore.paneBackgroundAlpha) {
      throw new Error(
        `the device config moved the viewer's appearance: ${glassBefore.paneBackgroundAlpha} → ${glassAfter.paneBackgroundAlpha}`,
      );
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
    // Direction two: choosing it wrote NOTHING into the device document. The
    // file is read back whole against the exact bytes row 11 wrote, so any key
    // the appearance path might have appended — a `custom-shader`, a managed
    // block — fails here. If a shader ever does appear in this file because a
    // viewer picked one, the homes have merged and GT-5's phone inherits this
    // desktop's CRT, which is the thing 0.9.0's own changelog forbids.
    const configAfterShader = readFileSync(document.path, "utf8");
    if (configAfterShader !== configText) {
      throw new Error(
        `the viewer's shader leaked into the device config document: ${JSON.stringify(configAfterShader)}`,
      );
    }
    verdict["shaderLeftConfigAlone"] = true;

    // 12. The recovery row, inherited from the GT-1 spike: SIGKILL the bridge
    //    and watch the deck come back on a new runtime with the same sessions.
    //    field-native owns them; the bridge is only a pipe.
    //
    //    The survivor set is whatever the deck holds NOW — rows 9 to 11 have
    //    moved it since the close row, and a recovery that had to reproduce a
    //    stale list would be asserting about a deck that no longer exists.
    //    The killed session is excluded: a rebuild does not resurrect, and
    //    demanding it back would make a passing recovery impossible.
    const current = deck.current();
    if (current === null) throw new Error("the deck said nothing before the bridge kill");
    const survivors = current.sessionIds.filter((id) => id !== killTarget);
    const panesBeforeKill = current.panes;
    const pid = killTerminalBridge();
    if (pid === null) throw new Error("no ghosttea bridge utility process to kill");
    verdict["bridgeKilledPid"] = pid;
    const recovered = await deck.until(
      (facts) =>
        facts.active &&
        facts.panes === panesBeforeKill &&
        survivors.every((id) => facts.sessionIds.includes(id)),
      "the deck to rebuild itself on a new bridge with the same sessions",
      120_000,
    );
    verdict["recoveredPanes"] = recovered.panes;
    verdict["recoveredBackend"] = recovered.rendererBackend;
    await untilFloor(
      opts.handle,
      (terminals) => survivors.every((id) => terminals.some((t) => t.sessionId === id)),
      "still listed every session after the bridge died",
      15_000,
    );

    // ── GT-3p, REPORT-ONLY ────────────────────────────────────────────────
    // Everything below records numbers and asserts nothing. A performance row
    // that could fail this smoke would be a budget nobody has agreed to yet
    // (the `keystrokeEchoMs` precedent, GT-3), and these numbers move with
    // machine load — the same load that already makes the reload rows flaky.
    //
    // THE COLD OPEN, and it is genuinely cold even though the prewarm is on:
    // row 1 presses ⌘⎋ the moment the canvas reports, and `claimWarmTransport`
    // deliberately never blocks an open on a warm still in flight (GT-D14) — so
    // the first open of this harness takes the cold path by construction, and
    // `prewarmed: false` in this object is the proof rather than a disappointment.
    // It is the BEFORE number, measured on the same run as the after.
    verdict["coldOpen"] = await coldOpenLine
      .then((raw) => JSON.parse(raw) as Record<string, unknown>)
      .catch((error) => ({ unmeasured: error instanceof Error ? error.message : String(error) }));

    // The steady-state frame cost, sampled from the page itself while the
    // overlay is open with the swarm running and a pane focused. One second of
    // rAF intervals; the median is the honest summary of a sample this short.
    verdict["frameMs"] = await win.webContents
      .executeJavaScript(
        `new Promise((resolve) => {
          const intervals = [];
          let last = performance.now();
          const tick = (now) => {
            intervals.push(now - last);
            last = now;
            if (now - start < 1000) requestAnimationFrame(tick);
            else {
              const sorted = intervals.slice(1).sort((a, b) => a - b);
              resolve(sorted.length === 0 ? null : {
                frames: sorted.length,
                p50: Math.round(sorted[Math.floor(sorted.length * 0.5)] * 10) / 10,
                p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10,
              });
            }
          };
          const start = performance.now();
          requestAnimationFrame(tick);
        })`,
      )
      .catch((error) => ({ unmeasured: error instanceof Error ? error.message : String(error) }));

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
      opts.toggleGodview();
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
      opts.toggleGodview();
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
  console.log(`SMOKE_GODVIEW ${JSON.stringify(verdict)}`);
  rmSync(scratch, { recursive: true, force: true });
  await teardown(opts.supervisor, opts.root, opts.beforeExit);
  app.exit(verdict["ok"] === true ? 0 : 2);
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
