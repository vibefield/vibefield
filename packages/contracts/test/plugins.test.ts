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

  it("widgets/commands/surfaces/systems require entries.renderer", () => {
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

  it("canvas systems require canvas.read", () => {
    refuse(
      (m) => ({
        ...m,
        contributes: {
          ...m.contributes,
          systems: [{ id: "com.example.demo.tick", phase: "tick", budgetMs: 1, reason: "test" }],
        },
      }),
      /canvas\.read/,
    );
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
