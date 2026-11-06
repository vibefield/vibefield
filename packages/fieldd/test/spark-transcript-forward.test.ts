import {
  type CallerContext,
  SPARK_TRANSCRIPT_SERVICE,
  type SparkTranscriptOpenTicketResult,
} from "@vibefield/contracts";
import { describe, expect, it } from "vitest";
import { RpcCallError } from "../src/native-link";
import type { DeviceForwarder } from "../src/product-api";
import { sparkTranscriptForwardVia } from "../src/transcripts/forward";

// SP-7a (D3; `transcripts/forward.ts`) — the HOME's half of a phone's transcript ticket. The phone asks its home
// `compose.sparks.transcript.openTicket {spark, device}`. The door forwards it whole (`federate`, ProductApi's
// `device?`), and this wrapper around the forwarder carries a self `tailnet` principal's ask alone: a window, the
// shell, a plugin, an agent, a guest and a peer daemon are refused before anything is carried (one hop; a window
// reads the sparks its own desktop keeps). The owner's answer passes back untouched, with no adoption, because the
// phone's node dials the owner's routed serve itself. An answer naming a socket only the owner's machine can dial is
// `doors_not_published`, naming the owner, never handed to the phone.

const OWNER = "dev-a";
const SPARK = "sp-vela00000000";
const METHOD = "compose.sparks.transcript.openTicket";

type Fields = Record<string, unknown>;
const ctxOf = (principal: Fields, more: Fields = {}): CallerContext =>
  ({ principal, transport: "ws-loopback", receivedAt: 0, ...more }) as CallerContext;
const PHONE = ctxOf(
  { kind: "tailnet", login: "me@example.com", self: true, tailscaleId: "n-phone" },
  { transport: "ws-tailnet", clientKind: "ios" },
);
const REFUSED: Array<[string, CallerContext]> = [
  [
    "a window here",
    ctxOf({
      kind: "local-token",
      tokenId: "tok-window",
      scopes: ["sparks.use"],
      rendererParticipant: { participantId: "renderer:w1", incarnation: "renderer:w1:doc-1" },
    }),
  ],
  ["shell-main", ctxOf({ kind: "shell-main" })],
  ["a plugin", ctxOf({ kind: "plugin", pluginId: "p", scopes: [] })],
  ["an MCP agent", ctxOf({ kind: "mcp-agent", sessionId: "run-1", scopes: [] })],
  [
    "a guest",
    ctxOf({ kind: "tailnet-guest", login: "them@example.com" }, { transport: "ws-tailnet" }),
  ],
  ["another login's node", ctxOf({ kind: "tailnet", login: "them@example.com", self: false })],
  ["a peer daemon", ctxOf({ kind: "peer-fieldd", deviceId: "dev-b" })],
];

/** The owner's answer to the phone: a ticket at its routed serve. */
const ownerTicket = (endpoint = "ws://desk-a.tail1234.ts.net:9426/transcripts") =>
  ({
    spark: SPARK,
    endpoint,
    ticket: "Qm9pZ2hUcmFuc2NyaXB0VGlja2V0X0V4YW1wbGUwMDE",
    expiresAt: 1_762_298_000_000,
    generation: 2,
    runs: [{ runtimeRunId: "run-vela-1", startedAt: "2026-11-05T03:00:00.000Z", fresh: true }],
  }) satisfies SparkTranscriptOpenTicketResult;

/** A forwarder that answers `answer` and counts what it carried. */
function owner(answer: unknown): DeviceForwarder & { calls: string[] } {
  const calls: string[] = [];
  const forward: DeviceForwarder = async (device, method) => {
    calls.push(`${device} ${method}`);
    return answer;
  };
  return Object.assign(forward, { calls });
}

/** What a call was refused with, or "served" (the row asserts on it). */
type Refusal = RpcCallError | "served" | "thrown";
async function refusalOf(run: () => Promise<unknown>): Promise<Refusal> {
  try {
    await run();
    return "served";
  } catch (error) {
    return error instanceof RpcCallError ? error : "thrown";
  }
}

describe("SP-7a — the home carries a phone's transcript ticket (D3)", () => {
  it("carries the phone's ask to the owner whole, and hands its answer back untouched", async () => {
    const answer = ownerTicket();
    const inner = owner(answer);
    const forward = sparkTranscriptForwardVia(inner);
    const carried = await forward(OWNER, METHOD, { spark: SPARK, device: OWNER }, PHONE);
    expect(inner.calls).toEqual([`${OWNER} ${METHOD}`]);
    expect(carried).toEqual(answer);
  });

  it("passes every other method through as it was", async () => {
    const inner = owner({ ok: true });
    const forward = sparkTranscriptForwardVia(inner);
    const other = await forward(OWNER, "compose.sparks.open", { spark: SPARK }, REFUSED[0]![1]);
    expect(other).toEqual({ ok: true });
    expect(inner.calls).toEqual([`${OWNER} compose.sparks.open`]);
  });

  it("refuses to carry anyone else's ask, before anything is carried", async () => {
    const inner = owner(ownerTicket());
    const forward = sparkTranscriptForwardVia(inner);
    for (const [who, ctx] of REFUSED) {
      const refused = await refusalOf(() => forward(OWNER, METHOD, { spark: SPARK }, ctx));
      expect(refused instanceof RpcCallError ? refused.kind : refused, who).toBe("FORBIDDEN_SCOPE");
    }
    expect(inner.calls).toEqual([]);
  });

  it("refuses a malformed ask before it is carried", async () => {
    const inner = owner(ownerTicket());
    const forward = sparkTranscriptForwardVia(inner);
    const refused = await refusalOf(() => forward(OWNER, METHOD, { spark: "../x" }, PHONE));
    expect(refused instanceof RpcCallError ? refused.kind : refused).toBe("PRECONDITION_FAILED");
    expect(inner.calls).toEqual([]);
  });

  it("says doors_not_published, naming the owner, when the owner answers a socket only its machine can dial", async () => {
    const loopback = ownerTicket("ws://127.0.0.1:53817/transcripts");
    const forward = sparkTranscriptForwardVia(owner(loopback));
    const refused = await refusalOf(() => forward(OWNER, METHOD, { spark: SPARK }, PHONE));
    const said =
      refused instanceof RpcCallError
        ? [refused.kind, refused.retryable, refused.details]
        : refused;
    expect(said).toEqual([
      "UNAVAILABLE",
      true,
      {
        service: SPARK_TRANSCRIPT_SERVICE.SERVICE,
        state: SPARK_TRANSCRIPT_SERVICE.STATE_DOORS_NOT_PUBLISHED,
        device: OWNER,
      },
    ]);
  });

  it("says an owner's answer that does not parse as a ticket is incompatible, naming the owner", async () => {
    const forward = sparkTranscriptForwardVia(owner({ spark: SPARK }));
    const refused = await refusalOf(() => forward(OWNER, METHOD, { spark: SPARK }, PHONE));
    const said = refused instanceof RpcCallError ? [refused.kind, refused.details] : refused;
    expect(said).toEqual([
      "INCOMPATIBLE",
      { service: SPARK_TRANSCRIPT_SERVICE.SERVICE, device: OWNER },
    ]);
  });
});
