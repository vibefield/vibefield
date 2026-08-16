import { randomBytes } from "node:crypto";
import { LiveSurfaceAttachTicketV1, type LiveSurfaceSourceSpecV1 } from "@vibefield/contracts";

export type LiveSurfacePresentationOperation = "view" | "pointer" | "keyboard" | "resize" | "crop";

export interface LiveSurfaceTicketBinding<TAuthority> {
  readonly targetWebContentsId: number;
  readonly rendererGeneration: number;
  readonly surfaceId: string;
  readonly sourceKind: LiveSurfaceSourceSpecV1["kind"];
  readonly operations: readonly LiveSurfacePresentationOperation[];
  readonly principalId?: string;
  readonly authority: TAuthority;
}

export interface LiveSurfaceRedeemedTicket<TAuthority>
  extends LiveSurfaceTicketBinding<TAuthority> {
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}

interface StoredTicket<TAuthority> extends LiveSurfaceRedeemedTicket<TAuthority> {
  readonly token: string;
}

export type LiveSurfaceTicketRejection =
  | "invalid"
  | "unknown"
  | "expired"
  | "wrong-window"
  | "wrong-generation"
  | "capacity";

export class LiveSurfaceTicketError extends Error {
  constructor(readonly reason: LiveSurfaceTicketRejection) {
    super(`live surface ticket rejected: ${reason}`);
    this.name = "LiveSurfaceTicketError";
  }
}

export interface LiveSurfaceTicketTableOptions {
  readonly now?: () => number;
  readonly randomToken?: () => string;
  readonly defaultTtlMs?: number;
  readonly maxTtlMs?: number;
  readonly maxEntries?: number;
}

function assertIdentity(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function distinctOperations(
  operations: readonly LiveSurfacePresentationOperation[],
): readonly LiveSurfacePresentationOperation[] {
  const result = [...new Set(operations)];
  if (!result.includes("view")) {
    throw new Error("a live surface presentation ticket must include view");
  }
  return result;
}

/** Main-private, bounded, one-use presentation authority. */
export class LiveSurfaceTicketTable<TAuthority> {
  readonly #entries = new Map<string, StoredTicket<TAuthority>>();
  readonly #now: () => number;
  readonly #randomToken: () => string;
  readonly #defaultTtlMs: number;
  readonly #maxTtlMs: number;
  readonly #maxEntries: number;

  constructor(options: LiveSurfaceTicketTableOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#randomToken = options.randomToken ?? (() => randomBytes(32).toString("base64url"));
    this.#defaultTtlMs = options.defaultTtlMs ?? 15_000;
    this.#maxTtlMs = options.maxTtlMs ?? 60_000;
    this.#maxEntries = options.maxEntries ?? 1_024;
    if (this.#defaultTtlMs <= 0 || this.#defaultTtlMs > this.#maxTtlMs) {
      throw new RangeError("default ticket TTL must be positive and no greater than max TTL");
    }
    if (this.#maxTtlMs <= 0 || this.#maxEntries <= 0) {
      throw new RangeError("ticket TTL and capacity limits must be positive");
    }
  }

  get size(): number {
    return this.#entries.size;
  }

  issue(
    binding: LiveSurfaceTicketBinding<TAuthority>,
    ttlMs = this.#defaultTtlMs,
  ): LiveSurfaceAttachTicketV1 {
    assertIdentity(binding.targetWebContentsId, "target WebContents id");
    assertIdentity(binding.rendererGeneration, "renderer generation");
    if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > this.#maxTtlMs) {
      throw new RangeError(`ticket TTL must be between 1 and ${this.#maxTtlMs}ms`);
    }
    const issuedAtMs = this.#now();
    this.prune(issuedAtMs);
    if (this.#entries.size >= this.#maxEntries) throw new LiveSurfaceTicketError("capacity");
    const operations = distinctOperations(binding.operations);
    let token: string | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const candidate = LiveSurfaceAttachTicketV1.shape.token.safeParse(this.#randomToken());
      if (candidate.success && !this.#entries.has(candidate.data)) {
        token = candidate.data;
        break;
      }
    }
    if (token === null) throw new Error("could not mint a unique live surface ticket");
    this.#entries.set(token, {
      ...binding,
      operations,
      token,
      issuedAtMs,
      expiresAtMs: issuedAtMs + ttlMs,
    });
    return LiveSurfaceAttachTicketV1.parse({ v: 1, token });
  }

  redeem(
    rawTicket: unknown,
    context: { readonly senderWebContentsId: number; readonly rendererGeneration: number },
  ): LiveSurfaceRedeemedTicket<TAuthority> {
    assertIdentity(context.senderWebContentsId, "sender WebContents id");
    assertIdentity(context.rendererGeneration, "renderer generation");
    const ticket = LiveSurfaceAttachTicketV1.safeParse(rawTicket);
    if (!ticket.success) throw new LiveSurfaceTicketError("invalid");
    const entry = this.#entries.get(ticket.data.token);
    if (entry === undefined) throw new LiveSurfaceTicketError("unknown");

    // Any exact-token redemption attempt consumes it. A leaked capability
    // presented from the wrong context cannot remain available for replay.
    this.#entries.delete(ticket.data.token);
    const now = this.#now();
    if (entry.expiresAtMs <= now) throw new LiveSurfaceTicketError("expired");
    if (entry.targetWebContentsId !== context.senderWebContentsId) {
      throw new LiveSurfaceTicketError("wrong-window");
    }
    if (entry.rendererGeneration !== context.rendererGeneration) {
      throw new LiveSurfaceTicketError("wrong-generation");
    }
    const { token: _token, ...redeemed } = entry;
    return redeemed;
  }

  revokeSurface(surfaceId: string): number {
    let removed = 0;
    for (const [token, entry] of this.#entries) {
      if (entry.surfaceId !== surfaceId) continue;
      this.#entries.delete(token);
      removed += 1;
    }
    return removed;
  }

  revokePrincipal(principalId: string): number {
    let removed = 0;
    for (const [token, entry] of this.#entries) {
      if (entry.principalId !== principalId) continue;
      this.#entries.delete(token);
      removed += 1;
    }
    return removed;
  }

  clear(): void {
    this.#entries.clear();
  }

  prune(now = this.#now()): number {
    let removed = 0;
    for (const [token, entry] of this.#entries) {
      if (entry.expiresAtMs > now) continue;
      this.#entries.delete(token);
      removed += 1;
    }
    return removed;
  }
}
