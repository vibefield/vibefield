// WP8-D6 — the packaged app's own plugins: a NAMED list, never a glob (DK-8's retired plugin folders keep build
// leftovers that must never ship). RL2 (b), TD-7: both stay. The ONE list — the stager (scripts/stage-package.mjs)
// and smoke:bundled's stager (stage-bundled-fixture.mjs) both import it. Builtins only, no side effects on import.
export const BUNDLED_PLUGINS = ["plugins/browser", "plugins/comment-pad"];
