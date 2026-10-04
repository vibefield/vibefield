// Optional ICE behavior authoring example. This module is deliberately separate
// from manifest.ts: the scaffolder imports the manifest before dependencies are
// installed, while behavior definitions use the React-free SDK value door.
//
// To enable this example:
//   1. import exampleCounterContribution into manifest.ts, request
//      `canvas.write`, and add it under contributes.behaviors;
//   2. optionally attach `{ id: ExampleCounter.name, data: { count: 0 } }` under
//      the object's `behaviors` (a behavior is for state that is a FACT the world
//      syncs or keeps; what the kind DRAWS from flux belongs in its `local`);
//   3. import ExampleCounter in renderer.ts and call
//      `ctx.canvas.behaviors.bind(ExampleCounter.name, ExampleCounter)`.
//
// The manifest contains a complete ICE descriptor, while renderer activation
// supplies the identity-matched executable handle. The host refuses any drift.

import {
  type BehaviorHandle,
  declareBehavior,
  defineBehavior,
  p,
} from "@vibefield/plugin-sdk/behavior";

// The handle's type is spelled out: inferred, it would name a path inside the SDK's own
// dependencies, which a declaration cannot carry (TS2742).
export const ExampleCounter: BehaviorHandle<{ readonly count: number }> = defineBehavior("{{id}}:counter", {
  store: "runtime",
  schema: { count: p.number({ default: 0 }) },
});

export const exampleCounterContribution = declareBehavior(ExampleCounter);
