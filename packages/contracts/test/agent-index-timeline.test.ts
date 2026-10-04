// SP-6 (thinking-sync-planes.md §5.4 "until RO-1", SP-D5 (a); thinking-ios-
// history.md H-D2) — one session's transcript over the DOOR, both sides of
// each seam: what rosetta answers on its timeline page and sends on its
// session socket (transcribed from the pinned checkout's protocol-26 wire
// golden; revision and digest in each file's `//` note), and what the page
// door and the tail answer over it in VibeField's spelling.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  IndexSessionSubscribeParams,
  IndexSessionTailDelta,
  IndexSessionTailOpen,
  IndexSessionTailSnapshot,
  IndexTimelineEntryRow,
  IndexTimelineFrameRow,
  IndexTimelinePageResponse,
  IndexTimelineParams,
  IndexTimelineResult,
  IndexTimelineRow,
} from "../src/agent-index";
import { ErrorData } from "../src/errors";
import { KEYED_FORWARD_METHODS } from "../src/forwarding";
import { METHODS, reachableFromTailnet } from "../src/methods";
import {
  INDEX_MESH,
  INDEX_TAILNET_LIMITS,
  INDEX_TIMELINE,
  TAILNET_SCOPES,
} from "../src/registries";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as Record<string, unknown>;

describe("rosetta's timeline page and socket frames, as fieldd reads them (protocol 26)", () => {
  it("parses the page golden: entries oldest first, a cursor to the older page, the watermark", () => {
    const page = IndexTimelinePageResponse.parse(fixture("index-timeline-page.rosetta-26.json"));
    expect(page.entries.map((row) => row.timeline_id)).toEqual(["t1", "team-report-1"]);
    expect(page.entries.map((row) => row.ordinal)).toEqual([7, 9]);
    expect(page.cursor).toContain('"before":7');
    expect(page.watermark).toBe("1.2.3");
    const [tool, collaboration] = page.entries;
    expect(tool?.body.type).toBe("tool_use");
    expect(tool?.group).toMatchObject({ id: "turn-1", kind: "human_turn" });
    expect(tool?.response).toMatchObject({ id: "response-1" });
    expect(tool?.usage).toMatchObject({ input: 10, output: 5 });
    // the cost rosetta could not price stays what it said — never a zero
    expect(tool?.cost).toMatchObject({ status: "unpriced" });
    expect(collaboration?.body.type).toBe("collaboration");
    expect(collaboration?.model).toBeNull();
    // rosetta's own columns fieldd does not read ride through
    expect(tool).toHaveProperty("provenance");
    expect(tool).toHaveProperty("block_index");
  });

  it("refuses a row without its identity, and a stamp that is not a finite number", () => {
    const golden = IndexTimelinePageResponse.parse(fixture("index-timeline-page.rosetta-26.json"))
      .entries[0] as Record<string, unknown>;
    expect(IndexTimelineEntryRow.safeParse({ ...golden, timeline_id: "" }).success).toBe(false);
    expect(IndexTimelineEntryRow.safeParse({ ...golden, ordinal: "7" }).success).toBe(false);
    expect(
      IndexTimelineEntryRow.safeParse({ ...golden, at: Number.POSITIVE_INFINITY }).success,
    ).toBe(false);
    // a body of a kind this build never heard of is a row of that kind
    expect(IndexTimelineEntryRow.safeParse({ ...golden, body: { type: "hologram" } }).success).toBe(
      true,
    );
    // null stamps and models are rosetta's "not stated"
    expect(
      IndexTimelineEntryRow.safeParse({ ...golden, at: null, model: null, usage: null }).success,
    ).toBe(true);
  });

  it("reads every frame the session socket sends, and carries one it does not read by its name", () => {
    const golden = fixture("index-timeline-frames.rosetta-26.json") as {
      frames: unknown[];
      mutations: unknown[];
    };
    const frames = golden.frames.map((frame) => IndexTimelineFrameRow.parse(frame));
    expect(frames.map((frame) => frame.frame)).toEqual([
      "hello",
      "timeline_snapshot",
      "timeline_meta_snapshot",
      "caught_up",
      "collaboration_snapshot",
      "response_runtime",
      "meta_snapshot",
      "mutation",
      "resync",
      "error",
    ]);
    const hello = frames[0];
    expect(hello).toMatchObject({
      frame: "hello",
      protocol_version: 26,
      stamp: { epoch: 9, seq: 3 },
    });
    const snapshot = frames[1];
    if (snapshot?.frame !== "timeline_snapshot") throw new Error("expected the snapshot frame");
    expect(snapshot.entries).toHaveLength(2);
    expect(snapshot.watermark).toBe("1.2.3");
    expect(snapshot.cursor).toBeNull();
    expect(frames[7]).toMatchObject({ frame: "mutation", mutation: { type: "session_swept" } });
    expect(frames[9]).toMatchObject({ frame: "error", error: { code: "internal" } });
    // every mutation kind the socket may carry is tagged by `type`
    expect(golden.mutations.map((mutation) => (mutation as { type: string }).type)).toEqual([
      "message",
      "message",
      "message",
      "tool_updated",
      "usage",
      "session_swept",
      "timeline_meta_changed",
      "session",
      "project",
      "runtime",
    ]);
  });
});

describe("the page door and the tail — asks and answers", () => {
  it("parses each golden, and the answer is the projection of the page", () => {
    expect(IndexTimelineParams.parse(fixture("index-timeline-params.valid.json"))).toMatchObject({
      sessionId: "s1",
      limit: 40,
    });
    const answer = IndexTimelineResult.parse(fixture("index-timeline.valid.json"));
    expect(answer.sessionId).toBe("s1");
    expect(answer.clipped).toBe(true);
    expect(answer.nextCursor).not.toBeNull();
    expect(answer.watermark).toBe("1.2.3");
    expect(answer.entries.map((row) => row.kind)).toEqual([
      "user",
      "tool_use",
      "agent",
      "collaboration",
    ]);
    const tool = answer.entries[1];
    expect(tool?.tool).toMatchObject({
      name: "Bash",
      family: "shell",
      status: "succeeded",
      failed: false,
      object: "one",
      result: "exit 0",
    });
    // an attachment is a REF: what it is and whether its bytes are recorded,
    // never the bytes and never an address
    expect(tool?.tool?.attachments).toEqual([
      { id: "tool-image-1", kind: "image", available: true },
    ]);
    expect(JSON.stringify(answer)).not.toContain("/api/assets/");
    expect(JSON.stringify(answer)).not.toContain("digest");
    // a tool row carries no text; a prompt and a reply carry theirs
    expect(tool?.text).toBeUndefined();
    expect(answer.entries[0]?.text).toMatch(/^Run the specimen/);
    expect(answer.entries[2]?.usage).toEqual({ input: 10, output: 5 });
    expect(answer.entries[2]?.costMicroUsd).toBe(175);
    expect(answer.entries[3]?.text).toBe("design docs updated");
  });

  it("parses the tail's ask, its open and a delta keyed by timelineId", () => {
    const ask = IndexSessionSubscribeParams.parse(
      fixture("index-session-subscribe-params.valid.json"),
    );
    expect(ask).toMatchObject({ sessionId: "s1", minIntervalMs: 2000 });
    expect(ask.since).toMatchObject({ revision: 7 });
    const open = IndexSessionTailOpen.parse(fixture("index-session-tail-open.snapshot.json"));
    if (!("snapshot" in open)) throw new Error("the golden open is a snapshot");
    const snapshot = IndexSessionTailSnapshot.parse(open.snapshot);
    expect(snapshot.rows).toHaveLength(4);
    expect(snapshot.revision).toBe(1);
    const delta = IndexSessionTailDelta.parse(fixture("index-session-tail-delta.valid.json"));
    expect(delta.epoch).toBe(snapshot.epoch);
    expect(delta.since).toBe(1);
    expect(delta.revision).toBe(2);
    // the golden `tool_updated` + `usage` mutations applied to t1: the stamp
    // moved, the usage was replaced (buckets the mutation left null are gone),
    // the cost is priced now
    expect(delta.upserts[0]).toMatchObject({
      timelineId: "t1",
      at: 3700000,
      usage: { input: 10, output: 5 },
      costMicroUsd: 175,
    });
    expect(delta.upserts[0]?.usage).not.toHaveProperty("cacheRead");
    expect(delta.removed).toEqual([]);
  });

  it("asks only what the door admits: a bounded id, a bounded cursor, a page within the ceiling", () => {
    expect(IndexTimelineParams.safeParse({ sessionId: "s1" }).success).toBe(true);
    expect(IndexTimelineParams.safeParse({ sessionId: "" }).success).toBe(false);
    expect(IndexTimelineParams.safeParse({ sessionId: "s".repeat(1025) }).success).toBe(false);
    expect(IndexTimelineParams.safeParse({ sessionId: "s1", cursor: "" }).success).toBe(false);
    expect(
      IndexTimelineParams.safeParse({ sessionId: "s1", cursor: "c".repeat(4097) }).success,
    ).toBe(false);
    expect(IndexTimelineParams.safeParse({ sessionId: "s1", limit: 0 }).success).toBe(false);
    expect(
      IndexTimelineParams.safeParse({ sessionId: "s1", limit: INDEX_TIMELINE.PAGE_MAX_LIMIT })
        .success,
    ).toBe(true);
    expect(
      IndexTimelineParams.safeParse({ sessionId: "s1", limit: INDEX_TIMELINE.PAGE_MAX_LIMIT + 1 })
        .success,
    ).toBe(false);
    expect(IndexSessionSubscribeParams.safeParse({ sessionId: "s1" }).success).toBe(true);
    expect(
      IndexSessionSubscribeParams.safeParse({ sessionId: "s1", minIntervalMs: 15 }).success,
    ).toBe(false);
    expect(IndexSessionSubscribeParams.safeParse({}).success).toBe(false);
  });

  it("a row is keyed by timelineId and strict about nothing else", () => {
    const row = IndexTimelineResult.parse(fixture("index-timeline.valid.json"))
      .entries[0] as Record<string, unknown>;
    expect(IndexTimelineRow.safeParse({ ...row, timelineId: "" }).success).toBe(false);
    expect(IndexTimelineRow.safeParse({ ...row, ordinal: Number.NaN }).success).toBe(false);
    // text, stamps, model, tool: every one optional — a row of any kind reads
    expect(
      IndexTimelineRow.safeParse({
        timelineId: "x",
        sessionId: "s1",
        ordinal: 1,
        kind: "hologram",
        group: { id: "g", kind: "synthetic" },
      }).success,
    ).toBe(true);
  });

  it("the cursor refusal is a PRECONDITION_FAILED a reader recognizes by its reason", () => {
    const refusal = ErrorData.parse(fixture("error-data.index-timeline-cursor-expired.json"));
    expect(refusal).toEqual({
      kind: "PRECONDITION_FAILED",
      retryable: false,
      details: { service: "index", reason: "cursor-expired" },
    });
  });

  it("the numbers: a page's defaults, the text bound, the tail's floor", () => {
    expect(INDEX_TIMELINE.PAGE_DEFAULT_LIMIT).toBe(100);
    expect(INDEX_TIMELINE.PAGE_MAX_LIMIT).toBe(500);
    expect(INDEX_TIMELINE.TEXT_CHARS).toBe(2_000);
    expect(INDEX_TIMELINE.OBJECT_CHARS).toBe(200);
    expect(INDEX_MESH.SESSION_TAIL_MIN_INTERVAL_MS).toBe(1_000);
    // a phone's page is tens of rows: the bound is below the door's default
    expect(INDEX_TAILNET_LIMITS.MAX_ROWS).toBeLessThanOrEqual(INDEX_TIMELINE.PAGE_DEFAULT_LIMIT);
  });
});

describe("the two doors in the registry", () => {
  it("index.timeline is a local, idempotent read on index.search — the phone reaches it, nothing keys it", () => {
    const def = METHODS.find((m) => m.method === "index.timeline");
    expect(def).toEqual({
      surface: "product",
      method: "index.timeline",
      scope: "index.search",
      idempotent: true,
      locality: "local",
    });
    expect(reachableFromTailnet(def!)).toBe(true);
    expect(KEYED_FORWARD_METHODS.has("index.timeline")).toBe(false);
    expect(TAILNET_SCOPES).toContain("index.search");
  });

  it("index.session.subscribe is a rows stream on index.search at the tail's floor", () => {
    const def = METHODS.find((m) => m.method === "index.session.subscribe");
    expect(def).toEqual({
      surface: "product",
      method: "index.session.subscribe",
      scope: "index.search",
      idempotent: true,
      locality: "stream",
      subscription: { shape: "rows", cadenceFloorMs: INDEX_MESH.SESSION_TAIL_MIN_INTERVAL_MS },
    });
    expect(reachableFromTailnet(def!)).toBe(true);
  });

  it("there is no index.timelineEntry door: rosetta's rows are its entries, bodies included", () => {
    // H-D2 assumed heads and a body loader; rosetta's `TimelinePage.entries`
    // are full `TimelineEntry` rows (the socket snapshot's own type), and the
    // room's `loadEntry` re-reads ONE row by id for a landing — the phone pages.
    expect(METHODS.some((m) => m.method === "index.timelineEntry")).toBe(false);
    expect(METHODS.some((m) => m.method === "index.subscribeSession")).toBe(false);
  });
});
