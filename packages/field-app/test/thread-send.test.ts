// @vitest-environment node
/**
 * SP-1d — Send, into the thread's pane (DESIGN.md §8 "Chat's composer": Send, a message wakes it, while the spark
 * waits on you, when the paste is not taken). Every effect comes through scripted deps: the wake, the feed's word that
 * the spark was heard, the pane's report and door, main's still door and the pool's refusal hearers. The composer's
 * DOM is `chat-composer.test.tsx`'s; the pane's own door is `spark-pane.test.tsx`'s.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  publishSparkPane,
  SPARK_WAKE_WAIT_MS,
  type SparkPaneDoor,
  type SparkPaneReport,
  whenSparkPane,
} from "../src/chat/thread-pane-door";
import {
  sendNote,
  sendToThread,
  type ThreadSendDeps,
  type ThreadSendOutcome,
} from "../src/chat/thread-send";
import { refusalClaimed } from "../src/frame/line-door";
import type { RoutedInputRefusal } from "../src/terminal/pool";

afterEach(() => {
  vi.useRealTimers();
  publishSparkPane("sp-vela0001", null);
});

/** A live pane's door that records what it was handed. */
function doorOf(over: Partial<SparkPaneDoor> = {}): SparkPaneDoor & { pasted: string[] } {
  const pasted: string[] = [];
  return {
    pasted,
    whenInputOpen: async () => true,
    paste: (text) => {
      pasted.push(text);
      return true;
    },
    ...over,
  };
}

const live = (door: SparkPaneDoor): SparkPaneReport => ({ state: "live", door });

function deps(over: Partial<ThreadSendDeps> = {}): ThreadSendDeps {
  return {
    terminals: true,
    needsYou: () => false,
    needsWake: false,
    wake: async () => undefined,
    heard: async () => true,
    pane: async () => live(doorOf()),
    stillKept: async () => true,
    inputRefusals: () => () => undefined,
    ...over,
  };
}

describe("Send pastes into the thread's pane (DESIGN.md §8 \"Chat's composer\")", () => {
  it("pastes once and says Pasted into Vela's pane — Return sends it", async () => {
    const door = doorOf();
    const outcome = await sendToThread(deps({ pane: async () => live(door) }), "run the tests", []);
    expect(outcome).toEqual({ state: "pasted" });
    expect(door.pasted).toEqual(["run the tests"]);
    expect(sendNote(outcome, "Vela")).toBe("Pasted into Vela's pane — Return sends it");
  });

  it("never presses Return: the door has only a paste, and the text goes as it is", async () => {
    const door = doorOf();
    await sendToThread(deps({ pane: async () => live(door) }), "line one\nline two", []);
    expect(door.pasted).toEqual(["line one\nline two"]);
    expect(Object.keys(door).sort()).toEqual(["paste", "pasted", "whenInputOpen"]);
  });

  it("wakes an asleep spark, waits until it is heard and its pane takes input, then pastes", async () => {
    const order: string[] = [];
    const door = doorOf({
      whenInputOpen: async (ms) => {
        order.push(`input ${ms}`);
        return true;
      },
      paste: (text) => {
        order.push(`paste ${text}`);
        return true;
      },
    });
    const outcome = await sendToThread(
      deps({
        needsWake: true,
        wake: async () => {
          order.push("wake");
        },
        heard: async () => {
          order.push("heard");
          return true;
        },
        pane: async () => {
          order.push("pane");
          return live(door);
        },
      }),
      "hello",
      [],
    );
    expect(outcome).toEqual({ state: "pasted" });
    // heard once woken, and asked again before the paste, as every paste is (answered at once)
    expect(order).toEqual(["wake", "heard", "pane", "heard", "input 1500", "paste hello"]);
  });

  it("pastes into an awake spark that has not been heard yet only once it is (R-4: its program may not read a paste as one)", async () => {
    vi.useFakeTimers();
    const door = doorOf();
    let heardNow: (heard: boolean) => void = () => undefined;
    const asked: number[] = [];
    const sent = sendToThread(
      deps({
        heard: (ms) => {
          asked.push(ms);
          return new Promise((resolve) => {
            heardNow = resolve;
          });
        },
        pane: async () => live(door),
      }),
      "look at this\npnpm test",
      [],
    );
    await vi.advanceTimersByTimeAsync(3_000);
    expect(asked).toHaveLength(1);
    expect(door.pasted, "pasted before its program was heard").toEqual([]);
    heardNow(true);
    expect(await sent).toEqual({ state: "pasted" });
    expect(door.pasted).toEqual(["look at this\npnpm test"]);
  });

  it("says an awake spark never heard in the 20 s is not taking input — never that it didn't wake", async () => {
    vi.useFakeTimers();
    const door = doorOf();
    const asked: number[] = [];
    const sent = sendToThread(
      deps({
        heard: (ms) => {
          asked.push(ms);
          return new Promise((resolve) => setTimeout(() => resolve(false), ms));
        },
        // its pane was found 5 s in: the spark is heard for in what is left of the one 20 s
        pane: () => new Promise((resolve) => setTimeout(() => resolve(live(door)), 5_000)),
      }),
      "hi",
      [],
    );
    await vi.advanceTimersByTimeAsync(SPARK_WAKE_WAIT_MS);
    const outcome = await sent;
    expect(asked).toEqual([SPARK_WAKE_WAIT_MS - 5_000]);
    expect(outcome).toEqual({ state: "not-taking" });
    expect(sendNote(outcome, "Vela")).toBe("Not pasted — Vela's pane is not taking input");
    expect(door.pasted).toEqual([]);
  });

  it("says a step that throws in its own words, and never rejects (a send is never a blank)", async () => {
    const stillDoor = await sendToThread(
      deps({
        stillKept: async () => {
          throw new Error("main's still door did not answer");
        },
      }),
      "see /stills/one.png",
      ["/stills/one.png"],
    );
    expect(stillDoor).toEqual({ state: "failed", reason: "main's still door did not answer" });
    expect(sendNote(stillDoor, "Vela")).toBe(
      "Couldn't send to Vela: main's still door did not answer",
    );
    let stopped = false;
    const thrown = await sendToThread(
      deps({
        pane: async () =>
          live(
            doorOf({
              paste: () => {
                throw new Error("the pane's input closed");
              },
            }),
          ),
        inputRefusals: () => () => {
          stopped = true;
        },
      }),
      "hi",
      [],
    );
    expect(thrown).toEqual({ state: "failed", reason: "the pane's input closed" });
    // the paste's refusal hearer is let go, and nothing is left claimed
    expect(stopped).toBe(true);
    expect(refusalClaimed()).toBe(false);
  });

  it("says Not sent — Vela didn't wake in 20 seconds only for a spark this send woke that was never heard", async () => {
    vi.useFakeTimers();
    const asked: number[] = [];
    const sent = sendToThread(
      deps({
        needsWake: true,
        heard: (ms) => {
          asked.push(ms);
          return new Promise((resolve) => setTimeout(() => resolve(false), ms));
        },
      }),
      "hello",
      [],
    );
    await vi.advanceTimersByTimeAsync(SPARK_WAKE_WAIT_MS);
    const outcome = await sent;
    expect(asked).toEqual([SPARK_WAKE_WAIT_MS]);
    expect(outcome).toEqual({ state: "no-wake" });
    expect(sendNote(outcome, "Vela")).toBe("Not sent — Vela didn't wake in 20 seconds");
  });

  it("says an awake spark whose terminal was not named in the 20 s is off the floor — never that it didn't wake", async () => {
    const heard = vi.fn(async () => true);
    const outcome = await sendToThread(
      deps({ heard, pane: async () => ({ state: "finding", door: null }) }),
      "hi",
      [],
    );
    expect(outcome).toEqual({ state: "off-floor" });
    expect(sendNote(outcome, "Vela")).toBe(
      "Not sent — Vela's terminal is not on this desktop's floor",
    );
    // its terminal not named, it is not asked whether it was heard: no wake, no "didn't wake"
    expect(heard).not.toHaveBeenCalled();
  });

  it("says a thread left before its pane was ready as left — never off the floor, where its terminal may stand", async () => {
    // no pane of the thread on screen when the 20 s ran out: Chat was left, or another thread chosen, while the send
    // waited — for an awake spark's pane being found, or for a woken one's to appear
    for (const needsWake of [false, true]) {
      const heard = vi.fn(async () => true);
      const outcome = await sendToThread(
        deps({ needsWake, heard, pane: async () => null }),
        "hi",
        [],
      );
      expect(outcome, `needsWake ${needsWake}`).toEqual({ state: "thread-left" });
      expect(sendNote(outcome, "Vela")).toBe(
        "Not sent — you left Vela's thread before its pane was ready",
      );
      // no pane, no paste: it is not asked again whether it was heard
      expect(heard).toHaveBeenCalledTimes(needsWake ? 1 : 0);
    }
  });

  it("refuses at once where the pane's place already says why: off the floor, a fault, no terminals", async () => {
    const cases: [SparkPaneReport, ThreadSendOutcome, string][] = [
      [
        { state: "gone", door: null },
        { state: "off-floor" },
        "Not sent — Vela's terminal is not on this desktop's floor",
      ],
      [
        { state: "fault", reason: "the floor did not answer in 10 s", door: null },
        { state: "fault", reason: "the floor did not answer in 10 s" },
        "Couldn't find Vela's pane: the floor did not answer in 10 s",
      ],
      [
        { state: "no-terminals", door: null },
        { state: "no-terminals" },
        "Not sent — this window has no terminals",
      ],
    ];
    for (const [report, expected, words] of cases) {
      const outcome = await sendToThread(deps({ pane: async () => report }), "hi", []);
      expect(outcome).toEqual(expected);
      expect(sendNote(outcome, "Vela")).toBe(words);
    }
  });

  it("in a window with no terminals, says so at once and wakes nothing", async () => {
    const wake = vi.fn(async () => undefined);
    const outcome = await sendToThread(deps({ terminals: false, needsWake: true, wake }), "hi", []);
    expect(outcome).toEqual({ state: "no-terminals" });
    expect(wake).not.toHaveBeenCalled();
  });

  it("keeps the wake's refusal in fieldd's words, said once, as the note", async () => {
    const outcome = await sendToThread(
      deps({
        needsWake: true,
        wake: async () => {
          throw new Error("the spark's agent has no sign-in");
        },
      }),
      "hi",
      [],
    );
    expect(outcome).toEqual({ state: "wake-refused", reason: "the spark's agent has no sign-in" });
    expect(sendNote(outcome, "Vela")).toBe("Couldn't wake Vela: the spark's agent has no sign-in");
  });

  it("pastes nothing while the spark waits on you, and says so (a menu in the pane would read it as its answer)", async () => {
    const door = doorOf();
    const outcome = await sendToThread(
      deps({ needsYou: () => true, pane: async () => live(door) }),
      "yes",
      [],
    );
    expect(outcome).toEqual({ state: "waiting-on-you" });
    expect(door.pasted).toEqual([]);
    expect(sendNote(outcome, "Vela")).toBe("Vela is waiting on you — answer it in its pane");
    // a woken spark that asks on waking is asked again just before the paste
    let asks = 0;
    const late = await sendToThread(
      deps({ needsYou: () => ++asks > 1, pane: async () => live(door) }),
      "yes",
      [],
    );
    expect(late).toEqual({ state: "waiting-on-you" });
    expect(door.pasted).toEqual([]);
  });

  it("reads the need again after the pane's input wait, just before the paste: a menu put up meanwhile gets no paste", async () => {
    let waiting = false;
    // the input opens just as the agent puts up a permission menu (Needs your OK): the wait is when a woken or
    // just-started agent asks first
    const door = doorOf({
      whenInputOpen: async () => {
        waiting = true;
        return true;
      },
    });
    const outcome = await sendToThread(
      deps({ needsYou: () => waiting, pane: async () => live(door) }),
      "yes, and push it",
      [],
    );
    expect(outcome).toEqual({ state: "waiting-on-you" });
    expect(door.pasted).toEqual([]);
  });

  it("says the pane is not taking input when its input does not open in 1.5 s, or the paste is not claimed", async () => {
    const closed = doorOf({ whenInputOpen: async () => false });
    const outcome = await sendToThread(deps({ pane: async () => live(closed) }), "hi", []);
    expect(outcome).toEqual({ state: "not-taking" });
    expect(closed.pasted).toEqual([]);
    expect(sendNote(outcome, "Vela")).toBe("Not pasted — Vela's pane is not taking input");
    const unclaimed = doorOf({ paste: () => false });
    expect(await sendToThread(deps({ pane: async () => live(unclaimed) }), "hi", [])).toEqual({
      state: "not-taking",
    });
  });

  it("a refusal for its size is the send's outcome, said once", async () => {
    let hear: ((refusal: RoutedInputRefusal) => void) | null = null;
    let claimedInside = false;
    const refusal: RoutedInputRefusal = {
      sessionId: "pty-vela",
      kind: "paste",
      bytes: 300_000,
      limitBytes: 261_958,
    };
    const door = doorOf({
      paste: () => {
        claimedInside = refusalClaimed();
        hear?.(refusal);
        return true;
      },
    });
    const outcome = await sendToThread(
      deps({
        pane: async () => live(door),
        inputRefusals: (listener) => {
          hear = listener;
          return () => {
            hear = null;
          };
        },
      }),
      "x".repeat(300_000),
      [],
    );
    expect(claimedInside).toBe(true);
    expect(refusalClaimed()).toBe(false);
    expect(hear).toBeNull();
    expect(outcome).toEqual({ state: "too-large", refusal });
    expect(sendNote(outcome, "Vela")).toBe(
      "Not pasted into Vela's pane — 300 KB, and one paste carries 261 KB of it",
    );
  });

  it("never pastes a snapshot's path once main no longer keeps its still", async () => {
    const door = doorOf();
    const wake = vi.fn(async () => undefined);
    const outcome = await sendToThread(
      deps({
        needsWake: true,
        wake,
        stillKept: async (path) => path !== "/stills/gone.png",
        pane: async () => live(door),
      }),
      "look at /stills/gone.png",
      ["/stills/kept.png", "/stills/gone.png"],
    );
    expect(outcome).toEqual({ state: "still-gone" });
    expect(sendNote(outcome, "Vela")).toBe("Not pasted — that snapshot is no longer kept");
    expect(door.pasted).toEqual([]);
    expect(wake).not.toHaveBeenCalled();
  });

  it('says every note in DESIGN.md\'s own words (§8 "Chat\'s composer", §9 "Chat\'s words")', () => {
    const design = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../../DESIGN.md"),
      "utf8",
    ).replace(/\s+/g, " ");
    const refusal = { sessionId: "s", kind: "paste", bytes: 300_000, limitBytes: 261_958 } as const;
    const outcomes: ThreadSendOutcome[] = [
      { state: "pasted" },
      { state: "waiting-on-you" },
      { state: "not-taking" },
      { state: "still-gone" },
      { state: "too-large", refusal },
      { state: "no-wake" },
      { state: "off-floor" },
      { state: "thread-left" },
      { state: "no-terminals" },
    ];
    for (const outcome of outcomes) {
      const words = sendNote(outcome, "Vela");
      expect(design, words).toContain(`"${words}"`);
      // under 70 characters beside the spark's name, so it is read in the note's 2.4 s
      expect(words.length, words).toBeLessThan(70 + "Vela".length);
    }
    expect(design).toContain(`"${sendNote({ state: "wake-refused", reason: "…" }, "Vela")}"`);
    expect(design).toContain(`"${sendNote({ state: "fault", reason: "…" }, "Vela")}"`);
    expect(design).toContain(`"${sendNote({ state: "failed", reason: "…" }, "Vela")}"`);
  });
});

describe("the thread's pane, waited for (thread-pane-door.ts)", () => {
  it("answers a settled report at once, a later one when it is published, and the latest at the timeout", async () => {
    vi.useFakeTimers();
    const door = doorOf();
    publishSparkPane("sp-vela0001", live(door));
    expect((await whenSparkPane("sp-vela0001", 1_000))?.state).toBe("live");
    publishSparkPane("sp-vela0001", { state: "finding", door: null });
    const later = whenSparkPane("sp-vela0001", 1_000);
    publishSparkPane("sp-vela0001", { state: "gone", door: null });
    expect((await later)?.state).toBe("gone");
    publishSparkPane("sp-vela0001", { state: "finding", door: null });
    const lapsed = whenSparkPane("sp-vela0001", 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await lapsed)?.state).toBe("finding");
    publishSparkPane("sp-vela0001", null);
    const none = whenSparkPane("sp-vela0001", 500);
    await vi.advanceTimersByTimeAsync(500);
    expect(await none).toBeNull();
  });
});
