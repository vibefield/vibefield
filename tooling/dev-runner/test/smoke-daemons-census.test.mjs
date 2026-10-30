// Item 93 — the launcher's census (`apps/desktop/packaging/smoke-daemons.mjs`) reads the WHOLE process table once, to
// find the run, and asks every later question of one pid at a time. These rows count its reads through its spawner,
// so they are counts and never timings: the two whole-table reads per look it once made came to four or more for a
// run that left a daemon, each 0.1–2 s with the host's load, and DK-18's launcher rows outran vitest's 5 s on them.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import {
  leftByRun,
  SMOKE_RUN_ENV,
  stillRunning,
} from "../../../apps/desktop/packaging/smoke-daemons.mjs";

const skip = process.platform === "win32";

/** A daemon of the run: a node, as the launcher rows' is (`ps -E` cannot read a platform binary's environment). */
const runDaemon = (mark) =>
  spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, [SMOKE_RUN_ENV]: mark },
  });

/** The real `ps`, every read it is asked for recorded. */
const countingPs = (reads) => (args) => {
  reads.push(args);
  return execFileSync("ps", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
};

const whole = (reads) => reads.filter((args) => !args.includes("-p"));
const pidsAsked = (reads) =>
  reads.filter((args) => args.includes("-p")).map((args) => args[args.indexOf("-p") + 1]);

test("a daemon the run left is found by ONE whole-table read, then re-looked by its pid alone and reaped", {
  skip,
}, async () => {
  const mark = `vf-smoke-profile-census-left-${process.pid}`;
  const daemon = runDaemon(mark);
  const reads = [];
  try {
    const row = await leftByRun(mark, { ps: countingPs(reads) });
    assert.deepEqual(row.left, [{ pid: daemon.pid, name: "node" }]);
    assert.deepEqual(row.reaped, [daemon.pid]);
    assert.equal(whole(reads).length, 1, `the whole table was read ${whole(reads).length} times`);
    // its name, then the reap's wait: each read names the daemon alone (a `-p` of two or more reads the whole table)
    assert.ok(pidsAsked(reads).length >= 2);
    assert.deepEqual(new Set(pidsAsked(reads)), new Set([String(daemon.pid)]));
  } finally {
    if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill("SIGKILL");
  }
});

test("a re-look judges each pid by its own environment: a live pid without the mark is not the run's, a gone one is gone", {
  skip,
}, async () => {
  const mark = `vf-smoke-profile-census-still-${process.pid}`;
  const daemon = runDaemon(mark);
  const reads = [];
  const ps = countingPs(reads);
  try {
    // this process lives and carries no mark, as a pid the system handed on would not
    assert.deepEqual(stillRunning(mark, [daemon.pid, process.pid], ps), [daemon.pid]);
    daemon.kill("SIGKILL");
    await once(daemon, "exit");
    // `ps` exits 1 when the one pid it names is gone: that is an answer, not a failure
    assert.deepEqual(stillRunning(mark, [daemon.pid], ps), []);
    assert.equal(whole(reads).length, 0);
    assert.deepEqual(pidsAsked(reads), [daemon.pid, process.pid, daemon.pid].map(String));
  } finally {
    if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill("SIGKILL");
  }
});
