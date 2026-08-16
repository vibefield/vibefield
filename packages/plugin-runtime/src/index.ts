// @vibefield/plugin-runtime — host-side plugin runtime primitives shared by the renderer and
// daemon adapters: canonical registration, exact runtime targets, and activation ownership.
// Plugin code never imports this package (R10); its public author vocabulary lives in plugin-sdk.
export { WIDGET_CATEGORIES, type WidgetCategory } from "@vibefield/contracts";
export {
  type ActivationCleanupError,
  type ActivationCloseKind,
  type ActivationCloseReason,
  type ActivationCloseReport,
  type ActivationDisposable,
  type ActivationDisposer,
  ActivationEffectSetupError,
  type ActivationEffectSnapshot,
  type ActivationResource,
  ActivationScope,
  type ActivationScopeOptions,
  type ActivationScopeSnapshot,
  type ActivationScopeState,
  type ActivationScopeStats,
  type ActivationTerminationAdapter,
  type BoundaryTerminationReport,
  InactiveActivationScopeError,
} from "./activation-scope";
export { createRendererContext, type PluginRendererContext } from "./context";
export { PluginRegistry, type RegisteredPlugin, safePreviewToCss } from "./registry";
export {
  type BehaviorRuntimeTarget,
  type PluginRuntimeTarget,
  type RendererRuntimeTarget,
  type RuntimeArtifactIdentity,
  type ServiceRuntimeTarget,
  samePluginRuntimeTarget,
} from "./runtime-target";
