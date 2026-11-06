import { createHash } from "node:crypto";
import {
  type AgentProfileSetId,
  type ComposeAskUserInput,
  NEEDS_CHOICE_MAX,
  NEEDS_CHOICE_WORDS,
  NEEDS_CHOICES_MAX,
  NEEDS_HELD_SENDS_MAX,
  NEEDS_OPEN_PER_SPARK,
  NEEDS_RECORD_FORMAT,
  NEEDS_WORDS_MAX,
  type NeedsAnswer,
  type NeedsAnswerOutcome,
  type NeedsRun as NeedsFlowRun,
  type NeedsFrom,
  type NeedsItem,
  type NeedsItemId,
  type NeedsItemKind,
  type NeedsItemState,
  type NeedsNotice,
  type NeedsRecord,
  type NeedsScript,
  NOTIFY_PER_MINUTE,
  needsKindOf,
  needsOutcomeOf,
  needsStateOf,
  profileSetOfRun,
  type SparkId,
  type SparkRecord,
  type SparkSummary,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { folderNameOf, projectBlocker } from "../../../agent-field";
import type { AgentInputQueues, DeliveryOutcome } from "../../../agent-input-queue";
import { RpcCallError } from "../../../native-link";
import type { GrantPrincipal } from "../../../terminal-grants";
import {
  type HeldLaunch,
  type HoldSender,
  SPARK_LIVE_AGENTS_MAX,
  type TalkDeps,
  type TalkHolds,
} from "../talk/verbs";
import { NeedsStore } from "./store";
import * as words from "./words";

// CP-3 — the needs-you queue (`draft/compose-plane/cp3-the-person.md`, ruled 2026-10-31 06:31:34Z: CP3-D1…D8 at A), the
// you room's one authority. What waits on the person: a spark's question (ask_user), its first send into a session the
// person started (CP-D3, CP3-D3 B), a spawn past its cap (CP-D7, CP3-D4 A), and an agent's own ask, read from its run's
// blockers, listed with where to answer it and never answered here (CP3-D1 A, CP-L4).
// - Kept: every item fieldd raised is a signed record (store.ts), read once at boot and held in memory after
//   (critique 20d); every change is written through before it is acted on. What follows an act already done (an
//   answer's record once its act began, a fact once it is in a spark's input queue) stands in memory whatever the disk
//   does, and a restart reads what the disk kept. An agent's own ask is never kept.
// - Answered once, an item is answered for every window: a second answer to one item waits for the first and is then
//   the same answer, or refused (critique 5). An act fieldd started and did not record done is never done again: after
//   a restart its spark is told it is uncertain (CP2-D2).
// - The act and its telling are apart (critique 4): `outcome` is the act's (done | failed), and `told` says whether the
//   spark has heard it. The spark hears it as one marked line of facts in its own input queue (CP3-D2 A, words.ts); a
//   sleeping spark is resumed for it through compose.sparks.open's own wake, one per spark (CP3-D7 A), and a spark that
//   cannot be woken hears it when its session is next live. Never into a pending run: AR-4 may replace it.
// - Heard only once its session takes it (item 158, CO-Q9 (b)): a fact queued keeps the record `owed`, `telling` at
//   that run, until the input queue says what became of the line (`onFactOutcome`). Delivered, it is heard; dropped
//   (the session ended first), it is owed again, `told` false with its `waits`, and the spark's next session hears it;
//   uncertain, it is never told again. `told` keeps its meaning on the wire: the fact is in the spark's input queue
//   (§8 Q1 (b)). A record already telling is never queued twice, and a boot whose kept queue lost its line owes it
//   again (`reconcileTelling`).
// - A held send's Allow is the allowance (one authority, no second table): the answered record stays until its run
//   ends, through a fieldd restart that finds it kept, and the spark's later words to that run are not held. A restart
//   that finds its act begun instead (`#uncertain`) leaves no allowance, and its spark is told the later words are held
//   again. Liveness is judged at use; a run that ended while fieldd was down is found once this boot's re-attach has
//   settled (critique 3).
// - Bounds (PF4's watermark), each contracts' (compose.ts): NEEDS_OPEN_PER_SPARK open items per spark,
//   NEEDS_HELD_SENDS_MAX sends per held item, NOTIFY_PER_MINUTE notices a minute per session.
// - CP-4a2b (§13a slice 6; 13a's D2, D22) — a flow run's items (`flowItem`): the runs raise them, each holding its run
//   and the call it waits at, with the runs' acts and then Stop the run. The person's answer is handed to the runs once
//   (the FlowItemActs port), who write it, keyed by its call, at most once: their journal is the act's record, so a
//   flow item carries no `acting` mark and is never uncertain. A run's end ends its items. Nothing is owed a spark
//   here: the runs tell the run's spark by their own wakes. No spark's watermark counts a flow item (its teller is the
//   flow); a run's calls are bounded by its cap (D10).

const NOTIFY_WINDOW_MS = 60_000;
/** The answered items remembered for an answer that comes again (the record of each is the audit line). */
const ANSWERED_KEPT = 64;
/** How often the queue asks whether this boot's re-attach has settled, until it has. */
const SETTLE_POLL_MS = 1_000;
/** A held item's yes is its first act, and Not now is always its last. */
const YES = 0;

/** A run as the queue reads it (daemon.ts adapts the runtime's rows): one the fold holds, managed or still
 * re-attaching. A run the fold no longer holds, or holds as exited, is no run here. */
export interface NeedsRun {
  readonly runtimeRunId: string;
  /** as a wake names it: its title, else its agent's label in its folder, else that label, else its id; one line of
   * at most NEEDS_NAME_MAX (words.ts's sessionName) */
  readonly label: string;
  /** the spark whose own session it is */
  readonly spark?: SparkId | undefined;
  /** the spark whose agent_spawn started it (CP-D15's origin) */
  readonly startedBy?: SparkId | undefined;
  /** the Agent Profile it is filed under; `profileSetOfRun` places it */
  readonly profileSet?: string | undefined;
  /** its persona, which places it when it is filed under none */
  readonly profileId?: string | undefined;
  /** live under this daemon: it can take input (a re-attaching run cannot yet) */
  readonly live: boolean;
}

/** The mirror's shape the queue reads (AgentMonitorMirror's blockers; a permission's tool rides its passthrough). */
export interface MonitorBlockers {
  readonly blockers: readonly {
    readonly id: string;
    readonly kind: string;
    readonly since: string;
  }[];
}

export interface NeedsQueueOptions {
  readonly store: NeedsStore;
  readonly inputs: Pick<AgentInputQueues, "wake" | "enqueue">;
  /** a run the fold holds, managed or re-attaching */
  run(runtimeRunId: string): NeedsRun | undefined;
  /** TU-1 — the talk room's persona map, so an Allow places a run as the room did */
  readonly personaSets: TalkDeps["personaSets"];
  /** a spark's own live session, where what it is told lands */
  sparkSession(spark: SparkId): string | undefined;
  /** a spark's record, when it verifies */
  spark(id: SparkId): SparkRecord | undefined;
  /** wake a spark through compose.sparks.open's own wake (CP3-D7 A): one per spark, joined by whoever asks meanwhile */
  open(spark: SparkId, principal: GrantPrincipal): Promise<SparkSummary>;
  /** the talk room's own spawn (one spawn): Allow one more starts past the cap on purpose (CP3-D4 A) */
  readonly spawn: TalkDeps["spawn"];
  /** an agent's label in the catalog (R23b: a lookup, never a compare) */
  agentLabel(agent: string): string | undefined;
  /** TH-1 (TH-Q27 (a)) — VibeField's own act, kept in the spark's transcript: an answer you gave to a spark's item is
   * kept in the run that raised it, so the flow says "You answered Vela: Yes" once the card leaves. Absent, nothing is
   * kept. */
  appendAct?(
    spark: SparkId,
    runtimeRunId: string,
    act: { readonly what: string; readonly text: string },
  ): void;
  readonly now?: () => Date;
  readonly logger?: Logger;
}

/** An answer as the door records it: the item, and the run it woke when it resumed or started a sleeping spark. */
export interface NeedsAnswered {
  readonly item: NeedsItem;
  readonly woke?: string;
}

/** CP-4a2b (§13a slice 6) — a flow run's items, each holding its run: a script's `ask` (`flow-gate`), the call cap
 * (`flow-cap`), a step's second miss (`flow-repair`) and a step lost to a Quit, or a run set aside (`flow-lost`). */
export type FlowRunItemKind = Extract<
  NeedsItemKind,
  "flow-gate" | "flow-cap" | "flow-repair" | "flow-lost"
>;

/** A flow run's item as the runs raise it (13a's D2, D22). */
export interface FlowItemRaise {
  readonly kind: FlowRunItemKind;
  /** the run, and the call it holds at (counted from 1 in the run's journal) with the script's label */
  readonly run: NeedsFlowRun;
  /** the flow as its mark names it (‹flow›: the runs choose the words, DESIGN.md §9, R18) */
  readonly name: string;
  /** the spark that started the run, whose thread shows the item; absent for a run you started */
  readonly spark?: SparkId | undefined;
  /** what it asks, in the runs' words: a gate's question, a lost run's sentence */
  readonly words?: string | undefined;
  /** the acts before Stop the run, in order: a gate's own choices, or its kind's (NEEDS_CHOICE_WORDS); none for a run
   * whose one act is Stop the run */
  readonly acts: readonly string[];
}

/** The person's answer to a flow run's item, as the runs are handed it: `stop` when it is Stop the run (every such
 * item's last act), else `choice` is the act's place among the acts the runs raised it with. */
export interface FlowItemAnswer {
  readonly id: NeedsItemId;
  readonly kind: FlowRunItemKind;
  readonly run: NeedsFlowRun;
  readonly choice: number;
  readonly stop: boolean;
}

/** What the runs did with an answer: done, or failed in fieldd's words. */
export type FlowItemActed =
  | { readonly outcome: "done" }
  | { readonly outcome: "failed"; readonly reason: string };

/** CP-4a2b (§13a slice 6's N5; CP4-Q5 (a)) — a flow that changed since you approved it, or that you never approved,
 * asked before its run starts: it holds no run yet, only the bytes it would run. */
export interface FlowChangedRaise {
  /** the flow, the version it would run (`hash`) and the one approved (`approved`), when one is */
  readonly script: NeedsScript;
  /** the flow as its mark names it (‹flow›) */
  readonly name: string;
  /** the spark whose flow_run waits on it (13b's D5), told what you chose; absent for a run you start */
  readonly from?: HoldSender | undefined;
}

/** A changed flow's start, as the runs are handed it: the item, and the bytes you chose to run. */
export interface FlowItemStart {
  readonly id: NeedsItemId;
  readonly flow: string;
  readonly hash: string;
}

/** What the runs did with a start: the run it started, or why it could not start, in fieldd's words. */
export type FlowItemStarted =
  | { readonly outcome: "done"; readonly run: string }
  | { readonly outcome: "failed"; readonly reason: string };

/** CP-4a2b (13a's D22) — the runs' side of their items: an answer, handed on once. The runs write it, keyed by its
 * call, at most once, so an answer handed on again (a restart found its item still open: the queue's record of the
 * answer was not kept) is answered by what their journal holds. One that throws acted on nothing: the item waits on. */
export interface FlowItemActs {
  answer(answer: FlowItemAnswer): Promise<FlowItemActed>;
  /** N5 — a changed flow's Run this version or Run the one you approved: its run starts on those bytes */
  start(start: FlowItemStart): Promise<FlowItemStarted>;
}

/** A tool call's refusal, with the fact the model reads (index.ts). */
const refuse = (fact: string, message: string) =>
  new RpcCallError("PRECONDITION_FAILED", message, false, { fact });
/** A window's refused answer, with its reason (the compose doors' shape). */
const refuseAnswer = (message: string, reason: string) =>
  new RpcCallError("PRECONDITION_FAILED", message, false, { reason });
/** CP-4a2b — a flow item answered before the runs have handed the queue their acts (`bindFlowActs`): the item stays
 * open, and the same answer is taken once they have. */
const FLOWS_UNBOUND = "VibeField hasn't started its flows yet. Try again in a moment";
/** TU-1 (§12 Q1 (a′)) — an Allow fieldd cannot place yet: the profiles are not read, so the item stays open and the
 * same answer is taken once the monitor's first frame lands. */
const PROFILES_UNREAD = "VibeField hasn't read the Agent Profiles yet. Try again in a moment";

/** What an act did, and what its spark is owed (a flow run's item owes none: the runs tell its spark). */
interface Act {
  readonly outcome: NeedsAnswerOutcome;
  readonly reason?: string;
  readonly owed?: string;
}

const isAllowance = (record: NeedsRecord): boolean =>
  needsKindOf(record.item) === "held-send" &&
  needsStateOf(record.item) === "answered" &&
  needsOutcomeOf(record.item.answer) === "done" &&
  record.item.answer?.choice === YES;

/** A record holds something still: an open item, an allowance, or a fact its spark has not heard. */
const needed = (record: NeedsRecord): boolean =>
  needsStateOf(record.item) === "open" || record.owed !== undefined || isAllowance(record);

/** An asker's own words as an item shows them: whole up to NEEDS_WORDS_MAX, else cut and said so. */
const shown = (text: string): Pick<NeedsItem, "words" | "cut"> =>
  text.length > NEEDS_WORDS_MAX
    ? { words: words.clip(text, NEEDS_WORDS_MAX), cut: true }
    : { words: text };

export class NeedsQueue implements TalkHolds {
  /** the store's records by item id: read once at restore, written through on every change */
  readonly #records = new Map<NeedsItemId, NeedsRecord>();
  /** each run's own ask, read from its blockers, never kept */
  readonly #asks = new Map<string, NeedsItem>();
  /** the last answered items, for an answer that comes again */
  readonly #answered = new Map<NeedsItemId, NeedsItem>();
  /** an answer in flight per item: a second waits for it */
  readonly #inFlight = new Map<NeedsItemId, Promise<NeedsAnswered>>();
  /** per teller session, when it told the person something in the last minute */
  readonly #told = new Map<string, number[]>();
  readonly #changes = new Set<(items: readonly NeedsItem[]) => void>();
  readonly #notices = new Set<(notice: NeedsNotice) => void>();
  #shown = "[]";
  #settle: ReturnType<typeof setInterval> | undefined;
  /** the settle's joiners, in the order they joined (item 159, X5); none is kept once the settle has run them */
  readonly #joiners: { readonly name: string; readonly fn: () => void }[] = [];
  #settled = false;
  /** CP-4a2b — the runs' side of their items, handed over once the runs are built (after the queue) */
  #flowActs: FlowItemActs | undefined;
  readonly #now: () => Date;
  readonly #logger: Logger;

  constructor(private readonly opts: NeedsQueueOptions) {
    this.#now = opts.now ?? (() => new Date());
    this.#logger = opts.logger ?? createNoopLogger();
  }

  /** At boot: read the store, and nothing else (critique 3: no run has re-attached yet). An act found begun and never
   * recorded done becomes its uncertain fact, owed to its spark, and is never done again. Returns how many records were
   * kept. */
  restore(): number {
    // item 172: a store that cannot be read answers nothing here, and refuses after (`readable`)
    for (const record of this.opts.store.boot()) {
      // an act begun is held by `#uncertain` while it holds something (a changed flow of yours owes no one: N5)
      if (record.acting === undefined) this.#records.set(record.item.id, record);
      else this.#uncertain(record);
    }
    this.#shown = JSON.stringify(this.list());
    return this.#records.size;
  }

  /** Once this boot's re-attach has settled, a held send or an allowance whose run the fold no longer holds ended
   * while fieldd was down: no exit event will say so (critique 3). Asked once, after `settled()` first holds; then
   * each joiner (`joinSettle`), the same moment's reconcile of another store. */
  reconcileWhenSettled(settled: () => boolean): void {
    if (this.#settle !== undefined) return;
    this.#settle = setInterval(() => {
      if (!settled()) return;
      this.stop();
      this.reconcile();
      this.#settled = true;
      for (const { name, fn } of this.#joiners.splice(0)) this.#guard(`settle joiner ${name}`, fn);
    }, SETTLE_POLL_MS);
    this.#settle.unref?.();
  }

  /** Item 159 (X5) — another store's reconcile at the same settle moment, run once, after this queue's own, in the
   * order joined, each guarded so one that throws stops none of the others; one that joins after the settle runs at
   * once. Each slice that keeps something per run joins with one line (the input queue's, 1′'s, SP-1e2's). */
  joinSettle(name: string, fn: () => void): void {
    if (this.#settled) this.#guard(`settle joiner ${name}`, fn);
    else this.#joiners.push({ name, fn });
  }

  /** The reconcile itself: every run a held send or an allowance waits on is judged against the fold, now. */
  reconcile(): void {
    const targets = new Set<string>();
    for (const record of this.#records.values())
      if (
        needsKindOf(record.item) === "held-send" &&
        needsStateOf(record.item) !== "ended" &&
        record.item.to
      )
        targets.add(record.item.to.session);
    for (const target of targets)
      if (this.opts.run(target) === undefined)
        this.#guard("reconcile", () => this.onRunEnded(target));
  }

  stop(): void {
    if (this.#settle !== undefined) clearInterval(this.#settle);
    this.#settle = undefined;
  }

  /** Item 172 — throws UNAVAILABLE {service: "needs"} in fieldd's words while the store could not be read at boot; the
   * doors and the verbs that keep a record ask it first. */
  readable(): void {
    this.opts.store.readable();
  }

  /** The open items, oldest asked first, whole. */
  list(): NeedsItem[] {
    const open = [...this.#records.values()]
      .filter((record) => needsStateOf(record.item) === "open")
      .map((record) => record.item);
    return [...open, ...this.#asks.values()].sort((a, b) => a.asked.localeCompare(b.asked));
  }

  /** Every change of the open items, whole, only when they changed. */
  onChange(fn: (items: readonly NeedsItem[]) => void): () => void {
    this.#changes.add(fn);
    return () => this.#changes.delete(fn);
  }

  /** Every notice, as it is told (never kept). */
  onNotice(fn: (notice: NeedsNotice) => void): () => void {
    this.#notices.add(fn);
    return () => this.#notices.delete(fn);
  }

  /** ask_user (CP3-D2 A): the question waits as an item, its choices then Not now. */
  ask(from: HoldSender, input: ComposeAskUserInput): NeedsItemId {
    this.#bound(from.spark);
    const id = NeedsStore.mintId();
    this.#keep({
      format: NEEDS_RECORD_FORMAT,
      item: {
        id,
        kind: "question" satisfies NeedsItemKind,
        state: "open" satisfies NeedsItemState,
        from: this.#fromOf(from),
        spark: from.spark,
        asked: this.#now().toISOString(),
        ...shown(input.question),
        choices: [...input.choices, NEEDS_CHOICE_WORDS.notNow],
      },
    });
    this.#emit();
    return id;
  }

  /** notify (CP3-D5 A): heard by every window and by main, never kept. */
  notify(from: NeedsFrom, text: string): NeedsNotice {
    const key = from.session ?? from.name;
    const now = this.#now().getTime();
    const recent = (this.#told.get(key) ?? []).filter((at) => now - at < NOTIFY_WINDOW_MS);
    if (recent.length >= NOTIFY_PER_MINUTE)
      throw refuse(
        "limit",
        `you have told the user ${NOTIFY_PER_MINUTE} things in the last minute; wait before telling them more`,
      );
    const said = words.noticeWords(text);
    if (said === "") throw refuse("bad-input", "text: there are no words to say");
    recent.push(now);
    this.#told.set(key, recent);
    const notice: NeedsNotice = {
      id: NeedsStore.noticeId(),
      from,
      words: said,
      at: new Date(now).toISOString(),
    };
    for (const fn of this.#notices) this.#guard("notice", () => fn(notice));
    return notice;
  }

  // ── TalkHolds (the talk room's port) ──

  allowed(spark: SparkId, runtimeRunId: string): boolean {
    for (const record of this.#records.values())
      if (
        isAllowance(record) &&
        record.item.from.spark === spark &&
        record.item.to?.session === runtimeRunId
      )
        return true;
    return false;
  }

  send(from: HoldSender, runtimeRunId: string, text: string): NeedsItemId {
    // words held for the same run join its open item; an item an answer is acting on takes none (critique 5)
    const open = [...this.#records.values()].find(
      (record) =>
        needsKindOf(record.item) === "held-send" &&
        needsStateOf(record.item) === "open" &&
        record.acting === undefined &&
        record.item.from.spark === from.spark &&
        record.item.to?.session === runtimeRunId,
    );
    if (open !== undefined) {
      const texts = [...(open.texts ?? []), text];
      if (texts.length > NEEDS_HELD_SENDS_MAX)
        throw refuse(
          "limit",
          `${NEEDS_HELD_SENDS_MAX} of your sends to ${open.item.to?.name ?? runtimeRunId} wait for the user's OK; wait for an answer`,
        );
      this.#keep({ ...open, texts, item: { ...open.item, count: texts.length } });
      this.#emit();
      return open.item.id;
    }
    this.#bound(from.spark);
    const id = NeedsStore.mintId();
    this.#keep({
      format: NEEDS_RECORD_FORMAT,
      item: {
        id,
        kind: "held-send" satisfies NeedsItemKind,
        state: "open" satisfies NeedsItemState,
        from: this.#fromOf(from),
        spark: from.spark,
        asked: this.#now().toISOString(),
        ...shown(text),
        choices: [NEEDS_CHOICE_WORDS.allow, NEEDS_CHOICE_WORDS.notNow],
        count: 1,
        to: {
          session: runtimeRunId,
          name: this.opts.run(runtimeRunId)?.label ?? words.nameWords(runtimeRunId),
        },
      },
      texts: [text],
      sender: from.name,
    });
    this.#emit();
    return id;
  }

  spawn(from: HoldSender, launch: HeldLaunch, live: number): NeedsItemId {
    this.#bound(from.spark);
    const id = NeedsStore.mintId();
    const folder = folderNameOf(launch.cwd);
    const first = launch.tasks[0];
    this.#keep({
      format: NEEDS_RECORD_FORMAT,
      item: {
        id,
        kind: "held-spawn" satisfies NeedsItemKind,
        state: "open" satisfies NeedsItemState,
        from: this.#fromOf(from),
        spark: from.spark,
        asked: this.#now().toISOString(),
        ...(first !== undefined ? shown(first) : {}),
        choices: [NEEDS_CHOICE_WORDS.allowOneMore, NEEDS_CHOICE_WORDS.notNow],
        agent: launch.agent,
        ...(folder !== undefined ? { folder: words.clip(folder, 255) } : {}),
        live,
      },
      launch: {
        agent: launch.agent,
        profileSet: launch.profileSet,
        cwd: launch.cwd,
        ...(launch.model !== undefined ? { model: launch.model } : {}),
        tasks: [...launch.tasks],
        // SP-1e2 (SPE-Q38 (a)) — the crew it was asked in, which Allow one more joins
        ...(launch.crew !== undefined ? { crew: launch.crew } : {}),
      },
      sender: from.name,
    });
    this.#emit();
    return id;
  }

  // ── a flow run's items (CP-4a2b, §13a slice 6) ──

  /** A flow run's item, raised by the runs: kept, signed, before it is shown, its acts the runs' then Stop the run. The
   * same kind raised again for the same run and call while it is open (a restart restored it, or a wake asks again) is
   * that item, never a second (D2's re-bind). Refused `bad-input`: more than NEEDS_CHOICES_MAX acts before Stop the
   * run, an act that is empty or past NEEDS_CHOICE_MAX, or one said twice (Stop the run is never a gate's own). */
  flowItem(raise: FlowItemRaise): NeedsItemId {
    const open = this.#openFlowItem(raise.kind, raise.run);
    if (open !== undefined) return open.item.id;
    if (raise.acts.length > NEEDS_CHOICES_MAX)
      throw refuse("bad-input", `acts: at most ${NEEDS_CHOICES_MAX} before Stop the run`);
    const choices = [...raise.acts, NEEDS_CHOICE_WORDS.stopRun];
    const seen = new Set<string>();
    for (const act of choices) {
      if (act.length === 0 || act.length > NEEDS_CHOICE_MAX)
        throw refuse("bad-input", `acts: each is 1 to ${NEEDS_CHOICE_MAX} characters`);
      if (seen.has(act.toLowerCase())) throw refuse("bad-input", `acts: "${act}" is there twice`);
      seen.add(act.toLowerCase());
    }
    const id = NeedsStore.mintId();
    this.#keep({
      format: NEEDS_RECORD_FORMAT,
      item: {
        id,
        kind: raise.kind satisfies NeedsItemKind,
        state: "open" satisfies NeedsItemState,
        from: { name: words.nameWords(raise.name) },
        ...(raise.spark !== undefined ? { spark: raise.spark } : {}),
        asked: this.#now().toISOString(),
        ...(raise.words !== undefined && raise.words !== "" ? shown(raise.words) : {}),
        choices,
        run: raise.run,
      },
    });
    this.#emit();
    return id;
  }

  /** The runs hand over their side of their items once they are built (they are built after the queue, and raise
   * through it). Until then a flow item's answer is refused, retryably, and nothing is spent. A later hand-over is the
   * one answers go to. */
  bindFlowActs(acts: FlowItemActs): void {
    this.#flowActs = acts;
  }

  /** A flow run ended (done, stopped, failed or set aside): its open items end, and an answer after is refused
   * `ended`. Nothing is owed: the runs say the end themselves. */
  onFlowRunEnded(run: string): void {
    for (const record of [...this.#records.values()])
      if (record.item.run?.run === run && needsStateOf(record.item) === "open")
        this.#endFlow(record);
    this.#emit();
  }

  /** The runs end one item alone: an open flow item whose call their journal already answered (the boot case of
   * R13d/R36: the run's record's `held.item` names it, and the queue's record of the answer was not kept). Answers
   * whether it ended one: an item no longer open, one that holds no flow run, or an id never held ends nothing. */
  endFlowItem(id: NeedsItemId): boolean {
    const record = this.#records.get(id);
    if (record?.item.run === undefined || needsStateOf(record.item) !== "open") return false;
    this.#endFlow(record);
    this.#emit();
    return true;
  }

  /** A flow item ended with no answer: it follows what the runs did, so it stands whatever the disk does, and holds
   * nothing more (no answer, nothing owed): its file goes, and it is remembered for an answer that comes after. */
  #endFlow(record: NeedsRecord): void {
    this.#stand({ ...record, item: { ...record.item, state: "ended" satisfies NeedsItemState } });
  }

  /** N5 (CP4-Q5 (a)) — a flow that changed since you approved it, or never approved, asked before its run starts. A
   * spark's flow_run that waits on it is its teller (`from`, `spark`, and ‹flow› in `words`, as a proposal's item
   * names its flow): it is told what you chose, and its open items' watermark counts it. Yours names the flow, and
   * tells no one. Its acts: Run this version, Run the one you approved (only while one is), Not now last; See the
   * change is the card's, drawn from `script`. The same teller asking to run the same bytes while it is open is that
   * item, never a second. */
  flowChanged(raise: FlowChangedRaise): NeedsItemId {
    const { script, from } = raise;
    for (const record of this.#records.values()) {
      const { item } = record;
      if (
        needsKindOf(item) === "flow-changed" &&
        needsStateOf(item) === "open" &&
        item.script?.flow === script.flow &&
        item.script.hash === script.hash &&
        item.from.spark === from?.spark
      )
        return item.id;
    }
    if (from !== undefined) this.#bound(from.spark);
    const id = NeedsStore.mintId();
    this.#keep({
      format: NEEDS_RECORD_FORMAT,
      item: {
        id,
        kind: "flow-changed" satisfies NeedsItemKind,
        state: "open" satisfies NeedsItemState,
        ...(from !== undefined
          ? { from: this.#fromOf(from), spark: from.spark, words: words.nameWords(raise.name) }
          : { from: { name: words.nameWords(raise.name) } }),
        asked: this.#now().toISOString(),
        choices: [
          NEEDS_CHOICE_WORDS.runThisVersion,
          ...(script.approved !== undefined ? [NEEDS_CHOICE_WORDS.runApproved] : []),
          NEEDS_CHOICE_WORDS.notNow,
        ],
        script,
      },
    });
    this.#emit();
    return id;
  }

  // ── the window's answer ──

  /** needs.answer: the act at `choice` among the item's acts. Answered once, for every window. */
  async answer(id: NeedsItemId, choice: number, principal: GrantPrincipal): Promise<NeedsAnswered> {
    // two answers to one item are one: the second waits for the first, then reads what it left (critique 5)
    for (let prior = this.#inFlight.get(id); prior !== undefined; prior = this.#inFlight.get(id))
      await prior.catch(() => undefined);
    const record = this.#records.get(id);
    if (record === undefined || needsStateOf(record.item) !== "open")
      return { item: this.#answeredAgain(id, record, choice) };
    const acts = record.item.choices ?? [];
    if (!Number.isInteger(choice) || choice < 0 || choice >= acts.length)
      throw refuseAnswer(`${id} has no act ${choice}`, "no-such-act");
    const run = this.#answer(record, choice, principal);
    this.#inFlight.set(id, run);
    try {
      return await run;
    } finally {
      if (this.#inFlight.get(id) === run) this.#inFlight.delete(id);
    }
  }

  // ── what the runs say ──

  /** A run's monitor row changed: its own ask, the first of its blockers that waits on the person (CP3-D1 A). */
  onRunMonitor(runtimeRunId: string, mirror: MonitorBlockers | undefined): void {
    const next = mirror === undefined ? undefined : this.#askOf(runtimeRunId, mirror);
    const prev = this.#asks.get(runtimeRunId);
    if (next === undefined) {
      if (prev !== undefined) {
        this.#asks.delete(runtimeRunId);
        this.#emit();
      }
      return;
    }
    if (prev !== undefined && JSON.stringify(prev) === JSON.stringify(next)) return;
    this.#asks.set(runtimeRunId, next);
    this.#emit();
  }

  /** A run ended: its ask goes, words held for it end and their spark is told, and an allowance for it ends. */
  onRunEnded(runtimeRunId: string): void {
    this.#asks.delete(runtimeRunId);
    this.#told.delete(runtimeRunId);
    for (const record of [...this.#records.values()]) {
      const { item } = record;
      if (needsKindOf(item) !== "held-send" || item.to?.session !== runtimeRunId) continue;
      if (record.acting !== undefined) continue; // the answer acting on it re-checks the run itself
      if (needsStateOf(item) === "open") {
        const { texts: _dropped, sender: _sender, ...rest } = record;
        const ended: NeedsRecord = {
          ...rest,
          item: { ...item, state: "ended" satisfies NeedsItemState },
          owed: words.sendEndedFact(item.from.name, item.to.name),
        };
        this.#stand(this.#delivered(ended, this.#sparkSessionOf(ended)));
      } else if (isAllowance(record))
        this.#keep({ ...record, item: { ...item, state: "ended" satisfies NeedsItemState } });
    }
    this.#emit();
  }

  /** A spark's own session is live: what it is owed lands there, oldest first. A fact already in a queue is not
   * queued again (`#delivered`), so a monitor row that comes again changes nothing. */
  onSparkLive(spark: SparkId, runtimeRunId: string): void {
    const owed = [...this.#records.values()].filter(
      (record) => record.owed !== undefined && record.item.from.spark === spark,
    );
    if (owed.length === 0 || !this.opts.run(runtimeRunId)?.live) return;
    owed.sort((a, b) => a.item.asked.localeCompare(b.item.asked));
    for (const record of owed) {
      const told = this.#delivered(record, runtimeRunId);
      if (told !== record) this.#stand(told);
    }
  }

  /** What became of a line that carried answers' facts (item 158, CO-Q9 (b)), as the input queue told it: delivered,
   * they are heard; dropped, they are owed again; uncertain, they are never told again. Only a record telling at `run`
   * moves, so a late word from a run whose line was dropped, and told elsewhere since, changes nothing. */
  onFactOutcome(run: string, items: readonly NeedsItemId[], outcome: DeliveryOutcome): void {
    if (outcome === "waiting") return;
    for (const id of items) {
      const record = this.#records.get(id);
      if (record === undefined || record.telling?.run !== run) continue;
      const { owed: _owed, telling: _telling, ...heard } = record;
      if (outcome === "dropped") {
        this.#stand(this.#owedAgain(record, words.sessionEndedWaits(record.item.from.name)));
        continue;
      }
      if (outcome === "uncertain")
        this.#logger.warn(
          "fieldd.needs.fact_uncertain",
          "An answer's fact was sent and its session gave no sign it took it; it is not told again",
          { item: id, run },
        );
      this.#stand(heard);
    }
  }

  /** At boot, after both stores are read (item 158): a record telling at a run whose kept queue no longer carries its
   * item (a file set aside, unkept or lost) is owed again. A stamped head still carries its items: its report settles
   * them. */
  reconcileTelling(carries: (run: string, item: NeedsItemId) => boolean): void {
    for (const record of [...this.#records.values()]) {
      const { telling } = record;
      if (telling === undefined || carries(telling.run, record.item.id)) continue;
      this.#logger.info(
        "fieldd.needs.fact_owed_again",
        "An answer's fact is no longer in its session's kept queue; it is owed again",
        { item: record.item.id, run: telling.run },
      );
      this.#stand(this.#owedAgain(record));
    }
  }

  // ── inside ──

  async #answer(
    record: NeedsRecord,
    choice: number,
    principal: GrantPrincipal,
  ): Promise<NeedsAnswered> {
    const { item } = record;
    const at = this.#now().toISOString();
    const act = await this.#act(record, choice, at);
    const answer: NeedsAnswer = {
      choice,
      at,
      outcome: act.outcome,
      ...(act.reason !== undefined ? { reason: words.reasonWords(act.reason) } : {}),
      told: false,
    };
    // what an Allow acted on is spent: only the answer, and what its spark is owed, are kept
    const answered: NeedsRecord = {
      format: NEEDS_RECORD_FORMAT,
      item: { ...item, state: "answered" satisfies NeedsItemState, answer },
      ...(act.owed !== undefined ? { owed: act.owed } : {}),
    };
    // an act that began (its mark kept) is done: what it did stands whatever the disk does now, so the item never
    // waits on with its act spent (CP2-D2); an answer that began none is written through, and its item waits on when
    // the disk does not take it
    if (this.#records.get(item.id)?.acting !== undefined) this.#stand(answered);
    else this.#keep(answered);
    this.#emit();
    // TH-1 — your answer, in the asking spark's own transcript, by the act's words
    const said = item.choices?.[choice];
    if (item.from.spark !== undefined && item.from.session !== undefined && said !== undefined)
      this.opts.appendAct?.(item.from.spark, item.from.session, { what: "answer", text: said });
    const { woke } = await this.#tellAnswer(item.id, principal);
    // the record as its telling left it: kept, or forgotten once told (and remembered for an answer again)
    const final = this.#records.get(item.id)?.item ?? this.#answered.get(item.id) ?? answered.item;
    return { item: final, ...(woke !== undefined ? { woke } : {}) };
  }

  /** The act an answer names, by the item's kind. Not now is always its last act. */
  async #act(record: NeedsRecord, choice: number, at: string): Promise<Act> {
    const { item } = record;
    const acts = item.choices ?? [];
    const notNow = choice === acts.length - 1;
    const spark = item.from.name;
    const kind = needsKindOf(item);
    switch (kind) {
      case "question":
        return {
          outcome: "done",
          owed: words.answeredFact(spark, item.words ?? "", acts[choice] ?? ""),
        };
      case "held-send":
        return notNow
          ? { outcome: "done", owed: words.sendHeldBackFact(spark, item.to?.name ?? "") }
          : this.#allowSend(record, choice, at);
      case "held-spawn":
        return notNow
          ? { outcome: "done", owed: words.spawnNotNowFact(spark, SPARK_LIVE_AGENTS_MAX) }
          : this.#allowSpawn(record, choice, at);
      case "flow-gate":
      case "flow-cap":
      case "flow-repair":
      case "flow-lost":
        return this.#flowAct(record, kind, choice);
      case "flow-changed":
        return this.#flowStart(record, choice, at);
      default:
        throw refuseAnswer(`fieldd cannot answer a ${item.kind} here`, "unknown-kind");
    }
  }

  /** CP-4a2b (13a's D22) — a flow run's item: handed to the runs, Stop the run as `stop` (its last act). Their journal
   * is the act's record, so it takes no `acting` mark and is never uncertain (CP2-D2). One handed on before the runs
   * have bound their acts, or that throws, acted on nothing: the item waits on. */
  async #flowAct(record: NeedsRecord, kind: FlowRunItemKind, choice: number): Promise<Act> {
    const { item } = record;
    const acts = this.#flowActs;
    if (acts === undefined)
      throw new RpcCallError("PRECONDITION_FAILED", FLOWS_UNBOUND, true, {
        reason: "flows-unbound",
      });
    if (item.run === undefined) throw refuseAnswer(`${item.id} names no flow run`, "unknown-kind");
    const stop = choice === (item.choices?.length ?? 0) - 1;
    const acted = await acts.answer({ id: item.id, kind, run: item.run, choice, stop });
    return acted.outcome === "done"
      ? { outcome: "done" }
      : { outcome: "failed", reason: acted.reason };
  }

  /** N5 — a changed flow's answer. Run this version or Run the one you approved is kept begun first (`acting`), as a
   * held spawn's Allow is, then handed to the runs: the start has no journal of its own before its run, so a restart
   * that finds it begun makes it uncertain (`#uncertain`) and it is never started again (CP2-D2; cp-landing's D). Not
   * now starts nothing. Before the runs have bound their acts it is refused, and nothing is begun. A spark's item owes
   * that spark what came of it; yours owes no one. */
  async #flowStart(record: NeedsRecord, choice: number, at: string): Promise<Act> {
    const { item } = record;
    const acts = this.#flowActs;
    const script = item.script;
    if (acts === undefined)
      throw new RpcCallError("PRECONDITION_FAILED", FLOWS_UNBOUND, true, {
        reason: "flows-unbound",
      });
    if (script === undefined) throw refuseAnswer(`${item.id} names no flow`, "unknown-kind");
    const told = this.#flowTeller(item);
    const owed = (fact: (spark: string, flow: string) => string) =>
      told !== undefined ? { owed: fact(told.spark, told.flow) } : {};
    if (choice === (item.choices?.length ?? 0) - 1)
      return {
        outcome: "done",
        ...owed((spark, flow) => words.flowNotNowFact(spark, flow, script.approved !== undefined)),
      };
    const approved = choice === 1 && script.approved !== undefined ? script.approved : undefined;
    this.#keep({ ...record, acting: { choice, at } });
    let started: FlowItemStarted;
    try {
      started = await acts.start({ id: item.id, flow: script.flow, hash: approved ?? script.hash });
    } catch (err) {
      started = { outcome: "failed", reason: (err as Error).message };
    }
    if (started.outcome === "failed") {
      const { reason } = started;
      return {
        outcome: "failed",
        reason,
        ...owed((spark, flow) => words.flowStartFailedFact(spark, flow, reason)),
      };
    }
    const { run } = started;
    return {
      outcome: "done",
      ...owed((spark, flow) =>
        approved !== undefined
          ? words.flowRanApprovedFact(spark, flow, run)
          : words.flowRanFact(spark, flow, run),
      ),
    };
  }

  /** The spark a changed flow's item tells, by its name, and ‹flow›: none for yours. */
  #flowTeller(item: NeedsItem): { readonly spark: string; readonly flow: string } | undefined {
    if (item.from.spark === undefined) return undefined;
    if (item.words === undefined) throw refuseAnswer(`${item.id} names no flow`, "unknown-kind");
    return { spark: item.from.name, flow: item.words };
  }

  /** Allow: re-checked first (the run is live, the spark's record and its profiles stand, CP-L4 and TL-D5), then each
   * held word queued as the spark's, in order (CP2-D1). A run the one rule can place only by its persona, before fieldd
   * has read the Agent Profiles, is refused retryably (`profiles-unread`): nothing is spent, the item stays open, and
   * the spark is told nothing until an answer acts (TU-1, §12 Q1 (a′): fail closed until the frame). A reason says "it"
   * for the session: its line names it already ("Couldn't send Vela's words to vibe-field·2: it ended"; CO-1b). */
  #allowSend(record: NeedsRecord, choice: number, at: string): Act {
    const { item } = record;
    const spark = item.from.name;
    const target = item.to?.session ?? "";
    const to = item.to?.name ?? target;
    const failed = (reason: string): Act => ({
      outcome: "failed",
      reason,
      owed: words.sendFailedFact(spark, to, reason),
    });
    const run = this.opts.run(target);
    if (run === undefined)
      return { outcome: "failed", reason: "it ended", owed: words.sendEndedFact(spark, to) };
    if (!run.live) return failed("it is not running");
    const sparkId = item.from.spark;
    const sender = record.sender;
    if (sparkId === undefined || sender === undefined)
      return failed("the words' sender is unknown");
    const personaSets = this.opts.personaSets();
    const profile = profileSetOfRun(run, personaSets);
    if (profile === undefined && personaSets === null)
      throw new RpcCallError("PRECONDITION_FAILED", PROFILES_UNREAD, true, {
        reason: "profiles-unread",
      });
    const why = this.#sparkRefusal(sparkId, profile);
    if (why !== undefined) return failed(why);
    this.#keep({ ...record, acting: { choice, at } });
    for (const text of record.texts ?? [])
      this.opts.inputs.enqueue(target, text, { kind: "spark", spark: sparkId, name: sender });
    return { outcome: "done", owed: words.sendAllowedFact(spark, to) };
  }

  /** Allow one more: re-checked, then started past the cap on purpose (CP3-D4 A), its tasks queued in order. */
  async #allowSpawn(record: NeedsRecord, choice: number, at: string): Promise<Act> {
    const { item, launch, sender } = record;
    const spark = item.from.name;
    const sparkId = item.from.spark;
    const failed = (reason: string): Act => ({
      outcome: "failed",
      reason,
      owed: words.spawnFailedFact(spark, reason),
    });
    if (launch === undefined || sender === undefined || sparkId === undefined)
      return failed("the spawn's launch is unknown");
    const agent = this.opts.agentLabel(launch.agent) ?? launch.agent;
    const why = this.#sparkRefusal(sparkId, launch.profileSet, agent);
    if (why !== undefined) return failed(why);
    this.#keep({ ...record, acting: { choice, at } });
    let runtimeRunId: string;
    try {
      ({ runtimeRunId } = await this.opts.spawn(
        {
          agent: launch.agent,
          profileSet: launch.profileSet,
          cwd: launch.cwd,
          ...(launch.model !== undefined ? { model: launch.model } : {}),
        },
        sparkId,
        // SP-1e2 — into the crew it was asked in, made in the spark's run that asked, even after the crew closed
        launch.crew !== undefined && item.from.session !== undefined
          ? { id: launch.crew, sparkRun: item.from.session }
          : undefined,
      ));
    } catch (err) {
      return failed((err as Error).message);
    }
    for (const task of launch.tasks)
      this.opts.inputs.enqueue(runtimeRunId, task, { kind: "spark", spark: sparkId, name: sender });
    return { outcome: "done", owed: words.spawnAllowedFact(spark, agent, runtimeRunId) };
  }

  /** Why the spark may not act there now: its record is gone, or what it acts on is in none of its profiles (TL-D5),
   * whether the one rule places it in another or, with the profiles read, in none (TU-1). What it acts on is `name`,
   * the spawn's agent; a send's is "it", the session its line already names (CO-1b). */
  #sparkRefusal(
    sparkId: SparkId,
    profile: AgentProfileSetId | undefined,
    name = "it",
  ): string | undefined {
    const spark = this.opts.spark(sparkId);
    if (spark === undefined) return "the spark's record is unavailable";
    if (profile === undefined) return `${name} is in none of ${spark.name}'s Agent Profiles`;
    if (!spark.profiles.includes(profile))
      return `${profile} is not one of ${spark.name}'s Agent Profiles`;
    return undefined;
  }

  /** Tell the spark its answer (CP3-D7 A): into its live session, or wake it through compose.sparks.open's own wake
   * (`open`: one per spark, so a window's Wake or Send asked meanwhile joins it, and it joins theirs) and land there
   * once that session is live; otherwise it waits on disk until its session is next live. */
  async #tellAnswer(id: NeedsItemId, principal: GrantPrincipal): Promise<{ woke?: string }> {
    const record = this.#records.get(id);
    const sparkId = record?.item.from.spark;
    if (record?.owed === undefined || record.telling !== undefined || sparkId === undefined)
      return {};
    const live = this.opts.sparkSession(sparkId);
    if (live !== undefined) {
      this.#stand(this.#delivered(record, live));
      return {};
    }
    let summary: SparkSummary;
    try {
      summary = await this.opts.open(sparkId, principal);
    } catch (err) {
      this.#waits(id, (err as Error).message);
      return {};
    }
    const woke = summary.session?.runtimeRunId;
    // the spark's session came alive meanwhile and took it already (onSparkLive): its fact is queued, or heard
    const now = this.#records.get(id);
    if (now?.owed === undefined || now.telling !== undefined)
      return woke !== undefined ? { woke } : {};
    if (woke !== undefined && summary.session?.live === true && this.opts.run(woke)?.live)
      this.#stand(this.#delivered(now, woke));
    else this.#waits(id, `${summary.name}'s session is not running yet`);
    return woke !== undefined ? { woke } : {};
  }

  /** The record once its fact is in the spark's input queue at `run` (never a pending run's): still owed, and telling
   * there, until that session takes the line (item 158, CO-Q9 (b)). The one guard against telling twice: a record
   * already telling is left as it is, and nothing is queued. */
  #delivered(record: NeedsRecord, run: string | undefined): NeedsRecord {
    if (record.owed === undefined || record.telling !== undefined || run === undefined)
      return record;
    this.opts.inputs.wake(run, record.owed, record.item.id);
    const telling: NeedsRecord = { ...record, telling: { run, at: this.#now().toISOString() } };
    const { answer } = record.item;
    if (answer === undefined) return telling;
    const { waits: _waits, ...told } = answer;
    return { ...telling, item: { ...record.item, answer: { ...told, told: true } } };
  }

  /** A record whose fact is no longer in any queue: owed again, its spark not told yet, and why when it is known. */
  #owedAgain(record: NeedsRecord, why?: string): NeedsRecord {
    const { telling: _telling, ...owed } = record;
    const answer = record.item.answer;
    if (answer === undefined) return owed;
    const { waits: _waits, ...rest } = answer;
    return {
      ...owed,
      item: {
        ...record.item,
        answer: {
          ...rest,
          told: false,
          ...(why !== undefined ? { waits: words.reasonWords(why) } : {}),
        },
      },
    };
  }

  /** The answer is kept owed, and says why its spark has not heard it. One whose fact is in a queue already is left as
   * it is: it is not "not running yet". */
  #waits(id: NeedsItemId, why: string): void {
    const record = this.#records.get(id);
    const answer = record?.item.answer;
    if (record?.owed === undefined || record.telling !== undefined || answer === undefined) return;
    this.#stand({
      ...record,
      item: { ...record.item, answer: { ...answer, told: false, waits: words.reasonWords(why) } },
    });
  }

  #sparkSessionOf(record: NeedsRecord): string | undefined {
    const spark = record.item.from.spark;
    return spark === undefined ? undefined : this.opts.sparkSession(spark);
  }

  /** An item that is no longer open, answered again: the same act answers it as it is, another is refused. */
  #answeredAgain(id: NeedsItemId, record: NeedsRecord | undefined, choice: number): NeedsItem {
    if ([...this.#asks.values()].some((ask) => ask.id === id))
      throw refuseAnswer("an agent's own ask is answered in its pane", "in-its-pane");
    const item = record?.item ?? this.#answered.get(id);
    if (item === undefined) throw new RpcCallError("NOT_FOUND", `no needs-you item ${id}`, false);
    if (needsStateOf(item) === "ended" && item.answer === undefined)
      throw refuseAnswer("what it waited on ended before an answer", "ended");
    if (item.answer?.choice === choice) return item;
    const said = item.answer === undefined ? undefined : item.choices?.[item.answer.choice];
    throw refuseAnswer(`already answered: ${said ?? "another act"}`, "answered");
  }

  /** An act a restart found begun and never recorded done (it broke into it, or the disk did not take the record of its
   * end): the spark is told it is uncertain, true whether or not it heard the act before, and it is never done again
   * (CP2-D2). */
  #uncertain(record: NeedsRecord): NeedsRecord {
    const { acting, texts: _texts, launch: _launch, sender: _sender, ...rest } = record;
    const { item } = record;
    const spark = item.from.name;
    const kind = needsKindOf(item);
    // a changed flow's start tells its spark, by ‹flow› in its words (never thrown here: a boot reads every record)
    const flow = item.from.spark !== undefined ? item.words : undefined;
    const owed =
      kind === "flow-changed"
        ? flow !== undefined
          ? words.flowStartUncertainFact(spark, flow)
          : undefined
        : kind === "held-spawn"
          ? words.spawnUncertainFact(spark)
          : words.actUncertainFact(spark, item.to?.name ?? "");
    const next: NeedsRecord = {
      ...rest,
      item: {
        ...item,
        state: "answered" satisfies NeedsItemState,
        answer: {
          choice: acting?.choice ?? YES,
          at: acting?.at ?? this.#now().toISOString(),
          outcome: "failed" satisfies NeedsAnswerOutcome,
          reason: words.UNCERTAIN_REASON,
          told: false,
        },
      },
      ...(owed !== undefined ? { owed } : {}),
    };
    this.#logger.warn(
      "fieldd.needs.act_uncertain",
      "An answer's act was begun and never recorded done when fieldd stopped; it is not done again, and its spark is told",
      { item: item.id, kind: item.kind },
    );
    this.#stand(next);
    return next;
  }

  /** CP3-D1 A: a run's own ask, derived from its blockers, its id the same on every read. */
  #askOf(runtimeRunId: string, mirror: MonitorBlockers): NeedsItem | undefined {
    const asks = mirror.blockers.filter((b) => b.kind === "permission" || b.kind === "question");
    const first = asks[0];
    if (first === undefined) return undefined;
    const run = this.opts.run(runtimeRunId);
    const spark = run?.spark ?? run?.startedBy;
    const tool = projectBlocker(first).tool;
    const digest = createHash("sha256").update(`${runtimeRunId}\0${first.id}`).digest("hex");
    return {
      id: `ny-${digest.slice(0, 16)}`,
      kind: "agent-ask" satisfies NeedsItemKind,
      state: "open" satisfies NeedsItemState,
      from: { name: run?.label ?? words.nameWords(runtimeRunId), session: runtimeRunId },
      ...(spark !== undefined ? { spark } : {}),
      asked: first.since,
      ask: first.kind,
      ...(tool !== undefined ? { tool: words.clip(tool, 128) } : {}),
      count: asks.length,
    };
  }

  /** The open item of a flow run's `kind` at its call (D2's re-bind), if one is held. */
  #openFlowItem(kind: FlowRunItemKind, run: NeedsFlowRun): NeedsRecord | undefined {
    for (const record of this.#records.values()) {
      const { item } = record;
      if (
        needsKindOf(item) === kind &&
        needsStateOf(item) === "open" &&
        item.run?.run === run.run &&
        item.run.call === run.call
      )
        return record;
    }
    return undefined;
  }

  /** PF4's watermark: a spark with eight open items waits for an answer before it asks again. */
  #bound(spark: SparkId): void {
    let open = 0;
    for (const record of this.#records.values())
      if (needsStateOf(record.item) === "open" && record.item.from.spark === spark) open += 1;
    if (open >= NEEDS_OPEN_PER_SPARK)
      throw refuse(
        "limit",
        `you have ${NEEDS_OPEN_PER_SPARK} things waiting on the user; wait for an answer`,
      );
  }

  #fromOf(sender: HoldSender): NeedsFrom {
    return { name: words.nameWords(sender.name), session: sender.session, spark: sender.spark };
  }

  /** Keep a record before anything is acted on it: written through (or its file removed once it holds nothing
   * more), so nothing is done that a restart would not find, and thrown when the disk does not take it; then held. */
  #keep(record: NeedsRecord): void {
    this.#store(record);
    this.#hold(record);
  }

  /** Keep a record that follows what was already done — an answer's once its act began, what an answer or a run's end
   * leaves its spark to hear (told, or still owed), one a restart broke into: held whatever the disk does, so every
   * window and the spark go by what was done. One the disk does not take is logged, and a restart reads what the disk
   * kept: an act it finds begun is uncertain (CP2-D2), and a fact it finds owed is told again, never an act. */
  #stand(record: NeedsRecord): void {
    try {
      this.#store(record);
    } catch (err) {
      this.#logger.warn(
        "fieldd.needs.unkept",
        "A needs-you record that follows an act could not be kept; it stands in memory",
        { item: record.item.id, reason: (err as Error).message },
      );
    }
    this.#hold(record);
  }

  /** The record on disk: written while it holds something, its file removed once it holds nothing more. */
  #store(record: NeedsRecord): void {
    if (needed(record)) this.opts.store.write(record);
    else this.opts.store.remove(record.item.id);
  }

  /** The record in memory: held while it holds something, forgotten once it holds nothing more. An item no longer
   * open is remembered for an answer that comes again. */
  #hold(record: NeedsRecord): void {
    if (needed(record)) this.#records.set(record.item.id, record);
    else this.#records.delete(record.item.id);
    if (needsStateOf(record.item) !== "open") this.#remember(record.item);
  }

  #remember(item: NeedsItem): void {
    this.#answered.delete(item.id);
    this.#answered.set(item.id, item);
    for (const old of this.#answered.keys()) {
      if (this.#answered.size <= ANSWERED_KEPT) break;
      this.#answered.delete(old);
    }
  }

  #emit(): void {
    const items = this.list();
    const shownNow = JSON.stringify(items);
    if (shownNow === this.#shown) return;
    this.#shown = shownNow;
    for (const fn of this.#changes) this.#guard("change", () => fn(items));
  }

  #guard(what: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.#logger.warn("fieldd.needs.listener_failed", `The needs-you queue's ${what} failed`, {
        reason: (err as Error).message,
      });
    }
  }
}
