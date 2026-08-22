#!/usr/bin/env node
// THE RAW-MODE ECHO FIXTURE — TP-S0c / TP-D19 / §19.1 stage 12.
//
// A terminal's keystroke latency is not the shell's. A shell may wait, block,
// batch, or not echo at all (§18.1's note on row 4), so grading "keystroke →
// glyph" against a shell grades the shell. This program removes it: it puts the
// PTY in raw mode and writes each byte back the instant it reads it, so the only
// things left between the key and the pixel are the terminal and the platform.
//
// It is the SAME program on both sides of the control. Ghostty runs it and
// VibeField runs it, with identical cols x rows, font size, refresh rate and
// host-load fixture, and the difference between the two runs is the terminal.
//
// THE probeId. Chromium's `latencyInfo` follows a key to a frame swap inside
// Chromium; it cannot follow ours through DOM -> WS -> cell -> vault -> PTY ->
// cell -> WS -> worker -> WebGPU. So each keystroke carries an identity in the
// only channel a raw PTY has: the byte itself. One printable character per
// probe, drawn from a 32-wide alphabet, echoed verbatim. The side channel below
// records what this program saw and when, and the rig associates the two by
// arrival order within a window, using the id to catch reordering rather than as
// a primary key (32 ids wrap, and saying so is cheaper than pretending they do
// not).
//
// THE SIDE CHANNEL. Timestamps go to a FILE, never to stdout: stdout is the PTY
// under measurement, and writing measurement bytes into it would change the
// thing being measured — more damage, more frames, a different render. One
// line per event, appended, flushed on exit.
//
// CLOCKS. `process.hrtime.bigint()` is CLOCK_MONOTONIC on this platform, the
// same domain the rig's own injector reads, on the same machine. No offset
// estimation is needed or attempted (§19.1's clock-domain rule applies to the
// worker/cell pair across the wire, not to two processes on one host reading
// one clock).

import { appendFileSync, closeSync, openSync, writeSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};

const out = flag("out", null);
const seconds = Number(flag("seconds", "60"));
/** Emit a DSR (device status report) after each echo. The terminal must PARSE
 * the echoed byte before it can answer, so the reply's arrival back here is a
 * software-only observation of the emulator having processed the keystroke —
 * available identically from Ghostty and from our cell, which is what makes it
 * comparable. Off by default: it doubles the bytes on the wire. */
const dsr = args.includes("--dsr");
const quiet = args.includes("--quiet");

if (out === null) {
  process.stderr.write("echo-probe: --out <path> is required\n");
  process.exit(2);
}

const fd = openSync(out, "a");
const t0 = process.hrtime.bigint();
const wallAtT0 = Date.now();

// The header ties this run's monotonic origin to wall time ONCE, so a reader can
// place these nanoseconds beside the rig's without either side guessing.
writeSync(
  fd,
  `${JSON.stringify({ kind: "start", monotonicOriginNs: t0.toString(), wallMs: wallAtT0, pid: process.pid, cols: process.stdout.columns ?? null, rows: process.stdout.rows ?? null, dsr })}\n`,
);

/** The one control character this fixture speaks: ESC, U+001B. */
const ESC = String.fromCharCode(0x1b);

const lines = [];
const record = (event) => {
  lines.push(JSON.stringify(event));
  // Batched: a write() per keystroke is a syscall inside the measured path.
  // 64 lines is well under any run's length and well over any burst — but a
  // SIZE trigger alone means a short run (a dozen probes) is still sitting in
  // memory when the reader looks, which reads exactly like "the keys never
  // arrived". The timer below is the other half of the trigger and the reason
  // the rig can watch a run live.
  if (lines.length >= 64) flush();
};
const flush = () => {
  if (lines.length === 0) return;
  const payload = `${lines.join("\n")}\n`;
  lines.length = 0;
  appendFileSync(fd, payload);
};

// Time-based flush, unref'd so it never holds the process open. 200ms is far
// outside any keystroke's latency (so it is never inside a measured interval)
// and far inside a human's patience for `tail -f`.
const flushTimer = setInterval(flush, 200);
flushTimer.unref?.();

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();

let index = 0;
let pendingDsr = null;
// The terminal's DSR answer is `ESC [ row ; col R`. Split reads are possible, so
// the reply is accumulated rather than matched per chunk.
let replyBuffer = "";

process.stdin.on("data", (chunk) => {
  const receivedNs = process.hrtime.bigint();

  // Ctrl-C and Ctrl-D end the run — a raw-mode program owns its own exit.
  if (chunk.includes(0x03) || chunk.includes(0x04)) return finish("interrupt");

  const text = chunk.toString("latin1");
  if (pendingDsr !== null) {
    replyBuffer += text;
    // ESC [ row ; col R. Built from a named constant rather than written as a
    // literal `\x1b` in the pattern: a control character inside a regex is
    // almost always a typo, so the linter flags it, and the answer is to say
    // which control character and why rather than to silence the rule.
    const match = new RegExp(`${ESC}\\[\\d+;\\d+R`).exec(replyBuffer);
    if (match !== null) {
      record({
        kind: "dsr",
        probeId: pendingDsr.probeId,
        index: pendingDsr.index,
        // The emulator had to parse the echoed byte before it could answer, so
        // this interval bounds byte -> model-applied for the terminal under
        // test. It is NOT byte -> pixel: presenting is downstream of parsing.
        echoToReplyNs: (receivedNs - pendingDsr.echoedNs).toString(),
      });
      replyBuffer = "";
      pendingDsr = null;
      return;
    }
    // Not the reply — fall through and treat it as a keystroke.
    replyBuffer = "";
  }

  for (const byte of chunk) {
    if (byte === 0x03 || byte === 0x04) return finish("interrupt");
    const probeId = String.fromCharCode(byte);
    const echoedNs = process.hrtime.bigint();
    // THE ECHO, before the record: the record is bookkeeping and must never sit
    // between the read and the write. Every nanosecond spent here is a
    // nanosecond this fixture added to the latency it exists to measure.
    process.stdout.write(probeId);
    if (dsr) {
      process.stdout.write(`${ESC}[6n`);
      pendingDsr = { probeId, index, echoedNs };
    }
    record({
      kind: "key",
      probeId,
      index,
      receivedNs: (receivedNs - t0).toString(),
      echoedNs: (echoedNs - t0).toString(),
      // read -> write, the fixture's OWN cost. Subtracting it is how a reader
      // separates the terminal's latency from this program's.
      fixtureNs: (echoedNs - receivedNs).toString(),
    });
    index += 1;
  }
});

const finish = (reason) => {
  clearInterval(flushTimer);
  record({ kind: "end", reason, keys: index, atNs: (process.hrtime.bigint() - t0).toString() });
  flush();
  try {
    closeSync(fd);
  } catch {
    /* already closed */
  }
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.exit(0);
};

const timer = setTimeout(() => finish("duration"), Math.max(1, seconds) * 1000);
timer.unref?.();
process.on("SIGTERM", () => finish("sigterm"));
process.on("SIGINT", () => finish("sigint"));

if (!quiet) {
  // ONE line, written before the clock matters, so the operator can see the
  // fixture is up. Everything after this point is echo only.
  process.stdout.write(`echo-probe ready pid=${process.pid}\r\n`);
}
