// @vibefield/fieldd — the product-plane daemon (design-02 §3).
export { bootstrap, type FielddConfig, type FielddDaemon, type FielddHealth } from "./daemon";
export { MeshClient, type ServeSpec, type ServeState } from "./mesh-client";
export { NativeLink, RpcCallError } from "./native-link";
export { computePairingMac } from "./pairing";
export { ProductApi } from "./product-api";
export { type TokenGrant, TokenService } from "./token-service";
