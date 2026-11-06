import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SparkTranscriptServerFrame } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { roleOf } from "../src/roles";
import { keyVerifier } from "../src/spark-transcript-lines";
import { SparkTranscripts } from "../src/spark-transcripts";
import { TranscriptListener } from "../src/transcripts/host/listener";
import {
  chooseTranscriptHostLaunch,
  TRANSCRIPT_HOST_BUNDLE,
  TRANSCRIPT_HOST_ROLE_ARG,
} from "../src/transcripts/launch";

// TH-1 (TH0-Q5 (b); step0-th §4.4, §8 "the ticket") — the transcript worker's listener, in this process: one loopback
// socket a window opens with its ticket, then the spark's runs it names, verified line by line under the folder's
// key, `caught-up` with the count never served, and the tail. Its child process, its supervisor and the daemon's door
// are spark-transcript-worker.test.ts's and spark-transcript-ticket.test.ts's.

const VELA = "sp-vela00000000";
const KIWI = "sp-kiwi00000000";
const RUN = "run-vela-1";
const AT = "2026-11-05T04:00:00.000Z";

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

/** A spark folder written by fieldd's own store, and a listener over it with the store's key. */
async function world(opts: { allowedOrigins?: string[] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "vf-transcript-host-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "spark-files");
  let clock = Date.parse(AT);
  const store = new SparkTranscripts({
    dir,
    keyPath: join(root, "spark-files.key"),
    now: () => {
      clock += 1000;
      return new Date(clock);
    },
  });
  store.append(VELA, RUN, { kind: "run", runtimeRunId: RUN, fresh: true });
  store.append(VELA, RUN, { kind: "you", via: "chat", text: "carry on" });
  store.append(VELA, RUN, { kind: "reply", messageId: "m-1", text: "On it." });
  store.append(VELA, RUN, { kind: "turn", edge: "end" });
  store.append(KIWI, "run-kiwi-1", { kind: "run", runtimeRunId: "run-kiwi-1", fresh: true });
  const time = { now: Date.parse(AT) };
  const listener = await TranscriptListener.start({
    dir,
    verify: keyVerifier(store.secret()),
    allowedOrigins: opts.allowedOrigins ?? ["file://"],
    generation: 3,
    now: () => time.now,
  });
  cleanup.push(() => listener.close());
  let tickets = 0;
  const ticket = (spark = VELA, clientId = "tok-window", ttlMs = 60_000) => {
    tickets += 1;
    const value = randomBytes(32).toString("base64url");
    listener.register({ ticket: value, spark, clientId, expiresAt: time.now + ttlMs });
    return value;
  };
  const file = (spark: string, run: string) => join(dir, spark, `${run}.jsonl`);
  return { root, dir, store, listener, ticket, time, file, tickets: () => tickets };
}

/** How long a row waits for a frame or a close before it says none came. */
const WAIT_MS = 2_000;

/** The message a bounded wait's assertion carries: what it waited for, and how long. */
const waited = (what: string, ms = WAIT_MS) => `waited ${ms} ms for ${what}; none came`;

/** What `promise` settles to within `ms`, or undefined: a bounded wait the row asserts on, naming what it waited for. */
const within = <T>(promise: Promise<T>, ms: number): Promise<T | undefined> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    void promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });

/** A window's socket: every frame it heard, each parsed as the contract (EL9), and a wait for the next that matches. */
async function dial(port: number, headers?: Record<string, string>) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/transcripts`, headers ? { headers } : {});
  cleanup.push(() => ws.terminate());
  const frames: SparkTranscriptServerFrame[] = [];
  const waiters: {
    test: (f: SparkTranscriptServerFrame) => boolean;
    resolve: (f: SparkTranscriptServerFrame) => void;
  }[] = [];
  ws.on("message", (data) => {
    const frame = SparkTranscriptServerFrame.parse(JSON.parse(String(data)));
    frames.push(frame);
    for (const waiter of [...waiters])
      if (waiter.test(frame)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(frame);
      }
  });
  const closed = new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  /** The first frame that matches, waited for at most `ms`: undefined when none came, which the row asserts on with
   * the frame it waited for and how long (`waited`), never a bare timeout. */
  const frameWithin = (
    test: (f: SparkTranscriptServerFrame) => boolean,
    ms = WAIT_MS,
  ): Promise<SparkTranscriptServerFrame | undefined> => {
    const heard = frames.find(test);
    if (heard !== undefined) return Promise.resolve(heard);
    return new Promise((resolve) => {
      const waiter = {
        test,
        resolve: (frame: SparkTranscriptServerFrame) => {
          clearTimeout(timer);
          resolve(frame);
        },
      };
      const timer = setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1);
        resolve(undefined);
      }, ms);
      waiters.push(waiter);
    });
  };
  const open = (ticket: string, runs: { run: string; after?: number }[]) =>
    ws.send(JSON.stringify({ type: "open", ticket, runs }));
  /** The socket's close code, waited for at most `ms`; undefined when it stayed open. */
  const closedWithin = (ms = WAIT_MS) => within(closed, ms);
  return { ws, frames, frameWithin, closedWithin, open };
}

const seqs = (frames: SparkTranscriptServerFrame[], run = RUN) =>
  frames.flatMap((f) => (f.type === "line" && f.run === run ? [f.line.seq] : []));
type Window = Awaited<ReturnType<typeof dial>>;

/** The worker's word for an open it refused, if it refused one. */
const refusal = (frames: SparkTranscriptServerFrame[]) => {
  const refused = frames.find((f) => f.type === "refused");
  return refused?.type === "refused" ? refused.reason : undefined;
};

describe("the transcript worker's listener (TH-1)", () => {
  it("serves an open: ready with its generation, each named run's verified lines after the seq it holds, then caught-up counting what it never served", async () => {
    const w = await world();
    // an edit: the reply's words changed, its MAC kept
    expect(existsSync(w.file(VELA, RUN)), "the run's file is kept").toBe(true);
    const lines = readFileSync(w.file(VELA, RUN), "utf8").split("\n");
    lines[2] = (lines[2] ?? "").replace("On it.", "Done.");
    writeFileSync(w.file(VELA, RUN), lines.join("\n"), { mode: 0o600 });
    const window = await dial(w.listener.port);
    window.open(w.ticket(), [{ run: RUN, after: 1 }]);
    expect(
      await window.frameWithin((f) => f.type === "caught-up"),
      waited("a caught-up frame"),
    ).toBeDefined();
    expect(window.frames[0]).toEqual({ type: "ready", generation: 3 });
    expect(seqs(window.frames)).toEqual([2, 4]);
    expect(window.frames.at(-1)).toEqual({ type: "caught-up", dropped: 1 });
    expect(JSON.stringify(window.frames)).not.toContain("Done.");
  });

  it("holds a ticket to one use, and its expiry to redemption alone: an open socket outlives it", async () => {
    const w = await world();
    const ticket = w.ticket(VELA, "tok-window", 1_000);
    const first = await dial(w.listener.port);
    first.open(ticket, [{ run: RUN }]);
    expect(
      await first.frameWithin((f) => f.type === "caught-up"),
      waited("a caught-up frame"),
    ).toBeDefined();
    const again = await dial(w.listener.port);
    again.open(ticket, [{ run: RUN }]);
    expect(await again.closedWithin(), waited("the used ticket's socket to close")).toBeDefined();
    expect(refusal(again.frames)).toBe("ticket-used");
    // past the ticket's expiry: the open socket is still served
    w.time.now += 5_000;
    w.store.append(VELA, RUN, { kind: "turn", edge: "start" });
    w.listener.appended(VELA, RUN);
    expect(
      await first.frameWithin((f) => f.type === "line" && f.line.seq === 5),
      waited("line 5 on the open socket"),
    ).toBeDefined();
    // …and a ticket redeemed past its own is refused
    const late = w.ticket(VELA, "tok-window", 1_000);
    w.time.now += 5_000;
    const expired = await dial(w.listener.port);
    expired.open(late, [{ run: RUN }]);
    expect(
      await expired.closedWithin(),
      waited("the expired ticket's socket to close"),
    ).toBeDefined();
    expect(refusal(expired.frames)).toBe("ticket-expired");
  });

  it("refuses a foreign Origin, a ticket it never held, a run not the spark's and a frame that is no open, each in its word, then closes", async () => {
    const w = await world();
    const foreign = await dial(w.listener.port, { Origin: "https://example.com" });
    expect(
      await foreign.closedWithin(),
      waited("the foreign Origin's socket to close"),
    ).toBeDefined();
    expect(refusal(foreign.frames)).toBe("origin");
    // the window's own Origin is admitted
    const own = await dial(w.listener.port, { Origin: "file://" });
    own.open(w.ticket(), [{ run: RUN }]);
    expect(
      await own.frameWithin((f) => f.type === "caught-up"),
      waited("a caught-up frame"),
    ).toBeDefined();
    const asks: [string, (d: Window) => void, string][] = [
      ["a ticket it never held", (d) => d.open("a".repeat(43), [{ run: RUN }]), "ticket-unknown"],
      ["Kiwi's run", (d) => d.open(w.ticket(), [{ run: "run-kiwi-1" }]), "run-unknown"],
      [
        "a path out of the folder",
        (d) => d.open(w.ticket(), [{ run: "../sp-kiwi00000000/run-kiwi-1" }]),
        "run-unknown",
      ],
      ["a frame that is no open", (d) => d.ws.send(JSON.stringify({ type: "hello" })), "malformed"],
      ["bytes that are no JSON", (d) => d.ws.send("{"), "malformed"],
    ];
    for (const [name, send, word] of asks) {
      const d = await dial(w.listener.port);
      send(d);
      expect(await d.closedWithin(), waited(`the socket that sent ${name} to close`)).toBeDefined();
      expect(refusal(d.frames), name).toBe(word);
      expect(
        d.frames.some((f) => f.type === "line"),
        name,
      ).toBe(false);
    }
  });

  it("tails: a line written after caught-up is served at its nudge, a run begun after the open is announced then served from its start, and another spark's nudge serves nothing", async () => {
    const w = await world();
    const window = await dial(w.listener.port);
    window.open(w.ticket(), [{ run: RUN }]);
    expect(
      await window.frameWithin((f) => f.type === "caught-up"),
      waited("a caught-up frame"),
    ).toBeDefined();
    w.store.append(VELA, RUN, { kind: "turn", edge: "start" });
    w.listener.appended(VELA, RUN);
    expect(
      await window.frameWithin((f) => f.type === "line" && f.line.seq === 5),
      waited("line 5, the tail's"),
    ).toBeDefined();
    // a wake: Vela's next run begins after the open
    w.store.append(VELA, "run-vela-2", { kind: "run", runtimeRunId: "run-vela-2", fresh: false });
    w.store.append(VELA, "run-vela-2", { kind: "you", via: "chat", text: "and then?" });
    w.listener.appended(VELA, "run-vela-2");
    expect(
      await window.frameWithin(
        (f) => f.type === "line" && f.run === "run-vela-2" && f.line.seq === 2,
      ),
      waited("line 2 of run-vela-2, the run begun after the open"),
    ).toBeDefined();
    const announced = window.frames.find((f) => f.type === "run");
    expect(announced).toMatchObject({ run: { runtimeRunId: "run-vela-2", fresh: false } });
    expect(window.frames.indexOf(announced as SparkTranscriptServerFrame)).toBeLessThan(
      window.frames.findIndex((f) => f.type === "line" && f.run === "run-vela-2"),
    );
    // Kiwi's line reaches no window of Vela's
    w.store.append(KIWI, "run-kiwi-1", { kind: "turn", edge: "start" });
    w.listener.appended(KIWI, "run-kiwi-1");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(window.frames.some((f) => f.type === "line" && f.run === "run-kiwi-1")).toBe(false);
  });

  it("closes a revoked window's sockets, and a closed ticket's", async () => {
    const w = await world();
    const revoked = await dial(w.listener.port);
    revoked.open(w.ticket(VELA, "tok-gone"), [{ run: RUN }]);
    expect(
      await revoked.frameWithin((f) => f.type === "caught-up"),
      waited("the revoked window's caught-up frame"),
    ).toBeDefined();
    const kept = await dial(w.listener.port);
    const keptTicket = w.ticket(VELA, "tok-kept");
    kept.open(keptTicket, [{ run: RUN }]);
    expect(
      await kept.frameWithin((f) => f.type === "caught-up"),
      waited("the kept window's caught-up frame"),
    ).toBeDefined();
    w.listener.revokeClient("tok-gone");
    expect(
      await revoked.closedWithin(),
      waited("the revoked window's socket to close"),
    ).toBeDefined();
    expect(kept.ws.readyState).toBe(WebSocket.OPEN);
    expect(w.listener.closeTicket("tok-kept", keptTicket)).toBe(true);
    expect(await kept.closedWithin(), waited("the closed ticket's socket to close")).toBeDefined();
  });

  it("never answers an open it cannot read as nothing: a run's file the disk does not answer closes the socket before caught-up (item 172's rule)", async () => {
    const w = await world();
    expect(existsSync(w.file(VELA, RUN)), "the run's file is kept").toBe(true);
    // the disk will not hand it over (EACCES, every one of RECORD_STORES.READ_TRIES tries)
    chmodSync(w.file(VELA, RUN), 0o000);
    const window = await dial(w.listener.port);
    window.open(w.ticket(), [{ run: RUN }]);
    expect(
      await window.closedWithin(),
      `the socket's close code, waited for at most ${WAIT_MS} ms`,
    ).toBe(1011);
    chmodSync(w.file(VELA, RUN), 0o600);
    // ready came, no line and never caught-up: the window asks again, and fieldd's door says what it cannot read
    expect(window.frames.map((frame) => frame.type)).toEqual(["ready"]);
  });
});

describe("the transcript worker's role and launch (TH-1; roles.ts, transcripts/launch.ts)", () => {
  it("is a closed role picked by the first argument alone, its bundle beside fieldd's", () => {
    const exe = "/Applications/VibeField.app/Contents/Resources/fieldd";
    expect(TRANSCRIPT_HOST_ROLE_ARG).toBe("--vibefield-role=transcript-host");
    expect(TRANSCRIPT_HOST_BUNDLE).toBe("transcript-host.cjs");
    expect(roleOf([exe, exe, TRANSCRIPT_HOST_ROLE_ARG])).toBe("transcript-host");
    // an agent's own argument never picks a role of ours, and a first argument that is no role is
    // no daemon either: refused (RV #1, item 203)
    expect(roleOf([exe, exe, "--model", TRANSCRIPT_HOST_ROLE_ARG])).toBe("stray");
  });

  it("runs the packaged executable in its role, a development bundle under fieldd's runtime, and says a source run has none", () => {
    const beside =
      (...present: string[]) =>
      (path: string) =>
        present.includes(path);
    expect(
      chooseTranscriptHostLaunch({
        sea: true,
        execPath: "/app/fieldd",
        bundleDir: undefined,
        exists: beside("/app/transcript-host.cjs"),
      }),
    ).toEqual({
      kind: "launch",
      launch: { command: "/app/fieldd", args: [TRANSCRIPT_HOST_ROLE_ARG] },
    });
    expect(
      chooseTranscriptHostLaunch({
        sea: false,
        execPath: "/usr/local/bin/node",
        bundleDir: "/repo/packages/fieldd/dist",
        exists: beside("/repo/packages/fieldd/dist/transcript-host.cjs"),
      }),
    ).toEqual({
      kind: "launch",
      launch: {
        command: "/usr/local/bin/node",
        args: ["/repo/packages/fieldd/dist/transcript-host.cjs"],
      },
    });
    expect(
      chooseTranscriptHostLaunch({
        sea: true,
        execPath: "/app/fieldd",
        bundleDir: undefined,
        exists: beside(),
      }).kind,
    ).toBe("unconfigured");
    expect(
      chooseTranscriptHostLaunch({
        sea: false,
        execPath: "/usr/local/bin/node",
        bundleDir: undefined,
        exists: beside(),
      }).kind,
    ).toBe("unconfigured");
  });
});
