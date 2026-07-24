import type { CommandInvocation, Disposable } from "@vibefield/plugin-sdk";
import { getRendererLogger } from "../logging";
import { getPluginRegistrySnapshot } from "./plugin-registry-store";

// The spine command registry (P6, spec §8.3 / §13.1): the renderer-side handler
// table behind ctx.commands. The SPINE owns invocation, provenance, and args
// validation; plugins only bind handlers for the commands their manifest
// DECLARES. This module is the runtime binding half; the palette reads the
// fieldd snapshot for the LISTING half (declared-but-unbound rows render as
// unavailable there — §8.3 "visible as unavailable when useful").
//
// §8.3 rules realised here:
//  - register refuses undeclared ids and double-binds;
//  - invoke records plugin provenance (structured, via the renderer logger —
//    NEVER console.*, R11/R15);
//  - handlers are removed immediately on deactivate (the Disposable), and
//    invoking a removed / never-bound but DECLARED command surfaces an honest
//    "unavailable" OUTCOME, never a throw-crash.
//
// ARGS VALIDATION — v1 decision (recorded): every v1 invocation passes
// args === undefined (the palette and the canvas-context C-key both invoke
// arg-less). Real per-command JSON-Schema validation lands with a lazy
// validator (§8.3 "validates args before invoking"); until then, if a caller
// supplies args we REFUSE honestly rather than pass unvalidated data to a
// handler — no silent fake. The message names the declared-schema case
// specifically so the deferred path is legible.

interface Binding {
  pluginId: string;
  handler: (args: unknown, invocation: CommandInvocation) => void | Promise<void>;
}

/** The result of an invoke attempt — never a throw. The palette and the
 * canvas-context seam read this to stay honest about what happened. */
export type CommandOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: "unavailable" | "unknown" | "args-unvalidated" | "threw";
      message: string;
    };

const bindings = new Map<string, Binding>();

function log() {
  return getRendererLogger().child({ component: "plugin.host" });
}

/** Is `commandId` DECLARED by `pluginId` in the current fieldd snapshot? Truth
 * is the snapshot (P5). When the snapshot is absent (daemon-away boot, dev
 * drift) it cannot refute a declaration, so it does not gate — the structural
 * ownership rule below stands in (two-plane law: the canvas never waits on
 * fieldd). Returns "unknown" when the snapshot can neither confirm nor deny. */
function snapshotDeclares(pluginId: string, commandId: string): boolean | "unknown" {
  const snapshot = getPluginRegistrySnapshot();
  if (snapshot === null) return "unknown";
  const record = snapshot.plugins.find((p) => p.id === pluginId);
  if (record === undefined) return "unknown";
  return record.contributions.commands.some((c) => c.id === commandId);
}

/** Is `commandId` declared by ANY plugin in the snapshot, and does it declare
 * an args schema? Used by invoke to distinguish unavailable-vs-unknown and to
 * tailor the args-refusal message. */
function findDeclaration(commandId: string): { declared: boolean; hasArgsSchema: boolean } {
  const snapshot = getPluginRegistrySnapshot();
  if (snapshot === null) return { declared: false, hasArgsSchema: false };
  for (const p of snapshot.plugins) {
    const c = p.contributions.commands.find((x) => x.id === commandId);
    if (c !== undefined) return { declared: true, hasArgsSchema: c.args !== undefined };
  }
  return { declared: false, hasArgsSchema: false };
}

/** Is `pluginId` enabled per the fieldd snapshot? "unknown" when the snapshot
 * cannot say (absent/record missing) — the honest degraded default is to let
 * the invocation proceed (the tray's "null snapshot hides nothing" rule). */
function pluginEnabled(pluginId: string): boolean | "unknown" {
  const snapshot = getPluginRegistrySnapshot();
  if (snapshot === null) return "unknown";
  const record = snapshot.plugins.find((p) => p.id === pluginId);
  return record === undefined ? "unknown" : record.enabled;
}

/** Bind a handler for a command this plugin DECLARES (§13.1). Refuses ids the
 * plugin does not own, ids the snapshot positively says it did not declare, and
 * double-binds. Throws on refusal (a registration-time programmer error, like
 * widget register); the honest-outcome path is invoke's, not register's. */
export function register(
  pluginId: string,
  commandId: string,
  handler: Binding["handler"],
): Disposable {
  // Structural ownership (§6.2, always enforceable without fieldd): a command
  // id is `<pluginId>.<name>`. The manifest validator already proved this at
  // emit time; re-checking keeps a mis-wired harness honest.
  if (!commandId.startsWith(`${pluginId}.`))
    throw new Error(`command ${commandId} is not owned by ${pluginId} (§6.2)`);
  // Snapshot declared-gate: when fieldd's truth is available AND names this
  // plugin, the command MUST be in its declared set. A "unknown" verdict
  // (snapshot absent) does not gate — bundled plugins bind at boot before the
  // first snapshot lands (P3c), exactly as their widgets do.
  if (snapshotDeclares(pluginId, commandId) === false)
    throw new Error(`command ${commandId} is not declared by ${pluginId} (§8.3)`);
  if (bindings.has(commandId))
    throw new Error(`command ${commandId} already bound in this entry (§8.3)`);
  bindings.set(commandId, { pluginId, handler });
  return {
    dispose() {
      // Idempotent + identity-guarded: a re-bind under the same id must not be
      // clobbered by a late dispose from the prior binding.
      if (bindings.get(commandId)?.handler === handler) bindings.delete(commandId);
    },
  };
}

/** Is a handler currently bound for `commandId`? The palette marks a declared
 * command "unavailable" when this is false (§8.3). */
export function isCommandBound(commandId: string): boolean {
  return bindings.has(commandId);
}

/** Invoke a command (§13.1). Records provenance, validates args (v1: arg-less),
 * and NEVER throws — a removed / never-bound but declared command yields an
 * honest "unavailable" outcome; an unknown command yields "unknown"; a throwing
 * handler is contained and reported. The spine sets the invocation's source and
 * userGesture — a handler cannot claim otherwise (§13.1). */
export async function invoke(
  commandId: string,
  args: unknown,
  invocation: CommandInvocation,
): Promise<CommandOutcome> {
  const binding = bindings.get(commandId);
  if (binding === undefined) {
    const { declared } = findDeclaration(commandId);
    const reason = declared ? "unavailable" : "unknown";
    const message = declared
      ? "command declared but no handler is bound (plugin disabled, failed, or deactivated)"
      : "no plugin declares this command";
    log().warn("renderer.commands.unavailable", "A command invocation found no live handler", {
      commandId,
      source: invocation.source,
      reason,
    });
    return { ok: false, reason, message };
  }

  // Enablement gate (P5 / §8.3): a DISABLED plugin's handler stays bound
  // (P3c — disable swaps faces, never unregisters), but it must not ACT — the
  // same rule that stops the tray offering new spawns of a disabled plugin. A
  // null/unknown snapshot does not gate (honest degraded default).
  if (pluginEnabled(binding.pluginId) === false) {
    log().warn("renderer.commands.unavailable", "A disabled plugin's command was not run", {
      commandId,
      pluginId: binding.pluginId,
      source: invocation.source,
      reason: "disabled",
    });
    return {
      ok: false,
      reason: "unavailable",
      message: "the owning plugin is disabled — enable it to run this command",
    };
  }

  // v1 args gate — no silent fake (see the header note).
  if (args !== undefined) {
    const { hasArgsSchema } = findDeclaration(commandId);
    const message = hasArgsSchema
      ? "args schema validation is not implemented yet (lazy validator lands later); refusing rather than passing unvalidated args"
      : "this command declares no args; refusing supplied args";
    log().warn("renderer.commands.args_refused", "A command invocation supplied unvalidated args", {
      commandId,
      pluginId: binding.pluginId,
      source: invocation.source,
    });
    return { ok: false, reason: "args-unvalidated", message };
  }

  // Provenance: which plugin, which command, from where, with a gesture — never
  // the args payload (it may carry user content; args are refused above anyway).
  log().info("renderer.commands.invoked", "A plugin command was invoked", {
    commandId,
    pluginId: binding.pluginId,
    source: invocation.source,
    userGesture: invocation.userGesture,
    selectionCount: invocation.selection.length,
  });
  try {
    await binding.handler(args, invocation);
    return { ok: true };
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : String(error);
    log().error("renderer.commands.handler_failed", "A plugin command handler threw", error, {
      commandId,
      pluginId: binding.pluginId,
    });
    return { ok: false, reason: "threw", message: errMessage };
  }
}
