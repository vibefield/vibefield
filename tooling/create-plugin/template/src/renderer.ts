import { defineRendererPlugin } from "@vibefield/plugin-sdk";
import type { ObjectBinding } from "@vibefield/plugin-sdk/desk";
import { kind } from "./kind";
import type { DiscGeometry, DiscRecord } from "./record";

// The renderer MODULE (spec §10.1) and the object it draws.
//
// Three rules this file obeys, and they are the three that catch people first:
//  - an object's code half is a STATIC EXPORT, never a registration. The manifest's `binding.kind`
//    names it; the host reads it off this module and compiles the object from the manifest's durable
//    half before the desk's first frame (every kind's pass is made together at the desk's mount).
//  - top-level code stays PURE. Making the kind object is declaration; registration, I/O and timers
//    start in `activate` — never here.
//  - the SDK is the only door (wall R10): `@vibefield/plugin-sdk` and its subpaths (`/desk` for a
//    kind), `@vibefield/contracts` types. Importing `@vibecook/ice` directly is refused by `pnpm plugin
//    check` (`wall-violation`) and by the build, even though every name in `/desk` is ICE's — reaching
//    it THROUGH the SDK is what runs your kind on the host's one copy.

/** The manifest's `binding: { kind: "{{className}}" }` names THIS export: the object's code half. */
export const {{className}}: ObjectBinding<DiscGeometry, DiscRecord> = { kind: kind() };

export default defineRendererPlugin({
  activate(ctx) {
    // ctx.logger, never console: the host stamps provenance on plugin logs. The kind needs nothing
    // here — a command, a surface or a behavior would bind in this function.
    ctx.logger.info("{{title}} activated");
  },
});
