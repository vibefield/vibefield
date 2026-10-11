import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  IndexSearchHit,
  IndexSearchParams,
  IndexSearchReadiness,
  IndexSearchResponse,
  IndexSearchResult,
  IndexSession,
  IndexSessionResponse,
  IndexSessionRow,
  IndexSessionsParams,
  IndexSessionsResult,
  IndexStatus,
} from "../src/agent-index";

// AR-5e — the find sheet's doors (`index.sessions`, `index.search`), both
// sides of the seam: what rosetta answers on `/api/search` and what fieldd
// answers over it. The wire fixture is transcribed from the reference's
// committed protocol-20 golden (its digest and rosetta revision are in the
// file's own `//` note), so a wire change upstream reds this file rather than
// surfacing as an empty sheet.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as unknown;

describe("rosetta's /api/search body, as fieldd reads it", () => {
  it("parses the protocol-20 golden and carries the columns fieldd does not read", () => {
    const parsed = IndexSearchResponse.parse(fixture("index-search.rosetta-20.json"));
    expect(parsed.state.readiness).toBe("catching-up");
    expect(parsed.state.progress).toBeNull();
    expect(parsed.hits).toHaveLength(1);
    expect(parsed.hits[0]).toMatchObject({
      timeline_id: "t1",
      session_id: "s1",
      kind: "user",
      at: 1,
      snippet: "[needle] in a haystack",
      // diagnostic, and deliberately unread: it rides through the reader
      score: -1.5,
    });
    // the projection's identity is rosetta's business and rides through too
    expect(parsed.state).toMatchObject({ projection_epoch: "epoch-1", revision: 42 });
  });

  it("a readiness this build has never heard of folds to `unknown` — never believed as ready", () => {
    // the WIRE keeps the word (a tolerant reader never refuses a body over it)
    const parsed = IndexSearchResponse.parse({ state: { readiness: "hyperspace" }, hits: [] });
    expect(parsed.state.readiness).toBe("hyperspace");
    // the PROJECTION folds it to the one answer that does not answer
    expect(IndexSearchReadiness.parse("hyperspace")).toBe("unknown");
    expect(IndexSearchReadiness.parse(undefined)).toBe("unknown");
    expect(IndexSearchReadiness.parse("catching-up")).toBe("catching-up");
  });

  it("refuses a hit that names no row, and a stamp that is not finite", () => {
    expect(
      IndexSearchResponse.safeParse({
        state: { readiness: "ready" },
        hits: [{ session_id: "s1", kind: "user", snippet: "x" }],
      }).success,
    ).toBe(false);
    const infinite = JSON.parse('{"at":1e999}') as { at: number };
    expect(Number.isFinite(infinite.at)).toBe(false);
    expect(
      IndexSearchResponse.safeParse({
        state: { readiness: "ready" },
        hits: [
          { timeline_id: "t1", session_id: "s1", kind: "user", snippet: "x", at: infinite.at },
        ],
      }).success,
    ).toBe(false);
    // a hit the source gave no stamp for is an answer, not a refusal
    expect(
      IndexSearchResponse.parse({
        state: { readiness: "ready" },
        hits: [{ timeline_id: "t1", session_id: "s1", kind: "user", snippet: "x", at: null }],
      }).hits[0]?.at,
    ).toBeNull();
  });
});

describe("the doors' own answers (the projections a renderer reads)", () => {
  it("the answered fixture carries the hit attributed to its navigable root", () => {
    const result = IndexSearchResult.parse(fixture("index-search-result.valid.json"));
    expect(result.answered).toBe(true);
    expect(result.clipped).toBe(false);
    expect(result.state).toMatchObject({ readiness: "catching-up", canonicalReady: true });
    expect(result.hits[0]).toMatchObject({
      sessionId: "s1",
      rootSessionId: "s0",
      nativeSessionId: "native-s0",
      title: "Named",
      timelineId: "t1",
      kind: "user",
      snippet: "[needle] in a haystack",
    });
  });

  it("the building fixture is an answer WITHOUT an answer: no hits, and never `no matches`", () => {
    const result = IndexSearchResult.parse(fixture("index-search-result.building.json"));
    expect(result.answered).toBe(false);
    expect(result.hits).toEqual([]);
    expect(result.state.readiness).toBe("building");
    expect(result.state.progress).toEqual({ done: 1284, total: 5912 });
    expect(result.state.detail).toMatch(/building/);
  });

  it("a hit may carry no join key at all — an absent native id is honest, never an invented one", () => {
    const orphan = IndexSearchHit.parse({
      sessionId: "s9",
      rootSessionId: "s9",
      timelineId: "t9",
      kind: "agent",
      snippet: "[needle]",
    });
    expect(orphan.nativeSessionId).toBeUndefined();
    expect(orphan.title).toBeUndefined();
  });

  it("the Peek's Everything answer carries each hit's ROOT facts — folder, project, agent — and none where the root is unknown", () => {
    const result = IndexSearchResult.parse(fixture("index-search-result.everything.json"));
    expect(result.answered).toBe(true);
    expect(result.clipped).toBe(true);
    const [first, second, outside, orphan] = result.hits;
    expect(first).toMatchObject({
      rootSessionId: "ses-7c1e",
      cwd: "/Users/james/Projects/rosetta",
      projectId: "p-4f1c2a9e",
      provider: "codex",
    });
    // two lines of one root carry the same root's facts
    expect(second).toMatchObject({ rootSessionId: "ses-7c1e", projectId: "p-4f1c2a9e" });
    // a root outside any project: a folder and an agent, no project id
    expect(outside?.projectId).toBeUndefined();
    expect(outside).toMatchObject({ cwd: "/Users/james/scratch", provider: "claude" });
    // no root, so no root facts — never the hit's own session's in their place
    expect(orphan?.rootSessionId).toBeUndefined();
    expect(orphan?.cwd).toBeUndefined();
    expect(orphan?.projectId).toBeUndefined();
    expect(orphan?.provider).toBeUndefined();
  });

  it("the root facts are optional and bounded like the session listing's columns", () => {
    const hit = { sessionId: "s1", timelineId: "t1", kind: "user", snippet: "[x]" };
    expect(IndexSearchHit.safeParse({ ...hit, projectId: "" }).success).toBe(false);
    expect(IndexSearchHit.safeParse({ ...hit, provider: "not a provider id" }).success).toBe(false);
    expect(IndexSearchHit.safeParse({ ...hit, cwd: "/w/one", provider: "claude" }).success).toBe(
      true,
    );
  });
});

describe("the params the doors admit", () => {
  it("index.sessions: at least one id, at most rosetta's 256, each a bounded label", () => {
    expect(IndexSessionsParams.safeParse({ nativeSessionIds: ["nat-1"] }).success).toBe(true);
    expect(IndexSessionsParams.safeParse({ nativeSessionIds: [] }).success).toBe(false);
    expect(
      IndexSessionsParams.safeParse({
        nativeSessionIds: Array.from({ length: 257 }, (_, i) => `nat-${i}`),
      }).success,
    ).toBe(false);
    expect(IndexSessionsParams.safeParse({ nativeSessionIds: [""] }).success).toBe(false);
    expect(IndexSessionsParams.safeParse({ nativeSessionIds: ["x".repeat(257)] }).success).toBe(
      false,
    );
  });

  it("index.search: a bounded plain-text query, an optional scope, and only the kinds rosetta indexes", () => {
    const parsed = IndexSearchParams.parse({ q: "needle" });
    expect(parsed.nativeSessionIds).toBeUndefined();
    expect(parsed.prefix).toBeUndefined(); // the SERVICE decides the default
    expect(IndexSearchParams.safeParse({ q: "" }).success).toBe(false);
    expect(IndexSearchParams.safeParse({ q: "x".repeat(513) }).success).toBe(false);
    expect(IndexSearchParams.safeParse({ q: "needle", limit: 0 }).success).toBe(false);
    expect(IndexSearchParams.safeParse({ q: "needle", limit: 1001 }).success).toBe(false);
    expect(IndexSearchParams.safeParse({ q: "needle", afterMs: -1 }).success).toBe(false);
    expect(IndexSearchParams.safeParse({ q: "needle", kind: "user" }).success).toBe(true);
    expect(IndexSearchParams.safeParse({ q: "needle", kind: "agent" }).success).toBe(true);
    // rosetta answers 400 for any other kind while tool activity is unindexed:
    // the door refuses at its edge rather than passing a refusal on
    expect(IndexSearchParams.safeParse({ q: "needle", kind: "tool_use" }).success).toBe(false);
  });
});

describe("the session rows the facts lane displays (AR-5e extends AR-4's reading)", () => {
  // rosetta's own `SessionRow`, whole: the display columns are read now, and
  // every one of them may be null — none decides anything.
  const wire = {
    id: "s1",
    native_session_id: "native-s1",
    runtime_id: "rt1",
    project_id: "p1",
    cwd: "/w/rosetta",
    parent_session_id: "s0",
    delegation: null,
    root_session_id: "s0",
    role: "subagent",
    title: "Named",
    summary: "A summary",
    started_at: 10000,
    updated_at: 20000,
    activity: { first_at: 11000, last_at: 19000 },
    stream_state: "streaming",
  };

  it("reads title, summary, cwd, updated_at and the parent, and keeps the rest", () => {
    const row = IndexSessionRow.parse(wire);
    expect(row).toMatchObject({
      title: "Named",
      summary: "A summary",
      cwd: "/w/rosetta",
      updated_at: 20000,
      parent_session_id: "s0",
      role: "subagent",
    });
    expect(IndexSessionResponse.parse({ session: wire }).session.id).toBe("s1");
  });

  it("a null in any display column is read as absent, never as a refusal", () => {
    const row = IndexSessionRow.parse({
      ...wire,
      title: null,
      summary: null,
      cwd: null,
      parent_session_id: null,
    });
    expect(row.title).toBeNull();
    // and a row that simply omits them still satisfies the identity columns
    const { title, summary, cwd, updated_at, parent_session_id, ...bare } = wire;
    expect(`${title}${summary}${cwd}${updated_at}${parent_session_id}`).toBeTruthy();
    expect(IndexSessionRow.parse(bare).id).toBe("s1");
  });

  it("the projection is camelCase and folds the evidence; an unread session is simply absent", () => {
    const rows = IndexSessionsResult.parse({
      rows: [
        {
          sessionId: "s1",
          nativeSessionId: "native-s1",
          rootSessionId: "s0",
          title: "Named",
          cwd: "/w/rosetta",
          updatedAt: 20000,
          activity: { firstAt: 11000, lastAt: 19000 },
          streamState: "streaming",
        },
      ],
    });
    expect(rows.rows[0]?.activity).toEqual({ firstAt: 11000, lastAt: 19000 });
    // no evidence is an explicit null, the same answer the AR-4 reader gives
    expect(
      IndexSession.parse({
        sessionId: "s1",
        nativeSessionId: "native-s1",
        rootSessionId: "s1",
        activity: null,
        streamState: "pending",
      }).activity,
    ).toBeNull();
    // …and it is never simply missing
    expect(
      IndexSession.safeParse({
        sessionId: "s1",
        nativeSessionId: "native-s1",
        rootSessionId: "s1",
        streamState: "pending",
      }).success,
    ).toBe(false);
  });
});

describe("index.status grows the find sheet's foot", () => {
  const base = {
    phase: "live",
    rosettad: { phase: "ready", detail: null, pid: 1, protocolVersion: 20 },
    enrollment: { enabledKinds: [], runtimes: [], retired: [], updatedAt: null },
    runtimes: [],
  };

  it("carries reachability, the generation's capabilities and the projection's readiness", () => {
    const status = IndexStatus.parse({
      ...base,
      search: {
        reachable: true,
        capabilities: { sessionScope: true, prefix: true },
        canonicalReady: true,
        readiness: "ready",
      },
    });
    expect(status.search).toMatchObject({
      reachable: true,
      capabilities: { sessionScope: true, prefix: true },
      readiness: "ready",
    });
    // the protocol version is NOT said twice: AR-1's projection already has it
    expect(status.rosettad.protocolVersion).toBe(20);
  });

  it("an answer from before AR-5e still parses, and an unheard-of readiness folds", () => {
    expect(IndexStatus.parse(base).search).toBeUndefined();
    const folded = IndexStatus.parse({
      ...base,
      search: {
        reachable: true,
        capabilities: { sessionScope: true, prefix: true },
        readiness: "hyperspace",
      },
    });
    expect(folded.search?.readiness).toBe("unknown");
  });
});
