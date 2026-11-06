import type { DriveHolders } from "./holders";
import type { DriveLaneRelay } from "./lane-relay";
import type { DriveAdoptCandidate, DriveLanded, DrivePullRequest, DrivePulls } from "./pulls";

// DR-3b (W3, VF-RELAY) — R2's STUB of the drive's transport port: the shape its rows compile against, answering
// wrong, so they are red by assertion. R6 writes it.

export interface DriveTransportPort {
  send(peer: string, record: Uint8Array): Promise<boolean>;
  onFrame(listener: (peer: string, record: Uint8Array) => void): () => void;
  onPeer(listener: (peer: string, up: boolean) => void): () => void;
  pull(request: DrivePullRequest): Promise<DriveLanded>;
  onAdoptCandidate(listener: (candidate: DriveAdoptCandidate) => void): () => void;
}

export interface DriveServiceOptions {
  relay: DriveLaneRelay;
  pulls: DrivePulls;
  holders: DriveHolders;
}

export function driveRefusal(error: unknown): unknown {
  return error;
}

export class DriveService implements DriveTransportPort {
  constructor(readonly options: DriveServiceOptions) {}

  async start(): Promise<void> {}

  async nodeUp(): Promise<void> {}

  async connected(): Promise<void> {}

  async driveChanged(): Promise<void> {}

  async send(_peer: string, _record: Uint8Array): Promise<boolean> {
    throw new Error("DR-3b R2 stub: the drive's service is not built");
  }

  onFrame(_listener: (peer: string, record: Uint8Array) => void): () => void {
    return () => undefined;
  }

  onPeer(_listener: (peer: string, up: boolean) => void): () => void {
    return () => undefined;
  }

  async pull(_request: DrivePullRequest): Promise<DriveLanded> {
    throw new Error("DR-3b R2 stub: the drive's service is not built");
  }

  onAdoptCandidate(_listener: (candidate: DriveAdoptCandidate) => void): () => void {
    return () => undefined;
  }

  async stop(): Promise<void> {}
}
