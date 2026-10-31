/**
 * CP-3 (CP3-D5 A) — an agent's notify on the window's status line (DESIGN.md §8 "The status line", amended 2026-10-31;
 * §9 "An agent's notify"): in every window, said once as it is told, as its teller (fieldd's name for it), a dash and
 * its words, on one line for the line's 2.4s, and shed per teller (critique 18) so one agent's notices never hold back
 * another's. A notice told before the window listened is no news: the snapshot says nothing, nor a reconnect's. The
 * notices are contracts' EL9 fixture (`needs-notices.valid.json`), read here as the window reads fieldd's frames.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type NeedsNotice, NeedsNotices } from "@vibefield/contracts";
import type { FielddClient } from "@vibefield/fieldd-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  needsNoticeStatus,
  needsNoticesPortOver,
  startNeedsNotices,
} from "../src/frame/needs-notices";
import {
  getStatusNotice,
  resetStatusLineForTest,
  STATUS_STAND_MS,
  statusLineSaid,
} from "../src/frame/status-line";

const HERE = dirname(fileURLToPath(import.meta.url));
const NOTICES = NeedsNotices.parse(
  JSON.parse(readFileSync(join(HERE, "../../contracts/fixtures/needs-notices.valid.json"), "utf8")),
).notices;
const [VELA, CLAUDE] = NOTICES as [NeedsNotice, NeedsNotice];

type OnEvent = (payload: unknown, kind: "snapshot" | "delta") => void;

/** Let the subscribe's answer reach the window's reader. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

/** One fake fieldd client: its `needs.notices.subscribe` answers when the test says. */
function fieldd() {
  const subscribed: string[] = [];
  let onEvent: OnEvent = () => {};
  let answer!: { resolve: (snapshot: unknown) => void; reject: (error: unknown) => void };
  const unsubscribe = vi.fn();
  const client = {
    subscribe: vi.fn((method: string, _params: unknown, listener: OnEvent) => {
      subscribed.push(method);
      onEvent = listener;
      return new Promise((resolve, reject) => {
        answer = {
          resolve: (snapshot) => resolve({ subId: "notices:1", snapshot, unsubscribe }),
          reject,
        };
      });
    }),
  } as unknown as FielddClient;
  return {
    client,
    subscribed,
    unsubscribe,
    answer: async (snapshot: unknown = { notices: [] }) => {
      answer.resolve(snapshot);
      await settle();
    },
    refuse: async (error: unknown) => {
      answer.reject(error);
      await settle();
    },
    tell: (...notices: unknown[]) => onEvent({ notices }, "delta"),
    snapshot: (...notices: unknown[]) => onEvent({ notices }, "snapshot"),
  };
}

/** A notice from `from`, told `n`th. */
const told = (from: NeedsNotice, n: number): NeedsNotice => ({
  ...from,
  id: `nt-${from.from.name === "Vela" ? "a" : "b"}${String(n).padStart(6, "0")}`,
  words: `${n}`,
});

beforeEach(() => {
  vi.useFakeTimers();
  resetStatusLineForTest();
});

afterEach(() => {
  resetStatusLineForTest();
  vi.useRealTimers();
});

describe("an agent's notify on the window's status line (CP3-D5 A)", () => {
  it("says each notify once, as its teller, a dash and its words, on one line, then the next", async () => {
    const f = fieldd();
    const stop = startNeedsNotices(needsNoticesPortOver(f.client));
    expect(f.subscribed).toEqual(["needs.notices.subscribe"]);
    await f.answer();
    // one this build cannot read is passed over, and the rest are said (the tolerant reader)
    f.tell(VELA, { id: "nt-unreadable" }, CLAUDE);
    expect(getStatusNotice()).toMatchObject({ text: "Vela — the build is green", oneLine: true });
    vi.advanceTimersByTime(STATUS_STAND_MS);
    expect(getStatusNotice()?.text).toBe(
      "claude·2 — the tests pass in packages/fieldd; 3 were slow",
    );
    vi.advanceTimersByTime(STATUS_STAND_MS);
    expect(getStatusNotice()).toBeNull();
    expect(statusLineSaid()).toEqual([
      { id: `notify:${VELA.id}`, text: "Vela — the build is green" },
      {
        id: `notify:${CLAUDE.id}`,
        text: "claude·2 — the tests pass in packages/fieldd; 3 were slow",
      },
    ]);
    stop();
    expect(f.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('says it in DESIGN.md\'s own words (§8 "The status line", §9 "Chat\'s words")', () => {
    const design = readFileSync(join(HERE, "../../../DESIGN.md"), "utf8").replace(/\s+/g, " ");
    expect(design).toContain(`"${needsNoticeStatus(VELA).text}"`);
    expect(design).toContain(`A notify on the status line: "${needsNoticeStatus(VELA).text}"`);
  });

  it("says nothing of a snapshot, nor of a reconnect's: a notice told before the window listened is no news", async () => {
    const f = fieldd();
    startNeedsNotices(needsNoticesPortOver(f.client));
    await f.answer({ notices: [VELA] });
    f.snapshot(CLAUDE);
    vi.advanceTimersByTime(STATUS_STAND_MS);
    expect(statusLineSaid()).toEqual([]);
    // and what is told after it is said
    f.tell(CLAUDE);
    expect(getStatusNotice()?.id).toBe(`notify:${CLAUDE.id}`);
  });

  it("sheds per teller: a flood from one agent never holds back, nor sheds, another's", async () => {
    const f = fieldd();
    startNeedsNotices(needsNoticesPortOver(f.client));
    await f.answer();
    f.tell(told(VELA, 1)); // stands
    f.tell(told(CLAUDE, 1));
    f.tell(told(VELA, 2), told(VELA, 3), told(VELA, 4), told(VELA, 5));
    vi.advanceTimersByTime(STATUS_STAND_MS * 8);
    // at most two of Vela's wait; claude·2's stands its turn
    expect(statusLineSaid().map((n) => n.text)).toEqual([
      "Vela — 1",
      "claude·2 — 1",
      "Vela — 4",
      "Vela — 5",
    ]);
  });

  it("a notice from a teller with no session sheds by its name, as fieldd counts it", () => {
    const { session: _, ...from } = VELA.from;
    expect(needsNoticeStatus({ ...VELA, from }).shed).toBe("notify:Vela");
    expect(needsNoticeStatus(VELA).shed).toBe(`notify:${VELA.from.session}`);
  });

  it("a fieldd without notify's carrier says nothing, and the window stands", async () => {
    const f = fieldd();
    const stop = startNeedsNotices(needsNoticesPortOver(f.client));
    await f.refuse(Object.assign(new Error("unknown method"), { code: "NOT_FOUND" }));
    expect(getStatusNotice()).toBeNull();
    expect(() => stop()).not.toThrow();
  });

  it("stopped, it says nothing more, and a subscribe that answers after the stop is let go at once", async () => {
    const f = fieldd();
    const stop = startNeedsNotices(needsNoticesPortOver(f.client));
    stop();
    await f.answer();
    expect(f.unsubscribe).toHaveBeenCalledTimes(1);
    f.tell(VELA);
    expect(statusLineSaid()).toEqual([]);
  });

  it("is started once for the window's life by its host, over its fieldd client, beside Chat's feed", () => {
    const layer = readFileSync(join(HERE, "../src/field/ChromeLayer.tsx"), "utf8");
    expect(layer).toContain(
      "useEffect(() => startNeedsNotices(needsNoticesPortOver(fieldd)), [fieldd]);",
    );
    expect(layer.indexOf("startNeedsNotices(")).toBeGreaterThan(layer.indexOf("startSparksFeed("));
  });
});
