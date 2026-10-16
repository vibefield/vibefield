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
  judgeRun,
  readEvents,
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
