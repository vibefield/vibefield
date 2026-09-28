// vibefield-terminal-perf-lab-only
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { BrowserWindow } from "electron";
import { pasteTerminalLine } from "./terminal-startup-benchmark";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (ok: unknown, message: string): void => {
  if (!ok) throw new Error(message);
};

/** Shipping Electron UI and native floor, in the perf runner's isolated person.
 * No runtime mocks or owner-profile commands. Geometry samples are observations
 * of CSS layout, not physical display presentation timestamps. */
export async function measureTerminalPaneRegression(options: {
  win: BrowserWindow;
  out: string;
  split(): void;
  close(): void;
  floor(): Promise<readonly { sessionId: string }[]>;
  monitorCount(): number | undefined;
}): Promise<void> {
  const { win, out } = options;
  const results: Record<string, unknown> = {};
  const read = <T>(source: string): Promise<T> =>
    win.webContents.executeJavaScript(source) as Promise<T>;
  const panes = () =>
    read<Array<{ id: string; session: string; width: number; height: number; active: boolean }>>(`
    [...document.querySelectorAll('.ghostty-pane')].map(p => ({
      id: p.dataset.paneId, session: p.querySelector('canvas')?.getAttribute('aria-label')?.replace('Terminal session ', ''),
      width: p.clientWidth, height: p.clientHeight, active: p.classList.contains('is-active')
    }))`);
  const until = async (
    predicate: () => Promise<boolean>,
    label: string,
    timeoutMs = 15_000,
  ): Promise<void> => {
    const start = Date.now();
    while (!(await predicate())) {
      if (Date.now() - start > timeoutMs) throw new Error(`Timed out: ${label}`);
      await sleep(25);
    }
  };
  const inputReady = () =>
    until(
      () =>
        read<boolean>(`(() => {
        const input = document.querySelector('.ghostty-pane.is-active .terminal-input');
        return input && !input.readOnly;
      })()`),
      "active pane accepting input",
    );
  try {
    await until(
      () => read<boolean>("!document.querySelector('.vf-splash')"),
      "startup overlay retired",
      60_000,
    );
    await sleep(250); // Outlive the app-entry transform after the splash retires.
    await inputReady();
    const first = (await panes())[0]!;
    await read(`document.querySelector('[aria-label="LIST view"]').click()`);
    await until(
      () => read<boolean>("Boolean(document.querySelector('.vf-monitor-list-new'))"),
      "new terminal action",
    );
    const firstReplacingAt = performance.now();
    await read(`document.querySelector('.vf-monitor-list-new').click()`);
    await until(
      async () => (await panes())[0]?.session !== first.session,
      "initial empty shell replaced",
    );
    await inputReady();
    await until(async () => options.monitorCount() === 1, "initial empty bubble removed");
    results.initialEmptyBubbleReplaceMs = performance.now() - firstReplacingAt;
    await until(
      async () => !(await options.floor()).some((row) => row.sessionId === first.session),
      "initial empty shell exited",
    );
    results.initialEmptyProcessExitMs = performance.now() - firstReplacingAt;
    // The geometry/switching witnesses below need two retained sessions.
    await pasteTerminalLine(win, (await panes())[0]!.session, "printf 'base retention witness\\n'");
    await sleep(150);
    await read(`document.querySelector('.terminal-input').focus()`);
    options.split();
    await until(async () => (await panes()).length === 2, "first split");
    await read(`document.querySelector('.ghostty-pane.is-active .terminal-input').focus()`);
    await sleep(150);
    options.split();
    await until(async () => (await panes()).length === 3, "second split");
    await until(async () => options.monitorCount() === 3, "three monitor bubbles");
    await inputReady();
    const three = await panes();
    const unused = three.find((p) => p.active)!;
    await read(`document.querySelector('.ghostty-pane.is-active .terminal-input').focus()`);
    await sleep(150);
    const closingAt = performance.now();
    options.close();
    await until(async () => (await panes()).length === 2, "unused pane removed");
    await until(async () => options.monitorCount() === 2, "unused bubble removed");
    results.unusedBubbleCloseMs = performance.now() - closingAt;
    await until(
      async () => !(await options.floor()).some((row) => row.sessionId === unused.session),
      "unused shell exited",
    );
    results.unusedProcessExitMs = performance.now() - closingAt;
    const two = await panes();
    await inputReady();
    check(Math.abs(two[0]!.width - two[1]!.width) <= 2, "surviving panes must have equal widths");
    results.survivingWidths = two.map((p) => p.width);

    // Measure canvas scale in its own layout coordinates: app-entry transforms
    // are independent of this gesture. Capture every frame and content resize, retaining the
    // original canvas reference to catch remounts as well as scaling.
    for (const direction of ["enter", "leave"]) {
      await read(`(() => {
        const pane = document.querySelector('.ghostty-pane.is-active');
        const button = pane.querySelector('.vf-pane-verb.is-zoom');
        if (!button) throw new Error('empty pane has no fullscreen button');
        const surface = pane.querySelector('.terminal-surface'), canvas = pane.querySelector('canvas');
        const host = pane.closest('.vf-deck-zoom');
        const geometry = c => { const m = new DOMMatrixReadOnly(getComputedStyle(c).transform); return {width:c.clientWidth*m.a, height:c.clientHeight*m.d}; };
        const initial = geometry(canvas);
        const probe = window.__vfPaneProbe = { frames: [], resizes: [], canvas, before: { width: initial.width, height: initial.height }, done: false };
        const ro = new ResizeObserver(([e]) => probe.resizes.push({ phase: host.dataset.zoomPhase, width: e.contentRect.width, height: e.contentRect.height }));
        ro.observe(surface);
        const start = performance.now();
        let settledFrames = 0;
        function tick() {
          const r = geometry(canvas);
          probe.frames.push({ ms: performance.now()-start, phase: host.dataset.zoomPhase, width: r.width, height: r.height,
            sameCanvas: canvas === pane.querySelector('canvas') && canvas.isConnected, bitmapWidth: canvas.width, bitmapHeight: canvas.height, dpr: devicePixelRatio });
          settledFrames = ['zoomed', 'idle'].includes(host.dataset.zoomPhase) ? settledFrames + 1 : 0;
          // A capture or host scheduling stall can put the settlement and this
          // rAF in the same frame, before ResizeObserver delivery. Observe two
          // more frames so the result includes the committed geometry.
          if (performance.now()-start < 650 || settledFrames < 3) requestAnimationFrame(tick);
          else { ro.disconnect(); probe.done = true; }
        }
        requestAnimationFrame(tick);
        if (${JSON.stringify(direction)} === 'leave') {
          pane.querySelector('.terminal-input').focus();
          pane.querySelector('.terminal-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
        } else button.click();
      })()`);
      await sleep(100);
      writeFileSync(
        join(out, `zoom-${direction}-moving.png`),
        (await win.webContents.capturePage()).toPNG(),
      );
      await until(async () => read<boolean>("window.__vfPaneProbe.done"), `${direction} animation`);
      const probe = await read<{
        before: { width: number; height: number };
        frames: Array<{
          phase: string;
          width: number;
          height: number;
          sameCanvas: boolean;
          bitmapWidth: number;
          bitmapHeight: number;
          dpr: number;
        }>;
        resizes: Array<{ phase: string; width: number; height: number }>;
      }>(
        "({before:window.__vfPaneProbe.before,frames:window.__vfPaneProbe.frames,resizes:window.__vfPaneProbe.resizes})",
      );
      results[direction] = probe;
      check(
        probe.frames.every(
          (f) =>
            f.sameCanvas &&
            Math.abs(f.width - f.bitmapWidth / f.dpr) < 0.1 &&
            Math.abs(f.height - f.bitmapHeight / f.dpr) < 0.1,
        ),
        "zoom must retain a canvas displayed at its bitmap pixel scale",
      );
      const moving = probe.frames.filter((f) => f.phase === "entering" || f.phase === "leaving");
      check(moving.length > 0, "animation was not sampled");
      check(
        moving.every(
          (f) =>
            Math.abs(f.width - probe.before.width) < 0.1 &&
            Math.abs(f.height - probe.before.height) < 0.1,
        ),
        "animation changed the original terminal box",
      );
      check(
        new Set(moving.map((f) => `${f.width}:${f.height}`)).size === 1,
        "canvas geometry changed during animation",
      );
      check(
        probe.resizes.filter((r) => r.phase === "zoomed" || r.phase === "idle").length === 1,
        "terminal must resize exactly once at settlement",
      );
      writeFileSync(
        join(out, `zoom-${direction}-settled.png`),
        (await win.webContents.capturePage()).toPNG(),
      );
    }
    const used = (await panes()).find((p) => p.active)!;
    await pasteTerminalLine(win, used.session, "printf 'pane retention witness\\n'");
    await sleep(300);
    options.close();
    await until(async () => (await panes()).length === 1, "used pane detached");
    check(
      (await options.floor()).some((row) => row.sessionId === used.session),
      "used session was killed",
    );
    await until(async () => options.monitorCount() === 2, "used bubble retained");
    results.usedSessionRetained = true;
    await read(`document.querySelector('[aria-label="LIST view"]').click()`);
    await until(
      async () => read<boolean>("document.querySelectorAll('.vf-monitor-list-row').length === 2"),
      "monitor list",
    );
    const switches: unknown[] = [];
    results.attachSwitches = switches;
    for (let i = 0; i < 8; i++) {
      await read(`document.querySelectorAll('.vf-monitor-list-row')[${i % 2}].click()`);
      const samples = await read<
        Array<{ session: string; cssWidth: number; bitmapWidth: number; dpr: number }>
      >(`new Promise(resolve => {
        const samples = [];
        function tick() {
          const c = document.querySelector('.ghostty-pane canvas');
          if (c) samples.push({session: c.getAttribute('aria-label'), cssWidth: c.clientWidth * new DOMMatrixReadOnly(getComputedStyle(c).transform).a, bitmapWidth: c.width, dpr: devicePixelRatio});
          if (samples.length < 12) requestAnimationFrame(tick); else resolve(samples);
        }
        requestAnimationFrame(tick);
      })`);
      switches.push(samples);
      check(
        samples.every((s) => Math.abs(s.cssWidth - s.bitmapWidth / s.dpr) < 0.1),
        "attach stretched the terminal bitmap",
      );
      await inputReady();
    }
    // A replacement is a detach even though the pane itself survives. The
    // unlinked row is the other retained session; clicking it must reap only
    // the untouched shell just created in the active split.
    await read(`document.querySelector('.ghostty-pane.is-active .terminal-input').focus()`);
    options.split();
    await until(async () => (await panes()).length === 2, "replacement witness split");
    await inputReady();
    await until(async () => options.monitorCount() === 3, "replacement witness bubbles");
    const replaced = (await panes()).find((pane) => pane.active)!;
    const replacingAt = performance.now();
    await read(`(() => {
      const row = document.querySelector('.vf-monitor-list-row:not(.is-linked)');
      if (!row) throw new Error('no detached session to attach');
      row.click();
    })()`);
    await until(
      async () => (await panes()).every((pane) => pane.session !== replaced.session),
      "empty shell lost its attachment",
    );
    await until(async () => options.monitorCount() === 2, "replaced empty bubble removed");
    results.unusedBubbleReplaceMs = performance.now() - replacingAt;
    check((await panes()).length === 2, "replacement must preserve the pane");
    await until(
      async () => !(await options.floor()).some((row) => row.sessionId === replaced.session),
      "replaced empty shell exited",
    );
    results.unusedReplacedProcessExitMs = performance.now() - replacingAt;
    await inputReady();
    writeFileSync(join(out, "attach-settled.png"), (await win.webContents.capturePage()).toPNG());
    results.passed = true;
  } catch (error) {
    results.failure = error instanceof Error ? error.message : String(error);
    writeFileSync(join(out, "failure.png"), (await win.webContents.capturePage()).toPNG());
    throw error;
  } finally {
    writeFileSync(join(out, "pane-regression.json"), `${JSON.stringify(results, null, 2)}\n`);
  }
}
