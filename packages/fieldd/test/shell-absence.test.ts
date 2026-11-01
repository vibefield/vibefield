import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNoopLogger } from "@vibefield/logging";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appBundleOf, fileRelaunchLog, type RelaunchLog, ShellAbsence } from "../src/shell-absence";

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

function rig(live: { n: number | null }, relaunch = true, relaunchLog?: RelaunchLog) {
  const calls = { idle: 0, relaunch: 0 };
  const absence = new ShellAbsence({
    ...(relaunchLog !== undefined ? { relaunchLog } : {}),
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

/** A log that outlives the ShellAbsence reading it, as the file outlives fieldd. */
function memoryLog(order?: string[]): RelaunchLog & { at: number[] } {
  const log = {
    at: [] as number[],
    read: async () => [...log.at],
    write: async (at: readonly number[]) => {
      order?.push("written");
      log.at = [...at];
    },
  };
  return log;
}

describe("the relaunch cap outlives fieldd (AL-11)", () => {
  it("a fieldd after the one that spent the cap relaunches nothing more inside the window, then may again", async () => {
    const log = memoryLog();
    const first = rig({ n: 1 }, true, log);
    for (let i = 0; i < T.RELAUNCH_CAP; i++) {
      first.absence.vacant(unplanned(1));
      await vi.advanceTimersByTimeAsync(T.RELAUNCH_DELAY_MS + 1);
      first.absence.held();
    }
    expect(first.calls.relaunch).toBe(T.RELAUNCH_CAP);
    expect(log.at).toHaveLength(T.RELAUNCH_CAP);
    first.absence.dispose();

    // a fieldd replaced at boot: its own count would begin at zero
    const next = rig({ n: 1 }, true, log);
    next.absence.vacant(unplanned(1));
    await vi.advanceTimersByTimeAsync(T.RELAUNCH_DELAY_MS + 1);
    expect(next.calls.relaunch).toBe(0);
    next.absence.held();

    await vi.advanceTimersByTimeAsync(T.RELAUNCH_WINDOW_MS + 1);
    next.absence.vacant(unplanned(1));
    await vi.advanceTimersByTimeAsync(T.RELAUNCH_DELAY_MS + 1);
    expect(next.calls.relaunch).toBe(1);
    // the times past the window leave the log
    expect(log.at).toHaveLength(1);
  });

  it("writes the relaunch down before it runs, so an app that dies at once is counted", async () => {
    const order: string[] = [];
    const log = memoryLog(order);
    const absence = new ShellAbsence({
      liveSessions: () => 1,
      stopForIdle: async () => undefined,
      relaunchShell: async () => {
        order.push("relaunched");
        return true;
      },
      relaunchLog: log,
      logger: createNoopLogger(),
      now: () => Date.now(),
      timings: T,
    });
    absence.vacant(unplanned(1));
    await vi.advanceTimersByTimeAsync(T.RELAUNCH_DELAY_MS + 1);
    expect(order).toEqual(["written", "relaunched"]);
  });

  it("a log it cannot read or write leaves the cap to this fieldd's own count, never unbounded", async () => {
    const broken: RelaunchLog = {
      read: async () => {
        throw new Error("not a relaunch log");
      },
      write: async () => {
        throw new Error("disk full");
      },
    };
    const { absence, calls } = rig({ n: 1 }, true, broken);
    for (let i = 0; i < T.RELAUNCH_CAP + 1; i++) {
      absence.vacant(unplanned(1));
      await vi.advanceTimersByTimeAsync(T.RELAUNCH_DELAY_MS + 1);
      absence.held();
    }
    expect(calls.relaunch).toBe(T.RELAUNCH_CAP);
  });

  it("a shell back while the log is read wins: no relaunch, nothing written", async () => {
    let release: () => void = () => undefined;
    const log = memoryLog();
    const slow: RelaunchLog = {
      read: () =>
        new Promise((resolve) => {
          release = () => resolve([]);
        }),
      write: log.write,
    };
    const { absence, calls } = rig({ n: 1 }, true, slow);
    absence.vacant(unplanned(1));
    await vi.advanceTimersByTimeAsync(T.RELAUNCH_DELAY_MS + 1);
    absence.held();
    release();
    await vi.advanceTimersByTimeAsync(T.RELAUNCH_DELAY_MS * 4);
    expect(calls.relaunch).toBe(0);
    expect(log.at).toEqual([]);
  });
});

describe("the relaunch log on disk (AL-11, LAYOUT.SHELL_RELAUNCHES)", () => {
  beforeEach(() => vi.useRealTimers());

  it("reads none before the first relaunch, then what was written, owner-only; a garbled one is refused", async () => {
    const dir = await mkdtemp(join(tmpdir(), "al11-"));
    try {
      const path = join(dir, "fieldd", "shell-relaunches.json");
      const log = fileRelaunchLog(path);
      expect(await log.read()).toEqual([]);
      await log.write([1_000, 2_000]);
      expect(await log.read()).toEqual([1_000, 2_000]);
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      await writeFile(path, JSON.stringify({ at: ["soon"] }));
      await expect(log.read()).rejects.toThrow("not a relaunch log");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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
