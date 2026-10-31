# UI system architecture

`DESIGN.md` remains the visual authority. This document defines where that direction lives in
code and how the design catalog stays identical to the product.

## The four layers

1. **Tokens — `packages/design-kit/src/tokens.css`**
   Owns palette, semantic text and chrome colors, radii, materials, shadows, and motion curves.
   Component styles consume tokens; they do not introduce a parallel palette or eyeballed shadow.
   *The mat in CSS (DK-16 — DESIGN.md §2.1's erratum):* where nothing draws the desk yet — the splash
   and the floor it shares, the loading veil, a field's tile before its still, the terminal
   preview's miniature — the kit's tokens stand the cutting mat in: `--vf-mat-ground` (its sage as
   the theme lights it), `--vf-mat-lattice` with `--vf-mat-lattice-size` (its lines in the lit cream,
   `--vf-mat-line`, at the line law's presences — a smaller composition scales the sizes, never the
   presences) and `--vf-mat-ink` for the words on it. The CSS-fallback dots (`--vf-canvas-dot`, and
   widgetlab's `--canvas-dot` alias) left the tokens at DK-17: where nothing can draw the mat — the
   unavailable card — and for what is not a board — the kit's placeholder face — the ground is the
   plain one, `--vf-canvas-bg`; `wearing-the-mat.test.tsx` holds all of it.
2. **Primitives — `packages/design-kit/src/primitives.tsx` and `primitives.css`**
   Owns reusable control and state anatomy: buttons, icon buttons, fields, switches, segmented
   controls, pills, empty/unavailable states, notices, placeholders, and status dots.
   *The segmented control, extended (R19, DK-13 — a kit change):* it draws its THUMB as its own
   element under the chosen segment — placed from that segment's measured box at once, then sliding
   300 ms on the island curve across widths (standing still under reduced motion) — so the chosen
   segment is only its label over it; until the thumb can be measured the segment wears the look
   itself. An option is a string (its id and its label, as before) or `{ id, label, title? }`, so an
   id need not be what it shows (the pegboard's All is `""`). ← → Home End choose — from the segment
   the focus is on, the focus moving with the choice, the keys claimed so the desk's keymap never
   hears them — and the chosen segment is the group's one stop of Tab. Every segmented control in
   the app gained the thumb and the keys at once (Settings, the Me menu's Theme, Setup's face); the
   Me menu leaves Theme's arrows and Home End to the control. A composition may CUT the kit's
   anatomy (the pegboard's filters, cut for the wood, `field/desk/pegboard/pegboard.css`) but never
   grows a thumb of its own — `ui-system-boundaries.test.ts` holds it.
   *The unavailable state, extended (R18, built at DK-3, recorded and held at DK-16 — a kit change):*
   beside its compact and in-place shapes it has a CARD — `card`, the 380-wide variant a whole view
   shows when it cannot draw (the desk in the Canvas stage, DESIGN.md §8 "When the desk can't draw"):
   the strong hairline dashed, corners 22, padded 26 26 22, what happened at 14/600 in primary ink and
   what to do at 12.5/400 in tertiary — and two slots: `action`, ONE act under the words (the primary
   `UiButton`, inverted, 36 tall, padded 0 18, corners 18, 13/500 — the desk's Reload, a remount),
   absent where it could not help; and `detail`, LAST and small (11 mono, faint, 12 below), the
   renderer's own message verbatim. The composition lays the ground (the plain canvas ground,
   `field/desk/desk.css`) and chooses the words (`desk-words.ts`); the anatomy and
   its numbers are the kit's — `unavailable-card.test.tsx` holds them.
3. **Product compositions — colocated component and CSS files**
   A domain component owns its structure and its namespaced stylesheet. Runtime-heavy components
   split into a controller and a controller-free view/frame, so state adapters can mount the exact
   shipping composition without reproducing it.
4. **Catalog harnesses — `packages/field-app/src/design-system`**
   Owns only page layout, specimen staging, explanatory copy, and deterministic fixture data. It
   may size or clip a production component, but must not redefine that component's selectors.

The app stylesheet is a manifest. Global canvas/layout rules live under `field-app/src/styles`,
settings composition under `panels`, Godview under `godview`, and component styles beside their
components. Plugin content styles remain inside their plugin packages.

## Catalog fidelity

Fieldmarks / After Hours and Face Club retired under housekeeping Q19 C (2026-10-28); their
catalog sections, reports, design-kit exports, generated artwork and generators were removed
2026-10-29. Their sheets and SVG archives remain in `draft/archive/retired/design-fieldmarks/`
on `dev-local`. The catalog's account specimens mount §2.8's shipping `UserFaceView`, and its
glyph specimens mount §13's `FieldGlyph`.

The catalog currently mounts these shipping views directly:

- Artifact Hub and all empty/loading/populated/unavailable states — at the width the pill's sheet
  gives its Artifacts shelf since HN-8, a container its plugin's own tile form answers (PL-D3); the
  side panel's contents, which the right edge's drawer held from One Frame FR-4 until then
- Godview stage, monitor registry, tuning panel, unavailable terminal deck, and the complete
  swarm-circle state matrix — and, since GV-D1 (2026-10-11), Godview's head: the shipping
  `GodviewHeadView`, which the shipping monitor mounts, so every Godview specimen wears it and no
  catalog module names it. The stage specimen stages the catalog's own button for the System
  control panel, which the product reaches from the palette
- the command palette (re-cut by One Frame FR-3: the frame's acts and the plugins' commands, each
  key at its row's end), settings dialog and loading veil (the side-panel frame retired into the
  right edge's drawer at FR-4, and the drawer into the pill's Artifacts shelf at HN-8)
- shared controls/states and every onboarding pane, alternate entry, and completion failure
- the account's face (UA-7): the Me menu open, closed, waiting and offline, the Settings head,
  both face frames at every size, and the face picker
- a spark's face (SP-1a, DESIGN.md §2.10): the shipping `SparkFace` in Foundations beside the
  account's face — the nineteen statuses at Chat's row size, both forms on the sizes §2.10's
  surfaces wear, a live `SparkStage`, and the flat star through the face's one adapter
  (`SparkFaceRenderer`), all on fixed seeds (`spark-fixtures.ts`)
- the view frame (One Frame FR-1): the views track in every state the design's plates show — at
  rest, ⌘ held, Godview, History, the Assistant's note, Windows' keys — and the cover rising,
  swapping and lowering over a field with Godview's stage and History's room, on fixture state
- the line (One Frame FR-2; shortened by Cards in Hand, HN-2): `ComposerLineView` in every state the
  Cards in Hand page's line plates draw — at rest, the snapshot under the pointer, in flight and
  waiting with no capture door, Objects out, Godview's New terminal, History's New terminal in the
  project the room shows (HN-7), Windows' keys — and the live line on its real controller
  (`Composer`) over the frame's field, with fixture doors for what Godview lends it and the
  capture. @'s `AtMenuView` and the draft's plates left with the draft (LN-D3)
- the hand (Cards in Hand, HN-1): the shipping `CardsView` and `CardFace` over fixture cards
  (`CardsPreview`) — the six faces in both lights, the fan at rest, a card reached with its ×, the
  hand raised with a card in the keyboard's focus, a card picked up over its scrim, and a card from
  another app still waiting
- the head (One Frame FR-3; its package and the pill's sheet on two shelves since HN-8, PL-D1 and
  PL-D2): `HeadView` in every state the page's head plates draw — the field's name at its top, the
  package after the chevron's rule and, in a plate of its own, its standing dot, the crumbs folded
  in inside a folder, FitPath in a narrow window, renaming in place, the pill's sheet on its Fields
  shelf (the fields explorer, and the sync question in place of its tiles, TS-6) and on its
  Artifacts shelf — holding the Hub's own fixture adapter (`ArtifactPanelPreview`, the plugin's
  design-system door) or, with no Hub bound, the words the shelf waits in — the same sheet under a
  cover, grown from the package circle, the zoom readout's menu (and Windows' keys), the palette
  under the head — and the live head on its real controller (`Head`) in the playground, over a
  fixture document manager and a fixture canvas door (the path, the zoom); the playground hosts no
  plugin, so its shelf says it waits, as a window's does at boot. It replaced the file pill, the
  navigation breadcrumbs and the − % + zoom pill
- the package circle (PL-D2, HN-8): the shipping `PackageCircleView` at its place over each covered
  view's own ground (`PackageCirclePreview`) — over Godview's stage, its Stories keeping one head
  gap from it; over History's band with a source unavailable, its dot on; and in the terminals'
  title bar while they are maximized, folded there as search is — its dot's words the head's own
  (`artifactsDotWords`). The sheet it grows is the pill's, drawn by the head's plates
- the corner (One Frame FR-4): `MeMenuView` open above the line over fixture account and theme
  state, a plate per Theme it holds — Light, Dark, and Auto following the page's own theme — and
  Settings → Appearance (`AppearanceSectionView`) in the shipping dialog, the same setting; the
  Settings specimen's old Appearance replica is gone
- *the edges' plates retired with the edges at HN-8 (PL-D1…PL-D3, 2026-10-30):* the shipping tray
  view on the right edge — the notch whole on Canvas, the sliver over Godview, the notch a sliver
  grew into over History, and the drawer holding the Hub — and its fixture adapter are gone, as the
  clipboard's left notch and drawer went into the hand at HN-1. Artifacts' doors are the head's
  (the pill's package and the covered views' circle), and the Hub's states are the first row above
- search, the frame's Peek (GV-D8, 2026-10-08): the shipping controller (`Peek`) over a fixture
  port answering from the room package's demo (`peek-fixtures.ts`) — the frame's button at rest
  over History before anything is read, and the popup holding words over the shipping History view
  drawn from the same demo, so a pick lands that room on the line; the plate is the window, the
  scrim and the popup drawn in it and the view receding by the product's own rule. The search
  interim's plate (the room's own sheet) retired with it
- the desk's selection bar (DK-11): `SelectionBarView` over fixture selections, a plate per state —
  one object with its kind's own act (drawn by the bar's one path renderer), two ("Send 2 to…"),
  taped ("Lift the tape"), a missing face ("Clock · plugin off"), an act with no glyph and a name
  the set lacks, and the bar grown up, down near the top, with Clean up, and scrolling where it fits
  neither way — its cells and rows read by the product's own model (`barCells`, `menuGroups`,
  `menuEyebrow`); and the status line's notices — a missing face's word, and its place under the
  tools in hand
- the tools in hand (DK-12): the same `SelectionBarView` in its hand's role (`HandPlate`) under the
  head at y 64, over the four specimens' fixture hands — the notebook (‹ › · its four pens as dots in
  the product's inks · undo, "Page 1"), the whiteboard (four markers · the eraser · undo · redo), the
  calendar (‹ › · today · the pen, "September") and the example clock (its own five drawings, its
  time) — the held object's stand-in in the reading fit's band (116 under the top, 100 over the
  foot); its cells read by the product's own model (`handCells`)
- the pegboard's chrome (DK-13): `PegboardView` over a fixture tray — a plain board standing in where
  the desk draws its own drawer behind the line — a plate per state: out (All), a category chosen,
  the filters past the band's width (the end where more lies fading), rising at 80 % of the slide
  (fading in), and a specimen in the keyboard's focus (ringed); the filters placed and filled by
  the product's own model (`placeFilters`, `filterOptions`); and the line's create in hand, faint,
  "Put it down first"
- Copy (HN-3; it replaced Send to…, DK-14): the selection bar's Copy on the shipping
  `SelectionBarView` (its plates read the product's model), and the cards it deals — a note's words
  as a text card, two objects as a picture card — on the shipping `CardFace`. Send to…'s plates (the
  chip in the draft, `ChipFlierView`, `SendFlightPlate`) left with the line's draft
- the peers on the mat (DK-16): `PeersLayerView` and `PeerCursorView` over fixture peers on a stand-in
  for the lit mat (`--vf-mat-ground`, where the desk draws its own) — a peer, and two with one at the
  mat's edge — each arrow placed by the product's own model through a fixture camera (`arrowBoxAt`)
  and each chip's words its face, then its name (`peerLabel`); in the product the same views are
  placed by a reflector, never re-rendered per frame (`PeersPlate`)
- when the desk can't draw (DK-3, DK-4, DK-16): the shipping `DeskUnavailableView` in the Status
  section, a plate per shape — the lost device and any other refusal (each with its Reload), no
  WebGPU and no adapter (no Reload: a reload cannot help), and a board from before the desk — the
  kit's card (the primitives layer, above) on the plain ground, in the product's own words
  (`desk-words.ts`); and the status line's notices (`StatusLineView`): a missing face's word said
  once, its place under the tools in hand, and a degraded desk holding ICE's message and its Reload
- the desk itself (`DeskPreview`, DK-3; named so at DK-17): the field's own layer (`fieldDeskLayer`)
  on a disposable engine with an empty board, under the canvas-ground workbench, the field chrome's
  playground and the view frame — and where a page has no WebGPU, the specimen says so

*Checked against the catalog as it stands, 2026-10-08 (DK-19, the desk landing):* every desk plate
named above is mounted by the catalog's sections; the Status section's desk plates were missing
from this list and are added above.

The pre-desk plates retired with their subjects at DK-17 (the migration's retire table, §6): the
"Living cards" plate (the DOM card's content surfaces and its resting, selected, lifted, accept and
reject projection — `CardShell` and its overlap knobs are gone), the terminal mirror's fixture (the
mirror surface is gone; the deck owns terminals), and the workbench's World grid, Magnet grid and
Overlap feedback controls (the 0.11 ground and the DOM card's glow and rim) — the workbench tunes the
plain ground alone, the appearance document's v4.

Runtime-free adapters replace only data or controllers. For example, Artifact Hub receives a
fixture product client and the head receives a fixture document manager and canvas door; their
DOM, interaction state, accessibility, and CSS are production code. Engine-rendered desk content
(object-kind faces) is represented by deterministic fixtures, while its stable visual identities come
from shared content tokens and the plugin-owned stylesheets. *(Corrected 2026-10-28, the housekeeping
pass: this said "widget content" and "card fixtures"; the widgets and cards retired at DK-17.)*

Godview mounts the shipping SDK views through `MonitorViewHost`, one at a time. `GodviewPreview`
mounts the product `GodviewMonitor` with `godview-model-fixture.ts` supplying the model board; it
replaces the data source, never the view or host markup. `SwarmBodiesPreview` mounts the same
`swarmMonitorView` over SDK fixtures to show the state matrix. The view owns its physics worker,
canvas, accessibility and lifecycle; field-app no longer supplies a physics context or circle CSS.
Each view's sheet is scoped to `.mv-<id>` and reads only its own custom properties and the finite
SDK `MONITOR_SKIN` (DESIGN §8). Host CSS names no view class. The head reads marks and focus keys
from manifests (`godview/GodviewHeadView.tsx`, its sheet beside it; DESIGN §8 "Godview's head —
Stories"). Every host chrome piece has its own `ChromeBoundary` — the head, usage, the
profile notice and the claims in `GodviewMonitor`; System control and the deck in `GodviewOverlay`;
the deck's edge in `GodviewStage`; each pane's frame, the frames and the launchers in `GodviewDeck` —
so a throw names that piece unavailable where it stood without unmounting the monitor or its view,
and each is tried again only for a fact it reads (its `retryKey`), at most once per window: 1 s,
doubling to 30 s while it keeps failing. The head and the
profile notice have no `retryKey`, as they read only the window's own state: they are not tried
again until the monitor remounts (M192). The `godview-monitor`,
`godview-overlay-boundaries` and `godview-deck-frames` tests hold each piece, on a held clock
(`chrome-clock-fixture.ts`). *(Made true 2026-10-07, MV-8b: the deck, System control and the
claims had no boundary before. The window: 2026-10-08, the package's boundary since M179.
Corrected 2026-10-11, GV-D1: this paragraph said "the bar" where it says the head — the views
package's instrument bar left VibeField for the head that day — and still listed Find, whose
sheet left at P2, 2026-10-09. System control's toggle went with the bar to the palette, through
`frame/system-control-door.ts`; its panel and its boundary are where they were.)*
Agent/profile glyphs and shared mark data come from the SDK's `/react` and `/toolkit`.

When a staged view or content token lives in another workspace package, the catalog composes it
through that package's `./design-system` export — a fixture-adapter door beside the shipping code
(`@vibefield/plugin-browser/design-system` is the template; the widgetlab plugin's content-token door
retired with the plugin at DK-8, and the catalog's weather card carries DESIGN.md §2.2's gradient as its
own content). Catalog code imports another workspace package only through
that door, the design-kit foundation, or `@vibefield/contracts` types; any other internal path is
rejected by the ownership test. A future package that owns a whole viewport — a History or
Assistant plugin, an extracted spine library — ships its specimens behind the same entry, so this
catalog stays the single composition root without ever owning foreign markup. (Added 2026-08-28.)

## Rules for new UI

- Add or change visual constants in `DESIGN.md`, then project them into `tokens.css`.
- Main-process code can't read CSS. A colour Electron needs before the page paints (a window's
  `backgroundColor`) is a named projection of its token: the literal stands beside a comment naming
  the token and DESIGN.md's value, DESIGN.md's token row names the file that projects it, and a test
  holds the two equal. (Added 2026-10-29, FG-D25: `--vf-field-ground` in
  `electron-shell/src/main/windows.ts`, held by `wearing-the-mat.test.tsx`.)
- Reuse a shell primitive before creating domain-specific control anatomy.
- An icon is a `FieldGlyph` from the kit's `/glyphs` leaf (DESIGN.md §13; plugins reach it through
  `@vibefield/plugin-sdk/ui`). An inline `<svg>` that is an icon fails `glyphs.test.tsx`; the
  allowlist is geometry that is not an icon, such as the coin's marks and the catalog's fixture
  stills (the edge tray's notch and drawer were, until HN-8 retired them).
- Put static styling in CSS. Inline styles are reserved for runtime geometry, progress, user data,
  or CSS custom-property projection.
- Give domain selectors a namespace and keep their CSS beside the component. Do not add another
  monolithic app stylesheet.
- For runtime-bound UI, export a controller-free `View`, `Frame`, or `Stage`; keep subscriptions,
  services, and engine operations in the controller.
- Add the real view to the catalog with a deterministic adapter. Never copy its markup or CSS into
  a `vf-ds-*` replica.
- A package that owns product views or shared content tokens ships a `./design-system` entry
  exporting its fixture adapters and tokens; the catalog composes that entry and never reaches
  package internals.
- Show meaningful states, including empty, loading, unavailable, disabled, and failure states.
- Verify light/dark, keyboard focus, reduced motion, and narrow layout before considering a
  component cataloged.
- **Import kit leaves from boot-reachable code, never the barrel.** The kit's GL card once pulled
  three and the 3D world into the splash through one class-name import (the 2026-08-10 incident),
  and its DOM card reached `@vibecook/ice` core (→ loro). DK-17 deleted the kit's card dressing —
  the kit imports no ICE at all now — but the rule stands as the cheap habit that keeps it so:
  boot-reachable code imports the deep entries (`@vibefield/design-kit/primitives`, `/glyphs`)
  and leaves the rest of the kit to lazy chunks. The kit declares `"sideEffects": ["*.css"]` so
  the barrel is survivable — every JS module in it must stay pure for that to hold, and a module
  that needs real import-time side effects belongs outside the kit. `pnpm bundle:assert` (inside
  `pnpm verify`) is the tripwire; it caught this four days late once because it only ran in
  `smoke:canvas` (2026-08-10).

## Working loop

Run `pnpm dev:design` for the canonical single-page catalog inside VibeField Studio. Studio and the
real product share one supervised development host and Vite server, while remaining separate
sandboxed windows with separate preloads and sessions. A second invocation attaches to the active
runner and opens or focuses Studio; it does not start another stack. Studio receives only the
bounded live-appearance preview capability and never receives product preload, user, daemon,
plugin, tray, or diagnostic capabilities. Use `pnpm dev:design:web` when a catalog-only browser HMR
loop with no live-product authority is sufficient.

Use `pnpm --filter @vibefield/field-app test` for DOM and ownership guards, and
`pnpm --filter @vibefield/electron-shell build:design` for an ignored standalone browser-catalog
bundle. That build lands under `.vibefield/studio/catalog-renderer/`; it never replaces the
production renderer output. The normal renderer build has only `index.html` as a document entry
and runs a leakage check that fails if a catalog or Studio document/marker reaches
`dist/renderer`. Desktop packaging then applies its existing exact stage allowlist as a second
boundary.

The ownership test intentionally rejects old catalog-only replicas and production selector
definitions in catalog CSS. That makes fidelity a maintained boundary rather than a one-time
cleanup.

## Test environments

Renderer-side suites run under happy-dom: field-app's and the browser plugin's (vitest's
`happy-dom` environment), and the plugin playground's, which installs its own happy-dom window.
Every one of them loads the repo's shared shim, `@vibefield/test-env` (`tooling/test-env`) —
through `setupFiles` (`@vibefield/test-env/happy-dom/setup`), or, in the playground, on the window
it creates before binding its classes. The reason: happy-dom 20 holds a `MutationObserver`'s
report callback only in a `WeakRef`, so a garbage collection between `observe()` and the mutation
deafens the observer for good — no record, no error. A loaded `pnpm test` collects often enough to
land there (DK-3: godview-monitor's no-GPU row failed four whole runs in six, never alone). The shim
makes `observe()` hold its listener strongly, as a browser does. Its forced-GC witness runs once, in
`tooling/test-env`; each suite carries a one-line wiring row. A new happy-dom suite loads the same
setup file. Drop the shim when happy-dom holds the callback itself.

The package owns every environment shim (DK-7): the Node-26 `localStorage` shim lives beside it
(`@vibefield/test-env/local-storage`, `holdLocalStorage()`), called by field-app's test setup and the
playground's boot. Node 26 defines an own `localStorage` that evaluates to `undefined` without
`--localstorage-file`, so happy-dom's real Storage never lands over it; the shim puts an in-memory
Storage there, deciding from the property's descriptor so it never reads Node's (reading it prints
an ExperimentalWarning). Its witness runs in `tooling/test-env` too.
