// PA-29 / spec §11.6 — the host-singleton externals list. React, ReactDOM,
// three, R3F/drei, ICE/strata, Loro, and the SDK runtime are host-provided
// singletons; a plugin bundle that carries a second copy of any of them
// refuses activation.
//
// Declared in EXACTLY ONE place: here. Every consumer — the renderer
// library-mode bundle, the esbuild service bundle, and the pack-time
// duplicate-singleton check (§5.4 item 1, stage "artifact checks") —
// imports THIS constant rather than hand-listing bundler externals. No
// plugin, built-in or third-party, configures its own externals list.
//
// This is the pack-time half of the PA-29 contract; the load-time half is
// the runtime resolution binding in §11.6 (a host-injected import map for
// the renderer, a `module.register` resolve hook for the service worker),
// which binds exactly these specifiers.
export const HOST_SINGLETON_EXTERNALS = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "three",
  "@react-three/fiber",
  "@react-three/drei",
  "@vibefield/plugin-sdk",
  "@vibecook/ice",
  "loro-crdt",
] as const;

export type HostSingletonExternal = (typeof HOST_SINGLETON_EXTERNALS)[number];
