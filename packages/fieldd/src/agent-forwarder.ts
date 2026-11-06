import { dirname, join } from "node:path";
import type { AgentForwarderRuntime } from "@vibefield/puppeteer-core";
import { isReadableFile } from "./agent-gateway";
import { AGENT_FORWARDER_BUNDLE, AGENT_FORWARDER_ROLE_ARG } from "./roles";

// THE AGENTS' FORWARDER RUNTIME (RV #1, item 203; rv-forwarder-role at its lean A):
// the program a managed agent's command hooks and status lines run in the agent's
// process tree, to relay what the agent wrote to its adapter's loopback ingress —
// puppeteer's `AgentHost.forwarderRuntime`, which `agent-host.ts` lends.
//
// puppeteer decides which Node runs a script (native-observation's script runner,
// the one authority): a real Node runs it itself, Electron a node on PATH or itself
// as Node. A single executable has no runner — it runs only its own blob, so a
// staged forwarder handed to it would start the blob instead — and puppeteer then
// refuses the launch (`FORWARDER_RUNTIME_UNAVAILABLE`) unless its host lends the
// program. So fieldd lends ONLY what puppeteer cannot know: how a single-executable
// fieldd runs puppeteer's forwarder entry, which is itself, in its closed fifth role
// (`--vibefield-role=agent-forwarder`, roles.ts), running the entry sealed beside
// it. Every other fieldd lends nothing.
//
// A packaged build names no program the person installed: never a node on PATH
// (`chooseLauncherRuntime`'s rule). A single executable whose sealed forwarder is
// gone lends nothing either, and puppeteer's refusal is the honest answer: an agent
// launched unobserved would be worse.

/** What the rule reads, each injectable: a unit row states a case by its facts and
 * never by the machine it happens to run on. */
export interface ForwarderRuntimeFacts {
  /** this process is a single-executable application (a packaged fieldd, EDP-14) */
  sea: boolean;
  /** this process's own program */
  execPath: string;
  /** whether a file stands, readable, at a path (default: this machine's) — what a
   * single executable's sealed forwarder is looked for with */
  exists?: ((path: string) => boolean) | undefined;
}

/** The sealed forwarder the agent-forwarder role runs: beside the executable
 * (build-fieldd-sea.mjs seals it there; stage-package.mjs stages it at
 * `Resources/bin`). */
export function sealedAgentForwarder(execPath: string): string {
  return join(dirname(execPath), AGENT_FORWARDER_BUNDLE);
}

/** THE FORWARDER'S RUNTIME, chosen once, when the host is made: a single
 * executable whose sealed forwarder is readable lends ITSELF in the
 * agent-forwarder role; every other case lends nothing, and puppeteer's own
 * script runner decides (or refuses, for a single executable). */
export function chooseForwarderRuntime(
  facts: ForwarderRuntimeFacts,
): AgentForwarderRuntime | undefined {
  if (!facts.sea) return undefined;
  if (!(facts.exists ?? isReadableFile)(sealedAgentForwarder(facts.execPath))) return undefined;
  return { command: facts.execPath, args: [AGENT_FORWARDER_ROLE_ARG] };
}

/** This process's own facts for the rule. */
export function ownForwarderRuntimeFacts(): ForwarderRuntimeFacts {
  let sea = false;
  try {
    const builtin = process.getBuiltinModule?.("node:sea") as { isSea?: () => boolean } | undefined;
    sea = builtin?.isSea?.() === true;
  } catch {
    // a Node with no such module is no single executable
  }
  return { sea, execPath: process.execPath };
}
