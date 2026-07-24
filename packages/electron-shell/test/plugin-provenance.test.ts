import type { PluginRecord } from "@vibefield/contracts";
import { describe, expect, it, vi } from "vitest";
import { RendererPluginProvenanceCatalog } from "../src/main/plugin-provenance";

function record(overrides: Partial<PluginRecord> = {}): PluginRecord {
  return {
    id: "vibefield.example.plugin",
    version: "1.2.3",
    title: "Example",
    source: "bundled",
    manifestHash: `sha256:${"a".repeat(64)}`,
    installRevision: "revision-1",
    state: "enabled",
    compatible: true,
    enabled: true,
    requestedCapabilities: [],
    grantedCapabilities: [],
    deniedCapabilities: [],
    grantGeneration: 0,
    contributions: { widgets: [], commands: [], surfaces: [], capabilities: [] },
    renderer: "active",
    service: "none",
    ...overrides,
  };
}

describe("renderer plugin provenance catalog", () => {
  it("holds hints until a snapshot, then stamps the active install tuple", () => {
    const catalog = new RendererPluginProvenanceCatalog();
    const changed = vi.fn();
    catalog.onChange(changed);

    expect(catalog.resolve("vibefield.example.plugin", "window-7")).toEqual({
      kind: "pending",
    });
    expect(
      catalog.update({
        generation: 1,
        plugins: [record()],
        problems: [],
      }),
    ).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(catalog.resolve("vibefield.example.plugin", "window-7")).toEqual({
      kind: "resolved",
      provenance: {
        id: "vibefield.example.plugin",
        version: "1.2.3",
        installRevision: "revision-1",
        entry: "renderer",
        windowId: "window-7",
        installSource: "bundled",
        trust: "r0-bundled",
      },
    });
  });

  it("rejects absent, disabled, entry-less, and malformed registry state", () => {
    const catalog = new RendererPluginProvenanceCatalog();
    expect(catalog.update({ malformed: true })).toBe(false);
    expect(catalog.resolve("vibefield.example.plugin", "7").kind).toBe("rejected");

    catalog.update({
      generation: 1,
      plugins: [
        record({ id: "vibefield.example.disabled", enabled: false, state: "disabled" }),
        record({ id: "vibefield.example.service", renderer: "none", service: "active" }),
      ],
      problems: [],
    });
    expect(catalog.resolve("vibefield.example.plugin", "7").kind).toBe("rejected");
    expect(catalog.resolve("vibefield.example.disabled", "7").kind).toBe("rejected");
    expect(catalog.resolve("vibefield.example.service", "7").kind).toBe("rejected");
  });

  it("fails closed instead of retaining stale provenance after a malformed update", () => {
    const catalog = new RendererPluginProvenanceCatalog();
    const changed = vi.fn();
    catalog.onChange(changed);
    catalog.update({ generation: 1, plugins: [record()], problems: [] });
    expect(catalog.resolve("vibefield.example.plugin", "7").kind).toBe("resolved");

    expect(catalog.update({ generation: 2, malformed: true })).toBe(false);
    expect(catalog.resolve("vibefield.example.plugin", "7").kind).toBe("rejected");
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("drops stale installs while fieldd is unavailable and waits for a fresh snapshot", () => {
    const catalog = new RendererPluginProvenanceCatalog();
    catalog.update({ generation: 1, plugins: [record()], problems: [] });
    expect(catalog.resolve("vibefield.example.plugin", "7").kind).toBe("resolved");

    catalog.invalidate();
    expect(catalog.resolve("vibefield.example.plugin", "7").kind).toBe("pending");
    catalog.update({ generation: 2, plugins: [], problems: [] });
    expect(catalog.resolve("vibefield.example.plugin", "7").kind).toBe("rejected");
  });

  it("maps dev-linked installs to explicit development trust", () => {
    const catalog = new RendererPluginProvenanceCatalog();
    catalog.update({
      generation: 1,
      plugins: [record({ source: "dev-linked" })],
      problems: [],
    });
    expect(catalog.resolve("vibefield.example.plugin", "7")).toMatchObject({
      kind: "resolved",
      provenance: { installSource: "dev-link", trust: "r3-dev" },
    });
  });

  it("does not overwrite a same-frame live update with the subscribe reply snapshot", async () => {
    const catalog = new RendererPluginProvenanceCatalog();
    const unsubscribe = vi.fn();
    const stop = await catalog.observe({
      async subscribe(_method, _params, onEvent) {
        onEvent(
          {
            generation: 2,
            plugins: [record({ installRevision: "newer-revision" })],
            problems: [],
          },
          "delta",
        );
        return {
          snapshot: {
            generation: 1,
            plugins: [record({ installRevision: "older-revision" })],
            problems: [],
          },
          unsubscribe,
        };
      },
    });

    expect(catalog.resolve("vibefield.example.plugin", "7")).toMatchObject({
      kind: "resolved",
      provenance: { installRevision: "newer-revision" },
    });
    stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
