// PJ-3 — the `project.*` doors as a unit (projects/project-doors.ts) over the
// REAL grouping (ProjectGroups → the engine) of two desktops: who is admitted
// and what each is told (D8, D10, P1), a path in an ask refused (P1), the
// pages and their cursors, a key that regrouped (D9: a read follows it, an act
// is refused), a session's place by the longest path and one row per native
// session (DS-D10), the pings with their key moves, and the act's shell until
// PJ-2's records are wired (P2). The phone's witness over the real door is
// project-doors-phone.test.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CallerContext,
  IndexCatalogProject,
  IndexCatalogSession,
  IndexCatalogSource,
  PlaceFacts,
  Principal,
  ProjectIntentParams,
} from "@vibefield/contracts";
import {
  ProjectChangesDelta,
  ProjectFiguresDayResult,
  ProjectFiguresResult,
  ProjectGetParams,
  ProjectGetResult,
  ProjectListParams,
  ProjectListResult,
  ProjectSessionsResult,
} from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { CatalogTable } from "../src/catalog-rows";
import { RpcCallError } from "../src/native-link";
import { KeyJournal } from "../src/projects/key-journal";
import {
  admitProjectReader,
  admitProjectWriter,
  ProjectDoors,
  type ProjectIntentWriter,
  type ProjectView,
  parseProjectAsk,
  readsProjects,
} from "../src/projects/project-doors";
import { ProjectGroups, type ProjectGroupsChange } from "../src/projects/project-groups";

const ctx = (principal: Principal): CallerContext => ({
  principal,
  transport: "ws-loopback",
  receivedAt: 0,
});
const WINDOW = ctx({ kind: "local-token", tokenId: "tk", scopes: ["project.read"] });
const PHONE = ctx({ kind: "tailnet", login: "me@example.com", self: true });
const PRE_CAPTURE = ctx({ kind: "tailnet", login: "me@example.com" });
const WINDOW_VIEW: ProjectView = { paths: true, tailnet: false };
const PHONE_VIEW: ProjectView = { paths: true, tailnet: true };
const BLIND_VIEW: ProjectView = { paths: false, tailnet: true };

/** the thrown refusal's kind and details */
function refusal(act: () => unknown): { kind: string; details: unknown } {
  try {
    act();
  } catch (error) {
    if (error instanceof RpcCallError) return { kind: error.kind, details: error.details };
    throw error;
  }
  throw new Error("expected a refusal");
}
async function refusalOf(act: () => Promise<unknown>): Promise<{ kind: string; details: unknown }> {
  try {
    await act();
  } catch (error) {
    if (error instanceof RpcCallError) return { kind: error.kind, details: error.details };
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("who is admitted, and what each is told (D8, D10, P1)", () => {
  it("a window and the shell read with paths; the phone with paths across the tailnet", () => {
    expect(admitProjectReader(WINDOW, "project.list")).toEqual({ paths: true, tailnet: false });
    expect(
      admitProjectReader(ctx({ kind: "shell-main", tokenId: "s", scopes: [] }), "project.list"),
    ).toEqual({ paths: true, tailnet: false });
    expect(admitProjectReader(PHONE, "project.list")).toEqual({ paths: true, tailnet: true });
    // a tailnet principal whose login was never compared (pre-capture): no paths
    expect(admitProjectReader(PRE_CAPTURE, "project.list")).toEqual({
      paths: false,
      tailnet: true,
    });
  });

  it("refuses a peer daemon (DS-L4), a guest, a plugin and an MCP agent, naming the door", () => {
    for (const principal of [
      { kind: "peer-fieldd", deviceId: "dev-b" },
      { kind: "tailnet-guest", login: "else@example.com" },
      { kind: "plugin", id: "p", scopes: ["project.read"] },
      { kind: "mcp-agent", sessionId: "m", scopes: ["project.read"] },
    ] satisfies Principal[]) {
      expect(refusal(() => admitProjectReader(ctx(principal), "project.get"))).toEqual({
        kind: "FORBIDDEN_SCOPE",
        details: { method: "project.get", principal: principal.kind },
      });
    }
  });

  it("an act is a desktop window's: the phone is refused it (P2)", () => {
    expect(() => admitProjectWriter(WINDOW, "project.intent")).not.toThrow();
    expect(refusal(() => admitProjectWriter(PHONE, "project.intent")).kind).toBe("FORBIDDEN_SCOPE");
    expect(
      refusal(() => admitProjectWriter(ctx({ kind: "peer-fieldd", deviceId: "b" }), "x")).kind,
    ).toBe("FORBIDDEN_SCOPE");
  });

  it("refuses a path anywhere in an ask before reading it, and names the field (P1)", () => {
    expect(
      refusal(() =>
        parseProjectAsk(ProjectListParams, { devices: ["a"], cwd: "/Users/me/app" }, "x"),
      ),
    ).toEqual({
      kind: "PRECONDITION_FAILED",
      details: { reason: "path-in-request", field: "cwd" },
    });
    // an anchor that spells a folder is the same refusal, named at its field
    expect(
      refusal(() =>
        parseProjectAsk(ProjectGetParams, { anchor: "remote:local:/Users/me/app" }, "x"),
      ),
    ).toEqual({
      kind: "PRECONDITION_FAILED",
      details: { reason: "path-in-request", field: "anchor" },
    });
    // a malformed ask without a path is the params' refusal, with no reason
    expect(refusal(() => parseProjectAsk(ProjectListParams, { limit: 0 }, "x"))).toEqual({
      kind: "PRECONDITION_FAILED",
      details: undefined,
    });
  });
});

// ── a two-desktop world ─────────────────────────────────────────────────────

const sha = (n: number) => n.toString(16).padStart(40, "0");

function place(placeId: string, path: string, over: Partial<PlaceFacts> = {}): PlaceFacts {
  return {
    placeId,
    path,
    aliases: [],
    kind: "project",
    caseless: true,
    exists: true,
    mounted: true,
    git: false,
    remotes: [],
    samples: [],
    hits: [],
    observedAt: 1,
    ...over,
  };
}

function session(
  device: string,
  id: string,
  cwd: string,
  lastAt: number,
  over: Partial<IndexCatalogSession> = {},
): IndexCatalogSession {
  return {
    device,
    sessionId: id,
    nativeSessionId: `n-${id}`,
    kind: "claude-code",
    provider: "claude",
    cwd,
    activity: { firstAt: 1, lastAt },
    streamState: "indexed",
    ...over,
  } as IndexCatalogSession;
}

const repo = (over: Partial<PlaceFacts> = {}): Partial<PlaceFacts> => ({
  git: true,
  root: sha(1),
  identityRemote: "github.com/acme/app",
  remotes: ["github.com/acme/app"],
  ...over,
});

function world() {
  const projects = new CatalogTable<IndexCatalogProject>({ epoch: "e", keyOf: (r) => r.projectId });
  const sessions = new CatalogTable<IndexCatalogSession>({ epoch: "e", keyOf: (r) => r.sessionId });
  const app = place("pl-app", "/Users/me/app", {
    ...repo(),
    aliases: ["/Users/me/App"],
    branch: "main",
  });
  // a checkout nested inside the app's folder (the same repository: E1 joins
  // it) — the session below it belongs to it, not to the app's own place
  const appDocs = place("pl-app-docs", "/Users/me/app/docs", repo({ branch: "docs" }));
  const notes = place("pl-notes", "/Users/me/notes");
  const home = place("pl-home", "/Users/me", { kind: "home" });
  projects.upsert([
    {
      device: "dev-a",
      projectId: "r-app",
      name: "app",
      rootPaths: [],
      sessionCount: 0,
      places: [app, appDocs],
    },
    {
      device: "dev-a",
      projectId: "r-notes",
      name: "notes",
      rootPaths: [],
      sessionCount: 0,
      places: [notes],
    },
    {
      device: "dev-a",
      projectId: "r-home",
      name: "me",
      rootPaths: [],
      sessionCount: 0,
      places: [home],
    },
  ]);
  sessions.upsert([
    session("dev-a", "s1", "/Users/me/app/src", 50),
    session("dev-a", "s2", "/Users/me/app/docs/guide", 40), // the nested place holds it
    session("dev-a", "s3", "/Users/me/notes", 30, { provider: "codex", kind: "codex" }),
    session("dev-a", "s4", "/Users/me", 10),
    // the same native session indexed on both desktops (DS-D10)
    session("dev-a", "s5", "/Users/me/app", 20, { nativeSessionId: "shared" }),
  ]);
  const peer = {
    device: "dev-b",
    projects: [
      {
        device: "dev-b",
        projectId: "r-b",
        name: "app",
        rootPaths: [],
        sessionCount: 0,
        places: [
          place("pl-b-app", "/home/me/src/app", {
            ...repo(),
            branch: "feature",
            worktreeOf: "pl-b-main",
          }),
        ],
      } as IndexCatalogProject,
    ],
    sessions: [
      session("dev-b", "t1", "/home/me/src/app", 60),
      session("dev-b", "t2", "/home/me/src/app/lib", 25, { nativeSessionId: "shared" }),
    ],
  };
  const peers = [peer];
  const journal = new KeyJournal();
  const groups = new ProjectGroups({
    deviceId: () => "dev-a",
    local: { projects, sessions },
    peers: () => peers,
    journal,
  });
  const sources: IndexCatalogSource[] = [
    { device: "dev-a", self: true, state: "live", asOf: "2026-10-08T01:00:00.000Z", rows: 3 },
    { device: "dev-b", self: false, state: "asleep", asOf: "2026-10-07T22:00:00.000Z", rows: 1 },
  ];
  let writer: ProjectIntentWriter | null = null;
  const doors = new ProjectDoors({
    groups,
    deviceId: () => "dev-a",
    localSessions: () => sessions.rows(),
    peerSessions: () => peers,
    sources: () => sources,
    records: () => writer,
    changesMinIntervalMs: 5,
  });
  return {
    projects,
    sessions,
    peers,
    groups,
    doors,
    setWriter: (next: ProjectIntentWriter | null) => {
      writer = next;
    },
  };
}

const appOf = (w: ReturnType<typeof world>) =>
  w.groups.current()?.result.projects.find((p) => p.places.some((pl) => pl.placeId === "pl-app"));

describe("before this boot's first grouping", () => {
  it("every read answers UNAVAILABLE {service: projects, state: grouping}, retryable", () => {
    const w = world();
    const refused = refusal(() => w.doors.list({}, WINDOW_VIEW, 100));
    expect(refused).toEqual({
      kind: "UNAVAILABLE",
      details: { service: "projects", state: "grouping" },
    });
  });
});

describe("project.list", () => {
  it("answers a window every project newest first, with paths, anchors and asOf", () => {
    const w = world();
    w.groups.regroupNow();
    const page = ProjectListResult.parse(w.doors.list({}, WINDOW_VIEW, 100));
    expect(page.rows.map((row) => row.name)).toEqual(["app", "notes", "Home"]);
    const app = page.rows[0]!;
    // the engine's order: the device of the newest place first
    expect(app.devices).toEqual(["dev-b", "dev-a"]);
    expect(app.places.map((p) => p.path).sort()).toEqual([
      "/Users/me/app",
      "/Users/me/app/docs",
      "/home/me/src/app",
    ]);
    expect(app.anchors).toEqual(
      expect.arrayContaining(["remote:github.com/acme/app", `root:${sha(1)}`, "place:pl-app"]),
    );
    expect(app.asOf).toEqual({
      "dev-a": "2026-10-08T01:00:00.000Z",
      "dev-b": "2026-10-07T22:00:00.000Z",
    });
    const worktree = app.places.find((p) => p.ref.placeId === "pl-b-app");
    expect(worktree).toMatchObject({
      name: "app",
      branch: "feature",
      worktreeOf: { device: "dev-b", placeId: "pl-b-main" },
    });
    // J11: a desktop's Home is a project on that desktop, not a bucket — ordered
    // by its activity like any other (here it is simply the oldest)
    expect(page.rows[2]).toMatchObject({ kind: "home", bucket: null, devices: ["dev-a"] });
    expect(page.sources).toHaveLength(2);
    expect(page.groupingVersion).toBe(2);
    // no answer carries a place's other spellings
    expect(JSON.stringify(page)).not.toContain("/Users/me/App");
  });

  it("answers a tailnet caller what D10 lets it: paths only when self (P1), place anchors only", () => {
    const w = world();
    w.groups.regroupNow();
    const phone = ProjectListResult.parse(w.doors.list({}, PHONE_VIEW, 100));
    expect(phone.rows[0]?.places.every((p) => p.path !== undefined)).toBe(true);
    expect(phone.rows[0]?.anchors.every((a) => a.startsWith("place:"))).toBe(true);
    const blind = ProjectListResult.parse(w.doors.list({}, BLIND_VIEW, 100));
    const text = JSON.stringify(blind.rows);
    expect(text).not.toMatch(/\/Users\/|\/home\/|github\.com|root:/);
    expect(blind.rows[0]?.places.map((p) => p.name).sort()).toEqual(["app", "app", "docs"]);
  });

  it("pages by (lastAt, anchor) — a cursor picks up exactly where the page stopped", () => {
    const w = world();
    w.groups.regroupNow();
    const first = w.doors.list({}, WINDOW_VIEW, 2);
    expect(first.rows).toHaveLength(2);
    expect(first.cursor).toBeDefined();
    const second = w.doors.list({ cursor: first.cursor }, WINDOW_VIEW, 2);
    expect(second.rows.map((r) => r.name)).toEqual(["Home"]);
    expect(second.cursor).toBeUndefined();
    expect(refusal(() => w.doors.list({ cursor: "garbage" }, WINDOW_VIEW, 2)).kind).toBe(
      "PRECONDITION_FAILED",
    );
  });

  it("narrows by device and by name — a query never matches a path", () => {
    const w = world();
    w.groups.regroupNow();
    expect(w.doors.list({ devices: ["dev-b"] }, WINDOW_VIEW, 100).rows.map((r) => r.name)).toEqual([
      "app",
    ]);
    expect(w.doors.list({ q: "NOT" }, WINDOW_VIEW, 100).rows.map((r) => r.name)).toEqual(["notes"]);
    // `docs` is a place's own folder name; `Users` is only in its path
    expect(w.doors.list({ q: "docs" }, WINDOW_VIEW, 100).rows.map((r) => r.name)).toEqual(["app"]);
    expect(w.doors.list({ q: "Users" }, WINDOW_VIEW, 100).rows).toEqual([]);
  });
});

describe("project.get", () => {
  it("by key and by any place anchor, with why its places joined", () => {
    const w = world();
    w.groups.regroupNow();
    const key = appOf(w)!.key;
    const byKey = ProjectGetResult.parse(w.doors.get({ key }, WINDOW_VIEW));
    expect(byKey.project.key).toBe(key);
    expect(byKey.movedTo).toBeUndefined();
    expect(byKey.edges).toEqual([
      {
        a: { device: "dev-a", placeId: "pl-app" },
        b: { device: "dev-a", placeId: "pl-app-docs" },
        rule: "remote",
        via: "github.com/acme/app",
      },
      {
        a: { device: "dev-a", placeId: "pl-app" },
        b: { device: "dev-b", placeId: "pl-b-app" },
        rule: "remote",
        via: "github.com/acme/app",
      },
    ]);
    expect(w.doors.get({ anchor: "place:pl-b-app" }, WINDOW_VIEW).project.key).toBe(key);
    expect(w.doors.get({ anchor: "remote:github.com/acme/app" }, WINDOW_VIEW).project.key).toBe(
      key,
    );
    // the phone is never told what joined the places (D10)
    const phone = ProjectGetResult.parse(w.doors.get({ key }, PHONE_VIEW));
    expect(phone.edges[0]).not.toHaveProperty("via");
  });

  it("names the suggestions on the project, by the other project's key — no `via` across the tailnet", () => {
    const w = world();
    // the same folder below home on the other desktop: only a suggestion (§4.2)
    w.projects.upsert([
      {
        device: "dev-a",
        projectId: "r-notes",
        name: "notes",
        rootPaths: [],
        sessionCount: 0,
        places: [place("pl-notes", "/Users/me/notes", { homeRelative: "notes" })],
      },
    ]);
    w.peers[0]?.projects.push({
      device: "dev-b",
      projectId: "r-b-notes",
      name: "notes",
      rootPaths: [],
      sessionCount: 0,
      places: [place("pl-b-notes", "/home/me/notes", { homeRelative: "notes" })],
    } as IndexCatalogProject);
    w.groups.regroupNow();
    const projects = w.groups.current()!.result.projects;
    const mine = projects.find((p) => p.places.some((pl) => pl.placeId === "pl-notes"))!;
    const theirs = projects.find((p) => p.places.some((pl) => pl.placeId === "pl-b-notes"))!;
    expect(w.doors.get({ key: mine.key }, WINDOW_VIEW).suggestions).toEqual([
      {
        type: "same-folder",
        with: theirs.key,
        a: { device: "dev-a", placeId: "pl-notes" },
        b: { device: "dev-b", placeId: "pl-b-notes" },
        via: "notes",
      },
    ]);
    // the other side sees the same suggestion from its own side
    expect(w.doors.get({ key: theirs.key }, PHONE_VIEW).suggestions).toEqual([
      {
        type: "same-folder",
        with: mine.key,
        a: { device: "dev-b", placeId: "pl-b-notes" },
        b: { device: "dev-a", placeId: "pl-notes" },
      },
    ]);
  });

  it("a key no project holds is NOT_FOUND no-such-project", () => {
    const w = world();
    w.groups.regroupNow();
    expect(refusal(() => w.doors.get({ key: "p1:nothing" }, WINDOW_VIEW))).toEqual({
      kind: "NOT_FOUND",
      details: { reason: "no-such-project" },
    });
    expect(refusal(() => w.doors.get({ anchor: "place:pl-nowhere" }, WINDOW_VIEW)).kind).toBe(
      "NOT_FOUND",
    );
  });

  it("a key that regrouped answers the project it moved into, with movedTo (D9)", () => {
    const w = world();
    w.groups.regroupNow();
    const notesKey = w.groups.current()!.result.projects.find((p) => p.name === "notes")!.key;
    // notes becomes a clone of the app's repository: it joins the app
    w.projects.upsert([
      {
        device: "dev-a",
        projectId: "r-notes",
        name: "notes",
        rootPaths: [],
        sessionCount: 0,
        places: [place("pl-notes", "/Users/me/notes", repo())],
      },
    ]);
    w.groups.regroupNow();
    const appKey = appOf(w)!.key;
    expect(appKey).not.toBe(notesKey);
    const moved = w.doors.get({ key: notesKey }, PHONE_VIEW);
    expect(moved.movedTo).toBe(appKey);
    expect(moved.project.key).toBe(appKey);
    expect(moved.project.places.map((p) => p.ref.placeId)).toContain("pl-notes");
  });
});

describe("project.sessions", () => {
  it("joins each session to its place by the longest path; one row per native session (DS-D10)", () => {
    const w = world();
    w.groups.regroupNow();
    const key = appOf(w)!.key;
    const page = ProjectSessionsResult.parse(w.doors.sessions({ key }, WINDOW_VIEW, 100));
    expect(page.rows.map((r) => [r.sessionId, r.place.placeId, r.devices])).toEqual([
      ["t1", "pl-b-app", ["dev-b"]],
      ["s1", "pl-app", ["dev-a"]],
      ["s2", "pl-app-docs", ["dev-a"]],
      // indexed on both desktops: the newest copy speaks, both are named
      ["t2", "pl-b-app", ["dev-b", "dev-a"]],
    ]);
    expect(page.rows[0]?.cwd).toBe("/home/me/src/app");
    // narrowed to a place, an agent, a device
    expect(
      w.doors
        .sessions({ key, places: [{ device: "dev-a", placeId: "pl-app-docs" }] }, WINDOW_VIEW, 100)
        .rows.map((r) => r.sessionId),
    ).toEqual(["s2"]);
    expect(w.doors.sessions({ key, agents: ["codex"] }, WINDOW_VIEW, 100).rows).toEqual([]);
    expect(
      w.doors.sessions({ key, devices: ["dev-a"] }, WINDOW_VIEW, 100).rows.map((r) => r.sessionId),
    ).toEqual(["s1", "s2", "s5"]);
  });

  it("carries a session's cwd only to the person's own devices (P1), and pages", () => {
    const w = world();
    w.groups.regroupNow();
    const key = appOf(w)!.key;
    const blind = w.doors.sessions({ key }, BLIND_VIEW, 100);
    expect(blind.rows.every((r) => r.cwd === undefined)).toBe(true);
    const first = w.doors.sessions({ key }, PHONE_VIEW, 3);
    expect(first.rows).toHaveLength(3);
    const second = w.doors.sessions({ key, cursor: first.cursor }, PHONE_VIEW, 3);
    expect([...first.rows, ...second.rows].map((r) => r.sessionId)).toEqual([
      "t1",
      "s1",
      "s2",
      "t2",
    ]);
  });
});

describe("project.subscribe", () => {
  async function waitFor(check: () => boolean): Promise<void> {
    const deadline = Date.now() + 3_000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error("timed out");
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  it("pings a regroup with its key moves, and a catalog's move with its device", async () => {
    const w = world();
    w.groups.regroupNow();
    const notesKey = w.groups.current()!.result.projects.find((p) => p.name === "notes")!.key;
    const frames: Array<{ payload: unknown; kind: string }> = [];
    const sub = w.doors.subscribe({}, (payload, kind) => frames.push({ payload, kind }));
    expect(sub.open).toMatchObject({ snapshot: { rows: [] } });
    sub.start();
    w.projects.upsert([
      {
        device: "dev-a",
        projectId: "r-notes",
        name: "notes",
        rootPaths: [],
        sessionCount: 0,
        places: [place("pl-notes", "/Users/me/notes", repo())],
      },
    ]);
    w.groups.regroupNow();
    await waitFor(() => frames.length === 1);
    const delta = ProjectChangesDelta.parse(frames[0]?.payload);
    expect(delta.regrouped).toEqual([{ from: notesKey, to: appOf(w)!.key }]);
    expect(delta.upserts).toEqual([]);
    w.doors.catalogChanged("dev-b");
    await waitFor(() => frames.length === 2);
    const ping = ProjectChangesDelta.parse(frames[1]?.payload);
    expect(ping.devices).toEqual(["dev-b"]);
    expect(ping.regrouped).toBeUndefined();
    expect(ping.since).toBe(delta.revision);
    // a kept cursor resumes, and hears what moved since
    const open = sub.open as { snapshot: { epoch: string } };
    sub.dispose();
    const later: unknown[] = [];
    const again = w.doors.subscribe(
      { since: { epoch: open.snapshot.epoch, revision: delta.since } },
      (payload) => later.push(payload),
    );
    expect(again.open).toEqual({ resumed: { epoch: open.snapshot.epoch, revision: delta.since } });
    again.start();
    await waitFor(() => later.length === 1);
    expect(ProjectChangesDelta.parse(later[0]).regrouped).toHaveLength(1);
    again.dispose();
  });

  it("a reader whose moves fell out of the log is reset, never handed a partial list", async () => {
    let listener: ((change: ProjectGroupsChange) => void) | undefined;
    const fake = {
      onChange: (l: (change: ProjectGroupsChange) => void) => {
        listener = l;
        return () => {};
      },
      current: () => null,
      movedTo: () => undefined,
    } as unknown as ProjectGroups;
    const doors = new ProjectDoors({
      groups: fake,
      deviceId: () => "dev-a",
      localSessions: () => [],
      peerSessions: () => [],
      sources: () => [],
      changesMinIntervalMs: 5,
    });
    const frames: Array<{ payload: unknown; kind: string }> = [];
    const sub = doors.subscribe({}, (payload, kind) => frames.push({ payload, kind }));
    const epoch = (sub.open as { snapshot: { epoch: string } }).snapshot.epoch;
    sub.start();
    const move = (i: number) =>
      listener?.({
        snapshot: {} as never,
        moves: [{ from: `p1:${i}`, to: `p1:${i + 1}`, at: i }],
      });
    for (let i = 0; i < 300; i += 1) move(i);
    await waitFor(() => frames.length === 1);
    expect(frames[0]?.kind).toBe("snapshot");
    // and a cursor from before the trim cannot resume
    const stale = doors.subscribe({ since: { epoch, revision: 1 } }, () => {});
    expect(stale.open).toHaveProperty("snapshot");
    sub.dispose();
    doors.dispose();
  });
});

describe("PJ-4 — the join column (A-D4): every catalog session carries its project's key", () => {
  const keyed = (w: ReturnType<typeof world>) =>
    new Map(
      w.doors.keyed(w.sessions.rows()).map((row) => [row.sessionId, row.projectKey] as const),
    );

  it("tags each of this desktop's rows with the key project.sessions files it under", () => {
    const w = world();
    w.groups.regroupNow();
    const page = ProjectListResult.parse(w.doors.list({}, WINDOW_VIEW, 100));
    const keys = keyed(w);
    // the join is the doors' own: every session project.sessions answers
    // under a key carries exactly that key — the window groups nothing
    for (const project of page.rows) {
      const filed = ProjectSessionsResult.parse(
        w.doors.sessions({ key: project.key, devices: ["dev-a"] }, WINDOW_VIEW, 100),
      );
      for (const row of filed.rows)
        expect(keys.get(row.sessionId), row.sessionId).toBe(project.key);
    }
    const byName = new Map(page.rows.map((row) => [row.name, row.key]));
    expect(Object.fromEntries(keys)).toEqual({
      s1: byName.get("app"),
      // the nested checkout's session: its own place, the same project
      s2: byName.get("app"),
      s3: byName.get("notes"),
      s4: byName.get("Home"),
      s5: byName.get("app"),
    });
  });

  it("R6: carries the place that holds the cwd beside the key — the folder ③ follows", () => {
    const w = world();
    w.groups.regroupNow();
    const places = new Map(
      w.doors.keyed(w.sessions.rows()).map((row) => [row.sessionId, row.place] as const),
    );
    expect(places.get("s1")).toEqual({ device: "dev-a", placeId: "pl-app" });
    // the nested checkout's session: its own place, though the same project
    expect(places.get("s2")).toEqual({ device: "dev-a", placeId: "pl-app-docs" });
    expect(places.get("s4")).toEqual({ device: "dev-a", placeId: "pl-home" });
    const [forged] = w.doors.keyed([
      { ...session("dev-a", "x9", "/Volumes/Elsewhere", 5), place: { device: "x", placeId: "y" } },
    ]);
    expect(forged).not.toHaveProperty("place");
  });

  it("H4: a project's pin and hide ride its summary from its record — absent when not", () => {
    const w = world();
    const app = () =>
      ProjectListResult.parse(w.doors.list({}, WINDOW_VIEW, 100)).rows.find((row) =>
        row.places.some((p) => p.ref.placeId === "pl-app"),
      );
    w.groups.regroupNow();
    expect(app()).not.toHaveProperty("pinned");
    expect(app()).not.toHaveProperty("hidden");
    const groups = new ProjectGroups({
      deviceId: () => "dev-a",
      local: { projects: w.projects, sessions: w.sessions },
      peers: () => w.peers,
      intents: () => ({
        records: [
          { id: "rec1", anchors: ["place:pl-app"], pinned: true, hidden: true, createdAt: 1 },
        ],
      }),
    });
    const doors = new ProjectDoors({
      groups,
      deviceId: () => "dev-a",
      localSessions: () => w.sessions.rows(),
      peerSessions: () => w.peers,
      sources: () => [],
    });
    groups.regroupNow();
    const pinned = ProjectListResult.parse(doors.list({}, WINDOW_VIEW, 100)).rows.find(
      (row) => row.key === "r:rec1",
    );
    expect(pinned).toMatchObject({ pinned: true, hidden: true });
  });

  it("PJ-6: a project's launch recipe rides its summary from its record; one this daemon cannot read is left off — never a refused list", () => {
    const w = world();
    const recipe = {
      provider: "scripted",
      profileSet: "work",
      selection: { modelId: "model-a" },
      controlsByModel: { "model-a": { effort: "high" }, "model-b": {} },
      at: 1_759_276_800_000,
    };
    const answerWith = (held: unknown) => {
      const groups = new ProjectGroups({
        deviceId: () => "dev-a",
        local: { projects: w.projects, sessions: w.sessions },
        peers: () => w.peers,
        intents: () => ({
          records: [{ id: "rec1", anchors: ["place:pl-app"], recipe: held, createdAt: 1 }],
        }),
      });
      const doors = new ProjectDoors({
        groups,
        deviceId: () => "dev-a",
        localSessions: () => w.sessions.rows(),
        peerSessions: () => w.peers,
        sources: () => [],
      });
      groups.regroupNow();
      return ProjectListResult.parse(doors.list({}, WINDOW_VIEW, 100)).rows.find(
        (row) => row.key === "r:rec1",
      );
    };
    expect(answerWith(recipe)?.recipe).toEqual(recipe);
    // PJ-7 — the contracts' golden recipe, with the place its launch entered,
    // answers whole (EL9: the fixture read by its daemon), and a place this
    // daemon cannot read leaves the recipe standing without one
    const golden = JSON.parse(
      readFileSync(
        join(import.meta.dirname, "../../contracts/fixtures/project-summary.recipe-place.json"),
        "utf8",
      ),
    ) as { recipe: Record<string, unknown> };
    expect(answerWith(golden.recipe)?.recipe).toEqual(golden.recipe);
    expect(answerWith(golden.recipe)?.recipe?.place).toEqual({
      device: "01J9ZK3M5Q8XR2V7N4B6C1D0EF",
      placeId: "pl_4c1e9a0b7d2f6e8a1b3c5d7e",
    });
    const strayPlace = answerWith({ ...golden.recipe, place: "/Users/me/x" })?.recipe;
    expect(strayPlace?.provider).toBe("claude");
    expect(strayPlace?.place).toBeUndefined();
    // a newer desktop's shape this daemon cannot read: no recipe, the row stands
    const unreadable = answerWith({ provider: "scripted", profileSet: "work", v: 2 });
    expect(unreadable).toBeDefined();
    expect(unreadable).not.toHaveProperty("recipe");
    // no recipe on the record, none on the row
    w.groups.regroupNow();
    const plain = ProjectListResult.parse(w.doors.list({}, WINDOW_VIEW, 100)).rows.find((row) =>
      row.places.some((p) => p.ref.placeId === "pl-app"),
    );
    expect(plain).not.toHaveProperty("recipe");
  });

  it("leaves the column off a row no place holds, and never trusts one a row arrived with", () => {
    const w = world();
    w.groups.regroupNow();
    const [stray, forged] = w.doors.keyed([
      session("dev-a", "x1", "/Volumes/Elsewhere/thing", 5),
      { ...session("dev-a", "x2", "/Users/me/notes/a", 5), projectKey: "r:forged" },
    ]);
    expect(stray).not.toHaveProperty("projectKey");
    expect(forged?.projectKey).toBe(keyed(w).get("s3"));
    // no cwd, no key
    expect(w.doors.keyed([{ ...session("dev-a", "x3", "", 5) }])[0]).not.toHaveProperty(
      "projectKey",
    );
  });

  it("reads a peer's row by ITS places, never this desktop's same-spelled folder", () => {
    const w = world();
    w.groups.regroupNow();
    const app = appOf(w)!.key;
    const [t1, spoofed] = w.doors.keyed([
      session("dev-b", "t1", "/home/me/src/app", 60),
      // dev-b has no place at this desktop's /Users/me/app spelling
      session("dev-b", "t9", "/Users/me/app/src", 60),
    ]);
    expect(t1?.projectKey).toBe(app);
    expect(spoofed).not.toHaveProperty("projectKey");
  });

  it("answers rows without the column before this boot's first grouping — never a refusal", () => {
    const w = world();
    const rows = w.doors.keyed(w.sessions.rows());
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(row).not.toHaveProperty("projectKey");
    expect(w.doors.keyOf("dev-a", "/Users/me/app")).toBeUndefined();
  });

  it("files a delegated thread under its ROOT's project, whatever folder it worked in", () => {
    const w = world();
    w.groups.regroupNow();
    const threads = w.doors.keyedThreads(
      [
        { sessionId: "c1", rootSessionId: "s1", cwd: "/Users/me/notes" },
        { sessionId: "c2", rootSessionId: "gone" },
      ],
      (id) => w.sessions.get(id),
    );
    expect(threads[0]?.projectKey).toBe(appOf(w)!.key);
    expect(threads[1]).not.toHaveProperty("projectKey");
  });

  it("is a reader's column: never answered to a peer daemon (DS-L4)", () => {
    expect(readsProjects(WINDOW)).toBe(true);
    expect(readsProjects(PHONE)).toBe(true);
    expect(readsProjects(ctx({ kind: "peer-fieldd", deviceId: "dev-b" }))).toBe(false);
    expect(readsProjects(ctx({ kind: "plugin", id: "p", scopes: ["index.search"] }))).toBe(false);
  });

  it("a ping names the catalog tables that moved — only when nothing else did", async () => {
    const w = world();
    w.groups.regroupNow();
    const frames: unknown[] = [];
    const sub = w.doors.subscribe({}, (payload) => frames.push(payload));
    sub.start();
    const waitFor = async (n: number) => {
      const deadline = Date.now() + 3_000;
      while (frames.length < n) {
        if (Date.now() > deadline) throw new Error("timed out");
        await new Promise((r) => setTimeout(r, 5));
      }
    };
    // this desktop's threads alone: the room keeps its roots
    w.doors.catalogChanged("dev-a", "threads");
    await waitFor(1);
    expect(ProjectChangesDelta.parse(frames[0]).tables).toEqual(["threads"]);
    // two tables in one ping
    w.doors.catalogChanged("dev-a", "threads");
    w.doors.catalogChanged("dev-a", "sessions");
    await waitFor(2);
    expect(ProjectChangesDelta.parse(frames[1]).tables).toEqual(["sessions", "threads"]);
    // a desktop's standing (no table) — everything is asked again
    w.doors.catalogChanged("dev-b");
    await waitFor(3);
    expect(ProjectChangesDelta.parse(frames[2]).tables).toBeUndefined();
    // a new grouping beside a threads move — everything again
    w.doors.catalogChanged("dev-a", "threads");
    w.projects.upsert([
      {
        device: "dev-a",
        projectId: "r-notes",
        name: "notes",
        rootPaths: [],
        sessionCount: 0,
        places: [place("pl-notes", "/Users/me/notes", repo())],
      },
    ]);
    w.groups.regroupNow();
    await waitFor(4);
    expect(ProjectChangesDelta.parse(frames[3]).tables).toBeUndefined();
    sub.dispose();
  });
});

// ── PJ-4: the merged figures (H2 (a), A-D3) ─────────────────────────────────

/** One session's recorded usage in one hour, as a desktop's rosetta holds it. */
interface Usage {
  device: string;
  projectId: string;
  sessionId: string;
  day: string;
  hour: number;
  model: string;
  tokens: number;
  cost: number | null;
}

const USAGE: Usage[] = [
  {
    device: "dev-a",
    projectId: "r-app",
    sessionId: "s1",
    day: "2026-10-01",
    hour: 9,
    model: "opus",
    tokens: 100,
    cost: 10,
  },
  {
    device: "dev-a",
    projectId: "r-app",
    sessionId: "s2",
    day: "2026-10-01",
    hour: 10,
    model: "opus",
    tokens: 50,
    cost: 5,
  },
  {
    device: "dev-a",
    projectId: "r-app",
    sessionId: "s5",
    day: "2026-10-02",
    hour: 9,
    model: "opus",
    tokens: 20,
    cost: null,
  },
  {
    device: "dev-a",
    projectId: "r-notes",
    sessionId: "s3",
    day: "2026-10-01",
    hour: 9,
    model: "codex",
    tokens: 70,
    cost: 7,
  },
  {
    device: "dev-a",
    projectId: "r-home",
    sessionId: "s4",
    day: "2026-10-02",
    hour: 11,
    model: "opus",
    tokens: 5,
    cost: 1,
  },
  // dev-b's rosetta minted the SAME id for its checkout (A4.1: a shared path)
  {
    device: "dev-b",
    projectId: "r-app",
    sessionId: "t1",
    day: "2026-10-01",
    hour: 9,
    model: "opus",
    tokens: 40,
    cost: 4,
  },
  {
    device: "dev-b",
    projectId: "r-app",
    sessionId: "t2",
    day: "2026-10-02",
    hour: 12,
    model: "opus",
    tokens: 30,
    cost: 3,
  },
];

/** rosetta's own aggregates over one desktop's usage — what `index.project`
 * and `index.projectDay` answer (the six figures, money summed as SQL does). */
function rosettaOver(usage: readonly Usage[], device: string) {
  const figures = (rows: readonly Usage[]) => ({
    tokens: rows.reduce((n, r) => n + r.tokens, 0),
    costMicroUsd: rows.every((r) => r.cost === null)
      ? null
      : rows.reduce((n, r) => n + (r.cost ?? 0), 0),
    billedMicroUsd: null,
    unpricedTokens: rows.reduce((n, r) => n + (r.cost === null ? r.tokens : 0), 0),
    unrecordedOutput: 0,
    reportedCostAdjustmentMicroUsd: 0,
  });
  const by = <K extends string | number>(rows: readonly Usage[], key: (r: Usage) => K) => {
    const out = new Map<K, Usage[]>();
    for (const row of rows) out.set(key(row), [...(out.get(key(row)) ?? []), row]);
    return [...out.entries()];
  };
  const asked: Array<{ method: string; params: Record<string, unknown> }> = [];
  return {
    asked,
    project: async (params: { projectId: string; sinceMs?: number; offsetMinutes?: number }) => {
      asked.push({ method: "index.project", params });
      const rows = usage.filter((r) => r.device === device && r.projectId === params.projectId);
      return {
        projectId: params.projectId,
        heatmap: by(rows, (r) => r.day).map(([day, held]) => ({ day, ...figures(held) })),
        usage: {
          models: by(rows, (r) => `${r.day} ${r.model}`).map(([, held]) => ({
            day: held[0]!.day,
            model: held[0]!.model,
            ...figures(held),
          })),
          hours: by(rows, (r) => r.hour).map(([hour, held]) => ({ hour, ...figures(held) })),
        },
        contribution: by(rows, (r) => r.sessionId).map(([sessionId, held]) => ({
          sessionId,
          projectId: params.projectId,
          commits: 0,
          edits: 0,
          loc: 0,
          messages: held.length,
          ...figures(held),
        })),
        clipped: false,
      };
    },
    projectDay: async (params: { projectId: string; day: string; offsetMinutes?: number }) => {
      asked.push({ method: "index.projectDay", params });
      const rows = usage.filter(
        (r) => r.device === device && r.projectId === params.projectId && r.day === params.day,
      );
      return {
        projectId: params.projectId,
        day: params.day,
        models: by(rows, (r) => `${r.hour} ${r.model}`).map(([, held]) => ({
          hour: held[0]!.hour,
          model: held[0]!.model,
          tokens: held.reduce((n, r) => n + r.tokens, 0),
        })),
      };
    },
  };
}

function figuresWorld(
  opts: {
    usage?: readonly Usage[];
    extraSessions?: IndexCatalogSession[];
    sharedConversation?: boolean;
    peerAsleep?: boolean;
  } = {},
) {
  const w = world();
  const usage = opts.usage ?? USAGE;
  const filing = new Map(usage.map((u) => [`${u.device} ${u.sessionId}`, u.projectId]));
  // rosetta files each session under its project
  w.sessions.upsert(
    [...w.sessions.rows(), ...(opts.extraSessions ?? [])].map((row) => ({
      ...row,
      projectId: filing.get(`dev-a ${row.sessionId}`) ?? row.projectId,
    })),
  );
  const peer = w.peers[0]!;
  peer.sessions = peer.sessions.map((row) => ({
    ...row,
    projectId: filing.get(`dev-b ${row.sessionId}`),
    // t2 shares s5's native id in world(); a distinct conversation unless asked
    ...(row.sessionId === "t2" && opts.sharedConversation !== true
      ? { nativeSessionId: "n-t2" }
      : {}),
  }));
  const local = rosettaOver(usage, "dev-a");
  const remote = rosettaOver(usage, "dev-b");
  const peerAsks: Array<{ device: string; method: string; params: unknown }> = [];
  const doors = new ProjectDoors({
    groups: w.groups,
    deviceId: () => "dev-a",
    localSessions: () => w.sessions.rows(),
    peerSessions: () => w.peers,
    sources: () => [],
    figures: {
      local: { project: local.project, projectDay: local.projectDay },
      peer: async (device, method, params) => {
        peerAsks.push({ device, method, params });
        if (opts.peerAsleep === true)
          return {
            answered: false,
            source: { device, state: "asleep", tookMs: 0, detail: "this desktop is asleep" },
          };
        const ask = params as { projectId: string; day?: string };
        const value =
          method === "index.project"
            ? await remote.project(ask)
            : await remote.projectDay(ask as { projectId: string; day: string });
        return { answered: true, value, tookMs: 3 };
      },
    },
  });
  w.groups.regroupNow();
  const keyOfPlace = (placeId: string) =>
    w.groups.current()!.result.projects.find((p) => p.places.some((pl) => pl.placeId === placeId))!
      .key;
  /** the project's sessions' recorded tokens, straight from the usage */
  const lifetime = (sessions: string[]) =>
    usage
      .filter((u) => sessions.includes(`${u.device} ${u.sessionId}`))
      .reduce((n, u) => n + u.tokens, 0);
  return { w, doors, local, peerAsks, keyOfPlace, lifetime };
}

const WINDOW_ASK = { sinceMs: 1_000, offsetMinutes: -420 };

describe("PJ-4 — project.figures: one merged figure, honest when partial (H2)", () => {
  it("asks every (desktop, rosetta project) the project's sessions are filed under — both, never a bare id — and sums what is additive", async () => {
    const f = figuresWorld();
    const key = f.keyOfPlace("pl-app");
    const answer = ProjectFiguresResult.parse(await f.doors.figures({ key, ...WINDOW_ASK }));
    // A4.1: dev-b's rosetta minted the same id; both desktops are asked for it
    expect(f.local.asked).toEqual([
      { method: "index.project", params: { projectId: "r-app", ...WINDOW_ASK } },
    ]);
    expect(f.peerAsks).toEqual([
      { device: "dev-b", method: "index.project", params: { projectId: "r-app", ...WINDOW_ASK } },
    ]);
    expect(answer.heatmap).toEqual([
      {
        day: "2026-10-01",
        tokens: 190,
        costMicroUsd: 19,
        billedMicroUsd: null,
        unpricedTokens: 0,
        unrecordedOutput: 0,
        reportedCostAdjustmentMicroUsd: 0,
      },
      {
        // an unpriced part is not zero: SQL's sum, the unpriced tokens counted
        day: "2026-10-02",
        tokens: 50,
        costMicroUsd: 3,
        billedMicroUsd: null,
        unpricedTokens: 20,
        unrecordedOutput: 0,
        reportedCostAdjustmentMicroUsd: 0,
      },
    ]);
    expect(answer.usage.hours.map((h) => [h.hour, h.tokens])).toEqual([
      [9, 160],
      [10, 50],
      [12, 30],
    ]);
    expect(answer.usage.models.map((m) => [m.day, m.model, m.tokens])).toEqual([
      ["2026-10-01", "opus", 190],
      ["2026-10-02", "opus", 50],
    ]);
    expect(answer.contribution.map((c) => [c.device, c.sessionId, c.tokens])).toEqual([
      ["dev-b", "t1", 40],
      ["dev-b", "t2", 30],
      ["dev-a", "s1", 100],
      ["dev-a", "s2", 50],
      ["dev-a", "s5", 20],
    ]);
    expect(answer.sources).toEqual([
      { device: "dev-b", state: "answered", tookMs: 3, projects: 1, split: 0 },
      expect.objectContaining({ device: "dev-a", state: "answered", projects: 1, split: 0 }),
    ]);
    expect(answer).toMatchObject({ key, partial: false, lifetimePartial: false, clipped: false });
  });

  it("an asleep desktop is named; its figures are missing, and both kinds say partial", async () => {
    const f = figuresWorld({ peerAsleep: true });
    const answer = ProjectFiguresResult.parse(
      await f.doors.figures({ key: f.keyOfPlace("pl-app"), ...WINDOW_ASK }),
    );
    expect(answer.sources[0]).toEqual({
      device: "dev-b",
      state: "asleep",
      tookMs: 0,
      detail: "this desktop is asleep",
      projects: 1,
      split: 0,
    });
    expect(answer.heatmap.map((d) => [d.day, d.tokens])).toEqual([
      ["2026-10-01", 150],
      ["2026-10-02", 20],
    ]);
    expect(answer.contribution.map((c) => c.sessionId)).toEqual(["s1", "s2", "s5"]);
    expect(answer).toMatchObject({ partial: true, lifetimePartial: true });
  });

  it("a rosetta project held in PART: its days are left out, its rows kept for the project's own sessions — the lifetime total stays exact", async () => {
    // a session rosetta files under the app's checkout, in a folder the notes'
    // place holds: r-app is split between the two projects
    const f = figuresWorld({
      usage: [
        ...USAGE,
        {
          device: "dev-a",
          projectId: "r-app",
          sessionId: "s7",
          day: "2026-10-03",
          hour: 9,
          model: "opus",
          tokens: 1000,
          cost: 100,
        },
      ],
      extraSessions: [session("dev-a", "s7", "/Users/me/notes/x", 70)],
    });
    const app = ProjectFiguresResult.parse(
      await f.doors.figures({ key: f.keyOfPlace("pl-app"), ...WINDOW_ASK }),
    );
    // the app's days: dev-b's whole checkout only — dev-a's r-app cannot be cut
    expect(app.heatmap.map((d) => [d.day, d.tokens])).toEqual([
      ["2026-10-01", 40],
      ["2026-10-02", 30],
    ]);
    expect(app.usage.hours.map((h) => [h.hour, h.tokens])).toEqual([
      [9, 40],
      [12, 30],
    ]);
    // …its rows are its own sessions', and their sum is exactly theirs
    expect(app.contribution.map((c) => c.sessionId)).toEqual(["t1", "t2", "s1", "s2", "s5"]);
    expect(app.contribution.reduce((n, c) => n + c.tokens, 0)).toBe(
      f.lifetime(["dev-a s1", "dev-a s2", "dev-a s5", "dev-b t1", "dev-b t2"]),
    );
    expect(app.sources.find((s) => s.device === "dev-a")).toMatchObject({
      state: "answered",
      projects: 1,
      split: 1,
    });
    expect(app).toMatchObject({ partial: true, lifetimePartial: false });
    // the notes: its own rosetta project whole, and its part of r-app
    const notes = ProjectFiguresResult.parse(
      await f.doors.figures({ key: f.keyOfPlace("pl-notes"), ...WINDOW_ASK }),
    );
    expect(notes.heatmap.map((d) => [d.day, d.tokens])).toEqual([["2026-10-01", 70]]);
    // the plan's order: the desktop, then the rosetta id
    expect(notes.contribution.map((c) => [c.sessionId, c.tokens])).toEqual([
      ["s7", 1000],
      ["s3", 70],
    ]);
    expect(notes.contribution.reduce((n, c) => n + c.tokens, 0)).toBe(
      f.lifetime(["dev-a s3", "dev-a s7"]),
    );
    expect(notes.sources).toEqual([
      expect.objectContaining({ device: "dev-a", projects: 2, split: 1 }),
    ]);
    expect(notes).toMatchObject({ partial: true, lifetimePartial: false });
  });

  it("one conversation two desktops recorded keeps ONE row; its days, counted twice, say partial", async () => {
    const f = figuresWorld({ sharedConversation: true });
    const answer = ProjectFiguresResult.parse(
      await f.doors.figures({ key: f.keyOfPlace("pl-app"), ...WINDOW_ASK }),
    );
    // DS-D10: the copy of the desktop listed first speaks (the project's order)
    expect(answer.contribution.map((c) => c.sessionId)).toEqual(["t1", "t2", "s1", "s2"]);
    expect(answer).toMatchObject({ partial: true, lifetimePartial: false });
  });

  it("a tailnet caller's rows are cut at its bound, and the lifetime says so", async () => {
    const f = figuresWorld();
    const answer = ProjectFiguresResult.parse(
      await f.doors.figures({ key: f.keyOfPlace("pl-app"), ...WINDOW_ASK }, 2),
    );
    expect(answer.contribution).toHaveLength(2);
    expect(answer).toMatchObject({ clipped: true, lifetimePartial: true, partial: false });
  });

  it("follows a key that regrouped, as every read does", async () => {
    const f = figuresWorld();
    const notesKey = f.keyOfPlace("pl-notes");
    // the notes' folder becomes a clone of the app's repository: it joins
    f.w.projects.upsert([
      {
        device: "dev-a",
        projectId: "r-notes",
        name: "notes",
        rootPaths: [],
        sessionCount: 0,
        places: [place("pl-notes", "/Users/me/notes", repo())],
      },
    ]);
    f.w.groups.regroupNow();
    const answer = ProjectFiguresResult.parse(
      await f.doors.figures({ key: notesKey, ...WINDOW_ASK }),
    );
    expect(answer.movedTo).toBe(f.keyOfPlace("pl-app"));
    expect(answer.contribution.map((c) => c.sessionId)).toContain("s3");
  });
});

describe("PJ-4 — project.figuresDay: one day's hours over the same parts", () => {
  it("sums the whole parts' hours by model, across desktops", async () => {
    const f = figuresWorld();
    const day = ProjectFiguresDayResult.parse(
      await f.doors.figuresDay({
        key: f.keyOfPlace("pl-app"),
        day: "2026-10-01",
        offsetMinutes: -420,
      }),
    );
    expect(day.models).toEqual([
      { hour: 9, model: "opus", tokens: 140 },
      { hour: 10, model: "opus", tokens: 50 },
    ]);
    expect(f.peerAsks).toEqual([
      {
        device: "dev-b",
        method: "index.projectDay",
        params: { projectId: "r-app", day: "2026-10-01", offsetMinutes: -420 },
      },
    ]);
    expect(day.partial).toBe(false);
  });

  it("never asks a part held in part, and says the day is partial", async () => {
    const f = figuresWorld({
      usage: [
        ...USAGE,
        {
          device: "dev-a",
          projectId: "r-app",
          sessionId: "s7",
          day: "2026-10-01",
          hour: 9,
          model: "opus",
          tokens: 1000,
          cost: 100,
        },
      ],
      extraSessions: [session("dev-a", "s7", "/Users/me/notes/x", 70)],
    });
    const day = ProjectFiguresDayResult.parse(
      await f.doors.figuresDay({ key: f.keyOfPlace("pl-app"), day: "2026-10-01" }),
    );
    expect(f.local.asked).toEqual([]);
    expect(day.models).toEqual([{ hour: 9, model: "opus", tokens: 40 }]);
    expect(day.partial).toBe(true);
  });
});

describe("project.intent — the shell until PJ-2's records are wired (P2)", () => {
  const rename = (key: string): ProjectIntentParams => ({ key, op: "rename", name: "App" });

  it("answers UNAVAILABLE records-unbuilt once it has resolved what the act names", async () => {
    const w = world();
    w.groups.regroupNow();
    const key = appOf(w)!.key;
    expect(await refusalOf(() => w.doors.intent(rename(key)))).toEqual({
      kind: "UNAVAILABLE",
      details: { service: "projects", state: "records-unbuilt" },
    });
    // what it cannot resolve is said first
    expect((await refusalOf(() => w.doors.intent(rename("p1:nothing")))).kind).toBe("NOT_FOUND");
    expect(
      await refusalOf(() =>
        w.doors.intent({ key, op: "split", place: { device: "dev-a", placeId: "pl-notes" } }),
      ),
    ).toEqual({ kind: "PRECONDITION_FAILED", details: { reason: "no-such-place" } });
  });

  it("refuses an act aimed at a key that regrouped, naming where it went (D9)", async () => {
    const w = world();
    w.groups.regroupNow();
    const notesKey = w.groups.current()!.result.projects.find((p) => p.name === "notes")!.key;
    w.projects.upsert([
      {
        device: "dev-a",
        projectId: "r-notes",
        name: "notes",
        rootPaths: [],
        sessionCount: 0,
        places: [place("pl-notes", "/Users/me/notes", repo())],
      },
    ]);
    w.groups.regroupNow();
    expect(await refusalOf(() => w.doors.intent(rename(notesKey)))).toEqual({
      kind: "PRECONDITION_FAILED",
      details: { reason: "key-moved", movedTo: appOf(w)!.key },
    });
  });

  it("hands a resolved act to the records once they are wired, and answers its record's key", async () => {
    const w = world();
    w.groups.regroupNow();
    const app = appOf(w)!;
    const notes = w.groups.current()!.result.projects.find((p) => p.name === "notes")!;
    const seen: Array<{ key: string; op: string; with?: string }> = [];
    w.setWriter({
      act: (project, intent, context) => {
        seen.push({
          key: project.key,
          op: intent.op,
          ...(context.with !== undefined ? { with: context.with.key } : {}),
        });
        return { recordId: "rec-1" };
      },
    });
    expect(await w.doors.intent(rename(app.key))).toEqual({ key: "r:rec-1", recordId: "rec-1" });
    await w.doors.intent({ key: app.key, op: "dismiss", with: notes.key });
    expect(seen).toEqual([
      { key: app.key, op: "rename" },
      { key: app.key, op: "dismiss", with: notes.key },
    ]);
  });
});
