// TL (docket v9, RULED 2026-10-09) — Godview's timeline reads the past: the
// record's door (`index.activity`) and the backend's (`agent.recordedLanes`).
// What the shapes promise, beyond each fixture parsing: a window of at most a
// day (T2), the record's open words carried through (the tolerant reader), and
// a past that never says blocked or unseen (T1).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  AgentRecordedLanesParams,
  AgentRecordedLanesResult,
  INDEX_ACTIVITY,
  IndexActivityParams,
  IndexActivityResponse,
  IndexActivityResult,
  METHODS,
  MonitorPastSpan,
} from "../src/index";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
const DAY = INDEX_ACTIVITY.MAX_WINDOW_MS;
const UNTIL = 1_791_547_200_000;

describe("the window is the view's day (T2)", () => {
  for (const [name, schema] of [
    ["index.activity", IndexActivityParams],
    ["agent.recordedLanes", AgentRecordedLanesParams],
  ] as const) {
    it(`${name} admits a day and no more, and refuses a window that holds no time`, () => {
      expect(schema.safeParse({ sinceMs: UNTIL - DAY, untilMs: UNTIL }).success).toBe(true);
      expect(schema.safeParse({ sinceMs: UNTIL - DAY - 1, untilMs: UNTIL }).success).toBe(false);
      expect(schema.safeParse({ sinceMs: UNTIL, untilMs: UNTIL }).success).toBe(false);
      expect(schema.safeParse({ sinceMs: UNTIL, untilMs: UNTIL - 1 }).success).toBe(false);
      expect(schema.safeParse({ sinceMs: -1, untilMs: UNTIL }).success).toBe(false);
      // a device routes it (B-D4: shaped per desktop)
      expect(schema.safeParse({ sinceMs: 0, untilMs: DAY, device: "01JPEER" }).success).toBe(true);
    });
  }

  it("bounds the silence cut an ask may name, and the sessions it may narrow to", () => {
    const at = { sinceMs: UNTIL - DAY, untilMs: UNTIL };
    expect(
      IndexActivityParams.safeParse({ ...at, silenceMs: INDEX_ACTIVITY.SILENCE_MS }).success,
    ).toBe(true);
    expect(IndexActivityParams.safeParse({ ...at, silenceMs: 59_999 }).success).toBe(false);
    expect(IndexActivityParams.safeParse({ ...at, sessions: [] }).success).toBe(false);
    const many = Array.from({ length: INDEX_ACTIVITY.MAX_SESSIONS + 1 }, (_, i) => `s${i}`);
    expect(IndexActivityParams.safeParse({ ...at, sessions: many }).success).toBe(false);
    expect(INDEX_ACTIVITY.SILENCE_MS).toBe(15 * 60_000);
  });
});

describe("the record's words ride through; the past never says blocked or unseen", () => {
  it("reads rosetta's own protocol-27 body: a root session, its turns and the gaps rosetta cut", () => {
    const body = IndexActivityResponse.parse(fixture("index-activity-response.rosetta-27.json"));
    expect(body.gap_ms).toBe(INDEX_ACTIVITY.SILENCE_MS);
    const [entry] = body.sessions;
    expect(entry?.session.parent_session_id).toBeNull();
    expect(entry?.turns.map((turn) => [turn.kind, turn.gaps.length])).toEqual([
      ["human_turn", 1],
      ["agent_cycle", 0],
    ]);
    expect(entry?.turns_withheld).toBe(false);
    // a newer group kind rides through the reader
    expect(
      IndexActivityResponse.safeParse({
        ...body,
        sessions: [{ ...entry, turns: [{ ...entry?.turns[0], kind: "a_newer_kind" }] }],
      }).success,
    ).toBe(true);
  });

  it("carries a group kind and a field a newer side added", () => {
    const turns = IndexActivityResult.parse(fixture("index-activity.turns.json"));
    expect(turns.sessions[0]?.turns?.map((turn) => turn.kind)).toEqual([
      "human_turn",
      "human_turn",
      "a_group_kind_from_a_newer_rosetta",
    ]);
    const bounds = IndexActivityResult.parse(fixture("index-activity.bounds.json"));
    expect(bounds.sessions.map((session) => session.provider)).toEqual(["claude", undefined]);
    expect(bounds.sessions[1]).toHaveProperty("aFieldFromANewerPeer", true);
  });

  it("a span is worked, quiet, unrecorded or the floor's active band — nothing else", () => {
    for (const kind of ["worked", "quiet", "unrecorded", "active"])
      expect(MonitorPastSpan.safeParse({ kind, from: 0, to: 1 }).success, kind).toBe(true);
    for (const kind of ["blocked", "unseen", "idle", "working"])
      expect(MonitorPastSpan.safeParse({ kind, from: 0, to: 1 }).success, kind).toBe(false);
    const floor = AgentRecordedLanesResult.parse(fixture("agent-recorded-lanes.floor.json"));
    expect(floor.ended.flatMap((lane) => lane.spans.map((span) => span.kind))).toEqual(["active"]);
  });

  it("both doors ride the record's consent and are asked where the record lives", () => {
    const rows = METHODS.filter(
      (m) => m.method === "index.activity" || m.method === "agent.recordedLanes",
    ).map((m) => [m.method, m.scope, m.locality, m.idempotent]);
    expect(rows).toEqual([
      ["index.activity", "index.search", "federate", true],
      ["agent.recordedLanes", "index.search", "federate", true],
    ]);
    expect(METHODS.some((m) => m.method === "agent.history")).toBe(false);
  });
});
