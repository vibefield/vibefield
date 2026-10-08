#!/usr/bin/env node
// `node packaging/run-studio-smoke.mjs` — `pnpm smoke:studio` ON A FRESH PROFILE, the run-smoke.mjs way (DK-18, plan
// (88)). The Studio's physical acceptance runs the DEVELOPMENT runner (`tooling/dev-runner/src/cli.mjs
// --studio-physical`: the real dev composition — the Vite renderer, the product window and Studio's under one Electron,
// the daemon pair), and the runner keeps ALL its state under one root: the checkout's persistent `.vibefield/dev` until
// DK-18, so no slice could run it fresh. `VIBEFIELD_DEV_ROOT` moves that root whole (tooling/dev-runner/src/paths.mjs),
// so this mints one under /tmp (short — the daemons' unix sockets live beneath it), gives it ONE user already onboarded
// (minted by the users package as main mints a smoke's, `mintOnboarded`: the dev shell would otherwise hold its boot on
// the Setup Assistant), runs the acceptance on it MARKED as a smoke run is (`VF_SMOKE_RUN` — every process the runner
// starts inherits it), takes the same row once the runner has exited (no daemon of the run lives — smoke-daemons.mjs),
// and removes the root: whole when green; kept and named (`SMOKE_STUDIO_ROOT`) when red, for its logs.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { leftByRun, SMOKE_RUN_ENV } from "./smoke-daemons.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const root = mkdtempSync(
  process.platform === "win32" ? join(tmpdir(), "vf-studio-") : "/tmp/vf-studio-",
);
const mark = basename(root);

// the dev shell's VibeField root is the runner's `data` (it hands the shell FIELDD_DATA_DIR = <root>/data)
const MINT = `import { ensureUsersRoot } from "./src/index.ts";
const ensured = await ensureUsersRoot(process.argv[1], { allowMint: true, mintOnboarded: true });
process.stdout.write(JSON.stringify({ userId: ensured.user.userId, onboarded: ensured.user.onboarded }));`;
const users = join(repoRoot, "packages", "users");
const minted = spawnSync(
  join(users, "node_modules", ".bin", "tsx"),
  ["--input-type=module", "-e", MINT, join(root, "data")],
  { cwd: users, encoding: "utf8" },
);
if (minted.status !== 0) {
  process.stderr.write(`run-studio-smoke: could not mint the onboarded user: ${minted.stderr}\n`);
  rmSync(root, { recursive: true, force: true });
  process.exit(2);
}
process.stdout.write(
  `SMOKE_STUDIO_ROOT ${JSON.stringify({ root, user: JSON.parse(minted.stdout) })}\n`,
);

const child = spawn(
  process.execPath,
  [join(repoRoot, "tooling", "dev-runner", "src", "cli.mjs"), "--studio-physical"],
  {
    cwd: repoRoot,
    env: { ...process.env, VIBEFIELD_DEV_ROOT: root, [SMOKE_RUN_ENV]: mark },
    stdio: "inherit",
  },
);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}

const settle = async (code) => {
  const daemons = await leftByRun(mark);
  process.stdout.write(`SMOKE_DAEMONS ${JSON.stringify(daemons)}\n`);
  if (daemons.left.length > 0) {
    process.stderr.write(
      `run-studio-smoke: ${daemons.left.length} process(es) of this run outlived it (reaped): ${daemons.left
        .map((p) => `${p.name} ${p.pid}`)
        .join(", ")}\n`,
    );
  }
  const ok = code === 0 && daemons.left.length === 0;
  if (ok) rmSync(root, { recursive: true, force: true });
  process.stdout.write(
    `SMOKE_STUDIO_ROOT_REMOVED ${JSON.stringify({ root, removed: !existsSync(root), kept: !ok })}\n`,
  );
  process.exit(ok ? 0 : code === 0 ? 1 : code);
};
child.once("error", (error) => {
  process.stderr.write(`run-studio-smoke: the dev runner did not start: ${error.message}\n`);
  void settle(2);
});
child.once("exit", (code, signal) => {
  void settle(code ?? 128 + (signal === null ? 0 : (constants.signals[signal] ?? 0)));
});
