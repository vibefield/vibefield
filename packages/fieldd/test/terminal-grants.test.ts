// TP-S1 — the grant minter in isolation: identity derivation, the two
// generation ledgers, MACs that verify against the contracts' signing input,
// the CAS + idempotent renewal, and the roster projection that carries no
// placement. The wire-level path (tickets over the product API with a routed
// mock floor) lives in terminal-service.test.ts.
import { createHmac } from "node:crypto";
import {
  CellTransportGrant,
  grantSigningInput,
  ProductSessionRosterItem,
  SessionAttachGrant,
  type TerminalInfo,
} from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { RpcCallError } from "../src/native-link";
import {
  type CellGrantKey,
  clientIdFor,
  connectionSetIdFor,
  isSelfPeerDaemon,
  isSelfPrincipal,
  isSelfTailnetPrincipal,
  mintedClientId,
  projectRoster,
  rightsFor,
  TerminalGrantMinter,
  TP_ATTACH_GRANT_TTL_MS,
  TP_TRANSPORT_GRANT_TTL_MS,
} from "../src/terminal-grants";

const KEY: CellGrantKey = {
  cellBootId: "cell-boot-A",
  keyHex: "5e".repeat(32),
  keyGeneration: 1,
};
const WINDOW = {
  kind: "local-token",
  tokenId: "tok-1",
  rendererParticipant: { participantId: "p-3c4d", incarnation: "doc-2" },
};
const GUEST = { kind: "tailnet-guest", login: "me@example.com" };
// TM-D3 — a WhoIs-verified SELF peer: the person who owns this desktop,
// reaching it from another of their own devices (product-api sets `self` only
// when the login matched link.json).
const SELF = { kind: "tailnet", login: "me@example.com", self: true };
// D2 — who a forwarded call is FOR, as the owner reads it (`ctx.onBehalfOf`)
const FOR_A_WINDOW = { clientKind: "renderer", deviceId: "dev-b", windowId: "p-77" };
const ROUTE = { cellBootId: KEY.cellBootId, routeRevision: 12 };
const DOORS = {
  controlUrl: "ws://127.0.0.1:49152/control",
  framesUrl: "ws://127.0.0.1:49152/frames",
};

function verify(
  key: CellGrantKey,
  grant: { protected: unknown; claims: unknown; mac: string },
): boolean {
  const expected = createHmac("sha256", Buffer.from(key.keyHex, "hex"))
    .update(grantSigningInput(grant.protected as never, grant.claims), "utf8")
    .digest("base64url");
  return expected === grant.mac;
}

describe("clientId and rights derive from the principal, never from the caller's claims", () => {
  it("a window's id is its participant + incarnation (non-reused); others get their own stable id", () => {
    expect(clientIdFor(WINDOW)).toBe("win:p-3c4d#doc-2");
    expect(
      clientIdFor({
        ...WINDOW,
        rendererParticipant: { participantId: "p-3c4d", incarnation: "doc-3" },
      }),
    ).toBe("win:p-3c4d#doc-3");
    expect(clientIdFor(GUEST)).toBe("tailnet-guest:me@example.com");
    expect(clientIdFor({ kind: "shell-main", tokenId: "tok-9" })).toBe("shell-main:tok-9");
    expect(connectionSetIdFor("win:p#1", "cell-boot-A")).toBe("win:p#1@cell-boot-A");
  });
  it("a window reads, types and holds geometry; a guest reads; nobody gets geometryAdmin in v1", () => {
    expect(rightsFor(WINDOW)).toEqual(["geometry", "input", "read"]);
    expect(rightsFor({ kind: "shell-main", tokenId: "t" })).toEqual(["geometry", "input", "read"]);
    expect(rightsFor(GUEST)).toEqual(["read"]);
    expect(rightsFor({ kind: "plugin", tokenId: "t" })).toEqual(["read"]);
  });

  // DS-D5, ruled 2026-09-30 with James's note: "the latest focused pane takes
  // full control include resizing, LWW. no matter it is local pane, remote
  // desktop pane or mobile pane". TM-D3 minted this row `[input, read]`.
  it("a self peer reads, types and holds geometry — the pane focused last takes the seat", () => {
    expect(rightsFor(SELF)).toEqual(["geometry", "input", "read"]);
    expect(rightsFor({ ...SELF, tailscaleId: "nodekey:aaaa" })).toEqual([
      "geometry",
      "input",
      "read",
    ]);
  });

  // DS-4 — a window on ANOTHER desktop reaches this mint through its own
  // daemon, forwarded: the principal here is that daemon, `peer-fieldd`, which
  // ProductApi mints only for a login-matched (self) peer.
  it("a self peer DAEMON forwarding for a window is minted the self set", () => {
    const daemon = { kind: "peer-fieldd", deviceId: "dev-b" };
    expect(isSelfPeerDaemon(daemon)).toBe(true);
    expect(rightsFor(daemon, FOR_A_WINDOW)).toEqual(["geometry", "input", "read"]);
  });

  // D2 (the landing review, 2026-10-01) — design-06 §6: "a peer daemon acting
  // for no one gets [read]". Provenance reaches the owner on every forwarded
  // call (`ctx.onBehalfOf`); a call that names no one is the daemon on its own
  // account.
  it("a self peer DAEMON acting for no one reads only — provenance narrows, and lifts nobody else", () => {
    const daemon = { kind: "peer-fieldd", deviceId: "dev-b" };
    expect(rightsFor(daemon)).toEqual(["read"]);
    expect(rightsFor(daemon, undefined)).toEqual(["read"]);
    expect(rightsFor(daemon, { clientKind: "ios", deviceId: "dev-b" })).toEqual([
      "geometry",
      "input",
      "read",
    ]);
    // a restated `onBehalfOf` is never authority beyond the principal's own
    for (const other of [GUEST, { kind: "plugin", tokenId: "t" }, { kind: "tailnet" }])
      expect(rightsFor(other, FOR_A_WINDOW), other.kind).toEqual(["read"]);
    // and the self principals here need none
    expect(rightsFor(WINDOW)).toEqual(["geometry", "input", "read"]);
    expect(rightsFor(SELF)).toEqual(["geometry", "input", "read"]);
  });

  it("the minter carries the rule: a ticket and a renewal for a peer daemon follow its provenance", () => {
    const minter = new TerminalGrantMinter(() => 1_000_000, "epochA");
    const daemon = { kind: "peer-fieldd", deviceId: "dev-b" };
    const base = { key: KEY, principal: daemon, sessionId: "s-1", route: ROUTE, doors: DOORS };
    expect(minter.mintTicket(base).attachGrant.claims.rights).toEqual(["read"]);
    const forwarded = minter.mintTicket({ ...base, forwardedFor: FOR_A_WINDOW });
    expect(forwarded.attachGrant.claims.rights).toEqual(["geometry", "input", "read"]);
    const generation = minter.attachGeneration(daemon, "s-1");
    const renewed = minter.renewAttach({
      key: KEY,
      principal: daemon,
      sessionId: "s-1",
      route: ROUTE,
      expectGeneration: generation,
      requestId: "r-1",
      forwardedFor: FOR_A_WINDOW,
    });
    expect(renewed.claims.rights).toEqual(["geometry", "input", "read"]);
    const ownAccount = minter.renewAttach({
      key: KEY,
      principal: daemon,
      sessionId: "s-1",
      route: ROUTE,
      expectGeneration: generation + 1,
      requestId: "r-2",
    });
    expect(ownAccount.claims.rights).toEqual(["read"]);
  });

  it("every self principal gets exactly one set, and nobody gets geometryAdmin", () => {
    // (a peer daemon's set is for a call FOR someone — D2, the row above)
    const self = [
      WINDOW,
      { kind: "shell-main", tokenId: "t" },
      SELF,
      { kind: "peer-fieldd", deviceId: "dev-b" },
    ];
    for (const principal of self) {
      expect(isSelfPrincipal(principal), principal.kind).toBe(true);
      expect(rightsFor(principal, FOR_A_WINDOW), principal.kind).toEqual([
        "geometry",
        "input",
        "read",
      ]);
    }
    const others = [
      GUEST,
      { kind: "tailnet", login: "me@example.com" },
      { kind: "plugin", tokenId: "t" },
      { kind: "mcp-agent", tokenId: "t" },
    ];
    for (const principal of others) {
      expect(isSelfPrincipal(principal), principal.kind).toBe(false);
      expect(rightsFor(principal), principal.kind).toEqual(["read"]);
    }
  });

  it("`self` is the ONLY thing that lifts a tailnet principal's rights", () => {
    // product-api sets `self` only when the WhoIs login matched link.json and
    // leaves it ABSENT pre-capture rather than writing false — so absence must
    // read as "not self", never as "unknown, be generous"
    expect(rightsFor({ kind: "tailnet", login: "me@example.com" })).toEqual(["read"]);
    expect(rightsFor({ kind: "tailnet", login: "me@example.com", self: false })).toEqual(["read"]);
    // and the flag cannot be smuggled onto some other kind
    expect(rightsFor({ kind: "tailnet-guest", login: "x@y", self: true })).toEqual(["read"]);
    expect(rightsFor({ kind: "plugin", tokenId: "t", self: true })).toEqual(["read"]);
    expect(isSelfTailnetPrincipal(SELF)).toBe(true);
    expect(isSelfTailnetPrincipal(GUEST)).toBe(false);
  });

  it("a tailnet principal is keyed by its verified login, not by the bare kind", () => {
    // it used to fall through to `principal.kind`, so EVERY remote client
    // shared the clientId "tailnet" — one connection set and one attach
    // ledger between them, which §5.1's per-client counters assume never
    // happens
    expect(clientIdFor(SELF)).toBe("tailnet:me@example.com");
    expect(clientIdFor({ kind: "tailnet", login: "other@example.com", self: true })).toBe(
      "tailnet:other@example.com",
    );
    expect(clientIdFor(SELF)).not.toBe(clientIdFor(GUEST));
  });

  // E-F2 (EL7 lens, 2026-09-14) — one login is not one client.
  it("keys two of ONE PERSON'S devices apart by the sidecar's node id", () => {
    const phone = { ...SELF, tailscaleId: "nodekey:aaaa" };
    const ipad = { ...SELF, tailscaleId: "nodekey:bbbb" };
    expect(clientIdFor(phone)).toBe("tailnet:me@example.com#nodekey:aaaa");
    expect(clientIdFor(phone)).not.toBe(clientIdFor(ipad));
    // …so they hold DIFFERENT connection sets on the same cell, which is what
    // stops the cell answering the second leg with `replaces_current_leg` and
    // closing the first as Superseded — the ping-pong, with backoff, that a
    // person watching two of their own screens would see
    expect(connectionSetIdFor(clientIdFor(phone), "cell-boot-A")).not.toBe(
      connectionSetIdFor(clientIdFor(ipad), "cell-boot-A"),
    );
    // a guest is separated the same way, and never confusable with the owner
    expect(clientIdFor({ ...GUEST, tailscaleId: "nodekey:aaaa" })).not.toBe(clientIdFor(phone));
  });

  it("falls back to the login alone when the sidecar injects no node id", () => {
    // a pre-v3 sidecar carries no node header, and absence means "it did not
    // say" — one shared client per login is what that fleet already had, so
    // this is the old behaviour preserved, not a widening
    expect(clientIdFor(SELF)).toBe("tailnet:me@example.com");
    expect(clientIdFor(GUEST)).toBe("tailnet-guest:me@example.com");
  });

  // E-F4 / F-L6a — the arm that named a kind nobody mints.
  it("keys a peer daemon by its deviceId, not by the bare kind", () => {
    // `clientIdFor` used to test for "tailnet-peer", which has never existed;
    // the real kind is `peer-fieldd`, it carries a deviceId and NO login, so it
    // fell through to the constant "peer-fieldd" — one identity for every peer
    // daemon. Unreachable then (locality refused it before a mint), fixed so
    // the slice that opens that door does not inherit it — DS-4 opened it
    // (2026-09-30): a forwarded `terminal.openTicket` is minted for this id.
    expect(clientIdFor({ kind: "peer-fieldd", deviceId: "dev-01H" })).toBe("peer-fieldd:dev-01H");
    expect(clientIdFor({ kind: "peer-fieldd", deviceId: "dev-A" })).not.toBe(
      clientIdFor({ kind: "peer-fieldd", deviceId: "dev-B" }),
    );
    // and a peer with no deviceId at all still gets the honest bare answer
    expect(clientIdFor({ kind: "peer-fieldd" })).toBe("peer-fieldd");
  });
});

describe("the minter — fresh transport grants, monotonic attach generations, verifiable MACs", () => {
  // E-F2 — the same fix seen through the minter, which is where it bites.
  it("gives two of one person's devices two connection sets, and two ledgers, on ONE cell", () => {
    const minter = new TerminalGrantMinter(() => 1_787_788_800_000);
    const phone = minter.mintTransport(KEY, { ...SELF, tailscaleId: "nodekey:aaaa" });
    const ipad = minter.mintTransport(KEY, { ...SELF, tailscaleId: "nodekey:bbbb" });
    expect(phone.claims.connectionSetId).not.toBe(ipad.claims.connectionSetId);
    // and each device's transport ledger starts at 1. That is the other half of
    // the bug: the generation counter is per {clientId, cellBootId}, so with one
    // shared clientId the iPad's first grant arrived at generation 2 and raised
    // the cell's high-water past every grant the phone still held.
    expect(phone.claims.transportGrantGeneration).toBe(1);
    expect(ipad.claims.transportGrantGeneration).toBe(1);
  });

  it("mints a ticket whose grants parse, verify against the cell key, and bind audience/client/session", () => {
    let now = 1_787_788_800_000;
    const minter = new TerminalGrantMinter(() => now, "E1");
    const ticket = minter.mintTicket({
      key: KEY,
      principal: WINDOW,
      sessionId: "s1",
      route: ROUTE,
      doors: DOORS,
    });
    expect(CellTransportGrant.safeParse(ticket.transportGrant).success).toBe(true);
    expect(SessionAttachGrant.safeParse(ticket.attachGrant).success).toBe(true);
    expect(verify(KEY, ticket.transportGrant)).toBe(true);
    expect(verify(KEY, ticket.attachGrant)).toBe(true);
    expect(ticket.transportGrant.claims).toMatchObject({
      audienceCellBootId: "cell-boot-A",
      // TP-R21 — the identity, scoped to this minter's (this fieldd boot's) epoch
      clientId: "win:p-3c4d#doc-2~E1",
      connectionSetId: "win:p-3c4d#doc-2~E1@cell-boot-A",
      allowedChannels: ["control", "frames"],
      transportGrantGeneration: 1,
      issuedAt: now,
      expiresAt: now + TP_TRANSPORT_GRANT_TTL_MS,
    });
    expect(ticket.attachGrant.claims).toMatchObject({
      audienceCellBootId: "cell-boot-A",
      clientId: "win:p-3c4d#doc-2~E1",
      sessionId: "s1",
      routeRevision: 12,
      grantGeneration: 1,
      rights: ["geometry", "input", "read"],
      expiresAt: now + TP_ATTACH_GRANT_TTL_MS,
    });
    // no lease epoch until the floor exposes custody's per-session epoch
    expect("leaseEpoch" in ticket.attachGrant.claims).toBe(false);
    // TP-S3e: the doors ARE the ticket's endpoints, unconditionally — the
    // S3a era's endpoints-optional mint retired with the bridge (the refusal
    // for a doorless cell lives in terminal-service, before the mint).
    expect(ticket.endpoints).toEqual(DOORS);
    // a second key cannot verify the first key's grant
    expect(verify({ ...KEY, keyHex: "a1".repeat(32) }, ticket.attachGrant)).toBe(false);
    now += 1;
    const again = minter.mintTicket({
      key: KEY,
      principal: WINDOW,
      sessionId: "s1",
      route: ROUTE,
      doors: DOORS,
    });
    expect(again.transportGrant.claims.transportGrantGeneration).toBe(2);
    expect(again.transportGrant.claims.connectionSetId).toBe(
      ticket.transportGrant.claims.connectionSetId,
    );
    expect(again.transportGrant.claims.nonce).not.toBe(ticket.transportGrant.claims.nonce);
    expect(again.attachGrant.claims.grantGeneration).toBe(2);
  });

  it("generations are per {client, cell} and per {client, session} — another window starts at 1", () => {
    const minter = new TerminalGrantMinter(() => 1);
    minter.mintTicket({ key: KEY, principal: WINDOW, sessionId: "s1", route: ROUTE, doors: DOORS });
    minter.mintTicket({ key: KEY, principal: WINDOW, sessionId: "s1", route: ROUTE, doors: DOORS });
    const other = minter.mintTicket({
      key: KEY,
      principal: {
        ...WINDOW,
        rendererParticipant: { participantId: "p-other", incarnation: "doc-1" },
      },
      sessionId: "s1",
      route: ROUTE,
      doors: DOORS,
    });
    expect(other.transportGrant.claims.transportGrantGeneration).toBe(1);
    expect(other.attachGrant.claims.grantGeneration).toBe(1);
    const s2 = minter.mintTicket({
      key: KEY,
      principal: WINDOW,
      sessionId: "s2",
      route: ROUTE,
      doors: DOORS,
    });
    expect(s2.transportGrant.claims.transportGrantGeneration).toBe(3);
    expect(s2.attachGrant.claims.grantGeneration).toBe(1);
  });

  it("renewAttach is a CAS on the held generation and idempotent by requestId", () => {
    const minter = new TerminalGrantMinter(() => 10);
    minter.mintTicket({ key: KEY, principal: WINDOW, sessionId: "s1", route: ROUTE, doors: DOORS });
    const renewed = minter.renewAttach({
      key: KEY,
      principal: WINDOW,
      sessionId: "s1",
      route: ROUTE,
      expectGeneration: 1,
      requestId: "r-1",
    });
    expect(renewed.claims.grantGeneration).toBe(2);
    expect(verify(KEY, renewed)).toBe(true);
    // the same request again: the same grant, generation untouched
    const retried = minter.renewAttach({
      key: KEY,
      principal: WINDOW,
      sessionId: "s1",
      route: ROUTE,
      expectGeneration: 1,
      requestId: "r-1",
    });
    expect(retried).toEqual(renewed);
    expect(minter.attachGeneration(WINDOW, "s1")).toBe(2);
    // a stale expectation is CONFLICT, never a silent mint
    let error: unknown;
    try {
      minter.renewAttach({
        key: KEY,
        principal: WINDOW,
        sessionId: "s1",
        route: ROUTE,
        expectGeneration: 1,
        requestId: "r-2",
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(RpcCallError);
    expect((error as RpcCallError).kind).toBe("CONFLICT");
    // and a never-minted pair renews only from generation 0
    expect(() =>
      minter.renewAttach({
        key: KEY,
        principal: GUEST,
        sessionId: "s1",
        route: ROUTE,
        expectGeneration: 1,
        requestId: "g-1",
      }),
    ).toThrow(RpcCallError);
    const guest = minter.renewAttach({
      key: KEY,
      principal: GUEST,
      sessionId: "s1",
      route: ROUTE,
      expectGeneration: 0,
      requestId: "g-2",
    });
    expect(guest.claims.rights).toEqual(["read"]);
    expect(guest.claims.grantGeneration).toBe(1);
  });

  it("the renewal memory is bounded — the oldest requestId is forgotten first", () => {
    const minter = new TerminalGrantMinter(() => 10);
    minter.mintTicket({ key: KEY, principal: WINDOW, sessionId: "s1", route: ROUTE, doors: DOORS });
    let generation = 1;
    for (let i = 0; i < 12; i += 1) {
      minter.renewAttach({
        key: KEY,
        principal: WINDOW,
        sessionId: "s1",
        route: ROUTE,
        expectGeneration: generation,
        requestId: `r-${i}`,
      });
      generation += 1;
    }
    // the first request is forgotten: replaying it is now a stale CAS, not a cached answer
    expect(() =>
      minter.renewAttach({
        key: KEY,
        principal: WINDOW,
        sessionId: "s1",
        route: ROUTE,
        expectGeneration: 1,
        requestId: "r-0",
      }),
    ).toThrow(RpcCallError);
    // the most recent is still remembered
    const last = minter.renewAttach({
      key: KEY,
      principal: WINDOW,
      sessionId: "s1",
      route: ROUTE,
      expectGeneration: 12,
      requestId: "r-11",
    });
    expect(last.claims.grantGeneration).toBe(13);
  });
});

// TP-R21 (the 2026-09-24 terminal audit) — the minter's ledgers are memory-only
// and restart at 1 with fieldd, while the cells OUTLIVE fieldd and hold each
// connection set's high-water for `maxGrantLifetimeMs` + skew (field-native
// `tp/ledger.rs`). A grant BELOW a set's high-water is `GRANT_GENERATION_ROLLBACK`
// (retryable: false). So a restart is safe only if every clientId — and with it
// every connection set and attach ledger key — is NEW after it. A window got that
// from Electron main's boot fence; a tailnet caller (`tailnet:<login>#<node>`) was
// the same identity before and after, and nothing made it new.
describe("TP-R21 — a fieldd restart never meets its own old high-water", () => {
  const PHONE = { ...SELF, tailscaleId: "nodekey:aaaa" };

  /** The cell's rule, as `tp/ledger.rs` states it: per connection set, a
   * generation below the high-water is a rollback; at or above, admitted. */
  function cellLedger() {
    const highWater = new Map<string, number>();
    return {
      admit(claims: { connectionSetId: string; transportGrantGeneration: number }): boolean {
        const held = highWater.get(claims.connectionSetId) ?? 0;
        if (claims.transportGrantGeneration < held) return false;
        highWater.set(claims.connectionSetId, claims.transportGrantGeneration);
        return true;
      },
    };
  }

  it("scopes EVERY minted clientId to the minter's epoch, stable within it", () => {
    const minter = new TerminalGrantMinter(() => 10, "E1");
    for (const principal of [PHONE, SELF, GUEST, WINDOW, { kind: "shell-main", tokenId: "t" }]) {
      const first = minter.mintTransport(KEY, principal).claims;
      const second = minter.mintTransport(KEY, principal).claims;
      expect(first.clientId).toBe(mintedClientId(principal, "E1"));
      expect(first.clientId).toBe(`${clientIdFor(principal)}~E1`);
      // within one fieldd boot the client is ONE client: its connection set is
      // stable and its generations climb (spec §5.1)
      expect(second.connectionSetId).toBe(first.connectionSetId);
      expect(second.transportGrantGeneration).toBe(first.transportGrantGeneration + 1);
    }
  });

  it("two boots never mint one clientId, one connection set or one attach key for a stable identity", () => {
    const bootA = new TerminalGrantMinter(() => 10);
    const bootB = new TerminalGrantMinter(() => 20);
    expect(bootA.epoch).not.toBe(bootB.epoch);
    for (const principal of [PHONE, WINDOW]) {
      const a = bootA.mintTicket({
        key: KEY,
        principal,
        sessionId: "s1",
        route: ROUTE,
        doors: DOORS,
      });
      const b = bootB.mintTicket({
        key: KEY,
        principal,
        sessionId: "s1",
        route: ROUTE,
        doors: DOORS,
      });
      expect(b.transportGrant.claims.clientId).not.toBe(a.transportGrant.claims.clientId);
      expect(b.transportGrant.claims.connectionSetId).not.toBe(
        a.transportGrant.claims.connectionSetId,
      );
      expect(b.attachGrant.claims.clientId).not.toBe(a.attachGrant.claims.clientId);
    }
  });

  it("the phone's first grant after a restart is ADMITTED by a cell that remembers the last boot", () => {
    const cell = cellLedger();
    const bootA = new TerminalGrantMinter(() => 10);
    // boot A: three tickets (a flaky leg re-mints each time), the cell admits each
    for (let i = 0; i < 3; i += 1) {
      expect(cell.admit(bootA.mintTransport(KEY, PHONE).claims)).toBe(true);
    }
    // fieldd restarts; the cell does not — boot B's counter starts again at 1
    const bootB = new TerminalGrantMinter(() => 20);
    const first = bootB.mintTransport(KEY, PHONE).claims;
    expect(first.transportGrantGeneration).toBe(1);
    expect(cell.admit(first)).toBe(true);
  });

  it("CONTROL — the unscoped identity is exactly what the cell refuses as a rollback", () => {
    // what the grants carried before TP-R21 was fixed: the bare identity
    const cell = cellLedger();
    const unscoped = (generation: number) => ({
      connectionSetId: connectionSetIdFor(clientIdFor(PHONE), KEY.cellBootId),
      transportGrantGeneration: generation,
    });
    for (let generation = 1; generation <= 3; generation += 1) {
      expect(cell.admit(unscoped(generation))).toBe(true);
    }
    // the restarted fieldd's first grant, generation 1, on the SAME set
    expect(cell.admit(unscoped(1))).toBe(false);
  });
});

describe("the roster projection carries no placement (TP-D4, TP-L-C)", () => {
  it("projects id, class, health and title; the cell tag never reaches the item", () => {
    const rows: TerminalInfo[] = [
      {
        sessionId: "s1",
        pid: 42,
        title: "zsh",
        cell: {
          cellInstanceId: 4,
          cellBootId: "cell-boot-A",
          workloadClass: "interactive",
          role: "class",
        },
      },
      {
        sessionId: "s2",
        cell: { cellInstanceId: 2, cellBootId: "cell-boot-B", workloadClass: "agent" },
      },
      { sessionId: "s3" },
    ];
    const items = projectRoster(rows);
    expect(items).toEqual([
      { sessionId: "s1", workloadClass: "interactive", health: "live", title: "zsh" },
      { sessionId: "s2", workloadClass: "agent", health: "live" },
      { sessionId: "s3", workloadClass: "interactive", health: "live" },
    ]);
    for (const item of items) expect(ProductSessionRosterItem.safeParse(item).success).toBe(true);
  });
});
