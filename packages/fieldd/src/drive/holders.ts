import type { DriveHolderState, DriveHoldersSlice } from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";

// DR-3b (W3, VF-RELAY) — R2's STUB of `field.drive.v1`'s holders slice: the shape its rows compile against, answering
// wrong, so they are red by assertion. R3 writes it.

export interface DriveHoldersMesh {
  setSlice(storeId: string, data: unknown): Promise<unknown>;
  subscribeStoreManaged(
    storeId: string,
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<{ snapshot: unknown; dispose: () => void }>;
}

export interface DriveHolding {
  state: DriveHolderState;
  held: { objects: number; bytes: number };
}

export interface DriveHoldersOptions {
  mesh: DriveHoldersMesh;
  deviceId: () => string;
  drive: () => DriveHolding | null;
  logger?: Logger;
  debounceMs?: number;
  now?: () => number;
}

export class DriveHolders {
  constructor(readonly options: DriveHoldersOptions) {}

  async start(): Promise<void> {}

  async nodeUp(): Promise<void> {}

  schedule(): void {}

  async publish(): Promise<void> {}

  holders(): DriveHoldersSlice[] {
    return [];
  }

  stop(): void {}
}
