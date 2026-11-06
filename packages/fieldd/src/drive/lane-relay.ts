import type { Logger } from "@vibefield/logging";
import type { LaneInfo } from "../doc-sync";

// DR-3b (W3, VF-RELAY) — R2's STUB of the drive's lane relay: the shape its rows compile against, answering wrong,
// so they are red by assertion. R5 writes it.

export interface DriveLaneControl {
  open(req: { laneId: number; class: "reliable"; peer: string; protocol: "drive" }): Promise<void>;
  close(laneId: number): Promise<void>;
  subscribe(
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<{ lanes: LaneInfo[] }>;
}

export interface DriveLaneBytes {
  send(laneId: number, payload: Uint8Array): boolean;
  onLane(laneId: number, handler: (payload: Uint8Array) => void): void;
  offLane(laneId: number): void;
  readonly bufferedBytes?: number;
}

export interface DriveLaneRelayOptions {
  control: DriveLaneControl;
  bytes: DriveLaneBytes;
  allocateLaneId: () => number;
  isSelfPeer: (peer: string) => boolean;
  logger?: Logger;
  sendWatermarkBytes?: number;
  maxQueuedBytes?: number;
}

export class DriveLaneRelay {
  constructor(readonly options: DriveLaneRelayOptions) {}

  async start(): Promise<void> {}

  async send(_peer: string, _record: Uint8Array): Promise<boolean> {
    throw new Error("DR-3b R2 stub: the drive's lane relay is not built");
  }

  onFrame(_listener: (peer: string, record: Uint8Array) => void): () => void {
    return () => undefined;
  }

  onPeer(_listener: (peer: string, up: boolean) => void): () => void {
    return () => undefined;
  }

  async dispose(): Promise<void> {}
}
