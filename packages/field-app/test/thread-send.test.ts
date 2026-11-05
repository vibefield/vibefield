// @vitest-environment node
/**
 * TH-1 — Send, queued (DESIGN.md §8 "Chat's composer": Send, a message wakes it, each send once, when the send is not
 * taken). Every effect comes through scripted deps: the wake, the say (`compose.sparks.say`), main's still door. The
 * composer's DOM is `chat-composer.test.tsx`'s. *TH-1, the pane leaves Chat:* the pane's door (`thread-pane-door.ts`)
 * was tested at the foot; it retired with the pane.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPOSE_TEXT_MAX,
  ComposeSayRequestId,
  type ComposeSparksSayResult,
  composeChipsFit,
} from "@vibefield/contracts";
import { FielddRpcError } from "@vibefield/fieldd-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type DraftPart, draftMessage } from "../src/chat/composer-draft";
import {
  type SayAsk,
  sayRequestId,
  sendNote,
  sendToThread,
  type ThreadSendDeps,
  type ThreadSendOutcome,
} from "../src/chat/thread-send";

afterEach(() => {
  vi.useRealTimers();
});

const RECEIPT: ComposeSparksSayResult = {
  spark: "sp-vela0001",
  requestId: "say-000000000001",
  queued: true,
  state: "queued",
  position: 1,
};

/** Scripted deps that record every step in order. */
function deps(over: Partial<ThreadSendDeps> = {}) {
  const steps: string[] = [];
  const asked: SayAsk[] = [];
  const made: ThreadSendDeps = {
    needsWake: false,
    wake: async () => {
      steps.push("wake");
    },
    say: async (ask) => {
      steps.push("say");
      asked.push(ask);
      return { ...RECEIPT, requestId: ask.requestId };
    },
    stillKept: async (path) => {
      steps.push(`still:${path}`);
      return true;
    },
    sending: (requestId) => {
      steps.push(`sending:${requestId}`);
    },
    ...over,
  };
  return { deps: made, steps, asked };
}

const MESSAGE = { text: "Run the review loop", chips: [] } as const;

describe('Send queues your words (TH-1; DESIGN.md §8 "Chat\'s composer")', () => {
  it("queues the message with its chips and its request id, the bubble standing first, and answers the receipt", async () => {
    const { deps: made, steps, asked } = deps();
    const message = {
      text: "Have Claude Code in vibe-field (session run-1) look",
      chips: [{ start: 5, length: 41, kind: "session" }],
    };
    const outcome = await sendToThread(made, message, ["/s/1.png"], "say-abcdefgh01");
    expect(steps).toEqual(["still:/s/1.png", "sending:say-abcdefgh01", "say"]);
    expect(asked).toEqual([{ ...message, requestId: "say-abcdefgh01" }]);
    expect(outcome).toEqual({
      state: "queued",
      receipt: { ...RECEIPT, requestId: "say-abcdefgh01" },
    });
    // queued, the note says nothing: the bubble and its receipt say it
    expect(sendNote(outcome, "Vela")).toBeNull();
  });

  it("wakes a spark asleep or not started first, through the one wake, and says its refusal in the wake's words", async () => {
    const woken = deps({ needsWake: true });
    await sendToThread(woken.deps, MESSAGE, [], "say-abcdefgh02");
    expect(woken.steps).toEqual(["sending:say-abcdefgh02", "wake", "say"]);
    const refused = deps({
      needsWake: true,
      wake: async () => {
        throw new Error("its folder is gone");
      },
    });
    const outcome = await sendToThread(refused.deps, MESSAGE, []);
    expect(outcome).toEqual({ state: "wake-refused", reason: "its folder is gone" });
    expect(refused.asked).toEqual([]);
    expect(sendNote(outcome, "Vela")).toBe("Couldn't wake Vela: its folder is gone");
  });

  it("queues while the spark waits on you: nothing is pasted, so no menu reads it (ER-C2)", async () => {
    // Send reads no blocker: the queue delivers only at an idle with nothing blocking, and the receipt says so
    const { deps: made, steps } = deps({
      say: async (ask) => ({ ...RECEIPT, requestId: ask.requestId, state: "waiting" }),
    });
    expect(await sendToThread(made, MESSAGE, [], "say-abcdefgh04")).toMatchObject({
      state: "queued",
      receipt: { state: "waiting" },
    });
    expect(steps).toEqual(["sending:say-abcdefgh04"]);
  });

  it("refuses a message past the door's bound, and a snapshot main no longer keeps, before anything reaches fieldd", async () => {
    const long = deps();
    const outcome = await sendToThread(
      long.deps,
      { text: "x".repeat(COMPOSE_TEXT_MAX + 1), chips: [] },
      [],
    );
    expect(outcome).toEqual({ state: "too-large" });
    expect(long.steps).toEqual([]);
    expect(
      await sendToThread(long.deps, { text: "x".repeat(COMPOSE_TEXT_MAX), chips: [] }, []),
    ).toMatchObject({
      state: "queued",
    });
    const gone = deps({ stillKept: async () => false });
    expect(await sendToThread(gone.deps, MESSAGE, ["/s/old.png"])).toEqual({ state: "still-gone" });
    expect(gone.steps).toEqual([]);
  });

  it("asks once more by its request id when the answer was lost, never queueing twice, and says fieldd's refusal", async () => {
    let calls = 0;
    const lost = deps({
      say: async (ask) => {
        calls += 1;
        if (calls === 1) throw new FielddRpcError("UNAVAILABLE", "the connection closed", true);
        return { ...RECEIPT, requestId: ask.requestId, state: "delivered" };
      },
    });
    const outcome = await sendToThread(lost.deps, MESSAGE, [], "say-abcdefgh03");
    expect([calls, outcome]).toEqual([
      2,
      { state: "queued", receipt: { ...RECEIPT, requestId: "say-abcdefgh03", state: "delivered" } },
    ]);
    // a refusal for good is said, never asked again
    let refusals = 0;
    const refused = deps({
      say: async () => {
        refusals += 1;
        throw new FielddRpcError(
          "PRECONDITION_FAILED",
          "that request id is another spark's",
          false,
        );
      },
    });
    const said = await sendToThread(refused.deps, MESSAGE, []);
    expect([refusals, said]).toEqual([
      1,
      { state: "failed", reason: "that request id is another spark's" },
    ]);
    expect(sendNote(said, "Vela")).toBe(
      "Couldn't send to Vela: that request id is another spark's",
    );
    // a step that throws is the send's outcome, never a rejection
    const broken = deps({
      stillKept: async () => {
        throw new Error("main's still door is gone");
      },
    });
    expect(await sendToThread(broken.deps, MESSAGE, ["/s/1.png"])).toEqual({
      state: "failed",
      reason: "main's still door is gone",
    });
  });

  it("mints a request id the door takes, fresh for each send", () => {
    const ids = new Set(Array.from({ length: 50 }, () => sayRequestId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(ComposeSayRequestId.safeParse(id).success, id).toBe(true);
  });

  it("says every note in DESIGN.md's own words (§8 \"Chat's composer\")", () => {
    const design = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../DESIGN.md"),
      "utf8",
    ).replace(/\s+/g, " ");
    const outcomes: ThreadSendOutcome[] = [
      { state: "too-large" },
      { state: "still-gone" },
      { state: "wake-refused", reason: "…" },
      { state: "failed", reason: "…" },
    ];
    for (const outcome of outcomes) {
      const words = sendNote(outcome, "Vela") ?? "";
      expect(design, words).toContain(`"${words}"`);
      // under 70 characters beside the spark's name, so it is read in the note's 2.4 s
      expect(words.length, words).toBeLessThan(70 + "Vela".length);
    }
  });
});

describe("what a send carries (TH-Q25 (a))", () => {
  const agent = {
    kind: "chip",
    chip: {
      id: "a",
      kind: "agent",
      agent: "claude",
      label: "Claude Code",
      profile: { id: "p", name: "Work" },
      named: true,
      model: null,
    },
  } as const satisfies DraftPart;
  const session = {
    kind: "chip",
    chip: {
      id: "s",
      kind: "session",
      session: "run-7f3c2a",
      agent: "claude",
      label: "Claude Code",
      handle: "vibe-field·2",
      project: "vibe-field",
    },
  } as const satisfies DraftPart;

  it("carries each chip as a span of its words, inside them, in order, past the trim", () => {
    const message = draftMessage([
      { kind: "text", text: "  Have " },
      agent,
      { kind: "text", text: " review " },
      session,
      { kind: "text", text: "  " },
    ]);
    expect(message.text).toBe(
      "Have Claude Code under Work review Claude Code in vibe-field (session run-7f3c2a)",
    );
    expect(
      message.chips.map((chip) => [
        chip.kind,
        message.text.slice(chip.start, chip.start + chip.length),
      ]),
    ).toEqual([
      ["agent", "Claude Code under Work"],
      ["session", "Claude Code in vibe-field (session run-7f3c2a)"],
    ]);
    expect(composeChipsFit(message.text, message.chips)).toBe(true);
  });

  it("carries a card of more than one line on lines of its own, its span its words alone", () => {
    const card = {
      kind: "chip",
      chip: { id: "c", kind: "card", card: {} as never, text: "line one\nline two" },
    } as const satisfies DraftPart;
    const message = draftMessage([
      { kind: "text", text: "Look at " },
      card,
      { kind: "text", text: " please" },
    ]);
    expect(message.text).toBe("Look at\nline one\nline two\nplease");
    expect(message.chips).toEqual([{ start: 8, length: 17, kind: "card" }]);
    expect(composeChipsFit(message.text, message.chips)).toBe(true);
  });
});
