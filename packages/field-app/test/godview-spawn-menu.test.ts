import { menuOf } from "@vibecook/puppeteer-views";
import type { AgentPersona, AgentProfileSet } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { profileTabs } from "../src/godview/monitor/profile-tabs";
import {
  HERE_DEVICE_ID,
  signedInLabels,
  spawnMenuOf,
  targetsHere,
} from "../src/godview/monitor/spawn-menu";

// SB-3 — the spawn menu as a pure function of the profile tabs' feed: this
// desktop alone (SB-D9), reading until the feed answers, then its profiles in
// the tabs' order with the tabs' fields and who is signed in under each.

const AT = "2026-09-30T12:00:00.000Z";

function persona(
  profileId: string,
  provider: string,
  kind: AgentPersona["kind"],
  loggedIn?: boolean,
): AgentPersona {
  return {
    profileId,
    provider,
    label: provider,
    kind,
    createdAt: AT,
    ...(loggedIn === undefined ? {} : { identity: { loggedIn, verifiedAt: AT } }),
  };
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

// This Mac: Claude's own folder signed in, Codex's read and signed out.
const NATIVE = set("native", "This Mac", [
  persona("claude:native-default", "claude", "native-default", true),
  persona("codex:native-default", "codex", "native-default", false),
]);
// Work: the default; a Claude sign-in (any state counts — the profile holds it).
const WORK = set("work", "Work", [persona("w-claude", "claude", "managed")], {
  glyph: "briefcase",
  default: true,
});
const DEMO = set("demo", "Demo", [], { glyph: "flask" });

describe("the spawn menu (SB-3)", () => {
  it("offers this desktop alone, reading its profiles until the feed answers", () => {
    expect(spawnMenuOf(null, [])).toEqual({
      devices: [{ id: HERE_DEVICE_ID, label: "This desktop", self: true, state: "reading" }],
    });
    // reading is no choice yet: the hold creates at once, under nothing named
    const menu = menuOf(spawnMenuOf(null, []));
    expect(menu.kind).toBe("instant");
    expect(menu.hub.profile).toBeNull();
  });

  it("lists the profiles in the tabs' order with the tabs' fields and who is signed in under each", () => {
    const sets = [NATIVE, WORK, DEMO];
    const tabs = profileTabs(sets, []);
    const blockedTabs = tabs.map((tab) => (tab.id === "demo" ? { ...tab, blocked: true } : tab));
    const menu = spawnMenuOf(sets, blockedTabs);
    expect(menu.devices).toHaveLength(1);
    expect(menu.devices[0]).toMatchObject({ id: HERE_DEVICE_ID, self: true, state: "ready" });
    expect(menu.devices[0]?.profiles).toEqual([
      {
        id: "native",
        label: "This Mac",
        kind: "native",
        isDefault: false,
        signedIn: ["Claude Code"],
      },
      {
        id: "work",
        label: "Work",
        glyph: "briefcase",
        kind: "managed",
        isDefault: true,
        signedIn: ["Claude Code"],
      },
      {
        id: "demo",
        label: "Demo",
        glyph: "flask",
        kind: "managed",
        isDefault: false,
        blocked: true,
        signedIn: [],
      },
    ]);
  });

  it("blooms two or more profiles with the default at the hub, and makes one profile no choice", () => {
    const bloom = menuOf(spawnMenuOf([NATIVE, WORK, DEMO], []));
    expect(bloom.kind).toBe("profiles");
    expect(bloom.hub.profile?.id).toBe("work");
    const one = menuOf(spawnMenuOf([NATIVE], []));
    expect(one.kind).toBe("instant");
    expect(one.hub.profile?.id).toBe("native");
  });

  it("names a signed-in agent once, by the catalog's label, and This Mac's only when signed in", () => {
    expect(signedInLabels(NATIVE)).toEqual(["Claude Code"]);
    const twice = set("twice", "Twice", [
      persona("a", "claude", "managed"),
      persona("b", "claude", "managed"),
      persona("c", "unknown-agent", "managed"),
    ]);
    expect(signedInLabels(twice)).toEqual(["Claude Code", "unknown-agent"]);
  });

  it("asks only this desktop for a terminal", () => {
    expect(targetsHere(undefined)).toBe(true);
    expect(targetsHere({})).toBe(true);
    expect(targetsHere({ deviceId: HERE_DEVICE_ID, profileSet: "work" })).toBe(true);
    expect(targetsHere({ deviceId: "mini" })).toBe(false);
  });
});
