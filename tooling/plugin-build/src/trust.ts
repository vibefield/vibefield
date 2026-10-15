// TD-2 / WP8 — the trust-root verifier MOVED to `@vibefield/trust` at WP12 (build-wp12-updater.md D2: wall R2 keeps
// every `@vibefield/plugin-*` out of Electron main, and the UpdateProvider there must verify with the SAME code fieldd
// and the stager use). Re-exported so the kit's door (`@vibefield/plugin-build`) and every existing import hold.
export * from "@vibefield/trust";
