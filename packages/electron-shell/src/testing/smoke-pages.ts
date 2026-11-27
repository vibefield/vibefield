// Item 658 (2026-11-26) — THE PAGES SMOKE'S ROWS (`pnpm smoke:pages`, desk-gates row 41). On ONE run
// they CHECK that the engine main starts for an agent's pages is the recorded source build, with its
// stream off and its peer check on: what a run read is in its lines, and nothing here is a standing
// fact of every start. One run of the canvas smoke under `--pages`, on the engine and the page the
// stager hands it (packaging/stage-pages-engine.mjs). The rows drive main's ONE pages plane through
// the door main hands the smoke, and read the engine through the witness main made
// (pages-engine-witness.ts). Nothing here reads a process: the witness and the house census do.
//
// The legs, in this order and no other:
//   OPEN      one run-form navigate, the command an agent's browser_open sends, on the stager's page
//   IDENTITY  the spawned file is the stager's copy and the record's bytes; main's ready line agrees
//   CENSUS    ONE read, mid-life, of the run's marked processes: its one engine is the child main
//             spawned, with nothing beneath it
//   PEER      a process that is not main is dropped; main's same line is answered before and after;
//             the child holds a socket bound at the session's path; and, while main holds one
//             connection open, a socket of main's names a socket of the child's as its peer
//   TCP       no listener on the engine in any read; three reads counted by its own connection to
//             main's bridge, which main's own listeners name; its UDP read borne out by a later one
//   CLOSE     the run's close ends its engine by main's own ladder
//   CONTROL   a `.stream` file planted in the next engine's folder: main's own check must refuse it
//   LATCH     after that refusal no engine is started
//   STOP      the product's own stop leaves no engine for the smoke's teardown
//   ENGINES   EVERY engine the witness was told of, judged after the stop: its file, the record, its
//             folders for its whole life (no `.stream` file, the plant alone excepted), its sockets,
//             its pid file
// The control comes after the open's run has closed and never before: a refused stream latches the
// supervisor, and every start after it is refused.
//
// Three words. OK. RED: a thing claimed is false, by something read. BLIND: a leg could not see
// what it claims, or was not run. Blind is never ok, and nothing blind is folded into ok. A red is
// tested before any blind of its leg. What a judge itself waives is said in the line and waived
// there alone: for an engine that NEVER ANSWERED main, its socket never seen and the bridge
// connection no read of it could bear; for an engine main REFUSED, the bridge connection, its one
// read tied to its life by the read of its unix sockets. An engine that took a connect of main's
// and of which main read nothing has answered, and nothing of it is waived: the ready connect,
// after which it was gone, or the close main ends an engine that was not ready in time with. Exit
// 0 ok, 1 red, 2 blind; a red anywhere outranks every blind. No line says a pid, a kernel address,
// a descriptor or a local path.
//
// No leg sends a page action to an engine that has not answered its launch, and the only line sent
// to an engine's socket is `session_info` (the witness's): an action that needs a browser makes an
// engine with none start one of its own.

import { get } from "node:http";
import { loadavg } from "node:os";
import {
  type ShellSurfacesControlParams,
  type ShellSurfacesControlResult,
  SURFACE_AUTHORITY_LIMITS,
} from "@vibefield/contracts";
import type { PagesEngineWitness, WitnessedEngine } from "./pages-engine-witness";
import { readSockets, runPs, type SocketRead } from "./pages-listeners";
import {
  type CensusRow,
  enginesIn,
  joinVerdicts,
  judgeMainControl,
  judgeTries,
  PAGES_OPEN_TRIES,
  PAGES_OPEN_WINDOW_MS,
  type Verdict,
} from "./pages-witness-judge";
import { listRunProcesses } from "./smoke-daemons";

/** The stager's word to the run: `{ url, hits, engineIs }` as JSON. */
export const PAGES_FIXTURE_ENV = "VF_PAGES_FIXTURE";

export interface PagesFixture {
  /** the stager's page, on loopback */
  readonly url: string;
  /** the address that answers how often the page was fetched */
  readonly hits: string;
  /** the SHA-256 (hex) of the PATH of the stager's checked copy of the source build. A digest and
   * no path: everything main starts inherits main's environment, and the engine's place is taken
   * out of it for that reason (resources.ts). The witness answers whether a spawned file is it. */
  readonly engineIs: string;
}

const LOOPBACK_PAGE = /^http:\/\/127\.0\.0\.1:\d{1,5}\/[0-9a-f]{16}\/$/u;

/** The fixture as the stager handed it, or why it is none. */
export function pagesFixture(
  env: NodeJS.ProcessEnv,
): { readonly fixture: PagesFixture } | { readonly problem: string } {
  const raw = env[PAGES_FIXTURE_ENV];
  const none = (what: string) => ({
    problem: `--pages ${what} (packaging/stage-pages-engine.mjs stages the engine and the page)`,
  });
  if (raw === undefined || raw === "") return none(`without ${PAGES_FIXTURE_ENV}`);
  let said: unknown;
  try {
    said = JSON.parse(raw);
  } catch {
    return none(`with a ${PAGES_FIXTURE_ENV} that is not JSON`);
  }
  const f = (typeof said === "object" && said !== null ? said : {}) as Record<string, unknown>;
  const { url, hits, engineIs } = f;
  if (typeof url !== "string" || !LOOPBACK_PAGE.test(url)) {
    return none("with a page that is not the stager's loopback page");
  }
  if (hits !== `${url}hits`) return none("with a count address that is not the page's own");
  if (typeof engineIs !== "string" || !/^[0-9a-f]{64}$/u.test(engineIs)) {
    return none("with no SHA-256 of the engine copy's path");
  }
  return { fixture: { url, hits, engineIs } };
}

export const PAGES_RUN_OPEN = "smokepages-open";
export const PAGES_RUN_PLANT = "smokepages-plant";
export const PAGES_RUN_LATCH = "smokepages-latch";
/** How long an engine has to be gone after main ended it: main's ladder is three rungs of 3 s. */
export const PAGES_EXIT_WAIT_MS = 10_000;
/** The identity main's ready line names for an unpackaged engine held to the record's source build. */
export const PAGES_READY_IDENTITY = "dev-source-build";

/** The door main hands the smoke: its one pages plane, and the witness it made. */
export interface PagesSmokeDoor {
  readonly witness: PagesEngineWitness;
  control(
    p: ShellSurfacesControlParams,
    ctx: { readonly signal: AbortSignal; readonly deadlineAt: number },
  ): Promise<ShellSurfacesControlResult>;
  stop(): Promise<void>;
  /** the rest of the product's quit for its pages: its live-surface custody disposed, which ends
   * each page's offscreen window. The rows never call it; the smoke's exit does (smoke-exit.ts). */
  closeSurfaces(): void;
}

export const PAGES_LEGS = [
  "open",
  "identity",
  "census",
  "peer",
  "tcp",
  "close",
  "control",
  "latch",
  "stop",
  "engines",
] as const;
export type PagesLeg = (typeof PAGES_LEGS)[number];
export type PagesLegVerdict = Verdict["verdict"] | "skipped";

export interface PagesRowsDeps {
  readonly door: PagesSmokeDoor;
  readonly fixture: PagesFixture;
  readonly mainPid: number;
  readonly say: (line: string) => void;
  /** the smoke run's mark, for the house census */
  readonly mark?: string | undefined;
  /** main's own listeners; absent: lsof's read of `mainPid` */
  readonly listeners?: (pid: number) => Promise<SocketRead>;
  /** the run's processes; absent: the house census by the run's mark, read through this smoke's own
   * `ps` (its absolute path, an environment built from nothing) */
  readonly census?: () => readonly CensusRow[];
  /** how often the stager's page was fetched; absent: asked of the stager */
  readonly hits?: () => Promise<number | null>;
  /** the host's 1-minute load; absent: the system's own */
  readonly load?: () => number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly controlMs?: number;
  readonly exitWaitMs?: number;
}

export interface PagesRowsResult {
  readonly verdict: Verdict["verdict"];
  readonly why?: string;
  readonly legs: Readonly<Record<PagesLeg, PagesLegVerdict>>;
  /** how many engines the witness was told of */
  readonly spawns: number;
  readonly exit: 0 | 1 | 2;
}

const OK: Verdict = { verdict: "ok" };
const red = (why: string): Verdict => ({ verdict: "red", why });
const blind = (why: string): Verdict => ({ verdict: "blind", why });

/** An open is tried again only where the engine may yet answer: a start that has not finished, or
 * an act whose answer never came. */
const TRY_AGAIN: readonly string[] = ["engine-starting", "no-answer"];

type Called =
  | { readonly kind: "answer"; readonly answer: ShellSurfacesControlResult }
  | { readonly kind: "thrown"; readonly state: string };

/** Whether main leased this engine: it said it ready. Only such an engine was attached to main's
 * bridge, so only its reads can be counted by its own connection to it. */
const leased = (engine: WitnessedEngine): boolean =>
  engine.lines().some((l) => l.event === "pages.engine.ready");

function askHits(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const request = get(url, { timeout: 5000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          const said = (JSON.parse(body) as { hits?: unknown }).hits;
          resolve(typeof said === "number" ? said : null);
        } catch {
          resolve(null);
        }
      });
      // a response that began and then broke: no count, never an error nobody hears
      res.on("error", () => resolve(null));
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(null));
  });
}

/** THE RUN'S ONE WORD, from its legs. Ok only when every leg is ok. A red leg makes it red whatever
 * is blind or was not run; with no red, a blind leg or a leg that was not run makes it blind. The
 * first leg of the worst kind speaks: a red before a blind before a leg not run. */
export function pagesVerdict(
  legs: Readonly<Record<PagesLeg, PagesLegVerdict>>,
  whys: Readonly<Partial<Record<PagesLeg, string>>>,
): { readonly verdict: Verdict["verdict"]; readonly why?: string; readonly exit: 0 | 1 | 2 } {
  const kinds: readonly PagesLegVerdict[] = ["red", "blind", "skipped"];
  const worst = kinds
    .map((kind) => PAGES_LEGS.find((leg) => legs[leg] === kind))
    .find((leg) => leg !== undefined);
  if (worst === undefined) return { verdict: "ok", exit: 0 };
  const why =
    whys[worst] ??
    (legs[worst] === "skipped"
      ? `the ${worst} leg was not run`
      : `the ${worst} leg is ${legs[worst]}`);
  return legs[worst] === "red"
    ? { verdict: "red", why, exit: 1 }
    : { verdict: "blind", why, exit: 2 };
}

export async function runPagesRows(o: PagesRowsDeps): Promise<PagesRowsResult> {
  const { door, fixture } = o;
  const witness = door.witness;
  const now = o.now ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const listeners = o.listeners ?? ((pid: number) => readSockets("listen", pid));
  const census =
    o.census ??
    ((): readonly CensusRow[] =>
      listRunProcesses(o.mark ?? "", runPs).map(({ pid, ppid, name }) => ({ pid, ppid, name })));
  const hits = o.hits ?? (() => askHits(fixture.hits));
  const load = o.load ?? (() => loadavg()[0] ?? Number.NaN);
  const controlMs = o.controlMs ?? SURFACE_AUTHORITY_LIMITS.CONTROL_DEADLINE_MS;
  const exitWaitMs = o.exitWaitMs ?? PAGES_EXIT_WAIT_MS;

  const legs = Object.fromEntries(PAGES_LEGS.map((leg) => [leg, "skipped"])) as Record<
    PagesLeg,
    PagesLegVerdict
  >;
  const whys: Partial<Record<PagesLeg, string>> = {};
  const settle = (leg: PagesLeg, verdict: Verdict, facts: Record<string, unknown> = {}): void => {
    legs[leg] = verdict.verdict;
    if (verdict.why !== undefined) whys[leg] = verdict.why;
    o.say(
      `SMOKE_PAGES_${leg.toUpperCase()} ${JSON.stringify({
        verdict: verdict.verdict,
        ...(verdict.why === undefined ? {} : { why: verdict.why }),
        ...(verdict.said === undefined ? {} : { said: verdict.said }),
        ...facts,
      })}`,
    );
  };
  const call = async (run: string, command: { action: string; url?: string }): Promise<Called> => {
    try {
      const answer = await door.control(
        { run, window: "act", command },
        { signal: new AbortController().signal, deadlineAt: now() + controlMs },
      );
      return { kind: "answer", answer };
    } catch (error) {
      const state =
        typeof error === "object" && error !== null && "state" in error
          ? String(error.state)
          : typeof error === "object" && error !== null && "kind" in error
            ? String(error.kind)
            : "an error";
      return { kind: "thrown", state };
    }
  };
  const gone = async (engine: WitnessedEngine, rootToo: boolean): Promise<void> => {
    const until = now() + exitWaitMs;
    while ((engine.alive() || (rootToo && engine.rootLeft())) && now() < until) await sleep(100);
  };
  const safely = (read: () => Verdict, what: string): Verdict => {
    try {
      return read();
    } catch {
      return blind(`${what} could not be read`);
    }
  };

  // main's own listeners before the first pages call: its bridge listens from that call on
  const mainBefore = await listeners(o.mainPid);

  // OPEN
  const t0 = now();
  let opens = 0;
  let opened: Called = { kind: "thrown", state: "not tried" };
  while (opens < PAGES_OPEN_TRIES && now() - t0 <= PAGES_OPEN_WINDOW_MS) {
    opens += 1;
    opened = await call(PAGES_RUN_OPEN, { action: "navigate", url: fixture.url });
    if (opened.kind === "answer" || !TRY_AGAIN.includes(opened.state)) break;
  }
  const hooked = witness.engines().filter((e) => e.run === PAGES_RUN_OPEN);
  const live = hooked.filter((e) => e.alive());
  const answer = opened.kind === "answer" ? opened.answer : null;
  const output = answer !== null && answer.status === "done" ? answer.output : null;
  const success =
    typeof output === "object" && output !== null && "success" in output && output.success === true;
  const fetched = success ? await hits() : null;
  const serving = success && live.length === 1 ? live[0] : undefined;
  // The two reds first. Two living engines of one run is read, whatever the open came to. An
  // engine that answered with success while the witness was told of no child is the other; it
  // needs the success, so none of the blinds below could have hidden it, and it stands here so
  // that the leg's order is the rule's own.
  const answered: Verdict =
    live.length > 1
      ? red("the run holds two engines")
      : success && hooked.length === 0
        ? red("an engine answered and the witness was told of no child")
        : opened.kind === "thrown"
          ? blind(
              hooked.some(leased)
                ? `the open was not answered (${opened.state}) though an engine was ready: an engine refusing main, or slow; one call cannot tell`
                : `the open was not answered: ${opened.state}`,
            )
          : opened.answer.status !== "done"
            ? blind(`the open was refused: ${opened.answer.fact}`)
            : !success
              ? blind("the engine answered the open without success")
              : live.length === 0
                ? blind("the engine that answered the open has exited")
                : fetched === null
                  ? blind("the page's fetch count could not be read")
                  : fetched < 1
                    ? blind("the open was answered and the page was never fetched")
                    : OK;
  // the engines the tries started are judged with every other engine, by the last leg
  const tried = judgeTries({ opens, elapsedMs: now() - t0, answered: success });
  settle("open", joinVerdicts([answered, tried]), {
    status: answer?.status ?? "none",
    success,
    hits: fetched,
    tries: opens,
    spawns: hooked.length,
    // the host's 1-minute load, to two places: a blind under a loaded host is read with it
    load1: Math.round(load() * 100) / 100,
  });
  // main's bridge listens from the first pages call on: the one new loopback listener main shows is
  // the address every leased engine's reads are counted by
  const control = judgeMainControl(mainBefore, await listeners(o.mainPid));

  if (serving === undefined) {
    // the run may hold a pane and an engine the witness never saw: the product is asked to end it
    await call(PAGES_RUN_OPEN, { action: "close" });
  } else {
    // IDENTITY
    const ready = serving.lines().find((l) => l.event === "pages.engine.ready");
    const said: Verdict =
      ready === undefined
        ? blind("main said no ready line for the engine")
        : ready.identity === PAGES_READY_IDENTITY
          ? OK
          : blind(`main's ready line names the identity ${ready.identity ?? "none"}`);
    const copy = serving.fileIs(fixture.engineIs);
    const file = copy ? OK : red("the spawned file is not the stager's copy");
    settle("identity", joinVerdicts([serving.identity(), file, said]), {
      file: copy ? "stager-copy" : "another",
      ready: ready?.identity ?? null,
    });
    await witness.sample(serving);

    // CENSUS
    settle(
      "census",
      safely(() => serving.census(census()), "the run's census"),
    );
    await witness.sample(serving);

    // PEER
    const peer = await witness.probePeer(serving);
    const own = await witness.control(serving);
    const holds: Verdict =
      own.browser === false ? blind("the engine that answers says it holds no browser") : OK;
    settle("peer", joinVerdicts([peer, holds]), {
      browser: own.browser,
      pid: own.pid,
      foreignMs: peer.foreignMs,
      mainBefore: peer.mainBefore,
      mainAfter: peer.mainAfter,
      // the kernel's tie, as counts and never an address
      tie: peer.tie,
      mainPeers: peer.mainPeers,
      mainByPath: peer.mainByPath,
      childSockets: peer.childSockets,
      ties: peer.ties,
    });
    await witness.sample(serving);

    // TCP: the UDP read, then one more read of its TCP sockets, which is what can show that the
    // engine the UDP read found silent was alive. No read of the engine is begun once main is to be
    // asked to end it, and every read that was begun is waited for before the engine is judged: a
    // listener it saw is in the verdict
    await witness.readUdp(serving);
    await witness.sample(serving);
    serving.quiet();
    await witness.drained(serving);
    const tcp = serving.tcp(control.bridge);
    // main's control first: with no bridge shown, its words say what was read, where the engine's
    // judge can only say it was handed none. A red of the engine's outranks it wherever it stands.
    settle("tcp", joinVerdicts([control, tcp, serving.udp(control.bridge)]), {
      bridge: control.bridge,
      counted: tcp.counted,
      bare: tcp.bare,
      discarded: tcp.discarded,
      maxGapMs: tcp.maxGapMs,
      headMs: tcp.headMs,
      // from the last counted read to THIS judgment, with the engine alive: the stretch to its exit
      // is the close's to say (`unreadMs`)
      sinceLastMs: tcp.tailMs,
    });

    // CLOSE
    const closed = await call(PAGES_RUN_OPEN, { action: "close" });
    await gone(serving, true);
    const closeLine = serving.lines().some((l) => l.event === "pages.engine.close");
    // The three reds first, each a thing READ of the engine, whatever came of the call itself; a
    // close that threw is blind only when nothing read is wrong.
    settle(
      "close",
      serving.alive()
        ? red("the run's close left its engine running")
        : !closeLine
          ? red("the engine's exit came without main's close line")
          : serving.rootLeft()
            ? red("the engine's root was left after its exit")
            : closed.kind === "thrown"
              ? blind(`the run's close was not answered: ${closed.state}`)
              : OK,
      {
        exited: !serving.alive(),
        closeLine,
        rootGone: !serving.rootLeft(),
        // from the last counted read to the exit: the close and main's ladder, which no read covers
        unreadMs: serving.alive() ? null : serving.tcp(control.bridge).tailMs,
      },
    );

    if (!serving.alive()) {
      // CONTROL: the next engine's folder holds a `.stream` file from its spawn
      const before = witness.engines().length;
      witness.plantFor(PAGES_RUN_PLANT);
      const got = await call(PAGES_RUN_PLANT, { action: "navigate", url: fixture.url });
      const planted = witness
        .engines()
        .slice(before)
        .find((e) => e.planted);
      if (planted !== undefined) await gone(planted, false);
      const refusal = planted?.lines().find((l) => l.event === "pages.engine.refused");
      const unplanted = planted?.plantFailed() ?? null;
      // the planted engine's folder for its whole life, as its own judge reads it: red on a stream
      // file that is not the plant
      const folder = planted?.stream();
      // the three reds first, so that no blind hides one: an engine main let through over a stream
      // file in its folder (the witness's own plant or, where that could not be written, the file
      // of its name that was there already), an engine main refused and left running, and a
      // stream file in the planted engine's folder that is not the plant
      // REFUSED BY MAIN: main's own refusal line of the planted engine, whatever its reason, or the
      // call refused as an engine refused. The line is main's word whatever the call came to. Main
      // answers such a call only once its ladder has run, as an engine refused; the one other
      // ending read in main today is its logger failing on that very line, after which the call is
      // rejected with the logger's error, the ladder having run too. Either way the engine has had
      // main's whole ladder by the time the call returns: alive after the wait, it was left running.
      const refusedByMain =
        refusal !== undefined || (got.kind === "thrown" && got.state === "engine-refused");
      const verdict: Verdict =
        got.kind === "answer" && planted?.plantAtAnswer() === true
          ? red("main started an engine whose folder held a stream file")
          : refusedByMain && planted?.alive() === true
            ? red("the refused engine was left running")
            : folder?.verdict === "red"
              ? folder
              : unplanted !== null
                ? blind(`the control's file could not be planted (${unplanted})`)
                : got.kind === "answer"
                  ? blind("the control's call was answered: the control proved nothing")
                  : got.state !== "engine-refused"
                    ? blind(`the control was refused as ${got.state}, not by the stream check`)
                    : planted === undefined || folder === undefined
                      ? blind("the control was refused before any engine was started")
                      : refusal?.reason !== "stream-on"
                        ? blind(
                            `main refused the planted engine for ${refusal?.reason ?? "no reason said"}`,
                          )
                        : !planted.plantAtAnswer()
                          ? blind(
                              "the planted file was not in the folder when main refused the engine",
                            )
                          : folder;
      settle("control", verdict, {
        refused: refusal?.reason ?? null,
        plantAtAnswer: planted?.plantAtAnswer() ?? false,
        exited: planted === undefined ? null : !planted.alive(),
      });

      // LATCH: after a stream that was on, no engine is started. An engine started, or a call
      // answered, is the latch read to be false: red.
      if (verdict.verdict === "ok") {
        const held = witness.engines().length;
        const next = await call(PAGES_RUN_LATCH, { action: "navigate", url: fixture.url });
        const newSpawns = witness.engines().length - held;
        settle(
          "latch",
          newSpawns > 0
            ? red("an engine was started after a stream that was on")
            : next.kind === "answer"
              ? red("the call after the refusal was answered")
              : next.state !== "engine-refused"
                ? blind(`the call after the refusal was refused as ${next.state}`)
                : OK,
          { refused: next.kind === "thrown" ? next.state : null, newSpawns },
        );
      }
    }
  }

  // STOP: the product's own, always asked for
  let stopped = true;
  try {
    await door.stop();
  } catch {
    stopped = false;
  }
  const { unended } = await witness.settled(exitWaitMs);
  const lines = witness.said();
  const brokerStop = lines.some((l) => l.event === "pages.broker.stop");
  const unendedSaid = lines.some((l) => l.event === "pages.engine.unended");
  const rootsLeft = witness.engines().filter((e) => e.rootLeft()).length;
  let censusEngines: number | null;
  try {
    censusEngines = enginesIn(census());
  } catch {
    censusEngines = null;
  }
  settle(
    "stop",
    unended > 0 || unendedSaid || (censusEngines ?? 0) > 0
      ? red("the product left its engine to the smoke's teardown")
      : rootsLeft > 0
        ? red("an engine's root was left after the product's stop")
        : !stopped
          ? blind("the product's stop threw")
          : censusEngines === null
            ? blind("the run's census could not be read")
            : !brokerStop
              ? blind("main said no stop line for its pages broker")
              : OK,
    { brokerStop, unended, censusEngines, rootsLeft },
  );

  // ENGINES: every engine the witness was told of, whichever leg started it, over its whole life.
  // One main leased is counted read by read by its own connection to the bridge; one it never
  // leased was never attached, and its listeners alone are judged, by what main said of it. Every
  // read that was begun of an engine is waited for before that engine is judged.
  const each: { verdict: Verdict; facts: Record<string, unknown> }[] = [];
  for (const e of witness.engines()) {
    await witness.drained(e);
    const lease = leased(e);
    const stream = e.stream();
    const sockets = lease ? e.tcp(control.bridge) : e.listeners();
    const verdict = joinVerdicts([
      e.fileIs(fixture.engineIs) ? OK : red("the spawned file is not the stager's copy"),
      e.identity(),
      stream,
      sockets,
      e.pidFile(),
      e.alive() ? blind("an engine had not exited when it was judged") : OK,
      // main's lines carry no engine's name and are laid to the newest: an engine it never said
      // ready that holds a connection to its bridge says they were laid to another
      !lease && e.attached(control.bridge)
        ? blind(
            "an engine main never said ready shows a connection to main's bridge: its lines were laid to another engine",
          )
        : OK,
    ]);
    each.push({
      verdict,
      facts: {
        run: e.run,
        planted: e.planted,
        leased: lease,
        answer: e.answered(),
        verdict: verdict.verdict,
        lifeMs: stream.lifeMs,
        polls: stream.polls,
        holes: stream.holes,
        maxGapMs: stream.maxGapMs,
        socketSeen: stream.socketSeen,
        plantSeen: stream.plantSeen,
        // the reads its verdict stands on, the reads set aside, and the reads inside its life that
        // count for nothing (a leased engine's bare reads; an unleased one's unborne reads)
        reads: "counted" in sockets ? sockets.counted : sockets.inside,
        setAside: sockets.discarded,
        unborne: "counted" in sockets ? sockets.bare : sockets.unborne,
        // for a leased engine, from its last counted read to its EXIT
        tailMs: "counted" in sockets ? sockets.tailMs : null,
      },
    });
  }
  // a testing hook that threw told the witness of no engine at that spawn: main says so, and an
  // engine nobody watched is judged by nobody
  const hookThrew = witness.said().filter((l) => l.event === "pages.engine.hook").length;
  settle(
    "engines",
    each.length === 0
      ? blind("the witness was told of no engine")
      : joinVerdicts([
          ...each.map((x) => x.verdict),
          hookThrew > 0
            ? blind(
                "main said its testing hook threw: an engine it started may be watched by nobody",
              )
            : OK,
        ]),
    { hookThrew, engines: each.map((x) => x.facts) },
  );

  const run = pagesVerdict(legs, whys);
  const spawns = witness.engines().length;
  o.say(
    `SMOKE_PAGES ${JSON.stringify({
      verdict: run.verdict,
      legs,
      spawns,
      ...(run.why === undefined ? {} : { why: run.why }),
    })}`,
  );
  return { ...run, legs, spawns };
}
