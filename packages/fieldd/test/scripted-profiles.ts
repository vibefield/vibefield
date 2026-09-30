// AR-S2 — the scripted agent's account capability, shared by every suite that
// needs a sign-in to hold a LIVE session (agent-session.test.ts's spawns, and
// since SB-2 the typed agent in a pane born under a profile): its root is bound
// through a variable of its own — the fake's name, never a vendor's (AR-L1) —
// its identity is whatever this says, and its native default points nowhere
// real. Test-only; the gate's R23 never reads it.
import type { AgentProfile, ProfileService } from "@vibecook/puppeteer-core";

/** The one variable the scripted agent's binding sets: its managed root. */
export const SCRIPTED_ROOT_VARIABLE = "SCRIPTED_HOME";

export function scriptedProfiles(): ProfileService {
  return {
    provider: {
      id: "scripted",
      label: "Scripted",
      support: {
        supported: true,
        identity: "native-status",
        sharedSurfaces: [],
        nativeDefaultRoot: "/nonexistent/.scripted",
      },
    },
    bindingEnvironment: (profile: AgentProfile): Record<string, string> =>
      profile.kind === "managed" ? { [SCRIPTED_ROOT_VARIABLE]: profile.dataRoot } : {},
    observationRoot: (profile: AgentProfile) => profile.dataRoot,
    // returns at once, unless a row asks for a login that stays open
    loginInvocation: (_profile, options) => ({
      command: "/bin/sh",
      args: ["-c", process.env["SCRIPTED_LOGIN"] ?? "exit 0"],
      cwd: options.cwd,
    }),
    async verify() {
      return {
        loggedIn: true,
        email: "scripted@example.test",
        verifiedAt: new Date().toISOString(),
        source: { kind: "native-status", stability: "documented" },
      };
    },
  };
}
