// WP12 L4 (build-wp12-updater.md §14) — the launcher's reaper (`apps/desktop/packaging/smoke-daemons.mjs`) names a
// PACKAGED app's processes, which `smoke:update` runs: the shell, its helpers (they carry the product name, not
// Electron's), fieldd's SEA and the floor in `Resources/bin`. A helper is still a helper, given time to follow the shell.
import assert from "node:assert/strict";
import { test } from "node:test";
import { processName, runProcesses } from "../../../apps/desktop/packaging/smoke-daemons.mjs";

const APP = "/private/tmp/vf-update-smoke-x/staged/app/VibeField.app";

test("names the packaged layout: the shell, its helpers, fieldd's SEA, the floor and the sidecar", () => {
  assert.equal(
    processName(`${APP}/Contents/MacOS/VibeField --allow-dev-trust --user-data-dir=/p`),
    "vibefield",
  );
  assert.equal(
    processName(
      `${APP}/Contents/Frameworks/VibeField Helper (Renderer).app/Contents/MacOS/VibeField Helper (Renderer) --type=renderer`,
    ),
    "electron-helper",
  );
  assert.equal(
    processName(
      `${APP}/Contents/Frameworks/VibeField Helper.app/Contents/MacOS/VibeField Helper --type=utility`,
    ),
    "electron-helper",
  );
  assert.equal(processName(`${APP}/Contents/Resources/bin/fieldd`), "fieldd");
  assert.equal(processName(`${APP}/Contents/Resources/bin/field-native`), "field-native");
  assert.equal(
    processName(`${APP}/Contents/Resources/bin/sidecar-slim --socket x`),
    "sidecar-slim",
  );
  // the dev layout is unchanged
  assert.equal(processName("/r/packages/fieldd/dist/bin.cjs"), "fieldd");
});

test("a packaged run's processes by the mark: helpers flagged, the daemons named", () => {
  const mark = "vf-update-smoke-AbC123-staged";
  const lines = [
    [100, 1, `${APP}/Contents/MacOS/VibeField --allow-dev-trust`],
    [
      101,
      100,
      `${APP}/Contents/Frameworks/VibeField Helper (GPU).app/Contents/MacOS/VibeField Helper (GPU) --type=gpu-process`,
    ],
    [102, 1, `${APP}/Contents/Resources/bin/fieldd`],
    [103, 1, `${APP}/Contents/Resources/bin/field-native`],
  ];
  const plain = lines.map(([pid, ppid, command]) => `  ${pid}  ${ppid} ${command}`).join("\n");
  const withEnv = lines
    .map(([pid, ppid, command]) => `  ${pid}  ${ppid} ${command} HOME=/h VF_SMOKE_RUN=${mark}`)
    .join("\n");
  assert.deepEqual(
    runProcesses(withEnv, plain, mark).map((p) => [p.pid, p.name, p.helper]),
    [
      [100, "vibefield", false],
      [101, "electron-helper", true],
      [102, "fieldd", false],
      [103, "field-native", false],
    ],
  );
});
