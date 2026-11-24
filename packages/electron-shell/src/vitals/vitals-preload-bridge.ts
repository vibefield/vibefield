// VT-2 (track VT, 2026-11-24) — the Vitals window's preload bridge, apart from Electron so its tests need none. One
// port in, one read-only stream out: the page is handed envelopes main relayed and can send nothing back but the id of
// an incident to open (VT-4b).

export interface VitalsRendererPort {
  start(): void;
  close(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  /** VT-4b — the page's one ask, an incident to open */
  postMessage?(message: string): void;
}

/** What the page receives: an envelope's own fields, checked for shape and no further. Its payload is parsed by the
 * page (field-app's feed), which owns the contracts. */
export interface VitalsBridgeEvent {
  kind: "vitals" | "logs" | "incident";
  origin?: "fieldd" | "shell";
  event: "snapshot" | "delta" | "down";
  payload?: unknown;
  /** VT-4b — the incident main could not read */
  id?: string;
}

/** VT-4b — an incident's id, as fieldd mints it; the only thing the page may send. */
const INCIDENT_ID = /^[0-9a-z]{1,16}-[0-9a-f]{8}$/;

export type VitalsBridgeHandler = (event: VitalsBridgeEvent) => void;

/** Frames that arrive before the page listens are kept, so the first snapshot is never lost to a race between the
 * port's arrival and the page's mount. Bounded: past it the oldest deltas leave, and a snapshot always stays. */
export const VITALS_BRIDGE_BACKLOG_MAX = 256;

export function parseVitalsEnvelope(raw: unknown): VitalsBridgeEvent | null {
  if (typeof raw !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const envelope = value as Record<string, unknown>;
  if (envelope["v"] !== 1) return null;
  const kind = envelope["kind"];
  const event = envelope["event"];
  const origin = envelope["origin"];
  if (kind !== "vitals" && kind !== "logs" && kind !== "incident") return null;
  if (event !== "snapshot" && event !== "delta" && event !== "down") return null;
  if (kind === "logs" && origin !== "fieldd" && origin !== "shell") return null;
  if (kind === "incident") {
    // VT-4b — one incident whole, or the id main could not read
    if (event === "delta") return null;
    const id = envelope["id"];
    return event === "down"
      ? { kind, event, ...(typeof id === "string" && INCIDENT_ID.test(id) ? { id } : {}) }
      : { kind, event, payload: envelope["payload"] };
  }
  return {
    kind,
    ...(kind === "logs" ? { origin: origin as "fieldd" | "shell" } : {}),
    event,
    ...(event === "down" ? {} : { payload: envelope["payload"] }),
  };
}

export class VitalsPreloadBridge {
  private readonly handlers = new Set<VitalsBridgeHandler>();
  private backlog: VitalsBridgeEvent[] = [];
  private port: VitalsRendererPort | null = null;

  /** A new document generation's port replaces the last one. */
  attach(port: VitalsRendererPort): void {
    this.port?.close();
    this.port = port;
    port.onmessage = (message) => this.accept(message.data);
    port.start();
  }

  /** VT-4b — ask main for one incident whole, by its id. Anything that is not an id is never sent. */
  openIncident(id: unknown): void {
    if (typeof id !== "string" || !INCIDENT_ID.test(id)) return;
    try {
      this.port?.postMessage?.(JSON.stringify({ v: 1, kind: "incident", id }));
    } catch {
      // a port that closed has nobody to ask
    }
  }

  subscribe(handler: VitalsBridgeHandler): () => void {
    this.handlers.add(handler);
    if (this.backlog.length > 0) {
      const kept = this.backlog;
      this.backlog = [];
      for (const event of kept) handler(event);
    }
    return () => {
      this.handlers.delete(handler);
    };
  }

  private accept(raw: unknown): void {
    const event = parseVitalsEnvelope(raw);
    if (event === null) return;
    if (this.handlers.size === 0) {
      this.backlog.push(event);
      if (this.backlog.length > VITALS_BRIDGE_BACKLOG_MAX) {
        const drop = this.backlog.findIndex((kept) => kept.event === "delta");
        this.backlog.splice(drop < 0 ? 0 : drop, 1);
      }
      return;
    }
    for (const handler of this.handlers) handler(event);
  }
}
