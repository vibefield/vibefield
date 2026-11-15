import { randomBytes } from "node:crypto";
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
import { type CapturedLog, captureLogger } from "./drive-fakes";
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
    // MK-2c: VibeField's own rung, signed by this test's key (the gate refuses a community entry)
    plugins: [{ manifestDir: KV_DIR, artifactBytes: bytes, rung: "R1" }],
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

// MK-2d (fix): a removal is whole only when its audit outcome is written. The reconciler's removeHere tears the
// plugin down, removes its code (the folder goes), re-reads the plugin table (the row goes), retires it, and only
// then writes the outcome. A busy host can read between those steps, so the test waits for the last of them. A
// segment read mid-append is "not yet", never a red: the verified read after this wait is the one that asserts.
async function untilAuditOutcome(dataDir: string, action: string, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  const root = join(dataDir, "audit");
  for (;;) {
    for (const name of readdirSync(root).filter((entry) => entry.endsWith(".jsonl"))) {
      const verified = await verifyAuditSegment(join(root, name));
      if (
        verified.valid &&
        verified.records.some((r) => r.action === action && r.phase === "outcome")
      )
        return;
    }
    if (Date.now() > deadline)
      throw new Error(`untilAuditOutcome: no ${action} outcome within ${ms} ms`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
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
  /** MK-2d: the record's code was removed here (the fake uninstall's effect) */
  #gone = false;

  constructor(revoked: readonly string[] = [], source: PluginRecord["source"] = "bundled") {
    for (const capability of revoked) this.#decisions[capability] = false;
    this.record = this.#recompute({
      id: PA32_ID,
      version: "1.0.0",
      title: "PA-32 fixture",
      source,
      manifestHash: `sha256:${"0".repeat(64)}`,
      installRevision: "r1",
      state: "enabled",
      compatible: true,
      enabled: true,
      requestedCapabilities: [CAP, BYSTANDER],
      grantedCapabilities: [],
      deniedCapabilities: [],
      grantGeneration: 0,
      contributions: {
        widgets: [],
        objects: [],
        behaviors: [],
        commands: [],
        surfaces: [],
        capabilities: [],
      },
      renderer: "inactive",
      service: "none",
    });
  }

  get(id: string): PluginRecord | undefined {
    return id === PA32_ID && !this.#gone ? this.record : undefined;
  }

  /** MK-O3 (O3-C): this desktop holds nothing for community plugins being off. */
  isHeld(_id: string): boolean {
    return false;
  }

  /** MK-2d: the code removed (gone) or installed again (back). */
  forget(): void {
    this.#gone = true;
  }

  restore(): void {
    this.#gone = false;
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

/** MK-2d: what R3 asked of this desktop, in order: a fake teardown, uninstall and retire that start nothing. */
interface RemovalCalls {
  teardown: string[];
  uninstall: Array<[string, boolean]>;
  retire: string[];
  logs: CapturedLog[];
}

const removalCalls = (): RemovalCalls => ({ teardown: [], uninstall: [], retire: [], logs: [] });

async function desktop(
  name: string,
  opts: {
    legacy?: LoroDoc;
    revoked?: readonly string[];
    source?: PluginRecord["source"];
    calls?: RemovalCalls;
    /** test-only: the installer's first step, awaited before it refuses as it always has (the grant race's row) */
    install?: (id: string) => Promise<void>;
  } = {},
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
  const registry = new MemoryRegistry(opts.revoked, opts.source);
  const audit: AuditRow[] = [];
  const calls = opts.calls;
  const reconciler = new InstallSetReconciler({
    settingsDoc: settings,
    plugins: registry as unknown as PluginRegistryService,
    installer: {
      install: async (request: { id: string }) => {
        await opts.install?.(request.id);
        throw new Error("this harness installs nothing");
      },
      uninstall: async (id: string, removeData: boolean) => {
        calls?.uninstall.push([id, removeData]);
        registry.forget();
      },
    } as unknown as RegistryInstallService,
    teardown: async (id: string) => {
      calls?.teardown.push(id);
    },
    retire: (id: string) => {
      calls?.retire.push(id);
    },
    ...(calls !== undefined ? { logger: captureLogger(calls.logs) } : {}),
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
  await merge(from, to);
  await settle(to);
}

/** The exchange alone: `to`'s host merges what it lacks and tells its listeners; nothing waits for the walk. */
async function merge(from: Desktop, to: Desktop): Promise<void> {
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
  await d.reconciler.grantAct(PA32_ID, capability, granted, async () => {
    const { record, changed } = await d.registry.setGrant(PA32_ID, capability, granted);
    d.audit.push({
      action: granted ? "capability.grant" : "capability.revoke",
      capability,
      origin: "local",
    });
    return { record, changed, value: undefined };
  });
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

// --- E10 across desktops: a removal travels (MK-2d; VF-PM 2026-11-11 10:34:14Z) -----------------------------
//
// R3 on the harness above: a fake teardown, uninstall and retire that start nothing and record what they were asked
// (no child, no real data dir). The removal is the door's own path on one desktop (its code gone, then `unpublish`),
// and reaches the other through the host's merge path.

/** Desktops A and B, each holding the plugin from the registry, with one shared, merged install-set entry. */
async function registryPair(): Promise<[Desktop, Desktop, RemovalCalls, RemovalCalls]> {
  const callsA = removalCalls();
  const callsB = removalCalls();
  const a = await desktop("A", { source: "registry", calls: callsA });
  const b = await desktop("B", { source: "registry", calls: callsB });
  await a.settings.setInstallSetEntry(
    { pluginId: PA32_ID, source: "registry", version: "1.0.0", enabled: true, grants: [] },
    "seed",
  );
  await settle(a);
  await reconnect(a, b, "A first");
  a.audit.length = 0;
  b.audit.length = 0;
  return [a, b, callsA, callsB];
}

/** The uninstall door on this desktop: its own code gone, then the removal published. */
async function removeHere(d: Desktop): Promise<void> {
  d.registry.forget();
  await d.reconciler.unpublish(PA32_ID, "uninstall");
  await settle(d);
}

describe("E10 across desktops — a removal travels, data kept (MK-2d)", () => {
  it("R3: a removal from A removes B's code with data kept, retires it, audits it, and says it once", async () => {
    const [a, b, callsA, callsB] = await registryPair();
    await removeHere(a);
    await deliver(a, b);
    expect(callsB.teardown).toEqual([PA32_ID]);
    // the literal `false`: whether data goes is never the doc's
    expect(callsB.uninstall).toEqual([[PA32_ID, false]]);
    expect(callsB.retire).toEqual([PA32_ID]);
    const removal = b.audit.filter((row) => row.action === "plugin.uninstall");
    expect(removal.length).toBe(1);
    expect(removal[0]?.attrs).toMatchObject({ origin: "settings-doc", removeData: false });
    const said = callsB.logs.filter((l) => l.event === "fieldd.install_reconciler.removed");
    expect(said.map((l) => l.attrs)).toEqual([
      { pluginId: PA32_ID, reason: "removed-in-settings" },
    ]);
    await settle(b);
    expect(callsB.uninstall.length).toBe(1);
    // A's own code went through its door, not through R3
    expect(callsA.uninstall).toEqual([]);
  });

  for (const order of ["A first", "B first"] as const) {
    it(`a removal on A and B's concurrent explicit install end as removed on both — merged ${order}`, async () => {
      const [a, b, , callsB] = await registryPair();
      await removeHere(a);
      // B, offline, installs a new version: its stamp saw no removal
      await b.settings.updateInstallSet(
        PA32_ID,
        { identity: { source: "registry", version: "2.0.0" }, enabled: true },
        "install",
      );
      await reconnect(a, b, order);
      for (const d of [a, b]) {
        expect(await entryOf(d)).toBeUndefined();
        expect([...(await d.settings.removedPlugins())]).toEqual([PA32_ID]);
      }
      expect(callsB.uninstall).toEqual([[PA32_ID, false]]);
    });
  }

  it("two concurrent removals and a reinstall that saw one of them end as removed", async () => {
    const [a, b, callsA] = await registryPair();
    await removeHere(a);
    await removeHere(b);
    // A installs again, having seen its own removal alone
    a.registry.restore();
    await a.reconciler.publish(a.registry.record, "install");
    await settle(a);
    await reconnect(a, b, "A first");
    for (const d of [a, b]) expect(await entryOf(d)).toBeUndefined();
    expect(callsA.uninstall).toEqual([[PA32_ID, false]]);
  });

  it("a bundled plugin is never removed by the doc", async () => {
    const callsA = removalCalls();
    const callsB = removalCalls();
    const a = await desktop("A", { calls: callsA });
    const b = await desktop("B", { calls: callsB });
    await a.settings.setInstallSetEntry(
      { pluginId: PA32_ID, source: "bundled", enabled: true, grants: [] },
      "seed",
    );
    await settle(a);
    await reconnect(a, b, "A first");
    await a.reconciler.unpublish(PA32_ID, "uninstall");
    await deliver(a, b);
    expect([callsB.teardown, callsB.uninstall, callsB.retire]).toEqual([[], [], []]);
    expect(b.registry.get(PA32_ID)?.source).toBe("bundled");
  });
});

describe("E10 on a booted daemon (MK-2d)", () => {
  it("a removal from another desktop removes the code here and keeps the data, byte for byte", {
    timeout: 60_000,
  }, async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "vf-rec-e10-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await mock.start();
    cleanup.push(() => mock.stop());
    const registry = await setupRegistry();
    const seed = new SettingsDocService({ dataDir });
    await seed.setInstallSetEntry(
      { pluginId: KV_ID, source: "registry", version: "0.1.0", enabled: true, grants: [] },
      "another-desktop",
    );
    await seed.dispose();

    let first: FielddDaemon | null = await bootstrap({
      dataDir,
      controlPort: 0,
      registryUrl: registry.registryUrl,
      registryPublicKey: registry.publicKey,
    });
    cleanup.push(async () => {
      if (first !== null) await first.stop();
    });
    await until(() => first?.plugins.get(KV_ID) !== undefined, 20_000);
    const installed = join(dataDir, "plugins", "installed", KV_ID);
    expect(existsSync(installed)).toBe(true);
    // the plugin's data: the test's own bytes, in its own temp root
    const dataFile = join(dataDir, "plugins", KV_ID, "mk-2d.bin");
    mkdirSync(dirname(dataFile), { recursive: true });
    const bytes = randomBytes(4096);
    writeFileSync(dataFile, bytes);
    await first.stop();
    first = null;

    // the removal arrives as another desktop's, written into the doc this test owns while fieldd is down
    const peer = new SettingsDocService({ dataDir });
    await peer.removeInstallSetEntry(KV_ID, "another-desktop");
    await peer.dispose();

    const second = await boot(dataDir, registry);
    // the code goes first (plugin-install.ts's uninstall), the table's row after its re-read, the audit outcome
    // last: wait for all three before asserting any (V-MK1b read the row between the first two, at a load of 100+)
    await until(
      () => !existsSync(installed) && second.plugins.get(KV_ID) === undefined,
      20_000,
      "the code and the row gone",
    );
    await untilAuditOutcome(dataDir, "plugin.uninstall", 20_000);
    expect(existsSync(installed)).toBe(false);
    expect(second.plugins.get(KV_ID)).toBeUndefined();
    expect(readFileSync(dataFile).equals(bytes)).toBe(true);
    const audit = await auditRecords(dataDir);
    const removal = audit.filter((r) => r.action === "plugin.uninstall");
    expect(removal.map((r) => [r.phase, r.outcome ?? null])).toEqual([
      ["attempt", null],
      ["outcome", "succeeded"],
    ]);
    expect(removal[0]?.attrs).toMatchObject({ origin: "settings-doc", removeData: false });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The grant race (2026-11-15). A person's grant act is the last word on this desktop until their next act. The
// handler (`plugins.grants.set`) moves the registry, recycles the plugin's principals, and only then publishes; a
// walk raised in that gap (by this desktop's own earlier publication, or by any peer merge) read the doc's OLDER
// decision and applied it over the act: in OFF, the plugin restarted holding a capability the person had just
// revoked, and the handler answered the re-granted record. A walk already past its wait did the same after the
// act had published. `actInGap` stands where the handler stands after its registry move; the function it returns
// is the rest of the handler.
//
// Time: no row's GREEN depends on it. A walk the fix holds back cannot reach its power, however long the row
// waits. `walkNow` gives an unheld walk 25 ms to run (it is in memory, no I/O) before the row samples the gap;
// a slower host only moves the walk's power later, where the trace still records it.

const BLOCKER = "a.fixture.blocker"; // a registry entry this desktop lacks; its install is the row's to hold

type Trace = { by: "person" | "walk"; granted: boolean }[];
const marks = new WeakMap<Desktop, () => void>();

/** One desktop holding a seeded, settled install-set entry. */
async function solo(
  grants: GrantDecision[],
  install?: (id: string) => Promise<void>,
): Promise<Desktop> {
  const revoked = grants.filter((g) => g.decision === "revoked").map((g) => g.capability);
  const d = await desktop("A", { revoked, ...(install !== undefined ? { install } : {}) });
  await d.settings.setInstallSetEntry(
    { pluginId: PA32_ID, source: "bundled", enabled: true, grants },
    "seed",
  );
  await settle(d);
  d.audit.length = 0;
  return d;
}

/** Every registry move of `capability` from now on, in order, marked the person's (by `actInGap`) or a walk's:
 * every state a read could see. */
function traceGrants(d: Desktop, capability: string): Trace {
  const trace: Trace = [];
  const setGrant = d.registry.setGrant.bind(d.registry);
  let person = false;
  marks.set(d, () => {
    person = true;
  });
  d.registry.setGrant = async (id, cap, granted) => {
    const by = person ? "person" : "walk";
    person = false;
    const out = await setGrant(id, cap, granted);
    if (cap === capability)
      trace.push({ by, granted: out.record.grantedCapabilities.includes(capability) });
    return out;
  };
  return trace;
}

/** The person's act up to the handler's gap, through the lane as the handler goes: the registry moved, the
 * handler's own audit row, the recycle held by the row. The returned function is the rest of the handler: `latest`
 * read after the recycle, then the publication `grantAct` starts; its promise is the handler's return. */
async function actInGap(
  d: Desktop,
  capability: string,
  granted: boolean,
): Promise<() => Promise<void>> {
  let moved: () => void = () => undefined;
  const inGap = new Promise<void>((resolve) => {
    moved = resolve;
  });
  let recycled: () => void = () => undefined;
  const recycle = new Promise<void>((resolve) => {
    recycled = resolve;
  });
  const done = d.reconciler.grantAct(PA32_ID, capability, granted, async () => {
    marks.get(d)?.();
    const { changed } = await d.registry.setGrant(PA32_ID, capability, granted);
    d.audit.push({
      action: granted ? "capability.grant" : "capability.revoke",
      capability,
      origin: "local",
    });
    moved();
    await recycle; // the handler's recycle, held by the row
    return { record: d.registry.record, changed, value: undefined };
  });
  await inGap;
  return async () => {
    recycled();
    await done;
  };
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A walk raised now, given 25 ms to run unheld; the walk itself, boxed, for the row to await once the act is done.
 * Boxed because an async function that returns a promise adopts it: its caller would wait for the walk to end. */
async function walkNow(d: Desktop): Promise<{ walk: Promise<void> }> {
  const walk = d.reconciler.reconcile();
  await Promise.race([walk, pause(25)]);
  return { walk };
}

/** The doc's next install-set write throws, once: the disk refused it. */
function failNextInstallSetWrite(d: Desktop): void {
  const write = d.settings.updateInstallSet.bind(d.settings);
  let failed = false;
  d.settings.updateInstallSet = async (
    ...args: Parameters<SettingsDocService["updateInstallSet"]>
  ) => {
    if (!failed) {
      failed = true;
      throw new Error("the disk refused the write (the row's)");
    }
    return write(...args);
  };
}

/** The invariant, held three ways after the person's LAST act:
 * (1) every registry state from that act on equals it (the trace);
 * (2) the record the handler answers (`latest`, read at its end) equals it — the row reads it in the gap;
 * (3) the ledger holds no settings-doc act of the opposite sense for the capability after it. */
function heldToLastAct(d: Desktop, trace: Trace, granted: boolean, ledgerFrom: number): void {
  const last = trace.map((t) => t.by).lastIndexOf("person");
  expect(last, "the person's last act is in the trace").toBeGreaterThanOrEqual(0);
  expect(
    trace.slice(last).map((t) => t.granted),
    "every state after the person's last act",
  ).toEqual(trace.slice(last).map(() => granted));
  const opposite = granted ? "capability.revoke" : "capability.grant";
  expect(
    d.audit
      .slice(ledgerFrom)
      .filter(
        (row) => row.origin === "settings-doc" && row.capability === CAP && row.action === opposite,
      ),
    `no settings-doc ${opposite} after the person's last act`,
  ).toEqual([]);
}

describe("the grant race: a person's act is the last word here until their next act", () => {
  for (const [dir, first, second] of [
    ["OFF (a grant, then a revoke while the grant still publishes)", true, false],
    ["ON (a revoke, then a grant while the revoke still publishes)", false, true],
  ] as const) {
    it(`${dir}: the walk raised by this desktop's own earlier act`, async () => {
      const seed = grantRow(CAP, first ? "revoked" : "granted");
      const d = await solo([seed, grantRow(BYSTANDER, "granted")]);
      const trace = traceGrants(d, CAP);

      const rest1 = await actInGap(d, CAP, first); // act 1, in its gap
      const done1 = rest1(); // act 1's handler ends; its publication runs, unawaited by it
      const rest2 = await actInGap(d, CAP, second); // act 2, in its gap
      const ledgerFrom = d.audit.length;
      await done1; // act 1's publication persisted and emitted; the walk it raised waited for act 1 alone
      const { walk } = await walkNow(d);

      expect(isGranted(d, CAP), "in act 2's gap, the registry holds act 2").toBe(second); // RED today
      await rest2();
      await walk;
      await settle(d);
      expect(isGranted(d, CAP), "after act 2's publication").toBe(second);
      heldToLastAct(d, trace, second, ledgerFrom);
    });

    it(`${dir}: the walk raised by a peer's merge of an unrelated setting`, async () => {
      const seed = grantRow(CAP, first ? "revoked" : "granted");
      const [a, b] = await sharedPair([seed, grantRow(BYSTANDER, "granted")]);
      await decide(a, CAP, first); // act 1, published, settled, and carried to B
      await reconnect(a, b, "A first");
      const trace = traceGrants(a, CAP);
      const rest2 = await actInGap(a, CAP, second); // act 2, in its gap
      const ledgerFrom = a.audit.length;
      // B moves a setting that is not a grant; the merge raises `changed {installSet}` on A all the same
      await b.settings.setAppValue("desktop.showTray", false, "pane");
      await merge(b, a);
      const { walk } = await walkNow(a);

      expect(isGranted(a, CAP), "in act 2's gap, the registry holds act 2").toBe(second); // RED today
      await rest2();
      await walk;
      await settle(a);
      expect(isGranted(a, CAP), "after act 2's publication").toBe(second);
      heldToLastAct(a, trace, second, ledgerFrom);
    });
  }

  it("a walk already past its wait never applies the doc it read before the act over the act", async () => {
    let reached: () => void = () => undefined;
    const atInstall = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    const d = await solo([grantRow(CAP, "granted"), grantRow(BYSTANDER, "granted")], async (id) => {
      if (id !== BLOCKER || held) return;
      held = true;
      reached();
      await gate; // the walk holds the doc it read, inside the blocker's install
    });
    await d.settings.setInstallSetEntry(
      { pluginId: BLOCKER, source: "registry", version: "1.0.0", enabled: true, grants: [] },
      "seed",
    );
    const order = Object.keys(await d.settings.installSet());
    // the harness's own precondition: a doc that orders PA-32 first makes this row prove nothing
    expect(order.indexOf(BLOCKER), "the blocker's entry is walked before PA-32's").toBeLessThan(
      order.indexOf(PA32_ID),
    );
    await atInstall;
    const walk = d.reconciler.reconcile(); // the walk in flight, its `desired` read before the act
    const trace = traceGrants(d, CAP);
    const rest = await actInGap(d, CAP, false);
    const ledgerFrom = d.audit.length;
    await rest(); // the whole act: the registry, the recycle, the publication
    // an act never waits for a walk to end: its publication commits while this walk is still held in the install
    let committed = false;
    for (let i = 0; i < 40 && !committed; i++) {
      committed =
        (await entryOf(d))?.grants.find((g) => g.capability === CAP)?.decision === "revoked";
      if (!committed) await pause(25);
    }
    expect(committed, "the act's publication committed while the walk was held").toBe(true);
    release();
    await walk;
    await settle(d);

    expect(isGranted(d, CAP), "after the walk ended").toBe(false); // a later pass revoked again, so this holds today
    heldToLastAct(d, trace, false, ledgerFrom); // RED today: the trace holds the walk's re-grant
  });

  it("a revoke whose publication parked is never re-granted here; a later publication carries it", async () => {
    const d = await solo([grantRow(CAP, "granted"), grantRow(BYSTANDER, "granted")]);
    const trace = traceGrants(d, CAP);
    failNextInstallSetWrite(d);
    const rest = await actInGap(d, CAP, false);
    const ledgerFrom = d.audit.length;
    await rest(); // its publication parks: `publish` catches and logs
    await settle(d);
    await settle(d);

    expect(isGranted(d, CAP), "after the parked revoke").toBe(false); // RED today: the walk re-granted it
    heldToLastAct(d, trace, false, ledgerFrom);
    const entry = await entryOf(d);
    expect(
      entry?.grants.find((g) => g.capability === CAP)?.decision,
      "a later publication carried the revoke to the doc",
    ).toBe("revoked");
    expect(entry?.revocationGenerations?.[CAP]).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The generation a grant names (2026-11-15). The header's law: a grant records the revocation generation IT SAW.
// The doc stamped the generation it held at the grant's COMMIT. So a peer's revocation that merged during the
// act's gap was stamped as seen, and the grant stood over a revocation the person never saw.

describe("the generation a grant names is the one its act saw", () => {
  it("a peer's revocation merged in a grant's gap stands: the grant applies as REVOKED (the bias)", async () => {
    const [a, b] = await sharedPair([grantRow(CAP, "granted"), grantRow(BYSTANDER, "granted")]);
    await decide(a, CAP, false); // the first revocation, carried to both
    await reconnect(a, b, "A first");
    expect((await entryOf(a))?.revocationGenerations?.[CAP]).toBe(1);
    a.audit.length = 0;
    b.audit.length = 0;

    const rest = await actInGap(a, CAP, true); // A's person grants, having seen ONE revocation
    await decide(b, CAP, true); // concurrently B's person grants and revokes again: a second revocation
    await decide(b, CAP, false);
    await merge(b, a); // B's second revocation reaches A inside the grant's gap
    const { walk } = await walkNow(a);
    await rest();
    await walk;
    await settle(a);
    await reconnect(a, b, "A first");

    const decision = (await entryOf(a))?.grants.find((g) => g.capability === CAP);
    expect(decision, "A's grant names the generation it saw").toMatchObject({
      decision: "granted",
      revocationGeneration: 1,
    });
    for (const d of [a, b]) {
      expect((await entryOf(d))?.revocationGenerations?.[CAP], d.name).toBe(2);
      expect(isGranted(d, CAP), `${d.name} holds c`).toBe(false); // RED today: the grant stood
    }
    expect(
      a.audit.filter((row) => row.origin === "settings-doc" && row.capability === CAP),
      "A applied its own grant as revoked by the bias, once",
    ).toMatchObject([{ action: "capability.revoke", reasonCode: "REVOCATION_BIAS" }]);
  });

  it("a grant that moved nothing still writes no decision, whatever generation it saw", async () => {
    const d = await solo([grantRow(CAP, "granted"), grantRow(BYSTANDER, "granted")]);
    const before = (await entryOf(d))?.grants.find((g) => g.capability === CAP);
    await decide(d, CAP, true); // granted already: the act moves nothing here
    expect((await entryOf(d))?.grants.find((g) => g.capability === CAP)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The disable race (2026-11-15). The disable handler (`plugins.disable`) moves the registry, then stops the
// service and kills the plugin's children, and only then publishes. A walk in that gap read the doc still enabled
// against a disabled record and ENABLED the plugin again, restarting it with fresh principals, until the disable's
// publication landed. Red until the lane takes the enablement section and the disable handler.

/** Every enablement move from now on, in order, marked the person's or a walk's (`granted` holds enablement). */
function traceEnabled(d: Desktop): Trace {
  const trace: Trace = [];
  let person = false;
  marks.set(d, () => {
    person = true;
  });
  for (const method of ["enable", "disable"] as const) {
    const move = d.registry[method].bind(d.registry);
    d.registry[method] = async (id: string) => {
      const by = person ? "person" : "walk";
      person = false;
      const out = await move(id);
      trace.push({ by, granted: out.enabled });
      return out;
    };
  }
  return trace;
}

/** The person's disable up to the handler's gap: the registry moved, the handler's own audit row, NO
 * publication. The returned function is the rest of the handler: `after` read, then `publish`. */
async function disableInGap(d: Desktop): Promise<() => Promise<void>> {
  marks.get(d)?.();
  await d.registry.disable(PA32_ID);
  d.audit.push({ action: "plugin.disable", origin: "local" });
  return () => d.reconciler.publish(d.registry.record, "disable");
}

/** The invariant after the person's last enablement act: every state equals it, and no settings-doc act of the
 * opposite sense follows it. */
function enabledHeldToLastAct(
  d: Desktop,
  trace: Trace,
  enabled: boolean,
  ledgerFrom: number,
): void {
  const last = trace.map((t) => t.by).lastIndexOf("person");
  expect(last, "the person's last act is in the trace").toBeGreaterThanOrEqual(0);
  expect(
    trace.slice(last).map((t) => t.granted),
    "every enablement state after the person's last act",
  ).toEqual(trace.slice(last).map(() => enabled));
  const opposite = enabled ? "plugin.disable" : "plugin.enable";
  expect(
    d.audit
      .slice(ledgerFrom)
      .filter((row) => row.origin === "settings-doc" && row.action === opposite),
    `no settings-doc ${opposite} after the person's last act`,
  ).toEqual([]);
}

describe("the disable race: a person's disable is the last word here until their next act", () => {
  it("a disable made while this desktop's enable still publishes is never enabled again by a walk", async () => {
    const d = await solo([grantRow(CAP, "granted"), grantRow(BYSTANDER, "granted")]);
    await d.reconciler.publish(await d.registry.disable(PA32_ID), "disable"); // off, published, settled
    await settle(d);
    const trace = traceEnabled(d);
    marks.get(d)?.();
    const enabled = await d.registry.enable(PA32_ID); // act 1, the enable: its publication runs, unawaited
    const published1 = d.reconciler.publish(enabled, "enable");
    const rest2 = await disableInGap(d); // act 2, the disable, in its gap
    const ledgerFrom = d.audit.length;
    await published1; // act 1's publication persisted and emitted; the walk it raised waited for act 1 alone
    const { walk } = await walkNow(d);

    expect(d.registry.record.enabled, "in the disable's gap, the plugin stays off").toBe(false); // RED today
    await rest2();
    await walk;
    await settle(d);
    expect(d.registry.record.enabled, "after the disable's publication").toBe(false);
    enabledHeldToLastAct(d, trace, false, ledgerFrom);
  });

  it("a disable in its gap is never enabled again by the walk a peer's merge raises", async () => {
    const [a, b] = await sharedPair([grantRow(CAP, "granted"), grantRow(BYSTANDER, "granted")]);
    const trace = traceEnabled(a);
    const rest = await disableInGap(a);
    const ledgerFrom = a.audit.length;
    await b.settings.setAppValue("desktop.showTray", false, "pane");
    await merge(b, a);
    const { walk } = await walkNow(a);

    expect(a.registry.record.enabled, "in the disable's gap, the plugin stays off").toBe(false); // RED today
    await rest();
    await walk;
    await settle(a);
    expect(a.registry.record.enabled, "after the disable's publication").toBe(false);
    enabledHeldToLastAct(a, trace, false, ledgerFrom);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The uninstall race (2026-11-15). The uninstall handler (`plugins.uninstall`) tears the plugin down and removes
// its code, and only then `unpublish`es; `unpublish` never enters `publishing`, so no walk waits for it. A walk
// before its commit found the doc's registry entry with no record here and INSTALLED the plugin again (its
// enablement followed, so it ran). Red until the lane takes the presence section and the uninstall handler.

/** The person's uninstall up to its `unpublish`: the handler's teardown and the code removed (`forget`). The
 * returned function is the rest of the handler, its `unpublish`; its promise is the removal's. */
async function uninstallInGap(d: Desktop): Promise<() => Promise<void>> {
  d.registry.forget();
  return () => d.reconciler.unpublish(PA32_ID, "uninstall");
}

describe("the uninstall race: a person's uninstall is the last word here", () => {
  it("a plugin the person just removed is never installed again by a walk before the removal commits", async () => {
    const calls = removalCalls();
    const installs: string[] = [];
    const d = await desktop("A", {
      source: "registry",
      calls,
      install: async (id) => {
        installs.push(id);
      },
    });
    await d.settings.setInstallSetEntry(
      { pluginId: PA32_ID, source: "registry", version: "1.0.0", enabled: true, grants: [] },
      "seed",
    );
    await settle(d);
    expect(installs, "the seed is present here: nothing to install").toEqual([]);

    const rest = await uninstallInGap(d); // the person's uninstall, up to its `unpublish`
    const { walk } = await walkNow(d); // any `changed` stands here: a peer merge, this desktop's earlier act
    expect(installs, "no walk installs what the person just removed").toEqual([]); // RED today
    await rest();
    await walk;
    await settle(d);

    expect(installs, "nor after the removal committed").toEqual([]);
    expect(await entryOf(d)).toBeUndefined();
    expect([...(await d.settings.removedPlugins())]).toEqual([PA32_ID]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The disable race, as an update meets it (2026-11-15). An update of a present, enabled plugin publishes `install`,
// whose change writes `enabled` from the record it was handed. Three rows, each holding that a person's disable is
// the last word here and in the doc:
// - the third: with the update's publication in flight, a person's disable in its gap and the walk it raises, the
//   plugin stays off (p5's first row with the update's own action);
// - the fourth: when one desktop's two publications would commit out of call order (a test-only seam holds the
//   first write), the doc's last enablement is still the disable's, never the update's stale one;
// - the fifth: the person's own update never carries a flipped record's enablement into the doc over their disable,
//   so the plugin stays off everywhere. It holds the rule that an install publication of a PRESENT entry writes
//   its identity only (enablement through `ensure`): James's pick on the board, 2026-11-15T01:22:08.253Z, "Fix before
//   the 0.9 tag, and yes: an install follows the account's on/off (Recommended)".

/** The person's update of the present plugin, as the update doors end: `publish(record, "install")`. Its promise is
 * the publication's. The fix's patch redefines it as a lane act (as p2 does `actInGap`); the rows do not change. */
function updateAct(d: Desktop): Promise<void> {
  return d.reconciler.publish(d.registry.record, "install");
}

/** The person's whole disable: the registry, the handler's own audit row, the publication. Its promise is the act's
 * whole, publication included. The fix's patch redefines it as a lane act; the rows do not change. */
async function disableAct(d: Desktop): Promise<void> {
  marks.get(d)?.();
  await d.registry.disable(PA32_ID);
  d.audit.push({ action: "plugin.disable", origin: "local" });
  await d.reconciler.publish(d.registry.record, "disable");
}

/** The ledger's index just past the person's last local disable row (the rows after it are what followed it). */
const pastLastDisable = (d: Desktop): number => {
  const disables = d.audit.map((row) => row.origin === "local" && row.action === "plugin.disable");
  return disables.lastIndexOf(true) + 1;
};

/** The doc's next install-set write waits until `release`; `held` resolves once that write has been reached. */
function holdNextInstallSetWrite(d: Desktop): { held: Promise<void>; release: () => void } {
  const write = d.settings.updateInstallSet.bind(d.settings);
  let first = true;
  let reached: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  d.settings.updateInstallSet = async (
    ...args: Parameters<SettingsDocService["updateInstallSet"]>
  ) => {
    if (first) {
      first = false;
      reached();
      await gate;
    }
    return write(...args);
  };
  return { held, release };
}

describe("the disable race, as an update's publication meets it", () => {
  it("a disable made while an update's publication (plugin on) still publishes is never undone", async () => {
    const d = await solo([grantRow(CAP, "granted"), grantRow(BYSTANDER, "granted")]);
    const trace = traceEnabled(d);
    const published1 = updateAct(d); // the update's publication, unawaited
    const rest2 = await disableInGap(d); // the person's disable, in its gap
    const ledgerFrom = d.audit.length;
    await published1; // the update's publication persisted and emitted; its walk waited for it alone
    const { walk } = await walkNow(d);

    expect(d.registry.record.enabled, "in the disable's gap, the plugin stays off").toBe(false); // RED today
    await rest2();
    await walk;
    await settle(d);
    expect(d.registry.record.enabled, "after the disable's publication").toBe(false);
    enabledHeldToLastAct(d, trace, false, ledgerFrom);
  });

  it("one desktop's publications land in its acts' order: a disable after an update stands", async () => {
    const d = await solo([grantRow(CAP, "granted"), grantRow(BYSTANDER, "granted")]);
    const trace = traceEnabled(d);
    const gate = holdNextInstallSetWrite(d);
    const updating = updateAct(d); // the update's publication: its write is held by the gate
    await gate.held;
    // The disable is STARTED, never awaited before the gate opens: the release must not wait on the act it gates.
    // Today it writes at once (no lane), the gate sees its write, and the update's stale write then lands LAST: red.
    // Under the fix the disable waits behind the update's lane hold (held until the update's publication settles,
    // which waits on this gate): no write is seen, the 1 s bound opens the gate, the update commits, then the disable
    // moves and publishes LAST: green. Time decides nothing green; the red side's proof is an in-memory write seen
    // within the bound.
    const disabling = disableAct(d);
    for (let i = 0; i < 40 && (await entryOf(d))?.enabled !== false; i += 1) await pause(25);
    gate.release();
    await updating;
    await disabling;
    await settle(d);
    const ledgerFrom = pastLastDisable(d);

    expect((await entryOf(d))?.enabled, "the doc's enablement is the last act").toBe(false); // RED today
    expect(d.registry.record.enabled, "the plugin is off here").toBe(false);
    enabledHeldToLastAct(d, trace, false, ledgerFrom);
  });

  it("a person's update never carries a flipped record's enablement into the doc over their disable", async () => {
    const d = await solo([grantRow(CAP, "granted"), grantRow(BYSTANDER, "granted")]);
    await d.reconciler.publish(await d.registry.disable(PA32_ID), "disable"); // off, published, settled
    await settle(d);
    // the record turned on again by a walk's flip, the doc still off: what the gap's race leaves
    await d.registry.enable(PA32_ID);
    await updateAct(d); // the person's update of the plugin
    await settle(d);

    // an install publication of a present entry writes its identity only (James's pick, 2026-11-15T01:22:08.253Z)
    expect((await entryOf(d))?.enabled, "the doc keeps the person's disable").toBe(false); // RED today
    expect(d.registry.record.enabled, "a walk turns the flipped record off again").toBe(false);
  });
});
