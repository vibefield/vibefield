// THE ROLES of fieldd's own executable (FS-1a's files worker; AR-7j's agent
// shim). A packaged fieldd is a Node single-executable application (EDP-14): it
// runs nothing but its own blob, its RunAsNode fuse is closed, and it carries no
// Node a second program could be handed. So whatever else must run as Node runs
// as fieldd ITSELF, in a role, and each role loads ONE bundle sealed beside the
// executable — a real file next to it, as the service harness is.
//
// The roles are CLOSED: this file names every one, and a role is picked by the
// executable's FIRST argument alone (`roleOf`). A SEA hands its user arguments
// from `process.argv[2]`, the index `node bin.cjs <arg>` hands them at, so one
// rule serves the packaged executable and a development bundle alike. Never by
// `argv.includes`: an agent typed with `--vibefield-role=files-host` among its
// arguments passes that word on as ITS argument, and it must never pick a role
// of ours.
//
// No imports: bin.ts dispatches on this before any module of the daemon's is
// evaluated, so a role pays for builtins and its own bundle and nothing more.

/** The argument that makes the executable a files worker (FS-1a, L1). */
export const FILES_HOST_ROLE_ARG = "--vibefield-role=files-host";
/** The files worker's bundle, beside fieldd's. */
export const FILES_HOST_BUNDLE = "files-host.cjs";

/** The argument that makes the executable an agent's launcher runtime (AR-7j):
 * the program every launcher in a packaged build execs on the shim. */
export const AGENT_SHIM_ROLE_ARG = "--vibefield-role=agent-shim";
/** puppeteer's spawn-through shim, bundled by fieldd's build and SEALED beside
 * the executable — the copy the role runs, never the shim home's. */
export const AGENT_SHIM_BUNDLE = "agent-shim.cjs";

/** How the agent-shim role leaves when the sealed shim cannot be loaded: the
 * kit's own status for a launcher that cannot run anything
 * (`SPAWN_THROUGH_EXIT_UNAVAILABLE`, the shell's "not found"), spelled here
 * because this file imports nothing; a row holds the two equal. */
export const AGENT_SHIM_EXIT_UNAVAILABLE = 127;

/** A command name as the kit writes launchers for (its `COMMAND_NAME`). */
const COMMAND_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

/** The one line a person reads when this copy of VibeField has lost the file
 * it starts agents with — after the gateway chose the role, which it does only
 * while that file stands (a damaged install, a half-finished update). The
 * launcher's name when it is one the kit writes, else "the agent"; never a
 * path. */
export function agentShimUnavailable(name: string | undefined): string {
  const agent = name !== undefined && COMMAND_NAME.test(name) ? name : "the agent";
  return `VibeField: ${agent} was not started: this copy of VibeField is missing the file it starts agents with. Reinstall VibeField.`;
}

export type FielddRole = "files-host" | "agent-shim";

/** The role the process's FIRST argument names, or none: positional, so an
 * argument further along — an agent's own, typed by a person — is never read.
 * `argv` is `process.argv`: the runtime, the script (a SEA repeats the
 * executable there), then the user's arguments. */
export function roleOf(argv: readonly string[]): FielddRole | undefined {
  const first = argv[2];
  if (first === FILES_HOST_ROLE_ARG) return "files-host";
  if (first === AGENT_SHIM_ROLE_ARG) return "agent-shim";
  return undefined;
}

/** The argv the sealed shim runs with: as if `node <sealed> <the agent's
 * arguments…>` had started it — the shim reads its arguments from
 * `process.argv.slice(2)`.
 *
 * A launcher execs `<runtime.command> <runtime.args…> <home>/lib/agent-shim.cjs
 * "$@"` (the kit's `launcherScript`), so the role stands at argv[2] and the
 * HOME's copy of the shim at argv[3]. That copy is a file of the user's root,
 * which anything of this user's can write: the role DROPS it — never reads it,
 * never runs it — and runs the sealed bundle in its place. Everything after it
 * is the agent's, passed on exactly. */
export function agentShimArgv(argv: readonly string[], execPath: string, sealed: string): string[] {
  return [execPath, sealed, ...argv.slice(4)];
}
