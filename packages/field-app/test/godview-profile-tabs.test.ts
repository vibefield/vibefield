import type { AgentPersona, AgentProfileSet } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  agentProfileSet,
  chosenProfile,
  personaProfiles,
  profileTabs,
  recedeOutside,
  showsProfileTabs,
  withProfileSets,
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

describe("a terminal born under a profile (SB-3)", () => {
  const shell = (id: string, profileSet?: string): MonitorAgent =>
    ({ ...row(id, null), ...(profileSet !== undefined ? { profileSet } : {}) }) as MonitorAgent;

  it("runs under the profile its shell was born under, so a chosen Work tab keeps a Work shell", () => {
    const rows = [shell("work-shell", "work"), shell("bare"), shell("orphan", "deleted-set")];
    expect(agentProfileSet(rows[0]!, personas)).toBe("work");
    expect(agentProfileSet(rows[1]!, personas)).toBeUndefined();
    expect(
      recedeOutside(rows, "work", personas).map((agent) => [agent.id, agent.receded === true]),
    ).toEqual([
      ["work-shell", false],
      ["bare", true],
      ["orphan", true],
    ]);
    // A set deleted since recedes under every tab, like an unbound shell, and
    // lights no tab's dot.
    for (const tab of ["native", "personal", "work"]) {
      expect(recedeOutside(rows, tab, personas)[2]?.receded).toBe(true);
    }
    const blockedOrphan = { ...shell("x", "deleted-set"), status: "blocked" } as MonitorAgent;
    expect(profileTabs(SETS, [blockedOrphan], personas).some((tab) => tab.blocked)).toBe(false);
  });

  it("puts on every row the set the tabs compute, and hands an unchanged row on as itself", () => {
    const rows = [
      row("w1", { profileSet: "work" }),
      row("p1", { profileId: "p-claude" }),
      row("m1", {}),
      shell("s1", "work"),
      shell("t1"),
      row("gone", { profileId: "signed-out" }),
    ];
    const stamped = withProfileSets(rows, personas);
    expect(stamped.map((agent) => [agent.id, agent.profileSet])).toEqual([
      ["w1", "work"],
      ["p1", "personal"],
      ["m1", "native"],
      ["s1", "work"],
      ["t1", undefined],
      ["gone", undefined],
    ]);
    expect(stamped[3]).toBe(rows[3]);
    expect(stamped[4]).toBe(rows[4]);
    expect(withProfileSets(stamped, personas).every((agent, i) => agent === stamped[i])).toBe(true);
    // a row whose set is no longer known drops the one it carried
    const stale = { ...row("stale", { profileId: "signed-out" }), profileSet: "work" };
    expect("profileSet" in (withProfileSets([stale], personas)[0] ?? {})).toBe(false);
  });
});
