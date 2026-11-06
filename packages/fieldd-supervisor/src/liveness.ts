import { type FielddClient, FielddRpcError } from "@vibefield/fieldd-client";
import { afterIoTurn } from "./io-turn";
import type { FielddLiveness, FielddLivenessOptions } from "./types";

// THE SHELL'S LIVENESS WATCH ON ITS FIELDD LINK (item 212, RV #67, gap3-8). A fieldd whose loop has stalled keeps its
// sockets open (the kernel completes handshakes and buffers what it is sent), so its client stays `ready` while
// nothing answers. The floor's link has had this layer since WG-D1 (fieldd's native-supervisor.ts: the heartbeat, the
// confirm bound, WG-E1 to E3); the shell's link to fieldd never had it. This is that layer, by the floor's rules:
// - An ask is one `system.health` (scope null, local, answered from fieldd's memory) every `intervalMs`, only while
//   the client is `ready`, and never a second while one is unanswered. It carries no bound of the client's own: a
//   bounded call drops its answer when it comes late (fieldd-client's `timeoutMs`), and a reply past its deadline
//   dropped unseen is the defect WG-D1's correction names (NATIVE_SUPERVISION.WEDGE_CONFIRM_MS's comment). The
//   watch's own tick is the deadline.
// - Only replies count (WG-E2): an ask's answer, a result or fieldd's own error, a late one included; and a hello
//   answered, which is how a reconnected client comes back `ready`. `system.tick` and subscription deltas never
//   restart the clock: they are not answers.
// - A tick that finds its ask still unanswered counts a miss only when both hold (WG-E1): main's own tick fired on
//   time, its lateness under the interval (a stalled Electron main is not a stalled fieldd), and one turn of I/O
//   (`afterIoTurn`) finds no answer, so a reply already waiting in the socket is read first.
// - `missThreshold` misses in a row say `unresponsive`; a counted miss that finds `confirmMs` of reply silence says
//   `wedged`. Any reply says `responsive`, and the clock starts again (WG-E3).
// - It stops when the client leaves for `closed` or `failed`, or when its owner stops it (the handle's stop).
// It decides a state and nothing more. The supervisor acts on it: an OWNED fieldd at `wedged` is ended by the
// child-only ladder, an adopted one is only said (supervisor.ts makeHandle).

/** The house numbers: an ask every five seconds, two misses to `unresponsive`, and WG-D1's measured bound to
 * `wedged`: NATIVE_SUPERVISION.WEDGE_CONFIRM_MS, sixty seconds, cited and never imported (a floor constant is the
 * floor's). A shorter bound killed a healthy, slow floor (2026-10-19, `thinking-floor-wedge.md` §1). */
export const FIELDD_LIVENESS: FielddLivenessOptions = Object.freeze({
  intervalMs: 5_000,
  missThreshold: 2,
  confirmMs: 60_000,
});

/** What the watch reads of a client: its status and its changes, and one call. */
export type LivenessClient = Pick<FielddClient, "status" | "request" | "onStatusChange">;

/** The watch's clock, in milliseconds: monotonic (`performance.now`) unless a test injects its own. */
export interface LivenessClock {
  now(): number;
}

export interface LivenessWatch {
  readonly liveness: FielddLiveness;
  stop(): void;
}

const RESPONSIVE: FielddLiveness = Object.freeze({ kind: "responsive" });
const MONOTONIC: LivenessClock = { now: () => performance.now() };

/** Watch `client`'s replies by the rules above, telling `onChange` each change of state. */
export function watchLiveness(
  client: LivenessClient,
  opts: FielddLivenessOptions & { readonly onChange: (liveness: FielddLiveness) => void },
  clock: LivenessClock = MONOTONIC,
): LivenessWatch {
  const { intervalMs, missThreshold, confirmMs } = opts;
  for (const bound of [intervalMs, missThreshold, confirmMs]) {
    if (!Number.isSafeInteger(bound) || bound < 1) {
      throw new Error("the liveness watch's numbers must be positive safe integers");
    }
  }
  let liveness = RESPONSIVE;
  let stopped = false;
  let misses = 0;
  /** the last reply read: the watch starts on a client whose hello was just answered */
  let lastReplyAt = clock.now();
  /** the ask in flight, by its number; one at a time */
  let inFlight: number | null = null;
  let asked = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const say = (next: FielddLiveness): void => {
    if (next.kind === liveness.kind) return;
    liveness = next;
    opts.onChange(next);
  };

  const replied = (): void => {
    lastReplyAt = clock.now();
    misses = 0;
    say(RESPONSIVE);
  };

  const send = (): void => {
    asked += 1;
    const ask = asked;
    inFlight = ask;
    const settle = (reply: boolean): void => {
      if (inFlight === ask) inFlight = null;
      if (!stopped && reply) replied();
    };
    void client.request("system.health", {}).then(
      () => settle(true),
      // fieldd's own refusal carries its JSON-RPC code; the client's own failures (the socket closed under the call,
      // the client closed) carry none and are no answer
      (error: unknown) => settle(error instanceof FielddRpcError && error.code !== undefined),
    );
  };

  /** One turn of I/O after an on-time tick found `ask` unanswered: still unanswered, it is a miss. */
  const judge = (ask: number): void => {
    if (stopped || inFlight !== ask || client.status !== "ready") return;
    misses += 1;
    if (misses < missThreshold) return;
    const silentMs = clock.now() - lastReplyAt;
    say(silentMs >= confirmMs ? { kind: "wedged", silentMs } : { kind: "unresponsive", silentMs });
  };

  const tick = (dueAt: number): void => {
    timer = null;
    if (stopped) return;
    const firedAt = clock.now();
    arm();
    if (client.status !== "ready") return;
    const ask = inFlight;
    if (ask === null) {
      send();
      return;
    }
    // main's own stall: a tick it fired late counts neither way
    if (firedAt - dueAt >= intervalMs) return;
    afterIoTurn(() => judge(ask));
  };

  const arm = (): void => {
    const dueAt = clock.now() + intervalMs;
    timer = setTimeout(() => tick(dueAt), intervalMs);
    timer.unref();
  };

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    unwatch();
  };

  const unwatch = client.onStatusChange(() => {
    if (stopped) return;
    const status = client.status;
    if (status === "closed" || status === "failed") {
      stop();
      return;
    }
    // a hello answered: the client came back `ready`, and that is a reply
    if (status === "ready") replied();
  });
  if (client.status === "closed" || client.status === "failed") stop();
  else arm();

  return {
    get liveness() {
      return liveness;
    },
    stop,
  };
}
