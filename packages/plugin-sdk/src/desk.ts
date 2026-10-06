// @vibefield/plugin-sdk/desk — THE OBJECT DOOR (DK-6; spec §12.8): everything a plugin's object
// KIND is written against, re-exported from the umbrella's PUBLISHED entries and from nowhere else
// (ICE design-016 K-L1 — the SDK is a plugin's only door onto ICE; K-L2 — a plugin kind compiles
// exactly as one of ICE's six built-ins does, from these same names):
//
//  - `@vibecook/ice/desk/kit`, WHOLE — the render kit a kind's pass is written against: the slot's
//    view and its mat (`MatPass`), the lamp and its light, the kit's WGSL by name (`kitWgsl`), a
//    container's inside, the finishes, and the service keys a kind is lent (`TEXT_RASTER`,
//    `PICTURE_DECODER`, `BLOB_STORE`, `serviceKey`/`service`).
//  - `@vibecook/ice/desk/engine` — the raw-WebGPU engine a pass is built with (`compose`/`compile`,
//    pipelines, `defineStruct`, targets), LESS device acquisition (`acquire`/`adopt`): a kind draws
//    on the HOST's one device, handed to its `create` (DK-D22 — a plugin gets no device of its own).
//  - `@vibecook/ice/desk`, CURATED — the kind contract (`ObjectKind`, `KindProgram`, `KindPass`, the
//    world half's contexts), the placement keys (`DESK_OBJECT`, `CONTAINABLE`, `PINNABLE`), the record
//    store, the theme's types and `rgb` (with `MISSING_INK`, what it answers for a colour it cannot
//    read — I32), the fault ladder's constants. Never the host half: no
//    `deskLayer`, no renderer, no profiler — those are the app's.
//  - `@vibecook/ice` — the core types a kind's acts and tray entry speak: `HeldToolDef`,
//    `MenuActionDef` and their APIs, `HeldGlyph`, `TrayEntry` (`hang` required), `Entity`, `World`;
//    and the two core names a kind's DOM HALF reads (DK-8 — VibeField's comment pad, the first plugin
//    kind with a text part), exactly as ICE's own halves read them (the note's body, the calendar's
//    line): `Camera` — the resource that says where the desk's one editor stands on screen (read,
//    never written) — and `Active` — the tag that says its object is still in the frame (a nav cut
//    ends the lease). Nothing else of core's: a kind writes its document through `writable(docs)`.
//
// NOTHING of `@vibecook/ice/desk/objects`: a plugin never imports a built-in kind (K-L4 — a kind
// names another only by its registry name, through `KindDriverHost.kind(name)`/`provides(key)`).
// `test/desk-door.test.ts` holds this file to that, and to the published entries alone.
//
// The plugin's bundle leaves this module EXTERNAL (`@vibefield/plugin-sdk` and its subpaths are host
// singletons, PA-29): at load the host's import map binds it to the app's own copy, so a plugin kind
// runs on the host's one ICE — one loro, one strata, one catalog.

import type { MenuActionDef } from "@vibecook/ice";
import type { DriverFactory, ObjectDef, ObjectHost, ObjectKind } from "@vibecook/ice/desk";

export type {
  Entity,
  HeldGlyph,
  HeldToolApi,
  HeldToolDef,
  MenuActionApi,
  MenuActionDef,
  TrayEntry,
  World,
} from "@vibecook/ice";
export { Active, Camera } from "@vibecook/ice";
export {
  CONTAINABLE,
  type ColourParse,
  createRecordStore,
  cssColor,
  type DataChildren,
  DESK_OBJECT,
  type DriverFactory,
  defineObject,
  driversOf,
  FLUX_REST,
  type HeldContext,
  type HeldReadoutContext,
  hostOf,
  type InsideContext,
  isObjectKind,
  KIND_MISSING,
  KIND_STRIKES,
  type KindDriver,
  type KindDriverHost,
  type KindExtra,
  type KindFault,
  type KindHost,
  type KindLocal,
  type KindPass,
  type KindProgram,
  MISSING_INK,
  NO_DOCS,
  numberProp,
  type ObjectContext,
  type ObjectDef,
  type ObjectDomHost,
  type ObjectFlux,
  type ObjectHit,
  type ObjectHost,
  type ObjectKind,
  type ObjectRect,
  type OpenBinding,
  objectKindOf,
  type Palette,
  PINNABLE,
  type RecordStore,
  type RecordStoreStats,
  type RGB,
  type RGBA,
  type RungContext,
  rectFrame,
  rectOf,
  rgb,
  type SlotContext,
  type StratumName,
  stringProp,
  type ThemeName,
  type TokenRef,
  type TypingDocs,
  type WritableSession,
  writable,
  ZOOM_MAX,
  ZOOM_MIN,
} from "@vibecook/ice/desk";
export {
  type BindEntry,
  type BindKind,
  BLEND_OVER,
  beginPass,
  bindGroup,
  bindLayout,
  type Clear,
  type ComposedShader,
  type ComposeOptions,
  compile,
  compose,
  defineStruct,
  type FieldSlot,
  type FieldType,
  type FieldValue,
  type RenderPipelineOptions,
  readback,
  renderPipeline,
  type ShaderPart,
  type StructBuffer,
  type StructDef,
  type StructValues,
  storageBuffer,
  Target,
  type TargetOptions,
  uniformBuffer,
  type Visibility,
} from "@vibecook/ice/desk/engine";
export * from "@vibecook/ice/desk/kit";

// docs:begin object-binding
/**
 * An OBJECT's code half (spec §12.8; DK-0f's contract): the value of the renderer module's NAMED
 * EXPORT that `contributes.objects[].binding.kind` names. Static, never registered from `activate` —
 * the desk creates every kind's pass together at its mount — so the HOST reads the export and
 * compiles the prefab from the manifest's DURABLE half through ICE's `defineObject` (§12.2: plugin
 * code never owns a durable schema). The host refuses a binding whose `kind` is not a desk kind
 * (`isObjectKind`) or whose registry `name` is not the row's type (one id, no second namespace).
 *
 * `defineObject` is re-exported by this door for a plugin's own TESTS (compile the object as the host will,
 * then read it back with `objectKindOf`) — never call it in the renderer module: the host defines
 * your type from the manifest, and a second definition of one type throws.
 */
export interface ObjectBinding<G = unknown, R = unknown, L = unknown> {
  /** The kind: its program (its WGSL, its pass) and its world half. Its `name` IS the row's type. */
  readonly kind: ObjectKind<G, R, L>;
  /** The props chain to the manifest's `schemaVersion`: version → (prev) => next. Renames of the TYPE are host history, never a plugin's (`TYPE_RENAMES`). */
  readonly migrate?: ObjectDef["migrate"];
  /** The hand onto the kind's state, made once per desk (a pen, a carry, a typing session). */
  readonly drivers?: DriverFactory;
  /** The kind's DOM half, declared: `lend` · `text` · `mount`. */
  readonly host?: ObjectHost;
  /** Selection-menu acts, one undo step each. */
  readonly menu?: readonly MenuActionDef[];
}
// docs:end object-binding
