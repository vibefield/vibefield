# {{title}}

`{{id}}` — a VibeField plugin that puts an OBJECT on the desk: a disc drawn by its own WGSL, lying where
the desk lays it, hanging on the pegboard among the desk's things. Everything it imports of the engine
comes through `@vibefield/plugin-sdk/desk`; the host compiles it exactly as it compiles the desk's own
kinds.

## The ten-minute path

1. **Install** — `pnpm install` at the repository root (this directory joined the workspace when it
   was scaffolded under `plugins/` or `examples/plugins/`).
2. **Build** — `pnpm --filter {{packageName}} build`: plugin-build writes `dist/renderer.js`, your
   `.wgsl` inlined into it as text (no stylesheet: a kind has no CSS).
3. **Check** — `pnpm plugin check <this directory>`: every row passes — the manifest, the import wall,
   and the activation's object rows (your export is a desk kind named by its type; it hangs on
   "things" by a hook; its WGSL arrived as text). `pnpm plugin inspect <this directory>` says the same
   as data.
4. **Test** — `pnpm --filter {{packageName}} test`: the manifest contract, and the kind over its
   playground states (`test/kind.test.ts` — DK-7's harness will hold a still of each to a golden).
5. **See it** — a dev session (`pnpm dev`) stages every built plugin under `plugins/` and
   `examples/plugins/` (elsewhere: `pnpm plugin dev-link <this directory>`), and the desk mounts your
   kind beside its own. It hangs on the pegboard under "things" — reached from the desk's chrome once
   VibeField wires the pegboard (DK-13).

## Make it yours

| file | what it is |
| --- | --- |
| `src/manifest.ts` | the DURABLE half: the type, its props (`color`), its size, what it provides (`desk.object`), its tray entry; emitted to `vibefield.plugin.json` by `pnpm gen:manifest` |
| `src/renderer.ts` | the export the manifest's `binding.kind` names — the object's code half (`ObjectBinding`) |
| `src/kind.ts` | the kind, whole: `create` (its pass, on the host's device), `resolve` (where it lies), `record` (what the pass draws), `hit` (what a press picks) |
| `src/pass.ts` | its pass: one pipeline, a record store, one instanced draw |
| `src/record.ts` | the GPU record, declared once — its WGSL struct is generated from it |
| `src/shaders.wgsl` | its own WGSL, after the kit's `view` and `portal` pieces (`src/shaders.ts` names them) |
| `playground/states.ts` | the states a harness draws it in |

The reference is `docs/plugin-authoring/objects.md` (generated with the contracts); the worked example
it quotes is ICE's desk clock ported to a plugin, `examples/plugins/desk-clock` — a desk state that
wakes the desk only when a hand must move, a menu act, held tools, a chip inside a mini mat.
