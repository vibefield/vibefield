# @vibefield/plugin-playground

The headless **verdict runner** (plugin spec §5.4 item 5, §24.2 "every widget
state render fixture").

It judges every declared widget state of a plugin with no window, no daemon and
no build step, lists the plugin's object kinds, and answers pass/fail with a
machine-readable diagnostic. It is scriptable acceptance, not a visual bench —
VibeField Studio (`pnpm dev:design`) exists for eyes beside the real product;
this exists for agents and CI.

**Since DK-5 (the desk) nothing mounts.** The canvas is ICE's desk, which draws
object KINDS and no DOM under the camera: a widget row compiles faceless (DK-2),
so the old verdict — "its React face mounts in happy-dom" — retired with the
faces. The kind-conformance harness that judges an object's states
(`resolve`/`record`/`hit` over them, no DOM, and an optional Dawn still) is the
playground v2, DK-7's.

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

Props are validated against the manifest's declared prop schema, so a fixture
that contradicts the declaration is reported as `state-invalid` — its own class.
Unknown prop names refuse too: the engine drops them silently, so a typo would
otherwise read as the defaults and pass. A states file may name an object kind's
type as well: its states are counted on the kind's row for DK-7's harness.

## What a pass means

A **widget state** passes when its props agree with the type's declared schema —
the same check `state-invalid` refuses on. Nothing is spawned or mounted for it:
on the desk a widget row has no face (it is retired at DK-8 in favour of object
kinds), so a mount could only answer for the harness.

An **object kind** is LISTED, one row per `contributes.objects` entry: its type,
the export its `binding.kind` names, how many states its fixture declares (or the
one synthesized `default`), and its `refusal` — a field that reads `null`, because
the desk draws object kinds (`vibefield-plugin inspect` carries the same field),
so an agent branches on the field, never on a code's absence. DK-7's harness
judges those states on the same row.

The `skipped-gl` note, `state-spawn-failed`, `state-render-failed` and
`widget-unbound` are no longer emitted: each answered for a mount.

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
