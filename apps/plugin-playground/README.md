# @vibefield/plugin-playground

The headless **verdict runner** (plugin spec §5.4 item 5, §24.2 "every state
render fixture").

It judges a plugin with no window, no daemon, no device (but `--still`'s Dawn,
below) and no build step, and answers pass/fail with a machine-readable
diagnostic. It is scriptable
acceptance, not a visual bench — VibeField Studio (`pnpm dev:design`) exists for
eyes beside the real product; this exists for agents and CI.

**Since DK-7 it is the playground v2:** every OBJECT KIND a plugin contributes is
judged by the SDK's **kind-conformance harness** (`@vibefield/plugin-sdk/testing`,
`runKindConformance`) — the kind's code half (the export its manifest row's
`binding.kind` names) against its durable half (the row), with no GPU and no DOM:

1. **its declaration**, as the host reads it — a desk kind (`isObjectKind`) named by
   its type, a tray entry that says how it hangs under a category of 1–64
   characters, a row that provides `desk.object`;
2. **its program** — `create` on a RECORDING device that answers every call as
   WebGPU does short of compiling: the kit pieces it names exist, its WGSL arrives
   as text and READS (its entry points and bindings — regular expressions, the way
   ICE's own units read WGSL; nothing compiles it), each pipeline's layout carries
   what its stages statically use, each bind group fills its layout;
3. **every declared state** — each fixture in `playground/states.ts` (its props
   validated first) × idle, selected, held, open (when the kind opens), contained
   (when the row provides `desk.containable`) × the zooms the desk's LOD names (one
   per band of its decade lattice, its ends, the arrival band, the hang), and once
   at rest by night — through resolve, record, hit (it must hit its own box),
   frame, chip, the opening, prepare and drawRange into a pass that checks the
   draw list;
4. **its dispose.**

A widget row has no face on the desk (it retires at DK-8); its states are judged
on their props against the declared schema, nothing mounted.

Without `--still` nothing compiles a kind's WGSL here: every kind with shaders
carries the note `object-wgsl-not-compiled` — its WGSL was read, never compiled,
so an unresolved name or a type error passes the harness.

```sh
node apps/plugin-playground/bin/plugin-playground.mjs examples/plugins/desk-clock
node apps/plugin-playground/bin/plugin-playground.mjs examples/plugins/desk-clock --json
node apps/plugin-playground/bin/plugin-playground.mjs <plugin> --state <type>:<state>
node apps/plugin-playground/bin/plugin-playground.mjs <plugin> --still           # draw each state on Dawn
node apps/plugin-playground/bin/plugin-playground.mjs <plugin> --still --bless   # write its golden, once
```

## The still (`--still`, DK-11)

`--still` also DRAWS each object kind on **Dawn** — Node's WebGPU, the `webgpu`
package, a devDependency of this CLI and of nothing else — with no window and no
app, through ICE's `createStill` (petition I30, `@vibecook/ice/desk`): for each
state the harness drove, ONE object of the kind on a bare mat, by day and by
night, built as the product builds it (field-app's `buildObjectType`) under the
palette the product mounts its desk with. It does what the harness cannot: the
kind's WGSL is **compiled** on a real device — a WGSL error comes back as the
compiler's own line at your file's line and column (`still-failed`) — and its
pixels are judged:

- **drawn** — some of its box is off the bare mat (`still-blank`: it compiled and
  drew nothing);
- **inside its reach** — nothing past its rect grown by `kind.reach` moved
  (`still-past-reach`: the desk culls and pads an object by its reach);
- **steady** — drawn twice, the same bytes (`still-unsteady`: a look that reads a
  wall clock or a random);
- **held to the plugin's golden**, `test/still.golden.json` — each still's size
  and the sha-256 of its RGBA, **blessed once by the named flag**: `--still
  --bless` writes it (a deliberate event; say so in its commit). No golden yet is
  a note (`still-unblessed`); other bytes are a refusal (`still-golden-mismatch`,
  naming the host that blessed it). `--bless` with `--state` mends that state and
  keeps the rest.

**A golden is host-specific.** It is Dawn's bytes on the host that blessed it —
its GPU, its driver and OS, and this CLI's Dawn (`webgpu` 0.4.0, ICE's own) — and
it records that host. Another host is expected to differ: re-bless there locally,
and never commit a second host's golden over the first. For the same reason the
stills never run in `pnpm test` (CI's hosts carry no such GPU); `pnpm still` runs
this package's Dawn suite (`test/still.dawn.test.ts`). No adapter is a harness
error (exit 2), never a refusal.

A still is ICE's facts and pins: a kind is handed no `local` (a clock shows its
shop time), no host services (no text raster — the comment pad's writing is not
in its still) and no chrome. Each still's PNG lands in `<plugin>/.vibefield-still/`
(ignored here) for a reader's eye.

**What is said while a still is drawn is listed beneath its row** (`said`, each
line counted). ICE itself says nothing there since `0.15.0-desk.5`: until then,
under strata's DEV build (vitest, or `node --conditions=development`), every
still printed strata's access warning about `"Tray"` — two of ICE core's own
systems sharing a write in one phase, said at every engine a still made — and
desk.5 orders them (ICE I34). So a line under a still's row is your kind's own,
or its draw's. The bin, under Node's default conditions, loads strata's
production build.

Exit codes are law (P8-D8): **0** every row passed (a note is not a refusal) ·
**1** at least one refusal · **2** the harness itself failed. Nothing prompts.

## Authoring states

States live at `<plugin>/playground/states.ts`, default-exporting
`object (or widget) type → state name → props`:

```ts
export default {
  "vendor.demo": {
    default: {},
    coral: { color: "#e8765c" },
  },
};
```

The file is authoring-time material — it never enters a `.vfplugin`, the same way
`scripts/` and `test/` do not. **Absent file ⇒ one `default` state per declared
object or widget**, built from the manifest's own prop defaults, so a plugin gets
a verdict before anyone writes a fixture. For an object kind each state is a
FIXTURE the harness drives in every declared mode and at every zoom.

Props are validated against the manifest's declared prop schema — one function
for a widget's states and a kind's fixtures, the SDK's `validateStateProps` — so a
fixture that contradicts the declaration is reported as `state-invalid`, its own
class, before anything draws it. Unknown prop names refuse too: the engine drops
them silently, so a typo would otherwise read as the defaults and pass.

## What the rows say

An **object kind** gets its own row — `{ kind: "object", type, binding, states,
refusal }`: `states` is the count of states the harness DROVE, and `refusal` its
first refusal or `null` (a field an agent branches on, never a code's absence).
The harness's verdicts follow it, one row each: `{ kind: "kind", type, subject,
status, code, pointer?, expected?, detail }`, `subject` being `declaration`,
`program`, `dispose` or a fixture's name. The codes are the SDK's
(`KIND_EXPECTED` says what each would have passed): `object-export-missing`,
`object-kind-invalid`, `object-kind-misnamed`, `object-tray-hang-missing`,
`object-tray-category-invalid`, `object-provides-no-desk-object`,
`object-create-failed`, `object-kit-piece-unknown`, `object-wgsl-not-text`,
`object-wgsl-unread`, `object-wgsl-binding-unlaid`, `object-bind-group-mismatch`,
`object-dispose-failed`, `state-invalid`, `state-spawn-failed` (a world half threw
or answered no shape), `state-hit-missed`, `state-render-failed` (a prepare or
drawRange threw), `state-draw-ill-formed`; the notes `object-wgsl-not-compiled`
and `object-create-not-run-here`.

A **widget state** passes when its props agree with the type's declared schema.

**Retired by name (DK-7):** `widget-unbound` (a widget row binds no face) and the
note `skipped-gl` (nothing is GL) — never emitted again (`RETIRED_CODES`).
`state-spawn-failed` and `state-render-failed` were re-aimed at the states the
harness drives.

## How it loads code

`bin/` installs a DOM (happy-dom) and stands up a Vite dev server used purely as
a module loader, then hands control to `src/cli.ts` on the far side of it. The
graph a plugin's activation needs is `.ts` + `.tsx` + `.css` + workspace packages
that export source — the renderer's own pipeline — so running the real transform
is what makes the answer about the plugin rather than about the harness. React
and ICE stay external, so each is the single instance Node resolved.

Plugins load from **source** (`src/renderer.tsx`, the convention `plugin-build`
declares), never from `dist/`: a verdict must not require a build to have run,
and `pnpm test` must never depend on `pnpm build`. The staged-artifact path is
witnessed by `smoke:canvas` (P8-D2); this is the authoring path.
