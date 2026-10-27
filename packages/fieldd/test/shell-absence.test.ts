import { createNoopLogger } from "@vibefield/logging";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appBundleOf, ShellAbsence } from "../src/shell-absence";

// AL-5 (`draft/thinking-app-lifecycle.md` §8.2; AL-D4, AL-D8) — the orphan bound, over fake timers: an empty pair
// with no shell ends itself after the idle span (never on a count it cannot read); an unplanned exit that left
// sessions relaunches the app after a short delay, capped; a shell attaching ends both.

const T = {
  IDLE_EXIT_MS: 1_000,
  IDLE_POLL_MS: 100,
  RELAUNCH_DELAY_MS: 50,
  RELAUNCH_CAP: 3,
  RELAUNCH_WINDOW_MS: 10_000,
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function rig(live: { n: number | null }, relaunch = true) {
  const calls = { idle: 0, relaunch: 0 };
  const absence = new ShellAbsence({
    liveSessions: () => live.n,
    stopForIdle: async () => void calls.idle++,
    relaunchShell: relaunch
      ? async () => {
          calls.relaunch++;
          return true;
        }
      : null,
    logger: createNoopLogger(),
    now: () => Date.now(),
    timings: T,
  });
  return { absence, calls };
}

const unplanned = (sessions: number | null) => ({ planned: false, at: Date.now(), sessions });
const planned = (sessions: number) => ({
  planned: true,
  why: "restart" as const,
  at: Date.now(),
  sessions,
});

describe("the orphan bound (AL-5)", () => {
  it("no shell and no session for the idle span: the pair ends itself, once", async () => {
    const live = { n: 0 };
    const { absence, calls } = rig(live);
    absence.vacant(planned(0));
    await vi.advanceTimersByTimeAsync(T.IDLE_EXIT_MS - 200);
    expect(calls.idle).toBe(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(calls.idle).toBe(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls.idle).toBe(1);
  });

  it("a session born inside the span restarts it; a count it cannot read is never idle", async () => {
    const live: { n: number | null } = { n: 0 };
    const { absence, calls } = rig(live);
    absence.vacant(planned(0));
    await vi.advanceTimersByTimeAsync(T.IDLE_EXIT_MS / 2);
    live.n = 1;
    await vi.advanceTimersByTimeAsync(T.IDLE_POLL_MS);
    live.n = null;
    await vi.advanceTimersByTimeAsync(T.IDLE_EXIT_MS * 2);
    expect(calls.idle).toBe(0);
    live.n = 0;
    await vi.advanceTimersByTimeAsync(T.IDLE_EXIT_MS + T.IDLE_POLL_MS);
    expect(calls.idle).toBe(1);
  });

  it("a refused idle stop keeps watching: the next whole span ends the pair", async () => {
    let refusals = 1;
    let stops = 0;
    const absence = new ShellAbsence({
      liveSessions: () => 0,
      stopForIdle: async () => {
        if (refusals-- > 0)
          throw new Error("the live sessions differ from the set consented to end; ask again");
        stops++;
      },
      relaunchShell: null,
      logger: createNoopLogger(),
      now: () => Date.now(),
      timings: T,
    });
    absence.vacant(planned(0));
    await vi.advanceTimersByTimeAsync(T.IDLE_EXIT_MS + T.IDLE_POLL_MS);
    expect(stops).toBe(0); // the floor refused it (a session born at the last moment, a stale inventory)
    await vi.advanceTimersByTimeAsync(T.IDLE_EXIT_MS + T.IDLE_POLL_MS);
    expect(stops).toBe(1);
  });

  it("a shell back while a refused idle stop was in flight ends the watch", async () => {
    let asked = 0;
    let refuse: (error: Error) => void = () => undefined;
    const absence = new ShellAbsence({
      liveSessions: () => 0,
      stopForIdle: () => {
        asked++;
        return new Promise<void>((_resolve, reject) => {
          refuse = reject;
        });
      },
      relaunchShell: null,
      logger: createNoopLogger(),
      now: () => Date.now(),
      timings: T,
    });
    absence.vacant(planned(0));
    await vi.advanceTimersByTimeAsync(T.IDLE_EXIT_MS + T.IDLE_POLL_MS);
    expect(asked).toBe(1);
    absence.held();
    refuse(new Error("ask again"));
    await vi.advanceTimersByTimeAsync(T.IDLE_EXIT_MS * 3);
    expect(asked).toBe(1);
  });

  it("a shell attaching inside the span ends the watch", async () => {
    const { absence, calls } = rig({ n: 0 });
    absence.vacant(planned(0));
    await vi.advanceTimersByTimeAsync(T.IDLE_EXIT_MS / 2);
    absence.held();
    await vi.advanceTimersByTimeAsync(T.IDLE_EXIT_MS * 3);
    expect(calls.idle).toBe(0);
  });

  it("an UNPLANNED exit that left sessions relaunches the app after the delay; a planned one never does", async () => {
    const a = rig({ n: 2 });
    a.absence.vacant(unplanned(2));
    await vi.advanceTimersByTimeAsync(T.RELAUNCH_DELAY_MS - 10);
    expect(a.calls.relaunch).toBe(0);
    await vi.advanceTimersByTimeAsync(20);
    expect(a.calls.relaunch).toBe(1);

    const b = rig({ n: 2 });
    b.absence.vacant(planned(2));
    await vi.advanceTimersByTimeAsync(T.RELAUNCH_DELAY_MS * 4);
    expect(b.calls.relaunch).toBe(0);
  });

  it("a shell back before the delay wins: no relaunch", async () => {
    const { absence, calls } = rig({ n: 2 });
    absence.vacant(unplanned(2));
    absence.held();
    await vi.advanceTimersByTimeAsync(T.RELAUNCH_DELAY_MS * 4);
    expect(calls.relaunch).toBe(0);
  });

  it("past the cap inside its window the app is not relaunched again; the window passing lets it", async () => {
    const { absence, calls } = rig({ n: 1 });
    for (let i = 0; i < 4; i++) {
      absence.vacant(unplanned(1));
      await vi.advanceTimersByTimeAsync(T.RELAUNCH_DELAY_MS + 1);
      absence.held();
    }
    expect(calls.relaunch).toBe(T.RELAUNCH_CAP);
    await vi.advanceTimersByTimeAsync(T.RELAUNCH_WINDOW_MS + 1);
    absence.vacant(unplanned(1));
    await vi.advanceTimersByTimeAsync(T.RELAUNCH_DELAY_MS + 1);
    expect(calls.relaunch).toBe(T.RELAUNCH_CAP + 1);
  });

  it("a fieldd that cannot relaunch (dev, unpackaged) only waits", async () => {
    const { absence, calls } = rig({ n: 1 }, false);
    absence.vacant(unplanned(1));
    await vi.advanceTimersByTimeAsync(T.RELAUNCH_DELAY_MS * 4);
    expect(calls.relaunch).toBe(0);
  });
});

describe("the app a packaged fieldd relaunches is read from its own path (EL7)", () => {
  it("names the bundle a packaged fieldd lives in, and nothing for any other path or platform", () => {
    expect(appBundleOf("/Applications/VibeField.app/Contents/Resources/bin/fieldd", "darwin")).toBe(
      "/Applications/VibeField.app",
    );
    expect(appBundleOf("/Users/me/repo/packages/fieldd/dist/bin.cjs", "darwin")).toBeNull();
    expect(
      appBundleOf("/Applications/VibeField.app/Contents/Resources/bin/fieldd", "linux"),
    ).toBeNull();
  });
});
