import type { FrameView } from "@vibefield/contracts";
import type { GlyphName } from "@vibefield/design-kit/glyphs";
import type { LinePane } from "./line-door";

// @'S LIST (DESIGN.md §8 "The line"; One Frame FC-D1: @ is typed, never a
// button). What it offers, as data: Send to — the panes the deck shows, each
// named as the swarm names its body — and Add — the clipboard's newest, a
// file, a capture, a past session. Read bottom-up, nearest first: the list
// grows upward from the line, so the row nearest the line is the one a Return
// takes. Typing after the @ filters both groups.

/** One of the clipboard's stills, as the list's thumbnail shows it. */
export interface AtMini {
  readonly id: string;
  /** "1440 × 900" */
  readonly label: string;
  readonly path: string;
  /** Through the shell's still scheme; null where there is none to show. */
  readonly url: string | null;
}

export interface AtSendRow {
  readonly kind: "send";
  readonly id: string;
  readonly sessionId: string;
  readonly name: string;
  /** What runs there, and whether it is the active pane. */
  readonly sub: string;
  /** The state in words ("working", "waiting on you"), or "" for a shell. */
  readonly state: string;
  readonly dot: "green" | "orange" | null;
}

export interface AtClipRow {
  readonly kind: "clip";
  readonly id: "clipboard";
  /** The three newest, newest first. */
  readonly minis: readonly AtMini[];
  readonly count: number;
}

export interface AtAddRow {
  readonly kind: "add";
  readonly id: "file" | "capture" | "past";
  readonly label: string;
  readonly glyph: GlyphName;
  /** Why the row cannot be taken here, said in it; null when it can. */
  readonly why: string | null;
}

export type AtRow = AtSendRow | AtClipRow | AtAddRow;

export interface AtList {
  /** Top to bottom, as drawn. */
  readonly add: readonly (AtClipRow | AtAddRow)[];
  /** Top to bottom, as drawn — the nearest pane is LAST, against the line. */
  readonly send: readonly AtSendRow[];
  readonly sendEyebrow: string;
  /** What the Send to group says when it has no row; null when it has rows. */
  readonly sendQuiet: string | null;
}

export interface AtSources {
  readonly view: FrameView;
  readonly panes: readonly LinePane[];
  /** The clipboard, newest first. */
  readonly clipboard: readonly AtMini[];
  /** Whether a capture door is here at all (a browser harness has none). */
  readonly canCapture: boolean;
  readonly query: string;
}

const STATE_WORD: Record<NonNullable<LinePane["state"]>, string> = {
  working: "working",
  idle: "idle",
  blocked: "waiting on you",
};

function matches(query: string, ...words: readonly string[]): boolean {
  if (query === "") return true;
  const needle = query.toLowerCase();
  return words.some((word) => word.toLowerCase().includes(needle));
}

export function atList(sources: AtSources): AtList {
  const { query } = sources;
  // Nearest first: the active pane, then the deck's others in its own order.
  const nearest = [...sources.panes].sort((a, b) => Number(b.active) - Number(a.active));
  const send = nearest
    .filter((pane) => matches(query, pane.name, pane.runs))
    .map(
      (pane): AtSendRow => ({
        kind: "send",
        id: `send:${pane.sessionId}`,
        sessionId: pane.sessionId,
        name: pane.name,
        sub: pane.active ? `${pane.runs} · the active pane` : pane.runs,
        state: pane.state === null ? "" : STATE_WORD[pane.state],
        dot: pane.state === "working" ? "green" : pane.state === "blocked" ? "orange" : null,
      }),
    )
    .reverse();
  const add: (AtClipRow | AtAddRow)[] = [];
  if (matches(query, "From the clipboard", "screenshot")) {
    add.push({
      kind: "clip",
      id: "clipboard",
      minis: sources.clipboard.slice(0, 3),
      count: sources.clipboard.length,
    });
  }
  const rows: AtAddRow[] = [
    {
      kind: "add",
      id: "file",
      label: "File…",
      glyph: "folder",
      why: "No file door on the desktop yet",
    },
    {
      kind: "add",
      id: "capture",
      label: "Capture…",
      glyph: "capture",
      why: sources.canCapture ? null : "No capture here",
    },
    {
      kind: "add",
      id: "past",
      label: "Past session…",
      glyph: "history",
      why: "History is not wired yet",
    },
  ];
  for (const row of rows) if (matches(query, row.label)) add.push(row);
  const empty = sources.panes.length === 0;
  return {
    add,
    send,
    sendEyebrow: sources.view === "godview" ? "Send to a pane" : "Send to",
    sendQuiet: send.length > 0 ? null : empty ? "No panes open yet" : `No pane matches “${query}”`,
  };
}

/** Whether a row can be taken: a clipboard with nothing in it, and a door that
 * is not here, cannot. */
export function atTakeable(row: AtRow): boolean {
  if (row.kind === "clip") return row.count > 0;
  if (row.kind === "add") return row.why === null;
  return true;
}

/** The rows a hot highlight can stop on, top to bottom as drawn. */
export function atStops(list: AtList): AtRow[] {
  return [...list.add, ...list.send].filter(atTakeable);
}

/** The row a Return takes before anything is pointed at: the nearest. */
export function atDefaultHot(list: AtList): string | null {
  const stops = atStops(list);
  return stops[stops.length - 1]?.id ?? null;
}

/** ↑ goes away from the line, ↓ toward it; both stop at the ends. */
export function atMove(list: AtList, hot: string | null, direction: "up" | "down"): string | null {
  const stops = atStops(list);
  if (stops.length === 0) return null;
  const at = stops.findIndex((row) => row.id === hot);
  if (at === -1) return atDefaultHot(list);
  const next = direction === "up" ? Math.max(0, at - 1) : Math.min(stops.length - 1, at + 1);
  return stops[next]?.id ?? null;
}

export function atRow(list: AtList, id: string | null): AtRow | null {
  if (id === null) return null;
  return [...list.add, ...list.send].find((row) => row.id === id) ?? null;
}
