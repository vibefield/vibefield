import { randomInt } from "node:crypto";
import {
  OBJECT_RECORD_FORMAT,
  type ObjectGrant,
  type ObjectRecord,
  type ObjectRef,
  type ObjectYours,
} from "@vibefield/contracts";
import { RpcCallError } from "../native-link";
import type { ObjectsStore } from "./store";

// OB-3a — the registry (a ref ↔ a board's object) and the grants (OB-L1: which run may work which object). Held in
// memory after the store's one boot read, and written through before anything acts on the change, so a restart finds
// exactly what a caller was told. Grants outlive the app (EY-D9 B). A ref is a name and grants nothing: `refFor` hands
// one to anybody, and only `grant` opens an object.

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const REF_CHARS = 8;

const mintRef = (): ObjectRef => {
  let id = "";
  for (let i = 0; i < REF_CHARS; i += 1) id += ALPHABET[randomInt(ALPHABET.length)];
  return `vf:obj/${id}`;
};

const placeOf = (docId: string, key: string): string => `${docId}\u0000${key}`;

export interface ObjectsRegistryOptions {
  readonly store: ObjectsStore;
  readonly now?: () => number;
  /** a new ref (tests) */
  readonly mint?: () => ObjectRef;
}

export class ObjectsRegistry {
  readonly #records = new Map<ObjectRef, ObjectRecord>();
  readonly #places = new Map<string, ObjectRef>();
  readonly #now: () => number;
  readonly #mint: () => ObjectRef;

  constructor(private readonly opts: ObjectsRegistryOptions) {
    this.#now = opts.now ?? Date.now;
    this.#mint = opts.mint ?? mintRef;
  }

  /** The store's one read, and how many records it served. Never throws (ObjectsStore.boot). */
  boot(): number {
    const records = this.opts.store.boot();
    for (const record of records) this.#hold(record);
    return records.length;
  }

  /** Throws the store's refusal while the boot read has failed. */
  readable(): void {
    this.opts.store.readable();
  }

  /** The ref of a board's object, minted the first time it is named. */
  refFor(docId: string, key: string, kind?: string): ObjectRef {
    const known = this.#places.get(placeOf(docId, key));
    if (known !== undefined) {
      if (kind !== undefined) this.setKind(known, kind);
      return known;
    }
    this.readable();
    let ref = this.#mint();
    // at 36^8 a collision is a curiosity; never let it name two objects
    while (this.#records.has(ref)) ref = this.#mint();
    this.#keep({
      format: OBJECT_RECORD_FORMAT,
      ref,
      docId,
      key,
      ...(kind !== undefined ? { kind } : {}),
      grants: [],
    });
    return ref;
  }

  get(ref: ObjectRef): ObjectRecord | undefined {
    return this.#records.get(ref);
  }

  find(docId: string, key: string): ObjectRef | undefined {
    return this.#places.get(placeOf(docId, key));
  }

  refsOn(docId: string): ObjectRef[] {
    return [...this.#records.values()].filter((r) => r.docId === docId).map((r) => r.ref);
  }

  grantOf(ref: ObjectRef, run: string): ObjectGrant | undefined {
    return this.#records.get(ref)?.grants.find((g) => g.run === run);
  }

  /** Give `run` this object. What it placed stays placed: a later hand never weakens that. */
  grant(ref: ObjectRef, run: string, how: ObjectYours): void {
    const record = this.#required(ref);
    const held = record.grants.find((g) => g.run === run);
    if (held !== undefined && (held.how === "placed" || held.how === how)) return;
    this.#keep({
      ...record,
      grants: [...record.grants.filter((g) => g.run !== run), { run, how, at: this.#now() }],
    });
  }

  /** End `run`'s grant. False when it held none. */
  revoke(ref: ObjectRef, run: string): boolean {
    const record = this.#records.get(ref);
    if (record === undefined || !record.grants.some((g) => g.run === run)) return false;
    this.#keep({ ...record, grants: record.grants.filter((g) => g.run !== run) });
    return true;
  }

  /** OB-D9 — a `one` kind's hand: every other run's grant ends and `run` is handed it. Returns the runs it left. */
  moveTo(ref: ObjectRef, run: string): string[] {
    const record = this.#required(ref);
    const left = record.grants.filter((g) => g.run !== run).map((g) => g.run);
    const own = record.grants.find((g) => g.run === run);
    if (left.length === 0 && own !== undefined) return [];
    this.#keep({ ...record, grants: [own ?? { run, how: "handed", at: this.#now() }] });
    return left;
  }

  setKind(ref: ObjectRef, kind: string): void {
    const record = this.#required(ref);
    if (record.kind === kind) return;
    this.#keep({ ...record, kind });
  }

  /** OB-D11 — a remove's undo re-spawned the object under a new key: its ref follows it. */
  remap(ref: ObjectRef, key: string): void {
    const record = this.#required(ref);
    if (record.key === key) return;
    this.#places.delete(placeOf(record.docId, record.key));
    this.#keep({ ...record, key });
  }

  #required(ref: ObjectRef): ObjectRecord {
    const record = this.#records.get(ref);
    if (record === undefined)
      throw new RpcCallError("NOT_FOUND", "VibeField does not know that object", false);
    return record;
  }

  #keep(record: ObjectRecord): void {
    this.opts.store.write(record);
    this.#hold(record);
  }

  #hold(record: ObjectRecord): void {
    this.#records.set(record.ref, record);
    this.#places.set(placeOf(record.docId, record.key), record.ref);
  }
}
