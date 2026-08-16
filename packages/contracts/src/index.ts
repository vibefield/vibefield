// @vibefield/contracts — the single source of truth for every protocol VibeField owns
// (design-01). Zero runtime service code lives here; daemons and clients import from it.

export const CONTRACTS_VERSION = "0.1.0";

export * from "./artifacts";
export * from "./devices";
export * from "./doclane";
export * from "./docs";
export * from "./docsync";
export * from "./endpoints";
export * from "./envelope";
export * from "./errors";
export * from "./live-surfaces";
export * from "./meshdata";
export * from "./methods";
export * from "./mgmt";
export * from "./plugin-distribution";
export * from "./plugin-registry";
export * from "./plugin-runtime";
export * from "./plugins";
export * from "./registries";
export * from "./shell";
export * from "./terminal";
export * from "./users";
