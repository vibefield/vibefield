import { type ConnectionHello, decodeTpMessage, TP_LEG_INBOUND } from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import {
  buildDoorProbeScript,
  doorProbeHellos,
  doorProbeVerdict,
} from "../src/testing/terminal-door-probe";

// TP-S3a — the door probe's PURE halves: the renderer script it injects, the
// hellos it sends (the contracts' tagged ConnectionHello, one per channel) and
// the verdict (both contexts accepted). The Electron half — a real pair, a real
// window, a real cell — runs as `pnpm smoke:terminal-door`.

const GRANT = {
  protected: {
    v: 1,
    typ: "CellTransportGrant",
    iss: "fieldd",
    alg: "HS256",
    kid: { cellBootId: "cb-1", keyGeneration: 1 },
  },
  claims: {
    audienceCellBootId: "cb-1",
    clientId: "win:1#1",
    connectionSetId: "win:1#1@cb-1",
    allowedChannels: ["control", "frames"],
    transportGrantGeneration: 1,
    issuedAt: 1_787_788_800_000,
    expiresAt: 1_787_788_860_000,
    nonce: "n",
  },
  mac: "AAAA",
};

describe("doorProbeHellos", () => {
  it("sends the contracts' tagged ConnectionHello per channel; the worker advertises capacity", () => {
    const { controlHello, framesHello } = doorProbeHellos(GRANT);
    const control = decodeTpMessage(controlHello, TP_LEG_INBOUND.control);
    const frames = decodeTpMessage(framesHello, TP_LEG_INBOUND.frames);
    expect(control.ok && frames.ok).toBe(true);
    if (!control.ok || !frames.ok) return;
    expect((control.body as ConnectionHello).channel).toBe("control");
    expect((control.body as ConnectionHello).receiverCapacities).toBeUndefined();
    expect((frames.body as ConnectionHello).channel).toBe("frames");
    expect(
      (frames.body as ConnectionHello).receiverCapacities?.connectionCreditBytes,
    ).toBeGreaterThan(0);
    expect((frames.body as ConnectionHello).transportGrant).toEqual(GRANT);
  });
});

describe("buildDoorProbeScript", () => {
  it("is one self-contained, syntactically valid expression naming both doors", () => {
    const { controlHello, framesHello } = doorProbeHellos(GRANT);
    const script = buildDoorProbeScript({
      controlUrl: "ws://127.0.0.1:49152/control",
      framesUrl: "ws://127.0.0.1:49152/frames",
      controlHello,
      framesHello,
      timeoutMs: 1000,
    });
    // Compiles without running (WebSocket/Worker are renderer globals).
    expect(() => new Function(`return (${script});`)).not.toThrow();
    expect(script).toContain("ws://127.0.0.1:49152/control");
    expect(script).toContain("ws://127.0.0.1:49152/frames");
    expect(script).toContain('"type":"ConnectionHello"');
    // the worker inherits the dial function verbatim and reports its own origin
    expect(script).toContain("self.onmessage");
    expect(script).toContain("r.origin = self.origin");
    // nothing is imported — the app origin's CSP admits only what is already there
    expect(script).not.toMatch(/\bimport\b/);
  });
});

describe("doorProbeVerdict", () => {
  const accepted = (context: "document" | "worker") => ({
    context,
    url: "ws://127.0.0.1:1/x",
    accepted: true,
    type: "ConnectionAccepted",
    refusal: null,
    closeCode: null,
    closeReason: null,
    error: null,
  });
  it("is the conjunction of both contexts, and names what failed", () => {
    expect(
      doorProbeVerdict({
        documentOrigin: "vibefield-app://shell",
        document: accepted("document"),
        worker: accepted("worker"),
      }),
    ).toEqual({ ok: true, why: [] });
    const silent = doorProbeVerdict({
      documentOrigin: "vibefield-app://shell",
      document: accepted("document"),
      worker: {
        ...accepted("worker"),
        accepted: false,
        type: null,
        closeCode: 1008,
        closeReason: "",
      },
    });
    expect(silent.ok).toBe(false);
    expect(silent.why).toEqual(["worker: no reply close 1008"]);
    const refused = doorProbeVerdict({
      documentOrigin: "vibefield-app://shell",
      document: {
        ...accepted("document"),
        accepted: false,
        type: "ConnectionRefused",
        refusal: "CAPACITY",
      },
      worker: accepted("worker"),
    });
    expect(refused.why).toEqual(["document: ConnectionRefused CAPACITY"]);
  });
});
