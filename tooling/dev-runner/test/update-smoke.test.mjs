// WP12 L4 (WP12f, W9; build-wp12-updater.md §14) — `smoke:update`'s judging, from outside a packaged app: the desktop log
// under the run's HOME, the fixture's request log, electron-updater's cache. The physical runs need a package and a
// window; these pin what each run must SEE to be green, and what may never reach the app's environment (EL7).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  appEnv,
  footprintChanged,
  footprintSnapshot,
  freewayHostOf,
  judgeQuit,
  judgeRun,
  readEvents,
  readLastApply,
} from "../../../apps/desktop/packaging/run-update-smoke.mjs";

const work = mkdtempSync(join(tmpdir(), "vf-update-smoke-test-"));
after(() => rmSync(work, { recursive: true, force: true }));

const RELEASE = {
  tag: "v0.1.1-beta.1",
  version: "0.1.1-beta.1",
  zip: "VibeField-0.1.1-beta.1-arm64-mac.zip",
  sha512: "c2hhNTEy",
};
const run = (expect) => ({ releases: [RELEASE], seed: null, expect });
const event = (name, attrs) => ({ event: name, attrs });
const chain = [
  { method: "GET", path: "/vibefield/vibefield/releases.atom" },
  { method: "GET", path: `/vibefield/vibefield/releases/download/${RELEASE.tag}/trust-root.json` },
];
const zip = {
  method: "GET",
  path: `/vibefield/vibefield/releases/download/${RELEASE.tag}/${RELEASE.zip}`,
};

test("run 1 · staged: silent until the line, green on the line + the cache's sha512 + one zip; Squirrel's word is kept", () => {
  assert.equal(judgeRun(run("staged"), { events: [], requests: chain, cached: null }), null);
  const staged = event("desktop.update.staged", {
    version: RELEASE.version,
    sha512: RELEASE.sha512,
  });
  const green = judgeRun(run("staged"), {
    events: [staged],
    requests: [...chain, zip],
    cached: { fileName: RELEASE.zip, sha512: RELEASE.sha512 },
  });
  assert.equal(green.ok, true, JSON.stringify(green));
  assert.equal(green.squirrel, "no updater error");
  const squirrel = judgeRun(run("staged"), {
    events: [staged, event("desktop.update.updater_error", { code: "failed" })],
    requests: [...chain, zip],
    cached: { sha512: RELEASE.sha512 },
  });
  assert.equal(squirrel.ok, true); // the first touch is witnessed, whatever it says (R6)
  assert.deepEqual(squirrel.squirrel, ["failed"]);
  // the line before the cache's record: wait, unless it is the run's last reading
  assert.equal(
    judgeRun(run("staged"), { events: [staged], requests: [...chain, zip], cached: null }),
    null,
  );
  const noCache = judgeRun(
    run("staged"),
    { events: [staged], requests: [...chain, zip], cached: null },
    { final: true },
  );
  assert.equal(noCache.ok, false);
  const lying = judgeRun(run("staged"), {
    events: [staged],
    requests: [...chain, zip],
    cached: { sha512: "b3RoZXI=" },
  });
  assert.equal(lying.ok, false);
  assert.match(
    lying.problems.join("\n"),
    /cache's update-info\.json sha512 is not the signed feed's/,
  );
  const twice = judgeRun(run("staged"), {
    events: [staged],
    requests: [...chain, zip, zip],
    cached: { sha512: RELEASE.sha512 },
  });
  assert.equal(twice.ok, false);
});

test("runs 2–5: the expected refusal with no payload is green; a payload, another state or a failed check is red", () => {
  const refused = (state) => event("desktop.update.refused", { service: "updates", state });
  assert.equal(
    judgeRun(run("feed-unverified"), {
      events: [refused("feed-unverified")],
      requests: chain,
      cached: null,
    }).ok,
    true,
  );
  const paid = judgeRun(run("feed-unverified"), {
    events: [refused("feed-unverified")],
    requests: [...chain, zip],
    cached: null,
  });
  assert.equal(paid.ok, false);
  assert.match(paid.problems.join("\n"), /1 payload request\(s\); W9 says none/);
  assert.equal(
    judgeRun(run("policy-rollback"), {
      events: [refused("feed-unverified")],
      requests: chain,
      cached: null,
    }).ok,
    false,
  );
  assert.equal(
    judgeRun(run("killed"), {
      events: [event("desktop.update.lever", { version: RELEASE.version, lever: "killed" })],
      requests: chain,
      cached: null,
    }).ok,
    true,
  );
  const nightlyFeed = {
    method: "GET",
    path: "/vibefield/vibefield/releases/download/nightly-20261016/latest-mac.yml",
  };
  assert.equal(
    judgeRun(run("channel-unresolved"), {
      events: [refused("channel-unresolved")],
      requests: [...chain, nightlyFeed],
      cached: null,
    }).ok,
    false,
  );
  assert.equal(
    judgeRun(run("feed-unverified"), {
      events: [event("desktop.update.check_failed", { code: "offline" })],
      requests: chain,
      cached: null,
    }).saw,
    "check_failed",
  );
});

test("EL7: the app's environment carries no secret, and the run's HOME, data root, origin and mark", () => {
  const env = appEnv(
    {
      PATH: "/bin",
      VIBEFIELD_SMOKE_BUNDLED_SECRET: "x",
      VIBEFIELD_BUNDLED_INDEX_SECRET: "y",
      VIBEFIELD_RELEASE_SECRET: "z",
      NODE_OPTIONS: "--require=/x.cjs",
      FIELD_LOG_DIR: "/elsewhere",
    },
    {
      home: "/r/home",
      fieldd: "/r/fieldd",
      origin: "http://127.0.0.1:9/vibefield/vibefield/releases",
      mark: "m",
    },
  );
  for (const name of [
    "VIBEFIELD_SMOKE_BUNDLED_SECRET",
    "VIBEFIELD_BUNDLED_INDEX_SECRET",
    "VIBEFIELD_RELEASE_SECRET",
    "NODE_OPTIONS",
    "FIELD_LOG_DIR",
  ])
    assert.equal(name in env, false, name);
  assert.equal(env.HOME, "/r/home");
  assert.equal(env.FIELDD_DATA_DIR, "/r/fieldd");
  assert.equal(env.VIBEFIELD_UPDATE_ORIGIN, "http://127.0.0.1:9/vibefield/vibefield/releases");
  assert.equal(env.VF_SMOKE_RUN, "m");
  assert.equal(env.PATH, "/bin");
});

test("the desktop log is read from the run's HOME, every desktop segment, locks skipped", () => {
  const home = join(work, "home");
  const dir = join(home, "Library", "Logs", "VibeField", "system");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "desktop.ndjson"), `${JSON.stringify({ event: "a" })}\nnot json\n`);
  writeFileSync(join(dir, "desktop.ndjson.lock"), "123");
  writeFileSync(join(dir, "fieldd.ndjson"), `${JSON.stringify({ event: "f" })}\n`);
  assert.deepEqual(
    readEvents(home).map((record) => record.event),
    ["a"],
  );
  assert.deepEqual(readEvents(join(work, "nobody")), []);
});

test("R5: the footprint names what a run created or touched outside its root, and nothing it left alone", () => {
  const kept = join(work, "kept");
  const touched = join(work, "touched");
  const created = join(work, "created");
  writeFileSync(kept, "x");
  writeFileSync(touched, "x");
  utimesSync(kept, 1_000, 1_000);
  utimesSync(touched, 1_000, 1_000);
  const before = footprintSnapshot([kept, touched, created]);
  utimesSync(touched, 2_000, 2_000);
  writeFileSync(created, "x");
  assert.deepEqual(footprintChanged(before, footprintSnapshot([kept, touched, created])), [
    touched,
    created,
  ]);
});

test("F1: every run's freeway host is the app's own — by real path, with the floor's arguments", () => {
  const app = "/tmp/vf-update-smoke-x/staged/app/VibeField.app";
  const hostPath = `${app}/Contents/Resources/bin/field-freeway-host`;
  // `/tmp` is `/private/tmp`: the floor's own path is whichever it was exec'd by
  const real = (path) => path.replace(/^\/tmp\//u, "/private/tmp/");
  const host = (command, name = "field-freeway-host") => ({ pid: 9, name, helper: false, command });
  const spawned = host(`/private${hostPath} --listener-fd 3`);
  assert.equal(freewayHostOf([spawned], hostPath, real), spawned);
  assert.equal(freewayHostOf([host(`${hostPath} --listener-fd 3 `)], hostPath, real)?.pid, 9);
  // a dev build's host, another run's app, the wrong arguments, no command, another binary: none is this run's
  for (const other of [
    host("/r/target/debug/field-freeway-host --listener-fd 3"),
    host(
      "/tmp/vf-update-smoke-y/staged/app/VibeField.app/Contents/Resources/bin/field-freeway-host --listener-fd 3",
    ),
    host(`${hostPath} --listener-fd 4`),
    host(`${hostPath}`),
    host(null),
    host(
      `${app}/Contents/Resources/bin/field-terminal-host --listener-fd 3`,
      "field-terminal-host",
    ),
  ])
    assert.equal(freewayHostOf([other], hostPath, real), null, JSON.stringify(other));
  assert.equal(freewayHostOf([], hostPath, real), null);
});

// AU-5 (LC-29) — the opt-in quit run: a PERSON's quit through the gate, judged from outside after the exit.
test("AU-5 · quit: green on the gate, a stop, THEN Squirrel's refusal, the record, exit 0 and no relaunch", () => {
  const atom = { method: "GET", path: "/vibefield/vibefield/releases.atom" };
  const events = [
    event("desktop.update.staged", { version: RELEASE.version }),
    event("desktop.quit.census_read", { pairs: 1, sessions: 0 }),
    event("desktop.quit.pair_stopped", { pair: "Me" }),
    event("desktop.update.squirrel_refused", { error: "code signature" }),
    event("desktop.update.quit_install", {
      installing: false,
      reason: "squirrel-refused",
      version: RELEASE.version,
    }),
  ];
  const seen = {
    events,
    afterQuit: [atom],
    zips: 1,
    lastApply: { branch: "exited", reason: "squirrel-refused", trigger: "quit" },
    exit: { code: 0, signal: null },
    relaunched: [],
  };
  const green = judgeQuit(seen);
  assert.equal(green.ok, true, JSON.stringify(green));
  assert.equal(green.saw, "quit_install squirrel-refused");

  const red = (changes, pattern) => {
    const verdict = judgeQuit({ ...seen, ...changes });
    assert.equal(verdict.ok, false, JSON.stringify(changes));
    assert.match(verdict.problems.join("\n"), pattern);
  };
  // a signal's quit (or none): no gate, no stop, no install
  red({ events: [events[0]] }, /the gate did not run/);
  // Squirrel touched before the stop
  red({ events: [events[0], events[1], events[3], events[2], events[4]] }, /BEFORE a pair stopped/);
  red({ events: events.slice(0, 4) }, /install on quit never ran/);
  red(
    {
      events: [
        ...events.slice(0, 3),
        event("desktop.update.quit_install", { installing: false, reason: "policy-unreachable" }),
      ],
    },
    /policy-unreachable/,
  );
  red({ afterQuit: [] }, /no fresh policy read at the quit/);
  red({ zips: 2 }, /asked for 2 times/);
  red({ lastApply: null }, /lastApply is null/);
  red({ lastApply: { ...seen.lastApply, trigger: "restart" } }, /lastApply/);
  red({ exit: null }, /did not exit/);
  red({ exit: { code: null, signal: "SIGKILL" } }, /exited SIGKILL/);
  red({ relaunched: [4242] }, /a relaunch/);
});

test("AU-5 · the run's lastApply is read from its own profile, and is null when there is none", () => {
  const profile = join(work, "profile");
  assert.equal(readLastApply(profile), null);
  mkdirSync(join(profile, "updates"), { recursive: true });
  writeFileSync(
    join(profile, "updates", "state.json"),
    JSON.stringify({ schemaVersion: 1, lastApply: { branch: "exited", trigger: "quit" } }),
  );
  assert.deepEqual(readLastApply(profile), { branch: "exited", trigger: "quit" });
  writeFileSync(join(profile, "updates", "state.json"), "not json");
  assert.equal(readLastApply(profile), null);
});
