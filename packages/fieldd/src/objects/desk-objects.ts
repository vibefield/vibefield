import type {
  ObjectGrant,
  ObjectGrantRow,
  ObjectIntent,
  ObjectRef,
  ObjectsHandResult,
  ObjectYours,
} from "@vibefield/contracts";
import { IntentUndoValue, OBJECT_ROOM } from "@vibefield/contracts";
import { RpcCallError } from "../native-link";
import { DeskIntents, type DeskIntentsOptions } from "./intents";
import { type DeskKind, deskKinds } from "./kinds";
import { type AtWorkAgent, ObjectPresenceBoard } from "./presence";
import { ObjectsRegistry } from "./registry";
import type { ObjectsStore } from "./store";
import { AgentUndoShelf, type KeptChange } from "./undo";

// OB-3a, OB-3b, OB-4 — the desk's state in fieldd, whole: the registry and grants, the intent table, presence, and the
// agents' undo. The window's door (doors.ts) and the desk room (tool-plane/rooms/desk) are its two readers. Everything
// the person does that changes who may work what is here, so both doors hold to one rule (OB-L8: policy in fieldd,
// mechanism where the kind lives).
//
// OB custody (C4; OB-D18 A) — who a run is, for a grant, is fieldd's own memory of what it launched (`bornFor`), never
// a record read back from disk. A run's record is signed with a key that is a file the same user can read, so an agent
// can rewrite its own run's record to name any spark; were a holder read from it, the agent would be served that
// spark's grants with no restart at all. So a grant is honoured only for a run THIS fieldd launched: a plain run's
// grants end with fieldd, a spark's stand (EY-D9 B) and are held by the runs fieldd starts for it from then on, and a
// run that was already running when fieldd started holds nothing and can be handed nothing.

export type RunState = "live" | "ended" | "unknown";

/** What this fieldd process launched a run as: plain (`{}`), or for a spark. */
export interface BornFor {
  readonly spark?: string | undefined;
}

export interface DeskObjectsOptions {
  readonly store: ObjectsStore;
  /** whether a run can still be handed work */
  runState(run: string): RunState;
  /** how the desk names a run */
  label(run: string): string;
  /** OB-D18 A — what THIS fieldd process launched the run as, from the launch call's own argument and never from a
   * record: `{ spark }` for a spark's run, `{}` for a plain one (a launch adopted through the agent gateway is plain,
   * whatever its record names), and undefined for a run it did not launch (re-attached at boot). It must go on
   * answering for a run that has ended: a sleeping spark is handed things by its last run's id, and a resume is told
   * after the end. */
  bornFor(run: string): BornFor | undefined;
  /** What a run's RECORD says its spark is. A record is a file an agent can rewrite, so this never gives anything: it
   * is read only to take away, when the person takes an object back from a run fieldd cannot vouch for. */
  sparkOf(run: string): string | undefined;
  /** a spark's name; undefined when fieldd no longer holds it */
  sparkName(id: string): string | undefined;
  /** the agent a run is, by its catalog id */
  agentOf(run: string): string;
  /** the kinds table (OB-2); the one seam */
  readonly kinds?: () => readonly DeskKind[];
  readonly intents?: DeskIntentsOptions;
  readonly now?: () => number;
  readonly releasedShownMs?: number;
}

/** A spark's grants are the spark's: its run id changes each time it sleeps and wakes. */
const SPARK_HOLDER = "spark:";
/** A run this fieldd did not launch holds under a name nothing is ever granted to, so it holds nothing. */
const UNVOUCHED_HOLDER = "re-attached:";

const NO_SUCH_AGENT = "VibeField doesn't know that agent.";
/** A hand to a run fieldd cannot vouch for: it was running before this fieldd started (OB-D18 A). */
const UNVOUCHED_AGENT =
  "That agent was running before VibeField restarted. Start it again, or hand this to another.";
const ENDED_AGENT = "That agent has ended. Start it again, or hand this to another.";
const NO_SUCH_OBJECT = "VibeField doesn't know that object.";

/** The same, said to the agent itself when it would place something: nothing would hold what it made. */
const unvouched = (): RpcCallError =>
  new RpcCallError(
    "UNAVAILABLE",
    "This session was running before VibeField restarted, so it holds nothing on the desk. Ask the user to start it again.",
    false,
    { service: "desk", state: "before-restart" },
  );

interface EndedRun {
  readonly on: readonly ObjectRef[];
  readonly grants: readonly { ref: ObjectRef; how: ObjectYours; at: number }[];
}

export class DeskObjects {
  readonly registry: ObjectsRegistry;
  readonly intents: DeskIntents;
  readonly presence: ObjectPresenceBoard;
  readonly undo = new AgentUndoShelf();
  /** what each ended run had, until a resume names its successor: fieldd's memory, bounded, never a claim */
  readonly #ended = new Map<string, EndedRun>();

  constructor(private readonly opts: DeskObjectsOptions) {
    this.registry = new ObjectsRegistry({
      store: opts.store,
      ...(opts.now ? { now: opts.now } : {}),
    });
    this.intents = new DeskIntents(opts.intents);
    this.presence = new ObjectPresenceBoard({
      keyOf: (run) => this.holder(run),
      locate: (ref) => {
        const record = this.registry.get(ref);
        return record && { docId: record.docId, key: record.key };
      },
      ...(opts.now ? { now: opts.now } : {}),
      ...(opts.releasedShownMs !== undefined ? { releasedShownMs: opts.releasedShownMs } : {}),
    });
  }

  boot(): void {
    this.registry.boot();
  }

  kinds(): readonly DeskKind[] {
    return (this.opts.kinds ?? deskKinds)();
  }

  kind(id: string | undefined): DeskKind | undefined {
    return id === undefined ? undefined : this.kinds().find((k) => k.kind === id);
  }

  who(run: string): AtWorkAgent {
    return { run, handle: this.opts.label(run), agent: this.opts.agentOf(run) };
  }

  /** A window takes a board's intents. When it stops, nobody's hand can be on that board any more. */
  subscribeDesk(docId: string, tokenId: string, send: (intent: ObjectIntent) => void): () => void {
    const stop = this.intents.subscribe(docId, tokenId, send);
    return () => {
      stop();
      // a newer window on this board has its own hand; the one that closed can no longer hold anything
      if (this.intents.holds(docId)) return;
      for (const ref of this.registry.refsOn(docId)) this.presence.hold(ref, false);
    };
  }

  /** Who a run's grants belong to (OB-D18 A): what THIS fieldd launched it as, never what a record says. A run it
   * launched for a spark holds as the spark; a plain run it launched, as itself; a run it did not launch, under a name
   * nothing is ever granted to, so it holds nothing. A spark's holder as `grants` names it is taken as itself. */
  holder(run: string): string {
    if (run.startsWith(SPARK_HOLDER)) return run;
    const born = this.opts.bornFor(run);
    if (born === undefined) return `${UNVOUCHED_HOLDER}${run}`;
    return born.spark === undefined ? run : `${SPARK_HOLDER}${born.spark}`;
  }

  /** Whether this fieldd launched the run, and so can say whose it is. */
  vouched(run: string): boolean {
    return this.opts.bornFor(run) !== undefined;
  }

  /** Throws unless the run can be given anything. A run fieldd did not launch holds nothing, and is told so before
   * the window is asked to make an object nobody would hold. */
  vouch(run: string): void {
    if (!this.vouched(run)) throw unvouched();
  }

  grantOf(ref: ObjectRef, run: string): ObjectGrant | undefined {
    return this.registry.grantOf(ref, this.holder(run));
  }

  /** Throws when the run cannot be vouched for, or the grant cannot be kept. */
  grant(ref: ObjectRef, run: string, how: ObjectYours): void {
    this.vouch(run);
    this.registry.grant(ref, this.holder(run), how);
  }

  /** The run's grant ends; a spark's for every run of it. */
  revoke(ref: ObjectRef, run: string): void {
    this.registry.revoke(ref, this.holder(run));
  }

  /** OB-L1 — the grant, on the person's play. A run that does not exist or has ended holds nothing: said, never kept. A
   * spark has not ended when its last run has: it sleeps, and what it is handed waits for it. A run this fieldd did
   * not launch can be handed nothing, whatever its record says it is (OB-D18 A). Throws when the grant cannot be
   * kept: nothing is granted that a restart would not find. */
  hand(ref: ObjectRef, run: string): ObjectsHandResult {
    const record = this.registry.get(ref);
    if (record === undefined) return { handed: false, reason: NO_SUCH_OBJECT };
    const born = this.opts.bornFor(run);
    const state = this.opts.runState(run);
    if (born === undefined)
      return { handed: false, reason: state === "unknown" ? NO_SUCH_AGENT : UNVOUCHED_AGENT };
    if (born.spark === undefined) {
      if (state === "unknown") return { handed: false, reason: NO_SUCH_AGENT };
      if (state === "ended") return { handed: false, reason: ENDED_AGENT };
    }
    const holder = this.holder(run);
    const already = this.registry.grantOf(ref, holder) !== undefined;
    if (this.kind(record.kind)?.concurrency === "one") {
      const others = this.registry.grantsOn(ref).filter((grant) => grant.holder !== holder);
      try {
        this.registry.moveTo(ref, holder);
      } finally {
        // what the move took away stays taken even when the hand itself could not be kept
        for (const { holder: left } of others)
          if (this.registry.grantOf(ref, left) === undefined) this.#releaseHolder(ref, left);
      }
      this.presence.moveHolder(ref, run);
    } else {
      this.registry.grant(ref, holder, "handed");
    }
    return already ? { handed: true, already: true } : { handed: true };
  }

  /** The person takes an object back: the grant ends, and the agent's next call answers `not-handed`. `run` is a run, or
   * a holder as `grants` names it. A take-back always takes (OB-D19 A): the grant is gone from memory whatever the
   * disk says, and it reaches the grant the person means whoever fieldd can vouch for. So it ends what the run holds
   * as fieldd knows it, what is held under the very name given, and, for a run fieldd did not launch, what its record's
   * spark holds: a record is believed here only because believing it can do no more than take away. */
  takeBack(ref: ObjectRef, run: string): void {
    const holders = new Set([this.holder(run), run]);
    if (!this.vouched(run)) {
      const spark = this.opts.sparkOf(run);
      if (spark !== undefined) holders.add(`${SPARK_HOLDER}${spark}`);
    }
    this.registry.end((grant) => grant.ref === ref && holders.has(grant.holder));
    for (const holder of holders) {
      this.#releaseHolder(ref, holder);
      this.presence.dropLease(ref, holder);
    }
  }

  /** Whether the grants file holds every change so far: false after a take-back the disk would not take, which
   * stands all the same, until a write lands. */
  get kept(): boolean {
    return this.registry.kept;
  }

  /** Once whoever outlives fieldd was told the grants' count as it stands, or the wait for them has run out (OB-D19
   * A). A door or a verb that changed a grant awaits this before it answers; it never rejects. */
  settled(): Promise<void> {
    return this.registry.settled();
  }

  /** Stop the store's timer. */
  close(): void {
    this.registry.close();
  }

  /** Whether this run's process is still here to be answered. */
  runLive(run: string): boolean {
    return this.opts.runState(run) === "live";
  }

  /** Whether a grant to this run would have anyone to serve: a live run this fieldd launched, or a spark it launched
   * the run for, which outlasts its runs. */
  runStands(run: string): boolean {
    const born = this.opts.bornFor(run);
    return born !== undefined && (born.spark !== undefined || this.runLive(run));
  }

  /** §11 — every grant still standing, or one object's, with whose it is: it outlives the app, so it can be forgotten. */
  grants(ref?: ObjectRef): ObjectGrantRow[] {
    const rows: ObjectGrantRow[] = [];
    for (const grant of this.registry.grants()) {
      if (ref !== undefined && grant.ref !== ref) continue;
      const record = this.registry.get(grant.ref);
      if (record === undefined) continue;
      rows.push({
        ref: record.ref,
        docId: record.docId,
        key: record.key,
        ...(record.kind !== undefined ? { kind: record.kind } : {}),
        holder: grant.holder,
        name: this.#nameOf(grant.holder),
        how: grant.how,
        at: grant.at,
      });
    }
    return rows;
  }

  #nameOf(holder: string): string {
    if (!holder.startsWith(SPARK_HOLDER)) return this.opts.label(holder);
    return this.opts.sparkName(holder.slice(SPARK_HOLDER.length)) ?? holder;
  }

  /** Every run of this holder on this object reads released. */
  #releaseHolder(ref: ObjectRef, holder: string): void {
    for (const run of this.presence.runsOn(ref))
      if (this.holder(run) === holder) this.presence.released(ref, run);
  }

  /** Once the boot's re-attach has settled: every plain run's grant from before this fieldd ends (OB-D18 A: a plain
   * run's grants end with the fieldd that launched it, whether or not the run came back), and so does a spark's when
   * fieldd no longer holds the spark. One write. A plain run launched and handed something since the boot keeps it:
   * the settle is polled, and may come after the first hand. */
  reconcile(): void {
    this.registry.end((grant) => this.#gone(grant.holder));
  }

  #gone(holder: string): boolean {
    if (holder.startsWith(SPARK_HOLDER))
      return this.opts.sparkName(holder.slice(SPARK_HOLDER.length)) === undefined;
    return this.opts.bornFor(holder) === undefined || this.opts.runState(holder) !== "live";
  }

  resolve(ref: ObjectRef): { docId: string; key: string } | undefined {
    const record = this.registry.get(ref);
    return record && { docId: record.docId, key: record.key };
  }

  /** OB-L5 — the window says the person's hand came onto or left an object. Nothing an agent has not touched has a ref,
   * and such an object has no agents to pause. */
  held(docId: string, key: string, held: boolean): void {
    const ref = this.registry.find(docId, key);
    if (ref !== undefined) this.presence.hold(ref, held);
  }

  /** A run has left for good. A plain run's grants end with it, in one write, so nothing goes on claiming an object for
   * it (a spark's are the spark's, and wait for its next run). What it had is remembered, in fieldd's memory only,
   * because the runtime tells a run's end before a resume's successor exists: `runReplaced` hands it on. Nothing is
   * remembered for a run this fieldd did not launch: what stood under its name ended with the fieldd before, and no
   * resume carries it. */
  runEnded(run: string): void {
    const on = this.presence.onObjects(run);
    this.presence.runEnded(run);
    const ended = this.registry.end((grant) => grant.holder === run);
    if (!this.vouched(run)) return;
    const grants = ended.map(({ ref, how, at }) => ({ ref, how, at }));
    if (on.length === 0 && grants.length === 0) return;
    this.#ended.set(run, { on, grants });
    for (const oldest of this.#ended.keys()) {
      if (this.#ended.size <= OBJECT_ROOM.ENDED_RUNS_KEPT) break;
      this.#ended.delete(oldest);
    }
  }

  /** A resume continued a session in a new run: the grants, the place on each object and the undo offer go with it. A run
   * whose end named no successor has already lost them. A `one` kind handed to someone meanwhile stays with them.
   * They go only to a run this fieldd launched (OB-D18 A): a successor it cannot vouch for is handed nothing on. */
  runReplaced(old: string, next: string): void {
    const ended = this.#ended.get(old);
    this.#ended.delete(old);
    const holder = this.holder(next);
    if (this.vouched(next)) {
      this.undo.rekey(old, holder);
      for (const { ref, how, at } of ended?.grants ?? []) {
        const record = this.registry.get(ref);
        if (record === undefined) continue;
        const taken = this.registry.grantsOn(ref).some((grant) => grant.holder !== holder);
        if (taken && this.kind(record.kind)?.concurrency === "one") continue;
        this.registry.grant(ref, holder, how, at);
      }
    }
    for (const ref of ended?.on ?? []) {
      this.presence.forget(ref, old);
      if (this.grantOf(ref, next) === undefined) continue;
      this.presence.opened(ref, this.who(next));
      this.offerOn(ref, next);
    }
  }

  /** Keep what an act's undo needs, and say on the desk what it would undo. */
  keepChange(docId: string, change: Omit<KeptChange, "holder"> & { run: string }): void {
    const { run, ...kept } = change;
    for (const fell of this.undo.keep(docId, { ...kept, holder: this.holder(run) }))
      this.#refreshOffer(docId, fell.ref, fell.holder);
    this.presence.setLastChange(change.ref, run, change.label);
  }

  /** Say on this run's row what its holder's undo would undo: a spark's next run comes to the offer its last one left. */
  offerOn(ref: ObjectRef, run: string): void {
    const record = this.registry.get(ref);
    if (record !== undefined) this.#refreshOffer(record.docId, ref, this.holder(run));
  }

  /** OB-D11 — undo the run's newest change to this object. A `conflict` or `gone` can never come good, so that change
   * is dropped and the next one back is on offer; `held` or no window, it waits. */
  async undoAgent(
    ref: ObjectRef,
    run: string,
  ): Promise<{ undone: true; changed?: string } | { undone: false; reason: string }> {
    const record = this.registry.get(ref);
    if (record === undefined) return { undone: false, reason: NO_SUCH_OBJECT };
    const holder = this.holder(run);
    const change = this.undo.newest(record.docId, ref, holder);
    if (change === undefined)
      return { undone: false, reason: "That agent has no change left to undo here." };
    if (change.undoing) return { undone: false, reason: "That change is already being undone." };
    change.undoing = true;
    const { handle } = this.who(run);
    try {
      const answered = await this.intents.ask(record.docId, {
        op: "undo",
        run,
        handle,
        key: change.key,
        inverse: change.inverse,
      });
      const moved = IntentUndoValue.safeParse(answered.value);
      if (moved.success && moved.data.key !== undefined && moved.data.key !== change.key) {
        this.registry.remap(ref, moved.data.key);
        this.undo.remap(record.docId, ref, moved.data.key);
      }
      this.undo.forget(record.docId, change);
      this.#refreshOffer(record.docId, ref, holder);
      if (change.op === "place") this.presence.drop(ref);
      return { undone: true, changed: change.label };
    } catch (err) {
      if (!(err instanceof RpcCallError)) throw err;
      const fact = (err.details as { fact?: unknown } | undefined)?.fact;
      if (fact === "conflict" || fact === "gone") {
        this.undo.forget(record.docId, change);
        this.#refreshOffer(record.docId, ref, holder);
      }
      return { undone: false, reason: err.message };
    } finally {
      change.undoing = false;
    }
  }

  #refreshOffer(docId: string, ref: ObjectRef, holder: string): void {
    const label = this.undo.newest(docId, ref, holder)?.label;
    for (const run of this.presence.runsOn(ref))
      if (this.holder(run) === holder) this.presence.setLastChange(ref, run, label);
  }
}
