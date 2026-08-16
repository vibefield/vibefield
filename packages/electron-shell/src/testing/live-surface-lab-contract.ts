import type { LiveSurfaceAttachTicketV1 } from "@vibefield/contracts";

/**
 * Test-only rendezvous values shared by the external Electron harness and its
 * separately built renderer document. The ticket is deterministic only inside
 * this lab artifact; production tickets always come from crypto.randomBytes.
 */
export const LIVE_SURFACE_LAB_SURFACE_ID = "live_surface_lab_fixture_01";
export const LIVE_SURFACE_LAB_BROWSER_SURFACE_IDS = Array.from(
  { length: 10 },
  (_, index) => `live_surface_lab_browser_${String(index + 1).padStart(2, "0")}`,
);
export const LIVE_SURFACE_LAB_FALLBACK_SURFACE_ID = "live_surface_lab_browser_fallback";
export const LIVE_SURFACE_LAB_SCK_SURFACE_ID = "live_surface_lab_sck_fixture_01";

function ticket(index: number): LiveSurfaceAttachTicketV1 {
  return {
    v: 1,
    token: `live_surface_lab_ticket_${String(index).padStart(40, "0")}`,
  };
}

/** Reload, CPU fixture, ten Browser sources, CPU fallback, then the optional SCK fixture. */
export const LIVE_SURFACE_LAB_ALL_TICKETS = Array.from({ length: 14 }, (_, index) =>
  ticket(index + 1),
);
export const LIVE_SURFACE_LAB_RELOAD_TICKET = LIVE_SURFACE_LAB_ALL_TICKETS[0]!;
export const LIVE_SURFACE_LAB_TICKETS = LIVE_SURFACE_LAB_ALL_TICKETS.slice(1);
export const LIVE_SURFACE_LAB_TICKET_TOKEN = LIVE_SURFACE_LAB_TICKETS[0]?.token ?? "";
export const LIVE_SURFACE_LAB_TICKET = LIVE_SURFACE_LAB_TICKETS[0] as LiveSurfaceAttachTicketV1;
export const LIVE_SURFACE_LAB_SCK_TICKET = LIVE_SURFACE_LAB_TICKETS[12]!;

export const LIVE_SURFACE_LAB_TICKET_READY_DATASET = "liveSurfaceLabTicketReady";
export const LIVE_SURFACE_LAB_RELOAD_READY_DATASET = "liveSurfaceLabReloadReady";
export const LIVE_SURFACE_LAB_RESULT_DATASET = "liveSurfaceLabResult";

export interface LiveSurfaceLabRendererResult {
  readonly ok: boolean;
  readonly presented: number;
  readonly presentedAfterRecovery: number;
  readonly deviceGenerations: number;
  readonly deviceLossObserved: boolean;
  readonly rendererReloadObserved: boolean;
  readonly transportProtocolFaults: number;
  readonly supersededFrames: number;
  readonly browserOnePresented: number;
  readonly browserOneTransport?: "shared-texture" | "cpu-bgra";
  readonly browserFallbackPresented: number;
  readonly browserFallbackObserved: boolean;
  readonly tenSurfacePresented: readonly number[];
  readonly tenSurfaceShared: number;
  readonly sckEnabled: boolean;
  readonly sckMode?: "fixture" | "simulator";
  readonly sckPresented: number;
  readonly sckExact: boolean;
  readonly sckRebound: boolean;
  readonly sckTransport?: "shared-texture";
  readonly sckPixelFormat?: "bgra";
  readonly sckRedPureRatio: number;
  readonly sckBluePureRatio: number;
  readonly error?: string;
}
