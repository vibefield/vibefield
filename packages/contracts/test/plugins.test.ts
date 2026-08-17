import { describe, expect, it } from "vitest";
import {
  findUnknownManifestKeys,
  isDistributablePluginId,
  isSafeRelativePath,
  PluginManifestV1,
  validatePluginManifest,
} from "../src/plugins";

// The §7.1 invariants, exercised as mutations of one known-good manifest. The
// golden fixtures prove the happy paths; these prove the schema REFUSES what
// the spec forbids (a permissive manifest schema is a silent capability grant).

const base = () => ({
  manifestVersion: 1,
  id: "com.example.demo",
  version: "0.1.0",
  title: "Demo",
  engines: { app: "^0.1.0", contracts: "^0.1.0" },
  entries: { renderer: "./dist/renderer.js" },
  activation: ["onWidget:com.example.demo"],
  capabilities: ["doc.write"],
  contributes: {
    widgets: [
      {
        type: "com.example.demo",
        title: "Demo",
        schemaVersion: 1,
        surface: "dom",
        sizeMode: "fixed",
        defaultSize: { w: 100, h: 100 },
        props: { label: { kind: "string", maxLength: 40 } },
        groups: { label: ["label"] },
      },
    ],
  },
});

const behaviorBase = () => {
  const m = base();
  const id = "com.example.demo:counter";
  return {
    ...m,
    capabilities: [...m.capabilities, "canvas.write"],
    contributes: {
      ...m.contributes,
      widgets: [
        {
          ...m.contributes.widgets[0]!,
          behaviors: [{ id, data: { count: 3, mode: "row", meta: { title: "Root" } } }],
        },
      ],
      behaviors: [
        {
          id,
          reason: "advance the counter",
          definition: {
            store: "runtime",
            derived: false,
            deriveDuringGesture: false,
            version: 1,
            phase: "simulate",
            budgetMs: 2,
            tickWhile: "all",
            schema: [
              { name: "count", spec: { kind: "number", default: 0, min: 0, max: 10 } },
              {
                name: "mode",
                spec: { kind: "enum", options: ["row", "tree"], default: "tree" },
              },
              {
                name: "meta",
                spec: {
                  kind: "json",
                  inner: { kind: "object", fields: { title: { kind: "string" } } },
                  default: '{"title":"Ready"}',
                },
              },
            ],
            reads: [{ kind: "component", name: "Position" }],
            writes: [],
            migrationFrom: [],
            hooks: ["init", "tick", "dispose"],
          },
        },
      ],
    },
  };
};

const refuse = (mutate: (m: ReturnType<typeof base>) => unknown, pattern: RegExp) => {
  const m = mutate(base());
  const r = validatePluginManifest(m);
  expect(r.ok, "expected refusal").toBe(false);
  if (!r.ok) expect(r.issues.join("\n")).toMatch(pattern);
};

describe("PluginManifestV1 invariants (§7.1)", () => {
  it("accepts the base manifest", () => {
    const r = validatePluginManifest(base());
    expect(r.ok).toBe(true);
  });

  it("widgets/commands/surfaces/behaviors require entries.renderer", () => {
    refuse((m) => ({ ...m, entries: {} }), /require entries\.renderer/);
  });

  it("services require entries.service and the services.provide capability", () => {
    refuse(
      (m) => ({
        ...m,
        contributes: {
          services: [
            {
              namespace: "x.com.example.demo",
              methods: [
                {
                  name: "q",
                  kind: "query",
                  requiredCapability: "index.read",
                  idempotent: true,
                  locality: "local",
                  input: {},
                  output: {},
                },
              ],
            },
          ],
        },
        entries: {},
        activation: [],
      }),
      /require entries\.service|services\.provide/,
    );
  });

  it("host is invalid without entries.service", () => {
    refuse((m) => ({ ...m, host: "worker" }), /host is invalid/);
  });

  it("onStartup demands service entry + background + reason", () => {
    refuse((m) => ({ ...m, activation: ["onStartup"] }), /onStartup requires/);
  });

  it("activation events must name owned declarations", () => {
    refuse((m) => ({ ...m, activation: ["onWidget:com.example.other"] }), /names no owned/);
  });

  it("widget types stay in the plugin namespace", () => {
    refuse(
      (m) => ({
        ...m,
        activation: [],
        contributes: { widgets: [{ ...m.contributes.widgets[0]!, type: "com.other.demo" }] },
      }),
      /must be com\.example\.demo/,
    );
  });

  it("the keyboard claim is a declared, bounded field (S2 — the mind map's door)", () => {
    // Declared values parse AND survive typed (before S2 they rode .passthrough()).
    const m = base();
    m.contributes.widgets[0] = {
      ...m.contributes.widgets[0],
      interaction: { keyboard: "exclusive", keyboardEscape: "release" },
    } as (typeof m.contributes.widgets)[0];
    const r = validatePluginManifest(m);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const w = r.manifest.contributes?.widgets?.[0];
      expect(w?.interaction?.keyboard).toBe("exclusive");
      expect(w?.interaction?.keyboardEscape).toBe("release");
    }
    // A bogus value is REFUSED — the pre-S2 behavior (silent flow to the engine) is the bug.
    refuse((b) => {
      b.contributes.widgets[0] = {
        ...b.contributes.widgets[0],
        interaction: { keyboard: "bogus" },
      } as unknown as (typeof b.contributes.widgets)[0];
      return b;
    }, /keyboard/i);
  });

  it("groups are named, disjoint, and reference declared props; omitting them is legal", () => {
    const withGroups = (m: ReturnType<typeof base>, groups: Record<string, string[]>) => ({
      ...m,
      contributes: { widgets: [{ ...m.contributes.widgets[0]!, groups }] },
    });
    // ungrouped props auto-join the engine's "props" default group (engine truth)
    expect(validatePluginManifest(withGroups(base(), {})).ok).toBe(true);
    refuse((m) => withGroups(m, { a: ["label"], b: ["label"] }), /more than one group/);
    refuse((m) => withGroups(m, { a: ["ghost"] }), /undeclared prop ghost/);
    refuse((m) => withGroups(m, { Bad_Name: ["label"] }), /group name/);
  });

  it("custom capabilities live in the owner namespace", () => {
    refuse(
      (m) => ({
        ...m,
        contributes: {
          ...m.contributes,
          capabilities: [{ id: "x.com.other.cap", title: "t", description: "d", risk: "read" }],
        },
      }),
      /must be x\.com\.example\.demo/,
    );
  });

  it("mcp tools may only project declared methods", () => {
    refuse(
      (m) => ({
        ...m,
        capabilities: [...m.capabilities, "mcp.contribute"],
        entries: { renderer: "./dist/renderer.js", service: "./dist/service.js" },
        contributes: {
          ...m.contributes,
          mcp: {
            tools: [
              { name: "ghost", title: "t", description: "d", method: "x.com.example.demo.ghost" },
            ],
          },
        },
      }),
      /projects undeclared method/,
    );
  });

  it("refuses the superseded canvas-system contribution with a stable code", () => {
    const raw = {
      ...base(),
      contributes: {
        ...base().contributes,
        systems: [{ id: "com.example.demo.tick", phase: "tick", budgetMs: 1, reason: "test" }],
      },
    };
    const result = validatePluginManifest(raw);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issueDetails).toContainEqual({
      code: "systems-contribution-superseded",
      path: ["contributes", "systems"],
      message: "contributes.systems is superseded by contributes.behaviors",
    });
  });

  it("accepts and preserves the complete strict behavior descriptor and widget rider", () => {
    const result = validatePluginManifest(behaviorBase());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.contributes?.behaviors?.[0]?.definition.hooks).toEqual([
      "init",
      "tick",
      "dispose",
    ]);
    expect(result.manifest.contributes?.widgets?.[0]?.behaviors?.[0]?.data).toEqual({
      count: 3,
      mode: "row",
      meta: { title: "Root" },
    });
  });

  it("requires requested canvas.write and reports ephemeral admission at the exact store path", () => {
    const withoutWrite = structuredClone(behaviorBase());
    withoutWrite.capabilities = ["doc.write"];
    const denied = validatePluginManifest(withoutWrite);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.issues.join("\n")).toMatch(/canvas\.write/);

    const ephemeral = structuredClone(behaviorBase());
    ephemeral.contributes.behaviors[0]!.definition.store = "ephemeral";
    ephemeral.contributes.behaviors[0]!.definition.phase = "publish";
    const gated = validatePluginManifest(ephemeral);
    expect(gated.ok).toBe(false);
    if (gated.ok) return;
    expect(gated.issueDetails).toContainEqual({
      code: "behavior-store-unsupported",
      path: ["contributes", "behaviors", 0, "definition", "store"],
      message: "ephemeral plugin behaviors await a document-room presence transport",
    });
  });

  it("fails namespace, duplicate, strict-descriptor, and attachment mutations closed", () => {
    const mutations: Array<{
      mutate(value: ReturnType<typeof behaviorBase>): void;
      pattern: RegExp;
    }> = [
      {
        mutate: (value) => {
          value.contributes.behaviors[0]!.id = "com.other:counter";
        },
        pattern: /must be com\.example\.demo:<localName>/,
      },
      {
        mutate: (value) => {
          value.contributes.behaviors.push(structuredClone(value.contributes.behaviors[0]!));
        },
        pattern: /duplicate behavior id/,
      },
      {
        mutate: (value) => {
          Object.assign(value.contributes.behaviors[0]!.definition, { futureSemanticField: true });
        },
        pattern: /Unrecognized key/,
      },
      {
        mutate: (value) => {
          value.contributes.widgets[0]!.behaviors[0]!.id = "com.example.demo:missing";
        },
        pattern: /names no same-plugin behavior/,
      },
      {
        mutate: (value) => {
          value.contributes.widgets[0]!.behaviors[0]!.data.count = 99;
        },
        pattern: /does not match behavior schema/,
      },
      {
        mutate: (value) => {
          Object.assign(value.contributes.widgets[0]!.behaviors[0]!.data, { ghost: true });
        },
        pattern: /undeclared behavior data field/,
      },
    ];

    for (const { mutate, pattern } of mutations) {
      const raw = structuredClone(behaviorBase());
      mutate(raw);
      const result = validatePluginManifest(raw);
      expect(result.ok, pattern.source).toBe(false);
      if (!result.ok) expect(result.issues.join("\n")).toMatch(pattern);
    }
  });

  it("rejects behavior descriptors that no ICE handle can canonically describe", () => {
    const mutations: Array<{
      mutate(value: ReturnType<typeof behaviorBase>): void;
      pattern: RegExp;
    }> = [
      {
        mutate: (value) => {
          value.contributes.behaviors[0]!.definition.store = "durable";
        },
        pattern: /phase simulate is illegal for durable/,
      },
      {
        mutate: (value) => {
          value.contributes.behaviors[0]!.definition.derived = true;
        },
        pattern: /derived=true is durable-only/,
      },
      {
        mutate: (value) => {
          value.contributes.behaviors[0]!.definition.tickWhile = "visible";
          value.contributes.behaviors[0]!.definition.hooks = ["init", "dispose"];
        },
        pattern: /scoped tick policy requires a tick hook/,
      },
      {
        mutate: (value) => {
          value.contributes.behaviors[0]!.definition.schema.push(
            structuredClone(value.contributes.behaviors[0]!.definition.schema[0]!),
          );
        },
        pattern: /duplicate field/,
      },
      {
        mutate: (value) => {
          const count = value.contributes.behaviors[0]!.definition.schema[0]!.spec;
          if (count.kind === "number") count.min = 11;
        },
        pattern: /min must not exceed max|default is below min/,
      },
      {
        mutate: (value) => {
          const mode = value.contributes.behaviors[0]!.definition.schema[1]!.spec;
          if (mode.kind === "enum") mode.default = "missing";
        },
        pattern: /default must be an enum option/,
      },
      {
        mutate: (value) => {
          const meta = value.contributes.behaviors[0]!.definition.schema[2]!.spec;
          if (meta.kind === "json") meta.default = '{"title":3}';
        },
        pattern: /serialized default does not match inner JSON shape/,
      },
      {
        mutate: (value) => {
          value.contributes.behaviors[0]!.definition.store = "durable";
          value.contributes.behaviors[0]!.definition.phase = "derive";
          value.contributes.behaviors[0]!.definition.version = 4;
          (
            value.contributes.behaviors[0]!.definition as { migrationFrom: number[] }
          ).migrationFrom = [1, 3];
        },
        pattern: /migration chain must cover every version/,
      },
      {
        mutate: (value) => {
          value.contributes.behaviors[0]!.definition.hooks = ["tick", "init"];
        },
        pattern: /hooks must be unique and in ICE delivery order/,
      },
      {
        mutate: (value) => {
          delete (value.contributes.behaviors[0] as { reason?: string }).reason;
        },
        pattern: /tick behavior requires a non-empty reason/,
      },
      {
        mutate: (value) => {
          value.contributes.widgets[0]!.behaviors.push(
            structuredClone(value.contributes.widgets[0]!.behaviors[0]!),
          );
        },
        pattern: /duplicate attachment/,
      },
    ];

    for (const { mutate, pattern } of mutations) {
      const raw = structuredClone(behaviorBase());
      mutate(raw);
      const result = validatePluginManifest(raw);
      expect(result.ok, pattern.source).toBe(false);
      if (!result.ok) expect(result.issues.join("\n")).toMatch(pattern);
    }
  });

  it("rejects duplicate widget types and traversal paths", () => {
    refuse(
      (m) => ({
        ...m,
        contributes: { widgets: [m.contributes.widgets[0]!, m.contributes.widgets[0]!] },
      }),
      /duplicate widget types/,
    );
    refuse((m) => ({ ...m, icon: "./a/../b.svg" }), /-relative POSIX/);
  });

  it("preview gradients refuse url() smuggling", () => {
    refuse(
      (m) => ({
        ...m,
        contributes: {
          widgets: [
            {
              ...m.contributes.widgets[0]!,
              preview: { kind: "gradient", value: "linear-gradient(url(http://x))" },
            },
          ],
        },
      }),
      /no url/,
    );
  });

  it("tolerant reader: unknown fields survive a parse round-trip", () => {
    const raw = { ...base(), futureField: { keep: 1 } };
    const parsed = PluginManifestV1.parse(raw);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(raw);
  });
});

describe("helpers", () => {
  it("isDistributablePluginId: two segments minimum", () => {
    expect(isDistributablePluginId("com.example.notes")).toBe(true);
    expect(isDistributablePluginId("vibefield.note")).toBe(true);
    expect(isDistributablePluginId("note")).toBe(false);
    expect(isDistributablePluginId("Bad.Id")).toBe(false);
  });

  it("isSafeRelativePath rejects escapes", () => {
    expect(isSafeRelativePath("./dist/renderer.js")).toBe(true);
    expect(isSafeRelativePath("dist/renderer.js")).toBe(false);
    expect(isSafeRelativePath("./a/../b")).toBe(false);
    expect(isSafeRelativePath("./a\\b")).toBe(false);
    expect(isSafeRelativePath("./c:/x")).toBe(false);
  });

  it("findUnknownManifestKeys surfaces top and contributes levels", () => {
    expect(
      findUnknownManifestKeys({ ...base(), extra: 1, contributes: { widgets: [], typo: [] } }),
    ).toEqual(["extra", "contributes.typo"]);
    expect(findUnknownManifestKeys(base())).toEqual([]);
  });
});
