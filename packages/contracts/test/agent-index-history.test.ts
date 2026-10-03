// AR-8b (thinking-ar-history-room.md §3) — the History room's reads, both
// sides of each seam: what rosetta answers on its project and session routes
// (transcribed from the pinned checkout's protocol-26 wire golden; revision and
// digest in each file's `//` note) and what the three new doors answer over it;
// and the direct plane's LOOPBACK set, the half of the ticket a window on this
// desktop is minted today.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  IndexCalendarDay,
  IndexContributionResponse,
  IndexDayUsageResponse,
  IndexEndpointSet,
  IndexHeatmapResponse,
  IndexOpenTicket,
  IndexProjectDayParams,
  IndexProjectDayResult,
  IndexProjectParams,
  IndexProjectResult,
  IndexSessionParams,
  IndexSessionResponse,
  IndexSessionResult,
  IndexTicketEndpointSet,
  IndexTicketUnavailableDetails,
  IndexUsageResponse,
  indexEndpointsFor,
  RemoteIndexEndpointSet,
} from "../src/agent-index";
import { ErrorData } from "../src/errors";
import { KEYED_FORWARD_METHODS } from "../src/forwarding";
import { METHODS, reachableFromTailnet } from "../src/methods";
import { INDEX_TICKET, PEER_FIELDD_SCOPES, TAILNET_SCOPES } from "../src/registries";
import { RemoteEndpointSet } from "../src/remote-endpoints";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as Record<string, unknown>;

describe("rosetta's project aggregates, as fieldd reads them (protocol 26)", () => {
  it("parses the four goldens and carries the columns fieldd does not read", () => {
    const heat = IndexHeatmapResponse.parse(fixture("index-heatmap.rosetta-26.json"));
    expect(heat.days).toHaveLength(1);
    // an unbilled day is null, and stays null — never coerced to zero
    expect(heat.days[0]).toMatchObject({ day: "2026-08-26", tokens: 123, billed_micro_usd: null });
    const usage = IndexUsageResponse.parse(fixture("index-usage.rosetta-26.json"));
    expect(usage.models.map((m) => m.model)).toEqual(["claude-opus-5", "unknown"]);
    // the model days sum back to the heatmap's figure exactly (rosetta's rule)
    expect(usage.models.reduce((sum, m) => sum + m.tokens, 0)).toBe(heat.days[0]?.tokens);
    expect(usage.hours[0]).toMatchObject({ hour: 15, cost_micro_usd: null });
    const contribution = IndexContributionResponse.parse(
      fixture("index-contribution.rosetta-26.json"),
    );
    expect(contribution.rows[0]).toMatchObject({ session_id: "s1", project_id: "p1", loc: 30 });
    const day = IndexDayUsageResponse.parse(fixture("index-day-usage.rosetta-26.json"));
    expect(day).toMatchObject({ day: "2026-09-30", models: [{ hour: 16, tokens: 123 }] });
    // the tolerant reader's other half: a column fieldd never reads rides through
    const wider = IndexHeatmapResponse.parse({
      days: [{ ...heat.days[0], someday: "a new column" }],
      cursor: "x",
    });
    expect(wider.days[0]).toMatchObject({ someday: "a new column" });
    expect(wider).toMatchObject({ cursor: "x" });
  });

  it("refuses a figure that is missing, infinite or not a number — a body fieldd cannot vouch for", () => {
    const [row] = IndexHeatmapResponse.parse(fixture("index-heatmap.rosetta-26.json")).days;
    const { tokens: _t, ...noTokens } = row as Record<string, unknown>;
    expect(IndexHeatmapResponse.safeParse({ days: [noTokens] }).success).toBe(false);
    expect(
      IndexHeatmapResponse.safeParse({ days: [{ ...row, tokens: Number.POSITIVE_INFINITY }] })
        .success,
    ).toBe(false);
    expect(IndexHeatmapResponse.safeParse({ days: [{ ...row, tokens: "123" }] }).success).toBe(
      false,
    );
    // a cost rosetta could not price is ABSENT or null; both read as "unpriced"
    const { cost_micro_usd: _c, ...noCost } = row as Record<string, unknown>;
    expect(IndexHeatmapResponse.safeParse({ days: [noCost] }).success).toBe(true);
    // an hour outside the day is no hour
    expect(
      IndexDayUsageResponse.safeParse({
        day: "2026-09-30",
        models: [{ hour: 24, model: "m", tokens: 1 }],
      }).success,
    ).toBe(false);
  });

  it("reads rosetta's session row for the header door", () => {
    const parsed = IndexSessionResponse.parse(fixture("index-session-response.rosetta-26.json"));
    expect(parsed.session).toMatchObject({
      id: "s1",
      native_session_id: "native-s1",
      root_session_id: "s0",
      parent_session_id: "s0",
      project_id: "p1",
      started_at: 10000,
      // rosetta's own columns fieldd does not read ride through
      role: "subagent",
      delegation: null,
    });
  });
});

describe("the three doors' asks and answers", () => {
  it("parses each golden", () => {
    expect(IndexSessionParams.parse(fixture("index-session-params.valid.json"))).toEqual({
      sessionId: "s1",
      device: "dev-01HQ8ZK4M7",
    });
    const header = IndexSessionResult.parse(fixture("index-session.valid.json")).session;
    expect(header).toMatchObject({
      sessionId: "s1",
      rootSessionId: "s0",
      parentSessionId: "s0",
      projectId: "p1",
      provider: "claude",
      project: { id: "p1", name: "rosetta" },
      activity: { firstAt: 11000, lastAt: 19000 },
    });
    const project = IndexProjectResult.parse(fixture("index-project.valid.json"));
    expect(project.clipped).toBe(false);
    expect(project.heatmap[0]?.billedMicroUsd).toBeNull();
    expect(project.usage.models).toHaveLength(2);
    expect(project.contribution[0]).toMatchObject({ sessionId: "s1", projectId: "p1" });
    expect(IndexProjectParams.parse(fixture("index-project-params.valid.json"))).toEqual({
      projectId: "p1",
      sinceMs: 1756166400000,
      offsetMinutes: 120,
    });
    // rosetta's unassigned bucket is a project id like any other, at a device
    expect(IndexProjectParams.parse(fixture("index-project-params.mesh.json")).projectId).toBe(
      "__rosetta_unassigned__",
    );
    expect(IndexProjectDayResult.parse(fixture("index-project-day.valid.json")).models).toEqual([
      { hour: 16, model: "claude-opus-5-5", tokens: 123 },
    ]);
    expect(IndexProjectDayParams.parse(fixture("index-project-day-params.valid.json")).day).toBe(
      "2026-09-30",
    );
  });

  it("asks only what rosetta answers: a real day, an offset it admits, a bounded id", () => {
    for (const day of ["2026-09-30", "2024-02-29", "0001-01-01"])
      expect(IndexCalendarDay.safeParse(day).success, day).toBe(true);
    for (const day of ["2026-02-30", "2025-02-29", "2026-9-30", "2026-09-30T00:00", "", "today"])
      expect(IndexCalendarDay.safeParse(day).success, day).toBe(false);
    const ask = { projectId: "p1", day: "2026-09-30" };
    expect(IndexProjectDayParams.safeParse({ ...ask, offsetMinutes: 840 }).success).toBe(true);
    expect(IndexProjectDayParams.safeParse({ ...ask, offsetMinutes: -840 }).success).toBe(true);
    expect(IndexProjectDayParams.safeParse({ ...ask, offsetMinutes: 841 }).success).toBe(false);
    expect(IndexProjectDayParams.safeParse({ ...ask, offsetMinutes: 1.5 }).success).toBe(false);
    expect(IndexProjectDayParams.safeParse({ projectId: "p1" }).success).toBe(false);
    expect(IndexProjectParams.safeParse({ projectId: "p1", offsetMinutes: -841 }).success).toBe(
      false,
    );
    expect(IndexProjectParams.safeParse({ projectId: "p1", sinceMs: -1 }).success).toBe(false);
    expect(IndexProjectParams.safeParse({ projectId: "" }).success).toBe(false);
    expect(IndexProjectParams.safeParse({ projectId: "p".repeat(257) }).success).toBe(false);
    expect(IndexSessionParams.safeParse({ sessionId: "" }).success).toBe(false);
    expect(IndexSessionParams.safeParse({ sessionId: "s".repeat(1025) }).success).toBe(false);
  });

  it("are federate reads on index.search — the phone and a peer reach them, nothing keys them", () => {
    for (const method of ["index.session", "index.project", "index.projectDay"]) {
      const def = METHODS.find((m) => m.method === method);
      expect(def, method).toEqual({
        surface: "product",
        method,
        scope: "index.search",
        idempotent: true,
        locality: "federate",
      });
      expect(reachableFromTailnet(def!), method).toBe(true);
      // idempotent: a routed one is never keyed (DS-D15 keys the mints)
      expect(KEYED_FORWARD_METHODS.has(method), method).toBe(false);
    }
    expect(TAILNET_SCOPES).toContain("index.search");
    expect(PEER_FIELDD_SCOPES).toContain("index.search");
  });
});

describe("the direct plane's LOOPBACK set — what a window on this desktop dials (AR-8b)", () => {
  it("composes both legs from rosettad's origin, the id one percent-encoded segment", () => {
    expect(indexEndpointsFor("http://127.0.0.1:52811", "s1")).toEqual({
      sessionUrl: "ws://127.0.0.1:52811/ws/sessions/s1",
      restUrl: "http://127.0.0.1:52811",
    });
    // the supervisor's own normalized spelling carries a trailing slash-free origin;
    // a URL with the root path is the same origin
    expect(indexEndpointsFor("http://127.0.0.1:52811/", "s1")?.restUrl).toBe(
      "http://127.0.0.1:52811",
    );
    const sid = 's"1\\2\u0001/é \u{1f600}';
    const set = indexEndpointsFor("http://127.0.0.1:52811", sid);
    expect(set?.sessionUrl.split("/")).toHaveLength(6);
    expect(
      decodeURIComponent(set?.sessionUrl.slice(set.sessionUrl.lastIndexOf("/") + 1) ?? ""),
    ).toBe(sid);
  });

  it("composes nothing from an origin the supervisor would never accept", () => {
    for (const origin of [
      "http://localhost:52811",
      "http://127.0.0.2:52811",
      "https://127.0.0.1:52811",
      "http://127.0.0.1",
      "http://127.0.0.1:52811/api",
      "http://127.0.0.1:52811/?q=1",
      "http://user@127.0.0.1:52811",
      "http://desk.ts.net:9424",
      "not an origin",
    ]) {
      expect(indexEndpointsFor(origin, "s1"), origin).toBeUndefined();
    }
    expect(indexEndpointsFor("http://127.0.0.1:52811", "")).toBeUndefined();
  });

  it("is disjoint from the tailnet set by host class — the template's reader still refuses it (D36)", () => {
    const local = indexEndpointsFor("http://127.0.0.1:52811", "s1");
    expect(IndexEndpointSet.safeParse(local).success).toBe(true);
    expect(RemoteIndexEndpointSet.safeParse(local).success).toBe(false);
    expect(RemoteEndpointSet.safeParse(local).success).toBe(false);
    const remote = fixture("index-open-ticket.valid.json")["endpoints"];
    expect(IndexEndpointSet.safeParse(remote).success).toBe(false);
    expect(IndexTicketEndpointSet.safeParse(remote).success).toBe(true);
    expect(IndexTicketEndpointSet.safeParse(local).success).toBe(true);
    for (const bad of [
      { sessionUrl: "ws://127.0.0.1:52811/ws/sessions/s1" },
      { sessionUrl: "ws://127.0.0.1:52811/ws/meta", restUrl: "http://127.0.0.1:52811" },
      { sessionUrl: "ws://127.0.0.1:52811/ws/sessions/s1?g=x", restUrl: "http://127.0.0.1:52811" },
      { sessionUrl: "ws://127.0.0.1:52811/ws/sessions/s1", restUrl: "http://127.0.0.1:52811/" },
      { sessionUrl: "ws://127.0.0.1:70000/ws/sessions/s1", restUrl: "http://127.0.0.1:70000" },
      { sessionUrl: "ws://localhost:52811/ws/sessions/s1", restUrl: "http://localhost:52811" },
      // each leg's host is held on its own
      { sessionUrl: "ws://localhost:52811/ws/sessions/s1", restUrl: "http://127.0.0.1:52811" },
      { sessionUrl: "ws://127.0.0.1:52811/ws/sessions/s1", restUrl: "http://[::1]:52811" },
    ]) {
      expect(IndexEndpointSet.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("the local ticket's golden carries the loopback pair beside a REAL rosetta grant", () => {
    const ticket = IndexOpenTicket.parse(fixture("index-open-ticket.local.json"));
    expect(IndexEndpointSet.parse(ticket.endpoints)).toEqual(ticket.endpoints);
    expect(Object.keys(ticket)).toEqual(["device", "endpoints", "grant", "expiresAt"]);
    // rosetta's first valid grant vector (key bytes 00..1f): sid is the URL's
    // session, exp is expiresAt, the scope is read, and the MAC verifies
    const [payloadPart, macPart] = ticket.grant.split(".");
    const payload = Buffer.from(payloadPart ?? "", "base64url");
    const url = (ticket.endpoints as { sessionUrl: string }).sessionUrl;
    expect(JSON.parse(payload.toString("utf8"))).toEqual({
      cid: "fieldd/window-1",
      exp: ticket.expiresAt,
      scope: ["read"],
      sid: decodeURIComponent(url.slice(url.lastIndexOf("/") + 1)),
      v: 1,
    });
    const key = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
    expect(createHmac("sha256", key).update(payload).digest("base64url")).toBe(macPart);
  });

  it("names its two capability refusals; a daemon merely not ready is neither", () => {
    expect(INDEX_TICKET.TTL_MS).toBe(10 * 60 * 1000);
    const off = ErrorData.parse(fixture("error-data.index-direct-plane-off.json"));
    expect(off).toMatchObject({ kind: "UNAVAILABLE", retryable: false });
    expect(IndexTicketUnavailableDetails.parse(off.details)).toEqual({
      service: "index",
      state: INDEX_TICKET.STATE_OFF,
    });
    const unbuilt = ErrorData.parse(fixture("error-data.index-direct-plane-unbuilt.json"));
    expect(IndexTicketUnavailableDetails.parse(unbuilt.details).state).toBe(
      INDEX_TICKET.STATE_UNBUILT,
    );
    expect(
      IndexTicketUnavailableDetails.safeParse({ service: "index", state: "starting" }).success,
    ).toBe(false);
  });
});
