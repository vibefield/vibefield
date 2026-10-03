# Living mark — VibeField logo studio

The existing infinity and RGB identity becomes a continuous white ribbon in a field of
spectral light. The supplied reference informed the luminous crossing, radiating filaments,
white core, and fine colored edge. The redesigned silhouette adds controlled taper and a
slight asymmetry, with a definite over/under crossing. A Möbius half-twist now travels
continuously around the ribbon, keeping the infinity path readable while its faces turn in
3D. Luminous pulses follow its single continuous boundary. The interface follows DESIGN §2–6;
the artwork direction is recorded in DESIGN §12.

## Open the studio

With the design server running, open <http://localhost:5174/logo-studio.html>.
The design catalog also links to it under **Living mark**.

```sh
pnpm dev:logo
```

This starts the existing Vite design server on port 5174. If that server is already running,
use its URL directly. `pnpm --filter @vibefield/electron-shell build:design` builds both the
catalog and studio into `.vibefield/studio/catalog-renderer/`. The logo studio is a design
entry; it is not included in the production desktop document entries.

## Explore

Five presets: **Prism**, **Afterglow**, **Daylight**, **Signal**, and **Ink**.
Each is editable through 39 parameters:

| Group | Controls |
| --- | --- |
| Shape | Scale, width, height, ribbon width, taper, pinch, rotation, asymmetry |
| Finish | Spectral edge, pearlescence, glow |
| Light | Field intensity, saturation, exposure, diffusion, filament intensity/count, twist, grain, vignette |
| Motion | Overall speed, breathing, color drift, pointer response |
| Möbius flow | View tilt, twist focus, circulation speed, loop depth, perspective |
| Edge flow | Highlight strength, highlight speed, falloff length, highlight count |
| Palette | Four spectrum colors, ground color, ribbon color |

Changes save locally. **Reset to Prism** restores the starting direction. **Share look**
copies a URL containing the complete settings. **Save preset** and **Import a saved preset**
round-trip versioned JSON. Earlier version-1 presets gain the new motion defaults when loaded.
Imported numbers are bounded and nonfinite values rejected;
colors accept six-digit hex. Import errors leave the current look intact.

**Space** pauses/resumes when focus is outside a control. The stage's expand button enters
focus view; **Escape** exits it. Tabs, sliders, number fields, palette inputs, and buttons
are keyboard accessible. Reduced motion starts paused and can be explicitly overridden
with Play. A change to reduced motion while the studio is open also pauses it.

In **Motion → Möbius flow · 3D**, **Circulation speed** moves a half-twist continuously around
the infinity. The ribbon rolls around its local tangent while its centerline holds the
infinity shape. **Twist focus** gathers the turn into a tighter fold or distributes it around
the ribbon. View tilt sets a fixed, bounded viewing angle. Loop depth sets the crossing's
physical separation, and Perspective controls foreshortening. Negative circulation speed
reverses travel; zero holds the twist in place. The background stays on its own plane.
Earlier version-1 presets retain their colors and speeds; their rotation range migrates to
twist focus. The interface's earlier rocking controls are replaced by the Möbius controls.

In **Motion → Light along the edges**, Highlight strength controls the moving reflections
independently of Ribbon glow. Zero removes the moving highlights; Highlight speed zero
holds them on the moving ribbon, and negative speed reverses their travel. Falloff length
softens their trailing shoulder, and Highlight count sets one to eight reflections around
the continuous edge. Overall speed scales the shared animation clock; Pause freezes the
entire composition.

The light has a fine spectral rim, a satin surface, and soft colored diffusion close to the
edge. Highlights retain the palette's saturation, with a soft brightness ceiling. The halo
responds to viewing angle and stays narrow when strength increases. This lighting applies
to saved settings as well as the defaults; the palette and geometry remain editable.

The reference **Prism** defaults match the selected Motion settings:

| Motion control | Default |
| --- | --- |
| View tilt | 5 |
| Twist focus | 0 |
| Circulation speed | 1.32 |
| Loop depth | 0.27 |
| Perspective | 0.63 |
| Highlight strength | 0.7 |
| Highlight speed | 3 |
| Falloff length | 0.83 |
| Highlight count | 7 |
| Overall speed | 2 |
| Breathing | 0.26 |
| Color drift | 0.2 |
| Pointer response | 0.3 |

Fresh sessions and **Reset to Prism** use these values. Saved looks keep their explicit
settings; Afterglow, Daylight, Signal, and Ink retain their individual mood overrides.

## Export

- **PNG:** 1024, 2048, or 4096 square pixels, rendered at export resolution with the current
  animation time. Transparent mark removes the field and preserves the colored rim/glow.
  Exports center the pointer response and omit interface labels.
- **Vector SVG:** the flat, editable ribbon silhouette, using the current 2D geometry and
  ribbon color. It omits the 3D pose, light field, and spectral finish; use PNG for the current frame.
- **Preset JSON:** all 39 parameters, suitable for importing, sharing, or using in code.

Example exports: [Prism 2048 PNG](logo-review/prism-2048.png) and
[transparent ribbon](logo-review/prism-transparent-2048.png).

## Reuse in the app

```tsx
import { LivingLogo, LOGO_PRESETS } from "@vibefield/design-kit/logo";

<div style={{ width: "100%", height: 420 }}>
  <LivingLogo parameters={LOGO_PRESETS[0].parameters} />
</div>
```

`playing` defaults to the OS motion preference; an explicit boolean controls playback.
`transparent` removes the light field. `onStatus` reports loading, ready, and unavailable
states. A `LivingLogoHandle` ref exposes `snapshot(size, transparent): Promise<Blob>`.
The leaf also exports parameter types, defaults, presets, normalization/serialization,
and the `logoSvg` outline exporter. It has no three.js or canvas-engine runtime dependency.

The canvas needs a secure context (HTTPS or localhost) and an available WebGPU adapter.
Unavailable adapters, compilation failures, and lost devices show the static SVG and an
honest status. SVG/preset exports remain available. Reload reconnects after device loss.

## Implementation

- `packages/design-kit/src/logo/shader.ts`: native WGSL, a fullscreen procedural field,
  a 512-segment ribbon with a 16-sided elliptical profile, and two emissive edge strips.
  The cross-section makes one half-turn per circuit, with a continuously advancing phase.
  At the join, opposite profile sides coincide; the two apparent rims form one closed boundary.
  A coordinate spanning two laps joins the edge colors and pulse phases across both seams.
  The ribbon receives a fixed view tilt, its in-plane rotation, and perspective.
  An opaque depth pass keeps the crossing and back faces correct. The glows use the same
  projected physical rims and test against that depth without writing to it. Two offset
  periodic lobes create a broad reflection with a soft trailing shoulder; its value passes
  through an exponential brightness shoulder instead of adding clipped white to the ribbon.
  A narrow Gaussian core and a faint wider falloff form the halo. Viewing angle and light
  direction modulate it, and projected curvature limits its width around tight bends.
  The halo radius is independent of highlight strength, keeping bright settings restrained.
  All artistic changes use one 256-byte uniform buffer; no shader recompilation.
- `motion.ts`: constant-speed circulation, wrapped before uploading to GPU floats, and a
  fixed viewing angle limited by the shape's height and depth. Live rendering and exports
  use the same phase. The cycle has no reversal or rest at its join.
- `renderer.ts`: device/pipeline ownership, canvas configuration, uniform packing, resizing,
  isolated square PNG exports, and explicit GPU cleanup.
- `LivingLogo.tsx`: demand rendering, animation clock, eased pointer response, resize/visibility
  observers, reduced motion, fallback, and cancellation of asynchronous initialization.
- `parameters.ts` and `svg.ts`: serializable settings and portable geometry.
- `packages/field-app/src/design-system/logo`: studio UI, shared design-kit controls, and CSS.
- `LogoSection.tsx`: catalog specimen using the same renderer; it starts on request.

The live canvas caps device pixel ratio at 1.75 and its longest backing dimension at 1800px.
Four-sample antialiasing smooths the geometry and overlapping edges. Exports through 2048px
also use four samples; 4096px exports use native resolution with one sample to bound GPU memory.
Color/depth attachments are reused, rebuilt on resize, and destroyed with the renderer;
exports own separate temporary attachments. Paused, offscreen, and hidden canvases stop scheduling
frames; tuning a paused canvas requests a single new frame. Grain is spatial, avoiding flicker.
The shader uses the [W3C WGSL specification](https://www.w3.org/TR/WGSL/).

## Review

Screenshots: [Prism studio](logo-review/prism.png), [Afterglow / dark](logo-review/afterglow-dark.png),
[Daylight](logo-review/daylight.png), and [mobile](logo-review/mobile.png).
Browser measurements are in [checks.json](logo-review/checks.json).

Validation passed: design-kit and field-app TypeScript checks, the production design build,
scoped Biome checks, and 42 tests covering catalog navigation/ownership, preset validation,
backward compatibility, readable view bounds, continuous phase, reversed/stopped motion settings,
and cancellation during GPU initialization.

The browser verification exercised real WebGPU compilation and rendering, five presets,
slider editing, keyboard tabs, local persistence, share round-trip, valid/invalid/oversize
imports, PNG/SVG/JSON export, 2048px transparency, 4096px output, reduced motion, explicit
playback, offscreen suspension, focus/Escape, and simulated device loss. Layouts at 320,
390, 768, 1024, and 1440px had no horizontal overflow. The measured animation submitted 42
frames in 700ms on this test machine; this is a local observation, not a cross-device guarantee.

Packaged app, tray, and Icon Composer masters are preserved. This study is available for
review and reuse through the studio and design-kit leaf.

### Earlier full-turn review

These captures document the first 3D implementation. The current Möbius animation keeps
the centerline steady because turning the whole shape edge-on lost the infinity silhouette.

[Motion controls](logo-review/axial/studio.png) · [mobile](logo-review/axial/mobile.png) ·
[45° pose](logo-review/axial/pose-45.png) · [90° pose](logo-review/axial/pose-90.png) ·
[edge flow, first frame](logo-review/axial/edge-flow-0.png) ·
[edge flow, later frame](logo-review/axial/edge-flow-1.png).

[GPU checks](logo-review/axial/checks.json) verify visible geometry at five axial angles,
pixel-identical completion of a full rotation with other animation disabled, isolated
edge-light movement, reversed travel, and an unchanged image when pulse brightness is zero.
Transparent 4096px export passed, temporary attachments were released, live attachments were
reused across frames, and resize/disposal released their allocations. No GPU errors occurred.

[UI checks](logo-review/axial/ui-checks.json) cover all 12 Motion controls, pause and repaint
while paused, reduced motion, explicit playback, offscreen suspension, and mobile width.
The 3D renderer submitted 41 frames in 700ms in this session; performance depends on hardware.

### Earlier bounded roll and bend-safe glow review

This intermediate version preserved the silhouette but reversed direction at each turning
point. The current Möbius motion replaces that rocking behavior with continuous circulation.

[Cycle and glow contact sheet](logo-review/bounded-roll/cycle-review.png) ·
[forward turning point](logo-review/bounded-roll/forward-turn.png) ·
[backward turning point](logo-review/bounded-roll/back-turn.png) ·
[maximum glow](logo-review/bounded-roll/strong-glow.png).

[GPU checks](logo-review/bounded-roll/checks.json) sample 24 frames across each of three
complete cycles: Prism, the largest arc, and a deep, low loop. Image-space flood fills find
two enclosed lobe interiors in all 72 frames; the smallest remains 1,740 pixels at 384px.
The default tilt spans approximately −8° to +30° with smooth reversals. Strong-glow and
dark-preset captures show the curvature-limited halos at the turning points. A transparent
4096px export succeeded, with no GPU errors.

### Continuous Möbius review

[Quarter-cycle contact sheet](logo-review/mobius/cycle-review.png) ·
[first phase](logo-review/mobius/phase-0.png) ·
[half lap](logo-review/mobius/phase-180.png) ·
[maximum glow](logo-review/mobius/strong-glow.png).

[GPU checks](logo-review/mobius/checks.json) cover 24 phases for each of Prism, focused
twist, distributed twist, and a deep, low loop. Both lobe interiors remain enclosed in all
96 frames at 512px. The test includes antialiased silhouette pixels, since a local twist
can make a very thin ribbon narrower than one solid pixel.

With independent atmosphere and light clocks held, completing a twist circuit produces a
pixel-identical image. Frames immediately before and after the join differ by an average
of 0.016 on the 0–255 component scale. A quarter lap visibly moves the twist, pulse travel
works independently, and zero speeds hold an identical pose. Transparent 4096px export
passed, and the GPU reported no errors.

[UI checks](logo-review/mobius/ui-checks.json) cover the 13 Motion controls, native slider
editing, pause and paused repaint, reduced motion, explicit playback, offscreen suspension,
and the mobile layout.

### Earlier restrained edge-light review

[Before / after](logo-review/soft-light/before-after.png) ·
[Five presets and previous settings](logo-review/soft-light/presets.png) ·
[Studio](logo-review/soft-light/studio.png).

The presets now use two broad, slower highlights with less diffusion. The shader also
softens previously saved bright settings, without altering their saved values. A finer
spectral rim and gentle satin shading retain the ribbon's depth and color.

[GPU checks](logo-review/soft-light/checks.json) verify the compiled shader revision, all
five presets, an earlier bright Afterglow configuration, and twelve phases at maximum glow,
highlight strength, and count. The maximum-setting sweep had no clipped-white surface
pixels; the halo outside the ribbon stayed at or below 59/255 alpha. Independent highlight
travel, a held light phase, the seamless Möbius circuit, and transparent 4096px output passed
without GPU errors. [UI checks](logo-review/soft-light/ui-checks.json) cover the renamed
highlight controls, pause, reduced motion, and mobile layout. The 23 logo tests, both
TypeScript checks, scoped formatting checks, and production design build pass.

### Selected defaults and stronger color

[Same-settings comparison](logo-review/color-glow/comparison.png) ·
[Prism](logo-review/color-glow/prism-after.png) ·
[Motion controls](logo-review/color-glow/studio.png).

The thirteen reference Motion values above come directly from the selected settings.
Highlight strength remains exactly 0.7. Visibility increases in the shader through a
stronger halo and a broader reflection on the ribbon. Less white is mixed into the moving
light, keeping more of the palette's color while preserving the soft falloff and brightness
ceiling. Brightness still does not change the halo radius.

[GPU checks](logo-review/color-glow/checks.json) compare the previous and current shader at
identical settings and times. Three sampled phases show higher halo opacity and color
contrast, without clipped-white surface pixels. Highlight movement, the seamless Möbius
cycle, and transparent 4096px export pass without GPU errors.
[UI checks](logo-review/color-glow/ui-checks.json) confirm every displayed Motion value,
Reset to Prism, and local persistence. The 23 logo tests, both TypeScript checks, scoped
formatting checks, and production design build pass.
