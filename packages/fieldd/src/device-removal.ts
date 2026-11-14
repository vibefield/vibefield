import type {
  CallerContext,
  DeviceInfo,
  DeviceRemoveResult,
  KnownPhone,
} from "@vibefield/contracts";
import type { Logger } from "@vibefield/logging";
import type { AuditMutation, AuditMutationOutcome } from "./audit-service";

// 406 (red, S3): STUBBED — the ask, the act and the sweep do nothing (the green commit's).

/** What Remove reads of the roster (`DeviceService`). */
export interface RemovalRoster {
  currentDeviceId(): string;
  get(deviceId: string): DeviceInfo | undefined;
  isDocHost(deviceId: string): boolean;
  selfPeerDeviceIds(): readonly string[];
  sync(): Promise<void>;
}

/** What Remove reads of the account's settings document (`SettingsDocService`). */
export interface RemovalDoc {
  refusedDevices(): Promise<ReadonlyMap<string, ReadonlySet<string>>>;
  knownPhones(): Promise<ReadonlyMap<string, KnownPhone>>;
}

/** The audit, as Remove writes it (`AuditService`). */
export interface RemovalAudit {
  required<T>(
    ctx: CallerContext,
    mutation: AuditMutation,
    effect: () => Promise<T>,
    describeOutcome: (value: T) => AuditMutationOutcome,
  ): Promise<T>;
  requiredSystem<T>(
    mutation: AuditMutation,
    effect: () => Promise<T>,
    describeOutcome: (value: T) => AuditMutationOutcome,
  ): Promise<T>;
}

export interface DeviceRemovalOptions {
  roster: RemovalRoster;
  doc: RemovalDoc;
  audit: RemovalAudit;
  revokeTranscripts(clientId: string): Promise<void>;
  dropConnections(nodeIds: readonly string[]): number;
  revokeFreeway(minted: string): Promise<number>;
  linkedLogin(): string | null;
  logger?: Logger;
}

/** A Remove the handler may write. */
export interface RemovalAsk {
  deviceId: string;
  tailscaleIds: string[];
}

export class DeviceRemoval {
  constructor(readonly opts: DeviceRemovalOptions) {}

  async ask(_params: unknown): Promise<RemovalAsk | null> {
    return null;
  }

  async remove(
    _ctx: CallerContext,
    _ask: RemovalAsk,
    _write: () => Promise<{ wrote: boolean }>,
  ): Promise<DeviceRemoveResult> {
    return { removed: false, closed: 0 };
  }

  async sweep(): Promise<void> {}

  async seed(): Promise<void> {}
}
