// @vitest-environment node
/**
 * AR-8c — the History room's ports (`history/doors.ts`, `session-port.ts`,
 * `asset-source.ts`): pure adapters over a fieldd client, read here against
 * the CONTRACT fixtures (EL9 — the same JSON fieldd's own suites parse) and a
 * scripted client. The rows: the catalog assembled from DS-6's listings and
 * pings into the room's meta shapes; the session lease renewed before its
 * grant expires and repointed when the ticket's origin moves; the asset
 * cache's bound and its revokes; the honest refusal of a recorded file.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AssetRef,
  type MetaState,
  PROTOCOL_VERSION,
  RosettaClient,
  type SubscriptionStatus,
} from "@rosetta/protocol";
import {
  IndexProjectResult,
  IndexProjectsResult,
  IndexSessionsResult,
  IndexStatus,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assetSourceOver } from "../src/history/asset-source";
import {
  catalogPortOver,
  catalogStatusOf,
  type HistoryDoorClient,
  metaStateOf,
  projectStatsOf,
  sessionRowOf,
  usageOf,
} from "../src/history/doors";
import {
  FILE_TARGET_REFUSAL,
  sessionPortOver,
  TICKET_RENEW_LEAD_MS,
} from "../src/history/session-port";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "fixtures");
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

const PROJECTS = IndexProjectsResult.parse(fixture("index-projects.mesh.json"));
const SESSIONS = IndexSessionsResult.parse(fixture("index-sessions.mesh.json"));
const STATUS = IndexStatus.parse(fixture("index-status.valid.json"));
const PROJECT = IndexProjectResult.parse(fixture("index-project.valid.json"));
const TICKET = fixture("index-open-ticket.local.json") as {
  device: string;
  endpoints: { sessionUrl: string; restUrl: string };
  grant: string;
  expiresAt: number;
};

/** A second page of the listing: a session the catalog maps to no agent, with
 * no activity and a stream state this build never heard of. */
const PAGE_TWO = {
  rows: [
    {
      sessionId: "ses-unmapped",
      nativeSessionId: "n-2",
      rootSessionId: "ses-unmapped",
      activity: null,
      streamState: "rewinding",
      projectId: "p-4f1c2a9e",
      updatedAt: 1759000000000,
    },
  ],
  sources: SESSIONS.sources,
};

afterEach(() => {
  vi.useRealTimers();
});

/* ── a scripted fieldd client ──────────────────────────────────────────── */

function client(answers: Record<string, (params: Record<string, unknown>) => unknown>) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  let onFrame: ((payload: unknown, kind?: "snapshot" | "delta") => void) | null = null;
  const door: HistoryDoorClient & {
    calls: typeof calls;
    ping(kind?: "snapshot" | "delta"): void;
  } = {
    calls,
    ping: (kind = "delta") =>
      onFrame?.(
        {
          epoch: "changes-local-1",
          since: 0,
          revision: 1,
          upserts: [],
          removed: [],
          tables: ["sessions"],
          devices: [],
        },
        kind,
      ),
    request: async (method, params) => {
      calls.push({ method, params });
      const answer = answers[method];
      if (answer === undefined) {
        throw Object.assign(new Error(`${method} is not scripted`), { kind: "NOT_FOUND" });
      }
      return answer(params);
    },
    subscribe: async (method, params, frame) => {
      calls.push({ method, params });
      onFrame = frame;
      return {
        snapshot: { snapshot: { epoch: "changes-local-1", revision: 0, rows: [] } },
        unsubscribe: () => {
          onFrame = null;
        },
      };
    },
  };
  return door;
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

/* ── the catalog: DS-6's rows → the room's meta ───────────────────────── */

describe("the catalog port's rows (AR-8c)", () => {
  it("maps a listing row field by field into rosetta's SessionRow, the catalog's honest nulls kept", () => {
    const row = SESSIONS.rows[0];
    if (row === undefined) throw new Error("fixture has no row");
    expect(sessionRowOf(row)).toEqual({
      id: "ses-9b2f0c7d",
      native_session_id: "665e3e71-7c12-4810-925a-e8b92cb6f29d",
      // the agent, read through the catalog: the provider's rosetta kind
      runtime_id: "claude-code",
      project_id: "p-4f1c2a9e",
      cwd: "/Users/me/Projects/vibe-field",
      parent_session_id: null,
      delegation: null,
      root_session_id: "ses-9b2f0c7d",
      role: "main",
      title: "the history catalog across desktops",
      summary: null,
      started_at: 1759270000000,
      updated_at: 1759276790000,
      activity: { first_at: 1759270000000, last_at: 1759276800000 },
      stream_state: "indexed",
    });
    // a row with less: no agent, no activity, a word this build does not know
    expect(sessionRowOf(IndexSessionsResult.parse(PAGE_TWO).rows[0]!)).toMatchObject({
      runtime_id: "unknown",
      activity: null,
      stream_state: "indexed",
      // no start and no activity: its freshness is the nearest fact there is
      started_at: 1759000000000,
      updated_at: 1759000000000,
      cwd: null,
      title: null,
    });
  });

  it("assembles the room's whole topology: one runtime per agent kind, projects with their remotes", () => {
    const meta = metaStateOf(PROJECTS.rows, [
      ...SESSIONS.rows,
      ...IndexSessionsResult.parse(PAGE_TWO).rows,
    ]);
    expect(meta.runtimes.map((runtime) => [runtime.id, runtime.kind])).toEqual([
      ["claude-code", "claude-code"],
      ["unknown", "unknown"],
    ]);
    expect(meta.projects[0]).toEqual({
      id: "p-4f1c2a9e",
      name: "vibe-field",
      root_paths: ["/Users/me/Projects/vibe-field"],
      git_repo: "github.com:jamesyong42/vibe-field",
    });
    expect(meta.sessions.map((row) => row.id)).toEqual(["ses-9b2f0c7d", "ses-unmapped"]);
  });

  it("folds index.status into the room's CatalogStatus, and an index that is not up into no status", () => {
    expect(catalogStatusOf(STATUS)).toEqual({
      canonicalReady: true,
      searchReadiness: "ready",
      searchProgress: null,
      ingest: {
        phase: "live",
        runtimes: [
          expect.objectContaining({
            kind: "claude-code",
            runtime_id: "rt_5f0c9a2e1b7d4c3a",
            state: "done",
            files_total: 1284,
            sessions_total: 212,
            records: 90411,
          }),
          expect.objectContaining({ runtime_id: "rt_0b7e2c4d9a1f3e58", label: "Kim" }),
        ],
        projects: [],
      },
      startedAt: null,
      uptimeMs: 0,
    });
    expect(
      catalogStatusOf({
        ...STATUS,
        phase: "starting",
        rosettad: { ...STATUS.rosettad, phase: "starting" },
      }),
    ).toBeNull();
  });

  it("splits ONE index.project answer into the panel's figures and its usage, nulls kept null", () => {
    const stats = projectStatsOf(PROJECT);
    expect(stats.heat[0]).toEqual({
      day: "2026-08-26",
      tokens: 123,
      cost_micro_usd: 4210,
      billed_micro_usd: null,
      unpriced_tokens: 23,
      unrecorded_output: 0,
      reported_cost_adjustment_micro_usd: 0,
    });
    expect(stats.contribution[0]).toMatchObject({ session_id: "s1", project_id: "p1", commits: 1 });
    const usage = usageOf(PROJECT);
    expect(usage.models.map((row) => [row.model, row.cost_micro_usd])).toEqual([
      ["claude-opus-5", 4210],
      ["unknown", null],
    ]);
    expect(usage.hours[0]).toMatchObject({ hour: 15, tokens: 123 });
  });
});

describe("the catalog port's meta feed (AR-8c)", () => {
  function scripted(pages: { sessions: unknown[] }) {
    return client({
      "index.projects": () => PROJECTS_ONE_PAGE,
      "index.sessions": (params) => {
        const page = params["cursor"] === undefined ? 0 : Number(params["cursor"]);
        return pages.sessions[page];
      },
      "index.status": () => fixture("index-status.valid.json"),
      "index.project": () => fixture("index-project.valid.json"),
    });
  }
  const PROJECTS_ONE_PAGE = { rows: PROJECTS.rows, sources: PROJECTS.sources };

  it("answers one snapshot assembled from every page of both listings, then a mutation per ping", async () => {
    const pages: { sessions: unknown[] } = {
      sessions: [{ ...SESSIONS, cursor: "1" }, PAGE_TWO],
    };
    const door = scripted(pages);
    const catalog = catalogPortOver(door);
    const changes: Array<{ meta: MetaState; source: string }> = [];
    const statuses: SubscriptionStatus[] = [];
    const feed = catalog.subscribeMeta({
      onChange: (meta, source) => changes.push({ meta, source }),
      onStatus: (status) => statuses.push(status),
    });
    await flush();
    expect(door.calls.map((call) => call.method)).toContain("index.changes.subscribe");
    expect(changes).toHaveLength(1);
    expect(changes[0]?.source).toBe("snapshot");
    expect(changes[0]?.meta.sessions.map((row) => row.id)).toEqual([
      "ses-9b2f0c7d",
      "ses-unmapped",
    ]);
    // the listings are this desktop's own, asked at the door's page ceiling
    const listing = door.calls.find((call) => call.method === "index.sessions");
    expect(listing?.params).toEqual({ scope: "local", limit: 500 });
    expect(statuses).toEqual(["connecting", "live"]);

    // a ping: the listing is read again and said as a mutation
    pages.sessions[1] = {
      ...PAGE_TWO,
      rows: [{ ...PAGE_TWO.rows[0], title: "renamed" }],
    };
    door.ping();
    await flush();
    expect(changes).toHaveLength(2);
    expect(changes[1]?.source).toBe("mutation");
    expect(changes[1]?.meta.sessions[1]?.title).toBe("renamed");

    // hidden, a ping is noted, not read; showing reads it once
    catalog.setActive(false);
    door.ping();
    await flush();
    expect(changes).toHaveLength(2);
    catalog.setActive(true);
    await flush();
    expect(changes).toHaveLength(3);
    feed.close();
  });

  it("says the catalog's refusal in fieldd's words and asks again, never a blank", async () => {
    vi.useFakeTimers();
    let ready = false;
    const door = client({
      "index.projects": () => {
        if (!ready) {
          throw Object.assign(new Error("the history catalog has not read the index yet"), {
            kind: "UNAVAILABLE",
            retryable: true,
            details: { service: "index", state: "connecting" },
          });
        }
        return { rows: PROJECTS.rows, sources: PROJECTS.sources };
      },
      "index.sessions": () => SESSIONS,
    });
    const catalog = catalogPortOver(door);
    const changes: string[] = [];
    catalog.subscribeMeta({ onChange: (_meta, source) => changes.push(source) });
    await vi.advanceTimersByTimeAsync(0);
    expect(changes).toEqual([]);
    expect(catalog.words()).toBe("The history catalog has not read the index yet (connecting)");
    expect(catalog.unavailable?.()).toBe(catalog.words());
    ready = true;
    await vi.advanceTimersByTimeAsync(600);
    expect(changes).toEqual(["snapshot"]);
    expect(catalog.words()).toBeNull();
  });

  it("refuses status for an index that is not up, in fieldd's own words", async () => {
    const catalog = catalogPortOver(
      client({
        "index.status": () => ({
          ...(fixture("index-status.valid.json") as object),
          phase: "failed",
          rosettad: { phase: "failed", detail: "exited 101", pid: null, protocolVersion: null },
        }),
      }),
    );
    await expect(catalog.status()).rejects.toThrow("The agent index is failed: exited 101");
    expect(catalog.unavailable?.()).toBe("The agent index is failed: exited 101");
  });

  it("shares ONE index.project flight between the panel's figures and its usage", async () => {
    const door = client({ "index.project": () => fixture("index-project.valid.json") });
    const catalog = catalogPortOver(door);
    const window = { sinceMs: 1_700_000_000_000, offsetMinutes: -420 };
    const [stats, usage] = await Promise.all([
      catalog.projectStats("p1", window),
      catalog.usage("p1", window),
    ]);
    expect(stats.heat).toHaveLength(1);
    expect(usage.hours).toHaveLength(1);
    expect(door.calls.filter((call) => call.method === "index.project")).toEqual([
      {
        method: "index.project",
        params: { projectId: "p1", sinceMs: 1_700_000_000_000, offsetMinutes: -420 },
      },
    ]);
  });
});

/* ── the session lease ─────────────────────────────────────────────────── */

/** rosetta's client's transport in a test: sockets recorded, frames served. */
class FakeSocket {
  static opened: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(
    readonly url: string,
    readonly protocols?: string[],
  ) {
    FakeSocket.opened.push(this);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
  serve(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  /** the daemon went away under the stream */
  drop(): void {
    this.close();
  }
}

/** rosettad's REST in a test: every read recorded with the credential it
 * carried; a 401 the first time `refuseOnce` names a path. */
function rosettadFetch(refuseOnce: Set<string> = new Set()) {
  const reads: Array<{ url: string; authorization: string | null }> = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const authorization = new Headers(init?.headers).get("authorization");
    reads.push({ url, authorization });
    const path = new URL(url).pathname;
    const headers = { "x-rosetta-protocol-version": String(PROTOCOL_VERSION) };
    if (refuseOnce.delete(path)) {
      return new Response("", {
        status: 401,
        headers: { ...headers, "x-rosetta-auth": "expired" },
      });
    }
    if (path.startsWith("/api/assets/")) {
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers });
    }
    return new Response(JSON.stringify({ entry: { timeline_id: "t1" }, generation: 1 }), {
      status: 200,
      headers: { ...headers, "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchFn, reads };
}

function ticket(port: number, grant: string, expiresAt: number) {
  return {
    ...TICKET,
    endpoints: {
      sessionUrl: `ws://127.0.0.1:${port}/ws/sessions/s1`,
      restUrl: `http://127.0.0.1:${port}`,
    },
    grant,
    expiresAt,
  };
}

describe("the session port's lease (AR-8c)", () => {
  it("renews the grant before it expires, and repoints the one client when the ticket names a new origin", async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    FakeSocket.opened = [];
    const tickets = [
      ticket(52811, "g1", 1_000_000 + 600_000),
      ticket(52811, "g2", 1_000_000 + 540_000 + 600_000),
      // far ahead: its own renewal falls outside this row's window
      ticket(52999, "g3", 1_000_000 + 10_000_000),
    ];
    const door = client({ "index.openTicket": () => tickets.shift() });
    const rest = rosettadFetch();
    const port = sessionPortOver(door, {
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      fetchFn: rest.fetchFn,
    });
    const session = await port.open("s1");
    const statuses: SubscriptionStatus[] = [];
    session.subscribeSession("s1", { onStatus: (status) => statuses.push(status) });
    const first = FakeSocket.opened[0];
    expect(first?.url).toBe("ws://127.0.0.1:52811/ws/sessions/s1");
    expect(first?.protocols).toEqual(["rosetta", "rosetta.grant.g1"]);
    first?.serve({ frame: "hello", protocol_version: PROTOCOL_VERSION, stamp: null });
    first?.serve({ frame: "caught_up", stamp: { epoch: 1, seq: 0 } });
    expect(statuses.at(-1)).toBe("live");

    // the lead before the grant's exp: the next ticket is asked, and the
    // client presents it from then on — the live stream is left alone
    await vi.advanceTimersByTimeAsync(600_000 - TICKET_RENEW_LEAD_MS - 1);
    expect(door.calls.filter((call) => call.method === "index.openTicket")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(door.calls.filter((call) => call.method === "index.openTicket")).toHaveLength(2);
    await session.timelineEntry("s1", "t1");
    expect(rest.reads.at(-1)).toEqual({
      url: "http://127.0.0.1:52811/api/sessions/s1/timeline/t1",
      authorization: "Rosetta-Grant g2",
    });
    expect(FakeSocket.opened).toHaveLength(1);

    // the next renewal names ANOTHER origin (a daemon restarted on a new port):
    // the same client repoints — its stream reconnects there with the new grant
    await vi.advanceTimersByTimeAsync(600_000);
    expect(door.calls.filter((call) => call.method === "index.openTicket")).toHaveLength(3);
    const moved = FakeSocket.opened.at(-1);
    expect(moved?.url).toBe("ws://127.0.0.1:52999/ws/sessions/s1");
    expect(moved?.protocols).toEqual(["rosetta", "rosetta.grant.g3"]);
    await session.timelineEntry("s1", "t1");
    expect(rest.reads.at(-1)?.url.startsWith("http://127.0.0.1:52999/")).toBe(true);
    port.dispose();
  });

  it("a stream that drops after it was live asks for a fresh grant at once — the retry only carries it", async () => {
    vi.useFakeTimers({ now: 5_000_000 });
    FakeSocket.opened = [];
    const tickets = [
      ticket(41000, "g1", 5_000_000 + 600_000),
      ticket(41001, "g2", 5_000_000 + 600_000),
    ];
    const door = client({ "index.openTicket": () => tickets.shift() });
    const port = sessionPortOver(door, {
      WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
      fetchFn: rosettadFetch().fetchFn,
    });
    const session = await port.open("s1");
    session.subscribeSession("s1", {});
    const socket = FakeSocket.opened[0];
    socket?.serve({ frame: "hello", protocol_version: PROTOCOL_VERSION, stamp: null });
    socket?.serve({ frame: "caught_up", stamp: { epoch: 1, seq: 0 } });
    socket?.drop();
    await vi.advanceTimersByTimeAsync(0);
    expect(door.calls.filter((call) => call.method === "index.openTicket")).toHaveLength(2);
    // the restarted daemon's origin: the stream is there with the new grant
    const again = FakeSocket.opened.at(-1);
    expect(again?.url).toBe("ws://127.0.0.1:41001/ws/sessions/s1");
    expect(again?.protocols).toEqual(["rosetta", "rosetta.grant.g2"]);
    port.dispose();
  });

  it("a read rosettad refuses renews the grant once and is asked again", async () => {
    const tickets = [
      ticket(42000, "g1", Date.now() + 600_000),
      ticket(42000, "g2", Date.now() + 600_000),
    ];
    const door = client({ "index.openTicket": () => tickets.shift() });
    const rest = rosettadFetch(new Set(["/api/sessions/s1/timeline/t1"]));
    const port = sessionPortOver(door, { fetchFn: rest.fetchFn });
    const session = await port.open("s1");
    await expect(session.timelineEntry("s1", "t1")).resolves.toMatchObject({ timeline_id: "t1" });
    expect(rest.reads.map((read) => read.authorization)).toEqual([
      "Rosetta-Grant g1",
      "Rosetta-Grant g2",
    ]);
    port.dispose();
  });

  it("answers a recorded file with its honest refusal — a grant never opens the live-file read (RO-13)", async () => {
    const door = client({ "index.openTicket": () => ticket(43000, "g1", Date.now() + 600_000) });
    const port = sessionPortOver(door, { fetchFn: rosettadFetch().fetchFn });
    const session = await port.open("s1");
    await expect(session.readFileTarget("s1", "t1", 0)).rejects.toThrow(FILE_TARGET_REFUSAL);
    port.dispose();
  });

  it("an open refused by fieldd rejects in the room's words", async () => {
    const door = client({
      "index.openTicket": () => {
        throw Object.assign(new Error("the direct plane is off"), {
          kind: "UNAVAILABLE",
          retryable: false,
          details: { service: "index", state: "direct-plane-off" },
        });
      },
    });
    const port = sessionPortOver(door);
    await expect(port.open("s1")).rejects.toThrow(
      "This desktop has the direct plane switched off — its transcripts can't be read here",
    );
  });
});

/* ── the asset cache ───────────────────────────────────────────────────── */

function asset(digest: string): AssetRef {
  return { url: `/api/assets/${digest}.webp`, digest, media_type: "image/webp", byte_len: 3 };
}

describe("the asset source (AR-8c, AR-D40 (a))", () => {
  it("reads an image with the grant into an object URL, bounded: the oldest is revoked, a hit is kept", async () => {
    const rest = rosettadFetch();
    const rosetta = new RosettaClient({
      baseUrl: "http://127.0.0.1:44000",
      credential: { kind: "grant", grant: "g1" },
      fetchFn: rest.fetchFn,
    });
    let made = 0;
    const revoked: string[] = [];
    const assets = assetSourceOver(
      { anyClient: () => rosetta },
      {
        limit: 2,
        createObjectURL: () => {
          made += 1;
          return `blob:history/${made}`;
        },
        revokeObjectURL: (url) => revoked.push(url),
      },
    );
    expect(await assets.imageAssetUrl(asset("a"), "full")).toBe("blob:history/1");
    expect(rest.reads[0]).toEqual({
      url: "http://127.0.0.1:44000/api/assets/a.webp",
      authorization: "Rosetta-Grant g1",
    });
    expect(await assets.imageAssetUrl(asset("b"), "full")).toBe("blob:history/2");
    // a hit answers at once and becomes the newest
    expect(assets.imageAssetUrl(asset("a"), "full")).toBe("blob:history/1");
    expect(await assets.imageAssetUrl(asset("c"), "full")).toBe("blob:history/3");
    expect(revoked).toEqual(["blob:history/2"]);
    expect(assets.size).toBe(2);
    // a rendition the timeline does not name is asked by recipe, as rosetta's
    // own address spells it
    await assets.imageAssetUrl(asset("d"), "tile");
    expect(rest.reads.at(-1)?.url).toBe("http://127.0.0.1:44000/api/assets/d.webp?image=tile&v=1");
    assets.dispose();
    expect(revoked.sort()).toEqual([
      "blob:history/1",
      "blob:history/2",
      "blob:history/3",
      "blob:history/4",
    ]);
    expect(assets.size).toBe(0);
  });

  it("keeps no failure — the next ask reads again — and answers null with no session open", async () => {
    let fail = true;
    const rosetta = new RosettaClient({
      baseUrl: "http://127.0.0.1:45000",
      fetchFn: (async () =>
        fail
          ? new Response("", {
              status: 500,
              headers: { "x-rosetta-protocol-version": String(PROTOCOL_VERSION) },
            })
          : new Response(new Uint8Array([9]), {
              status: 200,
              headers: { "x-rosetta-protocol-version": String(PROTOCOL_VERSION) },
            })) as typeof fetch,
    });
    const assets = assetSourceOver(
      { anyClient: () => rosetta },
      { createObjectURL: () => "blob:ok", revokeObjectURL: () => undefined },
    );
    expect(await assets.imageAssetUrl(asset("x"), "full")).toBeNull();
    fail = false;
    expect(await assets.imageAssetUrl(asset("x"), "full")).toBe("blob:ok");
    expect(assetSourceOver({ anyClient: () => null }).imageAssetUrl(asset("y"), "full")).toBeNull();
    expect(assets.attachmentAssetUrl(asset("x"))).toBeNull();
  });
});
