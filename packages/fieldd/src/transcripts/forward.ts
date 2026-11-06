import {
  type CallerContext,
  RemoteSparkTranscriptSocket,
  SPARK_TRANSCRIPT_SERVICE,
  SparkTranscriptOpenTicketParams,
  SparkTranscriptOpenTicketResult,
} from "@vibefield/contracts";
import { RpcCallError } from "../native-link";
import type { DeviceForwarder } from "../product-api";
import { isSelfTailnetPrincipal } from "../terminal-grants";

// SP-7a (D3; `SP-7a-plan.md`) — A PHONE'S TRANSCRIPT TICKET, the half on its HOME.
//
// The phone asks only its home (DS-L4): `compose.sparks.transcript.openTicket {spark, device}`, naming the desktop
// that keeps the spark. The method is `federate`, so the door forwards it WHOLE (ProductApi's `device?` convention),
// with the phone in `onBehalfOf` (F1b's `clientDeviceId`). The owner mints for the phone from its own rule
// (`tickets.ts`), beside its worker's routed serve (`serve.ts`). This wrapper around the forwarder does two things,
// and nothing else:
//  · BEFORE the forward, it carries a self `tailnet` principal's ask alone. A window here asking for another desktop's
//    spark is refused: a desktop has no tailnet socket of its own (TM-D6), so the answer would be one it cannot dial,
//    and a window reads the sparks its own desktop keeps. The shell, a plugin, an agent and a guest are refused
//    likewise, because the owner sees this daemon and never the caller behind it (`TerminalService.forwardVia`'s law:
//    no refusal launders through a peer). A peer daemon's own forward is not carried on: one hop.
//  · AFTER it, the owner's answer passes back UNTOUCHED, with no adoption (DS-7 re-homed a window's set onto loopback;
//    the phone's node dials the owner's serve itself). It is read first: an answer that is no ticket is INCOMPATIBLE,
//    and one naming a socket only the owner's machine can dial is `doors_not_published`, each naming the owner, so the
//    phone never holds an endpoint it cannot use. A ticket's bytes ride this door once. The transcript never does
//    (EL2).

const METHOD = "compose.sparks.transcript.openTicket";

/** Whether this daemon carries `ctx`'s ask to another desktop: this person's phone alone. */
function refuseCarry(ctx: CallerContext, device: string): RpcCallError | null {
  if (isSelfTailnetPrincipal(ctx.principal)) return null;
  const kind = ctx.principal.kind;
  return new RpcCallError(
    "FORBIDDEN_SCOPE",
    kind === "peer-fieldd"
      ? "a ticket for another desktop's spark is forwarded one hop, from the phone's home"
      : "a ticket for another desktop's spark is carried for this person's phone alone",
    false,
    { method: METHOD, principal: kind, device },
  );
}

/** The transcript half of this daemon's `device?` forwarder, wrapped around the rest of it: every other method passes
 * through untouched. */
export function sparkTranscriptForwardVia(inner: DeviceForwarder): DeviceForwarder {
  return async (device, method, params, ctx, envelope) => {
    if (method !== METHOD) return await inner(device, method, params, ctx, envelope);
    if (!SparkTranscriptOpenTicketParams.safeParse(params ?? {}).success)
      throw new RpcCallError("PRECONDITION_FAILED", "expected { spark, device? }", false);
    const refusal = refuseCarry(ctx, device);
    if (refusal !== null) throw refusal;
    const answer = await inner(device, method, params, ctx, envelope);
    const ticket = SparkTranscriptOpenTicketResult.safeParse(answer);
    if (!ticket.success)
      throw new RpcCallError(
        "INCOMPATIBLE",
        `the transcript ticket ${device} answered does not parse as one`,
        false,
        { service: SPARK_TRANSCRIPT_SERVICE.SERVICE, device },
      );
    if (!RemoteSparkTranscriptSocket.safeParse(ticket.data.endpoint).success)
      throw new RpcCallError(
        "UNAVAILABLE",
        `${device} answered a transcript socket only its own machine can dial`,
        true,
        {
          service: SPARK_TRANSCRIPT_SERVICE.SERVICE,
          state: SPARK_TRANSCRIPT_SERVICE.STATE_DOORS_NOT_PUBLISHED,
          device,
        },
      );
    return answer;
  };
}
