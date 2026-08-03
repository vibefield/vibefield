import { randomBytes } from "node:crypto";
import { SCOPES, type Scope } from "@vibefield/contracts";

// TokenService (design-02 §3.3): scoped bearer tokens, minted per client kind.
// Same-uid agents are the adversary (EL7) — tokens are mandatory on every
// surface; peer-cred/origin checks are sanity only. Audit via the event hook
// (JSONL sink lands with the storage milestone).

export interface TokenGrant {
  tokenId: string;
  token: string;
  scopes: Scope[];
  label: string;
  /** epoch ms — present only for TTL'd mints (renderer leases, P3b) */
  expiresAt?: number;
  /** P4 — a plugin-bound grant: hello with it derives a {kind:"plugin"}
   * principal (D20 provenance; the plugin cannot choose its identity). */
  pluginId?: string;
  /** Shell bootstrap binding. A hello derives shell-main only when this and
   * clientKind:shell-main agree on the loopback door. */
  shellMain?: true;
}

export interface TokenEvent {
  kind: "mint" | "revoke" | "verify-failed";
  tokenId?: string;
  label?: string;
  scopes?: Scope[];
  at: number;
}

export interface TokenMintOptions {
  ttlMs?: number;
  pluginId?: string;
  shellMain?: true;
  /** A caller may reserve the safe public id so a mandatory audit attempt can
   * name it before the bearer token is generated. */
  tokenId?: string;
}

export interface TokenRevocationResult {
  count: number;
  tokenIds: string[];
}

interface TokenRecord {
  tokenId: string;
  scopes: Scope[];
  label: string;
  createdAt: number;
  /** epoch ms — expired records verify null and are dropped (leases, P3b) */
  expiresAt?: number;
  /** P4 — plugin-bound grants (renderer leases + service-entry mints) */
  pluginId?: string;
  shellMain?: true;
}

export class TokenService {
  private byToken = new Map<string, TokenRecord>();
  private byId = new Map<string, string>(); // tokenId -> token

  constructor(private readonly onEvent?: (e: TokenEvent) => void) {}

  reserveTokenId(): string {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      const tokenId = `tk_${randomBytes(6).toString("hex")}`;
      if (!this.byId.has(tokenId)) return tokenId;
    }
    throw new Error("could not reserve a unique token id");
  }

  mint(scopes: Scope[], label: string, opts?: TokenMintOptions): TokenGrant {
    if (opts?.pluginId !== undefined && opts.shellMain === true) {
      throw new Error("a token cannot be both plugin-bound and shell-bound");
    }
    for (const s of scopes) {
      if (!(SCOPES as readonly string[]).includes(s)) throw new Error(`unknown scope: ${s}`);
    }
    const tokenId = opts?.tokenId ?? this.reserveTokenId();
    if (!/^tk_[0-9a-f]{12}$/.test(tokenId) || this.byId.has(tokenId)) {
      throw new Error("invalid or already-used reserved token id");
    }
    const token = `tok_${randomBytes(24).toString("hex")}`;
    const expiresAt = opts?.ttlMs !== undefined ? Date.now() + opts.ttlMs : undefined;
    this.byToken.set(token, {
      tokenId,
      scopes: [...scopes],
      label,
      createdAt: Date.now(),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(opts?.pluginId !== undefined ? { pluginId: opts.pluginId } : {}),
      ...(opts?.shellMain === true ? { shellMain: true } : {}),
    });
    this.byId.set(tokenId, token);
    this.onEvent?.({ kind: "mint", tokenId, label, scopes, at: Date.now() });
    return {
      tokenId,
      token,
      scopes: [...scopes],
      label,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      ...(opts?.pluginId !== undefined ? { pluginId: opts.pluginId } : {}),
      ...(opts?.shellMain === true ? { shellMain: true } : {}),
    };
  }

  verify(token: string): {
    tokenId: string;
    scopes: Scope[];
    label: string;
    pluginId?: string;
    shellMain?: true;
  } | null {
    const rec = this.byToken.get(token); // token is 192-bit random — map lookup is fine
    if (!rec) {
      this.onEvent?.({ kind: "verify-failed", at: Date.now() });
      return null;
    }
    if (rec.expiresAt !== undefined && Date.now() > rec.expiresAt) {
      // a dead lease is indistinguishable from no token — drop and refuse
      this.byToken.delete(token);
      this.byId.delete(rec.tokenId);
      this.onEvent?.({ kind: "verify-failed", tokenId: rec.tokenId, at: Date.now() });
      return null;
    }
    return {
      tokenId: rec.tokenId,
      scopes: rec.scopes,
      label: rec.label,
      ...(rec.pluginId !== undefined ? { pluginId: rec.pluginId } : {}),
      ...(rec.shellMain === true ? { shellMain: true } : {}),
    };
  }

  /** P5/§15.4 — revoke every live grant bound to a plugin (disable path).
   * Returns how many grants died; the caller drops live connections. */
  revokeByPlugin(pluginId: string): TokenRevocationResult {
    const tokenIds: string[] = [];
    for (const [token, rec] of [...this.byToken]) {
      if (rec.pluginId !== pluginId) continue;
      this.byToken.delete(token);
      this.byId.delete(rec.tokenId);
      this.onEvent?.({ kind: "revoke", tokenId: rec.tokenId, at: Date.now() });
      tokenIds.push(rec.tokenId);
    }
    return { count: tokenIds.length, tokenIds };
  }

  revoke(tokenId: string): boolean {
    const token = this.byId.get(tokenId);
    if (!token) return false;
    this.byId.delete(tokenId);
    this.byToken.delete(token);
    this.onEvent?.({ kind: "revoke", tokenId, at: Date.now() });
    return true;
  }
}
