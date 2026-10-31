import { randomBytes } from "node:crypto";
import { type RendererParticipantIdentity, SCOPES, type Scope } from "@vibefield/contracts";

// TokenService (design-02 §3.3): scoped bearer tokens, minted per client kind.
// Same-uid agents are the adversary (EL7) — tokens are mandatory on every
// surface; peer-cred/origin checks are sanity only. Audit via the event hook
// (JSONL sink lands with the storage milestone).
// *Note 2026-10-29 (CP-D1, ruled by James on the compose plane version 2 page; design-02 §3.3's dated note):* one
// surface takes no token. The `vibefield` door is the floor's unix socket: the kernel names the calling process and
// its start, the floor walks it to the pane that holds it, and fieldd maps that pane to its run (compose/). A pid's
// ancestry tells one session from another, which no token every same-uid agent can read could do. The rule above
// stands for every other surface, and the mcp-agent preset design-02 planned stays for them.

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
  /** Shell-minted renderer identity. ProductAPI projects this into the
   * local-token principal, so update calls never trust participant params. */
  rendererParticipant?: RendererParticipantIdentity;
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
  rendererParticipant?: RendererParticipantIdentity;
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
  rendererParticipant?: RendererParticipantIdentity;
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
    const bindings = [
      opts?.pluginId === undefined ? null : "plugin",
      opts?.shellMain === true ? "shell" : null,
      opts?.rendererParticipant === undefined ? null : "renderer",
    ].filter((binding) => binding !== null);
    if (bindings.length > 1) {
      throw new Error(`a token cannot carry ambiguous bindings: ${bindings.join(", ")}`);
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
      ...(opts?.rendererParticipant !== undefined
        ? { rendererParticipant: { ...opts.rendererParticipant } }
        : {}),
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
      ...(opts?.rendererParticipant !== undefined
        ? { rendererParticipant: { ...opts.rendererParticipant } }
        : {}),
    };
  }

  verify(token: string): {
    tokenId: string;
    scopes: Scope[];
    label: string;
    pluginId?: string;
    shellMain?: true;
    rendererParticipant?: RendererParticipantIdentity;
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
      ...(rec.rendererParticipant !== undefined
        ? { rendererParticipant: { ...rec.rendererParticipant } }
        : {}),
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
