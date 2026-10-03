# UI system architecture

`DESIGN.md` remains the visual authority. This document defines where that direction lives in
code and how the design catalog stays identical to the product.

## The four layers

1. **Tokens — `packages/design-kit/src/tokens.css`**
   Owns palette, semantic text and chrome colors, radii, materials, shadows, and motion curves.
   Component styles consume tokens; they do not introduce a parallel palette or eyeballed shadow.
2. **Primitives — `packages/design-kit/src/primitives.tsx` and `primitives.css`**
   Owns reusable control and state anatomy: buttons, icon buttons, fields, switches, segmented
   controls, pills, empty/unavailable states, notices, placeholders, and status dots.
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

The catalog currently mounts these shipping views directly:

- Artifact Hub and all empty/loading/populated/unavailable states
- Godview stage, monitor registry, tuning panel, unavailable terminal deck, and the complete
  swarm-circle state matrix
- FilePill, navigation breadcrumbs, ZoomPill, WidgetTray frame/tool switcher
- command palette, settings dialog, side-panel frame, and loading veil
- shared controls/states and every onboarding pane, alternate entry, and completion failure
- the account's face (UA-7): the Me menu open, closed, waiting and offline, the Settings head,
  both face frames at every size, and the face picker
- the view frame (One Frame FR-1): the views track in every state the design's plates show — at
  rest, ⌘ held, Godview, History, the Assistant's note, Windows' keys — and the cover rising,
  swapping and lowering over a field with Godview's stage and History's room, on fixture state

Runtime-free adapters replace only data or controllers. For example, Artifact Hub receives a
fixture product client and FilePill receives a fixture document manager; their DOM, interaction
state, accessibility, and CSS are production code. Engine-rendered widget content is represented
by deterministic card fixtures, while its stable visual identities come from shared content
tokens and the plugin-owned stylesheets.

Godview's swarm follows the same boundary at a smaller scale. `AgentSwarm.tsx` owns physics,
placement, drag gestures, and field-level creation; `AgentBubble.tsx` owns the exact circle state
projection, DOM, accessibility, identity layers, and arrival motion. Field composition lives in
`swarm.css`, while circle styling lives in `agent-bubble.css`. The catalog mounts that production
circle without starting the physics engine and inventories every valid source/status combination,
access and pane modifier, provider glyph, and context boundary.

When a staged view or content token lives in another workspace package, the catalog composes it
through that package's `./design-system` export — a fixture-adapter door beside the shipping code
(`@vibefield/plugin-browser/design-system` is the template; `@vibefield/plugin-widgetlab/design-system`
carries content tokens the same way). Catalog code imports another workspace package only through
that door, the design-kit foundation, or `@vibefield/contracts` types; any other internal path is
rejected by the ownership test. A future package that owns a whole viewport — a History or
Assistant plugin, an extracted spine library — ships its specimens behind the same entry, so this
catalog stays the single composition root without ever owning foreign markup. (Added 2026-08-28.)

## Rules for new UI

- Add or change visual constants in `DESIGN.md`, then project them into `tokens.css`.
- Reuse a shell primitive before creating domain-specific control anatomy.
- An icon is a `FieldGlyph` from the kit's `/glyphs` leaf (DESIGN.md §13; plugins reach it through
  `@vibefield/plugin-sdk/ui`). An inline `<svg>` that is an icon fails `glyphs.test.tsx`; the
  allowlist is geometry that is not an icon, such as the edge tray's notch and drawer.
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
- **Import kit leaves from boot-reachable code, never the barrel.** The kit's GL-card surface
  (`GlLiftGroup` → `@vibecook/ice/r3f` → three) lives behind the dedicated `./gl` entry since
  2026-08-28 — the root barrel is GL-free by construction, so one stray class-name import can no
  longer pull the 3D world into the splash (the 2026-08-10 incident's class). The rule still
  stands at a lower stake: the barrel's card chrome reaches `@vibecook/ice` core (→ loro), so
  boot-reachable code imports the deep entries (`@vibefield/design-kit/primitives`, `/visuals`)
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
