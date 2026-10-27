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

*Status 2026-10-12: ruled and built. Built: the Lip and its two buttons, the groove, the frame's tone and the well (GV-D7, GV-D12); where a session with no pane opens (GV-D4); the terminals away and called up as they were left (GV-D5's call, GV-D6); the edge's three outcomes and their readouts, and the monitor making room; maximized, the bar the window's title bar (GV-D11); the monitor alone at launch, the first call bringing last run's panes with the one it called (GV-D5, N14 (a)); ⌘W on the last pane minimizing them (N16 (a)); rest, the drawing's share above a floor on every height (N15 (a)).*

Godview is the deliberate control-room exception to the iOS-widget chrome around it. Its
visual source of truth is `p008/chopsticks/apps/godview`: a flat 40px instrument bar, compact
monospace controls, a gridded agent stage, stark monochrome status bodies, a parchment terminal
deck in light mode, a graphite terminal deck in dark mode, and the reference scanline/vignette
treatment. VibeField keeps its own host mechanics, honest mock label, and renderer-native terminal
alpha, but does not reinterpret that reference through rounded cards, colorful agent fills, or
floating pills — with the exceptions James named: the terminal deck's sheet edge (§8, 2026-09-28)
and, since round 3 (2026-10-02), Godview's head (GV-D1) and the wrapper around its terminals
(GV-D7, GV-D11, GV-D12). The scoped `--vf-godview-*` tokens are the exact reference palette. VibeField
composites those status-body colors at 72% by default so they remain legible glass over the field;
the temporary system-control panel exposes that alpha for live tuning.
**Since One Frame (FR-1, 2026-10-03) Godview is a view, not an overlay:** it is drawn inside the
cover BELOW the frame (§10), reached by ⌘2 or its cell in the views track (§8). **Its head is the
frame's, not the reference's instrument bar** (GV-D1, ruled 2026-10-02; §8 "Godview's head —
Stories"): the 40px bar, its counters (FC-D18) and its ☼◐ switch (FC-D7) are gone from VibeField.
puppeteer's own Godview keeps the bar. *(Until the Stories head, built 2026-10-11, this paragraph
said Godview "keeps this instrument bar as its head for now".)*
**Since FR-4 (2026-10-03) Godview follows the app's theme (FC-D7):** its ☼◐ switch and its own
remembered light are gone, and the parchment or graphite deck is whichever the app's one theme
control (§8, the Me menu) resolves to — unless Settings → Terminal → Look holds the one override,
Godview's mode (As the app · Light · Dark), saved with the rest of this viewer's deck appearance.

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
| the cutting mat (`glyph: "mat"`, `draft/ground/MAT.md`) — sage `#86A078`, cream lines `#E8DCBE`, a material carried across both themes | lit by the **Sun**: the tree-shadow reference's chain — the sage shows `#3D5A30` | lit by the **Moon**: 4100 K through the Purkinje shift — `#313C40` in the dapples, `#1C2027` in the palm's shadow, Eigengrau `#16161D` under all; half the sunlit luminance |

*Retired 2026-10-07 (DK-17; DK-0d's erratum of 2026-10-03, executed — DK-D2, R22):* the ground this
section described until then was ICE 0.11's — a world grid (`spacings: [25, 50, 100]` and its fades)
and the magnet grid tuned through ICE's `GridMagnetConfig` (a dot or needle glyph, `reach: 60`, …),
inked `#A6A6A6` by day and `#8A8A8A` by night (a classic alternate's `#1C1C1C` recorded beside it).
ICE retired the magnet grid with the cards and the dot and needle grids on 2026-09-25, and on the
desk (DK-3) the ground is the cutting mat below — its sage and cream, its rulers at a margin of 60,
its lattice's fade-in (`GridConfig { fadeIn, mat }`). So the grid's projection, the magnet's tuning
and its inks, Canvas Settings' Dot/Needle preference, Studio's grid controls and the appearance
document's grid half left with the old ground: the document is v4, the plain ground alone
(`--vf-canvas-bg`), and its reader reads a v3 file past what retired. The CSS-fallback dots
(`--vf-canvas-dot`: `rgba(0,0,0,0.16)` by day, `rgba(255,255,255,0.08)` by night, and widgetlab's
`--canvas-dot` alias) left the tokens with it (the migration plan's (76)): where the desk stands in,
the mat in CSS (below); everywhere else the plain ground.
*Built 2026-10-07 (DK-16):* the mat in CSS is the kit's — `--vf-mat-ground` as the theme lights it,
its lattice (`--vf-mat-lattice`) in its lit cream (`--vf-mat-line`: MAT.md §4's lines at full cover,
(206, 183, 131) by the Sun and `#4C5254` in the Moon) at the line law's presences — one CSS px at 7 %
every 25 and at 21 % every 100, ICE `MAT_GRID`'s 0.14 and 0.28 — and the words on it in
`--vf-mat-ink`, paper white at 60 %: **4.0:1** on the Sun-lit sage and **5.2:1** in the Moon, where
the old splash's black/50 read 3.9:1 on its canvas (55 % measured 3.6:1 and was raised). The splash
and the floor it shares (the Setup Assistant's, the switch's), the loading veil, the explorer's tiles
before their still (a mini mat, the lattice at a quarter) and the terminal preview's miniature field
(at half) wear it; the dots stand only under the unavailable card.
*Amended 2026-10-07 (DK-17):* the dots left the product — the unavailable card stands on the plain
ground alone (§8), and so does the kit's placeholder face, whose one consumer is the Artifacts panel
(a page or an app not yet pictured is not a board, so not the mat). The design catalog's stand-ins
for the field — the chrome's plates, the switch's and the Setup Assistant's floor — wear the mat in
CSS, as the field they stand for does.
*Erratum 2026-10-03 (DK-0d — DK-D2, R22) — the cursor's halo, which this file never described:* the
field above answered a pointer VibeField drew itself (`cursor/`: a DOM halo over the canvas that hid
the OS cursor, became a dot over a widget's controls and fed this field its poles — the `reach`
above). It retires with the field (DK-16): on the desk your pointer is the OS cursor and the
desk's own open hand, and other people's are §8's peers on the mat.

**The cutting mat (2026-09-07).** The third ground is a material, not a token: its sage and
cream are the same in both themes and the theme changes the light that falls on it. The
gobo plates are the product's assets; the engine ships the mat's law and its two lights.

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

**State as TEXT — the inks** (GT-7, 2026-09-24). The values above are FILLS: dots, rings,
badges, hairlines. As small text on light chrome every one of them fails 4.5:1 against white
(green 2.0, orange 2.1, red 3.4, cyan 1.9), so a state word that has to be READ takes its
ink: `--vf-ink-healthy` `#1F7A36` (5.4:1) · `--vf-ink-attention` `#B25E00` (4.7:1) ·
`--vf-ink-danger` `#D70015` (5.4:1) · `--vf-ink-info` `#0A6A93` (6.0:1). On dark chrome the
inks ARE the fills (`.dark` maps each to its fill — 5.0–9.0:1 on `#1C1C1E`), so one token
names one meaning in both themes. The meanings are the table's; an ink is never decorative
either.

### 2.6 Organizational accents (containers, comments, tags)

Curated set, assigned per object, used as *tint*: `#6366F1 · #EC4899 · #22C55E · #F59E0B ·
#06B6D4 · #8B5CF6 · #EF4444 · #3B82F6`. Tint recipe: body fill at 12% (`{hex}1F`),
hairline at ~35%, label at full. These group and label; they never signal state.
**One exception, carried by shape (TL-D2, TL-D14, 2026-10-02):** in Godview's timeline (§8) a
working span wears its PROJECT's colour (`AgentView.colour`, the backend's project identity), because
across an afternoon colour has to say whose a lane is, and the swarm's one ink made every lane look
alike. There the shape says what: work is a wide wake, a wait a thin thread, rest a hairline. So a
project hue that lands near orange (the wheel withholds only the band around `--vf-select`) never
reads as blocked, and the wheel itself is not changed.
**Users are not among them (2026-09-22, UA-D17):** a person is known by a face (§2.8), never a
colour. An accent on a user collided with the project inks and with §2.5 — measured in OKLCH,
three of the eight slots sat within 3° of green, orange and red, and one inside the band
withheld for `--vf-select`.

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
| deck sheet shadow (§8, the deck's edge) | `0 -20px 40px rgba(0,0,0,0.08)` | `0 -20px 40px rgba(0,0,0,0.4)` |

**The phone's one pane** (D-i12, ruled 2026-10-18). The desktop lights a mounted body in its pane's
colour, because its panes are told apart by colour. The phone has one pane, the open card, so a
colour there tells nothing. The card's bubble draws its band and its light in **text main**:
`#111111` by day, `#FFFFFF` by night, never a dealt pane colour. James: "on mobile there is only
one pane, so color no longer make sense, so just keep the glow it generic white, black instead".

The deck sheet's shadow is §5's *Sheet* recipe, keyed to Godview's OWN mode switch rather than
the app's theme (Godview can be dark over a light field). Its geometry: top corners
`--vf-godview-deck-radius` 12px; **the Lip** (GV-D7; built 2026-10-11) `--vf-godview-deck-lip` 30px
— the lip grown into the drag bar, where a 14 band stood until then; still never less than the
radius, so no pane corner meets the curve; **the groove** (the grip, GV-D12)
`--vf-godview-deck-grip-width` / `--vf-godview-deck-grip-height` 40 × 6, corners
`--vf-godview-deck-grip-radius` 3px — a slot pressed into the frame, not a bar laid on it, where a
72 × 4 bar on the text ramp stood (the island's pull bar at instrument scale; James, 2026-09-28).
The empty pane launcher's clearing (QL-1, pass 3 §22) is the terminal's ground at the sheet's
glass — the sheet's own paint until round 3 gave the sheet the frame's tone; the clearing stands
inside a pane, and nothing inside a pane changed (GV-D2) — but never thinner than
`--vf-godview-launcher-clearing-floor` 92% of the ground: a viewer who thins the stage thins the
sheet, and at the sheet's glass the prompt beneath would read through the launcher's rows. At the
default opaque backdrop the floor changes nothing. A launch (QL-2, §8) covers its pane with the
same paint and the same floor while it waits.

**The wrapper's tokens** (round 3 — One Frame §23.2 and §23.3, GV-D7, GV-D11 and GV-D12; in
`tokens.css` since 2026-10-11). The numbers are the ruled drawing's own (`kit/gv3.css`,
`kit/gv3.js`). The frame's and the well's are drawn (the paragraph after the table); the
controls', the grip's title-bar hit and the field's two stand AHEAD of the rules that will read
them (the status line below). Keyed per Godview mode, as the deck's shadow is:

| Role | Light | Dark |
|---|---|---|
| deck frame — how far the sheet's ground is mixed from the terminal's ground toward the terminal's own ink | `--vf-godview-light-deck-frame-ink` 11% | `--vf-godview-dark-deck-frame-ink` 9% |
| well edge | `--vf-godview-light-well-edge` `rgba(0,0,0,0.17)` | `--vf-godview-dark-well-edge` `rgba(0,0,0,0.42)` |
| well rim | `--vf-godview-light-well-rim` `rgba(255,255,255,0.6)` | `--vf-godview-dark-well-rim` `rgba(255,255,255,0.06)` |
| well shade | `--vf-godview-light-well-shade` `rgba(0,0,0,0.09)` | `--vf-godview-dark-well-shade` `rgba(0,0,0,0.28)` |

Their geometry: the well's corners `--vf-godview-deck-well-radius` 10px; the groove's corners
`--vf-godview-deck-grip-radius` 3px; its pill `--vf-godview-deck-grip-pill` 22px tall (its corners
half that, 11) with `--vf-godview-deck-grip-pill-pad` 12px at each side; the grip's hit in the
maximized title bar `--vf-godview-deck-grip-hit` 168px; the two controls
`--vf-godview-deck-control-width` / `--vf-godview-deck-control-height` /
`--vf-godview-deck-control-radius` 30px / 24px / 8px; the monitor's field
`--vf-godview-deck-field-gap` 12px; the deck's rest (N15 (a), §8)
`--vf-godview-deck-rest-share` 5/13 of the stage — 300 of the drawing's 780 — and
`--vf-godview-deck-rest-floor` 232px, the field's least height, 220, and its gap. *(2026-10-19:
the field's own floor, `--vf-godview-deck-field-floor` 220px, stood here. The field no longer
shrinks past rest (§8 "The monitor makes room"), so rest's floor is the field's, and the token
went.)*

**How the wrapper is drawn** (GV-D7 the Lip and GV-D12 the groove, ruled 2026-10-02 and locked as
drawn; built 2026-10-11; §8, the deck). **The frame** is the sheet's ground: the terminal's
ground mixed toward the terminal's own ink by the frame's share (the table), painted at the
stage's glass as the sheet's ground was. The ink is the terminal's foreground — the same
projection the panes are handed, said on the stage's root beside the ground; where a host hands
none, Godview's text main. **The groove** is filled with the well's edge, the well's shade inside
its top (`inset 0 1px 1.5px`) and the well's rim under it (`0 1px 0`). **Its pill** is clear at
rest; under the pointer, anywhere on the lip, the pill is the terminal's ink at 7% and the groove
takes 30% of that ink into its edge colour; held, the pill is 10% and the groove the full ink;
120ms on `ease`; under the keyboard's focus a 1px outline in text main, 1 off the pill. **Its
hit** is the whole lip and 6 above it — `row-resize` over it, `grabbing` while held. **The Lip's
minimize** (built 2026-10-11 with the terminals away; §8) is a control of
`--vf-godview-deck-control-width` × `--vf-godview-deck-control-height`, corners
`--vf-godview-deck-control-radius`, 10 from the lip's right end and on its axis: a 14 glyph (§13)
in the terminal's ink at 64%; under the pointer the full ink on a 10% fill of it, 120ms on `ease`;
under the keyboard's focus the pill's outline, 1px in text main, 1 off. It stands above the lip's
hit, so the edge never takes its press. **The monitor's field** (built 2026-10-11, §8 "The monitor
makes room"; re-ruled 2026-10-19) ends `--vf-godview-deck-field-gap` above the deck's edge as last
set, and never above where it ends at rest. **The well**
the panes sit in stands 8 in from the sheet's sides and its foot (inside the cover its foot is
the window's reserve, §10), corners `--vf-godview-deck-well-radius` (a selected pane's 8, the 1
gap, the 1 edge), the panes 1 in from it and clipped at 9; drawn OVER the panes, the edge as a 1px
inner ring and the shade as `inset 0 2px 4px`; under its foot, the rim as `0 1px 0`. The well has
no ground of its own: a pane paints its own ground over the frame's.
**Maximize** (built 2026-10-11 with the title bar, §8) stands beside minimize, drawn as it is
(above), 4 apart, the last of the two 10 from the lip's right end; in the title bar the two are
minimize and restore, 8 in, after a hairline. **The grip's hit in the maximized title bar** is
`--vf-godview-deck-grip-hit` wide, the bar's full height.

### 2.8 Identity — the face

**A user is known by form, never by hue (UA-D17, ratified 2026-09-22).** One emoji per user,
framed as a **sticker** (the default) or a **coin** (the user's own choice). The product gives
a person no colour: hue belongs to projects (the project ink) and to state (§2.5). Five rules
decide every surface a user appears on:

| Rule | Law |
|---|---|
| **I-1 Form, not hue** | No dot, no tint, no coloured ring, no accent slot. The only colour a face carries is the emoji its user chose. |
| **I-2 The field, not the person** | Two users of one person must never look alike: a machine never deals one emoji to two of its users — the emoji is the guarantee — and a sticker's own angle is a second, softer cue (one user in eight shares an angle, and below 40px every sticker sits straight). |
| **I-3 A neutral ground** | The face sits on the chrome's own materials — no disc, no plate, no wash taken from the emoji. |
| **I-4 The name makes it certain** | The face is an index. The name sits beside it wherever there is room, and in the accessible name where there isn't. |
| **I-5 State stays in words** | Linked, offline and "2 waiting" are written beside the face (a count badge at most), never painted onto it. |

**The sticker** (default): the emoji is its own frame. Figure at 86% of the box. A die-cut
border in paper white **in both themes** (`--vf-sticker-edge`) — the white edge is what reads
as a sticker; knocked out in dark it becomes an emoji with a halo — at 3.2% of the size,
rounded (1px at 16px, 5px at 144px), with a 1px cut line beyond it at black/12
(`--vf-sticker-cut`), which is what holds a white edge on white chrome. The border is the
glyph's alpha dilated, **thresholded first** (slope 4, intercept −2): an emoji bitmap's faint
corner pixels otherwise dilate into grey squares, visible only on a dark ground. iOS is to
dilate with `CIMorphologyMaximum` (no iOS face exists yet). Shadow `0 3% 4.5%` of the size at black/22 (dark /50). **Tilt**,
from 40px up: ±2–5°, stable per user — `h = FNV-1a(userId)`, magnitude `2 + h mod 4` degrees,
sign from bit 7 (set: clockwise) — a second colourless persona cue (I-2); below 40px every sticker sits
straight so rows line up. From 20px, the control holding it lifts it on hover or keyboard focus
(a face standing alone, like the Account row's, stays put): 1.07×, the shadow to `0 7% 9%`, the
tilt relaxed to 35%, on `--vf-ease-lift` (180ms) — held, like a card (§7). Reduced motion: the
same lift in 90ms, `ease-out` (M6).

**The coin** (by choice — then the frame itself tells personas apart: a fox sticker at home, a
minted octopus at work). Pewter. The figure at 58% of the box (66% at 20px and below), raised
with a small drop shadow off a field sunk by an inset shadow; rim 8.5% of the size (15% once
the legend shows); the coin throws `0 5% 12%` + `0 1.2% 2.5%` of its size (black /16 + /6,
dark /50 + /30). Its detail switches on by size: **beading** — the §2.1 dots, in the coin's
ink at 70% — from 44px · **reeding**, 112 ridges, from 56px · it **catches the light**, a highlight
that follows the pointer, from 72px · the **legend**, name · tailnet engraved round the rim,
from 96px. Never a user number: nobody knows theirs, and the tailnet is what tells two "JAMES"
coins apart. *As built (UA-7): the legend engraves the name alone — the one surface that large,
Setup pane 2, comes before the link, and nothing yet carries another user's tailnet.* A coin
neither tilts nor lifts; its host's hover or focus scales it 1.05× on `--vf-ease-lift` (180ms). Tokens
`--vf-coin-rim` · `-field` · `-ink` · `-reed`, plus the light and shade that
make it metal (`-inset` · `-shadow` · `-shadow-contact` · `-relief` · `-bevel-light` ·
`-bevel-dark` · `-sheen`):

| Pewter | Light | Dark |
|---|---|---|
| rim (conic, from 210°) | `#FBFBFD · #C4C4CA 16% · #F1F1F4 33% · #B6B6BD 52% · #F4F4F7 70% · #C0C0C6 86%` | `#77777D · #36363B · #646469 · #2A2A2F · #68686E · #34343A` (same stops) |
| field (radial at 34% 28%) | `#FFFFFF · #ECECF0 58% · #D5D5DB` | `#5B5B61 · #3A3A3F 58% · #27272B` |
| ink — beading, legend | `#1C1C1E` /52 | `#F5F5F7` /52 |
| reeding | black /16 | black /35 |
| inset — the sunk field, `inset 0 2% 4.5%` of the size | black /22 | black /42 |
| relief — the figure's drop, `0 1.4% 2%` (at least 0.5px) | black /25 | black /25 |
| bevel — light · dark | white /50 · black /16 | the same |
| sheen — the light it catches | white /30 | white /30 |

**Dealing.** The machine deals each new user an emoji no other local user holds, from a deck
of 48 that read at 16px on both grounds — animals first, then plants and objects
(`contracts/src/user-face.ts`); each user starts at their id's hash, so nobody is always
the fox. Unique for up to 48 users, the deck's size: a 49th gets its starting face back,
honest and never a blank. Setup pane 2 shows the deal beside the name with the picker already
open and whole inside the shell — the frame switch (small) under the face, a three-row deck and
any single emoji typed in beside it; on the Account page, Change… opens the same picker over a
four-row deck. A face another user wears stays in the deck, greyed and named. Refused as faces, because they already mean
something here: flat colours and hearts · 🔥 (the swarm's burn ladder) · 📁 · the state marks
· 🔗. A joined sequence is judged by its base — fire joined to fire is still fire, while 🐈 + ⬛
is a black cat — and a typed face is refused in place, in main's words, before anything is
written. The face and the name are to travel with the login (UA-D18) — *gated (2026-09-22): the
settings doc does not replicate yet, so today a face is this machine's, as the accent was.*

**Where it appears, at what size.** The Me menu (§8): 40px in the corner, 26px in its rows ·
the Settings head: 40px, other users 24px · Settings → Account: 48px, rows 28px · Setup
Assistant pane 2: 96px, the smallest size whose coin shows its legend · the Setup users chooser:
56px · the switch (§8): 128px at the centre of the window while it changes hands, a coin
engraving the name · the tray: the emoji leads the item's
label for both frames — a native menu draws no frame, and at menu size a coin reads as its
emoji · document presence: the face leads the cursor's label ("🦊 James"), and every cursor
is `--vf-presence-ink` (`#68686B`). *Corrected 2026-09-22 (UA-7): this said the cursor is
drawn in ink. It cannot be — ICE paints the SENDER'S colour at every receiver, whatever the
receiver's theme, with white label text on it — so the colour that is nobody's is one
neutral grey that holds on both grounds and under white text.* *Corrected again the same day
(review): `#636366` measured 2.99:1 on the dark ground, just under 3:1; `#68686B` holds 3.2:1
there, 3.1:1 on dark chrome, 5.3:1 on the light ground and 5.5:1 under the white label.*
*Erratum 2026-10-03 (DK-0d, against the desk — MC-D10 = DK-D23, R17, R22):* on the desk VibeField
draws the peers' cursors itself (§8, peers on the mat), so the ink is drawn where it is seen rather
than sent as the sender's colour — and there `#68686B` does not hold: it measures 1.4:1 on the
Sun-lit sage (`#3D5A30`) and 2.0:1 on the Moon's dapples (`#313C40`), so on the mat the label is a
chip on the line's glass in the chrome's text ink (R17, amended 13:40Z; §8, peers on the mat), and
the arrow keeps the presence ink on its white edge. The contrasts above stand for the plain grounds
and the chrome.
*Measured 2026-10-07 (DK-16 — smoke:canvas's PEERS CONTRAST row, the chip's glyph cores against its
glass in the window's own pixels over the lit mat):* the label reads **9.2:1** by day and **11.3:1**
by night (three runs: 9.1–9.2 and 11.3). The arrow's white edge is `--vf-presence-edge`.

### 2.9 The project ink — the cool half (PJ-L7)

**One project, one ink, everywhere** (PJ-L7, PJ-D5 (a) ruled 2026-10-07; P3: a record freezes the
ink of its first act). fieldd deals every project a number, `ink`, in `[0, 997)`
(`PROJECT_GROUPING.INK_DEALS`): a record keeps the one it was dealt, a record-less project's comes
from its strongest anchor. That number is the project's colour on every surface — History, Godview,
the swarm, the phone — and this entry is the one map from it to a hue. It supersedes the per-device
and per-room deals (D-i13, AR5-D3; the History room's own 333° wheel and puppeteer's
`project-tint.ts`, which withhold only the band around the selection, read here as the old way).

- **The hue is OKLCH's, and only the cool half is the projects'.** State keeps the warm half and
  green — the wheel from **350° through 0° to 180°** is withheld, where §2.5's red (28°), orange
  (67°), yellow (95°) and green (147°) sit, with 38° clear of red and 33° of green at the band's
  edges — and so is **238°–265°**, the band around `--vf-select` (251°), so no project reads as the
  selection. What is left are two arcs, **180°–238°** (cyan to blue, 58°) and **265°–350°**
  (violet to pink, 85°): 143° in all. *The one overlap, said:* `--vf-cyan` (231°, info and links)
  and its ink (`--vf-ink-info`, 235°) sit inside the first arc. They mean information, never a
  state a person must answer, and an ink is drawn as a mark, never as text or a link (below), so
  the record's bands stand as ruled.
- **The deal walks the golden ratio across the arcs:** `hue(i) = arcs((0.12 + i·φ) mod 1 · 143°)`,
  φ = 0.6180339887…, where `arcs(x)` lays x along 180°→238° and then 265°→350° — the PJ page's own
  `projectHue`, so neighbouring numbers never sit side by side and the page's drawing and the
  product's agree.
- **Lightness and chroma are the theme's,** so no project is louder than another and each is the
  same hue in light and dark: `--vf-project-ink-l` **0.60** by day and **0.74** by night,
  `--vf-project-ink-c` **0.15** in both (puppeteer's and the History room's `--tint-l`/`--tint-c`,
  the same numbers). At 0.15 some hues leave sRGB (405 of the 997 by day, 564 by night): a hue
  keeps its hue and lightness and gives up chroma until it fits (down to 0.10 by day, 0.13 by
  night), the way the engine maps an `oklch()` it cannot show — and the hex form the canvases take
  (`projectInkHex`) does the same.
- **Contrast** (measured over all 997, both themes): **3.3–4.3:1** against white and the inset fill
  by day, **5.6–9.7:1** against `#1C1C1E`, `#2C2C2E` and black by night — every ink clears 3:1, the
  floor for a mark that must be seen. It does not clear 4.5:1 by day, so **an ink is never text**.
- **How it is drawn:** as the **folder mark** (`folder`, §13), filled with the ink at a quarter and
  stroked in it — never a round dot, which reads as state (PJ-L7). Godview's swarm and timeline wake
  still wear puppeteer's own deal (§2.6's exception) until they take this ink (PJ-5). A device
  never gets an ink (§2.8, PJ-D24): a desktop is its OS mark.
- **Where it lives in code:** the design kit's `projectInk(ink)` answers the CSS colour,
  `oklch(var(--vf-project-ink-l) var(--vf-project-ink-c) <hue>)`, so it follows the theme on its
  own; `projectInkHue(ink)` the hue, and `projectInkHex(ink, theme)` the sRGB hex for a surface
  that cannot resolve CSS (a WebGPU canvas). History hands the room `projectInk(ink)` as each
  project's colour (A-D2) once the room takes a host colour (PJ-4's second half, the room's R1);
  until then the room still deals its own.

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
| `--vf-radius-card` | `22px` | THE card radius (the DOM card's `CARD_RADIUS` until DK-17 deleted it; the token stays the chrome's); scaled minis use `max(6, 22 × scale)` — silhouette is preserved, never re-styled |
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
| Edge tray (enters from the left; 2026-09-23) | `20px 0 40px rgba(0,0,0,0.08)` · dark `0.4` — the side panel's shadow cast the other way; as `drop-shadow()` where the silhouette is a path (`--vf-drop-edge`, and `--vf-drop-island` for the island recipe) |
| Drag proxy (above everything) | `drop-shadow(0 24px 48px rgba(0,0,0,0.35))` |
| Tray tile | `drop-shadow(0 10px 18px rgba(0,0,0,0.16))` |
| Search popup (the Peek, §8 "Search"; GV-D8, built 2026-10-08) | `0 40px 100px rgba(0,0,0,0.24), 0 12px 30px rgba(0,0,0,0.10)` · dark `0 40px 100px rgba(0,0,0,0.6)` and a 6% top light (`inset 0 1px 0` white/6) — ringed by the strong hairline |

**One exception to "chrome is glass" (2026-09-23, James — the notch):** the edge tray's notch
and its drawer (§8, edge trays) are OPAQUE solid chrome (`--vf-chrome-solid`, the theme's
colour), because they belong to the window's edge rather than floating over the field — a
fixture, not a control; a hardware notch, not a pane of glass. Nothing else in chrome may
claim it.

**Material tiers** (translucency + backdrop blur — chrome is glass, cards are opaque):

| Tier | Recipe | Use |
|---|---|---|
| Island | surface `/80` + `backdrop-blur-xl` (hover `/90`) | closed pill, toolbars |
| Line (MC-D2, ruled 2026-10-01) | `--vf-chrome-solid` at 88% (94% by night) + a 24px blur, ringed by the hairline (`--vf-hairline-strong` by night), the island shadow, and by night a 6% top light (`inset 0 1px 0` white/6) | the composer line (§8), the views track at its left end on the same pane of glass — the track's own pill folded into it 2026-10-03 (FR-2); the head's name pill and zoom readout, the frame's floating controls at the top (FR-3, 2026-10-03); on the desk, the selection bar and the tools in hand (§8; MC-D2, R20) |
| Sheet | surface `/90` + `backdrop-blur-3xl` | open tray, large panels, the fields explorer grown from the head's pill (FR-3) |
| Overlay chip | surface `/90–95` + `backdrop-blur-xl` | put-back affordance, HUD toasts |
| Backdrop dim | `black/10` light · `black/40` dark | behind open sheets; canvas recedes to `scale(0.98)` |
| Search scrim (GV-D8; K7, 2026-10-08) | `black/16` light · `black/46` dark, over a backdrop blur of 18 and `saturate(0.9)` | behind the Peek only (§8 "Search"): the window blurred and dimmed, the view and the frame receding to `scale(0.98)` under it. Darker than the backdrop dim so it reads as dimmed (One Frame §23); the backdrop dim stays the sheets' until James rules otherwise (docket PK1) |

**Menus are solid, floating controls are glass** (One Frame FR-7, FC-D14 ruled 2026-10-01): a menu
is rows to be read, so it is `--vf-chrome-solid` — opaque — ringed by `--vf-hairline-strong`, with
the island shadow and corners 18 (the Me menu keeps its 28, concentric with the face). The Me menu
(2026-09-22) was the first; @'s list in the line (§8) is the second; the zoom's menu and the palette
are the third and fourth (the head, §8; FR-3, 2026-10-03). A menu opens over the stage and never over
the frame: the line's menus grow upward from the line, 8 above it; the head's grow downward from the
head — the zoom's 4 under it, the palette 16 — and end 8 above the line; the corner's, the Me menu,
grows upward from your face's column and stands 8 above the line with the face beneath it (FR-4,
2026-10-03 — it grew around the face until then, over the line's left end). **The desk's grown bar**
(§8, the bar grown) is the fifth, with two exceptions (R20, 2026-10-03): its corners are 20, the
bar's own, and it is placed from its own row — the bar's row stays where the bar stood and the rows
grow away from it — rather than grown from a control in the frame.

**On the desk each object draws its own material** (DK-D2; *rewritten 2026-10-07, DK-17* — this
paragraph read "the composited profile draws the card's material on the ground", ICE design-013 Q8,
2026-09-07: ICE deleted its presentation profiles, the composited and the stratified, with the ground
at design-015 D5b, so that profile never reached VibeField). Each object kind draws its own face,
shadow and lift on the GPU under the mat's one light; the selection is the mat's pencil brackets (§8,
the desk's chrome); no DOM card exists to carry a shadow, so the two card rows of the table above
are the record of the card that retired, and the rest are the chrome's — the islands, the sheets,
the edges, the menus. What the desk's materials mean is the material book's (§5.1).

### 5.1 The material book — what the desk's materials mean (DK-D5; a stub)

**Ruled 2026-09-25 (DK-D5; thinking-the-desk §6): §5 is the material book.** The desk's materials
are a fixed vocabulary, each a recipe with a normal response to the mat's one light, and each
MEANS something; a material is written once by its recipe's name, as a colour is by its token's.
The book is the desk's — what lies under the camera; the chrome over it keeps the tiers above and
is lit by nothing (MC-1, §8 the desk's chrome). What an object is — an entity with its kind, its
rect, its props, its stratum (pads · sheets · things), taped or not — is ICE's object model,
`design-015` §5; this book says only what each material means and what wears it.

| Material | Means | Wears it | On the desk |
|---|---|---|---|
| **paper** | writable | notes, the notebook's pages, the calendar, the whiteboard's face | drawn |
| **ink** | drawn by hand | strokes on a board or a page, a note's handwriting | drawn |
| **pictures** | a captured image | prints | drawn — device-local until the upload plane (DK-D21) |
| **string** | a relation | wires, mind-map edges, patch cables | not yet — STRING |
| **boards** (the mat) | a place: it holds a desk | the mat itself, the ground (§2.1); the mini mat, a desk inside the desk | drawn |
| **stickers** (tape) | an attachment, a label | tags, Fieldmarks (§11) — the masking and label tape are already marks | not yet, as objects |
| **tools** (metal) | a tool | rulers, clips, scissors | the mat's rulers and its lamp |
| **instruments** (panel, plastic) | an instrument | the packs — shader, 8-bit, arduino: a panel, controls, screens, cables | not yet — the OBJECT KIT |
| **portals** (glass) | a window onto something live | artifacts, pages, terminals, captures | not yet — PORTALS (DK-D19, DK-D20) |

**The five guardrails** (thinking-the-desk §6): **no material without a meaning** — no ornament
that does not inform (a glass portal that refracts the mat passes; the stitched-leather calendar
fails) · **the efficiency clause** — every physical control is at least as fast as its flat equal
(a knob takes a drag, the wheel and a typed value, and shows its number), and where the physical
form loses, the flat form wins · **legibility rules the camera** — text at every zoom band, on
every material, in both lights · **one physics** — one light, one spring set, one mass; no object
keeps private motion rules · **the agent test** — a material must make working with an agent
better: the agent sees the same objects by the same names, and a material only the eye can read
is decoration. *A stub:* the recipes are ICE's (its `theme.ts` names them, each kind's pass draws
them), and a material's row gains its recipe's name when a VibeField surface first wears it. Not
yet drawn: string, stickers as objects, instruments and portals — each the desk migration's
follow-on program, never a half-port.

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

One more plain curve, with its reason: a **retract** goes back along the way it came on
`cubic-bezier(0.4, 0, 1, 1)` — an ease-in, a hair sharper off the mark than CSS's `ease-in`
(0.42, 0, 1, 1) — with its fade on `ease` (the spawn bloom's buds, 180ms, §8; the prototype's
stylesheet said 200ms, its constants table 180, and the table is the authority) — it accelerates
home, the pop's reverse (M4). Leaving things never wait out an entrance's reveal delay.

One more interval, with its reason — **the arrival** (track TS, TS-D8 ruled 2026-10-27; §8 "The Connect
pane"). When a link lands, the account's devices arrive around your face **90ms apart**, not 26: each is a
wire drawn from the face on the island curve (560ms) and an OS mark popped at its end on `--vf-ease-pop`
(280ms). At 26ms three devices land inside two frames and read as one flash; at 90ms each is seen to
arrive, which is the moment's whole point (TS-L8, arrival is the reward). The cap is the table's: the fifth
device's delay, 360ms, is the last, and any after it arrive with the fifth. A coin face engraves its
tailnet on the legend's lower arc over 900ms on the island curve, 260ms behind the first wire (§2.8, from
96px). Under reduced motion they appear together in a 120ms fade. It is the one staggered entrance that is
not 26ms.

Two more, with their reasons — **the hand-over** and **History's arc** (track AO; AO-D2, AO-D4 and AO-D8 ruled
2026-10-27; §8 "The Setup Assistant's agent chapter"). **The hand-over** is a first run's reveal. Setting up's
live phase breathes (the loop below) while the desk opens, warms and settles behind the wizard's glass. When the
pane's facts are in, its title becomes the welcome by a **180ms** cross-fade in place (one element, M1) and holds
**1.4s**, long enough to read the welcome and its one line; the old Ready pane's 700ms beat never was, because the
splash stood in for the rest. Then the glass leaves exactly as the splash does: a 240ms plain `ease` fade while the
desk settles `scale(0.99) → 1` over 560ms on the island curve. The mat under the glass is the desk's own, so nothing
changes floor. Reduced motion: fades only, halved; no breath. **The arc** is the loop's travel drawn on a glyph.
While History imports, a fifth of the History glyph's own circle, in the cell's ink at the glyph's weight, turns once
every 1.1s on the island curve over the glyph resting at a third of its ink. It stops the moment the room says the
archive is ready. It is the import's only sign outside History, so it carries no number (the room's law: a
percentage names its step, never an invented whole). *Amended 2026-10-27 (AO-4b, built):* reduced motion (M6) stops
the travel, and the arc rests at the top of the circle, a fifth of it from twelve o'clock, until the archive is ready;
the glyph stays at a third of its ink.

*Status 2026-10-12: ruled and built. Built: the Lip and its two buttons, the groove, the frame's tone and the well (GV-D7, GV-D12); where a session with no pane opens (GV-D4); the terminals away and called up as they were left (GV-D5's call, GV-D6); the edge's three outcomes and their readouts, and the monitor making room; maximized, the bar the window's title bar (GV-D11); the monitor alone at launch, the first call bringing last run's panes with the one it called (GV-D5, N14 (a)); ⌘W on the last pane minimizing them (N16 (a)); rest, the drawing's share above a floor on every height (N15 (a)).*
**The terminals rise and fall** (Godview's deck, §8; One Frame §22 "Shared mechanics" and §23 —
GV-D5, GV-D6, GV-D7 and GV-D11, ruled 2026-10-02; built 2026-10-11): two durations, no new
curve. The deck **rises** — called up from away, or maximized by its button — over **480ms on
the island curve**: it is a thing that travels. It **falls** — minimized, or restored from
maximized — over **300ms on the retract curve** above: it goes back the
way it came, accelerating home (M4), its top 40 past the window's foot. Each is a `transform` on
a sheet that is already at its end size (rising) or still at its old one (falling), never an
animated edge (§8, one resize per change), and a CSS transition (M3), ended by a timer of its
length and two frames (34ms), never by a `transitionend` a hidden window may not send. A call
during a fall turns it round from where it is. Beside them, on plain `ease`: the view's bodies
fade out under a maximized deck, and back, in 260ms (the drawing's number, 20 past the table's
range); the sheet's top corners and shadow go and return in 160ms; the two readouts (§8, §9) come
in 120ms and leave in 160ms, their veil 160ms both ways; the title bar's own search steps out in
120ms, and only then the head's returns in 200ms (§8 "Search — the Peek"). Under reduced motion the deck is at its end at once.

Loops are for an indicator waiting on a fact it cannot predict, never for decoration (QL-2's
launch, §8): a **breath** — `ease-in-out`, alternate, 1.1s, scale 1 → 1.06 — and a repeating
**travel** on the island curve (the launch's ripple, 1.1s). Both stop the moment the fact
arrives, and neither runs under reduced motion.

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
- **M5 — The stage recedes.** When a sheet opens, the canvas eases to `scale(0.98)` — focus is
  physical — and the world keeps stepping behind it, so undo and collab land visibly behind a
  partial overlay. *Rewritten 2026-10-07 (DK-17 — the policy as built):* two gates, no third. **A
  sheet takes none**: the desk keeps its own idle — zero frames and zero submits while nothing moves
  (ICE design-015 §2) — its ambient wind blowing for 20 s after the last touch and easing out over
  2 s (`deskLayer({ ambient })`, its default `idle`); the stage hold the sheets and the loading veil took
  until DK-17 wrote a resource the desk never reads, so it left. **A cover freezes**:
  `engine.frame.freeze("cover")` over a still of the desk, zero frames and zero submits while it
  stands (§8, the covers over the desk), and the user switch freezes the field it leaves the same
  way. (Until 2026-09-26 a stage hold froze the GL islands' repaints and parked the compositor's
  demand loop; ICE retired both with its planes at design-015 D5b.)
- **M6 — Respect `prefers-reduced-motion`**: morphs become fades, springs become ease-out,
  durations halve. Non-negotiable quality floor.

**The view switch (One Frame §12, FC-D13; ruled 2026-10-01, built 2026-10-03).** The canvas is the
ground floor (FV-D1); every other view is ONE cover over it (§10). From Canvas the cover fades in
over 240ms plain `ease` and settles `scale(1.012) → 1` over 560ms on the island curve — Godview's
open as it shipped — over the LIVE desk while its last frame is captured; the desk's STILL, blurred
once, then swaps in under the cover and the desk freezes (§8, the covers over the desk): a cover
covers, so it takes M5's freeze (a sheet takes no gate). The still recedes to `scale(0.98)` over 560ms
on the island curve, transform only; the field itself never recedes under a cover. Between covered
views the cover stays put and only its content changes, in place: a 180ms `ease` fade, no second
settle. Back to Canvas the cover lowers — the rise reversed, 240ms out to 1.012 — and the desk thaws
first and shows at once, at scale 1, under it, the still dropped. **The frame never moves**: only
the views track's thumb travels (300ms, island; §8). Reduced motion (M6): fades only, halved — the
cover 120ms, its content 90ms; no settle, no recede, the thumb lands without travelling or dipping.
*Amended 2026-10-07 (DK-16, as DK-15 built it — `field/desk/cover-still.ts`; plan addendum (64)):*
this said the field "recedes to `scale(0.98)` (600ms, island) and freezes" and, back to Canvas,
"comes forward and thaws". On the desk the scene no longer recedes under a cover — the still does —
so no transform reaches the desk's own box while a cover stands (a desk measured under a transform
drew ~2% small: ICE I39, fixed at desk.5); and back to Canvas nothing comes forward: the live desk is
shown at once under the lowering cover (DK-15's reading 1, ruled at (67)). The 600 here was the
island curve's morph, never the recede's (§8).

**The file pill's own curve retired (One Frame F14; 2026-10-03, FR-3).** The head's name pill grows
into the fields explorer as every other morph does — 600ms on the island curve (M1), the pill's own
row staying its head — and the 560ms `cubic-bezier(0.32, 0.72, 0, 1)` it alone carried is gone. The
head's menus grow from their control on the island curve in 240ms (the zoom's from the readout, the
palette from the head); the zoom's folds at once, as @'s list does, and the palette fades out over
200ms `ease`. Reduced motion fades them in over 120ms at full size.

**The edges and the corner (One Frame §10, §12; FR-4, 2026-10-03).** Over a covered view a notch
rests as its **sliver** (§8, edge trays) and on approach — the pointer reaching the 8px it rests in,
or the keyboard's focus — becomes the notch in **240ms on the island curve**: ONE path morphing (M1),
the sliver's 7 × 96 drawing into the notch's 26 × 116 (both drawn by the notch's builder, so every
point has a partner), its hit box growing with it, and the glyph and the count fading in over 160ms
plain `ease` behind it; leaving, it goes back the same way. A notch reached that way opens its drawer
only once it IS the notch: its hover delay is the growth plus the notch's own (240 + 120ms). On
Canvas the notch rests whole and nothing grows. **The Me menu** grows upward on the island curve
(600ms) from a seed the size of the face's circle at its own foot, above the face, the surface
fading in over 160ms and the rows rising nearest-first as before (§8); folding reverses it, and the
face, which never moves, stays lifted while it is open. Reduced motion (M6): no growth anywhere —
the sliver becomes the notch at once, its glyph and count fading in over 120ms, and the Me menu
fades in whole over 120ms.

**Search (the Peek; One Frame §23, GV-D8; built 2026-10-08).** The popup pops in over **260ms on
the island curve** from 2% above its place at 0.97 (`translate(-50%, -48%) scale(0.97)`), fading in
with it; the scrim fades in over 240ms plain `ease`; the view **and the frame** recede to
`scale(0.98)` about 50% 46% of the window over **420ms on the island curve** (M5's recede; the
window is already covered, so nothing new freezes). What recedes is what you see — **the cover,
the still under it and the frame's chrome, together** in one box the size of the window — and
**never the desk's own box** (DK-15, above: no transform reaches the desk while a cover stands);
at rest that box carries no transform, so it stacks and takes the pointer as if it were not there. Folding, the popup goes at once — what you picked is already opening
behind it — the scrim fades out over the same 240ms and the window comes forward over the same
420ms. Reduced motion (M6): no pop and no recede — the scrim and the popup fade in over 120ms.

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

*Retired 2026-10-07 (DK-17; DK-0d's erratum, executed):* the overlap glow and rim knobs — the
`--ic-glow-*` and `--ic-rim-*` CSS vars Studio tuned — were the DOM card's, and the desk draws no
DOM card (DK-D2). They left `tokens.css` with the card itself, its `card-appearance` defaults and
the appearance document's `overlapFeedback` (the document is v4 — the plain ground alone, §2.1).

**On the desk the living states are the kinds' and the mat's** (ICE design-015 §7–§8; DK-D2, R22;
*rewritten 2026-10-07, DK-17* — this paragraph read "in the composited profile", 2026-09-07, a
profile that never shipped, §5): hover is a rise, never an outline; a drag lifts and carries the
object; a sole selection wears the pencil brackets 6 out and several one union, so the select ring
stays the chrome's focus (MC-4); a picked-up object rises into the hand (§8, tools in hand) while the
desk behind it goes out of focus. The table above is the DOM card's, which the desk does not draw —
its hot-point glow and rim left with the card (above); its last two rows are the chrome's.

---

## 8. Component canon

- **Card anatomy** (CardShell, landing in `@vibefield/design-kit` — 03·A D14): rounded-22
  clip → content → glow layer → rim layer → ring layer. Chrome layers are
  `pointer-events: none` and ride the base transform. Header = eyebrow row (label left,
  meta right). Every widget ships a **compact face** for the zoom readability floor
  (03·A D15): title + badge, no micro-text.
  *Erratum 2026-10-03 (DK-0d, against the desk):* the DOM card under the camera ends with the desk
  (DK-D2, ruled 2026-09-25; ICE design-015 §2): on the Canvas view no widget is a DOM tree in a
  DOM plane — an object kind draws its face, its compact form at a small zoom, its shadow and its
  lift on the GPU, the mat's marks are its selection (the desk's chrome, below), and the only DOM
  over the desk is screen-space chrome and the one focused editor. *Retired 2026-10-07 (DK-17):*
  CardShell and this anatomy left the design kit with the 0.11 canvas — the record of the card that was.
- **HUD island**: one morphing element (§6 M1), island material, centered-bottom;
  `64px` closed; opens to a sheet with pull bar (48×6 rounded-full, `black/20`),
  morphing ⊕→✕ (135° rotation), edge-fade scroll masks, no visible scrollbars.
  *Retired into the line 2026-10-03 (One Frame FR-2; DK-D29):* the closed pill is gone — its 48px
  ⊕ disc, its Select · Pan · Wire switch and its ✨ Clean up with it (Select and Pan stay on V and
  H, Wire on C; Clean up waits for the selection bar's More, on the desk) — and the line's create
  is the door: Objects (B) raises the SHEET behind the line, and the create's ⊕ is what turns to ✕.
  The sheet is the old catalog, unchanged (the backdrop, the recede and the stage hold, the category
  pills, the drag-out insert, its pull bar), a transitional door until the desk's pegboard replaces
  it (DK-13).
  *Erratum 2026-10-03 (DK-0d, against the desk — R14, R21):* on the desk the sheet goes too: Objects
  raises the pegboard (below) — the desk's own drawer, behind the line — and **the tray island and
  its state are deleted at DK-13** (R21), the catalog's tiles, its category pills and its drag-out
  insert with them, as are §4's tray grid (132 cells, 18 gap) and §5's tray-tile shadow; DK-17
  sweeps what remains. The pegboard keeps none of the sheet's backdrop, recede or stage hold: the
  stage neither recedes nor dims behind it, the desk dimming under the board itself (R14). Select
  and Pan retire too — the desk's one tool pans the bare mat and with Space — C no longer connects,
  and Clean up is More's (DK-D29, DK-D24).
- **Artifact Hub side panel** (AH-3/4; amended 2026-08-03): a `vibefield.browser`
  contribution inside the spine-owned `hud.side-panel` stage, separate from the bottom island.
  Its persistent 40px round toggle is the outermost control in the top-right chrome cluster:
  zoom pill · theme · Artifacts, with 8px gaps, anchored `top-4 right-4`. It uses the floating
  round-button recipe and the inverted active state; the same button toggles open/closed and
  carries the matching tooltip/accessible name. *Since 2026-10-03 (One Frame FR-3) that cluster is
  the head's right slot — the zoom readout · theme · Artifacts, 8 apart, on the head's axis
  (`top-2 right-4`) — until FR-4 moves the toggle behind the right notch (FC-D10).*
  *Retired into the right edge 2026-10-03 (One Frame FR-4, FC-D10 — closes D-7; F10):* the toggle
  and the 26rem stage below are gone. The right notch (`package`) is Artifacts' only door and its
  drawer holds the SAME contents — the `hud.side-panel` contribution, mounted in the drawer's
  152-wide column (edge trays, below) — where the panel reads in its narrow form: the plugin's own
  stylesheet answers a narrow container (under 200 wide) by stacking each row into a 128-wide card,
  the preview on top (16:10, full width), the title, the fact line and the status below, the
  overflow on a chip over the preview, the Add step's choices stacked; the wide form below stays
  for any host that is wider. Escape, focus back to the notch, plugin disable or hot-reload folding
  it, and M6 stand as written; the spine's arbitration is the frame's one owner now (§10).
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
- **Edge trays — the notch and its drawer** (2026-09-23, James; the record is
  `draft/composer/compact.html` §15–19 and `compact.md` Parts II–IV): a spine-owned tray on the
  window's LEFT edge — the **clipboard** — with its twin on the right reserved for Artifacts
  once D-7 is ruled. The **notch** (N1) sits at the edge's mid-height: 26 × 116, one path drawn
  FROM the wall — a concave fillet of 12 into the edge, a convex face of 14 — in the theme's
  solid chrome with the strong hairline, the island shadow at rest; the glyph (16px) and the
  count (9px mono) on the text ramp. Hover widens it 15% from the wall on the island curve;
  the pin is a 1.5px ring in `--vf-foreground` (§2.3: 1.5px is a selection ring). The
  **drawer** (P4) is the same path at 152 wide — a fillet of 18 into the window's edge, a face
  of 22 — from `top-16` to `bottom-20`, opaque solid chrome, the hairline along the whole
  silhouette and GAPPED under the notch so the two outlines are one line; the edge shadow
  (§5) when open, cast by the whole. The notch rides the panel's outer edge, so its fillets
  always flare into whatever wall is there. Inside: ONE column of 128 × 128 tiles with 10px
  between them, grouped by day under a 9px mono caption, dealt in 26ms apart on the island
  curve; no head, no find line, no pills — the notch carries the count and the pin; typing
  while pinned filters. Hover opens after 120ms and closes after a 320ms grace; click pins;
  ⇧⌘V pins from the keyboard; Escape unpins. Non-modal like the Artifact panel: no backdrop,
  recede, stage hold or focus trap. A capture (SNAP-3) **flies in**: a ghost of the still
  travels from where the capture was to the notch on the island curve (560ms), shrinking along
  its travel (M4), then the notch bumps on the pop and the count ticks; reduced motion fades it
  at the notch (M6). The column ends with the **Snap** tile, the product's door to the capture,
  disabled with the honest word when the door is absent or refused.
  **Both edges, every view (One Frame §10, FR-1, FR-4; FC-D10; built 2026-10-03):** the clipboard
  on the left as above, and **Artifacts on the right** — the twin, mirrored, its notch wearing
  `package` and no count (the catalog's count is the plugin's to say, in its own header inside the
  drawer), its drawer the Artifact Hub's column (above); the head's Artifacts button is gone. With
  no Hub bound (its plugin off or reloading) there is no right notch — a door to nothing would lie,
  as the side panel's toggle had the same rule — and an open drawer folds with it. The
  notches' tooltips say their keys (FR-5): "Clipboard  ⇧⌘V", "Artifacts". **Over a covered view**
  (Godview, History) a notch rests as a **sliver** — its own 7 × 96 path from the notch's builder,
  a fillet of 5 into the wall and a face of 2, in the same solid chrome with its own strong
  hairline and the island's drop, glyph and count hidden — in the 8px the view keeps clear at each
  edge; **its hit box is the sliver** (no wider target), so a pane's text beside it never takes a
  stray press, and on approach it becomes the notch (§6: 240ms, island; its hover delay the growth
  plus the notch's own); on Canvas it rests whole. The edges are the frame's, not the canvas's:
  they stand above the cover with the line (§10), so a drawer opens over Godview's deck or History's
  room as it does over the field. **One owner:** each drawer is one of the frame's open surfaces
  (§10) — opening one, by hover or by pin, folds @'s list, Objects, the fields explorer, the zoom's
  menu, the palette, the Me menu and the other drawer, and any of them opening folds it (F11). A
  drawer that holds the keyboard's focus — a field in the Hub's Add step — stays open when the
  pointer leaves it; Escape folds it and gives focus back to its notch.
- **Segmented control**: full-round track in `--vf-fill`, sliding solid thumb
  (white / `#2C2C2E`, hairline + `shadow-sm`), 300ms island ease; labels 13px medium,
  active full-opacity, rest `/50`. A **small** size (26px thumb, 11px labels) for a switch that
  sits inside a composition rather than heading a section — the face's Sticker / Coin in Setup,
  and the Me menu's Theme, Light · Dark · Auto (FR-4).
- **The views track** (One Frame FR-1; FC-D2, FC-D4, FC-D11, FC-D17 ruled 2026-10-01; built
  2026-10-03): the frame's way to each view (§10), the segmented control at the line's left end.
  Four cells — Canvas (`canvas`), Godview (`panes`), History (`history`), and Assistant (`message`),
  whose cell waits, faint by ink (the faint text at 55%), named "not built yet" — each **printing
  its key under its glyph**, the way a Mac keyboard prints F1 under its brightness mark. Cells
  46 × 36 on a 48 pitch (the track 196: padding 3, gap 2), the glyph 15 (the views' glyphs at rest
  tertiary, secondary under the pointer, primary on the cell that is on), the key 3 below it at 9 —
  the digit 600 in secondary ink, the ⌘ 500 a step lighter in tertiary, both a step darker on the
  cell that is on or hovered. The track is `--vf-fill` (by night the foreground at 9%); the thumb is
  the segmented thumb (`--vf-chrome-solid`, the hairline and `0 2px 6px` black/8; by night the
  foreground at 20%, no shadow) wearing a key's skirt — a 1.5px black/10 lower edge, and by night a
  0.5px white/10 top light over a black/55 skirt — because the button is the key. It slides 300ms
  on the island curve. **⌘ held alone for 400ms** (so ⌘C and ⌘V never light it; another key with ⌘,
  a pointerdown, a wheel or the window's blur puts it out): the keys go primary and the glyphs to
  45%, in 160ms. **⌘ + a digit** presses its cell: the thumb slides and lands with a 1px dip (240ms,
  the lift curve); ⌘4 says "Assistant · not built yet" over its cell for 1.4s — solid chrome, 12px
  medium in secondary ink, the strong hairline ring and the island shadow, rising 4px as it fades
  in — and nothing moves. On Windows the keys read Ctrl 1…Ctrl 4. A cell carries its key in its
  tooltip and its accessible name (`aria-keyshortcuts`); how the keys reach the frame is §10's.
  *As built (FR-1):* until the line exists the track sits alone in the line's material (§5) — a
  208 × 52 pill, padding 5 × 6, at the line's left end (§10) — so the line can grow around it
  without the track moving. *Folded into the line 2026-10-03 (FR-2):* the same track and keys at
  the line's left end, on the line's glass; its own pill is gone, and nothing about it moved.
  *Amended 2026-10-27 (track AO, AO-D8 ruled by James):* while History imports, its cell carries
  **the arc** (§6): a fifth of the clock's own circle travels it once every 1.1s on the island curve
  over the glyph at a third of its ink, until the room says the archive is ready. It carries no
  number, never a badge or a count, and its accessible name adds "importing" ("History, importing").
  The cell is otherwise unchanged and still presses at once.
- **The line** (One Frame FR-2, FR-3, §5; FC-D1, FC-D3, FC-D14 ruled 2026-10-01; built
  2026-10-03): the frame's foot (§10), the same in every view — `[views] create │ draft mic send`,
  the composer as one product composition. 880 × 52 on the line's glass (§5), padding 5 × 6, its
  pieces 2 apart and centred on the foot axis. From the left:
  - **the views track** (above), its left end;
  - **create** — 32 round in the ready fill (the foreground at 8%; 14% under the pointer, where it
    grows 1.06 on the pop curve), 6 clear of the track, its glyph 16 in secondary ink (primary while
    open or hovered). It is the view's own act (FC-D3), and only Canvas's is a bare plus (FR-3):
    **Canvas — Objects** (`plus`, B): the objects rise behind the line and the plus turns 135° into
    ✕ over 600ms on the island curve; **Godview — New terminal** (`start`, ⌘T): a fresh shell, which
    shows its launcher, placed as a session with no pane is (the deck, below; GV-D4) — in the
    focused pane, whose session runs on (*corrected 2026-10-18*, GV-D4 re-ruled: it opened beside
    the focused pane while fewer than three panes showed); **History — Resume**
    (`resume`): waiting, faint by ink as
    the Assistant's cell is, until a session is chosen — and **Jump to** (`jump`) while the chosen
    session runs on this desktop (§8 "History", 2026-10-08). Between views the glyph cross-fades in
    place, 200ms `ease` (One Frame §12), and so does History's between Resume and Jump to; the
    tooltip says the act and its key ("Objects  B", "New terminal ⌘T", "Resume this session —
    choose a session first", "Jump to this session"), open it says "Close  Esc";
  - **the rule** — 1 × 18 in the strong hairline, 8 after create and 6 before the draft;
  - **the draft** — an editor, not a field: 14px body (§3 — the page drew 15, off the ramp, F15) in
    primary ink, padded 10, one line that keeps the caret in view (typing past one line is the
    page's next drawing, One Frame §21, and is not built). Its placeholder, tertiary, teaches the one
    way in at rest — **"Message, or type @ to add…"** in every view (the page's own ruling of its
    text, One Frame §21) — and once a chip aims it, says who it goes to: **"Message vibe-field…"**;
  - **mic** — 36 round in the ready fill, `mic` 17. The desktop has no dictation door yet, so the
    mic waits, faint by ink, and says so in its tooltip ("Dictation — not on the desktop yet");
    nothing is faked;
  - **send** — 40 round, 4 after the mic, `arrow` (up) 17: the ready fill and tertiary ink while there
    is nothing to send, **inverted** (`--vf-foreground`, the inverse ink) once there is (D1). Return
    sends.
  **@ is typed, never a button** (FC-D1; no attach button either). An @ typed at the start of a word
  opens **@'s list** — a menu (§5: solid, the strong hairline, the island shadow, corners 18,
  padding 6), 316 wide, grown upward from the caret (its left 10 before the @, its foot 8 above the
  line), read bottom-up, nearest first: **Send to** nearest the line ("Send to a pane" in Godview,
  where the panes lead) — what the deck shows, each named by its folder as the swarm names its body,
  with what runs there and its state word; above it **Add** — From the clipboard (its three newest as
  34px thumbnails, corners 8), File…, Capture…, Past session…. Rows 36 tall (Send to's 46, a name
  over a small line), corners 12, 13/500; eyebrows 10px mono capitals in tertiary ink; the hot row
  in the ready fill. Typing after the @ filters both groups; ↑ ↓ move, Return or Tab takes the row,
  Esc closes the list and keeps what was typed. A row with no door behind it says why and cannot be
  taken (File… "no file door on the desktop yet", Past session… "History is not wired yet") — never
  faked. A paste or a drop lands at the caret, as plain text. *Corrected 2026-10-03 (AR-8c):*
  History is wired — it is rosetta's room (below) — but a past session still has no door into a
  message, so Past session… says "no past-session door on the line yet".
  **The chip** (D1, ruled 12 Sep): a token in the sentence, 24 tall, corners 7, 12.5/500, its glyph
  13, padded 0 8 0 6, ringed 1px; it never splits a word, Backspace takes it as one character and ×
  on hover removes it. A capture wears `capture` on the select blue at 14%. **The aim** — a Send to
  row taken — is the chip that leads the draft (`@vibe-field`, the fill, primary ink): the target is
  always named (CB-1), and it stays across sends until changed or removed.
  **Send, until the agent seam** (thinking-four-views §11, the interim send): aimed at a pane the
  deck is showing, the draft is PASTED into that pane's input — the road ⌘V takes, bracketed, Return
  never pressed for you — and the line's note says "Pasted into vibe-field"; otherwise it goes to the
  clipboard, and the note says that and why: "Copied — no agent takes a message from here yet". When
  the aimed pane cannot take it, the draft is copied all the same and the note names the pane and
  its reason: "Copied — vibe-field's pane is not on screen" while another view is up, and "Copied —
  vibe-field's pane is not taking input" while the pane is shown and its input is closed (a terminal
  still reopening after a change of view, a read-only one), where a paste would be dropped. "Pasted
  into" is never said for a paste the pane did not take. *Corrected 2026-10-11:* it was said while
  the pane's input was closed, and the paste was lost. A paste larger than a terminal can take — ⌘V
  into a pane — is never dropped unsaid either: the note says its size and how much of it one paste
  carries, both as Finder counts the text (§9 — its own bytes, in thousands; its tabs, quotes and
  control characters cost the link more, so the second figure is this paste's, "of it", not a fixed
  one), the size rounded up and what fits down so the two never read as equal — "Not pasted into
  vibe-field — 300 KB, and one paste carries 261 KB of it". Typed text that large says "Not typed
  into vibe-field — 300 KB, and typed text carries 261 KB of it"; a session no pane of the deck
  shows is "the terminal". The phone's terminal card says the same sentence, with "the terminal" for
  the name and the limit its leg negotiated, so one paste reads alike on every device. A draft SENT
  that large is copied, as any aim the pane cannot take: "Copied — too large for vibe-field: 300 KB,
  and one paste carries 261 KB of it" — the pane's handler claims the paste it refuses, so "Pasted
  into" is never said over that refusal. Each is under 70 characters beside the pane's name, to be
  read in the note's 2.4s; what to do next is in its numbers. The
  note is the views track's note (solid, 12/500 in secondary ink, rising 4px as it fades in), over
  send with its right edge on send's (so a long sentence grows leftward, never past the window's
  right edge) — or, for create's outcomes ("Terminal opened in the active pane": it takes the
  focused pane, GV-D4 — "… in a new pane" retired with the re-ruling of 2026-10-18), centred over
  create — for 2.4s. *Corrected 2026-10-18:* this said a long sentence never leaves the window; in
  a window too narrow for it, its first words run past the left edge. Sending clears the draft's
  words and chips and keeps the aim.
  **One surface at a time, at the line** (One Frame FR-4, F11): @'s list and the objects are ONE
  owner's two surfaces — opening either folds the other — and Settings, the palette, the docs
  explorer, the Artifact panel and the Me menu fold them as they folded the tray. The Me menu and
  the edges' drawers join the owner with FR-4. *Since FR-3 (2026-10-03) the owner is the frame's,
  not the line's: the head's three surfaces — the fields explorer, the zoom's menu, the palette —
  are in the same one value (the head, below). Since FR-4 (2026-10-03) the Me menu and the two
  drawers are in it too (§10).*
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
  painted as a **mini mat** — the lattice at a quarter (§2.1) — under the board's **still** as it
  lands: the document's picture through the capture door, never the person's selection, taken
  without the selection's marks (ICE I23, I40 — `capture({ scale: 0.25, marks: false })`; DK-D27);
  name 12px medium, relative time caption in `tabular-nums`; the CURRENT doc wears the 1.5px inside `--vf-select`
  ring (it is the selection); hover 1.03 / active 0.95. **The sync dot (C6-4):** a 6px
  dot after the pill's doc name for STANDING sync states only — pending / peer-offline
  (muted grey `rgba(128,128,128,0.45)`) · peer-declined / epoch-stale (`--vf-orange`);
  in-step and transient syncing render NOTHING here — the signature chrome never
  flickers with routine traffic. The title carries the words, numbers, and the
  last-exchange time. Explorer tiles append the honest sync word to their time caption
  ("· syncing", "· waiting on 3", "· peer offline") only when there is one.
  *Its ⊕ retired 2026-10-03 (One Frame FR-3: one plus — the line's create on Canvas is the only
  bare plus on screen):* the pill keeps the name and the chevron, and **New field** is the
  explorer's first tile, in words — a doc tile's footprint whose face is the fill inside a dashed
  strong hairline, the words 12/500 in secondary ink at its centre, hover 1.03 / active 0.95 like
  its neighbours. The empty explorer says "No fields yet" in words beside it, never "⊕ creates
  one". *Became the head's name pill 2026-10-03 (One Frame FR-3, below):* its place (`top-4`,
  280 wide), its single-click rename, the separate breadcrumbs beside it and its own 560ms curve
  (F14 — this entry already said the island's 600ms) retired; the explorer, its tiles, New field
  and the sync dot stand, as written here.
  *History of the tiles' face:* a mini empty field — canvas-bg and the §2.1 CSS-fallback dots, the
  ground motif as the doc's face until real thumbnails (B4); the board's still since DK-4 (2026-10-03,
  DK-D27); a mini mat under it since DK-16 (2026-10-07, §2.1's erratum); the still without the
  selection's marks since DK-17b (2026-10-08, ICE I40).
- **The head** (One Frame FR-2 "the head says where", FR-6, §4, §6, §7; FC-D8, FC-D9 ruled
  2026-10-01; built 2026-10-03, FR-3): the frame's top (§10) on the lights' axis — every control
  40 tall at `top-2`, centred on y 28. On Canvas the left slot (from 96, clear of the lights) is
  empty, **the name pill** stands centred on the window and **the zoom readout** at the right, 16
  in. No keycaps and no plus anywhere in it (FR-3, FR-5; F1, F2).
  - **The name pill** — the line's glass (§5), corners 20, padded 0 6 0 16: the field's name at
    13/500 in primary ink, then **the chevron** — a 28 round button, `chevron` 12 turned down in
    tertiary ink (the ready fill and primary under the pointer) — which grows the fields explorer.
    **A double-click renames** in place, as do Return and Space on the focused name: the name
    becomes an input with no border, on the ready fill, corners 6, as wide as what is typed, all of
    it chosen; Return or leaving commits, Esc reverts. The sync dot (C6-4, above) follows the field's name. **In another
    window's place** (DK-9): when the board a window asked for — its own, reopened under a new
    renderer — is held by another window, the window shows an empty in-memory board that saves
    nothing, and the pill says so: the name reads **"In memory"**, never renamable, and the dot is
    `--vf-orange` (attention, nothing failed) titled "“Studio desk” is open in another window — this
    window's board is in memory and saves nothing". A new window never lands here: it opens the
    most recent board no window holds, else a new one. **Inside a
    folder the crumbs fold into the pill** (FC-D9): `Studio desk › Sketches` — the earlier names
    are buttons in tertiary ink (primary under the pointer) that go there in one flight, a
    `chevron` 11 in faint ink stands between names, and the last is the name; **Esc goes up one**,
    said in the parent's tooltip. **At the field's top it is one name**: no back button, no "Root"
    (F12). **FitPath** (One Project, Many Places): the pill stays centred on the window and never
    wider than the window less the wider side's slot on both sides; a path too long for that drops
    whole leading names, one at a time, behind a `…` that is itself a button (it goes to the
    nearest name it hides, and its tooltip names them all) — never a name cut mid-word (F13). Only
    the last name, if even it alone cannot fit, ends in an ellipsis.
  - **The fields explorer** grows FROM the pill (M1): one element, 600ms on the island curve,
    still at `top-2`, to `min(56%, 34rem)` × `min(46vh, 420px)` (544 wide at the default window),
    corners 22 22 40 40, the sheet tier (§5) ringed by the strong hairline with the top sheet's
    shadow; the backdrop dim and the field's recede behind it, as before (no stage hold since DK-17 —
    M5: the desk keeps its own idle). Its head
    row is the pill's own: the field's name and the chevron turned up ("Close  Esc"). Below, the
    doc tiles (the file pill, above) in three columns, **New field** first, in words. Esc or the
    dim closes it.
  - **The zoom readout** (FC-D8; Canvas's one instrument): at least 66 wide, the line's glass,
    corners 20, the zoom as one number at 13/500 `tabular-nums` in secondary ink (primary under
    the pointer or while its menu is open). **A click grows its menu** (FC-D14, §5: solid), 4
    under the head with its right edge on the readout's: 196 wide, corners 18, padding 6 —
    **Zoom in ⌘+ · Zoom out ⌘− · Zoom to fit ⇧1 · Actual size ⌘0**, rows 36 tall at 13/500 with
    each key at the row's end (11/500, tertiary: said, never printed — FR-5), the hot row in the
    ready fill (the first, until the pointer or ↑ ↓ moves it); Return takes it, Esc or a click
    elsewhere folds the menu. **A double-click fits.** In and out step ×1.25 and ×0.8, as the old
    − + did; to fit frames everything in the folder you are in; actual size is 100%. Off the Mac
    the keys read Ctrl+Plus · Ctrl+Minus · Shift+1 · Ctrl+0. The − % + cluster it replaces
    retired with its text marks (F2, F9).
  - **The palette** (⌘K, in every view): a solid panel (§5, corners 22, padding 6 6 8), 560 wide,
    centred under the head at `top-16` (64), over the stage — never over the line, which it ends
    8 above. Its field heads it: 46 tall, `search` 16 in secondary ink and the words at 14 (§3;
    the page drew 15, F15) under the strong hairline — "Type a command or a view…". Below it every
    act, **its key at the row's end**: **Views** — Canvas ⌘1 · Godview ⌘2 · History ⌘3 ·
    Assistant ⌘4, which waits ("not built yet"); **On this view** — the line's create (Objects B
    on Canvas, New terminal ⌘T in Godview, Resume this session in History, waiting until a session
    is chosen — Jump to this session while it runs here, by the line's own reading), on Canvas
    the four zoom acts, and in Godview **System control**, the one act with no key (GV-D1,
    2026-10-11: it left the instrument bar for the palette — §8 "Godview's head — Stories");
    **App** — Settings… ⌘,; then each enabled
    plugin's palette commands under the plugin's name, one no live handler answers drawn
    "unavailable" and never run. Eyebrows 10px mono capitals in tertiary ink; rows 36, a 16 glyph
    in a 24 column in secondary ink (the zoom acts and System control carry none), 13/500, the
    hot row in the ready
    fill; a row that waits says why under its name. Typing filters every group; ↑ ↓ move,
    Return runs, Esc or the dim closes it. The prose footer ("↵ to run · esc to close") retired
    (F7, F15): the keys are said in the rows. The backdrop dim behind it, no recede.
  - **One surface at a time** (FR-4): the explorer, the zoom's menu and the palette are three of
    **the frame's open surface** — the line's owner, renamed now that it holds the head's too:
    `objects · @ · fields · zoom · palette`, one value, so opening any one folds the rest by
    construction; Settings, the Artifact panel and the Me menu fold them and are folded by them as
    before. A change of view folds whichever is open.
  - *As built (FR-3, 2026-10-03):* until FR-4 moves them, the theme button and the Artifacts
    toggle stand beside the readout in the head's right slot, 8 apart, on the head's axis where
    the cluster stood (FR-4 takes the theme into the Me menu, FC-D5, and Artifacts behind the
    right notch, FC-D10). The head is still the canvas's own chrome: it lies under the cover with
    the field, and Godview's and History's heads are their own bands (FC-D6). Full screen's left
    slot (16 rather than 96) waits for a host signal; none exists.
  - *Since FR-4 (2026-10-03) the right cluster is GONE:* the theme went into the Me menu (FC-D5,
    F3) and Artifacts behind the right notch (FC-D10, F10), so the head's right slot is the zoom
    readout alone, 16 in, and the pill gives up only the wider of the lights' 96 and that slot.
- **Godview's head — Stories** (One Frame §23, round 3; GV-D1 ruled 2026-10-02; MV-D16 marks only,
  ruled 2026-10-03; N12 (a) and N13 (a) ruled 2026-10-11; built 2026-10-11): the monitor's views
  switch in a row of glass circles on the frame's head row (the head, above) — every circle 40 at
  `top-2`, centred on y 28, 12 apart, **the row centred on the window**. It is the monitor host's
  chrome, drawn in the frame's language. **It wears the frame's theme** — the app's, as the search
  button beside it does, also where Settings → Terminal → Look holds Godview's own mode (§1.1) —
  and stands over the terminals' sheet and over Godview's scanlines and vignette: the frame's glass
  carries neither.
  - **A circle** is the line's glass (§5) with its hairline, the island shadow and the line's
    lift. It holds its view's **mark** from the view's manifest (MV-D6): filled, in a 22 box
    centred, in secondary ink; primary on the current view and under the pointer or the focus.
    **Marks only** (MV-D16): never a still, never a second running view. A view whose manifest
    draws no mark shows its label's initial, in the label's 12/500.
  - **The current view's ring is the circle's own edge**: 2 in primary ink inside its 40, in
    place of the hairline. Nothing grows, shifts or clips. Under the pointer or the keyboard's
    focus, another circle's edge is 1.5 in tertiary ink. The edge changes in 120ms.
  - **Its name is said under it** while the pointer or the focus is on it: a solid label
    (`--vf-chrome-solid`, FC-D14) 24 tall, 8 under the circle and centred on it, corners 12,
    padded 0 10, ringed by the strong hairline, with the island shadow. The name is 12/500 in
    primary ink — the view's manifest label, said in sentence case (§9): the instrument's SWARM is
    said Swarm; 6 after it come **the keys the view takes while it is focused**, 11/400 in tertiary
    ink (M177: this label is where a view's focus keys are said, as the bar's tooltip was). It
    appears in 140ms, 3 down into place, and never covers the next circle's ring. The circles
    have no keys of their own.
  - **The row never crowds the head's ends.** It keeps one head gap (12) from the lights' slot
    (96) and from the search button (§8 "Search — the Peek"), also while a filter's token widens
    that glass. It shows as many WHOLE circles as fit, nine at most. Past that it **pages by
    whole circles**, three at a time, in 320ms on the island curve, with a 28 glass chevron on the
    same axis outside each end that has more. 700ms after the pointer leaves the head it comes
    back to the page that holds the current view.
    *As built (2026-10-11):* a chevron is the line's glass, 12 from the row, holding `chevron` 12
    in secondary ink (primary under the pointer); it comes and goes in 160ms, and its place and
    gap come off the room before the circles are counted. A row that pages clips 10 past each
    end — under the gap, so no neighbour shows — along the row alone, so the shadows keep their
    room. A row that shows fewer than three turns by what it shows. A circle the keyboard reaches
    off the page turns the row to it, and the return never moves a page from under the
    keyboard's focus.
  - **There is no "Add a view" circle** (N13 (a)): nothing adds a view yet, and a control that
    opens nothing is not drawn. It returns with that flow, last in the row.
  - **The stage runs under the head**, to the window's top. A view keeps its words and controls
    clear of the head's reserve, **56** (the head's foot at 48, plus 8), through the stage's top
    inset (§8 "The monitor view owns its drawing").
    *As built (2026-10-11):* the reserve is `--vf-godview-head-reserve`. The stage's own chrome —
    the usage column and the claims strip — begins at it, where it began 11 under the bar. The
    swarm steers by the stage's obstacles and reads no inset, so the reserve is the first of
    them, the band across the stage's top. *(Corrected 2026-10-12: this said "its bodies keep
    below the head as they kept below the bar". They do not, and they never did. The swarm's crowd
    is bigger than its field (no body is smaller than r 50), and its physics lets the crowd past
    every edge, a band as thick as a wall included. Under the bar the swarm spilled above the
    stage's top too, and the bar and the stage's edge hid it. Measured in
    `draft/monitor-view-sdk/evidence/swarm-probe-15bfb9ae`.)* The rain is a picture with no words or
    controls of its own; it runs under the head too.
    The terminals' edge rests where it rested: the monitor's rest height takes up the bar's 40.
  - **The field dissolves under the head** (2026-10-12; James: "Fade now + sizing later"). The
    stage is masked from clear at the head's axis, **28**, to whole at the reserve, **56**
    (`--vf-godview-head-fade-from` → `--vf-godview-head-reserve`), whatever the view. What a field
    draws in that band, the swarm's crowd or the rain's ground, fades out under the glass instead
    of standing beside the circles. The stage's own chrome begins at the reserve and is never
    faded. It is the stage that is masked, never the head beside it. Past the swarm's floor (the
    next point) the fade still takes what spills. *(2026-10-14: this said "Until the swarm sizes its
    bodies to its field (puppeteer's, owed), the fade is what keeps the head clear". It sizes them
    now.)*
  - **The swarm's crowd fits its field** (2026-10-14, puppeteer `d3e82aa`; James: "Shrink
    together", then "Pull takes the field's shape", which he reversed on 2026-10-19: "i'll go with
    A", puppeteer `fa0d6cf`).
    - **One shared scale.** Every body's base size (idle 50, working 60–80, blocked 50) is
      multiplied by one scale, *k*, never above 1. *k* solves Σπ(k·rᵢ + 4)² = 0.45 × the free area:
      the field less its obstacles, each padded by 7. It moves on a 0.04 grid: it shrinks at once,
      and grows only once the crowd's room clears the next step by 0.02, so a dragged window never
      makes it shimmer. It is refitted when the bodies, the field's size or its obstacles change,
      never per frame. The bodies ease to it on the swarm's radius spring.
    - **The floor is r 28** (*k* 0.56 at today's sizes). A crowd past it spills, as it did before,
      and under the head the fade takes it.
    - **The pull is round** (James, 2026-10-19 02:02Z: "i'll go with A, why is A been dropped in
      the first place?"). The swarm's pull toward the field's centre is the same along both sides,
      whatever the field's shape, so a body let go far out comes home in about half a second, as
      on the phone. The cost is the ball: in a short field the crowd's top row presses into the
      head's band. On James's Mac at today's packing, twenty bodies with the deck up (1712 × 393)
      tuck about 3 px under the head, 27 about 7 px and 40 about 14 px; with the deck away
      (1712 × 912) the crowd is clear up to 27. **James ruled (a), 2026-10-19 17:42Z: full size,
      the small tuck**: the packing stays 0.45 rather than give up size for clearance. A new body
      never spawns far out (spawns are searched within 28 % of the width from the centre).
      *(2026-10-19: this said "The pull takes the field's shape" — weakened along the free field's
      long side by the square of its short-to-long ratio, so under the head the crowd settled as a
      wide, low band, and a lone body from the far left took 13 s to reach another, 0.5 s round.
      James felt it live beside the round pull and chose the round one. A round crowd is clear on
      every measured field only at a packing of 0.08 (twenty bodies at the floor).)*
    - **The words step down, on three rungs by the drawn radius.** At r 50 and up a body draws
      everything, so a field with room changes nothing. From 50 down to 35 it draws its name and
      one line: its state when it has one ("Bash · …", "? Should …"), otherwise its model,
      otherwise the terminal's word. Below 35 it draws its name alone, centred. Figures, the
      branch, the clock and the burn row go at the first step.
    - **Measured on this field** (1164 × 288 under the head, puppeteer's own physics, settled 8 s):
      20 bodies settle clean at *k* 0.68, and 27 at the floor. Before, at full size, 27 bodies put
      8 in the band and 10 past an edge.
    - Spawns keep clear of obstacles, so a body is never born under the head.
  - **Maximized** (GV-D11) nothing of the head stands over the terminals' title bar: the row and
    its chevrons fade in 200ms and take no pointer.
  - **Reduced motion:** the row pages and the label appears at once.
  - **The window still drags by the app's strip** across the head's row; every circle and
    chevron is a control and never drags it.
  - **A head that fails** says "Monitor views unavailable" where the row stood, in the label's
    solid in secondary ink, and the stage and its view stay (§8 "The monitor view owns its
    drawing").
  - **What left with the bar:** the counters (FC-D18) and the ☼◐ switch (FC-D7), hidden since
    One Frame; the spacer for the window's lights, which the frame's head row already clears; the
    bridge notice's slot, empty since the bridge retired; and
    **System control**, now an act in the palette's "On this view" group while the view is
    Godview, with no key and no glyph — its panel is §1.1's temporary one, unchanged, and open to
    whoever could open it before.
- **The Me menu** (UA-D19, ratified 2026-09-22 — Where You Sit II, design 2B): the owner's
  face replaces the Settings gear at the bottom-left (`bottom-4 left-4`; Godview stays beside
  it, `hud.panel` above both — *Godview's button retired 2026-10-03, FR-1: its cell in the views
  track is the way in*) and is the account's one door. A 44px button holds the 40px face
  (§2.8). Around it sits a 56px circle — `--vf-hairline` on hover (§7's fill step), invisible otherwise — and
  **that circle is the menu**: a click grows it (M1) on `--vf-ease-island` 600ms into a
  256px-wide panel of solid chrome (`--vf-chrome-solid` — opaque, nothing shows through;
  *changed 2026-09-22, James: "do not make it transparent" — it was island material*) with the
  island shadow and a hairline, its corners 28px so the arc stays concentric with the face. **The face never moves** (M2): the panel
  opens up and to the right around it, so the second click lands on the same face and folds it
  away. It reads bottom-up, nearest first: *you* (the name and login beside the face; clicking
  them opens Settings → Account) · Settings… `⌘,` · Link Tailscale account… (only while
  unlinked) · New user… (wearing `person` — *it wore a plus until 2026-10-03, One Frame FR-3*) ·
  then, under a "Switch to" eyebrow, the other users — a 26px face,
  the name, the tailnet as one mono word, and "N waiting" in words after a 6px orange dot. A
  machine with one user shows no switch list. Faces and row icons share one 44px column
  centred on the owner's face. **Choreography** (§6's constants): the surface fades in over
  160ms plain `ease`; the name and login reveal 140ms behind the shape (240ms `ease`, sliding in 6px); rows
  fade and rise 4px nearest-first, 160ms + 26ms per row (cap 400ms); the face stays lifted
  while open. **Closing reverses it** (M4): the content goes in 120ms, the shape folds from
  80ms over 600ms, and the surface fades as it reaches the face. Return/Space opens it with
  focus on Settings…, the nearest act; arrows move. Esc or a second click folds it and returns
  focus to the face, as does anything else that folds it while focus is inside (`⌘,`, the tray's
  Settings…); a click outside folds it and leaves focus where the click put it, and Tab folds it
  on its way out. It is a menu, not a sheet — no dim, no recede — but it is one of
  the spine's expanded surfaces: opening it folds the tray or the docs explorer, and they fold
  it. Reduced motion: a 120ms fade at full size (M6).
  **Settings stays the centred dialog, headed by you.** Settings… (or `⌘,` from anywhere)
  opens it while the menu folds. The sidebar's head is the account card — the 40px face, the
  name, the login; it opens the Account page — in place of the gear tile and the word
  "Settings"; the other users sit under it as 24px faces, each with its waiting count, and a
  switch main refuses is said under them in its words; and the Account nav group is gone,
  because the head is the account. **The head is one tile** (*refined 2026-09-22, James: "self
  contained and seperated from below sections"*): the card, the switch row and any refusal sit
  inside the Settings sections' own material — the hairline, the whisper fill, 18px corners —
  with a hairline between the card and the switch row, and the tile stands 12px clear of the
  nav, so the switch row never reads as one more nav group. The row's eyebrow says "Switch
  user", bottom-aligned with the faces it names.
  **Waiting, offline.** A resident user's waiting agents (UA-D3) show as a §2.5 orange count
  *beside* the owner's face (top-right, ringed 2px in the ground), never on it (I-5); it fades
  as the menu opens and the words take over in that user's row. An unlinked user reads
  "offline · not linked" in words — the ordinary first-run state, never red (UA-P-D1).
  **Discoverability**, because a face does not say "settings": the tooltip ("James ·
  Account"), `⌘,`, the tray's Settings…, and the Setup Assistant's last pane saying it once
  ("Your face in the bottom-left corner opens Settings — so does ⌘,.").
  *As built (UA-7, 2026-09-22):* `⌘,` did not exist before this — the app menu's `appMenu`
  role carries no Settings item — so it is bound where `⌘K` is, and toggles (a held chord's repeats do nothing). The waiting
  count has no feed yet (main does not watch other users' pairs; spec v0.3 §12): the view
  draws it when handed one. A window with no account door (a browser harness) keeps the
  plain Settings button, so the corner is never a dead end. The rows name no tailnet: nothing
  yet carries another user's link. Another user's row, like New user…, leaves through the switch
  (below). A refusal (a switch or a new user main will not do) reopens
  the menu with main's sentence at its top, in words, until it folds. Open, the menu stands one
  z-step above Godview's button, which it grows over. *Since FR-1 (2026-10-03) the button is gone
  and what it grows over is the views track's left end, so open it stands above the frame until
  FR-4 opens it above the line (FC-D14); its rows are never under the track.* Under
  reduced motion the seed circle's
  hover fill does not show — the panel waits at full size, invisible.
  **Above the line, with Theme (One Frame §10, FR-4; FC-D5, FC-D12, FC-D14; built 2026-10-03).**
  *The corner* is the face's alone: the 44px button holding the 40px face at x 16–60, **centred on
  the foot axis, y 734** (§10) — the devtools button and Godview's are gone from the corners. The
  56px circle around the face is now only its hover (§7's fill step); **the menu opens ABOVE the
  line, never around the face** (a menu never covers the frame, FR-4): a 256-wide panel of the same
  solid chrome, corners 28, padded 8, its left at 8 and its foot 8 above the line (y 700 at the
  default window), grown upward on the island curve from its own foot (§6) while **the face stays
  put beneath it, lifted**. Nearest first, from the foot: **you** (the name 13/600 over the login in
  11px mono, under a strong hairline; it opens Settings → Account) · **Settings…** `⌘,` · **Theme**
  — a row whose `sun` (or `moon`, by night) heads a **small segmented control, Light · Dark · Auto**
  (§8's small size): the app's ONE theme control (FC-D5, F3) · **Link Tailscale account…** (only
  while unlinked) — which **starts the link itself** (F16: it no longer opens Account, which the name
  row does): the menu folds, the daemon is asked to begin, and the sign-in opens in the browser the
  moment the node offers its address; a refusal reopens the menu with the daemon's sentence at its
  top · **New user…** · then the other users under "Switch to", above a hairline. The icons stand in
  the 44px column centred on x 38, the face's own. Choosing a theme keeps the menu open (the app
  changes behind it); ↑ ↓ walk the rows and stop once on Theme, where ← → choose. **One theme, one
  owner:** the choice is MAIN's — one value per device (Light · Dark · Auto), Auto following the
  OS through Electron's `nativeTheme` — and the renderer is told; **Settings → Appearance is the same
  setting** (the same three, the regular segmented control), the Setup Assistant's sun/moon button
  writes it too, and Godview follows it (§1.1). The menu is one of the frame's open surfaces (§10),
  and stands with the frame above the cover in every view. **Devtools** leave the corner for
  Settings → Advanced, a "Developer" section shown in development builds only (FC-D12, F12).
  *Amended 2026-10-27 (track TS; TS-D1, TS-D2, TS-D5, TS-D7 ruled by James):* the link row is
  **Connect your devices…** (it wore "Link Tailscale account…"), shown while this Mac is not
  connected and gone the moment it is. It still starts the link itself, and the browser opens
  once, when the address is ready — the Connect pane and Settings → Devices now do the same
  (TS-D5). The line under your name says **This Mac only** where it said "offline · not linked"
  ("This PC only" on Windows): the ordinary first-run state, never red. While the link moves the
  line says where it is, in the same 11px: "Connecting…", "Waiting for approval", "Sign-in renews
  in 6 days" (in `--vf-ink-attention` from 14 days out), "Sign-in expired · this Mac only"
  (attention ink). Connected, the login replaces them all. The row is the menu's one standing
  ask (§8 "Asking again"): never badged, never on the face.
- **The Connect pane** (Setup pane 4, and every surface that starts the link; track TS, ruled
  2026-10-27 — TS-D1…TS-D8, TS-D12, TS-D13; the record is `draft/thinking-tailscale-onboarding.md`,
  the page *Your Devices, One Field*). The pane keeps its place, the wizard's glass and its fixed
  shell: nothing on it grows the shell. **Ask:** the eyebrow "Your devices", the title "Your field,
  on every device.", a small constellation — your face at the centre, This Mac solid beside it, a
  phone and another computer as dashed ghosts — beside three reasons, titles only ("Answer your
  agents from your phone" · "Open sessions running on your other computers" · "Keep documents in
  step across your desks"), and under them the **partner line**: Tailscale's mark (§13), "Private
  network by Tailscale. Free for personal use; signing in creates an account if you don't have
  one." and "Use the account you use for your own devices. A work account joins your company's
  network." One primary act, **Continue with Tailscale** (↩), then **Not now** (esc), then a quiet
  **Other ways to sign in**. "What VibeField can see", a quiet link, REPLACES the constellation in
  place: VibeField learns your login and which of your devices are signed in; it joins as its own
  device, with no VPN prompt and no change to this Mac's network settings; only you can reach this
  Mac; your work goes device to device and Tailscale sees which devices connect, never what they
  send; Settings → Devices → Disconnect undoes it. **One click to the browser** (TS-D5): the button
  becomes its status ("Opening Tailscale…", M1), and the browser opens the moment the address
  arrives, once, because the person clicked. **Waiting** names two true steps — "Sign in or create
  an account at Tailscale" → "This Mac joins your network" — the live one breathing (§6's loop),
  says "Tailscale will ask to connect `<machine name>`. That's this Mac.", and keeps its exits:
  Open again · Copy link · Sign in on your phone (a QR of the same address, drawn locally, 148 px
  square: black on white in both themes, `--vf-qr-ink` `#000000` on `--vf-qr-ground` `#FFFFFF`
  with its two-module quiet border inside the ground, because a scanner reads contrast, not a
  theme) · Cancel. There is no timer: a new account takes the minutes it takes. **Approval** (a network
  whose admin approves devices): the machine named as the console shows it; **Tell me when it's
  approved** (the person carries on, and the face menu's line says "Waiting for approval"); Copy a
  request for your admin (the machine name and the Machines page); Use another account; the
  console's link for admins. **Arrival** (TS-D8): "Connected.", the account in mono, "Not this
  account? Sign in again", and the account's devices arrive around your face (§6, the arrival).
  When this Mac is alone, **Add your phone** is the primary act. **Not now** lands on the same
  Ready pane; the face menu keeps Connect your devices… and nothing else asks until a moment where
  it helps (§8 "Asking again"). The refusals keep the daemon's sentence and gain a person's words
  and a way forward: "`<login>` already has a field here" with **Switch to `<user>`** and **Use
  another account** (a second account is a second user — TS-D12 offers New user…); "That sign-in
  can't own this Mac" (a tagged sign-in); "This Mac's link record is damaged" with Reveal in
  Finder. **Other ways:** Sign in on your phone, and an auth key for a machine with no browser
  (untagged; never stored). The sync question is not asked here: the first new project after
  connecting asks it (TS-D13).
- **Settings → Devices** (track TS, TS-D3 ruled 2026-10-27): the account's reach, one page under
  the head, absorbing Mesh; Account keeps the profile and the users. In order: the **Tailscale
  card** — the mark (§13), one state word (a green "Connected"; "This Mac only" muted; the
  attention states in their ink), the login in mono and the tailnet, **Manage in Tailscale ↗**,
  **Disconnect…**; **This Mac** — its name, the machine name as Tailscale shows it with Copy, and
  the sign-in's renewal as "Due by 2 Nov" (the attention ink and **Sign in again** once due);
  **Your devices** — quiet rows: an OS mark (§13's set), the name, one word, and Add a device;
  **New projects** — the sync posture's two cards, moved from Account; **Network details**,
  collapsed — today's mesh diagnostics in the panel's mono vocabulary, connection paths, and the
  embedded client's version. Sheets: **Disconnect** signs this Mac out of Tailscale, then archives
  its identity (TS-D14; until truffle can sign out, it archives and says the record stays in the
  admin console until removed there) · **Add a device** (Phone | Computer) · **Use another
  account** → New user… (TS-D12).
- **Asking again** (track TS, TS-D7 ruled 2026-10-27; TS-L6): someone who said Not now said it
  before they had a reason, so the offer returns only where a connected device would do the job —
  the face menu's row (always, while not connected); a ghost row, "Your other devices", in
  Godview's and History's device filters; Publish's choice of where to open; the status item's
  **Connect Your Devices…** (title case, as macOS menus are); a card after an approval that waited
  more than ten minutes, only once it is answered and never beside Allow and Deny; and a
  once-only notice when the window closes with agents running. The rules: never on launch; each
  place at most once per 30 days after Not now, and at most one a day across them; each has ×,
  and one switch in Settings → Devices stops them all; each retires the moment the link lands. ×
  sends a nudge back the way it came (M4, the retract, 180ms).
- **Finish setting up** (track AO, AO-D10 and AO-D12 ruled 2026-10-27; AO-L6): a step skipped in the
  Setup Assistant stays findable and never asks. At the head of Settings, under the account card, one
  tile lists what was skipped, each as a row with its glyph and its one line — "Bring in your past
  sessions", "Connect your devices" — while anything was: **Continue setup** opens the same panes as a
  sheet over the app (the wizard's glass and shell, the same words), and **Hide** removes the tile for
  good (each step still lives on its page). A step answered elsewhere leaves the list by itself: a link
  made from the face menu or Settings → Devices, history brought in from History. "Not now" records
  later; turning every switch off and continuing records no, and a no is never listed. Someone who set
  up before the chapter existed (AO-D12) gets no wizard: the tile lists "Bring in your past sessions"
  while history is found on this Mac and none is brought in, and History shows its pane. Never a badge,
  never a count on the face, never on launch.
- **Settings → History** (track AO, AO-D9 ruled 2026-10-27; AO-L5): the home of whose history is read,
  one page in the Workspace group after Agent Profiles. In order: the History pane's rows, each agent
  with its mark, size, last use, where it lives and its switch, the switches meaning what they mean in
  the pane (on: read; off: **Stop reading**, which keeps what was read and says so); **Look again**
  (the census asked afresh, for an agent installed since); the space History's copy uses on this Mac;
  and the room's own state while it imports, in the room's words. Changing a switch asks once more
  only when it turns reading off. Profiles' own folders are read by construction and are listed with
  their profile's name, not a switch.
- **The desk's chrome** (Chrome on the Mat MC-1…MC-6, 2026-09-28; MC-D1 ruled through One Frame's
  lock and MC-D10 with DK-D23, 2026-10-02; the orchestrator's Phase 4 rulings R1–R25, 2026-10-03,
  cited below as Rn; built on the desk by DK-11…DK-16): **the mat keeps its marks and the chrome
  joins the field.** Under the camera is the desk's: the pencil brackets, the laser guides, the
  masking tape, the label tape and the printed rulers are GPU marks in the mat's own inks, lit by
  its Sun and Moon (§2.1). Over it is VibeField's: the bar, its menu, the tools in hand, the
  pegboard's filters and the line's door are screen-space chrome, lit by nothing and following the
  theme; they stand over the desk and under the frame (§10) — the head, the line, the edges and the
  corner are above them. A control never dresses as a mark and a mark never becomes a control
  (MC-1), so the desk's ink leaves the bar and the label tape leaves the filters. Every bar is the
  line's glass and a menu grown from it the same piece, firmed to solid (MC-2, FR-7); colour is
  content or state only — the mode in hand inverts, a pen's ink is its own dot, Delete arms in §2.5
  red, focus is `--vf-select`, the pencil's twin (MC-4); the bar is one element through every role,
  and the line keeps the foot (MC-5). **VibeField draws all of it** (MC-D10 = DK-D23): views over
  ICE's doors, each a product composition (a controller and a controller-free view) cataloged with
  fixture anchors; ICE's own `SelectionMenu` and `TrayBar` are inline-styled and constant-placed and
  cannot be re-skinned to this. **ICE's own desk keeps its demo chrome** (MC-D11's "it follows"
  deferred, DK-D23): nothing below binds ICE's ink bar, its Objects pill or its demo letter keys.
  **The doors** — ICE gives the chrome data, never pixels. `handle.selection` offers `anchor()` and
  `subscribe()` only, and the anchor (`SelectionAnchor`) carries the brackets' `box`, `count`,
  `locked`, `gesturing`, `editing`, the `view`, the `rulers`, the hand (`held`) and the kinds' acts
  (`menu`) — no ids, no types, no names. So the host reads the rest itself, in one place: the
  selection's entities (`selectedEntities(engine.world)`), each one's type (`PrefabId`), its
  definition (`engine.catalog.widget(type)` — `openable`, its container, its tray entry) and its
  human name — the manifest's (a built-in's tray label), else the type id. The acts run through the
  engine's ops: `ops.duplicateSelection`, `ops.setLocked(ids, locked)`, `ops.deleteSelection`,
  `ops.reorder`, `ops.arrange`, `ops.open`, `ops.runMenuAction(id)`, `ops.useHeldTool(id)`,
  `ops.putDown`. The pegboard is `handle.tray` (`anchor()`, `subscribe()`, `toggle()`,
  `category(id)`); the desk's health is the layer's `status()` and `onStatus`.
- **The status line** (R12, R16, R18 — the orchestrator, 2026-10-03; the head's place, FR-1): the
  frame's one line for the desk's notices, under the head — where what the desk says once is said:
  a type it cannot draw (the missing face, below), a type to remount, a capture that failed (the
  covers), a degraded desk. It is the line's note (§8, the line) moved under the head: solid chrome
  ringed by the strong hairline with the island shadow, corners 10, padded 7 10, 12/500 in
  secondary ink, centred on the window with its top 8 under the head (y 56) — 8 under the tools in
  hand (y 112) while an object is held — rising 4px as it fades in and gone after 2.4s. One notice
  at a time, each said once, never per frame. A notice that carries an act — the degraded desk's
  Reload (R18) — holds until the act is taken or the state clears, the act at its end as a text
  button in primary ink. A notice may carry a detail — the renderer's own words after VibeField's,
  verbatim, 11 mono and faint on a row of its own under them (the degraded desk's ICE message; DK-17,
  2026-10-07). It stands with the frame, above the cover (§10).
  **An ended lane that could not be opened** in History (TV-8, 2026-10-11; Godview's timeline) is
  said here, in the words of the Peek's pick that could not be shown ("Could not jump — ‹why›")
  but not in its place: that one is said in the line's note, where its act began; this act began
  in the stage, so it is a notice on the status line. Each is said once: **"Could not open — the
  record cannot be read now"**, with the door's own words as its detail; **"Could not open — no
  session is recorded for this run"**; **"Could not open — this run is no longer in the
  timeline"**.
- **The selection bar** (Chrome on the Mat §3.1; MC-D2 the line's glass, ruled 2026-10-01; MC-D1;
  One Frame §7; R1, R2, R3, R7–R10, R23, R25; DK-11): one element over `handle.selection`'s anchor,
  placed imperatively each time the anchor publishes — never a render per frame.
  - **Place** — centred over the selection's brackets (the anchor's `box`: 6 out for one object,
    the union's 10 out for several), its foot **10** above them; when its top would cross the
    **safe top, 94** (§10) it stands 10 below them instead, and a bar flipped below clamps at 94
    (R7); kept **42** from each side (the notch's 26 + 16); its top never lower than **660** (its
    foot 8 above the line's top, 708). A selection wholly off-screen hides the bar (R7).
  - **Size and material** — **40** tall (the top chrome's height), padding 4, gap 2, corners 20, on
    the line's glass (§5) with its hairline and the island shadow; cells **32** × 32, corners 16,
    their glyphs **16** in secondary ink (primary under the pointer); the rule 1 × 18 in the strong
    hairline, 5 clear each side.
  - **Order** — **Send to…** · rule · the kind's acts · Duplicate (`duplicate`) · Tape it down
    (`tape`) · More (`ellipsis`) · rule · Delete (`trash`). *Send to…* is the bar's one word:
    `agents` 16 and "Send to…" at 13/500 in primary ink, resting on the ready fill (the foreground
    at 8%), a 32-tall pill padded 0 12 0 10, gap 7; several selected, it counts them — "Send 2 to…".
    **The kind's acts** are those every selected object's type declares (the anchor's `menu`, ICE
    K8a), each a 32 cell wearing its glyph by §13's table (R2) — a `{ path, fill? }` drawing
    through the bar's one path renderer, a name the set lacks as `missing`, said once — and an act
    with no glyph as its label alone, a text cell (R3); its label is its tooltip and accessible
    name; the host prints what the kind declares and adds nothing. **Taped** (the anchor's
    `locked`: every selected object taped): no Duplicate, and the tape act becomes **Lift the
    tape**, wearing `lift` — an ACTION whose name changes, never a toggle and never `aria-pressed`
    (R10).
  - **States** — hover the ready fill (8%) · press the foreground at 14% and scale 0.95 · Send to…,
    which rests on the ready fill, steps to 14% under the pointer and 0.97 pressed (R25) · More,
    its menu open, shown on — the inverted solid · Delete arms only while hovered:
    `--vf-ink-danger` on `--vf-red` at 12% · focus a 2px `--vf-select` ring, offset 2.
  - **Keyboard** (R9) — a toolbar named "Selection": ← → move between its cells, Esc goes back to
    the desk, and Tab from the draft reaches it. A tooltip says the act and its key, the frame's way
    (FR-5): "Duplicate  ⌘D", "Tape it down  ⇧⌘L", "Delete  ⌫" — the desk's keymap (DK-D24);
    ⇧⌘L is the DESK's act, ICE's default keymap's (`keymap.ts:172`), not a kind's, so it is printed
    (R23, reversed 13:40Z). A kind's act prints none on this build — its declared keys are ICE's
    demo's (R1, DK-D24); Send to… and More have none.
  - **Motion** — away for a gesture (a drag, a marquee, a pan, a pinch) and while a note is being
    written (the anchor's `gesturing`, `editing`): out in 90ms, back 200ms after it ends, in over
    180ms (ICE's, as built); away too from Send to…'s press while its chip flies and @'s list is
    open (below). Deselected, it fades out over 120ms `ease-out` (R8). Reduced motion (M6) halves
    every duration, fades only (R8).
  - **A missing face** selected (below): the bar names the type where the kind's acts would stand.
- **The bar grown — More, and right-click** (Chrome on the Mat §3.2; MC-D6 ruled through One Frame's
  lock; FC-D14 solid; R1, R4, R5, R6, R20, R23, R26; DK-D29, DK-D24; DK-11): **More grows the bar
  into its menu** — ONE element (M1), on the island curve over 600ms, the Me menu's grow — upward,
  or downward when its top would cross 94, the bar's own row then heading it (R6); when it fits
  neither way the list scrolls inside it, clamped between the safe top (94) and 8 above the line
  (700 at 780 — the foot every menu keeps, §5), never over the line (R6). *Corrected 2026-10-05
  (DK-11, measured):* this said "between 94 and 660", but 660 is the bar's own lowest TOP, its
  foot 8 above the line; a menu grown down from a bar at y 350 ends at 699 — whole, 8 above the
  line — where a 660 clamp would have made a list that fits scroll.
  **The bar's row never moves** (M2): More stays under the pointer, shown on. The menu is **solid**
  (§5's menus, with the grown bar's two exceptions — R20: corners 20, the bar's own, and placed from
  its own row), at least **244** wide (the bar's width when wider), centred on the bar and kept 42
  from the sides; its list padded 6 6 2 (2 6 6 grown down), and a hairline in the strong hairline,
  12 in from each side, between the list and the bar's own row. **Rows** 34 tall, corners 12, padded
  0 10, 13/500 in primary ink, the nearest hot in the ready fill; **keys at the row's end**, 11/500
  in tertiary ink; between groups a hairline in the strong hairline, 10 in, 4 above and below; grown
  upward the list reads bottom-up, nearest first. **The order, nearest first:** the kind's acts
  (`ops.runMenuAction`; no keys, R1) · **Open** (↩) — only when exactly one object is selected and
  its type opens (`engine.catalog.widget(type).openable`), running `ops.open`; a container (the mini
  mat) has no row, ⏎ enters it (R4) · Send to… | Duplicate (⌘D; not while taped) · Bring to front ·
  Send to back (`ops.reorder`) · **Clean up** (two or more selected: `ops.arrange` tidies them into
  reading-order rows, one undo step — DK-D29) | Tape it down, or Lift the tape (⇧⌘L, R23) | Delete
  (⌫, armed red under the pointer). No Copy: the engine has no copy op. Send to…, Bring to front,
  Send to back and Clean up print no key — DK-D24 binds none. **The eyebrow** names what it acts on,
  at the far end, in the mat's print: mono 10, capitals, 0.08em, tertiary, padded 8 10 5 — NOTE · 2
  OBJECTS · CLOCK, the host's read of the types' names (the doors, above), and a missing face's type
  with its word: NOTE · PLUGIN OFF. Rows fade and rise 4px nearest first, 160ms + 26ms a row (cap
  400ms), and fold back the same way (M4); ↑ ↓ walk, Return takes. **It closes** on Esc, a click
  elsewhere, a gesture and a change of selection (R5, ICE's rule), and it is one of the frame's open
  surfaces (§10) — its Esc is taken before the desk's Esc ladder (R5). **Right-click** grows this
  same bar into this same menu — never a separate popover (MC-D6) — through a VibeField
  `contextmenu` listener. Selecting the object under the pointer first needs the desk's pick, which
  the handle does not offer (core's `FramePickSource.hit` tests one object it is given; the stack's
  `framePick` is internal): it is ICE ask **I27**, `handle.pick({ x, y })` → the object at a screen
  point or null (R26). **Until I27 lands, right-click acts on the current selection only** — it
  grows the menu of what is already selected and selects nothing (R26); with I27 it selects the
  object under the pointer first. **The comment command** (DK-D24: the C key's wrap of the
  selection, which leaves the keymap) becomes a row here when DK-8's comment kind exists. The bare
  mat's own menu (Paste here, New note here) is not built (a Marks on the Mat item).
- **Tools in hand** (Chrome on the Mat §3.3; MC-D4 ruled 2026-10-01: under the head; MC-D9
  readouts; One Frame §7; ICE I20, I22; R2, R13; DK-12): when an object is picked up (the anchor's
  `held`), **the same bar travels** with the pickup and becomes the tools in hand — one element
  (M1), **560ms** on the island curve (I20's `travelMs`, carried as `HeldAnchor.travelMs`), its
  contents swapping by a 120ms cross-fade at the travel's end (R13; reduced motion, a fade only) —
  hides while the object flies home (`landing`) and is back over it 200ms after it lands.
  **Place:** under the head, its top at **y 64** (centre 84), 16 under the name pill, centred on
  the window — the field, then what you hold; object chrome, not the head's (FR-1). The held
  object's **reading fit keeps 116** above it (the bar's foot, 104, + 12) **and 100** below (the
  line's 88 + 12): I20's `deskLayer({ hold: { top: 116, band: 100, travelMs: 560 } })` — ICE's own
  56 / 72 are its demo's. **Order:** Send to… · rule · the kind's tools · the readout · rule · Done.
  **The tools** are the anchor's slots (`HeldAnchor.tools`; each `HeldSlot` an `id`, a `label`, a
  `kind`, a `hint`, a `glyph`, a `swatch`), **in their declared order, never regrouped** (R13), a 6
  gap where the run changes between pages, inks and tools; each runs through `ops.useHeldTool(id)`.
  A **mode with a swatch** (`kind: "mode"` and a `swatch` — ICE's pens) is a **dot** (R13, MC-4):
  12px in the slot's own ink with a 1px inner ring (black/14; white/20 by night) so a black ink
  reads on the night glass, in a 28 × 32 cell; the one in hand wears a 1.5px foreground ring 2px
  off the dot — the notch pin's ring; a dot grows 1.18× under the pointer (160ms, pop). A **mode
  without one** (the eraser, the calendar's pen) is a 32 cell, the inverted solid while it is the
  one in hand (`aria-pressed`); an **action** (`kind: "action"` — undo, today, a page) is a 32
  cell; a slot with no `kind` waits, faint by ink. Glyphs by §13's table (R2). **The readout**
  (MC-D9, I22's `HeldAnchor.readout` — "Page 1", "September") is ONE slot after the tools, before
  Done, since the string carries no position (R13): 12/500 `tabular-nums` in secondary ink, at
  least 44 wide, padded 0 4; a kind that says none shows none. **Done** is VibeField's primary at
  32: the inverted solid, 13/500, padded 0 15, no glyph, the chip shadow (`0 4px 10px` black/14,
  /40 by night); 0.9 opacity under the pointer and 0.96 pressed (R13); it runs `ops.putDown()`.
  Tooltips say the slot's `label` and its `hint` the frame's way — "Felt pen  1", "Eraser  E",
  "Put it down  Esc". **The specimens:** of ICE's six built-ins (the note, the print, the notebook,
  the whiteboard, the calendar, the mini mat) three open — the notebook ‹ › · felt, ball, fountain,
  red · undo, reading "Page 1"; the whiteboard black, blue, red, green · eraser · undo · redo; the
  calendar ‹ › · today · pen, reading "September" — and the example plugin's clock
  (`@ice-examples/desk-clock`) holds seconds · the 24-hour ring · an hour back · an hour ahead · the
  next dial, its own five drawings (§13), reading its time.
- **The pegboard — Objects, behind the line** (Chrome on the Mat §3.4–§3.5; MC-D7 ⊕ Objects, B,
  ruled through One Frame's lock; MC-D3 ruled 2026-10-01: segmented; One Frame §7; ICE I21; R14,
  R19, R21; DK-13): **the door is the line's create on Canvas** (§8, the line): Objects, B, calling
  `handle.tray.toggle()` and mirroring the tray's `open` — the plus turned 135° into ✕ while the
  board is out. While an object is in hand the desk refuses the board (`open()` answers false), and
  the create is **faint by ink** with the tooltip **"Put it down first"** (R14). ICE's Objects pill,
  its ✕ and its ride on the drawer's edge are its demo's: here the drawer's handle is the line.
  **The board rises behind the line** — the desk's own pegboard, its specimens hung by category
  over their label tape — and **its lay keeps 88 at the foot** (I21:
  `deskLayer({ tray: { foot: 88 } })`) so the last row clears the line and the board's scroll still
  reaches it. **The stage behind it neither recedes nor dims** — the desk dims under the board
  itself (design-017), so the old sheet's backdrop, recede and stage hold do not come with it (R14).
  It hangs only the kinds whose plugin is on: the install set's disabled list filters the entries
  `tray.categories()` offers (P3c — the old sheet's filter, now the board's). **The filters are
  segmented** (MC-D3): the kit's `SegmentedControl` **extended** — a thumb element, ids distinct
  from labels, ← → Home End (R19; a kit change, UI_SYSTEM — today the primitive renders each
  option's string as both its id and its label, with no thumb and no keys) — cut for the wood,
  centred in the board's clear **header band** (`TrayAnchor.drawer.header`, 48 tall), 12 in from
  its sides, following the drawer every frame of its slide and fading in over its last 40%. The
  track is the chrome's solid at 55% over a 12px blur, **sunk** — an inset `0 1px 3px` black/16
  inside the hairline — padded 3; the thumb is solid chrome with the hairline (by night the line's
  edge, the strong hairline — R19) and `0 2px 6px` black/12, **sliding 300ms on the island curve**
  across widths; segments 30 tall, padded 0 15, 13/500 sentence case, in tertiary ink at rest and
  primary on the one chosen. **All** first, then `tray.categories()` in the lay's order — the six
  built-ins' Paper and Surfaces, the example clock's Things, and whatever a plugin's kind declares —
  **no counts**. Past the band's width
  they scroll inside it, the far end fading under the tray's mask; a click, or ← → Home End,
  chooses (`tray.category(id)`). **Chrome does not dim by night**: the anchor's `night` is not read
  here. **Inserting by keyboard** (R14), on ICE's own doors (petition I37): in the board the arrows
  move between the specimens — the focus is ICE's, `handle.tray.focus("first")` as the board takes
  the keyboard, ← → its walk in the lay's order (`"prev"` / `"next"`, never wrapping), ↑ ↓ the
  specimen nearest by centre in the row above or below, focused by its id and read back from
  `anchor().focused`; the board scrolls the least that shows the focused specimen's HANG between the
  header and the foot, and the **ring** stands 2 out from `focused.rect` — the object's fit in its
  hang as the last frame drew it, what a press there grabs — never the hang box. ⏎ lays the focused
  one at the view's centre — `handle.tray.lay()`, the tray's own take: one undo step, selected, the
  board folding as a handed take's does; Esc closes the board; the filters and the board are two
  stops of Tab. **One surface at a time:** Objects is one of the frame's open surfaces (§10) — it
  folds @'s list, the explorer, the menus, the drawers and the palette, and they fold it; Esc
  closes it ("Close  Esc"); B toggles it, never while typing and never under a cover. **The tray
  island and its state are gone** (R21) — the pegboard replaced them.
  *History:* DK-13 (2026-10-06) built the board and deleted the tray island and its state (R21); its
  keyboard path ran on its own walk and scroll and ringed the hang box. *Amended 2026-10-07 (DK-17b,
  ICE `0.15.0-desk.6`, petition I37):* the walk, the scroll and the lay moved onto ICE's doors and the
  ring onto `focused.rect`; ICE's scroll does not keep the focused hang out of the content's fade under
  the header, as DK-13's own did.
- **Send to…** (Chrome on the Mat §3.6; MC-D5 ruled through One Frame's lock: hand off to the line;
  DK-D26; One Frame §7, FC-D1; R15, R25; DK-14): **it only drafts** — it never sends and never
  aims; VibeField aims in one place, the line. Pressed (on the bar, in hand or in the menu), the
  selection becomes **one chip** in the draft: the host inserts it at the caret, focuses the draft
  and **types the @**, so @'s list opens exactly as typing opens it (FC-D1), the caret after the
  chip (R15). Before it lands, a chip of the object's face **flies from the selection to the caret
  on a straight line, 1.25 → 0.86, 560ms on the island curve** (R15; M4, shrinking along its
  travel), and the @ comes 180ms after it lands; a draft already aimed takes the chip with no @,
  and send arms (Chrome on the Mat §3.6). It lands as the line's chip (§8, the line: 24 tall,
  corners 7, 12.5/500, the glyph 13). **Its face** (R15): a note wears its paper — its `paper` prop
  through the palette's CSS colour — and its ink, `snippets` and its first 24 characters; any other
  kind its NAME and no glyph ("Clock") — neither ICE's `TrayEntry` nor DK-0f's contribution carries
  one (R15, amended 13:40Z); several, `package` and "N objects"; a missing face, its type's name.
  **What it
  carries** (DK-D26): the objects' names, their durable text and a still through the capture door of
  the anchor's box WITHOUT the brackets' 6 / 10 outset — `handle.capture({ rect, marks: false })`
  (ICE I23, I40), drawn without the selection's marks and taken at once, of the last presented frame
  (R15). The selection is **never cleared or put back**: no selection write during Send to…, and
  nothing a peer could see blink (smoke:canvas holds the selection's count on every frame from the
  press). **The bar steps aside from the press** and comes back 200ms after the list folds (R8's 200;
  aimed, 200 after the chip lands, there being no list — DK-14 measured it away 16ms after the press
  and back 208ms after the fold). The tools in hand never step aside for it (plan addendum (50)): the
  hand is drawn out of the marks. Whether the bar should wait for the list again, now that nothing is
  cleared, is James's call (plan addendum (95)); it stands as built until he rules. Reduced motion
  (M6): no flight — the chip fades in at the caret. The picker Marks on the Mat drew growing out of the
  bar was never built and is not; an agent reading or rendering the desk itself is the AGENT'S EYES
  program, beyond a chip.
  *History:* the canon's first words (DK-0d, 2026-10-03) hid the marks by the host's own doors and
  stepped the bar aside only while the list was open. *Corrected 2026-10-06 (DK-14, measured):* hiding
  the marks cleared the selection for one fade of the brackets and a capture (the act's record: the
  still taken 144–160ms after the press, the selection put back then), and a bar left standing would
  have faded out and back in under the flying chip (R8's deselect) — so the bar stepped aside from the
  press. *Amended 2026-10-07 (DK-17b, ICE `0.15.0-desk.6`, petition I40):* ICE's capture hides the marks
  itself; the clear and the put-back are gone, and with them the step-aside's first reason.
- **The missing face** (DK-D18 as amended 2026-10-03: no VibeField kind; ICE I24; R11, R12, R24):
  an object the desk cannot draw — its type has **no kind** on this desk (a plugin off or gone, a
  type this build never registered — ghost stubs register faceless types only — or one registered
  after the desk mounted, I25) or its **kind faulted** (refused at create, or quarantined after
  three strikes: the layer's `status().faults`) — wears **ICE's missing face**: a faint 45° hatched
  card the size of its box, a hairline edge, no text, pickable, so it still selects, moves,
  duplicates (the data — R11), tapes and deletes like any object. VibeField draws no face of its
  own (the placeholder kind is struck). **The bar names it**, in words where the kind's acts would
  stand: the type's human name — the manifest's when there is one, else the type id (R12) — and
  why, in one of five words (R12, R24): **"plugin off"** (its plugin disabled) · **"plugin gone"**
  (uninstalled) · **"no kind"** (never registered) · **"remount to draw it"** (registered after the
  mount, I25) · **"can't draw"** (its kind faulted) — "Note · plugin off" — 13/500 in secondary
  ink, a label and not a control; the grown menu's eyebrow says the same in capitals, and Send to…
  carries the type's name. It is said once, in the status line (R12, above), never painted onto the
  object as an alarm.
- **The covers over the desk** (DK-D25 ruled 2026-10-02 — "frozen desk should be still and consume
  no render time at all"; FC-D13, FC-D15, FC-D16; ICE I23; R16; DK-15): **under a cover the desk is
  a still and costs nothing** — the cover fades in over the LIVE desk (240ms) while
  `handle.capture()` (I23) takes its last presented frame; when the capture resolves, the still,
  blurred once, swaps in under the cover's tint and the canvas is hidden — by `visibility`, never
  `display:none`, which the host's ResizeObserver would read as 0 × 0 — and then
  `engine.frame.freeze("cover")` parks the loop, so the desk runs zero frames and zero submits for
  as long as the cover stands (the witnesses: the layer's `submits()` and `perf().frames`; the GPU
  memory ledger never reads 0) (R16). The numbers: the blur **40 CSS px** — 40 × the still's bitmap
  px per CSS px — **once**, in an OffscreenCanvas `filter`, never a `backdrop-filter`, which the
  compositor redraws every frame the cover's own content moves (Godview's swarm moves every frame);
  the cover's own ground over it at **72%** (FC-D16), holding over the live desk until the still
  arrives — never a blank; the still recedes to 0.98 over **560ms**, transform only — the cover's
  settle (One Frame §12; §6's 600 for the field is the island curve's morph, not this recede); a
  covered view's content ends at **692** (FC-D15, §10). Back to Canvas: thaw first, the live canvas
  shown at once under the lowering cover, the still dropped. **The canvas's head is hidden under
  any cover** (§8 "The head"; Godview, History): it is DOM over the desk, never in the still, so the
  tint alone would leave its name pill and zoom readout sharp at 28 % on the head's row, behind a
  covered view's own head (the Stories row, the Peek's button). So it goes with the canvas, by
  `visibility`, once the cover has faded in (240ms, 120 under reduced motion), and shows at once as
  the cover lowers. *(Built with the Stories head. Until then Godview's bar hid it, and History,
  which has no bar, showed it.)* A resize or a theme change while
  covered re-captures: thaw → one frame → capture → freeze (R16). A capture that answers nothing (a
  lost device) covers the mat's ground as the theme lights it — `--vf-mat-ground`, `#3D5A30` by day
  and `#313C40` by night (§2.1's lit values; the token is DK-15's to add) — and says so once in the
  status line (R16), in the card's own words: "The desk lost its graphics device". Until I23 ships,
  `createImageBitmap` on the desk's own canvas stands in — a bitmap ICE does not promise, so its
  absence falls back the same way. **Godview's live backdrop** (GT-7's viewer glass,
  `backdropOpacity` / `backdropBlur`) **and rosetta's room glass retire on the desk**: the cover is
  a tint over the still, and their settings rows go (R16; the deck's note, below). *(Carve-out
  2026-10-12, docket N3 (a): the room's sticky day heads keep their own frost — the deck's note.)*
  *Amended 2026-10-07 (DK-16; plan addenda (68), (69)):* the rim the receded still leaves at the
  window's edge (≈12 px at 0.98) is the mat's ground as the theme lights it under the cover's tint —
  the still's own ring, `box-shadow: 0 0 0 2vmax var(--vf-mat-ground)`, never the canvas's colour
  (measured under History: (201, 209, 198) by day and (33, 37, 39) by night — the tint over the sage
  and over the Moon's dapples; Godview's CRT vignette darkens its edge, so there the ring alone is
  held). A desk that never drew (no WebGPU, no adapter) is covered by the same ground and nothing is
  said — the card is the Canvas stage's, and it stands again as the cover lowers.
- **Peers on the mat** (DK-16; MC-D10 = DK-D23, R22; UA-D17, §2.8 I-1, I-4; R17): another person's
  pointer on the desk is VibeField's own cursor — ICE's are turned off,
  `deskLayer({ cursors: false })` (petition I26), so nobody is drawn twice (R17).
  **Where:** each peer's `PresenceCursor` world x/y through the camera every frame, in a reflector;
  `usePresencePeers` gives only the roster's names (R17). **When not** (R17): an idle peer hides after
  8s; a peer whose pointer is **away** hides — its `PresenceCursor.away` (petition I42): its pointer
  left its window with nowhere to go (ICE's pointer adapter's `leave`, heard from anywhere in the
  host's document — from the desk or from the chrome BESIDE it, the line, the head, the window's drag
  strip, petition I44 — at its last point over the desk; back in the window over the chrome it stays
  away until it is on the desk again), or its host holds a reason; and a peer inside another canvas
  hides — its `canvas`, the entered container's durable key ("" at the root, a keyless one
  `~<peerId>/<entity>`), compared with this window's own, which `presenceCanvasOf` names the same way.
  VibeField says one reason of its own: a view that covers the canvas sends this window's pointer away
  through ICE's `setAway("cover")`, said as the presence attaches and as the view moves, and published
  between frames, so a peer hears it under the cover's parked freeze too. Peers also hide under the
  pegboard, under your cover, and while the desk does not draw. A peer on a build that sends neither
  field reads as ICE's defaults: present, on the root. **Above** the mat, **below** the bar and the
  line (R17). **The arrow** — the pointer's, 18 × 22, its tip at 2,2 in its box, drawn inline (its
  path joins §13's allow-list, R17) — with a 1.4 white edge and a `0 1px 2px` black/25 drop; **the
  label** — its box's top-left 14 right of and 18 below the arrow box's top-left corner (R17) — a
  **chip on the line's glass** (R17, amended 13:40Z): 22 tall, full round, padded 0 9 0 7,
  `--vf-chrome-solid` at 88% (94% by night) with the line's blur and hairline (§5), its words 11.5/500
  in the chrome's primary text ink, reading **the face first, then the name** ("🦊 James", §2.8) —
  never bare text or a bare ink on the mat, where `#68686B` measures 1.4:1 on the Sun-lit sage and
  2.0:1 by night and even the desk's own ink only 2.5:1 by day (§2.8's erratum), so it reads on any
  mat: on the lit mat it measures 9.2:1 by day and 11.3:1 by night (DK-16, §2.8). Never the peer's own
  colour (I-1). Your own pointer on the desk is the OS's and the desk's own open hand; the halo is
  gone (§2.1). smoke:canvas's PEERS EXIT witnesses the chrome's exits.
  *History:* DK-16 (2026-10-07) built the peers and carried `away` and `canvas` in VibeField's interim
  presence facet, `vibefield.PeerWhere { away, canvas }`, written change-only beside ICE's cursor until
  ICE carried both (ask I42). *Amended 2026-10-07 (DK-17b, ICE `0.15.0-desk.6`, petition I42):* ICE
  carries both and the facet is gone. *Amended 2026-10-08 (DK-17b, ICE `0.15.0-desk.7`, petition I44):*
  desk.6 heard only an exit from the desk itself, so a pointer that left through the chrome beside it
  stood on the mat until the 8 s idle; the exit is heard from anywhere in the host's document since.
- **When the desk can't draw** (DK-D32 ruled 2026-10-02; Chrome on the Mat §3.7; R18; DK-3, DK-16):
  the layer's status (`onStatus`) is said in VibeField's words — never ICE's black monospace screen,
  never a blank. **`failed`** — WebGPU absent (a remote desktop has none, Windows is unverified) or
  the device lost — shows the full **unavailable card** in the Canvas stage: the kit's
  `UnavailableState` **extended** — a detail slot, a Reload act and a 380-wide variant (R18; a kit
  change, UI_SYSTEM) — on the plain ground (`--vf-canvas-bg` — not the mat, which nothing can draw;
  the CSS-fallback dots left with the tokens, DK-17, 2026-10-07), centred, the strong hairline dashed, corners 22, padded 26 26 22:
  **what happened** (14/600, primary), **what to do** (12.5/400, tertiary), **one Reload** (the
  primary: inverted, 36 tall, padded 0 18, corners 18, 13/500) — a desk remount, not a window reload
  (R18) — and in the detail slot **ICE's message, verbatim**, last and small (11 mono, faint, 12
  below; R18). ICE says why in that one string, so the card reads it: **the device lost**
  (`the device was lost: <reason>: <message>`) — "The desk lost its graphics device" · "The graphics
  device was reset while the desk was drawing. Your objects are saved in this document; reload to
  draw them again." · Reload · the message; **no WebGPU** (a boot refusal ending
  `WebGPU is unavailable here (no navigator.gpu)`) — "This computer can't draw the desk" · "The desk
  draws with WebGPU, which this graphics setup doesn't offer — a remote desktop has none — so
  reloading won't help. Your objects are saved in this document." · no Reload, since it would not
  help (R18) · the message; **no adapter** (a boot refusal ending `requestAdapter() returned null` —
  WebGPU is there, the computer's graphics offered it nothing; hardware acceleration off among the
  causes; DK-4) — "This computer can't draw the desk" · "The desk draws with WebGPU, and this
  computer's graphics offered it no adapter — hardware acceleration may be off — so reloading won't
  help. Your objects are saved in this document." · no Reload, for the same reason · the message;
  **any other refusal**
  (`no desk — the adapter, the device or the pipelines were refused: …`) — "The desk couldn't start
  its graphics" · "Your objects are saved in this document; reload to try again." · Reload · the
  message. **A boot whose device never arrived** — before any device was in hand — is mounted again
  before any card shows, as often as a retry can cure it (DK-5's heal, DK-9's rule): **no adapter**
  three times over about two seconds (Chromium's GPU process can be late, and an adapter asked for
  before it is up answers null), **a refused device** once (an adapter lost mid-request — a refusal
  is otherwise deterministic for the same adapter and limits); the card shows only when those run
  out, and a Reload the person asked for is never retried. **`degraded`** (an uncaptured GPU error;
  the desk still draws) is a banner, not the card: the status line saying VibeField's sentence first
  — **"The graphics device reported an error. The desk is still drawing — Reload restarts it."** (what
  happened, that the desk keeps drawing, that Reload remounts it) — with ICE's message after it as the
  detail (11 mono, faint, verbatim, on a row of its own under the words, as the card carries its
  detail) and a Reload until the state clears, the desk drawing on beneath it (R18). *Amended
  2026-10-07 (DK-17; the migration plan's (75)):* until then the line held ICE's message alone, and a
  person read "an uncaptured GPU error — GPUValidationError: …" as the whole of it. No Canvas2D fallback in v1
  (DK-D32): the state is the whole answer, and the frame around it still works.
- **The Setup Assistant's agent chapter** (track AO, AO-D1…AO-D13 ruled by James 2026-10-27; the record
  is `draft/thinking-agent-onboarding.md`, the page *Bring Your Agents*). Three panes after "What should
  this field call you?" and before the Connect pane, then one Setting up pane that becomes Ready: **Agents
  → Profiles → History → Devices → Setting up** (AO-D1, AO-D13). Each pane keeps the wizard's glass, its
  fixed shell and W1–W6, and opens on what this Mac already told VibeField (AO-L1). A pane with nothing to
  decide doesn't show (AO-L2): no agent installed or installing means no Profiles pane, and no history on
  disk means no History pane. Continue on every pane gives a setup that works (AO-L3), and every skip
  names its later home in the skip's own line (W3). Every agent is drawn by its own mark (`AgentIcon`, the
  view SDK's, §13 kept exact) and named by the catalog's label, never a monogram.
  **Agents — "Your agents are ready."** The installed agents as rows: the mark, the label, the version
  and how it updates ("updates itself", "npm", "Homebrew") and a green **Ready**. The catalog's supported
  agents that are missing follow with **Get**, which becomes **Install** and names what will run ("Runs
  Anthropic's installer: curl -fsSL https://claude.ai/install.sh | bash", the command in mono) before it
  runs it (AO-D5, AO-L7). Preview agents wait behind **More agents**. With nothing installed the title is
  "Add your first agent." and Claude Code and Codex come first. Voice: "VibeField found these on this Mac.
  It runs them as they are, with your settings and sign-ins, and keeps them up to date." An install runs
  on after Continue, and the last pane reports it. Later: "Add agents anytime in Settings → Agents."
  *Built 2026-10-27, AO-5b, until Get (AO-7):* a missing agent's row says **Not on this Mac** in the
  secondary ink where Get will stand, its mark at half ink; "Claude Code and Codex first" is the catalog's
  supported rows in its own order; More agents lists the preview rows VibeField installs and updates
  (`offers.distribution`), so a protocol is never offered as an agent to get. With nothing installed the
  voice is "VibeField runs the coding agents you install, as they are, with your settings and sign-ins,
  and keeps them up to date.", under the rows Settings → Agents' own sentence "Install one, and it
  appears here." with **Look again**, and the later line under them. The title claims only what the
  inventory said: "Your agents." while it has not answered ("Looking on this Mac…") or could not
  ("VibeField couldn't read the agents on this Mac.", with **Try again**, a fresh read), and the voice
  says "VibeField found these" only once it has found them (before that, the first-agent voice), and
  Continue then moves on recording nothing. Continue records the step answered when an agent is on this Mac, put
  off when none is. *Corrected 2026-10-27 (AO-6a): this note said "Looking for your agents…" and "…on
  this Mac right now." with no Try again; the page's §10 states table, which governs, says it as above.*
  **Profiles — "Every subscription, side by side."** Taught with the person's own sign-ins: **This Mac**
  as a card, each agent with who it is signed in as and its plan by name ("Claude Max"), and beside it a
  dashed card, **Add a profile…**, which grows into the pane in place (M1). Voice: "A profile holds one
  sign-in for each agent. This Mac is your first: it uses the accounts your agents are already signed in
  to." The offer: "Another plan, for work or a client? Give it a profile." The fact: "Profiles keep their
  sign-ins apart, so they work at the same time and never sign each other out." Adding is one field a
  step: a name (placeholder "Work, a client, Personal…"), the agent, then that agent's own login in the
  pane (the Sign-in terminal, "This runs in Work's folder, so the sign-in lands there and nowhere else").
  The profile is kept once its first agent says who signed in (AO-D7); Cancel leaves nothing behind.
  Done: "Work is ready. It starts with clean settings: its own skills and servers." Later: "Add one
  anytime in Settings → Agent Profiles."
  *Built 2026-10-27, AO-5b:* the cards stack (the pane is the glass's one column): This Mac's rows are
  Agent Profiles' own (`profilePage`), each saying "Signed in as {who}" with the plan it runs on by name
  at the trailing edge, or "Not signed in" with **Sign in…**, which runs the agent's own login in the
  card, in its own folder; a lapsed one says "Sign-in expired" with **Sign in again** (*corrected
  2026-10-27, AO-6a: AO-5b offered Sign in… there; the page's §10 row says Sign in again*). For a second
  person on this Mac (UA §6.2) This Mac's card says "These sign-ins belong to this Mac, so everyone
  using VibeField here shares them." (*added 2026-10-27, AO-6a: a §10 row AO-5b missed*), and Add a
  profile… is how they get their own. Add a profile… steps: **Name this profile** (Enter is the add's Next, never
  the pane's Continue), "Sign in to an agent in Work" (the installed agents that sign in), then the
  login in the card. The profile is made as its login starts (the login writes into its folder) and is
  kept once the agent says who signed in; Cancel deletes it. A login that ends before the agent says
  who leaves it unkept, saying so in the agent's name, with **Sign in again** and **Cancel**: it is never
  deleted unasked, because the login may have worked. *Built 2026-10-27, AO-5a (AO-D14, ruled (a)):*
  - The profile is made as a draft that fieldd notes (`agents.profileSets.create {draft}`), and fieldd
    keeps it at the first sign-in that says who.
  - Cancel is `agents.profileSets.discard`, which deletes it only while it is still a draft, so a sign-in
    that landed first wins.
  - A draft nothing kept is deleted at fieldd's next start.
  - Settings → New profile… makes a draft too. Its page says "kept once an agent signs in here" beside
    its facts, and its empty state says "Add an agent and sign in: Work is kept once one does." While a login is open, Continue and Back wait and the later line reads
  "Finish or cancel the sign-in first." The glass scrolls a tall pane: while Add a profile… is open,
  This Mac folds to one line (its agents' names) so the card has the pane, and each step, the login
  above all, comes into view as it opens. The sign-in is Agent Profiles' own controller, shared. **This Mac explains itself**
  on its Settings page while it is the only profile: "Have another subscription?" and "Give it a
  profile. Each profile keeps its own sign-ins, so they work at the same time and never sign each other
  out." with **New profile…**. It is page text, not a tip, and leaves by itself when a second profile
  exists, so it has no Hide (the page's prototype drew one).
  **History — "Bring in your past sessions."** One row per agent that has history on this Mac, an agent
  no longer installed included: the mark, the label, its size (§9, as Finder counts it), when it was last
  used and where it lives (`~/.claude`, mono), and a switch. **Every switch starts on** (AO-D3); nothing
  is read before the button. Voice: "Search everything your agents did on this Mac, and pick up any
  session where it left off." Under the rows, two sentences: how long the first reading takes ("About a
  minute on a quiet Mac, one time only. History fills in while you work.") and where it stays ("Your
  history stays on your devices. VibeField reads it here and never uploads it."). The acts: **Bring in
  history** (the primary), **Not now** (recorded as later), and with every switch off the primary reads
  **Continue without history** (recorded as no). Not enough space says so with both numbers. Later:
  "Bring it in anytime from History."
  **Setting up, then Ready** (AO-D2, AO-D4). Today's pane 3 is retired: the long jobs only exist after
  the chapter, so one pane at the end lists the real phases, each a fact a door reports, never a bar of
  its own: **Your desk** (the boot's own stages), **Agents** (an install still running, as background,
  with its elapsed time), **Profiles**, and **History** in the room's own words ("Discovering
  conversations · 1,215 files checked", then "4,441 sessions found in 74 projects" and "Reading
  conversations, in the background"; *built 2026-10-27, AO-4b:* "Finding your history", the room's own first words,
  until a file is checked, and "History isn't available right now." with no wait when it cannot start). The live
  phase breathes (§6); a done one takes its ✓. It waits
  for the desk and History's first pass only, and for no more than 8s past the desk, then offers **Start
  now** under "Finding sessions in a history this size takes longer. It carries on in History." Then
  its title becomes "Welcome to your field, {name}." in place, with the line "Your face in the
  bottom-left corner opens Settings — so does ⌘,", and the glass hands the window to the desk it opened
  (§6, the hand-over). A second user's chapter is the same and its end has no welcome beat (UA §6.2).
- **The users chooser** (Setup, second-user variant; 2026-09-22): Back from a new user's pane 2
  opens it, because that user already exists by then — the chooser is where you choose who to
  enter instead. Eyebrow "Users", one line of voice, then every user on this machine as a tile,
  four to a row: the 56px face (§2.8), the name, and one tertiary line only where there is
  something to say — "Setting up" on the user this window is setting up, "Not set up yet" on
  another unfinished one. A tile is a button: another user's switches the window to them (the
  switch, below, carries the tile's face; a refusal is said on the pane, in main's words), this user's goes back to
  pane 2, as does the primary action, "Continue setup". Tiles rest bare, take the §7 fill step
  on hover and the select ring on focus, and lift their face like any face host; it is the
  wizard's own glass, so nothing dims. There is no delete here: a user once created stays
  (spec §11 — archival is a non-goal), and a half-made one says so in its tile.
- **The loading veil** (B4): a full-window chrome frost (`white/60 + backdrop-blur-xl`,
  dark `#171717/60`) while a doc loads — centered thin bar (`3px × 220px`, colorless
  fill: loading is not a §2.5 state) over an 11px/50% lowercase stage label
  ("drawing the board" — its last; DK-4 retired "preparing previews" with the
  R3F preview capture). **Late-veil rule:** invisible until 120ms of loading elapse
  (a cached switch never flashes); 240ms fade-out. Loading is modal (it holds no stage since
  DK-17 — M5).
  *Amended 2026-10-07 (DK-16; §2.1's erratum, measured):* the veil wears the mat — its lit sage and
  its lattice, opaque — and its bar and label are in the mat's ink (`--vf-mat-ink`, white at 60 %:
  4.0:1 by day, 5.2:1 by night), so a switch goes from desk to desk on one floor.
- **The boot splash** (ESR slice 4; design-03 §4.3 v0.3): the app's first face, painted
  before anything heavy loads — the canvas ground itself (`--vf-canvas-bg` + the §2.1
  CSS-fallback dots at rest; the field waking, not a logo card), the wordmark
  "VibeField" centered (13px medium, `/50` — quiet), the veil's thin bar
  (`3px × 220px`, colorless) beneath it over an 11px/50% lowercase stage label. Stages
  are REAL, never theater: "waking the daemon" → the DocManager's own strings
  ("opening doc" … "drawing the board") → "settling". Unlike the veil the splash is
  NOT late (there is nothing behind it yet) and NOT frost (nothing to frost).
  Unavailable is honest voice (§9): the stage line becomes the plain reason and a
  ghost "Retry" appears — no apology, no spinner theater.
  *As built (2026-09-22, the switch):* its first frame is painted synchronously, with the
  theme stamped before it and the product entry render-blocking, so no bare or wrong-theme
  ground ever shows ahead of it. In the switch's dress (below) the wordmark gives way to the
  arriving user's face, the eyebrow "Switching to" and their name.
  *Amended 2026-10-07 (DK-16; §2.1's erratum, measured):* the ground is the mat (`--vf-mat-ground`
  and `--vf-mat-lattice`), not the canvas and its dots — the floor the Setup Assistant and the switch
  share with it — and its words are in the mat's ink (white at 60 %: 4.0:1 by day, 5.2:1 by night,
  where `/50` read 3.9:1 on the canvas), the bar white/15 under white/80, the ghost Retry white.
- **The reveal** (boot-exclusive motion): the canvas composes and stabilizes BEHIND
  the splash (the frame-stability gate — never reveal mid-hitch), then the splash
  fades 240ms plain `ease` while the canvas settles `scale(0.99) → 1` over 560ms
  `--vf-ease-island` (a breath, not a zoom). Fires once, fully warm. Reduced motion:
  fade only. Doc SWITCHES stay the loading veil's business — the splash exists only
  at boot.
  *Amended 2026-10-27 (track AO, AO-D2):* on a first run the Setup Assistant's glass is what the
  desk composes behind, never the splash: the wizard keeps the window from its last question until
  its Ready beat ends, and then leaves with the splash's fade and the desk's settle (§6, the
  hand-over). The splash never returns between the wizard and the desk.
- **The switch** (UA-D15's reload, dressed; 2026-09-22): changing users reloads the window,
  so the transition is two halves that meet on one frame — the boot splash wearing the face of
  the user you are going to. **Leaving.** The face you clicked lifts out of its row (held,
  §2.8) and travels to the centre of the window, growing to 128px, on `--vf-ease-island`
  560ms; the row's own face goes with it (M1), so there is never a second copy. Behind it the
  window defocuses: a backdrop blur climbs to 40px in 360ms `ease-out` while the stage recedes
  to `scale(0.98)` on the island curve (M5 — the engine freezes, since this covers the window),
  and from 120ms the splash's own ground — `--vf-canvas-bg` and the §2.1 dots — rises over it
  in 360ms `ease` until the field is gone. The words follow 200ms behind the face (240ms
  `ease`, rising 6px): the eyebrow "Switching to", the name in the Setup headline's type (28px
  light), and the splash's bar and stage line as the splash begins them — "waking the daemon",
  the bar at rest — because waking that user's pair is what main does next. The face is set
  down before the frame converges at 600ms, and only then is main asked. **The seam.** The
  window you leave converges on exactly the frame the window you enter paints first, so the
  reload happens under an identical picture. *Measured 2026-09-22:* Chromium holds the old
  frame through an `http:` reload until the new page paints content, but not through a
  `vibefield-app:` one — there the bare ground shows for as long as the boot script runs —
  hence the render-blocking entry above. **Arriving.** The new window opens on that frame and
  runs its real stages on the bar. At the reveal the words go first (120ms `ease`); from 80ms
  the face, lifted again, travels home to the Me menu's corner on the island curve (600ms),
  shrinking to 40px along its way (M4), and hands over to the corner's own face as it lands
  (120ms, over an identical face); the ground falls away in 420ms `ease` and the blur lifts off
  the new field in 560ms `ease` while the canvas settles (the reveal's own `0.99 → 1`). A user
  not set up yet arrives in Setup, and the face lands on pane 2's. **Refused.** Main's refusal
  plays the leaving backwards — the face goes back to its row, the ground falls, the blur
  lifts, the stage comes forward — and the refusal is said where it always is (the Me menu,
  the Settings head, the Account page, the chooser). **New user…** leaves the same way to the
  plain splash, the wordmark and no face, because that is exactly how a new user's window
  begins. Nothing here is theater: no spinner, and the bar moves on real progress only.
  Reduced motion (M6): no travel, blur or recede — the face and the words fade in place
  (120ms), the ground rises in 180ms and falls in 120ms.
- **Empty / degraded states**: a state is rendered, never blank space — dashed-hairline
  pill for drop affordances ("Release here to put it back"), progress with numbers
  ("index rebuilding · 42%"), placeholder faces for missing plugins (A6/A8). Empty
  screens invite the next action.
  *Erratum 2026-10-03 (DK-0d, against the desk):* on the desk a missing plugin's object wears ICE's
  missing face, never a VibeField placeholder (DK-D18 as amended; the missing face, above).
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
- **The desktop update card** (WP12d L3c-ii, 2026-10-15; `build-wp12-updater.md` §13; Settings › General after
  Desktop): the app's own updater, main's, over the host bridge.
  - **One state line**, in words, with its number and its provenance:
    - "VibeField is up to date · checked 14:02";
    - "Downloading VibeField X · 42%", over a 3px bar that moves on real progress only (no spinner);
    - "VibeField X is ready — restart to finish updating" (never "installed": macOS stages, EDP-34).
  - **The policy's answers** read in `--vf-ink-attention` ("Updates are paused by VibeField's publisher", "This update
    needs a newer macOS"). A failed check reads in `--vf-ink-danger` with "Check again". These are the inks, because a
    state word is read (§2.5). Offline is quiet: "Couldn't check — offline · VibeField tries again on its own".
  - **The notices** (a refusal, the advisory line, a bridge that didn't answer) are the kit's neutral `InlineNotice`,
    and their words carry the meaning.
  - **The card IS the consent** (C2):
    - "Restart to update…" takes ONE snapshot. The consent names what ends in main's own words, the very words the
      tray's box joins.
    - It is the two-step destructive confirm below: "End N sessions and update" in `--vf-red` text, with Cancel focused
      (the tray box's default).
    - A release that ends nothing restarts on the one click. No apply asks twice.
  - **A lower channel** says EDP-36's sentence before it takes ("Return to stable — reinstalls the latest stable
    release").
  - **The advisory UNSUPPORTED line** is a sentence, never a block.
  - **Settings › Diagnostics' "Updater" block** renders the doctor's lines as `SystemSection`'s key/value rows. A support
    bundle's `doctor/status.json` carries the same lines.
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
- **Fact labels — scope and timing** (GT-7, Settings → Terminal; 2026-09-24): a page whose
  settings have DIFFERENT owners says, on each section head, whose a setting is and when it
  lands — as facts, in the plugin-source-badge recipe (hairline chip, no fill, no hue; 10px
  uppercase, tertiary ramp). Scope: "This window" (the viewer's own store, GT-D12) · "This
  Mac" (a device document every terminal reads) · "Read-only" (a fact, shown so nothing is
  guessed). Timing: "Live" · "New terminals" · "After save" · "Kept, not drawn" on a DASHED
  hairline; "Next ghosttea" — not in the shipped release — DOTTED. Ownership and timing are
  not states of concern, so a tag never takes a hue.
- **Device-document edits collect in one save bar** (GT-7): edits to a device-scoped
  document (config.ghostty) never apply per control. They gather in a bar at the page's foot
  — "N changes to config.ghostty · every terminal on this Mac reloads when you save", Discard
  and Save — because one save reloads every terminal on the device and deserves one moment
  of review. The bar tells the loader's truth as it arrives ("checking…", "N errors to fix
  first", "includes can't change here") and holds Save only on the loader's verdict. A
  CONFLICT names both sides ("Use the file's version" · "Save mine over it") — never a
  silent clobber. This-window settings on the same page apply as they change; the scope tag
  is what tells the two apart.
- **Godview's terminal deck is a sheet over the monitor** (2026-09-28, James — the first of
  §1.1's named departures from the reference). The deck is one card whose top edge is a tab: rounded
  top corners, §2.3's hairline as a ring, and the Sheet shadow (§2.7's row) cast UP onto the
  monitor, so the stage reads as lying beneath it. **The card's ground is the frame** (round 3,
  GV-D7 — "make the inner pane part feel like wrapped, maybe a inner border", James, 2 Oct; built
  2026-10-11): the terminal's own background — `--vf-godview-terminal-bg`, projected from the
  same theme the panes are handed (a catalog theme, the per-mode choice, or §2.7's terminal
  grounds) — mixed toward the terminal's own ink, 11% by day and 9% by night (§2.7), at the
  stage's glass (`--vf-godview-stage-opacity`), with the ring and the shadow cast up. **The panes
  sit in a well** set into it: 8 in from each side of the sheet (the 8 a covered view keeps
  clear, §10) and from its foot, corners 10, the panes 1 in from its edge and clipped at 9; drawn
  OVER the panes, a 1px inner edge and a soft shade at its top; under its foot, a rim of light —
  set in, not drawn on. The well has no ground of its own, so a pane's own ground stands over the
  frame's: the lip and the sheet around the well are a shade off the panes, on purpose. The
  panes, their frames and the launcher are the ones that shipped before it, untouched (GV-D2).
  *(Until 2026-10-11 the card's ground was the terminal's own background exactly — James,
  2026-09-28 — so that lip, gaps and panes were one surface.)* A viewer who thins the backdrop
  thins the sheet with the rest of Godview; the panes cannot shed their ground (ghosttea draws
  inverse video and glyph backdrops from it). *Since 2026-10-03 (FC-D16) the backdrop's default
  is the covers' glass, 72%*; the panes keep their own 82% and the launcher its 92% floor (§2.7),
  so text never sits on the field. **Inside the cover (§10, FC-D15)** the sheet's ground still runs to the
  window's foot and edges, under the line, but the panes stop at 692 — the 88px reserve above the
  foot — and keep 8px clear of each edge.
  *Erratum 2026-10-03 (DK-0d, against the desk — DK-D25, R16):* on the desk Godview's LIVE backdrop
  — the viewer's glass, `backdropOpacity` / `backdropBlur` (GT-7), and with it the terminal
  preview's middle layer — retires, as does rosetta's room glass in History: the cover is a tint at
  the covers' 72% over a still of the desk blurred once (§8, the covers over the desk), and their
  settings rows go.
  *As built (DK-15, 2026-10-07):* the rows gone, by name — Settings → Terminal → Look → Glass's
  middle layer, **"Godview's backdrop"**, with its **"Backdrop opacity"** and **"Background blur"**
  rows (and their two search entries; the docked preview's foot no longer says "backdrop N%" or
  "blur N px"); Godview's system controls' **"Stage opacity"** and **"Backdrop blur"**. The Glass
  section is two layers: each terminal's ground, then Godview's cover over your canvas. The deck
  record keeps no backdrop: a saved `backdropOpacity` / `backdropBlur` reads as nothing, and the
  next write drops it. Godview's ground is the stylesheet's own — the stage colour at 72%
  (`--vf-godview-stage-opacity`, which the sheet and the launcher read), with no backdrop filter.
  History's room keeps its paper fades' masks but not their frost: on a host surface under a cover
  the transcript's top fade and the sticky day heads are the cover's tint (`--vf-chrome-solid`,
  feathered by the room's own masks), never a backdrop filter — the room's sheet is rosetta's, so
  the override is VibeField's, scoped to the view and riding the room's own chunk.
  *Carve-out 2026-10-12 (docket N3 (a), James):* the **sticky day heads frost** again — the room's
  own 14px blur, feathered by its own mask (`linear-gradient(#000 72%, transparent)`), over the
  cover's glass, on every head the room draws as `.ah-day` (a list's days and its section heads
  alike); the override keeps only **the transcript's top fade**, which stays the cover's tint. The
  ruling asks the frost's cost to be measured under a cover before it lands. *Measured 2026-10-12* (lane dui,
  offscreen at 60 fps, History under its cover, 181 rows and 45 day heads scrolled 8 s an arm, paired A/B with a null
  A/A): no frame cost (rAF p95 16.7 ms in both arms, no long frames); the GPU process about 5 points of a core higher
  (+37 %) while the list scrolls, every pair above the null's spread; a still list costs nothing.
  Over the monitor the card occludes the bodies exactly as much as Godview occludes the field.
  **The Lip** (GV-D7; built 2026-10-11) is the lip grown into the drag bar: **30** tall, on the
  frame's tone. **The groove** (GV-D12 — James's pick over the lean: "i like the groove one")
  stands in its middle, in its pill: a 40 × 6 slot pressed into the frame, the well's own depth
  in miniature (§2.7 has its states), where a 72 × 4 bar stood until then. **At its right end,
  10 in and 4 apart, minimize, then maximize** — the order windows keep them (GV-D7; built
  2026-10-11) — each 30 × 24 with its glyph at 14 (§13), in the terminal's ink (§2.7), standing
  beside the separator, never in it: the whole lip drags the edge, but never its buttons. **The
  edge moves:**
  the whole lip (`role="separator"`, ↑/↓ 24px, ⇧ ×4, Home/End, double-click to rest) drags it,
  and 6 above it so it can be caught from the monitor — `row-resize` over it, `grabbing` while
  held. A drag reads the person's own moves at the window, so a pointer capture the browser
  drops ends nothing (One Frame §23, "Found while driving it"; 2026-10-11). The sheet is
  **placed at its edge**: rest plus the edge's move, so the terminals' box follows the edge
  alone. **Rest** (N15 (a), ruled 2026-10-11; built 2026-10-12 — *replaced* "the head's 40 and
  the monitor's tuned height, `Monitor height`, 35%, 170px floor", a slider that is gone): **300
  from the stage's top in the drawing's 780-tall window** — where the sheet's top corners clear
  the edges' slivers (332–428), so the lip is 300–330 and the panes 330–692 — **and the same
  share, 5/13, on any other height, never above 232** (L21): 5/13 is the ruling's 38.5% made
  exact, the drawing's 300 of 780; 232 is the field's least height, 220, and its 12, so at rest
  the monitor's field always ends 12 above the edge and is never shorter than 220. A height the
  old slider stored is read past,
  removed from storage on load, and never applies. The floor holds below a 603-tall stage.
  Rest names no head: the monitor's basis is rest less the head's height, whatever stands above
  it. A deck that is up rises to **the fill line, 104 from the
  window's top** — Home takes it there, ↑ stops there — the bodies still moving beneath; a HELD
  edge goes on up to the window's top. *(2026-10-11: until round 3's W6 the reach was the head's
  reserve, 56 — an interim, with nothing for a higher edge to become — and before that the bar's
  bottom edge, 40. The reach is a place in the window, the same with the bar above the monitor
  and without it, and a lip at 104 is clear of the head, its foot at 48, and of the app's drag
  strip, the window's top 52, §10.)*
  **The monitor makes room** (round 3, W4; built 2026-10-11; re-ruled 2026-10-19): its field
  **ends 12 above the deck's edge** as it was last set, and **never above where it ends at
  rest** — so at rest the field is at its least, and it only grows. An edge set below rest grows
  it; an edge set above rest leaves it as it is at rest, and the sheet slides OVER the field, the
  bodies still moving beneath. Measured once per change — a let-go, a key, a double-click, a
  window that moves the bounds — and never once per frame of a drag: a held edge moves the sheet
  and its terminals, not the field. At rest the field ends 12 above the sheet. *(2026-10-19,
  James: "for the swarm squeeze issue, let's tackle this way, when at the default terminal pane
  height, the swarm area is at its min height, so when user move the terminal pane further up,
  no more squeezing the swarm bounds". Until then an edge set above rest shrank the field to 12
  above it, down to a floor of 220 from the window's top, and the swarm's fit shrank the crowd
  with it. The rule W4 replaced — "upward the monitor does NOT shrink — its tuned height … is
  its minimum" — is this one, with rest in place of the tuned height that N15 retired.)*
  **A let-go decides** (round 3, W4; built 2026-10-11 — *replaced* "The deck keeps at least
  120px — above the cover's reserve, inside the cover"). Held, the edge follows the pointer and
  the terminals resize with it (rows only, so no reflow of history), on down past the line to 24
  short of the panes' foot (692 inside the cover). Let go, **it stays**, and the place is
  remembered — the viewer's (`localStorage`, the saved edge keeping its key), re-clamped to each
  window, never a shared setting — unless **less than 120 is left** between the edge and the
  panes' foot, or it is let go **moving down faster than 1.4 px/ms** (read across its last six
  positions, the let-go's own among them, so a pause before letting go is no fling): then the
  terminals go **away** (minimized, below), and the place the viewer left the edge is still the
  one remembered. Let go with **the edge above the fill line**, or **moving up faster than 1.4
  px/ms**, and the terminals are **maximized** (below) — at once, in one layout with no travel:
  the edge was already in the hand (L10) — and the remembered place, again, is untouched. 120 is
  still the least a deck that is UP keeps and the fill line its highest: End and Home take the
  edge there, and **keys never minimize and never maximize**. **A double-click** on the lip,
  never on a button, puts the edge back at rest and forgets the remembered place; each of these
  is one layout, with no travel. **While the edge is held past either line, the stage says what
  letting go would do** (James, 29 Sep: a readout is huge bold words in open space — the bloom's
  words, below), and nothing between the two: ***Minimize* the terminals** or ***Maximize* the
  terminals** (§9), 800 at 64px/1, −0.04em, in Godview's text main (§2.7), the verb at 40% and
  the noun full, haloed in the monitor's ground (40 and 18), over a **veil** of that ground at
  62%. *Minimize* is written on the monitor, centred between y 60 and the edge (never above
  150), its veil over the monitor down to 26 above the edge — both under the sheet; *Maximize*
  over the terminals, centred between the edge and the panes' foot (never above 150), its veil
  over the sheet from the edge down. In over 120ms, out over 160ms (§6), and gone when the edge
  is let go. Keys say nothing: they never minimize or maximize.
  **One resize per change** (built 2026-10-11; *replaced* "No transition on the edge: every frame
  of an animated edge would be a PTY resize" — whose reason stands, and is the reason for this).
  A move the product makes is ONE resize of the terminals, at most. **Rising** — called up, or
  maximized by its button — the deck is laid out at its END size first and travels there by
  `transform` (480ms, island, §6). An edge let go above the fill line, or flung up, is maximized
  AT ONCE, in that one layout with no travel. **Falling** — minimized, or restored — it travels at
  the size it HAS (300ms, the retract curve): restored, it is laid out at its edge on arrival
  (the state is up from the press, so the head and the lights come back at once); minimized it
  arrives laid out as it was — away, the sheet keeps the very box it had, out of the flow and
  below the window's foot, so it is not laid out again at all, and a rise to the edge it left
  lays it out not at all either. Only a person's drag resizes as it goes, rows
  only. The monitor's field is resized once per change too, to its end size — on arrival, and at
  a rise's start — never once per frame of the travel. Under reduced motion the deck is at its
  end at once.
  **The deck has one state — `away · up · maximized`** (round 3, GV-D5, GV-D6 and GV-D11; built
  2026-10-11). Godview's overlay owns it and alone publishes it; the stage draws the state
  it is handed, on its root, so the catalog and Settings' miniature can be handed any of the
  three without speaking for the window. It is published through a door of the frame's own, and
  withdrawn while Godview is not the window's view. The door carries the three-valued state for
  Godview's own readers; the frame's readers — the Peek's button and the Stories head — read
  only whether it is maximized. **The shell hears it by name** (`deck.set`): main lends ⌘W to the
  panes while it is not away and places the window's lights by it — a word kept while another
  view shows, since main composes it with the view it owns, and withdrawn only with the page.
  **The door takes one ask:** bring the terminals up, as a call does (below) — the deck's own
  doors ask it at every call. A lab asks it before it measures them, through the Godview markers'
  own seam (`window.__vfGodviewDeck.up()`: there only while the markers are on, read by no
  product code, safe at any time, answering nothing), and the deck's marker says when that call
  is what raised them (`raisedBy: "lab"`). **It is kept for the run:** a renderer reload finds
  the state it left — away, up or maximized — in the window's session storage; a launch opens
  Godview on the monitor alone (below).
  **Minimized** (GV-D6 — "Nothing, fully away"; built 2026-10-11): the Lip's minimize puts the
  terminals **fully away**: no tab, no sliver, nothing at the foot. **Every session keeps
  running** — a pane is a viewport, never the session — and the button's title says so (§9).
  Away, the deck takes no pointer, no focus and no key: the sheet is inert, a pane that held the
  keyboard lets it go, and the panes ask for no frames, as a closed Godview's do. The monitor
  has the window: its field ends at 692, the covers' reserve (FC-D15). (The drawing runs the
  field on to the window's foot, round the line and the face; a field under the line is the
  head's work, with its obstacles.) **⌘W on the last pane minimizes them too** (N16 (a), ruled
  2026-10-11; built 2026-10-12 — until then it asked for Canvas), and Godview stays the view.
  **⌘W closed that pane's session, so the terminals never come back showing it:** the pane is
  emptied as a cleanly exited agent's pane is — a fresh shell in the closed session's folder,
  with the launcher over it — and the closed session goes the way ⌘W sends any pane's: a shell
  never used is released, a running one runs on. The next call takes the empty pane's place,
  and ⌘T's terminal is its fresh shell; the closed session comes back only when it is the one
  called. If the new shell is refused, the terminals go away regardless, the pane keeps its
  session, and the line says so: **"Terminals minimized — the last pane still shows its
  session: a new shell could not be opened (‹fieldd's words›)"**. Away, ⌘W is the window's
  again (main takes it back, as under History), so a second ⌘W closes the window.
  **Called up** (GV-D5, GV-D6; built 2026-10-11): **any session brings the terminals back** — a
  body, a list row, a rain column, a timeline lane, a spend row, a search result, History's
  Resume, Jump to and New agent: whatever selects a session — and so do the line's create (New
  terminal, ⌘T) and the swarm's hold (the bloom's birth). They rise from under the window's foot
  (§6) **as they were left**: the same panes, the same edge, every session where it was. They
  rise at the call, not when the floor answers it; a call that then fails says so in its own
  words. A call while they are up moves nothing, and a call from another view (History's acts)
  raises them for the return. A hand-over — the fold moving a PTY into the pane it replaces —
  selects nothing, and raises nothing.
  **The monitor alone at launch, then as you left it** (GV-D5; N14 (a), ruled 2026-10-11; built
  2026-10-12). A launch opens Godview on the monitor alone: the terminals
  away, and nothing asked of them — no pane, no shell born — until something calls them (the one
  question a launch can put is the window's, below). **The first call brings last run's panes back
  with the session it called**, placed by the rule for a session with no pane (below): beside the
  focused pane, or in its place with three showing. While the last run's question waits, an act
  that called the terminals waits with the person, and its bound is the deck's time, never theirs
  (§8 "History"). *Amended 2026-10-15 (LR, James): the deck's own face — "this deck had N panes
  last time" · restore · start clean, asked at its first call — is retired; the question is the
  window's, as Godview opens.*
  **What the last run left — the curtain** (LR; James, 2026-10-15: "this restore dialogue should
  be shown at the godview at the center … a static view of previous snapshotted last state shown
  in each view … a semi transparent overlay on top"). When the last run ended with sessions this
  launch no longer has — agents its records can resume, panes whose shells are gone — **Godview
  opens on last run's picture**: every view draws the board as the last run left it (fieldd keeps
  ONE picture of its model board and holds it until answered — never a history), **still** — no
  motion, no verb, no pointer — and over the whole stage stands **the curtain**: a veil of the
  monitor's own ground at the readouts' 62%, the picture reading through it; in the window's middle
  a mono eyebrow, **Last run · 15:39** (the moment the picture was taken; the day too when it was
  not today); the count **huge**, the readouts' words (800, −0.04em, up to 64px, haloed in the
  ground), the nouns full and the joint at 40% — **2 agents · 1 terminal**; one mono line of what
  each answer does in those numbers — *Restore resumes each agent's conversation where it was and
  opens a new shell in the terminal's folder (at home if it had none here). Start clean lets them
  go.* — and, when the picture holds bare shells no pane showed, *1 shell that had no pane can't
  come back*, a step fainter; then **Restore** · **Start clean**, two pills of one weight (neither
  is the safe one, GT-3). It stands over the monitor and the sheet (20) and under the CRT layers
  (30) — it wears the scanlines — and the head (31), whose **view circles stay live** so each
  view's picture can be looked at before answering. **Restore** resumes every agent at once, each into its own
  conversation in its folder under its profile with its launch model, and hands each its old pane;
  the curtain says *Resuming 2 agents…* with both answers held, and lifts when they have started —
  or says, before it lifts, which could not and why in fieldd's words (*1 of 2 agents resumed* ·
  *Claude Code in vibe-field — its profile is signed out* · **Continue**). **Start clean** forgets
  the deck's layout and the picture; nothing still running is touched. A restart the floor
  survived asks nothing (the silence of GT-3). Motion: the curtain fades in over 240ms (`ease`),
  its words rising 8px on the island curve (480ms); reduced motion fades only, 120ms. **A first call that
  is a new terminal** — ⌘T, the bloom's birth — on a deck with nothing to bring back finds the
  workspace's own first shell, and that shell is the terminal: one pane, never a second born
  beside it (asked under an Agent Profile, the profile's shell is born in its place). Within a
  run — the view left and come back to, or the window reloaded — the terminals are as they were
  left: away, up at their edge, or maximized.
  **Maximized — the bar is the window's title bar** (GV-D11 — "it looks kind of awkward having
  the search button there blocking the terminal from becoming fullscreen and having the big gap
  at top", James, 2 Oct; built 2026-10-11). The maximize button, an edge let go above 104, or a fling up: the
  terminals take the window from its **top, 0**, and nothing of the head stays over them. The
  sheet loses its top corners, its ring and its shadow (160ms); **the Lip's 30 bar is the title
  bar**; the panes run from 30 to 692 in the same well, 8 in at each side.
  **The lights move onto the bar's axis:** `12 · 9` while maximized (the bar's centre, y 15),
  back at `18 · 22` (the head's axis, y 28) after, in one step. The OS draws and moves them; the
  window says only the deck's state, by name, and the shell owns the two positions — so a change
  of view puts them back in the same step. **The grip** — the groove in its pill — keeps the
  bar's middle, in a **168-wide hit** the bar's full height: it drags the TERMINALS. **The rest
  of the bar moves the WINDOW**, as a title bar does: the bar is a window-drag region, and that
  hit and the buttons are holes in it (`no-drag`) — the grip drags the terminals, the buttons
  click. **The app's own drag strip** (§10's top 52) **is left as it is.** The terminals' pane
  area declares `no-drag`, so the panes' first rows under the bar — y 30 to 52, inside the
  strip — take their clicks and never move the window. The 8 gutters beside the well stay
  window-drag: that is frame, not pane.
  At its right end, 8 in: **search · a hairline · minimize · restore.** Search is the frame's
  button at the bar's height (§8 "Search — the Peek"); the hairline is 1 × 14, the terminal's
  ink at 16%; **restore** — the square behind a square — stands where maximize stood, and the
  terminals fall back to where their edge was left. **On Windows and Linux** there are no
  lights: the bar is drawn the same, with nothing at its left.
  **Dragging the grip out turns it back into the sheet AT ONCE** — from the start of the drag
  (its first move: a press that never moves, a double-click's first half, leaves the bar as it
  is), not its release. The state reads `up` from that start, so the bar stops being a window-drag
  region at once; the corners and the shadow return, the monitor and the head above it, the
  lights go back on the head's axis, and the bar's own search steps out as the head's returns,
  so search is never in two places. Let go, the three outcomes above decide. **On the bar's
  grip** a double-click restores the terminals to rest (a fall, §6) and forgets the remembered
  place, and the keys take them out of maximized — ↑, ↓ and Home to the fill line, End to 120
  left — in one layout. **Maximized, the view's bodies rest:** the monitor's stage fades out
  (260ms) and its loops stop, the cover's glass stays under the sheet; they come back as the
  deck leaves maximized. Away from maximized, a call brings the terminals back up at their edge.
  The pane frame's own fullscreen (its two diagonal arrows, ⌘⇧↵) stays the pane's, and macOS
  full screen stays the green light's.
  *Status 2026-10-12: ruled and built. Built: the Lip and its two buttons, the groove, the frame's tone and the well (GV-D7, GV-D12); where a session with no pane opens (GV-D4); the terminals away and called up as they were left (GV-D5's call, GV-D6); the edge's three outcomes and their readouts, and the monitor making room; maximized, the bar the window's title bar (GV-D11); the monitor alone at launch, the first call bringing last run's panes with the one it called (GV-D5, N14 (a)); ⌘W on the last pane minimizing them (N16 (a)); rest, the drawing's share above a floor on every height (N15 (a)).*
  **Round 3 redraws the wrapper around these panes, and nothing inside it** (One Frame §22 "Shared
  mechanics", §23 and §23.1–§23.3; GV-D2 — "keep the current terminal pane design as is … what i
  want you to redesign is the wrapper", James, 2 Oct; GV-D4, GV-D5, GV-D6, GV-D7, GV-D11 and GV-D12
  ruled 2026-10-02; to be built, N12 (a), ruled 2026-10-11). Everything above that status line is
  what ships — the Lip and its buttons, the groove, the frame, the well, the terminals away,
  called up and maximized, and the edge's three outcomes among it since 2026-10-11. The items
  below were the ruling still to build, each saying which shipped sentence it replaced on the
  day it landed. The numbers are the ruled drawing's, in its 1180 × 780 window; the values are
  §2.7's. James ruled the three questions written here as open on 2026-10-11, and all three are
  built: N14 (a) "The monitor alone at launch", N16 (a) in "Minimized", N15 (a) in "Rest" (all
  above).
  - **A session with no pane** (GV-D4 — *built 2026-10-11, the first of these items to ship;
    RE-RULED 2026-10-18 23:33Z*): it opens **in the focused pane**, whatever the count. A pane is a
    window onto any session the person wants to watch — James, 2026-10-18: *"when i select a pane,
    and then click on any bubble, it should actually attach the clicked bubble to this terminal
    pane, because the meaning behind this action is that each pane is an window/observer, and it
    can monitor any of the sessions user want to observe"*; asked whether that holds for every
    door, **"Everywhere"**; asked about a session another pane already shows, **"Mirror it"**.
    So a session the focused pane already shows moves nothing; any other — one no pane shows, or
    one another pane shows — **takes the focused pane's place**, and the session it displaces
    keeps running (a pane is a viewport, never the session). One another pane shows is
    **mirrored**: two panes on one session and one PTY between them, sized by the pane that holds
    the geometry seat, the one focused last (DS-4). A new terminal — ⌘T, the bloom's birth — is
    born in the focused pane by the same rule, and a focused pane ⌘W emptied (above,
    "Minimized") is a pane like any. **⌘D still splits without limit, and it is the one deliberate
    way to more panes**: no door opens one. A pane held fullscreen over where a session lands is
    let go first, so nothing is focused out of sight; landing in the fullscreen pane leaves it up.
    Every door that selects a session places it so — a body, a list row, a rain column, a
    timeline lane, a spend row, a search result, History's Resume and Jump to, the Peek's Open, a
    peer's attach — and what it says follows: **"… in the active pane"** where it took the focused
    pane, **"… is in the active pane"** for one the focused pane already showed; each door's own
    entry in this section says it so (the line's New terminal, History's Resume and Jump to, the
    Peek's Open), corrected the same day. *This re-rules GV-D4's 10-02 answer* ("Beside the
    focused pane, up to three"): from 2026-10-11 a session opened **beside the focused pane** —
    ⌘D's split, to its right — while fewer than three panes showed and took its place after, one
    a pane already showed was focused where it was, and the doors said **"… in a new pane"** for
    beside. Its "never mounted twice" came from the ruled drawing's code, never from the ruling.
    The rule returns to GT-D17 (James, 2026-08-05: "clicking a remote bubble attaches the
    CURRENT ACTIVE pane") and to the original Godview's select, "Show this agent in the active
    pane", whose panes mirror a session.
    **Each door's turn ends** (2026-10-11): the deck places one session at a time (AR-4b), and a
    door's turn waits on a read of the floor it places from — this desktop's, or the peer's whose
    session it is — bounded at **10 s**. One that never answers fails its own door in words,
    **"the floor did not answer in 10 s"**, or by the desktop's name, **"studio did not answer in
    10 s"**, and the next door's turn comes; until then a read that never answered held every
    placement behind it, History's New agent among them.
  - **A session another device is driving** (item 42; James, 2026-10-19 03:00Z: in a desktop pane,
    the phone-sized content read as a glitch; the look ruled 21:38Z, "good, design all go with the
    lean"). While a pane's session has its geometry seat (DS-4) held outside this window, by a phone
    or another desktop, the pane goes on drawing the session at the holder's size, top-left on its
    ground, and says so in **the held-edge readout's figure** (above; James, 29 Sep: a readout is
    huge bold words in open space). **The words**: the holder's name as fieldd minted it, full, and
    **is driving** at 40%, 800 at 64px/1, −0.04em, in Godview's text main, haloed in the
    terminal's ground (40 and 18), centred in the pane over **a veil** of that ground at 62%, the
    content dimmed beneath it, never hidden and never blurred. Under them **one caption line** (11px
    600, ink 72%): the size held in mono, **45 × 22**, then **· click the pane to take it back**.
    **The pane colour lights it**: two inset glows, `inset 0 0 30px 2px` at 74% and `inset 0 0 130px
    18px` at 30%, and a radial bloom behind the words, 600 × 380, from 50% at its centre through
    16% at 52% to clear. The pane's line stays the frame's own 1px, never the selection ring's 1.5
    (§2.3): no key goes to this pane. **The entrance plays once**, 400ms after the seat goes, so a
    glance at the phone never flashes it: the veil in 200ms on plain `ease`, the glow on the island
    curve in 600ms and the bloom in 600ms from 140ms, the letters on the pop (280ms) from 140ms,
    26ms apart and capped at 400ms (§6's cap: a letter past it starts with the one at it), the verb
    tracking in from .34em on the island curve in 560ms from 340ms, and the caption in 240ms from
    540ms. Then it holds still, with no loop (§6: a held seat is a state, not a wait), and it goes
    at once when this window takes the seat. Reduced motion: the whole of it fades in over 100ms. It
    takes no pointer: a click goes through to the pane, and the pane's press takes the seat back
    (ghosttea's press take, at the pin). **When the holder lets go**, a focused pane on the session
    takes the empty seat itself, and the readout goes (James, 2026-10-19 17:42Z; it arrives with
    item 20's ghosttea lane, the first key takes). While no pane on it is focused, the readout stays
    and says the seat is free, in the same figure: **James's iPhone let go**, the verb at 40%, over
    **45 × 22 · click the pane to take it.**, the size the session was left at. *Status
    2026-10-19: until item 20's lane lands, no pane takes the empty seat by itself, so every pane on
    the session, focused or not, says this until a click.*
- **A launch in an empty pane is one element from the click to the first frame** (QL-2, 2026-09-29 —
  James picked look C · Cells from the Minimal Pane Frame's pass 4). The click (or ⌥n, or ↵ on a
  past session) answers in its own frame: the launcher shrinks to 0.94 toward the clicked mark
  (160ms, island) as it fades (160ms, `ease-out`), and that mark — the same element to the eye —
  hops to the pane's middle (46% down) on the pop spring (400ms, a spawn pop-in, §6), 11 → 26px, in
  the pane colour. The terminal's own ground covers the pane; under it, the pane's cell grid as
  dots, one per terminal cell (ghosttea's pitch, clipped to the grid's area so no dot enters the
  frame's bands), a dot about 2px across (radius 1.05px, feathered to 1.55px) at ink 20%. **Three
  facts move it and nothing else:** at 320ms the grid wakes in a 100px patch around the mark and a
  band of dots in the pane colour (85%) ripples out every 1.1s (island) while the mark breathes
  (§6); when the agent's process is running in the pane the grid reaches past the corners (560ms,
  island); on its first frame a last ripple opens the ground from the mark (480ms, island) and the
  mark flies into the badge's slot (420ms, island, from 140ms), turning the badge's colour as it
  arrives. The caption under the mark is the agent's label (11px 600, ink 72%) over `starting` or
  `opening` (`resuming` for a resume) and, from 1.5s, the seconds (9.5px, ink 42%, tabular) — honest
  state, never a progress bar it cannot back up. A launch drawn inside 320ms shows no indicator at
  all; a first frame that has not come 3s after the agent runs releases the pane anyway. The frame
  holds the badge's own mark back while the launch's is out (`data-vf-launching`), so there is never
  a second mark. A refusal drains the grid into the mark (240ms), lifts the ground, and hops the
  mark back to its row (360ms) as the launcher returns with the reason in fieldd's words. An agent
  that leaves its pane before its first frame (it exited at once, and the pane has a fresh shell
  again) lets the pane go at once: the grid drains, the mark goes out in the middle (160ms, to half
  size), and the launcher there says it exited before it opened. While it waits, a resized pane
  keeps the mark and the grid at its middle (240ms, island). Reduced motion: no travel and no loops;
  what changes fades in 100ms (the reveal is the ground's fade, the badge's slot opens at once) and
  the seconds still count. Colour: ink and the pane colour only — no orange, no green.
- **Hold, reach, let go — the spawn bloom** (SB, ruled 2026-09-30 by James on the page *Hold, Reach, Let
  Go*; the record is `thinking-spawn-bloom.md`). A long press on the swarm's empty ground keeps the hold
  ring as the **hub** and blooms around it the choices a new terminal can be born under: the **desktops**
  (only when there are two or more), and, reaching one, its **Agent Profiles**. One desktop blooms its
  profiles at once; one desktop with one profile does not bloom — the hold creates at once, as before,
  under that one profile (the pane keeps it, so its launches and typed agents answer alike). **Letting go
  commits the path so far:** the hub is this desktop under its default profile, a desktop its default, a
  profile exactly that; open ground or ⎋ opens nothing. The bud let go on grows into the new body where it
  stands (M1, M2) while the rest go back along their spokes (M4). **Geometry** (puppeteer's
  `views/swarm/bloom` constants are the numbers): ring one 92px from the hub, buds 48px, 42° apart
  (narrowed to fit 220°); ring two 80px from its desktop, buds 42px, 40° apart. The arc opens UP and turns
  in 15° steps only as far as the field's edge or the chrome forces it, never moving the centre, and the
  turn is chosen in strict order — the buds fit, then their labels, then every desktop has room for its
  profiles to bloom onward (never back toward the hub), then the open desktop keeps its label. Selection
  is by DIRECTION past a 22px dead zone (sectors at most ±26°); past the ring by 64px is open ground; a
  desktop opens on reach (12px short of its ring) and closes 34px inside it; a new ring ignores the
  pointer for 90ms. **Buds** are clear discs (white, `#242424` in the dark) with a 1.25px ring at 22% ink,
  the profile tabs' own glyphs (filled = the default) and orange dot; a desktop is its initial in the body
  type (there is no desktop mark; the laptop already means This Mac); the one pointed at inverts to ink
  and lifts to 1.16× (`--vf-ease-lift`, 180ms), the nearest leans in by up to 6%, an open desktop is
  ringed (2px) and its siblings step back (scale .9, the bud at .62, its label at .58); a desktop that
  cannot take a terminal keeps its place, faint and dashed, with its reason. **Labels** (the name in 9.5px
  mono 700 at 78% ink over a 7.5px 800 state line, haloed in the ground, 8px off the rim) do not sit on
  anything: one that would touch another bud at its hot size, another label, the hub, a spoke or the
  field's edge moves round its own bud 15° at a time to the nearest clear place, then keeps only the name;
  an open desktop's label boxed in by its profiles gives way. (Only a hold pressed against the field's
  edge, where no turn clears everything, can leave a label on the least-crowded place.) **The words** say
  what letting go does as a verb and a noun, huge (800, −0.04em; up to 72px, 6.6% of the field's longer
  side, down to 22px), the noun at full ink and the verb at 40% — *New terminal*, *Open on mini*, *Open as
  Work*, *Air is asleep*, *Cancel*, and *Opening as Work* for 460ms after letting go — over one mono line
  of where and under whom; they stand in the field's widest empty space, 40px clear of the bloom, stay put
  while the pointer moves, change as a new slate (150ms in, 120ms out), and are the live region. A peer's
  own profile reads **Default**. **The field goes quiet** (SB-D8): every body sinks under a veil of the
  monitor's own ground at 80% except the sessions under what is pointed at, which stay above it, and solid
  clearings (16px past the bloom's farthest bud or label, and under the words; feathered 44px and 64px)
  cut out everything beneath, so nothing shows through the bloom; the hub is drawn above them. **Motion:**
  buds pop out centre-first on `--vf-ease-pop` (280ms, 26ms apart), labels 140ms behind; back along the
  spoke on the retract curve (180ms, §6), their labels with them. The born body stands where it was let go
  — moved in from the field's edge only as far as the terminal's own body will stand, so nothing jumps
  when it arrives — hollow, until the terminal arrives; after 320ms its dashes turn and it reads OPENING
  (inside 320ms nothing indicates, as QL-2). A refused birth goes back at once; one the host answered
  whose terminal is still missing 4s later, or one the host never answers within 30s, goes back then.
  **Other doors:** a secondary click on empty ground opens it held open (move, click; ⎋ or open ground
  puts it away); the swarm's hidden list's `＋ New terminal…` opens it for keys (←/→ move, ↵ opens a
  desktop or commits, 1–9 pick, 0 the hub, ⎋ backs out) and it holds the keys while open; the list view's
  `＋ TERMINAL` offers the same tree as a two-step menu, in the bloom's order, the keys landing on the
  default. The empty notice says to hold empty ground, and so does a hint under a pointer held still (3px)
  over empty ground for 1.2s — the first three times after the app starts. A terminal born under a profile
  names it on its body (glyph and name, where the desktop has more than one) and its empty-pane launcher
  reads `New · Under Work`, an agent the profile has no sign-in for marked `no sign-in`. Reduced motion:
  no travel, overshoot or turning; 90ms fades; the body appears.
  **On the phone** (PJ-7, 2026-10-14; SB §2.12, `thinking-project-places.md` §6.3, Q4 (a)): the SAME
  geometry, transcribed — puppeteer's `views/swarm/bloom` numbers, held to it by a golden its own code
  generates — over SwarmStage's 520 ms hold. Every desktop is a choice: ring one is the desktops (from one
  desktop with two profiles or more, its profiles), each bud its **OS mark** (the desktop's own, §13), 48 pt,
  92 pt out, opening upward and turning only for the field's edge and the bar, its label above — the name
  (mono 9.5/700) over its state line (`2 RUNNING` · `IDLE` · `ASLEEP · 2 H`, mono 7.5/800). A sleeping
  desktop's bud is dashed and faint, and letting go on it opens nothing. Reaching a desktop with two profiles
  or more opens ring two with them; the agents' own folders read **Default** (Q5). **The hub is the home.**
  Letting go opens the **launch sheet** on that desktop and profile, never a terminal (Q4); one desktop with
  one profile does not bloom, and the hold opens the sheet as before. The words are the phone prototype's —
  `New agent on studio` · `New agent as Work` · `laptop is asleep` · `Cancel` — in SF 800 over the veil, the
  verb at 40%, one mono line under them, at the field's top when the hold is in its lower half and above the
  bar otherwise. **Haptics:** a soft impact as the bloom opens, a selection tick at each new target, success
  or warning at the birth (the sheet's Start). Reduced motion: the buds stand in place behind a 90 ms fade —
  no pop, no lift.
- **The terminal preview is Godview in miniature** (GT-7): a preview of how terminals will
  look mounts Godview's OWN parts over a depiction of the canvas — `GodviewStage` with its
  ground, the scanlines and vignette, `PaneFrameChrome`'s bands — never a painted
  imitation of a terminal. Its glass is named in the order light passes through it: the
  pane's opacity · Godview's cover (the covers' 72%, `--vf-godview-stage-opacity`, with no
  backdrop filter — FC-D16) · your canvas, on the desk a still of it blurred once (§8, the
  covers over the desk). *Amended 2026-10-07 (DK-16, as DK-15 built it):* this named "the saved
  backdrop" and a middle layer the viewer set — "Godview's backdrop (opacity and blur,
  `--vf-godview-stage-opacity/-blur`; the covers' 72% and sharp by default — FC-D16, 2026-10-03; it
  was opaque)". On the desk that backdrop retired (the deck's note, above): Settings → Terminal →
  Look → Glass is two layers, each terminal's ground then Godview's cover over your canvas, and the
  miniature's stage is the fixed 72% over its stand-in canvas, left unblurred, saying so ("over
  Godview's cover: the covers' glass at 72% over a still of your desk").
  Variants: `window` (on the page), `deck` (the
  theme browser's stage), `thumb` (a 600px window scaled, docked in the corner once the big
  one scrolls away, and minimizable to a pill). It is `inert` inside a `role="img"` with a
  description — a picture, never a second UI.
- **The monitor view owns its drawing** (MV, ruled 2026-10-03). List, rain, swarm, timeline and
  spend are SDK modules. The host mounts one at a time, supplies geometry and a finite skin, and
  never styles a view's classes. Each view's sheet is rooted at `.mv-<id>`; its local variables and
  keyframes use `--mv-<id>-` and `mv-<id>-`. No host DOM, theme class or stylesheet is a view
  dependency. **The skin** is the SDK's `MONITOR_SKIN`: `--text-main`, `--text-muted`,
  `--text-faint`, `--panel-bg`, `--panel-border`, `--control-hover-bg`, `--control-hover-border`,
  `--idle-bg`, `--monitor-bg`, §6's named `--vf-ease-pop`, `--vf-ease-lift` and
  `--vf-ease-island`, and the sans, `--vf-font-sans` (M178: the stage is monospace, so a view set
  in the sans reads the token, never a copied stack). Both host themes define the colours; the
  shared token sheet defines the easings and the sans. A new shared name changes the contract
  first; a view never copies a curve or reads an undeclared host token.
  Stage insets replace host padding rules, including the timeline's former extra 11px (MV-6).
  **The head reads the manifest:** each view supplies its filled mark and its focus keys; the host
  has no view mark table. The declared keys are said in the circle's label, after the view's name
  — ruled 2026-10-07 (James, M177) for the bar's tooltip, and carried to the label when the
  Stories head replaced the bar (§8 "Godview's head — Stories"). Where a declared key
  presses a control the view shows, its legend is printed on that control, under the glyph in
  readable ink (never an outlined box or a corner digit), as the views track prints ⌘1–⌘4 (§8).
  View loops stop under reduced motion or the stage's animations switch. Each piece of host
  chrome has its own boundary — the head, the usage column, the profile notice, the claims,
  System control, the deck and its edge, each pane's frame, the frames and the launchers: one that
  throws says "‹name› unavailable" where it stood (a deck piece in the deck's unavailable face),
  the monitor and its view stay mounted, and it is tried again only for a fact it is handed, at
  most once a window (1 s, doubling to 30 s while it keeps failing). (Find stood in this list until
  P2, 2026-10-09: the sheet left VibeField for the frame's Peek — whose Live now rows, live peek and
  scope-row filters each stand behind a boundary of their own, tried again for the rows, the run
  and the filters they draw, each the same object while its content is.) The head and the profile notice
  read only the window's own state, so they stay
  unavailable until the monitor mounts again (M192). It never
  leaves a silent blank. The deck builds the monitor's door, so a deck that fails whole leaves the
  monitor on no door (GT-D17). *(Made true 2026-10-07, MV-8b: the deck, System control and the
  claims stood outside any boundary until then. The window since 2026-10-08, MV-8b phase 2: the
  package's boundary, M179.)*
- **Godview's timeline is the swarm through time** (TL, 2026-10-02 — James ruled design F,
  Wakes, with its map of the day; `draft/godview-timeline/`). A fourth monitor view (`TIMELINE`,
  after swarm, list and rain). It is painted into a canvas, like the swarm and the rain. Lanes run
  in birth order and never move (TL-D4). A lane is 24–36px (18px for a bare terminal, kept in a
  quiet group under the agents, TL-D7). It opens on the last hour, following now (TL-D5), with
  presets 15M · 1H · 4H · 12H. Pinch or ⌘-scroll zooms at the pointer (240ms, island) and a drag pans.
  **Runtime only where no record is lent (MV-6, MV-D13, 2026-10-03):** a lane begins at its row's
  birth, claims no state before `statusSince`, and draws its current state from there to now; a
  row leaving the model leaves the timeline. That is still the whole drawing on the phone, in
  puppeteer's own Godview and on a desktop with no record.
  **The record's past (TL · TLV, 2026-10-10; docket v9, T1–T6).** Where the host lends `history`,
  a lane also draws what rosettad's record says of the last 24 hours. It is read at each ask;
  the view keeps nothing and nothing here records. *(Corrected 2026-10-10: this paragraph said
  the timeline was runtime only everywhere and kept no previous spans.)*
  **Each lane is one wake**: the record's stretches, then the current state, each in its own
  width. Time no stretch covers is a dotted thread, never a guessed state. Blocked and unseen are
  drawn only from the runtime: the record does not say them.
  - Work, now or recorded: 2 × 22% of the lane height, clamped 8–15px, in the project's colour
    (§2.6's exception), with a 1px sheen along it. A live lane adds a soft glow (the outline's own
    blur, 5px light at 24% · 6px dark at 62%).
  - Blocked and unseen: a 4.4–7.6px thread in `--vf-orange` and the swarm's blue.
  - Idle, and recorded quiet: a 1.7px hairline in text-faint.
  - Time the record does not hold: a dotted text-faint thread (1.2px dots, 3.4px apart), never a
    state. A silence longer than 15 minutes is not recorded.
  - Session bounds alone (the record holds a run's start and end, nothing between): a flat
    4.4–7.6px band in the project's colour at 50%. It is never work's swell, and the map never
    counts it.
  - The seam: where the record runs unbroken into the current state, a 1px cut across the wake in
    the ground colour at 70%. A gap there is already the dotted thread.
  **A run that ended keeps its lane** (TL-D6, restored 2026-10-10 and fed from the record). It
  stays in its birth slot at 45%, wake and name, until it scrolls out past the left edge. A
  2 × 12px tick in text-muted marks its last recorded activity. It has no glow and, past that
  tick, no body. It is named by its session's title, else by what ran it and its project. A
  receding filter (the profile tab) takes it to 30% of that; a narrowing one (the scope row's
  desktop) removes it, as each does a live row. It is lit and read. In VibeField a click on it,
  Return while it is lit, or its line in the reader's list opens its session in History (TV-8, ruled
  2026-10-11); a session that cannot be opened says why on the status line (§8 "The status line").
  Where no host lends that door (puppeteer's own Godview, the phone) it is never a control. Only a
  run this runtime ran is a lane.
  **At the head** sit the swarm's bodies, lit as the swarm lights them, the swarm's wave ringing out of
  one you owe (1.1s, island, the view's only loop). Beside each body is a readout: the current
  state's length, then its word. Names float over the wakes' far end; there is no rail. **Pointing
  at a lane (or ↑ ↓) lights it and quiets the rest to 30%.** Looking back shows the current span
  where it covers that moment. Before it, a lane with a record says what the record says: a
  worked stretch as work reads (`4:39` · `working · of 12m`), `quiet`, or `–` · `detail not
  recorded` on bounds alone; any other time is `–` · `not recorded`. Those last two wear a hollow
  body (a 1px dashed text-faint ring). Past its last activity an ended lane reads `last active
  27m ago`, or `last active 14:32` when looking back. The clock chip turns to the outlined head
  time, and NOW glides back (600ms, island). *(Corrected 2026-10-10: closed-span readouts and
  ended lanes were retired with the history book at MV-6. They are back, read from the record;
  these controls still record nothing.)*
  **When the record is partial or cannot be read now**, one sentence under SINCE says so in the
  record's own words, and a narrow head says `RECORD PARTIAL` or `NO RECORD NOW`. A whole record
  says nothing.
  **The map of the day** is its own 46px strip above the axis (TL-D17). Its right end lines up with
  the head while following now.
  - It is drawn as Pulse (TL-D15): the current spans, and with a record its worked stretches on
    live and ended lanes (T6), summed into one ridge, smoothed by an ~8px
    gaussian. Work stacks above a line in each project's colour, its height the number of agents
    working, drawn and never printed (FC-D18). Waits hang below in orange, then blue.
    Waits come only from the rows; bounds alone count nothing.
  - Only the window in view keeps its colour; the rest of the day is grayed.
  - The head is a 2px line with a knob, filled while following now and hollow while looking back.
  - **Pressing the map puts the head there, and dragging moves the head** across the known spans
    (TL-D16). It is a `role="slider"`: ← → 5 min, ⇧ 30, Home the day's start, End now. The now
    button prints End's legend `↘` under its mark, in `--text-main` (ruling 4, M179).
  **Colours:** project for work, §2.5's orange for blocked, the swarm's blue for a reply not yet
  opened (TL-D3), text-faint for idle. Never red; now is ink. One click opens the agent in the pane
  you are in (the views' `select`).
  **Reduced motion:** no wave, no glide, no zoom tween; positions jump.
  **There is no history book; the timeline reads a record it does not keep.** MV-D13 superseded
  TL-D8's status ledger: `agent.history` and fieldd's status recorder are removed. The `history`
  capability (2026-10-10) READS rosettad's record through the backend at each ask; neither a view
  nor its backend may begin recording one.
- **Godview's spend view is where the money went** (SV · MV-7 — James ruled 2026-10-07, M177: the
  runtime-only view as built, puppeteer `feat/sv-live` `d1890e0`; SV-D15…D19 are ruled later).
  A fifth monitor view (`SPEND`, after the timeline), painted into a canvas like the timeline:
  what each agent spent in the last ten minutes, a line each from $0, an estimate of
  API-equivalent USD and never an invoice. **A line is the backend's ten-minute series**
  (`cost.series`, twenty 30 s steps, kept in its memory: runtime only). A row without a series
  draws no line, and a peer's row never draws one (the view reads a series only on its own
  desktop's rows). The burn is the five-minute rate off that series, the same definition now and
  at a set moment, so the hero sums the printed rates (SV-D7's lean, M178).
  - The list beside the chart names each run. **The line under a name is the toolkit's
    `detailLine`** (M178, M4's one rule): the wait while blocked, else the reply, else the status;
    a peer's leads with its desktop. The task as a model fact goes to the SV refinement round.
  - Its words are set in the sans (`--vf-font-sans`); the stage around it stays monospace.
  - ↑ ↓ move the keyboard's focus between rows and Return opens the focused one, said in the
    bar's tooltip (ruling 4). **End lets go of a set moment, and its legend `↘` is printed on the
    Now pill** (M181: every printed legend comes from the toolkit's `keyLegend` table), in the
    view's secondary ink (6.5:1 light, 9.0:1 dark).
- **History is rosetta's room, on the cover's glass** (AR-8c, built 2026-10-03; One Frame §9
  "History, joined"; FC-D6, FC-D15, FC-D16; AR-D36…AR-D43): History is rosetta's own room — the
  projects, the sessions, the panels and charts, the transcript and its folds — mounted from the
  package `@vibefield/rosetta-room` behind VibeField's ports, so its drawing is rosetta's and this entry governs
  only where it sits and what VibeField says around it. Lists and figures arrive over fieldd's
  `index.*` doors; one session's body over the direct plane, with a grant of its own (EL2).
  - **Its ground is the cover's glass.** The room is a HOST surface: it paints no ground and no plate
    of its own, and the view's ground is the covers' glass, `--vf-chrome-solid` at **72%** (FC-D16).
    The room's paper fades — the transcript's top frost, the sticky day heads — **frost** over that
    glass (a 14px blur feathered by its own mask, the package's), never a mask on the scroller, which
    would fade the pinned chrome with the rows.
    *Corrected 2026-10-12 (docket N3 (a)):* this said both fades frost, and from DK-15 (2026-10-07)
    neither did — on the desk both were the cover's tint (§8 "The covers over the desk", the deck's
    note), which this line was not corrected for. Since N3 (a) the **sticky day heads frost** as
    above; **the transcript's top fade is the cover's tint** (`--vf-chrome-solid`, feathered by the
    room's mask), never a frost.
  - **Its edges are the frame's.** The columns end at **692** — the reserve of 88 above the window's
    foot (FC-D15) — and keep **8** clear at each side for the notches' slivers; the top band, 0–52, is
    the head's (FC-D6), holding only the window's lights: the strip's search pill left for the frame's
    button (GV-D10) and the Peek is not built, so History has no search yet. Its dialogs (a file, an
    image's gallery) land in a layer that ends at the reserve too, so a dialog is never under the line.
    The numbers are the frame's own (`frame/frame-geometry.ts`), never retyped.
    *Corrected 2026-10-04 (the search interim, below):* History has a search until the Peek lands —
    the room's own sheet — and the room's layer, where its dialogs and that sheet land, **starts at
    the head band's foot (52)** as it ends at the reserve, so neither ever covers the band: the band
    keeps only the lights, and a file shown full screen ends under it too.
    *Corrected 2026-10-08 (the Peek, P1):* the Peek has landed (§8 "Search — the Peek") and the
    room's sheet left with it. The band holds the window's lights and, at its right end, **the
    frame's search button** (GV-D10); the room's layer still starts at the band's foot, so no dialog
    ever covers the band or the button.
  - **Its create is Resume** (`resume`, §13): waiting, faint by ink, until the room has a session
    chosen ("Resume this session — choose a session first"), and waiting with the empty pane
    launcher's own words for one it would not resume ("its folder is gone", "not offered here", "not
    installed"). Pressed, it continues the conversation in its own agent and persona (`agent.resume`,
    the native form, as the launcher asks it), placed as the swarm's open places a session with no
    pane (§8, the deck, GV-D4: in the focused pane), and the window moves to Godview to show it;
    the note says **"Resumed in the active pane"**, or **"Could not resume — …"** in the launcher's
    words, and then the window stays in History. *Corrected 2026-10-18 (GV-D4 re-ruled):* it was
    placed beside the focused pane while fewer than three panes showed, and said **"Resumed in a
    new pane"** there. Jump to, for a session still running, is owed.
    *Corrected 2026-10-08 (P3):* Jump to is built — the next entry.
  - **Its create is Jump to while the session runs here** (`jump`, §13; AR-D43, K11 — built
    2026-10-08, P3; the room's own row footer, PJ-D9 (a), waits for PJ-4's slot). Whether the
    chosen session runs is read by **one plain `agent.list`** — no subscription, so a closed Godview
    still asks nothing (PF6) — joined on the room's native id: a run continuing that conversation,
    not stamped ended, with its terminal on this desktop's floor. It is asked again when the choice
    changes, when History shows again, and at every press (the board's feed is Godview's, and the
    index's pings move with transcripts, not with runs, so the line listens to neither). While an
    answer is on its way **the create keeps what it said** — Resume or Jump to, its glyph and its
    words — so a new choice never flickers through Resume on its way to Jump to (a press asks
    afresh, so what is kept only ever names the act). Live, the glyph cross-fades to
    `jump` (200ms `ease`, as between views) and the act is **"Jump to this session"**, which never
    waits on the launcher's reading: a running session is shown even where it could not be resumed.
    Pressed, the window moves to Godview and the session shows in the **focused pane**, placed as a
    resumed one is (GV-D4) — mirrored there when another pane shows it, nothing moved when the
    focused pane does; the note says **"Jumped to its pane"**, or **"Could not jump — …"** in the
    deck's words. *Corrected 2026-10-18 (GV-D4 re-ruled, "Everywhere"):* the pane already showing
    the session became the active one, and only a session no pane showed was placed. A session running on
    another desktop is not running *here* (reaching it is the mesh's, DS-4): the create stays
    Resume and says nothing new. The palette's row is the line's: the same reading, the same act.
  - **Resume refuses a running session.** A Resume pressed while the session runs here (the line's
    reading was older than the press) asks nothing of `agent.resume`: the note says **"This session
    is running — Jump to it"**, and the create becomes Jump to. Fieldd's own refusal of a second run
    on one conversation (AR-4b's one-run law, `terminal-alive`) is said in the same words. A Jump to
    pressed after the session ended says **"This session has ended — Resume it"**, and the create
    becomes Resume. *Before P3* nothing double-ran either: fieldd refused the second run, and the
    line said "Could not resume — it is already running" with no way to the pane that was.
  - **An act never ends in silence** (2026-10-11; two `smoke:godview` reds where New agent started
    a run, moved the window to Godview and said nothing for 60 s). Once the window has moved to show
    what an act started, the deck mounts it in its turn (AR-4b: one mount at a time), and the act
    waits **20 s** for that turn — the same bound it gave the deck to open. Past it the note says
    so: **"Could not start — it started, but no pane took it in 20 s"**, **"Could not resume — it
    resumed, but no pane took it in 20 s"**, **"Could not jump — no pane showed it in 20 s"** (and
    a live row the Peek opened from History says the last). Nothing is stopped: the run goes on,
    and a pane that lands after the note still lands. A start or resume whose pane could not be
    made is said with the reason in the parentheses — "it started, but no pane took it (‹why›)",
    an answer this build cannot read as **"fieldd's answer could not be read"** — and an act that
    throws anywhere is still refused in its own verb's words, "Could not start — ‹why›"; each is
    logged too (`renderer.history.unplaced`, `renderer.history.act_failed`). The deck's own turns
    end too (§8, the deck, "A session with no pane": a read of a floor that never answers fails
    its own door in 10 s), so an act's turn queued behind one still comes inside its 20 s. **The
    person's time is never the deck's** (W7): an act whose call brought the terminals up from a
    launch can meet the restore question (§8, the deck, "The monitor alone at launch"); while it
    is asked the act's clock stands, the note says **"Waiting in Godview — restore last time's
    panes, or start clean"**, and once answered the clock runs on from where it stood.
  - **Its honest states are said inside the frame** (§9; the tolerant reader). An index that cannot
    answer keeps the room's own **"rosettad is not answering"** (or "Connecting to rosettad") with
    fieldd's own words under it — "The agent index is starting", "The agent index is failed: …",
    "The history catalog has not read the index yet (connecting)", "Fieldd is not answering
    (reconnecting)" — never a blank. **An index that has FAILED carries its act** (fix7,
    2026-10-14 — until then the failed sentence named "the restart affordance" and no window
    offered one): under the room's words, centred in the room's box and 48 above the reserve, the
    frame's own band — **Restart the index** (`UiButton`, primary), then what it did in the line's
    words (`--vf-text-secondary`): "Restarting the index…" on the button while it runs, then "The
    index is running again." · "The index is rebuilding." · "The index stopped again — ‹fieldd's
    words›" · "Could not restart the index — ‹the refusal›". fieldd's failed sentence names the
    button: "… Restart the index in the desktop's History to try again". The PHONE shows the
    failed state in the same words and offers no act (P2: the phone reads); its sentence is the
    one that names the desktop. An index waiting for consent, nothing enrolled, says ours:
    **"No agent's history is read yet"** — "Nothing is enrolled yet, so the index reads nothing.
    Choose whose history it reads in Settings → Agents." (No count is claimed: a desktop with no
    agents to find waits the same way.) A recorded file says
    "Recorded files can't open here yet — no file door on the desktop" (the live-file read is
    bearer-only upstream, RO-13), and the worktree guest stays closed with its own words until
    VibeField's worktree host (AR-D38, AR-8d). *Corrected 2026-10-04 (RO-13 built):* a recorded
    file OPENS in the room's viewer — the window's grant carries `files` — and a file that is gone
    says rosetta's own words ("the recorded file is no longer available"); "Recorded files can't
    open here yet — no file door on the desktop" is said only when rosettad refuses the grant the
    file read (a daemon from before the scope, or a grant minted without it).
    *Amended 2026-10-27 (track AO, AO-D9 ruled by James; gap 2 of the record, a dead end: Settings
    → Agents had no such control):* an index waiting for consent shows **the History pane itself**
    in the room's consent slot ("Bring in your past sessions.", §8 "The Setup Assistant's agent
    chapter"), with its rows, its switches and its acts, on every visit until answered — the view's
    empty state, never a pointer elsewhere. Its home is Settings → History. An index that is not
    answering keeps the room's words and puts ours under them in a person's terms: **"History isn't
    answering. VibeField is restarting it."** with **Try again**, the daemon's and fieldd's names
    never on screen (§9 "The agents' words"; fieldd's sentences stay in the log and Diagnostics).
    **While it imports, the room's import is the room's own** (ruled 2026-10-27, "rosetta app
    already well designed, can be directly inherited"): its card's four named steps, its cold
    start, its cooking cards, a transcript's "Indexing history" and "Progress updates paused"
    stand as rosetta draws them, and VibeField feeds them every field they read (each project's
    progress, the search build's stage, the daemon's clock). A percentage names its step, never an
    invented whole, and the only sign outside History is the views track's arc (§6).
  - **It lists your projects** (PJ-4, H1–H6 ruled (a) 2026-10-09; "we map, the room draws"): the
    room's projects are fieldd's (`project.list`: places grouped by evidence, PJ-L1), each session
    filed under the key fieldd joined it to, and what the room draws beyond its own rows is
    VibeField's, handed through the room's host inputs (rosetta `host-inputs.ts`) and drawn in the
    room's vocabulary. Until transcripts travel (DS-7) the list is THIS desktop's places and
    sessions (H3): a project with no folder here is not listed, and nothing of another desktop is
    handed to the room as if it were here.
    - **A project's colour is its ink** (§2.9), never the room's dealt tint.
    - **A project row** leads its path line with one OS mark per desktop it lives on (§6.0 of the
      record, PJ-D24: Simple Icons' marks, 11 px, in the path line's ink), left-aligned in the
      listing's order, this desktop's first; an asleep desktop's mark is in the tertiary ink.
      Under the path, in the room's second-line type, what the others hold: **"4 sessions on
      Studio"** (and "(asleep)" after one that is). Its time slot says **"n live"** while its
      sessions run here.
    - **The list's order:** **Live now** first (a project with a session running here, by P3's
      reading: one plain `agent.list` per listing, asked only while History shows), then
      **Pinned**, then the projects in the room's own order (each desktop's **Home** among them, a
      row like any other, J11), then **Temporary** as ONE folded line at the foot — "Temporary ·
      6" (its sessions of the last 14 days) and **Show** — and under it, folded the same way,
      **Hidden**. An empty section draws nothing, and a fold never says "0": with nothing from the
      last 14 days the line reads "Temporary · older than 14 days · 3", and a Temporary holding no
      session here is an ordinary row, with nothing to fold away.
    - **In a project:** **Live now** first, then the room's days; in Temporary, the sessions older
      than 14 days fold behind **"Older than 14 days · n · Show older"** (PJ-L4).
    - **A session row** (PJ-D9) carries, in its id slot, this desktop's mark and the folder's path,
      cut whole folders from the left to fit (FitPath: `…/project100/vibe-field`, never a name cut
      mid-word; the whole path is its title); and at its end **Resume** (the `resume` glyph and the
      word) or, while it runs here, **Jump to** (`jump`) — or, quiet in the reason's place, why
      neither, in the empty pane launcher's own words: "folder is gone", "not installed", "not
      offered here", "can’t resume" — and "its volume is not connected". ④'s head carries the same act as a pill, or the same reason after the range. Pressed,
      each does what the line's create does, and the note on the line says what came of it.
    - **New agent** is ②'s head's one primary — the `start` glyph on the room's primary fill — and
      opens the room's rows: **Starts in** names the folder ③ shows (its mark, its path, its
      branch, "1 agent is already working there"; or, dimmed, why it cannot start there: another
      desktop's folder waits for routed acts, DS-2), then the ways to start there (PJ-6, built
      2026-10-12; Q7 "menu first" — the full launch of the record's PJ-D7 waits for the room):
      - **Last used** — the project's recipe (PJ-D13, written by fieldd at a launch's confirmed
        birth): the agent, the model, its effort, then the Agent Profile after a dash —
        **"Claude Code · Opus · high — Work"** — checked, "last used" at its end; "its own" for a
        launch that named no model. The words are the agent catalog's label and the agent's own
        picker's (`agent.models`); until that picker is read, its ids as they are. A recipe whose
        agent or profile is not here any more is dimmed and says why. None until a launch.
      - **Agent** — each agent this desktop offers under each **Agent Profile** it can run in
        (Q2: This Mac for every agent, a profile holding its sign-in for the rest — the profiles
        Godview's launcher offers, never personas), at the agent's own model and effort: the
        agent's label, the profile's name at the row's end, the most recently used agent first.
        Each row carries its own act beside it, **Another model…** (`chevron`, quiet until the
        row is under the pointer, → reaches it).
      - **Another model…** turns the rows to that agent's and profile's **models**: "All agents"
        first (the `chevron` turned 180), then the agent's own picker as fieldd last read it —
        each model's label, its description under it, and at its end the effort this project
        last chose for it; the recipe's model checked. While the first read runs one dimmed row
        says **"Reading Claude Code's models…"**; a picker that could not be read says why,
        dimmed — **"Sign in to see models"** for a sign-in, else the agent's own words — never an
        empty list; the foot says the picker's age, **"As of 3 min ago"** (and "· reading again"
        while a read runs behind it). Past nine models a filter heads them.
      - A model with no control starts at once; one with controls turns the rows to the first
        control's values, under its label ("Opus — Effort"): "Models" first (turned back), **its
        own** (the agent's own effort), then each value, the one this project last chose for the
        model checked and the agent's default saying so. A value starts it (or turns to the next
        control). The rows turn **in place**: the room closes its rows on a choice and VibeField
        opens them again on the next page — an interim until the room pages its own rows (a room
        ask). Rows closed without a choice (Escape, a press outside) open on the first page again.
      A row starts the agent in that folder and the window moves to Godview to show its pane; the
      note says **"Started in ~/…"**, or **"Could not start — …"** in fieldd's words ("Claude Code
      was not started at the chosen model: …" for a model it no longer offers) — or, for a run
      that started and no pane showed, why (above, "An act never ends in silence").
    - **③'s head is the folder list** (PJ-D22): every folder of the project under its desktop's
      mark and name ("here", "asleep"), a linked worktree one step in, the shown one checked; past
      nine a filter heads it. A folder on another desktop is never opened here: ③ says **"Files
      stay on Studio"** (or that Studio is asleep), and its caption names the desktop and the
      branch ("Studio · main"); a folder that is gone or unmounted says so in the same place. New
      agent follows the folder ③ shows (PJ-D8).
    - **The chips** (R7): over the list, **any desktop ▾** — every desktop with its mark, "here" or
      "asleep", and how many of these projects live on it (one with none is dimmed, so a choice
      never empties the list); over a project's sessions, **any agent ▾** — the agents its
      sessions ran under, with their counts.
    - **The project's acts sit where they act** (H4 (a), as James ruled it on docket v9: a `···`
      in the project's head; rename on the name itself; split on a folder's row in the folder
      dropdown; pin and hide also on list rows, with a Hidden foot — built on ROOM API v3
      2026-10-10; desktop windows only — P2). Temporary has none of them: it is not a project.
      - **A `···` in ②'s head,** after New agent, opens **Pin to the top** / **Unpin** and
        **Hide** / **Show again** ("It folds under Hidden, at the list's foot") for the project
        the column shows. Rename and split are not in it: each has its own place, below.
      - **Pin and hide also on ①'s row:** the same quiet `···` at the row's end, before its
        time, opens the same two rows — the ruling's "also": a project is pinned or hidden from
        the list without being opened. A hidden project folds under **Hidden** at the list's
        foot, its row's act saying **Show again**.
      - **Split on ③'s folder row:** each folder of a project with more than one, a desktop's
        Home excepted (J11), carries **Not part of this project** beside it — quiet until the row
        is under the pointer, → reaches it from the row; pressed, the folder leaves the project
        and the list closes, the folder ③ shows unchanged.
      - **Rename on ②'s name itself:** pressed, the name is a field; Enter keeps a changed name,
        Escape or leaving it keeps the old. A refusal stays in the field and says why under it —
        **"Could not rename — the project changed while you looked — try again"**, in fieldd's
        intent's own words — and a rename that took says **"Renamed to …"** on the line.
    - **②'s card slot** carries the **suggestions** (PJ-D16): "vibe-field shares old history with
      **vf-docs**" with **Not the same** and **One project**.
    - **The card's look** (VibeField's own, inside the room's card slot; the suggestions are its
      one card since rename moved to ②'s name): corners 12, the hairline, padded 10 12, its words
      at 12.5/400 in secondary ink, its buttons 26 tall, corners 13, 12/500 — the ready fill, the
      one primary inverted on the foreground like the room's go.
  - **Its first open says "Opening History"** (2026-10-04): the room — its code and its sheet — is
    its own chunk, on neither the first paint nor the canvas's. It loads when the window is first
    idle after the canvas has drawn, or at the first ⌘3 if that comes sooner. While it arrives the
    view is already the covers' glass with the room's edges (its box ending at the reserve, 8 clear
    at each side, and the room's hairline under the head band), and in the consent line's place and
    type (the kit's empty state under the `history` glyph) it says **"Opening History"** —
    "rosetta's room is loading." The words are **late**, as the veil's are: invisible until 120ms
    have passed, then a 180ms plain `ease` fade, so a room already loaded never flashes them; the
    glass under them is the room's own, so nothing moves when the room takes their place. A room
    that cannot open says so in the same place, never a blank: **"History could not open"** over
    what failed, in its own words, and a quiet **Retry** (the splash's rule: the plain reason, then
    Retry). *Amended 2026-10-27 (AO-6a; §9 "The agents' words", the page's rewrite): it says
    **"Opening History…"** and nothing under it. "rosetta's room is loading." named the machinery,
    which is never on screen.*
  - **Its search is the Peek** (§8 "Search — the Peek"; built 2026-10-08, P1). The search interim
    (ruled by James 2026-10-04) retired with its landing, as AR-D41 said it would: the room's strip
    no longer holds its launcher pill and the room's own sheet is never drawn — VibeField passes the
    room no `search` — and the `history-search` surface left the frame's value with them. The frame's
    button at the band's right end and **⌘F** open the Peek on **Everything** (GV-D9), and a past row
    opens the room **at the line** through the room's own `openAt`: the session, in its project, the
    transcript landed on the message. **⌘G / ⇧⌘G retired with the interim** (K3): they walked the
    stepper a hit from the room's sheet left, and the room's `openAt` clears that stepper, so nothing
    is left to step. The empty transcript says **"Pick a session, or search with ⌘F."** (Ctrl+F off
    the Mac) — the key the button prints (K2). No recent searches are kept: the room's sheet kept
    them, and the Peek draws none.
    *The interim, for the record (2026-10-04 to 2026-10-08):* the room's strip held its launcher
    ("Search 11 sessions across 4 agents"), which printed no key (⌘K is the palette's) and grew into
    the room's top-attached sheet in the room's layer, one of the frame's open surfaces
    (`history-search`); a hit landed the transcript on the message, and ⌘G / ⇧⌘G walked the
    session's other matches; the empty transcript said "Pick a session, or search above."
  - History follows the app's **theme** (the room reads the page's `.dark` and the kit's `--vf-*`);
    it has no toggle of its own. Under **reduced motion** the room's own transitions collapse — the
    floor the room asks of its host, scoped to the view. Its **preferences** (dealt project tints,
    the fold) keep under `vf.history.` in the window's storage, where a refusal
    costs only the memory. ⌘3 out and back keeps the room as it was: its scroll, its choice, its
    open stream.
- **Search — the Peek** (One Frame §23, round 3; GV-D8 the Peek, GV-D9 the view's own scope,
  GV-D10 the frame's button, GV-D3 the filters inside search — ruled 2026-10-02; built for History
  2026-10-08, P1): ONE search for every view that searches, the frame's and never a view's — "the
  search designs are the same and consistent on both views … a bigger and centered popup in the
  middle of the screen with background all blurred and dimmed" (James, 2 Oct). It is History's
  and, since P2 (2026-10-09; docket v9 PK2/PK4/PK5, all (a)), Godview's: puppeteer's Find sheet
  left VibeField with the bar's FIND, and Live now is the Peek's.
  - **The button** is the frame's: a 40 glass circle (the line's glass, §5) at the head's right end —
    16 in, `top-2`, on the lights' axis — holding `search` 15 in secondary ink (primary under the
    pointer), lifted 8 so **its key is printed under it**, as the views track prints its keys: ⌘F at
    9/600 in secondary ink, the ⌘ at 8.5/500 in tertiary (Ctrl F off the Mac). It stands above the
    cover with the line, the edges and the corner (62), in the views that search — History and
    Godview. **⌘F** (Ctrl+F) opens the popup, or puts the caret back in its field while it is open:
    a product chord (§10).
    **With a filter on** (Godview's, GV-D3) the glass grows a token after the circle naming it —
    the desktop's OS mark and name, a hairline, the profile's glyph and name ("studio · Work"), at
    13/500 in primary ink — and a 26 × that clears both: a filtered view never looks unfiltered.
    **In Godview** it stands in the same place, on the head's own row: the Stories row (§8
    "Godview's head — Stories") is centred on the window and keeps one head gap (12) from it, also
    as its glass widens. *(Until the Stories head, built 2026-10-11, it stood over the instrument
    bar's right end and hung 8 below the bar's foot, PK2 (a).)*
  - **The button in the terminals' title bar** (GV-D11, ruled 2026-10-02; One Frame §23.1;
    built 2026-10-11, its step-out below 2026-10-12): while
    Godview's terminals are maximized (§8, the deck) the head's circle is not drawn — nothing of
    the head stands over the terminals — and the same button stands in their title bar, first of
    the controls at its right end, before the hairline. It is folded to the bar: **24 tall**,
    corners 8, padded 0 8 0 7, `search` 13 with **⌘F printed BESIDE the glyph**, 6 from it, since
    a 24 bar has no room under one (10.5/600, the ⌘ at 500 and 72%; Ctrl F off the Mac) — in the
    terminal's ink at 64%, the full ink on a 10% fill of it under the pointer, as the bar's other
    controls are (§2.7). It is the frame's ONE button standing in another place, never a second
    one and never the deck's: the same act, the same `search` surface (§10), the same return of
    the keyboard, and the popup opens over the terminals. ⌘F is unchanged. **A filter that is on
    is not named in the bar:** maximized there is no view for it to filter, and the popup shows
    it. As the grip is dragged out of maximized the bar's button steps out (120ms) and the head's
    returns (200ms), so search is never in two places. It is one button, so the two are a
    sequence, never a morph of the 24 bar control into the 40 glass circle: the bar's control
    fades where it stands over 120ms on `ease`, taking no pointer, and once it is gone (its 120ms
    and the deck's two frames, 34ms, on a timer) the circle fades in at the head over 200ms on
    `ease`; maximized again mid-step, it is back in the bar at once. Into the bar, and under
    reduced motion, it changes its place at once. The head's row starts its fade back as the deck
    leaves maximized, so the circle starts 154ms after it. The deck's ink it wears is lent by
    Godview's stage on the document (`--vf-godview-bar-ink`) while the terminals are maximized.
  - **The popup — Peek, 900 × 560**, centred in the window: solid (`--vf-chrome-solid`, FC-D14 —
    rows to be read), corners 24, ringed by the strong hairline, with its own shadow (§5, *Search
    popup*). It pops in on the island curve (§6). **The scrim** (§5, *Search scrim*) blurs and dims
    the whole window under it; **the view recedes** to 0.98 about 50% 46%, and the frame recedes with
    it (the line, the edges, the corner, the button) — the cover, the still under it and the chrome
    together, never the desk's own box (DK-15; §6) — only the window's lights stay sharp, as the OS
    draws them. Nothing under the scrim holds the keyboard while it stands (the field is inert), and
    the keyboard goes back where it was when the popup folds on its own. A click on the scrim closes
    the popup.
  - **Top to foot.** **The field**: 64 tall, `search` 18 in tertiary ink 22 in, the words at 20/400
    (−0.01em) in primary ink with the select caret, and at its end **close** — a 40 circle, `close`
    12 lifted 9, **esc printed under it** (9/600, secondary), the ready fill under the pointer. In
    Everything it says "Search your whole agentic past…". **The scope row**, 48 tall between two
    hairlines: a **Live now · Everything** segment — the ready fill as its track, padding 3, corners
    12; each half 28 tall at 12.5/500 in secondary ink, the chosen one solid in primary ink with the
    hairline and a 1px shadow — then that scope's dropdowns, 30 tall, corners 15, a 13 glyph in
    secondary ink, the name at 12.5/500 and a turned `chevron` 11 in tertiary (the ready fill under
    the pointer). Everything's are **Every project · Prompts and replies · Any agent**; Live now's,
    in Godview, are the view's own filters (GV-D3) — **All desktops** (every desktop's OS mark; a
    desktop's mark and name, `here` beside this one, its agents or its standing beside each, a
    desktop not answering quiet) and **Every profile** (the person glyph; a profile's own glyph,
    filled for the default, `waiting` beside one a session under it waits in) — each offered only
    when there is a choice to make (two desktops; a profile besides This Mac), and they **filter the
    view too**: the stage shows what search's Live now shows. History's Live now has none. Each
    opens a solid menu (§5) 4 under it, and a filter that is on names itself on its dropdown. In
    Godview the placeholder says "Words said in a live session, a folder, an agent…". **The body**:
    the list, 380 wide, and the peek beside it, a hairline between them. **The foot**, 52 tall over
    a hairline: one count sentence at 12/400 in tertiary ink, and **Open** — 32 tall, corners 16,
    12.5/600 on the ready fill (14% under the pointer) — with **↵ printed on it** in tertiary ink: a
    live row's says **Open in the terminals**; a past row's **Open at the line** in History and
    **Open in History** in Godview.
  - **A row is a session** — the root a reader lands in; the lines that matched are its evidence,
    never rows of their own. Its head: the title at 14/600, then the time at 12 `tabular-nums` in
    tertiary ink at the right end (the clock inside today, the day and the clock inside the year, the
    day and the year beyond it). Under it, indented 17 (the state dot's column, empty for a past
    session): **folder · agent** at 12 in tertiary ink — the folder it ran in, by its last name, and
    the agent by the catalog's label. Then up to three matched lines, newest first: a 40 column
    saying who said it — **you**, **agent**, or the kind as itself (11/500, tertiary) — and the line
    at 13/1.45 in secondary ink, cut at a word with its first match among its first words, then
    ellipsised. Padding 10 12, corners 14, 2 apart; the hot row in the ready fill. **A live row**
    (Live now, P2) is the same shape: the 8 dot in the state's colour (§2.5 — working green,
    waiting orange, idle and a shell faint), the session's title (the transcript's, else its folder)
    and, where a past row says its time, its state — **waiting · working · idle · a shell**; under
    it folder · agent ("shell" for a bare terminal), and **a run on another desktop says where it
    runs** (K10): its OS mark and the desktop's name at 11.5/500 in secondary ink. With words, the
    runs whose facts or transcript hold every word (puppeteer's find model: the live runs joined to
    rosetta's words), by how many lines matched, then waiting → working → idle → shell; without
    words, every live session in that order, the bare shells last.
  - **A match is neutral, everywhere** (K1): the text's own primary ink at 600 on an 11% wash of it,
    corners 3 — never orange, which means "waiting on you" here (§2.5), and never the select blue.
    The peek too: the round-3 kit's orange line marker was a leftover.
  - **The live peek** (GV-D8, P2): what opening a live row would show — **the run's own pane,
    resting**: its terminal, watched, at corners 14 on the terminal's ground with a hairline, 14 in.
    It watches by construction (the canvas mirror's five layers, which DK-17 retired from the canvas,
    restored here): a runtime that refuses every geometry and input verb, `inert`, no pointer, no
    focus, read-only — so it makes **no geometry claim** (the pane keeps the PTY's size; the peek
    draws what fits), takes no focus and types nothing. A run on another desktop cannot be watched
    from here (no mirror until DS-4's): the peek says where it runs and that Open brings its
    terminal into a pane here.
  - **The peek** (K8, until the docket's PK3 rules): what opening the row would show. Today, that
    session's matched lines — every hit the index answered for it, in reading order, each led by
    who said it and marked as above, at 13.5/1.55 in primary ink — under the session's title at
    15/600 and its folder · agent · time at 12 in tertiary ink over a hairline; the line ↵ lands on
    sits in the ready fill. One component draws it, so an upstream reader or a timeline excerpt
    replaces it whole.
    *Corrected 2026-10-09 (PK3, built in PJ-4):* under the same head, the peek is now the room's own
    **read-only reader** (rosetta's `TranscriptReader`) at the matched line, the words typed marked
    — the session as opening it shows it, with no acts and nothing written back. A match stays
    neutral (K1) through the reader's own tokens: the text's own ink at 600 on an 11% wash of it,
    and the matched line keeps the reader's quiet edge in the tertiary ink. It reads the window's
    History ports (the room's one meta feed and its session leases); while its code arrives, and if
    it cannot draw, the matched lines above stand in. **Every project** names your projects as
    History lists them (fieldd's, with a folder on this desktop), and narrows by the project each
    hit's session is filed under.
  - **Honest, empty or not.** With no words typed, Everything lists your latest sessions and the foot
    says "Your latest sessions · every word you type must match". With words, it says how many
    sessions and lines matched, and that it is the first page only when the index stopped at its
    limit. With nothing matching: **"Nothing in your past holds every word of “q”. Try fewer words,
    or a phrase in quotes."** — rosetta matches a quoted phrase whole, and while a quote is still
    open nothing is asked: the foot says "Close the quote to search for the phrase". An index that
    cannot answer says so in the foot in fieldd's words, and the list keeps what it last showed —
    never "no matches" for a question nobody answered. **Live now**'s foot: "3 live sessions,
    waiting first" before a word (or "Nothing runs right now"); with words "2 sessions · 3 lines
    matched", with "searching" while the newest ask is out, "the words were not searched" when the
    index did not answer (the last answer's lines stand), "the first page only — narrow the
    search" when it clipped; the index's own state after it when it is not ready ("transcript search
    off — …", "indexing · 40%"). Nothing live holding the words: **"No live session holds every word
    of “q”."** with a press, **Search everything for “q”**. **Live now in History** (docket PK5
    (a), 2026-10-09) is live while it shows: the Peek opens the monitor's own feed (the model board,
    over this window's fieldd client) when Live now comes to show and closes it when it stops — a
    change of scope, the popup's close, unmount — so Godview itself still asks nothing while closed
    (PF6). Until it answers the foot says "Asking what runs…"; refused, "What runs could not be
    read — ‹fieldd's words›". (K9's "searched in Godview" retired with it.)
  - **Keys** (the kit's): ⌘F opens the popup or refocuses its field, on the view's own scope —
    **Live now in Godview, Everything in History** (GV-D9); **Esc** closes an open menu, then the
    popup, before anything else hears it; **↑ ↓** move the hot row; **↵** opens it; a click opens a
    row. **One surface at a time**: the popup is one of the frame's open surfaces, `search`
    (§10) — the palette, a drawer, the Me menu, Settings or a change of view fold it, and it folds
    them; ⌘K over it opens the palette, ⌘F over the palette opens it.
  - **Open in the terminals** (P2). A live row — ↵, a click or Open — folds the popup and, in
    Godview, does what the view's own select does: this desktop's run placed as a session with no
    pane is (§8, the deck, GV-D4 — in the focused pane, mirrored there when another pane shows
    it), a peer's attached the same way. From History it takes Jump to's path (P3): the frame
    moves to Godview and the deck shows the run in the focused pane by that rule; a peer's run is
    selected through Godview as it opens. *Corrected 2026-10-18 (GV-D4 re-ruled):* its own pane
    was focused if one showed it, else it opened beside the focused pane. A run that could
    not be shown is SAID, on the line's note in Jump to's words ("Could not jump — ‹why›"): the
    popup folded at the pick.
  - **Open at the line.** A past row — ↵, a click or Open — folds the popup and opens History at the
    line: the room's own `openAt` with the hit's session and message, the session in its project and
    the transcript landed on the message (§8 "History"). Everything reads this desktop's index (K5);
    other desktops' history waits for DS-7, since the room cannot open a peer's session yet.
  - **A narrow window** (K6): the popup clamps to the window — 24 clear of each side, and 96 clear
    of the window's top and foot (the line's 72, and 24), so it never covers the head or the line.
    Below a 680 popup — a window narrower than 728 — the list and a useful peek no longer both fit:
    **the peek folds and the list fills the popup**.
- **The phone's History is one ledger of projects** (PJ-7, 2026-10-14; `thinking-project-places.md`
  §6.3, PJ-D24, PJ-L7): the tab reads the projects every desktop groups alike from ONE door — the
  home's, or another answering desktop's while the home sleeps — and is no longer grouped by desktop
  (SP-D10's grouping is superseded). **A device is its OS mark** — the kept-exact Simple Icons
  marks (§13), template assets on the phone, in the text's ink — and never a hue. The **ledger row**
  keeps identity · location · quantity; location is the marks, **one per desktop the project lives
  on, left-aligned** in the roster's order (the home first) at 13 pt in `inkFaint`, a sleeping
  desktop's at 40% — the path never shows. The **scope line** ends in the marks of the desktops
  read (12 pt), and each sleeping desktop gets its own honest sentence led by its mark: `⊞ mini is
  asleep · read 11:42`. A **live row** names its desktop — mark and name — before its running
  line. The project's colour is **its ink** (§2.9) on the cap, the wash, the sparkline and the
  ribbon; the per-device deal by sequence retires from History. The **project screen**: the head
  (cap, name, count), `N places on` and the marks, the four tiles, Overview, Live now, then
  **Desktops** — one row per desktop (its mark at 19 pt, its name, `1 working` or `asleep · 2h`,
  and a disclosure that folds its places out run-fold style: each place by its folder's name and
  a branch that says more, then its last use or why it cannot take a launch), then the sessions by
  day. A **session row's** foot names where it ran — the desktop's mark and name, then the
  folder's name, never its path — and its last-word slot holds the session's act (Resume or Jump
  to, below) or the reason there is none. A session's document is read from its OWN desktop's door
  (the row's `device`); a desktop that does not answer shows what this phone kept, in the same words.
  **Resume and Jump to** (Q3 (a); TP §5): an ENDED session's slot takes **Resume** — the `resume`
  glyph and its word in a 28 pt pill — when its own desktop answers and its catalog offers it for the
  agent (absent otherwise); `asleep` stands in its place while that desktop sleeps. A session the field
  holds a run for (joined by the conversation's native id) takes **Jump to** instead, and a live row
  ends in a 32 pt `jump` circle; Jump to switches to the Field and opens that run's card. On a session's
  document the stepper's slot carries the same act with where it runs (mark, desktop, folder). A refused
  Resume is said, never shown as a failure: `studio is asleep` · `The folder is gone` · `Signed out of
  Claude Code on studio` · `Held under another profile on studio`.
  **The ledger's door's INDEX is said, never guessed** (fix7, 2026-10-14 — PJ-7's first phone run
  said "No project in your desktops' index yet" over a FAILED index): the reader asks `index.status`
  beside each `project.list`, and while the index is not ready the scope line gains one more
  sentence, led by that desktop's mark like an asleep one — `studio's index is starting` · `studio
  is rebuilding its index` · `studio is indexing · 61%` · `studio's index has stopped` · `studio runs
  no history index` — the project screen carries the same line under its head, and an EMPTY ledger
  says it as its note, with fieldd's own words after it: **"studio's index has stopped"** — "‹fieldd's
  reason›. History on this phone reads nothing from it until it runs again; its restart is in History
  on studio." (the restart is the desktop's act — P2, the phone reads) · **"studio is rebuilding its
  index"** — "studio's VibeField reads history in a newer form, so it is rebuilding its index from
  what it recorded; its projects arrive when that ends." · **"studio's index is starting"** — "Its
  projects arrive when it is ready." · **"studio is reading its history"** — "8,400 of 13,700
  sessions read; its projects arrive as it reads." "No project in your desktops' index yet" is said
  only over an index that is READY (or a desktop whose door offers no `index.status`). The phone
  offers no restart; desktop History's failed state carries **Restart the index**. While it is not ready the
  ledger is read again every few seconds (nothing pings when it becomes ready).
- **The phone's folder picker and launch sheet** (FS-2, 2026-10-05): the launch sheet
  keeps one system medium detent through loading, selection, refusal and spawning. Folder
  comes first, chosen in its own large sheet above the launch sheet. No task field: the
  terminal takes the task. A single agent or desktop is a quiet fact, multiple choices a
  dropdown. A desktop choice shows its platform mark and name in the chrome's neutral ink.
  The picker lists recent places, then home and volumes; folder rows carry child counts
  when known and the desktop's absolute path. Files and links stay muted behind Show files;
  links are never traversed. Every row has a discoverable Copy path action. Breadcrumbs and
  search stay within the chosen export. Offline rows keep their last-known paths and say
  “studio is asleep · read 11:42”; starting/restarting and partial search coverage are
  stated explicitly. Forms use the existing chrome palette, system prose and monospaced
  paths; the sheet radius remains 40 pt, as the phone's other sheets.
  **PJ-7 (2026-10-14; Q5, Q6, Q7, PJ-D12 (a)) — how it starts, in three more rows.** Under
  Folder, Desktop and Agent the same Form at the same medium detent takes **Profile · Model ·
  Effort**, menu rows (the system's `.menu` picker) that never come or go: a choice with one
  answer, or none, is a quiet fact in its own row instead — `Default — the only profile on
  studio`, `Haiku has no effort setting`, `Each agent's own · Sign in to see models` — never an
  empty menu and never a row that vanishes. **Profile** offers the desktop's Agent Profiles that
  hold a sign-in for the agent, and its agents' own folders, which the phone names **Default**
  (the wire's "This Mac" is a desktop's word for itself). **Model** offers "Each agent's own"
  first, then the agent's own picker as that desktop last read it under that profile; the
  footer says how old the read is (`models read 2h ago`), and a failed read is said in words
  (`Sign in to see models`). **What a row waits on is said, at once** (fix7, 2026-10-14 — the first
  open from the field stood empty for a minute): the sheet is presented BY its model, never by a
  flag beside it; the folder roots (the files worker's) are read beside the agents, never before
  them; a row being read says so — `Reading agents…`, `Reading profiles…`, `Each agent's own ·
  reading models…` — and a refused read is said in every row it empties (`Agents could not be
  read`, `Not read — no agent to run`, `Each agent's own · not read`) with fieldd's words in the
  footer; "No agent available" only when the desktop answered with none. **Effort** offers "Its own" first, then the chosen model's own
  effort values; switching model brings back the effort the project last ran that model at.
  **The folder row comes filled**: the place the project's last launch entered (its recipe's
  place), else the newest place on the sheet's desktop that can take a launch, named by its
  folder's name and branch; with neither, the folder sheet opens by itself. **From a project**
  the folder sheet lists that project's places first — under each desktop's mark and name, a
  place that cannot take a launch dimmed with its reason — then Recent places and Browse. A
  place is launched by its ref; only Browse sends a path, until PJ-8. **New agent** on a
  project screen stands in the stepper's slot: the 48 pt glass capsule 10 above the bar, the
  `start` glyph and "New agent", then the usual place's desktop mark and name (`asleep` when
  it cannot be asked).
- **The phone's session card attaches in words, and never waits forever** (fix8, 2026-10-15 —
  PJ-7's second phone run: ATTACH minted one ticket and the card read "connecting over the
  mesh…" for good, after the run had ended too). Between the tap and the first frame an attach
  waits on six things — the ticket, the phone's terminal-leg slot, the dial over the mesh, the
  cell's control acknowledgement, its frames acknowledgement, the first frame — and each has the
  same deadline, 20 s (the mesh's own request timeout and a margin). While it waits the card
  says `connecting over the mesh…`, as before. Past the deadline the card's banner names the
  desktop, then the step and the number: **`couldn't reach studio's terminal`** over `the dial
  over the mesh got no answer — stopped after 20 s` (and, step by step: `the ticket was asked
  for and never came back`, `this phone's last terminal never let go of its connection`, `the
  terminal took the dial but never attached the session`, `the session attached but its screen
  never did`, `the session attached but sent no screen`) — the terminal cooled, the card's two
  acts RETRY (a fresh attach, never a longer wait) and BACK TO THE FIELD. A run whose row says
  it EXITED while the card is still attaching is said as ended — `this session ended — its run
  exited on studio` — with RESUME and BACK TO THE FIELD: nothing keeps dialing a terminal the
  field says is gone. A live session is never stopped by these deadlines. **Nor is a refusal
  asked forever** (2026-10-19). James's floor was respawned at 02:24:56Z, and the phone asked
  for a lost session's ticket 254 times over three hours while its card said nothing. **A
  refusal the door marks final (`retryable: false`) is not asked again; the kind says why.**
  The door's `NOT_FOUND`, saying it no longer has the session, ends that card alone:
  **`this session ended — studio no longer has it`**, with BACK TO THE FIELD. The door's
  `cell_gone` comes before it and IS asked again: it is the beat before the desktop's
  inventory drops the session. The end that follows says why: **`this session ended —
  studio's terminal engine restarted`**. Any other final refusal is said in the door's words
  with RETRY, as are the product client's own final kinds (`INCOMPATIBLE`, `UNAUTHORIZED`,
  `PRECONDITION_FAILED`). Every other card on that desktop is asked for, and answered, on its
  own. A refusal the door marks retryable is asked again on the backoff, as before.
  **What the cell turns away is said in its own word** (C5, the focus audit; built 2026-10-17
  and 2026-10-20). A key the cell refused at its own gate (`InputRefused`, on a leg that asked
  for `input-refusals`) is the card's note: **`the terminal didn't take that input`**, then why
  and what to do:
  - `this screen is behind; type again once it catches up` (lagging);
  - `the screen is still arriving; type again once it shows` (pending);
  - `the connection can't carry this screen now; type again once it moves` (overload);
  - `the write grant has run out; reattach to type again` (right-expired);
  - `this desktop has taken input away; this viewer is view only now` (right-revoked: a
    renewal took it, so a reattach, which mints the same grant, is not the act);
  - `view only: this desktop granted read without input` (not-granted);
  - `the session has ended` (exited);
  - `this session moved; reattach to type again` (stale-lease-epoch);
  - `this screen is parked; open it to type` (no-view).

  A reason this build predates is said as `the desktop paused input for this viewer`, with
  the word itself in parentheses, never guessed at. The note is said while the card is
  connecting as while it is live, and it outranks `connecting over the mesh…` while it shows,
  because an overload's refusal lands after the lease that took the card out of live.
  **A run's end says who ended it** (C8, 2026-10-20). After `this session ended — `, a run whose
  end the cell named as requested says whose act it was, never the signal that carried it:
  `its run on studio was closed` (the person's), `VibeField closed its run on studio`, or `the
  terminal service on studio shut down`. Any other end is said as the desktop's pane face says
  it:
  - a signal: `its run on studio was ended by SIGHUP`;
  - a nonzero code: `its run exited on studio with code 2`;
  - a clean exit: only `its run exited on studio`;
  - no code at all: `its run ended on studio`, never an invented one.

  A key pressed into an ended session is declined as `the session has ended — there is
  nothing to type into`, never `waiting for the terminal to catch up`.
- **The phone's live card is its terminal, edge to edge** (item 41; James, 2026-10-19: "instead of
  containing the terminal content in the rounded rectangle right now, just make it fully fill the
  entire tab area…", and at 20:48Z "i said fully fill the tab card"; the look ruled 21:38Z, "good,
  design all go with the lean"). While the card is live the sheet IS the terminal. **Its ground** is
  the terminal's own background at its own opacity (the theme's; Matte Black `#121212` by default,
  never §2.7's paper), from the sheet's top edge to its foot, behind the home indicator. There is
  no paper, no rounded inset, no divider and no header block. **The card wears Godview's pane
  frame**: a 1px line and the inner glow in text main follow the sheet's corners, 40pt at the top
  and the display's own at the foot (62pt on James's iPhone) so the display never cuts the line, and
  a 44pt band across its top holds, at the left, **the readout** (model · effort · context,
  lowercase, as a desktop pane's), and at the right **···** and **the badge** (OS mark · agent
  mark · name, filled in text main), inset clear of the 40pt corner. The band's ink, the line's and
  the glow's follow the ground's lightness, not the app's theme: a ground that white reads better on
  takes §2.4's dark ramp by day too, and a light ground takes the light ramp. The band takes its
  own touches, so a touch there never reaches the terminal under it (that touch would take the seat,
  DS-D5). **The grid starts under the band and runs to the top of the home indicator's safe area**
  (34pt), so no row hides under chrome; the text's margins are the renderer's own padding, 10pt each
  side, 2pt above and 8pt below. **The closed input row is no longer a band**: its keyboard key and
  its reply chips float over the last rows, each on a local clearing of the ground. The open input
  card is as it was. The attachment's words ride over the grid 10pt below the band. A cooled
  terminal dims toward its ground (a veil of the ground at 45%), not toward the glass. While another
  device holds the seat, the held screen **anchors at the grid's foot** (a ghosttea renderer option,
  riding its 0.10.2 pin: a translate in the kit would move the Metal view onto the safe area, and
  ghosttea would measure a shorter grid), so its empty rows are at the top. *Status 2026-10-19:
  until that option ships, the held screen stands top-left, as a desktop pane's does, and its empty
  rows are at the foot.* The peer, absence and ended faces keep the stacked card on the glass. While
  the phone holds the seat, that grid is the PTY's. *(2026-10-19: this said the header stood on a
  fade of the ground, solid to 24pt above its foot and clear 8pt below, with the grid's top rows
  under it: "at 13pt the grid gains about five rows, three or four of them under the header, so a
  full-screen program's first lines are hidden on the phone". James's pick of T1 and F1 retires both
  the fade and that cost: the band holds no rows.)*
- **A live card another client is driving** (item 42's phone half; James, 2026-10-19 17:42Z: "studio
  is driving · touch to take it back"; the look ruled 21:38Z, "good, design all go with the lean").
  While the card's session has its geometry seat (DS-4) held by another client, the studio's window,
  a peer's window or another phone, the card goes on drawing the session at the holder's size, where
  the bullet above stands it, so some of the card's rows stand empty: the converse of the phone's
  own seat, where the grid is the PTY's. The card says so in its empty rows, above the floating
  input row, wherever they are (at the foot while the held screen stands top-left, at the top once
  it anchors at the foot; as the spawn bloom's words take the field's widest empty space), in the
  desktop's figure at the phone's scale: **studio**, the holder's name as fieldd minted it
  (**Another device** when it minted none), full, and **is driving** at 40%, 800 at 56pt/1,
  −0.04em, haloed in the terminal's ground (40 and 18), over a veil of that ground at 62%, the
  content dimmed beneath it, never hidden and never blurred. Under them one caption line, **touch to
  take it back**, 12pt semibold at 72%. It names no size: the phone can see what it is drawing. The
  light is **text main** (D-i12), which follows the ground's ramp (the bullet above): white on Matte
  Black, `#111111` on a light ground. The glow and the bloom are the desktop's recipe in that ink.
  The entrance plays once, as the desktop's does, 400ms after the seat goes, and holds still; it
  goes at once when the phone takes the seat, and under reduced motion it fades in over 100ms.
  Neither the words nor the veil take a touch: a touch on the grid goes through and takes the seat
  back (DS-D5). **When the holder lets go**, a live card on the screen takes the empty seat itself,
  and the readout goes. It is the phone's one pane in front, so this is Q1's ruling (a focused pane
  takes the empty seat) applied to the phone. The kit owns its claims, so it waits on no ghosttea
  lane. A card that is not on the screen, with the app in the background or another card in front,
  takes nothing while it is away. When it comes back it is presented again, and a presented card
  takes the seat (DS-4b), so the readout shows only while another device holds the seat as the card
  sits on the screen.
- **The file tree** (mille; 2026-08-09 — first consumer is the History room's files rail,
  `draft/four-views/design.md` §4): a tree is a **reader** surface, not chrome. It leans on
  the type ramp and hairlines, never on materials — no glass, no card, no shadow (four-views
  §0: "the drama stays in what the agents said, never in the chrome"). `@vibecook/mille-ui`
  ships its own GitHub-derived palette; **none of it reaches a VibeField pixel.**
  **The theme lives upstream, in mille** — `@vibecook/mille-ui/theme/vibefield.css`, mounted
  as `data-mille-theme="vibefield"` (2026-08-09; it sits beside mille's own `minimal.css`,
  which is the established shape for an app-specific theme there). It is self-contained so it
  can ship on npm, and every value additionally reads its `--vf-*` token first
  (`var(--vf-fill, …)`), so THIS file still governs: move a token in `tokens.css` and the tree
  moves with it, with no mille release and no second palette. Geometry rides the same bridge —
  the `--vf-tree-*` constants below are what the theme reads for row height, indent and gutter.
  **Geometry:** `--vf-tree-row-height` `26px` (`--vf-tree-row-height-compact` `22px` for long
  rails), `--vf-tree-indent` `14px`, `--vf-tree-gutter` `8px`, and rows rounded to
  `--vf-radius-control` *inside* that gutter — an iOS list inset, not an IDE gutter. Name is
  **12px medium in the sans stack**, matching the projects-rail row it sits beside; a file
  NAME is a label, and only full paths and ids go mono (§3).
  **The icon set is ours and it is deliberately small** (`vibefieldIconTheme`, from
  `@vibecook/mille-ui/icons/vibefield`): eleven monoline glyphs on a 16-unit grid, `fill: none` +
  `stroke: currentColor`, so every glyph inherits the row's ramp and carries no color of its
  own — a file's TYPE is not a §2.5 state, and a colored icon pack is a violation on sight.
  The glyph renders at `1em` of a 12px row, and §8's own readability floor already refuses
  detail at that scale ("no micro-text"), so the set is **category-first and the mark IS the
  icon** — no page silhouette competing for the same twelve pixels. The page shape is kept
  for the two things that really are pages: prose, and the unknown file. Categories are the
  distinctions that change how you treat a row in a reading rail — code · style · prose ·
  config · media · a lockfile you must not hand-edit (EL8) · a secrets file (EL7) · git's own
  plumbing — never which language the code is written in. **Named folders are declined** for
  the same reason: a mark inside a folder at 12px is the micro-text again, and a derived
  directory already arrives ignored and wearing the muted ramp, which says "not your code"
  more legibly than any glyph this size. Per-language glyphs stay one map away if the rail
  ever proves otherwise.
  **Location vs interaction is the tree's whole state grammar** — four-views §4 settles it:
  *"the current project wears `--vf-fill`, not the select ring — selection ring is
  interaction, this is location."* So: the **active** entry (the file actually open) wears
  `--vf-fill` · **selected** rows wear the hover-step fill one notch up from hover · the
  **focused** row alone wears §7's `1.5px` inside `--vf-select` ring. One ring at a time —
  a multi-selection is N fills and one ring, never N rings (§7's sole/multi law, applied to
  a list that has no union box). Indent guides are `--vf-hairline-strong`, solid; the
  archival dashed rail belongs to mille's minimal theme, not to us.
  **Decorations carry §2.5's meanings, not git's colors:** added/untracked green ·
  deleted red · modified/renamed **cyan** (a dirty file is a live fact about the tree, and
  orange must stay scarce enough to still mean *act*) · conflict orange (a human must
  resolve it) · ignored the muted ramp at no hue. Diagnostics: error red · warning orange ·
  info cyan · hint muted. Tests follow the agent-state mapping literally (§2.5: `working`
  green, `done` muted): running green · failed red · errored orange · **passed and skipped
  muted** — a passing test is not news, and quiet is the honesty. Loading is colorless (the
  veil's rule: loading is not a §2.5 state). An unavailable root keeps §2.5's `unknown`
  treatment — muted italic, never an error, because a disconnected folder has not failed.
  A dragged row takes the card's lift opacity (`0.75`, §7 — every file row is a drag source
  for file chips); a drop-into-folder target takes the `--vf-select` ring, and a
  between-siblings drop a 2px `--vf-select` line. mille ships its context menu **unstyled**,
  so the bridge dresses that one part in island material (§5) — the menu is chrome floating
  over the reader, and the only place in the tree where a material appears at all.

---

## 9. Voice

Sentence case (eyebrows uppercase). Buttons say what they do ("Spawn agent", not
"Submit"); a name survives its flow (Publish → "Published"). States tell the truth with
numbers and provenance — "syncing history…", "external terminal — state only",
"needs approval · 4m" — and never overstate what we know (EL5). Errors say what happened
and what to do next; they don't apologize and they're never vague. No filler, no lorem:
demo content is real-shaped (AAPL, San Francisco, 64°).

**Sizes are said as Finder counts them**, in thousands — bytes, KB, MB, GB (the terminal settings
page, the line's notes) — and a size a person did not make, such as a link's message, is never
said as theirs. A count in 1024s names itself KiB or MiB (Diagnostics). Where a size meets a
limit, the size is rounded up and the limit down, so the two never read as equal. *Ruled
2026-10-18 (James). Known deviation, owed: the desk readout's GPU memory says MB for a count in
1024s (`panels/DeskReadout.tsx`).*

**The link's words** (track TS, TS-D1 and TS-D2 ruled 2026-10-27). The act is **Continue with
Tailscale** on every button that starts it — the Connect pane, Settings → Devices, the phone — and
the place that holds it says **Connect your devices**; the state is **Connected**. A desktop that
is not connected is **This Mac only** ("This PC only" on Windows), never "offline", which a person
reads as no internet. "Tailnet", "node" and "link" stay in Network details (TS-L2). Waiting says
who must act: "Finish in your browser", "Waiting for approval", "Sign in to Tailscale again". The
machine is named as Tailscale names it, in mono, so a person can match it on Tailscale's own page.
Tailscale is named plainly, and its mark appears only where trust is decided (§13).

**The agents' words** (track AO, ruled 2026-10-27; AO-L8, no machinery on screen). One word per thing,
in the Setup Assistant, Settings, History and the launcher alike. An **agent** is named by the
catalog's label (Claude Code, Codex, Grok). **This Mac** is the profile that uses the agents' own
folders ("This PC" on Windows) — never "native", "This desktop" or "this machine". A **profile** is a
set of sign-ins, one per agent; "Agent Profiles" is only the Settings group's head. A **sign-in** is
one agent's account inside a profile ("Signed in as james@acme.dev"). A **plan** is what a sign-in
runs on, by its product name ("Claude Max", "ChatGPT Pro"); "subscription" is only the idea ("Every
subscription, side by side."). **History** is the place, and its verbs are **bring in** (the yes),
**read** (the work) and **stop reading** (the no). What comes in is **past sessions**. **Get** starts
an install and becomes **Install**; never "Download". Never on screen: ingest or ingestion, enroll or
consent, runtime or kind, persona, index, rosetta or rosettad, puppeteer, fieldd, backfill, skim or
census, and "we" ("VibeField found", never "we found"); they stay in logs, Diagnostics and the code.
Inside History the room's own words stand as rosetta wrote them, and the Setup Assistant borrows them
("Discovering conversations", "Reading conversations"), so History says the same thing when it opens.
*Built 2026-10-27, AO-6a — the page's rewrites:*
- History's first open says "Opening History…" (§8, amended at its source).
- This desktop is "This Mac" ("This PC" on Windows) wherever VibeField names it, the spawn menu's device row
  included (`thisDeviceWord`, beside TS's "This Mac only").
- An Add agent… menu on a Mac with no agent says "No agents on this Mac yet.". Its "Get an agent…" waits for Get
  (AO-7).
- Two wait on their libraries:
  - History's not-answering title is rosetta's room's own ("rosettad is not answering"), and the host only words
    the line under it. "History isn't answering. VibeField is restarting it." is a rosetta petition (AO-8).
  - The launcher's refusal carries a reason and no act in puppeteer's views, so "Sign in to Codex in Work…" rides
    AO-7's puppeteer release.
- A words slice diffs its built words against the page's §10 states table before its packet (the lane's
  `ao-states-diff.mjs`; VF-PM 2026-10-27).
- One row stands by decision. An agent that never says who keeps Settings' "Doesn't say who is signed in" over the
  page's "Signed in · doesn't say which account": VibeField cannot know it is signed in.

*Status 2026-10-12: ruled and built. Built: the Lip and its two buttons, the groove, the frame's tone and the well (GV-D7, GV-D12); where a session with no pane opens (GV-D4); the terminals away and called up as they were left (GV-D5's call, GV-D6); the edge's three outcomes and their readouts, and the monitor making room; maximized, the bar the window's title bar (GV-D11); the monitor alone at launch, the first call bringing last run's panes with the one it called (GV-D5, N14 (a)); ⌘W on the last pane minimizing them (N16 (a)); rest, the drawing's share above a floor on every height (N15 (a)).*
**The terminals' wrapper says the window's own words** (Godview, §8, the deck; One Frame §23.2 —
"for close button, replace it with a minimize - button … for fill button, replace it with a
maximize button", James, 2 Oct; ruled 2026-10-02; built 2026-10-11). **The two readouts** while the edge is held are
a verb and its noun, saying what letting go would do: **Minimize the terminals** · **Maximize the
terminals**. Round 2's "Put away" and "Fill the window", and the buttons' first names, close and
fill, are retired. **The three titles:** **Minimize — every session keeps running** (it says the
one thing the gesture could leave in doubt) · **Maximize** · **Restore**. Their accessible names
carry the noun: "Minimize the terminals", "Maximize the terminals", "Restore the terminals to
their place". "Fullscreen" stays the pane's word (§8).

---

## 10. Implementation & governance

- **Tokens live in `@vibefield/design-kit`** (design kit, 03·A D14) as CSS vars under
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
  *(Superseded 2026-10-03 by the head — the five places below, §8 "The head": the crumbs fold
  into the name pill, the cluster goes and only the zoom readout is the head's right; the window
  still drags by the strip between the pills.)*
  **Bottom-left (2026-09-22, UA-D19):** the Me menu — the owner's face, §8 — then Godview,
  with the `hud.panel` slot above them; the Settings gear retires into the menu and `⌘,`.
  *(Godview's button retired 2026-10-03 — the views track below is the way in. Since FR-4 the
  corner is the face's alone, centred on the foot axis, and its menu opens above the line; the
  bottom-right corner's devtools button is gone — into Settings → Advanced, development builds
  only, a section like every other dev-facing diagnostic (FC-D12).)*
  **The left edge (2026-09-23, SNAP-3):** the clipboard tray's notch at mid-height, its drawer
  from `top-16` to `bottom-20` (clearing the Me menu and Godview); the right edge is reserved
  for its twin — *Artifacts', since FR-4 (§8, edge trays): the right edge is Artifacts' door and
  nothing else's.* **Bottom-centre:** the HUD island — *retired into the line 2026-10-03 (One Frame
  FR-2): the bottom centre is the line's, and the island's sheet rises behind it (§8).*
- **One frame, every view — five places, two axes** (One Frame FR-1 and FR-6, ruled
  2026-10-01; first built 2026-10-03). Chrome lives in FIVE places: **the head** (the window's top
  0–52, its controls 40 tall at `top-2`, centred on the lights' axis), **the line** (the foot:
  880 × 52 at 20 from the bottom — x 150–1030, y 708–760 at the default 1180 × 780 — never
  starting nearer the left than 76, so it never meets the corner), **the two edges** (the notches
  and their drawers, §8), **the corner** (your face, centred on the foot axis), or **on its own
  object** (a card's bar, the tools in hand, a pane's band; object chrome stays with its object,
  even where it stands under the head). **Two axes:** everything in the head centres on y 28, the
  traffic lights' centre; everything at the foot on y 734, the line's centre. **The frame stands
  above every view.** The canvas is the ground floor; Godview, History and (once it exists) the
  Assistant are views drawn as ONE cover over it (§6), each on its own ground at the covers' glass,
  72% (FC-D16) — with no blur until the field's still exists to blur (the desk's, DK-15: §8, the
  covers over the desk). A covered view ends its content at 692, the **reserve** of 88 above the
  window's foot, and keeps 8px clear at each edge for the notches' slivers; its own ground runs
  under the line, and only the canvas runs content
  under it. Above the frame stand only Settings, the palette, the Peek's scrim and popup (64, §8
  "Search — the Peek", 2026-10-08) and the loading veil (and, until
  FR-4 opens it above the line, the open Me menu, which grows over the track's left end — *since
  FR-4 it stands with the frame, above the line, and nothing of the frame's is under it*).
  **The active view has ONE owner** — the window's, held in main beside the menu that names it,
  persisted for the window's life and Canvas at launch; the views track, the keys and the View
  menu all ask that owner and draw what it answers. **The keys:** ⌘1–⌘4 (Ctrl 1–4 on Windows) go
  to Canvas, Godview, History and the Assistant (which waits: ⌘4 says so and nothing moves), and
  nothing else switches views (FC-D4) — they are the product's own chords, taken on the window's
  capture phase before a focused pane can see them, printed on the views track's cells (§8) and
  said in the View menu. **The line's own keys** (One Frame §11) belong to its create and are SAID,
  never printed (FR-5): **B** toggles Objects on Canvas — never while typing (the draft, a note, any
  field) and never under a cover; **⌘T** (Ctrl+T) is Godview's New terminal, a product chord taken
  on the capture phase in Godview so a focused pane never sees it (ghostty's new_tab); and **@ is
  never a shortcut** — it is typed in the draft. **Search's key** (§8 "Search — the Peek",
  2026-10-08) is PRINTED under the frame's search button: **⌘F** (Ctrl+F) opens the Peek, a product
  chord taken on the capture phase while History or Godview is the view (Godview's own Find left
  with P2, 2026-10-09) — so Settings → Terminal → Keyboard says Ghostty's find never reaches a pane
  while History or Godview is the view. **⌥0–⌥9 are nobody's** (docket PK4 (a), 2026-10-09): they
  chose Godview's profile tabs, and the tabs left the bar for search's scope row (GV-D3), so ⌥ and
  every digit reach the pane — a fresh pane's launcher keeps its own ⌥n there (QL-D2); nothing
  prints them. **The head's keys** (DK-D24; One Frame §6) are
  the zoom's, SAID in its menu and the palette, never printed: **⌘+** (⌘= or ⌘+, the keypad's too)
  zooms in, **⌘−** out, **⌘0** to actual size and **⇧1** to fit — Ctrl+Plus, Ctrl+Minus, Ctrl+0
  and Shift+1 off the Mac. They are Canvas's, not the product's chords: heard on the window's
  BUBBLE phase, so a pane that holds the keyboard keeps its own ⌘+ ⌘− ⌘0 (ghostty's font sizes) and
  a key something else took is left alone; never under a cover, never from inside a keyboard claim
  (design-007's `data-canvas-keyboard` — a terminal or a page on the canvas), and ⇧1 never while
  typing (it types "!"). A key they take is claimed, so the View menu's item never answers it a
  second time (the menu's zoom is an act the head answers since FR-4, below). **The frame's open
  surfaces have ONE owner** (FR-4; the line's, renamed at FR-3 when
  the head's joined): @'s list, Objects, the fields explorer, the zoom's menu and the palette are
  one value, so opening any one folds the rest, and every surface that folded the tray folds them.
  *As built (FR-1, 2026-10-03):* the frame so far is the views track, on
  the line's glass at the line's left end; the line (FR-2), the head (FR-3), the edges and the
  corner (FR-4) join it next. Until they do, the slots above stay the canvas's own chrome and lie
  under the cover with the field. *As built (FR-2, 2026-10-03):* the line is whole, the track at its
  left end; the head (FR-3), the edges and the corner (FR-4) are next. *As built (FR-3,
  2026-10-03):* the head is the name pill and the zoom readout on y 28 (§8 "The head"), still the
  canvas's chrome under the cover; until FR-4 the theme button and the Artifacts toggle stand
  beside the readout. The edges and the corner (FR-4) are next.
  *As built (FR-4, 2026-10-03):* **the edges and the corner join the frame** and stand above the
  cover with the line in every view: the clipboard's notch on the left, Artifacts' on the right,
  each resting as a sliver over a covered view (§8, edge trays), and your face in the corner with
  its menu above the line (§8, the Me menu). **The frame's one owner now holds all of its open
  surfaces** — `objects · @ · fields · zoom · palette · me · clipboard · artifacts`, one value, so
  any one opening folds every other (F11); Settings still folds them and is folded by them.
  *Until the Peek lands (2026-10-04, the search interim), History's room's sheet is a ninth,
  `history-search` (§8 "History").* *Since 2026-10-08 (the Peek, P1) **`search`**, the Peek's popup,
  is one of them (§8 "Search — the Peek") and `history-search` left with the room's sheet; beside
  the desk's selection menu (DK-11, §10 "The mat's places") the one owner holds ten.* **The
  app's theme has ONE owner, main's** (FC-D5): Light · Dark · Auto, one value per device kept by the
  shell, Auto following the OS through Electron's `nativeTheme`, and the owner projects what it
  resolves to back into `nativeTheme` — so the window's native chrome, its menus and the page's
  `prefers-color-scheme` agree with it from the first frame — and tells every window; the Me menu's
  Theme, Settings → Appearance and the Setup Assistant's button all ask it, and Godview follows what
  it answers (§1.1). **The View menu's zoom** (Actual Size ⌘0 · Zoom In ⌘+ · Zoom Out ⌘−) is no
  longer Electron's page-zoom roles: each item sends its act to the window's head, which answers
  on Canvas as its keys do, and the three are disabled under a cover — so nothing in the menu bar
  or its keys zooms the whole window any more (One Frame FR-3's finding).
  **The head band's one exception — Godview's terminals, maximized** (GV-D11, ruled 2026-10-02;
  built 2026-10-11; §8, the deck). While the deck is maximized the band holds the terminals' title bar and nothing
  of the head: the bar is the window's top 0–30, its controls centred on ITS axis, y 15, where the
  lights then stand (`12 · 9`, from `18 · 22`). The head's controls are not drawn — Godview's row
  (§8 "Godview's head — Stories") fades out, and the search button stands in the bar (§8 "Search —
  the Peek"). The window drags by the bar, with the grip's 168 hit and the bar's buttons as holes
  in it (`no-drag`). The app's strip stays the top 52: the terminals' pane area is `no-drag`, so
  the panes' rows inside the strip (y 30–52) take their clicks and never move the window, while
  the 8 gutters beside the well still do. The other four places do not change — the line, the
  edges and the corner stand above the cover as in every view, and the panes still end at 692.
  The bar is the deck's own chrome, on its own object (the fifth place), standing where the head
  stands in every other state: not a second head, and the y 28 axis is the head's again the
  moment the grip is dragged out.
- **The mat's places** (Chrome on the Mat §4; One Frame §7; MC-D4 ruled 2026-10-01; ICE I20, I21;
  R5, R7, R12; built on the desk by DK-11…DK-13): on Canvas the desk's chrome stands in the frame's
  fifth place, **on its own object** (FR-1). **The bar follows its object** — over the selection's
  brackets, under them near the top — and travels with it into the hand; **the tools in hand sit
  under the head** (top y 64, 16 under the name pill), still the object's chrome and not the head's;
  **the pegboard rises behind the line**, whose create is its door (§8). **The desk keeps two
  reserves:** the **safe top, 94** — the rulers' band plus 8: the rulers move in to a margin of 60
  (DK-3), so the top ruler starts below the head strip and the left ruler clears the notch, and
  their band ends at 86 — above which the bar goes under its object; and **the foot, 88** — the
  line's reserve, the same 88 a covered view keeps (692): the board's lay ends 88 above the window's
  foot (I21) so its last row clears the line, and the bar's top never sits below 660 (its foot 8
  above the line's 708). Between them the bar keeps **42** from each side (the notch's 26 + 16), and
  a held object's reading fit keeps **116** above it (the held bar's foot, 104, + 12) and **100**
  below (the line's 88 + 12, I20). The reserves are measured from the window's edges and hold at
  every size; the y values here are the default window's (1180 × 780). A selection wholly off-screen
  has no bar (R7). **The bar's grown menu is one of the frame's open surfaces** — the one owner's
  ninth, `objects · @ · fields · zoom · palette · me · clipboard · artifacts · selection menu` — so
  opening it folds the rest, any of them opening folds it, and its Esc is taken before the desk's
  Esc ladder (R5). *With the Peek (2026-10-08, P1) the one owner holds ten: these and `search`,
  the Peek's popup (§8 "Search — the Peek").* **The status line** (§8) is the head's: centred under it at y 56, or under the
  tools in hand at y 112 while an object is held (R12).
- **Review ritual**: UI PRs cite the sections they follow, include a screenshot in both
  themes, and answer the §0 bar question. Deviations from a token/recipe/easing are a
  change *to this file first* — the doc moves, then the code.

---

## 11. Fieldmarks / AFTER HOURS — sticker edition

**Edition 02, 2026-09-22.** The requested direction is retro sticker illustration: expressive,
specific, and collectible. AFTER HOURS replaces edition 01's minimalist geometry with 77 new
drawings plus the exact existing logo. The cultural vocabulary comes from VibeField: a personal
field, physical cards, agent work, old computers, private connections, and accumulated creations.

The collection has three related drawing registers:

| Register | Artboard | Recommended floor | Typical subjects |
|---|---|---|---|
| Character / brand sticker | 112 units (logo retains 480) | 48px (logo 32px) | skewed CRTs, rubber gloves, floppy creatures, cassette workers, odd personal characters |
| Desk object | 72 units | 32px | hardware, folders, paper, patch leads, crates, layered windows |
| Action stamp / state signal | 48 / 50 units | 24 / 28px | heavy positive/negative shapes, cut-paper arrows, glove, sun, speech flag, radio |

Contours are deliberately unequal; black side planes, hatching, scratched highlights, bitmap
lettering, and offset eyes carry character. There is no single nominal line weight. Detailed
characters are not reduced to tiny toolbar glyphs; functional controls have their own simpler
geometry. Actual controls keep §4's hit areas and explicit accessible names.

Two exports share the same original drawing: **sticker** adds a white backing and die-cut
keyline; **artwork** omits that outer keyline. Both have an ink layer (`currentColor`) and an
interior paper layer (`--vf-sticker-paper`, falling back to the canvas and then white). Paper
is intentionally opaque inside the illustrations; empty space outside is transparent. This
supersedes edition 01's all-transparent knockout claim. No raster or generated-image texture
is required; every shape is an editable vector.

The catalogue is a **committed editorial art surface**, not a new product chrome recipe. Its
print palette is ink `#171815`, stock `#F1EDDF`, acid-yellow sheet `#E5E549`, and proof inks
cobalt `#214ACC` / vermilion `#C53D25`; the night wall is `#232720`. Sticker backing stays white
in both themes. These inks are presentation choices and never encode account identity or state.
The sheet can use hard borders, pasted rotations, checker fields, and condensed display type.
Other product surfaces continue to follow the existing quiet-chrome rules.

Identity, assigned role, provider, and observed state stay independent. §2.8's emoji sticker/coin
account face remains current; the new vector alter egos are an additional identity-art study.
The agent characters are role proposals, not vendor marks or asserted capabilities. §2.5 still
governs product-state color, and state words remain visible. Existing Godview bodies and the
upstream file-tree icon family are unchanged.

The packaged app, tray, and Icon Composer masters remain exact. `@vibefield/design-kit/icons`
exports the shared `FieldIcon`, typed names, metadata, and `fieldIconSvg(name, finish)`.
`finish="sticker"` adds the paper cut; the component defaults to `"artwork"` and decorative
semantics inside labelled controls. The drawing source is `tooling/fieldmarks/generate.py`.
Studio and the offline `draft/design/fieldmarks.html` mount the same `IconsSection`. The HTML
bundles its CSS, React, vectors, and downloadable archive without network dependencies.


### 11.1 Face Club — the account deck, drawn in After Hours ink

**Account artwork study, 2026-09-22.** The 48 selected emoji in contracts' `FACE_DECK`
receive 48 original black-and-white sticker interpretations. This is a complete one-to-one
artwork proposal, preserving the exact deck order and the stored emoji. §2.8 remains the
shipping face policy and renderer; adoption of vector art is a separate integration step.

Each subject has two authored optical masters: **112 units, detailed, from 40px** and
**56 units, simplified, at 16–39px**. Small masters enlarge distinguishing features and
remove hatching, fine fur, and secondary marks. They are separate geometry, not a filter or
an automatically shrunk full illustration. The switch aligns with the face's existing 40px
tilt threshold. The neutral ink is `#171815`, paper is explicit white, and the surrounding
wall uses §11's print palette. The sticker finish grows a white cut edge; artwork omits it.
Interior paper remains opaque, including the doughnut's central knockout.

Animal anatomy and object silhouette precede expression: fox wedge, raccoon mask, wolf
profile, panda patches, two camel humps, snail spiral, and ringed planet. Color never deals
or disambiguates users. The drawings contain no system emoji glyphs, traced reference paths,
fonts, filters, or embedded raster art. The original emoji appears only as a comparison,
through the shipping `UserFaceView`.

`@vibefield/design-kit/face-stickers` owns `FaceSticker`, typed ids and metadata,
`findFaceSticker(emoji)`, and portable `faceStickerSvg` export. The mapping ignores only
text/emoji variation selectors, like `faceKey`. Unknown/custom emoji return `undefined`
and retain native rendering when integrated. Account dealing, collision validation,
per-user tilt, coin choice, and persistence remain in their existing owners.

`tooling/face-stickers/art.py` is the editable drawing source. Its generator verifies all
48 emoji against the current policy before producing 192 SVG exports and two sprites.
Studio and the self-contained `draft/design/face-stickers.html` mount the same
`FaceStickersSection`, with all emoji/sticker pairs, an inspector, actual-size light/dark
proofs, and downloads. Recognition at tiny sizes is an explicit design review concern,
not a claim established by a bounds test.

## 12. Logo studies — draft only

Logo experiments live in local, uncommitted `draft/` studies. They are not part of the
design kit or the production design system. Packaged icon masters remain governed by §11.

---

## 13. Glyphs — the chrome's icon law

**Chosen 2026-09-24 (James, from the Field Glyphs page; `tooling/glyphs/picks.json` is the record).**
Every functional icon the chrome draws — the HUD's round buttons, the file pill, the Settings rail,
the agent rows, the edge trays, the plugins' toolbars, the phone's composer and keypad, the swarm's
marks, the desk's bar, the tools in hand and the wrapper around Godview's terminals — is one of
**64 named glyphs** in one **24-unit box**,
optical centre at 12,12, live area 2 to 22, drawn in `currentColor` and nothing else. The host says
the size and the colour, the way it says them for text (§2.4); a glyph never carries state (§2.5,
I-5) and never a colour of its own. Two constructions, one set:

| Construction | Glyphs | Law |
|---|---|---|
| **Instrument** (54) | everything not listed as Hardware | one 2-unit stroke, round caps and joins, 3-unit corners; solid dots only where a mark ends in one (the question and the failure) |
| **Hardware** (10) | close · check · search · rename (pencil) · return · backspace · more (ellipsis) · arrow · general (sliders) · keyboard | one solid silhouette as a single `evenodd` path — bodies and their holes, no masks, no filters — so the same geometry is a template asset on iOS |

**Sizes** are the host's, by CSS: 12 (captions) · 13–16 (row controls) · 18 (the Settings rail, the
Snap tile, the Me menu) · 20 (the 40px round buttons) · 22 (the tray's plus, the artifact choices) ·
28 (the Agents head). Instrument's stroke therefore renders 1 px at 12 and 1.67 px at 20 — one
weight, scaled, never nine. **One drawing per meaning:** a chevron is drawn pointing right and
*turned* (90 down, 180 left, 270 up); the four cursor keys are one arrow turned; redo is undo
*flipped*. The set, by group — actions: plus · close · check · search · pencil · undo · reset ·
outward · link · return · backspace · ellipsis · start · resume · jump · duplicate · tape · lift · trash ·
pen · eraser · today · minimize · maximize · restore; navigation: chevron · arrow; places and objects:
gear · person · sliders · canvas · agents · profiles · plugin · mesh · terminal · pulse · code · sun ·
moon · clipboard · package · capture · panes · history · sidepanel · bug · globe · folder · keyboard ·
mic · scantext · snippets · prompt; signals: message · key · question · exclaim · flame · missing · importing;
Studio only: document · layers · sparkle. **`history`** (2026-10-03, One Frame §13) is the views
track's History cell (§10): a clock turning back, the dial at `globe`'s radius opened where its arrow
turns it. **`importing`** (2026-10-27, AO-4b) is History's arc (§6, the arc; §8, the views track): a fifth of
that dial, from twelve o'clock, drawn only over the History cell's glyph while History imports and turned by the
host, which says the turn and the rest; it is never drawn alone.
**`start`** and **`resume`** (2026-10-03, One Frame §13; Session Glyphs' picks of 30 Sep, spawn-T3
and resume-play-T3) are the composer's create in Godview and in History (§8, the line): `terminal`'s
window with its chevron, the frame opened at the lower right to hold the verb — a plus for a session
started, play for one resumed — so the noun travels with the verb (One Frame FR-3: only Canvas's
create is a bare plus). Their Hardware records are the page's T4 column, drawn and not shipped.
**Send** needs no glyph of its own: it is `arrow`, as drawn (up). No `attach`: the line has no attach
button (FC-D1 ruled type @).
**`jump`** (2026-10-03, One Frame §13; Session Glyphs' jump-T3) goes to a session that is running — a
live row in History, a link in running text: `terminal`'s window with its wall opened on the left for
the arrow going in, since a box with an arrow leaving it is already `outward`; its Hardware record is
the page's T4. Since 2026-10-08 (P3) it is also History's create while the chosen session runs here
(§8, the line; §8 "History"), cross-fading with `resume` in the create's one place. **The desk's seven** (2026-10-03, Chrome on the Mat §5; MC-D8 ruled 2026-10-02) are
ICE's selection glyphs redrawn in the Instrument construction for the desk's chrome (§8):
`duplicate` · `tape` · `lift` · `trash` on the selection bar — `tape` and `lift` are one padlock, shut
and opened — and `pen` · `eraser` · `today`, the modes and the act the held kinds declare; their
Hardware records are drawn, not shipped. The rest of that chrome borrows the set as drawn: `agents`
(Send to…), `ellipsis` (More), `plus` (Objects, turned 135° to close), `chevron` (a page or a month,
turned 180° to go back), `undo` (flipped for redo), `snippets` (a note's chip). **A desk kind may draw
its own act and tool glyphs beyond the set** (MC-D8) — ICE's `{ path }` drawing, held to this
construction (the 24-unit box, one 2-unit stroke, `currentColor`) and drawn as the set's are, never as
an inline `<svg>` in product code; the mini mat's "Change the vinyl" is the first built-in to (the
example plugin's clock draws five).
**ICE's glyph names, mapped** (R2 — the orchestrator's Phase 4 rulings, 2026-10-03): a kind declares
a glyph by a NAME of ICE's set or by its own drawing (`HeldGlyph = string | { path, fill? }`), and
the desk's chrome draws it from this set by this table, never by a guess:

| ICE's name | Drawn as |
|---|---|
| `chevron` · `chevron-left` | `chevron` · `chevron` turned 180 |
| `undo` · `redo` | `undo` · `undo` flipped |
| `pen` · `eraser` · `today` | `pen` · `eraser` · `today` |
| `duplicate` · `lock` · `unlock` · `trash` | `duplicate` · `tape` · `lift` · `trash` |
| `agents` · `ellipsis` · `check` | `agents` · `ellipsis` · `check` |
| `{ path }` · `{ path, fill: true }` | the bar's own path renderer: the path in the 24-unit box, stroked 2 in the bar's ink, or filled |
| any other name | **`missing`** — said once, never another glyph |

**`missing`** (2026-10-03, R2) is the desk's missing face as a mark — a card with two of its 45°
hatches — for a name the set does not hold; an act that declares no glyph at all shows its label
instead (R3).

**`minimize` · `maximize` · `restore`** (2026-10-11; One Frame §23.2, ruled 2026-10-02) are the
three glyphs of the wrapper around Godview's terminals (§8, the deck): a rule, a square, and the
square behind a square — the window's own pair in the order windows keep them, `restore` standing
in `maximize`'s place while the terminals are maximized. **Instrument** construction, for the Lip's
controls at 14. The ruled drawing's own paths were stand-ins (strokes of 1.7 and 1.9, 1-unit
corners) and are not the set's: the three are **drawn to this section's law** — one 2-unit stroke,
round caps and joins, 3-unit corners — at the drawing's 12-unit extent about 12,12 (6 to 18): the
rule along y 12; the square 12 by 12; `restore` an 8 by 8 square at the lower left and
the top and right of the one behind it, 4 up and 4 right, its two ends a stroke's width clear of
the square in front. **`restore`'s two squares are 8 units and keep the law's corner in
proportion, 2 units** — 3 is a quarter of `maximize`'s 12-unit side, and at 3 an 8-unit square
read, at 14, as a ring with a hook (ruled 2026-10-11). Their Hardware records are drawn, not shipped. **The three are drawn by the
wrapper's buttons** (built 2026-10-11, §8, the deck): minimize and maximize on the Lip, minimize
and restore in the maximized title bar. They are the wrapper's alone — never the pane
frame's fullscreen (its two diagonal arrows), never the window's lights.

**Where it lives.** The drawings are `tooling/glyphs/drawings.mjs` (both constructions for every
name); `build.mjs` emits the kit's `packages/design-kit/src/glyphs/data.ts` and the phone's
`FieldGlyphs.xcassets` (FieldDesign) from `picks.json`, and `glyphs.test.tsx` fails when either
output is stale. Product code draws `<FieldGlyph name size turn flip label>` from
`@vibefield/design-kit/glyphs`; plugins take it through `@vibefield/plugin-sdk/ui` (R10). On the
phone, `FieldGlyph(.name, size:)` draws the template asset at `FieldGlyph.box(for:)` of the point
size the SF Symbol had, and the swarm's CoreGraphics sprites are the Instrument drawings by hand.
**An inline `<svg>` that is an icon is refused by test**; what may stay inline is geometry that is
not an icon — the edge tray's notch and drawer (§8), the coin's marks (§2.8), the catalog's fixture
stills — and, on the desk, two named exceptions: the bar's ONE path renderer for a kind's own drawing
(R2; one component, allow-listed) and the peers' pointer arrow (R17; §8, peers on the mat).
**Kept exact, outside this set:** the tray and app masters, the three vendor marks (AR-L1),
the OS marks the device chip wears (Simple Icons, drawn inline in `os-marks.tsx` — the test's one
other allowed file; a phone, wherever a surface marks one, wears the mark macOS wears, Apple's,
since iOS's own is a word — James, DS-3: "do not use texts, use OS icons instead" — and no surface
marks one today), the Face Club and AFTER HOURS art (§11), the file-tree family (§8), and
**Tailscale's logomark** (track TS, TS-D4 ruled 2026-10-27), held to the rules of Tailscale's Brand
Toolkit (its press and media kit, 10-2025): the nine dots exactly as its file draws them — the middle
row and the bottom centre solid, the other five at 40% — never in one colour, never smaller than
48 × 48 px (drawn at 56, so the dots themselves span 48), never on a busy ground, in
`--vf-tailscale-ink` (`#1E1E1F` on light, `#FFFFFF` on dark, its two files' inks). It appears only
where trust is decided — the Connect pane's partner line, Settings → Devices' card, the phone's
sign-in — and every button stays words. It is drawn inline in `account/tailscale-mark.tsx`, the
glyph test's allow-list naming it, and About carries "Tailscale is a registered trademark of
Tailscale Inc.". On the
phone (PJ-7) the OS marks are template SVGs in FieldDesign's `OSMarks.xcassets` (`DeviceMark`),
copies of `os-marks.tsx`'s paths that `pnpm check:ios-fixtures` holds to them; and `start`,
`resume` and `jump` join the phone's picks, so History's New agent, Resume and Jump to draw the
same Session Glyphs the desktop does.

*History:* pass 1 (2026-09-23) redrew the set at three stroke treatments and was rejected as three
weights of one drawing; pass 2 drew three constructions — a 9×9 dot matrix on the ground's grid,
solid hardware with transport-control verbs, and generated brush strokes — beside the quiet
monoline baseline. The choice mixed the baseline with ten hardware verbs; the other constructions
remain in `drawings.mjs` and on the page, not in the product.
