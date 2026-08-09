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

## Rules for new UI

- Add or change visual constants in `DESIGN.md`, then project them into `tokens.css`.
- Reuse a shell primitive before creating domain-specific control anatomy.
- Put static styling in CSS. Inline styles are reserved for runtime geometry, progress, user data,
  or CSS custom-property projection.
- Give domain selectors a namespace and keep their CSS beside the component. Do not add another
  monolithic app stylesheet.
- For runtime-bound UI, export a controller-free `View`, `Frame`, or `Stage`; keep subscriptions,
  services, and engine operations in the controller.
- Add the real view to the catalog with a deterministic adapter. Never copy its markup or CSS into
  a `vf-ds-*` replica.
- Show meaningful states, including empty, loading, unavailable, disabled, and failure states.
- Verify light/dark, keyboard focus, reduced motion, and narrow layout before considering a
  component cataloged.

## Working loop

Run `pnpm dev:design` for the canonical single-page catalog in its dedicated Electron UI Bench.
The bench uses the production window/security factory while deliberately omitting the product
preload, users, daemons, plugins, tray, and diagnostics. Its generated shell and Electron user
data stay under `.vibefield/ui-bench/`, so it can run beside the full application without touching
product state. Use `pnpm dev:design:web` when a browser-only HMR loop is sufficient.

Use `pnpm --filter @vibefield/field-app test` for DOM and ownership guards, and
`pnpm --filter @vibefield/electron-shell build:design` for an ignored standalone bench bundle.
That design build also lands under `.vibefield/ui-bench/`; it never replaces the production
renderer output. The normal renderer build has only `index.html` as an entry and runs a leakage
check that fails if a bench document or marker reaches `dist/renderer`. Desktop packaging then
applies its existing exact stage allowlist as a second boundary.

The ownership test intentionally rejects old catalog-only replicas and production selector
definitions in catalog CSS. That makes fidelity a maintained boundary rather than a one-time
cleanup.
