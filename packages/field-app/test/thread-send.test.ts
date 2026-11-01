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
    drawn: () => true,
    whenInputOpen: async () => true,
    paste: (text) => {
      pasted.push(text);
      return "pasted";
    },
    ...over,
  };
}

/** A door whose pane is no longer drawn: it says so, and its paste hands nothing over. */
const undrawnDoor = (): SparkPaneDoor & { pasted: string[] } =>
  doorOf({ drawn: () => false, paste: () => "undrawn" });

/** A door drawn until `gone()` holds, as a pane is until its thread is left: then it says so, and pastes nothing. */
const doorUntil = (
  gone: () => boolean,
  over: Partial<SparkPaneDoor> = {},
): SparkPaneDoor & { pasted: string[] } => {
  const door = doorOf(over);
  return {
    ...door,
    drawn: () => !gone(),
    paste: (text) => (gone() ? "undrawn" : door.paste(text)),
  };
};

const live = (door: SparkPaneDoor): SparkPaneReport => ({ state: "live", door });

function deps(over: Partial<ThreadSendDeps> = {}): ThreadSendDeps {
  return {
    terminals: true,
    needsYou: () => false,
    needsWake: false,
    wake: async () => undefined,
    heard: async () => true,
    pane: async () => live(doorOf()),
    asleep: () => false,
    onScreen: () => true,
    paneNow: () => null,
    sparksReading: () => "ready",
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
    expect(Object.keys(door).sort()).toEqual(["drawn", "paste", "pasted", "whenInputOpen"]);
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
        return "pasted";
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
    // no pane of the thread when the 20 s ran out, and its thread not on screen then: Chat was left, or another thread
    // chosen, while the send waited — for an awake spark's pane being found, or for a woken one's to appear
    for (const needsWake of [false, true]) {
      const heard = vi.fn(async () => true);
      const outcome = await sendToThread(
        deps({ needsWake, heard, pane: async () => null, onScreen: () => false }),
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

  it("says a spark that fell asleep while the send waited as asleep — never that you left its thread (SP-1d's fix review)", async () => {
    // its run ended during the wait: an asleep thread draws no pane, so none settles, though the thread stays on screen
    for (const needsWake of [false, true]) {
      let asleep = false;
      const outcome = await sendToThread(
        deps({
          needsWake,
          pane: async () => {
            asleep = true;
            return null;
          },
          asleep: () => asleep,
        }),
        "hi",
        [],
      );
      expect(outcome, `needsWake ${needsWake}`).toEqual({ state: "fell-asleep" });
      expect(sendNote(outcome, "Vela")).toBe(
        "Not sent — Vela fell asleep before its pane was ready",
      );
    }
    // asleep is why there is no pane, whether or not you stayed
    expect(
      await sendToThread(
        deps({ pane: async () => null, asleep: () => true, onScreen: () => false }),
        "hi",
        [],
      ),
    ).toEqual({ state: "fell-asleep" });
  });

  it("reads a pane not yet drawn on a thread still on screen as one being found: off the floor, never left (SP-1d's fix review)", async () => {
    // a woken spark heard as the 20 s end: the wait for its pane has no time left, and Chat has not drawn the pane
    // yet, so nothing is published for it — the thread never left the screen
    vi.useFakeTimers();
    const sent = sendToThread(
      deps({
        needsWake: true,
        heard: (ms) => new Promise((resolve) => setTimeout(() => resolve(true), ms - 1)),
        pane: (ms) => whenSparkPane("sp-vela0001", ms, () => false),
      }),
      "hi",
      [],
    );
    await vi.advanceTimersByTimeAsync(SPARK_WAKE_WAIT_MS);
    const outcome = await sent;
    expect(outcome).toEqual({ state: "off-floor" });
    expect(sendNote(outcome, "Vela")).toBe(
      "Not sent — Vela's terminal is not on this desktop's floor",
    );
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
    const unclaimed = doorOf({ paste: () => "closed" });
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
        return "pasted";
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

  it("says a thread left after its pane was found as left, read once the spark is heard — never that its pane is not taking input (final critique 7)", async () => {
    // the pane was found, and the send waits for the spark to be heard (a just-hatched spark: up to the 20 s); meanwhile
    // the thread's pane goes — another thread chosen, the spark asleep, or Chat's list unread — so the door's pane is
    // no longer drawn, and the facts are read as the null pane's are
    const cases: [Partial<ThreadSendDeps>, ThreadSendOutcome][] = [
      [{ onScreen: () => false }, { state: "thread-left" }],
      [{ asleep: () => true }, { state: "fell-asleep" }],
      [
        { sparksReading: () => "unavailable", onScreen: () => false },
        { state: "sparks-unread", reading: "unavailable" },
      ],
      [
        {
          paneNow: () => ({
            state: "fault",
            reason: "the floor did not answer in 10 s",
            door: null,
          }),
        },
        { state: "fault", reason: "the floor did not answer in 10 s" },
      ],
    ];
    for (const [after, expected] of cases) {
      let left = false;
      const inputAsked = vi.fn(async () => true);
      const door = doorUntil(() => left, { whenInputOpen: inputAsked });
      const outcome = await sendToThread(
        deps({
          pane: async () => live(door),
          heard: async () => {
            left = true;
            return true;
          },
          onScreen: () => !left || after.onScreen?.() !== false,
          asleep: () => left && after.asleep?.() === true,
          sparksReading: () => (left ? (after.sparksReading?.() ?? "ready") : "ready"),
          paneNow: () => (left ? (after.paneNow?.() ?? null) : live(door)),
        }),
        "hi",
        [],
      );
      expect(outcome, JSON.stringify(expected)).toEqual(expected);
      // said once the wait ends: its input is never waited for, nothing is pasted
      expect(inputAsked).not.toHaveBeenCalled();
      expect(door.pasted).toEqual([]);
    }
    // the note is the left thread's
    expect(sendNote({ state: "thread-left" }, "Vela")).toBe(
      "Not sent — you left Vela's thread before its pane was ready",
    );
  });

  it("says a thread left while its input was waited for as left, when that wait lapses — never that its pane is not taking input (the final critique's fix review)", async () => {
    // ghosttea lets a session's routed input go with its last view: a thread left, its pane unmounted, its input wait
    // lapses — so a lapse is read as the pane stands then, as no pane is
    const cases: [Partial<ThreadSendDeps>, ThreadSendOutcome][] = [
      [{ onScreen: () => false }, { state: "thread-left" }],
      [{ asleep: () => true }, { state: "fell-asleep" }],
      [
        { sparksReading: () => "unavailable", onScreen: () => false },
        { state: "sparks-unread", reading: "unavailable" },
      ],
    ];
    for (const [after, expected] of cases) {
      let left = false;
      const door = doorUntil(() => left, {
        whenInputOpen: async () => {
          left = true;
          return false;
        },
      });
      const outcome = await sendToThread(
        deps({
          pane: async () => live(door),
          onScreen: () => !left || after.onScreen?.() !== false,
          asleep: () => left && after.asleep?.() === true,
          sparksReading: () => (left ? (after.sparksReading?.() ?? "ready") : "ready"),
          paneNow: () => (left ? null : live(door)),
        }),
        "hi",
        [],
      );
      expect(outcome, JSON.stringify(expected)).toEqual(expected);
      expect(door.pasted).toEqual([]);
    }
    // its pane still drawn, a lapse is its input not opening
    const closed = doorOf({ whenInputOpen: async () => false });
    expect(await sendToThread(deps({ pane: async () => live(closed) }), "hi", [])).toEqual({
      state: "not-taking",
    });
  });

  it("pastes into the pane its thread draws as it pastes: a thread left and shown again is pasted into, once its own input opens", async () => {
    // drawn again before the spark was heard: the new pane's input is waited for, and it takes the paste
    const asked: string[] = [];
    const found = undrawnDoor();
    const drawnAgain = doorOf({
      whenInputOpen: async (ms) => {
        asked.push(`again ${ms}`);
        return true;
      },
    });
    const outcome = await sendToThread(
      deps({ pane: async () => live(found), paneNow: () => live(drawnAgain) }),
      "carry on",
      [],
    );
    expect(outcome).toEqual({ state: "pasted" });
    expect(drawnAgain.pasted).toEqual(["carry on"]);
    expect(found.pasted).toEqual([]);
    expect(asked).toEqual(["again 1500"]);
    // drawn again while the first pane's input was waited for: the new one's is waited for too, before the paste
    let again = false;
    const first = doorUntil(() => again, {
      whenInputOpen: async () => {
        again = true;
        return true;
      },
    });
    const second = doorOf({
      whenInputOpen: async () => {
        asked.push("second");
        return true;
      },
    });
    expect(
      await sendToThread(
        deps({
          pane: async () => live(first),
          paneNow: () => live(again ? second : first),
        }),
        "carry on",
        [],
      ),
    ).toEqual({ state: "pasted" });
    expect(second.pasted).toEqual(["carry on"]);
    expect(first.pasted).toEqual([]);
    expect(asked).toEqual(["again 1500", "second"]);
    // a pane drawn again whose input does not open is not taking input, and gets no paste
    const shut = doorOf({ whenInputOpen: async () => false });
    expect(
      await sendToThread(
        deps({ pane: async () => live(found), paneNow: () => live(shut) }),
        "hi",
        [],
      ),
    ).toEqual({ state: "not-taking" });
    expect(shut.pasted).toEqual([]);
  });

  it("waits, in what is left of the 20 s, for a pane its thread is finding again — never off the floor before they end (the final critique's fix review)", async () => {
    vi.useFakeTimers();
    // left and shown again while the spark was heard: the new pane starts with no floor read, so it is being found
    let shownAgain = false;
    const found = doorUntil(() => shownAgain);
    const drawnAgain = doorOf();
    let published: SparkPaneReport = live(found);
    let settle: () => void = () => undefined;
    const waited: number[] = [];
    const sent = sendToThread(
      deps({
        pane: (ms) => {
          if (!shownAgain) return Promise.resolve(published);
          waited.push(ms);
          return new Promise((resolve) => {
            settle = () => {
              published = live(drawnAgain);
              resolve(published);
            };
          });
        },
        heard: () =>
          new Promise((resolve) =>
            setTimeout(() => {
              shownAgain = true;
              published = { state: "finding", door: null };
              resolve(true);
            }, 4_000),
          ),
        paneNow: () => published,
      }),
      "carry on",
      [],
    );
    let answered: ThreadSendOutcome | "waiting" = "waiting";
    void sent.then((outcome) => {
      answered = outcome;
    });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(waited).toEqual([SPARK_WAKE_WAIT_MS - 4_000]);
    expect(answered, "said before the new pane settled").toBe("waiting");
    settle();
    expect(await sent).toEqual({ state: "pasted" });
    expect(drawnAgain.pasted).toEqual(["carry on"]);
    expect(found.pasted).toEqual([]);
    // still being found when the 20 s end: then, and only then, a pane still being found
    let again = false;
    const lapsed = sendToThread(
      deps({
        pane: (ms) =>
          again
            ? new Promise((resolve) =>
                setTimeout(() => resolve({ state: "finding", door: null }), ms),
              )
            : Promise.resolve(live(doorUntil(() => again))),
        heard: async () => {
          again = true;
          return true;
        },
        paneNow: () => (again ? { state: "finding", door: null } : null),
      }),
      "hi",
      [],
    );
    let late: ThreadSendOutcome | "waiting" = "waiting";
    void lapsed.then((outcome) => {
      late = outcome;
    });
    await vi.advanceTimersByTimeAsync(SPARK_WAKE_WAIT_MS - 1);
    expect(late).toBe("waiting");
    await vi.advanceTimersByTimeAsync(1);
    expect(late).toEqual({ state: "off-floor" });
  });

  it("pastes into a pane still drawn under another view's cover: nothing is published then, and its door takes it", async () => {
    const door = doorOf();
    const outcome = await sendToThread(
      deps({ pane: async () => live(door), paneNow: () => null, onScreen: () => false }),
      "carry on",
      [],
    );
    expect(outcome).toEqual({ state: "pasted" });
    expect(door.pasted).toEqual(["carry on"]);
  });

  it("says a list Chat cannot read in the list's own words — never that you left, that it didn't wake, or that it is not taking input", async () => {
    vi.useFakeTimers();
    // its list refused: Chat's list unread, so no thread is drawn (none on screen) and no spark is heard
    const unread: Partial<ThreadSendDeps> = {
      sparksReading: () => "unavailable",
      onScreen: () => false,
    };
    const lapse = (ms: number) =>
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms));
    const sends = [
      // no pane of the thread at the 20 s
      sendToThread(deps({ ...unread, pane: async () => null }), "hi", []),
      // a spark this send woke, never heard
      sendToThread(deps({ ...unread, needsWake: true, heard: lapse }), "hi", []),
      // an awake spark whose pane was found, never heard
      sendToThread(deps({ ...unread, heard: lapse }), "hi", []),
    ];
    await vi.advanceTimersByTimeAsync(SPARK_WAKE_WAIT_MS);
    for (const outcome of await Promise.all(sends)) {
      expect(outcome).toEqual({ state: "sparks-unread", reading: "unavailable" });
      expect(sendNote(outcome, "Vela")).toBe("Not sent — Chat can't read your sparks");
    }
    // fieldd restarting: the window's feed starts again, and the list reads "Opening Chat…" — said as the list says it
    const opening = await sendToThread(
      deps({ sparksReading: () => "opening", onScreen: () => false, pane: async () => null }),
      "hi",
      [],
    );
    expect(opening).toEqual({ state: "sparks-unread", reading: "opening" });
    expect(sendNote(opening, "Vela")).toBe("Not sent — Chat is opening again");
  });

  it("says an awake spark that fell asleep before it was heard, or before its input opened, as asleep — never not taking input", async () => {
    vi.useFakeTimers();
    let asleep = false;
    const notHeard = sendToThread(
      deps({
        asleep: () => asleep,
        heard: (ms) =>
          new Promise((resolve) =>
            setTimeout(() => {
              asleep = true;
              resolve(false);
            }, ms),
          ),
      }),
      "hi",
      [],
    );
    await vi.advanceTimersByTimeAsync(SPARK_WAKE_WAIT_MS);
    expect(await notHeard).toEqual({ state: "fell-asleep" });
    // heard, then asleep while its input was waited for: its pane went, so its input never opened
    let slept = false;
    const closed = await sendToThread(
      deps({
        asleep: () => slept,
        pane: async () =>
          live(
            doorUntil(() => slept, {
              whenInputOpen: async () => {
                slept = true;
                return false;
              },
            }),
          ),
      }),
      "hi",
      [],
    );
    expect(closed).toEqual({ state: "fell-asleep" });
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
      { state: "fell-asleep" },
      { state: "sparks-unread", reading: "opening" },
      { state: "sparks-unread", reading: "unavailable" },
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
    const never = () => false;
    publishSparkPane("sp-vela0001", live(door));
    expect((await whenSparkPane("sp-vela0001", 1_000, never))?.state).toBe("live");
    publishSparkPane("sp-vela0001", { state: "finding", door: null });
    const later = whenSparkPane("sp-vela0001", 1_000, never);
    publishSparkPane("sp-vela0001", { state: "gone", door: null });
    expect((await later)?.state).toBe("gone");
    publishSparkPane("sp-vela0001", { state: "finding", door: null });
    const lapsed = whenSparkPane("sp-vela0001", 1_000, never);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await lapsed)?.state).toBe("finding");
    publishSparkPane("sp-vela0001", null);
    const none = whenSparkPane("sp-vela0001", 500, never);
    await vi.advanceTimersByTimeAsync(500);
    expect(await none).toBeNull();
  });

  it("ends early once its wait is over: at once when it already is, else at the publication that finds it so (final critique: a spark asleep mid-send)", async () => {
    vi.useFakeTimers();
    let asleep = true;
    const over = () => asleep;
    // asleep as the wait starts: no pane will be drawn, so it answers at once, as the pane stands
    const atOnce = whenSparkPane("sp-vela0001", SPARK_WAKE_WAIT_MS, over);
    let answered: SparkPaneReport | null | "waiting" = "waiting";
    void atOnce.then((report) => {
      answered = report;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(answered).toBeNull();
    // awake while its pane is being found, then asleep: the pane goes, and that publication ends the wait
    asleep = false;
    publishSparkPane("sp-vela0001", { state: "finding", door: null });
    let heard: SparkPaneReport | null | "waiting" = "waiting";
    void whenSparkPane("sp-vela0001", SPARK_WAKE_WAIT_MS, over).then((report) => {
      heard = report;
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(heard).toBe("waiting");
    asleep = true;
    publishSparkPane("sp-vela0001", null);
    await vi.advanceTimersByTimeAsync(0);
    expect(heard).toBeNull();
  });
});
