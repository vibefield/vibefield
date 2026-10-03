import { describe, expect, it } from "vitest";
import {
  declaresObjects,
  findUnknownManifestKeys,
  isDistributablePluginId,
  isSafeRelativePath,
  OBJECT_RETIRED_FIELDS,
  OBJECTS_NEED_DESK,
  PLUGIN_LIMITS,
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

  it("requires requested canvas.write and admits only bounded ephemeral descriptors", () => {
    const withoutWrite = structuredClone(behaviorBase());
    withoutWrite.capabilities = ["doc.write"];
    const denied = validatePluginManifest(withoutWrite);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.issues.join("\n")).toMatch(/canvas\.write/);

    const ephemeral = structuredClone(behaviorBase());
    ephemeral.contributes.behaviors[0]!.definition.store = "ephemeral";
    ephemeral.contributes.behaviors[0]!.definition.phase = "publish";
    ephemeral.contributes.widgets[0]!.behaviors = [];
    const unattested = validatePluginManifest(ephemeral);
    expect(unattested.ok).toBe(false);
    if (!unattested.ok) {
      expect(unattested.issues.join("\n")).toMatch(/maxFacetBytes.*must attest/);
    }

    Object.assign(ephemeral.contributes.behaviors[0]!.definition, { maxFacetBytes: 1_024 });
    expect(validatePluginManifest(ephemeral).ok).toBe(true);

    const wrongStore = structuredClone(behaviorBase());
    Object.assign(wrongStore.contributes.behaviors[0]!.definition, { maxFacetBytes: 1_024 });
    const wrongStoreResult = validatePluginManifest(wrongStore);
    expect(wrongStoreResult.ok).toBe(false);
    if (!wrongStoreResult.ok) {
      expect(wrongStoreResult.issues.join("\n")).toMatch(/maxFacetBytes is ephemeral-only/);
    }
  });

  it("charges a plugin's ephemeral declarations including measured per-facet envelopes", () => {
    const manifest = structuredClone(behaviorBase());
    manifest.contributes.widgets[0]!.behaviors = [];
    const first = manifest.contributes.behaviors[0]!;
    first.definition.store = "ephemeral";
    first.definition.phase = "publish";
    const second = structuredClone(first);
    second.id = "com.example.demo:counter-two";
    manifest.contributes.behaviors = [first, second];

    const exactClaim =
      PLUGIN_LIMITS.BEHAVIOR_EPHEMERAL_WINDOW_BYTES / 2 -
      PLUGIN_LIMITS.BEHAVIOR_EPHEMERAL_ENVELOPE_BYTES;
    Object.assign(first.definition, { maxFacetBytes: exactClaim });
    Object.assign(second.definition, { maxFacetBytes: exactClaim });
    expect(validatePluginManifest(manifest).ok).toBe(true);

    Object.assign(second.definition, { maxFacetBytes: exactClaim + 1 });
    const over = validatePluginManifest(manifest);
    expect(over.ok).toBe(false);
    if (over.ok) return;
    expect(over.issueDetails).toContainEqual({
      code: "behavior-presence-budget-exceeded",
      path: ["contributes", "behaviors"],
      message: `plugin ephemeral behavior charge is ${
        PLUGIN_LIMITS.BEHAVIOR_EPHEMERAL_WINDOW_BYTES + 1
      } bytes, over the ${PLUGIN_LIMITS.BEHAVIOR_EPHEMERAL_WINDOW_BYTES}-byte window`,
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

// DK-0f — the object door's CONTRACT, ahead of the desk: the schema accepts a
// kind's durable half plus its tray entry and its export name, refuses the
// widget's view fields BY NAME, holds one type to one contribution, and names
// the one refusal every host door gives on this build.
describe("the object contribution (DK-0f)", () => {
  const CLOCK = "com.example.demo.clock";
  const object = (over: Record<string, unknown> = {}) => ({
    type: CLOCK,
    title: "Clock",
    schemaVersion: 1,
    size: { w: 160, h: 160 },
    provides: [CLOCK, "desk.object", "desk.containable"],
    props: {
      style: { kind: "enum", options: ["classic", "ink"], default: "classic" },
      seconds: { kind: "boolean", default: true },
    },
    tray: { category: "things", label: "Clock", props: { style: "ink" }, take: "face" },
    binding: { kind: "clock" },
    ...over,
  });
  const withObjects = (objects: unknown[], over: Record<string, unknown> = {}) => ({
    ...base(),
    activation: [`onWidget:${CLOCK}`],
    contributes: { objects },
    ...over,
  });
  const refused = (m: unknown): string[] => {
    const r = validatePluginManifest(m);
    expect(r.ok).toBe(false);
    return r.ok ? [] : r.issues;
  };

  it("accepts a well-formed objects manifest — alone, and beside widgets on this build", () => {
    expect(validatePluginManifest(withObjects([object()])).ok).toBe(true);
    expect(findUnknownManifestKeys(withObjects([object()]))).toEqual([]);
    const both = {
      ...base(),
      activation: [...base().activation, `onWidget:${CLOCK}`],
      contributes: { ...base().contributes, objects: [object()] },
    };
    expect(validatePluginManifest(both).ok).toBe(true);
    // the tray entry is optional (placeable, hangs nowhere); hang/order/local ride it
    expect(validatePluginManifest(withObjects([object({ tray: undefined })])).ok).toBe(true);
    const hung = object({
      tray: {
        category: "things",
        label: "Clock",
        order: 2,
        local: true,
        hang: { w: 110, h: 110, accessory: "hook", pegs: [[0, -0.5]] },
      },
    });
    expect(validatePluginManifest(withObjects([hung])).ok).toBe(true);
  });

  it("refuses each retired widget field by name, saying where it went", () => {
    const retired: Record<string, unknown> = {
      surface: "dom",
      sizeMode: "fixed",
      preview: { kind: "color", value: "#FFFFFF" },
      category: "Cards",
      defaultSize: { w: 1, h: 1 },
      maxSize: { w: 1, h: 1 },
    };
    expect(Object.keys(retired).sort()).toEqual(Object.keys(OBJECT_RETIRED_FIELDS).sort());
    for (const [field, value] of Object.entries(retired)) {
      const issues = refused(withObjects([object({ [field]: value })]));
      expect(issues).toContain(`contributes.objects.0.${field}: ${OBJECT_RETIRED_FIELDS[field]}`);
    }
  });

  it("holds the durable half to the widget's laws: size, binding, props, groups, ports", () => {
    expect(refused(withObjects([object({ size: undefined })]))).toContainEqual(
      expect.stringContaining("contributes.objects.0.size"),
    );
    expect(refused(withObjects([object({ binding: undefined })]))).toContainEqual(
      expect.stringContaining("contributes.objects.0.binding"),
    );
    expect(
      refused(withObjects([object({ binding: { kind: "not an identifier" } })])),
    ).toContainEqual(expect.stringContaining("an export name: an identifier"));
    expect(refused(withObjects([object({ groups: { look: ["missing"] } })]))).toContain(
      "contributes.objects.0: group names undeclared prop missing",
    );
    expect(
      refused(
        withObjects([
          object({
            ports: [
              { id: "out", side: "e" },
              { id: "out", side: "w" },
            ],
          }),
        ]),
      ),
    ).toContain("contributes.objects.0: duplicate port ids: out");
  });

  it("one type, one contribution — a widget and an object never share a type", () => {
    const shared = {
      ...base(),
      contributes: { ...base().contributes, objects: [object({ type: "com.example.demo" })] },
    };
    expect(refused(shared)).toContain(
      "contributes.objects: type com.example.demo is declared as both a widget and an object — one type, one contribution",
    );
  });

  it("objects need a renderer entry, stay in the plugin's namespace, and are unique", () => {
    expect(refused(withObjects([object()], { entries: undefined }))).toContain(
      "entries: objects require entries.renderer",
    );
    expect(
      refused(withObjects([object({ type: "someone.else.clock" })], { activation: [] })),
    ).toContain(
      "contributes.objects: object type someone.else.clock must be com.example.demo or com.example.demo.<name>",
    );
    expect(refused(withObjects([object(), object()]))).toContain(
      `contributes: duplicate object types: ${CLOCK}`,
    );
  });

  it("an object type is an onWidget activation target — an object is a widget to the engine", () => {
    expect(validatePluginManifest(withObjects([object()])).ok).toBe(true);
    expect(
      refused(withObjects([object()], { activation: ["onWidget:com.example.demo.nothing"] })),
    ).toContain(
      "activation: activation event onWidget:com.example.demo.nothing names no owned declaration",
    );
  });

  it("the tray's face and take name declared props, each a value of its prop's kind", () => {
    const tray = (entry: Record<string, unknown>) =>
      refused(withObjects([object({ tray: { category: "things", label: "Clock", ...entry } })]));
    expect(tray({ props: { nope: 1 } })).toContain(
      "contributes.objects.0.tray.props.nope: tray props names undeclared prop nope",
    );
    expect(tray({ props: { style: "bogus" } })).toContain(
      "contributes.objects.0.tray.props.style: tray props value for style is not one of its options",
    );
    expect(tray({ take: { seconds: "yes" } })).toContain(
      "contributes.objects.0.tray.take.seconds: tray take value for seconds is not a boolean",
    );
    expect(tray({ hang: { w: 1, h: 1, accessory: "nail", pegs: [[0, 0]] } })).toContainEqual(
      expect.stringContaining("contributes.objects.0.tray.hang.accessory"),
    );
  });

  it("names the one refusal every host door gives on this build", () => {
    expect(OBJECTS_NEED_DESK).toEqual({
      code: "objects-need-desk",
      message: "object kinds need the desk; this build draws widgets",
    });
    expect(declaresObjects(withObjects([object()]).contributes)).toBe(true);
    expect(declaresObjects(base().contributes)).toBe(false);
    expect(declaresObjects({ objects: [] })).toBe(false);
    expect(declaresObjects(undefined)).toBe(false);
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
