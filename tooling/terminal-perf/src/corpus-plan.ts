// WHAT THE CORPUS CONTAINS — one list, read by the capture and by the manifest.
//
// Two families, because the spec asked for one corpus and the spike could only
// supply half of it (see `byte-traces.ts` for the provenance correction):
//
//   * REPLAYED   — the eleven BASE-1 generators, written into a real cell by the
//     fixture pty program. Byte-reproducible: the same seed and scale produce
//     the same source bytes on any machine, so a re-capture differs only in the
//     cell's cadence.
//   * RECORDED   — real programs, run for real in a real cell. NOT byte
//     reproducible (a `top` sample is of this machine at this moment), which is
//     the price of covering the classes §19.2 actually names. The manifest
//     carries the exact argv so a re-run is a run, not a guess.
//
// Absent, and named rather than quietly missing: `nvim`, `htop`, and an agent
// TUI are not installed on the capture host, so the corpus covers their CLASSES
// through `vim`, `top`, and `alt-animation` and does not pretend to cover the
// programs. A corpus entry that does not exist is better than one that lies
// about what produced it.
import type { GhostteaAutomationClient } from "@vibecook/ghosttea-client";

/** The corpus geometry. 100x30 matches fieldd's own spawn size
 * (`packages/fieldd/src/terminal-service.ts:71-72`), so a corpus frame is the
 * size the product actually produces rather than a benchmark-friendly one. */
export const CORPUS_COLS = 100;
export const CORPUS_ROWS = 30;

export interface ReplayEntry {
  readonly kind: "replay";
  readonly name: string;
  readonly covers: string;
  /** Requested output rate in bytes/second. 0 = as fast as the pty accepts —
   * the uncapped flood arm, whose real rate is set by pty backpressure. */
  readonly bytesPerSecond: number;
  /** How long the replay should RUN. The trace loops to fill it. This, not the
   * trace's byte count, is what decides how many frames the entry yields: the
   * cell coalesces to at most one frame per render cycle. */
  readonly targetMs: number;
  readonly settleMs?: number;
}

export interface RecordEntry {
  readonly kind: "record";
  readonly name: string;
  readonly covers: string;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  /** Keystrokes to send once the program is up, with the gaps between them. */
  readonly drive?: readonly { readonly afterMs: number; readonly text: string }[];
  readonly settleMs?: number;
  readonly timeoutMs?: number;
}

export type CorpusEntry = ReplayEntry | RecordEntry;

/** The replayed half — one entry per BASE-1 generator.
 *
 * Cadence is chosen per class rather than uniformly: replaying an editing trace
 * at flood speed would record a flood, and replaying a flood at editing speed
 * would record neither. `bulk-styled` and `redraw-heavy` run uncapped because
 * their whole subject is what the cell does when bytes outrun the display. */
export const REPLAY_ENTRIES: readonly ReplayEntry[] = [
  // Paced entries: a rate a real program plausibly produces, held long enough
  // for the cell to emit a distribution rather than a handful of frames.
  {
    kind: "replay",
    name: "mode-setter",
    covers: "mode/tab-stop/margin/title state",
    bytesPerSecond: 24_000,
    targetMs: 5_000,
  },
  {
    kind: "replay",
    name: "alternate-screen-active",
    covers: "alt-screen switching, ends in alt",
    bytesPerSecond: 16_000,
    targetMs: 5_000,
  },
  {
    kind: "replay",
    name: "alternate-screen-exited",
    covers: "alt-screen switching, returns to primary",
    bytesPerSecond: 16_000,
    targetMs: 5_000,
  },
  {
    kind: "replay",
    name: "query",
    covers: "DSR/CPR query round trips",
    bytesPerSecond: 8_000,
    targetMs: 5_000,
  },
  {
    kind: "replay",
    name: "fragmenter",
    covers: "unicode + escape atoms interleaved",
    bytesPerSecond: 12_000,
    targetMs: 5_000,
  },
  {
    kind: "replay",
    name: "counter",
    covers: "plain append-only lines",
    bytesPerSecond: 24_000,
    targetMs: 5_000,
  },
  // The flood arm, uncapped: the rate is whatever pty backpressure allows, which
  // is the number the fixture exists to expose.
  {
    kind: "replay",
    name: "bulk-styled",
    covers: "styled scrollback flood (yes/cat class)",
    bytesPerSecond: 0,
    targetMs: 5_000,
  },
  {
    kind: "replay",
    name: "redraw-heavy",
    covers: "one-line redraw churn (progress bar / cargo build class)",
    bytesPerSecond: 0,
    targetMs: 5_000,
  },
  // TUI repaint at a plausible animation rate: ~1.5KB per grid row x 24 rows per
  // repaint, ~12 repaints/second.
  {
    kind: "replay",
    name: "alt-animation",
    covers: "full-grid alt-screen repaint (htop / TUI class)",
    bytesPerSecond: 400_000,
    targetMs: 6_000,
  },
  {
    kind: "replay",
    name: "alt-animation-exited",
    covers: "alt-screen animation that exits to primary",
    bytesPerSecond: 400_000,
    targetMs: 5_000,
  },
  {
    kind: "replay",
    name: "softwrap",
    covers: "soft-wrap continuation rows",
    bytesPerSecond: 40_000,
    targetMs: 5_000,
  },
];

/** The recorded half — real programs. `cwd` is filled in by the capture. */
export function recordEntries(repoRoot: string): readonly RecordEntry[] {
  return [
    {
      kind: "record",
      name: "vim-edit",
      covers: "editor: alt-screen, cursor motion, partial-row damage, status line",
      executable: "/usr/bin/vim",
      // `-u NONE` so the corpus is not a recording of whoever's vimrc ran it;
      // `-N` keeps nocompatible so the editing keys behave normally.
      args: ["-u", "NONE", "-N", "-c", "set number ruler laststatus=2"],
      cwd: repoRoot,
      drive: [
        { afterMs: 900, text: "ithe quick brown fox jumps over the lazy dog\r" },
        { afterMs: 250, text: "second line with some UTF-8: héllo 日本語 🌍\r" },
        { afterMs: 250, text: "third line" },
        { afterMs: 250, text: "yy10p" },
        { afterMs: 400, text: "gg" },
        { afterMs: 200, text: "jjjjwwcwREPLACED" },
        { afterMs: 300, text: "G" },
        { afterMs: 200, text: "dd" },
        { afterMs: 300, text: ":q!\r" },
      ],
      settleMs: 1_200,
      timeoutMs: 30_000,
    },
    {
      kind: "record",
      name: "top-repaint",
      covers: "process monitor: whole-viewport repaint on a timer (htop class)",
      // macOS `top`: -l 6 takes six samples then exits; -s 1 paces them.
      executable: "/usr/bin/top",
      args: ["-l", "6", "-s", "1"],
      settleMs: 1_200,
      timeoutMs: 40_000,
    },
    {
      kind: "record",
      name: "git-log-scroll",
      covers: "scrollback growth from a long coloured log",
      // `-P` disables the pager: the trace is the LOG's own output, not less's
      // repaints, which the alt-screen entries already cover. Looped for a fixed
      // wall time for the same reason the replayed entries are: frame count
      // follows DURATION, and one 400-line log drains in under a second.
      executable: "/bin/sh",
      args: ["-c", loopFor(5, "git -P -c color.ui=always log --oneline --graph --decorate -n 400")],
      cwd: repoRoot,
      settleMs: 1_200,
      timeoutMs: 30_000,
    },
    {
      kind: "record",
      name: "yes-flood",
      covers: "unbounded output at pty speed — the coalescing arm",
      executable: "/bin/sh",
      // Bounded by a byte count per pass and looped for a fixed wall time: the
      // trace ends on its own (never on the harness timeout, which would make
      // its length a property of the harness) and it lasts long enough to be a
      // distribution rather than a burst.
      args: [
        "-c",
        loopFor(
          5,
          "yes 'the quick brown fox jumps over the lazy dog 0123456789' | head -c 8000000",
        ),
      ],
      settleMs: 2_000,
      timeoutMs: 60_000,
    },
    {
      kind: "record",
      name: "unicode-wall",
      covers: "emoji, CJK, box drawing and combining marks at width",
      executable: "/bin/sh",
      args: ["-c", loopFor(5, UNICODE_WALL_SCRIPT)],
      settleMs: 1_200,
      timeoutMs: 30_000,
    },
    {
      kind: "record",
      name: "ls-recursive",
      covers: "fast bursty output with colour runs — the everyday command class",
      executable: "/bin/sh",
      args: ["-c", loopFor(5, "ls -laR packages plugins tooling 2>/dev/null | head -n 4000")],
      cwd: repoRoot,
      settleMs: 1_200,
      timeoutMs: 30_000,
    },
  ];
}

/** Run `body` repeatedly for `seconds` of wall time.
 *
 * The corpus's unit is DURATION, not bytes: the cell coalesces damage to at most
 * one frame per render cycle, so a command that finishes in 300ms yields three
 * frames however much it printed. Every recorded entry whose natural runtime is
 * shorter than the window is looped rather than enlarged, so the trace keeps the
 * program's own output shape. */
function loopFor(seconds: number, body: string): string {
  return `end=$(($(date +%s) + ${seconds})); while [ $(date +%s) -lt $end ]; do\n${body}\ndone`;
}

/** Box drawing + CJK + emoji + combining marks, printed as a wall. Written as a
 * shell script rather than a data file so the corpus has no external input. */
const UNICODE_WALL_SCRIPT = [
  "i=0",
  "while [ $i -lt 120 ]; do",
  '  printf "\\033[3%dm┌──────┬──────┐ 日本語テキスト %s\\033[0m\\r\\n" $((i % 8)) "$i"',
  '  printf "│ 🌍🚀 │ héllo│ Ω≈ç√∫˜µ≤≥ ﬁﬂ \\r\\n"',
  '  printf "└──────┴──────┘ e\\314\\201a\\314\\200o\\314\\202u\\314\\210 ｆｕｌｌｗｉｄｔｈ\\r\\n"',
  "  i=$((i + 1))",
  "done",
].join("\n");

/** Send a recorded entry's keystrokes with their gaps. */
export async function driveEntry(
  entry: RecordEntry,
  client: GhostteaAutomationClient,
  sessionId: string,
): Promise<void> {
  for (const step of entry.drive ?? []) {
    await new Promise((resolve) => setTimeout(resolve, step.afterMs));
    await client.sendText(sessionId, step.text);
  }
}
