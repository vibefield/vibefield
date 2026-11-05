import { createHash } from "node:crypto";
import {
  type AgentProfileSetId,
  type ComposeAskUserInput,
  NEEDS_CHOICE_WORDS,
  NEEDS_HELD_SENDS_MAX,
  NEEDS_OPEN_PER_SPARK,
  NEEDS_RECORD_FORMAT,
  NEEDS_WORDS_MAX,
  type NeedsAnswer,
  type NeedsAnswerOutcome,
  type NeedsFrom,
  type NeedsItem,
  type NeedsItemId,
  type NeedsItemKind,
  type NeedsItemState,
  type NeedsNotice,
  type NeedsRecord,
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
  /** as a wake names it: its title, else its agent's label, else its id; one line of at most NEEDS_NAME_MAX */
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
  readonly now?: () => Date;
  readonly logger?: Logger;
}

/** An answer as the door records it: the item, and the run it woke when it resumed or started a sleeping spark. */
export interface NeedsAnswered {
  readonly item: NeedsItem;
  readonly woke?: string;
}

/** A tool call's refusal, with the fact the model reads (index.ts). */
const refuse = (fact: string, message: string) =>
  new RpcCallError("PRECONDITION_FAILED", message, false, { fact });
/** A window's refused answer, with its reason (the compose doors' shape). */
const refuseAnswer = (message: string, reason: string) =>
  new RpcCallError("PRECONDITION_FAILED", message, false, { reason });
/** TU-1 (§12 Q1 (a′)) — an Allow fieldd cannot place yet: the profiles are not read, so the item stays open and the
 * same answer is taken once the monitor's first frame lands. */
const PROFILES_UNREAD = "VibeField hasn't read the Agent Profiles yet. Try again in a moment";

/** What an act did, and what its spark is owed. */
interface Act {
  readonly outcome: NeedsAnswerOutcome;
  readonly reason?: string;
  readonly owed: string;
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
    for (const record of this.opts.store.list()) {
      const kept = record.acting === undefined ? record : this.#uncertain(record);
      this.#records.set(kept.item.id, kept);
    }
    this.#shown = JSON.stringify(this.list());
    return this.#records.size;
  }

  /** Once this boot's re-attach has settled, a held send or an allowance whose run the fold no longer holds ended
   * while fieldd was down: no exit event will say so (critique 3). Asked once, after `settled()` first holds; then
   * `alongside`, the same moment's reconcile of another store (the input queue's, item 158). */
  reconcileWhenSettled(settled: () => boolean, alongside?: () => void): void {
    if (this.#settle !== undefined) return;
    this.#settle = setInterval(() => {
      if (!settled()) return;
      this.stop();
      this.reconcile();
      if (alongside !== undefined) this.#guard("reconcile", alongside);
    }, SETTLE_POLL_MS);
    this.#settle.unref?.();
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
      },
      sender: from.name,
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
      owed: act.owed,
    };
    // an act that began (its mark kept) is done: what it did stands whatever the disk does now, so the item never
    // waits on with its act spent (CP2-D2); an answer that began none is written through, and its item waits on when
    // the disk does not take it
    if (this.#records.get(item.id)?.acting !== undefined) this.#stand(answered);
    else this.#keep(answered);
    this.#emit();
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
    switch (needsKindOf(item)) {
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
      default:
        throw refuseAnswer(`fieldd cannot answer a ${item.kind} here`, "unknown-kind");
    }
  }

  /** Allow: re-checked first (the run is live, the spark's record and its profiles stand, CP-L4 and TL-D5), then each
   * held word queued as the spark's, in order (CP2-D1). A run the one rule can place only by its persona, before fieldd
   * has read the Agent Profiles, is refused retryably (`profiles-unread`): nothing is spent, the item stays open, and
   * the spark is told nothing until an answer acts (TU-1, §12 Q1 (a′): fail closed until the frame). */
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
      return { outcome: "failed", reason: `${to} ended`, owed: words.sendEndedFact(spark, to) };
    if (!run.live) return failed(`${to} is not running`);
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
    const why = this.#sparkRefusal(sparkId, profile, to);
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
      ));
    } catch (err) {
      return failed((err as Error).message);
    }
    for (const task of launch.tasks)
      this.opts.inputs.enqueue(runtimeRunId, task, { kind: "spark", spark: sparkId, name: sender });
    return { outcome: "done", owed: words.spawnAllowedFact(spark, agent, runtimeRunId) };
  }

  /** Why the spark may not act there now: its record is gone, or what it acts on (`name`) is in none of its profiles
   * (TL-D5), whether the one rule places it in another or, with the profiles read, in none (TU-1). */
  #sparkRefusal(
    sparkId: SparkId,
    profile: AgentProfileSetId | undefined,
    name: string,
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
    const owed =
      needsKindOf(item) === "held-spawn"
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
      owed,
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
