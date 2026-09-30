// SB-2 (AR-7g) — the shell is born under its profile: how fieldd asks the agent
// runtime for a set's binding (`runtimeProfileBinding`). The runtime here is a
// stand-in that answers puppeteer's two doors; every name in a binding map is
// the fake's own (AR-L1 — VibeField spells no vendor's variable, in a test
// either).
import type { AgentProfile, ProfileSet } from "@vibecook/puppeteer-core";
import type { AgentRuntime } from "@vibecook/puppeteer-runtime";
import { describe, expect, it } from "vitest";
import { runtimeProfileBinding } from "../src/terminal-bindings";

type ProfileSetInfo = NonNullable<Awaited<ReturnType<AgentRuntime["profileSet"]>>>;

const CREATED = "2026-09-30T00:00:00.000Z";

function account(id: string, provider: string, set: string): AgentProfile {
  return {
    id,
    provider,
    label: id,
    kind: "managed",
    dataRoot: `/profiles/${set}/${id}`,
    createdAt: CREATED,
    set,
  };
}

function setInfo(set: ProfileSet, profiles: AgentProfile[]): ProfileSetInfo {
  return { set, isDefault: false, profiles };
}

const WORK = setInfo(
  {
    id: "work",
    kind: "managed",
    label: "Work",
    directory: "/profiles/work",
    createdAt: CREATED,
  },
  [account("scripted-1", "scripted", "work"), account("other-1", "other", "work")],
);
const NATIVE = setInfo({ id: "native", kind: "native", label: "This Mac", createdAt: CREATED }, [
  account("scripted:native", "scripted", "native"),
]);

/** puppeteer's two doors, answering from `sets`, and what each was asked. */
function runtimeOf(
  sets: ProfileSetInfo[],
  doors: {
    profileSet?: (setId: string) => Promise<ProfileSetInfo | undefined>;
    bind?: (ids: readonly string[]) => Promise<Record<string, string>>;
  } = {},
) {
  const bound: string[][] = [];
  const runtime: Pick<AgentRuntime, "profileSet" | "profileBindingEnvironment"> = {
    profileSet: doors.profileSet ?? (async (setId) => sets.find((info) => info.set.id === setId)),
    profileBindingEnvironment: async (ids) => {
      bound.push([...ids]);
      return (
        doors.bind?.(ids) ??
        Object.fromEntries(
          ids.map((id) => [`VF_PROBE_${id.toUpperCase().replace(/\W/gu, "_")}`, id]),
        )
      );
    },
  };
  return { runtime, bound };
}

describe("SB-2 — a set's binding, as fieldd asks the agent runtime for it", () => {
  it("a managed set binds its sign-ins: the runtime is asked with their ids, and its map is handed on as it answered", async () => {
    const { runtime, bound } = runtimeOf([WORK, NATIVE]);
    const answer = await runtimeProfileBinding(runtime)("work");
    expect(bound).toEqual([["scripted-1", "other-1"]]);
    expect(answer).toEqual({
      state: "bound",
      label: "Work",
      variables: { VF_PROBE_SCRIPTED_1: "scripted-1", VF_PROBE_OTHER_1: "other-1" },
    });
  });

  it("This Mac binds nothing — and is never handed to the runtime to bind", async () => {
    const { runtime, bound } = runtimeOf([WORK, NATIVE]);
    expect(await runtimeProfileBinding(runtime)("native")).toEqual({
      state: "bound",
      label: "This Mac",
      variables: {},
    });
    expect(bound).toEqual([]);
  });

  it("a set the runtime does not hold is unknown, and nothing is bound", async () => {
    const { runtime, bound } = runtimeOf([WORK, NATIVE]);
    expect(await runtimeProfileBinding(runtime)("gone")).toEqual({ state: "unknown" });
    expect(bound).toEqual([]);
  });

  it("a runtime that cannot read its sets is unavailable; a binding the runtime refuses is failed, with the set's label and the runtime's reason", async () => {
    const unreadable = runtimeOf([], {
      profileSet: async () => {
        throw new Error("agent runtime is disposed");
      },
    });
    expect(await runtimeProfileBinding(unreadable.runtime)("work")).toEqual({
      state: "unavailable",
      reason: "agent runtime is disposed",
    });
    const refusing = runtimeOf([WORK], {
      bind: async () => {
        throw new Error("profile set binds scripted more than once: scripted-2");
      },
    });
    expect(await runtimeProfileBinding(refusing.runtime)("work")).toEqual({
      state: "failed",
      label: "Work",
      reason: "profile set binds scripted more than once: scripted-2",
    });
  });
});
