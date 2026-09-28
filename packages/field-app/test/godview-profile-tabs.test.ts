import type { AgentPersona, AgentProfileSet } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  agentProfileSet,
  chosenProfile,
  personaProfiles,
  profileTabs,
  recedeOutside,
  showsProfileTabs,
} from "../src/godview/monitor/profile-tabs";
import type { MonitorAgent } from "../src/godview/monitor/types";
import { managedSummary } from "./managed-session-fixture";

// AR-S5 — the bar's profile tabs as pure functions: which profile a row runs
// under, the strip, what a chosen tab recedes, and where a spawn lands.

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

function row(
  id: string,
  facet: { profileId?: string; profileSet?: string } | null,
  status: MonitorAgent["status"] = "idle",
): MonitorAgent {
  const summary = managedSummary({
    runtimeRunId: id,
    ...(facet?.profileId !== undefined ? { profileId: facet.profileId } : {}),
  });
  return {
    id,
    createdAtMs: 0,
    status,
    project: id,
    detail: "",
    color: "currentColor",
    active: false,
    ...(facet === null
      ? {}
      : {
          agent: {
            provider: { id: "claude", label: "Claude" },
            kind: "claude",
            tier: "managed",
            runtimeRunId: id,
            recency: "fresh",
            summary,
            ...(facet.profileId !== undefined ? { profileId: facet.profileId } : {}),
            ...(facet.profileSet !== undefined ? { profileSet: facet.profileSet } : {}),
          },
        }),
  } as MonitorAgent;
}

const personas = personaProfiles(SETS);

describe("which profile a session runs under", () => {
  it("takes fieldd's word first, then the sign-in's profile, and a bare local agent is This Mac's", () => {
    expect(agentProfileSet(row("a", { profileSet: "work", profileId: "p-claude" }), personas)).toBe(
      "work",
    );
    expect(agentProfileSet(row("b", { profileId: "p-claude" }), personas)).toBe("personal");
    expect(agentProfileSet(row("c", { profileId: "claude:native-default" }), personas)).toBe(
      "native",
    );
    expect(agentProfileSet(row("d", {}), personas)).toBe("native");
  });

  it("puts a bare terminal, a peer's session and a sign-in the feed no longer lists under no profile", () => {
    expect(agentProfileSet(row("t", null), personas)).toBeUndefined();
    const remote = {
      ...row("r", {}),
      remote: {
        deviceId: "mini",
        deviceName: "studio-mini",
        remoteSessionId: "s1",
        attachable: true,
        hostWritable: false,
        cwdLabel: null,
      },
    } as MonitorAgent;
    expect(agentProfileSet(remote, personas)).toBeUndefined();
    expect(agentProfileSet(row("gone", { profileId: "signed-out" }), personas)).toBeUndefined();
  });
});

describe("the strip", () => {
  it("is drawn once a profile besides This Mac exists", () => {
    expect(showsProfileTabs([NATIVE])).toBe(false);
    expect(showsProfileTabs([])).toBe(false);
    expect(showsProfileTabs(SETS)).toBe(true);
  });

  it("lists the profiles in the feed's order, fills the default, and dots only a profile with a blocked session", () => {
    const tabs = profileTabs(
      SETS,
      [
        row("w1", { profileSet: "work" }, "blocked"),
        row("p1", { profileSet: "personal" }, "working"),
      ],
      personas,
    );
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

describe("a chosen tab", () => {
  const rows = [
    row("w1", { profileSet: "work" }),
    row("p1", { profileId: "p-claude" }),
    row("m1", {}),
    row("t1", null),
  ];

  it("keeps its profile's sessions as they are and recedes every other row in place", () => {
    const staged = recedeOutside(rows, "work", personas);
    expect(staged.map((agent) => [agent.id, agent.receded === true])).toEqual([
      ["w1", false],
      ["p1", true],
      ["m1", true],
      ["t1", true],
    ]);
    expect(staged[0]).toBe(rows[0]);
    expect(
      recedeOutside(rows, "native", personas)
        .filter((a) => !a.receded)
        .map((a) => a.id),
    ).toEqual(["m1"]);
    expect(recedeOutside(rows, undefined, personas)).toBe(rows);
  });
});
