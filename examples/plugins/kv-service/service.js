// @vibefield/plugin-example-kv — the service entry the manifest's
// entries.service names. Plain JS ESM at the package root: dist/ is
// gitignored, so this file IS the artifact, not a build output. Imports
// ONLY @vibefield/plugin-sdk (wall R10). An in-memory Map backs get/set;
// watch keeps a per-key set of sinks and fans out deltas on every set of
// that key. Every handler is total — a missing key is a null value, never
// a throw. With storage.self granted, the map persists through plugin KV
// (loaded at activate, written through on set) — the P5 dogfood.

import { defineServicePlugin } from "@vibefield/plugin-sdk";

/** @typedef {import("@vibefield/plugin-sdk").SnapshotDeltaSink} SnapshotDeltaSink */

export default defineServicePlugin({
  async activate(ctx) {
    /** @type {Map<string, string>} */
    const store = new Map();
    // P5 dogfood — ctx.storage is present iff the manifest requests
    // storage.self: the store survives worker restarts via plugin KV.
    if (ctx.storage !== undefined) {
      const persisted = await ctx.storage.kv.get("entries");
      if (persisted !== null && typeof persisted === "object")
        for (const [k, v] of Object.entries(persisted)) if (typeof v === "string") store.set(k, v);
    }
    const persist = () => {
      void ctx.storage?.kv
        .set("entries", Object.fromEntries(store))
        .catch((e) => ctx.logger.warn(`persist failed: ${e instanceof Error ? e.message : e}`));
    };
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
            persist();
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
