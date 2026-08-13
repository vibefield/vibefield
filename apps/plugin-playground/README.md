# @vibefield/plugin-playground

The headless widget-state **verdict runner** (plugin spec §5.4 item 5, §24.2
"every widget state render fixture").

It renders every declared widget state of a plugin with no window, no daemon and
no build step, and answers pass/fail per state with a machine-readable
diagnostic. It is scriptable acceptance, not a visual bench — the UI Bench
(`pnpm dev:design`) exists for eyes; this exists for agents and CI.

```sh
node apps/plugin-playground/bin/plugin-playground.mjs plugins/note
node apps/plugin-playground/bin/plugin-playground.mjs plugins/note --json
node apps/plugin-playground/bin/plugin-playground.mjs plugins/note --state vibefield.note:long
```

Exit codes are law (P8-D8): **0** every state passed · **1** at least one
refusal · **2** the harness itself failed. Nothing prompts.

## Authoring states

States live at `<plugin>/playground/states.ts`, default-exporting
`widget type → state name → props`:

```ts
export default {
  "vibefield.note": {
    empty: { text: "", color: "#f6e7a9" },
    written: { text: "Ship the playground.", color: "#f6e7a9" },
  },
};
```

The file is authoring-time material — it never enters a `.vfplugin`, the same way
`scripts/` and `test/` do not. **Absent file ⇒ one `default` state per declared
widget**, built from the manifest's own prop defaults, so a plugin gets a verdict
before anyone writes a fixture.

Props are validated against the manifest's declared prop schema **before**
anything mounts, so a fixture that contradicts the declaration is reported as
`state-invalid` — its own class — rather than surfacing later as a mysterious
render failure. Unknown prop names refuse too: the engine drops them silently, so
a typo would otherwise render the defaults and pass.

## What a pass means

The component under test is not the plugin's export — it is what the host's
`buildWidgetType` produced from the manifest, mounted inside the real §11.4
per-widget failure boundary, on a real ICE engine with a real entity spawned from
the state's props. A state passes when the mount completes without throwing, the
boundary stays untripped, and unmount (with every effect cleanup it runs)
completes. `console.error` output is reported on the row but does not gate: the
React dev channel carries version-dependent warnings that are not the plugin's
contract, and a verdict that flips on a React upgrade is not a verdict.

`surface: "gl"` widgets are **skipped, by declaration** (`skipped-gl`): a GL
widget renders inside an island backed by a real WebGL context, which this
DOM-only harness does not have. Mounting one anyway throws at the first island
hook — an answer about the harness, not the widget. Skips are counted apart from
passes and never reported as one; they do not fail a run.

## How it loads code

`bin/` installs a DOM (happy-dom) and stands up a Vite dev server used purely as
a module loader, then hands control to `src/cli.ts` on the far side of it. The
graph a widget verdict needs is `.ts` + `.tsx` + `.css` + workspace packages that
export source — the renderer's own pipeline — so running the real transform is
what makes the answer about the plugin rather than about the harness. React, ICE
and three stay external, so each is the single instance Node resolved and hooks
work across the host/plugin boundary.

Plugins load from **source** (`src/renderer.tsx`, the convention `plugin-build`
declares), never from `dist/`: a verdict must not require a build to have run,
and `pnpm test` must never depend on `pnpm build`. The staged-artifact path is
witnessed by `smoke:canvas` (P8-D2); this is the authoring path.
