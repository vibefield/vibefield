// The agent runtime THROUGH fieldd (AR-2): puppeteer's first import. The
// runtime is built from the built-in providers with every path it would keep
// under ~/.puppeteer injected from THIS user's root; the persona path enrolls
// a profile's OBSERVATION root in the enrollment record under the kind the
// roll call joins; the distribution doors read native evidence and write the
// ONE machine-scope record under the root lock. Against the mock mgmt server,
// the scripted rosettad (test/fixtures/fake-rosettad.mjs) and a scripted
// `claude` on a PRIVATE search path (test/fixtures/fake-claude) that the
// claude adapter classifies from its version banner — nothing of the
// developer's is inspected, run, or written. The last block runs the persona
// path against the REAL rosettad when FIELDD_ROSETTAD_BIN names it.
import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AgentProfile,
  extensionActUnavailable,
  extensionSkillFolderPlan,
  type SkillItem,
} from "@vibecook/puppeteer-core";
import type { AgentProvider } from "@vibecook/puppeteer-runtime";
import {
  type AgentCatalogEntry,
  type AgentCatalogResult,
  type AgentDistributionRecord,
  type AgentProvidersResult,
  AgentsExtensionsActResult,
  AgentsExtensionsAddResult,
  AgentsExtensionsAddSkillResult,
  AgentsExtensionsCatalogResult,
  AgentsExtensionsListResult,
  AgentsExtensionsPlanResult,
  AgentsExtensionsPlanSkillResult,
  type AgentsInstallsResult,
  type AgentsOperationsResult,
  type AgentsProfileSetsDeleteResult,
  type AgentsProfileSetsListResult,
  type AgentsProfileSetsSetResult,
  type AgentsProfilesCreateResult,
  type AgentsProfilesDeleteResult,
  type AgentsProfilesListResult,
  type AgentsProfilesVerifyResult,
  type AgentsReleasesResult,
  type AgentsSetActiveResult,
  type AgentsUpdateResult,
  type IndexDiscoveriesResult,
  type IndexEnrollmentRecord,
  type IndexStatus,
  LAYOUT,
  SOCKETS,
  visibleCatalog,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import type { SecretStore } from "../src/plugin-settings";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { catalogWith } from "./agent-catalog-fixture";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const FAKE_ROSETTAD = join(FIXTURES, "fake-rosettad.mjs");
const FAKE_CLAUDE = join(FIXTURES, "fake-claude");
const fakeSpawner = (mode: string, env: Record<string, string> = {}): typeof spawn =>
  ((_bin: string, args: readonly string[], options: object) =>
    spawn(process.execPath, [FAKE_ROSETTAD, ...args], {
      ...options,
      env: { ...process.env, FAKE_ROSETTAD_MODE: mode, ...env },
    })) as unknown as typeof spawn;

/** the vendor's stable and latest release texts, and nothing else, reachable;
 * every request counted, so a door that must not reach the network can say so */
let fetches = 0;
const fakeFetch: typeof fetch = async (input) => {
  fetches += 1;
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url === "https://downloads.claude.ai/claude-code-releases/stable") {
    return new Response("2.2.0\n", { status: 200 });
  }
  if (url === "https://downloads.claude.ai/claude-code-releases/latest") {
    return new Response("2.3.0\n", { status: 200 });
  }
  return new Response("not here", { status: 404 });
};

const rendererParticipant = (suffix: string) => ({
  participantId: `renderer:desktop-test:window-${suffix}`,
  incarnation: `renderer:desktop-test:window-${suffix}:document-1`,
});
const ALL = ["agent.spawn", "agents.manage", "index.read", "index.manage"];

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.reverse()) await fn();
  cleanup = [];
});

/** The claude adapter's OWN probes (identity reads, sign-in, sign-out)
 * resolve `claude` from PUPPETEER_CLAUDE_BIN or PATH, not from the install
 * inventory's private search path — so every row pins it to the scripted
 * claude, and nothing here can run the developer's real agent (AR-S2: This
 * Mac's identities are read at a product boot). */
function pinClaude(bin: string): void {
  // Codex is the other adapter that reads who is signed in (its app-server);
  // a machine with a brew codex would otherwise have it run against the
  // developer's own ~/.codex. A path that does not exist fails that read fast.
  const pins: Record<string, string> = {
    PUPPETEER_CLAUDE_BIN: join(bin, "claude"),
    PUPPETEER_CODEX_BIN: join(bin, "no-real-codex"),
    FAKE_CLAUDE_STATE_DIR: bin,
  };
  for (const [name, value] of Object.entries(pins)) {
    const previous = process.env[name];
    process.env[name] = value;
    cleanup.push(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
}

async function setup(
  config: {
    rosettadBin?: string;
    mode?: string;
    real?: boolean;
    /** false = boot with NO VibeField root above the user root (no machine scope) */
    machine?: boolean;
    /** a registry written BEFORE boot (puppeteer's snapshot shape) */
    profiles?: {
      version: 1;
      profiles: unknown[];
    };
    /** boot as the product's daemon does: read the agents' installs at boot */
    warm?: boolean;
    /** compose providers beside puppeteer's built-ins (the extension rows' fakes) */
    providers?: (builtin: AgentProvider[]) => AgentProvider[];
    /** AC-3: the catalog the doors answer from (default: THE table) */
    catalog?: readonly AgentCatalogEntry[];
    /** AR-S4d: the keychain the daemon keeps values in (default: a map — never the machine's) */
    secretStore?: SecretStore;
  } = {},
): Promise<{ root: string; dataDir: string; bin: string; daemon: FielddDaemon }> {
  const root = mkdtempSync(join(tmpdir(), "vf-agents-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const dataDir = join(root, ...LAYOUT.USERS_DIR, "1");
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const bin = join(root, "bin");
  mkdirSync(bin);
  copyFileSync(FAKE_CLAUDE, join(bin, "claude"));
  pinClaude(bin);
  if (config.profiles !== undefined) {
    mkdirSync(join(dataDir, ...LAYOUT.AGENTS_DIR), { recursive: true });
    writeFileSync(
      join(dataDir, ...LAYOUT.AGENT_PROFILES_FILE),
      `${JSON.stringify(config.profiles)}\n`,
    );
  }
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  const home = join(dataDir, "home");
  mkdirSync(home, { recursive: true });
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    rosettadBin: config.rosettadBin ?? "/stand-in/rosettad",
    ...(config.real ? {} : { rosettadSpawn: fakeSpawner(config.mode ?? "ok") }),
    rosettadHome: home,
    ...(config.machine === false ? {} : { vibefieldRoot: root }),
    ...(config.catalog !== undefined ? { agentCatalog: config.catalog } : {}),
    agentSearchPath: bin,
    agentFetch: fakeFetch,
    ...(config.warm === true ? { agentInventoryWarm: true, logRoot: join(root, "logs") } : {}),
    ...(config.providers !== undefined ? { agentProviders: config.providers } : {}),
    secretStore: config.secretStore ?? memoryKeychain().store,
  });
  cleanup.push(() => daemon.stop().catch(() => undefined));
  return { root, dataDir, bin, daemon };
}

/** A keychain in a map, so no test here ever writes the machine's. */
function memoryKeychain() {
  const entries = new Map<string, string>();
  const store: SecretStore = {
    get: async (service, account) => entries.get(`${service}/${account}`) ?? null,
    set: async (service, account, value) => {
      entries.set(`${service}/${account}`, value);
    },
    delete: async (service, account) => {
      entries.delete(`${service}/${account}`);
    },
  };
  return { store, entries };
}

async function openRpc(port: number): Promise<WsRpc> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  cleanup.push(() => ws.close());
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return new WsRpc(ws);
}

/** A renderer window token holding exactly `scopes`. */
async function window(daemon: FielddDaemon, scopes: string[], suffix: string): Promise<WsRpc> {
  const shell = await openRpc(daemon.controlPort);
  await helloAs(shell, daemon.shellToken, "shell-main");
  const minted = (await shell.call("system.mintWindowToken", {
    scopes,
    label: `window-${suffix}`,
    rendererParticipant: rendererParticipant(suffix),
  })) as { token: string };
  const win = await openRpc(daemon.controlPort);
  await helloAs(win, minted.token);
  return win;
}

const ready = (daemon: FielddDaemon) =>
  until(() => daemon.health().rosettad.phase === "ready", 8_000);
const readRecord = (dataDir: string): IndexEnrollmentRecord =>
  JSON.parse(readFileSync(join(dataDir, ...LAYOUT.INDEX_ENROLLMENT_FILE), "utf8"));
/** the record's runtimes, [] when no daemon has published a record yet */
const recordRuntimes = (dataDir: string): IndexEnrollmentRecord["runtimes"] =>
  existsSync(join(dataDir, ...LAYOUT.INDEX_ENROLLMENT_FILE)) ? readRecord(dataDir).runtimes : [];
/** a record as an earlier daemon would have written it (AC-D8's scenario: the
 * binary changes under an enrolled kind) */
function writeRecord(dataDir: string, record: IndexEnrollmentRecord): void {
  const path = join(dataDir, ...LAYOUT.INDEX_ENROLLMENT_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record)}\n`);
}
const readDistribution = (root: string): AgentDistributionRecord =>
  JSON.parse(readFileSync(join(root, ...LAYOUT.MACHINE_DISTRIBUTION_FILE), "utf8"));
const mode = (path: string) => statSync(path).mode & 0o777;

/** every audit line under the user root, concatenated (the ledgers are JSONL) */
function auditText(dataDir: string): string {
  const dir = join(dataDir, ...LAYOUT.AUDIT_DIR);
  const walk = (d: string): string[] =>
    existsSync(d)
      ? readdirSync(d, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
        )
      : [];
  return walk(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");
}

async function untilAsync(fn: () => Promise<boolean>, ms: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`untilAsync: condition not met within ${ms}ms`);
}

describe("personas (AR-2) — the persona path against the scripted rosettad", () => {
  it("the runtime is real: every supporting provider's native-default persona is listed, without a path; a window needs agent.spawn", async () => {
    const { dataDir, daemon } = await setup();
    await ready(daemon);
    const win = await window(daemon, ["agent.spawn", "index.read"], "p1");
    const listed = (await win.call("agents.profiles.list", {})) as AgentsProfilesListResult;
    const ids = listed.personas.map((p) => p.profileId);
    expect(ids).toContain("claude:native-default");
    expect(ids).toContain("codex:native-default");
    expect(ids).toContain("pi:native-default");
    for (const persona of listed.personas) {
      expect(persona.kind).toBe("native-default");
      expect(persona.label).toBe("Default");
      expect(persona).not.toHaveProperty("dataRoot");
    }
    // the OS user's own claude root is the DISCOVERED runtime the fake lists
    // only when consented — nothing consented yet, so no runtimeId anywhere
    expect(listed.personas.every((p) => p.runtimeId === undefined)).toBe(true);
    const serialized = JSON.stringify(listed);
    expect(serialized).not.toContain(homedir());
    expect(serialized).not.toContain(dataDir);
    // a filter by provider
    const claude = (await win.call("agents.profiles.list", {
      provider: "claude",
    })) as AgentsProfilesListResult;
    expect(claude.personas.map((p) => p.profileId)).toEqual(["claude:native-default"]);
    // nothing on disk yet: listing touches no registry file
    expect(existsSync(join(dataDir, ...LAYOUT.AGENT_PROFILES_FILE))).toBe(false);

    const denied = await window(daemon, ["agents.manage"], "p1b");
    const err = await denied.callErr("agents.profiles.list", {});
    expect(err.data?.kind).toBe("FORBIDDEN_SCOPE");
  });

  it("signing an agent into an Agent Profile allocates its root INSIDE the profile's folder (0700), persists the registry v2 (0600), enrolls the observation root under the JOINED kind, bounces the daemon, and the persona carries its runtimeId", async () => {
    const { dataDir, daemon } = await setup();
    await ready(daemon);
    const firstPid = daemon.health().rosettad.pid;
    const win = await window(daemon, ALL, "p2");
    const { set } = (await win.call("agents.profileSets.create", {
      label: "Work",
      glyph: "briefcase",
    })) as AgentsProfileSetsSetResult;
    expect(set).toMatchObject({ id: "work", kind: "managed", label: "Work", default: false });
    const folder = join(dataDir, ...LAYOUT.AGENT_PROFILE_SETS_DIR, "work");
    expect(mode(folder)).toBe(0o700);
    const created = (await win.call("agents.profiles.create", {
      set: "work",
      provider: "claude",
    })) as AgentsProfilesCreateResult;
    const { persona } = created;
    expect(persona).toMatchObject({
      provider: "claude",
      label: "Work",
      kind: "managed",
      set: "work",
    });
    expect(persona).not.toHaveProperty("dataRoot");
    expect(persona.runtimeId).toBe("rt-claude-code-enrolled-1");

    // the root: inside the profile's folder, named for the agent, never reused
    const entries = readdirSync(folder);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^claude-[0-9a-f]{8}$/);
    const root = join(folder, entries[0] as string);
    expect(mode(root)).toBe(0o700);
    // nothing is allocated under the AR-1 roots directory any more
    expect(existsSync(join(dataDir, ...LAYOUT.AGENT_ROOTS_DIR))).toBe(false);
    // the registry: puppeteer's schema (version 2 — the sets beside the
    // sign-ins), fieldd's custody
    const registryPath = join(dataDir, ...LAYOUT.AGENT_PROFILES_FILE);
    expect(mode(registryPath)).toBe(0o600);
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    expect(registry).toMatchObject({
      version: 2,
      sets: [{ id: "work", kind: "managed", label: "Work", glyph: "briefcase", directory: folder }],
    });
    expect(registry.profiles).toEqual([
      expect.objectContaining({
        id: persona.profileId,
        provider: "claude",
        kind: "managed",
        dataRoot: root,
        set: "work",
      }),
    ]);
    // the record: the observation root (claude's = the profile root), the
    // kind the roll call joined (`~/.claude` ⇒ claude-code), the persona named
    expect(readRecord(dataDir).runtimes).toEqual([
      { kind: "claude-code", data_root: root, label: "Work", profile_id: persona.profileId },
    ]);
    // the daemon read it: a new generation, the runtime enrolled and watched
    expect(daemon.health().rosettad.pid).not.toBe(firstPid);
    const status = (await win.call("index.status", {})) as IndexStatus;
    expect(status.runtimes).toEqual([
      expect.objectContaining({
        runtimeId: "rt-claude-code-enrolled-1",
        kind: "claude-code",
        provenance: "enrolled",
        label: "Work",
        profileId: persona.profileId,
        watched: true,
      }),
    ]);
    expect(JSON.stringify(status)).not.toContain(root);
    // listed now, with the join — and still no path on the persona door
    const listed = (await win.call("agents.profiles.list", {
      provider: "claude",
    })) as AgentsProfilesListResult;
    expect(listed.personas.map((p) => [p.profileId, p.runtimeId])).toEqual([
      ["claude:native-default", undefined],
      [persona.profileId, "rt-claude-code-enrolled-1"],
    ]);
    expect(JSON.stringify(listed)).not.toContain(dataDir);
    // a profile holds one sign-in per agent; This Mac takes none
    const twice = await win.callErr("agents.profiles.create", { set: "work", provider: "claude" });
    expect(twice.data?.kind).toBe("PRECONDITION_FAILED");
    const native = await win.callErr("agents.profiles.create", {
      set: "native",
      provider: "claude",
    });
    expect(native.data?.kind).toBe("PRECONDITION_FAILED");
    const nowhere = await win.callErr("agents.profiles.create", {
      set: "ghost",
      provider: "claude",
    });
    expect(nowhere.data?.kind).toBe("NOT_FOUND");
    // audited: the attempt names the provider and the profile, the outcome the minted id
    const audit = auditText(dataDir);
    expect(audit).toContain('"agents.profiles.create"');
    expect(audit).toContain('"agents.profile_sets.create"');
    expect(audit).toContain(persona.profileId);
    expect(audit).toContain('"indexed":true');
  });
  it("a provider the roll call does not know is created but not indexed (runtimeId absent); verify reads an empty folder as signed out; unknown personas are refused typed", async () => {
    const { dataDir, daemon } = await setup();
    await ready(daemon);
    const win = await window(daemon, ALL, "p3");
    // the fake's roll call lists claude-code and codex only — pi's `~/.pi` is
    // not on it, so the persona exists in the registry and waits for an index
    await win.call("agents.profileSets.create", { label: "Research" });
    const pid = daemon.health().rosettad.pid;
    const { persona } = (await win.call("agents.profiles.create", {
      set: "research",
      provider: "pi",
    })) as AgentsProfilesCreateResult;
    expect(persona).toMatchObject({ provider: "pi", kind: "managed", label: "Research" });
    expect(persona.runtimeId).toBeUndefined();
    expect(readRecord(dataDir).runtimes).toEqual([]);
    expect(daemon.health().rosettad.pid).toBe(pid); // nothing changed, nothing bounced
    expect(auditText(dataDir)).toContain('"indexed":false');

    // pi lists what its folder holds (puppeteer 16493b4): an empty folder is
    // signed out with an empty list — read from the folder alone; pi itself
    // runs only to confirm a stored sign-in, and there is none
    const verified = (await win.call("agents.profiles.verify", {
      profileId: persona.profileId,
    })) as AgentsProfilesVerifyResult;
    expect(verified.persona.profileId).toBe(persona.profileId);
    expect(verified.failure).toBeUndefined();
    expect(verified.persona.identity).toMatchObject({ loggedIn: false, signIns: [] });
    expect(auditText(dataDir)).toContain('"agents.profiles.verify"');

    const missing = await win.callErr("agents.profiles.verify", { profileId: "nope" });
    expect(missing.data?.kind).toBe("NOT_FOUND");
    const gone = await win.callErr("agents.profiles.delete", { profileId: "nope" });
    expect(gone.data?.kind).toBe("NOT_FOUND");
  });
  it("signing out of a persona with no session running finishes it at once: the runtime retired (rows kept, the record names it), the persona unregistered, its root deleted — the profile's folder kept", async () => {
    const { dataDir, daemon } = await setup();
    await ready(daemon);
    const win = await window(daemon, ALL, "p4");
    await win.call("agents.profileSets.create", { label: "Temp" });
    const { persona } = (await win.call("agents.profiles.create", {
      set: "temp",
      provider: "claude",
    })) as AgentsProfilesCreateResult;
    const folder = join(dataDir, ...LAYOUT.AGENT_PROFILE_SETS_DIR, "temp");
    const root = join(folder, readdirSync(folder)[0] as string);
    expect(existsSync(root)).toBe(true);
    const pid = daemon.health().rosettad.pid;

    const deleted = (await win.call("agents.profiles.delete", {
      profileId: persona.profileId,
    })) as AgentsProfilesDeleteResult;
    // Claude keeps its credential outside the folder: the vendor's own sign-out took it
    expect(deleted).toEqual({ deleted: true, credential: "signed-out" });
    expect(existsSync(root)).toBe(false);
    // the profile is still there, empty: signing out leaves the place
    expect(existsSync(folder)).toBe(true);
    const record = readRecord(dataDir);
    expect(record.runtimes).toEqual([]);
    expect(record.retired).toEqual([
      expect.objectContaining({
        kind: "claude-code",
        data_root: root,
        label: "Temp",
        profile_id: persona.profileId,
      }),
    ]);
    expect(daemon.health().rosettad.pid).not.toBe(pid); // the daemon read the change
    const status = (await win.call("index.status", {})) as IndexStatus;
    expect(status.enrollment.retired).toEqual([
      expect.objectContaining({ kind: "claude-code", label: "Temp", profileId: persona.profileId }),
    ]);
    expect(status.runtimes).toEqual([]);
    const listed = (await win.call("agents.profiles.list", {
      provider: "claude",
    })) as AgentsProfilesListResult;
    expect(listed.personas.map((p) => p.profileId)).toEqual(["claude:native-default"]);
    expect(JSON.parse(readFileSync(join(dataDir, ...LAYOUT.AGENT_PROFILES_FILE), "utf8"))).toEqual({
      version: 2,
      sets: [expect.objectContaining({ id: "temp", label: "Temp" })],
      profiles: [],
    });
    expect(auditText(dataDir)).toContain('"agents.profiles.delete"');
    // signed out already: the persona is not there to sign out again
    const again = await win.callErr("agents.profiles.delete", { profileId: persona.profileId });
    expect(again.data?.kind).toBe("NOT_FOUND");
  });
  it("every daemon ready re-applies the record to the personas (R4): a persona registered before this fieldd existed is enrolled at the first ready, and the ready after that changes nothing", async () => {
    // A SHORT root, like every other row's (AR-5-0): the mock mgmt socket lives
    // at `<root>/users/1/native/run/mgmt.sock`, and under macOS's default
    // `/var/folders/…/T/` a pid-and-timestamp name pushed that path past the
    // 104-byte `sun_path` limit — `listen EINVAL` on every run whose TMPDIR was
    // not already short.
    const root = mkdtempSync(join(tmpdir(), "vf-pre-"));
    // the pre-existing registry names a managed root under the roots directory
    const preRoot = join(
      root,
      ...LAYOUT.USERS_DIR,
      "1",
      ...LAYOUT.AGENT_ROOTS_DIR,
      "claude",
      "pre1",
    );
    mkdirSync(preRoot, { recursive: true, mode: 0o700 });
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const { dataDir, daemon } = await setupAt(root, {
      profiles: {
        version: 1,
        profiles: [
          {
            id: "pre1",
            provider: "claude",
            label: "Before",
            kind: "managed",
            dataRoot: preRoot,
            createdAt: "2026-09-12T10:00:00.000Z",
          },
        ],
      },
    });
    await untilAsync(
      async () => readRecord(dataDir).runtimes.some((rt) => rt.profile_id === "pre1"),
      10_000,
    );
    expect(readRecord(dataDir).runtimes).toEqual([
      { kind: "claude-code", data_root: preRoot, label: "Before", profile_id: "pre1" },
    ]);
    // the bounce that followed lands ready with the runtime enrolled…
    await untilAsync(
      () =>
        daemon.index
          .status()
          .then((s) => s.runtimes.some((rt) => rt.profileId === "pre1" && rt.watched))
          .catch(() => false),
      10_000,
    );
    // …and the reconcile that ready triggers finds nothing to do (one generation stays)
    const pid = daemon.health().rosettad.pid;
    await daemon.agents.reconcile();
    expect(daemon.health().rosettad.pid).toBe(pid);
    const win = await window(daemon, ["agent.spawn"], "p5");
    const listed = (await win.call("agents.profiles.list", {
      provider: "claude",
    })) as AgentsProfilesListResult;
    expect(listed.personas.find((p) => p.profileId === "pre1")?.runtimeId).toBe(
      "rt-claude-code-enrolled-1",
    );
  });
});

describe("Agent Profiles (AR-S2) — puppeteer's profile sets, one folder each under the user", () => {
  it("the list: This Mac first (the agents' own folders, the default, no folder of its own), the sign-in-capable providers, no identity read unasked; a window needs agent.spawn", async () => {
    const { dataDir, daemon } = await setup();
    await ready(daemon);
    const win = await window(daemon, ["agent.spawn"], "s1");
    const listed = (await win.call("agents.profileSets.list", {})) as AgentsProfileSetsListResult;
    expect(listed.sets.map((set) => [set.id, set.kind, set.default])).toEqual([
      ["native", "native", true],
    ]);
    const native = listed.sets[0]!;
    expect(native.label).toBe("This Mac");
    expect(native).not.toHaveProperty("folder");
    const claude = native.personas.find((p) => p.provider === "claude");
    // each agent's own folder, printed for a person to read
    expect(claude).toMatchObject({
      profileId: "claude:native-default",
      set: "native",
      folder: "~/.claude",
    });
    // an embedded daemon reads no identity on its own (a status command is the vendor's)
    expect(claude?.identity).toBeUndefined();
    expect(listed.reading).toBe(false);
    // the Add menu's candidates: every adapter that can sign in in a folder,
    // and, apart, the ones that can also say WHO — since puppeteer 16493b4,
    // every one of them (Antigravity's profiles on, Pi's folder listed)
    const every = ["claude", "codex", "grok", "kimi", "pi", "antigravity", "copilot"];
    expect(listed.signIn).toEqual(expect.arrayContaining(every));
    expect(listed.identity).toEqual(expect.arrayContaining(every));
    // AR-S2c: the ways to add a sign-in, for an agent whose folder holds several
    expect(listed.routes?.["hermes"]?.map((route) => route.id)).toEqual(["portal", "provider"]);
    expect(listed.routes?.["opencode"]?.map((route) => route.id)).toEqual(["provider", "console"]);
    expect(listed.routes).not.toHaveProperty("claude");
    // nothing read, nothing it runs on
    expect(native.plans).toEqual([]);
    // This Mac's sign-outs: only where the vendor's own command signs a folder out
    expect(listed.signOut).toContain("claude");
    expect(listed.signOut).not.toContain("codex");
    expect(JSON.stringify(listed)).not.toContain(dataDir);
    // nothing on disk yet: listing touches no registry file
    expect(existsSync(join(dataDir, ...LAYOUT.AGENT_PROFILES_FILE))).toBe(false);

    const denied = await window(daemon, ["agents.manage"], "s1b");
    expect((await denied.callErr("agents.profileSets.list", {})).data?.kind).toBe(
      "FORBIDDEN_SCOPE",
    );
  }, 20_000);

  it("refresh reads This Mac's sign-ins with the vendor's own status command (the scripted claude), and the answer says it is reading", async () => {
    const { daemon } = await setup();
    await ready(daemon);
    const win = await window(daemon, ["agent.spawn"], "s2");
    const first = (await win.call("agents.profileSets.list", {
      refresh: true,
    })) as AgentsProfileSetsListResult;
    expect(first.reading).toBe(true);
    await untilAsync(async () => {
      const listed = (await win.call("agents.profileSets.list", {})) as AgentsProfileSetsListResult;
      const claude = listed.sets[0]?.personas.find((p) => p.provider === "claude");
      return !listed.reading && claude?.identity?.loggedIn === true;
    }, 10_000);
    const listed = (await win.call("agents.profileSets.list", {})) as AgentsProfileSetsListResult;
    expect(listed.sets[0]?.personas.find((p) => p.provider === "claude")?.identity).toMatchObject({
      loggedIn: true,
      email: "persona@example.test",
      plan: "max",
    });
    // only installed agents are asked: nothing but the scripted claude is on this search path
    expect(
      listed.sets[0]?.personas.filter((p) => p.identity !== undefined).map((p) => p.provider),
    ).toEqual(["claude"]);
  }, 20_000);

  it("create, rename, re-mark and move the default: the folder keeps the name it was made with, the sign-ins and the index take the new one, and there is always exactly one default", async () => {
    const { dataDir, daemon } = await setup();
    await ready(daemon);
    const win = await window(daemon, ALL, "s3");
    const made = (await win.call("agents.profileSets.create", {
      label: "Client demo",
      glyph: "flask",
      default: true,
    })) as AgentsProfileSetsSetResult;
    expect(made.set).toMatchObject({
      id: "client-demo",
      label: "Client demo",
      glyph: "flask",
      default: true,
      personas: [],
    });
    expect(made.set.folder).toMatch(/agents\/profiles\/client-demo$/);
    const { persona } = (await win.call("agents.profiles.create", {
      set: "client-demo",
      provider: "claude",
    })) as AgentsProfilesCreateResult;
    // the same name again is a different place with a different folder
    const again = (await win.call("agents.profileSets.create", {
      label: "Client demo",
    })) as AgentsProfileSetsSetResult;
    expect(again.set.id).toBe("client-demo-2");

    const renamed = (await win.call("agents.profileSets.update", {
      set: "client-demo",
      label: "Acme",
      glyph: "rocket",
    })) as AgentsProfileSetsSetResult;
    expect(renamed.set).toMatchObject({ id: "client-demo", label: "Acme", glyph: "rocket" });
    expect(renamed.set.personas.map((p) => p.label)).toEqual(["Acme"]);
    expect(existsSync(join(dataDir, ...LAYOUT.AGENT_PROFILE_SETS_DIR, "client-demo"))).toBe(true);
    // the index names the sign-in by the profile's new name
    expect(readRecord(dataDir).runtimes).toEqual([
      expect.objectContaining({ label: "Acme", profile_id: persona.profileId }),
    ]);

    // the default only ever MOVES to a profile
    const moved = (await win.call("agents.profileSets.update", {
      set: "native",
      default: true,
    })) as AgentsProfileSetsSetResult;
    expect(moved.set.default).toBe(true);
    const listed = (await win.call("agents.profileSets.list", {})) as AgentsProfileSetsListResult;
    expect(listed.sets.filter((set) => set.default).map((set) => set.id)).toEqual(["native"]);
    // This Mac keeps its name and mark
    const renameNative = await win.callErr("agents.profileSets.update", {
      set: "native",
      label: "Mine",
    });
    expect(renameNative.data?.kind).toBe("PRECONDITION_FAILED");
    const bad = await win.callErr("agents.profileSets.update", {
      set: "acme",
      glyph: "Not A Glyph",
    });
    expect(bad.data?.kind).toBe("PRECONDITION_FAILED");
    const audit = auditText(dataDir);
    expect(audit).toContain('"agents.profile_sets.update"');
  }, 30_000);

  it("delete: refused for This Mac and for the default; a profile's sign-ins are signed out, the profile unregistered and its folder deleted", async () => {
    const { dataDir, daemon } = await setup();
    await ready(daemon);
    const win = await window(daemon, ALL, "s4");
    await win.call("agents.profileSets.create", { label: "Work", default: true });
    const { persona } = (await win.call("agents.profiles.create", {
      set: "work",
      provider: "claude",
    })) as AgentsProfilesCreateResult;
    const folder = join(dataDir, ...LAYOUT.AGENT_PROFILE_SETS_DIR, "work");

    const native = await win.callErr("agents.profileSets.delete", { set: "native" });
    expect(native.data?.kind).toBe("PRECONDITION_FAILED");
    const theDefault = await win.callErr("agents.profileSets.delete", { set: "work" });
    expect(theDefault.data?.kind).toBe("PRECONDITION_FAILED");
    expect(theDefault.message).toBe(
      "Work is the default for new sessions. Make another profile the default first.",
    );
    await win.call("agents.profileSets.update", { set: "native", default: true });
    const deleted = (await win.call("agents.profileSets.delete", {
      set: "work",
    })) as AgentsProfileSetsDeleteResult;
    expect(deleted).toEqual({ deleted: true, stopped: 0 });
    expect(existsSync(folder)).toBe(false);
    expect(readRecord(dataDir).retired).toEqual([
      expect.objectContaining({ profile_id: persona.profileId, label: "Work" }),
    ]);
    expect(JSON.parse(readFileSync(join(dataDir, ...LAYOUT.AGENT_PROFILES_FILE), "utf8"))).toEqual({
      version: 2,
      sets: [],
      profiles: [],
    });
    const gone = await win.callErr("agents.profileSets.delete", { set: "work" });
    expect(gone.data?.kind).toBe("NOT_FOUND");
    expect(auditText(dataDir)).toContain('"agents.profile_sets.delete"');
  }, 30_000);

  it("the subscription carries whole frames as the profiles change; Show in Finder resolves ids and refuses what it cannot show", async () => {
    const { daemon } = await setup();
    await ready(daemon);
    const win = await window(daemon, ALL, "s5");
    const frames = (): AgentsProfileSetsListResult[] =>
      win.notifications
        .map((n) => n.params.payload as AgentsProfileSetsListResult | undefined)
        .filter((payload): payload is AgentsProfileSetsListResult => payload?.sets !== undefined);
    const subscribed = await win.call("agents.profileSets.subscribe", {});
    // the first frame is the snapshot: This Mac, before anything was made
    await until(
      () => frames().length > 0 || JSON.stringify(subscribed).includes('"native"'),
      5_000,
    );
    await win.call("agents.profileSets.create", { label: "Personal", glyph: "house" });
    await until(() => frames().some((f) => f.sets.some((set) => set.id === "personal")), 5_000);

    // This Mac has no folder of its own; a profile without a sign-in has one
    expect((await win.callErr("agents.profileSets.reveal", { set: "native" })).data?.kind).toBe(
      "PRECONDITION_FAILED",
    );
    expect(
      (await win.callErr("agents.profileSets.reveal", { set: "personal", provider: "codex" })).data
        ?.kind,
    ).toBe("NOT_FOUND");
    // no desktop shell in a unit daemon: said, never pretended
    const shell = await win.callErr("agents.profileSets.reveal", { set: "personal" });
    expect(shell.data?.kind).toBe("UNAVAILABLE");
  }, 20_000);
});

describe("Extensions (AR-S4b) — each Agent Profile's lens over its agents' own reads", () => {
  /** Every built-in extension reader replaced by one that reads nothing: a
   * test daemon never opens the developer's own ~/.claude or starts a codex. */
  function fakeReaders(reads: string[], switches = new Map<string, boolean>()) {
    return (builtin: AgentProvider[]): AgentProvider[] =>
      builtin.map((provider) => {
        const real = provider.extensions;
        if (real === undefined) return provider;
        return {
          ...provider,
          extensions: {
            provider: real.provider,
            // AR-S4c: Codex's linear turns on and off through a stand-in for
            // its protocol — nothing starts a process here — and asks for a
            // sign-in, which would open Codex's own login in a pane.
            plan: (_profile, item, act) =>
              provider.descriptor.id === "codex" && (act === "sign-in" || act === "sign-out")
                ? {
                    target: { kind: item.kind, id: item.id },
                    act,
                    available: true as const,
                    runs: {
                      kind: act === "sign-in" ? ("terminal" as const) : ("command" as const),
                      argv: ["codex", "mcp", act === "sign-in" ? "login" : "logout", item.id],
                    },
                    display: `codex mcp ${act === "sign-in" ? "login" : "logout"} ${item.id}`,
                    reaches: ["every-profile" as const],
                  }
                : provider.descriptor.id === "codex" && act !== "remove"
                  ? {
                      target: { kind: item.kind, id: item.id },
                      act,
                      available: true as const,
                      runs: { kind: "protocol" as const, method: "config/value/write" },
                      display: `config/value/write mcp_servers.${item.id}.enabled = ${act === "enable"}`,
                      reaches: [],
                    }
                  : {
                      target: { kind: item.kind, id: item.id },
                      act,
                      available: false as const,
                      reason: "no-command" as const,
                      message: "no command here",
                    },
            perform: async (profile, plan, io) => {
              io.onOutput?.(`${plan.display}\n`);
              switches.set(`${profile.provider} ${plan.target.id}`, plan.act === "enable");
              return { ok: true };
            },
            inventory: async (profile) => {
              reads.push(`${profile.provider} ${profile.id}`);
              const linear = ["claude", "codex"].includes(profile.provider)
                ? [
                    {
                      kind: "mcp-server" as const,
                      id: "linear",
                      name: "linear",
                      origin: "own" as const,
                      enabled: switches.get(`${profile.provider} linear`) ?? true,
                      transport: "http" as const,
                      target: "https://mcp.linear.app/mcp",
                      ...(profile.provider === "codex"
                        ? { env: ["LINEAR_TOKEN"], auth: "needs-sign-in" as const }
                        : {}),
                    },
                  ]
                : [];
              return {
                provider: profile.provider,
                profileId: profile.id,
                fetchedAt: "2026-09-25T09:00:00.000Z",
                items: linear,
                source: { kind: "native-store" as const, stability: "documented" as const },
              };
            },
          },
        };
      });
  }

  it("lists This Mac's lens for a window holding agents.manage, reads again when asked, and pushes the read to subscribers", async () => {
    const reads: string[] = [];
    const { daemon } = await setup({ providers: fakeReaders(reads) });
    await ready(daemon);
    // Nothing is read until a page asks.
    expect(reads).toEqual([]);

    const denied = await window(daemon, ["agent.spawn"], "x0");
    expect((await denied.callErr("agents.extensions.list", { set: "native" })).data?.kind).toBe(
      "FORBIDDEN_SCOPE",
    );

    const win = await window(daemon, ALL, "x1");
    expect((await win.callErr("agents.extensions.list", {})).data?.kind).toBe(
      "PRECONDITION_FAILED",
    );
    expect((await win.callErr("agents.extensions.list", { set: "gone" })).data?.kind).toBe(
      "NOT_FOUND",
    );

    const lens = AgentsExtensionsListResult.parse(
      await win.call("agents.extensions.list", { set: "native" }),
    );
    expect(lens.set).toBe("native");
    expect(lens.reading).toBe(false);
    const claude = lens.agents.find((column) => column.provider === "claude");
    expect(claude).toMatchObject({ profileId: "claude:native-default", counts: { mcpServers: 1 } });
    // An agent puppeteer has no extension reader for is a column that says so.
    expect(lens.agents.find((column) => column.provider === "copilot")?.failure?.status).toBe(
      "unsupported",
    );
    const linear = lens.servers.find((row) => row.name === "linear");
    expect(Object.keys(linear?.cells ?? {})).toEqual(["claude", "codex"]);
    // Codex's reads a variable Claude's does not: two versions.
    expect(linear?.versions).toBe(2);
    const first = reads.length;
    expect(first).toBeGreaterThan(0);

    // The kept read answers again; `refresh` reads every agent again.
    await win.call("agents.extensions.list", { set: "native" });
    expect(reads).toHaveLength(first);

    const frames = (): AgentsExtensionsListResult[] =>
      win.notifications
        .map((n) => n.params.payload as AgentsExtensionsListResult | undefined)
        .filter((payload): payload is AgentsExtensionsListResult => payload?.set === "native");
    const subscribed = (await win.call("agents.extensions.subscribe", {
      set: "native",
    })) as { snapshot?: AgentsExtensionsListResult } | AgentsExtensionsListResult;
    expect(JSON.stringify(subscribed)).toContain('"linear"');
    await win.call("agents.extensions.list", { set: "native", refresh: true });
    expect(reads).toHaveLength(first * 2);
    await until(() => frames().some((frame) => frame.reading === false), 5_000);
  }, 30_000);

  it("runs an act through the agent's own protocol for a window holding agents.manage, audited, and answers with what the agent holds after (AR-S4c)", async () => {
    const reads: string[] = [];
    const { daemon, dataDir } = await setup({ providers: fakeReaders(reads) });
    await ready(daemon);
    const act = {
      set: "native",
      provider: "codex",
      kind: "mcp-server",
      id: "linear",
      act: "disable",
    };

    const denied = await window(daemon, ["agent.spawn"], "x2");
    expect((await denied.callErr("agents.extensions.act", act)).data?.kind).toBe("FORBIDDEN_SCOPE");
    const win = await window(daemon, ALL, "x3");
    expect((await win.callErr("agents.extensions.act", { set: "native" })).data?.kind).toBe(
      "PRECONDITION_FAILED",
    );

    const before = AgentsExtensionsListResult.parse(
      await win.call("agents.extensions.list", { set: "native" }),
    );
    const cell = (lens: AgentsExtensionsListResult, provider: string) =>
      lens.servers.find((row) => row.name === "linear")?.cells[provider]?.[0];
    // Codex offers its switch (and its sign-in, a pane's, AR-S4c); Claude, here, offers nothing
    expect(cell(before, "codex")?.acts).toEqual([
      {
        act: "disable",
        runs: "config/value/write mcp_servers.linear.enabled = false",
        reaches: [],
      },
      {
        act: "sign-in",
        runs: "codex mcp login linear",
        reaches: ["every-profile"],
        terminal: true,
      },
    ]);
    expect(cell(before, "claude")?.acts).toBeUndefined();
    expect(
      (await win.callErr("agents.extensions.act", { ...act, provider: "claude" })).data?.kind,
    ).toBe("PRECONDITION_FAILED");

    const answered = AgentsExtensionsActResult.parse(await win.call("agents.extensions.act", act));
    expect(answered.receipt).toMatchObject({ status: "changed", message: "turned off" });
    expect(answered.run).toMatchObject({ provider: "codex", name: "linear", state: "finished" });
    const after = AgentsExtensionsListResult.parse(
      await win.call("agents.extensions.list", { set: "native" }),
    );
    expect(cell(after, "codex")).toMatchObject({
      enabled: false,
      acts: [{ act: "enable", runs: "config/value/write mcp_servers.linear.enabled = true" }],
    });
    expect(after.run).toMatchObject({ act: "disable", receipt: { status: "changed" } });
    const audit = auditText(dataDir);
    expect(audit).toContain('"agents.extensions.act"');
    expect(audit).toContain("codex:mcp-server:linear");
  }, 30_000);

  /** Claude's extensions replaced by a store in memory: one marketplace whose
   * catalog lists lint, installed through a stand-in for a protocol call —
   * nothing starts a process here. */
  function fakeCatalog() {
    const installed = new Set<string>();
    return (builtin: AgentProvider[]): AgentProvider[] =>
      builtin.map((provider) => {
        const real = provider.extensions;
        if (real === undefined) return provider;
        if (provider.descriptor.id !== "claude") {
          return {
            ...provider,
            extensions: {
              provider: real.provider,
              inventory: async (profile) => ({
                provider: profile.provider,
                profileId: profile.id,
                fetchedAt: "2026-09-27T09:00:00.000Z",
                items: [],
                source: { kind: "native-store" as const, stability: "documented" as const },
              }),
            },
          };
        }
        return {
          ...provider,
          extensions: {
            provider: real.provider,
            plan: (_profile, item, act) =>
              act === "install" || (item.kind === "marketplace" && act === "update")
                ? {
                    target: { kind: item.kind, id: item.id },
                    act,
                    available: true as const,
                    runs: { kind: "protocol" as const, method: `plugin/${act}` },
                    display: `plugin/${act} ${item.id}`,
                    reaches: [],
                  }
                : extensionActUnavailable(
                    { kind: item.kind, id: item.id },
                    act,
                    "no-command",
                    "no command here",
                  ),
            perform: async (_profile, plan, io) => {
              io.onOutput?.(`${plan.display}\n`);
              if (plan.act === "install") installed.add(plan.target.id);
              return { ok: true };
            },
            inventory: async (profile) => ({
              provider: profile.provider,
              profileId: profile.id,
              fetchedAt: "2026-09-27T09:00:00.000Z",
              items: [
                {
                  kind: "marketplace" as const,
                  id: "northlight",
                  name: "northlight",
                  origin: "own" as const,
                  enabled: true,
                  source: "northlight/plugins",
                },
                ...[...installed].map((id) => ({
                  kind: "plugin" as const,
                  id,
                  name: id.split("@")[0]!,
                  origin: "own" as const,
                  enabled: true,
                  version: "2.0.0",
                  marketplace: "northlight",
                })),
              ],
              source: { kind: "native-store" as const, stability: "documented" as const },
            }),
            catalog: async (profile) => ({
              provider: profile.provider,
              profileId: profile.id,
              fetchedAt: "2026-09-27T09:00:00.000Z",
              marketplaces: [
                {
                  id: "northlight",
                  name: "northlight",
                  source: "northlight/plugins",
                  origin: "own" as const,
                },
              ],
              plugins: [
                {
                  id: "lint@northlight",
                  name: "lint",
                  marketplace: "northlight",
                  version: "2.0.0",
                  ...(installed.has("lint@northlight") ? { held: "lint@northlight" } : {}),
                },
              ],
              source: { kind: "native-store" as const, stability: "documented" as const },
            }),
          },
        };
      });
  }

  it("browses an agent's catalog for a window holding agents.manage and installs from it through the agent's own call, audited (AR-S4e2)", async () => {
    const { daemon, dataDir } = await setup({ providers: fakeCatalog() });
    await ready(daemon);
    const browse = { set: "native", provider: "claude" };

    const denied = await window(daemon, ["agent.spawn"], "c1");
    for (const [method, params] of [
      ["agents.extensions.catalog", browse],
      ["agents.extensions.check", browse],
      [
        "agents.extensions.planSource",
        { ...browse, kind: "marketplace", source: "northlight/extra" },
      ],
    ] as const) {
      expect((await denied.callErr(method, params)).data?.kind, method).toBe("FORBIDDEN_SCOPE");
    }
    // a pane is a spawn: agents.manage alone may act, not open one
    const manager = await window(daemon, ["agents.manage"], "c2");
    expect(
      (
        await manager.callErr("agents.extensions.terminal", {
          ...browse,
          kind: "plugin",
          id: "lint@northlight",
          act: "install",
        })
      ).data?.kind,
    ).toBe("FORBIDDEN_SCOPE");

    const win = await window(daemon, ALL, "c3");
    expect((await win.callErr("agents.extensions.catalog", { set: "native" })).data?.kind).toBe(
      "PRECONDITION_FAILED",
    );
    const catalog = AgentsExtensionsCatalogResult.parse(
      await win.call("agents.extensions.catalog", browse),
    );
    expect(catalog.marketplaces).toEqual([
      {
        id: "northlight",
        name: "northlight",
        source: "northlight/plugins",
        origin: "own",
        count: 1,
      },
    ]);
    expect(catalog.plugins[0]).toMatchObject({
      id: "lint@northlight",
      install: { act: "install", runs: "plugin/install lint@northlight", reaches: [] },
    });

    const answered = AgentsExtensionsActResult.parse(
      await win.call("agents.extensions.act", {
        ...browse,
        kind: "plugin",
        id: "lint@northlight",
        act: "install",
      }),
    );
    expect(answered.receipt).toMatchObject({ status: "changed", message: "installed 2.0.0" });
    const lens = AgentsExtensionsListResult.parse(
      await win.call("agents.extensions.list", { set: "native" }),
    );
    expect(lens.plugins.claude?.map((plugin) => plugin.id)).toEqual(["lint@northlight"]);
    // the catalog was read again after: it holds it now
    const again = AgentsExtensionsCatalogResult.parse(
      await win.call("agents.extensions.catalog", browse),
    );
    expect(again.plugins[0]).toMatchObject({ held: "lint@northlight" });
    expect(again.plugins[0]).not.toHaveProperty("install");
    const audit = auditText(dataDir);
    expect(audit).toContain('"agents.extensions.act"');
    expect(audit).toContain("claude:plugin:lint@northlight");
  }, 30_000);

  it("opens a server's sign-in only for a window that may open a pane, and only where the agent offers one (AR-S4c)", async () => {
    const reads: string[] = [];
    const { daemon, dataDir } = await setup({ providers: fakeReaders(reads) });
    await ready(daemon);
    const signIn = { set: "native", provider: "codex", id: "linear" };

    // a pane is a spawn: agents.manage alone may act, not open one
    const manager = await window(daemon, ["agents.manage"], "s1");
    expect((await manager.callErr("agents.extensions.signIn", signIn)).data?.kind).toBe(
      "FORBIDDEN_SCOPE",
    );
    const win = await window(daemon, ALL, "s2");
    expect((await win.callErr("agents.extensions.signIn", { set: "native" })).data?.kind).toBe(
      "PRECONDITION_FAILED",
    );
    // a sign-in is never an act: the act door refuses it before anything runs
    expect(
      (
        await win.callErr("agents.extensions.act", {
          ...signIn,
          kind: "mcp-server",
          act: "sign-in",
        })
      ).data?.kind,
    ).toBe("PRECONDITION_FAILED");
    // Claude offers no sign-in here: refused before any pane could open
    expect(
      (await win.callErr("agents.extensions.signIn", { ...signIn, provider: "claude" })).data?.kind,
    ).toBe("PRECONDITION_FAILED");
    expect(auditText(dataDir)).toContain('"agents.extensions.sign_in"');
  }, 30_000);

  /**
   * AR-S4d: Claude holds its own context7, which reads a key; Codex holds
   * nothing until its add runs — a stand-in for its protocol, nothing starts.
   */
  function fakeAdding(added: Set<string>) {
    const context7 = {
      transport: "stdio" as const,
      command: "npx",
      args: ["-y", "@upstash/context7-mcp"],
      env: ["CONTEXT7_API_KEY"],
    };
    return (builtin: AgentProvider[]): AgentProvider[] =>
      builtin.map((provider) => {
        const real = provider.extensions;
        if (real === undefined) return provider;
        const id = provider.descriptor.id;
        return {
          ...provider,
          extensions: {
            provider: real.provider,
            plan: (_profile, item, act) =>
              id === "codex" && act === "add"
                ? {
                    target: { kind: item.kind, id: item.id },
                    act,
                    available: true as const,
                    runs: { kind: "protocol" as const, method: "config/value/write" },
                    display: `config/value/write mcp_servers.${item.id}`,
                    reaches: [],
                  }
                : {
                    target: { kind: item.kind, id: item.id },
                    act,
                    available: false as const,
                    reason: "no-command" as const,
                    message: "no command here",
                  },
            perform: async (profile, plan, io) => {
              io.onOutput?.(`${plan.display}\n`);
              added.add(`${profile.provider} ${plan.target.id}`);
              return { ok: true };
            },
            inventory: async (profile) => ({
              provider: profile.provider,
              profileId: profile.id,
              fetchedAt: "2026-09-27T09:00:00.000Z",
              items: [
                ...(id === "claude" || added.has(`${id} context7`)
                  ? [
                      {
                        kind: "mcp-server" as const,
                        id: "context7",
                        name: "context7",
                        origin: "own" as const,
                        enabled: true,
                        transport: "stdio" as const,
                        target: "npx -y @upstash/context7-mcp",
                        env: ["CONTEXT7_API_KEY"],
                        definition: context7,
                      },
                    ]
                  : []),
                ...(added.has(`${id} linear`)
                  ? [
                      {
                        kind: "mcp-server" as const,
                        id: "linear",
                        name: "linear",
                        origin: "own" as const,
                        enabled: true,
                        transport: "http" as const,
                        target: "https://mcp.linear.app/mcp",
                      },
                    ]
                  : []),
              ],
              source: { kind: "native-store" as const, stability: "documented" as const },
            }),
          },
        };
      });
  }

  it("turns a server on once for a window holding agents.manage: the value into the keychain, never the ledger or the wire (AR-S4d)", async () => {
    const added = new Set<string>();
    const keychain = memoryKeychain();
    const { daemon, dataDir } = await setup({
      providers: fakeAdding(added),
      secretStore: keychain.store,
    });
    await ready(daemon);
    const secret = "ctx7_value_that_stays_in_the_keychain";
    const turnOn = {
      set: "native",
      provider: "codex",
      kind: "mcp-server",
      id: "context7",
      act: "add",
      values: { CONTEXT7_API_KEY: secret },
    };
    const linear = {
      set: "native",
      name: "linear",
      definition: { transport: "http", url: "https://mcp.linear.app/mcp" },
      agents: ["codex"],
    };

    const denied = await window(daemon, ["agent.spawn"], "a1");
    expect((await denied.callErr("agents.extensions.add", linear)).data?.kind).toBe(
      "FORBIDDEN_SCOPE",
    );
    expect(
      (
        await denied.callErr("agents.extensions.plan", {
          set: "native",
          name: "linear",
          definition: linear.definition,
        })
      ).data?.kind,
    ).toBe("FORBIDDEN_SCOPE");
    const win = await window(daemon, ALL, "a2");
    expect((await win.callErr("agents.extensions.add", { set: "native" })).data?.kind).toBe(
      "PRECONDITION_FAILED",
    );

    // the lens offers Codex its add of Claude's server, and needs the key first
    const before = AgentsExtensionsListResult.parse(
      await win.call("agents.extensions.list", { set: "native" }),
    );
    expect(before.servers.find((row) => row.name === "context7")).toMatchObject({
      needs: ["CONTEXT7_API_KEY"],
      offers: { codex: { act: { act: "add", runs: "config/value/write mcp_servers.context7" } } },
    });
    const answered = AgentsExtensionsActResult.parse(
      await win.call("agents.extensions.act", turnOn),
    );
    expect(answered.receipt).toMatchObject({ status: "changed", message: "added" });
    expect([...keychain.entries.keys()]).toEqual(["VibeField agent server values/native"]);
    expect(JSON.parse(keychain.entries.get("VibeField agent server values/native")!)).toEqual({
      CONTEXT7_API_KEY: secret,
    });
    const after = AgentsExtensionsListResult.parse(
      await win.call("agents.extensions.list", { set: "native" }),
    );
    expect(after.values).toEqual(["CONTEXT7_API_KEY"]);
    expect(Object.keys(after.servers.find((row) => row.name === "context7")?.cells ?? {})).toEqual([
      "claude",
      "codex",
    ]);

    // the plan, then the Add: each agent's own add, audited
    expect(
      AgentsExtensionsPlanResult.parse(
        await win.call("agents.extensions.plan", {
          set: "native",
          name: "linear",
          definition: linear.definition,
        }),
      ).offers.codex,
    ).toMatchObject({ act: { act: "add", runs: "config/value/write mcp_servers.linear" } });
    const result = AgentsExtensionsAddResult.parse(await win.call("agents.extensions.add", linear));
    expect(result.receipts).toMatchObject([{ provider: "codex", receipt: { status: "changed" } }]);

    const audit = auditText(dataDir);
    expect(audit).toContain('"agents.extensions.act"');
    expect(audit).toContain('"agents.extensions.add"');
    expect(audit).toContain("native:mcp-server:linear");
    const keep = readFileSync(join(dataDir, ...LAYOUT.AGENT_EXTENSIONS_DIR, "native.json"), "utf8");
    expect(JSON.parse(keep)).toMatchObject({
      servers: { context7: {}, linear: {} },
      values: ["CONTEXT7_API_KEY"],
      given: { codex: { context7: ["CONTEXT7_API_KEY"], linear: [] } },
    });
    for (const text of [audit, keep, JSON.stringify(after), JSON.stringify(result)])
      expect(text).not.toContain(secret);
  }, 30_000);

  /**
   * AR-S4d2: every agent reads a person's skills from a folder of its own
   * under `root` — never its real one: these daemons run with this machine's
   * home, where the native set's roots are the agents' own — planned with
   * Core's placing, so the runtime makes each link itself and nothing starts.
   */
  function fakeSkills(root: string) {
    return (builtin: AgentProvider[]): AgentProvider[] =>
      builtin.map((provider) => {
        const real = provider.extensions;
        if (real === undefined) return provider;
        const label = real.provider.label;
        const folderOf = (profile: AgentProfile) => join(root, profile.provider, "skills");
        return {
          ...provider,
          extensions: {
            provider: real.provider,
            plan: (profile, item, act, options) =>
              item.kind === "skill" && (act === "add" || act === "remove")
                ? extensionSkillFolderPlan({
                    label,
                    folder: folderOf(profile),
                    item,
                    act,
                    ...(options?.keepIn !== undefined ? { keepIn: options.keepIn } : {}),
                  })
                : extensionActUnavailable(
                    { kind: item.kind, id: item.id },
                    act,
                    "no-command",
                    "no command here",
                  ),
            inventory: async (profile) => {
              const items: SkillItem[] = [];
              const folder = folderOf(profile);
              for (const name of existsSync(folder) ? readdirSync(folder).sort() : []) {
                const location = join(folder, name);
                if (!existsSync(join(location, "SKILL.md"))) continue;
                items.push({
                  kind: "skill",
                  id: name,
                  name,
                  origin: "own",
                  enabled: true,
                  location,
                  ...(lstatSync(location).isSymbolicLink()
                    ? { linkTarget: readlinkSync(location) }
                    : {}),
                });
              }
              return {
                provider: profile.provider,
                profileId: profile.id,
                fetchedAt: "2026-09-27T09:00:00.000Z",
                items,
                source: { kind: "native-store" as const, stability: "documented" as const },
              };
            },
          },
        };
      });
  }

  it("keeps a skill once for a window holding agents.manage: copied into the profile's folder, linked where Claude looks, audited (AR-S4d2)", async () => {
    const agents = mkdtempSync(join(tmpdir(), "fieldd-skill-agents-"));
    cleanup.push(() => rmSync(agents, { recursive: true, force: true }));
    const { daemon, dataDir } = await setup({
      providers: fakeSkills(agents),
      secretStore: memoryKeychain().store,
    });
    await ready(daemon);
    const source = join(agents, "Downloads", "changelog-writer");
    mkdirSync(source, { recursive: true });
    writeFileSync(
      join(source, "SKILL.md"),
      "---\nname: changelog-writer\ndescription: Writes the changelog entry\n---\nThe steps.\n",
    );
    const add = { set: "native", from: source, agents: ["claude"] };

    const denied = await window(daemon, ["agent.spawn"], "k1");
    expect((await denied.callErr("agents.extensions.addSkill", add)).data?.kind).toBe(
      "FORBIDDEN_SCOPE",
    );
    expect(
      (await denied.callErr("agents.extensions.planSkill", { set: "native", from: add.from })).data
        ?.kind,
    ).toBe("FORBIDDEN_SCOPE");
    const win = await window(daemon, ALL, "k2");
    expect((await win.callErr("agents.extensions.addSkill", { set: "native" })).data?.kind).toBe(
      "PRECONDITION_FAILED",
    );

    const plan = AgentsExtensionsPlanSkillResult.parse(
      await win.call("agents.extensions.planSkill", { set: "native", from: add.from }),
    );
    const library = join(dataDir, ...LAYOUT.AGENT_SKILLS_DIR, "native");
    expect(plan).toMatchObject({
      name: "changelog-writer",
      description: "Writes the changelog entry",
    });
    expect(plan.offers.claude?.act?.runs).toContain(`${library}/changelog-writer`);
    expect(existsSync(join(library, "changelog-writer"))).toBe(false);

    const result = AgentsExtensionsAddSkillResult.parse(
      await win.call("agents.extensions.addSkill", add),
    );
    expect(result).toMatchObject({
      name: "changelog-writer",
      receipts: [{ provider: "claude", receipt: { status: "changed", message: "added" } }],
    });
    expect(readFileSync(join(library, "changelog-writer", "SKILL.md"), "utf8")).toContain(
      "The steps.",
    );
    const lens = AgentsExtensionsListResult.parse(
      await win.call("agents.extensions.list", { set: "native" }),
    );
    const row = lens.skills.find((candidate) => candidate.name === "changelog-writer");
    expect(row).toMatchObject({ kept: true, versions: 1 });
    expect(row?.cells.claude?.[0]).toMatchObject({ origin: "own" });
    expect(readlinkSync(join(agents, "claude", "skills", "changelog-writer"))).toBe(
      join(library, "changelog-writer"),
    );
    expect(auditText(dataDir)).toContain('"agents.extensions.add_skill"');
  }, 30_000);
});

/** `setup` at a caller-owned root (the reconcile row plants files first). */
async function setupAt(
  root: string,
  config: {
    profiles?: { version: 1; profiles: unknown[] };
    /** the real rosettad (FIELDD_ROSETTAD_BIN) instead of the scripted one */
    real?: boolean;
    /** the scripted daemon's knobs */
    env?: Record<string, string>;
  },
): Promise<{ dataDir: string; daemon: FielddDaemon }> {
  const dataDir = join(root, ...LAYOUT.USERS_DIR, "1");
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  copyFileSync(FAKE_CLAUDE, join(bin, "claude"));
  pinClaude(bin);
  if (config.profiles !== undefined) {
    mkdirSync(join(dataDir, ...LAYOUT.AGENTS_DIR), { recursive: true });
    writeFileSync(
      join(dataDir, ...LAYOUT.AGENT_PROFILES_FILE),
      `${JSON.stringify(config.profiles)}\n`,
    );
  }
  const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
  await mock.start();
  cleanup.push(() => mock.stop());
  const home = join(dataDir, "home");
  mkdirSync(home, { recursive: true });
  const daemon = await bootstrap({
    dataDir,
    controlPort: 0,
    rosettadBin: config.real ? (REAL_BIN as string) : "/stand-in/rosettad",
    ...(config.real ? {} : { rosettadSpawn: fakeSpawner("ok", config.env ?? {}) }),
    rosettadHome: home,
    vibefieldRoot: root,
    agentSearchPath: bin,
    agentFetch: fakeFetch,
  });
  cleanup.push(() => daemon.stop().catch(() => undefined));
  return { dataDir, daemon };
}

// Each row boots a daemon and spawns the scripted agent (a fresh inspection runs its
// version command): the budget the other daemon-spawning rows carry, for a loaded gate.
describe("distribution (AR-2) — native evidence in, the one machine-scope record out", () => {
  it("agents.installs lists the scripted claude on the private search path — classified from its banner, active by puppeteer's rule — and a window needs agents.manage", async () => {
    const { bin, daemon } = await setup();
    await ready(daemon);
    const win = await window(daemon, ["agents.manage"], "d1");
    const { installs } = (await win.call("agents.installs", {
      provider: "claude",
    })) as AgentsInstallsResult;
    const fake = installs.find((i) => i.executable === join(bin, "claude"));
    expect(fake).toMatchObject({
      provider: "claude",
      version: "2.1.0",
      active: true,
      autoUpdate: expect.any(String),
    });
    expect(fake?.method).toBeDefined();
    // nothing of the developer's PATH leaked in: every claude install is the fake
    expect(installs.filter((i) => i.provider === "claude")).toHaveLength(1);
    const all = (await win.call("agents.installs", {})) as AgentsInstallsResult;
    expect(all.installs.some((i) => i.executable === join(bin, "claude"))).toBe(true);

    const denied = await window(daemon, ["agent.spawn"], "d1b");
    expect((await denied.callErr("agents.installs", {})).data?.kind).toBe("FORBIDDEN_SCOPE");
  }, 20_000);

  it("agents.setActive records the choice in machine/agents/distribution.json (0600, under the root lock); installs reflects it; an unknown executable is NOT_FOUND; the same choice again changes nothing", async () => {
    const { root, bin, dataDir, daemon } = await setup();
    await ready(daemon);
    const win = await window(daemon, ["agents.manage"], "d2");
    const executable = join(bin, "claude");
    const result = (await win.call("agents.setActive", {
      provider: "claude",
      executable,
    })) as AgentsSetActiveResult;
    expect(result.changed).toBe(true);
    expect(result.installs.find((i) => i.executable === executable)?.active).toBe(true);
    const path = join(root, ...LAYOUT.MACHINE_DISTRIBUTION_FILE);
    expect(mode(path)).toBe(0o600);
    expect(readDistribution(root)).toMatchObject({
      format: 1,
      providers: { claude: { activeExecutable: executable } },
    });
    // the machine directory exists exactly where LAYOUT says, and nowhere under the user
    expect(existsSync(join(root, ...LAYOUT.MACHINE_AGENTS_DIR))).toBe(true);
    expect(existsSync(join(dataDir, "machine"))).toBe(false);
    const again = (await win.call("agents.setActive", {
      provider: "claude",
      executable,
    })) as AgentsSetActiveResult;
    expect(again.changed).toBe(false);
    const { installs } = (await win.call("agents.installs", {
      provider: "claude",
    })) as AgentsInstallsResult;
    expect(installs.find((i) => i.executable === executable)?.active).toBe(true);
    const missing = await win.callErr("agents.setActive", {
      provider: "claude",
      executable: join(bin, "nope"),
    });
    expect(missing.data?.kind).toBe("NOT_FOUND");
    expect(auditText(dataDir)).toContain('"agents.set_active"');
  }, 20_000);

  it("without a VibeField root above the user root there is no machine scope: installs still answer, setActive and update refuse UNAVAILABLE {service:agents, state:no-machine-scope}", async () => {
    const { bin, daemon } = await setup({ machine: false });
    await ready(daemon);
    const win = await window(daemon, ["agents.manage"], "d3");
    const { installs } = (await win.call("agents.installs", {
      provider: "claude",
    })) as AgentsInstallsResult;
    expect(installs.some((i) => i.executable === join(bin, "claude"))).toBe(true);
    for (const [method, params] of [
      ["agents.setActive", { provider: "claude", executable: join(bin, "claude") }],
      ["agents.update", { provider: "claude" }],
    ] as const) {
      const err = await win.callErr(method, params);
      expect(err.data?.kind, method).toBe("UNAVAILABLE");
      expect(err.data?.details, method).toMatchObject({
        service: "agents",
        state: "no-machine-scope",
      });
    }
  }, 20_000);

  it("agents.update runs the vendor's own updater (the scripted `update`), keeps a 0600 transcript under machine/agents/updates, and records the receipt", async () => {
    const { root, dataDir, daemon } = await setup();
    await ready(daemon);
    const win = await window(daemon, ["agents.manage"], "d4");
    const { receipt } = (await win.call("agents.update", {
      provider: "claude",
    })) as AgentsUpdateResult;
    // the scripted updater exits 0 without moving the version: unchanged, never a claim of currency
    expect(receipt).toMatchObject({ provider: "claude", status: "unchanged", exitCode: 0 });
    expect(receipt).not.toHaveProperty("transcriptPath");
    const updates = join(root, ...LAYOUT.MACHINE_UPDATES_DIR);
    const transcripts = readdirSync(updates);
    expect(transcripts).toHaveLength(1);
    expect(mode(join(updates, transcripts[0] as string))).toBe(0o600);
    expect(readFileSync(join(updates, transcripts[0] as string), "utf8")).toContain(
      "nothing to update",
    );
    expect(readDistribution(root).providers.claude?.lastUpdate).toMatchObject({
      provider: "claude",
      status: "unchanged",
    });
    expect(auditText(dataDir)).toContain('"agents.update"');
  }, 20_000);

  it("agents.releases: the network is an attended act — off, the detectors are silent; on, the vendor's stable line is a release and unreachable detectors are honest failures", async () => {
    const { daemon } = await setup();
    await ready(daemon);
    const win = await window(daemon, ["agents.manage"], "d5");
    const quiet = (await win.call("agents.releases", {
      provider: "claude",
    })) as AgentsReleasesResult;
    expect(quiet.releases).toEqual([]);
    const checked = (await win.call("agents.releases", {
      provider: "claude",
      network: true,
    })) as AgentsReleasesResult;
    expect(checked.releases).toContainEqual(
      expect.objectContaining({
        provider: "claude",
        channel: "stable",
        version: "2.2.0",
        source: { kind: "text", id: "vendor-stable" },
      }),
    );
    const failures = checked.releases.filter((r) => "status" in r);
    expect(failures.length).toBeGreaterThan(0);
    for (const failure of failures) {
      expect(failure).toMatchObject({ provider: "claude", status: "unavailable" });
    }
    // an unknown provider is an honest failure row, never a throw
    const unknown = (await win.call("agents.releases", {
      provider: "nope",
    })) as AgentsReleasesResult;
    expect(unknown.releases).toEqual([
      expect.objectContaining({ provider: "nope", status: "unsupported" }),
    ]);
  }, 20_000);

  it("agents.installs names what Update would run: the adapter's recipe for the scripted standalone claude, as argv", async () => {
    const { bin, daemon } = await setup();
    await ready(daemon);
    const win = await window(daemon, ["agents.manage"], "d6");
    const { installs } = (await win.call("agents.installs", {
      provider: "claude",
    })) as AgentsInstallsResult;
    const fake = installs.find((i) => i.executable === join(bin, "claude"));
    expect(fake?.update).toEqual({
      kind: "native-self-update",
      command: [join(bin, "claude"), "update"],
    });
    // the adapter's line for the install, whichever the machine's settings name
    expect(["stable", "preview"]).toContain(fake?.releaseChannel);
    // the answer above is fieldd's boot inventory; `refresh` reads the Mac again
    const reread = (await win.call("agents.installs", {
      provider: "claude",
      refresh: true,
    })) as AgentsInstallsResult;
    expect(reread.installs.some((i) => i.executable === join(bin, "claude"))).toBe(true);
    expect(
      (await win.callErr("agents.installs", { provider: "claude", refresh: "yes" })).data?.kind,
    ).toBe("PRECONDITION_FAILED");
  }, 20_000);

  it("agents.releases keeps what a network check learned in the machine record, and `cached` answers from it without reaching anything", async () => {
    const { root, daemon } = await setup();
    await ready(daemon);
    const win = await window(daemon, ["agents.manage"], "d7");
    const { installs } = (await win.call("agents.installs", {
      provider: "claude",
    })) as AgentsInstallsResult;
    const line = installs.find((i) => i.provider === "claude" && i.active)?.releaseChannel;

    // before any check: the honest empty answer, and nothing fetched
    const before = fetches;
    const empty = (await win.call("agents.releases", { cached: true })) as AgentsReleasesResult;
    expect(empty).toMatchObject({ releases: [], available: [], checked: [] });
    expect(fetches).toBe(before);

    const checked = (await win.call("agents.releases", {
      provider: "claude",
      network: true,
    })) as AgentsReleasesResult;
    expect(checked.checked).toEqual([{ provider: "claude", at: expect.any(String) }]);
    // the one update the install's own updater would take: stable 2.2.0 or latest 2.3.0
    expect(checked.available).toEqual([
      line === "stable"
        ? { provider: "claude", channel: "stable", version: "2.2.0" }
        : { provider: "claude", channel: "preview", version: "2.3.0" },
    ]);
    const kept = readDistribution(root).providers.claude;
    expect(kept?.lastCheckedAt).toBe(checked.checked?.[0]?.at);
    expect(kept?.lastReleases).toContainEqual(
      expect.objectContaining({ channel: "stable", version: "2.2.0" }),
    );

    const afterCheck = fetches;
    const cached = (await win.call("agents.releases", { cached: true })) as AgentsReleasesResult;
    expect(fetches).toBe(afterCheck);
    expect(cached.checked).toEqual(checked.checked);
    expect(cached.available).toEqual(checked.available);
    expect(cached.releases).toEqual(checked.releases);
  }, 20_000);

  it("agents.operations.subscribe carries the vendor updater's own output while it runs, then the receipt", async () => {
    const { daemon } = await setup();
    await ready(daemon);
    const win = await window(daemon, ["agents.manage"], "d8");
    const sub = (await win.call("agents.operations.subscribe", {})) as {
      subId: string;
      snapshot: AgentsOperationsResult;
    };
    expect(sub.snapshot).toEqual({ operations: [] });
    const { receipt } = (await win.call("agents.update", {
      provider: "claude",
    })) as AgentsUpdateResult;
    expect(receipt.status).toBe("unchanged");
    const last = (): AgentsOperationsResult | undefined =>
      win.notifications
        .filter((n) => n.params.subId === sub.subId)
        .map((n) => n.params.payload as AgentsOperationsResult)
        .at(-1);
    await until(() => last()?.operations[0]?.state === "finished", 4_000);
    expect(last()?.operations[0]).toMatchObject({
      provider: "claude",
      kind: "update",
      state: "finished",
      output: expect.stringContaining("fake claude: nothing to update"),
      truncated: false,
      receipt: { provider: "claude", status: "unchanged" },
    });
    // a window without the management scope cannot watch it
    const denied = await window(daemon, ["agent.spawn"], "d8b");
    expect((await denied.callErr("agents.operations.subscribe", {})).data?.kind).toBe(
      "FORBIDDEN_SCOPE",
    );
  }, 20_000);

  it("agents.reveal: never a path the inventory does not hold; with no desktop shell attached it says so", async () => {
    const { bin, daemon } = await setup();
    await ready(daemon);
    const win = await window(daemon, ["agents.manage"], "d9");
    const missing = await win.callErr("agents.reveal", {
      provider: "claude",
      executable: "/etc/passwd",
    });
    expect(missing.data?.kind).toBe("NOT_FOUND");
    const unattached = await win.callErr("agents.reveal", {
      provider: "claude",
      executable: join(bin, "claude"),
    });
    expect(unattached.data?.kind).toBe("UNAVAILABLE");
    expect(unattached.data?.details).toMatchObject({
      service: "shell",
      state: "no-shell-provider",
    });
  }, 20_000);

  it("the product's daemon reads the installs at boot, in the background; an embedded one never runs a machine's agents unasked", async () => {
    const product = await setup({ warm: true });
    await ready(product.daemon);
    const log = join(product.root, "logs", "system", "fieldd.ndjson");
    const warmed = (): Record<string, unknown> | undefined =>
      (existsSync(log) ? readFileSync(log, "utf8") : "")
        .split("\n")
        .filter((line) => line.includes('"fieldd.agents.inventory_warm"'))
        .map((line) => JSON.parse(line) as Record<string, unknown>)[0];
    await until(() => warmed() !== undefined, 10_000);
    // the scripted claude on the private search path was read
    expect(JSON.stringify(warmed())).toMatch(/"installs":[1-9]/u);

    const embedded = await setup();
    await ready(embedded.daemon);
    expect(existsSync(join(embedded.root, "logs"))).toBe(false);
  }, 20_000);

  it("agents.update.stop: says when nothing is running, is audited, and needs agents.manage", async () => {
    const { dataDir, daemon } = await setup();
    await ready(daemon);
    const win = await window(daemon, ["agents.manage"], "d10");
    expect(await win.call("agents.update.stop", { provider: "claude" })).toEqual({
      stopped: false,
    });
    expect(auditText(dataDir)).toContain('"agents.update.stop"');
    const denied = await window(daemon, ["agent.spawn"], "d10b");
    expect((await denied.callErr("agents.update.stop", { provider: "claude" })).data?.kind).toBe(
      "FORBIDDEN_SCOPE",
    );
  }, 20_000);
});

// The real binary (`pnpm siblings:build`; FIELDD_ROSETTAD_BIN=$(node scripts/siblings.mjs bin)):
// the persona path end to end — puppeteer allocates, fieldd enrolls, rosettad
// indexes — with an EMPTY home so nothing of the developer's is read.
const REAL_BIN = process.env["FIELDD_ROSETTAD_BIN"];
describe.skipIf(REAL_BIN === undefined || REAL_BIN === "" || !existsSync(REAL_BIN))(
  "personas (AR-2) — against the real rosettad (opt-in via FIELDD_ROSETTAD_BIN)",
  () => {
    it("a claude persona and a pi persona are enrolled under their joined kinds (claude-code at the profile root; pi at the profile root, its agent dir inside), live from the first start; deleting retires them", async () => {
      const { dataDir, daemon } = await setup({ rosettadBin: REAL_BIN as string, real: true });
      await until(() => daemon.health().rosettad.phase === "ready", 30_000);
      const win = await window(daemon, ALL, "live1");
      await win.call("agents.profileSets.create", { label: "Kim" });
      await win.call("agents.profileSets.create", { label: "Lab" });
      const claude = (await win.call("agents.profiles.create", {
        set: "kim",
        provider: "claude",
      })) as AgentsProfilesCreateResult;
      const pi = (await win.call("agents.profiles.create", {
        set: "lab",
        provider: "pi",
      })) as AgentsProfilesCreateResult;
      const record = readRecord(dataDir);
      const inFolder = (set: string) => {
        const folder = join(dataDir, ...LAYOUT.AGENT_PROFILE_SETS_DIR, set);
        return join(folder, readdirSync(folder)[0] as string);
      };
      const claudeRoot = inFolder("kim");
      const piRoot = inFolder("lab");
      expect(record.runtimes).toEqual(
        expect.arrayContaining([
          {
            kind: "claude-code",
            data_root: claudeRoot,
            label: "Kim",
            profile_id: claude.persona.profileId,
          },
          { kind: "pi", data_root: piRoot, label: "Lab", profile_id: pi.persona.profileId },
        ]),
      );
      // PU-7: pi binds <root>/agent one level inside; the layout root is the profile root
      expect(existsSync(join(piRoot))).toBe(true);
      // the daemon's runtime rows trail its ready line by a moment: the ids
      // arrive on the list door once the projection holds them
      await untilAsync(
        () =>
          daemon.agents
            .personas()
            .then((r) =>
              [claude.persona.profileId, pi.persona.profileId].every(
                (id) => r.personas.find((p) => p.profileId === id)?.runtimeId !== undefined,
              ),
            )
            .catch(() => false),
        30_000,
      );
      await untilAsync(
        () =>
          daemon.index
            .status()
            .then(
              (s) =>
                s.phase === "live" &&
                s.runtimes.filter((rt) => rt.provenance === "enrolled" && rt.watched).length === 2,
            )
            .catch(() => false),
        30_000,
      );
      const status = await daemon.index.status();
      for (const rt of status.runtimes) {
        expect(rt).not.toHaveProperty("dataRoot");
        expect(["claude-code", "pi"]).toContain(rt.kind);
      }
      expect(status.runtimes.map((rt) => rt.profileId).sort()).toEqual(
        [claude.persona.profileId, pi.persona.profileId].sort(),
      );

      for (const persona of [claude.persona, pi.persona]) {
        const deleted = (await win.call("agents.profiles.delete", {
          profileId: persona.profileId,
        })) as AgentsProfilesDeleteResult;
        expect(deleted.deleted).toBe(true);
      }
      expect(existsSync(claudeRoot)).toBe(false);
      expect(existsSync(piRoot)).toBe(false);
      const after = readRecord(dataDir);
      expect(after.runtimes).toEqual([]);
      expect(after.retired?.map((rt) => rt.profile_id).sort()).toEqual(
        [claude.persona.profileId, pi.persona.profileId].sort(),
      );
      await until(() => daemon.health().rosettad.phase === "ready", 30_000);
      const finalStatus = await daemon.index.status();
      expect(finalStatus.enrollment.retired.map((rt) => rt.label).sort()).toEqual(["Kim", "Lab"]);
      expect(finalStatus.runtimes.filter((rt) => rt.watched)).toEqual([]);
    }, 120_000);

    it("AC-D8 against the real daemon: a record naming a kind its registry lacks is refused at start, the root is subtracted with the daemon's own reason, and the index comes up", async () => {
      // the refusal is read off rosettad's stderr (`rosettad: --enroll …:
      // runtime #1 (kind "…", data_root "…"): unknown agent kind`); this row
      // is the live witness of that wording at the pin — the scripted daemon
      // only mirrors it
      const root = mkdtempSync(join(tmpdir(), "vf-real-d8-"));
      cleanup.push(() => rmSync(root, { recursive: true, force: true }));
      const dataDir = join(root, ...LAYOUT.USERS_DIR, "1");
      const ghostRoot = join(dataDir, ...LAYOUT.AGENT_ROOTS_DIR, "nope-agent", "ghost-root");
      mkdirSync(ghostRoot, { recursive: true, mode: 0o700 });
      writeRecord(dataDir, {
        format: 1,
        enabled_kinds: [],
        runtimes: [
          { kind: "nope-agent", data_root: ghostRoot, label: "Ghost", profile_id: "nope:1" },
        ],
      });
      const { daemon } = await setupAt(root, { real: true });
      await until(() => daemon.health().rosettad.phase === "ready", 60_000);
      const record = readRecord(dataDir);
      expect(record.runtimes).toEqual([]);
      expect(record.retired?.[0]).toMatchObject({ kind: "nope-agent", profile_id: "nope:1" });
      expect(record.retired?.[0]?.refused?.detail).toContain("unknown agent kind");
      const win = await window(daemon, ALL, "live-d8");
      const status = (await win.call("index.status", {})) as IndexStatus;
      expect(status.enrollment.retired[0]?.refused).toEqual({ reason: "unknown agent kind" });
      expect(JSON.stringify(status)).not.toContain(dataDir);
    }, 120_000);
  },
);

describe("the catalog (AC-3) — the doors answer from the table, the roll call witnesses", () => {
  const NONE = {
    spawn: false,
    resume: false,
    reattach: false,
    history: false,
    usage: false,
    distribution: false,
    personas: false,
    invoke: false,
  };

  it("agent.providers lists the catalog's visible rows — the decision, the claims, our label, the index's state — in the table's order", async () => {
    const { daemon } = await setup();
    await ready(daemon);
    const win = await window(daemon, ["agent.spawn"], "c1");
    const { providers } = (await win.call("agent.providers", {})) as AgentProvidersResult;
    expect(providers.map((p) => p.id)).toEqual(visibleCatalog("desktop").map((r) => r.id));
    const claude = providers.find((p) => p.id === "claude");
    // the label is the catalog's, the fake claude on the search path resolves,
    // the fake's roll call spells ~/.claude as claude-code and nothing is
    // consented yet: indexable, not indexed
    expect(claude).toMatchObject({
      label: "Claude Code",
      status: "supported",
      available: true,
      resumable: true,
      history: "unindexed",
    });
    expect(claude?.offers?.reattach).toBe(true);
    // the fake's roll call has no ~/.pi: the catalog offers history for pi
    // and the daemon cannot witness it — unavailable, said out loud
    expect(providers.find((p) => p.id === "pi")).toMatchObject({
      status: "preview",
      available: false,
      history: "unavailable",
    });
    // a protocol row: spawn only, no history state at all
    const acp = providers.find((p) => p.id === "acp");
    expect(acp).toMatchObject({ status: "preview" });
    expect(acp?.offers?.history).toBe(false);
    expect(acp).not.toHaveProperty("history");
    expect(JSON.stringify(providers)).not.toContain("/");
  });

  it("agent.catalog answers the visible rows for the surface; the phone never sees the protocol row; a declined row never leaves fieldd; it reads on agent.observe", async () => {
    const { daemon } = await setup({
      catalog: catalogWith("grok", {
        status: "declined",
        offers: NONE,
        surfaces: { desktop: false, phone: false },
      }),
    });
    await ready(daemon);
    const win = await window(daemon, ["agent.observe"], "c2");
    const all = (await win.call("agent.catalog", {})) as AgentCatalogResult;
    expect(all.catalog.some((r) => r.id === "grok")).toBe(false);
    expect(all.catalog.some((r) => r.id === "acp")).toBe(true);
    expect(all.catalog.every((r) => r.status !== "declined")).toBe(true);
    const phone = (await win.call("agent.catalog", { surface: "phone" })) as AgentCatalogResult;
    expect(phone.catalog.some((r) => r.id === "acp")).toBe(false);
    expect(phone.catalog.map((r) => r.id)).toEqual(
      all.catalog.filter((r) => r.surfaces.phone).map((r) => r.id),
    );
    // an OPEN surface word: one this build never heard of gets every visible row
    const tv = (await win.call("agent.catalog", { surface: "tv" })) as AgentCatalogResult;
    expect(tv.catalog.map((r) => r.id)).toEqual(all.catalog.map((r) => r.id));
    const bad = await win.callErr("agent.catalog", { surface: "" });
    expect(bad.data?.kind).toBe("PRECONDITION_FAILED");
    const denied = await window(daemon, ["agents.manage"], "c2b");
    expect((await denied.callErr("agent.catalog", {})).data?.kind).toBe("FORBIDDEN_SCOPE");
    // and agent.providers no longer offers what the catalog declined
    const spawner = await window(daemon, ["agent.spawn"], "c2c");
    const { providers } = (await spawner.call("agent.providers", {})) as AgentProvidersResult;
    expect(providers.some((p) => p.id === "grok")).toBe(false);
  });

  it("a door refuses typed what the catalog does not offer: no row is NOT_FOUND, a declined row PRECONDITION_FAILED {reason: unsupported-agent}, a row without personas refuses profiles.create", async () => {
    const { daemon } = await setup({
      catalog: catalogWith("claude", {
        status: "declined",
        offers: NONE,
        surfaces: { desktop: false, phone: false },
      }),
    });
    await ready(daemon);
    const win = await window(daemon, ALL, "c3");
    const nobody = await win.callErr("agent.spawn", { provider: "nobody" });
    expect(nobody.data?.kind).toBe("NOT_FOUND");
    const declined = await win.callErr("agent.spawn", { provider: "claude" });
    expect(declined.data?.kind).toBe("PRECONDITION_FAILED");
    expect(declined.data?.details).toMatchObject({
      reason: "unsupported-agent",
      status: "declined",
    });
    const persona = await win.callErr("agents.profiles.create", {
      set: "native",
      provider: "acp",
    });
    expect(persona.data?.kind).toBe("PRECONDITION_FAILED");
    expect(persona.data?.details).toMatchObject({
      reason: "unsupported-agent",
      capability: "personas",
    });
    const active = await win.callErr("agents.setActive", {
      provider: "claude",
      executable: "/nowhere/claude",
    });
    expect(active.data?.kind).toBe("PRECONDITION_FAILED");
    expect(active.data?.details).toMatchObject({ reason: "unsupported-agent" });
  });

  it("index.discoveries and the runtimes carry the catalog id for the daemon's kind; a kind no row maps is shown by its wire kind alone", async () => {
    const { daemon } = await setup();
    await ready(daemon);
    const win = await window(daemon, ALL, "c4");
    const { discoveries } = (await win.call("index.discoveries", {})) as IndexDiscoveriesResult;
    expect(discoveries.find((d) => d.kind === "claude-code")?.agent).toBe("claude");
    expect(discoveries.find((d) => d.kind === "codex")?.agent).toBe("codex");
    await win.call("index.enroll", { kinds: ["claude-code"] });
    await ready(daemon);
    const status = (await win.call("index.status", {})) as IndexStatus;
    const runtime = status.runtimes.find((r) => r.kind === "claude-code");
    expect(runtime?.agent).toBe("claude");
  });

  it("AC-D8 — a persona created with no daemon is NOT enrolled on the catalog's word (no witness); a record naming a kind the daemon's registry lacks is subtracted at start; the index comes up; the refusal is on the record", async () => {
    // boot 1: no index daemon at all — no witness, so the persona exists in
    // the registry and waits for a ready (R4); the record is not written on
    // the catalog's word alone (the review's finding: that word is what a
    // daemon refuses at its next start)
    const first = await setup({ rosettadBin: "" });
    expect(first.daemon.health().rosettad.phase).toBe("unconfigured");
    const win = await window(first.daemon, ALL, "c5");
    // AR-S2: a persona is a sign-in inside an Agent Profile (a profile set)
    await win.call("agents.profileSets.create", { label: "Ghost" });
    const { persona } = (await win.call("agents.profiles.create", {
      set: "ghost",
      provider: "hermes",
    })) as AgentsProfilesCreateResult;
    expect(persona.runtimeId).toBeUndefined();
    expect(recordRuntimes(first.dataDir)).toEqual([]);
    await first.daemon.stop();
    // the scenario AC-D8 is for: a record an earlier daemon (one that
    // registered hermes) wrote, and a binary under it that does not
    const ghostRoot = join(first.dataDir, ...LAYOUT.AGENT_ROOTS_DIR, "hermes", "ghost-root");
    mkdirSync(ghostRoot, { recursive: true, mode: 0o700 });
    writeRecord(first.dataDir, {
      format: 1,
      enabled_kinds: [],
      runtimes: [
        { kind: "hermes", data_root: ghostRoot, label: "Ghost", profile_id: persona.profileId },
      ],
    });
    // boot 2: the scripted daemon does not register hermes and refuses the
    // file at start (exit 2, "unknown agent kind") — fieldd subtracts the
    // root, restarts the daemon, and it comes up
    const second = await setupAt(first.root, {});
    await until(() => second.daemon.health().rosettad.phase === "ready", 15_000);
    const record = readRecord(second.dataDir);
    expect(record.runtimes.some((rt) => rt.kind === "hermes")).toBe(false);
    const retired = record.retired?.find((rt) => rt.kind === "hermes");
    expect(retired?.profile_id).toBe(persona.profileId);
    expect(retired?.refused?.detail).toContain("unknown agent kind");
    const win2 = await window(second.daemon, ALL, "c5b");
    const status = (await win2.call("index.status", {})) as IndexStatus;
    // the projection says WHEN and WHY, never the root (no paths leave fieldd)
    expect(status.enrollment.retired.find((r) => r.kind === "hermes")?.refused).toMatchObject({
      reason: "unknown agent kind",
    });
    expect(JSON.stringify(status)).not.toContain(second.dataDir);
    const { providers } = (await win2.call("agent.providers", {})) as AgentProvidersResult;
    expect(providers.find((p) => p.id === "hermes")).toMatchObject({ history: "unavailable" });
    // the ready-time reconcile cannot re-add it: the roll call does not
    // spell ~/.hermes, so the daemon stays up and the record stays subtracted
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(second.daemon.health().rosettad.phase).toBe("ready");
    expect(readRecord(second.dataDir).runtimes.some((rt) => rt.kind === "hermes")).toBe(false);
  });

  it("the census fills in behind the ready line: a persona registered before this fieldd is still enrolled at the first ready (the reconcile waits for the roll call), and agent.providers asked at once says indexed, never unavailable", async () => {
    // the R4 row's shape, against a daemon whose roll call is EMPTY for its
    // first 1.2 s after `ready` — the real daemon's window (serve.rs prints
    // ready, then walks the roots and publishes the census)
    const root = mkdtempSync(join(tmpdir(), "vf-cen-"));
    const preRoot = join(
      root,
      ...LAYOUT.USERS_DIR,
      "1",
      ...LAYOUT.AGENT_ROOTS_DIR,
      "claude",
      "late1",
    );
    mkdirSync(preRoot, { recursive: true, mode: 0o700 });
    cleanup.push(() => rmSync(root, { recursive: true, force: true }));
    const { dataDir, daemon } = await setupAt(root, {
      env: { FAKE_ROSETTAD_CENSUS_DELAY_MS: "1200" },
      profiles: {
        version: 1,
        profiles: [
          {
            id: "late1",
            provider: "claude",
            label: "Late",
            kind: "managed",
            dataRoot: preRoot,
            createdAt: "2026-09-12T10:00:00.000Z",
          },
        ],
      },
    });
    await untilAsync(
      async () => recordRuntimes(dataDir).some((rt) => rt.profile_id === "late1"),
      15_000,
    );
    expect(readRecord(dataDir).runtimes).toEqual([
      { kind: "claude-code", data_root: preRoot, label: "Late", profile_id: "late1" },
    ]);
    // the bounce that followed comes up ready with its own empty window, and
    // the door waits it out rather than saying `unavailable`
    await until(() => daemon.health().rosettad.phase === "ready", 15_000);
    const win = await window(daemon, ALL, "cen");
    const { providers } = (await win.call("agent.providers", {})) as AgentProvidersResult;
    expect(providers.find((p) => p.id === "claude")).toMatchObject({ history: "indexed" });
    // its own two 15 s waits, the 1.2 s census window and a rosettad bounce
  }, 30_000);
});
