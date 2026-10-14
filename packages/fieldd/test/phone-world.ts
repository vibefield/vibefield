// PJ-7 — ONE DESKTOP AS THE PERSON'S PHONE MEETS IT, for the phone's witnesses:
// project-doors-phone.test.ts's real-floor rows and the simulator fixture
// (fixtures/ios-phone-place.ts) boot the same world.
//
// Real: fieldd, its files worker (the place scanner reads the place's git
// facts), field-native and its terminal cells, the product door's secret path,
// fieldd's projects, records and ticket mint. Scripted: the agent (a shell
// holding `cat` open, its conversation id fieldd's to know), the index (the
// fake rosettad, whose rows the world writes as rosetta would index a
// transcript), and the tailnet — `MeshStandIn` answers the mesh the sidecar
// would (mesh-stand-in.ts says what that covers).
//
// The place is a real git checkout with an identity remote. Its folder sits
// under the OS temp, and that is the point: a clone with an identity remote is
// its repository wherever it lives (PJ-L4), so it groups as a project and its
// launches write a recipe — a remote-less folder there is Temporary, and writes
// none (LANDED "PJ-6, the launch", Found).
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentAdapterBinding } from "@vibecook/puppeteer-core";
import type { AgentProvider } from "@vibecook/puppeteer-runtime";
import type { AgentCatalogEntry } from "@vibefield/contracts";
import { SOCKETS } from "@vibefield/contracts";
import type { WsCtor } from "@vibefield/fieldd-client";
import WebSocket from "ws";
import { bootstrap, type FielddDaemon } from "../src/index";
import type { SecretStore } from "../src/plugin-settings";
import { TERMINAL_SERVE_ID } from "../src/terminal-serve";
import { SCRIPTED_ROW } from "./agent-catalog-fixture";
import { filesHostLaunch } from "./files-host-bundle";
import { productDoorPath, TEST_LOGIN, writeLinkFixture } from "./link-fixture";
import { MeshStandIn } from "./mesh-stand-in";
import {
  killDaemonTree,
  nativeBinPath,
  nativeEndpoint,
  removeTempRoot,
  shortTmpRoot,
  waitForMgmtEndpoint,
} from "./native-harness";
import { scriptedProfiles } from "./scripted-profiles";

const FAKE_ROSETTAD = join(import.meta.dirname, "fixtures", "fake-rosettad.mjs");
const REPO = join(import.meta.dirname, "..", "..", "..");

/** The scripted agent's row, filed by the index under its own kind (a native
 * resume takes only a conversation the index files under the agent asked). */
export const PHONE_AGENT: AgentCatalogEntry = {
  ...SCRIPTED_ROW,
  seams: { puppeteer: { provider: "scripted" }, rosetta: { kind: "scripted" } },
};

/** The identity remote the place's checkout carries, as git spells it. */
export const PLACE_REMOTE = "https://github.com/acme/phone-place.git";

/** One birth the scripted agent was asked for. */
export interface PhoneBirth {
  cwd: string;
  sessionId: string;
  resume: string | undefined;
  /** the persona the run was bound to (absent: the agent's own folder) */
  profileId?: string | undefined;
}

export interface PhoneWorld {
  root: string;
  dataDir: string;
  daemon: FielddDaemon;
  mesh: MeshStandIn;
  /** the place's folder, as its device spells it (`realpath`) */
  placePath: string;
  /** where a phone dials the product door, playing the sidecar: the secret
   * path is the sidecar's, so the caller must add the login header itself */
  doorUrl: string;
  /** the login a self phone arrives with (the desktop's linked login) */
  login: string;
  /** every birth the scripted agent was asked for, in order */
  births: PhoneBirth[];
  /** the index learns a conversation of the scripted agent in `cwd`, as
   * rosetta would once it read the transcript — under `runtimeId` (default:
   * the agent's own folder, `rt-scripted`; an enrolled persona root's is
   * `rt-scripted-enrolled-<n>`) */
  fileConversation(nativeSessionId: string, cwd: string, runtimeId?: string): void;
  stop(): Promise<void>;
}

function memoryKeychain(): SecretStore {
  const entries = new Map<string, string>();
  return {
    get: async (service, account) => entries.get(`${service}/${account}`) ?? null,
    set: async (service, account, value) => {
      entries.set(`${service}/${account}`, value);
    },
    delete: async (service, account) => {
      entries.delete(`${service}/${account}`);
    },
  };
}

/** The peer link's dialer: this world has one desktop. */
class Unreachable extends WebSocket {
  constructor(_url: string) {
    super("ws://127.0.0.1:1/");
  }
}

async function until(label: string, ok: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error(`the phone's world did not come up: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const rosettaRow = (
  id: string,
  nativeSessionId: string,
  cwd: string,
  at: number,
  runtimeId = "rt-scripted",
) => ({
  id,
  native_session_id: nativeSessionId,
  root_session_id: id,
  parent_session_id: null,
  runtime_id: runtimeId,
  project_id: "p-place",
  cwd,
  title: null,
  summary: null,
  started_at: at - 60_000,
  updated_at: at,
  activity: { first_at: at - 60_000, last_at: at },
  stream_state: "indexed",
  role: "main",
  delegation: null,
});

/** Boot the world: the floor, the stand-in, fieldd, a place, and a door the
 * phone can reach. `onBirth` hears each birth as the agent is asked for it. */
export async function bootPhoneWorld(
  opts: { onBirth?: (birth: PhoneBirth) => void; root?: string } = {},
): Promise<PhoneWorld> {
  const root = opts.root ?? shortTmpRoot("vf-pj7-");
  const dataDir = join(root, "user");
  const home = join(root, "home");
  mkdirSync(join(dataDir, "native", "run"), { recursive: true });
  mkdirSync(home, { recursive: true });
  // the desktop is linked to the account the phone signs in as (UA-P-0a: an
  // unlinked desktop declares no product serve at all)
  writeLinkFixture(dataDir, TEST_LOGIN);

  // the place: a git checkout with an identity remote and a first commit
  const place = join(root, "phone-place");
  mkdirSync(place);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", place, ...args], {
      stdio: "ignore",
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    });
  git("init", "-q", "-b", "main");
  git("remote", "add", "origin", PLACE_REMOTE);
  writeFileSync(join(place, "README.md"), "a place the phone launches into\n");
  git("add", "README.md");
  git("-c", "user.name=PJ-7", "-c", "user.email=pj7@example.test", "commit", "-q", "-m", "first");
  const placePath = realpathSync(place);

  // the index: one conversation already worked in the place, so rosetta
  // roots a project there and the scanner reads it
  const sessionsFile = join(root, "rosetta-sessions.json");
  const runtimesFile = join(root, "rosetta-runtimes.json");
  writeFileSync(
    runtimesFile,
    JSON.stringify([{ id: "rt-scripted", kind: "scripted", data_root: "~/.scripted" }]),
  );
  writeFileSync(
    sessionsFile,
    JSON.stringify([rosettaRow("s-seed", "nat-seed", placePath, Date.now() - 3_600_000)]),
  );

  const native = spawn(process.env["FS2_NATIVE_BIN"] ?? nativeBinPath(REPO), [], {
    env: {
      ...process.env,
      FIELD_NATIVE_DATA_DIR: dataDir,
      FIELD_LOG_DIR: join(dataDir, "logs"),
      FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE: "1",
    },
    stdio: "ignore",
  });
  const children: ChildProcess[] = [native];
  const stops: Array<() => unknown> = [];
  const stop = async () => {
    for (const fn of stops.reverse()) {
      try {
        await fn();
      } catch {
        /* already stopped */
      }
    }
    await Promise.all(children.map((child) => killDaemonTree(child)));
    // the suite's own removal: a floor still writing beside the walk retried,
    // and a leak said on stderr, never a red on housekeeping
    removeTempRoot(root);
  };
  try {
    await waitForMgmtEndpoint(dataDir, 30_000);
    const mesh = new MeshStandIn(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await mesh.start();
    stops.push(() => mesh.stop());

    const births: PhoneBirth[] = [];
    let count = 0;
    const provider: AgentProvider = {
      descriptor: { id: PHONE_AGENT.id, label: PHONE_AGENT.label },
      profiles: scriptedProfiles(),
      async createSession(options): Promise<AgentAdapterBinding> {
        const { runtimeSessionId } = await options.host.spawnTerminal({
          command: "/bin/sh",
          args: ["-c", "exec /bin/cat"],
          cwd: options.cwd,
          env: options.environment ?? {},
        });
        count += 1;
        const birth: PhoneBirth = {
          cwd: options.cwd,
          sessionId: options.resume ?? `pj7-native-${count}-${Date.now()}`,
          resume: options.resume,
          ...(options.profile !== undefined ? { profileId: options.profile.id } : {}),
        };
        births.push(birth);
        opts.onBirth?.(birth);
        return {
          sessionId: birth.sessionId,
          runtimeSessionId,
          observationLevel: () => "terminal-only",
          events: { onCandidate: () => () => undefined },
          services: {
            prompt: {
              async submit() {
                return { status: "rejected" as const, reason: "the phone's world types nothing" };
              },
            },
          },
          async dispose() {},
        };
      },
    };

    const daemon = await bootstrap({
      dataDir,
      controlPort: 0,
      dataPort: 0,
      peerWebSocket: Unreachable as unknown as WsCtor,
      secretStore: memoryKeychain(),
      rosettadBin: "/stand-in/rosettad",
      rosettadSpawn: ((_bin: string, args: readonly string[], options: object) =>
        spawn(process.execPath, [FAKE_ROSETTAD, ...args], {
          ...options,
          env: {
            ...process.env,
            FAKE_ROSETTAD_MODE: "ok",
            FAKE_ROSETTAD_SESSIONS: sessionsFile,
            FAKE_ROSETTAD_RUNTIMES: runtimesFile,
          },
        })) as unknown as typeof spawn,
      rosettadHome: home,
      indexCatalog: { batchMs: 20, digestIntervalMs: 300 },
      vibefieldRoot: root,
      agentSearchPath: join(root, "no-vendor-binaries"),
      agentCatalog: [PHONE_AGENT],
      agentProviders: () => [provider],
      filesHost: await filesHostLaunch(),
      // Browse is the test home's, never this machine's
      workspace: {
        browse: () => ({
          platform: process.platform,
          home,
          user: "",
          fs: {
            readdir: () => [],
            realpath: (path: string) => path,
            isDirectory: existsSync,
            exists: existsSync,
          },
        }),
      },
    });
    stops.push(() => daemon.stop());

    await until("rosettad", () => daemon.health().rosettad.phase === "ready", 30_000);
    await until("the catalog", () => daemon.indexCatalog.ready, 30_000);
    await until("the place's project row", () => daemon.indexCatalog.projects.size === 1, 30_000);
    await until(
      "the mesh identity",
      () => daemon.devices.currentDeviceId() === mesh.mesh.meshDeviceId,
      30_000,
    );
    await until("the product serve", () => mesh.mesh.meshServes.has("product"), 30_000);
    await until(
      "the files worker",
      () => daemon.workspace.supervisor.health().phase === "ready",
      30_000,
    );
    // the scanner has read the place's git: its facts ride the project row
    await until(
      "the place's facts",
      () =>
        daemon.indexCatalog.projects
          .rows()
          .some((row) =>
            (row.places ?? []).some(
              (facts) => facts.path === placePath && facts.identityRemote !== undefined,
            ),
          ),
      60_000,
    );
    daemon.projects.regroupNow();

    const fileConversation = (nativeSessionId: string, cwd: string, runtimeId?: string) => {
      const rows = JSON.parse(readFileSync(sessionsFile, "utf8")) as unknown[];
      rows.push(rosettaRow(`s-${nativeSessionId}`, nativeSessionId, cwd, Date.now(), runtimeId));
      writeFileSync(sessionsFile, JSON.stringify(rows));
      daemon.indexCatalog.resnapshot();
    };

    return {
      root,
      dataDir,
      daemon,
      mesh,
      placePath,
      doorUrl: `ws://127.0.0.1:${daemon.controlPort}${productDoorPath(mesh.mesh)}`,
      login: TEST_LOGIN,
      births,
      fileConversation,
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** The terminal serve is live: what makes a self phone's ticket mintable. */
export function terminalServing(daemon: FielddDaemon): boolean {
  return daemon.mesh
    .serves()
    .some((s) => (s.serveId ?? s.name) === TERMINAL_SERVE_ID && s.status === "active");
}
