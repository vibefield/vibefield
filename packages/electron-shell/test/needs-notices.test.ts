/**
 * CP-3 (CP3-D5 A) — an agent's notify, said outside the app by main (DESIGN.md §9 "An agent's notify"): only while no
 * VibeField window is in front, its title the teller and its body the words, a click opening Chat whoever told it. The
 * notices are contracts' EL9 fixture (`needs-notices.valid.json`), read here as main reads fieldd's frames. main's own
 * wiring runs at its load, so no unit reaches it: the smoke rule and the click are held in its source, as smoke-opens'
 * rows are.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NeedsNotices } from "@vibefield/contracts";
import type { FielddHandle } from "@vibefield/fieldd-supervisor";
import { describe, expect, it, vi } from "vitest";
import { NeedsNoticeObserver, type NeedsOsNotice, needsOsNotice } from "../src/main/needs-notices";

const FIXTURE: unknown = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../../contracts/fixtures/needs-notices.valid.json"),
    "utf8",
  ),
);
const NOTICES = NeedsNotices.parse(FIXTURE).notices;

type OnEvent = (payload: unknown, kind: "snapshot" | "delta") => void;

/** One fake fieldd: its `needs.notices.subscribe` answers when the test says. */
function fieldd(name: string) {
  const subscribed: string[] = [];
  let onEvent: OnEvent = () => {};
  let answer!: { resolve: (snapshot: unknown) => void; reject: (error: unknown) => void };
  const unsubscribe = vi.fn();
  const handle = {
    info: { bootId: name, port: 4242 },
    client: {
      subscribe: vi.fn((method: string, _params: unknown, listener: OnEvent) => {
        subscribed.push(method);
        onEvent = listener;
        return new Promise((resolve, reject) => {
          answer = {
            resolve: (snapshot) => resolve({ subId: `${name}:1`, snapshot, unsubscribe }),
            reject,
          };
        });
      }),
    },
  } as unknown as FielddHandle;
  return {
    handle,
    subscribed,
    unsubscribe,
    answer: (snapshot: unknown = { notices: [] }) => answer.resolve(snapshot),
    refuse: (error: unknown) => answer.reject(error),
    frame: (payload: unknown) => onEvent(payload, "delta"),
    snapshot: (payload: unknown) => onEvent(payload, "snapshot"),
  };
}

function observe(opts: { focused?: () => boolean } = {}) {
  const listeners = new Set<(handle: FielddHandle) => void>();
  const said: NeedsOsNotice[] = [];
  const errors: unknown[] = [];
  const observer = new NeedsNoticeObserver(
    {
      onHandle: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    { focused: opts.focused ?? (() => false), notify: (notice) => said.push(notice) },
    (error) => errors.push(error),
  );
  const attach = (handle: FielddHandle): void => {
    for (const listener of listeners) listener(handle);
  };
  return { observer, said, errors, attach, listening: () => listeners.size };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("an agent's notify outside the app (CP-3, CP3-D5 A)", () => {
  it("names the teller and says its words; a click opens Chat, whoever told it", () => {
    const [spark, run] = NOTICES;
    expect(spark?.from.spark).toBeDefined();
    expect(run?.from.spark).toBeUndefined();
    expect(NOTICES.map(needsOsNotice)).toEqual([
      { title: "Vela", body: "the build is green", opens: "assistant" },
      {
        title: "claude·2",
        body: "the tests pass in packages/fieldd; 3 were slow",
        opens: "assistant",
      },
    ]);
  });

  it("says a notice outside the app only while no VibeField window is in front", async () => {
    let inFront = true;
    const { said, attach } = observe({ focused: () => inFront });
    const daemon = fieldd("boot-1");
    attach(daemon.handle);
    daemon.answer();
    await settle();
    expect(daemon.subscribed).toEqual(["needs.notices.subscribe"]);

    daemon.frame(FIXTURE);
    expect(said).toEqual([]); // the window's status line says it there

    inFront = false;
    daemon.frame(FIXTURE);
    expect(said.map((notice) => notice.title)).toEqual(["Vela", "claude·2"]);
  });

  it("ignores the snapshot, and passes over a notice it cannot read", async () => {
    const { said, attach } = observe();
    const daemon = fieldd("boot-1");
    attach(daemon.handle);
    // a snapshot is empty by design; a reconnect's fresh one says nothing late either
    daemon.snapshot(FIXTURE);
    daemon.answer(FIXTURE);
    await settle();
    expect(said).toEqual([]);

    const [vela, claude] = NOTICES;
    daemon.frame({ notices: [{ ...vela, words: "" }, { id: "nt-?" }, claude] });
    daemon.frame({ notices: "not a list" });
    daemon.frame(null);
    expect(said).toEqual([{ title: "claude·2", body: claude?.words, opens: "assistant" }]);
  });

  it("follows a new handle, and stops hearing the old one", async () => {
    const { observer, said, errors, attach, listening } = observe();
    const first = fieldd("boot-1");
    attach(first.handle);
    first.answer();
    await settle();

    const second = fieldd("boot-2");
    attach(second.handle);
    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    first.frame(FIXTURE);
    expect(said).toEqual([]);

    // an old handle's late answer is let go at once, and says nothing
    const third = fieldd("boot-3");
    attach(third.handle);
    second.answer();
    await settle();
    expect(second.unsubscribe).toHaveBeenCalledTimes(1);
    second.frame(FIXTURE);
    expect(said).toEqual([]);

    // an old handle's refusal is not the current one's; the current one's is said
    const fourth = fieldd("boot-4");
    attach(fourth.handle);
    third.refuse(new Error("stale"));
    fourth.refuse(new Error("fieldd went away"));
    await settle();
    expect(errors).toEqual([new Error("fieldd went away")]);

    const fifth = fieldd("boot-5");
    attach(fifth.handle);
    fifth.answer();
    await settle();
    fifth.frame({ notices: [NOTICES[0]] });
    expect(said.map((notice) => notice.title)).toEqual(["Vela"]);

    observer.dispose();
    expect(fifth.unsubscribe).toHaveBeenCalledTimes(1);
    expect(listening()).toBe(0);
    fifth.frame(FIXTURE);
    expect(said).toHaveLength(1);
  });

  describe("held in main's source (main/index.ts)", () => {
    const index = readFileSync(new URL("../src/main/index.ts", import.meta.url), "utf8");
    const start = index.indexOf("new NeedsNoticeObserver(");
    const wiring = index.slice(start, index.indexOf("const offerConnect", start));

    it("is the attached user's, beside the link's notices, and is disposed with the attachment", () => {
      expect(start).toBeGreaterThan(index.indexOf("new LinkNoticeObserver("));
      expect(wiring).toContain("bundle.handles,");
      expect(index).toMatch(/linkNotices\.dispose\(\);\s*needsNotices\.dispose\(\);/u);
    });

    it("never puts one on the screen in a smoke, and asks the OS whether it can", () => {
      expect(wiring).toContain("focused: () => BrowserWindow.getFocusedWindow() !== null,");
      expect(wiring).toMatch(
        /notify: \(words\) => \{\s*if \(isSmokeLike\(MODE\) \|\| !Notification\.isSupported\(\)\) return;/u,
      );
    });

    it("a click reveals the primary window on the view the notice opens (the helper SD-3 shares)", () => {
      const helperAt = index.indexOf("const showViewNotice = (");
      expect(helperAt).toBeGreaterThan(0);
      const helper = index.slice(helperAt, start);
      expect(helper).toMatch(
        /notice\.on\("click", \(\) => \{\s*void revealPrimaryWindow\(\)\.then\(/u,
      );
      expect(helper).toContain(".set(words.opens)");
      expect(wiring).toContain(
        'showViewNotice(words, { silent: false, event: "desktop.needs_notice.reveal_failed" });',
      );
    });
  });
});
