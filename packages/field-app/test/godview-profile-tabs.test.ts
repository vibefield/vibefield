import { agentViewFixture } from "@vibecook/puppeteer-view-sdk/testing";
import type { AgentPersona, AgentProfileSet } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  agentProfileSet,
  chosenProfile,
  profileTabs,
  showsProfileTabs,
} from "../src/godview/monitor/profile-tabs";
import type { MonitorAgent } from "../src/godview/monitor/types";

// AR-S5 — the bar's profile tabs as pure functions: which profile a row runs
// under, the strip, what a chosen tab recedes. MV-3b: the row's `profileSet` is
// the BACKEND's word (`resolveProfileSet`: fieldd's set, else the sign-in's,
// else This Mac), carried on the model; a peer's set is dropped by
// the window's rows pass before any reader sees it.

const AT = "2026-09-24T12:00:00.000Z";

function persona(profileId: string, provider: string, kind: AgentPersona["kind"]): AgentPersona {
  return { profileId, provider, label: provider, kind, createdAt: AT };
}

function set(
  id: string,
  label: string,
  personas: AgentPersona[],
  extra: Partial<AgentProfileSet> = {},
): AgentProfileSet {
  return {
    id,
    kind: id === "native" ? "native" : "managed",
    label,
    default: false,
    createdAt: AT,
    personas,
    ...extra,
  };
}

const NATIVE = set("native", "This Mac", [
  persona("claude:native-default", "claude", "native-default"),
]);
const PERSONAL = set("personal", "Personal", [persona("p-claude", "claude", "managed")], {
  glyph: "house",
  default: true,
});
const WORK = set(
  "work",
  "Work",
  [persona("w-claude", "claude", "managed"), persona("w-codex", "codex", "managed")],
  { glyph: "briefcase" },
);
const SETS = [NATIVE, PERSONAL, WORK];

/** The backend's row, with the profile resolved once beside the runtime. */
function row(
  id: string,
  facet: boolean,
  profileSet: string | undefined,
  status: MonitorAgent["status"] = "idle",
): MonitorAgent {
  return agentViewFixture({ id, kind: facet ? "agent" : "terminal", status, profileSet });
}

describe("which profile a session runs under", () => {
  it("is the row's own word — the backend's chain: fieldd's set, the sign-in's, This Mac", () => {
    expect(agentProfileSet(row("a", true, "work"))).toBe("work");
    expect(agentProfileSet(row("b", true, "personal"))).toBe("personal");
    expect(agentProfileSet(row("d", true, "native"))).toBe("native");
  });

  it("puts a bare terminal, a peer's session and a shell under no set under no profile", () => {
    expect(agentProfileSet(row("t", false, undefined))).toBeUndefined();
    const remote = {
      ...row("r", true, "native"),
      device: { id: "mini", name: "studio-mini", self: false },
    } as MonitorAgent;
    expect(agentProfileSet(remote)).toBeUndefined();
  });
});

describe("the strip", () => {
  it("is drawn once a profile besides This Mac exists", () => {
    expect(showsProfileTabs([NATIVE])).toBe(false);
    expect(showsProfileTabs([])).toBe(false);
    expect(showsProfileTabs(SETS)).toBe(true);
  });

  it("lists the profiles in the feed's order, fills the default, and dots only a profile with a blocked session", () => {
    const tabs = profileTabs(SETS, [
      row("w1", true, "work", "blocked"),
      row("p1", true, "personal", "working"),
    ]);
    expect(tabs).toEqual([
      { id: "native", label: "This Mac", kind: "native", isDefault: false },
      { id: "personal", label: "Personal", kind: "managed", glyph: "house", isDefault: true },
      {
        id: "work",
        label: "Work",
        kind: "managed",
        glyph: "briefcase",
        isDefault: false,
        blocked: true,
      },
    ]);
  });

  it("falls back to All for a profile the feed no longer has, and for any choice while no strip is drawn", () => {
    expect(chosenProfile(SETS, "work")?.id).toBe("work");
    expect(chosenProfile(SETS, "deleted")).toBeUndefined();
    expect(chosenProfile(SETS, null)).toBeUndefined();
    expect(chosenProfile([NATIVE], "native")).toBeUndefined();
  });
});

describe("a terminal born under a profile (SB-3)", () => {
  const shell = (id: string, profileSet?: string): MonitorAgent => row(id, false, profileSet);

  it("runs under the profile its shell was born under, so a chosen Work tab keeps a Work shell", () => {
    const rows = [shell("work-shell", "work"), shell("bare"), shell("orphan", "deleted-set")];
    expect(agentProfileSet(rows[0] as MonitorAgent)).toBe("work");
    expect(agentProfileSet(rows[1] as MonitorAgent)).toBeUndefined();
    const blockedOrphan = { ...shell("x", "deleted-set"), status: "blocked" } as MonitorAgent;
    expect(profileTabs(SETS, [blockedOrphan]).some((tab) => tab.blocked)).toBe(false);
  });
});
