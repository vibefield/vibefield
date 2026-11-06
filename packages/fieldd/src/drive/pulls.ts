import type { FileTransferRootName } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { RpcCallError } from "../native-link";

// DR-3b (W3, VF-RELAY) — R2's STUB of fieldd's half of the floor's file transfer: the shape its rows compile against,
// answering wrong, so they are red by assertion. R4 writes it.

export interface DrivePullsFloor {
  request(method: string, params: unknown): Promise<unknown>;
  subscribe(
    method: string,
    params: unknown,
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<{ snapshot: unknown; dispose: () => void }>;
}

export interface DrivePullRequest {
  peer: string;
  digest: string;
  path: string;
}

export interface DriveLanded {
  path: string;
}

export interface DriveAdoptCandidate {
  transferId: string;
  digest: string;
  path: string;
}

export interface DriveRootState {
  name: FileTransferRootName;
  state: "served" | "held" | "refused";
  reason?: string;
}

export class DrivePullFailed extends Error {
  readonly reason: string;
  readonly transferId: string;

  constructor(reason: string, message: string, transferId: string) {
    super(message);
    this.name = "DrivePullFailed";
    this.reason = reason;
    this.transferId = transferId;
  }
}

export interface DrivePullsOptions {
  floor: DrivePullsFloor;
  landsDir: string;
  roots: () => FileTransferRootName[];
  bootId: () => string | undefined;
  exists?: (path: string) => Promise<boolean>;
  mintId?: () => string;
  logger?: Logger;
}

export function failedWord(reason: string): string {
  return reason;
}

export function isFileTransferUnsupported(_error: unknown): _error is RpcCallError {
  return false;
}

export class DrivePulls {
  constructor(readonly options: DrivePullsOptions) {}

  async start(): Promise<void> {}

  async nodeUp(): Promise<void> {}

  async connected(): Promise<void> {}

  unsupported(): boolean {
    return false;
  }

  roots(): readonly DriveRootState[] {
    return [];
  }

  async declareRoots(): Promise<readonly DriveRootState[]> {
    return [];
  }

  async pull(_request: DrivePullRequest): Promise<DriveLanded> {
    throw new Error("DR-3b R2 stub: the drive's pulls are not built");
  }

  onAdoptCandidate(_listener: (candidate: DriveAdoptCandidate) => void): () => void {
    return () => undefined;
  }

  stop(): void {}
}
