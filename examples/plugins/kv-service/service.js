// @vibefield/plugin-example-kv — the service entry the manifest's
// entries.service names. Plain JS ESM at the package root: dist/ is
// gitignored, so this file IS the artifact, not a build output. Imports
// ONLY @vibefield/plugin-sdk (wall R10). An in-memory Map backs get/set;
// watch keeps a per-key set of sinks and fans out deltas on every set of
// that key. Every handler is total — a missing key is a null value, never
// a throw.

import { defineServicePlugin } from "@vibefield/plugin-sdk";

/** @typedef {import("@vibefield/plugin-sdk").SnapshotDeltaSink} SnapshotDeltaSink */

export default defineServicePlugin({
  activate(ctx) {
    /** @type {Map<string, string>} */
    const store = new Map();
    /** @type {Map<string, Set<SnapshotDeltaSink>>} */
    const watchers = new Map();

    /** @param {string} key */
    function notify(key) {
      const sinks = watchers.get(key);
      if (sinks === undefined) return;
      const value = store.get(key) ?? null;
      for (const sink of sinks) sink.delta({ value });
    }

    const disposable = ctx.services.provide({
      namespace: "x.vibefield.example.kv",
      methods: {
        get: {
          kind: "query",
          handle(params) {
            const { key } = /** @type {{ key: string }} */ (params);
            return { value: store.get(key) ?? null };
          },
        },
        set: {
          kind: "mutation",
          handle(params) {
            const { key, value } = /** @type {{ key: string, value: string }} */ (params);
            store.set(key, value);
            notify(key);
            return { ok: true };
          },
        },
        watch: {
          kind: "subscription",
          subscribe(params, _call, sink) {
            const { key } = /** @type {{ key: string }} */ (params);
            let sinks = watchers.get(key);
            if (sinks === undefined) {
              sinks = new Set();
              watchers.set(key, sinks);
            }
            sinks.add(sink);
            sink.snapshot({ value: store.get(key) ?? null });
            return {
              dispose() {
                const current = watchers.get(key);
                if (current === undefined) return;
                current.delete(sink);
                if (current.size === 0) watchers.delete(key);
              },
            };
          },
        },
      },
    });

    ctx.logger.info("kv service activated");
    return disposable;
  },
});
