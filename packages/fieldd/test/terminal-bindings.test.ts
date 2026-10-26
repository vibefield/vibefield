// SB-2 (AR-7g) — the shell is born under its profile: how fieldd asks the agent
// runtime for a set's binding (`runtimeProfileBinding`), and fieldd's record of
// which shells were born bound (`TerminalBindingStore`). The runtime here is a
// stand-in that answers puppeteer's two doors; every name in a binding map is
// the fake's own (AR-L1 — VibeField spells no vendor's variable, in a test
// either).
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TerminalBindingsFile } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { AgentProfile, ProfileSet } from "@vibefield/puppeteer-core";
import type { AgentRuntime } from "@vibefield/puppeteer-runtime";
import { afterEach, describe, expect, it } from "vitest";
import {
  BINDING_BIRTH_GRACE_MS,
  runtimeProfileBinding,
  TerminalBindingStore,
} from "../src/terminal-bindings";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A user root of the test's own, and where the record lives under it. */
function recordFile(): string {
  const root = mkdtempSync(join(tmpdir(), "vf-bindings-"));
  roots.push(root);
  return join(root, "fieldd", "terminal-bindings.json");
}

/** A logger that keeps each event's name and attributes. */
function captured(events: Array<{ event: string; attrs?: unknown }>): Logger {
  const logger: Logger = {
    child: () => logger,
    trace: (event, _message, attrs) => events.push({ event, attrs }),
    debug: (event, _message, attrs) => events.push({ event, attrs }),
    info: (event, _message, attrs) => events.push({ event, attrs }),
    warn: (event, _message, attrs) => events.push({ event, attrs }),
    error: (event, _message, _error, attrs) => events.push({ event, attrs }),
    fatal: (event, _message, _error, attrs) => events.push({ event, attrs }),
    isLevelEnabled: () => true,
  };
  return logger;
}

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

describe("SB-2 — fieldd's record of which shells were born bound", () => {
  it("a bound birth is on disk at once — the contract's shape, owner-only — and a new store over the file (fieldd restarted) reads it back", () => {
    const file = recordFile();
    const first = new TerminalBindingStore({ file });
    first.bind("sess-work", "work");
    first.bind("sess-native", "native");
    const onDisk = TerminalBindingsFile.parse(JSON.parse(readFileSync(file, "utf8")));
    expect(onDisk.bindings.map((row) => [row.sessionId, row.profileSet])).toEqual([
      ["sess-work", "work"],
      ["sess-native", "native"],
    ]);
    expect(Number.isNaN(Date.parse(onDisk.bindings[0]?.boundAt ?? ""))).toBe(false);
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    // no temp file is left beside it
    expect(readdirSync(join(file, "..")).filter((name) => name.endsWith(".tmp"))).toEqual([]);

    const restarted = new TerminalBindingStore({ file });
    expect(restarted.profileSetOf("sess-work")).toBe("work");
    expect(restarted.profileSetOf("sess-native")).toBe("native");
    expect(restarted.profileSetOf("sess-unbound")).toBeUndefined();
  });

  it("the first inventory that does not list a session ends its row — on disk too — while a birth inside its grace window waits, and its exit ends the wait", () => {
    const file = recordFile();
    let now = 1_000_000;
    const store = new TerminalBindingStore({ file, now: () => now });
    store.bind("sess-listed", "work");
    store.bind("sess-fresh", "work");
    // an inventory taken before either birth reached it: both are in their window
    store.observe([]);
    expect(store.profileSetOf("sess-listed")).toBe("work");
    expect(store.profileSetOf("sess-fresh")).toBe("work");
    // one is listed; the other is not yet
    store.observe(["sess-listed"]);
    expect(store.profileSetOf("sess-fresh")).toBe("work");
    // the window passes and the floor never listed it: it ended
    now += BINDING_BIRTH_GRACE_MS;
    store.observe(["sess-listed"]);
    expect(store.profileSetOf("sess-fresh")).toBeUndefined();
    // a LISTED session leaves the inventory: its row ends at once
    store.observe([]);
    expect(store.profileSetOf("sess-listed")).toBeUndefined();
    expect(TerminalBindingsFile.parse(JSON.parse(readFileSync(file, "utf8"))).bindings).toEqual([]);

    // a birth whose process ended before any inventory listed it waits for nothing
    store.bind("sess-brief", "work");
    store.exited("sess-brief");
    store.observe([]);
    expect(store.profileSetOf("sess-brief")).toBeUndefined();
    // …and one the floor keeps after its exit is still listed, so it is kept
    store.bind("sess-husk", "work");
    store.exited("sess-husk");
    store.observe(["sess-husk"]);
    expect(store.profileSetOf("sess-husk")).toBe("work");
  });

  it("a restarted fieldd's first inventory ends every row whose session did not survive — there is no grace for a birth it did not make", () => {
    const file = recordFile();
    const before = new TerminalBindingStore({ file });
    before.bind("sess-survives", "work");
    before.bind("sess-gone", "work");
    const after = new TerminalBindingStore({ file });
    after.observe(["sess-survives"]);
    expect(after.profileSetOf("sess-survives")).toBe("work");
    expect(after.profileSetOf("sess-gone")).toBeUndefined();
    expect(
      TerminalBindingsFile.parse(JSON.parse(readFileSync(file, "utf8"))).bindings.map(
        (row) => row.sessionId,
      ),
    ).toEqual(["sess-survives"]);
  });

  it("the tolerant reader: a row that is not one is dropped and the rest are read; a file that is not the contract's is set aside, and the record starts empty", () => {
    const file = recordFile();
    new TerminalBindingStore({ file }).bind("sess-work", "work");
    const record = JSON.parse(readFileSync(file, "utf8"));
    record.bindings.push({ sessionId: "sess-bad", profileSet: "Not A Set", boundAt: "x" });
    record.bindings.push("not even an object");
    record.futureField = true;
    writeFileSync(file, JSON.stringify(record));
    const events: Array<{ event: string; attrs?: unknown }> = [];
    const tolerant = new TerminalBindingStore({ file, logger: captured(events) });
    expect(tolerant.list().map((row) => row.sessionId)).toEqual(["sess-work"]);
    expect(events).toContainEqual({
      event: "fieldd.terminal.bindings_rows_dropped",
      attrs: { dropped: 2 },
    });

    for (const text of ['{"version":2,"bindings":[]}', "not json", '{"version":1}']) {
      writeFileSync(file, text);
      const seen: Array<{ event: string; attrs?: unknown }> = [];
      const fresh = new TerminalBindingStore({ file, logger: captured(seen), now: () => 42 });
      expect(fresh.list()).toEqual([]);
      expect(seen.map((entry) => entry.event)).toEqual(["fieldd.terminal.bindings_set_aside"]);
      // set aside beside it, byte for byte — a newer fieldd's record is not lost
      expect(readFileSync(`${file}.unreadable-42`, "utf8")).toBe(text);
      expect(existsSync(file)).toBe(false);
      rmSync(`${file}.unreadable-42`);
    }
  });

  it("with no file the record is kept in memory, and nothing is written anywhere", () => {
    const store = new TerminalBindingStore();
    store.bind("sess-work", "work");
    expect(store.profileSetOf("sess-work")).toBe("work");
    store.observe([]);
    expect(store.profileSetOf("sess-work")).toBe("work");
  });
});
