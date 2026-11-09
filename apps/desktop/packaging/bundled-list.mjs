// WP8-D6 — the packaged app's own plugins: a NAMED list, never a glob (DK-8's retired plugin folders keep build
// leftovers that must never ship). RL2 (b), TD-7: the product's own objects ship bundled — the comment pad. The panel
// that made `plugins/browser` the other row moved into field-app (FL-2, 2026-11-09). The browser pane (here from PT-6b, 2026-10-14) left on 2026-11-09 (James, the first
// launch's lineup): it stays in the repo and a dev run, and ships in no packaged app. The ONE list — the stager
// (scripts/stage-package.mjs) and smoke:bundled's stager (stage-bundled-fixture.mjs) both import it. Builtins only, no
// side effects on import.
export const BUNDLED_PLUGINS = ["plugins/comment-pad"];
