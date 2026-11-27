// Item 658 (2026-11-26) — THE PAGES SMOKE'S VERDICT RULES, on plain data: no process is read and
// nothing is run here. The smoke claims four things of the engine main starts: it is one process,
// with nothing beneath it; it holds no TCP listener; no `.stream` file shows in its folders for its
// whole life; and it answers no process but main. Each judge says ok, red or blind.
// - RED: the thing claimed is false, by something that was read.
// - BLIND: the row could not see what it claims (a tool that did not answer, a read with a hole,
//   a control that did not show). Blind is never ok: the smoke exits 2 on it, which a gate counts
//   red.
// A red is never hidden by a blind or an ok beside it (joinVerdicts), and what a verdict says is an
// address, a file's place in the engine's own root or a command's name: never a pid or a local path.
// What was seen and could not be judged is `said`, and a thing said is no judgment.

import type { SocketLine, SocketRead } from "./pages-listeners";

export interface Verdict {
  readonly verdict: "ok" | "red" | "blind";
  readonly why?: string;
  /** what was seen and is not judged, said for the record */
  readonly said?: readonly string[];
}

const red = (why: string): Verdict => ({ verdict: "red", why });
const blind = (why: string): Verdict => ({ verdict: "blind", why });

/** Red beats blind beats ok; the first of the worst kind speaks. Nothing judged is blind. What the
 * ok parts said is kept. */
export function joinVerdicts(parts: readonly Verdict[]): Verdict {
  const worst =
    parts.find((p) => p.verdict === "red") ?? parts.find((p) => p.verdict === "blind") ?? null;
  if (worst !== null) return worst;
  if (parts.length === 0) return blind("nothing was judged");
  const said = parts.flatMap((p) => p.said ?? []);
  return said.length === 0 ? { verdict: "ok" } : { verdict: "ok", said };
}

const LOOPBACK = "127.0.0.1:";

/** MAIN'S CONTROL. Main's bridge listens from the first pages call, so main's listeners after that
 * call must hold ONE loopback address its listeners before it did not: that shows the read sees a
 * listener when there is one, and names the bridge the engine's own connection is looked for at. */
export function judgeMainControl(
  before: SocketRead,
  after: SocketRead,
): Verdict & { readonly bridge: string | null } {
  if (before.seen !== "read" || after.seen !== "read") {
    return { ...blind("main's own listeners could not be read"), bridge: null };
  }
  const had = new Set(before.lines.filter((l) => l.state === "listen").map((l) => l.name));
  const fresh = after.lines
    .filter((l) => l.state === "listen" && !had.has(l.name) && l.name.startsWith(LOOPBACK))
    .map((l) => l.name);
  const bridge = fresh[0];
  if (bridge === undefined) {
    return {
      ...blind("main's bridge did not show as a new loopback listener: the read sees no listener"),
      bridge: null,
    };
  }
  if (fresh.length > 1) {
    return {
      ...blind("more than one new loopback listener showed in main: the bridge cannot be told"),
      bridge: null,
    };
  }
  return { verdict: "ok", bridge };
}

/** One read of the engine child's sockets, with whether the child had exited when the read began
 * and when it ended. A read taken at once inside main's refusal line, where no exit can be seen
 * while it runs, carries `alive`: what the read of the child's unix sockets taken after it said of
 * the session's socket. "shown": the child still held it. "not-shown": the read answered and the
 * socket was not in it, as lsof answers of a process that is gone. "unread": that read could not be
 * taken, so nothing is known. */
export interface EngineSample {
  readonly startedAt: number;
  readonly endedAt: number;
  readonly exitedBefore: boolean;
  readonly exitedAfter: boolean;
  readonly read: SocketRead;
  readonly alive?: "shown" | "not-shown" | "unread";
}

/** The fewest counted reads the engine's verdict stands on: the three the smoke makes by phase. */
export const ENGINE_TCP_MIN_READS = 3;

/** Every listener any read showed, by its address: one that straddles the exit was read too. */
function listenersIn(samples: readonly EngineSample[]): string[] {
  const out: string[] = [];
  for (const s of samples) {
    if (s.read.seen !== "read") continue;
    for (const l of s.read.lines) {
      if (l.state === "listen" && !out.includes(l.name)) out.push(l.name);
    }
  }
  return out;
}

const inside = (s: EngineSample): boolean => !s.exitedBefore && !s.exitedAfter;

/** Whether a read shows the engine's own ESTABLISHED connection to main's bridge: the one thing a
 * read can show that a process which is gone cannot. */
export const showsBridge = (read: SocketRead, bridge: string | null): boolean =>
  bridge !== null &&
  read.seen === "read" &&
  read.lines.some((l) => l.state === "established" && l.name.endsWith(`->${bridge}`));

/** THE ENGINE'S TCP SOCKETS, over every read of its life, for an engine main leased. Red on a
 * listener in ANY read. The control is PER READ: a read counts only when the child lived before
 * and after it AND it shows the engine's own connection to main's bridge. lsof's silence is also
 * what it gives for a process that is gone and not yet seen to exit, so a read that shows nothing
 * shows nothing of the listeners either: it is said (`bare`), never counted. Ok needs three counted
 * reads. What no counted read covers is said, never judged: the largest gap between two of them,
 * the stretch from the spawn to the first (`headMs`) and from the last to `life.endedAt`
 * (`tailMs`): the engine's exit once it has exited, and the moment of this judgment while it
 * lives. A listener opened and closed inside any of them is not seen. */
export function judgeEngineTcp(
  samples: readonly EngineSample[],
  bridge: string | null,
  life: { readonly spawnedAt: number; readonly endedAt: number },
): Verdict & {
  readonly counted: number;
  readonly bare: number;
  readonly discarded: number;
  readonly maxGapMs: number;
  readonly headMs: number | null;
  readonly tailMs: number | null;
  readonly listeners: readonly string[];
} {
  const listeners = listenersIn(samples);
  let counted = 0;
  let bare = 0;
  let discarded = 0;
  let maxGapMs = 0;
  let firstStart: number | null = null;
  let lastEnd: number | null = null;
  let blindRead = false;
  for (const s of samples) {
    if (!inside(s)) {
      discarded += 1;
      continue;
    }
    if (s.read.seen !== "read") {
      blindRead = true;
      continue;
    }
    if (!showsBridge(s.read, bridge)) {
      bare += 1;
      continue;
    }
    counted += 1;
    if (firstStart === null) firstStart = s.startedAt;
    if (lastEnd !== null) maxGapMs = Math.max(maxGapMs, s.startedAt - lastEnd);
    lastEnd = s.endedAt;
  }
  const facts = {
    counted,
    bare,
    discarded,
    maxGapMs,
    headMs: firstStart === null ? null : firstStart - life.spawnedAt,
    tailMs: lastEnd === null ? null : life.endedAt - lastEnd,
    listeners,
  };
  if (listeners.length > 0) {
    return { ...red(`the engine holds a TCP listener: ${listeners.join(", ")}`), ...facts };
  }
  if (blindRead) return { ...blind("a read of the engine's sockets did not answer"), ...facts };
  if (bridge === null) {
    return {
      ...blind("main's bridge is not known, so the engine's reads have no control"),
      ...facts,
    };
  }
  if (counted < ENGINE_TCP_MIN_READS) {
    return {
      ...blind(
        "fewer than three reads inside the engine's life showed its own connection to main's bridge",
      ),
      ...facts,
    };
  }
  return { verdict: "ok", ...facts };
}

/** What an engine main never leased is, by what main said of it. */
export type UnleasedEngine =
  /** it never answered main: never ready, and no line of main's says otherwise */
  | "unanswered"
  /** main refused it after its spawn, for its stream */
  | "refused"
  /** it took a connect of main's and main read nothing of it: the ready wait's, after which it was
   * gone, or the close main ends an engine that was not ready in time with */
  | "answered-gone";

const count = (n: number): string => `${n} read${n === 1 ? "" : "s"}`;

/** THE LISTENERS ALONE, for an engine main never leased: main never attached it to the bridge, so
 * no read of it can show the one thing that proves a read was of a living process. Red on a
 * listener in ANY read, whatever the engine is. Otherwise, by what it is:
 * - NEVER ANSWERED main: the reads that fell inside its life by the exit's own word are what there
 *   is. With one or more, ok, and the waiver is said; with none, blind.
 * - REFUSED: a second, NAMED waiver. Only a read taken at once in main's refusal line counts, and
 *   only when the read of its unix sockets after it showed the session's socket. A waited read
 *   that fell inside its life is said (`unborne`) and counts for nothing: lsof's silence is also
 *   what it gives for a process that is gone. A unix read that could not be taken is blind, never
 *   a read set aside. With one tied read, ok, and the waiver is said in its own words.
 * - ANSWERED AND GONE: no waiver. It answered main, so its reads need a control none can have. */
export function judgeEngineListeners(
  samples: readonly EngineSample[],
  engine: UnleasedEngine,
): Verdict & {
  /** the reads the verdict stands on */
  readonly inside: number;
  /** the reads set aside: outside its life, or taken at a refusal the unix read did not bear out */
  readonly discarded: number;
  /** the reads that fell inside its life and count for nothing, for want of anything to bear them */
  readonly unborne: number;
  readonly listeners: readonly string[];
} {
  const listeners = listenersIn(samples);
  let within = 0;
  let discarded = 0;
  let unborne = 0;
  let blindRead = false;
  let untied = false;
  for (const s of samples) {
    if (engine === "refused" && s.alive !== undefined) {
      if (s.alive === "unread") untied = true;
      else if (s.alive === "not-shown") discarded += 1;
      else if (s.read.seen !== "read") blindRead = true;
      else within += 1;
      continue;
    }
    if (!inside(s)) discarded += 1;
    else if (s.read.seen !== "read") blindRead = true;
    else if (engine === "unanswered") within += 1;
    else unborne += 1;
  }
  const facts = { inside: within, discarded, unborne, listeners };
  if (listeners.length > 0) {
    return { ...red(`the engine holds a TCP listener: ${listeners.join(", ")}`), ...facts };
  }
  if (engine === "answered-gone") {
    return {
      ...blind(
        "the engine answered main and was gone before main read it: no read of its sockets has a control",
      ),
      ...facts,
    };
  }
  if (blindRead) return { ...blind("a read of the engine's sockets did not answer"), ...facts };
  if (engine === "refused") {
    if (untied) {
      return {
        ...blind(
          "the read of the refused engine's unix sockets could not be taken: its TCP read is not known to be of a living engine",
        ),
        ...facts,
      };
    }
    if (within === 0) {
      return {
        ...blind(
          "no read of the refused engine's sockets was tied to its life by a read of its unix sockets after it",
        ),
        ...facts,
      };
    }
    return {
      verdict: "ok",
      said: [
        `${count(within)} of its sockets showed no listener; the refused engine's TCP read has no bridge positive control; its life is tied by the unix read`,
      ],
      ...facts,
    };
  }
  if (within === 0) {
    return {
      ...blind("no read of the engine's sockets fell wholly inside its life"),
      ...facts,
    };
  }
  return {
    verdict: "ok",
    said: [
      `${count(within)} of its sockets inside its life showed no listener; the engine never answered main, so none could bear the bridge control`,
    ],
    ...facts,
  };
}

/** THE UDP READS, every one that was taken. A socket bound with no peer could take a stream: red,
 * in any read that answered, whatever a later read shows. One with a peer is said. Ok needs every
 * read to have answered, to lie inside the child's life, and to be BORNE OUT: a read of the
 * engine's TCP sockets, begun after the UDP read ended and itself inside that life, must show the
 * engine's own connection to main's bridge. lsof's silence is also what it gives for a process that
 * is gone, and an exit not yet heard is no word that it lived. */
export function judgeUdp(
  udp: readonly EngineSample[],
  tcp: readonly EngineSample[],
  bridge: string | null,
): Verdict {
  const bound: string[] = [];
  const peers: string[] = [];
  for (const s of udp) {
    if (s.read.seen !== "read") continue;
    for (const l of s.read.lines) {
      const into = l.name.includes("->") ? peers : bound;
      if (!into.includes(l.name)) into.push(l.name);
    }
  }
  if (bound.length > 0) {
    return red(`the engine holds a UDP socket with no peer: ${bound.join(", ")}`);
  }
  if (udp.length === 0) return blind("the engine's UDP sockets were not read");
  if (udp.some((s) => s.read.seen !== "read")) {
    return blind("the engine's UDP sockets could not be read");
  }
  if (!udp.every(inside)) {
    return blind("the engine's UDP sockets were not read wholly inside its life");
  }
  const borne = (s: EngineSample): boolean =>
    tcp.some((t) => t.startedAt >= s.endedAt && inside(t) && showsBridge(t.read, bridge));
  if (!udp.every(borne)) {
    return blind("no read of the engine's sockets after its UDP read showed it alive");
  }
  return peers.length === 0 ? { verdict: "ok" } : { verdict: "ok", said: peers };
}

/** THE SOCKET'S HOLDER, by the kernel: the child main spawned holds a unix socket whose BOUND
 * address is the session's own path (`socket`, as main made it; the system may name the same place
 * under /private). Blind otherwise. This is the address the socket was bound at and nothing more:
 * a file put at that path by another process after the bind is not seen here. That main's own
 * connection ends at a socket of the child's is `judgePeerTie`'s. What it says holds no path. */
export function judgeSocketHeld(sample: EngineSample, socket: string): Verdict {
  if (sample.read.seen !== "read") return blind("the child's unix sockets could not be read");
  if (!inside(sample)) {
    return blind("the child's unix sockets were not read wholly inside its life");
  }
  const held = sample.read.lines.some((l) => l.name === socket || l.name === `/private${socket}`);
  return held
    ? { verdict: "ok" }
    : blind(
        "the child main spawned holds no unix socket at the session's own path: the socket is not tied to it",
      );
}

const PEER_ADDRESS = /^->(0x[0-9a-f]+)$/u;

/** MAIN'S HELD CONNECTION, TIED TO THE CHILD BY THE KERNEL'S OWN ADDRESSES. Read while main holds
 * one connection to the session's socket open: lsof names a connected unix socket by its peer's
 * kernel address, and gives every socket its own. THE LINE OF MAIN'S THAT IS THE HELD CONNECTION
 * is found by the connection's own descriptor (`heldFd`), and it must name as its peer a socket
 * the CHILD holds: the process that took that connection is then the child and no other. Another
 * socket of main's that names one of the child's says nothing of the connection the leg holds,
 * and is counted (`ties`) and not judged. Blind when the descriptor is not known, when it is the
 * descriptor of no line of main's or of two, when that line names no peer by a kernel address,
 * when its peer is no socket of the child's, on either read unanswered, and on a read of the
 * child that was not inside its life. What it says is three counts, never an address or a
 * descriptor. */
export function judgePeerTie(
  main: SocketRead,
  child: EngineSample,
  heldFd: number | null,
): Verdict & {
  /** main's unix sockets that name a peer by its kernel address */
  readonly mainPeers: number | null;
  /** the child's unix sockets that have a kernel address of their own */
  readonly childSockets: number | null;
  /** main's sockets whose peer is a socket of the child's: the held connection, and any other */
  readonly ties: number | null;
} {
  if (main.seen !== "read") {
    return {
      ...blind("main's own unix sockets could not be read"),
      mainPeers: null,
      childSockets: null,
      ties: null,
    };
  }
  const peerOf = (l: SocketLine): string | null => PEER_ADDRESS.exec(l.name)?.[1] ?? null;
  const peers = main.lines.flatMap((l) => peerOf(l) ?? []);
  if (child.read.seen !== "read") {
    return {
      ...blind("the child's unix sockets could not be read"),
      mainPeers: peers.length,
      childSockets: null,
      ties: null,
    };
  }
  const held = child.read.lines.flatMap((l) => l.device ?? []);
  const facts = {
    mainPeers: peers.length,
    childSockets: held.length,
    ties: peers.filter((address) => held.includes(address)).length,
  };
  if (!inside(child)) {
    return { ...blind("the child's unix sockets were not read wholly inside its life"), ...facts };
  }
  if (heldFd === null) {
    return { ...blind("the descriptor of main's held connection could not be read"), ...facts };
  }
  const own = main.lines.filter((l) => l.fd === heldFd);
  const line = own.length === 1 ? own[0] : undefined;
  if (line === undefined) {
    return {
      ...blind("main's held connection is not in the read of main's own sockets"),
      ...facts,
    };
  }
  const peer = peerOf(line);
  if (peer === null) {
    return { ...blind("main's held connection names no peer by a kernel address"), ...facts };
  }
  return held.includes(peer)
    ? { verdict: "ok", ...facts }
    : {
        ...blind(
          "the peer of main's held connection is no socket of the child's: main's connection is not tied to the child",
        ),
        ...facts,
      };
}

/** One read of the engine's folders: every file's place in the engine's own root, at a time.
 * `complete` is false when a folder could not be read, when the walk met a symbolic link (what
 * lies behind one was not read) or when it was cut at its bound: what such a read did show is
 * read, and it is a hole in the watch, never a poll that saw no stream file. */
export interface FolderRead {
  readonly at: number;
  readonly names: readonly string[];
  readonly complete: boolean;
}

export interface StreamWatch {
  readonly spawnedAt: number;
  /** the child's exit, or null while it lives */
  readonly exitedAt: number | null;
  /** when the watch was read for its verdict */
  readonly endedAt: number;
  readonly reads: readonly FolderRead[];
  /** the engine's own socket, by its place in the root */
  readonly socket: string;
  /** the control leg's own planted file, by its exact place in the root; null on any other leg */
  readonly plant: string | null;
  /** the engine's first answer to main, or null if it gave none */
  readonly answeredAt: number | null;
}

/** The longest two reads of the engine's folders may lie apart while the child lives. */
export const STREAM_POLL_MAX_GAP_MS = 1000;

/** THE STREAM FILE, for the engine's whole life. Red on a `.stream` anywhere under the root in any
 * read, the leg's own plant alone excepted, by its exact place. Blind on a watch with a hole (from
 * the spawn to the first complete read, between two of them, from the last to the exit), on a
 * plant that was asked for and never seen, and when the engine's own socket never showed, in a read
 * at or after its spawn, before its first answer: a poll that cannot see the socket is not reading
 * the engine's folder. For an engine that NEVER answered main, a socket never seen is said and not
 * judged: it may never have made one. Nothing else of such an engine is waived, and an engine that
 * took main's ready connect HAS answered, whatever became of it. A read taken before the spawn or
 * after the end is no poll and closes no gap; what it shows is read all the same. */
export function judgeStreamPolls(w: StreamWatch): Verdict & {
  readonly polls: number;
  readonly holes: number;
  readonly maxGapMs: number;
  readonly lifeMs: number | null;
  readonly plantSeen: boolean;
  readonly socketSeen: boolean;
} {
  const end = w.exitedAt ?? w.endedAt;
  const streams: string[] = [];
  let plantSeen = false;
  let socketSeen = false;
  let polls = 0;
  let holes = 0;
  let maxGapMs = 0;
  let last = w.spawnedAt;
  for (const r of [...w.reads].sort((a, b) => a.at - b.at)) {
    for (const name of r.names) {
      if (name === w.plant) plantSeen = true;
      else if (name.endsWith(".stream") && !streams.includes(name)) streams.push(name);
    }
    if (
      r.at >= w.spawnedAt &&
      (w.answeredAt === null || r.at <= w.answeredAt) &&
      r.names.includes(w.socket)
    ) {
      socketSeen = true;
    }
    if (r.at < w.spawnedAt || r.at > end) continue;
    if (!r.complete) {
      holes += 1;
      continue;
    }
    polls += 1;
    maxGapMs = Math.max(maxGapMs, r.at - last);
    last = r.at;
  }
  maxGapMs = Math.max(maxGapMs, end - last);
  const facts = {
    polls,
    holes,
    maxGapMs,
    lifeMs: w.exitedAt === null ? null : w.exitedAt - w.spawnedAt,
    plantSeen,
    socketSeen,
  };
  if (streams.length > 0) {
    return {
      ...red(`a stream file showed in the engine's folders: ${streams.join(", ")}`),
      ...facts,
    };
  }
  if (polls === 0)
    return { ...blind("the engine's folders were never read while it lived"), ...facts };
  if (maxGapMs > STREAM_POLL_MAX_GAP_MS) {
    return {
      ...blind(`the engine's folders went unread for ${maxGapMs} ms of its life`),
      ...facts,
    };
  }
  if (w.plant !== null && !plantSeen) {
    return {
      ...blind("the planted file was never seen: the poll does not read where main reads"),
      ...facts,
    };
  }
  if (!socketSeen) {
    if (w.answeredAt === null) {
      return {
        verdict: "ok",
        said: [
          "the engine never answered main and its socket was never seen: its folder reads have no control",
        ],
        ...facts,
      };
    }
    return {
      ...blind("the engine's own socket never showed in time: the folder read is not the engine's"),
      ...facts,
    };
  }
  return { verdict: "ok", ...facts };
}

/** What the engine's own pid file said of the hooked child, compared where the pid is held. */
export type PidFile = "match" | "none" | "other";

/** THE PID FILE: a weak witness (any process of this uid can write it). One naming another process
 * means the reads may be of the wrong one; none seen is said. */
export function judgePidFile(seen: PidFile): Verdict {
  if (seen === "other") {
    return blind("the engine's pid file names another process than the child main spawned");
  }
  return seen === "none" ? { verdict: "ok", said: ["no pid file was seen"] } : { verdict: "ok" };
}

/** Main's own line to the engine, the same line the probe sends: answered with success, answered
 * with a refusal, or not answered at all. */
export type MainExchange = "answered" | "refused" | "unanswered";

/** What the foreign process saw on the engine's socket, within its bound. */
export interface PeerProbe {
  readonly connected: boolean;
  readonly wrote: boolean;
  readonly bytesRead: number;
  readonly closed: boolean;
  readonly error: string | null;
  readonly ms: number;
}

/** THE FOREIGN PEER, judged from the client's side (the engine's own words are read by nobody).
 * Red on any byte read. Ok, which is "refused", needs the probe connected and then dropped with no
 * byte, WHILE main's identical line was answered just before and just after: without that sandwich
 * a refusal cannot be told from a wrong socket or an engine that answers nobody. Whether the
 * probe's line was written before the drop is said: an engine may drop a stranger at once. */
export function judgePeer(
  before: MainExchange,
  probe: PeerProbe | null,
  after: MainExchange,
): Verdict {
  if (probe !== null && probe.bytesRead > 0) {
    return red("the engine answered a process that is not main");
  }
  if (probe === null) return blind("the foreign probe could not be run");
  if (before !== "answered" || after !== "answered") {
    return blind("main's own line was not answered around the probe: a refusal cannot be told");
  }
  if (!probe.connected) return blind("the probe never reached the engine's socket");
  const dropped = probe.closed || probe.error === "ECONNRESET" || probe.error === "EPIPE";
  if (!dropped) return blind("the probe was neither answered nor dropped within its bound");
  return {
    verdict: "ok",
    said: ["refused", `the probe's line was ${probe.wrote ? "written" : "not written"}`],
  };
}

/** One process of the run, as the house census names it. */
export interface CensusRow {
  readonly pid: number;
  readonly ppid: number;
  readonly name: string;
}

const ENGINE_NAME = /^agent-browser/u;

/** How many of a census's rows are the engine, by the name the census gives its command. */
export function enginesIn(rows: readonly CensusRow[]): number {
  return rows.filter((r) => ENGINE_NAME.test(r.name)).length;
}

/** THE CENSUS, read while the child lives: the run's one engine is the child main spawned, and
 * nothing is beneath it. Red on a process of the run whose parent is the engine (it starts no
 * browser of its own) and on a second engine, whatever the census shows of the hooked child: both
 * were read. Blind when the census does not show the hooked child (the socket reads may be of the
 * wrong process), and when it names that child otherwise than as the engine: every count of
 * engines by name, this one and the stop's, would then see nothing. The census holds the run's
 * MARKED processes alone, so a process beneath the engine that dropped the mark is not seen, nor
 * anything beneath that one. Nor is a macOS platform binary, marked or not: `ps` shows no
 * environment for one (`/bin/sh` is one), so a shell the engine starts is in no census, and what
 * that shell starts has the shell for its parent and not the engine. What it says is a command's
 * name, never a pid. */
export function judgeCensus(rows: readonly CensusRow[], pid: number): Verdict {
  const beneath = rows.filter((r) => r.ppid === pid && r.pid !== pid);
  if (beneath.length > 0) {
    const names = [...new Set(beneath.map((r) => r.name))];
    return red(`the engine has a process beneath it: ${names.join(", ")}`);
  }
  if (rows.some((r) => r.pid !== pid && ENGINE_NAME.test(r.name))) {
    return red("the run holds a second engine");
  }
  const hooked = rows.find((r) => r.pid === pid);
  if (hooked === undefined) return blind("the census does not show the child main spawned");
  if (!ENGINE_NAME.test(hooked.name)) {
    return blind(
      "the census names the child main spawned otherwise than as the engine: its count of engines sees nothing",
    );
  }
  return { verdict: "ok" };
}

/** THE CENSUS OF AN ENGINE THAT HAS EXITED (item 658, 2026-11-27). What was beneath it is not shown
 * (an orphan has another parent, and a row with its pid may be another process by now): blind. But
 * a SECOND engine in the run's rows is red whether or not the first still lives, and it is tested
 * first: an engine that forks itself away and exits is this shape. */
export function judgeCensusAfterExit(rows: readonly CensusRow[], pid: number): Verdict {
  if (rows.some((r) => r.pid !== pid && ENGINE_NAME.test(r.name))) {
    return red("the run holds a second engine");
  }
  return blind("the engine had exited when the census was read");
}

/** The open may be tried this often, inside this long, when an engine was ready and its launch
 * went unanswered. */
export const PAGES_OPEN_TRIES = 3;
export const PAGES_OPEN_WINDOW_MS = 120_000;

/** THE OPEN'S TRIES: they must have stayed in their bounds, and one open must have been answered.
 * The engines the tries started are judged with every other engine of the run, each by its own
 * reads (smoke-pages.ts, its last leg): nothing of them is judged or waived here. */
export function judgeTries(t: {
  readonly opens: number;
  readonly elapsedMs: number;
  readonly answered: boolean;
}): Verdict {
  if (t.opens > PAGES_OPEN_TRIES) return blind("the open was tried more than three times");
  if (t.elapsedMs > PAGES_OPEN_WINDOW_MS) return blind("the open's tries ran past their window");
  if (!t.answered) return blind("no open was answered");
  return { verdict: "ok" };
}
