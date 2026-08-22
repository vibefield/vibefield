#!/usr/bin/env node
// THE RATE-CONTROLLED FLOOD GENERATOR — TP-S0c, §19.2 "Generators".
//
// `yes` floods as fast as the PTY will take it, which measures the pipe rather
// than the pipeline: the rate is whatever backpressure happens to allow that
// second, so two runs are not the same fixture and an A/B has no controlled
// variable. This writes a REQUESTED bytes/second and reports what it achieved,
// so "50MB/s into an urgent pane" is a setting rather than a hope, and a run
// that could not reach its rate says so instead of quietly measuring a slower
// one.
//
// SHAPE MATTERS AS MUCH AS RATE. TP-S0a's finding 4: the cell emits FULL frames
// on scrolling output (yes-flood: 154 of 154) and incremental frames on
// in-place repaint (alt-animation: 7 of 193). Those are different pipelines
// downstream — a flood of one says nothing about the other — so the shape is a
// flag, not an assumption:
//
//   --shape scroll     newline-terminated lines; every row moves (the `yes`/`cat` case)
//   --shape repaint    cursor-addressed in-place rewrites; few rows move (the TUI case)
//   --shape unicode    scroll, with wide/combining/emoji cells (the atlas case)

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};

const bytesPerSecond = Math.max(1, Number(flag("rate", String(1024 * 1024))));
const seconds = Math.max(1, Number(flag("seconds", "30")));
const shape = flag("shape", "scroll");
const cols = Math.max(20, Number(flag("cols", String(process.stdout.columns ?? 120))));
const rows = Math.max(4, Number(flag("rows", String(process.stdout.rows ?? 30))));

/** One tick per display interval at 120Hz. Finer would spend more time in the
 * scheduler than in the write; coarser would deliver a "flood" as 30 bursts a
 * second, which is a different fixture — the cell coalesces per render cycle
 * (S0a finding 5), so burst structure changes the frame count directly. */
const TICK_MS = 8;

const LINE = (width) => {
  const body = "abcdefghijklmnopqrstuvwxyz0123456789 ";
  let text = "";
  while (text.length < width) text += body;
  return text.slice(0, width);
};

const UNICODE = (width) => {
  // Wide (CJK), combining, and emoji — the three cases that make a cell wider
  // than a byte and an atlas entry more than a mono glyph.
  const body = "漢字テスト é̂ \u{1F600}\u{1F1EF}\u{1F1F5} ";
  let text = "";
  while ([...text].length < width) text += body;
  return [...text].slice(0, width).join("");
};

const plain = LINE(Math.max(1, cols - 1));
const wide = UNICODE(Math.max(1, Math.floor(cols / 2) - 1));

let sequence = 0;
const chunkFor = (targetBytes) => {
  const parts = [];
  let size = 0;
  while (size < targetBytes) {
    sequence += 1;
    let piece;
    if (shape === "repaint") {
      // Cursor-addressed rewrite of one row inside the viewport: the row moves,
      // the rest of the screen does not. `\x1b[<row>;1H` then the text, no
      // newline — so nothing scrolls and the damage stays local.
      const row = 1 + (sequence % Math.max(1, rows - 1));
      piece = `\x1b[${row};1H${plain.slice(0, Math.max(1, cols - 8))} ${String(sequence).padStart(6, "0")}`;
    } else if (shape === "unicode") {
      piece = `${wide} ${String(sequence).padStart(6, "0")}\n`;
    } else {
      piece = `${plain.slice(0, Math.max(1, cols - 8))} ${String(sequence).padStart(6, "0")}\n`;
    }
    parts.push(piece);
    size += Buffer.byteLength(piece, "utf8");
  }
  return parts.join("");
};

const perTick = Math.max(1, Math.round((bytesPerSecond * TICK_MS) / 1000));
const startedAt = process.hrtime.bigint();
const deadlineNs = startedAt + BigInt(seconds) * 1_000_000_000n;
let written = 0;
let backpressureTicks = 0;
let ticks = 0;

// Alternate-screen for the repaint shape, so the rewrite has a stable viewport
// and the run does not leave the scrollback shredded.
if (shape === "repaint") process.stdout.write("\x1b[?1049h\x1b[2J");

const stop = (reason) => {
  clearInterval(timer);
  if (shape === "repaint") process.stdout.write("\x1b[?1049l");
  const elapsedNs = Number(process.hrtime.bigint() - startedAt);
  const achieved = elapsedNs > 0 ? (written * 1e9) / elapsedNs : 0;
  // The report goes to STDERR, which in a pty is the same stream — so it is
  // written last, after the flood, and the rig reads it from the side-channel
  // file instead when one is given. In a pty run it is simply the closing line.
  process.stderr.write(
    `\nflood done reason=${reason} requested=${bytesPerSecond} achieved=${Math.round(achieved)} bytes=${written} ticks=${ticks} backpressure=${backpressureTicks}\n`,
  );
  process.exit(0);
};

const timer = setInterval(() => {
  ticks += 1;
  if (process.hrtime.bigint() >= deadlineNs) return stop("duration");
  const chunk = chunkFor(perTick);
  written += Buffer.byteLength(chunk, "utf8");
  // `write` returning false means the pty buffer is full. The tick is NOT
  // skipped and nothing is queued behind it: a generator that queued would
  // stop being rate-controlled the moment it fell behind, and would deliver
  // its backlog as a burst later. Counting the ticks instead makes "could not
  // reach the requested rate" a number in the report.
  if (!process.stdout.write(chunk)) backpressureTicks += 1;
}, TICK_MS);

process.on("SIGTERM", () => stop("sigterm"));
process.on("SIGINT", () => stop("sigint"));
