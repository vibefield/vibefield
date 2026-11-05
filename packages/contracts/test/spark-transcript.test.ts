import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { METHODS, reachableFromTailnet } from "../src/methods";
import { SPARK_TRANSCRIPT } from "../src/registries";
import {
  SPARK_TRANSCRIPT_FORMAT,
  SPARK_TRANSCRIPT_KINDS,
  SparkTranscriptLine,
  SparkTranscriptOpen,
  SparkTranscriptOpenTicketResult,
  SparkTranscriptServerFrame,
  sparkTranscriptLineOf,
} from "../src/spark-transcript";

// TH-1 — the spark's transcript (spark-transcript.ts; DESIGN.md §8 "Chat's thread"): its lines, read tolerantly; the
// ticket's door and answer; the wire between the window and the transcript worker. What fieldd writes, signs and
// serves is fieldd's (spark-transcripts.test.ts, wave B); these hold the shapes both sides parse (EL9).

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8"));

describe("a transcript line (TH0-Q1 = O1)", () => {
  it("reads every kind this build knows, each from its fixture", () => {
    const kinds = readdirSync(FIXTURES)
      .filter((f) => f.startsWith("spark-transcript-line."))
      .map((f) => f.slice(0, -".json".length))
      .filter((name) => !name.endsWith(".unknown-kind"))
      .map((name) => sparkTranscriptLineOf(fixture(name))?.kind);
    expect(new Set(kinds)).toEqual(new Set(SPARK_TRANSCRIPT_KINDS));
    expect(SPARK_TRANSCRIPT_FORMAT).toBe(1);
  });

  it("keeps your words with their chips and request id, and the terminal's with neither", () => {
    const yours = sparkTranscriptLineOf(fixture("spark-transcript-line.you"));
    if (yours?.kind !== "you") throw new Error("not a you line");
    expect([yours.via, yours.input, yours.requestId, yours.state]).toEqual([
      "chat",
      "b27e5a90c4d1",
      "say-01JC4N0B6WQZ",
      "queued",
    ]);
    const [chip] = yours.chips ?? [];
    expect(yours.text.slice(chip?.start, (chip?.start ?? 0) + (chip?.length ?? 0))).toMatch(
      /^Claude Code in vibe-field \(session /,
    );
    const typed = sparkTranscriptLineOf(fixture("spark-transcript-line.you-terminal"));
    expect(typed?.kind === "you" && [typed.via, typed.input, typed.chips]).toEqual([
      "terminal",
      undefined,
      undefined,
    ]);
  });

  it("refuses chips that do not stand inside the words, and a line of another format", () => {
    const yours = fixture("spark-transcript-line.you") as Record<string, unknown>;
    expect(
      sparkTranscriptLineOf({ ...yours, chips: [{ start: 70, length: 20, kind: "session" }] }),
    ).toBeUndefined();
    expect(sparkTranscriptLineOf({ ...yours, v: 2 })).toBeUndefined();
    // the head still reads, so a reader can count what it skipped
    expect(SparkTranscriptLine.safeParse({ ...yours, v: 2 }).success).toBe(true);
  });

  it("keeps a tool by its kind and what it touched, never its name", () => {
    const tool = sparkTranscriptLineOf(fixture("spark-transcript-line.tool"));
    expect(tool?.kind === "tool" && [tool.toolKind, tool.detail]).toEqual([
      "command",
      "pnpm --filter @vibefield/field-app test chat-composer",
    ]);
    const ours = sparkTranscriptLineOf(fixture("spark-transcript-line.tool-ours"));
    expect(ours?.kind === "tool" && [ours.toolKind, ours.ours, ours.detail]).toEqual([
      "mcp",
      true,
      undefined,
    ]);
    for (const name of ["spark-transcript-line.tool", "spark-transcript-line.tool-ours"]) {
      const raw = fixture(name) as Record<string, unknown>;
      expect(Object.keys(raw)).not.toContain("tool");
      expect(Object.keys(raw)).not.toContain("title");
    }
  });

  it("skips a kind this build does not know, while its head reads", () => {
    const unknown = fixture("spark-transcript-line.unknown-kind");
    expect(SparkTranscriptLine.parse(unknown).kind).toBe("plan");
    expect(sparkTranscriptLineOf(unknown)).toBeUndefined();
  });

  it("parses a forged line as any line: its MAC is the worker's to refuse, never the reader's", () => {
    const forged = SparkTranscriptLine.parse(fixture("spark-transcript-line.forged"));
    const reply = SparkTranscriptLine.parse(fixture("spark-transcript-line.reply"));
    expect([forged.mac, forged.seq]).toEqual([reply.mac, reply.seq]);
    expect(SparkTranscriptLine.safeParse({ ...reply, mac: "not-hex" }).success).toBe(false);
    expect(SparkTranscriptLine.safeParse({ ...reply, seq: 0 }).success).toBe(false);
  });

  it("says what became of your words in the receipt's words, OPEN", () => {
    const delivered = sparkTranscriptLineOf(fixture("spark-transcript-line.outcome"));
    const lost = sparkTranscriptLineOf(fixture("spark-transcript-line.outcome-uncertain"));
    expect(delivered?.kind === "outcome" && [delivered.of, delivered.state]).toEqual([
      "b27e5a90c4d1",
      "delivered",
    ]);
    expect(lost?.kind === "outcome" && [lost.state, lost.reason]).toEqual([
      "uncertain",
      "no-receipt",
    ]);
  });
});

describe("the ticket (TH-Q30 (a′); VF-PM's X2: local, a renderer window alone, sparks.use)", () => {
  it("is a local sparks.use row that is never idempotent: each answer is a fresh credential", () => {
    const def = METHODS.find((m) => m.method === "compose.sparks.transcript.openTicket");
    expect(def).toMatchObject({
      surface: "product",
      scope: "sparks.use",
      idempotent: false,
      locality: "local",
    });
    // the scope alone would admit the phone's preset: fieldd's own gate narrows it to a window of this desktop
    expect(def !== undefined && reachableFromTailnet(def)).toBe(true);
  });

  it("answers a loopback endpoint with no credential in it, a single-use ticket and the spark's runs", () => {
    const answer = SparkTranscriptOpenTicketResult.parse(fixture("spark-transcript-ticket.valid"));
    expect(answer.runs.map((run) => run.fresh)).toEqual([true, false]);
    for (const endpoint of [
      "ws://10.0.0.4:53817/transcripts",
      "ws://127.0.0.1:53817/transcripts?ticket=x",
      "wss://127.0.0.1:53817/transcripts",
    ])
      expect(
        SparkTranscriptOpenTicketResult.safeParse({ ...answer, endpoint }).success,
        endpoint,
      ).toBe(false);
    expect(SparkTranscriptOpenTicketResult.safeParse({ ...answer, ticket: "short" }).success).toBe(
      false,
    );
    expect(SPARK_TRANSCRIPT.RUNS_MAX).toBe(256);
    expect(SPARK_TRANSCRIPT.TICKET_TTL_MS).toBe(60_000);
  });
});

describe("the wire between the window and the transcript worker", () => {
  it("opens with the ticket and the runs to read, each after the line it holds", () => {
    const open = SparkTranscriptOpen.parse(fixture("spark-transcript-open.valid"));
    expect(open.runs.map((run) => run.after)).toEqual([undefined, 4]);
    expect(SparkTranscriptOpen.safeParse({ ...open, runs: [] }).success).toBe(false);
  });

  it("answers ready, lines, caught-up with what it dropped, a new run, or a refusal", () => {
    const types = ["ready", "line", "caught-up", "run", "refused"].map(
      (name) => SparkTranscriptServerFrame.parse(fixture(`spark-transcript-frame.${name}`)).type,
    );
    expect(types).toEqual(["ready", "line", "caught-up", "run", "refused"]);
    const caught = SparkTranscriptServerFrame.parse(fixture("spark-transcript-frame.caught-up"));
    expect(caught.type === "caught-up" && caught.dropped).toBe(1);
    // a frame of a type this build does not know does not parse: the window passes it over
    expect(SparkTranscriptServerFrame.safeParse({ type: "pause" }).success).toBe(false);
  });
});
