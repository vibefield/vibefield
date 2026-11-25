// @vibefield/contracts — the single source of truth for every protocol VibeField owns
// (design-01). Zero runtime service code lives here; daemons and clients import from it.

export const CONTRACTS_VERSION = "0.1.0";
export * from "./agent-catalog";
export * from "./agent-extensions";
export * from "./agent-field";
export * from "./agent-index";
export * from "./agent-session";
export * from "./agent-usage";
export * from "./artifacts";
export * from "./compose";
export * from "./custody";
export * from "./desk-kinds";
export * from "./devices";
export * from "./doclane";
export * from "./docs";
export * from "./docsync";
export * from "./drive";
export * from "./endpoints";
export * from "./envelope";
export * from "./errors";
export * from "./flows";
export * from "./forwarding";
export * from "./freeway";
export * from "./live-surfaces";
export * from "./made-app-network";
export * from "./meshdata";
export * from "./methods";
export * from "./mgmt";
export * from "./objects";
export * from "./pages";
export * from "./phone-code";
export * from "./plugin-diagnostics";
export * from "./plugin-distribution";
export * from "./plugin-registry";
export * from "./plugin-runtime";
export * from "./plugin-update";
export * from "./plugin-words";
export * from "./plugins";
export * from "./project-doors";
export * from "./project-places";
export * from "./registries";
export * from "./release-identity";
export * from "./remote-endpoints";
export * from "./rows";
export * from "./screenshot";
export * from "./session-name";
export * from "./setup";
export * from "./shell";
export * from "./shell-lease";
export * from "./spark-transcript";
export * from "./stickers";
export * from "./subscription-admission";
export * from "./terminal";
export * from "./terminal-pipeline";
export * from "./terminal-pipeline-machines";
export * from "./tools";
export * from "./trust-root";
export * from "./update-policy";
export * from "./user-face";
export * from "./users";
// VT-2 (2026-11-24): the vitals wire is NOT re-exported here. Only fieldd and the Vitals window read it, through the
// `@vibefield/contracts/vitals` subpath, so the desk's window carries none of its schemas (as it carries none of
// `./diagnostics`). VT-1 exported it from this root for a day; the renderer build showed its cost.
export * from "./workspace";
