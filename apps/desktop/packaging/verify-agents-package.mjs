#!/usr/bin/env node
// AR-7j packaging witness (LP-D1/LP-D2; desk-gates row 34): agents TYPED into a packaged
// pane are managed.
// A packaged fieldd is a single executable whose RunAsNode fuse is closed, so its
// launchers exec the executable ITSELF in its one closed agent-shim role
// (`--vibefield-role=agent-shim`, packages/fieldd/src/roles.ts), which runs the
// shim sealed beside it — never the copy in the user's shim home.
// Under --require-signed, the packaged fieldd's and field-native's actual nested
// signatures first. Then fieldd's packaged-typed-agent rows against the artifact's
// own files, none falling back to a source or lock build: the packaged fieldd over
// the packaged field-native as a real floor, the godview smoke's person and stub —
//  - the launcher's exec line names the packaged executable and its role; a name
//    typed in a pane is a managed run (a row in the fold, a record holding the
//    launcher's pid, nothing private handed to the agent); the home's copy of the
//    shim never runs; an argument the agent cannot carry is refused in VibeField's
//    words with the kit's status;
//  - MEASURED, and said here whatever it says: the role's added start cost over the
//    bare program (median of 20 interleaved runs; LP-D2's budget ~250 ms) and the
//    packaged fieldd's publish after a relaunch against the 8 s a launcher waits.
//    Over budget is REPORTED on its own line, never hidden and never a red: a loaded
//    host's number is not the product's;
//  - the signed executable's own hardening, which nothing else runs on the artifact
//    (`build-fieldd-sea.mjs --verify` is by hand): the role ignores NODE_OPTIONS and
//    hands the agent SIGUSR1 as a real Node does, and SIGUSR1 to the packaged daemon
//    opens no inspector;
//  - the forwarders (RV #1, item 203): a managed agent's command hooks and status
//    line run the executable in its agent-forwarder role, which runs the forwarder
//    sealed beside it (`agent-forwarder.cjs`); the run is observed by its hooks, and
//    the role's start per status-line refresh is MEASURED and said, never a red.
// Every row is opt-in, so a skip would read as a pass: the run writes a JSON report,
// and every row in it must have PASSED. Modelled on verify-history-package.mjs.
import { spawn } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { floorBinaryNames } from "../../../scripts/native-floor.mjs";
import { assertReleaseSigned } from "./release-signature.mjs";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(desktopRoot, "..", "..");
const args = process.argv.slice(2);
const signed = args.includes("--require-signed");
const positional = args.filter((arg) => arg !== "--require-signed");
if (positional.length !== 2 || positional[0] !== "--native-root") {
  throw new Error(
    "usage: verify-agents-package.mjs --native-root <Resources/bin> [--require-signed]",
  );
}
const nativeRoot = realpathSync(resolve(positional[1]));
const exe = (name) => (process.platform === "win32" ? `${name}.exe` : name);
const fieldd = join(nativeRoot, exe("fieldd"));
// the floor and its siblings (its terminal cell, its freeway host): a typed agent needs a pane
const floor = floorBinaryNames().map((name) => join(nativeRoot, name));
// the sealed shim the role runs, beside the executable
const shim = join(nativeRoot, "agent-shim.cjs");
// RV #1 (item 203) — the sealed forwarder the agent-forwarder role runs, beside it too
const forwarder = join(nativeRoot, "agent-forwarder.cjs");
for (const file of [fieldd, ...floor, shim, forwarder]) {
  if (!lstatSync(file).isFile())
    throw new Error(`packaged Agents input is not a regular file: ${file}`);
}
for (const file of [fieldd, ...floor]) accessSync(file, constants.X_OK);

// the executable the role runs as, and the floor every pane is born on
if (signed) await assertReleaseSigned(desktopRoot, [fieldd, ...floor], "Agents");

console.log(`Agents package under test: ${nativeRoot}`);
const reports = mkdtempSync(join(tmpdir(), "vf-agents-package-"));
// The release runner's credentials (Developer ID, notarization, the bundled index's secret) stay
// out of the rows' process. The rows spawn the pair and the person on an explicit environment of
// their own (packaged-typed-agent.test.ts `personSource`); this keeps the rows' own process from
// holding them too. Matched by name, and nothing about them is printed.
const CREDENTIAL = /^(CSC_|APPLE_)|SECRET|PASSWORD|PASSPHRASE|TOKEN|PRIVATE_KEY|API_KEY/iu;
const environment = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !CREDENTIAL.test(name))),
  FIELDD_TEST_AGENTS_PACKAGE: nativeRoot,
  FIELDD_TEST_AGENTS_REPORT: reports,
};
const suite = { filter: "@vibefield/fieldd", files: ["test/packaged-typed-agent.test.ts"] };
const report = join(reports, "fieldd.json");
await run(suite.filter, [
  ...suite.files,
  "--reporter=default",
  "--reporter=json",
  `--outputFile.json=${report}`,
  // a cold signed SEA and a cold floor outlast the 5 s default; each row's own
  // waits remain the tighter checks
  "--testTimeout=480000",
]);
const { testResults } = JSON.parse(readFileSync(report, "utf8"));
for (const file of suite.files) {
  const result = testResults.find((entry) => entry.name.endsWith(file));
  const rows = result?.assertionResults ?? [];
  const unpassed = rows.filter((row) => row.status !== "passed");
  if (rows.length === 0 || unpassed.length > 0) {
    throw new Error(
      `${suite.filter} ${file}: every row must pass against the package — ` +
        (rows.length === 0
          ? "none ran"
          : unpassed.map((row) => `${row.status}: ${row.fullName}`).join("; ")),
    );
  }
  console.log(`Agents package: ${suite.filter} ${file} — ${rows.length} rows passed`);
}

// The measurements, said in full; a missing one is a witness that did not measure.
const measured = (name) => {
  const path = join(reports, name);
  if (!existsSync(path)) throw new Error(`the packaged rows passed but wrote no ${name}`);
  return JSON.parse(readFileSync(path, "utf8"));
};
const cost = measured("cost.json");
console.log(
  `Agents package: the role adds ${cost.addedMedianMs} ms (median of ${cost.runs} interleaved runs) ` +
    `to a typed agent's start over the bare program — role ${cost.roleMedianMs} ms, bare ${cost.bareMedianMs} ms, ` +
    `a real Node on the same shim ${cost.nodeMedianMs} ms, the first (cold) role run ${cost.coldRoleMs} ms; ` +
    `budget ${cost.budgetMs} ms: ${cost.withinBudget ? "within" : "OVER BUDGET (reported, not failed — re-measure on a quiet host before it is called)"}`,
);
// RV #1 (item 203): reported, never failed
console.log(
  `Agents package: each status-line refresh runs the forwarder role in ${cost.forwarderMedianMs} ms ` +
    `(median of ${cost.runs} runs; a real Node on the same sealed forwarder ${cost.forwarderNodeMedianMs} ms)`,
);
const publish = measured("publish.json");
console.log(
  `Agents package: after a relaunch the packaged fieldd was ready in ${publish.readyMs} ms and published ` +
    `its launchers' gateway in ${publish.publishMs} ms; a launcher waits ${publish.launcherWaitsMs} ms for it: ` +
    `${publish.withinWait ? "within the wait" : "PAST THE WAIT (reported, not failed — a name typed during a relaunch would be refused)"}`,
);
console.log(
  `Agents package verified (${signed ? "Developer ID signature checked" : "runtime only; release signature not checked"}).`,
);

function run(filter, vitestArgs) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["--filter", filter, "exec", "vitest", "run", ...vitestArgs],
      {
        cwd: repoRoot,
        env: environment,
        stdio: "inherit",
        shell: process.platform === "win32",
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`packaged Agents tests failed in ${filter} (${signal ?? code})`));
    });
  });
}
