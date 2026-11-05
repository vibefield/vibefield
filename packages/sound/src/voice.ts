/**
 * The voice (DESIGN.md §14 "When it speaks", SD-D9 … SD-D13): when the field speaks, and how many agents become one
 * sound. Pure policy, no audio: it takes agents' status observations and asks `play` for a sound at the moments a
 * person should hear something. The clock and its timers are injected, so the same code runs in Electron main, in the
 * window and in tests on a virtual clock.
 *
 * The rules, in the order an observation meets them: meaning · hold · focus · gather · all quiet · spacing · budget ·
 * reminders. Where a sound comes from (its pan) and whether it crosses the field (another desktop) ride along.
 */
import { clearOf } from "./render.ts";
import { PAN_LIMIT } from "./score.ts";

/** The voice's numbers, as §14 states them. */
export const VOICE = {
  /** A state must hold this long before it sounds. */
  holdMs: { done: 900, question: 450, approval: 450, failed: 250 },
  /** A moment closes after this much quiet… */
  gatherMs: 320,
  /** …and never later than this after it opened. */
  gatherMaxMs: 1200,
  /** At least this between two sounds' starts, and never before the last has said itself. */
  spacingMs: 620,
  /** A request folded into a louder one plays on its own this much later, if it still waits. */
  deferMs: 4000,
  /** Past this many sounds in the window, Dones fold silently; a request never does. */
  budget: { windowMs: 60000, max: 6 },
  /** An unanswered request is said again at these times after it first sounded, then never. */
  remindAtMs: [120000, 600000],
  /** A reminder is this much softer (dB)… */
  remindLevel: -6,
  /** …and this much slower. */
  remindStretch: 1.25,
  /** All quiet needs at least this many agents in the field. */
  settleMinAgents: 2,
  /** Each sound cycles through this many takes (variant 0 first). */
  takes: 5,
  /** A moment plays one request: approval, then question, then failure. */
  priority: { approval: 4, question: 3, failed: 2, settle: 1, done: 0 },
} as const;

/** An agent's headline status, as fieldd folds it. */
export type AgentStatus = "idle" | "working" | "blocked" | "unknown";

/** What one agent's transition means: Done, or the request a blocker makes. */
export type StatusCue = "done" | "question" | "approval" | "failed";

/** What the voice plays: an agent's cue, or All quiet when the last working agent stops. */
export type VoiceCue = StatusCue | "settle";

/** One blocker on an agent: what it waits for, and which prompt it is. */
export interface Blocker {
  readonly id?: string;
  readonly kind: string;
}

/** One observation of an agent. */
export interface AgentObservation {
  readonly id: string;
  readonly status: AgentStatus;
  /** The blocker's kind when `status` is blocked and no `blockers` are given. */
  readonly kind?: string | null;
  /**
   * The row's blockers. A blocker wins over a headline "working": puppeteer reports an agent as working while any
   * subagent runs, even with a permission prompt open, and that prompt is the most expensive sound to miss.
   */
  readonly blockers?: readonly Blocker[];
  /** Where its agent is on screen, −1 (left) … 1 (right). */
  readonly pan?: number;
  /** It runs on another of the person's desktops: heard from across the field, in a moment of its own. */
  readonly remote?: boolean;
}

/** What the voice asks to be played. */
export interface PlayRequest {
  readonly cue: VoiceCue;
  /** The agents it speaks for. */
  readonly ids: readonly string[];
  /** Agents coalesced into it (a Done chord). */
  readonly count: number;
  readonly pan: number;
  /** A Done chord's agents, each from its own side, in score order. */
  readonly notePans?: readonly number[];
  /** Heard from across the field (the far space). */
  readonly far: boolean;
  /** dB from the cue's target. */
  readonly level: number;
  readonly reminder: boolean;
  readonly stretch: number;
  /** The take (0 … VOICE.takes − 1). */
  readonly variant: number;
}

/** The clock the voice runs on: `now` in ms, and one-shot timers. */
export interface VoiceClock<T> {
  readonly now: () => number;
  readonly setTimer: (fn: () => void, ms: number) => T;
  readonly clearTimer: (timer: T) => void;
}

export interface VoiceStats {
  events: number;
  held: number;
  focused: number;
  folded: number;
  played: number;
  gathered: number;
  reminders: number;
}

export interface Voice {
  /** One status observation of one agent. */
  observe(ev: AgentObservation): void;
  /** Which agent has the keyboard (the one you are typing into never sounds), or none. */
  attention(a: { readonly focusedId: string | null }): void;
  /** Forget every agent and every pending sound. */
  reset(): void;
  readonly stats: Readonly<VoiceStats>;
}

const BLOCKER_ORDER: readonly string[] = ["permission", "question", "failure"];
/** A known blocker ranks by BLOCKER_ORDER; an unknown kind ranks after them (it plays as a failure). */
const blockerRank = (kind: string): number => {
  const i = BLOCKER_ORDER.indexOf(kind);
  return i < 0 ? BLOCKER_ORDER.length : i;
};

/** A status and its blocker → the cue a transition INTO it means, or null for silence. */
export function cueFor(to: AgentStatus, kind: string | null): StatusCue | null {
  if (to === "idle") return "done";
  if (to === "blocked") {
    if (kind === "permission") return "approval";
    if (kind === "question") return "question";
    // a failure, or blocked on something unnamed: the phone's projection reads it as a failure too
    return "failed";
  }
  return null;
}

interface Due {
  readonly id: string;
  readonly cue: StatusCue;
  readonly level: number;
  readonly pan: number;
  readonly remote: boolean;
  readonly reminder: boolean;
  readonly deferred: boolean;
}

type Queued = Omit<PlayRequest, "variant">;

/** The voice: one per person's field. `play` is asked for each sound, at the moment it should start. */
export function createVoice<T>(clock: VoiceClock<T>, play: (request: PlayRequest) => void): Voice {
  const { now, setTimer, clearTimer } = clock;
  interface AgentState {
    status: AgentStatus;
    kind: string | null;
    blockerId: string | null;
    since: number;
    pan: number;
    focused: boolean;
    remote: boolean;
    pending: T | null;
    reminders: T[];
  }
  const agents = new Map<string, AgentState>();
  const recent: number[] = []; // start times of the sounds played, for the budget
  const queue: Queued[] = [];
  const takes = new Map<VoiceCue, number>();
  let gather: { items: Due[]; first: number; timer: T } | null = null;
  let queueTimer: T | null = null;
  let lastStart = Number.NEGATIVE_INFINITY;
  let lastClearAt = Number.NEGATIVE_INFINITY;
  const stats: VoiceStats = {
    events: 0,
    held: 0,
    focused: 0,
    folded: 0,
    played: 0,
    gathered: 0,
    reminders: 0,
  };

  function agent(id: string): AgentState {
    let a = agents.get(id);
    if (!a) {
      a = {
        status: "unknown",
        kind: null,
        blockerId: null,
        since: now(),
        pan: 0,
        focused: false,
        remote: false,
        pending: null,
        reminders: [],
      };
      agents.set(id, a);
    }
    return a;
  }
  function cancelPending(a: AgentState): void {
    if (a.pending !== null) {
      clearTimer(a.pending);
      a.pending = null;
    }
  }
  function cancelReminders(a: AgentState): void {
    for (const t of a.reminders) clearTimer(t);
    a.reminders = [];
  }

  function observe(ev: AgentObservation): void {
    stats.events++;
    let status = ev.status;
    let kind = status === "blocked" ? ev.kind || null : null;
    let blockerId: string | null = null;
    if (ev.blockers && ev.blockers.length > 0) {
      const top = [...ev.blockers].sort((x, y) => blockerRank(x.kind) - blockerRank(y.kind))[0]!;
      status = "blocked";
      kind = top.kind;
      blockerId = top.id ?? null;
    }
    const a = agent(ev.id);
    if (ev.pan !== undefined) a.pan = Math.max(-PAN_LIMIT, Math.min(PAN_LIMIT, ev.pan));
    if (ev.remote !== undefined) a.remote = ev.remote;
    // Not a transition: the same status, the same blocker. A new prompt (a new blocker id) is a new request.
    if (a.status === status && a.kind === kind && a.blockerId === blockerId) return;
    const from = a.status;
    a.status = status;
    a.kind = kind;
    a.blockerId = blockerId;
    a.since = now();
    if (a.pending !== null) stats.held++;
    cancelPending(a);
    cancelReminders(a);
    // The first thing heard about an agent is a fact, not news: VibeField opening onto three blocked agents shows
    // them and says nothing.
    const cue =
      from !== "unknown" && (from === "working" || status === "blocked")
        ? cueFor(status, kind)
        : null;
    if (!cue) return;
    // HOLD: the state must still be this one when the hold ends.
    const stamp = a.since;
    a.pending = setTimer(() => {
      a.pending = null;
      if (a.since !== stamp) {
        stats.held++;
        return;
      }
      due(ev.id, cue, false, false);
    }, VOICE.holdMs[cue]);
  }

  function attention({ focusedId }: { readonly focusedId: string | null }): void {
    for (const [id, a] of agents) a.focused = id === focusedId;
  }

  function due(id: string, cue: StatusCue, reminder: boolean, deferred: boolean): void {
    const a = agents.get(id);
    if (!a) return;
    // FOCUS: the agent you are typing into never sounds; its reminders wait for you to leave it
    if (a.focused) {
      stats.focused++;
      if (!reminder) scheduleReminders(id, cue);
      return;
    }
    // GATHER: the moment stays open while changes keep arriving (each gives it another gatherMs of quiet), but never
    // past gatherMaxMs from its first change.
    if (!gather) {
      gather = { items: [], first: now(), timer: setTimer(flush, VOICE.gatherMs) };
    } else {
      clearTimer(gather.timer);
      const left = gather.first + VOICE.gatherMaxMs - now();
      gather.timer = setTimer(flush, Math.max(0, Math.min(VOICE.gatherMs, left)));
    }
    const level = reminder ? VOICE.remindLevel : 0;
    gather.items.push({ id, cue, level, pan: a.pan, remote: a.remote, reminder, deferred });
    if (!reminder && cue !== "done") scheduleReminders(id, cue);
  }

  function scheduleReminders(id: string, cue: StatusCue): void {
    const a = agents.get(id);
    if (!a || cue === "done") return;
    const stamp = a.since;
    a.reminders = VOICE.remindAtMs.map((ms) =>
      setTimer(() => {
        if (a.since !== stamp || a.status !== "blocked") return;
        stats.reminders++;
        due(id, cue, true, false);
      }, ms),
    );
  }

  function workingCount(): number {
    let n = 0;
    for (const a of agents.values()) if (a.status === "working") n++;
    return n;
  }

  function flush(): void {
    const items = gather?.items ?? [];
    gather = null;
    const out: Queued[] = [];
    // This Mac's agents and another desktop's are separate moments: each gets one request and one Done at most.
    for (const remote of [false, true]) {
      const here = items.filter((it) => it.remote === remote);
      if (here.length === 0) continue;
      const requests = here.filter((it) => it.cue !== "done");
      const dones = here.filter((it) => it.cue === "done");
      if (requests.length > 0) {
        const top = requests.reduce((x, y) =>
          VOICE.priority[y.cue] > VOICE.priority[x.cue] ? y : x,
        );
        const same = requests.filter((it) => it.cue === top.cue);
        for (const it of requests) {
          if (it.cue === top.cue) continue;
          if (it.deferred) {
            // it already waited once: it plays in this moment after the top request, and never folds twice
            out.push({
              cue: it.cue,
              ids: [it.id],
              count: 1,
              pan: it.pan,
              far: remote,
              level: it.level,
              reminder: it.reminder,
              stretch: it.reminder ? VOICE.remindStretch : 1,
            });
            continue;
          }
          stats.gathered++;
          // Not dropped: the folded request plays on its own deferMs later if it still waits, and its reminders
          // start from THAT sounding, so they never coincide with the winner's. A folded REMINDER keeps the
          // reminders still to come.
          const ag = agents.get(it.id);
          if (ag) {
            if (!it.reminder) cancelReminders(ag);
            const stamp = ag.since;
            ag.reminders.push(
              setTimer(() => {
                if (ag.since !== stamp || ag.status !== "blocked") return;
                due(it.id, it.cue, it.reminder, true);
              }, VOICE.deferMs),
            );
          }
        }
        const allReminders = same.every((it) => it.reminder);
        out.push({
          cue: top.cue,
          ids: same.map((it) => it.id),
          count: 1,
          pan: same.reduce((sum, it) => sum + it.pan, 0) / same.length,
          far: remote,
          level: Math.max(...same.map((it) => it.level)),
          reminder: allReminders,
          stretch: allReminders ? VOICE.remindStretch : 1,
        });
      }
      if (dones.length > 0) {
        stats.gathered += Math.max(0, dones.length - 1);
        let known = 0;
        for (const a of agents.values()) if (a.status !== "unknown") known++;
        const cue: VoiceCue =
          !remote && workingCount() === 0 && known >= VOICE.settleMinAgents ? "settle" : "done";
        const pans = dones.map((it) => it.pan);
        const chord = cue === "done" && dones.length > 1;
        out.push({
          cue,
          ids: dones.map((it) => it.id),
          count: cue === "done" ? dones.length : 1,
          ...(chord ? { notePans: pans } : {}),
          pan: chord ? 0 : pans.reduce((x, y) => x + y, 0) / pans.length,
          far: remote,
          level: Math.max(...dones.map((it) => it.level)),
          reminder: false,
          stretch: 1,
        });
      }
    }
    out.sort((x, y) => VOICE.priority[y.cue] - VOICE.priority[x.cue]);
    for (const o of out) enqueue(o);
  }

  function enqueue(o: Queued): void {
    // BUDGET: Dones fold when the field has been talking a lot; a request is never dropped.
    const t = now();
    while (recent.length > 0 && t - recent[0]! > VOICE.budget.windowMs) recent.shift();
    if (
      (o.cue === "done" || o.cue === "settle") &&
      recent.length + queue.length >= VOICE.budget.max
    ) {
      stats.folded += o.ids.length;
      return;
    }
    queue.push(o);
    pump();
  }

  function pump(): void {
    if (queueTimer !== null || queue.length === 0) return;
    const wait = Math.max(0, Math.max(lastStart + VOICE.spacingMs, lastClearAt) - now());
    queueTimer = setTimer(() => {
      queueTimer = null;
      const o = queue.shift();
      if (!o) return;
      const variant = takes.get(o.cue) ?? 0;
      takes.set(o.cue, (variant + 1) % VOICE.takes);
      lastStart = now();
      recent.push(lastStart);
      stats.played++;
      // SPACING: the next sound waits until this one has said itself (its last strike + 450 ms)
      lastClearAt =
        lastStart + clearOf(o.cue, { count: o.count, stretch: o.stretch, variant }) * 1000;
      play({ ...o, variant });
      pump();
    }, wait);
  }

  function reset(): void {
    for (const a of agents.values()) {
      cancelPending(a);
      cancelReminders(a);
    }
    agents.clear();
    if (gather) {
      clearTimer(gather.timer);
      gather = null;
    }
    if (queueTimer !== null) {
      clearTimer(queueTimer);
      queueTimer = null;
    }
    queue.length = 0;
    recent.length = 0;
    takes.clear();
    lastStart = Number.NEGATIVE_INFINITY;
    lastClearAt = Number.NEGATIVE_INFINITY;
    for (const k of Object.keys(stats) as (keyof VoiceStats)[]) stats[k] = 0;
  }

  return { observe, attention, reset, stats };
}
