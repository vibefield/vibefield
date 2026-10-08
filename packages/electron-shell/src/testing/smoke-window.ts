// DK-18 (plan (36)) — A SMOKE'S WINDOW, KEPT FROM THE PERSON'S INPUT. The smokes run on a Mac someone is using: DK-10b's
// recorder caught a person's pointer and keys waking a smoke's resting desk, and DK-17b met a REAL pointer inside smoke:canvas
// (B's first published point fractional — a person's, not the smoke's move — and PRESENCE_REST counting `wakes {input: 2}`).
// A row that injects the first fact can meet it. So a desk smoke's window is:
//   CLICK-THROUGH (`setIgnoreMouseEvents`) for its whole life — a real pointer over it lands on whatever lies beneath, and
//   Chromium sends its page nothing (no move, no enter, no leave); the smoke's own pointer goes in by `sendInputEvent`,
//   which reaches the page all the same (DK-18's probe: move, down, up, click and the leave arrive, trusted);
//   SHOWN INACTIVE (`showInactive`), and never focused by a row (`win.focus()` makes the app active and the window key, and
//   the person's keys follow) — the smoke's keys go in by `sendInputEvent`, which needs no key window: the page takes them
//   into its focused element, text included (the probe), and KEYS witnesses exactly that event-less focus path (plan (94)).
// The godview smoke keeps its own windows' focus: its typed rows need `document.hasFocus()` (a pane takes input focus only
// then) — the pointer half holds there too.

import type { BrowserWindow } from "electron";
import type { ShellMode } from "../main/modes";
import { createMainWindow } from "../main/windows";

/** How many times each smoke window became the key window, by its id — kept after it closes (B closes mid-run). */
const keyed = new Map<number, number>();

/** The product's main window for a smoke, kept from the person's input (above); each time it becomes the key window is
 * counted (`smokeWindowsFocused`) — a row may then say the person's keys could have followed it. */
export function smokeWindow(opts: {
  mode: ShellMode;
  preloadPath: string;
  show: boolean;
}): BrowserWindow {
  const win = createMainWindow({ mode: opts.mode, preloadPath: opts.preloadPath, show: false });
  keepFromPerson(win);
  const id = win.id;
  keyed.set(id, 0);
  win.on("focus", () => keyed.set(id, (keyed.get(id) ?? 0) + 1));
  if (opts.show) win.showInactive();
  return win;
}

/** The smoke windows made so far, and how many times in all one became the key window. */
export function smokeWindowsFocused(): { readonly windows: number; readonly times: number } {
  let times = 0;
  for (const n of keyed.values()) times += n;
  return { windows: keyed.size, times };
}

/** A real pointer passes through the window to what lies beneath it; the smoke's injected input still reaches its page. */
export function keepFromPerson(win: BrowserWindow): void {
  win.setIgnoreMouseEvents(true);
}
