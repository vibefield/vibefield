import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DOC_SYNC_RECORD,
  type GrantDecision,
  type InstallSetEntry,
  LAYOUT,
  type PluginRecord,
  SETTINGS_DOC_SECTIONS,
  SOCKETS,
} from "@vibefield/contracts";
import type { AuditRecordV1 } from "@vibefield/contracts/diagnostics";
import {
  buildFixtureRegistry,
  generateRegistryKeypair,
  packVfplugin,
} from "@vibefield/plugin-build";
import { LoroDoc } from "loro-crdt";
import { afterEach, describe, expect, it } from "vitest";
import type { AuditService } from "../src/audit-service";
import { DocumentService } from "../src/doc-service";
import { bootstrap, type FielddDaemon, verifyAuditSegment } from "../src/index";
import { InstallSetReconciler } from "../src/install-reconciler";
import { systemAccount, systemDocId } from "../src/library-doc";
import type { RegistryInstallService } from "../src/plugin-install";
import type { PluginRegistryService } from "../src/plugin-registry";
import { SettingsDocService } from "../src/settings-doc";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { until } from "./ws-rpc";

// PLUG-P7 — §16.6 convergence: the DESIRED set in the settings doc drives
// this device. The suite seeds a desired entry into the doc BEFORE boot
// (exactly what a synced-in change from another desktop will look like when
// the doc-sync track lands) and watches the daemon converge: install from
// the signed registry, activate, apply enablement and grant decisions.

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

const HERE = dirname(fileURLToPath(import.meta.url));
const KV_DIR = join(HERE, "..", "..", "..", "examples", "plugins", "kv-service");
const KV_ID = "vibefield.example.kv";

async function setupRegistry(): Promise<{ registryUrl: string; publicKey: string }> {
  const registryDir = mkdtempSync(join(tmpdir(), "vf-rec-reg-"));
  cleanup.push(() => rmSync(registryDir, { recursive: true, force: true }));
  const { bytes } = await packVfplugin({ rootDir: KV_DIR });
  const keys = generateRegistryKeypair();
  buildFixtureRegistry({
    dir: registryDir,
    plugins: [{ manifestDir: KV_DIR, artifactBytes: bytes }],
    secretKey: keys.secretKey,
  });
  return {
    registryUrl: pathToFileURL(join(registryDir, "index.json")).href,
    publicKey: keys.publicKey,
  };
}

async function boot(
  dataDir: string,
  registry: { registryUrl: string; publicKey: string },
): Promise<FielddDaemon> {
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    registryUrl: registry.registryUrl,
    registryPublicKey: registry.publicKey,
  });
  cleanup.push(() => daemon.stop());
  return daemon;
}

async function auditRecords(dataDir: string): Promise<AuditRecordV1[]> {
  const root = join(dataDir, "audit");
  const records: AuditRecordV1[] = [];
  for (const name of readdirSync(root).filter((entry) => entry.endsWith(".jsonl"))) {
    const verified = await verifyAuditSegment(join(root, name));
    expect(verified.valid, `${name}: ${verified.reason}`).toBe(true);
    records.push(...verified.records);
  }
  return records;
}

describe("install-set reconciliation (§16.6)", () => {
  it("a desired registry entry seeded in the doc installs, activates, and honors its grants", {
    timeout: 40_000,
  }, async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-rec-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await mock.start();
    cleanup.push(() => mock.stop());
    const registry = await setupRegistry();

    // seed the DESIRED entry the way a synced-in doc change would arrive:
    // installed, enabled, with storage.self REVOKED by decision
    const seed = new SettingsDocService({ dataDir });
    await seed.setInstallSetEntry(
      {
        pluginId: KV_ID,
        source: "registry",
        version: "0.1.0",
        enabled: true,
        grants: [{ capability: "storage.self", decision: "revoked", at: Date.now() }],
      },
      "another-desktop",
    );
    await seed.dispose();

    const daemon = await boot(dataDir, registry);
    // convergence: absent → installed → active, grants applied
    await until(() => daemon.plugins.get(KV_ID) !== undefined, 20_000);
    const record = () => daemon.plugins.get(KV_ID);
    expect(record()?.source).toBe("registry");
    await until(
      () => daemon.plugins.snapshot().plugins.find((p) => p.id === KV_ID)?.service === "active",
      15_000,
    );
    // the revoked decision holds — storage.self denied, the rest granted
    expect(record()?.grantedCapabilities).not.toContain("storage.self");
    expect(record()?.deniedCapabilities).toContainEqual({
      capability: "storage.self",
      reason: "revoked",
    });
    expect(record()?.grantedCapabilities).toContain("services.provide");
    const audit = await auditRecords(dataDir);
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actor: { kind: "system", id: "fieldd" },
          action: "plugin.install",
          target: expect.objectContaining({ id: KV_ID }),
          phase: "outcome",
          outcome: "succeeded",
        }),
        expect.objectContaining({
          actor: { kind: "system", id: "fieldd" },
          action: "capability.revoke",
          target: expect.objectContaining({ id: "storage.self", parentId: KV_ID }),
          phase: "outcome",
          outcome: "succeeded",
        }),
        expect.objectContaining({
          actor: { kind: "system", id: "fieldd" },
          action: "token.plugin_service.mint",
          target: expect.objectContaining({ parentId: KV_ID }),
          phase: "outcome",
          outcome: "succeeded",
        }),
      ]),
    );
  });

  it("reconcile is idempotent and parks an unsatisfiable entry honestly", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-rec2-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await mock.start();
    cleanup.push(() => mock.stop());
    const registry = await setupRegistry();

    const seed = new SettingsDocService({ dataDir });
    // an id the registry does not carry — §16.6: parked pending, never fatal
    await seed.setInstallSetEntry(
      { pluginId: "vibefield.absent.plugin", source: "registry", enabled: true, grants: [] },
      "another-desktop",
    );
    await seed.dispose();

    const daemon = await boot(dataDir, registry);
    // the daemon boots and stays healthy; the entry parks
    await new Promise((r) => setTimeout(r, 1_500));
    expect(daemon.plugins.get("vibefield.absent.plugin")).toBeUndefined();
    expect(daemon.health().fieldd.state).toBe("up");
  });
});

// --- PA-32 across desktops (DS-5b) ------------------------------------------
//
// Two desktops in one process. Each is a SettingsDocService on its own disk,
// registered with its own DocumentService exactly as the daemon's
// mountSystemDocs registers it, and an InstallSetReconciler over an in-memory
// registry. A local act is done the way the daemon's handlers do it: the
// registry first, then `publish`. "Offline" is simply not exchanging; a
// reconnect is the doc-sync VERSION exchange: the receiver states its version
// (`hostVersion`), the sender answers what it lacks (`hostAnswer`), and the
// receiver's host merges the answer (`applyRemoteRecord`), which persists and
// tells the reconciler. The host's merge path, never a hand import.
//
// Last-writer-wins is made deterministic where a row needs it: the desktop that
// writes more after the shared state carries the higher Lamport clock, and its
// write wins a register. Each row says whose write that is, because that is
// precisely the write P7's one-value-per-entry layout let win (B1).

const PA32_ID = "vibefield.fixture.pa32";
const CAP = "storage.self"; // the capability the rows fight over
const BYSTANDER = "canvas.read"; // requested beside it, never touched
const SETTINGS_ID = systemDocId("settings", systemAccount("pa32@example.com", undefined));

interface AuditRow {
  action: string;
  capability?: string;
  origin: "local" | "settings-doc";
  reasonCode?: string;
  attrs?: Record<string, unknown>;
}

/** The slice of PluginRegistryService the reconciler touches, computed as
 * §15.2 does: requested minus revoked, and nothing granted while disabled. */
class MemoryRegistry {
  readonly #decisions: Record<string, boolean> = {};
  record: PluginRecord;

  constructor(revoked: readonly string[] = []) {
    for (const capability of revoked) this.#decisions[capability] = false;
    this.record = this.#recompute({
      id: PA32_ID,
      version: "1.0.0",
      title: "PA-32 fixture",
      source: "bundled",
      manifestHash: `sha256:${"0".repeat(64)}`,
      installRevision: "r1",
      state: "enabled",
      compatible: true,
      enabled: true,
      requestedCapabilities: [CAP, BYSTANDER],
      grantedCapabilities: [],
      deniedCapabilities: [],
      grantGeneration: 0,
      contributions: { widgets: [], behaviors: [], commands: [], surfaces: [], capabilities: [] },
      renderer: "inactive",
      service: "none",
    });
  }

  get(id: string): PluginRecord | undefined {
    return id === PA32_ID ? this.record : undefined;
  }

  async enable(_id: string): Promise<PluginRecord> {
    this.record = this.#recompute({ ...this.record, enabled: true, state: "enabled" });
    return this.record;
  }

  async disable(_id: string): Promise<PluginRecord> {
    this.record = this.#recompute({ ...this.record, enabled: false, state: "disabled" });
    return this.record;
  }

  async setGrant(
    _id: string,
    capability: string,
    granted: boolean,
  ): Promise<{ record: PluginRecord; changed: boolean }> {
    this.#decisions[capability] = granted;
    const before = this.record;
    const next = this.#recompute(before);
    const changed =
      JSON.stringify(next.grantedCapabilities) !== JSON.stringify(before.grantedCapabilities) ||
      JSON.stringify(next.deniedCapabilities) !== JSON.stringify(before.deniedCapabilities);
    this.record = { ...next, grantGeneration: before.grantGeneration + (changed ? 1 : 0) };
    return { record: this.record, changed };
  }

  #recompute(row: PluginRecord): PluginRecord {
    const granted: string[] = [];
    const denied: PluginRecord["deniedCapabilities"] = [];
    for (const capability of row.requestedCapabilities) {
      if (this.#decisions[capability] === false) denied.push({ capability, reason: "revoked" });
      else granted.push(capability);
    }
    return { ...row, grantedCapabilities: row.enabled ? granted : [], deniedCapabilities: denied };
  }
}

interface Desktop {
  name: string;
  settings: SettingsDocService;
  docs: DocumentService;
  registry: MemoryRegistry;
  reconciler: InstallSetReconciler;
  audit: AuditRow[];
  /** every local commit the host announced, in order (what a peer is sent) */
  announced: Uint8Array[];
}

async function desktop(
  name: string,
  opts: { legacy?: LoroDoc; revoked?: readonly string[] } = {},
): Promise<Desktop> {
  const dataDir = mkdtempSync(join(tmpdir(), `vf-pa32-${name}-`));
  cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
  if (opts.legacy !== undefined) {
    const file = join(dataDir, ...LAYOUT.SETTINGS_DOC);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, opts.legacy.export({ mode: "snapshot" }));
  }
  const settings = new SettingsDocService({ dataDir });
  await settings.ready();
  cleanup.push(() => settings.dispose());
  const announced: Uint8Array[] = [];
  const docs = new DocumentService({
    dataDir,
    onCommit: (commit) => {
      if (commit.docId === SETTINGS_ID) announced.push(commit.payload);
    },
  });
  cleanup.push(() => docs.dispose());
  docs.registerSystemDoc(SETTINGS_ID, "Settings", settings.hostDoc(), settings.hostOwner());
  const registry = new MemoryRegistry(opts.revoked);
  const audit: AuditRow[] = [];
  const reconciler = new InstallSetReconciler({
    settingsDoc: settings,
    plugins: registry as unknown as PluginRegistryService,
    installer: {
      install: async () => {
        throw new Error("this harness installs nothing");
      },
    } as unknown as RegistryInstallService,
    teardown: async () => undefined,
    restart: () => undefined,
    audit: {
      requiredSystem: async (
        mutation: Parameters<AuditService["requiredSystem"]>[0],
        effect: () => unknown,
        describe?: (value: unknown) => { attrs?: Readonly<Record<string, unknown>> },
      ) => {
        const value = await effect();
        audit.push({
          action: mutation.action,
          ...(mutation.target.kind === "capability" ? { capability: mutation.target.id } : {}),
          origin: "settings-doc",
          ...(mutation.reasonCode !== undefined ? { reasonCode: mutation.reasonCode } : {}),
          attrs: { ...(mutation.attrs ?? {}), ...(describe?.(value).attrs ?? {}) },
        });
        return value;
      },
    } as unknown as Pick<AuditService, "requiredSystem">,
  });
  reconciler.attach();
  await reconciler.reconcile();
  return { name, settings, docs, registry, reconciler, audit, announced };
}

/** Let the reconciler finish what the last change started. */
async function settle(d: Desktop): Promise<void> {
  await d.reconciler.reconcile();
  await new Promise((r) => setTimeout(r, 25));
  await d.reconciler.reconcile();
}

/** A reconnect from `from` to `to`: the VERSION exchange the doc-sync lane runs. */
async function deliver(from: Desktop, to: Desktop): Promise<void> {
  const theirs = await to.docs.hostVersion(SETTINGS_ID);
  if (theirs === null) throw new Error(`${to.name} does not host the settings document`);
  const answer = await from.docs.hostAnswer(SETTINGS_ID, theirs);
  if (answer === null) throw new Error(`${from.name} cannot answer for the settings document`);
  if (answer.update !== null) {
    const outcome = await to.docs.applyRemoteRecord(SETTINGS_ID, {
      kind: DOC_SYNC_RECORD.UPDATE,
      meta: answer.meta,
      payload: answer.update,
    });
    expect(outcome.applied, `${from.name} → ${to.name}`).toBe(true);
  }
  await settle(to);
}

/** Both ways, in the order the row names. */
async function reconnect(a: Desktop, b: Desktop, order: "A first" | "B first"): Promise<void> {
  if (order === "A first") {
    await deliver(a, b);
    await deliver(b, a);
  } else {
    await deliver(b, a);
    await deliver(a, b);
  }
  await settle(a);
  await settle(b);
}

/** The user revokes or grants on this desktop, as `plugins.grants.set` does it:
 * the device-local decision, the handler's own audit row, then the publication. */
async function decide(d: Desktop, capability: string, granted: boolean): Promise<void> {
  const { record, changed } = await d.registry.setGrant(PA32_ID, capability, granted);
  d.audit.push({
    action: granted ? "capability.grant" : "capability.revoke",
    capability,
    origin: "local",
  });
  await d.reconciler.publish(record, "grants", { capability, granted, changed });
  await settle(d);
}

/** The user flips the plugin off and on — two publications, neither about grants. */
async function toggle(d: Desktop): Promise<void> {
  await d.reconciler.publish(await d.registry.disable(PA32_ID), "disable");
  await settle(d);
  await d.reconciler.publish(await d.registry.enable(PA32_ID), "enable");
  await settle(d);
}

/** Desktops A and B holding one shared, merged install-set entry. */
async function sharedPair(grants: GrantDecision[]): Promise<[Desktop, Desktop]> {
  const revoked = grants.filter((g) => g.decision === "revoked").map((g) => g.capability);
  const a = await desktop("A", { revoked });
  const b = await desktop("B", { revoked });
  await a.settings.setInstallSetEntry(
    { pluginId: PA32_ID, source: "bundled", enabled: true, grants },
    "seed",
  );
  await settle(a);
  await reconnect(a, b, "A first");
  a.audit.length = 0;
  b.audit.length = 0;
  return [a, b];
}

const isGranted = (d: Desktop, capability: string): boolean =>
  d.registry.record.grantedCapabilities.includes(capability);
const count = (d: Desktop, action: string, capability: string): number =>
  d.audit.filter((row) => row.action === action && row.capability === capability).length;
const entryOf = async (d: Desktop): Promise<InstallSetEntry | undefined> =>
  (await d.settings.installSet())[PA32_ID];
const grantRow = (capability: string, decision: "granted" | "revoked"): GrantDecision => ({
  capability,
  decision,
  at: 1,
});

describe("PA-32 across desktops — revocation wins the merge (DS-5b)", () => {
  for (const order of ["A first", "B first"] as const) {
    it(`(a) A revokes c while B, offline, holds the grant — merged ${order}: revoked on both, audited once each`, async () => {
      const [a, b] = await sharedPair([grantRow(CAP, "granted"), grantRow(BYSTANDER, "granted")]);
      await decide(a, CAP, false);
      // B, offline, never saw it: it flips the plugin off and on — two later
      // publications, so its Lamport clock runs past A's revocation.
      await toggle(b);
      await reconnect(a, b, order);

      for (const d of [a, b]) {
        expect(isGranted(d, CAP), `${d.name} holds c`).toBe(false);
        expect(d.registry.record.deniedCapabilities, d.name).toContainEqual({
          capability: CAP,
          reason: "revoked",
        });
        expect(count(d, "capability.revoke", CAP), `${d.name} revocations audited`).toBe(1);
        expect(count(d, "capability.grant", CAP), `${d.name} re-grants audited`).toBe(0);
        // B's own act — the enablement — crossed independently
        expect(d.registry.record.enabled, d.name).toBe(true);
        expect(isGranted(d, BYSTANDER), d.name).toBe(true);
      }
      expect(b.audit.find((row) => row.capability === CAP)?.origin).toBe("settings-doc");
      expect((await entryOf(a))?.revocationGenerations?.[CAP]).toBe(1);
    });
  }

  it("(b) B re-grants c after it saw the revocation — the grant stands on both, though A wrote later", async () => {
    const [a, b] = await sharedPair([grantRow(CAP, "granted"), grantRow(BYSTANDER, "granted")]);
    await decide(a, CAP, false);
    await reconnect(a, b, "A first");
    expect(isGranted(b, CAP), "B took the revocation").toBe(false);
    a.audit.length = 0;
    b.audit.length = 0;

    await decide(b, CAP, true); // a NEW decision, made knowing the revocation
    await toggle(a); // concurrently A flips the plugin off and on — two later writes
    await reconnect(a, b, "B first");

    for (const d of [a, b]) expect(isGranted(d, CAP), `${d.name} holds c`).toBe(true);
    expect(count(a, "capability.grant", CAP), "A applied the re-grant once").toBe(1);
    const decision = (await entryOf(a))?.grants.find((g) => g.capability === CAP);
    expect(decision).toMatchObject({ decision: "granted", revocationGeneration: 1 });
  });

  for (const order of ["A first", "B first"] as const) {
    it(`(c) A revokes c again while B grants it at the OLD generation — merged ${order}: revoked on both`, async () => {
      const [a, b] = await sharedPair([grantRow(CAP, "revoked"), grantRow(BYSTANDER, "granted")]);
      // B's clock runs ahead, so its stale grant is the register's last writer
      await b.settings.setAppValue("desktop.showTray", false, "pane");
      await b.settings.setAppValue("desktop.showTray", true, "pane");
      await decide(b, CAP, true); // B grants at the generation it holds
      await decide(a, CAP, false); // concurrently, A revokes once more
      await reconnect(a, b, order);

      for (const d of [a, b]) expect(isGranted(d, CAP), `${d.name} holds c`).toBe(false);
      expect(count(a, "capability.grant", CAP), "A never re-granted").toBe(0);
      const applied = b.audit.filter(
        (row) => row.origin === "settings-doc" && row.capability === CAP,
      );
      expect(applied, "B's grant was revoked by the bias, once").toMatchObject([
        { action: "capability.revoke", reasonCode: "REVOCATION_BIAS" },
      ]);
      expect((await entryOf(b))?.revocationGenerations?.[CAP]).toBe(2);
    });
  }

  it("(c) two revocations, a grant that saw one: B revokes and re-grants while A revokes — the count holds both", async () => {
    const [a, b] = await sharedPair([grantRow(CAP, "granted"), grantRow(BYSTANDER, "granted")]);
    await decide(a, CAP, false); // A's revocation
    await decide(b, CAP, false); // B's own, concurrent
    await decide(b, CAP, true); // B re-grants, having seen ONE revocation — its own
    await reconnect(a, b, "A first");

    // A generation that merged as a max (1 and 1) would let B's grant stand.
    for (const d of [a, b]) expect(isGranted(d, CAP), `${d.name} holds c`).toBe(false);
    for (const d of [a, b]) expect((await entryOf(d))?.revocationGenerations?.[CAP]).toBe(2);
    expect(count(a, "capability.grant", CAP), "A never re-granted").toBe(0);
  });

  it("§16.6's other law holds through the new publish: a dev-linked or sideloaded plugin never enters the document", async () => {
    // A guard, not a red proof: publish() was rewritten around this early
    // return, which the old publish had too.
    const a = await desktop("A");
    for (const source of ["dev-linked", "sideload"] as const) {
      a.registry.record = { ...a.registry.record, source };
      await decide(a, CAP, false);
      await decide(a, CAP, true);
      await toggle(a);
    }
    expect(await a.settings.installSet()).toEqual({});
    expect(a.announced, "nothing announced to a peer").toEqual([]);
  });

  it("a revocation crosses as ONE update: the generation and the revoked decision together", async () => {
    const [a, b] = await sharedPair([grantRow(CAP, "granted"), grantRow(BYSTANDER, "granted")]);
    const before = a.announced.length;
    await decide(a, CAP, false);
    const sent = a.announced.slice(before);
    expect(sent, "one commit announced for the revocation").toHaveLength(1);
    const outcome = await b.docs.applyRemoteRecord(SETTINGS_ID, {
      kind: DOC_SYNC_RECORD.UPDATE,
      meta: { baseEpoch: 0, engineSchema: null, savedAt: Date.now() },
      payload: sent[0] as Uint8Array,
    });
    expect(outcome.applied).toBe(true);
    await settle(b);
    const entry = await entryOf(b);
    expect(entry?.revocationGenerations?.[CAP]).toBe(1);
    expect(entry?.grants.find((g) => g.capability === CAP)).toMatchObject({
      decision: "revoked",
      revocationGeneration: 1,
    });
    expect(isGranted(b, CAP)).toBe(false);
  });

  it("(f) desktops whose settings predate the stamps adopt them and merge — the old revocation still wins", async () => {
    // P7's layout on disk: ONE whole entry per plugin, no stamps. B's entry was
    // written later (its clock ahead), the write P7's merge let win.
    const legacy = (grants: GrantDecision[], extraCommits: number): LoroDoc => {
      const doc = new LoroDoc();
      for (let i = 0; i < extraCommits; i++) {
        doc.getMap(SETTINGS_DOC_SECTIONS.APP).set("desktop.showTray", i % 2 === 0);
        doc.commit();
      }
      doc.getMap(SETTINGS_DOC_SECTIONS.INSTALL_SET).set(PA32_ID, {
        pluginId: PA32_ID,
        source: "bundled",
        enabled: true,
        grants,
      } as never);
      doc.commit();
      return doc;
    };
    const a = await desktop("A", {
      legacy: legacy([grantRow(CAP, "revoked"), grantRow(BYSTANDER, "granted")], 0),
    });
    const b = await desktop("B", {
      legacy: legacy([grantRow(CAP, "granted"), grantRow(BYSTANDER, "granted")], 3),
    });
    // Each adopted its own: the old entry parses and APPLIES — A's registry
    // started with c granted, and its reconciler revoked it from the old entry.
    expect(isGranted(a, CAP)).toBe(false);
    expect(count(a, "capability.revoke", CAP)).toBe(1);
    expect(isGranted(b, CAP)).toBe(true);
    a.audit.length = 0;
    b.audit.length = 0;

    await reconnect(a, b, "A first");

    for (const d of [a, b]) expect(isGranted(d, CAP), `${d.name} holds c`).toBe(false);
    expect(count(a, "capability.grant", CAP), "A never re-granted").toBe(0);
    expect(count(b, "capability.revoke", CAP), "B took the revocation once").toBe(1);
    for (const d of [a, b]) {
      // and every desktop now holds the per-field layout alone
      const raw = d.settings.hostDoc().getMap(SETTINGS_DOC_SECTIONS.INSTALL_SET);
      expect(raw.keys(), `${d.name}'s P7 section`).toEqual([]);
    }
  });
});
