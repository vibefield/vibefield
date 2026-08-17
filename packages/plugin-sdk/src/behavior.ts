// React-free authoring and binding door for ICE behaviors (plugin spec §8.8,
// §12.7 / PRC-4d). Definition modules are imported by manifest generation, so
// this file must never reach the SDK root, ./canvas, React, or renderer hooks.

import { type BehaviorHandle, describeBehavior } from "@vibecook/ice";
import type { BehaviorContribution } from "@vibefield/contracts";
import { BehaviorContribution as BehaviorContributionSchema } from "@vibefield/contracts";

export type {
  AnyBehaviorAttachSpec,
  AnyBehaviorDef,
  BehaviorAttachSpec,
  BehaviorChanges,
  BehaviorCtxFor,
  BehaviorDescription,
  BehaviorFrame,
  BehaviorHandle,
  BehaviorHooks,
  BehaviorPhase,
  BehaviorQuery,
  BehaviorQuerySpec,
  BehaviorRead,
  BehaviorSchema,
  BehaviorSpec,
  BehaviorStore,
  DataOf,
  DurableBehaviorCtx,
  EphemeralBehaviorCtx,
  RuntimeBehaviorCtx,
} from "@vibecook/ice";
/** The complete React-free authoring vocabulary. Core read targets are
 * repeated from the canvas door so a definitions-only module need not import
 * the React-bearing `./canvas` subpath. */
export {
  CameraLimits,
  ChildOf,
  defineBehavior,
  describeBehavior,
  MeasuredSize,
  Position,
  PrefabId,
  p,
  Selected,
  Size,
  Viewport,
  Wire,
  WireFrom,
  WirePorts,
  WireTo,
} from "@vibecook/ice";
export type { BehaviorContribution } from "@vibefield/contracts";

export interface BehaviorDeclarationOptions {
  /** Required by manifest validation when the behavior declares a tick hook. */
  readonly reason?: string;
}

/** Produce the one signed data descriptor from an ICE handle. ICE remains the
 * semantic oracle; contracts only verifies that its version-pinned JSON shape
 * is safe to place in a manifest. */
export function declareBehavior<Data>(
  behavior: BehaviorHandle<Data>,
  options: BehaviorDeclarationOptions = {},
): BehaviorContribution {
  const { id, ...definition } = describeBehavior(behavior);
  return BehaviorContributionSchema.parse({
    id,
    ...(options.reason !== undefined ? { reason: options.reason } : {}),
    definition,
  });
}

/** Synchronous, identity-bound inverse. Binding is candidate-local and inert;
 * it never registers an ICE guest or invokes a behavior hook. */
export interface BehaviorBindingDisposable {
  dispose(): void;
}

/** Renderer activation's sealed declaration/code mirror. The host accepts
 * exactly one matching handle for every manifest row before publication. */
export interface PluginBehaviorBindingAPI {
  bind<Data>(id: string, behavior: BehaviorHandle<Data>): BehaviorBindingDisposable;
}
