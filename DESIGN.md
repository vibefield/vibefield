# DESIGN.md — VibeField Art Direction

**Authority:** this document governs how every VibeField surface looks, moves, and speaks —
shell HUD, canvas widgets, Godview, panels, settings, empty states. Structure and mechanics
live in the design corpus (`draft/design-03*`); *look and feel* live here. When they seem to
conflict, mechanics defer to design-03, aesthetics defer to this file.
**Source DNA:** distilled from `infinite-canvas-engine/apps/widgetlab` (the ICE widget lab —
CardShell chrome, the morphing widget tray, the iOS card set), which is itself the refined
v1-playground look. Exact values below are lifted from that code, not invented.
**The bar:** Apple-keynote / Figma-release quality. The review question for any new UI is
literal: *would this frame survive in an Apple Weather-widget screenshot or a Figma launch
post?* If it reads as "developer tool that got some Tailwind," it does not ship.

---

## 1. The Direction

**iOS widgets grown into a control room.** VibeField's field is a calm, dotted, neutral
ground on which *live content cards* sit — terminals, agents, repos, notes — each carrying
its own world the way an iOS home-screen widget does. Chrome is physical material
(translucency, backdrop blur, hairlines, soft ambient shadow). Motion is physics (one
element morphing, springs, grab-point invariance). Color belongs to **content and honest
state only** — the chrome itself is nearly colorless, so the drama on screen is always
*what the agents are doing*, never the UI.

Three surface families, one physics:

| Family | Ground rules |
|---|---|
| **The field** (canvas + widgets) | Neutral ground, dual-theme. Cards are content-first and may carry their own committed surface (dark card, sky gradient, sticky yellow) in either app theme — exactly like iOS widgets on any wallpaper. |
| **The chrome** (HUD islands, tray, panels, palette) | Floating translucent materials over the field. Dual-theme, near-colorless, hairline-bordered, blurred. |
| **The control room** (Godview, diagnostics) | May commit to dark — it is a stage, not a document. Its palette still derives from §2 (no bespoke greens). |

### 1.1 Godview visual source

Godview is the deliberate control-room exception to the iOS-widget chrome around it. Its
visual source of truth is `p008/chopsticks/apps/godview`: a flat 40px instrument bar, compact
monospace controls, a gridded agent stage, stark monochrome status bodies, a parchment terminal
deck in light mode, a graphite terminal deck in dark mode, and the reference scanline/vignette
treatment. VibeField keeps its own host mechanics, honest mock label, and renderer-native terminal
alpha, but does not reinterpret that reference through rounded cards, colorful agent fills, or
floating pills. The scoped `--vf-godview-*` tokens are the exact reference palette. VibeField
composites those status-body colors at 72% by default so they remain legible glass over the field;
the temporary system-control panel exposes that alpha for live tuning.

**The two signatures** (spend boldness here, keep everything else quiet):
1. **The living card** — CardShell physics: lift-on-grab, hot-point glow and rim on overlap,
   the sole-selection ring. A VibeField card feels *held*, not dragged.
2. **The morphing island** — HUD chrome is one element that morphs between roles (pill ⇄
   sheet), never two elements crossfading.

---

## 2. Color

### 2.1 Ground (the canvas)

| Token | Light | Dark |
|---|---|---|
| `--vf-canvas-bg` | `#FAFAFA` | `#171717` |
| `--vf-canvas-dot` (GL ground) | `#BFC4CC` | `#595E66` |
| `--vf-canvas-dot` (CSS fallback) | `rgba(0,0,0,0.16)` | `rgba(255,255,255,0.08)` |

### 2.2 Surfaces

| Token | Value | Use |
|---|---|---|
| `--vf-card` | `#1C1C1E` | default card surface (iOS dark-elevated) — both themes |
| `--vf-card-deep` | `#000000` | data-dense cards (stocks-class) |
| content surfaces | per-widget | committed gradients/colors are content, not theme (e.g. weather `linear-gradient(135deg, #3A86FF 0%, #1D4ED8 55%, #0B2AB5 100%)`; note sticky `#F6E7A9`) |
| `--vf-fill` | light `#F2F2F7` · dark `#2C2C2E` | inset fills: segmented tracks, chip resting |
| `--vf-fill-hover` | light `#E5E5EA` · dark `#2C2C2E` (opaque) | hover step of the above |
| chrome material | light `white` · dark `#1C1C1E`, at the §5 opacity/blur tiers | islands, sheets, overlays |
| solid chrome | light `white` · dark `neutral-800` | small floating round buttons, zoom pill |

### 2.3 Hairlines & lines

Borders are hairlines, always: `1px` at **`black/5`** (light) / **`white/10`** (dark);
inset ring form `0 0 0 1px rgba(0,0,0,0.05)` when it must ride a shadow. Structural
strokes inside content (clock face, dividers) use the text opacity ramp, not grays.
Heavier weights exist only as *meaning*: `1.5px` = selection ring and rim width.

### 2.4 Text — the opacity ramp

Text color is **surface color + opacity**, never fixed grays (so hierarchy survives on any
card surface). On dark surfaces: primary `white`, secondary `white/70–80`, eyebrow
`white/60`, tertiary/captions `white/40`. On light chrome: `black`, `black/70`, `black/50`,
captions `neutral-500`. Pure-opaque text is reserved for primary content.

### 2.5 State & system color (the only color chrome may use)

iOS system palette, one meaning each — never decorative:

| Token | Value | Meaning |
|---|---|---|
| `--vf-green` | `#30D158` | working / healthy / positive delta |
| `--vf-orange` | `#FF9F0A` | **needs attention** — approvals, the Godview ring-1 color |
| `--vf-red` | `#FF453A` | failed / destructive / negative delta |
| `--vf-yellow` | `#FFD60A` | content accent (sun, star) — not a status |
| `--vf-cyan` | `#5AC8FA` | info / links / live-data accent |
| `--vf-select` | `#4A90D9` | selection ring **only** — interaction, never status |

Agent-state mapping (SessionSummary → badge/monitor): `working` green · `needs-approval`
orange · `waiting`/`idle` muted (text ramp, no hue) · `done` muted with green tick ·
`failed` red · `unknown` muted italic — honesty over rainbow.

### 2.6 Organizational accents (containers, comments, tags)

Curated set, assigned per object, used as *tint*: `#6366F1 · #EC4899 · #22C55E · #F59E0B ·
#06B6D4 · #8B5CF6 · #EF4444 · #3B82F6`. Tint recipe: body fill at 12% (`{hex}1F`),
hairline at ~35%, label at full. These group and label; they never signal state.

### 2.7 Godview instrument palette

These values are scoped to Godview and reproduce the Chopsticks reference rather than extending
the general chrome palette.

| Role | Light | Dark |
|---|---|---|
| monitor ground | `#F7F7F7` | `#0A0A0A` |
| panel | `#FFFFFF` | `#111111` |
| panel border | `#E0E0E0` | `#333333` |
| text main / muted / faint | `#111111 / #888888 / #B8B8B8` | `#FFFFFF / #777777 / #555555` |
| idle body / text | `#E5E5E5 / #666666` | `#2A2A2A / #AAAAAA` |
| working body / text | `#222222 / #FFFFFF` | `#EEEEEE / #111111` |
| terminal ground / divider | `#ECE8DC / #D2CEC3` | `#282C34 / #414650` |

---

## 3. Typography

**Stack:** `-apple-system, system-ui, sans-serif` (SF on macOS) for everything;
`ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace` for data/paths/ids. Terminal
text belongs to Ghosttea's renderer, not CSS.

| Role | Spec | Where |
|---|---|---|
| **Eyebrow** | 10–11px · medium · uppercase · `tracking-wider` (0.05–0.08em) · 60–80% opacity | card headers ("CLOCK · WED 16"), section labels |
| **Label** | 11–13px · medium | buttons, chips, tray tile names, badges |
| **Body** | 13–14px · regular · 1.45 line height | notes, prose, settings |
| **Title** | 12px · semibold | card row titles (ticker symbol class) |
| **Data numeral** | 28–34px · **light** · `tabular-nums` · `leading-none` | the hero number (temperature class) |
| **Data small** | 12px · medium · `tabular-nums` | prices, times, counts |
| **Caption** | 9–10px · 40% opacity | sub-labels ("NASDAQ" class) |

Laws: every number that can change is `tabular-nums`. Weight makes hierarchy *down* (big =
light, small = medium) — the iOS inversion; never bold a hero numeral. Sentence case
everywhere except eyebrows.

---

## 4. Geometry

| Token | Value | Notes |
|---|---|---|
| `--vf-radius-card` | `22px` | THE card radius (CardShell `CARD_RADIUS`); scaled minis use `max(6, 22 × scale)` — silhouette is preserved, never re-styled |
| `--vf-radius-island` | `32px` | the closed HUD pill |
| `--vf-radius-sheet` | `40px` | sheet top corners (open island) |
| `--vf-radius-control` | `6–10px` | inline controls, change badges (`rounded` ≈ 4–6 for tiny) |
| pills/buttons | fully round (`999px`) | chips, round icon buttons, pull bar |

**The iOS size grid** (cards snap to it; the tray previews in it): small `155×155`,
medium `329×155`, large `329×345`; canvas gap `19px` → pitch `174`. Tray grid: `132px`
cells, `18px` gap, spans by size class. Card padding: `16px` (`p-4`); dense cards
`16px × 12px`. Round icon buttons: `40px` (`h-10 w-10`); island height `64px`.

---

## 5. Elevation & materials

Shadows are **ambient** — large blur, low alpha, paired with a hairline ring. Never small,
dark, or hard. The exact recipes (do not eyeball new ones):

| Level | Recipe |
|---|---|
| Card, resting | `0 20px 40px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05)` |
| Card, lifted | `0 30px 60px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.06)` |
| Island / floating chrome | `0 8px 30px rgba(0,0,0,0.08)` · dark `rgba(0,0,0,0.4)` |
| Sheet (rises from bottom) | `0 -20px 40px rgba(0,0,0,0.08)` · dark `0.4` |
| Side panel (enters from right) | `-20px 0 40px rgba(0,0,0,0.08)` · dark `0.4` |
| Drag proxy (above everything) | `drop-shadow(0 24px 48px rgba(0,0,0,0.35))` |
| Tray tile | `drop-shadow(0 10px 18px rgba(0,0,0,0.16))` |

**Material tiers** (translucency + backdrop blur — chrome is glass, cards are opaque):

| Tier | Recipe | Use |
|---|---|---|
| Island | surface `/80` + `backdrop-blur-xl` (hover `/90`) | closed pill, toolbars |
| Sheet | surface `/90` + `backdrop-blur-3xl` | open tray, large panels |
| Overlay chip | surface `/90–95` + `backdrop-blur-xl` | put-back affordance, HUD toasts |
| Backdrop dim | `black/10` light · `black/40` dark | behind open sheets; canvas recedes to `scale(0.98)` |

---

## 6. Motion

Three easings, by name — new curves require a reason recorded here:

| Name | Curve | Duration | Use |
|---|---|---|---|
| `--vf-ease-island` | `cubic-bezier(0.25, 1, 0.3, 1)` | 600ms morph · 240ms glide · 560ms flow-in | the island morph, proxy glides, segmented thumb (300ms), anything that *travels* |
| `--vf-ease-lift` | `cubic-bezier(0.2, 0.9, 0.3, 1.2)` | 180ms | the card lift transform (slight overshoot = "held") |
| `--vf-ease-pop` | `cubic-bezier(0.34, 1.45, 0.64, 1)` | 280ms | spring pops: tile return, spawn pop-in (1.3 variant) |
| plain `ease` / `ease-out` | — | 120–240ms | opacity, color, shadow (shadow 220ms, ring 120ms) |

Choreography constants: staggered entrances `26ms/item` (cap 400ms); content reveal delay
`140–200ms` behind its container; lift/hold response poll ≤ 60ms ("snappy — the lift must
read as an immediate response to the hold").

**Motion laws:**
- **M1 — One element morphs.** A role change (pill→sheet, plus→close, proxy→widget) is one
  element transitioning; never unmount-and-replace, never two things crossfading.
- **M2 — The grab point is the invariant.** Whatever is under the finger at press stays
  under it through pickup, morph, and drop (`transform-origin` at the grab point; scale
  about it). Nothing ever snaps or re-anchors.
- **M3 — CSS transitions, not WAAPI**, for chrome: a stalled compositor leaves WAAPI
  pending forever; a transition worst-case snaps to its end state.
- **M4 — Depart ≠ vanish.** Things put themselves back (glide home, spring pop) or shrink
  along their travel; only cancelled ghosts fade.
- **M5 — The stage recedes.** When a sheet opens, the canvas eases to `scale(0.98)` and
  discretionary per-frame work pauses (stage hold) — focus is physical.
  *Correction, 2026-08-04:* "discretionary per-frame work" is narrower than it reads. A
  stage hold freezes GL island repaints and parks the compositor's demand loop; the world
  keeps stepping, which is what keeps undo and collab landing visibly behind a partial
  overlay. Chrome that COVERS the window instead takes `useFrameFreeze` (ice 0.3.0), which
  parks the engine outright. Sheets recede → hold. Godview covers → freeze.
- **M6 — Respect `prefers-reduced-motion`**: morphs become fades, springs become ease-out,
  durations halve. Non-negotiable quality floor.

---

## 7. Interactive states (the living card)

| State | Treatment |
|---|---|
| **Lift** (grab or armed hold) | `scale(liftScale)` — 1.05, read from the engine's `ChromeSettings.liftScale` (one source; selection chrome uses the same number) · opacity `0.75` for the whole hold+drag · lifted shadow. GL content fades in lockstep. |
| **Selection, sole** | `1.5px` inside ring, `--vf-select`, drawn *inside* the scaled base so the lift transform carries it; 120ms fade. |
| **Selection, multi** | no per-card ring — the engine's union box wraps the set. |
| **Overlap, accept** (`t` tier) | hot-point glow + rim, strong: inset glow offset `±8px` toward the hot point, rim radial anchored at it, masked to the border ring. |
| **Overlap, reject** (`c` tier) | same anatomy, weak alphas. |
| **Hover / active** (tiles, buttons) | `scale(1.03)` hover · `scale(0.95)` active · fills step `black/5 → black/10` (dark `white/10 → white/20`) · `cursor-grab/-grabbing`. |
| **Keyboard focus** | visible ring, always (quality floor); Esc = close/cancel, consistently. |

Glow/rim knobs are live CSS vars (settings-panel adjustable, defaults in code):
`--ic-glow-size-t/-c: 60px` · `--ic-glow-alpha-t/-c: 0.25` · `--ic-glow-color: 128,128,128`
(dark theme: white) · `--ic-rim-width: 1.5px` · `--ic-rim-radius: 600px` ·
`--ic-rim-alpha-t: 0.85` / `-c: 0.55`.

---

## 8. Component canon

- **Card anatomy** (CardShell, landing in `@vibefield/shell-ui` — 03·A D14): rounded-22
  clip → content → glow layer → rim layer → ring layer. Chrome layers are
  `pointer-events: none` and ride the base transform. Header = eyebrow row (label left,
  meta right). Every widget ships a **compact face** for the zoom readability floor
  (03·A D15): title + badge, no micro-text.
- **HUD island**: one morphing element (§6 M1), island material, centered-bottom;
  `64px` closed; opens to a sheet with pull bar (48×6 rounded-full, `black/20`),
  morphing ⊕→✕ (135° rotation), edge-fade scroll masks, no visible scrollbars.
- **Artifact Hub side panel** (AH-3/4; amended 2026-08-03): a `vibefield.browser`
  contribution inside the spine-owned `hud.side-panel` stage, separate from the bottom island.
  Its persistent 40px round toggle is the outermost control in the top-right chrome cluster:
  zoom pill · theme · Artifacts, with 8px gaps, anchored `top-4 right-4`. It uses the floating
  round-button recipe and the inverted active state; the same button toggles open/closed and
  carries the matching tooltip/accessible name.
  The panel is fixed `top-16 right-0 bottom-0 w-[min(92vw,26rem)]`, with
  `rounded-l-[2.5rem]`, sheet material, a left-cast side-panel shadow from §5, and internal
  edge-faded scrolling. The same physical panel translates from the right on the 600ms island
  curve; it is never a crossfade. It overlays without resizing the infinite canvas and is
  deliberately non-modal: no backdrop, canvas recede, stage hold, or focus trap. The spine
  still arbitrates one expanded focus surface across the side panel, docs, tray, settings, and
  Godview; Escape closes, focus returns to the toggle, plugin disable/hot-reload closes, and
  M6 applies.
  Header = “Artifacts” + quiet count + one round Add action. The catalog is a single-column
  list; each row uses a left `w-28 aspect-[16/10] rounded-[10px]` clipped preview, then title at
  12px medium, one 11px `/50` fact line (`origin · proxy|folder`), and an honest status dot +
  word. Color comes only from §2.5: active green, source-unavailable orange, error red, and
  starting/removing/offline/unknown muted. Offline/unknown keeps the cached image at `/55`,
  never turns it into a skeleton.
  Openable row click opens externally; overflow holds copy URL and, for the local owner only,
  refresh preview and remove. A first-publish failure has no guessed URL, so open/copy are
  disabled. Add changes the panel content in place to a two-choice Proxy/Folder step: protocol
  uses the segmented control, port uses `tabular-nums`, and Folder is a single native-picker
  row — no renderer path textbox. Starting is immediate but visually quiet; success returns to
  the catalog, while errors stay inline with a plain corrective sentence. The confirm step
  carries one `/50` factual line: “Opens on devices connected to this tailnet with Tailscale”;
  it is not a warning banner or a green reachability promise.
- **Segmented control**: full-round track in `--vf-fill`, sliding solid thumb
  (white / `#2C2C2E`, hairline + `shadow-sm`), 300ms island ease; labels 13px medium,
  active full-opacity, rest `/50`.
- **Chips / category pills**: full-round, `--vf-fill` resting; active = **inverted solid**
  (black-on-light / white-on-dark) with `shadow-md`; `active:scale-95`.
- **Status badge** (`StateBadge`, 03·A C-7): dot or pill in §2.5 color + label; always
  carries tier + `ObservationLevel` provenance; wait times in `tabular-nums`. Change
  badges (±%) are solid green/red with white text, `rounded px-1`.
- **Floating round buttons**: 40px, solid chrome surface, `shadow-lg`, icon at
  `neutral-500` → full on hover; persistent active/toggled state is inverted solid.
- **The file pill** (B4): top-center chrome, `top-4`, **40px tall** (the top-chrome
  control height — 64px stays the bottom island's) — ⊕ new doc · the doc name (13px
  medium, click-to-rename in place: transparent input, Enter/blur commits, Esc reverts)
  · a chevron. It morphs (M1, island ease 600ms) into the **docs explorer**: a
  top-attached sheet `w-[min(56%,34rem)] × min(46vh,420px)`, `rounded-b-[2.5rem]`,
  sheet material, the §5 sheet shadow **sign-flipped** (`0 20px 40px …` — a top sheet
  throws its shadow down); chevron rotates 180°; backdrop dim + recede + stage hold,
  one sheet at a time with the tray. Doc tiles: `aspect-[16/10] rounded-[10px]` faces
  painted as a **mini empty field** (canvas-bg + the §2.1 CSS-fallback dots — the
  ground motif as the doc's face until real thumbnails); name 12px medium, relative
  time caption in `tabular-nums`; the CURRENT doc wears the 1.5px inside `--vf-select`
  ring (it is the selection); hover 1.03 / active 0.95. **The sync dot (C6-4):** a 6px
  dot after the pill's doc name for STANDING sync states only — pending / peer-offline
  (muted grey `rgba(128,128,128,0.45)`) · peer-declined / epoch-stale (`--vf-orange`);
  in-step and transient syncing render NOTHING here — the signature chrome never
  flickers with routine traffic. The title carries the words, numbers, and the
  last-exchange time. Explorer tiles append the honest sync word to their time caption
  ("· syncing", "· waiting on 3", "· peer offline") only when there is one.
- **The loading veil** (B4): a full-window chrome frost (`white/60 + backdrop-blur-xl`,
  dark `#171717/60`) while a doc loads — centered thin bar (`3px × 220px`, colorless
  fill: loading is not a §2.5 state) over an 11px/50% lowercase stage label
  ("preparing previews"). **Late-veil rule:** invisible until 120ms of loading elapse
  (a cached switch never flashes); 240ms fade-out. Loading is modal; the stage holds.
- **The boot splash** (ESR slice 4; design-03 §4.3 v0.3): the app's first face, painted
  before anything heavy loads — the canvas ground itself (`--vf-canvas-bg` + the §2.1
  CSS-fallback dots at rest; the field waking, not a logo card), the wordmark
  "VibeField" centered (13px medium, `/50` — quiet), the veil's thin bar
  (`3px × 220px`, colorless) beneath it over an 11px/50% lowercase stage label. Stages
  are REAL, never theater: "waking the daemon" → the DocManager's own strings
  ("opening doc" … "preparing previews") → "settling". Unlike the veil the splash is
  NOT late (there is nothing behind it yet) and NOT frost (nothing to frost).
  Unavailable is honest voice (§9): the stage line becomes the plain reason and a
  ghost "Retry" appears — no apology, no spinner theater.
- **The reveal** (boot-exclusive motion): the canvas composes and stabilizes BEHIND
  the splash (the frame-stability gate — never reveal mid-hitch), then the splash
  fades 240ms plain `ease` while the canvas settles `scale(0.99) → 1` over 560ms
  `--vf-ease-island` (a breath, not a zoom). Fires once, fully warm. Reduced motion:
  fade only. Doc SWITCHES stay the loading veil's business — the splash exists only
  at boot.
- **Empty / degraded states**: a state is rendered, never blank space — dashed-hairline
  pill for drop affordances ("Release here to put it back"), progress with numbers
  ("index rebuilding · 42%"), placeholder faces for missing plugins (A6/A8). Empty
  screens invite the next action.
- **Doc sync state** (C6-4; Settings Mesh section): one row per doc sync has FACTS
  for — no facts, no row (with no peers, quiet IS the honesty; never a vacuous
  "synced"). Vocabulary: `in step` · `syncing` (green — healthy work) · `pending`
  ("waiting on N" in `tabular-nums`) · `peer offline` (muted-grey fact, like a
  device's offline — never an error) · `declined` · `epoch stale` (orange —
  needs attention; nothing failed, so never red). The muted detail line carries
  provenance: the verbatim decline reason, WHO is offline by device name, and
  "last exchange HH:MM:SS" — the clock, not the state word, is the freshness claim,
  because offline detection can lag by minutes (F-C6-22) and the row must never
  imply promptness. A doc a peer syncs that this device does not hold reads
  "a peer's doc · not held here" — a fact, not an alarm.
- **The plugin source badge** (P7; spec §20.5 / §5.3): every plugin row labels its
  source and rung as a FACT in the muted text ramp (`labelCls`), never a warning — no
  hue (§2.5: color is for honest state, and a source is not a state of concern). A
  `rounded px-1` chip with no fill, so it reads as a label, not a status. Words:
  bundled → "built-in", dev-linked → "dev", registry → "registry · reviewed" with the
  publisher appended ("reviewed names who reviewed" — the registry publisher is the
  reviewer), sideload → "sideload" (honest, not alarmed — the word IS the caution).
- **The updates flow** (P7; spec §5.3.1): a section-top "updates ▸" disclosure that
  NEVER checks on its own — opening it reveals a "check for updates" action and nothing
  fetches on mount, on expand, or on a timer (no push feed, no polling; a fetch is a
  deliberate act). Results render honestly (the empty/degraded rule): a compatible
  update reads "id · installedVersion → latest.version" (`tabular-nums`) with an
  "install" action; an incompatible one says WHY from the release's own engine range
  ("needs app X · contracts Y"), no action; a vanished entry lists "dropped from
  registry"; an all-clear reads "everything current". The checked time is stated
  ("checked HH:MM:SS"), never implied fresh.
- **The destructive uninstall affordance** (P7; spec §16.5): registry/sideload rows
  carry a "···" overflow revealing two acts — "uninstall" (muted, keeps data) and
  "remove data too" (the destructive variant: `--vf-red` text, visually distinct BEFORE
  any confirm, §2.5 red = destructive). Each is a two-step confirm — a narrow-panel
  click is never irreversible. The keep-data confirm says "keeps its data"; the
  destructive confirm names the object and states exactly what dies ("deletes its
  settings and stored data — canvas cards it made are kept"). Red is text-only, never a
  filled alarm — honesty over dread.
- **The settings undo affordance** (P7 D29′; spec §16.6): compact "undo · redo" text
  buttons at the head of a plugin's settings form, in the muted ramp, `disabled:opacity-40`
  when there is nothing to reach. A right-aligned caption tells the coverage truth at all
  times — "covers user-scope keys only" when live, "no user-scope keys" when the plugin
  declares none (device/secret keys are never on the stack), and the honest outcome when
  an action no-ops ("nothing to undo", "history horizon reached"). No optimistic echo — an
  applied undo re-gets every row from the daemon.

---

## 9. Voice

Sentence case (eyebrows uppercase). Buttons say what they do ("Spawn agent", not
"Submit"); a name survives its flow (Publish → "Published"). States tell the truth with
numbers and provenance — "syncing history…", "external terminal — state only",
"needs approval · 4m" — and never overstate what we know (EL5). Errors say what happened
and what to do next; they don't apologize and they're never vague. No filler, no lorem:
demo content is real-shaped (AAPL, San Francisco, 64°).

---

## 10. Implementation & governance

- **Tokens live in `@vibefield/shell-ui`** (design kit, 03·A D14) as CSS vars under
  `--vf-*`, exposed to Tailwind v4 via `@theme`. Upstream vars bridge onto ours
  (`--ic-*` chrome knobs, `--mille-*` tree vars — design-00 §3.4); widgets consume
  tokens, never hex literals (exception: a widget's own committed content surface).
- **Dark mode**: `.dark` class + `data-theme="dark"` stamped together (03·A §6); cards
  keep their committed surfaces across themes.
- **Converged (Track D + cleanup, 2026-07-21):** the note widget wears CardShell (D1);
  the ad-hoc Field toolbar died with the island (D2); the System/health page and the app
  bar are REMOVED outright. **Placement laws:** the window IS the field — chrome floats
  over the canvas, there is no app bar; dev-facing diagnostics render as *sections inside
  the Settings panel* (`SystemSection` is the template) — never as standalone pages.
  Top-row slots (all inside the 52px drag strip, all `no-drag`): breadcrumbs left
  (`left-24`, clearing the traffic lights) · **the file pill center** · the right chrome
  cluster anchored `top-4 right-4` (zoom pill · theme FAB · Artifact FAB outermost).
- **Review ritual**: UI PRs cite the sections they follow, include a screenshot in both
  themes, and answer the §0 bar question. Deviations from a token/recipe/easing are a
  change *to this file first* — the doc moves, then the code.
