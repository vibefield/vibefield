#!/usr/bin/env node
// THE FIXTURE PTY PROGRAM (spec §19.2: "a fixture PTY program replays the byte
// trace at recorded or accelerated cadence -> real cell -> real wire").
//
// It is spawned as the SESSION'S EXECUTABLE, so its stdout IS the pty slave and
// every byte it writes is parsed by the real cell exactly as a real program's
// output would be. Nothing here touches the input path: replaying a trace as
// keystrokes would be replaying it through a shell, which is a different
// experiment (and one whose result the shell, not the pipeline, decides).
//
// argv: <traceFile> <bytesPerSecond> <targetMs> <holdMs>
//   bytesPerSecond  0 = write as fast as the pty accepts (the flood arm)
//   targetMs        0 = one pass over the trace; otherwise LOOP the trace until
//                   this much wall time has passed
//
// WHY RATE AND DURATION RATHER THAN CHUNK AND DELAY: the cell coalesces damage
// to at most one frame per render cycle, so the number of frames a trace yields
// is set by how LONG it runs, not by how many bytes it contains. The first
// version of this program took a chunk size and a delay; every trace drained in
// under half a second and the whole corpus came to 112 frames — enough to prove
// the path and far too few to be a histogram. Asking for a rate and a duration
// makes "5 seconds of output at 2 MB/s" expressible, which is what a flood
// fixture actually is.
//
// TIMING HONESTY: Node's timer granularity is ~1ms, so the pacer works in
// millisecond ticks and emits the whole tick's byte budget at once. The
// requested rate is recorded in the container; the frames' ACTUAL arrival
// offsets are recorded beside it, so a reader compares them rather than
// trusting the request. Sub-millisecond pacing would need a spin loop, which on
// this always-loaded host would compete with the very cell being measured.
import { readFileSync } from "node:fs";

const [traceFile, ratePerSecondArg, targetMsArg, holdMsArg] = process.argv.slice(2);
if (!traceFile) {
  process.stderr.write(
    "usage: replay-program.mjs <traceFile> <bytesPerSecond> <targetMs> <holdMs>\n",
  );
  process.exit(2);
}

const bytesPerSecond = Math.max(0, Number(ratePerSecondArg ?? 0));
const targetMs = Math.max(0, Number(targetMsArg ?? 0));
const holdMs = Math.max(0, Number(holdMsArg ?? 0));
const bytes = readFileSync(traceFile);
if (bytes.byteLength === 0) {
  process.stderr.write("trace file is empty\n");
  process.exit(2);
}

/** One pacing tick. Small enough that a 4 MB/s rate is delivered in ~32KB
 * pieces rather than one-second lumps, large enough to stay above the timer's
 * own granularity. */
const TICK_MS = 8;

const write = (chunk) =>
  new Promise((resolve) => {
    // Respect backpressure: `write` returning false means the pty buffer is
    // full, and ignoring that would measure this program's memory rather than
    // the cell's throughput. Under an uncapped flood this is the ONLY thing
    // setting the rate, which is exactly what a flood fixture should measure.
    if (process.stdout.write(chunk)) resolve();
    else process.stdout.once("drain", resolve);
  });

const sleepMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const run = async () => {
  const startedAt = Date.now();
  const budgetPerTick =
    bytesPerSecond > 0 ? Math.max(1, Math.round((bytesPerSecond * TICK_MS) / 1000)) : 0;
  const deadline = targetMs > 0 ? startedAt + targetMs : Number.POSITIVE_INFINITY;
  let offset = 0;

  for (;;) {
    if (Date.now() >= deadline) break;

    if (budgetPerTick === 0) {
      // Unpaced: one whole pass, then loop only if a duration was asked for.
      await write(bytes.subarray(offset));
      offset = 0;
      if (targetMs === 0) break;
      continue;
    }

    const tickStartedAt = Date.now();
    let written = 0;
    while (written < budgetPerTick) {
      const take = Math.min(budgetPerTick - written, bytes.byteLength - offset);
      await write(bytes.subarray(offset, offset + take));
      written += take;
      offset += take;
      if (offset >= bytes.byteLength) {
        offset = 0;
        // One pass was all that was asked for.
        if (targetMs === 0) return;
      }
    }
    const elapsed = Date.now() - tickStartedAt;
    if (elapsed < TICK_MS) await sleepMs(TICK_MS - elapsed);
  }
};

const finish = async () => {
  await run();
  // Hold the pty open so the cell's final coalesced frame is emitted and
  // recorded before the session exits and the subscription tears down. Without
  // it the last frame of every trace is a race.
  if (holdMs > 0) await sleepMs(holdMs);
};

finish().then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(`replay failed: ${error?.stack ?? error}\n`);
    process.exit(1);
  },
);
