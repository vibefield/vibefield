// @vibefield/contracts — the single source of truth for every protocol VibeField owns
// (design-01). Zero runtime service code lives here; daemons and clients import from it.

export const CONTRACTS_VERSION = "0.1.0";

export * from "./registries";
export * from "./errors";
export * from "./envelope";
export * from "./methods";
