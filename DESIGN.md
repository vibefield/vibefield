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
floating pills — with ONE named exception, the terminal deck's sheet edge (§8, 2026-09-28,
James). The scoped `--vf-godview-*` tokens are the exact reference palette. VibeField
composites those status-body colors at 72% by default so they remain legible glass over the field;
the temporary system-control panel exposes that alpha for live tuning.
**Since One Frame (FR-1, 2026-10-03) Godview is a view, not an overlay:** it is drawn inside the
cover BELOW the frame (§10), reached by ⌘2 or its cell in the views track (§8), and keeps this
instrument bar as its head for now — without the blocked · working · idle counters (FC-D18).
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

The deck sheet's shadow is §5's *Sheet* recipe, keyed to Godview's OWN mode switch rather than
the app's theme (Godview can be dark over a light field). Its geometry: top corners
`--vf-godview-deck-radius` 12px; the lip (the band the grip sits in) `--vf-godview-deck-lip`
14px — never less than the radius, so no pane corner meets the curve; the grip
`--vf-godview-deck-grip` 72×4, fully round — the island's pull bar (§8), longer and thinner: it names a full-width edge (James, 2026-09-28: 36 read too short).
The empty pane launcher's clearing (QL-1, pass 3 §22) is the sheet's own paint, but never
thinner than `--vf-godview-launcher-clearing-floor` 92% of the ground: a viewer who thins the
stage thins the sheet, and at the sheet's glass the prompt beneath would read through the
launcher's rows. At the default opaque backdrop the floor changes nothing. A launch (QL-2, §8)
covers its pane with the same paint and the same floor while it waits.

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
- **The line** (One Frame FR-2, FR-3, §5; FC-D1, FC-D3, FC-D14 ruled 2026-10-01; built
  2026-10-03): the frame's foot (§10), the same in every view — `[views] create │ draft mic send`,
  the composer as one product composition. 880 × 52 on the line's glass (§5), padding 5 × 6, its
  pieces 2 apart and centred on the foot axis. From the left:
  - **the views track** (above), its left end;
  - **create** — 32 round in the ready fill (the foreground at 8%; 14% under the pointer, where it
    grows 1.06 on the pop curve), 6 clear of the track, its glyph 16 in secondary ink (primary while
    open or hovered). It is the view's own act (FC-D3), and only Canvas's is a bare plus (FR-3):
    **Canvas — Objects** (`plus`, B): the objects rise behind the line and the plus turns 135° into
    ✕ over 600ms on the island curve; **Godview — New terminal** (`start`, ⌘T): a fresh shell in the
    active pane, which shows its launcher; **History — Resume** (`resume`): waiting, faint by ink as
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
  clipboard, and the note says that and why: "Copied — no agent takes a message from here yet". The
  note is the views track's note (solid, 12/500 in secondary ink, rising 4px as it fades in), over
  send with its right edge on send's (so a long sentence never leaves the window) — or, for create's
  outcomes ("Terminal opened in the active pane"), centred over create — for 2.4s. Sending clears
  the draft's words and chips and keeps the aim.
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
    is chosen — Jump to this session while it runs here, by the line's own reading) and on Canvas
    the four zoom acts; **App** — Settings… ⌘,; then each enabled
    plugin's palette commands under the plugin's name, one no live handler answers drawn
    "unavailable" and never run. Eyebrows 10px mono capitals in tertiary ink; rows 36, a 16 glyph
    in a 24 column in secondary ink (the zoom acts carry none), 13/500, the hot row in the ready
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
  shown at once under the lowering cover, the still dropped. A resize or a theme change while
  covered re-captures: thaw → one frame → capture → freeze (R16). A capture that answers nothing (a
  lost device) covers the mat's ground as the theme lights it — `--vf-mat-ground`, `#3D5A30` by day
  and `#313C40` by night (§2.1's lit values; the token is DK-15's to add) — and says so once in the
  status line (R16), in the card's own words: "The desk lost its graphics device". Until I23 ships,
  `createImageBitmap` on the desk's own canvas stands in — a bitmap ICE does not promise, so its
  absence falls back the same way. **Godview's live backdrop** (GT-7's viewer glass,
  `backdropOpacity` / `backdropBlur`) **and rosetta's room glass retire on the desk**: the cover is
  a tint over the still, and their settings rows go (R16; the deck's note, below).
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
- **Godview's terminal deck is a sheet over the monitor** (2026-09-28, James — §1.1's one
  named departure from the reference). The deck is one card whose top edge is a tab: rounded
  top corners, §2.3's hairline as a ring, and the Sheet shadow (§2.7's row) cast UP onto the
  monitor, so the stage reads as lying beneath it. **The card's ground is always the terminal's
  own background** (James, 2026-09-28): `--vf-godview-terminal-bg`, projected from the same
  theme the panes are handed (a catalog theme, the per-mode choice, or §2.7's terminal
  grounds), at the stage's glass (`--vf-godview-stage-opacity`). A pane's translucent ground
  over a sheet of its own colour composites to that colour exactly, so lip, gaps and panes are
  one surface — at an opaque backdrop; a viewer who thins the backdrop thins the
  sheet with the rest of Godview, and the panes then read a shade denser than the lip (the
  panes cannot shed their ground: ghosttea draws inverse video and glyph backdrops from it).
  *Since 2026-10-03 (FC-D16) the backdrop's default is the covers' glass, 72%*, so that shade is
  the default look; the panes keep their own 82% and the launcher its 92% floor (§2.7), so text
  never sits on the field. **Inside the cover (§10, FC-D15)** the sheet's ground still runs to the
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
  Over the monitor the card occludes the bodies exactly as much as Godview occludes the field. **The edge moves:** a
  grip in the lip (`role="separator"`, ↑/↓ 24px, ⇧ ×4, Home/End, double-click to rest) drags it.
  Downward the monitor grows and the swarm's field grows with it; upward the monitor does NOT
  shrink — its tuned height (`Monitor height`, 35%, 170px floor) is its minimum — and the sheet
  slides OVER it, up to the bar's bottom edge, the bodies still moving beneath. The deck keeps
  at least 120px — above the cover's reserve, inside the cover. Terminals resize live (rows only,
  so no reflow of history). The position is
  the viewer's (`localStorage`), re-clamped to each window, never a shared setting. No
  transition on the edge: every frame of an animated edge would be a PTY resize.
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
  **The bar reads the manifest:** each view supplies its filled mark and its focus keys; the host
  has no view mark table. The declared keys print in the control's tooltip — ruled 2026-10-07
  (James, M177): the bar's tooltip is where a view's focus keys are said. Where a declared key
  presses a control the view shows, its legend is printed on that control, under the glyph in
  readable ink (never an outlined box or a corner digit), as the views track prints ⌘1–⌘4 (§8).
  View loops stop under reduced motion or the stage's animations switch. Each piece of host
  chrome has its own boundary — the bar, the usage column, the profile notice, the claims,
  System control, the deck and its edge, each pane's frame, the frames and the launchers: one that
  throws says "‹name› unavailable" where it stood (a deck piece in the deck's unavailable face),
  the monitor and its view stay mounted, and it is tried again only for a fact it is handed, at
  most once a window (1 s, doubling to 30 s while it keeps failing). (Find stood in this list until
  P2, 2026-10-09: the sheet left VibeField for the frame's Peek — whose Live now rows, live peek and
  scope-row filters each stand behind a boundary of their own, tried again for the rows, the run
  and the filters they draw, each the same object while its content is.) The bar and the profile notice
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
  **Runtime only (MV-6, MV-D13, 2026-10-03):** a lane begins at its row's birth, claims no state
  before `statusSince`, and draws its current state from there to now. It keeps no previous spans.
  A row leaving the model leaves the timeline. **Each lane is one wake**, drawn in the current
  state's width; earlier time is an unrecorded thread, never a guessed state.
  - Work: 2 × 22% of the lane height, clamped 8–15px, in the project's colour (§2.6's
    exception), with a soft glow (the outline's own blur, 5px light at 24% · 6px dark at 62%) and a
    1px sheen along it.
  - Blocked and unseen: a 4.4–7.6px thread in `--vf-orange` and the swarm's blue.
  - Idle: a 1.7px hairline in text-faint.
  - Time the record does not hold: a dotted text-faint thread, never a state.
  **At the head** sit the swarm's bodies, lit as the swarm lights them, the swarm's wave ringing out of
  one you owe (1.1s, island, the view's only loop). Beside each body is a readout: the current
  state's length, then its word. Names float over the wakes' far end; there is no rail. **Pointing
  at a lane (or ↑ ↓) lights it and quiets the rest to 30%.** Looking back can show only the
  current span where it covers that moment; before it the body claims no recorded state. The clock
  chip turns to the outlined head time, and NOW glides back (600ms, island). Closed-span readouts
  and retained ended lanes are retired with the history book; these controls do not record a day.
  **The map of the day** is its own 46px strip above the axis (TL-D17). Its right end lines up with
  the head while following now.
  - It is drawn as Pulse (TL-D15): only the current spans summed into one ridge, smoothed by an ~8px
    gaussian. Work stacks above a line in each project's colour, its height the number of agents
    working, drawn and never printed (FC-D18). Waits hang below in orange, then blue.
  - Only the window in view keeps its colour; the rest of the day is grayed.
  - The head is a 2px line with a knob, filled while following now and hollow while looking back.
  - **Pressing the map puts the head there, and dragging moves the head** across the known spans
    (TL-D16). It is a `role="slider"`: ← → 5 min, ⇧ 30, Home the day's start, End now. The now
    button prints End's legend `↘` under its mark, in `--text-main` (ruling 4, M179).
  **Colours:** project for work, §2.5's orange for blocked, the swarm's blue for a reply not yet
  opened (TL-D3), text-faint for idle. Never red; now is ink. One click opens the agent in the pane
  you are in (the views' `select`).
  **Reduced motion:** no wave, no glide, no zoom tween; positions jump.
  **There is no history book.** MV-D13 superseded TL-D8's status ledger: `agent.history` and
  fieldd's status recorder are removed. A future history capability must READ
  rosettad's record; neither a view nor its backend may begin recording one.
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
  package `@rosetta/room` behind VibeField's ports, so its drawing is rosetta's and this entry governs
  only where it sits and what VibeField says around it. Lists and figures arrive over fieldd's
  `index.*` doors; one session's body over the direct plane, with a grant of its own (EL2).
  - **Its ground is the cover's glass.** The room is a HOST surface: it paints no ground and no plate
    of its own, and the view's ground is the covers' glass, `--vf-chrome-solid` at **72%** (FC-D16).
    The room's paper fades — the transcript's top frost, the sticky day heads — **frost** over that
    glass (a 14px blur feathered by its own mask, the package's), never a mask on the scroller, which
    would fade the pinned chrome with the rows.
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
    the native form, as the launcher asks it) in the active pane — the pane the swarm's open uses —
    and the window moves to Godview to show it; the note says **"Resumed in the active pane"**, or
    **"Could not resume — …"** in the launcher's words, and then the window stays in History. Jump to,
    for a session still running, is owed.
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
    Pressed, the window moves to Godview and the pane showing that session becomes the active one —
    or, when no pane shows it, it is put in the active pane, as a resumed one is; the note says
    **"Jumped to its pane"**, or **"Could not jump — …"** in the deck's words. A session running on
    another desktop is not running *here* (reaching it is the mesh's, DS-4): the create stays
    Resume and says nothing new. The palette's row is the line's: the same reading, the same act.
  - **Resume refuses a running session.** A Resume pressed while the session runs here (the line's
    reading was older than the press) asks nothing of `agent.resume`: the note says **"This session
    is running — Jump to it"**, and the create becomes Jump to. Fieldd's own refusal of a second run
    on one conversation (AR-4b's one-run law, `terminal-alive`) is said in the same words. A Jump to
    pressed after the session ended says **"This session has ended — Resume it"**, and the create
    becomes Resume. *Before P3* nothing double-ran either: fieldd refused the second run, and the
    line said "Could not resume — it is already running" with no way to the pane that was.
  - **Its honest states are said inside the frame** (§9; the tolerant reader). An index that cannot
    answer keeps the room's own **"rosettad is not answering"** (or "Connecting to rosettad") with
    fieldd's own words under it — "The agent index is starting", "The agent index is failed: …",
    "The history catalog has not read the index yet (connecting)", "Fieldd is not answering
    (reconnecting)" — never a blank. An index waiting for consent, nothing enrolled, says ours:
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
      **Hidden**. An empty section draws nothing.
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
      desktop's folder waits for routed acts, DS-2), then **Agent** — each agent this desktop
      offers, one row per persona (its name at the row's end, "its own" for the agent's own
      sign-in), the most recently used first — then **Model and effort**, one dimmed row: "Model
      and effort can't be set from here yet (PJ-6)". A row starts the agent in that folder and the
      window moves to Godview to show its pane; the note says **"Started in ~/…"**.
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
    - **The project's acts** (H4, behind ②'s `···`, desktop windows only — P2): **Rename…**,
      **Pin to the top** / **Unpin**, **Hide** / **Show again**, and **Not part of this project**
      — every folder, one row each (a split). Temporary has none: it is not a project. Rename
      opens in ②'s card slot as a field with **Cancel** and **Rename** (the room's name cannot be
      edited in place yet). The same slot otherwise carries the **suggestions** (PJ-D16): "vibe-
      field shares old history with **vf-docs**" with **Not the same** and **One project**.
    - **The cards' look** (VibeField's own, inside the room's card slot): corners 12, the hairline,
      padded 10 12, its words at 12.5/400 in secondary ink, its buttons 26 tall, corners 13,
      12/500 — the ready fill, the one primary inverted on the foreground like the room's go.
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
    Retry).
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
    a product chord (§10). **In Godview** (PK2 (a), until the Stories head, GV-D1, is built) it
    stands in the same place, over the instrument bar's right end: the bar's tools end one head gap
    (12) short of it, so System control sits beside it and never under it, and the bar steps aside
    by the button's own measure as its glass widens. The button is 40 tall at `top-2` and the bar
    40 tall from the window's top, so it hangs 8 below the bar's foot, over the stage's edge.
    **With a filter on** (Godview's, GV-D3) the glass grows a token after the circle naming it —
    the desktop's OS mark and name, a hairline, the profile's glyph and name ("studio · Work"), at
    13/500 in primary ink — and a 26 × that clears both: a filtered view never looks unfiltered.
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
    terminal into the active pane.
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
    Godview, does what the view's own select does: this desktop's run mounted in the active pane, a
    peer's attached there. From History it takes Jump to's path (P3): the frame moves to Godview and
    the deck reveals the pane showing the run (activated, or mounted in the active pane); a peer's
    run is selected through Godview as it opens. A run that could not be shown is SAID, on the
    line's note in Jump to's words ("Could not jump — ‹why›"): the popup folded at the pick.
  - **Open at the line.** A past row — ↵, a click or Open — folds the popup and opens History at the
    line: the room's own `openAt` with the hit's session and message, the session in its project and
    the transcript landed on the message (§8 "History"). Everything reads this desktop's index (K5);
    other desktops' history waits for DS-7, since the room cannot open a peer's session yet.
  - **A narrow window** (K6): the popup clamps to the window — 24 clear of each side, and 96 clear
    of the window's top and foot (the line's 72, and 24), so it never covers the head or the line.
    Below a 680 popup — a window narrower than 728 — the list and a useful peek no longer both fit:
    **the peek folds and the list fills the popup**.
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
marks, the desk's bar and the tools in hand — is one of **60 named glyphs** in one **24-unit box**,
optical centre at 12,12, live area 2 to 22, drawn in `currentColor` and nothing else. The host says
the size and the colour, the way it says them for text (§2.4); a glyph never carries state (§2.5,
I-5) and never a colour of its own. Two constructions, one set:

| Construction | Glyphs | Law |
|---|---|---|
| **Instrument** (50) | everything not listed as Hardware | one 2-unit stroke, round caps and joins, 3-unit corners; solid dots only where a mark ends in one (the question and the failure) |
| **Hardware** (10) | close · check · search · rename (pencil) · return · backspace · more (ellipsis) · arrow · general (sliders) · keyboard | one solid silhouette as a single `evenodd` path — bodies and their holes, no masks, no filters — so the same geometry is a template asset on iOS |

**Sizes** are the host's, by CSS: 12 (captions) · 13–16 (row controls) · 18 (the Settings rail, the
Snap tile, the Me menu) · 20 (the 40px round buttons) · 22 (the tray's plus, the artifact choices) ·
28 (the Agents head). Instrument's stroke therefore renders 1 px at 12 and 1.67 px at 20 — one
weight, scaled, never nine. **One drawing per meaning:** a chevron is drawn pointing right and
*turned* (90 down, 180 left, 270 up); the four cursor keys are one arrow turned; redo is undo
*flipped*. The set, by group — actions: plus · close · check · search · pencil · undo · reset ·
outward · link · return · backspace · ellipsis · start · resume · jump · duplicate · tape · lift · trash ·
pen · eraser · today; navigation: chevron · arrow; places and objects:
gear · person · sliders · canvas · agents · profiles · plugin · mesh · terminal · pulse · code · sun ·
moon · clipboard · package · capture · panes · history · sidepanel · bug · globe · folder · keyboard ·
mic · scantext · snippets · prompt; signals: message · key · question · exclaim · flame · missing;
Studio only: document · layers · sparkle. **`history`** (2026-10-03, One Frame §13) is the views
track's History cell (§10): a clock turning back, the dial at `globe`'s radius opened where its arrow
turns it.
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
other allowed file), the Face Club and AFTER HOURS art (§11), the file-tree family (§8).

*History:* pass 1 (2026-09-23) redrew the set at three stroke treatments and was rejected as three
weights of one drawing; pass 2 drew three constructions — a 9×9 dot matrix on the ground's grid,
solid hardware with transport-control verbs, and generated brush strokes — beside the quiet
monoline baseline. The choice mixed the baseline with ten hardware verbs; the other constructions
remain in `drawings.mjs` and on the page, not in the product.
