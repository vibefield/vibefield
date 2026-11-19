// WP8-D6 — the packaged app's own plugins: a NAMED list, never a glob (DK-8's retired plugin folders keep build
// leftovers that must never ship). RL2 (b), TD-7: the product's own objects ship bundled — the comment pad. The panel
// that made `plugins/browser` the other row moved into field-app (FL-2, 2026-11-09). The browser pane (here from PT-6b,
// 2026-10-14) left the first launch's lineup on 2026-11-09 and came back on 2026-11-19 with the iOS simulator: both
// ship as official plugins (DECISIONS "FL" as amended 2026-11-19). The comment pad stays FIRST: smoke:bundled's
// corrupt run flips the first renderer-bearing plugin's renderer (docs/desk-gates.md row 29). The ONE list — the
// stager (scripts/stage-package.mjs), smoke:bundled's stager (stage-bundled-fixture.mjs) and the notices
// (scripts/third-party-notices.mjs) import it. Builtins only, no side effects on import.
export const BUNDLED_PLUGINS = ["plugins/comment-pad", "plugins/browser-pane", "plugins/simulator"];
