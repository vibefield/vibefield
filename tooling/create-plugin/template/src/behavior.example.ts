// Optional ICE behavior authoring example. This module is deliberately separate
// from manifest.ts: the scaffolder imports the manifest before dependencies are
// installed, while behavior definitions use the React-free SDK value door.
//
// To enable this example:
//   1. import exampleCounterContribution into manifest.ts, request
//      `canvas.write`, and add it under contributes.behaviors;
//   2. optionally attach `{ id: ExampleCounter.name, data: { count: 0 } }` under
//      a widget's behaviors;
//   3. import ExampleCounter in renderer.tsx and call
//      `ctx.canvas.behaviors.bind(ExampleCounter.name, ExampleCounter)`.
//
// The manifest contains a complete ICE descriptor, while renderer activation
// supplies the identity-matched executable handle. The host refuses any drift.

import { declareBehavior, defineBehavior, p } from "@vibefield/plugin-sdk/behavior";

export const ExampleCounter = defineBehavior("{{id}}:counter", {
  store: "runtime",
  schema: { count: p.number({ default: 0 }) },
});

export const exampleCounterContribution = declareBehavior(ExampleCounter);
