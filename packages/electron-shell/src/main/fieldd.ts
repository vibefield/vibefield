import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFielddSupervisor, type FielddSupervisor } from "@vibefield/fieldd-supervisor";
import type { Logger } from "@vibefield/logging";
import { app } from "electron";
import { isSmokeLike, type ShellMode, shutdownPolicy } from "./modes";
import type { DesktopResources } from "./resources";

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
  resources: DesktopResources;
  viteUrl: string;
  logRoot: string;
  logger: Logger;
}): FielddSupervisor {
  // Env overrides still win — they are how smoke harnesses and a developer
  // testing a packaged layout redirect the daemon — but the DEFAULT now comes
  // from the injected layout, never from a path this file derives. That is the
  // §4.3 law: a packaged build must not be able to reach a repository, even by
  // accident, so `repoRoot` is no longer an input here.
  // FIELDD_BIN overrides the ARGUMENT in node mode (a .cjs bundle) and the
  // COMMAND when fieldd is its own executable — the two shapes the launcher
  // takes on either side of EDP-14.
  const nodeMode = opts.resources.fielddNeedsNodeMode;
  const override = process.env["FIELDD_BIN"];
  const command = nodeMode
    ? opts.resources.fielddCommand
    : (override ?? opts.resources.fielddCommand);
  const args = nodeMode
    ? [override ?? opts.resources.fielddArgs[0]]
    : [...opts.resources.fielddArgs];
  const nativeBin = process.env["FIELDD_NATIVE_BIN"] ?? opts.resources.fieldNativePath;
  const launchTarget = nodeMode ? args[0] : command;
  if (launchTarget === undefined || !existsSync(launchTarget)) {
    throw new Error(`fieldd bin missing (build it): ${launchTarget ?? "(unset)"}`);
  }
  const smokeLike = opts.mode === "smoke" || opts.mode === "smoke-canvas";
  const logger = opts.logger.child({ component: "daemon.supervisor" });
  const pluginRoots = opts.resources.pluginRoots;
  return createFielddSupervisor({
    dataRoot: opts.root,
    spawn: { command, args: args.filter((a): a is string => a !== undefined) },
    environment: {
      ...process.env,
      // Set ONLY when the command is genuinely Electron. A packaged build execs
      // a real fieldd, where the RunAsNode fuse is off and the variable is
      // ignored — asking for node mode there would be a claim the artifact
      // cannot honour (ESP §9.3).
      ...(nodeMode ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      // PLUG-P2 — plugin discovery roots (§9.1), now layout-derived: the repo in
      // development, Resources/plugins/bundled when packaged. Explicit env still
      // wins (PATH-style lists, see fieldd bin.ts).
      FIELDD_PLUGIN_ROOTS: process.env["FIELDD_PLUGIN_ROOTS"] ?? pluginRoots.bundled.join(":"),
      FIELDD_PLUGIN_DEV_ROOTS:
        process.env["FIELDD_PLUGIN_DEV_ROOTS"] ?? pluginRoots.devLinked.join(":"),
      // The shell resolved this root under its own mode policy. Passing that
      // trusted absolute decision keeps all three process owners aligned while
      // fieldd still refuses an ambient override on its own.
      FIELD_LOG_DIR: opts.logRoot,
      FIELDD_ALLOW_LOG_DIR_OVERRIDE: "1",
    },
    ...(existsSync(nativeBin) ? { nativeExecutable: nativeBin } : {}),
    ...(opts.mode === "dev" ? { allowedOrigins: [new URL(opts.viteUrl).origin] } : {}),
    ...(smokeLike ? { controlPort: 0, dataPort: 0 } : {}),
    shutdownPolicy: shutdownPolicy(opts.mode),
    onEvent: (event) => {
      if (event.kind === "lifecycle") {
        logger.info(event.event, event.message, event.attrs);
      } else if (event.kind === "readiness") {
        logger.info("desktop.fieldd.readiness_received", "fieldd readiness was validated", {
          port: event.signal.port,
          bootId: event.signal.bootId,
        });
      } else if (event.kind === "stderr") {
        logger.error(
          "desktop.fieldd.emergency_output",
          "fieldd emitted bounded emergency stderr",
          undefined,
          { line: event.line },
        );
      } else {
        logger.warn(
          "desktop.fieldd.unexpected_stdout",
          "fieldd emitted unexpected bounded stdout",
          { line: event.line },
        );
      }
    },
  });
}
