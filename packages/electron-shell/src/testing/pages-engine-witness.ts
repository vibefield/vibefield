// Item 658 (2026-11-26) — THE PAGE ENGINE'S WITNESS, the pages smoke's alone. Main makes it only
// when it started unpackaged, in the canvas smoke, with the smoke's run mark AND the `--pages` flag
// (pagesWitnessAsked, pages/broker/index.ts). It is told each engine child through the supervisor's
// `onSpawned` hook, which production never passes, and watches that child for its whole life from
// main's own process, independently of main's one look at the engine's folder at ready:
// - the file that was spawned is hashed and held to the record's source build;
// - its whole root is read every 100 ms, from the spawn to the exit, for a `.stream` file, with one
//   more read at its first answer to main and one at its exit, taken before main's own exit
//   listener removes the root. A read that failed, that met a symbolic link (what lies behind one
//   is not read) or that was cut at its bound is kept as a hole, never as a read that saw no
//   stream file;
// - its TCP sockets are read from the spawn: the watch's own reads half a second apart, and the
//   smoke's legs ask for more between them, each waited read behind the one before it. Its UDP
//   sockets and its unix sockets are read when the smoke asks. No waited read is begun once the
//   child's exit was seen: the pid is the system's to hand out again;
// - an engine main REFUSES is ended by main's ladder at once (54 ms from its spawn on the run that
//   showed it), and a waited read is a process of its own that takes longer. So it is read inside
//   main's own refusal line, before that line returns and so before the ladder: its TCP sockets,
//   then its unix sockets, each at once, beside whatever waited read is under way. The TCP read
//   counts only when the unix read after it still shows the session's socket: lsof says "no
//   sockets" of a process that is gone. Main's thread stands still for those two reads, in this
//   smoke alone;
// - a process that is not main is sent to its socket, between two of main's own lines. Then main
//   holds one connection to that socket open while the kernel's lists of main's own unix sockets
//   and of the child's are read: a socket of main's must name a socket of the child's as its peer.
//   The child's list must also hold a socket BOUND at the session's path, which says where it was
//   bound and no more;
// - for the control leg, a `.stream` file is planted in its socket's folder at the spawn, so the
//   PRODUCT's own check must refuse that engine.
// Main's lines are laid to the NEWEST engine it was told of: they carry no engine's name, and one
// start at a time is the smoke's own order. An engine main never said ready whose reads show a
// connection to main's bridge gives that away (`attached`).
// Every engine is kept by its child object: a run's generations start from one again after a stop.
// No pid and no kernel address leaves this module: what is said is a verdict, a count, an address
// of the network, or a file's place in the engine's own root. The hook never throws: it runs
// inside the supervisor's start.
//
// Every line it sends an engine is `session_info`, which the engine answers without a browser: an
// action that needs one makes the engine start a browser of its own when it holds none.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { dirname, join, relative } from "node:path";
import { PAGES_ENGINE_RECORD } from "@vibefield/contracts/pages-record";
import { daemonRequestId, exchangeDaemon } from "../main/pages/broker/daemon-client";
import { sha256OfRegularFile } from "../main/pages/broker/engine-identity";
import type { EngineChild, EngineSpawned } from "../main/pages/broker/engine-supervisor";
import {
  PAGES_ENGINE_PATH,
  type PagesSurroundings,
  SMOKE_RUN_ENV,
} from "../main/pages/broker/surroundings";
import { readSockets, readSocketsNow, type SocketRead } from "./pages-listeners";
import {
  type CensusRow,
  type EngineSample,
  type FolderRead,
  joinVerdicts,
  judgeCensus,
  judgeCensusAfterExit,
  judgeEngineListeners,
  judgeEngineTcp,
  judgePeer,
  judgePeerTie,
  judgePidFile,
  judgeSocketHeld,
  judgeStreamPolls,
  judgeUdp,
  type MainExchange,
  type PeerProbe,
  type PidFile,
  showsBridge,
  type Verdict,
} from "./pages-witness-judge";

/** The control leg's planted file: a `.stream` name that is not the session's, so the engine can
 * take it for no file of its own. Main's check counts any `.stream` in the folder. */
export const PAGES_WITNESS_PLANT = "control.stream";
/** How often an engine's whole root is read while it lives. */
export const WITNESS_POLL_MS = 100;
export const WITNESS_TCP_GAP_MS = 500;
/** The most files one read of a root lists: a root holding more is not read whole, and says so. */
export const WITNESS_ROOT_WALK_MAX = 2000;
export const WITNESS_LINE_MS = 5000;
export const WITNESS_PROBE_MS = 4000;

/** The foreign process: connects, writes ONE line, and says what it saw. Run as node by the same
 * executable that runs main, from an argument, so no file of it is built or left. */
export const PAGES_WITNESS_PROBE = [
  'const net = require("node:net");',
  "const [path, bound] = process.argv.slice(-2);",
  "const out = { connected: false, wrote: false, bytesRead: 0, closed: false, error: null, ms: 0 };",
  "const t0 = Date.now();",
  "let done = false;",
  "let late = false;",
  "const finish = () => {",
  "  if (done) return;",
  "  done = true;",
  "  out.ms = Date.now() - t0;",
  '  process.stdout.write(JSON.stringify(out) + "\\n", () => process.exit(0));',
  "};",
  "const s = net.createConnection(path);",
  's.on("connect", () => {',
  "  out.connected = true;",
  '  s.write(JSON.stringify({ id: "probe", action: "session_info" }) + "\\n", (e) => {',
  "    if (!e) out.wrote = true;",
  "  });",
  "});",
  's.on("data", (c) => {',
  "  out.bytesRead += c.length;",
  "});",
  's.on("error", (e) => {',
  '  out.error = e.code || "error";',
  "});",
  's.on("close", () => {',
  "  if (out.connected && !late) out.closed = true;",
  "  finish();",
  "});",
  "setTimeout(() => {",
  "  late = true;",
  "  s.destroy();",
  "  finish();",
  "}, Number(bound));",
].join("\n");

export type SpawnProbe = (
  file: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
) => Promise<PeerProbe | null>;

/** What main's own line to an engine came to, with what the engine said of itself held to the
 * child HERE: its pid is compared in this module and never told. */
export interface ControlAnswer {
  readonly exchange: MainExchange;
  readonly pid: "match" | "other" | "unsaid";
  readonly browser: boolean | null;
}

export interface PagesEngineWitnessDeps {
  /** the smoke run's mark, given to the probe so the house census sees it */
  readonly mark?: string | undefined;
  /** the source build's sum for this host; absent: the record's */
  readonly sourceBuildSha256?: string | null;
  readonly now?: () => number;
  readonly readSockets?: (kind: "tcp" | "udp" | "unix", pid: number) => Promise<SocketRead>;
  /** the same read taken at once, for an engine main refuses */
  readonly readSocketsNow?: (kind: "tcp" | "unix", pid: number) => SocketRead;
  readonly exchange?: typeof exchangeDaemon;
  readonly spawnProbe?: SpawnProbe;
  readonly execPath?: string;
  readonly probeMs?: number;
  /** main's own pid, whose unix sockets the peer leg reads; absent: this process's */
  readonly mainPid?: number;
  /** a connection of main's to a unix socket, held open until let go; null when none could be made */
  readonly connect?: HoldOpen;
}

/** A connection held open and nothing sent on it. */
export type HoldOpen = (path: string) => Promise<{
  close(): void;
  readonly fd: number | null;
  /** whether the connection's descriptor is still its own: not given back, by a close here or by
   * the other end letting go */
  open(): boolean;
} | null>;

/** What main said of an engine: nothing, its ready line, a refusal after its spawn, or that it took
 * the ready connect and was gone. */
export type EngineAnswer = "none" | "ready" | "refused" | "gone";

/** One of main's pages log lines: the part's own event name (main's `desktop.` taken off), its
 * `reason` field, and the ready line's `identity`. No other field is kept. */
export interface WitnessedLine {
  readonly event: string;
  readonly reason: string | null;
  readonly identity: string | null;
}

/** One engine main spawned, as the witness watched it. */
export interface WitnessedEngine {
  readonly run: string;
  readonly generation: number;
  readonly planted: boolean;
  alive(): boolean;
  /** main's pages log lines said while this engine was the newest and lived, by the part's own name */
  lines(): readonly WitnessedLine[];
  /** whether the file that was spawned is the one whose path has this SHA-256 (hex): the asker
   * holds a digest and never the path, and the path itself is never told */
  fileIs(pathSha256: string): boolean;
  /** whether the engine's root is still on disk */
  rootLeft(): boolean;
  /** whether the control's planted file was in the socket's folder at the engine's first answer */
  plantAtAnswer(): boolean;
  /** the code of the error that kept the control's file from being planted, or null */
  plantFailed(): string | null;
  /** no more TCP reads are started: the smoke is about to close this engine */
  quiet(): void;
  identity(): Verdict;
  stream(): ReturnType<typeof judgeStreamPolls>;
  pidFile(): Verdict;
  /** for an engine main leased: every read counted by its own connection to the bridge */
  tcp(bridge: string | null): ReturnType<typeof judgeEngineTcp>;
  /** for an engine main never leased: its listeners alone, judged by what main said of it */
  listeners(): ReturnType<typeof judgeEngineListeners>;
  /** every UDP read, borne out by a later read that shows the connection to this bridge */
  udp(bridge: string | null): Verdict;
  /** whether any read of its sockets showed its own connection to this bridge */
  attached(bridge: string | null): boolean;
  /** what main said of it */
  answered(): EngineAnswer;
  census(rows: readonly CensusRow[]): Verdict;
}

/** The peer leg's word, with what it timed, what main's own line came to on either side, and the
 * kernel's tie as counts: how many of main's unix sockets name a peer by its kernel address, how
 * many name the session's socket by its path, how many unix sockets the child holds. */
export type PeerVerdict = Verdict & {
  readonly foreignMs: number | null;
  readonly mainBefore: MainExchange;
  readonly mainAfter: MainExchange;
  readonly tie: "ok" | "blind";
  readonly mainPeers: number | null;
  readonly mainByPath: number | null;
  readonly childSockets: number | null;
  /** main's sockets whose peer is a socket of the child's: the held connection, and any other */
  readonly ties: number | null;
};

export interface PagesEngineWitness {
  readonly onSpawned: (
    run: string,
    generation: number,
    child: EngineChild,
    spawned: EngineSpawned,
  ) => void;
  /** main's pages log lines, as main says them (under its `desktop.` name, or the part's own) */
  line(event: string, fields: Readonly<Record<string, unknown>>): void;
  /** every line told, in order, whichever engine it was said of or none */
  said(): readonly { readonly event: string; readonly reason: string | null }[];
  /** the NEXT engine spawned for this run gets the control's stream file planted at its spawn */
  plantFor(run: string): void;
  engines(): readonly WitnessedEngine[];
  control(engine: WitnessedEngine): Promise<ControlAnswer>;
  sample(engine: WitnessedEngine): Promise<void>;
  readUdp(engine: WitnessedEngine): Promise<void>;
  /** every read of this engine that was begun has ended and is in its verdicts */
  drained(engine: WitnessedEngine): Promise<void>;
  probePeer(engine: WitnessedEngine): Promise<PeerVerdict>;
  /** waits for every engine's exit, up to the bound: how many have not ended */
  settled(withinMs: number): Promise<{ readonly unended: number }>;
  dispose(): void;
}

interface Watched {
  readonly child: EngineChild;
  readonly file: string;
  readonly surroundings: PagesSurroundings;
  readonly spawnedAt: number;
  readonly plant: string | null;
  readonly plantError: string | null;
  readonly reads: FolderRead[];
  readonly samples: EngineSample[];
  readonly lines: WitnessedLine[];
  readonly udp: EngineSample[];
  exitedAt: number | null;
  answeredAt: number | null;
  /** main's first word of it after its spawn: ready, or a refusal for its stream */
  answer: "ready" | "refused" | null;
  /** main said it took a connect of main's and main read nothing of it: the ready connect, after
   * which it was gone, or the close of an engine that was not ready in time */
  gone: boolean;
  plantAtAnswer: boolean;
  pidFile: PidFile;
  quiet: boolean;
  chain: Promise<void>;
  timer: ReturnType<typeof setInterval> | null;
}

const runProbe: SpawnProbe = (file, args, env) =>
  new Promise((resolve) => {
    execFile(
      file,
      [...args],
      { env: { ...env }, timeout: 15_000, maxBuffer: 64 * 1024, encoding: "utf8" },
      (error, stdout) => {
        if (error !== null) {
          resolve(null);
          return;
        }
        try {
          const said = JSON.parse(String(stdout).trim().split("\n").pop() ?? "") as PeerProbe;
          resolve(typeof said.bytesRead === "number" ? said : null);
        } catch {
          resolve(null);
        }
      },
    );
  });

/** The refusals main says of an engine it HAS spawned: its stream was on, or its folder could not
 * be read for one. Every other refusal is said before any child exists. */
const REFUSED_AFTER_SPAWN: readonly string[] = ["stream-on", "stream-unread"];

export const holdPagesSocketOpen: HoldOpen = (path) =>
  new Promise((resolve) => {
    const socket = createConnection(path);
    const none = () => {
      socket.destroy();
      resolve(null);
    };
    const bound = setTimeout(none, WITNESS_LINE_MS);
    socket.once("error", () => {
      clearTimeout(bound);
      none();
    });
    socket.once("connect", () => {
      clearTimeout(bound);
      // an engine that drops it is the engine's to do: a later error is nobody's to hear
      socket.on("error", () => undefined);
      // ... but whether its number is still ITS number is said (item 658, 2026-11-27): the tie is
      // found by this connection's descriptor, and one that was given back may be another socket's
      // by then. Node gives the descriptor back when it destroys the socket, here or because the
      // other end let go; until then the number is this connection's, whatever the other end did.
      // The connection's own descriptor in this process, as node's handle of a pipe says it: what
      // lsof's FD column says of the same socket. Node documents no way to read it, so anything
      // but a whole number is no descriptor, and the tie that needs one is then blind.
      const handle = (socket as { readonly _handle?: { readonly fd?: unknown } | null })._handle;
      const fd = handle?.fd;
      resolve({
        close: () => socket.destroy(),
        fd: typeof fd === "number" && Number.isInteger(fd) && fd >= 0 ? fd : null,
        open: () => !socket.destroyed,
      });
    });
  });

/** Every file's place under `root`, never through a link. `complete` is false when a folder could
 * not be read (the root itself gone included), when the root is no folder of its own (a link to
 * one included), when a symbolic link was met anywhere under it, or when the root holds more than
 * the bound: such a read saw only part of what the engine may write to, and what it did see is
 * still said. A link is listed by its own name and never followed. */
function walk(root: string): { readonly names: string[]; readonly complete: boolean } {
  const names: string[] = [];
  let complete = true;
  try {
    if (!lstatSync(root).isDirectory()) return { names, complete: false };
  } catch {
    return { names, complete: false };
  }
  const todo = [root];
  while (todo.length > 0) {
    if (names.length > WITNESS_ROOT_WALK_MAX) {
      complete = false;
      break;
    }
    const dir = todo.pop() as string;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      complete = false;
      continue;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        todo.push(path);
        continue;
      }
      names.push(relative(root, path));
      // what lies behind a link was not read: a folder the engine writes through one is unseen
      if (entry.isSymbolicLink()) complete = false;
    }
  }
  return { names, complete };
}

const errorCode = (error: unknown): string =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : "an unknown error";

export function createPagesEngineWitness(deps: PagesEngineWitnessDeps = {}): PagesEngineWitness {
  const now = deps.now ?? Date.now;
  const read = deps.readSockets ?? ((kind, pid) => readSockets(kind, pid));
  const readNow = deps.readSocketsNow ?? ((kind, pid) => readSocketsNow(kind, pid));
  const exchange = deps.exchange ?? exchangeDaemon;
  const spawnProbe = deps.spawnProbe ?? runProbe;
  const connect = deps.connect ?? holdPagesSocketOpen;
  const mainPid = deps.mainPid ?? process.pid;
  const host = `${process.platform}-${process.arch}`;
  const want =
    deps.sourceBuildSha256 === undefined
      ? ((PAGES_ENGINE_RECORD.sourceBuild.binarySha256 as Record<string, string>)[host] ?? null)
      : deps.sourceBuildSha256;
  const watched: Watched[] = [];
  const faces: WitnessedEngine[] = [];
  const byFace = new Map<WitnessedEngine, Watched>();
  const plants = new Set<string>();
  const said: { event: string; reason: string | null }[] = [];

  const of = (engine: WitnessedEngine): Watched => {
    const w = byFace.get(engine);
    if (w === undefined) throw new Error("not an engine of this witness");
    return w;
  };

  /** One read of the child's sockets, behind every read already asked for: one at a time. Once the
   * child's exit was seen nothing is run: the read is kept as one that fell outside its life. */
  const readOnce = (
    w: Watched,
    kind: "tcp" | "udp" | "unix",
    keep: (sample: EngineSample) => void,
  ): Promise<void> => {
    w.chain = w.chain.then(async () => {
      const pid = w.child.pid;
      if (pid === undefined) return;
      const startedAt = now();
      if (w.exitedAt !== null) {
        keep({
          startedAt,
          endedAt: startedAt,
          exitedBefore: true,
          exitedAfter: true,
          read: { seen: "blind", why: "the child had exited" },
        });
        return;
      }
      const got = await read(kind, pid).catch(
        (): SocketRead => ({ seen: "blind", why: "the read failed" }),
      );
      keep({
        startedAt,
        endedAt: now(),
        exitedBefore: false,
        exitedAfter: w.exitedAt !== null,
        read: got,
      });
    });
    return w.chain;
  };

  const sampleOnce = (w: Watched): Promise<void> =>
    readOnce(w, "tcp", (sample) => {
      w.samples.push(sample);
    });

  const sampling = async (w: Watched): Promise<void> => {
    while (w.exitedAt === null && !w.quiet) {
      await sampleOnce(w);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, WITNESS_TCP_GAP_MS).unref?.();
      });
    }
  };

  /** AN ENGINE MAIN REFUSES, read inside main's own refusal line: its TCP sockets and then its unix
   * sockets, each at once, so both are taken before the line returns and main's ladder begins. The
   * TCP read is kept with what the unix read after it said of the session's socket: shown, read
   * and not shown (lsof's answer of a process that is gone), or not read at all, which is not the
   * same thing. Never thrown: the caller is main's own log call, which has already let go of an
   * engine whose exit was seen. */
  const readRefused = (w: Watched): void => {
    const pid = w.child.pid;
    if (pid === undefined) return;
    const at = (kind: "tcp" | "unix"): SocketRead => {
      try {
        return readNow(kind, pid);
      } catch {
        return { seen: "blind", why: "the read failed" };
      }
    };
    const startedAt = now();
    const tcp = at("tcp");
    const after: EngineSample = {
      startedAt,
      endedAt: now(),
      exitedBefore: false,
      exitedAfter: false,
      read: at("unix"),
    };
    const alive =
      after.read.seen !== "read"
        ? "unread"
        : judgeSocketHeld(after, w.surroundings.socketPath).verdict === "ok"
          ? "shown"
          : "not-shown";
    w.samples.push({
      startedAt,
      endedAt: now(),
      exitedBefore: false,
      // for every judge but the refused engine's own, this read is one inside its life only if tied
      exitedAfter: alive !== "shown",
      read: tcp,
      alive,
    });
  };

  /** One read of the engine's whole root. */
  const look = (w: Watched): FolderRead => {
    const got = walk(w.surroundings.root);
    const seen: FolderRead = { at: now(), names: got.names, complete: got.complete };
    w.reads.push(seen);
    const run = dirname(w.surroundings.socketPath);
    const pidFile = `${w.surroundings.session}.pid`;
    if (
      w.pidFile !== "other" &&
      seen.names.includes(relative(w.surroundings.root, join(run, pidFile)))
    ) {
      try {
        const said = Number(readFileSync(join(run, pidFile), "utf8").trim());
        w.pidFile = said === w.child.pid ? "match" : "other";
      } catch {
        // gone between the read of the folder and of the file: the next read says
      }
    }
    return seen;
  };

  const stop = (w: Watched): void => {
    if (w.timer !== null) clearInterval(w.timer);
    w.timer = null;
  };

  return {
    onSpawned(run, generation, child, spawned) {
      const s = spawned.surroundings;
      let plant: string | null = null;
      let plantError: string | null = null;
      if (plants.delete(run)) {
        const path = join(dirname(s.socketPath), PAGES_WITNESS_PLANT);
        plant = relative(s.root, path);
        try {
          writeFileSync(path, "", { mode: 0o600, flag: "wx" });
        } catch (error) {
          // never thrown into the supervisor's start: said, and the control is blind on it
          plantError = errorCode(error);
        }
      }
      const w: Watched = {
        child,
        file: spawned.file,
        surroundings: s,
        spawnedAt: now(),
        plant,
        plantError,
        reads: [],
        samples: [],
        lines: [],
        udp: [],
        exitedAt: null,
        answeredAt: null,
        answer: null,
        gone: false,
        plantAtAnswer: false,
        pidFile: "none",
        quiet: false,
        chain: Promise.resolve(),
        timer: null,
      };
      const face: WitnessedEngine = {
        run,
        generation,
        planted: plant !== null,
        alive: () => w.exitedAt === null,
        lines: () => [...w.lines],
        fileIs: (pathSha256) => createHash("sha256").update(w.file).digest("hex") === pathSha256,
        rootLeft: () => existsSync(s.root),
        plantAtAnswer: () => w.plantAtAnswer,
        plantFailed: () => w.plantError,
        quiet: () => {
          w.quiet = true;
        },
        identity: () => {
          if (want === null)
            return { verdict: "blind", why: "the record names no source build for this host" };
          const sum = sha256OfRegularFile(w.file);
          if (sum === null)
            return { verdict: "blind", why: "the spawned file could not be read as a file" };
          return sum === want
            ? { verdict: "ok" }
            : { verdict: "red", why: "the spawned file is not the recorded source build" };
        },
        stream: () =>
          judgeStreamPolls({
            spawnedAt: w.spawnedAt,
            exitedAt: w.exitedAt,
            endedAt: now(),
            reads: w.reads,
            socket: relative(s.root, s.socketPath),
            // a file of the plant's name the witness could not write is no plant of its own: it is
            // a stream file in the engine's folder, and is read as one
            plant: w.plantError === null ? w.plant : null,
            answeredAt: w.answeredAt,
          }),
        pidFile: () => judgePidFile(w.pidFile),
        tcp: (bridge) =>
          judgeEngineTcp(w.samples, bridge, {
            spawnedAt: w.spawnedAt,
            endedAt: w.exitedAt ?? now(),
          }),
        listeners: () =>
          judgeEngineListeners(
            w.samples,
            w.gone || w.answer === "ready"
              ? "answered-gone"
              : w.answer === "refused"
                ? "refused"
                : "unanswered",
          ),
        udp: (bridge) => judgeUdp(w.udp, w.samples, bridge),
        attached: (bridge) => w.samples.some((sample) => showsBridge(sample.read, bridge)),
        answered: () => (w.gone ? "gone" : (w.answer ?? "none")),
        census: (rows) =>
          w.child.pid === undefined
            ? { verdict: "blind", why: "the child has no pid" }
            : w.exitedAt !== null
              ? judgeCensusAfterExit(rows, w.child.pid)
              : judgeCensus(rows, w.child.pid),
      };
      watched.push(w);
      faces.push(face);
      byFace.set(face, w);
      const gone = () => {
        if (w.exitedAt !== null) return;
        // one last look before the exit is marked: the root as the engine left it
        look(w);
        w.exitedAt = now();
        stop(w);
      };
      // AHEAD of the supervisor's own exit listener, which is on the child already and removes the
      // root: a listener after it would look at a root that is gone
      child.prependOnceListener("exit", gone);
      child.prependOnceListener("error", gone);
      look(w);
      w.timer = setInterval(() => look(w), WITNESS_POLL_MS);
      void sampling(w);
    },
    line(told, fields) {
      const event = told.startsWith("desktop.") ? told.slice("desktop.".length) : told;
      const reason = typeof fields.reason === "string" ? fields.reason : null;
      said.push({ event, reason });
      const w = watched.at(-1);
      if (w === undefined) return;
      // An engine that took main's ready connect and was gone: main says so after its exit, of the
      // engine it has just waited on. It ANSWERED main, at the latest when it exited.
      if (event === "pages.engine.unready" && fields.answered === "yes") {
        w.gone = true;
        if (w.answeredAt === null) w.answeredAt = w.exitedAt ?? now();
      }
      // A close of main's that the engine TOOK. Main ends an engine that was not ready in time by
      // its ladder, whose first rung is a `close` sent to the engine's socket: an engine with no
      // answer yet that took that connect ANSWERED main, and nothing of it is waived. Main's line
      // says `timeout` alike for a deadline with the command written and for one whose connect
      // never came, so a timeout is read as taken; `not-sent` alone says the engine never saw it.
      // The line can follow the engine's exit, as the unready line does: it left on that close.
      if (
        event === "pages.engine.close" &&
        typeof fields.answered === "string" &&
        fields.answered !== "not-sent" &&
        w.answer === null &&
        !w.gone
      ) {
        w.gone = true;
        if (w.answeredAt === null) w.answeredAt = w.exitedAt ?? now();
      }
      // every other line is the newest engine's while that engine lives; after its exit, no engine's
      if (w.exitedAt !== null) return;
      const identity = typeof fields.identity === "string" ? fields.identity : null;
      w.lines.push({ event, reason, identity });
      // The ready line, and a refusal for its stream, both follow the engine's first answer to main:
      // the socket it answered on is in its folder now, so the folder is read here, before main's
      // ladder can end an engine it refuses. A poll alone would miss an engine that answers and
      // ends inside one gap. A refusal for anything else is said before main spawns a child: it is
      // no answer of an older engine that happens to live.
      const answer =
        event === "pages.engine.ready"
          ? "ready"
          : event === "pages.engine.refused" && REFUSED_AFTER_SPAWN.includes(reason ?? "")
            ? "refused"
            : null;
      if (answer === null || w.answeredAt !== null) return;
      const seen = look(w);
      w.plantAtAnswer = w.plant !== null && seen.names.includes(w.plant);
      w.answeredAt = now();
      w.answer = answer;
      // main's ladder ends an engine it refuses as soon as this returns
      if (answer === "refused") readRefused(w);
    },
    said: () => [...said],
    plantFor(run) {
      plants.add(run);
    },
    engines: () => [...faces],
    async control(engine) {
      const w = of(engine);
      const got = await exchange(
        w.surroundings.socketPath,
        { id: daemonRequestId(now), action: "session_info" },
        { deadlineAt: now() + WITNESS_LINE_MS },
      );
      if (!got.ok) return { exchange: "unanswered", pid: "unsaid", browser: null };
      if (got.reply.success !== true) return { exchange: "refused", pid: "unsaid", browser: null };
      const data = (got.reply.data ?? {}) as Record<string, unknown>;
      const said = data.backgroundPid;
      return {
        exchange: "answered",
        pid: typeof said !== "number" ? "unsaid" : said === w.child.pid ? "match" : "other",
        browser: typeof data.browserLaunched === "boolean" ? data.browserLaunched : null,
      };
    },
    sample: (engine) => sampleOnce(of(engine)),
    readUdp(engine) {
      const w = of(engine);
      // every read is kept: a later one never stands in for an earlier one
      return readOnce(w, "udp", (sample) => {
        w.udp.push(sample);
      });
    },
    async drained(engine) {
      const w = of(engine);
      // a read asked for while this waits is waited for too
      let seen: Promise<void>;
      do {
        seen = w.chain;
        await seen;
      } while (seen !== w.chain);
    },
    async probePeer(engine) {
      const w = of(engine);
      const before = await this.control(engine);
      const env: Record<string, string> = { ELECTRON_RUN_AS_NODE: "1", PATH: PAGES_ENGINE_PATH };
      if (deps.mark !== undefined && deps.mark !== "") env[SMOKE_RUN_ENV] = deps.mark;
      const probe = await spawnProbe(
        deps.execPath ?? process.execPath,
        [
          "-e",
          PAGES_WITNESS_PROBE,
          w.surroundings.socketPath,
          String(deps.probeMs ?? WITNESS_PROBE_MS),
        ],
        env,
      ).catch(() => null);
      const after = await this.control(engine);
      // The kernel's own lists, where what the answering process says of its pid is its word alone.
      // Main holds ONE connection to the session's socket open and sends nothing on it, while its
      // own unix sockets and then the child's are read: lsof names a connected socket by its peer's
      // kernel address, so the line of main's that IS that connection, found by the connection's
      // own descriptor, must name a socket the child holds.
      const kernel: { sample: EngineSample | null } = { sample: null };
      let mainRead: SocketRead | null = null;
      // asked AFTER both lists were read: the line found by the connection's number is that
      // connection's only if the connection was still open then
      let stillHeld = false;
      const held0 = await connect(w.surroundings.socketPath).catch(() => null);
      try {
        if (held0 !== null) {
          mainRead = await read("unix", mainPid).catch(
            (): SocketRead => ({ seen: "blind", why: "the read failed" }),
          );
        }
        await readOnce(w, "unix", (sample) => {
          kernel.sample = sample;
        });
        stillHeld = held0?.open() === true;
      } finally {
        held0?.close();
      }
      const whose: Verdict =
        before.pid === "other" || after.pid === "other"
          ? {
              verdict: "blind",
              why: "the socket is answered by another process than the child main spawned",
            }
          : before.pid !== "match" || after.pid !== "match"
            ? {
                verdict: "blind",
                why: "the process that answers the socket did not say its pid: the socket is not held to the child",
              }
            : { verdict: "ok" };
      const held: Verdict =
        kernel.sample === null
          ? { verdict: "blind", why: "the child's unix sockets were not read" }
          : judgeSocketHeld(kernel.sample, w.surroundings.socketPath);
      const tie: ReturnType<typeof judgePeerTie> =
        mainRead === null
          ? {
              verdict: "blind",
              why: "main's own connection to the session's socket could not be held open",
              mainPeers: null,
              childSockets: null,
              ties: null,
            }
          : kernel.sample === null
            ? {
                verdict: "blind",
                why: "the child's unix sockets were not read",
                mainPeers: null,
                childSockets: null,
                ties: null,
              }
            : {
                ...judgePeerTie(mainRead, kernel.sample, held0?.fd ?? null),
                ...(stillHeld
                  ? {}
                  : {
                      verdict: "blind" as const,
                      why: "main's held connection was no longer open when it was asked, after both lists had been read",
                    }),
              };
      // how many of main's sockets name the session's socket by its PATH: a count, for a system
      // whose lsof names a peer so and by no kernel address
      const byPath = [`->${w.surroundings.socketPath}`, `->/private${w.surroundings.socketPath}`];
      const { mainPeers, childSockets, ties, ...tied } = tie;
      return {
        ...joinVerdicts([judgePeer(before.exchange, probe, after.exchange), whose, held, tied]),
        foreignMs: probe?.ms ?? null,
        mainBefore: before.exchange,
        mainAfter: after.exchange,
        tie: tie.verdict === "ok" ? "ok" : "blind",
        mainPeers,
        mainByPath:
          mainRead === null || mainRead.seen !== "read"
            ? null
            : mainRead.lines.filter((l) => byPath.includes(l.name)).length,
        childSockets,
        ties,
      };
    },
    async settled(withinMs) {
      const until = now() + withinMs;
      while (watched.some((w) => w.exitedAt === null) && now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return { unended: watched.filter((w) => w.exitedAt === null).length };
    },
    dispose() {
      for (const w of watched) {
        w.quiet = true;
        stop(w);
      }
    },
  };
}
