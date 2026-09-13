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

/** the vendor's stable release text, and nothing else, reachable */
const fakeFetch: typeof fetch = async (input) => {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url === "https://downloads.claude.ai/claude-code-releases/stable") {
    return new Response("2.2.0\n", { status: 200 });
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

async function setup(
  config: {
    rosettadBin?: string;
    mode?: string;
    real?: boolean;
    /** false = boot with NO VibeField root above the user root (no machine scope) */
    machine?: boolean;
    /** a registry written BEFORE boot (puppeteer's snapshot shape) */
    profiles?: { version: 1; profiles: unknown[] };
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

  it("creating a persona allocates its root under AGENT_ROOTS_DIR (0700), persists the registry (0600), enrolls the observation root under the JOINED kind, bounces the daemon, and the persona carries its runtimeId", async () => {
    const { dataDir, daemon } = await setup();
    await ready(daemon);
    const firstPid = daemon.health().rosettad.pid;
    const win = await window(daemon, ALL, "p2");
    const created = (await win.call("agents.profiles.create", {
      provider: "claude",
      label: "Work",
    })) as AgentsProfilesCreateResult;
    const { persona } = created;
    expect(persona).toMatchObject({ provider: "claude", label: "Work", kind: "managed" });
    expect(persona).not.toHaveProperty("dataRoot");
    expect(persona.runtimeId).toBe("rt-claude-code-enrolled-1");

    // the root: fieldd's directory, puppeteer's allocation
    const rootsDir = join(dataDir, ...LAYOUT.AGENT_ROOTS_DIR, "claude");
    expect(readdirSync(rootsDir)).toEqual([persona.profileId]);
    const root = join(rootsDir, persona.profileId);
    expect(mode(root)).toBe(0o700);
    // the registry: puppeteer's schema, fieldd's custody
    const registryPath = join(dataDir, ...LAYOUT.AGENT_PROFILES_FILE);
    expect(mode(registryPath)).toBe(0o600);
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    expect(registry).toMatchObject({ version: 1 });
    expect(registry.profiles).toHaveLength(1);
    expect(registry.profiles[0]).toMatchObject({
      id: persona.profileId,
      provider: "claude",
      kind: "managed",
      dataRoot: root,
    });
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
    // listed now, with the join
    const listed = (await win.call("agents.profiles.list", {
      provider: "claude",
    })) as AgentsProfilesListResult;
    expect(listed.personas.map((p) => [p.profileId, p.runtimeId])).toEqual([
      ["claude:native-default", undefined],
      [persona.profileId, "rt-claude-code-enrolled-1"],
    ]);
    // audited: the attempt names the provider, the outcome the minted id
    const audit = auditText(dataDir);
    expect(audit).toContain('"agents.profiles.create"');
    expect(audit).toContain(persona.profileId);
    expect(audit).toContain('"indexed":true');
  });

  it("a provider the roll call does not know is created but not indexed (runtimeId absent); verify is honest about an adapter that cannot; unknown and native-default personas are refused typed", async () => {
    const { dataDir, daemon } = await setup();
    await ready(daemon);
    const win = await window(daemon, ALL, "p3");
    // the fake's roll call lists claude-code and codex only — pi's `~/.pi` is
    // not on it, so the persona exists in the registry and waits for an index
    const pid = daemon.health().rosettad.pid;
    const { persona } = (await win.call("agents.profiles.create", {
      provider: "pi",
      label: "Research",
    })) as AgentsProfilesCreateResult;
    expect(persona).toMatchObject({ provider: "pi", kind: "managed", label: "Research" });
    expect(persona.runtimeId).toBeUndefined();
    expect(readRecord(dataDir).runtimes).toEqual([]);
    expect(daemon.health().rosettad.pid).toBe(pid); // nothing changed, nothing bounced
    expect(auditText(dataDir)).toContain('"indexed":false');

    // pi exposes no credential-free identity document: the failure is data
    const verified = (await win.call("agents.profiles.verify", {
      profileId: persona.profileId,
    })) as AgentsProfilesVerifyResult;
    expect(verified.persona.profileId).toBe(persona.profileId);
    expect(verified.failure).toMatchObject({ status: "unsupported", retryable: false });
    expect(auditText(dataDir)).toContain('"agents.profiles.verify"');

    const missing = await win.callErr("agents.profiles.verify", { profileId: "nope" });
    expect(missing.data?.kind).toBe("NOT_FOUND");
    const notOurs = await win.callErr("agents.profiles.delete", {
      profileId: "claude:native-default",
    });
    expect(notOurs.data?.kind).toBe("PRECONDITION_FAILED");
    const gone = await win.callErr("agents.profiles.delete", { profileId: "nope" });
    expect(gone.data?.kind).toBe("NOT_FOUND");
  });

  it("deleting a persona retires its runtime (rows kept, the record names it retired), unregisters it and deletes its root", async () => {
    const { dataDir, daemon } = await setup();
    await ready(daemon);
    const win = await window(daemon, ALL, "p4");
    const { persona } = (await win.call("agents.profiles.create", {
      provider: "claude",
      label: "Temp",
    })) as AgentsProfilesCreateResult;
    const root = join(dataDir, ...LAYOUT.AGENT_ROOTS_DIR, "claude", persona.profileId);
    expect(existsSync(root)).toBe(true);
    const pid = daemon.health().rosettad.pid;

    const deleted = (await win.call("agents.profiles.delete", {
      profileId: persona.profileId,
    })) as AgentsProfilesDeleteResult;
    expect(deleted).toEqual({ deleted: true });
    expect(existsSync(root)).toBe(false);
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
      version: 1,
      profiles: [],
    });
    expect(auditText(dataDir)).toContain('"agents.profiles.delete"');
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
  });

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
  });

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
  });

  it("agents.update runs the vendor's own updater (the scripted `update`), keeps a 0600 transcript under machine/agents/updates, and records the receipt", async () => {
    const { root, dataDir, daemon } = await setup();
    await ready(daemon);
    const win = await window(daemon, ["agents.manage"], "d4");
    const { receipt } = (await win.call("agents.update", {
      provider: "claude",
    })) as AgentsUpdateResult;
    expect(receipt).toMatchObject({ provider: "claude", status: "already-current", exitCode: 0 });
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
      status: "already-current",
    });
    expect(auditText(dataDir)).toContain('"agents.update"');
  });

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
  });
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
      const claude = (await win.call("agents.profiles.create", {
        provider: "claude",
        label: "Kim",
      })) as AgentsProfilesCreateResult;
      const pi = (await win.call("agents.profiles.create", {
        provider: "pi",
        label: "Lab",
      })) as AgentsProfilesCreateResult;
      const record = readRecord(dataDir);
      const claudeRoot = join(
        dataDir,
        ...LAYOUT.AGENT_ROOTS_DIR,
        "claude",
        claude.persona.profileId,
      );
      const piRoot = join(dataDir, ...LAYOUT.AGENT_ROOTS_DIR, "pi", pi.persona.profileId);
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
