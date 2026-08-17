// PluginRegistryService (plugin spec §9, slice P2): discovery → validation →
// install records → sanitized snapshot, driven entirely off a fixture tree of
// vibefield.plugin.json roots (no daemon, no mgmt channel — the service reads
// the filesystem directly). Covers happy discovery + default-enable, the
// problem/row split for unparseable/oversize/schema-invalid/incompatible
// manifests, duplicate-id precedence (bundled shadow protection included),
// enable/disable intent with NOT_FOUND, records persistence across a
// reconstruct, reload of a newly appearing dir, the real shipped-plugins
// canary, and the sanitized-snapshot law (no path ever leaks).
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLUGIN_LIMITS, PluginRegistrySnapshot } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { RpcCallError } from "../src/native-link";
import { type PluginRegistryConfig, PluginRegistryService } from "../src/plugin-registry";

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures", "plugin-roots");
/** The real shipped plugins (…/vibe-field/plugins) — repo root is three up. */
const REPO_PLUGINS = join(HERE, "..", "..", "..", "plugins");

/** A committed fixture scenario dir; its CHILDREN are the plugin dirs. */
const scenario = (name: string): string => join(FIXTURES, name);

/** The oversize scenario is GENERATED (a ~256 KiB blob has no business being
 * committed): a schema-plausible manifest padded past MANIFEST_MAX_BYTES so
 * the service must refuse pre-parse on the stat size alone. */
function oversizeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "plugreg-oversize-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, "oversize-manifest");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "vibefield.plugin.json"),
    JSON.stringify({
      ...validManifest("vibefield.fixture.oversize"),
      _pad: "x".repeat(PLUGIN_LIMITS.MANIFEST_MAX_BYTES),
    }),
  );
  return root;
}

function makeDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "plugreg-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function newService(
  roots: PluginRegistryConfig["roots"],
  dataDir = makeDataDir(),
): PluginRegistryService {
  const svc = new PluginRegistryService({ dataDir, roots });
  cleanup.push(() => svc.dispose());
  return svc;
}

/** A minimal VALID manifest object (one owned widget + renderer entry), used to
 * seed writable dev-linked roots at test time (reload discovery). */
function validManifest(id: string): Record<string, unknown> {
  const widgetType = `${id}.card`;
  return {
    manifestVersion: 1,
    id,
    version: "0.1.0",
    title: id,
    engines: { app: ">=0.0.0", contracts: "^0.1.0" },
    entries: { renderer: "./renderer.js" },
    activation: [`onWidget:${widgetType}`],
    capabilities: [],
    contributes: {
      widgets: [
        {
          type: widgetType,
          title: "Card",
          schemaVersion: 1,
          surface: "dom",
          sizeMode: "fixed",
          defaultSize: { w: 200, h: 120 },
        },
      ],
    },
  };
}

/** Materialize <root>/<dir>/vibefield.plugin.json (+ renderer stub) at runtime. */
function writePluginDir(root: string, dir: string, manifest: Record<string, unknown>): void {
  const pdir = join(root, dir);
  mkdirSync(pdir, { recursive: true });
  writeFileSync(join(pdir, "vibefield.plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(pdir, "renderer.js"), "export {};\n");
}

/** Await a promise expected to reject; returns the thrown value. */
async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected the promise to reject");
}

describe("PluginRegistryService — discovery", () => {
  it("registers two bundled plugins as default-enabled rows (§9.2)", async () => {
    const svc = newService({ bundled: [scenario("ok")], devLinked: [] });
    await svc.refresh();

    const snap = svc.snapshot();
    expect(PluginRegistrySnapshot.safeParse(snap).success).toBe(true); // conforms to the wire contract
    expect(snap.generation).toBeGreaterThanOrEqual(1);
    expect(snap.problems).toEqual([]);
    // snapshot() sorts rows by id
    expect(snap.plugins.map((p) => p.id)).toEqual([
      "vibefield.fixture.alpha",
      "vibefield.fixture.beta",
    ]);

    for (const p of snap.plugins) {
      expect(p.source).toBe("bundled");
      expect(p.state).toBe("enabled");
      expect(p.enabled).toBe(true);
      expect(p.compatible).toBe(true);
      expect(p.manifestHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(p.installRevision).toMatch(/^[0-9a-f]{12}$/);
      // renderer declared ⇒ "inactive"; no service entry ⇒ "none" (both branches)
      expect(p.renderer).toBe("inactive");
      expect(p.service).toBe("none");
      expect(p.requestedCapabilities).toEqual([]);
      expect(p.grantedCapabilities).toEqual([]);
    }

    const alpha = svc.get("vibefield.fixture.alpha");
    expect(alpha?.contributions.widgets).toHaveLength(1);
    expect(alpha?.contributions.widgets[0]?.type).toBe("vibefield.fixture.alpha.card");
    expect(alpha?.contributions.commands).toEqual([]);
    expect(alpha?.contributions.surfaces).toEqual([]);

    expect(svc.health()).toEqual({ count: 2, enabled: 2, invalid: 0 });
  });

  it("projects behavior declarations and widget riders together without executing code", async () => {
    const root = mkdtempSync(join(tmpdir(), "plugreg-behavior-"));
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const id = "vibefield.fixture.behavior";
    const behaviorId = `${id}:counter`;
    const manifest = {
      ...validManifest(id),
      capabilities: ["canvas.write"],
      contributes: {
        widgets: [
          {
            type: `${id}.card`,
            title: "Card",
            schemaVersion: 1,
            surface: "dom",
            sizeMode: "fixed",
            defaultSize: { w: 200, h: 120 },
            behaviors: [{ id: behaviorId, data: { count: 3 } }],
          },
        ],
        behaviors: [
          {
            id: behaviorId,
            definition: {
              store: "runtime",
              derived: false,
              deriveDuringGesture: false,
              version: 1,
              phase: "simulate",
              tickWhile: "all",
              schema: [{ name: "count", spec: { kind: "number", default: 0, min: 0, max: 10 } }],
              reads: [],
              writes: [],
              migrationFrom: [],
              hooks: ["init"],
            },
          },
        ],
      },
    };
    writePluginDir(root, "behavior", manifest);
    const svc = newService({ bundled: [], devLinked: [root] });

    await svc.refresh();

    const record = svc.get(id);
    expect(record?.state).toBe("enabled");
    expect(record?.grantedCapabilities).toContain("canvas.write");
    expect(record?.contributions.behaviors).toEqual(manifest.contributes.behaviors);
    expect(record?.contributions.widgets[0]?.behaviors).toEqual(
      manifest.contributes.widgets[0]?.behaviors,
    );
    expect(PluginRegistrySnapshot.safeParse(svc.snapshot()).success).toBe(true);
  });
});

describe("PluginRegistryService — invalid & incompatible roots", () => {
  it("files problems (not rows) for broken/oversize manifests without throwing; other roots still register", async () => {
    const svc = newService({
      bundled: [scenario("broken-json"), oversizeRoot(), scenario("ok")],
      devLinked: [],
    });
    await expect(svc.refresh()).resolves.toBeUndefined(); // one bad root never fails the scan

    const snap = svc.snapshot();
    // the two valid ok/ plugins register despite the failing sibling roots
    expect(snap.plugins.map((p) => p.id)).toEqual([
      "vibefield.fixture.alpha",
      "vibefield.fixture.beta",
    ]);

    expect(snap.problems).toHaveLength(2);
    const byRoot = new Map(snap.problems.map((pr) => [pr.root, pr]));
    // problems name the plugin dir BASENAME only — never a path (sanitized law)
    for (const pr of snap.problems) {
      expect(pr.root).not.toContain("/");
      expect(pr.error.kind.length).toBeGreaterThan(0);
      expect(pr.error.message.length).toBeGreaterThan(0);
    }
    expect(byRoot.get("half-written-plugin")?.error.message).toContain("not valid JSON");
    expect(byRoot.get("oversize-manifest")?.error.message).toContain("exceeds");

    // health.invalid = problems + invalid rows; count = registered rows
    const invalidRows = snap.plugins.filter((p) => p.state === "invalid").length;
    expect(svc.health().invalid).toBe(snap.problems.length + invalidRows);
    expect(svc.health().count).toBe(snap.plugins.length);
  });

  it("keeps a schema-invalid but id-parseable manifest as an invalid row", async () => {
    const svc = newService({ bundled: [scenario("schema-invalid")], devLinked: [] });
    await svc.refresh();

    const snap = svc.snapshot();
    expect(snap.problems).toEqual([]); // a well-formed id ⇒ a row, not a problem
    expect(snap.plugins).toHaveLength(1);
    const row = snap.plugins[0];
    expect(row?.id).toBe("vibefield.fixture.badschema");
    expect(row?.state).toBe("invalid");
    expect(row?.enabled).toBe(false);
    expect(row?.compatible).toBe(true);
    expect(row?.renderer).toBe("none");
    expect(row?.contributions.widgets).toEqual([]); // invalid rows carry no contributions
    expect(row?.lastError?.kind).toBe("PLUGIN_INVALID");
    expect(row?.lastError?.message).toContain("entries.renderer");
  });

  it("marks a manifest with an unsatisfiable contracts range incompatible (a row, not a problem)", async () => {
    const svc = newService({ bundled: [scenario("bad-engines")], devLinked: [] });
    await svc.refresh();

    const snap = svc.snapshot();
    expect(snap.problems).toEqual([]);
    expect(snap.plugins).toHaveLength(1);
    const row = snap.plugins[0];
    expect(row?.id).toBe("vibefield.fixture.badengines");
    expect(row?.state).toBe("incompatible");
    expect(row?.compatible).toBe(false);
    expect(row?.enabled).toBe(false);
    expect(row?.lastError?.kind).toBe("PLUGIN_INCOMPATIBLE");
    expect(row?.lastError?.message).toContain("contracts");
  });
});

describe("PluginRegistryService — duplicate ids", () => {
  it("first-in-discovery-order wins; the loser becomes a problem naming the id", async () => {
    // two bundled roots carrying the same id — dup-a scans first, dup-b loses
    const svc = newService({ bundled: [scenario("dup-a"), scenario("dup-b")], devLinked: [] });
    await svc.refresh();

    const snap = svc.snapshot();
    expect(snap.plugins.filter((p) => p.id === "vibefield.fixture.dup")).toHaveLength(1);
    expect(svc.get("vibefield.fixture.dup")).toBeDefined();

    expect(snap.problems).toHaveLength(1);
    const prob = snap.problems[0];
    expect(prob?.root).toBe("secondary"); // dup-b's child dir; dup-a won
    expect(prob?.error.message).toContain("vibefield.fixture.dup");
    expect(prob?.error.message.toLowerCase()).toContain("duplicate");
  });

  it("a dev-linked dir may not shadow a bundled id", async () => {
    const svc = newService({ bundled: [scenario("ok")], devLinked: [scenario("shadow-dev")] });
    await svc.refresh();

    // bundled scans first, so the bundled alpha keeps the id
    expect(svc.get("vibefield.fixture.alpha")?.source).toBe("bundled");

    const shadow = svc.snapshot().problems.find((p) => p.root === "shadow");
    expect(shadow).toBeDefined();
    expect(shadow?.error.message).toContain("vibefield.fixture.alpha");
    expect(shadow?.error.message.toLowerCase()).toContain("duplicate");
  });
});

describe("PluginRegistryService — enable/disable", () => {
  it("disable then enable flips state, bumps generation, and emits changed", async () => {
    const svc = newService({ bundled: [scenario("ok")], devLinked: [] });
    await svc.refresh();

    const gen0 = svc.snapshot().generation;
    let changes = 0;
    let last: PluginRegistrySnapshot | undefined;
    svc.on("changed", (s: PluginRegistrySnapshot) => {
      changes += 1;
      last = s;
    });

    const disabled = await svc.disable("vibefield.fixture.alpha");
    expect(disabled.state).toBe("disabled");
    expect(disabled.enabled).toBe(false);
    expect(disabled.grantedCapabilities).toEqual([]);
    expect(svc.get("vibefield.fixture.alpha")?.enabled).toBe(false);
    expect(svc.snapshot().generation).toBeGreaterThan(gen0);
    expect(changes).toBeGreaterThanOrEqual(1);
    expect(last?.plugins.find((p) => p.id === "vibefield.fixture.alpha")?.state).toBe("disabled");

    const gen1 = svc.snapshot().generation;
    const enabled = await svc.enable("vibefield.fixture.alpha");
    expect(enabled.state).toBe("enabled");
    expect(enabled.enabled).toBe(true);
    expect(svc.snapshot().generation).toBeGreaterThan(gen1);
    expect(changes).toBeGreaterThanOrEqual(2);
  });

  it("enable/disable of an unknown id throws RpcCallError NOT_FOUND", async () => {
    const svc = newService({ bundled: [scenario("ok")], devLinked: [] });
    await svc.refresh();

    const onEnable = await rejection(svc.enable("vibefield.fixture.ghost"));
    expect(onEnable).toBeInstanceOf(RpcCallError);
    expect((onEnable as RpcCallError).kind).toBe("NOT_FOUND");

    const onDisable = await rejection(svc.disable("vibefield.fixture.ghost"));
    expect((onDisable as RpcCallError).kind).toBe("NOT_FOUND");
  });
});

describe("PluginRegistryService — persistence", () => {
  it("a disabled plugin stays disabled across dispose + reconstruct on the same dataDir", async () => {
    const dataDir = makeDataDir();
    const roots: PluginRegistryConfig["roots"] = { bundled: [scenario("ok")], devLinked: [] };

    const first = new PluginRegistryService({ dataDir, roots });
    await first.refresh();
    await first.disable("vibefield.fixture.alpha");
    first.dispose();

    expect(existsSync(join(dataDir, "fieldd", "plugins", "install-records.json"))).toBe(true);

    const second = new PluginRegistryService({ dataDir, roots });
    cleanup.push(() => second.dispose());
    await second.refresh();
    expect(second.get("vibefield.fixture.alpha")?.enabled).toBe(false);
    expect(second.get("vibefield.fixture.alpha")?.state).toBe("disabled");
    // beta was never touched ⇒ still default-enabled
    expect(second.get("vibefield.fixture.beta")?.enabled).toBe(true);
  });
});

describe("PluginRegistryService — reload discovery", () => {
  it("a newly added dev-linked plugin appears on refresh, bumping generation", async () => {
    const devRoot = mkdtempSync(join(tmpdir(), "plugreg-dev-"));
    cleanup.push(() => rmSync(devRoot, { recursive: true, force: true }));
    writePluginDir(devRoot, "one", validManifest("vibefield.fixture.reload-one"));

    const svc = newService({ bundled: [], devLinked: [devRoot] });
    await svc.refresh();
    expect(svc.get("vibefield.fixture.reload-one")).toBeDefined();

    const gen0 = svc.snapshot().generation;
    let changes = 0;
    svc.on("changed", () => {
      changes += 1;
    });

    // a new plugin dir shows up in the dev root at runtime
    writePluginDir(devRoot, "two", validManifest("vibefield.fixture.reload-two"));
    await svc.refresh();

    const two = svc.get("vibefield.fixture.reload-two");
    expect(two).toBeDefined();
    expect(two?.source).toBe("dev-linked");
    expect(svc.snapshot().generation).toBeGreaterThan(gen0);
    expect(changes).toBeGreaterThanOrEqual(1);
  });
});

describe("PluginRegistryService — real repo canary", () => {
  it("discovers the shipped note and field-tools plugins as valid, enabled rows", async () => {
    const svc = newService({ bundled: [REPO_PLUGINS], devLinked: [] });
    await svc.refresh();

    const ids = svc.list().map((p) => p.id);
    expect(ids).toContain("vibefield.note");
    expect(ids).toContain("vibefield.field-tools");
    expect(svc.list().length).toBeGreaterThanOrEqual(2); // the repo grows — never an exact count

    const note = svc.get("vibefield.note");
    expect(note?.state).toBe("enabled");
    expect(note?.compatible).toBe(true);
    const tools = svc.get("vibefield.field-tools");
    expect(tools?.state).toBe("enabled");
    expect(tools?.compatible).toBe(true);
  });
});

describe("PluginRegistryService — snapshot sanitization", () => {
  it("the serialized snapshot leaks no filesystem paths (§9.4)", async () => {
    const dataDir = makeDataDir();
    const svc = newService(
      { bundled: [scenario("ok"), scenario("broken-json")], devLinked: [] },
      dataDir,
    );
    await svc.refresh();

    const json = JSON.stringify(svc.snapshot());
    expect(json).not.toContain(dataDir);
    expect(json).not.toContain(FIXTURES);
    expect(json).not.toContain("/Users/");
  });
});
