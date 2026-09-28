// vibefield-terminal-perf-lab-only
import { randomUUID } from "node:crypto";
import { readFileSync, watch, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { quantile } from "@vibefield/terminal-perf/ab";
import type { BrowserWindow } from "electron";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const quote = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`;

/** Window-local paste through TerminalSurface's shipping handler, then Return.
 * No clipboard mutation, OS input injection or terminal automation side door. */
export async function pasteTerminalLine(
  win: BrowserWindow,
  sessionId: string,
  line: string,
): Promise<void> {
  const accepted = await win.webContents.executeJavaScript(`(() => {
    const canvas = [...document.querySelectorAll('canvas')].find(el =>
      el.getAttribute('aria-label') === ${JSON.stringify(`Terminal session ${sessionId}`)});
    const input = canvas?.parentElement?.querySelector('.terminal-input');
    if (!input || input.readOnly) return false;
    input.focus();
    const data = new DataTransfer(); data.setData('text/plain', ${JSON.stringify(line)});
    input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    return document.activeElement === input;
  })()`);
  if (!accepted) throw new Error("The target pane is not accepting input");
  win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
  win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
}

/** One directory watcher for the entire run. Registering a macOS filesystem
 * watcher can itself stall under load; registration is outside every sample. */
function acknowledgments(out: string) {
  const pending = new Map<string, { nonce: string; resolve(): void; reject(error: Error): void }>();
  const inspect = (name: string): void => {
    const entry = pending.get(name);
    if (!entry) return;
    try {
      if (readFileSync(join(out, name), "utf8") === entry.nonce) entry.resolve();
    } catch {
      // File creation and writing may be distinct filesystem events.
    }
  };
  const watcher = watch(out, (_event, name) => {
    if (name) inspect(name.toString());
  });
  let watcherError: Error | undefined;
  watcher.on("error", (error) => {
    watcherError = error;
    for (const entry of pending.values()) entry.reject(error);
  });
  const fallback = setInterval(() => {
    for (const name of pending.keys()) inspect(name);
  }, 10);
  return {
    async command(win: BrowserWindow, sessionId: string): Promise<number> {
      if (watcherError) throw watcherError;
      const nonce = randomUUID();
      const name = `ack-${nonce}.txt`;
      let rejectAnswer = (_error: Error): void => {};
      const answer = new Promise<void>((resolve, reject) => {
        rejectAnswer = reject;
        pending.set(name, { nonce, resolve, reject });
      });
      void answer.catch(() => undefined);
      const deadline = setTimeout(
        () => rejectAnswer(new Error("shell acknowledgment timed out")),
        15_000,
      );
      const began = performance.now();
      try {
        await pasteTerminalLine(
          win,
          sessionId,
          `printf %s ${quote(nonce)} > ${quote(join(out, name))}`,
        );
        await answer;
        return performance.now() - began;
      } finally {
        clearTimeout(deadline);
        pending.delete(name);
      }
    },
    close(): void {
      clearInterval(fallback);
      watcher.close();
    },
  };
}

interface Deck {
  panes: number;
  sessionIds: string[];
}

export async function measureTerminalStartup(options: {
  win: BrowserWindow;
  out: string;
  count: number;
  current(): Deck | null;
  inputReady(sessionId: string): Promise<void>;
  until(predicate: (deck: Deck) => boolean, what: string, timeout: number): Promise<Deck>;
  split(): void;
  close(): void;
}): Promise<void> {
  const { win, out, count } = options;
  if (!Number.isInteger(count) || count < 3 || count > 100)
    throw new Error("startup samples must be 3–100");
  const anchor = options.current()?.sessionIds[0];
  if (!anchor) throw new Error("startup benchmark requires an anchor pane");
  const samples: Array<{
    round: number;
    paneVisibleMs?: number;
    inputReadyMs?: number;
    readyMs?: number;
    commandMs?: number;
    nullBeforeMs?: number;
    nullAfterMs?: number;
    failure?: string;
    load: number[];
  }> = [];
  const save = (): void => {
    const ready = samples.flatMap((row) =>
      row.failure || row.readyMs === undefined ? [] : [row.readyMs],
    );
    writeFileSync(
      join(out, "startup.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          measured: "window-local split chord through execution of one pasted shell command",
          excludes: ["OS input dispatch", "physical display presentation"],
          shellProfile: "isolated lab person; owner dotfiles are not loaded",
          observer: "filesystem event with a 10 ms polling fallback; one attempt, no silent retry",
          summary: {
            attempts: samples.length,
            succeeded: ready.length,
            p50Ms: quantile(ready, 0.5),
            p95Ms: quantile(ready, 0.95),
            maxMs: ready.length ? Math.max(...ready) : null,
          },
          tailQualification:
            "descriptive only; ready-pane commands bracket each split as host-noise controls",
          samples,
        },
        null,
        2,
      )}\n`,
    );
  };
  const ack = acknowledgments(out);
  try {
    // An acknowledged command, outside all measured rounds, proves the anchor
    // is ready. DOM presence alone is not a readiness witness.
    try {
      await options.inputReady(anchor);
      await ack.command(win, anchor);
    } catch (error) {
      save();
      throw error;
    }
    for (let round = 0; round < count; round++) {
      const row: (typeof samples)[number] = { round, load: loadavg() };
      samples.push(row);
      let created: string | undefined;
      try {
        row.nullBeforeMs = await ack.command(win, anchor);
        const before = new Set(options.current()?.sessionIds ?? []);
        const began = performance.now();
        options.split();
        const deck = await options.until(
          (value) => value.sessionIds.some((id) => !before.has(id)),
          "the new pane",
          15_000,
        );
        row.paneVisibleMs = performance.now() - began;
        created = deck.sessionIds.find((id) => !before.has(id));
        if (!created) throw new Error("new pane has no session");
        await options.inputReady(created);
        row.inputReadyMs = performance.now() - began;
        row.commandMs = await ack.command(win, created);
        row.readyMs = performance.now() - began;
        options.close();
        await options.until(
          (value) => !value.sessionIds.includes(created!),
          "the split to close",
          15_000,
        );
        created = undefined;
        row.nullAfterMs = await ack.command(win, anchor);
      } catch (error) {
        row.failure = error instanceof Error ? error.message : "benchmark failed";
        save();
        // Stop after a failed sample: continuing could type into the wrong pane.
        throw error;
      }
      save();
      await sleep(100);
    }
  } finally {
    ack.close();
  }
}
