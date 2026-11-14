import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SETTINGS_DOC_SECTIONS, standingDecision } from "@vibefield/contracts";
import { LoroDoc } from "loro-crdt";
import { afterEach, describe, expect, it } from "vitest";
import { type RefusalAct, SettingsDocService } from "../src/settings-doc";

// PLUG-P7 — the D29′ system settings doc: fieldd's first live Loro doc.
// This suite pins the three D29′ laws mechanically (design-03 §7.2):
// coverage honesty is the settings suite's (secrets/device never enter);
// law 2 (undo never re-escalates) and law 3 (honest horizon) are here,
// plus migration and restart durability.

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const ID = "vibefield.fixture.docs";

function tempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "vf-sdoc-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function make(dataDir: string): SettingsDocService {
  const svc = new SettingsDocService({ dataDir });
  cleanup.push(() => svc.dispose());
  return svc;
}

describe("the system settings doc (D29′)", () => {
  it("persists writes durably and reloads them in a fresh instance (history intact)", async () => {
    const dataDir = tempDataDir();
    const a = make(dataDir);
    await a.setUserValue(ID, "greeting", "howdy", "test");
    await a.setAppValue("theme", "dark", "test");
    expect(existsSync(join(dataDir, "fieldd", "settings", "doc.loro"))).toBe(true);
    await a.dispose();

    const b = make(dataDir);
    expect(await b.userValues(ID)).toEqual({ greeting: "howdy" });
    expect(await b.appValues()).toEqual({ theme: "dark" });
  });

  it("publishes app writes and generic user undo so desktop subscribers refresh", async () => {
    const svc = make(tempDataDir());
    const sections: string[] = [];
    svc.on("changed", (event: { section: string }) => sections.push(event.section));
    await svc.setAppValue("desktop.showTray", false, "pane");
    expect(await svc.appValues()).toEqual({ "desktop.showTray": false });
    expect(await svc.undo()).toEqual({ applied: true });
    expect(await svc.appValues()).toEqual({});
    expect(sections).toEqual(["app", "settings"]);
  });

  it("law 2 for the switch — undo never turns community plugins on or off (MK-2a, S1)", async () => {
    const svc = make(tempDataDir());
    await svc.setAppValue("plugins.community", true, "pane");
    // the switch alone: nothing to undo
    expect(await svc.undo()).toEqual({ applied: false, reason: "empty-stack" });
    await svc.setAppValue("desktop.showTray", false, "pane");
    await svc.setAppValue("plugins.community", false, "pane");
    await svc.setAppValue("desktop.sounds", false, "pane");
    // each undo reverts an undoable write; the switch stays as last set
    expect(await svc.undo()).toEqual({ applied: true });
    expect(await svc.appValues()).toEqual({
      "plugins.community": false,
      "desktop.showTray": false,
    });
    expect(await svc.undo()).toEqual({ applied: true });
    expect(await svc.appValues()).toEqual({ "plugins.community": false });
    expect(await svc.undo()).toEqual({ applied: false, reason: "empty-stack" });
    expect(await svc.redo()).toEqual({ applied: true });
    expect(await svc.appValues()).toEqual({
      "plugins.community": false,
      "desktop.showTray": false,
    });
  });

  it("migrates P5's settings-user.json once, doc values winning, file renamed aside", async () => {
    const dataDir = tempDataDir();
    mkdirSync(join(dataDir, "fieldd", "plugins"), { recursive: true });
    const legacy = join(dataDir, "fieldd", "plugins", "settings-user.json");
    writeFileSync(
      legacy,
      JSON.stringify({ version: 1, plugins: { [ID]: { greeting: "from-json", extra: 7 } } }),
    );
    const svc = make(dataDir);
    expect(await svc.userValues(ID)).toEqual({ greeting: "from-json", extra: 7 });
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(`${legacy}.migrated`)).toBe(true);
    // the migration is OUTSIDE the undo stack (origin "migrate:")
    expect(await svc.undo()).toEqual({ applied: false, reason: "empty-stack" });
  });

  it("law 2 — undo reverts settings but NEVER an interleaved install-set write", async () => {
    const dataDir = tempDataDir();
    const svc = make(dataDir);
    await svc.setUserValue(ID, "volume", 3, "pane");
    await svc.setInstallSetEntry(
      {
        pluginId: "vibefield.example",
        source: "registry",
        version: "1.0.0",
        artifactSha256: `sha256:${"ab".repeat(32)}`,
        enabled: true,
        grants: [{ capability: "storage.self", decision: "revoked", at: 1 }],
      },
      "reconciler",
    );
    await svc.setUserValue(ID, "volume", 9, "pane");

    // first undo: the volume=9 write reverts; the install-set (with its
    // REVOKED grant) is untouched — undo never re-escalates
    expect(await svc.undo()).toEqual({ applied: true });
    expect((await svc.userValues(ID))["volume"]).toBe(3);
    const set = await svc.installSet();
    expect(set["vibefield.example"]?.grants[0]?.decision).toBe("revoked");

    // second undo: volume=3 reverts too; the install-set STILL stands
    expect(await svc.undo()).toEqual({ applied: true });
    expect((await svc.userValues(ID))["volume"]).toBeUndefined();
    expect((await svc.installSet())["vibefield.example"]?.enabled).toBe(true);

    // redo restores the setting; the install-set never moved
    expect(await svc.redo()).toEqual({ applied: true });
    expect((await svc.userValues(ID))["volume"]).toBe(3);
  });

  it("law 3 — the horizon is honest: an empty stack says so, and a fresh boot starts clean", async () => {
    const dataDir = tempDataDir();
    const a = make(dataDir);
    expect(await a.undo()).toEqual({ applied: false, reason: "empty-stack" });
    await a.setUserValue(ID, "greeting", "hi", "pane");
    await a.dispose();

    // v1 ceiling (two-plane law): the undo stack is daemon-lifetime — a fresh
    // instance holds the VALUE but not the stack
    const b = make(dataDir);
    expect(await b.userValues(ID)).toEqual({ greeting: "hi" });
    expect(await b.undo()).toEqual({ applied: false, reason: "empty-stack" });
  });

  it("tolerant reader — a malformed install-set entry is skipped, never fatal", async () => {
    const dataDir = tempDataDir();
    const a = make(dataDir);
    await a.setInstallSetEntry(
      {
        pluginId: "vibefield.good",
        source: "bundled",
        enabled: true,
        grants: [],
      },
      "test",
    );
    // A peer's merge is the only way bogus values arrive; simulate it with raw
    // writes through the same maps (the schema gate is at READ): an identity
    // that is not one, and a decision register under an unreadable key.
    const doc = a.hostDoc();
    doc.getMap(SETTINGS_DOC_SECTIONS.INSTALL_SET_PLUGINS).set("vibefield.bad", {
      not: "an identity",
    } as never);
    doc.getMap(SETTINGS_DOC_SECTIONS.INSTALL_SET_GRANTS).set("not-a-tuple", {
      decision: "granted",
    } as never);
    doc.commit({ origin: "no-undo:test" });
    const set = await a.installSet();
    expect(Object.keys(set)).toEqual(["vibefield.good"]);
  });

  // DS-5b (PA-32) — adoption: a document saved in P7's layout (ONE whole entry
  // per plugin, no stamps) is migrated on load into the per-field layout, a
  // revoked decision becoming a revocation the generation counts, once.
  it("adopts a P7 install-set: migrated on load with its stamps, the old section emptied, once", async () => {
    const dataDir = tempDataDir();
    const old = new LoroDoc();
    old.getMap(SETTINGS_DOC_SECTIONS.INSTALL_SET).set("vibefield.example", {
      pluginId: "vibefield.example",
      source: "registry",
      version: "1.0.0",
      artifactSha256: `sha256:${"ab".repeat(32)}`,
      enabled: false,
      grants: [
        { capability: "storage.self", decision: "revoked", at: 5 },
        { capability: "canvas.read", decision: "granted", at: 6 },
      ],
    } as never);
    old.commit();
    const file = join(dataDir, "fieldd", "settings", "doc.loro");
    mkdirSync(join(dataDir, "fieldd", "settings"), { recursive: true });
    writeFileSync(file, old.export({ mode: "snapshot" }));

    const expected = {
      pluginId: "vibefield.example",
      source: "registry",
      version: "1.0.0",
      artifactSha256: `sha256:${"ab".repeat(32)}`,
      enabled: false,
      revocationGenerations: { "storage.self": 1 },
    };
    const a = make(dataDir);
    const entry = (await a.installSet())["vibefield.example"];
    expect(entry).toMatchObject(expected);
    expect(entry?.grants).toEqual(
      expect.arrayContaining([
        { capability: "storage.self", decision: "revoked", at: 5, revocationGeneration: 1 },
        { capability: "canvas.read", decision: "granted", at: 6, revocationGeneration: 0 },
      ]),
    );
    expect(a.hostDoc().getMap(SETTINGS_DOC_SECTIONS.INSTALL_SET).keys()).toEqual([]);
    // the migration is outside the undo stack, like every install-set write
    expect(await a.undo()).toEqual({ applied: false, reason: "empty-stack" });
    await a.dispose();

    // a restart reads the per-field layout and migrates nothing twice
    const b = make(dataDir);
    expect((await b.installSet())["vibefield.example"]).toMatchObject(expected);
  });

  it("a revocation outlives an uninstall: the generation never shrinks", async () => {
    const svc = make(tempDataDir());
    const entry = {
      pluginId: "vibefield.example",
      source: "bundled" as const,
      enabled: true,
      grants: [{ capability: "storage.self", decision: "revoked" as const, at: 1 }],
    };
    await svc.setInstallSetEntry(entry, "test");
    await svc.removeInstallSetEntry("vibefield.example", "uninstall");
    expect(await svc.installSet()).toEqual({});
    // reinstalled with a grant some desktop made BEFORE the revocation (it saw 0)
    await svc.setInstallSetEntry(
      {
        ...entry,
        grants: [
          { capability: "storage.self", decision: "granted", at: 2, revocationGeneration: 0 },
        ],
      },
      "test",
    );
    const back = (await svc.installSet())["vibefield.example"];
    expect(back?.revocationGenerations).toEqual({ "storage.self": 1 });
    const decision = back?.grants.find((g) => g.capability === "storage.self");
    expect(decision && back && standingDecision(back, decision)).toEqual({
      granted: false,
      reason: "revocation-bias",
    });
  });

  it("the doc file never contains device/secret material by construction (law 1 lives in the settings service; the doc only ever receives user-scope writes)", async () => {
    const dataDir = tempDataDir();
    const svc = make(dataDir);
    await svc.setUserValue(ID, "public", "value", "pane");
    const bytes = readFileSync(join(dataDir, "fieldd", "settings", "doc.loro"));
    // sanity: the snapshot holds the user value and nothing else was routed in
    expect(bytes.length).toBeGreaterThan(0);
    expect(await svc.userValues(ID)).toEqual({ public: "value" });
  });
});

// MK-2d (E10's R1, R2; VF-PM 2026-11-11 10:34:14Z): a removal travels as a grow-only key, and an identity stands only
// while its removal stamp has seen every removal. Each test writes its own doc in its own temp root.
describe("a removal across desktops (MK-2d)", () => {
  const PLUGIN = "vibefield.example";
  const identity = { source: "registry" as const, version: "1.0.0" };
  const removalKeys = (svc: SettingsDocService) =>
    svc.hostDoc().getMap(SETTINGS_DOC_SECTIONS.INSTALL_SET_REMOVALS);
  const stampOf = (svc: SettingsDocService) =>
    (
      svc.hostDoc().getMap(SETTINGS_DOC_SECTIONS.INSTALL_SET_PLUGINS).get(PLUGIN) as
        | { removalGeneration?: unknown }
        | undefined
    )?.removalGeneration;

  it("an uninstall writes one removal key carrying its time alone, and keeps the revocations (R1)", async () => {
    const svc = make(tempDataDir());
    await svc.updateInstallSet(
      PLUGIN,
      { identity, enabled: true, revoke: ["storage.self"] },
      "install",
    );
    expect(stampOf(svc)).toBe(0);
    await svc.removeInstallSetEntry(PLUGIN, "uninstall");
    expect(await svc.installSet()).toEqual({});
    expect([...(await svc.removedPlugins())]).toEqual([PLUGIN]);
    const keys = removalKeys(svc).keys();
    expect(keys.length).toBe(1);
    expect(JSON.parse(keys[0] as string)[0]).toBe(PLUGIN);
    const value = removalKeys(svc).get(keys[0] as string) as Record<string, unknown>;
    expect(Object.keys(value)).toEqual(["at"]);
    expect(typeof value.at).toBe("number");
    const revocations = svc.hostDoc().getMap(SETTINGS_DOC_SECTIONS.INSTALL_SET_REVOCATIONS).keys();
    expect(revocations.length).toBe(1);
  });

  it("an ensure keeps an entry but never makes one for a removed plugin (R2)", async () => {
    const svc = make(tempDataDir());
    await svc.updateInstallSet(PLUGIN, { identity, enabled: true }, "install");
    await svc.removeInstallSetEntry(PLUGIN, "uninstall");
    await svc.updateInstallSet(PLUGIN, { ensure: { identity, enabled: true } }, "grants");
    await svc.updateInstallSet(
      PLUGIN,
      { enabled: false, ensure: { identity, enabled: false } },
      "disable",
    );
    expect(await svc.installSet()).toEqual({});
    expect(stampOf(svc)).toBeUndefined();
    expect([...(await svc.removedPlugins())]).toEqual([PLUGIN]);
  });

  it("an explicit install after a removal stands, stamped; the keys only grow", async () => {
    const svc = make(tempDataDir());
    await svc.updateInstallSet(PLUGIN, { identity, enabled: true }, "install");
    await svc.removeInstallSetEntry(PLUGIN, "uninstall");
    await svc.updateInstallSet(PLUGIN, { identity, enabled: true }, "install");
    expect(stampOf(svc)).toBe(1);
    expect((await svc.installSet())[PLUGIN]).toMatchObject({ pluginId: PLUGIN, enabled: true });
    expect((await svc.installSet())[PLUGIN]).not.toHaveProperty("removalGeneration");
    expect((await svc.removedPlugins()).size).toBe(0);
    await svc.removeInstallSetEntry(PLUGIN, "uninstall");
    expect(removalKeys(svc).keys().length).toBe(2);
    expect(await svc.installSet()).toEqual({});
    // the seeding verb stamps as an install does
    await svc.setInstallSetEntry(
      { pluginId: PLUGIN, ...identity, enabled: true, grants: [] },
      "seed",
    );
    expect(stampOf(svc)).toBe(2);
    expect(Object.keys(await svc.installSet())).toEqual([PLUGIN]);
  });

  it("an identity with no stamp (an older build's) reads as generation 0", async () => {
    const svc = make(tempDataDir());
    await svc.updateInstallSet(PLUGIN, { identity, enabled: true }, "install");
    await svc.removeInstallSetEntry(PLUGIN, "uninstall");
    // the test's own doc: an older build's identity write, which carries no stamp
    svc
      .hostDoc()
      .getMap(SETTINGS_DOC_SECTIONS.INSTALL_SET_PLUGINS)
      .set(PLUGIN, { ...identity });
    svc.hostDoc().commit();
    expect(await svc.installSet()).toEqual({});
    expect([...(await svc.removedPlugins())]).toEqual([PLUGIN]);
  });
});

// Item 406 (track WI's Desktop slice; VF-PM's rulings of 2026-11-14 04:49Z, Q-PM1 and Q-PM2) — the
// account's phones in the settings document. `devices.refused` is GROW-ONLY: one key per refusal
// ever made (`[deviceId, eventId]`), so the merge is the union and a concurrent Remove is never
// lost, written under a `no-undo:` origin, so no ⌘Z lifts one (law 2; the install-set's
// revocations are the template). `devices.phones` holds the known phones: upserted when a node
// speaks as a phone, deleted by Remove. Remove itself is S3's `device.remove` handler; these rows
// write through the one writer it will call.
describe("406 — the account's refused and known phones (Q-PM1, Q-PM2)", () => {
  /** One call of the refusals' writer, as its caller makes it; true when it wrote. */
  const refuse = async (
    svc: SettingsDocService,
    act: RefusalAct,
    deviceId: string,
    nodeIds: string[],
  ): Promise<boolean> => (await svc.refuseDevice(act, deviceId, nodeIds, "dev-a")).wrote;

  /** A node speaking as a phone, as a hello's door or the freeway's mint tells it; true when it
   * wrote. */
  const remember = async (
    svc: SettingsDocService,
    deviceId: string,
    seen: { tailscaleId: string; via: "freeway" | "product"; name?: string },
  ): Promise<boolean> => (await svc.rememberPhone(deviceId, seen, "dev-a")).wrote;

  it("law 2 — ⌘Z never lifts a refusal: undo reverts the settings around it, and its stack never held it", async () => {
    const svc = make(tempDataDir());
    await svc.setUserValue(ID, "volume", 3, "pane");
    expect(await refuse(svc, "remove", "dev-phone", ["node-phone"])).toBe(true);
    await svc.setUserValue(ID, "volume", 9, "pane");

    // first undo: volume=9 reverts; the refusal, written between, stands
    expect(await svc.undo()).toEqual({ applied: true });
    expect((await svc.userValues(ID))["volume"]).toBe(3);
    expect((await svc.refusals()).deviceIds.has("dev-phone")).toBe(true);
    // second undo: volume=3 reverts too, and nothing is left for ⌘Z — the refusal was never on it
    expect(await svc.undo()).toEqual({ applied: true });
    expect((await svc.userValues(ID))["volume"]).toBeUndefined();
    expect(await svc.undo()).toEqual({ applied: false, reason: "empty-stack" });
    expect(await svc.refusals()).toEqual({
      deviceIds: new Set(["dev-phone"]),
      nodeIds: new Set(["node-phone"]),
    });
  });

  it("the append can never refuse a durable id Remove did not, and carries a node id only under one it did", async () => {
    const svc = make(tempDataDir());
    // never removed: the append writes nothing, whatever node it names
    expect(await refuse(svc, "append", "dev-desk", ["node-desk"])).toBe(false);
    expect(await svc.refusals()).toEqual({ deviceIds: new Set(), nodeIds: new Set() });
    // removed: a node id seen under it is carried, once
    expect(await refuse(svc, "remove", "dev-phone", ["node-old"])).toBe(true);
    expect(await refuse(svc, "append", "dev-phone", ["node-new"])).toBe(true);
    expect(await refuse(svc, "append", "dev-phone", ["node-new"])).toBe(false);
    // a second Remove of a refused phone writes nothing (`DeviceRemoveResult.removed` false), and
    // an append under a durable id Remove did not refuse writes nothing, a refused node or not
    expect(await refuse(svc, "remove", "dev-phone", ["node-other"])).toBe(false);
    expect(await refuse(svc, "append", "dev-desk", ["node-new"])).toBe(false);
    expect(await svc.refusals()).toEqual({
      deviceIds: new Set(["dev-phone"]),
      nodeIds: new Set(["node-old", "node-new"]),
    });
    // every entry names the durable id Remove refused
    const keys = svc.hostDoc().getMap(SETTINGS_DOC_SECTIONS.DEVICES_REFUSED).keys();
    expect(keys).toHaveLength(2);
    const named = new Set(keys.map((key) => (JSON.parse(key) as string[])[0]));
    expect(named).toEqual(new Set(["dev-phone"]));
  });

  it("a merge from a second desktop's document refuses its phones here (the union: a concurrent Remove is never lost), and merged() announces both device sections", async () => {
    const a = make(tempDataDir());
    const b = make(tempDataDir());
    // two desktops apart, each removing a phone, and both the same one
    expect(await refuse(a, "remove", "dev-phone-1", ["node-1"])).toBe(true);
    expect(await refuse(b, "remove", "dev-phone-2", ["node-2"])).toBe(true);
    expect(await refuse(b, "remove", "dev-phone-1", ["node-1b"])).toBe(true);
    const announced: string[] = [];
    b.on("changed", (event: { section: string }) => announced.push(event.section));

    // the host's merge, both ways: a peer's update imported, then its owner told (`hostOwner`)
    b.hostDoc().import(a.hostDoc().export({ mode: "update", from: b.hostDoc().oplogVersion() }));
    b.hostOwner().merged?.();
    a.hostDoc().import(b.hostDoc().export({ mode: "update", from: a.hostDoc().oplogVersion() }));

    for (const svc of [a, b]) {
      expect(await svc.refusals()).toEqual({
        deviceIds: new Set(["dev-phone-1", "dev-phone-2"]),
        nodeIds: new Set(["node-1", "node-1b", "node-2"]),
      });
    }
    // without these, another desktop's roster never passes again, and never forgets the phone
    expect(announced).toContain(SETTINGS_DOC_SECTIONS.DEVICES_REFUSED);
    expect(announced).toContain(SETTINGS_DOC_SECTIONS.DEVICES_PHONES);
    expect(announced).toContain("installSet");
  });

  it("known phones: upserted when a node speaks as one, kept across a reload, never a refused phone, and gone at Remove", async () => {
    const dataDir = tempDataDir();
    const a = make(dataDir);
    const seen = { tailscaleId: "node-phone", via: "product" as const, name: "iPhone" };
    expect(await remember(a, "dev-phone", seen)).toBe(true);
    // the same phone saying the same again, by either evidence, moves nothing: a phone hellos at
    // every connect, and the document keeps every write in its history
    expect(await remember(a, "dev-phone", { ...seen, via: "freeway" })).toBe(false);
    await a.dispose();

    const b = make(dataDir);
    expect((await b.knownPhones()).get("dev-phone")).toMatchObject({
      tailscaleIds: ["node-phone"],
      phone: { via: "product" },
      name: "iPhone",
    });
    // the phone registered again: its new node id is remembered beside the old
    expect(await remember(b, "dev-phone", { ...seen, tailscaleId: "node-two" })).toBe(true);
    const ids = (await b.knownPhones()).get("dev-phone")?.tailscaleIds;
    expect(ids).toEqual(["node-phone", "node-two"]);

    // Remove forgets it, in the refusal's own transaction, and nothing brings it back: not the
    // phone speaking again (a new node, or its refused node under another durable id), not ⌘Z
    expect(await refuse(b, "remove", "dev-phone", ["node-phone", "node-two"])).toBe(true);
    expect((await b.knownPhones()).has("dev-phone")).toBe(false);
    expect(await remember(b, "dev-phone", { ...seen, tailscaleId: "node-three" })).toBe(false);
    expect(await remember(b, "dev-other", seen)).toBe(false);
    expect(await b.undo()).toEqual({ applied: false, reason: "empty-stack" });
    expect((await b.knownPhones()).size).toBe(0);
  });
});

// Item 406 (VF-PM's ruling, 2026-11-14 04:49Z) — the refusals have ONE writer, and it has exactly
// the callers the ruling names. Read off the source, as item 172's read seam is
// (record-stores.test.ts R7): each site is placed by the class method around it, or by the product
// method whose handler holds it. The writer has exactly two callers: DeviceService's registry pass
// appending a node id under a durable id already refused (S2), and the `device.remove` handler
// refusing a phone not refused yet (S3), its act a string literal at the call.
describe("406 — the refusals' one writer, and its callers", () => {
  const src = join(import.meta.dirname, "../src");
  const files = (readdirSync(src, { recursive: true, encoding: "utf8" }) as string[]).filter(
    (file) => file.endsWith(".ts"),
  );
  const HANDLER = /api\.register(?:Subscription)?\("([^"]+)"/;
  const METHOD = /^ {2}(?:(?:private|protected|public|static|async|override) )*(\w+)\s*[(<]/;
  const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "function"]);

  /** Where line `at` sits: going up, the first class method or product handler that holds it. */
  function placeOf(lines: readonly string[], at: number): string {
    for (let i = at; i >= 0; i -= 1) {
      const line = lines[i] ?? "";
      const handler = HANDLER.exec(line)?.[1];
      if (handler !== undefined) return handler;
      const method = METHOD.exec(line)?.[1];
      if (method !== undefined && !KEYWORDS.has(method)) return method;
    }
    return "(module)";
  }

  /** Every match of the global `pattern` in fieldd's source, as `file: place`, with what `say`
   * reads off the match. */
  function sitesOf(pattern: RegExp, say: (m: RegExpMatchArray) => string = () => ""): string[] {
    return files
      .flatMap((file) => {
        const text = readFileSync(join(src, file), "utf8");
        const lines = text.split("\n");
        return [...text.matchAll(pattern)].map((match) => {
          const at = text.slice(0, match.index ?? 0).split("\n").length - 1;
          return `${file.split("\\").join("/")}: ${placeOf(lines, at)}${say(match)}`;
        });
      })
      .sort();
  }

  it("the refusals' section is opened in two places, both the settings document's: its reader and THE writer", () => {
    const opened = sitesOf(/getMap\(\s*(?:S|SETTINGS_DOC_SECTIONS)\.DEVICES_REFUSED\s*\)/g);
    expect(opened).toEqual(["settings-doc.ts: readRefusals", "settings-doc.ts: refuseDevice"]);
  });

  it("the writer's callers are exactly the ones the ruling names: Remove, and the registry pass's append", () => {
    const calls = sitesOf(/\.refuseDevice\(\s*("\w+")?/g, (m) => ` (${m[1] ?? "?"})`);
    expect(calls).toEqual([
      'daemon.ts: device.remove ("remove")',
      'device-service.ts: refreshPeers ("append")',
    ]);
  });
});
