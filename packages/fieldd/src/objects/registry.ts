import { randomInt } from "node:crypto";
import {
  OBJECT_RECORD_FORMAT,
  type ObjectGrant,
  type ObjectGrantEntry,
  type ObjectRecord,
  type ObjectRef,
  type ObjectYours,
} from "@vibefield/contracts";
import { RpcCallError } from "../native-link";
import type { GrantsFile } from "./grants-file";
import type { ObjectsStore } from "./store";

// OB-3a — the registry (a ref ↔ a board's object) and the grants (OB-L1: which holder may work which object). Held in
// memory after the store's one boot read. A ref is a name and grants nothing: `refFor` hands one to anybody, and only
// `grant` opens an object. A name is written through before anything acts on it. The grants are the grants file's
// (grants-file.ts; OB custody C4, C5): what is given is in memory only once the disk holds it, so a restart finds
// exactly what a caller was told, and what is taken away is gone from memory first, whatever the disk then says.

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
  readonly #grants: GrantsFile;
  readonly #now: () => number;
  readonly #mint: () => ObjectRef;

  constructor(private readonly opts: ObjectsRegistryOptions) {
    this.#grants = opts.store.grants;
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

  grantOf(ref: ObjectRef, holder: string): ObjectGrant | undefined {
    return this.#grants.of(ref, holder);
  }

  /** Every grant on one object. */
  grantsOn(ref: ObjectRef): ObjectGrantEntry[] {
    return this.#grants.on(ref);
  }

  /** Every grant, for a walk over who holds what. */
  grants(): readonly ObjectGrantEntry[] {
    return this.#grants.all();
  }

  /** Give `holder` this object. What it placed stays placed: a later hand never weakens that. Throws when the grant
   * cannot be kept: nothing is granted that a restart would not find. */
  grant(ref: ObjectRef, holder: string, how: ObjectYours, at: number = this.#now()): void {
    this.#required(ref);
    const held = this.#grants.of(ref, holder);
    if (held !== undefined && (held.how === "placed" || held.how === how)) return;
    this.#grants.give({ ref, holder, how, at });
  }

  /** End `holder`'s grant. False when it held none. It is ended whatever the disk says (`end`). */
  revoke(ref: ObjectRef, holder: string): boolean {
    return this.end((grant) => grant.ref === ref && grant.holder === holder).length > 0;
  }

  /** End every grant `match` names, in one write, and answer what ended. A take-back always takes: they are gone
   * from memory before the disk is asked, and `kept` says whether the disk has them yet. */
  end(match: (grant: ObjectGrantEntry) => boolean): ObjectGrantEntry[] {
    return this.#grants.take(match);
  }

  /** OB-D9 — a `one` kind's hand: every other holder's grant ends and `holder` is handed it, in one write. Returns
   * those it left. When the hand cannot be kept it throws, and those it left stay left. */
  moveTo(ref: ObjectRef, holder: string): string[] {
    this.#required(ref);
    return this.#grants.move({ ref, holder, how: "handed", at: this.#now() });
  }

  /** Whether the disk holds every grant change so far: false from a take-back it would not take, until a write
   * lands. */
  get kept(): boolean {
    return this.#grants.kept;
  }

  /** Once whoever outlives fieldd was told the grants' count as it stands, or the wait for them has run out. */
  settled(): Promise<void> {
    return this.#grants.settled();
  }

  /** Stop the store's timer. */
  close(): void {
    this.opts.store.close();
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
