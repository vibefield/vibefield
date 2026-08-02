import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GhostteaAutomationClient } from "@vibecook/ghosttea-client";
import { TerminalCreateResult, TerminalListResult, TerminalTicket } from "@vibefield/contracts";
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
}

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

/** The type/echo proof, driven over the floor's OWN control socket.
 *
 * `GhostteaAutomationClient` is ghosttea's Node door onto a session — the same
 * socket and token the deck's bridge dialed, redeemed through the same
 * `terminal.openTicket` any attach uses. `pasteAndSubmit` writes into the real
 * PTY, so what runs is the user's real login shell interpreting a real command.
 * The proof is its SIDE EFFECT: the shell writes a marker to a file main then
 * reads. A screen scrape would prove less — the file only exists if the process
 * on the other end actually ran the line. That the echo also came BACK to the
 * deck is the deck's own business, and its marker line reports the panes that
 * are drawing it. */
async function proveEcho(
  handle: FielddHandle,
  sessionId: string,
  markerPath: string,
): Promise<string> {
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
    await automation.pasteAndSubmit(sessionId, `echo ${marker} > ${markerPath}\n`);
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        if (readFileSync(markerPath, "utf8").includes(marker)) return marker;
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

/** GT-2: the product Godview, end to end, against the real pair.
 *
 * Everything the deck does here it does because a user asked: the overlay opens
 * through the accelerator's own action, panes split and close through the
 * workspace's own ⌘D/⌘W, and the shells are fieldd's. The harness only presses
 * things and reads two sources of truth — the floor's inventory for what
 * exists, the deck's own marker for what is on screen.
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

    // 1. ⌘G's own action — the overlay opens and asks fieldd for a free shell.
    opts.toggleGodview();
    const opened = await deck.until(
      (facts) => facts.active && facts.panes >= 1,
      "the overlay to open with a free shell in a pane",
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

    // The shell is a FLOOR session, not a renderer's idea of one.
    const afterOpen = await untilFloor(
      opts.handle,
      (terminals) => terminals.some((terminal) => terminal.sessionId === freeShell),
      `listed the deck's free shell ${freeShell}`,
      15_000,
    );
    verdict["freeShellCreated"] = afterOpen.length > before.length;

    // 2. Type, and prove the shell ran it.
    verdict["echo"] = await proveEcho(opts.handle, freeShell, join(scratch, "echo.txt"));

    // 3. Split — the workspace's own ⌘D, which routes through the deck's
    //    createSplitSession and so mints another FLOOR session.
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
      (terminals) => terminals.some((terminal) => terminal.sessionId === splitSession),
      `listed the split session ${splitSession}`,
      15_000,
    );
    verdict["splitCreated"] = true;

    // 4. A session born on the floor OUTSIDE the deck, which the deck must
    //    adopt on its next open — `claimExistingSessions` covers only the first
    //    ever open, so this is the product rule doing the work.
    const stranger = TerminalCreateResult.parse(
      await opts.handle.client.request("terminal.create", {}),
    ).sessionId;
    opts.toggleGodview(); // closed
    await deck.until((facts) => !facts.active, "the overlay to close", 20_000);
    opts.toggleGodview(); // open again
    const claimed = await deck.until(
      (facts) => facts.active && facts.sessionIds.includes(stranger),
      "the deck to claim the floor session it did not create",
      45_000,
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

    // 5. Close a pane — and watch the session go on living (GT-D5). The deck
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

    // 6. The recovery row, inherited from the GT-1 spike: SIGKILL the bridge
    //    and watch the deck come back on a new runtime with the same sessions.
    //    field-native owns them; the bridge is only a pipe.
    const survivors = [...closed.sessionIds];
    const pid = killTerminalBridge();
    if (pid === null) throw new Error("no ghosttea bridge utility process to kill");
    verdict["bridgeKilledPid"] = pid;
    const recovered = await deck.until(
      (facts) =>
        facts.active &&
        facts.panes === closed.panes &&
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
