import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CellEndpointSet, TerminalRouteSnapshot } from "../src/envelope";
import { TERMINAL_PIPELINE } from "../src/registries";
import { TerminalTicket } from "../src/terminal";
import {
  AttachControlLeg,
  CellActivationStatus,
  CellTransportGrant,
  ConnectionHello,
  canonicalJson,
  compareSceneContent,
  DEFAULT_GRANT_VALIDITY_LIMITS,
  DEFAULT_PROTOCOL_LIMITS,
  decodePresentationEnvelope,
  decodeTpMessage,
  encodePresentationEnvelope,
  FramesAttachOutcome,
  type GrantProtectedHeader,
  grantSigningInput,
  grantValidityAt,
  highWaterTombstoneTtlMs,
  PRESENTATION_ENVELOPE_MAX_HEADER_BYTES,
  PresentationEnvelopeHeader,
  ProductSessionRosterItem,
  SessionAttachGrant,
  SessionAttachGrantClaims,
  TerminalCreateOpenResult,
  TerminalOpenTicket,
  TerminalOpenTicketResult,
  TP_LEG_INBOUND,
  TP_LEG_OUTBOUND,
  TpMessageType,
  tagTpMessage,
} from "../src/terminal-pipeline";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

/** The reference minting procedure (what fieldd does; what the cell redoes to verify). */
function macFor(keyHex: string, protectedHeader: GrantProtectedHeader, claims: unknown): string {
  return createHmac("sha256", Buffer.from(keyHex, "hex"))
    .update(grantSigningInput(protectedHeader, claims), "utf8")
    .digest("base64url");
}

describe("RFC 8785 — canonicalJson (the grant MAC input)", () => {
  it("reproduces the RFC's own example byte-for-byte", () => {
    const v = fixture("tp-jcs.vector.json");
    expect(canonicalJson(v.input)).toBe(v.canonical);
    // The RFC's expected text, spelled out so the fixture cannot drift silently.
    expect(v.canonical).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });
  it("sorts by UTF-16 code units, omits undefined members, refuses non-JSON values", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: null, c: "x" }], ω: true, Z: false })).toBe(
      '{"Z":false,"a":[2,{"c":"x","d":null}],"b":1,"ω":true}',
    );
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson(-0)).toBe("0");
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson({ a: 1n })).toThrow(TypeError);
    expect(() => canonicalJson([undefined])).toThrow(TypeError);
  });
});

describe("grants — the authenticated envelope (spec §5.1)", () => {
  const v = fixture("tp-grant-mac.vector.json");

  it("pins the transport and attach MACs and their signing inputs", () => {
    expect(grantSigningInput(v.transport.protected, v.transport.claims)).toBe(
      v.transport.signingInput,
    );
    expect(macFor(v.keyHex, v.transport.protected, v.transport.claims)).toBe(v.transport.mac);
    expect(grantSigningInput(v.attach.protected, v.attach.claims)).toBe(v.attach.signingInput);
    expect(macFor(v.keyHex, v.attach.protected, v.attach.claims)).toBe(v.attach.mac);
    // The header is UNDER the MAC: flipping the grant type changes the MAC.
    const swapped = { ...v.transport.protected, typ: "SessionAttachGrant" };
    expect(macFor(v.keyHex, swapped, v.transport.claims)).not.toBe(v.transport.mac);
  });

  it("a transport grant cannot be presented as an attach grant (domain separation at parse)", () => {
    const transport = fixture("tp-transport-grant.valid.json");
    expect(CellTransportGrant.safeParse(transport).success).toBe(true);
    expect(SessionAttachGrant.safeParse(transport).success).toBe(false);
  });

  it("set-valued claims are sorted unique arrays — JCS has no sets", () => {
    const attach = fixture("tp-attach-grant.valid.json");
    const unsorted = { ...attach.claims, rights: ["read", "input"] };
    expect(SessionAttachGrantClaims.safeParse(unsorted).success).toBe(false);
    const dup = { ...attach.claims, rights: ["input", "input", "read"] };
    expect(SessionAttachGrantClaims.safeParse(dup).success).toBe(false);
    expect(SessionAttachGrantClaims.safeParse(attach.claims).success).toBe(true);
  });

  it("validity: lifetime first, then skew-bounded not-yet-valid / expired", () => {
    const c = { issuedAt: 1_000_000, expiresAt: 1_060_000 };
    const l = DEFAULT_GRANT_VALIDITY_LIMITS;
    expect(grantValidityAt(c, 1_000_000 - l.maxClockSkewMs - 1, l)).toBe("not-yet-valid");
    expect(grantValidityAt(c, 1_000_000 - l.maxClockSkewMs, l)).toBe("valid");
    expect(grantValidityAt(c, 1_060_000 + l.maxClockSkewMs - 1, l)).toBe("valid");
    expect(grantValidityAt(c, 1_060_000 + l.maxClockSkewMs, l)).toBe("expired");
    expect(grantValidityAt({ issuedAt: 0, expiresAt: l.maxGrantLifetimeMs + 1 }, 1, l)).toBe(
      "lifetime-exceeded",
    );
    expect(highWaterTombstoneTtlMs(l)).toBe(l.maxGrantLifetimeMs + l.maxClockSkewMs);
  });

  it("endpoints are loopback ws URLs and never carry a token (no query, no fragment)", () => {
    expect(
      CellEndpointSet.safeParse({ controlUrl: "ws://127.0.0.1:1/c", framesUrl: "ws://[::1]:2/f" })
        .success,
    ).toBe(true);
    expect(
      CellEndpointSet.safeParse({
        controlUrl: "ws://127.0.0.1:1/c?token=x",
        framesUrl: "ws://127.0.0.1:2/f",
      }).success,
    ).toBe(false);
    expect(
      CellEndpointSet.safeParse({
        controlUrl: "ws://10.0.0.5:1/c",
        framesUrl: "ws://127.0.0.1:2/f",
      }).success,
    ).toBe(false);
  });
});

describe("the S1 product results are additive over today's ticket (TP-L-F)", () => {
  it("a legacy TerminalTicket reader parses the S1 openTicket result; the v2 reader ignores the legacy trio", () => {
    const r = fixture("tp-open-ticket.s1.json");
    expect(TerminalOpenTicketResult.safeParse(r).success).toBe(true);
    const legacy = TerminalTicket.parse(r);
    expect(legacy.token).toBe("legacy-bridge-token");
    const v2 = TerminalOpenTicket.parse(r);
    expect(v2.route.cellBootId).toBe(v2.attachGrant.claims.audienceCellBootId);
    expect(v2.attachGrant.claims.sessionId).toBe("sess-01J8Z3K9");
  });
  it("create's result carries the session id, the legacy nested ticket and the spread v2 fields", () => {
    const r = TerminalCreateOpenResult.parse(fixture("tp-create-open.s1.json"));
    expect(r.sessionId).toBe(r.attachGrant.claims.sessionId);
    expect(r.ticket.controlSocket).toMatch(/termctl/);
  });
});

describe("the roster projection refuses placement (TP-L-C)", () => {
  it("parses a clean item and refuses one carrying a cell tag", () => {
    const item = fixture("tp-roster-item.valid.json");
    expect(ProductSessionRosterItem.safeParse(item).success).toBe(true);
    expect(ProductSessionRosterItem.safeParse({ ...item, cell: { cellBootId: "x" } }).success).toBe(
      false,
    );
    expect(ProductSessionRosterItem.safeParse({ ...item, cellBootId: "x" }).success).toBe(false);
  });
});

describe("activation — no claim repeated outside the grant; the two-dimensional lease", () => {
  it("ConnectionHello derives client/set/generation from the grant and tolerates unknown capabilities", () => {
    const h = ConnectionHello.parse(fixture("tp-connection-hello.frames.json"));
    expect("clientId" in h).toBe(false);
    expect(h.capabilities).toContain("x-future-capability");
    expect(h.transportGrant.claims.allowedChannels).toContain(h.channel);
  });
  it("AttachControlLeg carries no sessionId/leaseEpoch — the grant does", () => {
    const a = AttachControlLeg.parse(fixture("tp-attach-control-leg.valid.json"));
    expect("sessionId" in a).toBe(false);
    expect(a.attachGrant.claims.sessionId).toBe("sess-01J8Z3K9");
  });
  it("input=allowed implies presentation=presenting", () => {
    const ok = fixture("tp-cell-activation-status.presenting-allowed.json");
    expect(CellActivationStatus.safeParse(ok).success).toBe(true);
    expect(
      CellActivationStatus.safeParse(fixture("tp-cell-activation-status.lagging.json")).success,
    ).toBe(true);
    const contradiction = { ...ok, presentation: { state: "stopped", reason: "overload" } };
    expect(CellActivationStatus.safeParse(contradiction).success).toBe(false);
    // unknown reasons are tolerated (logged, never refused)
    const future = { ...ok, input: { state: "suspended", reason: "x-future-reason" } };
    expect(CellActivationStatus.safeParse(future).success).toBe(true);
  });
  it("resume-accepted carries from + newestAvailable", () => {
    expect(FramesAttachOutcome.safeParse({ kind: "resume-accepted" }).success).toBe(false);
    expect(
      FramesAttachOutcome.safeParse({ kind: "seed-required", reason: "no-cursor" }).success,
    ).toBe(true);
  });
  it("stamps compare only within one lineage", () => {
    const e = { cellBootId: "a", modelGeneration: 1 };
    expect(
      compareSceneContent({ sceneEpoch: e, sceneRevision: 1 }, { sceneEpoch: e, sceneRevision: 2 }),
    ).toBe(-1);
    expect(
      compareSceneContent(
        { sceneEpoch: e, sceneRevision: 9 },
        { sceneEpoch: { cellBootId: "a", modelGeneration: 2 }, sceneRevision: 1 },
      ),
    ).toBeNull();
  });
});

describe("the presentation envelope — binary framing around unchanged TRF1 (spec §8)", () => {
  it("pins the wire vector and round-trips; the charge is the whole message length", () => {
    const v = fixture("tp-envelope.vector.json");
    const header = PresentationEnvelopeHeader.parse(v.header);
    const payload = Uint8Array.from(Buffer.from(v.payloadHex, "hex"));
    const wire = encodePresentationEnvelope(header, payload);
    expect(Buffer.from(wire).toString("base64")).toBe(v.wireBase64);
    const decoded = decodePresentationEnvelope(wire);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.chargedBytes).toBe(wire.byteLength);
    expect(decoded.chargedBytes).toBe(v.chargedBytes);
    expect(Buffer.from(decoded.envelope.payload).toString("hex")).toBe(v.payloadHex);
    expect(decoded.envelope.header.kind).toBe("trf1-frame");
    // the payload is a view, not a copy
    expect(decoded.envelope.payload.buffer).toBe(wire.buffer);
  });
  it("refuses bad magic, bad version, truncated and oversized headers, and invalid headers", () => {
    const v = fixture("tp-envelope.vector.json");
    const wire = Uint8Array.from(Buffer.from(v.wireBase64, "base64"));
    const badMagic = Uint8Array.from(wire);
    badMagic[0] = 0x58;
    expect(decodePresentationEnvelope(badMagic)).toMatchObject({ ok: false, error: "bad-magic" });
    const badVersion = Uint8Array.from(wire);
    badVersion[2] = 9;
    expect(decodePresentationEnvelope(badVersion)).toMatchObject({
      ok: false,
      error: "bad-version",
    });
    expect(decodePresentationEnvelope(wire.subarray(0, 5))).toMatchObject({
      ok: false,
      error: "short",
    });
    expect(decodePresentationEnvelope(wire.subarray(0, 40))).toMatchObject({
      ok: false,
      error: "header-truncated",
    });
    const huge = Uint8Array.from(wire);
    new DataView(huge.buffer).setUint32(4, PRESENTATION_ENVELOPE_MAX_HEADER_BYTES + 1, false);
    expect(decodePresentationEnvelope(huge)).toMatchObject({
      ok: false,
      error: "header-too-large",
    });
    const invalid = encodePresentationEnvelope(
      // a seed whose baseContent is not null is refused by the header schema at decode
      { ...v.header, kind: "transfer-begin" } as never,
      new Uint8Array(0),
    );
    expect(decodePresentationEnvelope(invalid)).toMatchObject({
      ok: false,
      error: "header-invalid",
    });
  });
  it("per-kind header rules: a seed carries baseContent = null, a chunk its placement", () => {
    expect(
      PresentationEnvelopeHeader.safeParse(fixture("tp-envelope-header.seed-begin.json")).success,
    ).toBe(true);
    expect(
      PresentationEnvelopeHeader.safeParse(fixture("tp-envelope-header.chunk.json")).success,
    ).toBe(true);
    const seed = fixture("tp-envelope-header.seed-begin.json");
    expect(
      PresentationEnvelopeHeader.safeParse({ ...seed, baseContent: seed.resultContent }).success,
    ).toBe(false);
    const crossEpoch = fixture("tp-envelope-header.trf1.json");
    expect(
      PresentationEnvelopeHeader.safeParse({
        ...crossEpoch,
        baseContent: { sceneEpoch: { cellBootId: "other", modelGeneration: 0 }, sceneRevision: 1 },
      }).success,
    ).toBe(false);
  });
});

describe("message tagging — one wire for both legs (TP-S3a)", () => {
  it("tags, decodes and strips the tag from the body", () => {
    const hello = fixture("tp-connection-hello.frames.json");
    const tagged = tagTpMessage("ConnectionHello", hello);
    expect(tagged["type"]).toBe("ConnectionHello");
    const decoded = decodeTpMessage(tagged, TP_LEG_INBOUND.frames);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.type).toBe("ConnectionHello");
    expect((decoded.body as Record<string, unknown>)["type"]).toBeUndefined();
    expect((decoded.body as ConnectionHello).channel).toBe("frames");
  });

  it("refuses what the leg does not accept in this direction, and unknown tags", () => {
    const hb = tagTpMessage("LegHeartbeat", {
      connectionSetId: "cs-1",
      channel: "control",
      legGeneration: 1,
      sequence: 7,
    });
    expect(decodeTpMessage(hb, TP_LEG_INBOUND.control).ok).toBe(true);
    // cell → client tags are never accepted inbound
    const ack = tagTpMessage("LegHeartbeatAck", { sequence: 7 });
    expect(decodeTpMessage(ack, TP_LEG_INBOUND.control)).toMatchObject({
      ok: false,
      error: "not-allowed-here",
    });
    expect(decodeTpMessage({ type: "Nope" }, TP_LEG_INBOUND.control)).toMatchObject({
      ok: false,
      error: "unknown-type",
    });
    expect(decodeTpMessage({ sequence: 1 }, TP_LEG_INBOUND.control)).toMatchObject({
      ok: false,
      error: "missing-type",
    });
    expect(decodeTpMessage("hello", TP_LEG_INBOUND.control)).toMatchObject({
      ok: false,
      error: "not-an-object",
    });
    // a tagged message whose body fails its schema is `invalid`, with issues
    const bad = decodeTpMessage({ type: "LegHeartbeatAck", sequence: -1 }, TP_LEG_OUTBOUND.control);
    expect(bad).toMatchObject({ ok: false, error: "invalid" });
  });

  it("every tag has a schema and sits on at least one leg in one direction", () => {
    const seen = new Set<string>([
      ...TP_LEG_INBOUND.control,
      ...TP_LEG_INBOUND.frames,
      ...TP_LEG_OUTBOUND.control,
      ...TP_LEG_OUTBOUND.frames,
    ]);
    for (const t of TpMessageType.options) expect(seen.has(t), t).toBe(true);
    // both hellos are first frames; acks answer heartbeats on both legs
    expect(TP_LEG_INBOUND.control[0]).toBe("ConnectionHello");
    expect(TP_LEG_INBOUND.frames[0]).toBe("ConnectionHello");
  });

  it("the tagged-message fixtures decode on the leg they are filed for", () => {
    const rows: Array<[string, readonly TpMessageType[]]> = [
      ["tp-tagged-message.hello-control.json", TP_LEG_INBOUND.control],
      ["tp-tagged-message.accepted-control.json", TP_LEG_OUTBOUND.control],
      ["tp-tagged-message.refused.json", TP_LEG_OUTBOUND.control],
      ["tp-tagged-message.heartbeat.json", TP_LEG_INBOUND.control],
      ["tp-tagged-message.heartbeat-ack.json", TP_LEG_OUTBOUND.frames],
    ];
    for (const [name, allowed] of rows) {
      const decoded = decodeTpMessage(fixture(name), allowed);
      expect(decoded.ok, name).toBe(true);
    }
  });
});

describe("§20 item 5 — numeric defaults with owners, as data", () => {
  it("the defaults fixture IS the defaults (registries → contracts → the cell)", () => {
    expect(fixture("tp-protocol-limits.defaults.json")).toEqual(DEFAULT_PROTOCOL_LIMITS);
    expect(DEFAULT_GRANT_VALIDITY_LIMITS.maxGrantLifetimeMs).toBe(
      TERMINAL_PIPELINE.MAX_GRANT_LIFETIME_MS,
    );
    // the TTL inequality, by construction
    expect(TERMINAL_PIPELINE.HEARTBEAT_TTL_MS).toBeGreaterThan(
      2 * TERMINAL_PIPELINE.HEARTBEAT_INTERVAL_MS,
    );
  });
});

describe("the route row carries the cell's T1 doors (TP-S3a)", () => {
  it("parses a snapshot whose row names its doors, and refuses a non-loopback door", () => {
    const snapshot = TerminalRouteSnapshot.parse(fixture("terminal-routes.doors.json"));
    const row = snapshot.cells[0]!;
    expect(row.doors?.controlUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/control$/);
    expect(row.doors?.framesUrl).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/frames$/);
    expect(
      CellEndpointSet.safeParse({
        controlUrl: "ws://10.0.0.1:4000/control",
        framesUrl: "ws://127.0.0.1:4000/frames",
      }).success,
    ).toBe(false);
    // a pre-door row (no `doors`) still parses — absence is the honest answer
    const legacy = TerminalRouteSnapshot.parse(fixture("terminal-routes.replaced.json"));
    expect(legacy.cells.every((c) => c.doors === undefined)).toBe(true);
  });
});
