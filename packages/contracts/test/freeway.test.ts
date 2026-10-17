// FW — the freeway's contract (freeway.ts; `draft/thinking-freeway.md` v0.3 §5.1, §5.2). The
// fixtures pin the shapes on both sides (fixtures.test.ts here; the floor seam's in field-native's
// fixture_parity.rs, the link wire's in the host's own tests); these rows pin the REFUSALS, which a
// golden cannot show, and the registry facts the host and fieldd both read.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FreewayDeclareParams,
  FreewayLinkMessage,
  FreewayOpen,
  FreewayOpenRefused,
  FreewaySessionAttachGrant,
  FreewayState,
  FreewayTicketRow,
  FreewayWelcome,
} from "../src/freeway";
import { METHODS } from "../src/methods";
import {
  FREEWAY,
  FREEWAY_CODES,
  FREEWAY_FRAGMENT_BIT,
  FREEWAY_FRAME,
  PORTS,
} from "../src/registries";
import { grantSigningInput, SessionAttachGrant, TicketEndpointSet } from "../src/terminal-pipeline";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as Record<string, unknown>;

describe("FW — the frame table and the codes are one wire, written once", () => {
  it("gives every frame type its own value, every one clear of the FRAGMENT bit", () => {
    const values = Object.values(FREEWAY_FRAME);
    expect(new Set(values).size).toBe(values.length);
    for (const value of values) expect(value & FREEWAY_FRAGMENT_BIT, String(value)).toBe(0);
  });

  it("registers every link code once, in the application range a WebSocket close may carry", () => {
    const codes = Object.values(FREEWAY_CODES);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code, String(code)).toBeGreaterThanOrEqual(4000);
      expect(code, String(code)).toBeLessThanOrEqual(4999);
    }
  });

  it("puts the freeway on its own port, by name", () => {
    expect(PORTS.FREEWAY_SERVE).toBe(9425);
    const assigned = Object.entries(PORTS).filter(([, port]) => port !== 0);
    expect(
      assigned.filter(([, port]) => port === PORTS.FREEWAY_SERVE).map(([name]) => name),
    ).toEqual(["FREEWAY_SERVE"]);
  });

  it("keeps a fragment between its floor and its ceiling, and the stream count inside QUIC's bound", () => {
    expect(FREEWAY.MIN_FRAGMENT_BYTES).toBeLessThan(FREEWAY.FRAGMENT_BYTES);
    expect(FREEWAY.FRAGMENT_BYTES).toBeLessThanOrEqual(FREEWAY.STREAM_WINDOW_BYTES);
    expect(FREEWAY.MAX_STREAMS).toBeLessThanOrEqual(100);
    expect(FREEWAY.APPROVAL_RENEW_MS).toBeLessThan(FREEWAY.APPROVAL_TTL_MS);
  });
});

describe("FW — the link refuses what it must", () => {
  it("refuses a hello for a protocol major this host does not speak", () => {
    const hello = fixture("freeway-hello.valid.json");
    expect(FreewayLinkMessage.safeParse(hello).success).toBe(true);
    const future = { ...hello, protocol: { major: FREEWAY.PROTOCOL_MAJOR + 1, minor: 0 } };
    expect(FreewayLinkMessage.safeParse(future).success).toBe(false);
  });

  it("announces a planned restart in the one plane vocabulary, never a second one", () => {
    // Ruled 2026-10-17 with the History lead: `RestartScheduled`'s planes, which the shell, fieldd
    // and the device slice all carry. A planned host restart is a field-native one.
    const restarting = fixture("freeway-link.restarting.json");
    expect(FreewayLinkMessage.safeParse(restarting).success).toBe(true);
    for (const planes of [["host"], ["floor"], ["app"], []]) {
      expect(FreewayLinkMessage.safeParse({ ...restarting, planes }).success, String(planes)).toBe(
        false,
      );
    }
  });

  it("refuses a welcome that does not say which desktop answered", () => {
    // FW-L9: the welcome's deviceId is the dialer's consistency check; a welcome without one
    // would let a misrouted link through unseen.
    const { deviceId: _, ...anonymous } = fixture("freeway-welcome.desktop.json");
    expect(FreewayWelcome.safeParse(anonymous).success).toBe(false);
  });

  it("refuses an open refusal whose code is not a registered link code", () => {
    const refused = fixture("freeway-open-refused.door-down.json");
    expect(FreewayOpenRefused.safeParse(refused).success).toBe(true);
    // a leg's own close code (4004 LEG_TIMEOUT) belongs in a stream's CLOSE, never here
    expect(FreewayOpenRefused.safeParse({ ...refused, code: 4004 }).success).toBe(false);
  });

  it("refuses a tickets ask beyond its bound", () => {
    const ask = fixture("freeway-open.terminal-tickets.json");
    const many = Array.from({ length: FREEWAY.MAX_TICKETS_PER_ASK + 1 }, (_, i) => `sess-${i}`);
    expect(FreewayOpen.safeParse({ ...ask, sessionIds: many }).success).toBe(false);
    expect(FreewayOpen.safeParse({ ...ask, sessionIds: [] }).success).toBe(false);
  });

  it("holds a ticket row to exactly one of a ticket or a refusal", () => {
    const rows = fixture("freeway-opened.tickets.json")["tickets"] as Record<string, unknown>[];
    const [withTicket, withRefusal] = rows as [Record<string, unknown>, Record<string, unknown>];
    expect(FreewayTicketRow.safeParse(withTicket).success).toBe(true);
    expect(FreewayTicketRow.safeParse(withRefusal).success).toBe(true);
    expect(
      FreewayTicketRow.safeParse({ ...withTicket, refusal: withRefusal["refusal"] }).success,
    ).toBe(false);
    expect(FreewayTicketRow.safeParse({ sessionId: "sess-01J8Z3K9" }).success).toBe(false);
  });
});

describe("FW — a ticket's legs may be streams on the link", () => {
  it("accepts freeway endpoints, and refuses swapped legs, a split pair or a malformed cell", () => {
    const tickets = fixture("freeway-opened.tickets.json")["tickets"] as Record<string, unknown>[];
    const ticket = tickets[0]!["ticket"] as Record<string, unknown>;
    const endpoints = ticket["endpoints"] as Record<string, string>;
    expect(TicketEndpointSet.safeParse(endpoints).success).toBe(true);
    const swapped = { controlUrl: endpoints["framesUrl"], framesUrl: endpoints["controlUrl"] };
    expect(TicketEndpointSet.safeParse(swapped).success).toBe(false);
    const split = { ...endpoints, framesUrl: "freeway://cell/cb-other/frames" };
    expect(TicketEndpointSet.safeParse(split).success).toBe(false);
    const malformed = { ...endpoints, controlUrl: "freeway://cell/cb 1/control" };
    expect(TicketEndpointSet.safeParse(malformed).success).toBe(false);
  });

  it("lets the host sign a phone's grants as itself, and keeps a desktop's fieldd's", () => {
    // FW-D1: the host mints from keys the floor generated — `field-native`, never a host signing
    // as fieldd — and a desktop's ticket stays fieldd's alone: its renderer never holds a host's.
    const grant = fixture("freeway-opened.attach-grant.json")["attachGrant"] as Record<
      string,
      unknown
    >;
    const asFieldd = { ...grant, protected: { ...(grant["protected"] as object), iss: "fieldd" } };
    expect(FreewaySessionAttachGrant.safeParse(grant).success).toBe(true);
    expect(FreewaySessionAttachGrant.safeParse(asFieldd).success).toBe(false);
    expect(SessionAttachGrant.safeParse(grant).success).toBe(false);
    expect(SessionAttachGrant.safeParse(asFieldd).success).toBe(true);
  });
});

describe("FW-D1 — the approval is TPv3's envelope under the floor's freeway key", () => {
  it("pins its signing input and MAC, which the host verifies at the phone's hello", () => {
    const v = fixture("freeway-approval-mac.vector.json") as {
      keyHex: string;
      approval: { protected: object; claims: object; signingInput: string; mac: string };
    };
    const { protected: header, claims, signingInput, mac } = v.approval;
    expect(grantSigningInput(header as never, claims)).toBe(signingInput);
    const expected = createHmac("sha256", Buffer.from(v.keyHex, "hex"))
      .update(signingInput, "utf8")
      .digest("base64url");
    expect(expected).toBe(mac);
    // The header is under the MAC: an approval re-typed as a grant is another MAC.
    const retyped = { ...header, typ: "SessionAttachGrant" };
    const other = createHmac("sha256", Buffer.from(v.keyHex, "hex"))
      .update(grantSigningInput(retyped as never, claims), "utf8")
      .digest("base64url");
    expect(other).not.toBe(mac);
  });
});

describe("FW — the floor seam", () => {
  it("admits only the two roles a link's hello can be", () => {
    const declare = fixture("freeway-declare-params.pair.json");
    expect(FreewayDeclareParams.safeParse(declare).success).toBe(true);
    const admit = [{ deviceId: "dev-x", role: "window" }];
    expect(FreewayDeclareParams.safeParse({ ...declare, admit }).success).toBe(false);
  });

  it("names this desktop, whose roster id the welcome carries (FW-L9)", () => {
    const { deviceId: _, ...nameless } = fixture("freeway-declare-params.phone.json");
    expect(FreewayDeclareParams.safeParse(nameless).success).toBe(false);
  });

  it("states the state stream's revision and floor boot even with the host gone", () => {
    const down = fixture("freeway-state.down.json");
    expect(FreewayState.safeParse(down).success).toBe(true);
    const { floorBootId: _, ...unanchored } = down;
    expect(FreewayState.safeParse(unanchored).success).toBe(false);
    expect(FreewayState.safeParse({ ...down, port: 0 }).success).toBe(false);
  });

  it("keeps the approval routable and every native.freeway verb local", () => {
    const byName = new Map(METHODS.map((def) => [def.method, def]));
    expect(byName.get("freeway.approve")?.locality).toBe("federate");
    for (const verb of [
      "native.freeway.declare",
      "native.freeway.state.subscribe",
      "native.freeway.joins.subscribe",
      "native.freeway.revoke",
    ]) {
      expect(byName.get(verb)?.surface, verb).toBe("mgmt");
      expect(byName.get(verb)?.locality, verb).toBe("local");
    }
  });
});
