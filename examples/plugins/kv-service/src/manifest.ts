import type { PluginManifestV1 } from "@vibefield/contracts";

// vibefield.example.kv — the FIRST service plugin (plugin spec §14, P4
// slice): an in-memory key-value store that proves the dynamic-service
// fabric end to end. No renderer entry, no widgets — entries.service only.
// onStartup keeps the store (and its watch subscriptions) alive independent
// of any widget or command trigger, which is why activation, the
// "background" capability, and backgroundReason are all required together
// (§7.1's onStartup invariant).

const KV_VALUE_SCHEMA = {
  type: "object",
  properties: { value: { type: ["string", "null"] } },
  required: ["value"],
  additionalProperties: false,
} as const;

export const kvManifest: PluginManifestV1 = {
  manifestVersion: 1,
  id: "vibefield.example.kv",
  version: "0.1.0",
  title: "KV (example service)",
  engines: { app: ">=0.0.0", contracts: "^0.1.0" },
  entries: { service: "./service.js" },
  activation: ["onStartup"],
  backgroundReason:
    "Keeps the in-memory store and its active watch subscriptions alive so get/set/watch answer at any time, not only while some other trigger is active.",
  capabilities: ["services.provide", "background"],
  contributes: {
    capabilities: [
      {
        id: "x.vibefield.example.kv.use",
        title: "Use the example KV store",
        description: "Read and write keys in this plugin's in-memory key-value store.",
        risk: "write", // gates both get and the mutating set/watch methods
      },
    ],
    services: [
      {
        namespace: "x.vibefield.example.kv",
        methods: [
          {
            name: "get",
            kind: "query",
            idempotent: true,
            locality: "local",
            requiredCapability: "x.vibefield.example.kv.use",
            input: {
              type: "object",
              properties: { key: { type: "string" } },
              required: ["key"],
              additionalProperties: false,
            },
            output: KV_VALUE_SCHEMA,
          },
          {
            name: "set",
            kind: "mutation",
            idempotent: false,
            locality: "local",
            requiredCapability: "x.vibefield.example.kv.use",
            input: {
              type: "object",
              properties: { key: { type: "string" }, value: { type: "string" } },
              required: ["key", "value"],
              additionalProperties: false,
            },
            output: {
              type: "object",
              properties: { ok: { type: "boolean" } },
              required: ["ok"],
              additionalProperties: false,
            },
          },
          {
            name: "watch",
            kind: "subscription",
            idempotent: true,
            locality: "local",
            requiredCapability: "x.vibefield.example.kv.use",
            input: {
              type: "object",
              properties: { key: { type: "string" } },
              required: ["key"],
              additionalProperties: false,
            },
            snapshot: KV_VALUE_SCHEMA,
            delta: KV_VALUE_SCHEMA,
          },
        ],
      },
    ],
  },
};
