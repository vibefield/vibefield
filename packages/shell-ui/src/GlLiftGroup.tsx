/**
 * GL twin of CardShell's lift — via the COMPOSITE quad (useIslandLift), not a
 * scene-scale: the quad carries the texture's rounded alpha corners with it
 * and pops the card over its neighbors, while a scene-scale pushed the
 * backplate past the card-sized frustum and cropped the corners square
 * (field report 2026-07-12). Lift signals match CardShell: hold-armed
 * (post-Sequence-hand-off Drag capturing this widget, no Grab yet) or
 * live-dragged (Grab).
 */
// The empty type import loads R3F's JSX augmentation (<group> et al.) into
// every program that type-checks a GL card through this shared wrapper.
import type {} from "@react-three/fiber";
import type { Entity, World } from "@vibecook/ice";
import { useIslandLift, useIslandOpacity } from "@vibecook/ice/r3f";
import type { ReactNode } from "react";
import { LIFT_OPACITY } from "./CardShell";
import { useDragLift } from "./use-drag-lift";

export function GlLiftGroup({
  world,
  entity,
  children,
}: {
  world: World;
  entity: Entity;
  children: ReactNode;
}) {
  // The shared lift signal (use-drag-lift.ts, 2026-07-18): same truth and
  // same ChromeSettings.liftScale as the DOM CardShell, so the floating 3D
  // content and the card chrome rise in lockstep from ONE knob.
  const { lifted, scale } = useDragLift(world, entity);
  useIslandLift(lifted ? scale : 1);
  // The drag-lift fade: same value as CardShell's CSS opacity, so the DOM
  // chrome (P1) and the floating 3D content (the composite quad) drop to 75 %
  // and restore together.
  useIslandOpacity(lifted ? LIFT_OPACITY : 1);
  return <group>{children}</group>;
}
