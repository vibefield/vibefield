import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFielddSupervisor, type FielddSupervisor } from "@vibefield/fieldd-supervisor";
import { app } from "electron";
import { isSmokeLike, type ShellMode, shutdownPolicy } from "./modes";

// The supervisor owns adopt/spawn/probe/readiness (ESR §5.3); this builder
// owns only what a supervisor must never know: Electron paths, the runner
// (our own binary in Node mode), and the mode-derived policy. Smoke isolates
// BOTH daemon ports (slice-0 finding 2) and dev/smoke stop what they spawned —
// never an adopted process.

export function dataRoot(mode: ShellMode): string {
  const injected = process.env["FIELDD_DATA_DIR"];
  if (injected) return injected;
  if (isSmokeLike(mode)) return mkdtempSync(join(tmpdir(), "vf-smoke-"));
  return join(app.getPath("appData"), "VibeField");
}

export function buildSupervisor(opts: {
  mode: ShellMode;
  root: string;
  repoRoot: string;
  viteUrl: string;
}): FielddSupervisor {
  const fielddBin =
    process.env["FIELDD_BIN"] ?? join(opts.repoRoot, "packages", "fieldd", "dist", "bin.cjs");
  const nativeBin =
    process.env["FIELDD_NATIVE_BIN"] ?? join(opts.repoRoot, "target", "debug", "field-native");
  if (!existsSync(fielddBin)) throw new Error(`fieldd bin missing (build it): ${fielddBin}`);
  const smokeLike = opts.mode === "smoke" || opts.mode === "smoke-canvas";
  return createFielddSupervisor({
    dataRoot: opts.root,
    spawn: { command: process.execPath, args: [fielddBin] },
    environment: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    ...(existsSync(nativeBin) ? { nativeExecutable: nativeBin } : {}),
    ...(opts.mode === "dev" ? { allowedOrigins: [new URL(opts.viteUrl).origin] } : {}),
    ...(smokeLike ? { controlPort: 0, dataPort: 0 } : {}),
    shutdownPolicy: shutdownPolicy(opts.mode),
    onLog: (line) => console.log(`[fieldd] ${line}`),
  });
}
