# {{title}}

`{{id}}` — a VibeField plugin that puts an OBJECT on the desk: a disc drawn by its own WGSL, lying where
the desk lays it, hanging on the pegboard among the desk's things. Everything it imports of the engine
comes through `@vibefield/plugin-sdk/desk`; the host compiles it exactly as it compiles the desk's own
kinds.

## The ten-minute path

The kit's commands are `plugin-build`, `vibefield-plugin` and `plugin-playground` (in a checkout of VibeField they
are also its root scripts: `pnpm plugin …`, `pnpm playground …`). Outside a checkout's workspace NOTHING IS
INSTALLED here, and nothing needs to be: the kit's commands build, judge and try this plugin, binding the SDK to the
copy they run from, as the app's import map does. Only this package's own `pnpm` scripts (`gen:manifest`, `test`,
`typecheck`) need an install, which only a checkout's workspace gives — scaffold under its `plugins/` for those.

1. **Edit** — `src/manifest.ts` (the durable half: the type, props, size, tray), `src/kind.ts` and
   `src/shaders.wgsl` (what it draws).
2. **Emit the manifest** after every edit of `src/manifest.ts` — `vibefield-plugin emit-manifest <this directory>`
   (`pnpm gen:manifest` with an install). Never edit `vibefield.plugin.json` by hand.
3. **Build** — `plugin-build <this directory>`: `dist/renderer.js`, your `.wgsl` inlined into it as text (no
   stylesheet: a kind has no CSS).
4. **Check** — `vibefield-plugin check <this directory>`: the manifest, the import wall, and your kind against the
   BUILT module — a desk kind named by its type, how it hangs, its held tools, every name it imports from the SDK's
   door, its WGSL READ (entry points, bindings) and never compiled here. `vibefield-plugin inspect` says it as data.
5. **Judge it** — `plugin-playground <this directory>`: the SDK's kind-conformance harness drives your kind through
   every state in `playground/states.ts`, in every mode it declares, at every zoom the desk's LOD names (with an
   install, `test/kind.test.ts` runs the same harness beside the manifest contract). Then **see it drawn** —
   `plugin-playground <this directory> --still`: each state DRAWN on Dawn (the kit's WebGPU, no window) as one object on
   a bare mat by day and by night, its WGSL COMPILED (an error is the compiler's own line), judged drawn, inside its
   `reach` and steady, and held to `test/still.golden.json` — which you bless ONCE on your machine with `--still
   --bless`. A golden is Dawn's bytes on the host that blessed it: another machine re-blesses locally and never commits
   over yours. `test/kind.test.ts` runs the still too.
6. **Put it on the desk** — `vibefield-plugin try <this directory>`: the app, on a fresh profile with this plugin
   staged alone, lays one of your object on a fresh board and says whether it is DRAWN — its WGSL compiled on the
   host's device (a compile error comes back as the compiler's own line), picked where it lies — with stills by day
   and by night in `.vibefield-try/`. Well under a minute while the app's build is cached.

A person's dev session (`pnpm dev` in a checkout) finds the plugin through `vibefield-plugin dev-link <this
directory>` (`FIELDD_PLUGIN_DEV_ROOTS`); nothing a person can do lays one on the desk yet — the pegboard will, under
"things", once VibeField wires it into the desk's chrome.

## Make it yours

| file | what it is |
| --- | --- |
| `src/manifest.ts` | the DURABLE half: the type, its props (`color`), its size, what it provides (`desk.object`), its tray entry; emitted to `vibefield.plugin.json` by `vibefield-plugin emit-manifest` (or `pnpm gen:manifest`) |
| `src/renderer.ts` | the export the manifest's `binding.kind` names — the object's code half (`ObjectBinding`) |
| `src/kind.ts` | the kind, whole: `create` (its pass, on the host's device), `resolve` (where it lies), `record` (what the pass draws), `hit` (what a press picks) |
| `src/pass.ts` | its pass: one pipeline, a record store, one instanced draw |
| `src/record.ts` | the GPU record, declared once — its WGSL struct is generated from it |
| `src/shaders.wgsl` | its own WGSL, after the kit's `view`, `portal` and `light` pieces (`src/shaders.ts` names them) |
| `playground/states.ts` | the states the kind harness drives it through — each validated against the manifest's props first |
| `test/still.golden.json` | your stills' golden — written ONCE by `plugin-playground <this directory> --still --bless`, on your machine (absent until then) |

The reference is the plugin authoring docs' `objects.md`; the worked example it quotes is ICE's desk clock
ported to a plugin — a desk state that wakes the desk only when a hand must move, a menu act, held tools, a chip
inside a mini mat.
