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
const ROUTE = { cellBootId: KEY.cellBootId, routeRevision: 12 };

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
});

describe("the minter — fresh transport grants, monotonic attach generations, verifiable MACs", () => {
  it("mints a ticket whose grants parse, verify against the cell key, and bind audience/client/session", () => {
    let now = 1_787_788_800_000;
    const minter = new TerminalGrantMinter(() => now);
    const ticket = minter.mintTicket({
      key: KEY,
      principal: WINDOW,
      sessionId: "s1",
      route: ROUTE,
    });
    expect(CellTransportGrant.safeParse(ticket.transportGrant).success).toBe(true);
    expect(SessionAttachGrant.safeParse(ticket.attachGrant).success).toBe(true);
    expect(verify(KEY, ticket.transportGrant)).toBe(true);
    expect(verify(KEY, ticket.attachGrant)).toBe(true);
    expect(ticket.transportGrant.claims).toMatchObject({
      audienceCellBootId: "cell-boot-A",
      clientId: "win:p-3c4d#doc-2",
      connectionSetId: "win:p-3c4d#doc-2@cell-boot-A",
      allowedChannels: ["control", "frames"],
      transportGrantGeneration: 1,
      issuedAt: now,
      expiresAt: now + TP_TRANSPORT_GRANT_TTL_MS,
    });
    expect(ticket.attachGrant.claims).toMatchObject({
      audienceCellBootId: "cell-boot-A",
      clientId: "win:p-3c4d#doc-2",
      sessionId: "s1",
      routeRevision: 12,
      grantGeneration: 1,
      rights: ["geometry", "input", "read"],
      expiresAt: now + TP_ATTACH_GRANT_TTL_MS,
    });
    // S1: no lease epoch until the floor exposes custody's per-session epoch (S3a)
    expect("leaseEpoch" in ticket.attachGrant.claims).toBe(false);
    expect(ticket.endpoints).toBeUndefined();
    // a second key cannot verify the first key's grant
    expect(verify({ ...KEY, keyHex: "a1".repeat(32) }, ticket.attachGrant)).toBe(false);
    now += 1;
    const again = minter.mintTicket({ key: KEY, principal: WINDOW, sessionId: "s1", route: ROUTE });
    expect(again.transportGrant.claims.transportGrantGeneration).toBe(2);
    expect(again.transportGrant.claims.connectionSetId).toBe(
      ticket.transportGrant.claims.connectionSetId,
    );
    expect(again.transportGrant.claims.nonce).not.toBe(ticket.transportGrant.claims.nonce);
    expect(again.attachGrant.claims.grantGeneration).toBe(2);
  });

  it("generations are per {client, cell} and per {client, session} — another window starts at 1", () => {
    const minter = new TerminalGrantMinter(() => 1);
    minter.mintTicket({ key: KEY, principal: WINDOW, sessionId: "s1", route: ROUTE });
    minter.mintTicket({ key: KEY, principal: WINDOW, sessionId: "s1", route: ROUTE });
    const other = minter.mintTicket({
      key: KEY,
      principal: {
        ...WINDOW,
        rendererParticipant: { participantId: "p-other", incarnation: "doc-1" },
      },
      sessionId: "s1",
      route: ROUTE,
    });
    expect(other.transportGrant.claims.transportGrantGeneration).toBe(1);
    expect(other.attachGrant.claims.grantGeneration).toBe(1);
    const s2 = minter.mintTicket({ key: KEY, principal: WINDOW, sessionId: "s2", route: ROUTE });
    expect(s2.transportGrant.claims.transportGrantGeneration).toBe(3);
    expect(s2.attachGrant.claims.grantGeneration).toBe(1);
  });

  it("renewAttach is a CAS on the held generation and idempotent by requestId", () => {
    const minter = new TerminalGrantMinter(() => 10);
    minter.mintTicket({ key: KEY, principal: WINDOW, sessionId: "s1", route: ROUTE });
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
    minter.mintTicket({ key: KEY, principal: WINDOW, sessionId: "s1", route: ROUTE });
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
