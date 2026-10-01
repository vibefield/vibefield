import { createHash, randomBytes } from "node:crypto";
import {
  ErrorKind,
  FORWARDING,
  type ForwardedFor,
  type ForwardReceipt,
  type ForwardReceiptState,
  OnBehalfOf,
  TERMINAL_PIPELINE,
} from "@vibefield/contracts";
import { RpcCallError } from "./native-link";

// DS-2 (DS-D15, 2026-09-30) — receipts for forwarded MUTATIONS.
//
// A mutation forwarded to the device that owns the thing carries an
// `idempotencyKey` in its envelope (`forward`, forward-envelope.ts). Two
// journals hold what that key
// means, one on each side of the peer link:
//
//  - the OWNER's (`OwnerForwardJournal`, product-api): the first arrival of a
//    {calling peer, key} executes and journals `applied` (the result, when it
//    fits) or `refused` (the error); every later arrival — the caller's retry —
//    reads that outcome instead of executing again, and one that arrives while
//    the first is still running waits for it. A key reused for a DIFFERENT call
//    (another method, other params) is refused, never answered with a stranger's
//    outcome. A RETRYABLE refusal is the exception (S5, 2026-10-01): nothing
//    applied, so it leaves no receipt and the same-key retry executes again.
//  - the CALLER's (`CallerForwardJournal`, PeerLink): what this daemon knows
//    about its own forwards. A forward that was SENT and then lost its answer
//    (the link cut mid-flight, or no answer within FORWARD_TIMEOUT_MS) is
//    journaled `outcome-unknown` and surfaced as UNAVAILABLE {device, state:
//    "outcome-unknown", idempotencyKey} — never as success, never as a plain
//    failure. A forward that never left (no endpoint, the dial failed) is
//    forgotten: nothing reached the owner, so there is nothing to be unsure of.
//    `forward.receipt {idempotencyKey}` reads this journal; the retry is the
//    same call carrying the same key, and it resolves the entry.
//
// Both are bounded (FORWARDING.RECEIPT_JOURNAL_DEPTH settled entries, each for
// FORWARDING.RECEIPT_TTL_MS) and memory-only: a daemon restart forgets them,
// which the session-persistence ceiling already says (two planes). A stored
// result is capped at FORWARDING.RESULT_CAP_BYTES (a registry number since
// DS-2b, 2026-10-01; a larger one is journaled `resultOmitted`, which is what
// its retry answers).
//
// DS-2b (2026-10-01; the review's DS-2 list) — TICKETS. Keyed results replayed
// for the TTL, tickets included, and a ticket's transport grant lives a minute
// (TERMINAL_PIPELINE.TRANSPORT_GRANT_TTL_MS): a retry past that replayed a
// ticket the cell refuses to dial. So a ticket MINT (TICKET_MINTS) is never
// journaled — nothing it applies is doubled by minting again, and its retry
// gets a fresh ticket — and any other answer that carries a transport grant (a
// birth's `terminal`) replays only while that grant lives; past it, the retry
// answers the receipt (`applied`, `resultOmitted`, `resultExpired`), never the
// stale ticket, and the act still never runs twice.

const RECEIPT_MESSAGE_CHARS = 1024;

/** DS-2b — the forwarded mints whose answer IS a ticket and which apply
 * nothing a second mint would double (a second credential; the first, lost
 * in flight, expires unused): never journaled, so a same-key retry mints
 * afresh. Named, never inferred from an answer's shape — `terminal.create`
 * answers a ticket too, and it creates a session. `workspace.openTicket`
 * (DS-D12) and `index.openTicket` (SP-3) join when they are served. */
const TICKET_MINTS: ReadonlySet<string> = new Set(["terminal.openTicket"]);

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** DS-2b — when a stored answer stops being safe to replay: the earliest
 * expiry of any transport grant it carries (a ticket's `transportGrant`, at
 * its top or one member down — a birth's `terminal`), read from the grant's
 * own `claims.expiresAt`; a grant whose expiry cannot be read counts the
 * registry's grant life from `appliedAt`. `undefined` = it carries none, and
 * replays for the receipt's TTL. */
export function transportGrantExpiry(result: unknown, appliedAt: number): number | undefined {
  if (!isObject(result)) return undefined;
  const grants: unknown[] = [];
  for (const holder of [result, ...Object.values(result)])
    if (isObject(holder) && Object.hasOwn(holder, "transportGrant"))
      grants.push(holder["transportGrant"]);
  if (grants.length === 0) return undefined;
  let earliest = Number.POSITIVE_INFINITY;
  for (const grant of grants) {
    const claims = isObject(grant) ? grant["claims"] : undefined;
    const expiresAt = isObject(claims) ? claims["expiresAt"] : undefined;
    earliest = Math.min(
      earliest,
      typeof expiresAt === "number" && Number.isFinite(expiresAt)
        ? expiresAt
        : appliedAt + TERMINAL_PIPELINE.TRANSPORT_GRANT_TTL_MS,
    );
  }
  return earliest;
}

/** A fresh key for a forwarded mutation (IdempotencyKey: 8..128 chars). */
export function mintForwardKey(): string {
  return `fk_${randomBytes(18).toString("base64url")}`;
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

/** What a key is bound to besides its method: a digest of the method's OWN
 * params — the routing key (`device`) and the envelope (`forward`) excluded,
 * so the caller (which still holds `device`) and the owner (which stripped it)
 * digest the same call identically. A method's own `idempotencyKey` param is
 * part of the call, and is digested. */
export function forwardDigest(params: unknown): string {
  let own = params;
  if (params !== null && typeof params === "object" && !Array.isArray(params)) {
    const { device: _device, forward: _forward, ...rest } = params as Record<string, unknown>;
    own = rest;
  }
  return createHash("sha256").update(canonicalJson(own)).digest("hex");
}

function reusedKey(key: string, method: string): RpcCallError {
  return new RpcCallError("CONFLICT", "idempotency key reused for a different call", false, {
    idempotencyKey: key,
    method,
  });
}

/** ForwardReceipt.error is the contract's ErrorKind; a kind outside it (a
 * provider's own) is INTERNAL there, while the replayed error keeps its own. */
function receiptErrorKind(kind: string): ErrorKind {
  const parsed = ErrorKind.safeParse(kind);
  return parsed.success ? parsed.data : "INTERNAL";
}

/** ForwardReceipt.onBehalfOf is the strict contract shape; a restatement this
 * build reads only tolerantly (a newer client kind) is left off the receipt. */
function receiptBehalf(onBehalfOf: ForwardedFor | undefined): OnBehalfOf | undefined {
  if (onBehalfOf === undefined) return undefined;
  const parsed = OnBehalfOf.safeParse(onBehalfOf);
  return parsed.success ? parsed.data : undefined;
}

function jsonWithin(value: unknown, bytes: number): string | undefined {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    return undefined;
  }
  if (encoded === undefined) return undefined;
  return Buffer.byteLength(encoded, "utf8") <= bytes ? encoded : undefined;
}

interface JournalLimits {
  now?: () => number;
  depth?: number;
  ttlMs?: number;
}

// ---------------------------------------------------------------- owner side

interface StoredError {
  kind: string;
  message: string;
  retryable: boolean;
  details?: unknown;
}

interface OwnerEntry {
  key: string;
  method: string;
  digest: string;
  onBehalfOf?: ForwardedFor;
  state: "pending" | "applied" | "refused";
  /** begin time while pending; the settle time after */
  at: number;
  /** resolves when a pending entry settles (a concurrent arrival waits on it) */
  settled: Promise<void>;
  /** the result's JSON; `null` = the method answered nothing; absent = omitted */
  resultJson?: string | null;
  resultOmitted?: boolean;
  /** DS-2b — the stored answer carried a transport grant: it replays until
   * then (`transportGrantExpiry`), and the receipt answers after */
  replayUntil?: number;
  /** DS-2b — set once a stored answer outlived its grant and was let go */
  resultExpired?: boolean;
  error?: StoredError;
}

export interface OwnerForwardCall {
  /** the calling peer's device (the principal's) — keys are per caller */
  peer: string;
  key: string;
  method: string;
  digest: string;
  onBehalfOf?: ForwardedFor;
}

/** The owner's receipts (product-api journals every keyed forwarded mutation). */
export class OwnerForwardJournal {
  private readonly entries = new Map<string, OwnerEntry>();
  private readonly now: () => number;
  private readonly depth: number;
  private readonly ttlMs: number;

  constructor(
    private readonly opts: JournalLimits & {
      /** this daemon's own device id — the receipt's `device` (where it applied) */
      device: () => string;
      resultBytes?: number;
    },
  ) {
    this.now = opts.now ?? Date.now;
    this.depth = opts.depth ?? FORWARDING.RECEIPT_JOURNAL_DEPTH;
    this.ttlMs = opts.ttlMs ?? FORWARDING.RECEIPT_TTL_MS;
  }

  /** Execute a keyed forwarded mutation at most once per {peer, key}. A ticket
   * mint (TICKET_MINTS) is not journaled at all: it runs every time. */
  async run(call: OwnerForwardCall, execute: () => Promise<unknown>): Promise<unknown> {
    if (TICKET_MINTS.has(call.method)) return await execute();
    this.sweep();
    const id = `${call.peer}\u0000${call.key}`;
    const hit = this.entries.get(id);
    if (hit !== undefined) {
      if (hit.method !== call.method || hit.digest !== call.digest)
        throw reusedKey(call.key, call.method);
      if (hit.state === "pending") await hit.settled;
      return this.replay(hit);
    }
    let settle: () => void = () => {};
    const entry: OwnerEntry = {
      key: call.key,
      method: call.method,
      digest: call.digest,
      ...(call.onBehalfOf !== undefined ? { onBehalfOf: call.onBehalfOf } : {}),
      state: "pending",
      at: this.now(),
      settled: new Promise<void>((resolve) => {
        settle = resolve;
      }),
    };
    this.entries.set(id, entry);
    let retryable = false;
    try {
      const result = await execute();
      entry.state = "applied";
      entry.at = this.now();
      const json =
        result === undefined
          ? null
          : jsonWithin(result, this.opts.resultBytes ?? FORWARDING.RESULT_CAP_BYTES);
      if (json === undefined) entry.resultOmitted = true;
      else entry.resultJson = json;
      const replayUntil = transportGrantExpiry(result, entry.at);
      if (replayUntil !== undefined) entry.replayUntil = replayUntil;
      return result;
    } catch (error) {
      entry.state = "refused";
      entry.at = this.now();
      entry.error = storedError(error, this.opts.resultBytes ?? FORWARDING.RESULT_CAP_BYTES);
      retryable = entry.error.retryable;
      throw error;
    } finally {
      settle();
      // S5 (the landing review, 2026-10-01) — a RETRYABLE refusal is not an
      // outcome: nothing applied, and its own word says asking again may work
      // (this daemon's UNAVAILABLE "starting", say). Journaled, it was replayed
      // for RECEIPT_TTL_MS, so a caller that lost the answer and retried with
      // the same key read the stale refusal for a day. It leaves no receipt:
      // the entry goes once settled, and the same-key retry executes again. An
      // arrival that was already waiting on THIS attempt holds the entry and
      // answers its refusal — never a second, parallel execution.
      if (retryable && this.entries.get(id) === entry) this.entries.delete(id);
      this.trim();
    }
  }

  /** The receipt for one {peer, key}, or undefined (tests; diagnostics). */
  receipt(peer: string, key: string): ForwardReceipt | undefined {
    this.sweep();
    const entry = this.entries.get(`${peer}\u0000${key}`);
    if (entry === undefined || entry.state === "pending") return undefined;
    return this.receiptOf(entry);
  }

  size(): number {
    return this.entries.size;
  }

  private receiptOf(entry: OwnerEntry): ForwardReceipt {
    const behalf = receiptBehalf(entry.onBehalfOf);
    return {
      idempotencyKey: entry.key,
      method: entry.method,
      device: this.opts.device(),
      state: entry.state === "refused" ? "refused" : "applied",
      at: entry.at,
      ...(entry.error !== undefined ? { error: receiptErrorKind(entry.error.kind) } : {}),
      ...(behalf !== undefined ? { onBehalfOf: behalf } : {}),
    };
  }

  private replay(entry: OwnerEntry): unknown {
    if (entry.state === "refused" && entry.error !== undefined) {
      const { kind, message, retryable, details } = entry.error;
      throw new RpcCallError(kind as never, message, retryable, details);
    }
    // DS-2b — an answer that carried a transport grant is let go once the
    // grant is dead: its ticket would be a refused dial
    if (entry.replayUntil !== undefined && this.now() >= entry.replayUntil) {
      delete entry.resultJson;
      delete entry.replayUntil;
      entry.resultOmitted = true;
      entry.resultExpired = true;
    }
    if (entry.resultOmitted === true)
      return {
        ...this.receiptOf(entry),
        resultOmitted: true,
        ...(entry.resultExpired === true ? { resultExpired: true } : {}),
      };
    return entry.resultJson === null || entry.resultJson === undefined
      ? undefined
      : JSON.parse(entry.resultJson);
  }

  private sweep(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, entry] of this.entries)
      if (entry.state !== "pending" && entry.at < cutoff) this.entries.delete(id);
  }

  private trim(): void {
    let settled = 0;
    for (const entry of this.entries.values()) if (entry.state !== "pending") settled += 1;
    for (const [id, entry] of this.entries) {
      if (settled <= this.depth) break;
      if (entry.state === "pending") continue; // in flight: bounded by concurrency, never evicted
      this.entries.delete(id);
      settled -= 1;
    }
  }
}

function storedError(error: unknown, bytes: number): StoredError {
  if (error instanceof RpcCallError) {
    const details = error.details === undefined ? undefined : jsonWithin(error.details, bytes);
    return {
      kind: error.kind,
      message: error.message.slice(0, RECEIPT_MESSAGE_CHARS),
      retryable: error.retryable,
      ...(details !== undefined ? { details: JSON.parse(details) } : {}),
    };
  }
  return {
    kind: "INTERNAL",
    message: (error instanceof Error ? error.message : "internal error").slice(
      0,
      RECEIPT_MESSAGE_CHARS,
    ),
    retryable: false,
  };
}

// --------------------------------------------------------------- caller side

interface CallerEntry {
  key: string;
  device: string;
  method: string;
  digest: string;
  onBehalfOf?: ForwardedFor;
  /** `pending` until an attempt that LEFT is answered or lost */
  state: "pending" | ForwardReceiptState;
  at: number;
  error?: string;
  /** attempts under way with this key (a retry may overlap its original) */
  inflight: number;
  /** did any attempt with this key reach the wire? */
  everSent: boolean;
}

export interface CallerForwardCall {
  /** the OWNING device the forward goes to */
  device: string;
  method: string;
  digest: string;
  onBehalfOf?: ForwardedFor;
}

/** One attempt at a keyed forward — PeerLink reports how it ended. */
export interface ForwardAttempt {
  /** the request is about to go on the wire (the link is ready) */
  sent(): void;
  /** the owner answered with a result */
  applied(): void;
  /** the owner answered with an error (its own kind) */
  refused(kind: string): void;
  /** it left and no answer came (cut mid-flight, or the deadline) */
  lost(): void;
  /** it never left (no endpoint, the dial failed) */
  unsent(): void;
}

/** A caller-side receipt: the contract's shape, plus `inFlight` while an
 * attempt is still out (its outcome is unknown because it is not over). */
export type CallerReceipt = ForwardReceipt & { inFlight?: true };

/** What this daemon knows about its own keyed forwards (PeerLink). */
export class CallerForwardJournal {
  private readonly entries = new Map<string, CallerEntry>();
  private readonly now: () => number;
  private readonly depth: number;
  private readonly ttlMs: number;

  constructor(opts: JournalLimits = {}) {
    this.now = opts.now ?? Date.now;
    this.depth = opts.depth ?? FORWARDING.RECEIPT_JOURNAL_DEPTH;
    this.ttlMs = opts.ttlMs ?? FORWARDING.RECEIPT_TTL_MS;
  }

  /** Start an attempt. A key already journaled must name the SAME call (the
   * retry of an outcome-unknown forward); another call is refused. */
  begin(key: string, call: CallerForwardCall): ForwardAttempt {
    this.sweep();
    let entry = this.entries.get(key);
    if (entry !== undefined) {
      if (
        entry.device !== call.device ||
        entry.method !== call.method ||
        entry.digest !== call.digest
      )
        throw reusedKey(key, call.method);
      entry.inflight += 1;
    } else {
      entry = {
        key,
        device: call.device,
        method: call.method,
        digest: call.digest,
        ...(call.onBehalfOf !== undefined ? { onBehalfOf: call.onBehalfOf } : {}),
        state: "pending",
        at: this.now(),
        inflight: 1,
        everSent: false,
      };
      this.entries.set(key, entry);
    }
    const held = entry;
    let over = false;
    const finish = (fn: () => void) => {
      if (over) return;
      over = true;
      held.inflight = Math.max(0, held.inflight - 1);
      fn();
      this.trim();
    };
    return {
      sent: () => {
        held.everSent = true;
      },
      applied: () =>
        finish(() => {
          held.state = "applied";
          held.at = this.now();
          delete held.error;
        }),
      refused: (kind) =>
        finish(() => {
          held.state = "refused";
          held.at = this.now();
          held.error = kind;
        }),
      lost: () =>
        finish(() => {
          // an overlapping attempt that WAS answered already settled it
          if (held.state === "pending" || held.state === "outcome-unknown") {
            held.state = "outcome-unknown";
            held.at = this.now();
          }
        }),
      unsent: () =>
        finish(() => {
          // nothing with this key ever reached the owner: forget it
          if (!held.everSent && held.inflight === 0 && this.entries.get(key) === held)
            this.entries.delete(key);
        }),
    };
  }

  get(key: string): CallerReceipt | undefined {
    this.sweep();
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    const behalf = receiptBehalf(entry.onBehalfOf);
    const pending = entry.state === "pending";
    return {
      idempotencyKey: entry.key,
      method: entry.method,
      device: entry.device,
      state: entry.state === "pending" ? "outcome-unknown" : entry.state,
      at: entry.at,
      ...(entry.error !== undefined ? { error: receiptErrorKind(entry.error) } : {}),
      ...(behalf !== undefined ? { onBehalfOf: behalf } : {}),
      ...(pending || entry.inflight > 0 ? { inFlight: true as const } : {}),
    };
  }

  size(): number {
    return this.entries.size;
  }

  private sweep(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [key, entry] of this.entries)
      if (entry.inflight === 0 && entry.state !== "pending" && entry.at < cutoff)
        this.entries.delete(key);
  }

  private trim(): void {
    let settled = 0;
    for (const entry of this.entries.values()) if (entry.inflight === 0) settled += 1;
    for (const [key, entry] of this.entries) {
      if (settled <= this.depth) break;
      if (entry.inflight > 0) continue;
      this.entries.delete(key);
      settled -= 1;
    }
  }
}
