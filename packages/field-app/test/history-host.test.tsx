// @vitest-environment happy-dom
/**
 * PJ-4's second half — History by project, as the room draws it: the host
 * model (`host-model.ts`) folded from fieldd's answers, the host inputs
 * (`host-inputs.tsx`) the room takes, and the acts (`acts.ts`) the room's
 * buttons press. Over the CONTRACT fixtures (`agent-providers.valid`,
 * `agent-session-summary.valid`) and a hand-made two-desktop listing:
 *   · Live now's join — one plain `agent.list`, joined on the native id (P3);
 *   · R1 the ink, R2 the marks, "n sessions on Studio" and "n live";
 *   · R3 the sections: Live now, Pinned, the rest, Temporary and Hidden
 *     folded at the foot; a project's Live now and Temporary's older fold;
 *   · R4 a row's act — Resume, Jump to, or the reason — and its host key;
 *   · R5 New agent's rows and its spawn args; the model and effort row;
 *   · R6 ③'s folders: by desktop, another desktop's never opened here;
 *   · R7 the chips; H4 each act's intent;
 *   · Resume refusing a gone folder with the reason, and a session another
 *     desktop holds (the host key).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SessionRow } from "@rosetta/protocol";
import type { RoomMenu, RoomMenuItem } from "@rosetta/room";
import {
  AgentProvidersResult,
  type IndexSession,
  type ProjectIntentParams,
  type ProjectSummary,
} from "@vibefield/contracts";
import { projectInk } from "@vibefield/design-kit/project-ink";
import { isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  deviceOfHostKey,
  type HistoryActsDeps,
  hostKeyOf,
  newAgent,
  projectIntent,
  resumeTarget,
  spawnParamsOf,
} from "../src/history/acts";
import {
  type HistoryHostActs,
  historyHostInputs,
  NO_HOST_STATE,
  projectSectionsOf,
  resumeWaits,
  sessionSectionsOf,
} from "../src/history/host-inputs";
import { type HistoryListing, hostModelOf } from "../src/history/host-model";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "fixtures");
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

const PROVIDERS = AgentProvidersResult.parse(fixture("agent-providers.valid.json")).providers;
const SUMMARY = fixture("agent-session-summary.valid.json");

const STUDIO = "dev-studio";
const LAPTOP = "dev-laptop";
const NOW = 1_760_000_000_000;
const DAY = 86_400_000;

const place = (
  device: string,
  placeId: string,
  path: string,
  over: Partial<ProjectSummary["places"][number]> = {},
) => ({
  ref: { device, placeId },
  name: path.split("/").pop() ?? path,
  path,
  class: "repo" as const,
  exists: true,
  mounted: true,
  sessions: 0,
  ...over,
});

const project = (key: string, over: Partial<ProjectSummary>): ProjectSummary => ({
  key,
  provisional: true,
  name: key,
  nameFrom: "folder",
  ink: 7,
  kind: "repo",
  bucket: null,
  devices: [STUDIO],
  places: [],
  sessions: 0,
  allGone: false,
  anchors: [],
  asOf: {},
  groupingVersion: 2,
  ...over,
});

const VIBE = project("p1:vibe", {
  name: "vibe-field",
  ink: 412,
  devices: [STUDIO, LAPTOP],
  places: [
    place(STUDIO, "pl_vf", "/Users/me/Projects/vibe-field", { branch: "main", sessions: 2 }),
    place(STUDIO, "pl_wt", "/Users/me/wt/feature", {
      branch: "feature",
      worktreeOf: { device: STUDIO, placeId: "pl_vf" },
      sessions: 0,
    }),
    place(LAPTOP, "pl_lap", "/Users/me/code/vibe-field", { branch: "main", sessions: 4 }),
  ],
});
const NOTES = project("p1:notes", {
  name: "notes",
  pinned: true,
  places: [place(STUDIO, "pl_notes", "/Users/me/notes", { class: "folder", exists: false })],
});
const HOME = project("p1:home", {
  name: "Home",
  nameFrom: "home",
  kind: "home",
  places: [place(STUDIO, "pl_home", "/Users/me", { class: "home" })],
});
const TEMP = project("p1:temp", {
  name: "Temporary",
  nameFrom: "bucket",
  kind: "temp",
  bucket: "temp",
  devices: [STUDIO],
  places: [place(STUDIO, "pl_tmp", "/private/tmp/x", { class: "temp" })],
});
const OLD = project("p1:old", {
  name: "old-thing",
  hidden: true,
  places: [place(STUDIO, "pl_old", "/Users/me/old")],
});
/** a project only the laptop holds: never listed here (H3 (a)) */
const AWAY = project("p1:away", {
  name: "away",
  devices: [LAPTOP],
  places: [place(LAPTOP, "pl_away", "/x")],
});

const session = (
  id: string,
  key: string,
  placeId: string,
  cwd: string,
  over: Partial<IndexSession> = {},
): IndexSession => ({
  sessionId: id,
  nativeSessionId: `n-${id}`,
  rootSessionId: id,
  cwd,
  activity: { firstAt: NOW - DAY, lastAt: NOW - 60_000 },
  streamState: "indexed",
  device: STUDIO,
  provider: "claude",
  projectKey: key,
  place: { device: STUDIO, placeId },
  ...over,
});

const SESSIONS = [
  session("s-live", "p1:vibe", "pl_vf", "/Users/me/Projects/vibe-field"),
  session("s-done", "p1:vibe", "pl_vf", "/Users/me/Projects/vibe-field/src"),
  session("s-pi", "p1:vibe", "pl_vf", "/Users/me/Projects/vibe-field", { provider: "pi" }),
  session("s-gone", "p1:notes", "pl_notes", "/Users/me/notes"),
  session("s-tmp-new", "p1:temp", "pl_tmp", "/private/tmp/x"),
  session("s-tmp-old", "p1:temp", "pl_tmp", "/private/tmp/x", {
    activity: { firstAt: NOW - 30 * DAY, lastAt: NOW - 20 * DAY },
  }),
];

const LISTING: HistoryListing = {
  projects: [VIBE, NOTES, HOME, TEMP, OLD, AWAY],
  sessions: SESSIONS,
  sources: [
    { device: STUDIO, name: "studio", self: true, state: "live", rows: 6 },
    { device: LAPTOP, name: "laptop", self: false, state: "asleep", rows: 2 },
  ],
  self: STUDIO,
  sections: {
    home: [{ key: "p1:home", device: STUDIO }],
    temporary: { key: "p1:temp", recent: ["s-tmp-new"], older: ["s-tmp-old"] },
  },
};

const ROSTER = [
  { deviceId: STUDIO, name: "Studio", platform: "darwin", self: true, online: true },
  { deviceId: LAPTOP, name: "Laptop", platform: "win32", self: false, online: false },
] as never[];

/** `agent.list`: the s-live conversation runs here, another run elsewhere */
const RUNS = [
  { ...SUMMARY, sessionId: "n-s-live", runtimeRunId: "run-live" },
  { ...SUMMARY, sessionId: "n-somewhere-else", runtimeRunId: "run-2" },
];

const MODEL = hostModelOf(LISTING, ROSTER, RUNS, PROVIDERS);

function spyActs() {
  return {
    setDesktop: vi.fn(),
    setAgent: vi.fn(),
    resume: vi.fn(),
    jump: vi.fn(),
    newAgent: vi.fn(),
    intent: vi.fn<(params: ProjectIntentParams, words: { done: string; verb: string }) => void>(),
    rename: vi.fn<(key: string, name: string) => Promise<void>>(async () => undefined),
    shown: vi.fn(),
  } satisfies HistoryHostActs;
}

const roomRow = (id: string, root = id): SessionRow =>
  ({ id, root_session_id: root, native_session_id: `n-${id}` }) as SessionRow;

const items = (menu: RoomMenu | undefined): RoomMenuItem[] =>
  (menu?.groups ?? []).flatMap((group) => group.items);

const text = (node: ReactNode): string => {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode; "aria-label"?: string };
    return text(props.children);
  }
  return "";
};

describe("the host model — one per listing (PJ-4)", () => {
  it("joins what runs here on the native id (P3's reading): only this desktop's live runs", () => {
    expect([...MODEL.live.keys()]).toEqual(["n-s-live"]);
    expect(MODEL.live.get("n-s-live")).toEqual({
      floorSessionId: "sess-01J8Z3K9",
      runtimeRunId: "run-live",
    });
  });

  it("names each desktop by the roster and its OS mark; asleep from the listing's standing", () => {
    expect(MODEL.devices.map((d) => [d.id, d.name, d.os, d.here, d.asleep])).toEqual([
      [STUDIO, "Studio", "macos", true, false],
      [LAPTOP, "Laptop", "windows", false, true],
    ]);
  });
});

describe("R1–R3: the ledger", () => {
  const inputs = historyHostInputs(MODEL, NO_HOST_STATE, spyActs());

  it("R1: a project's colour is its ink (DESIGN.md §2.9), never the room's deal", () => {
    expect(inputs.projectTint?.("p1:vibe")).toBe(projectInk(412));
    expect(inputs.projectTint?.("not-ours")).toBeNull();
  });

  it("R2: one mark per desktop, 'n sessions on Laptop (asleep)', and 'n live'", () => {
    const row = inputs.projectRow?.("p1:vibe");
    expect(text(row?.line)).toBe("4 sessions on Laptop (asleep)");
    expect(row?.live).toBe(1);
    const marks = row?.marks;
    expect(isValidElement(marks)).toBe(true);
    // a project on this desktop alone says nothing of others
    expect(inputs.projectRow?.("p1:notes")?.line).toBeUndefined();
  });

  it("R3: Live now · Pinned · the rest · Temporary folded (its recent count) · Hidden folded; another desktop's project never listed", () => {
    const sections = projectSectionsOf(MODEL, NO_HOST_STATE);
    expect(
      sections.map((section) => [section.key, section.ids ?? "rest", section.fold?.label ?? null]),
    ).toEqual([
      ["live", ["p1:vibe"], null],
      ["pinned", ["p1:notes"], null],
      ["projects", "rest", null],
      ["temporary", ["p1:temp"], "Temporary"],
      ["hidden", ["p1:old"], "Hidden"],
    ]);
    expect(sections.find((s) => s.key === "temporary")?.fold).toEqual({
      label: "Temporary",
      act: "Show",
      count: 1,
    });
    expect(sections.flatMap((s) => s.ids ?? [])).not.toContain("p1:away");
  });

  it("R3 + H5: Temporary's fold never says 0 — none recent, it counts the older ones and says so; none at all, it is a plain row", () => {
    const temporaryOf = (temporary: HistoryListing["sections"]["temporary"]) => {
      const model = hostModelOf(
        { ...LISTING, sections: { ...LISTING.sections, temporary } },
        ROSTER,
        RUNS,
        PROVIDERS,
      );
      return {
        any: projectSectionsOf(model, NO_HOST_STATE),
        laptop: projectSectionsOf(model, { ...NO_HOST_STATE, desktop: STUDIO }),
      };
    };
    // nothing in the last 14 days, two older: the line says what it holds
    const older = temporaryOf({ key: "p1:temp", recent: [], older: ["s-tmp-old", "s-tmp-x"] });
    expect(older.any.find((s) => s.key === "temporary")?.fold).toEqual({
      label: "Temporary · older than 14 days",
      act: "Show",
      count: 2,
    });
    // nothing at all: no fold — Temporary is an ordinary row of the rest
    const empty = temporaryOf({ key: "p1:temp", recent: [], older: [] });
    expect(empty.any.map((s) => s.key)).not.toContain("temporary");
    expect(empty.any.find((s) => s.key === "projects")?.ids).toBeUndefined();
    expect(empty.laptop.find((s) => s.key === "projects")?.ids).toContain("p1:temp");
    expect(empty.any.flatMap((s) => (s.fold === undefined ? [] : [s.fold.count]))).not.toContain(0);
  });

  it("R3 + R7: a desktop chosen names every section's rows, so a project not on it is not drawn", () => {
    const sections = projectSectionsOf(MODEL, { ...NO_HOST_STATE, desktop: LAPTOP });
    expect(sections.every((section) => section.ids !== undefined)).toBe(true);
    // (a row named twice lands in the first: Live now)
    expect(new Set(sections.flatMap((s) => s.ids ?? []))).toEqual(new Set(["p1:vibe"]));
  });

  it("R3 in a project: Live now first, the days, and Temporary's sessions older than 14 days behind Show older", () => {
    expect(
      sessionSectionsOf(MODEL, NO_HOST_STATE, "p1:vibe").map((s) => [s.key, s.ids ?? "rest"]),
    ).toEqual([
      ["live", ["s-live"]],
      ["days", "rest"],
    ]);
    const temp = sessionSectionsOf(MODEL, NO_HOST_STATE, "p1:temp");
    expect(temp.at(-1)).toEqual({
      key: "older",
      ids: ["s-tmp-old"],
      order: "room",
      fold: { label: "Older than 14 days", act: "Show older" },
    });
    // an agent chosen: every section names its rows
    const codexOnly = sessionSectionsOf(MODEL, { ...NO_HOST_STATE, agent: "pi" }, "p1:vibe");
    expect(codexOnly.flatMap((s) => s.ids ?? ["<rest>"])).toEqual(["s-pi"]);
  });
});

describe("R4 and ④: a session's act or its reason, and its host key", () => {
  it("Jump to while it runs here, Resume when it can, else the reason — pressed, the act names the session and its desktop", () => {
    const acts = spyActs();
    const inputs = historyHostInputs(MODEL, NO_HOST_STATE, acts);
    const live = inputs.sessionRow?.(roomRow("s-live"));
    expect(live?.act?.key).toBe("jump");
    expect(live?.hostKey).toBe(hostKeyOf(STUDIO, "s-live"));
    live?.act?.onPress?.();
    expect(acts.jump).toHaveBeenCalledWith({
      sessionId: "s-live",
      nativeSessionId: "n-s-live",
      folder: "/Users/me/Projects/vibe-field",
      hostKey: hostKeyOf(STUDIO, "s-live"),
    });
    const done = inputs.sessionRow?.(roomRow("s-done"));
    expect(done?.act?.key).toBe("resume");
    done?.act?.onPress?.();
    expect(acts.resume).toHaveBeenCalledTimes(1);
    // not installed here (the fixture's pi is not available): the reason, no act
    expect(text(inputs.sessionRow?.(roomRow("s-pi"))?.reason)).toBe("not installed");
    // its folder gone (the place's own fact): the reason at rest
    const gone = inputs.sessionRow?.(roomRow("s-gone"));
    expect(gone?.act).toBeUndefined();
    expect(text(gone?.reason)).toBe("folder is gone");
    // the id slot: this desktop's mark and the folder's path, the whole path its title
    expect(done?.idTitle).toBe("/Users/me/Projects/vibe-field/src");
    // ④'s head: the same act for a child thread, through its root
    expect(inputs.sessionActs?.(roomRow("child", "s-live"))?.acts?.[0]?.key).toBe("jump");
    expect(text(inputs.sessionActs?.(roomRow("s-gone"))?.reason)).toBe("folder is gone");
  });

  it("the host key names the desktop", () => {
    expect(deviceOfHostKey(hostKeyOf(STUDIO, "s1"))).toBe(STUDIO);
    expect(deviceOfHostKey("no-separator")).toBeNull();
    expect(deviceOfHostKey(undefined)).toBeNull();
  });

  it("resumeWaits reads the model's facts in the launcher's words: unknown agent, its folder", () => {
    expect(resumeWaits(MODEL, SESSIONS[1]!)).toBeNull();
    expect(resumeWaits(MODEL, { ...SESSIONS[1]!, provider: "nope" })).toBe("not offered here");
    expect(resumeWaits(MODEL, SESSIONS[3]!)).toBe("folder is gone");
  });
});

/** A client answering the reads Resume makes, the folder as given. */
function resumeClient(cwdExists: boolean) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  return {
    calls,
    async request(method: string, params: Record<string, unknown>) {
      calls.push({ method, params });
      switch (method) {
        case "agent.list":
          return { sessions: [] };
        case "agent.providers":
          return fixture("agent-providers.valid.json");
        case "index.recent":
          return {
            rows: [
              {
                sessionId: "s-done",
                nativeSessionId: "n-s-done",
                rootSessionId: "s-done",
                activity: null,
                streamState: "indexed",
                provider: "claude",
                cwd: "/Users/me/Projects/vibe-field/src",
                here: true,
                cwdExists,
              },
            ],
          };
        case "index.session":
          return {
            session: {
              sessionId: "s-done",
              nativeSessionId: "n-s-done",
              rootSessionId: "s-done",
              activity: null,
              streamState: "indexed",
            },
          };
        case "agent.resume":
          return fixture("agent-spawn.valid.json");
        case "agent.spawn":
          return fixture("agent-spawn.valid.json");
        default:
          throw Object.assign(new Error(`${method} is not scripted`), { kind: "NOT_FOUND" });
      }
    },
  };
}

const deck = () => {
  const place = vi.fn(async () => ({ state: "opened" as const }));
  return {
    place,
    door: {
      panes: [],
      onScreen: false,
      newTerminal: async () => ({ state: "opened" as const }),
      paste: () => false,
      canPlace: true,
      place,
      reveal: async () => ({ state: "opened" as const }),
    },
  };
};

const depsOf = (
  client: ReturnType<typeof resumeClient>,
  door: ReturnType<typeof deck>["door"],
): HistoryActsDeps => ({
  client,
  self: () => STUDIO,
  nameOf: (device) => (device === LAPTOP ? "Laptop" : "Studio"),
  deck: async () => door,
  showView: () => undefined,
});

describe("the acts", () => {
  const TARGET = {
    sessionId: "s-done",
    nativeSessionId: "n-s-done",
    folder: "/Users/me/Projects/vibe-field/src",
    hostKey: hostKeyOf(STUDIO, "s-done"),
  };

  it("Resume refuses a gone folder with the reason — and asks agent.resume nothing", async () => {
    const client = resumeClient(false);
    const outcome = await resumeTarget(depsOf(client, deck().door), TARGET);
    // the launcher's own words (QL), said on the line as "Could not resume — folder is gone"
    expect(outcome).toEqual({ state: "refused", reason: "folder is gone" });
    expect(client.calls.some((call) => call.method === "agent.resume")).toBe(false);
  });

  it("Resume refuses a session another desktop holds (R4's host key), before any read", async () => {
    const client = resumeClient(true);
    const outcome = await resumeTarget(depsOf(client, deck().door), {
      ...TARGET,
      hostKey: hostKeyOf(LAPTOP, "s-done"),
    });
    expect(outcome).toEqual({
      state: "refused",
      reason: "it ran on Laptop — act there until routed acts (DS-2)",
    });
    expect(client.calls).toEqual([]);
  });

  it("Resume with its folder there resumes and places the pane", async () => {
    const client = resumeClient(true);
    const { door, place } = deck();
    expect(await resumeTarget(depsOf(client, door), TARGET)).toEqual({ state: "resumed" });
    expect(place).toHaveBeenCalledTimes(1);
  });

  it("New agent spawns exactly {provider, cwd, profileId} in the chosen place, and places its pane", async () => {
    expect(
      spawnParamsOf({ provider: "claude", profileId: "claude:9a3d", cwd: "/w", where: "~/w" }),
    ).toEqual({
      provider: "claude",
      cwd: "/w",
      profileId: "claude:9a3d",
    });
    expect(spawnParamsOf({ provider: "claude", cwd: "/w", where: "~/w" })).toEqual({
      provider: "claude",
      cwd: "/w",
    });
    const client = resumeClient(true);
    const { door, place } = deck();
    const outcome = await newAgent(depsOf(client, door), {
      provider: "claude",
      profileId: "claude:9a3d",
      cwd: "/Users/me/Projects/vibe-field",
      where: "~/Projects/vibe-field",
    });
    expect(outcome).toEqual({ state: "started", where: "~/Projects/vibe-field" });
    expect(client.calls.find((call) => call.method === "agent.spawn")?.params).toEqual({
      provider: "claude",
      cwd: "/Users/me/Projects/vibe-field",
      profileId: "claude:9a3d",
    });
    expect(place).toHaveBeenCalledTimes(1);
  });
});

describe("R5: New agent and the project's acts", () => {
  it("New agent: Starts in names ③'s folder; one row per agent and persona from agent.providers; the model and effort row says it can't be set yet", () => {
    const acts = spyActs();
    const inputs = historyHostInputs(MODEL, { ...NO_HOST_STATE, home: "/Users/me" }, acts);
    const [newAgentAct, ...others] = inputs.projectActs?.("p1:vibe", { folder: null }) ?? [];
    expect(newAgentAct?.key).toBe("new-agent");
    expect(newAgentAct?.primary).toBe(true);
    const groups = newAgentAct?.menu?.groups ?? [];
    expect(groups.map((group) => group.key)).toEqual(["starts-in", "agents", "options"]);
    // the usual place: the newest folder here that is there
    const where = groups[0]?.items[0];
    expect(where?.label).toBe("~/Projects/vibe-field");
    expect(where?.detail).toBe("main · 1 agent is already working there");
    // the fixture offers claude (one persona, Kim); pi is not installed
    const agents = groups[1]?.items ?? [];
    expect(agents.map((row) => [row.label, row.aside])).toEqual([["Claude Code", "Kim"]]);
    agents[0]?.onSelect?.();
    expect(acts.newAgent).toHaveBeenCalledWith({
      provider: "claude",
      profileId: "claude:9a3d",
      cwd: "/Users/me/Projects/vibe-field",
      where: "~/Projects/vibe-field",
    });
    expect(groups[2]?.items[0]).toMatchObject({
      disabled: true,
      detail: "Model and effort can't be set from here yet (PJ-6)",
    });
    // ②'s head: New agent, then H4's `···` (its rows: the next test)
    expect(others.map((act) => act.key)).toEqual(["project-acts"]);
    expect(others[0]?.primary).toBeUndefined();
  });

  it("New agent follows ③: a folder on another desktop names why it can't start there, and its rows are dimmed", () => {
    const inputs = historyHostInputs(MODEL, NO_HOST_STATE, spyActs());
    const [act] = inputs.projectActs?.("p1:vibe", { folder: `${LAPTOP}\u001fpl_lap` }) ?? [];
    const where = act?.menu?.groups[0]?.items[0];
    expect(where?.disabled).toBe(true);
    expect(where?.detail).toBe("it starts on Laptop — not from here until routed acts (DS-2)");
    expect(items(act?.menu).filter((row) => row.onSelect !== undefined)).toEqual([]);
  });

  it("H4 (a): a `···` in ②'s head — Pin to the top and Hide, each its intent, never rename nor split; a pinned project unpins, a hidden one shows again; Temporary's head is New agent alone", () => {
    const acts = spyActs();
    const inputs = historyHostInputs(MODEL, NO_HOST_STATE, acts);
    const head = (key: string) => inputs.projectActs?.(key, { folder: null }) ?? [];
    const more = head("p1:vibe")[1];
    expect(more?.key).toBe("project-acts");
    expect(more?.label).toBe("Pin or hide vibe-field");
    expect(more?.onPress).toBeUndefined();
    // vibe-field has three folders and a name: neither split nor rename is here
    const rows = items(more?.menu);
    expect(rows.map((row) => [row.key, row.label])).toEqual([
      ["pin", "Pin to the top"],
      ["hide", "Hide"],
    ]);
    rows[0]?.onSelect?.();
    rows[1]?.onSelect?.();
    expect(acts.intent.mock.calls).toEqual([
      [
        { key: "p1:vibe", op: "pin", pinned: true },
        { done: "Pinned vibe-field", verb: "pin" },
      ],
      [
        { key: "p1:vibe", op: "hide", hidden: true },
        { done: "Hid vibe-field", verb: "hide it" },
      ],
    ]);
    expect(items(head("p1:notes")[1]?.menu)[0]?.label).toBe("Unpin");
    expect(items(head("p1:old")[1]?.menu)[1]?.label).toBe("Show again");
    // Home is a project row like any other (J11); Temporary is not a project
    expect(head("p1:home").map((act) => act.key)).toEqual(["new-agent", "project-acts"]);
    expect(head("p1:temp").map((act) => act.key)).toEqual(["new-agent"]);
  });

  it("H4 (a): pin and hide ALSO at ①'s row end — the same two rows, each its intent; a pinned project unpins, a hidden one shows again; Temporary has none", () => {
    const acts = spyActs();
    const inputs = historyHostInputs(MODEL, NO_HOST_STATE, acts);
    const act = inputs.projectRow?.("p1:vibe")?.act;
    expect(act?.key).toBe("project-acts");
    expect(act?.label).toBe("Pin or hide vibe-field");
    const rows = items(act?.menu);
    expect(rows.map((row) => [row.key, row.label])).toEqual([
      ["pin", "Pin to the top"],
      ["hide", "Hide"],
    ]);
    expect(rows[1]?.detail).toBe("It folds under Hidden, at the list's foot");
    rows[0]?.onSelect?.();
    rows[1]?.onSelect?.();
    expect(acts.intent.mock.calls).toEqual([
      [
        { key: "p1:vibe", op: "pin", pinned: true },
        { done: "Pinned vibe-field", verb: "pin" },
      ],
      [
        { key: "p1:vibe", op: "hide", hidden: true },
        { done: "Hid vibe-field", verb: "hide it" },
      ],
    ]);
    // the fixture's notes is pinned, old is hidden: the rows say the way back
    expect(items(inputs.projectRow?.("p1:notes")?.act?.menu)[0]?.label).toBe("Unpin");
    const old = items(inputs.projectRow?.("p1:old")?.act?.menu);
    expect(old[1]?.label).toBe("Show again");
    old[1]?.onSelect?.();
    expect(acts.intent.mock.calls.at(-1)?.[0]).toEqual({
      key: "p1:old",
      op: "hide",
      hidden: false,
    });
    // Temporary is not a project: no act (absent, never disabled); Home has its own
    expect(inputs.projectRow?.("p1:temp")?.act).toBeUndefined();
    expect(inputs.projectRow?.("p1:home")?.act?.key).toBe("project-acts");
  });

  it('H4 (b): "Not part of this project" on each of ③\'s folder rows — a split, pressed; never for a one-folder project, Home or Temporary', () => {
    const acts = spyActs();
    const inputs = historyHostInputs(MODEL, NO_HOST_STATE, acts);
    const folders = inputs.folders?.("p1:vibe")?.groups.flatMap((group) => group.folders) ?? [];
    expect(folders.map((folder) => [folder.key, folder.act?.label ?? null])).toEqual([
      [`${STUDIO}\u001fpl_vf`, "Not part of this project"],
      [`${STUDIO}\u001fpl_wt`, "Not part of this project"],
      [`${LAPTOP}\u001fpl_lap`, "Not part of this project"],
    ]);
    expect(folders[1]?.act?.menu).toBeUndefined();
    folders[1]?.act?.onPress?.();
    expect(acts.intent).toHaveBeenCalledWith(
      { key: "p1:vibe", op: "split", place: { device: STUDIO, placeId: "pl_wt" } },
      { done: "feature is no longer part of vibe-field", verb: "split it" },
    );
    for (const key of ["p1:notes", "p1:home", "p1:temp"]) {
      const only = inputs.folders?.(key)?.groups.flatMap((group) => group.folders) ?? [];
      expect(
        only.every((folder) => folder.act === undefined),
        key,
      ).toBe(true);
    }
  });

  it("H4 (c): rename on ②'s name — the room's field commits through the controller's rename, whose refusal words the room says; Temporary has none", async () => {
    const acts = spyActs();
    const inputs = historyHostInputs(MODEL, NO_HOST_STATE, acts);
    const rename = inputs.projectRename?.("p1:vibe");
    // the room says the name after it ("Rename the project: vibe-field")
    expect(rename?.label).toBe("Rename the project");
    await rename?.onRename("vibe");
    expect(acts.rename).toHaveBeenCalledWith("p1:vibe", "vibe");
    // a refusal reaches the room as the rejection it says under the field
    acts.rename.mockRejectedValueOnce(
      new Error("the project changed while you looked — try again"),
    );
    await expect(rename?.onRename("vf")).rejects.toThrow("the project changed while you looked");
    expect(inputs.projectRename?.("p1:temp")).toBeNull();
    expect(inputs.projectRename?.("p1:home")?.label).toBe("Rename the project");
  });

  it("H4 (c): the intent's own words are the refusal's — a key that moved, a bucket, a project gone", async () => {
    const refusing = (reason: string) => ({
      request: async () => {
        throw Object.assign(new Error("refused"), {
          kind: "PRECONDITION_FAILED",
          details: { reason },
        });
      },
    });
    const ask = { key: "p1:vibe", op: "rename" as const, name: "vf" };
    expect(await projectIntent(refusing("key-moved") as never, ask)).toEqual({
      state: "refused",
      reason: "the project changed while you looked — try again",
    });
    expect(await projectIntent(refusing("not-a-project") as never, ask)).toEqual({
      state: "refused",
      reason: "Temporary is not a project",
    });
    expect(await projectIntent(refusing("no-such-project") as never, ask)).toEqual({
      state: "refused",
      reason: "the project is no longer listed",
    });
    const taking = { request: async () => ({ key: "p1:vibe2" }) };
    expect(await projectIntent(taking as never, ask)).toEqual({ state: "done", key: "p1:vibe2" });
  });

  it("the card: the suggestions, else nothing (rename is on ②'s name since v3)", () => {
    const acts = spyActs();
    const quiet = historyHostInputs(MODEL, NO_HOST_STATE, acts);
    expect(quiet.projectCard?.("p1:vibe")).toBeNull();
    const suggested = historyHostInputs(
      MODEL,
      {
        ...NO_HOST_STATE,
        suggestions: new Map([
          [
            "p1:vibe",
            [
              {
                type: "related-history",
                with: "p1:notes",
                a: { device: STUDIO, placeId: "pl_vf" },
                b: { device: STUDIO, placeId: "pl_notes" },
              },
            ],
          ],
        ]),
      },
      acts,
    );
    expect(isValidElement(suggested.projectCard?.("p1:vibe"))).toBe(true);
  });
});

describe("R6: ③'s folders", () => {
  it("every folder by desktop, the worktree one step in, another desktop's never opened here (and captioned), the usual one first", () => {
    const acts = spyActs();
    const folders = historyHostInputs(MODEL, NO_HOST_STATE, acts).folders?.("p1:vibe");
    expect(folders?.groups.map((group) => [group.key, group.folders.map((f) => f.key)])).toEqual([
      [STUDIO, [`${STUDIO}\u001fpl_vf`, `${STUDIO}\u001fpl_wt`]],
      [LAPTOP, [`${LAPTOP}\u001fpl_lap`]],
    ]);
    const [main, worktree] = folders?.groups[0]?.folders ?? [];
    expect(main?.elsewhere).toBeUndefined();
    expect(worktree?.depth).toBe(1);
    const laptop = folders?.groups[1]?.folders[0];
    expect(text(laptop?.elsewhere)).toBe("Laptop is asleep — its files stay on Laptop");
    // lane room's finding 4: an elsewhere folder ALWAYS carries its caption
    expect(laptop?.caption).toBe("Laptop · main");
    // a folder's facts: its branch and how many sessions it held, in number
    expect(laptop?.detail).toBe("main · 4 sessions");
    const one = hostModelOf(
      {
        ...LISTING,
        projects: [
          project("p1:one", {
            places: [place(STUDIO, "pl_one", "/Users/me/one", { sessions: 1 })],
          }),
        ],
      },
      ROSTER,
      [],
      PROVIDERS,
    );
    expect(
      historyHostInputs(one, NO_HOST_STATE, acts).folders?.("p1:one")?.groups[0]?.folders[0]
        ?.detail,
    ).toBe("1 session");
    expect(folders?.initial).toBe(`${STUDIO}\u001fpl_vf`);
    expect(folders?.of?.(roomRow("s-done"))).toBe(`${STUDIO}\u001fpl_vf`);
    folders?.onShow?.(`${STUDIO}\u001fpl_wt`);
    expect(acts.shown).toHaveBeenCalledWith("p1:vibe", `${STUDIO}\u001fpl_wt`);
    // a gone folder here says so instead of opening
    const notes = historyHostInputs(MODEL, NO_HOST_STATE, acts).folders?.("p1:notes");
    expect(text(notes?.groups[0]?.folders[0]?.elsewhere)).toBe("This folder is gone");
    expect(notes?.groups[0]?.folders[0]?.caption).toBe("notes");
  });
});

describe("R7: the chips", () => {
  it("① any desktop: each desktop with its mark and how many of these projects live on it; ② any agent: the project's agents with counts", () => {
    const acts = spyActs();
    const inputs = historyHostInputs(MODEL, NO_HOST_STATE, acts);
    const [desktop] = inputs.projectFilters ?? [];
    expect(desktop?.label).toBe("any desktop");
    expect(desktop?.set).toBe(false);
    const rows = items(desktop?.menu);
    expect(rows.map((row) => [row.key, row.aside ?? null, row.checked ?? null])).toEqual([
      ["any", null, true],
      // its standing, then how many of the projects listed here live on it:
      // all five on Studio; on the laptop only vibe-field (away is not listed)
      [STUDIO, "here · 5", false],
      [LAPTOP, "asleep · 1", false],
    ]);
    rows.find((row) => row.key === LAPTOP)?.onSelect?.();
    expect(acts.setDesktop).toHaveBeenCalledWith(LAPTOP);
    const [agent] = inputs.sessionFilters?.("p1:vibe") ?? [];
    expect(items(agent?.menu).map((row) => [row.key, row.aside ?? null])).toEqual([
      ["any", null],
      ["claude", "2"],
      ["pi", "1"],
    ]);
    const chosen = historyHostInputs(MODEL, { ...NO_HOST_STATE, agent: "claude" }, acts);
    expect(chosen.sessionFilters?.("p1:vibe")?.[0]).toMatchObject({
      label: "Claude Code",
      set: true,
    });
  });
});
