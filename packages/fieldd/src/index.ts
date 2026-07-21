// @vibefield/fieldd — the product-plane daemon (design-02 §3).
export { bootstrap, type FielddConfig, type FielddDaemon, type FielddHealth } from "./daemon";
export { NativeLink, RpcCallError } from "./native-link";
export { TokenService, type TokenGrant } from "./token-service";
export { ProductApi } from "./product-api";
export { computePairingMac } from "./pairing";
