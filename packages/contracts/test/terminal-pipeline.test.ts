import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CellEndpointSet, TerminalRouteSnapshot } from "../src/envelope";
import { TERMINAL_PIPELINE } from "../src/registries";
import { TerminalRuntimeSession, TerminalRuntimeSessionsResult } from "../src/terminal";
import {
  AttachControlLeg,
  CellActivationStatus,
  CellTransportGrant,
  ClaimGeometry,
  ConnectionHello,
  canonicalJson,
  compareSceneContent,
  DEFAULT_GRANT_VALIDITY_LIMITS,
  DEFAULT_PROTOCOL_LIMITS,
  decodePresentationEnvelope,
  decodeTpMessage,
  encodePresentationEnvelope,
  FramesAttachOutcome,
  GeometryCommitted,
  GeometryRefused,
  type GrantProtectedHeader,
  grantSigningInput,
  grantValidityAt,
  highWaterTombstoneTtlMs,
  PRESENTATION_ENVELOPE_MAX_HEADER_BYTES,
  PresentationEnvelopeHeader,
  ProductSessionRosterItem,
  SendInput,
  SendInputOp,
  SessionAttachGrant,
  SessionAttachGrantClaims,
  TerminalCreateOpenResult,
  TerminalKeyInput,
  TerminalMouseInput,
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

describe("the product results ARE the end state (TP-S3e — the union retired with the bridge)", () => {
  it("openTicket's result is exactly TerminalOpenTicket, endpoints REQUIRED", () => {
    const r = TerminalOpenTicketResult.parse(fixture("tp-open-ticket.valid.json"));
    expect(r.route.cellBootId).toBe(r.attachGrant.claims.audienceCellBootId);
    expect(r.attachGrant.claims.sessionId).toBe("sess-01J8Z3K9");
    expect(r.endpoints.controlUrl).toMatch(/^ws:\/\/127\.0\.0\.1:/);
    // a ticket without dialable doors is NOT a ticket — the S1-era optional
    // endpoints (and the keyless-floor half ticket) retired deliberately
    const { endpoints: _doors, ...withoutDoors } = r;
    expect(TerminalOpenTicketResult.safeParse(withoutDoors).success).toBe(false);
  });
  it("create's result carries the id, the REQUIRED birth summary and the spread ticket — and no legacy trio anywhere", () => {
    const raw = fixture("tp-create-open.valid.json");
    const r = TerminalCreateOpenResult.parse(raw);
    expect(r.sessionId).toBe(r.attachGrant.claims.sessionId);
    expect(r.session.handle).toBe("18446744073709551615");
    expect("ticket" in raw).toBe(false);
    expect("controlSocket" in raw).toBe(false);
    const { session: _s, ...withoutSession } = raw as Record<string, unknown>;
    expect(TerminalCreateOpenResult.safeParse(withoutSession).success).toBe(false);
  });
});

describe("terminal.sessions — the exact G23 mount inventory", () => {
  const session = {
    id: "sess-01J8Z3K9",
    handle: "18446744073709551615",
    executable: "/bin/zsh",
    cols: 80,
    rows: 24,
    exited: false,
    readWrite: true,
    title: null,
    cwd: "/Users/test",
    bellCount: 0,
    pid: 123,
    createdAtMs: 1_000,
    exitCode: null,
    exitSignal: null,
    requestedTermination: null,
    exitOutcome: null,
    ownerId: null,
    persistence: "keep-until-exit",
    activity: {
      kind: "unknown",
      source: "unsupported",
      confidence: "heuristic",
      rootProcessGroupId: null,
      foregroundProcessGroupId: null,
      observedAtMs: 1_000,
    },
  };

  it("preserves the engine's decimal u64 handle without a JSON-number round trip", () => {
    const parsed = TerminalRuntimeSessionsResult.parse({ sessions: [session] });
    expect(parsed.sessions[0]?.handle).toBe("18446744073709551615");
  });

  it("refuses mnemonic, signed, fractional, and non-canonical handles", () => {
    for (const handle of ["session-handle", "-1", "1.5", "01", 1]) {
      expect(TerminalRuntimeSession.safeParse({ ...session, handle }).success, String(handle)).toBe(
        false,
      );
    }
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
      // TP-S3c — the geometry seat rides the same wire: the claim is inbound,
      // the cell's commit and refusal are outbound, all on the control leg.
      ["tp-tagged-message.claim-geometry.json", TP_LEG_INBOUND.control],
      ["tp-tagged-message.geometry-committed.json", TP_LEG_OUTBOUND.control],
      ["tp-tagged-message.geometry-refused.json", TP_LEG_OUTBOUND.control],
      // TP-S3-input — the input verb is control-leg INBOUND (the input thread).
      ["tp-tagged-message.send-input.json", TP_LEG_INBOUND.control],
    ];
    for (const [name, allowed] of rows) {
      const decoded = decodeTpMessage(fixture(name), allowed);
      expect(decoded.ok, name).toBe(true);
    }
    // …and each geometry body is pinned by its own schema, not just its tag.
    const claim = ClaimGeometry.parse(fixture("tp-tagged-message.claim-geometry.json"));
    expect(claim.claimant.clientId).toBe("client-02");
    expect(claim.cols).toBe(100);
    expect(claim.expectRevision).toBe(5);
    const committed = GeometryCommitted.parse(fixture("tp-tagged-message.geometry-committed.json"));
    expect(committed.holder.holderGeneration).toBe(2);
    expect(committed.geometryRevision).toBe(5);
    const refused = GeometryRefused.parse(fixture("tp-tagged-message.geometry-refused.json"));
    expect(refused.code).toBe("SEAT_HELD");
    expect(refused.currentHolder?.clientId).toBe("client-01");
    expect(refused.geometryRevision).toBe(5);
    // …and the input body: scroll rows are SIGNED (negative scrolls up).
    const input = SendInput.parse(fixture("tp-tagged-message.send-input.json"));
    expect(input.inputSequence).toBe(12);
    expect(input.op).toMatchObject({ kind: "scroll", rows: -5 });
  });
});

describe("the input verb — SendInput (spec \u00a75.4, TP-S3-input)", () => {
  it("every op-kind fixture parses, discriminated on kind", () => {
    const text = SendInput.parse(fixture("tp-send-input.text.json"));
    expect(text.op.kind).toBe("text");
    const key = SendInput.parse(fixture("tp-send-input.key.json"));
    expect(key.op).toMatchObject({ kind: "key", key: { type: "down", code: "Enter" } });
    const mouse = SendInput.parse(fixture("tp-send-input.mouse.json"));
    expect(mouse.op).toMatchObject({ kind: "mouse", mouse: { action: "press", meta: true } });
  });

  it("unshiftedCodepoint defaults to 0 — ghosttea's own serde default, mirrored", () => {
    const op = SendInputOp.parse({
      kind: "key",
      key: {
        type: "up",
        key: "a",
        code: "KeyA",
        repeat: false,
        shift: false,
        control: false,
        alt: false,
        meta: false,
      },
    });
    if (op.kind !== "key") throw new Error("kind");
    expect(op.key.unshiftedCodepoint).toBe(0);
  });

  it("pins the JSON numeric domain to the engine's u8/u32/f32 and safe i64/u64 subsets", () => {
    const key = fixture("tp-send-input.key.json").op.key;
    expect(TerminalKeyInput.safeParse({ ...key, unshiftedCodepoint: 0xffff_ffff }).success).toBe(
      true,
    );
    expect(TerminalKeyInput.safeParse({ ...key, unshiftedCodepoint: -1 }).success).toBe(false);
    expect(TerminalKeyInput.safeParse({ ...key, unshiftedCodepoint: 0x1_0000_0000 }).success).toBe(
      false,
    );

    const mouse = fixture("tp-send-input.mouse.json").op.mouse;
    expect(TerminalMouseInput.safeParse({ ...mouse, button: 0xff }).success).toBe(true);
    expect(TerminalMouseInput.safeParse({ ...mouse, button: -1 }).success).toBe(false);
    expect(TerminalMouseInput.safeParse({ ...mouse, button: 0x100 }).success).toBe(false);
    expect(TerminalMouseInput.safeParse({ ...mouse, screenWidth: 0xffff_ffff }).success).toBe(true);
    expect(TerminalMouseInput.safeParse({ ...mouse, screenWidth: -1 }).success).toBe(false);
    expect(TerminalMouseInput.safeParse({ ...mouse, screenWidth: 0x1_0000_0000 }).success).toBe(
      false,
    );
    expect(
      TerminalMouseInput.safeParse({
        ...mouse,
        x: 3.4028234663852886e38,
        y: -3.4028234663852886e38,
      }).success,
    ).toBe(true);
    expect(TerminalMouseInput.safeParse({ ...mouse, x: 3.5e38 }).success).toBe(false);

    const body = fixture("tp-send-input.text.json");
    expect(SendInput.safeParse({ ...body, inputSequence: Number.MAX_SAFE_INTEGER }).success).toBe(
      true,
    );
    expect(
      SendInput.safeParse({ ...body, inputSequence: Number.MAX_SAFE_INTEGER + 1 }).success,
    ).toBe(false);
    expect(SendInput.safeParse({ ...body, leaseEpoch: -1 }).success).toBe(false);
    expect(
      SendInput.safeParse({ ...body, op: { kind: "scroll", rows: Number.MIN_SAFE_INTEGER } })
        .success,
    ).toBe(true);
    expect(
      SendInput.safeParse({ ...body, op: { kind: "scroll", rows: Number.MIN_SAFE_INTEGER - 1 } })
        .success,
    ).toBe(false);
    expect(
      SendInput.safeParse({
        ...body,
        op: { kind: "scroll-to", row: Number.MAX_SAFE_INTEGER + 1 },
      }).success,
    ).toBe(false);
  });

  it("an unknown kind refuses; the verb is INBOUND on control only", () => {
    expect(SendInputOp.safeParse({ kind: "detonate" }).success).toBe(false);
    const tagged = fixture("tp-tagged-message.send-input.json");
    expect(decodeTpMessage(tagged, TP_LEG_INBOUND.control).ok).toBe(true);
    expect(decodeTpMessage(tagged, TP_LEG_INBOUND.frames)).toMatchObject({
      ok: false,
      error: "not-allowed-here",
    });
    expect(decodeTpMessage(tagged, TP_LEG_OUTBOUND.control)).toMatchObject({
      ok: false,
      error: "not-allowed-here",
    });
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
