// @vitest-environment node
/**
 * THE ATTRIBUTION WALK (AR-5b, the review's probe made a row).
 *
 * rosetta widens each named root to its delegated children, so a search's
 * hits arrive from sessions the question never named — the walk from a hit to
 * the root a reader navigates to is the ORDINARY path. A flat budget of 32
 * sequential lookups dropped a fifth of a 40-agent board's matches, and an
 * unresolved hit claimed to BE its own root (a subagent transcript read as
 * top-level). The service is driven directly over a stub daemon here: what is
 * asserted is the count of hits out, the root each one names, and what a walk
 * that cannot finish says.
 */

import { describe, expect, it } from "vitest";
import { type EnrollmentStore, IndexService } from "../src/agent-index";
import type { RosettadSupervisor } from "../src/rosettad-supervisor";

const PROTOCOL = 20;

interface Row {
  id: string;
  native_session_id: string;
  parent_session_id: string | null;
  root_session_id: string;
  title: string;
}

/** `count` roots, each with one delegated child; the hits all live in the children. */
function board(count: number): { rows: Row[]; hits: Record<string, unknown>[] } {
  const rows: Row[] = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({
      id: `s${i}`,
      native_session_id: `nat-${i}`,
      parent_session_id: null,
      root_session_id: `s${i}`,
      title: `Root ${i}`,
    });
    rows.push({
      id: `c${i}`,
      native_session_id: `natc-${i}`,
      parent_session_id: `s${i}`,
      root_session_id: `s${i}`,
      title: `Child ${i}`,
    });
  }
  const hits = rows
    .filter((row) => row.parent_session_id !== null)
    .map((row, n) => ({
      timeline_id: `t${n}`,
      session_id: row.id,
      kind: "agent",
      at: 1000 + n,
      snippet: "[needle] here",
    }));
  return { rows, hits };
}

function full(row: Row): Record<string, unknown> {
  return {
    ...row,
    runtime_id: "rt",
    project_id: null,
    cwd: null,
    delegation: null,
    role: row.parent_session_id === null ? "main" : "sub",
    summary: null,
    started_at: 1,
    updated_at: 2,
    activity: { first_at: 1, last_at: 2 },
    stream_state: "indexed",
  };
}

function daemon(
  rows: Row[],
  hits: Record<string, unknown>[],
  options: { rowsAnswer?: boolean } = {},
) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const asked: string[] = [];
  const headers = {
    "x-rosetta-protocol-version": String(PROTOCOL),
    "content-type": "application/json",
  };
  const ok = (body: unknown): Response =>
    new Response(JSON.stringify(body), { status: 200, headers });
  const fetchFn = (async (input: string | URL | Request) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    asked.push(url.pathname);
    if (url.pathname === "/api/search")
      return ok({ state: { readiness: "ready", progress: null }, hits });
    if (url.pathname === "/api/sessions") {
      const wanted = (url.searchParams.get("native_session_id") ?? "").split(",");
      return ok({
        sessions: rows.filter((row) => wanted.includes(row.native_session_id)).map(full),
      });
    }
    if (url.pathname.startsWith("/api/sessions/")) {
      if (options.rowsAnswer === false) return new Response("{}", { status: 404, headers });
      const row = byId.get(decodeURIComponent(url.pathname.slice("/api/sessions/".length)));
      return row ? ok({ session: full(row) }) : new Response("{}", { status: 404, headers });
    }
    return new Response("{}", { status: 404, headers });
  }) as unknown as typeof fetch;
  const service = new IndexService({
    supervisor: {
      health: () => ({ phase: "ready" }),
      state: () => ({ origin: "http://127.0.0.1:1", phase: "ready" }),
    } as unknown as RosettadSupervisor,
    store: {
      snapshot: () => ({ enabled_kinds: [] }),
      summary: () => ({}),
    } as unknown as EnrollmentStore,
    expectedProtocolVersion: PROTOCOL,
    fetchFn,
  });
  const lookups = (): number => asked.filter((path) => path.startsWith("/api/sessions/")).length;
  return { service, asked, lookups };
}

describe("the attribution walk (AR-5b)", () => {
  it("resolves every child's root in a scoped search: 40 hits in, 40 out, none dropped", async () => {
    const { rows, hits } = board(40);
    const { service, lookups } = daemon(rows, hits);
    const result = await service.search({
      q: "needle",
      nativeSessionIds: rows
        .filter((row) => row.parent_session_id === null)
        .map((row) => row.native_session_id),
    });
    expect(result.answered).toBe(true);
    expect(result.hits).toHaveLength(40);
    expect(result.clipped).toBe(false);
    for (const hit of result.hits) {
      expect(hit.rootSessionId).toBe(hit.sessionId.replace("c", "s"));
      expect(hit.nativeSessionId).toBe(hit.sessionId.replace("c", "nat-"));
    }
    // the roots came with the scope's own lookup; only the children were walked
    expect(lookups()).toBe(40);
  });

  it("attributes each hit of an UNSCOPED search to its real root, never to itself", async () => {
    const { rows, hits } = board(40);
    const { service, lookups } = daemon(rows, hits);
    const result = await service.search({ q: "needle" });
    expect(result.hits).toHaveLength(40);
    expect(result.clipped).toBe(false);
    expect(result.hits.filter((hit) => hit.rootSessionId === hit.sessionId)).toEqual([]);
    for (const hit of result.hits) expect(hit.title).toBe(`Root ${hit.sessionId.slice(1)}`);
    // a row and a root per child, in flights — never one per hit in sequence
    expect(lookups()).toBe(80);
  });

  it("a walk the index cannot answer clips the answer and carries NO root — never the hit's own id", async () => {
    const { rows, hits } = board(5);
    const { service } = daemon(rows, hits, { rowsAnswer: false });
    const open = await service.search({ q: "needle" });
    expect(open.answered).toBe(true);
    expect(open.clipped).toBe(true);
    expect(open.hits).toHaveLength(5);
    for (const hit of open.hits) expect(hit.rootSessionId).toBeUndefined();
    // and a scoped question never answers outside what it can attribute
    const scoped = await service.search({
      q: "needle",
      nativeSessionIds: rows
        .filter((row) => row.parent_session_id === null)
        .map((row) => row.native_session_id),
    });
    expect(scoped.clipped).toBe(true);
    expect(scoped.hits).toEqual([]);
  });
});
