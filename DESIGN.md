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
instrument bar as its head for now — without the blocked · working · idle counters (FC-D18) — and
its own light switch until the app's one theme control lands (FC-D7).

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
| `--vf-canvas-dot` (classic alternate build) | `#A6A6A6` | `#1C1C1C` |
| `--vf-canvas-magnet-ink` (selected GL ground) | `#A6A6A6` | `#8A8A8A` |
| `--vf-canvas-dot` (CSS fallback) | `rgba(0,0,0,0.16)` | `rgba(255,255,255,0.08)` |
| the cutting mat (`glyph: "mat"`, `draft/ground/MAT.md`) — sage `#86A078`, cream lines `#E8DCBE`, a material carried across both themes | lit by the **Sun**: the tree-shadow reference's chain — the sage shows `#3D5A30` | lit by the **Moon**: 4100 K through the Purkinje shift — `#313C40` in the dapples, `#1C2027` in the palm's shadow, Eigengrau `#16161D` under all; half the sunlit luminance |

The ICE ground projection uses `spacings: [25, 50, 100]`, `dotAlpha: 1`,
`fadeIn: [20, 30]`, `fadeOut: [90, 100]`, `dotRadius: [1.5, 1.5]`, and
`levelWeight: [1, 0]`.

The selected magnet implementation is configured through ICE's complete
`GridMagnetConfig` contract: `glyph: "dot"`, `reach: 60`, `polarity: 1`,
`widgets: true`, `widgetStrength: 0.1`, `widgetRadius: 12`, `alwaysAlign: false`,
`needleLength: 5`, `needleWidth: 0.55`, `maxSources: 256`, and `fadeZoom: 0`.
These are appearance data, not renderer selection. Studio owns a control
for every field and projects them into its live shared `InfiniteCanvasGround`
specimen; Canvas Settings exposes only the user-facing Dot/Needle preference.

**The magnet ink (decided 2026-08-25; ICE 0.11 amendment).** Renderer choice is
build-time: Vibe Field consumes ICE's magnet build. There is no classic/magnet
toggle. The selected field must be visible while it responds, so its dark ink
is the experiment's `#8A8A8A`; light keeps `#A6A6A6`. The classic alternate's
`#1C1C1C` whisper remains recorded for the build that wires that implementation,
but it does not ride the current production path. Dot/needle is tuning inside
the selected magnet implementation: Dot is the default, and Canvas Settings
may persist either glyph as a device presentation preference.

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
working span wears its PROJECT's colour (`MonitorAgent.color`, the host's `projectTint`), because
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
| Edge tray (enters from the left; 2026-09-23) | `20px 0 40px rgba(0,0,0,0.08)` · dark `0.4` — the side panel's shadow cast the other way; as `drop-shadow()` where the silhouette is a path (`--vf-drop-edge`, and `--vf-drop-island` for the island recipe) |
| Drag proxy (above everything) | `drop-shadow(0 24px 48px rgba(0,0,0,0.35))` |
| Tray tile | `drop-shadow(0 10px 18px rgba(0,0,0,0.16))` |

**One exception to "chrome is glass" (2026-09-23, James — the notch):** the edge tray's notch
and its drawer (§8, edge trays) are OPAQUE solid chrome (`--vf-chrome-solid`, the theme's
colour), because they belong to the window's edge rather than floating over the field — a
fixture, not a control; a hardware notch, not a pane of glass. Nothing else in chrome may
claim it.

**Material tiers** (translucency + backdrop blur — chrome is glass, cards are opaque):

| Tier | Recipe | Use |
|---|---|---|
| Island | surface `/80` + `backdrop-blur-xl` (hover `/90`) | closed pill, toolbars |
| Line (MC-D2, ruled 2026-10-01) | `--vf-chrome-solid` at 88% (94% by night) + a 24px blur, ringed by the hairline (`--vf-hairline-strong` by night), the island shadow, and by night a 6% top light (`inset 0 1px 0` white/6) | the composer line (§8), the views track at its left end on the same pane of glass — the track's own pill folded into it 2026-10-03 (FR-2) |
| Sheet | surface `/90` + `backdrop-blur-3xl` | open tray, large panels |
| Overlay chip | surface `/90–95` + `backdrop-blur-xl` | put-back affordance, HUD toasts |
| Backdrop dim | `black/10` light · `black/40` dark | behind open sheets; canvas recedes to `scale(0.98)` |

**Menus are solid, floating controls are glass** (One Frame FR-7, FC-D14 ruled 2026-10-01): a menu
is rows to be read, so it is `--vf-chrome-solid` — opaque — ringed by `--vf-hairline-strong`, with
the island shadow and corners 18 (the Me menu keeps its 28, concentric with the face). The Me menu
(2026-09-22) was the first; @'s list in the line (§8) is the second; the zoom's menu and the palette
follow with the head (FR-3). A menu opens over the stage and never over the frame: the line's menus
grow upward from the line, 8 above it.

**The composited profile draws the card's material on the ground (2026-09-07; ICE
design-013 Q8, ratified 2026-09-06).** In ICE's composited profile the resting and lifted
card shadows above, §7's lift, selection ring and buttons, and §2.3's hairline are rendered
by the ground's card frame — one SDF fragment per card, at true z — and the DOM card carries
none of them; the notched frame is the selection chrome. The recipes stay exactly as written
here: the ground reads them by name (`draft/ground` `theme.ts`: `SHADOW`, `LINES`, `LIFT`,
`HEAT`). The stratified profile keeps its CSS chrome. Nothing here changes for a widget
author; the change is which layer paints the chrome.

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
- **M5 — The stage recedes.** When a sheet opens, the canvas eases to `scale(0.98)` and
  discretionary per-frame work pauses (stage hold) — focus is physical.
  *Correction, 2026-08-04:* "discretionary per-frame work" is narrower than it reads. A
  stage hold freezes GL island repaints and parks the compositor's demand loop; the world
  keeps stepping, which is what keeps undo and collab landing visibly behind a partial
  overlay. Chrome that COVERS the window instead takes `useFrameFreeze` (ice 0.3.0), which
  parks the engine outright. Sheets recede → hold. Godview covers → freeze.
- **M6 — Respect `prefers-reduced-motion`**: morphs become fades, springs become ease-out,
  durations halve. Non-negotiable quality floor.

**The view switch (One Frame §12, FC-D13; ruled 2026-10-01, built 2026-10-03).** The canvas is the
ground floor (FV-D1); every other view is ONE cover over it (§10). From Canvas the cover fades in
over 240ms plain `ease` and settles `scale(1.012) → 1` over 560ms on the island curve — Godview's
open as it shipped — while the field recedes to `scale(0.98)` (600ms, island) and freezes: a cover
covers, so it takes M5's freeze, not the sheets' hold. Between covered views the cover stays put
and only its content changes, in place: a 180ms `ease` fade, no second settle. Back to Canvas the
cover lowers — the rise reversed, 240ms out to 1.012 — and the field comes forward and thaws.
**The frame never moves**: only the views track's thumb travels (300ms, island; §8). Reduced
motion (M6): fades only, halved — the cover 120ms, its content 90ms; no settle, no recede, the
thumb lands without travelling or dipping.

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

Glow/rim knobs are live CSS vars (Studio adjustable, defaults in code):
`--ic-glow-size-t/-c: 60px` · `--ic-glow-alpha-t: 0.5` / `-c: 0.25` · glow color
light `#FFFFFF`, dark `#6E6E6E` · rim color light `#E0E0E0`, dark `#5C5C5C` ·
`--ic-rim-width: 1.5px` · `--ic-rim-radius: 600px` · `--ic-rim-alpha-t: 0.85` /
`-c: 0.55`.

**In the composited profile (2026-09-07)** these states are the ground's frame terms, not
CSS: lift is `Motion.lift` (the same `liftScale`), the selection ring rides the frame's edge,
and the overlap glow and rim become the CAST LIGHT — the lifted card lights the card under
it through its own distance field (`draft/ground/GLOW.md`); the hot-point anatomy above is
the DOM chrome's and retires with it. The tier alphas, the rim width and the colours stay the
`--ic-*` values listed here; the size, offset and radial knobs have no meaning for the light.

---

## 8. Component canon

- **Card anatomy** (CardShell, landing in `@vibefield/design-kit` — 03·A D14): rounded-22
  clip → content → glow layer → rim layer → ring layer. Chrome layers are
  `pointer-events: none` and ride the base transform. Header = eyebrow row (label left,
  meta right). Every widget ships a **compact face** for the zoom readability floor
  (03·A D15): title + badge, no micro-text.
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
  ⌘⇧V pins from the keyboard; Escape unpins. Non-modal like the Artifact panel: no backdrop,
  recede, stage hold or focus trap. A capture (SNAP-3) **flies in**: a ghost of the still
  travels from where the capture was to the notch on the island curve (560ms), shrinking along
  its travel (M4), then the notch bumps on the pop and the count ticks; reduced motion fades it
  at the notch (M6). The column ends with the **Snap** tile, the product's door to the capture,
  disabled with the honest word when the door is absent or refused.
- **Segmented control**: full-round track in `--vf-fill`, sliding solid thumb
  (white / `#2C2C2E`, hairline + `shadow-sm`), 300ms island ease; labels 13px medium,
  active full-opacity, rest `/50`. A **small** size (26px thumb, 11px labels) for a switch that
  sits inside a composition rather than heading a section — the face's Sticker / Coin in Setup.
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
    the Assistant's cell is, until a session is chosen. Between views the glyph cross-fades in place,
    200ms `ease` (One Frame §12); the tooltip says the act and its key ("Objects  B", "New terminal
    ⌘T", "Resume this session — choose a session first"), open it says "Close  Esc";
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
  faked. A paste or a drop lands at the caret, as plain text.
  **The chip** (D1, ruled 12 Sep): a token in the sentence, 24 tall, corners 7, 12.5/500, its glyph
  13, padded 0 8 0 6, ringed 1px; it never splits a word, Backspace takes it as one character and ×
  on hover removes it. A capture wears `capture` on the select blue at 14%. **The aim** — a Send to
  row taken — is the chip that leads the draft (`@vibe-field`, the fill, primary ink): the target is
  always named (CB-1), and it stays across sends until changed or removed.
  **Send, until the agent seam** (thinking-four-views §11, the interim send): aimed at a pane the
  deck is showing, the draft is PASTED into that pane's input — the road ⌘V takes, bracketed, Return
  never pressed for you — and the line's note says "Pasted into vibe-field"; otherwise it goes to the
  clipboard, and the note says that and why: "Copied — no agent takes a message from here yet". The
  note is the views track's note (solid, 12/500 in secondary ink, rising 4px as it fades in), centred
  over send, for 2.4s. Sending clears the draft's words and chips and keeps the aim.
  **One surface at a time, at the line** (One Frame FR-4, F11): @'s list and the objects are ONE
  owner's two surfaces — opening either folds the other — and Settings, the palette, the docs
  explorer, the Artifact panel and the Me menu fold them as they folded the tray. The Me menu and
  the edges' drawers join the owner with FR-4.
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
  *Its ⊕ retired 2026-10-03 (One Frame FR-3: one plus — the line's create on Canvas is the only
  bare plus on screen):* the pill keeps the name and the chevron, and **New field** is the
  explorer's first tile, in words — a doc tile's footprint whose face is the fill inside a dashed
  strong hairline, the words 12/500 in secondary ink at its centre, hover 1.03 / active 0.95 like
  its neighbours. The empty explorer says "No fields yet" in words beside it, never "⊕ creates
  one". The pill itself becomes the head's name pill with FR-3.
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
  *As built (2026-09-22, the switch):* its first frame is painted synchronously, with the
  theme stamped before it and the product entry render-blocking, so no bare or wrong-theme
  ground ever shows ahead of it. In the switch's dress (below) the wordmark gives way to the
  arriving user's face, the eyebrow "Switching to" and their name.
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
  look mounts Godview's OWN parts over a depiction of the canvas — `GodviewStage` with the
  saved backdrop, the scanlines and vignette, `PaneFrameChrome`'s bands — never a painted
  imitation of a terminal. Its glass is named in the order light passes through it: the
  pane's opacity · Godview's backdrop (opacity and blur, `--vf-godview-stage-opacity/-blur`;
  the covers' 72% and sharp by default — FC-D16, 2026-10-03; it was opaque) · your canvas.
  Variants: `window` (on the page), `deck` (the
  theme browser's stage), `thumb` (a 600px window scaled, docked in the corner once the big
  one scrolls away, and minimizable to a pill). It is `inert` inside a `role="img"` with a
  description — a picture, never a second UI.
- **Godview's timeline is the swarm through time** (TL, 2026-10-02 — James ruled design F,
  Wakes, with its map of the day; `draft/godview-timeline/`). A fourth monitor view (`TIMELINE`,
  after swarm, list and rain). It is painted into a canvas, like the swarm and the rain. Lanes run
  in birth order and never move (TL-D4). A lane is 24–36px (18px for a bare terminal, kept in a
  quiet group under the agents, TL-D7). It opens on the last hour, following now (TL-D5), with
  presets 15M · 1H · 4H · 12H. Pinch or ⌘-scroll zooms at the pointer (240ms, island) and a drag pans.
  **Each lane is one wake:** a single variable-width outline that swells into work and narrows
  through a short S-curve into a wait.
  - Work: 2 × 22% of the lane height, clamped 8–15px, in the project's colour (§2.6's
    exception), with a soft glow (the outline's own blur, 5px light at 24% · 6px dark at 62%) and a
    1px sheen along it.
  - Blocked and unseen: a 4.4–7.6px thread in `--vf-orange` and the swarm's blue.
  - Idle: a 1.7px hairline in text-faint.
  - Time the record does not hold: a dotted text-faint thread, never a state.
  - An ended agent's lane stays at 45% with a 2px end tick until it scrolls out (TL-D6).
  **At the head** sit the swarm's bodies, lit as the swarm lights them, the swarm's wave ringing out of
  one you owe (1.1s, island, the view's only loop). Beside each body is a readout: the current
  state's length, then its word. Names float over the wakes' far end; there is no rail. **Pointing
  at a lane (or ↑ ↓) lights it and quiets the rest to 30%.** The lit lane prints each closed span's
  length: inside the work, or above a wait in that state's ink, haloed in the ground. **Looking back
  relights the bodies to that moment** (TL-D13). Each readout then says how far into that state it
  was and of how long ("4:39 idle · of 7m"). The clock chip turns to the outlined head time,
  and NOW glides back (600ms, island).
  **The map of the day** is its own 46px strip above the axis (TL-D17). Its right end lines up with
  the head while following now.
  - It is drawn as Pulse (TL-D15): the whole field summed into one ridge, smoothed by an ~8px
    gaussian. Work stacks above a line in each project's colour, its height the number of agents
    working, drawn and never printed (FC-D18). Waits hang below in orange, then blue.
  - Only the window in view keeps its colour; the rest of the day is grayed.
  - The head is a 2px line with a knob, filled while following now and hollow while looking back.
  - **Pressing the map puts the head there, and dragging plays the day back** on the bodies
    (TL-D16). It is a `role="slider"`: ← → 5 min, ⇧ 30, Home the day's start, End now.
  **Colours:** project for work, §2.5's orange for blocked, the swarm's blue for a reply not yet
  opened (TL-D3), text-faint for idle. Never red; now is ink. One click opens the agent in the pane
  you are in (the views' `select`).
  **Reduced motion:** no wave, no glide, no zoom tween; positions jump.
  **The record** is fieldd's status ledger (`agent.history`, TL-D8). Without it the view still draws
  each agent's birth and its current state (TL-D9).
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
  **Bottom-left (2026-09-22, UA-D19):** the Me menu — the owner's face, §8 — then Godview,
  with the `hud.panel` slot above them; the Settings gear retires into the menu and `⌘,`.
  *(Godview's button retired 2026-10-03 — the views track below is the way in.)*
  **The left edge (2026-09-23, SNAP-3):** the clipboard tray's notch at mid-height, its drawer
  from `top-16` to `bottom-20` (clearing the Me menu and Godview); the right edge is reserved
  for its twin. **Bottom-centre:** the HUD island — *retired into the line 2026-10-03 (One Frame
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
  72% (FC-D16) — with no blur until the field's still exists to blur. A covered view ends its
  content at 692, the **reserve** of 88 above the window's foot, and keeps 8px clear at each edge
  for the notches' slivers; its own ground runs under the line, and only the canvas runs content
  under it. Above the frame stand only Settings, the palette and the loading veil (and, until
  FR-4 opens it above the line, the open Me menu, which grows over the track's left end).
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
  never a shortcut** — it is typed in the draft. **The line's open surfaces have ONE owner** (FR-4):
  @'s list and Objects are one value, so opening either folds the other, and every surface that
  folded the tray folds them. *As built (FR-1, 2026-10-03):* the frame so far is the views track, on
  the line's glass at the line's left end; the line (FR-2), the head (FR-3), the edges and the
  corner (FR-4) join it next. Until they do, the slots above stay the canvas's own chrome and lie
  under the cover with the field. *As built (FR-2, 2026-10-03):* the line is whole, the track at its
  left end; the head (FR-3), the edges and the corner (FR-4) are next.
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
Studio and the offline `docs/design/fieldmarks.html` mount the same `IconsSection`. The HTML
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
Studio and the self-contained `docs/design/face-stickers.html` mount the same
`FaceStickersSection`, with all emoji/sticker pairs, an inspector, actual-size light/dark
proofs, and downloads. Recognition at tiny sizes is an explicit design review concern,
not a claim established by a bounds test.

## 12. Living mark — spectral ribbon study

The September 22 logo study develops the existing infinity/RGB identity into a continuous
paper-white ribbon with a fine spectral edge, suspended in a radial field of light. The
crossing has a definite over/under order. Shape stays readable while light travels; motion
combines breathing, flowing filaments, and restrained pointer parallax. This is authored brand
artwork: its pink, cobalt, amber, and mint belong to the artwork, not interface or status ink.

The Logo studio uses the §2 neutral chrome, system typography, hairlines, and shared controls.
Its shader palette is editable content data. Prism is the reference direction; Afterglow,
Daylight, Signal, and Ink demonstrate atmospheric, quiet, chromatic, and monochrome uses.
Geometry, edge color, field, grain, and movement are independent parameters. The same native
WebGPU renderer lives behind the design kit's `./logo` leaf and powers the catalog specimen
and full studio. A static SVG of the same curve covers unavailable GPUs and exports the
flat mark. Reduced motion starts still; explicit playback is available in the studio.
Hidden/offscreen canvases stop rendering. The study does not replace packaged icon masters.

The Möbius extension gives the ribbon a thin, rounded physical profile and separates the
crossing in depth. A half-twist circulates continuously along the ribbon's fixed infinity
path. Its faces turn locally while both lobes remain readable; the overall view tilt stays
within a safe angle. The half-twist connects the apparent two rims into one continuous edge,
with color and light flowing smoothly across the join. Perspective and lighting reveal the
depth without spinning the surrounding field. Halos narrow around tight bends to avoid
overlapping fans of light. View tilt, twist focus, circulation speed, depth, perspective,
and pulse brightness/speed/length/count are independent controls. Depth testing applies to
both the ribbon and its edge light. Pause, reduced motion, and PNG capture retain the exact
same pose and light phase.

Edge light is a colored reflection: a fine spectral rim with broad highlights and soft
diffusion close to the ribbon. Brightness has a soft ceiling, and the halo follows the
surface angle and curvature. The highlights retain the palette's saturation and remain
visible on the light field without washing out to white. The reference motion uses the
user's selected seven highlights, full overall speed, and distributed Möbius twist; the
alternate moods retain their individual speed and light settings.

---

## 13. Glyphs — the chrome's icon law

**Chosen 2026-09-24 (James, from the Field Glyphs page; `tooling/glyphs/picks.json` is the record).**
Every functional icon the chrome draws — the HUD's round buttons, the file pill, the Settings rail,
the agent rows, the edge trays, the plugins' toolbars, the phone's composer and keypad, the swarm's
marks — is one of **51 named glyphs** in one **24-unit box**, optical centre at 12,12, live area 2 to
22, drawn in `currentColor` and nothing else. The host says the size and the colour, the way it says
them for text (§2.4); a glyph never carries state (§2.5, I-5) and never a colour of its own. Two
constructions, one set:

| Construction | Glyphs | Law |
|---|---|---|
| **Instrument** (41) | everything not listed as Hardware | one 2-unit stroke, round caps and joins, 3-unit corners; solid dots only where a mark ends in one (the question and the failure) |
| **Hardware** (10) | close · check · search · rename (pencil) · return · backspace · more (ellipsis) · arrow · general (sliders) · keyboard | one solid silhouette as a single `evenodd` path — bodies and their holes, no masks, no filters — so the same geometry is a template asset on iOS |

**Sizes** are the host's, by CSS: 12 (captions) · 13–16 (row controls) · 18 (the Settings rail, the
Snap tile, the Me menu) · 20 (the 40px round buttons) · 22 (the tray's plus, the artifact choices) ·
28 (the Agents head). Instrument's stroke therefore renders 1 px at 12 and 1.67 px at 20 — one
weight, scaled, never nine. **One drawing per meaning:** a chevron is drawn pointing right and
*turned* (90 down, 180 left, 270 up); the four cursor keys are one arrow turned; redo is undo
*flipped*. The set, by group — actions: plus · close · check · search · pencil · undo · reset ·
outward · link · return · backspace · ellipsis · start · resume; navigation: chevron · arrow; places and objects:
gear · person · sliders · canvas · agents · profiles · plugin · mesh · terminal · pulse · code · sun ·
moon · clipboard · package · capture · panes · history · sidepanel · bug · globe · folder · keyboard ·
mic · scantext · snippets · prompt; signals: message · key · question · exclaim · flame; Studio only:
document · layers · sparkle. **`history`** (2026-10-03, One Frame §13) is the views track's History
cell (§10): a clock turning back, the dial at `globe`'s radius opened where its arrow turns it.
**`start`** and **`resume`** (2026-10-03, One Frame §13; Session Glyphs' picks of 30 Sep, spawn-T3
and resume-play-T3) are the composer's create in Godview and in History (§8, the line): `terminal`'s
window with its chevron, the frame opened at the lower right to hold the verb — a plus for a session
started, play for one resumed — so the noun travels with the verb (One Frame FR-3: only Canvas's
create is a bare plus). Their Hardware records are the page's T4 column, drawn and not shipped.
**Send** needs no glyph of its own: it is `arrow`, as drawn (up). No `attach`: the line has no attach
button (FC-D1 ruled type @).

**Where it lives.** The drawings are `tooling/glyphs/drawings.mjs` (both constructions for every
name); `build.mjs` emits the kit's `packages/design-kit/src/glyphs/data.ts` and the phone's
`FieldGlyphs.xcassets` (FieldDesign) from `picks.json`, and `glyphs.test.tsx` fails when either
output is stale. Product code draws `<FieldGlyph name size turn flip label>` from
`@vibefield/design-kit/glyphs`; plugins take it through `@vibefield/plugin-sdk/ui` (R10). On the
phone, `FieldGlyph(.name, size:)` draws the template asset at `FieldGlyph.box(for:)` of the point
size the SF Symbol had, and the swarm's CoreGraphics sprites are the Instrument drawings by hand.
**An inline `<svg>` that is an icon is refused by test**; what may stay inline is geometry that is
not an icon — the edge tray's notch and drawer (§8), the coin's marks (§2.8), the catalog's fixture
stills. **Kept exact, outside this set:** the tray and app masters, the three vendor marks (AR-L1),
the OS marks the device chip wears (Simple Icons, drawn inline in `os-marks.tsx` — the test's one
other allowed file), the Face Club and AFTER HOURS art (§11), the file-tree family (§8).

*History:* pass 1 (2026-09-23) redrew the set at three stroke treatments and was rejected as three
weights of one drawing; pass 2 drew three constructions — a 9×9 dot matrix on the ground's grid,
solid hardware with transport-control verbs, and generated brush strokes — beside the quiet
monoline baseline. The choice mixed the baseline with ten hardware verbs; the other constructions
remain in `drawings.mjs` and on the page, not in the product.

