// @vibefield/fieldd — the product-plane daemon (design-02 §3).

export {
  AUDIT_LEDGERS,
  type AuditIntegrityResult,
  type AuditLedger,
  type AuditMutation,
  type AuditMutationOutcome,
  AuditService,
  type AuditServiceOptions,
  AuditUnavailableError,
  type AuditWriterOperation,
  type AuditWriterTestHooks,
  verifyAuditSegment,
} from "./audit-service";
export { bootstrap, type FielddConfig, type FielddDaemon, type FielddHealth } from "./daemon";
export { DeviceService, type DeviceServiceOptions } from "./device-service";
export {
  DiagnosticsService,
  type DiagnosticsServiceOptions,
} from "./diagnostics-service";
export {
  type DocCommit,
  type DocOpenGrant,
  type DocServiceHealth,
  DocumentService,
  type DocumentServiceOptions,
  type TicketRedemption,
} from "./doc-service";
export {
  type DocSyncOptions,
  DocSyncService,
  type DocSyncState,
  type LaneBytes,
  type LaneControl,
  type LaneInfo,
} from "./doc-sync";
export { MeshClient, type ServeSpec, type ServeState } from "./mesh-client";
export { MeshLaneLink, type MeshLaneLinkOptions } from "./mesh-lane";
export { NativeLink, RpcCallError } from "./native-link";
export { computePairingMac } from "./pairing";
export { PeerLink, type PeerLinkOptions, type PeerLinkState } from "./peer-link";
export {
  contractsRangeSatisfied,
  type PluginRegistryConfig,
  type PluginRegistryHealth,
  PluginRegistryService,
} from "./plugin-registry";
export { ProductApi } from "./product-api";
export { ServiceHost, type ServiceHostConfig } from "./service-host";
export {
  type ServiceCallerInfo,
  type ServiceProviderBinding,
  type ServiceProviderHandlers,
  ServiceRegistry,
} from "./service-registry";
export {
  type TokenGrant,
  type TokenMintOptions,
  type TokenRevocationResult,
  TokenService,
} from "./token-service";
