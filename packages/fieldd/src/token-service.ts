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
}

export interface TokenEvent {
  kind: "mint" | "revoke" | "verify-failed";
  tokenId?: string;
  label?: string;
  scopes?: Scope[];
  at: number;
}

interface TokenRecord {
  tokenId: string;
  scopes: Scope[];
  label: string;
  createdAt: number;
  /** epoch ms — expired records verify null and are dropped (leases, P3b) */
  expiresAt?: number;
}

export class TokenService {
  private byToken = new Map<string, TokenRecord>();
  private byId = new Map<string, string>(); // tokenId -> token

  constructor(private readonly onEvent?: (e: TokenEvent) => void) {}

  mint(scopes: Scope[], label: string, opts?: { ttlMs?: number }): TokenGrant {
    for (const s of scopes) {
      if (!(SCOPES as readonly string[]).includes(s)) throw new Error(`unknown scope: ${s}`);
    }
    const tokenId = `tk_${randomBytes(6).toString("hex")}`;
    const token = `tok_${randomBytes(24).toString("hex")}`;
    const expiresAt = opts?.ttlMs !== undefined ? Date.now() + opts.ttlMs : undefined;
    this.byToken.set(token, {
      tokenId,
      scopes: [...scopes],
      label,
      createdAt: Date.now(),
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    });
    this.byId.set(tokenId, token);
    this.onEvent?.({ kind: "mint", tokenId, label, scopes, at: Date.now() });
    return {
      tokenId,
      token,
      scopes: [...scopes],
      label,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    };
  }

  verify(token: string): { tokenId: string; scopes: Scope[]; label: string } | null {
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
    return { tokenId: rec.tokenId, scopes: rec.scopes, label: rec.label };
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
