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
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AgentDistributionRecord,
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
  type IndexEnrollmentRecord,
  type IndexStatus,
  LAYOUT,
  SOCKETS,
} from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { nativeEndpoint } from "./native-harness";
import { helloAs, until, WsRpc } from "./ws-rpc";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const FAKE_ROSETTAD = join(FIXTURES, "fake-rosettad.mjs");
const FAKE_CLAUDE = join(FIXTURES, "fake-claude");
const fakeSpawner = (mode: string): typeof spawn =>
  ((_bin: string, args: readonly string[], options: object) =>
    spawn(process.execPath, [FAKE_ROSETTAD, ...args], {
      ...options,
      env: { ...process.env, FAKE_ROSETTAD_MODE: mode },
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
    profiles?: { version: 1; profiles: unknown[] };
    /** boot as the product's daemon does: read the agents' installs at boot */
    warm?: boolean;
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
    agentSearchPath: bin,
    agentFetch: fakeFetch,
    ...(config.warm === true ? { agentInventoryWarm: true, logRoot: join(root, "logs") } : {}),
  });
  cleanup.push(() => daemon.stop().catch(() => undefined));
  return { root, dataDir, bin, daemon };
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

/** `setup` at a caller-owned root (the reconcile row plants files first). */
async function setupAt(
  root: string,
  config: { profiles?: { version: 1; profiles: unknown[] } },
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
    rosettadBin: "/stand-in/rosettad",
    rosettadSpawn: fakeSpawner("ok"),
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
  },
);
