import type { AgentRuntime } from "@vibecook/puppeteer-runtime";
import type { TerminalProfileBinding } from "./terminal-service";

// SB-2 (AR-7g) — THE SHELL IS BORN UNDER ITS PROFILE. A `terminal.create` that
// names an Agent Profile (puppeteer's profile set) is born with that profile's
// binding environment: the variables that route each agent the shell starts to
// the set's sign-in for it. puppeteer owns the variables — which exist, what
// they name, what they hold — and VibeField spells none of them (AR-L1): the
// map is opaque here, passed through the create's fence and on to the floor,
// never branched on, named, logged or recorded.

/** How the daemon answers `TerminalServiceOptions.profileBinding` from the
 * agent runtime: the set (`runtime.profileSet`), its sign-ins — the active
 * accounts, one per provider — and puppeteer's `profileBindingEnvironment` over
 * them, which merges each account's variables and throws on an account it does
 * not know or a provider bound twice. The native set is the agents' own
 * folders: it binds nothing and is never handed to the runtime to bind. */
export function runtimeProfileBinding(
  runtime: Pick<AgentRuntime, "profileSet" | "profileBindingEnvironment">,
): (profileSet: string) => Promise<TerminalProfileBinding> {
  return async (profileSet) => {
    let info: Awaited<ReturnType<AgentRuntime["profileSet"]>>;
    try {
      info = await runtime.profileSet(profileSet);
    } catch (error) {
      return { state: "unavailable", reason: messageOf(error) };
    }
    if (info === undefined) return { state: "unknown" };
    const label = info.set.label;
    if (info.set.kind === "native") return { state: "bound", label, variables: {} };
    try {
      const variables = await runtime.profileBindingEnvironment(
        info.profiles.map((account) => account.id),
      );
      return { state: "bound", label, variables };
    } catch (error) {
      return { state: "failed", label, reason: messageOf(error) };
    }
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
