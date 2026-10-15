import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BundledPluginIndex,
  GrantDecision,
  InstallSetEntry,
  SETTINGS_DOC_SECTIONS,
  standingDecision,
} from "../src/plugin-distribution";

// DS-5b (PA-32) — the install-set's revocation stamps. The shape stays
// adoptable (every stamp optional: an entry written before them still parses),
// and one predicate says which decision stands once desktops have merged:
// revocation wins regardless of last-writer-wins timing.

const ID = "vibefield.example.kv";

describe("the install-set entry (§16.6) — the PA-32 stamps", () => {
  it("an entry written before the stamps still parses (adoption)", () => {
    const legacy = {
      pluginId: ID,
      source: "registry",
      version: "0.1.0",
      enabled: true,
      grants: [
        { capability: "storage.self", decision: "revoked", at: 1 },
        { capability: "services.provide", decision: "granted", at: 2 },
      ],
    };
    const parsed = InstallSetEntry.parse(legacy);
    expect(parsed.revocationGenerations).toBeUndefined();
    expect(parsed.grants[0]?.revocationGeneration).toBeUndefined();
  });

  it("a stamped entry parses and keeps its stamps", () => {
    const parsed = InstallSetEntry.parse({
      pluginId: ID,
      source: "bundled",
      enabled: true,
      grants: [{ capability: "storage.self", decision: "granted", at: 3, revocationGeneration: 2 }],
      revocationGenerations: { "storage.self": 2 },
    });
    expect(parsed.grants[0]?.revocationGeneration).toBe(2);
    expect(parsed.revocationGenerations).toEqual({ "storage.self": 2 });
  });

  it("a stamp is a count: negative and fractional stamps are refused", () => {
    const decision = { capability: "storage.self", decision: "granted", at: 1 };
    expect(GrantDecision.safeParse({ ...decision, revocationGeneration: -1 }).success).toBe(false);
    expect(GrantDecision.safeParse({ ...decision, revocationGeneration: 1.5 }).success).toBe(false);
    const entry = { pluginId: ID, source: "bundled", enabled: true, grants: [] };
    expect(
      InstallSetEntry.safeParse({ ...entry, revocationGenerations: { "storage.self": -1 } })
        .success,
    ).toBe(false);
  });

  it("names one root section per field, apart from P7's whole-entry section", () => {
    const sections = [
      SETTINGS_DOC_SECTIONS.INSTALL_SET,
      SETTINGS_DOC_SECTIONS.INSTALL_SET_PLUGINS,
      SETTINGS_DOC_SECTIONS.INSTALL_SET_ENABLED,
      SETTINGS_DOC_SECTIONS.INSTALL_SET_GRANTS,
      SETTINGS_DOC_SECTIONS.INSTALL_SET_REVOCATIONS,
    ];
    expect(new Set(sections).size).toBe(sections.length);
    // Loro refuses a root container name holding "/" or NUL.
    for (const name of sections) {
      expect(name.includes("/") || name.includes("\u0000"), name).toBe(false);
    }
  });
});

describe("standingDecision — which decision stands after a merge (PA-32)", () => {
  const entry = (generation?: number) =>
    generation === undefined ? {} : { revocationGenerations: { "storage.self": generation } };
  const granted = (saw?: number) => ({
    capability: "storage.self",
    decision: "granted" as const,
    ...(saw === undefined ? {} : { revocationGeneration: saw }),
  });

  it("a revocation stands, whatever it names", () => {
    expect(
      standingDecision(entry(3), {
        capability: "storage.self",
        decision: "revoked",
        revocationGeneration: 1,
      }),
    ).toEqual({ granted: false, reason: "decision" });
  });

  it("a grant that saw every revocation stands", () => {
    expect(standingDecision(entry(2), granted(2))).toEqual({ granted: true, reason: "decision" });
  });

  it("a grant that missed a revocation is applied as revoked — the bias", () => {
    expect(standingDecision(entry(2), granted(1))).toEqual({
      granted: false,
      reason: "revocation-bias",
    });
  });

  it("a grant naming a generation the entry never reached is refused, not trusted", () => {
    expect(standingDecision(entry(1), granted(4))).toEqual({
      granted: false,
      reason: "stamp-ahead",
    });
  });

  it("before the stamps: an unstamped grant stands until the first recorded revocation", () => {
    expect(standingDecision(entry(), granted())).toEqual({ granted: true, reason: "decision" });
    expect(standingDecision(entry(1), granted())).toEqual({
      granted: false,
      reason: "revocation-bias",
    });
  });
});

// WP8a (build-wp8-bundled-plugins.md §3): the bundled index's refusals, made inline from its fixture.
describe("the bundled plugin index (WP8a)", () => {
  const fixture = () =>
    JSON.parse(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          "..",
          "fixtures",
          "bundled-plugin-index.valid.json",
        ),
        "utf8",
      ),
    );
  const pad = (index: ReturnType<typeof fixture>) => index.plugins["vibefield.comment-pad"];

  it("refuses another schemaVersion and a platform that is neither any nor <platform>-<arch>", () => {
    expect(BundledPluginIndex.safeParse({ ...fixture(), schemaVersion: 2 }).success).toBe(false);
    expect(BundledPluginIndex.safeParse({ ...fixture(), platform: "macos" }).success).toBe(false);
    expect(BundledPluginIndex.safeParse({ ...fixture(), platform: "darwin-arm64" }).success).toBe(
      true,
    );
  });

  it("refuses a staged path that climbs, starts at the root, or hides an empty or dot segment", () => {
    for (const path of [
      "../renderer.js",
      "/etc/passwd",
      "dist//renderer.js",
      "dist/./renderer.js",
      "dist\\x.js",
    ]) {
      const index = fixture();
      pad(index).files[path] = `sha256:${"a".repeat(64)}`;
      expect(BundledPluginIndex.safeParse(index).success, path).toBe(false);
    }
  });

  it("refuses an entry whose files leave out its manifest, or that is listed under another id", () => {
    const noManifest = fixture();
    delete pad(noManifest).files["vibefield.plugin.json"];
    expect(BundledPluginIndex.safeParse(noManifest).success).toBe(false);
    const misfiled = fixture();
    misfiled.plugins["vibefield.other"] = pad(misfiled);
    expect(BundledPluginIndex.safeParse(misfiled).success).toBe(false);
  });

  it("refuses a hash that is not a sha256 pin", () => {
    const index = fixture();
    pad(index).artifactSha256 = "sha256:abc";
    expect(BundledPluginIndex.safeParse(index).success).toBe(false);
  });
});
