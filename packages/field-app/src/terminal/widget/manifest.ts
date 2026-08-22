import type { WidgetContribution } from "@vibefield/contracts";
import type { BuiltInContributor } from "@vibefield/plugin-runtime";

// THE BUILT-IN TERMINAL MIRROR — the durable half (TPv3 §17 mark 21, RATIFIED
// 2026-08-22 as (a): "a BUILT-IN widget type the host registers outside the SDK
// (field-app's own manifest contribution, pool access by construction; no
// third-party reach) — the least door").
//
// WHY THIS FILE IS NOT A PLUGIN MANIFEST. It is manifest DATA in the same
// vocabulary — `WidgetContribution` verbatim, so the host builds this prefab
// through the same `buildWidgetType` every plugin's rows go through — but it is
// not a `PluginManifestV1` and cannot be: §7.1's own invariant is "widgets
// require entries.renderer", and a built-in has no renderer artifact to name.
// Inventing one to satisfy a parse is exactly the lie `registerBuiltIn` exists
// to avoid (see `plugin-runtime/src/registry.ts` — the third authority).
//
// WHY IT IS A BUILT-IN AT ALL, restated where the code is. The mirror needs the
// WINDOW'S TERMINAL POOL — the routed runtime, the demand ledger, the transport
// table. `@vibefield/plugin-sdk` exports none of that and must not: minting a
// terminal door in the SDK would put third-party surfaces inside the terminal
// trust boundary (EL7 — same-uid agents are the adversary) and reopen the
// dependency TPv3's posture closes. R10 keeps the SDK the only door a PLUGIN
// reaches the app through; nothing in R10 says the host may not contribute its
// own widget. So the pool access here is by construction — the component is
// app source, in the same package as the pool it consumes — and no reach is
// granted to anyone else. The SDK is UNCHANGED by this slice, and
// `test/terminal-mirror-widget.test.tsx` asserts that as a gate.

/** The host's own contributor row. `version` is the APP's — a built-in has no
 * release of its own, and saying otherwise would invite an update story that
 * does not exist. */
export const TERMINAL_BUILT_IN: BuiltInContributor = {
  id: "vibefield.terminal",
  title: "Terminal",
  version: "0.1.0",
};

/** The widget type id. `<contributor>.<segment>` — the same owned-name rule the
 * manifest validator applies to plugins, enforced at the built-in door. It is
 * DURABLE: it lives in boards (plugin spec §21.2). */
export const TERMINAL_MIRROR_TYPE = "vibefield.terminal.mirror";

/**
 * The mirror's durable contract.
 *
 * PROPS. `sessionId` is the address and the only one (TP-L-C: a session is
 * addressed by id; which cell answers is the pool's business, and a widget that
 * stored placement would be storing a fact that expires). It defaults to EMPTY,
 * which is a real state rather than a missing one: a freshly inserted card has
 * not been pointed at anything yet and shows the roster picker. `label` is what
 * the user chose it by, REMEMBERED — so a card whose session has since exited
 * can still say whose screen it was, which is the difference between "gone" and
 * "blank". Both are strings because that is what a durable address is; the
 * contract's `ref` prop kinds (`session` among them) have no engine constructor
 * and `build-widget.ts` refuses them loudly rather than guessing.
 *
 * INTERACTION. Selectable, movable, resizable — that is the CARD's geometry,
 * which is the canvas's business and has nothing to do with the PTY's (a mirror
 * holds no geometry lease: TP-L-D, and the watch-only facade would refuse the
 * resize even if the surface tried). Deliberately absent: `keyboard`. Declaring
 * `keyboard: "exclusive"` would stand the engine keymap down while a node
 * inside this card held focus — i.e. it would ARRANGE for keys to flow into a
 * widget that must never take input focus at all (TP-R4a). The omission is a
 * load-bearing line, not an oversight.
 */
export const TERMINAL_MIRROR_CONTRIBUTION: WidgetContribution = {
  type: TERMINAL_MIRROR_TYPE,
  title: "Terminal mirror",
  description: "Watch a terminal session on the canvas — read-only, never typed into",
  category: "Tools",
  // The tray silhouette: the card's own deep ground. A literal because the
  // manifest vocabulary is data (SafePreview accepts a hex or a gradient, not a
  // token reference) — the LIVE card paints itself from tokens in
  // `mirror-widget.css`, which is where the no-hex rule applies.
  preview: { kind: "color", value: "#161a21" },
  schemaVersion: 1,
  surface: "dom",
  sizeMode: "fixed",
  defaultSize: { w: 420, h: 280 },
  minSize: { w: 220, h: 140 },
  interaction: { selectable: true, movable: true, resizable: true, snap: "target" },
  provides: ["widget"],
  props: {
    sessionId: { kind: "string", default: "" },
    label: { kind: "string", default: "" },
  },
  groups: {}, // group-less: everything rides the `vibefield.terminal.mirror:props` component
};

/** Every widget type the host contributes for the terminal. One today; the list
 * exists so the registration door has a single thing to iterate and a second
 * built-in never arrives by editing three files. */
export const TERMINAL_BUILT_IN_WIDGETS: readonly WidgetContribution[] = [
  TERMINAL_MIRROR_CONTRIBUTION,
];
