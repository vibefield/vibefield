// THE HOST KIT (plugin spec §5.4 item 5) — the declared door an out-of-process
// widget harness comes through.
//
// `apps/plugin-playground` renders every declared widget state headlessly and
// answers pass/fail. To be a VERDICT rather than a demo it has to mount what the
// product mounts: the same manifest→prefab projection, the same per-widget
// failure boundary, the same engine settings. UI_SYSTEM.md's catalog law is the
// same rule one floor up — a harness mounts the shipping thing with a fixture
// adapter, never a copy of it — so the two projections are exported here instead
// of being reimplemented against the same spec sections twice.
//
// Deliberately narrow, and it stays that way: this is not "field-app's internals
// are public now". Activation is NOT here — a headless harness activates through
// the SDK's own mock host (`@vibefield/plugin-sdk/testing`), which is the surface
// a plugin author is entitled to reason about, and which carries no
// process-global activation memo that would make a second run answer for the
// first.
export { createFieldEngine } from "./field-engine";
export type { WidgetBinding } from "./plugin-host/build-widget";
export { buildWidgetType } from "./plugin-host/build-widget";
