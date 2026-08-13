// The PA-29 host-singleton externals list — a RE-EXPORT, not a declaration.
//
// The list moved to `@vibefield/contracts` (src/registries.ts) at P8 rung 0b,
// because the load-time half of the same contract binds it from processes that
// cannot depend on a Node build tool: §11.6's import map is injected by the
// renderer host, and the module bytes are served by Electron main. Registries
// are code (design-01 §7), so the list is registry data and this file is the
// authoring kit's door onto it.
//
// The names stay identical so every consumer here — the renderer library-mode
// bundle, the esbuild service bundle, and the pack-time artifact checks —
// imports what it always did.
export {
  HOST_SINGLETON_EXTERNALS,
  HOST_SINGLETON_MODULE_SPECIFIERS,
  type HostSingletonExternal,
  type HostSingletonModuleSpecifier,
} from "@vibefield/contracts";
