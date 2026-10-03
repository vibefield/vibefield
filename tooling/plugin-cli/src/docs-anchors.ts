// The two pieces of the reference that are hand-curated, and the machinery that
// stops them from being merely asserted.
//
//  - THE CTX SURFACE. Which face is on `ctx`, and when. The rule lives in the
//    SDK's type declarations as prose, so the docs restate it — and every row
//    carries an `anchor`, a substring that MUST appear in
//    `packages/plugin-sdk/src/index.ts`. `test/docs-anchors.test.ts` proves each
//    one, so a present-iff rule that changes in the SDK reds the kit's suite
//    instead of quietly leaving the docs wrong.
//  - THE CROSS-FIELD INVARIANTS. `PluginManifestV1`'s superRefine holds two
//    dozen rules whose messages exist only inside the function. So the docs do
//    not quote them from memory: each row here is a deliberately-broken manifest
//    that is RUN through the schema at generation time, and the message printed
//    is whatever the schema actually said. A probe that stops failing fails
//    generation — the rule it documented is gone, and the docs must move with it.

import { PluginManifestV1 } from "@vibefield/contracts";

export interface CtxFaceRow {
  readonly face: string;
  readonly type: string;
  readonly presence: string;
  /** must appear verbatim in packages/plugin-sdk/src/index.ts */
  readonly anchor: string;
}

export const RENDERER_CTX_FACES: readonly CtxFaceRow[] = [
  {
    face: "ctx.plugin",
    type: "{ id, version, manifestHash?, installRevision? }",
    presence:
      "always; `manifestHash`/`installRevision` are present iff a staged loader supplied them (the dev bundled path has neither)",
    anchor: "Present iff a staged loader supplied them",
  },
  {
    face: "ctx.signal",
    type: "AbortSignal",
    presence: "always; aborts on deactivation, and every API rejects use after it fires",
    anchor: "APIs reject use after `signal` aborts",
  },
  {
    face: "ctx.logger",
    type: "PluginLogger (debug/info/warn/error)",
    presence: "always; the host stamps provenance — never log secrets",
    anchor: "structured, provenance-stamped by the host; never log secrets",
  },
  {
    face: "ctx.widgets",
    type: "RendererWidgetAPI",
    presence:
      "always (the legacy door — it retires at DK-8); `register` binds no face on the desk build, and throws on an undeclared type and on a double-bind",
    anchor: "Acknowledge a declared widget type (§12.1: throws on undeclared types and",
  },
  {
    face: "ctx.client",
    type: "PluginProductClient (request/subscribe)",
    presence: "always; calls arrive at fieldd as THIS plugin, with its granted scopes",
    anchor: "attributed to THIS plugin with its granted scopes",
  },
  {
    face: "ctx.commands",
    type: "RendererCommandAPI",
    presence: "present iff the manifest DECLARES `contributes.commands`",
    anchor: "present iff the manifest DECLARES contributes.commands",
  },
  {
    face: "ctx.surfaces",
    type: "RendererSurfaceAPI",
    presence: "present iff the manifest DECLARES `contributes.surfaces`",
    anchor: "present iff the manifest DECLARES contributes.surfaces",
  },
  {
    face: "ctx.canvas",
    type: "PluginCanvasAPI (`engine()`, `behaviors.bind()`)",
    presence:
      "present iff canvas access is requested or the manifest declares a behavior; denied behavior bindings seal identity but remain dormant",
    anchor: "Present iff the manifest requests canvas.read/write OR declares a behavior",
  },
  {
    face: "ctx.settings",
    type: "PluginSettingsAPI",
    presence: "present iff the manifest requests `storage.self` — absent, not stubbed",
    anchor: "present iff the manifest requests storage.self",
  },
  {
    face: "ctx.storage",
    type: "PluginStorageAPI (`kv` only)",
    presence:
      "present iff the manifest requests `storage.self`; files ride a ticketed lane and are deliberately absent",
    anchor: "the KV half. Files are deliberately ABSENT this slice",
  },
  {
    face: "ctx.track",
    type: "(resource) or (label, resource) => resource",
    presence: "always; exact handles are deduplicated and disposed when the activation ends",
    anchor: "track<T extends Disposable>(resource: T): T",
  },
  {
    face: "ctx.effect",
    type: "(label, acquire(childContext)) => Promise<result>",
    presence: "always; partial child acquisitions roll back without closing the outer activation",
    anchor: "acquire: (fx: RendererPluginContext) => T | Promise<T>",
  },
];

export const SERVICE_CTX_FACES: readonly CtxFaceRow[] = [
  {
    face: "ctx.services",
    type: "PluginServiceProviderAPI (`provide`)",
    presence:
      "always in a service entry; registration is accepted only on an exact declaration match",
    anchor: "registration is accepted only when every implemented method has an",
  },
  {
    face: "ctx.process",
    type: "PluginProcessAPI",
    presence: "present iff `process.spawn` is granted",
    anchor: "present iff process.spawn is granted",
  },
  {
    face: "ctx.endpoints",
    type: "PluginEndpointAPI",
    presence: "present iff `services.provide` is granted",
    anchor: "present iff services.provide is granted",
  },
  {
    face: "ctx.track",
    type: "(resource) or (label, resource) => resource",
    presence: "always; exact handles are deduplicated and disposed when the activation ends",
    anchor: "track<T extends Disposable>(label: string, resource: T): T",
  },
  {
    face: "ctx.effect",
    type: "(label, acquire(childContext)) => Promise<result>",
    presence: "always; partial child acquisitions roll back without closing the outer activation",
    anchor: "acquire: (fx: ServicePluginContext) => T | Promise<T>",
  },
];

// --- cross-field invariants ----------------------------------------------------

interface ProbeManifest {
  [key: string]: unknown;
}

function base(): ProbeManifest {
  return {
    manifestVersion: 1,
    id: "com.example.demo",
    version: "0.1.0",
    title: "Demo",
    engines: { app: "^0.1.0", contracts: "^0.1.0" },
    entries: { renderer: "./dist/renderer.js" },
    activation: [],
    capabilities: [],
    contributes: {},
  };
}

function widget(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "com.example.demo.card",
    title: "Card",
    schemaVersion: 1,
    surface: "dom",
    sizeMode: "fixed",
    defaultSize: { w: 200, h: 120 },
    ...overrides,
  };
}

/** DK-0f — the object door's probes mutate this minimal kind. */
function object(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "com.example.demo.clock",
    title: "Clock",
    schemaVersion: 1,
    size: { w: 160, h: 160 },
    props: { style: { kind: "enum", options: ["classic", "ink"], default: "classic" } },
    binding: { kind: "clock" },
    ...overrides,
  };
}

function behavior(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "com.example.demo:counter",
    definition: {
      store: "runtime",
      derived: false,
      deriveDuringGesture: false,
      version: 1,
      phase: "simulate",
      tickWhile: "all",
      schema: [],
      reads: [],
      writes: [],
      migrationFrom: [],
      hooks: [],
    },
    ...overrides,
  };
}

export interface InvariantProbe {
  /** the rule, in the docs' own words — the message comes from the schema */
  readonly topic: string;
  readonly manifest: ProbeManifest;
}

/** Each probe breaks exactly one rule. The docs print the schema's message. */
export const INVARIANT_PROBES: readonly InvariantProbe[] = [
  {
    topic: "a contribution that renders needs a renderer entry",
    manifest: { ...base(), entries: undefined, contributes: { widgets: [widget()] } },
  },
  {
    topic: "dynamic services and contributed MCP tools need a service entry",
    manifest: {
      ...base(),
      capabilities: ["services.provide"],
      contributes: {
        services: [
          {
            namespace: "x.com.example.demo",
            methods: [
              {
                kind: "query",
                name: "read",
                requiredCapability: "storage.self",
                idempotent: true,
                locality: "local",
                input: {},
                output: {},
              },
            ],
          },
        ],
      },
    },
  },
  {
    topic: "declaring dynamic services requires the services.provide capability",
    manifest: {
      ...base(),
      entries: { renderer: "./dist/renderer.js", service: "./dist/service.js" },
      contributes: {
        services: [
          {
            namespace: "x.com.example.demo",
            methods: [
              {
                kind: "query",
                name: "read",
                requiredCapability: "storage.self",
                idempotent: true,
                locality: "local",
                input: {},
                output: {},
              },
            ],
          },
        ],
      },
    },
  },
  {
    topic: "settings access from code requires storage.self",
    manifest: {
      ...base(),
      contributes: {
        settings: {
          properties: { theme: { title: "Theme", scope: "user", schema: { type: "string" } } },
        },
      },
    },
  },
  {
    topic: "canvas behaviors require canvas.write",
    manifest: {
      ...base(),
      contributes: {
        behaviors: [behavior()],
      },
    },
  },
  {
    topic: "onStartup is a background power, and pays the honesty tax",
    manifest: { ...base(), activation: ["onStartup"] },
  },
  {
    topic: "every contributed name is owned by the plugin's id",
    manifest: { ...base(), contributes: { widgets: [widget({ type: "someone.else.card" })] } },
  },
  {
    topic: "ids are unique within their collection",
    manifest: { ...base(), contributes: { widgets: [widget(), widget()] } },
  },
  {
    topic: "conflict groups name declared props, and each prop joins at most one",
    manifest: {
      ...base(),
      contributes: {
        widgets: [widget({ props: { text: { kind: "string" } }, groups: { body: ["missing"] } })],
      },
    },
  },
  {
    topic: "an immutable prop belongs to no conflict group",
    manifest: {
      ...base(),
      contributes: {
        widgets: [
          widget({
            props: { text: { kind: "string", mutable: false } },
            groups: { body: ["text"] },
          }),
        ],
      },
    },
  },
  {
    topic: "a prop default must satisfy its own prop spec",
    manifest: {
      ...base(),
      contributes: {
        widgets: [widget({ props: { mode: { kind: "enum", options: ["a", "b"], default: "c" } } })],
      },
    },
  },
  {
    topic: "a service namespace is x.<pluginId>",
    manifest: {
      ...base(),
      entries: { renderer: "./dist/renderer.js", service: "./dist/service.js" },
      capabilities: ["services.provide"],
      contributes: {
        services: [
          {
            namespace: "x.com.example.other",
            methods: [
              {
                kind: "query",
                name: "read",
                requiredCapability: "storage.self",
                idempotent: true,
                locality: "local",
                input: {},
                output: {},
              },
            ],
          },
        ],
      },
    },
  },
  {
    topic: "an activation event names something the plugin declares",
    manifest: { ...base(), activation: ["onWidget:com.example.demo.nothing"] },
  },
  // --- the object door (DK-0f) ---
  {
    topic: "an object kind renders too, so it needs the renderer entry",
    manifest: { ...base(), entries: undefined, contributes: { objects: [object()] } },
  },
  {
    topic: "a widget's view fields are retired on an object, each refused by name",
    manifest: { ...base(), contributes: { objects: [object({ surface: "dom" })] } },
  },
  {
    topic: "one type, one contribution — never both a widget and an object",
    manifest: {
      ...base(),
      contributes: {
        widgets: [widget({ type: "com.example.demo.clock" })],
        objects: [object()],
      },
    },
  },
  {
    topic: "a tray entry's face names declared props, each a value of its prop's kind",
    manifest: {
      ...base(),
      contributes: {
        objects: [
          object({
            tray: {
              category: "things",
              label: "Clock",
              props: { style: "bogus" },
              hang: { w: 110, h: 110, accessory: "hook", pegs: [[0, -0.5]] },
            },
          }),
        ],
      },
    },
  },
];

export interface InvariantRow {
  readonly topic: string;
  readonly pointer: string;
  readonly message: string;
}

/**
 * Run every probe and quote what the schema said. Throws when a probe stops
 * producing a custom issue: the documented rule no longer exists, and printing
 * it anyway would be the drift these docs are pinned against.
 */
export function invariantRows(): InvariantRow[] {
  const rows: InvariantRow[] = [];
  for (const probe of INVARIANT_PROBES) {
    const result = PluginManifestV1.safeParse(probe.manifest);
    if (result.success)
      throw new Error(
        `invariant probe "${probe.topic}" no longer fails — the rule it documents is gone`,
      );
    const custom = result.error.issues.filter((i) => i.code === "custom");
    if (custom.length === 0)
      throw new Error(
        `invariant probe "${probe.topic}" failed on shape, not on the invariant: ${result.error.issues.map((i) => i.message).join(" · ")}`,
      );
    for (const issue of custom)
      rows.push({
        topic: probe.topic,
        pointer: issue.path.length === 0 ? "<root>" : issue.path.join("."),
        message: issue.message,
      });
  }
  return rows;
}
