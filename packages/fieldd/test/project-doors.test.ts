// PJ-3 — the `project.*` doors as a unit (projects/project-doors.ts) over the
// REAL grouping (ProjectGroups → the engine) of two desktops: who is admitted
// and what each is told (D8, D10, P1), a path in an ask refused (P1), the
// pages and their cursors, a key that regrouped (D9: a read follows it, an act
// is refused), a session's place by the longest path and one row per native
// session (DS-D10), the pings with their key moves, and the act's shell until
// PJ-2's records are wired (P2). The phone's witness over the real door is
// project-doors-phone.test.ts.
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
    expect(page.sources).toHaveLength(2);
    expect(page.groupingVersion).toBe(1);
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
