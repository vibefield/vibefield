import type {
  ObjectGrant,
  ObjectGrantRow,
  ObjectIntent,
  ObjectRef,
  ObjectsHandResult,
  ObjectYours,
} from "@vibefield/contracts";
import { IntentUndoValue } from "@vibefield/contracts";
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

export type RunState = "live" | "ended" | "unknown";

export interface DeskObjectsOptions {
  readonly store: ObjectsStore;
  /** whether a run can still be handed work */
  runState(run: string): RunState;
  /** how the desk names a run */
  label(run: string): string;
  /** the spark a run is the session of, if it is one */
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

const NO_SUCH_AGENT = "VibeField doesn't know that agent.";
const ENDED_AGENT = "That agent has ended. Start it again, or hand this to another.";
const NO_SUCH_OBJECT = "VibeField doesn't know that object.";

export class DeskObjects {
  readonly registry: ObjectsRegistry;
  readonly intents: DeskIntents;
  readonly presence: ObjectPresenceBoard;
  readonly undo = new AgentUndoShelf();

  constructor(private readonly opts: DeskObjectsOptions) {
    this.registry = new ObjectsRegistry({
      store: opts.store,
      ...(opts.now ? { now: opts.now } : {}),
    });
    this.intents = new DeskIntents(opts.intents);
    this.presence = new ObjectPresenceBoard({
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

  /** Who a run's grants belong to: its spark's, or a plain run's own. A holder as `grants` names it is taken as itself. */
  holder(run: string): string {
    if (run.startsWith(SPARK_HOLDER)) return run;
    const spark = this.opts.sparkOf(run);
    return spark === undefined ? run : `${SPARK_HOLDER}${spark}`;
  }

  grantOf(ref: ObjectRef, run: string): ObjectGrant | undefined {
    return this.registry.grantOf(ref, this.holder(run));
  }

  grant(ref: ObjectRef, run: string, how: ObjectYours): void {
    this.registry.grant(ref, this.holder(run), how);
  }

  /** The run's grant ends; a spark's for every run of it. */
  revoke(ref: ObjectRef, run: string): void {
    this.registry.revoke(ref, this.holder(run));
  }

  /** OB-L1 — the grant, on the person's play. A run that does not exist or has ended holds nothing: said, never kept. A
   * spark has not ended when its last run has: it sleeps, and what it is handed waits for it. */
  hand(ref: ObjectRef, run: string): ObjectsHandResult {
    const record = this.registry.get(ref);
    if (record === undefined) return { handed: false, reason: NO_SUCH_OBJECT };
    if (this.opts.sparkOf(run) === undefined) {
      const state = this.opts.runState(run);
      if (state === "unknown") return { handed: false, reason: NO_SUCH_AGENT };
      if (state === "ended") return { handed: false, reason: ENDED_AGENT };
    }
    const holder = this.holder(run);
    if (this.kind(record.kind)?.concurrency === "one") {
      for (const left of this.registry.moveTo(ref, holder)) this.#releaseHolder(ref, left);
      this.presence.moveHolder(ref, run);
    } else {
      this.registry.grant(ref, holder, "handed");
    }
    return { handed: true };
  }

  /** The person takes an object back: the grant ends, and the agent's next call answers `not-handed`. `run` is a run, or
   * a holder as `grants` names it. */
  takeBack(ref: ObjectRef, run: string): void {
    const holder = this.holder(run);
    this.registry.revoke(ref, holder);
    this.#releaseHolder(ref, holder);
  }

  /** §11 — every grant still standing, or one object's, with whose it is: it outlives the app, so it can be forgotten. */
  grants(ref?: ObjectRef): ObjectGrantRow[] {
    return this.registry.all().flatMap((record) =>
      ref !== undefined && record.ref !== ref
        ? []
        : record.grants.map((grant) => ({
            ref: record.ref,
            docId: record.docId,
            key: record.key,
            ...(record.kind !== undefined ? { kind: record.kind } : {}),
            holder: grant.holder,
            name: this.#nameOf(grant.holder),
            how: grant.how,
            at: grant.at,
          })),
    );
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

  /** Once the boot's re-attach has settled: what ended while fieldd was down holds nothing now. A plain run that did not
   * come back, a spark fieldd no longer holds. */
  reconcile(): void {
    for (const record of this.registry.all())
      for (const { holder } of record.grants)
        if (this.#gone(holder)) this.registry.revoke(record.ref, holder);
  }

  #gone(holder: string): boolean {
    if (holder.startsWith(SPARK_HOLDER))
      return this.opts.sparkName(holder.slice(SPARK_HOLDER.length)) === undefined;
    return this.opts.runState(holder) !== "live";
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

  /** A run has left for good. A plain run's grants end with it, so nothing goes on claiming an object for it; a spark's
   * are the spark's, and wait for its next run. */
  runEnded(run: string): void {
    this.presence.runEnded(run);
    if (this.opts.sparkOf(run) !== undefined) return;
    for (const record of this.registry.all()) this.registry.revoke(record.ref, run);
  }

  /** Keep what an act's undo needs, and say on the desk what it would undo. */
  keepChange(docId: string, change: KeptChange): void {
    const fell = this.undo.keep(docId, change);
    if (fell !== undefined) this.#refreshLastChange(docId, fell.ref, fell.run);
    this.presence.setLastChange(change.ref, change.run, change.label);
  }

  /** OB-D11 — undo the run's newest change to this object. A `conflict` or `gone` can never come good, so that change
   * is dropped and the next one back is on offer; `held` or no window, it waits. */
  async undoAgent(
    ref: ObjectRef,
    run: string,
  ): Promise<{ undone: true; changed?: string } | { undone: false; reason: string }> {
    const record = this.registry.get(ref);
    if (record === undefined) return { undone: false, reason: NO_SUCH_OBJECT };
    const change = this.undo.newest(record.docId, ref, run);
    if (change === undefined)
      return { undone: false, reason: "That agent has no change left to undo here." };
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
      this.#refreshLastChange(record.docId, ref, run);
      if (change.op === "place") this.presence.drop(ref);
      return { undone: true, changed: change.label };
    } catch (err) {
      if (!(err instanceof RpcCallError)) throw err;
      const fact = (err.details as { fact?: unknown } | undefined)?.fact;
      if (fact === "conflict" || fact === "gone") {
        this.undo.forget(record.docId, change);
        this.#refreshLastChange(record.docId, ref, run);
      }
      return { undone: false, reason: err.message };
    }
  }

  #refreshLastChange(docId: string, ref: ObjectRef, run: string): void {
    this.presence.setLastChange(ref, run, this.undo.newest(docId, ref, run)?.label);
  }
}
