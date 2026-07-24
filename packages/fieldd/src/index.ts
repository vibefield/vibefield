// @vibefield/fieldd — the product-plane daemon (design-02 §3).
export { bootstrap, type FielddConfig, type FielddDaemon, type FielddHealth } from "./daemon";
export { DeviceService, type DeviceServiceOptions } from "./device-service";
export {
  DiagnosticsService,
  type DiagnosticsServiceOptions,
} from "./diagnostics-service";
export {
  type DocOpenGrant,
  type DocServiceHealth,
  DocumentService,
  type DocumentServiceOptions,
  type TicketRedemption,
} from "./doc-service";
export { MeshClient, type ServeSpec, type ServeState } from "./mesh-client";
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
export { type TokenGrant, TokenService } from "./token-service";
