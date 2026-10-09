#!/usr/bin/env node
// AR-8 packaging witness (L3): History's index daemon as the artifact ships it.
// Under --require-signed, the packaged rosettad's actual nested signature first.
// Then suites against the artifact's own files, none falling back to a source
// or lock build:
//  - fieldd's packaged-history rows exec the packaged fieldd SEA itself: with no
//    rosettad named its index is unconfigured in a person's words; with the
//    packaged rosettad the packaged pair reaches ready;
//  - fieldd's index-open-ticket and field-app's history-witness run a source
//    fieldd over the PACKAGED rosettad (FIELDD_ROSETTAD_BIN): the grants and the
//    kill matrix, and the room's ports speaking as the packaged window does
//    (`Origin: vibefield-app://shell` — the allow-origin answer, the preflight,
//    the 101 upgrade).
// Every one of those rows is opt-in, so a skip would read as a pass: each run
// writes a JSON report, and every row in it must have PASSED.
import { spawn } from "node:child_process";
import { accessSync, constants, lstatSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertReleaseSigned } from "./release-signature.mjs";

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(desktopRoot, "..", "..");
const args = process.argv.slice(2);
const signed = args.includes("--require-signed");
const positional = args.filter((arg) => arg !== "--require-signed");
if (positional.length !== 2 || positional[0] !== "--native-root") {
  throw new Error(
    "usage: verify-history-package.mjs --native-root <Resources/bin> [--require-signed]",
  );
}
const nativeRoot = realpathSync(resolve(positional[1]));
const exe = (name) => (process.platform === "win32" ? `${name}.exe` : name);
const rosettad = join(nativeRoot, exe("rosettad"));
const fieldd = join(nativeRoot, exe("fieldd"));
const shim = join(nativeRoot, "agent-shim.cjs");
for (const file of [rosettad, fieldd, shim]) {
  if (!lstatSync(file).isFile())
    throw new Error(`packaged History input is not a regular file: ${file}`);
}
for (const file of [rosettad, fieldd]) accessSync(file, constants.X_OK);

if (signed) await assertReleaseSigned(desktopRoot, [rosettad], "History");

console.log(`History package under test: ${nativeRoot}`);
const reports = mkdtempSync(join(tmpdir(), "vf-history-package-"));
const environment = {
  ...process.env,
  FIELDD_TEST_HISTORY_PACKAGE: nativeRoot,
  FIELDD_ROSETTAD_BIN: rosettad,
};
const suites = [
  {
    filter: "@vibefield/fieldd",
    files: ["test/packaged-history.test.ts", "test/index-open-ticket.test.ts"],
  },
  { filter: "@vibefield/field-app", files: ["test/history-witness.test.ts"] },
];
for (const suite of suites) {
  const report = join(reports, `${suite.filter.split("/")[1]}.json`);
  await run(suite.filter, [
    ...suite.files,
    "--reporter=default",
    "--reporter=json",
    `--outputFile.json=${report}`,
    // a cold signed SEA and a cold rosettad index outlast the 5 s default; each
    // row's own deadlines remain the tighter checks
    "--testTimeout=240000",
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
    console.log(`History package: ${suite.filter} ${file} — ${rows.length} rows passed`);
  }
}
console.log(
  `History package verified (${signed ? "Developer ID signature checked" : "runtime only; release signature not checked"}).`,
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
      else reject(new Error(`packaged History tests failed in ${filter} (${signal ?? code})`));
    });
  });
}
