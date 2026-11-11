// MK-1 — the plugin market's contracts (DESIGN.md §8 "Plugins — the frame's second popup", §9 "The plugins' words";
// MK-D5, MK-D6, MK-D7, MK-D12, MK-E3, MK-E8; MK's J1 and VF-PM's 07:42:17Z conditions on it).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { METHODS } from "../src/methods";
import {
  PluginsCatalog,
  PluginsCatalogState,
  RegistryIndex,
  RegistryIndexV2,
  RegistryListingFile,
  RegistryProvenance,
  registryListedAs,
  Sha256Pin,
} from "../src/plugin-distribution";
import { PluginsInstallResult } from "../src/plugin-registry";
import {
  PLUGIN_POWER_GROUPS,
  PLUGIN_POWER_WORDS,
  pluginOwnPowerLine,
  pluginPowerWords,
} from "../src/plugin-words";
import { PLUGIN_CAPABILITY_ELIGIBILITY } from "../src/plugins";
import {
  APP_PREFERENCE_KEYS,
  APP_PREFERENCES_NEVER_UNDONE,
  AppPreferenceKey,
  AppPreferenceSetParams,
  AppPreferences,
} from "../src/shell";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const DESIGN_MD = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "DESIGN.md");
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("the registry index carries listings and the maintainers' pick (MK-D12, MK-E8)", () => {
  it("v1: the pick and each listing parse, and a rung says VibeField's own or community", () => {
    const index = RegistryIndex.parse(fixture("registry-index-v1.market.json"));
    expect(index.featured).toEqual(["vibefield.simulator"]);
    const sim = index.plugins["vibefield.simulator"]!;
    expect(sim.listing?.title).toBe("Simulators");
    expect(sim.listing?.objects.map((o) => o.label)).toEqual(["Phone", "Tablet", "Watch"]);
    expect(registryListedAs(sim)).toBe("vibefield");
  });

  it("v1: an absent or unknown rung reads as community, never the other way (VF-PM 07:42:17Z)", () => {
    const index = RegistryIndex.parse(fixture("registry-index-v1.market.json"));
    expect(index.plugins["acme.burndown"]!.rung).toBeUndefined();
    expect(registryListedAs(index.plugins["acme.burndown"]!)).toBe("community");
    expect(index.plugins["acme.clock"]!.rung).toBeUndefined();
    expect(registryListedAs(index.plugins["acme.clock"]!)).toBe("community");
    const burndown = index.plugins["acme.burndown"]!;
    for (const rung of ["R0", "R2", "R3", "r1", "", 1, null, undefined])
      expect(registryListedAs({ ...burndown, rung })).toBe("community");
    expect(registryListedAs({ ...burndown, rung: "R1" })).toBe("vibefield");
  });

  it("v1: a bad listing or a bad pick never refuses the whole index, it goes unshown", () => {
    const index = RegistryIndex.parse(fixture("registry-index-v1.market.json"));
    expect(index.plugins["acme.clock"]!.listing).toBeUndefined();
    const raw = clone(fixture("registry-index-v1.market.json")) as Record<string, unknown>;
    raw.featured = "simulator";
    const parsed = RegistryIndex.safeParse(raw);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.featured).toBeUndefined();
  });

  it("v1: a picture is an index-relative path; any other drops the listing, not the index", () => {
    type Raw = { plugins: Record<string, { listing: Record<string, unknown> }> };
    const pin = `sha256:${"a".repeat(64)}`;
    for (const bad of ["https://x/y.png", "../x.png", "/abs.png", "a\\b.png"]) {
      const byIcon = clone(fixture("registry-index-v1.market.json")) as Raw;
      byIcon.plugins["vibefield.simulator"]!.listing.icon = { path: bad, sha256: pin };
      expect(RegistryIndex.parse(byIcon).plugins["vibefield.simulator"]!.listing).toBeUndefined();
      const bySpread = clone(fixture("registry-index-v1.market.json")) as Raw;
      bySpread.plugins["vibefield.simulator"]!.listing.spread = {
        day: { path: "listing/a.png", sha256: pin },
        night: { path: bad, sha256: pin },
      };
      expect(RegistryIndex.parse(bySpread).plugins["vibefield.simulator"]!.listing).toBeUndefined();
    }
    const good = RegistryIndex.parse(fixture("registry-index-v1.market.json"));
    expect(good.plugins["vibefield.simulator"]!.listing?.icon).toEqual({
      path: "listing/vibefield.simulator/icon.png",
      sha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
  });

  it("v1: a picture needs the artifacts' pin; bare, unpinned or wrong-length drops it", () => {
    expect(RegistryListingFile.shape.sha256).toBe(Sha256Pin);
    type Pic = { path: string; sha256?: unknown };
    type Listing = {
      icon: Pic | string;
      spread: { day: Pic };
      objects: Array<{ stills: { night: Pic } }>;
    };
    type Raw = { plugins: Record<string, { listing: Listing }> };
    const sim = (raw: Raw) => raw.plugins["vibefield.simulator"]!.listing;
    const pictures: Array<(raw: Raw) => Pic> = [
      (raw) => sim(raw).icon as Pic,
      (raw) => sim(raw).spread.day,
      (raw) => sim(raw).objects[0]!.stills.night,
    ];
    for (const at of pictures) {
      for (const pin of [undefined, `sha256:${"a".repeat(63)}`, `sha256:${"a".repeat(65)}`]) {
        const raw = clone(fixture("registry-index-v1.market.json")) as Raw;
        if (pin === undefined) delete at(raw).sha256;
        else at(raw).sha256 = pin;
        const index = RegistryIndex.parse(raw);
        expect(index.plugins["vibefield.simulator"]!.listing).toBeUndefined();
        expect(index.plugins["acme.burndown"]!.listing?.title).toBe("Burndown");
      }
    }
    const bare = clone(fixture("registry-index-v1.market.json")) as Raw;
    sim(bare).icon = "listing/vibefield.simulator/icon.png";
    expect(RegistryIndex.parse(bare).plugins["vibefield.simulator"]!.listing).toBeUndefined();
  });

  it("v2: types the same listing and pick, as tolerant, and its rung is the same authority", () => {
    const raw = clone(fixture("registry-index-v2.valid.json")) as {
      featured?: unknown;
      plugins: Record<string, Record<string, unknown>>;
    };
    const [id] = Object.keys(raw.plugins);
    raw.featured = [id];
    raw.plugins[id!]!.listing = { title: "Jupyter", objects: [] };
    const good = RegistryIndexV2.parse(raw);
    expect(good.featured).toEqual([id]);
    expect(good.plugins[id!]!.listing?.title).toBe("Jupyter");
    expect(good.plugins[id!]!.rung).toBe("R2");
    expect(registryListedAs(good.plugins[id!]!)).toBe("community");
    raw.plugins[id!]!.listing = { objects: 3 };
    raw.featured = [7];
    const bad = RegistryIndexV2.safeParse(raw);
    expect(bad.success).toBe(true);
    expect(bad.success && bad.data.plugins[id!]!.listing).toBeUndefined();
    expect(bad.success && bad.data.featured).toBeUndefined();
  });
});

describe("the provenance sidecar's display copies decide nothing (item 321; VF-PM 07:42:17Z)", () => {
  it("carries the rung and the publisher's name as copies", () => {
    const p = RegistryProvenance.parse(fixture("registry-provenance.display-copies.json"));
    expect(p.rung).toBe("R2");
    expect(p.publisherName).toBe("Acme");
  });

  it("a bad copy reads as absent, so neither reader of the sidecar can fail on it", () => {
    const p = RegistryProvenance.parse(fixture("registry-provenance.bad-copies.json"));
    expect(p.rung).toBeUndefined();
    expect(p.publisherName).toBeUndefined();
  });
});

describe("the catalog door (MK-D5)", () => {
  it("answers its states, its time always said", () => {
    expect(PluginsCatalogState.options).toEqual([
      "unconfigured",
      "unread",
      "reading",
      "ready",
      "stale",
      "unreachable",
      "refused",
    ]);
    const ready = PluginsCatalog.parse(fixture("plugins-catalog.ready.json"));
    expect(ready.checkedAt).toBe(1762823100000);
    expect(ready.plugins.map((p) => p.listedAs)).toEqual(["vibefield", "community"]);
    expect(ready.plugins[0]!.listing?.icon?.path).toBe("listing/vibefield.simulator/icon.png");
    expect(PluginsCatalog.parse(fixture("plugins-catalog.unconfigured.json")).checkedAt).toBeNull();
    // MK-1c: configured, but nothing held or read yet — a wire state, no list and no time
    const unread = PluginsCatalog.parse(fixture("plugins-catalog.unread.json"));
    expect([unread.state, unread.checkedAt, unread.plugins.length]).toEqual(["unread", null, 0]);
    const held = PluginsCatalog.parse(fixture("plugins-catalog.unreachable.json"));
    expect(held.state).toBe("unreachable");
    expect(held.plugins).toHaveLength(1);
    expect(PluginsCatalog.safeParse({ state: "offline", checkedAt: null }).success).toBe(false);
  });

  it("reads an unknown listedAs as community, and drops a bad listing or pick rather than the catalog", () => {
    const raw = clone(fixture("plugins-catalog.ready.json")) as {
      featured: unknown;
      plugins: Array<Record<string, unknown>>;
    };
    raw.plugins[0]!.listedAs = "verified";
    raw.plugins[1]!.listedAs = undefined;
    raw.plugins[0]!.listing = { title: "" };
    raw.featured = "simulator";
    const parsed = PluginsCatalog.parse(raw);
    expect(parsed.plugins.map((p) => p.listedAs)).toEqual(["community", "community"]);
    expect(parsed.plugins[0]!.listing).toBeUndefined();
    expect(parsed.featured).toEqual([]);
  });

  it("get reads at once on plugins.read; refresh is the person's read on plugins.manage, both local", () => {
    const row = (method: string) => METHODS.find((m) => m.method === method);
    expect(row("plugins.catalog.get")).toMatchObject({ scope: "plugins.read", locality: "local" });
    expect(row("plugins.catalog.refresh")).toMatchObject({
      scope: "plugins.manage",
      locality: "local",
    });
  });
});

describe("the install answer", () => {
  it("is the installed plugin's record, flat, or its id alone", () => {
    const record = PluginsInstallResult.parse(fixture("plugins-install-result.record.json"));
    expect(record.id).toBe("vibefield.comment-pad");
    expect("source" in record && record.source).toBe("registry");
    // only PluginRecord's defaults fill these, so the record branch is the one that parsed it
    expect(record).toMatchObject({ deniedCapabilities: [], grantGeneration: 0 });
    expect(record).toMatchObject({ registry: { rung: "R2", publisherName: "Acme" } });
    expect(PluginsInstallResult.parse(fixture("plugins-install-result.id-only.json"))).toEqual({
      id: "acme.burndown",
    });
  });
});

describe("the powers' plain words (MK-D7; DESIGN.md §9)", () => {
  it("cover exactly the core powers a plugin may hold", () => {
    expect(Object.keys(PLUGIN_POWER_WORDS).sort()).toEqual(
      Object.keys(PLUGIN_CAPABILITY_ELIGIBILITY).sort(),
    );
    for (const entry of Object.values(PLUGIN_POWER_WORDS))
      expect(PLUGIN_POWER_GROUPS).toContain(entry.group);
  });

  it("are DESIGN.md §9's, word for word (a word changes there first)", () => {
    const design = readFileSync(DESIGN_MD, "utf8").replace(/\s+/g, " ");
    for (const [id, entry] of Object.entries(PLUGIN_POWER_WORDS))
      expect(design).toContain(`\`${id}\` "${entry.words}"`);
    expect(design).toContain('"Run programs on this Mac" ("this PC" off the Mac)');
    expect(design).toContain('"macOS asks you once, for Screen Recording"');
  });

  it("say the machine they run on, and nothing for a power that is not core", () => {
    expect(pluginPowerWords("process.spawn", { onMac: true })).toBe("Run programs on this Mac");
    expect(pluginPowerWords("process.spawn", { onMac: false })).toBe("Run programs on this PC");
    expect(pluginPowerWords("canvas.read", { onMac: false })).toBe("Read what's on the desk");
    expect(pluginPowerWords("x.acme.clock.alarm", { onMac: true })).toBeUndefined();
    expect(pluginPowerWords("toString", { onMac: true })).toBeUndefined();
    expect(PLUGIN_POWER_WORDS["surface.capture"].macNote).toBe(
      "macOS asks you once, for Screen Recording",
    );
  });

  it("say whose a plugin's own power is", () => {
    expect(pluginOwnPowerLine("Clock", true)).toBe("A power of its own, named by Clock");
    expect(pluginOwnPowerLine("Clock", false)).toBe("A power Clock names");
  });
});

describe("Community plugins: a synced switch, never undone, absent is off (MK-D6, MK-E3)", () => {
  it("is an app preference the setter takes as a switch", () => {
    const key = APP_PREFERENCE_KEYS.COMMUNITY_PLUGINS;
    expect(AppPreferenceKey.options).toContain(key);
    expect(AppPreferenceSetParams.safeParse({ key, value: true }).success).toBe(true);
    expect(AppPreferenceSetParams.safeParse({ key, value: 1 }).success).toBe(false);
    expect(APP_PREFERENCES_NEVER_UNDONE).toEqual([key]);
  });

  it("an older daemon's snapshot says nothing of it (absent; off is fieldd's default, MK-2)", () => {
    const older = AppPreferences.parse(fixture("app-preferences.older-daemon.json"));
    expect(older.communityPlugins).toBeUndefined();
  });
});
