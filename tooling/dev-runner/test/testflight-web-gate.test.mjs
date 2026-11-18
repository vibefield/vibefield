// Item 541 (2026-11-18) — the archive's second fence for the phone's web host: testflight.sh refuses an archive whose
// app carries either of the host's two markers while apps/ios/ship-gates.txt holds an OPEN line, and refuses when it
// cannot read the app or the gates. The first fence is the compile gate (`#if DEBUG || VF_WEB_RELAY`). The script is
// copied into a staged tree with its own ship-gates.txt, and `check-web` reads fixture archives the way the archive
// and upload branches do: nothing builds an app.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = join(REPO_ROOT, "apps/ios/scripts/testflight.sh");
// check-web-markers.mjs's two MARKERS, read as text: importing it would run its check (it has no main guard).
const FRONT = "vibefield.web-front";
const TAG = "vibefield.web-host.document-start.v1";
const OPEN = "SHIP-GATE item-373 sp4d-relay OPEN\n";
const CLOSED = "# the gates\nSHIP-GATE item-373 sp4d-relay CLOSED 0123abcd\n";

/** A staged tree: the script, a ship-gates.txt (or none), and an archive whose app holds `bytes` (or no app). */
function stage(t, { gates, bytes }) {
  const root = mkdtempSync(join(tmpdir(), "vf-541-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "apps/ios/scripts"), { recursive: true });
  copyFileSync(SCRIPT, join(root, "apps/ios/scripts/testflight.sh"));
  if (gates !== undefined) writeFileSync(join(root, "apps/ios/ship-gates.txt"), gates);
  const archive = join(root, "VibeField-1.xcarchive");
  const apps = join(archive, "Products/Applications");
  mkdirSync(apps, { recursive: true });
  if (bytes !== undefined) {
    mkdirSync(join(apps, "VibeField.app"));
    writeFileSync(join(apps, "VibeField.app/VibeField"), bytes);
  }
  const run = spawnSync(
    "bash",
    [join(root, "apps/ios/scripts/testflight.sh"), "check-web", archive],
    {
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin" },
    },
  );
  return { status: run.status, out: run.stdout, err: run.stderr };
}

const app = (...words) =>
  Buffer.from(["\0\0Mach-O stand-in\0", ...words.map((word) => `${word}\0`)].join(""));

test("an app carrying the host while a gate is OPEN is refused, and the refusal says why", (t) => {
  const run = stage(t, { gates: OPEN, bytes: app(FRONT, "VibeField") });
  assert.equal(run.status, 1, run.out + run.err);
  assert.match(run.err, /carries the web host/);
  assert.match(run.err, /OPEN/);
});

test("the document-start script's tag alone is refused the same", (t) => {
  const run = stage(t, { gates: OPEN, bytes: app(TAG) });
  assert.equal(run.status, 1, run.out + run.err);
  assert.match(run.err, /carries the web host/);
});

test("the same app passes when every gate is CLOSED", (t) => {
  const run = stage(t, { gates: CLOSED, bytes: app(FRONT, TAG) });
  assert.equal(run.status, 0, run.out + run.err);
  assert.match(run.out, /ship gates: 1, 0 OPEN/);
});

test("an app with no web marker passes while a gate is OPEN", (t) => {
  const run = stage(t, { gates: OPEN, bytes: app("NotificationsPage", "VibeField") });
  assert.equal(run.status, 0, run.out + run.err);
  assert.match(run.out, /markers in the archive's app: 0/);
});

test("an app carrying only the host's file paths, never its code, passes while a gate is OPEN", (t) => {
  // What a Release build keeps of the gated host file (item 541's row on a real app): its source and object paths.
  const paths = app(
    ".../Sources/FieldWeb/Host/",
    "FieldWebAppHost.swift",
    ".../arm64/FieldWebAppHost.o",
  );
  const run = stage(t, { gates: OPEN, bytes: paths });
  assert.equal(run.status, 0, run.out + run.err);
  assert.match(run.out, /markers in the archive's app: 0/);
});

test("a malformed gate line is a refusal that names its line, never its text", (t) => {
  for (const line of [
    "SHIP-GATE item-373 sp4d-relay open",
    "SHIP-GATE item-373 OPEN",
    "SHIP-GATE item-373 sp4d-relay CLOSED",
  ]) {
    const run = stage(t, { gates: `# the gates\n${line}\n`, bytes: app(FRONT) });
    assert.equal(run.status, 1, `${line}: ${run.out}${run.err}`);
    assert.match(run.err, /line\(s\) 2: not a gate line/, line);
    assert.ok(!run.err.includes(line), `${line}: its text is not printed`);
  }
});

test("with a marker, a gates file that records no gate is a refusal; with none, it passes", (t) => {
  const marked = stage(t, { gates: "# no gate yet\n\n", bytes: app(FRONT) });
  assert.equal(marked.status, 1, marked.out + marked.err);
  assert.match(marked.err, /no gate is recorded/);
  const clean = stage(t, { gates: "# no gate yet\n\n", bytes: app("VibeField") });
  assert.equal(clean.status, 0, clean.out + clean.err);
});

test("no app in the archive, or no ship-gates.txt, is refused: the fence fails closed", (t) => {
  const noApp = stage(t, { gates: OPEN });
  assert.equal(noApp.status, 1, noApp.out + noApp.err);
  const noGates = stage(t, { bytes: app("VibeField") });
  assert.equal(noGates.status, 1, noGates.out + noGates.err);
});

test("both the archive and the upload branches run the fence, on the markers check-web-markers holds", () => {
  const script = readFileSync(SCRIPT, "utf8");
  assert.equal(
    script.split('web_gate "$archive" || exit 1').length - 1,
    2,
    "one call in each branch",
  );
  const markers = readFileSync(join(REPO_ROOT, "scripts/check-web-markers.mjs"), "utf8");
  for (const name of [FRONT, TAG]) {
    assert.ok(markers.includes(`{ name: "${name}",`), `check-web-markers' MARKERS names ${name}`);
    assert.ok(script.includes(`"${name}"`), `testflight.sh's web_markers names ${name}`);
  }
});
