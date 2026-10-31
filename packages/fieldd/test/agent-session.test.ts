// Managed sessions (AR-3): the AgentHost over the REAL floor, the fold, the
// persisted continuation, the persona login pane. The first block runs
// against the mock mgmt server (no floor: the doors refuse typed); the rest
// spawns the real field-native (Rust) and drives puppeteer inside fieldd with
// a SCRIPTED provider whose adapter asks the host for a PTY the way every
// built-in adapter does — so the seam under test is VibeField's (the clean
// environment, the agent cell, the ticket, the record, the exit path, the
// resume) and nothing of any vendor's. The persona login pane runs the
// scripted `claude` (test/fixtures/fake-claude) through puppeteer's own
// onboarding. The last block runs the REAL claude when FIELDD_TEST_REAL_AGENT
// names it — the P0 witness at the daemon level: a real agent in a PTY on the
// floor with live status.
//
// AR-4 (stable ingress): the restart rows boot a SECOND fieldd on the first
// one's root with field-native still running — a graceful stop RELEASES the
// runs, and the next boot's first inventory re-attaches (the scripted
// provider with `attachSession`), holds PENDING (without), and resumes a
// pending run by hand (`agent.resume`) or by itself once the fake rosettad's
// session rows say the conversation has been still (resume-when-idle).
//
// The witnesses answer to a review (2026-09-12), and what it asked for is the
// difference between a claim and evidence: the clean environment is read as a
// SET (an allow-list, which a deny-list would fail), the bound ingress is
// asserted at every place it travels, "the old PTY is gone before the new run
// is born" is measured as two TIMES rather than an end state, the ledger is
// parsed rather than grepped, a window in which nothing changed also carries
// the poller's own request count, and the index is asked with a canonical row
// and a decoy beside it.
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_EXIT,
  AGENT_FIELD,
  AGENT_MONITOR_SCHEMA_VERSION,
  type AgentAccountUsageBatch,
  type AgentCatalogEntry,
  AgentFieldRow,
  type AgentListResult,
  type AgentProvidersResult,
  AgentSessionRecord,
  type AgentSpawnResult,
  type AgentsExtensionsListResult,
  type AgentsExtensionsSignInResult,
  type AgentsProfileSetsDeleteResult,
  type AgentsProfileSetsListResult,
  type AgentsProfileSetsSetResult,
  type AgentsProfilesCreateResult,
  type AgentsProfilesDeleteResult,
  type AgentsProfilesListResult,
  type AgentsProfilesLoginResult,
  type ComposeSparksHatchResult,
  LAYOUT,
  type PlaceFacts,
  SOCKETS,
  type SparkRecord,
  TERMINAL_INVENTORY,
  type TerminalInfo,
} from "@vibefield/contracts";
import {
  type AccountUsageService,
  type AgentAdapterBinding,
  type AgentAttachNext,
  type AgentAttachRecord,
  AgentAttachRefusedError,
  type AgentBriefingCapabilities,
  type AgentHost,
  type AgentModelService,
  type AgentProfile,
  type AgentRunBriefing,
  type AgentTurnStopService,
  type BoundIngress,
  defineModelService,
  type ExtensionService,
  type PromptReceipt,
  type PromptSubmission,
} from "@vibefield/puppeteer-core";
import type {
  AgentProvider,
  AgentProviderSessionOptions,
  AttachProviderSessionOptions,
} from "@vibefield/puppeteer-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { EXIT_GRACE_MS } from "../src/agent-runtime";
import { bootstrap, type FielddDaemon, SessionRecordStore } from "../src/index";
import { RpcCallError } from "../src/native-link";
import type { SecretStore } from "../src/plugin-settings";
import { MockMgmtServer } from "../src/testing/mock-mgmt";
import { SparkStore } from "../src/tool-plane/sparks";
import { RootsRegistry } from "../src/workspace/roots";
import { born } from "./agent-birth";
import { catalogWith, SCRIPTED_CATALOG, SCRIPTED_ROW } from "./agent-catalog-fixture";
import {
  type FloorScene,
  killDaemonTree,
  nativeBinPath,
  nativeEndpoint,
  removeTempRoot,
  shortTmpRoot,
  waitForMgmtEndpoint,
  waitWithEvidence,
} from "./native-harness";
import { scriptedProfiles } from "./scripted-profiles";
import { helloAs, type RpcErrorShape, WsRpc } from "./ws-rpc";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const BIN = nativeBinPath(ROOT);
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const FAKE_ROSETTAD = join(FIXTURES, "fake-rosettad.mjs");
const FAKE_CLAUDE = join(FIXTURES, "fake-claude");
const fakeSpawner = (mode: string, extra: Record<string, string> = {}): typeof spawn =>
  ((_bin: string, args: readonly string[], options: object) =>
    spawn(process.execPath, [FAKE_ROSETTAD, ...args], {
      ...options,
      env: { ...process.env, FAKE_ROSETTAD_MODE: mode, ...extra },
    })) as unknown as typeof spawn;

const rendererParticipant = (suffix: string) => ({
  participantId: `renderer:desktop-test:window-${suffix}`,
  incarnation: `renderer:desktop-test:window-${suffix}:document-1`,
});

let children: ChildProcess[] = [];
let roots: string[] = [];
let cleanup: Array<() => void | Promise<void>> = [];
/** Item 68 — the row's floor and daemon, for its waits' evidence: set by `setup`, cleared after each row. */
let scene: FloorScene | undefined;
afterEach(async () => {
  scene = undefined;
  for (const fn of cleanup.reverse()) {
    try {
      await fn();
    } catch {
      /* already-stopped daemons and dead sockets are fine */
    }
  }
  cleanup = [];
  // Kill each floor's whole TREE and await the real exits BEFORE removing the
  // root (cross-daemon.test.ts / mesh-lane.test.ts do the same): field-native
  // spawns children of its own, a dying daemon can still be writing inside the
  // temp root while rmSync walks it (ENOTEMPTY), and on win32 a surviving
  // grandchild's handle makes the removal EPERM outright. The old teardown
  // removed the root first, with a bare SIGKILL to the parent only.
  await Promise.all(children.map((child) => killDaemonTree(child)));
  children = [];
  for (const root of roots) removeTempRoot(root);
  roots = [];
});

/** The scripted provider: an adapter that owns nothing but a recipe. Its
 * `createSession` asks the HOST for a PTY running a shell that writes its
 * environment to a file the test reads (the EL7 witness) and then holds the
 * PTY open with a `cat` whose OWN stdout is a second file — so what the
 * automation seam types reaches a real process and can be read back without a
 * data leg; its prompt service is `automateTerminal`; a resume arrives as
 * `options.resume`, which it records and continues as the native id. It also
 * binds an ingress the way an adapter with a loopback listener does: the pair
 * is reported through `options.ingress.onBound` BEFORE the process launches,
 * which is the contract a host that outlives its agent depends on. */
interface ScriptedSession {
  runtimeSessionId: string;
  sessionId: string;
  resume: string | undefined;
  host: AgentHost;
  /** the loopback pair this run reported before its process launched */
  ingress: BoundIngress;
  /** the instant `createSession` was ENTERED — the earliest moment this run
   * can be said to exist. A replacement's claim ("the old PTY is gone before
   * the new run is born") is measured against this. */
  bornAt: number;
  /** where this run's `cat` writes whatever is typed into its PTY */
  typedOut: string;
  briefing: AgentRunBriefing;
}
/** AR-4 — what the scripted adapter was asked to attach to. */
interface ScriptedAttach {
  runtimeSessionId: string;
  sessionId: string;
  ingress: AttachProviderSessionOptions["ingress"];
  /** the re-attach study's Step 1 — the launch options the codec restored,
   * and the attach record the host handed back */
  agentOptions: unknown;
  attachRecord: AgentAttachRecord | undefined;
}

/** Step 1 — what the scripted codec captures for every launch (`facts`): a
 * stand-in for a typed root an attach must hand back */
const SCRIPTED_STATE = JSON.stringify({ root: "scripted-root" });
const SPARK_BRIEFING: AgentBriefingCapabilities = {
  mcpServers: true,
  allowTools: true,
  instructions: true,
  mcpServerProcess: "terminal",
};

/** An older CP-1c run already belonged to a spark but was born before the briefing shipped. */
function keepLegacySpark(box: Box, runId: string): SparkRecord {
  const spark: SparkRecord = {
    format: 1,
    id: "sp-7k2m9q4x",
    name: "Vela",
    face: { seed: 7 },
    agent: "scripted",
    profiles: ["native"],
    thinksUnder: "native",
    folder: box.envOut,
    createdAt: "2026-10-29T12:00:00.000Z",
    updatedAt: "2026-10-29T12:00:00.000Z",
  };
  const store = new SparkStore({
    dir: join(box.dataDir, ...LAYOUT.SPARKS_DIR),
    keyPath: join(box.dataDir, ...LAYOUT.SPARKS_KEY_FILE),
  });
  store.write(spark);
  writeFileSync(join(spark.folder, "CLAUDE.md"), "The legacy spark's fresh briefing.");
  box.records.write({ ...readRecord(box.dataDir, runId), spark: spark.id, origin: { by: "you" } });
  return spark;
}

/** The text the scripted turn stop types: a line, because the PTY's `cat`
 * reads in canonical mode and a lone key byte would never reach its file. */
const SCRIPTED_TURN_STOP_TEXT = "scripted-turn-stop\n";

/** `turnStops` — Q08: the binding names a turn stop (an `escape` key, by
 * declaration) and records each press, by its terminal; absent, the binding
 * names none, as an adapter that has not been censused yet. */
function scriptedBinding(
  host: AgentHost,
  runtimeSessionId: string,
  sessionId: string,
  turnStops?: string[],
): AgentAdapterBinding {
  const turnStop: AgentTurnStopService | undefined =
    turnStops === undefined
      ? undefined
      : {
          stop: { kind: "key", key: "escape" },
          async submit() {
            turnStops.push(runtimeSessionId);
            const result = await host.automateTerminal(runtimeSessionId, {
              kind: "text",
              text: SCRIPTED_TURN_STOP_TEXT,
            });
            return result.accepted
              ? { accepted: true }
              : { accepted: false, reason: result.reason };
          },
        };
  return {
    sessionId,
    runtimeSessionId,
    observationLevel: () => "terminal-only",
    events: { onCandidate: () => () => undefined },
    services: {
      prompt: {
        async submit(submission: PromptSubmission): Promise<PromptReceipt> {
          const result = await host.automateTerminal(runtimeSessionId, {
            kind: "paste",
            text: submission.text,
            submit: submission.mode !== "paste-only",
          });
          return result.accepted
            ? { status: "confirmed" }
            : { status: "rejected", reason: result.reason };
        },
      },
      turnStop,
    },
    async dispose() {},
  };
}
/** AR-S4c — the scripted agent's one remote server, `linear`: it asks for a
 * sign-in until its sign-in — a shell in a pane on the floor — leaves `mark`. */
function scriptedExtensions(mark: string): ExtensionService {
  return {
    provider: {
      id: "scripted",
      label: "Scripted",
      support: { mcpServers: { store: "profile", changes: "command", read: true } },
    },
    inventory: async (profile) => ({
      provider: "scripted",
      profileId: profile.id,
      fetchedAt: new Date().toISOString(),
      items: [
        {
          kind: "mcp-server",
          id: "linear",
          name: "linear",
          origin: "own",
          enabled: true,
          transport: "http",
          target: "https://mcp.linear.app/mcp",
          auth: existsSync(mark) ? "signed-in" : "needs-sign-in",
        },
      ],
      source: { kind: "native-store", stability: "documented" },
    }),
    plan: (_profile, item, act) =>
      act === "sign-in"
        ? {
            target: { kind: item.kind, id: item.id },
            act,
            available: true,
            runs: { kind: "terminal", argv: ["/bin/sh", "-c", `touch '${mark}'`] },
            display: "scripted mcp login linear",
            reaches: [],
          }
        : {
            target: { kind: item.kind, id: item.id },
            act,
            available: false,
            reason: "no-command",
            message: "no command here",
          },
  };
}

/** AR-S4c — a built-in agent's extension reads, answered empty: no test here
 * reads this machine's homes. */
function withoutExtensionReads(provider: AgentProvider): AgentProvider {
  const real = provider.extensions;
  if (real === undefined) return provider;
  return {
    ...provider,
    extensions: {
      provider: real.provider,
      inventory: async (profile) => ({
        provider: provider.descriptor.id,
        profileId: profile.id,
        fetchedAt: new Date().toISOString(),
        items: [],
        source: { kind: "native-store", stability: "documented" },
      }),
    },
  };
}

/** PJ-6 — the scripted agent's own model picker, as an adapter declares one:
 * two models, the first with an effort control, read per account and folder.
 * `fail` makes the read fail the way a signed-out agent's does; `reads`
 * counts the reads (a launch at a model discovers again; one without does
 * not); `options` is what each launch was handed to start at — puppeteer's
 * translation of the selection, the adapter's private options. PJ-6 (Q4) —
 * `resumeSelection`: whether its resume takes a selection (fixed at boot);
 * `discovered`: the account each read ran in (a resume's must be the
 * session's own). */
interface ScriptedModels {
  fail: boolean;
  reads: number;
  options: unknown[];
  resumeSelection: boolean;
  discovered: Array<string | undefined>;
}

const SCRIPTED_MODELS = [
  {
    id: "model-a",
    label: "Model A",
    controls: [
      {
        id: "effort",
        label: "Effort",
        role: "effort" as const,
        values: [
          { id: "low", label: "low" },
          { id: "high", label: "high" },
        ],
      },
    ],
  },
  { id: "model-b", label: "Model B", controls: [] },
];

function scriptedModels(state: ScriptedModels): AgentModelService {
  return defineModelService({
    provider: {
      id: "scripted",
      label: "Scripted",
      discovery: "prelaunch",
      resumeSelection: state.resumeSelection,
    },
    async discover(context) {
      state.reads += 1;
      state.discovered.push(context.profile?.id);
      if (state.fail)
        return {
          status: "auth-required",
          provider: "scripted",
          code: "auth-required",
          message: "Sign in to discover models.",
        };
      return {
        status: "available",
        catalog: {
          provider: "scripted",
          ...(context.profile !== undefined ? { profileId: context.profile.id } : {}),
          cwd: context.cwd,
          observedAt: new Date().toISOString(),
          source: { kind: "native-protocol", freshness: "live" },
          completeness: "complete",
          customModels: false,
          models: SCRIPTED_MODELS,
        },
      };
    },
    toAgentOptions: (selection) => ({
      model: selection.modelId,
      ...(selection.controls?.["effort"] !== undefined
        ? { effort: selection.controls["effort"] }
        : {}),
    }),
  });
}

function scriptedProvider(
  envOut: string,
  sessions: ScriptedSession[],
  /** `refusals` — G5: the attaches this provider refuses first, each with its
   * next step, in order */
  attach: { records: ScriptedAttach[]; refusals?: AgentAttachNext[] } | undefined,
  extra: {
    profiles?: boolean;
    seen?: Array<AgentProfile | undefined>;
    signInMark?: string;
    models?: ScriptedModels;
    /** item 72 — held here after the PTY is born, before the spawn returns (and the runtime registers the run) */
    afterBirth?: (runtimeSessionId: string) => Promise<void>;
    /** item 81 — the PTY's own `sh -c` program (default: the environment written, then the PTY held by `cat`) */
    program?: string;
    /** Q08 — each binding names a turn stop, and each press lands here (absent: none named) */
    turnStops?: string[];
    /** the re-attach study's Step 1 — a continuation codec (every launch
     * captures `SCRIPTED_STATE`) and an attach record, reported before the
     * launch (`endpoint-<n>`) and again by each attach (`<handed>-attached`) */
    facts?: boolean;
    briefing?: AgentBriefingCapabilities;
    exerciseDoor?: boolean;
  } = {},
): AgentProvider {
  let counter = 0;
  return {
    descriptor: {
      id: "scripted",
      label: "Scripted",
      ...(extra.briefing === undefined ? {} : { briefing: extra.briefing }),
    },
    ...(extra.facts === true
      ? {
          launch: {
            provider: { id: "scripted", label: "Scripted", resume: true },
            continuation: {
              capture: () => SCRIPTED_STATE,
              restore: (state: string | undefined) =>
                state === undefined ? undefined : (JSON.parse(state) as unknown),
            },
          },
        }
      : {}),
    ...(extra.profiles === true ? { profiles: scriptedProfiles() } : {}),
    ...(extra.signInMark !== undefined ? { extensions: scriptedExtensions(extra.signInMark) } : {}),
    ...(extra.models !== undefined ? { models: scriptedModels(extra.models) } : {}),
    async createSession(options: AgentProviderSessionOptions): Promise<AgentAdapterBinding> {
      const bornAt = Date.now();
      const n = ++counter;
      // AR-S2 — the account a spawn was bound to, as the runtime resolved it
      extra.seen?.push(options.profile);
      // PJ-6 — what the launch was handed to start at
      extra.models?.options.push(options.agentOptions);
      const out = join(envOut, `session-${n}.env`);
      const typedOut = join(envOut, `session-${n}.typed`);
      // the stable-ingress contract, from the adapter's side: bound, then
      // REPORTED, and only then does anything launch. (The counter is this
      // provider instance's, so a restart's first run repeats the pair — no
      // listener is ever really bound, and nothing here assumes uniqueness.)
      const ingress: BoundIngress = { port: 40_000 + n, token: `bearer-${n}` };
      options.ingress?.onBound?.(ingress);
      if (extra.facts === true) {
        options.ingress?.onAttachRecord?.({
          version: 1,
          state: `endpoint-${n}`,
          secret: `nonce-${n}`,
        });
      }
      const doorRecipe = extra.exerciseDoor && options.mcpServers?.vibefield;
      const briefingFile = join(envOut, `session-${n}.briefing.json`);
      if (doorRecipe)
        writeFileSync(
          briefingFile,
          JSON.stringify({ server: doorRecipe, output: join(envOut, `session-${n}.tools.json`) }),
        );
      const { runtimeSessionId } = await options.host.spawnTerminal({
        command: "/bin/sh",
        // the environment lands ATOMICALLY (written beside, then renamed): the
        // witness polls for the file, and a reader that met it half-written
        // once read the adapter's token as absent under a loaded host
        args: [
          "-c",
          extra.program ??
            `env > "$SCRIPTED_ENV_OUT.part" && mv "$SCRIPTED_ENV_OUT.part" "$SCRIPTED_ENV_OUT"; exec /bin/cat >> "$SCRIPTED_TYPED_OUT"`,
        ],
        ...(doorRecipe
          ? {
              command: process.execPath,
              args: [join(FIXTURES, "spark-mcp-client.mjs"), briefingFile],
            }
          : {}),
        cwd: options.cwd,
        env: {
          // AR-S4d — a host's launch values, beneath the adapter's own, as the built-ins merge them
          ...options.environment,
          SCRIPTED_ENV_OUT: out,
          SCRIPTED_TYPED_OUT: typedOut,
          SCRIPTED_TOKEN: `token-${n}`,
          // an adapter asking for a daemon-secret class: the host must refuse it
          FIELDD_SMUGGLED: "never",
        },
      });
      await extra.afterBirth?.(runtimeSessionId);
      const sessionId = options.resume ?? `scripted-native-${n}`;
      sessions.push({
        runtimeSessionId,
        sessionId,
        resume: options.resume,
        host: options.host,
        ingress,
        bornAt,
        typedOut,
        briefing: {
          ...(options.mcpServers === undefined ? {} : { mcpServers: options.mcpServers }),
          ...(options.allowTools === undefined ? {} : { allowTools: options.allowTools }),
          ...(options.instructions === undefined ? {} : { instructions: options.instructions }),
        },
      });
      return scriptedBinding(options.host, runtimeSessionId, sessionId, extra.turnStops);
    },
    // AR-4 — an adapter that can re-attach to its running process: it records
    // what it was handed and binds the same terminal and native session
    ...(attach === undefined
      ? {}
      : {
          async attachSession(options: AttachProviderSessionOptions): Promise<AgentAdapterBinding> {
            attach.records.push({
              runtimeSessionId: options.runtimeSessionId,
              sessionId: options.sessionId,
              ingress: options.ingress,
              agentOptions: options.agentOptions,
              attachRecord: options.attachRecord,
            });
            const next = attach.refusals?.shift();
            if (next !== undefined) throw new AgentAttachRefusedError(next, `scripted: ${next}`);
            // the attached run's facts moved (a helper reborn): the next restart must read these
            if (extra.facts === true) {
              options.onAttachRecord?.({
                version: 1,
                state: `${options.attachRecord?.state ?? "none"}-attached`,
                secret: "nonce-attached",
              });
            }
            return scriptedBinding(
              options.host,
              options.runtimeSessionId,
              options.sessionId,
              extra.turnStops,
            );
          },
        }),
  };
}

interface Box {
  root: string;
  dataDir: string;
  bin: string;
  envOut: string;
  daemon: FielddDaemon;
  sessions: ScriptedSession[];
  /** AR-4 — the scripted adapter's attach log (empty when it cannot attach) */
  attached: ScriptedAttach[];
  /** AR-4 — the file the fake rosettad serves session rows from */
  sessionsFile: string;
  /** QL — extra `/api/runtimes` rows the fake rosettad serves (a scripted
   * session's runtime, so the index can say which agent it belongs to) */
  runtimesFile: string;
  /** AR-4 — one line per `/api/sessions` the fake rosettad answered: the
   * poller's own footprint, so a window in which nothing changed can say
   * whether anything was ASKED in it */
  requestLog: string;
  /** the product's own record store over this root — the only way a test can
   * stage a record the daemon will still act on (AR-4b: an unsigned or
   * re-written record is set aside, which is a different witness) */
  records: SessionRecordStore;
  /** AR-S2 — the account each scripted spawn was bound to, in order */
  seen: Array<AgentProfile | undefined>;
  /** PJ-6 — the scripted agent's model picker and what each launch started at */
  models: ScriptedModels;
  /** Q08 — each press of the scripted turn stop, by terminal (`turnStop: true`) */
  turnStops: string[];
}

interface SetupConfig {
  floor: "mock" | "real";
  briefing?: AgentBriefingCapabilities;
  exerciseDoor?: boolean;
  /** AR-S4d — the keychain fieldd keeps server values in (default: a map; never the machine's) */
  secretStore?: SecretStore;
  realAgent?: boolean;
  /** AR-4 — give the scripted provider an `attachSession` */
  attach?: boolean;
  /** G5 — the attaches THIS boot's scripted provider refuses first, in order */
  attachRefusals?: AgentAttachNext[];
  /** the re-attach study's Step 1 — the scripted codec and attach record */
  facts?: boolean;
  /** AR-4 — boot a SECOND fieldd on this box's root, its field-native still
   * running and its records on disk: the restart */
  restartOf?: Box;
  resumeWhenIdle?: { afterMs: number; pollMs: number };
  /** the fake rosettad's scripted misbehaviour for THIS boot (default `ok`) */
  rosettadMode?: string;
  /** AR-S2 — give the scripted provider an account capability (sign-ins) */
  profiles?: boolean;
  /** AR-S4c — the scripted agent holds a server whose sign-in runs in a pane;
   * every built-in agent's extension reads answer empty */
  extensions?: boolean;
  /** the catalog this fieldd answers from (default: THE table plus the scripted row) */
  catalog?: readonly AgentCatalogEntry[];
  /** Replace every real quota reader; only the fake Claude service remains. */
  usage?: AccountUsageService;
  /** PJ-6 (Q4) — whether the scripted agent's resume takes a model (default yes) */
  resumeSelection?: boolean;
  /** item 72 — the scripted agent waits here once its PTY is born, before its spawn returns */
  afterBirth?: (runtimeSessionId: string) => Promise<void>;
  /** item 81 — the scripted agent's own `sh -c` program */
  program?: string;
  /** Q08 — the scripted adapter names a turn stop (default: it names none) */
  turnStop?: boolean;
}

/** Boot fieldd: over the mock mgmt server (no floor) or the REAL field-native. */
async function setup(config: SetupConfig): Promise<Box> {
  const restart = config.restartOf;
  const root = restart?.root ?? shortTmpRoot("vf-ar3-");
  // the root is removed in afterEach AFTER every floor's tree is reaped
  if (restart === undefined) roots.push(root);
  const dataDir = join(root, ...LAYOUT.USERS_DIR, "1");
  const bin = join(root, "bin");
  const envOut = join(root, "env-out");
  const home = join(dataDir, "home");
  const sessionsFile = join(root, "rosetta-sessions.json");
  const requestLog = join(root, "rosetta-requests.log");
  const runtimesFile = join(root, "rosetta-runtimes.json");
  if (restart === undefined) {
    mkdirSync(join(dataDir, "native", "run"), { recursive: true });
    mkdirSync(bin);
    copyFileSync(FAKE_CLAUDE, join(bin, "claude"));
    mkdirSync(envOut);
    mkdirSync(home, { recursive: true });
  }
  // when this setup spawned the floor (a restart's floor was spawned earlier): the evidence's clock (item 63)
  let spawnedAt: number | undefined;
  if (restart !== undefined) {
    // the floor is the one already running; only fieldd is reborn
  } else if (config.floor === "mock") {
    writeFileSync(join(dataDir, "native", "pairing"), "ab".repeat(32));
    const mock = new MockMgmtServer(nativeEndpoint(dataDir, SOCKETS.MGMT));
    await mock.start();
    cleanup.push(() => mock.stop());
  } else {
    spawnedAt = Date.now();
    const child = spawn(BIN, [], {
      env: {
        ...process.env,
        FIELD_NATIVE_DATA_DIR: dataDir,
        FIELD_LOG_DIR: join(dataDir, "logs"),
        FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE: "1",
      },
      stdio: "ignore",
    });
    children.push(child);
    await waitForMgmtEndpoint(dataDir, 15_000);
  }
  // The scripted `claude` is what puppeteer's claude profile service runs for
  // the login pane and the identity read (it resolves the executable from
  // this variable at construction); the real-agent block leaves it unset so
  // the vendor's own binary is launched.
  // Codex, the other adapter that reads who is signed in, is pinned to a path
  // that does not exist, so no row can run a developer's own codex; the fake
  // claude keeps This Mac's signed-out mark in the test's own folder.
  const pins: Record<string, string | undefined> = config.realAgent
    ? { PUPPETEER_CLAUDE_BIN: undefined }
    : {
        PUPPETEER_CLAUDE_BIN: join(bin, "claude"),
        PUPPETEER_CODEX_BIN: join(bin, "no-real-codex"),
        FAKE_CLAUDE_STATE_DIR: bin,
      };
  for (const [name, value] of Object.entries(pins)) {
    const previous = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
    cleanup.push(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
  const sessions: ScriptedSession[] = restart?.sessions ?? [];
  const seen: Array<AgentProfile | undefined> = restart?.seen ?? [];
  const attached: ScriptedAttach[] = restart?.attached ?? [];
  const turnStops: string[] = restart?.turnStops ?? [];
  const models: ScriptedModels = restart?.models ?? {
    fail: false,
    reads: 0,
    options: [],
    resumeSelection: config.resumeSelection ?? true,
    discovered: [],
  };
  const daemon = await bootstrap({
    dataDir,
    // item 68 — fieldd's own log beside the floor's, for the waits' evidence (fieldd logged nowhere here before)
    logRoot: join(dataDir, "logs"),
    controlPort: 0,
    dataPort: 0,
    secretStore: config.secretStore ?? keychainIn(new Map()),
    rosettadBin: "/stand-in/rosettad",
    rosettadSpawn: fakeSpawner(config.rosettadMode ?? "ok", {
      FAKE_ROSETTAD_SESSIONS: sessionsFile,
      FAKE_ROSETTAD_REQUEST_LOG: requestLog,
      FAKE_ROSETTAD_RUNTIMES: runtimesFile,
    }),
    rosettadHome: home,
    vibefieldRoot: root,
    agentSearchPath: bin,
    agentCatalog: config.catalog ?? SCRIPTED_CATALOG,
    agentProviders: (builtin) => {
      const usage = config.usage;
      const providers =
        usage === undefined
          ? builtin
          : builtin.map(({ accountUsage: _usage, ...provider }) =>
              provider.descriptor.id === "claude" ? { ...provider, accountUsage: usage } : provider,
            );
      return [
        ...(config.extensions === true ? providers.map(withoutExtensionReads) : providers),
        scriptedProvider(
          envOut,
          sessions,
          config.attach
            ? {
                records: attached,
                ...(config.attachRefusals !== undefined
                  ? { refusals: [...config.attachRefusals] }
                  : {}),
              }
            : undefined,
          {
            profiles: config.profiles === true,
            ...(config.briefing === undefined ? {} : { briefing: config.briefing }),
            ...(config.exerciseDoor === undefined ? {} : { exerciseDoor: config.exerciseDoor }),
            seen,
            ...(config.extensions === true ? { signInMark: join(root, "scripted-signed-in") } : {}),
            models,
            ...(config.afterBirth !== undefined ? { afterBirth: config.afterBirth } : {}),
            ...(config.program !== undefined ? { program: config.program } : {}),
            ...(config.turnStop === true ? { turnStops } : {}),
            ...(config.facts === true ? { facts: true } : {}),
          },
        ),
      ];
    },
    ...(config.resumeWhenIdle !== undefined ? { agentResumeWhenIdle: config.resumeWhenIdle } : {}),
    // FS-1a — every run's folder becomes a place, a test root under /tmp or
    // /var/folders included: a place refuses only a filesystem root. The
    // /System, /Library and /private exclusion is the browse exports' (and
    // `/` everyone's), so no rule needs lifting here (2026-10-07: this note
    // said one was).
    // no floor: a spawn must refuse quickly, not wait a cell's whole birth budget
    ...(config.floor === "mock" ? { terminalBirthWaitMs: 300 } : {}),
  });
  cleanup.push(() => daemon.stop().catch(() => undefined));
  scene = { dataDir, spawnedAt, link: daemon.native };
  // The floor's terminal endpoints reach the daemon over the management link AFTER `bootstrap` resolves, so a row that
  // births at once is refused UNAVAILABLE "the terminal floor is not available". Wait for them, as a window would: the
  // 10-08 fix in `agent-gateway-floor.ts` (ec011806, "red in 3 of 9 gates, a different row each time"), whose second
  // site this is. The race was sighted here first at QL-D10's row (the MV landing, 8a851973) and again at PJ-7's
  // (2026-10-15 12:45Z, WP12 L2b-i's verify-2). A real floor only — a restart's floor is real too; the mock serves none.
  // 30 s, inside the rows' own 60 s budgets: a floor that never sends them fails HERE, as this wait timing out, not
  // as a refused birth deep inside a row. Item 63 (2026-10-26): the timeout's error carries the floor's own log and
  // fieldd's view of the link (since item 68 through this suite's `poll`, as every wait here does), because the root
  // that holds those logs is removed after the row. Measured on a Mac
  // with 10 cores: a boot takes ~55 ms warm and ~2 s on a run's first (cold) exec, and it stays flat under CPU load
  // (2.6 s cold at load 290). So 30 s is ~11× the worst boot measured: a miss is a stalled boot, not a slow one, and
  // the error says which step stalled.
  if (config.floor === "real")
    await poll(
      async () => (daemon.native.terminalEndpoints !== undefined ? true : undefined),
      30_000,
      "the floor's terminal endpoints reaching the daemon",
    );
  const records =
    restart?.records ??
    new SessionRecordStore({
      dir: join(dataDir, ...LAYOUT.AGENT_SESSIONS_DIR),
      keyPath: join(dataDir, ...LAYOUT.AGENT_SESSIONS_KEY_FILE),
      now: () => new Date(),
    });
  return {
    root,
    dataDir,
    bin,
    envOut,
    daemon,
    sessions,
    attached,
    sessionsFile,
    runtimesFile,
    requestLog,
    records,
    seen,
    models,
    turnStops,
  };
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

const DECK = ["agent.spawn", "agent.observe", "terminal.attach", "index.read"];

/** MF-1 — the field row's vocabulary, read from the CONTRACT so a leak in the
 * projection cannot pass through this door unnoticed. */
const FIELD_ROW_KEYS = Object.keys(AgentFieldRow.shape);

/** Every wait in this suite (item 68): at its deadline it says what was awaited, what the row last `seen`, and the
 * row's floor and fieldd logs with the link view (`waitWithEvidence`), and a `witness`'s word when one is given
 * (item 97: asked once, at the deadline). The budgets are the rows' own. */
async function poll<T>(
  fn: (seen: (value: unknown) => void) => Promise<T | undefined>,
  ms: number,
  what = "the row's condition",
  witness?: () => Promise<string>,
): Promise<T> {
  return await waitWithEvidence(what, fn, ms, () => scene, 100, witness);
}

/** What an interrupted run's HEARD exit has to read exited in (AR-6-0, MF-1g's `endedRun`): the floor's
 * interrupt, `cat`'s end, the floor's `session-exited` and the fold, on a loaded host. */
const INTERRUPTED_EXIT_MS = 15_000;

/** Item 97 — the same exit, never heard. On top of the heard budget, two things:
 * - the floor's next reconcile lists the kept pane `exited`: the exit itself asks for one at once, and the
 *   backstop period bounds it;
 * - fieldd's backstop then waits its grace for an exit event that will not come. */
const LOST_EXIT_MS = INTERRUPTED_EXIT_MS + TERMINAL_INVENTORY.BACKSTOP_MS + EXIT_GRACE_MS;

/** Item 97 — what a lost exit leaves, for an exit wait's deadline (`poll`'s witness). Three things:
 * - the floor's own row for the pane: its cell's list, through `runtimeSessions`, listed or not, and whether it
 *   says the process exited;
 * - whether fieldd's terminal service heard the floor's `session-exited` (`exitOf`);
 * - what still holds the run's typed-out file (`lsof -t`, each holder with its `ps` state). That is the scripted
 *   `cat` the interrupt should have ended.
 *
 * Between them they name the case: the interrupt never ended `cat` (it still holds the file); `cat` ended and the
 * floor never saw it (its row is not `exited`); or the floor saw it and fieldd never heard. */
function exitWitness(box: Box, paneId: string): () => Promise<string> {
  return async () => {
    const floorRow = await box.daemon.terminals.runtimeSessions().then(
      ({ sessions }) => {
        const row = sessions.find((session) => session.id === paneId);
        if (row === undefined) return "not listed";
        const { exited, exitOutcome, exitCode, exitSignal, pid } = row;
        return JSON.stringify({ exited, exitOutcome, exitCode, exitSignal, pid });
      },
      (error: unknown) => `unread (${error instanceof Error ? error.message : String(error)})`,
    );
    const heard = box.daemon.terminals.exitOf(paneId);
    const typedOut = box.sessions.find((s) => s.runtimeSessionId === paneId)?.typedOut;
    return [
      `the floor's row for pane ${paneId}: ${floorRow}`,
      `fieldd heard its exit: ${heard === undefined ? "no" : JSON.stringify({ exitOutcome: heard.exitOutcome, exitCode: heard.exitCode })}`,
      typedOut === undefined
        ? "no typed-out file names this pane"
        : `holding ${typedOut}: ${holdersOf(typedOut)}`,
    ].join("\n");
  };
}

/** The processes holding `path` open (`lsof -t`, which exits 1 when none does), each with its `ps` state. */
function holdersOf(path: string): string {
  let pids: string[];
  try {
    pids = execFileSync("lsof", ["-t", path], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch (error) {
    if ((error as { status?: number }).status === 1) return "nothing";
    return `unread (${error instanceof Error ? error.message : String(error)})`;
  }
  return pids
    .map((pid) => {
      try {
        return execFileSync("ps", ["-o", "pid=,stat=,command=", "-p", pid], {
          encoding: "utf8",
        }).trim();
      } catch {
        return `${pid} (gone)`;
      }
    })
    .join("; ");
}

/** Item 118 — the scripted pane's prologue's budget on a loaded host: the cell join's (`joinedRow`). */
const CAT_READY_MS = 15_000;

/** Item 118 — a row that ends the scripted run with the floor's ⌃C first reads that the pane's process IS `cat`.
 * The program is `/bin/sh -c 'env > … && mv …; exec /bin/cat >> …'`, and macOS's `/bin/sh` is bash 3.2: a ⌃C that
 * meets `env` or `mv` as it exits cannot kill it, the waiting shell reads a normal exit and goes on to the exec, and the
 * `cat` after it lives (the floor's row `exited:false`, its pid holding the typed-out file as `/bin/cat`; reproduced
 * under a PTY in 14 of 456 trials). The cell join says nothing about where the shell is, so the ⌃C waits for the exec:
 * the floor's own pid for the pane, read by `ps`, names `cat`, and then there is no shell left to swallow it. */
async function catReady(box: Box, paneId: string): Promise<void> {
  await poll(
    async (seen) => {
      const { sessions } = await box.daemon.terminals.runtimeSessions();
      const pid = sessions.find((session) => session.id === paneId)?.pid;
      const image = typeof pid === "number" ? imageOf(pid) : undefined;
      seen({ pid: pid ?? null, image: image ?? null });
      return image !== undefined && /(^|\/)cat$/.test(image) ? image : undefined;
    },
    CAT_READY_MS,
    "the scripted pane's process to be `cat`, its prologue done",
  );
}

/** The executable a pid runs now (`ps -o comm=`), or undefined once it is gone. */
function imageOf(pid: number): string | undefined {
  try {
    return execFileSync("ps", ["-o", "comm=", "-p", String(pid)], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

const mode = (path: string) => statSync(path).mode & 0o777;
const readRecord = (dataDir: string, runtimeRunId: string) =>
  AgentSessionRecord.parse(
    JSON.parse(
      readFileSync(
        join(dataDir, ...LAYOUT.AGENT_SESSIONS_DIR, `${encodeURIComponent(runtimeRunId)}.json`),
        "utf8",
      ),
    ),
  );

/** every JSONL ledger under the user root (the `.integrity.json` checkpoints
 * beside them are not records) */
function auditLedgers(dataDir: string): string[] {
  const dir = join(dataDir, ...LAYOUT.AUDIT_DIR);
  const walk = (d: string): string[] =>
    existsSync(d)
      ? readdirSync(d, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)],
        )
      : [];
  return walk(dir).filter((f) => f.endsWith(".jsonl"));
}

/** every audit line under the user root, concatenated (the ledgers are JSONL) */
const auditText = (dataDir: string): string =>
  auditLedgers(dataDir)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

/** One appended record: `AuditRecordBase` (packages/audit/src/model.ts) as it
 * lands on the line. */
interface AuditEntry {
  action: string;
  phase: "attempt" | "outcome";
  outcome?: string;
  reasonCode?: string;
  operationId?: string;
  actor: { kind: string; id?: string };
  target: { kind: string; id: string };
  attrs?: Record<string, unknown>;
}

const auditEntries = (dataDir: string): AuditEntry[] =>
  auditLedgers(dataDir).flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as AuditEntry),
  );

/** ONE act, read as the pair it is written as: the `attempt` that matches
 * (carrying the mutation's own attrs — `how`, the provider, the PTY) and the
 * `outcome` sharing its operationId (carrying the result's). Disjoint greps
 * over the concatenated ledger cannot say that the words came from the same
 * act, or the same ACTOR; this can, and it says what it saw when it cannot.
 *
 * WAITED FOR, up to `ms` (the debts lane, 2026-10-12): the outcome is appended
 * after the act's effect resolves (AuditService.requiredAs — attempt, effect,
 * outcome), and a daemon's own act (the boot's re-attach) shows its effect —
 * the row, the record — before its fsync'd outcome lands. Four gates read the
 * ledger in that gap ("never got an outcome record"); an outcome that is late
 * is not one that is missing, and one that never comes still fails here. */
async function auditAct(
  dataDir: string,
  where: (entry: AuditEntry) => boolean,
  ms = 10_000,
): Promise<{ attempt: AuditEntry; outcome: AuditEntry }> {
  const deadline = Date.now() + ms;
  for (;;) {
    const entries = auditEntries(dataDir);
    const attempt = entries.find((entry) => entry.phase === "attempt" && where(entry));
    const outcome =
      attempt === undefined
        ? undefined
        : entries.find(
            (entry) => entry.phase === "outcome" && entry.operationId === attempt.operationId,
          );
    if (attempt !== undefined && outcome !== undefined) return { attempt, outcome };
    if (Date.now() > deadline) {
      if (attempt === undefined) {
        const seen = entries.map((entry) => ({
          action: entry.action,
          phase: entry.phase,
          outcome: entry.outcome,
          actor: entry.actor.kind,
          target: entry.target.id,
          attrs: entry.attrs,
        }));
        throw new Error(`no audit attempt matched; the ledger holds ${JSON.stringify(seen)}`);
      }
      throw new Error(
        `the audit attempt ${attempt.operationId} never got an outcome record within ${ms} ms`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** EL7 as a SET, not as a list of suspicions.
 *
 * A row that only names forbidden keys cannot tell an allow-list from a
 * deny-list: it passes equally against a host that leaks the daemon's whole
 * environment except the four names the test thought to check. The witness is
 * the DIFFERENCE — every key the PTY was born with, minus the ones some
 * policy actually grants, must be empty.
 *
 * Four sources, each read from the code that owns it, and copied here on
 * purpose: importing the constant would only assert that the policy equals
 * itself, while a copy makes a widened allow-list a diff someone reviews.
 *   · `AGENT_ENV_PASSTHROUGH` — packages/fieldd/src/agent-host.ts
 *   · `buildAgentEnvironment` — puppeteer packages/runtime/src/host/environment.ts
 *   · the scripted adapter's own `spec.env`, and what /bin/sh adds for the
 *     `env` it runs (PWD, SHLVL, _ — and OLDPWD if anything ever cd's)
 *   · ghosttea's own spawn, since 0.13.0 — `SpawnOptions::hint_color_scheme`
 *     (native/ghosttea/src/session.rs): COLORFGBG
 * The win32 halves of the first two are left out: this suite spawns /bin/sh. */
const AGENT_ENV_ALLOWED = new Set([
  // fieldd's passthrough (agent-host.ts AGENT_ENV_PASSTHROUGH)
  "PATH",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "TERMINFO",
  "TERMINFO_DIRS",
  "SSH_AUTH_SOCK",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
  // puppeteer's own policy (buildAgentEnvironment, POSIX branch)
  "TERM",
  "COLORTERM",
  "FORCE_COLOR",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "CLAUDE_CODE_NO_FLICKER",
  "USER",
  "LOGNAME",
  "HOME",
  // the scripted adapter's own variables
  "SCRIPTED_ENV_OUT",
  "SCRIPTED_TYPED_OUT",
  "SCRIPTED_TOKEN",
  // /bin/sh's, for the child it runs
  "PWD",
  "SHLVL",
  "_",
  "OLDPWD",
  // ghosttea's own spawn (0.13.0 dfe0add, "report the color scheme to programs that ask"): the rxvt
  // `fg;bg` palette-index hint ("0;15" light, "15;0" dark) from the presentation's background, written
  // into every session's environment, a Clean one included, unless the caller set it. A terminal
  // capability hint of TERM/COLORTERM/TERM_PROGRAM's class: no secret and no FIELD_* name. ACCEPTED
  // under EL7 (VF-PM, 2026-10-23, the EL8 to ghosttea 0.13.1). Whether an agent's theme hint should be
  // VibeField's OWN value, so the agent env keeps one policy authority, is the agent plane owner's
  // open question.
  "COLORFGBG",
]);

/** how many `/api/sessions` requests the fake rosettad has answered so far */
const sessionRequests = (box: Box): number =>
  existsSync(box.requestLog)
    ? readFileSync(box.requestLog, "utf8")
        .split("\n")
        .filter((line) => line !== "").length
    : 0;

/** AR-S4d — a keychain in a map, `service/account` → value: no test here writes the machine's. */
function keychainIn(entries: Map<string, string>): SecretStore {
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

const parseEnvFile = (path: string): Record<string, string> =>
  Object.fromEntries(
    readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );

describe("agent.* without a floor (the mock mgmt server)", () => {
  it("agent.providers lists what one can spawn as — the scripted claude available, the scripted provider composed, personas by provider — and the fold starts empty", async () => {
    const { daemon } = await setup({ floor: "mock" });
    const win = await window(daemon, DECK, "p1");
    const { providers } = (await win.call("agent.providers", {})) as AgentProvidersResult;
    const claude = providers.find((p) => p.id === "claude");
    expect(claude).toBeDefined();
    expect(claude?.available).toBe(true);
    expect(claude?.resumable).toBe(true);
    expect(claude?.personas.map((p) => p.profileId)).toEqual(["claude:native-default"]);
    const scripted = providers.find((p) => p.id === "scripted");
    expect(scripted).toMatchObject({ label: "Scripted", available: false, personas: [] });
    // nothing here names a path or a home
    expect(JSON.stringify(providers)).not.toContain("/");
    // QL — nothing has been launched on this device yet
    expect(providers.filter((p) => p.lastLaunchedAt !== undefined)).toEqual([]);
    const listed = (await win.call("agent.list", {})) as AgentListResult;
    expect(listed.sessions).toEqual([]);
    const sub = (await win.call("agent.subscribe", {})) as {
      subId: string;
      snapshot: AgentListResult;
    };
    expect(sub.snapshot.sessions).toEqual([]);
  });

  it("MF-1 — one door, two projections: `full` is unchanged, `field` is the phone's board, a bad option is refused", async () => {
    const { daemon } = await setup({ floor: "mock" });
    const win = await window(daemon, DECK, "mf1");

    // absent params: byte for byte what the desktop has always received
    const full = (await win.call("agent.subscribe", {})) as {
      subId: string;
      snapshot: AgentListResult;
    };
    expect(full.snapshot).toEqual({ sessions: [] });
    // and asking for it by name is the same answer
    const named = (await win.call("agent.subscribe", { projection: "full" })) as {
      snapshot: AgentListResult;
    };
    expect(named.snapshot).toEqual({ sessions: [] });

    // the field projection answers a REVISIONED board, never a sessions array
    const field = (await win.call("agent.subscribe", {
      projection: "field",
      minIntervalMs: 250,
    })) as { subId: string; snapshot: { epoch?: string; revision: number; rows: unknown[] } };
    // DS-3 — on its own chain, named by this boot and the chain's ordinal
    expect(field.snapshot).toEqual({ epoch: expect.any(String), revision: 0, rows: [] });
    expect(field.snapshot.epoch?.startsWith(`${daemon.bootId}.`)).toBe(true);
    expect(field.subId).not.toBe(full.subId);
    // and a second subscription is a second chain, never comparable with the first
    const again = (await win.call("agent.subscribe", { projection: "field" })) as {
      snapshot: { epoch?: string };
    };
    expect(again.snapshot.epoch).not.toBe(field.snapshot.epoch);

    // DS-3 — the desk board: the field row plus what a person reads a run by,
    // at its own floor, and a heartbeat asked of it is honoured
    const desk = (await win.call("agent.subscribe", {
      projection: "desk",
      heartbeatMs: 1_000,
    })) as { snapshot: { epoch?: string; revision: number; rows: unknown[] } };
    expect(desk.snapshot).toMatchObject({ revision: 0, rows: [] });
    // a cadence or a heartbeat asked of the full fold is refused, as ever
    for (const params of [{ heartbeatMs: 1_000 }, { projection: "full", heartbeatMs: 1_000 }]) {
      const refused = (await win.callErr("agent.subscribe", params)) as RpcErrorShape;
      expect(refused.data?.kind, JSON.stringify(params)).toBe("PRECONDITION_FAILED");
    }

    // a tolerant reader still refuses an option it cannot honour, rather than
    // silently serving a cadence nobody asked for
    expect((await win.callErr("agent.subscribe", { projection: "mirror" })).data?.kind).toBe(
      "PRECONDITION_FAILED",
    );
    expect((await win.callErr("agent.subscribe", { minIntervalMs: 5 })).data?.kind).toBe(
      "PRECONDITION_FAILED",
    );
    // MF-1h — and a cadence asked for where it cannot apply is REFUSED, not
    // ignored: a caller that silently got the desktop's own 16 ms tick would
    // have no way to learn it had asked the wrong question
    for (const params of [{ minIntervalMs: 250 }, { projection: "full", minIntervalMs: 250 }]) {
      const refused = (await win.callErr("agent.subscribe", params)) as RpcErrorShape;
      expect(refused.data?.kind, JSON.stringify(params)).toBe("PRECONDITION_FAILED");
      expect(refused.message).toContain("field projection");
    }
    // an unknown OPTION is not an error — it is the next version's field
    expect(
      (
        (await win.call("agent.subscribe", { projection: "field", futureOption: 1 })) as {
          snapshot: { revision: number };
        }
      ).snapshot.revision,
    ).toBe(0);
  });

  // The landing review's nit (2026-10-01) — design-06 §8 names BOTH cadences
  // floors (250 / 100 ms). The field's was only a default: a 16 ms ask was
  // honoured, and on the mesh every distinct ask stood up a hub (a set of
  // upstreams) of its own. Asked faster than its floor, a board is served at
  // the floor; asked slower, it is honoured.
  it("the field projection's cadence is a FLOOR, like the desk's: faster asks share the floor's hub", async () => {
    const { daemon } = await setup({ floor: "mock" });
    const win = await window(daemon, DECK, "floor");
    const ask = (minIntervalMs: number) =>
      win.call("agent.subscribe", { projection: "field", scope: "mesh", minIntervalMs });
    await ask(AGENT_FIELD.MIN_INTERVAL_MS);
    await ask(16);
    await ask(100);
    expect(daemon.meshBoard.size).toBe(1); // all three at the 250 ms floor
    await ask(AGENT_FIELD.MIN_INTERVAL_MS * 2);
    expect(daemon.meshBoard.size).toBe(2); // slower is the caller's to ask
    // the desk's floor, as it was
    await win.call("agent.subscribe", { projection: "desk", scope: "mesh", minIntervalMs: 16 });
    await win.call("agent.subscribe", {
      projection: "desk",
      scope: "mesh",
      minIntervalMs: AGENT_FIELD.DESK_MIN_INTERVAL_MS,
    });
    expect(daemon.meshBoard.size).toBe(3);
  });

  it("the scopes: births need agent.spawn, the fold needs agent.observe", async () => {
    const { daemon } = await setup({ floor: "mock" });
    const observer = await window(daemon, ["agent.observe"], "s1");
    expect((await observer.callErr("agent.spawn", { provider: "scripted" })).data?.kind).toBe(
      "FORBIDDEN_SCOPE",
    );
    expect((await observer.callErr("agent.providers", {})).data?.kind).toBe("FORBIDDEN_SCOPE");
    const spawner = await window(daemon, ["agent.spawn"], "s2");
    expect((await spawner.callErr("agent.list", {})).data?.kind).toBe("FORBIDDEN_SCOPE");
    expect((await spawner.callErr("agent.subscribe", {})).data?.kind).toBe("FORBIDDEN_SCOPE");
  });

  it("MV-6 (L10, MV-D13) — agent.history is gone: the door answers method-not-found, and the user root holds no status ledger", async () => {
    // Godview is runtime only (James, 2026-10-03): fieldd keeps no record of
    // what a run did, and only rosetta ingests transcripts. The method is not
    // registered at all — a window that asks is told so, never handed an
    // empty record that reads as "nothing happened".
    const { daemon, dataDir } = await setup({ floor: "mock" });
    const win = await window(daemon, DECK, "h0");
    const refused = await win.callErr("agent.history", {});
    expect(refused.data?.kind).toBe("NOT_FOUND");
    expect(refused.message).toBe("method not found");
    expect(existsSync(join(dataDir, "agents", "history"))).toBe(false);
  });

  it("a spawn with no floor refuses UNAVAILABLE in the floor's own words, records nothing, and the audit says failed", async () => {
    const { daemon, dataDir } = await setup({ floor: "mock" });
    const win = await window(daemon, DECK, "n1");
    const err = (await win.callErr("agent.spawn", { provider: "scripted" })) as RpcErrorShape;
    expect(err.data?.kind).toBe("UNAVAILABLE");
    expect(JSON.stringify(err)).toContain("terminal");
    expect(existsSync(join(dataDir, ...LAYOUT.AGENT_SESSIONS_DIR))).toBe(false);
    // the ledger, as records: the door's own act, the provider it was for,
    // and the floor's refusal kind as the outcome's reason
    const refusal = await auditAct(dataDir, (entry) => entry.action === "agent.session.spawn");
    expect(refusal.attempt.attrs?.["provider"]).toBe("scripted");
    expect(refusal.attempt.actor.kind).toBe("local-token");
    expect(refusal.outcome.outcome).toBe("failed");
    expect(refusal.outcome.reasonCode).toBe("UNAVAILABLE");
    // an unknown provider is NOT_FOUND, not a spawn attempt
    expect((await win.callErr("agent.spawn", { provider: "nope" })).data?.kind).toBe("NOT_FOUND");
    // a resume of a record that does not exist is NOT_FOUND
    expect((await win.callErr("agent.resume", { runtimeRunId: "run-none" })).data?.kind).toBe(
      "NOT_FOUND",
    );
  });

  it("QL-D10 — a resume by native id refuses before anything starts: a row that does not offer resume, an agent with no row, a persona named twice, an Agent Profile that does not exist", async () => {
    const { daemon, dataDir } = await setup({
      floor: "mock",
      catalog: catalogWith("scripted", { offers: { ...SCRIPTED_ROW.offers, resume: false } }),
    });
    const win = await window(daemon, DECK, "qn1");
    const denied = (await win.callErr("agent.resume", {
      provider: "scripted",
      nativeSessionId: "conv-1",
    })) as RpcErrorShape;
    expect(denied.data?.kind).toBe("PRECONDITION_FAILED");
    expect(denied.data?.details).toMatchObject({
      provider: "scripted",
      reason: "unsupported-agent",
      capability: "resume",
    });
    // the attempt is ledgered as the native form names it: a conversation, no run yet
    const act = await auditAct(
      dataDir,
      (entry) =>
        entry.action === "agent.session.resume" && entry.attrs?.["nativeSessionId"] === "conv-1",
    );
    expect(act.attempt.target.id).toBe("pending");
    expect(act.attempt.attrs?.["provider"]).toBe("scripted");
    expect(act.outcome.outcome).toBe("failed");
    const stranger = (await win.callErr("agent.resume", {
      provider: "no-such-agent",
      nativeSessionId: "conv-1",
    })) as RpcErrorShape;
    expect(stranger.data?.kind).toBe("PRECONDITION_FAILED");
    expect(stranger.data?.details).toMatchObject({ reason: "unsupported-agent", status: "no-row" });
    // a persona is named once — by its id, or by its Agent Profile
    const twice = (await win.callErr("agent.resume", {
      provider: "scripted",
      nativeSessionId: "conv-1",
      profileId: "scripted:a",
      profileSet: "work",
    })) as RpcErrorShape;
    expect(twice.data?.kind).toBe("PRECONDITION_FAILED");
    // nothing was recorded for any of them
    expect(existsSync(join(dataDir, ...LAYOUT.AGENT_SESSIONS_DIR))).toBe(false);
  });

  it("QL-D10 — an Agent Profile a native resume names must exist", async () => {
    const { daemon, dataDir } = await setup({ floor: "mock" });
    const win = await window(daemon, DECK, "qn2");
    const missing = (await win.callErr("agent.resume", {
      provider: "scripted",
      nativeSessionId: "conv-1",
      profileSet: "nowhere",
    })) as RpcErrorShape;
    expect(missing.data?.kind).toBe("NOT_FOUND");
    expect(missing.data?.details).toMatchObject({ set: "nowhere" });
    expect(existsSync(join(dataDir, ...LAYOUT.AGENT_SESSIONS_DIR))).toBe(false);
  });

  it("QL-D10 hardening — a native resume takes only an id that cannot be a flag, a folder that exists, and a conversation the index files under that agent", async () => {
    const box = await setup({ floor: "mock", catalog: FILED_CATALOG });
    const { daemon, dataDir, envOut } = box;
    const win = await window(daemon, DECK, "qn5");
    await indexReady(win);
    const refusal = async (params: Record<string, unknown>) =>
      (await win.callErr("agent.resume", { provider: "scripted", ...params })) as RpcErrorShape;

    // an id an adapter's CLI would read as a flag, or that carries anything
    // but an id's characters, names nothing
    for (const nativeSessionId of [
      "--dangerously-bypass-approvals-and-sandbox",
      "-c",
      "conv 1",
      "conv;rm -rf ~",
      "conv/../x",
      "a".repeat(257),
    ]) {
      const refused = await refusal({ nativeSessionId, cwd: envOut });
      expect(refused.data?.kind, nativeSessionId).toBe("PRECONDITION_FAILED");
      // past the contract's 256 the params never parse; within it, fieldd says why
      if (nativeSessionId.length <= 256) {
        expect(refused.data?.details, nativeSessionId).toMatchObject({
          reason: "malformed-native-id",
        });
      }
    }

    // the folder must be an existing absolute one
    fileConversations(box, ["conv-1"]);
    for (const cwd of ["relative/dir", join(envOut, "not-there")]) {
      const refused = await refusal({ nativeSessionId: "conv-1", cwd });
      expect(refused.data?.kind, cwd).toBe("PRECONDITION_FAILED");
      expect(refused.data?.details).toMatchObject({ reason: "missing-cwd" });
    }

    // a conversation the index has never read…
    const unknown = await refusal({ nativeSessionId: "conv-unknown", cwd: envOut });
    expect(unknown.data?.kind).toBe("NOT_FOUND");
    expect(unknown.data?.details).toMatchObject({
      nativeSessionId: "conv-unknown",
      reason: "unknown-conversation",
    });
    // …or one it files under ANOTHER agent (the renderer's word is not provenance)
    fileConversations(box, ["conv-theirs"], "claude-code");
    const theirs = await refusal({ nativeSessionId: "conv-theirs", cwd: envOut });
    expect(theirs.data?.kind).toBe("NOT_FOUND");
    expect(theirs.data?.details).toMatchObject({ reason: "other-agent" });

    // nothing was recorded for any of them
    expect(existsSync(join(dataDir, ...LAYOUT.AGENT_SESSIONS_DIR))).toBe(false);
  });

  it("QL-D10 — two native resumes of one conversation racing through the checks: the second is refused while the first holds it, and the claim is given back after", async () => {
    const box = await setup({ floor: "mock", catalog: FILED_CATALOG });
    const { daemon, envOut } = box;
    const win = await window(daemon, DECK, "qn6");
    await indexReady(win);
    fileConversations(box, ["conv-race"]);
    const resume = () =>
      win.callErr("agent.resume", {
        provider: "scripted",
        nativeSessionId: "conv-race",
        cwd: envOut,
      }) as Promise<RpcErrorShape>;
    // both sent before either answers: the first awaits the index (and then a
    // birth the mock floor never makes) with the conversation claimed
    const [first, second] = await Promise.all([resume(), resume()]);
    expect(second.data?.kind).toBe("PRECONDITION_FAILED");
    expect(second.data?.details).toMatchObject({
      provider: "scripted",
      nativeSessionId: "conv-race",
      state: "resuming",
    });
    // the first went on past every check (no floor to start it on here)
    expect(first.data?.details).not.toMatchObject({ state: "resuming" });
    // …and gave the claim back when it failed: the next resume is not refused for it
    const after = await resume();
    expect(after.data?.details).not.toMatchObject({ state: "resuming" });
  });
});

describe("managed sessions over the REAL floor (field-native)", () => {
  it("CP-1d and MT-0 — hatch and run-id resume carry a spark's fresh briefing, and an ordinary run the door with its read-only agent rows", async () => {
    const briefing: AgentBriefingCapabilities = {
      mcpServers: true,
      allowTools: true,
      instructions: true,
      mcpServerProcess: "terminal",
    };
    const box = await setup({ floor: "real", profiles: true, briefing, exerciseDoor: true });
    const { daemon, dataDir, sessions } = box;
    const win = await window(daemon, [...DECK, "agents.manage"], "cp1d");
    await win.call("agents.profiles.verify", { profileId: "scripted:native-default" });
    const providers = (await win.call("agent.providers", {})) as AgentProvidersResult;
    expect(providers.providers.find((p) => p.id === "scripted")?.briefing).toEqual(briefing);
    const { spark } = (await win.call("compose.sparks.hatch", {
      name: "Vela",
      face: { seed: 7 },
      agent: "scripted",
      profiles: ["native"],
      thinksUnder: "native",
    })) as ComposeSparksHatchResult;
    const runId = spark.session!.runtimeRunId;
    const first = sessions[0]!;
    expect(first.briefing.allowTools).toEqual(["vibefield/*"]);
    expect(first.briefing.instructions).toContain("You are Vela");
    expect(first.briefing.mcpServers?.vibefield?.command).toBe(BIN);
    expect(first.briefing.mcpServers?.vibefield?.args).toContain("door");
    expect(first.briefing.mcpServers?.vibefield).not.toHaveProperty("env");
    expect(existsSync(join(spark.folder, ".mcp.json"))).toBe(false);
    expect(readRecord(dataDir, runId).spark).toBe(spark.id);
    const doorProof = await poll(async () => {
      const path = join(box.envOut, "session-1.tools.json");
      return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
    }, 25_000);
    expect(doorProof.error).toBeUndefined();
    expect(doorProof.listed.tools.map((tool: { name: string }) => tool.name)).toContain(
      "agents_list",
    );
    expect(doorProof.called.isError).not.toBe(true);

    await win.call("terminal.terminate", { sessionId: first.runtimeSessionId });
    await poll(async () => (readRecord(dataDir, runId).exited ? true : undefined), 15_000);
    const revised = "CP1d edited brief, supplied anew on resume.";
    writeFileSync(join(spark.folder, "CLAUDE.md"), revised);
    const resumed = (await born(win, "agent.resume", { runtimeRunId: runId })) as AgentSpawnResult;
    expect(sessions[1]?.briefing.instructions).toBe(revised);
    expect(sessions[1]?.briefing.allowTools).toEqual(["vibefield/*"]);
    expect(sessions[1]?.resume).toBe(first.sessionId);
    const resumedProof = await poll(async () => {
      const path = join(box.envOut, "session-2.tools.json");
      return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
    }, 25_000);
    expect(resumedProof.error).toBeUndefined();
    expect(resumedProof.listed.tools.map((tool: { name: string }) => tool.name)).toContain(
      "agents_list",
    );
    const record = readRecord(dataDir, resumed.session.runtimeRunId);
    expect(record.spark).toBe(spark.id);
    expect(record.origin).toEqual({ by: "you" });
    expect(JSON.stringify(record)).not.toContain(revised);
    expect(JSON.stringify(record)).not.toContain("mcpServers");
    await win.call("terminal.terminate", { sessionId: resumed.terminal.sessionId });

    const ordinary = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: box.envOut,
    })) as AgentSpawnResult;
    // MT-0 (MT-D7, MT-D9): a plain run carries the door and its read-only `agent` rows by name, and no instructions.
    expect(sessions[2]?.briefing.allowTools).toEqual([
      "vibefield/history_search",
      "vibefield/history_read",
      "vibefield/projects_list",
    ]);
    expect(sessions[2]?.briefing.instructions).toBeUndefined();
    expect(sessions[2]?.briefing.mcpServers?.vibefield?.command).toBe(BIN);
    const plainProof = await poll(async () => {
      const path = join(box.envOut, "session-3.tools.json");
      return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined;
    }, 25_000);
    expect(plainProof.error).toBeUndefined();
    expect(plainProof.listed.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "history_search",
      "history_read",
      "projects_list",
    ]);
    // MT-L2: a call is held to its row again, so a spark's row answers a plain run as the fact `forbidden`.
    expect(plainProof.called.isError).toBe(true);
    expect(plainProof.called.structuredContent?.fact).toBe("forbidden");
    await win.call("terminal.terminate", { sessionId: ordinary.terminal.sessionId });
  }, 90_000);

  it("spawn: a PTY on the agent cell with a CLEAN environment; the fold's row, the record (0600), the ticket, the audit; automation through the host; exit withdraws the row and stamps the record; resume continues from the record; a live run refuses to be resumed", async () => {
    const { daemon, dataDir, envOut, sessions } = await setup({ floor: "real" });
    const win = await window(daemon, DECK, "r1");

    // ── the birth ──
    const spawned = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: envOut,
      title: "scripted one",
    })) as AgentSpawnResult;
    expect(spawned.session.tier).toBe("managed");
    expect(spawned.session.kind).toBe("scripted");
    expect(spawned.session.label).toBe("Scripted");
    expect(spawned.session.device).toBe(daemon.devices.currentDeviceId());
    expect(spawned.session.title).toBe("scripted one");
    expect(spawned.session.terminal).toMatchObject({
      hosted: "local",
      runtimeSessionId: spawned.terminal.sessionId,
    });
    expect(spawned.session.continuation).toEqual({ persisted: true, resumable: false });
    expect(spawned.session.observationLevel).toBe("terminal-only");
    // the same routed ticket terminal.create answers: the pane mounts it
    expect(spawned.terminal.endpoints.controlUrl).toMatch(/^ws:/);
    expect(spawned.terminal).toHaveProperty("attachGrant");
    expect(spawned.terminal.session.id).toBe(spawned.terminal.sessionId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.runtimeSessionId).toBe(spawned.terminal.sessionId);
    expect(sessions[0]?.resume).toBeUndefined();
    // FS-1a (L2) — the run's folder became a place of the files service, its
    // lastActiveAt the moment the run entered the fold, on disk for the next boot
    const place = daemon.workspace.registry
      .roots()
      .find((root) => root.kind === "place" && root.path === envOut);
    expect(place).toMatchObject({ kind: "place", missing: false, name: "env-out" });
    expect(Date.parse(place?.lastActiveAt ?? "")).toBeGreaterThan(Date.now() - 60_000);
    expect(
      readFileSync(join(dataDir, ...LAYOUT.WORKSPACE_ROOTS_FILE), "utf8").includes(envOut),
    ).toBe(true);
    // …and a boot that lost its registry seeds the place back from the
    // VERIFIED session records (`recordedPlaces`)
    const reseeded = new RootsRegistry({
      file: join(dataDir, "reseeded-roots.json"),
      deviceId: () => "dev_test",
    });
    expect(reseeded.seedPlaces(daemon.agents.recordedPlaces())).toBe(1);
    expect(reseeded.roots().find((root) => root.kind === "place")?.path).toBe(envOut);

    // ── EL7: the environment the agent was born with ──
    const envFile = join(envOut, "session-1.env");
    const env = await poll(
      async () => (existsSync(envFile) ? parseEnvFile(envFile) : undefined),
      10_000,
    );
    expect(env["SCRIPTED_TOKEN"]).toBe("token-1");
    expect(env["TERM"]).toBe("xterm-256color");
    expect(env["HOME"]).toBeTruthy();
    expect(env["PATH"]).toBeTruthy();
    expect(env["USER"]).toBeTruthy();
    // the daemon's own variables never enter — not the ones it was spawned
    // with, not the one the adapter asked for
    expect(env).not.toHaveProperty("FIELDD_SMUGGLED");
    expect(env).not.toHaveProperty("FIELD_NATIVE_DATA_DIR");
    expect(env).not.toHaveProperty("FIELDD_ROSETTAD_BIN");
    expect(env).not.toHaveProperty("PUPPETEER_CLAUDE_BIN");
    // a variable of the TEST RUNNER's, carrying no prefix anyone strips: it is
    // in this process's environment and it is not in the agent's
    expect(env).not.toHaveProperty("VITEST");
    expect(process.env).toHaveProperty("VITEST");
    expect(
      Object.keys(env).filter((k) => k.startsWith("FIELD_") || k.startsWith("FIELDD_")),
    ).toEqual([]);
    // …and the whole SET, which is the claim the named absences only gesture
    // at: nothing is here that no policy granted (see AGENT_ENV_ALLOWED)
    const ungranted = Object.keys(env).filter((key) => !AGENT_ENV_ALLOWED.has(key));
    expect(
      ungranted,
      `the agent's PTY was born holding keys no policy grants: ${ungranted.join(", ")}`,
    ).toEqual([]);

    // ── the record ──
    const runId = spawned.session.runtimeRunId;
    const record = readRecord(dataDir, runId);
    expect(record.provider).toBe("scripted");
    expect(record.cwd).toBe(envOut);
    expect(record.terminalSessionId).toBe(spawned.terminal.sessionId);
    expect(record.continuation).toMatchObject({
      providerId: "scripted",
      nativeSessionId: spawned.session.sessionId,
    });
    expect(record.exited).toBeUndefined();
    // AR-4 — the ingress the adapter reported BEFORE its process launched is
    // the one the record keeps, pair for pair: the host's half of the stable
    // ingress contract (a re-attach hands exactly this back)
    expect(sessions[0]?.ingress).toEqual({ port: 40_001, token: "bearer-1" });
    expect(record.ingress).toEqual(sessions[0]?.ingress);
    const recordPath = join(dataDir, ...LAYOUT.AGENT_SESSIONS_DIR, `${runId}.json`);
    expect(mode(recordPath)).toBe(0o600);
    expect(mode(join(dataDir, ...LAYOUT.AGENT_SESSIONS_DIR))).toBe(0o700);

    // ── the fold: the row, joined to its cell once the inventory carries it ──
    const row = await poll(async () => {
      const { sessions: rows } = (await win.call("agent.list", {})) as AgentListResult;
      const found = rows.find((r) => r.runtimeRunId === runId);
      return found?.terminal?.cellBootId !== undefined ? found : undefined;
    }, 10_000);
    expect(row.terminal?.workloadClass).toBe("agent");
    expect(["idle", "working", "blocked", "unknown"]).toContain(row.status);
    const observed = (await win.call("terminal.list", {})) as { terminals: TerminalInfo[] };
    expect(
      observed.terminals.find((t) => t.sessionId === spawned.terminal.sessionId)?.cell,
    ).toMatchObject({ workloadClass: "agent" });

    // ── agent.subscribe: a snapshot now, frames later ──
    const sub = (await win.call("agent.subscribe", {})) as {
      subId: string;
      snapshot: AgentListResult;
    };
    expect(sub.snapshot.sessions.map((r) => r.runtimeRunId)).toEqual([runId]);

    // ── automation through the host: the floor's epoch path accepts it ──
    const agent = daemon.agents.runtime.agent(spawned.terminal.sessionId);
    expect(agent).toBeDefined();
    const receipt = await agent!.submitPrompt({ text: "hello-floor" });
    expect(receipt.status).toBe("confirmed");
    // accepted is the floor's answer, not the agent's: the bytes reach the
    // PROCESS, which is the claim. The scripted PTY's `cat` writes its own
    // stdout to a file, so the typed line can be read back without a data leg
    // (EL2 — bytes never ride this control path).
    const typed = await poll(async () => {
      const path = sessions[0]?.typedOut;
      if (path === undefined || !existsSync(path)) return undefined;
      const text = readFileSync(path, "utf8");
      return text.includes("hello-floor") ? text : undefined;
    }, 10_000);
    expect(typed).toContain("hello-floor");

    // ── the audit ──
    const spawnAct = await auditAct(dataDir, (entry) => entry.action === "agent.session.spawn");
    expect(spawnAct.attempt.target.kind).toBe("agent-session");
    expect(spawnAct.attempt.attrs?.["provider"]).toBe("scripted");
    expect(spawnAct.outcome.outcome).toBe("succeeded");
    expect(spawnAct.outcome.attrs?.["runtimeRunId"]).toBe(runId);
    expect(spawnAct.outcome.attrs?.["sessionId"]).toBe(spawned.terminal.sessionId);

    // ── the exit: the floor's ladder; the row leaves, the record is stamped ──
    const term = (await win.call("terminal.terminate", {
      sessionId: spawned.terminal.sessionId,
    })) as { terminated: boolean };
    expect(term.terminated).toBe(true);
    await poll(async () => {
      const { sessions: rows } = (await win.call("agent.list", {})) as AgentListResult;
      return rows.some((r) => r.runtimeRunId === runId) ? undefined : true;
    }, 15_000);
    const exited = await poll(async () => {
      const r = readRecord(dataDir, runId);
      return r.exited !== undefined ? r : undefined;
    }, 5_000);
    expect(exited.exited?.reason).toBeTruthy();
    // the subscriber saw the withdrawal as a full frame
    await poll(async () => {
      const frames = win.notifications.filter((n) => n.params.subId === sub.subId);
      const last = frames.at(-1)?.params.payload as AgentListResult | undefined;
      return last !== undefined && !last.sessions.some((r) => r.runtimeRunId === runId)
        ? true
        : undefined;
    }, 5_000);
    // puppeteer no longer holds the run
    expect(daemon.agents.runtime.agent(spawned.terminal.sessionId)).toBeUndefined();

    // ── resume: a new run in a new PTY, the vendor's conversation continued ──
    const resumed = (await born(win, "agent.resume", { runtimeRunId: runId })) as AgentSpawnResult;
    expect(resumed.session.runtimeRunId).not.toBe(runId);
    expect(resumed.session.sessionId).toBe(spawned.session.sessionId);
    expect(resumed.session.title).toBe("scripted one");
    expect(resumed.terminal.sessionId).not.toBe(spawned.terminal.sessionId);
    expect(sessions).toHaveLength(2);
    expect(sessions[1]?.resume).toBe(spawned.session.sessionId);
    const second = readRecord(dataDir, resumed.session.runtimeRunId);
    expect(second.continuation.nativeSessionId).toBe(spawned.session.sessionId);
    expect(second.exited).toBeUndefined();
    // a new run is a new identity: its own claim, its own ingress pair
    expect(second.creationRequestId).not.toBe(record.creationRequestId);
    expect(sessions[1]?.ingress).toEqual({ port: 40_002, token: "bearer-2" });
    expect(second.ingress).toEqual(sessions[1]?.ingress);
    const resumeAct = await auditAct(dataDir, (entry) => entry.action === "agent.session.resume");
    expect(resumeAct.attempt.target.id).toBe(runId);
    expect(resumeAct.attempt.actor.kind).toBe("local-token");
    expect(resumeAct.outcome.outcome).toBe("succeeded");
    expect(resumeAct.outcome.attrs?.["runtimeRunId"]).toBe(resumed.session.runtimeRunId);
    // this resume ended nothing — the record's PTY was already gone — and the
    // entry says so by omission: `how`/`replaced` ride only a REPLACEMENT
    expect(resumeAct.outcome.attrs).not.toHaveProperty("how");
    expect(resumeAct.outcome.attrs).not.toHaveProperty("replaced");
    // the old record stands, stamped; the new run is live — and a live run
    // refuses to be resumed (re-attach is AR-4's)
    expect(readRecord(dataDir, runId).exited).toBeDefined();
    const refused = await win.callErr("agent.resume", {
      runtimeRunId: resumed.session.runtimeRunId,
    });
    expect(refused.data?.kind).toBe("PRECONDITION_FAILED");
    expect(JSON.stringify(refused)).toContain("terminal-alive");

    await win.call("terminal.terminate", { sessionId: resumed.terminal.sessionId });
  }, 90_000);

  it("QL-D10 — a conversation resumed by its native id: refused while a run continues it; then a new run on puppeteer's continuation, recorded and audited, answered like a spawn; the exited record no longer resumes beside it", async () => {
    const box = await setup({ floor: "real", catalog: FILED_CATALOG, briefing: SPARK_BRIEFING });
    const { daemon, dataDir, envOut, sessions, records } = box;
    const win = await window(daemon, DECK, "qn3");
    const spawned = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: envOut,
      title: "first",
    })) as AgentSpawnResult;
    const conversation = spawned.session.sessionId;
    // the index has read it, under the scripted agent's runtime
    fileConversations(box, [conversation]);
    // QL — the launcher orders its agents by this device's newest record
    const launchedAt = async (): Promise<Array<[string, number | undefined]>> =>
      ((await win.call("agent.providers", {})) as AgentProvidersResult).providers
        .filter((p) => p.lastLaunchedAt !== undefined)
        .map((p) => [p.id, p.lastLaunchedAt]);
    expect(await launchedAt()).toEqual([
      ["scripted", Date.parse(readRecord(dataDir, spawned.session.runtimeRunId).createdAt)],
    ]);

    // a run continues the conversation: a second would be two runs on it
    const live = (await win.callErr("agent.resume", {
      provider: "scripted",
      nativeSessionId: conversation,
    })) as RpcErrorShape;
    expect(live.data?.kind).toBe("PRECONDITION_FAILED");
    expect(live.data?.details).toMatchObject({
      runtimeRunId: spawned.session.runtimeRunId,
      state: "terminal-alive",
    });
    expect(sessions).toHaveLength(1);

    await win.call("terminal.terminate", { sessionId: spawned.terminal.sessionId });
    await poll(
      async () =>
        readRecord(dataDir, spawned.session.runtimeRunId).exited !== undefined ? true : undefined,
      15_000,
    );

    const spark = keepLegacySpark(box, spawned.session.runtimeRunId);
    const resumed = (await born(win, "agent.resume", {
      provider: "scripted",
      nativeSessionId: conversation,
      cwd: envOut,
      title: "from the launcher",
    })) as AgentSpawnResult;
    expect(resumed.session.runtimeRunId).not.toBe(spawned.session.runtimeRunId);
    expect(resumed.session.sessionId).toBe(conversation);
    expect(resumed.session.title).toBe("from the launcher");
    expect(resumed.session.kind).toBe("scripted");
    // the adapter was asked to CONTINUE the conversation, in the folder named
    expect(sessions).toHaveLength(2);
    expect(sessions[1]?.resume).toBe(conversation);
    expect(sessions[1]?.briefing.instructions).toBe("The legacy spark's fresh briefing.");
    expect(readRecord(dataDir, resumed.session.runtimeRunId).spark).toBe(spark.id);
    expect(readRecord(dataDir, resumed.session.runtimeRunId).origin).toEqual({ by: "you" });
    // the same routed ticket a spawn answers: the pane mounts it the same way
    expect(resumed.terminal.endpoints.controlUrl).toMatch(/^ws:/);
    expect(resumed.terminal).toHaveProperty("attachGrant");
    expect(resumed.terminal.sessionId).not.toBe(spawned.terminal.sessionId);
    // recorded like any spawn: a later exit resumes from THIS record
    const record = readRecord(dataDir, resumed.session.runtimeRunId);
    expect(record.continuation).toMatchObject({
      providerId: "scripted",
      nativeSessionId: conversation,
    });
    expect(record.cwd).toBe(envOut);
    expect(record.exited).toBeUndefined();
    const act = await auditAct(
      dataDir,
      // the ledger redacts a temp root, so the one with a folder is the one sent with a folder
      (entry) => entry.action === "agent.session.resume" && entry.attrs?.["cwd"] !== undefined,
    );
    expect(act.attempt.target.id).toBe("pending");
    expect(act.attempt.attrs).toMatchObject({
      provider: "scripted",
      nativeSessionId: conversation,
    });
    expect(act.outcome.outcome).toBe("succeeded");
    expect(act.outcome.attrs?.["runtimeRunId"]).toBe(resumed.session.runtimeRunId);
    // a resume is a launch: the newest record is now the resumed run's —
    // by when it was CREATED, not when a record was last touched (the store
    // lists by update, and an old record is rewritten at every stamp)
    records.write({
      ...readRecord(dataDir, spawned.session.runtimeRunId),
      updatedAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(await launchedAt()).toEqual([["scripted", Date.parse(record.createdAt)]]);

    // the first run's record still stands exited — and its own resume would
    // make a second run on the conversation the launcher already continued
    const again = (await win.callErr("agent.resume", {
      runtimeRunId: spawned.session.runtimeRunId,
    })) as RpcErrorShape;
    expect(again.data?.kind).toBe("PRECONDITION_FAILED");
    expect(again.data?.details).toMatchObject({ runtimeRunId: resumed.session.runtimeRunId });
    expect(sessions).toHaveLength(2);

    await win.call("terminal.terminate", { sessionId: resumed.terminal.sessionId });
  }, 90_000);

  it("the persona login pane: the vendor's login in a PTY, then identity and usage re-read when it ends", async () => {
    let authenticated = false;
    let readings = 0;
    const { daemon, dataDir } = await setup({
      floor: "real",
      usage: {
        provider: { id: "claude", label: "Claude", refresh: { pollIntervalMs: 30 * 60_000 } },
        async fetch() {
          readings += 1;
          return authenticated
            ? {
                status: "available",
                snapshot: {
                  provider: "claude",
                  fetchedAt: new Date().toISOString(),
                  scope: "subscription",
                  source: { kind: "native-protocol", stability: "documented" },
                  metrics: [],
                },
              }
            : {
                status: "unauthenticated",
                provider: "claude",
                message: "Sign in required",
                retryable: false,
              };
        },
      },
    });
    const win = await window(daemon, [...DECK, "agent.usage"], "l1");
    const before = (await win.call("agents.profiles.list", {
      provider: "claude",
    })) as AgentsProfilesListResult;
    expect(before.personas[0]?.identity).toBeUndefined();

    await win.call("agents.usage.subscribe", {});
    await poll(async () => {
      const batch = (await win.call("agents.usage", {})) as AgentAccountUsageBatch;
      return batch.entries[0]?.state === "unauthenticated" ? true : undefined;
    }, 8_000);
    expect(readings).toBe(1);
    authenticated = true;

    const login = (await win.call("agents.profiles.login", {
      profileId: "claude:native-default",
    })) as AgentsProfilesLoginResult;
    expect(login.persona.profileId).toBe("claude:native-default");
    expect(login.terminal.endpoints.controlUrl).toMatch(/^ws:/);
    expect(login.terminal).toHaveProperty("attachGrant");

    // the scripted login returns at once → the pane ends → the identity is
    // read from the vendor's status surface and recorded on the persona. Item 68: measured flat at 314–901 ms
    // (loads 0–278: fieldd's `husk_reaped` +242–542 ms, then `login_finished`); at the deadline the error names
    // the persona last seen and fieldd's own login events, so a stalled step says which. Item 81 (CI 40530144594,
    // attempt 1): it said the pane's end never reached the login — the exit came in the read that answered the
    // birth and was dropped before the login was registered; fixed at the cause (`TerminalService.exitOf`), and the
    // order is made certain below ("item 81 — an exit that comes before its pane is registered")
    const verified = await poll(
      async (seen) => {
        const { personas } = (await win.call("agents.profiles.list", {
          provider: "claude",
        })) as AgentsProfilesListResult;
        const persona = personas.find((p) => p.profileId === "claude:native-default");
        seen(persona);
        return persona?.identity?.loggedIn === true ? persona : undefined;
      },
      15_000,
      "the persona's identity re-read after its login pane ends",
    );
    expect(verified.identity).toMatchObject({
      loggedIn: true,
      method: "claude.ai",
      email: "persona@example.test",
      organization: "Example Org",
      plan: "max",
    });
    await poll(async () => {
      const batch = (await win.call("agents.usage", {})) as AgentAccountUsageBatch;
      return batch.entries[0]?.state === "available" ? true : undefined;
    }, 8_000);
    expect(readings).toBe(2); // login completion bypasses the pre-login 30-minute delay
    expect(auditText(dataDir)).toContain('"action":"agents.profiles.login"');
    // AR-S2c: a route is one the agent declared — Claude Code declares none, so
    // puppeteer refuses one before any terminal opens; a malformed one never
    // reaches it
    const undeclared = await win.callErr("agents.profiles.login", {
      profileId: "claude:native-default",
      route: "portal",
    });
    expect(undeclared.data?.kind).toBe("PRECONDITION_FAILED");
    const malformed = await win.callErr("agents.profiles.login", {
      profileId: "claude:native-default",
      route: "Not a route",
    });
    expect(malformed.data?.kind).toBe("PRECONDITION_FAILED");
    // the login pane is not a managed session: the fold never carried it
    expect(((await win.call("agent.list", {})) as AgentListResult).sessions).toEqual([]);
  }, 60_000);

  it("a server's sign-in (AR-S4c): the agent's own login in a pane on the floor, the agent read again when it ends, its husk closed", async () => {
    const { daemon, dataDir } = await setup({ floor: "real", profiles: true, extensions: true });
    const win = await window(daemon, [...DECK, "agents.manage"], "e1");
    const lensOf = async () =>
      (await win.call("agents.extensions.list", { set: "native" })) as AgentsExtensionsListResult;
    const cell = (lens: AgentsExtensionsListResult) =>
      lens.servers.find((row) => row.name === "linear")?.cells["scripted"]?.[0];
    expect(cell(await lensOf())).toMatchObject({
      auth: "needs-sign-in",
      acts: [{ act: "sign-in", runs: "scripted mcp login linear", reaches: [], terminal: true }],
    });

    const started = (await win.call("agents.extensions.signIn", {
      set: "native",
      provider: "scripted",
      id: "linear",
    })) as AgentsExtensionsSignInResult;
    expect(started.run).toMatchObject({
      act: "sign-in",
      state: "running",
      terminal: { sessionId: started.terminal.sessionId },
    });
    expect(started.terminal.endpoints.controlUrl).toMatch(/^ws:/);
    expect(started.terminal).toHaveProperty("attachGrant");

    // the scripted sign-in leaves its mark and returns: the pane's end settles
    // it, and the read after says signed in, with no sign-in left to offer
    const after = await poll(async () => {
      const lens = await lensOf();
      return lens.run?.state === "finished" && cell(lens)?.auth === "signed-in" ? lens : undefined;
    }, 15_000);
    expect(after.run).toMatchObject({ receipt: { status: "changed", message: "signed in" } });
    expect(after.run?.terminal).toBeUndefined();
    expect(cell(after)?.acts).toBeUndefined();
    // the husk is closed, as a login pane's is
    await untilListed(win, started.terminal.sessionId, false);
    expect(auditText(dataDir)).toContain('"action":"agents.extensions.sign_in"');
  }, 60_000);
});

/** The fold's row for a run, once the inventory has joined it to its cell. */
async function joinedRow(
  win: WsRpc,
  runtimeRunId: string,
): Promise<AgentListResult["sessions"][number]> {
  return await poll(
    async (seen) => {
      const { sessions } = (await win.call("agent.list", {})) as AgentListResult;
      const row = sessions.find((r) => r.runtimeRunId === runtimeRunId);
      // item 72 — what the row stood at: absent, or listed without its cell's join (its terminal as the fold has it)
      seen(
        row === undefined
          ? { row: "not listed" }
          : { terminal: row.terminal ?? "no terminal join" },
      );
      return row?.terminal?.cellBootId !== undefined ? row : undefined;
    },
    15_000,
    "the run's row joined to its cell by the floor's inventory",
  );
}

const listed = async (win: WsRpc, sessionId: string): Promise<boolean> => {
  const { terminals } = (await win.call("terminal.list", {})) as { terminals: TerminalInfo[] };
  return terminals.some((t) => t.sessionId === sessionId);
};
/** the inventory trails a birth and an exit by a beat (TC): wait for the listing to say `expected` */
const untilListed = (win: WsRpc, sessionId: string, expected: boolean): Promise<true> =>
  poll(async () => ((await listed(win, sessionId)) === expected ? true : undefined), 10_000);

/** Watch the floor's listing for one session's DISAPPEARANCE, from the call
 * until `stop()`, and answer the instant it was first missing (undefined if it
 * never was). The reading is the product door, so the time is never earlier
 * than the truth — which is the direction that keeps "gone BEFORE the new run
 * was born" an honest claim rather than a generous one. Give it its own
 * window: it runs concurrently with the call it is watching. */
function watchForGone(win: WsRpc, sessionId: string): { stop: () => Promise<number | undefined> } {
  let goneAt: number | undefined;
  let watching = true;
  const loop = (async () => {
    while (watching && goneAt === undefined) {
      try {
        if (!(await listed(win, sessionId))) {
          goneAt = Date.now();
          return;
        }
      } catch {
        /* the floor can refuse mid-replacement; the next reading answers */
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  })();
  return {
    stop: async () => {
      watching = false;
      await loop;
      return goneAt;
    },
  };
}

/** rosetta's row for a native session whose conversation last moved
 * `stillForMs` ago — or, with `null`, one rosetta knows and has no timestamped
 * evidence for (`activity: null`: no evidence is NOT idle).
 *
 * `role` is rosetta's own vocabulary — `SessionRole` = main | subagent | team
 * (crates/core/src/rows.rs, clients/ts/generated/SessionRole.ts). An earlier
 * draft emitted "primary", which rosetta cannot produce; a fixture that speaks
 * words upstream does not have is not a witness of anything.
 *
 * `child` is what a delegated thread looks like BESIDE its root: its own id,
 * the root named as parent and as `root_session_id`, the "subagent" role — the
 * row whose clock fieldd must not read. The canonical row is the one whose
 * `root_session_id` is its own id (agent-index.ts `sessionByNativeId`). */
const rosettaRow = (nativeSessionId: string, stillForMs: number | null, child = false) => ({
  id: child ? `rs-${nativeSessionId}-child` : `rs-${nativeSessionId}`,
  native_session_id: nativeSessionId,
  runtime_id: "rt-scripted",
  project_id: null,
  cwd: null,
  parent_session_id: child ? `rs-${nativeSessionId}` : null,
  delegation: null,
  root_session_id: `rs-${nativeSessionId}`,
  role: child ? "subagent" : "main",
  title: null,
  summary: null,
  started_at: Date.now() - (stillForMs ?? 0) - 60_000,
  updated_at: Date.now(),
  activity:
    stillForMs === null
      ? null
      : { first_at: Date.now() - stillForMs - 60_000, last_at: Date.now() - stillForMs },
  stream_state: "indexed",
});

/** QL — the catalog with the scripted row naming a rosetta kind, so the
 * index can file a scripted conversation under the scripted agent (a native
 * resume takes only a conversation the index files under the agent asked). */
const FILED_CATALOG = catalogWith("scripted", {
  seams: { puppeteer: { provider: "scripted" }, rosetta: { kind: "scripted" } },
});

/** QL — the index answers only once its daemon is up; a native resume asks it. */
async function indexReady(win: { call(method: string, params: unknown): Promise<unknown> }) {
  await poll(async () => {
    const status = (await win.call("index.status", {})) as { rosettad?: { phase?: string } };
    return status.rosettad?.phase === "ready" ? true : undefined;
  }, 15_000);
}

/** QL — make the fake index know these conversations, each under the runtime
 * `runtimeId` whose kind is `kind` (the scripted agent's, by default). */
function fileConversations(
  box: Pick<Box, "sessionsFile" | "runtimesFile">,
  nativeIds: readonly string[],
  kind = "scripted",
): void {
  const runtimeId = `rt-${kind}`;
  writeFileSync(
    box.runtimesFile,
    JSON.stringify([{ id: runtimeId, kind, data_root: `~/.${kind}` }]),
  );
  writeFileSync(
    box.sessionsFile,
    JSON.stringify(nativeIds.map((id) => ({ ...rosettaRow(id, 60_000), runtime_id: runtimeId }))),
  );
}

describe("a server's values over the REAL floor (AR-S4d)", () => {
  it("an agent VibeField starts is given the values of the servers VibeField gave it, and no other; none reaches a record or the ledger", async () => {
    const entries = new Map<string, string>();
    const { daemon, dataDir, envOut } = await setup({
      floor: "real",
      secretStore: keychainIn(entries),
    });
    // This Mac keeps context7's key, and gave context7 to the scripted agent
    // alone; the entry also holds a value no agent here was given
    const secret = "ctx7_value_for_the_scripted_agent";
    mkdirSync(join(dataDir, ...LAYOUT.AGENT_EXTENSIONS_DIR), { recursive: true });
    writeFileSync(
      join(dataDir, ...LAYOUT.AGENT_EXTENSIONS_DIR, "native.json"),
      `${JSON.stringify({
        version: 1,
        servers: {
          context7: {
            definition: {
              transport: "stdio",
              command: "npx",
              args: ["-y", "@upstash/context7-mcp"],
              env: ["CONTEXT7_API_KEY"],
            },
            keptAt: "2026-09-27T09:00:00.000Z",
          },
        },
        values: ["CONTEXT7_API_KEY", "LINEAR_API_KEY"],
        given: { scripted: { context7: ["CONTEXT7_API_KEY"] } },
      })}\n`,
      { mode: 0o600 },
    );
    entries.set(
      "VibeField agent server values/native",
      JSON.stringify({ CONTEXT7_API_KEY: secret, LINEAR_API_KEY: "lin_value_given_to_no_one" }),
    );

    const win = await window(daemon, DECK, "v1");
    const spawned = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: envOut,
      title: "given a key",
    })) as AgentSpawnResult;
    const envFile = join(envOut, "session-1.env");
    const env = await poll(
      async () => (existsSync(envFile) ? parseEnvFile(envFile) : undefined),
      10_000,
    );
    expect(env["CONTEXT7_API_KEY"]).toBe(secret);
    expect(env).not.toHaveProperty("LINEAR_API_KEY");
    // the adapter's own variables still win beneath the host's
    expect(env["SCRIPTED_TOKEN"]).toBe("token-1");

    // the value lives in the process alone: not the record the resume reads, not the ledger
    const record = readFileSync(
      join(dataDir, ...LAYOUT.AGENT_SESSIONS_DIR, `${spawned.session.runtimeRunId}.json`),
      "utf8",
    );
    expect(record).not.toContain(secret);
    expect(auditText(dataDir)).not.toContain(secret);
    await win.call("terminal.terminate", { sessionId: spawned.terminal.sessionId });
  }, 60_000);
});

describe("PJ-6 — a launch at a model the agent offers (agent.spawn {modelSelection})", () => {
  /** The spawn params fixture's selection (EL9: the reader's side of the
   * contract's own file), aimed at the scripted agent, which does not list it. */
  const FIXTURE_PARAMS = JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../contracts/fixtures/agent-spawn-params.model-selection.json",
      ),
      "utf8",
    ),
  ) as { modelSelection: { modelId: string; controls: Record<string, string> } };

  it("refuses a model or a control the agent does not offer, and a picker it cannot read, before anything starts — in fieldd's words, keeping puppeteer's codes", async () => {
    const { daemon, dataDir, models } = await setup({ floor: "mock" });
    const win = await window(daemon, DECK, "pj6a");

    // the contract fixture's model is not one the scripted agent lists
    const unlisted = await win.callErr("agent.spawn", {
      provider: "scripted",
      modelSelection: FIXTURE_PARAMS.modelSelection,
    });
    expect(unlisted.data?.kind).toBe("PRECONDITION_FAILED");
    expect(unlisted.message).toContain("Scripted was not started at the chosen model");
    expect(unlisted.data?.details).toMatchObject({
      provider: "scripted",
      code: "AGENT_LAUNCH_REFUSED",
      refusal: "INVALID_MODEL_SELECTION",
      reason: "invalid-model-selection",
    });

    // a listed model at a value its control does not offer
    const value = await win.callErr("agent.spawn", {
      provider: "scripted",
      modelSelection: { modelId: "model-a", controls: { effort: "max" } },
    });
    expect(value.data?.details).toMatchObject({ refusal: "INVALID_MODEL_SELECTION" });

    // the picker cannot be read: the launch is refused as unavailable, never
    // started at the agent's own settings behind the person's back
    models.fail = true;
    const unread = await win.callErr("agent.spawn", {
      provider: "scripted",
      modelSelection: { modelId: "model-a" },
    });
    expect(unread.data?.kind).toBe("UNAVAILABLE");
    expect(unread.data?.retryable).toBe(true);
    expect(unread.message).toContain("Sign in to discover models.");
    expect(unread.data?.details).toMatchObject({
      service: "agents",
      state: "model-discovery-unavailable",
      refusal: "MODEL_DISCOVERY_UNAVAILABLE",
    });

    // each refusal read the picker once and launched nothing
    expect(models.reads).toBe(3);
    expect(models.options).toEqual([]);
    expect(existsSync(join(dataDir, ...LAYOUT.AGENT_SESSIONS_DIR))).toBe(false);
    const act = await auditAct(
      dataDir,
      (entry) => entry.action === "agent.session.spawn" && entry.attrs?.["modelSelection"] === true,
    );
    expect(act.outcome.outcome).toBe("failed");
    // a malformed selection never reaches puppeteer: the door's own refusal
    const malformed = await win.callErr("agent.spawn", {
      provider: "scripted",
      modelSelection: { modelId: "" },
    });
    expect(malformed.data?.kind).toBe("PRECONDITION_FAILED");
    expect(models.reads).toBe(3);
  });

  it("starts at the model and the control chosen: the adapter is handed them, the row is born, and the ledger says a selection was applied without naming it", async () => {
    const { daemon, dataDir, envOut, models } = await setup({ floor: "real" });
    const win = await window(daemon, DECK, "pj6b");
    const spawned = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: envOut,
      // a key a newer caller adds rides the contract, and never reaches
      // puppeteer's strict schema (which would call the selection malformed)
      modelSelection: { modelId: "model-a", controls: { effort: "high" }, later: 1 },
    })) as AgentSpawnResult;
    expect(models.options).toEqual([{ model: "model-a", effort: "high" }]);
    expect(models.reads).toBe(1);
    expect(spawned.session.runtimeRunId).toBeDefined();
    const act = await auditAct(
      dataDir,
      (entry) => entry.action === "agent.session.spawn" && entry.attrs?.["modelSelection"] === true,
    );
    expect(act.outcome.outcome).toBe("succeeded");
    expect(act.outcome.attrs?.["modelSelection"]).toBe("applied");
    expect(auditText(dataDir)).not.toContain("model-a");

    // no selection: the agent's own settings, and no picker read
    const plain = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: envOut,
    })) as AgentSpawnResult;
    expect(models.options).toEqual([{ model: "model-a", effort: "high" }, undefined]);
    expect(models.reads).toBe(1);

    await win.call("terminal.terminate", { sessionId: spawned.terminal.sessionId });
    await win.call("terminal.terminate", { sessionId: plain.terminal.sessionId });
  }, 60_000);

  it("a CONFIRMED birth hands its project the launch's recipe and keeps the selection on its record; a refusal hands nothing, a resume no recipe", async () => {
    const { daemon, dataDir, envOut, records } = await setup({ floor: "real", profiles: true });
    const win = await window(daemon, DECK, "pj6c");
    const acted = vi.spyOn(daemon.projectRecords, "actedIn");
    const spawned = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: envOut,
      profileSet: "native",
      modelSelection: { modelId: "model-a", controls: { effort: "high" } },
    })) as AgentSpawnResult;
    expect(acted).toHaveBeenCalledTimes(1);
    expect(acted.mock.calls[0]?.[0]).toBe(envOut);
    expect(acted.mock.calls[0]?.[2]).toEqual({
      provider: "scripted",
      profileSet: "native",
      selection: { modelId: "model-a", controls: { effort: "high" } },
    });
    // the record keeps what the launch asked for, signed
    const record = readRecord(dataDir, spawned.session.runtimeRunId);
    expect(record.modelSelection).toEqual({ modelId: "model-a", controls: { effort: "high" } });
    expect(records.verifies(record)).toBe(true);

    // a refused launch: no birth, no act
    await win.callErr("agent.spawn", {
      provider: "scripted",
      cwd: envOut,
      profileSet: "native",
      modelSelection: { modelId: "model-x" },
    });
    expect(acted).toHaveBeenCalledTimes(1);

    // the agent's own settings: a recipe with no model, and none on the record
    const plain = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: envOut,
      profileSet: "native",
    })) as AgentSpawnResult;
    expect(acted.mock.calls[1]?.[2]).toEqual({ provider: "scripted", profileSet: "native" });
    expect(readRecord(dataDir, plain.session.runtimeRunId)).not.toHaveProperty("modelSelection");

    // a resume is an act in its place, never a recipe (Q6: only a launch writes one)
    await win.call("terminal.terminate", { sessionId: spawned.terminal.sessionId });
    await poll(
      async () =>
        readRecord(dataDir, spawned.session.runtimeRunId).exited !== undefined ? true : undefined,
      15_000,
    );
    const resumed = (await born(win, "agent.resume", {
      runtimeRunId: spawned.session.runtimeRunId,
    })) as AgentSpawnResult;
    expect(acted).toHaveBeenCalledTimes(3);
    expect(acted.mock.calls[2]?.[2]).toBeUndefined();

    await win.call("terminal.terminate", { sessionId: resumed.terminal.sessionId });
    await win.call("terminal.terminate", { sessionId: plain.terminal.sessionId });
  }, 60_000);

  /** A run launched at model-a/high under `profileSet`, then ended. */
  async function launchedAndEnded(box: Box, win: WsRpc, profileSet: string) {
    const spawned = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: box.envOut,
      profileSet,
      modelSelection: { modelId: "model-a", controls: { effort: "high" } },
    })) as AgentSpawnResult;
    await win.call("terminal.terminate", { sessionId: spawned.terminal.sessionId });
    await poll(
      async () =>
        readRecord(box.dataDir, spawned.session.runtimeRunId).exited !== undefined
          ? true
          : undefined,
      15_000,
    );
    return spawned;
  }

  it("Q4 — a resume starts at the session's own launch model again, discovered in the account it was launched in; the answer and the ledger say applied, and the successor keeps it", async () => {
    const box = await setup({ floor: "real", profiles: true });
    const { daemon, dataDir, sessions, models } = box;
    const win = await window(daemon, DECK, "pj6d");
    const made = (await win.call("agents.profileSets.create", {
      label: "Work",
    })) as AgentsProfileSetsSetResult;
    const { persona } = (await win.call("agents.profiles.create", {
      set: made.set.id,
      provider: "scripted",
    })) as AgentsProfilesCreateResult;
    const spawned = await launchedAndEnded(box, win, made.set.id);
    expect(models.discovered).toEqual([persona.profileId]);

    const resumed = (await born(win, "agent.resume", {
      runtimeRunId: spawned.session.runtimeRunId,
    })) as AgentSpawnResult;
    // the same conversation, continued — at the model and the effort it was
    // launched at, the picker read again in the session's own account
    expect(sessions.at(-1)?.resume).toBe(spawned.session.sessionId);
    expect(models.options.at(-1)).toEqual({ model: "model-a", effort: "high" });
    expect(models.discovered).toEqual([persona.profileId, persona.profileId]);
    expect(resumed.modelSelection).toEqual({ state: "applied" });
    expect(readRecord(dataDir, resumed.session.runtimeRunId).modelSelection).toEqual({
      modelId: "model-a",
      controls: { effort: "high" },
    });
    const act = await auditAct(
      dataDir,
      (entry) =>
        entry.action === "agent.session.resume" && entry.target.id === spawned.session.runtimeRunId,
    );
    expect(act.outcome.attrs?.["modelSelection"]).toBe("applied");
    expect(auditText(dataDir)).not.toContain("model-a");
    await win.call("terminal.terminate", { sessionId: resumed.terminal.sessionId });
  }, 60_000);

  it("Q4 — a launch model the picker can no longer give is refused on resume, in fieldd's words with puppeteer's code — never dropped to the agent's own", async () => {
    const box = await setup({ floor: "real" });
    const { daemon, sessions, models } = box;
    const win = await window(daemon, DECK, "pj6e");
    const spawned = await launchedAndEnded(box, win, "native");
    const born = sessions.length;
    models.fail = true;
    const refused = await win.callErr("agent.resume", {
      runtimeRunId: spawned.session.runtimeRunId,
    });
    expect(refused.data?.kind).toBe("UNAVAILABLE");
    expect(refused.message).toContain(
      "Scripted was not resumed at the model the session was launched at",
    );
    expect(refused.data?.details).toMatchObject({ refusal: "MODEL_DISCOVERY_UNAVAILABLE" });
    expect(sessions).toHaveLength(born);
  }, 60_000);

  it("Q4 — an agent whose resume cannot take a model resumes at its own, and the answer says so in fieldd's words", async () => {
    const box = await setup({ floor: "real", resumeSelection: false });
    const { daemon, models } = box;
    const win = await window(daemon, DECK, "pj6f");
    const spawned = await launchedAndEnded(box, win, "native");
    const reads = models.reads;
    const resumed = (await born(win, "agent.resume", {
      runtimeRunId: spawned.session.runtimeRunId,
    })) as AgentSpawnResult;
    // no selection asked of puppeteer (which would refuse it): its own settings
    expect(models.options.at(-1)).toBeUndefined();
    expect(models.reads).toBe(reads);
    expect(resumed.modelSelection).toEqual({
      state: "own",
      reason: "at Scripted's own model — it can't start a resumed session at a chosen one",
    });
    await win.call("terminal.terminate", { sessionId: resumed.terminal.sessionId });
  }, 60_000);

  it("Q4 — a conversation resumed by its native id starts at the model its newest run of ours was launched at", async () => {
    const box = await setup({ floor: "real", catalog: FILED_CATALOG });
    const { daemon, sessions, models } = box;
    const win = await window(daemon, DECK, "pj6g");
    const spawned = await launchedAndEnded(box, win, "native");
    fileConversations(box, [spawned.session.sessionId]);
    const resumed = (await born(win, "agent.resume", {
      provider: "scripted",
      nativeSessionId: spawned.session.sessionId,
      cwd: box.envOut,
    })) as AgentSpawnResult;
    expect(sessions.at(-1)?.resume).toBe(spawned.session.sessionId);
    expect(models.options.at(-1)).toEqual({ model: "model-a", effort: "high" });
    expect(resumed.modelSelection).toEqual({ state: "applied" });
    await win.call("terminal.terminate", { sessionId: resumed.terminal.sessionId });
  }, 60_000);
});

/** PJ-7 — give this desktop one place, through the catalog's own write path
 * (the scanner's `setPlaces`): the index learns a project rooted at `path`, and
 * the place's facts ride its row. Answers the place's ref as the doors name it. */
async function placeOf(box: Box, placeId: string, path: string, over: Partial<PlaceFacts> = {}) {
  writeFileSync(
    box.runtimesFile,
    JSON.stringify([{ id: "rt-scripted", kind: "scripted", data_root: "~/.scripted" }]),
  );
  writeFileSync(
    box.sessionsFile,
    JSON.stringify([{ ...rosettaRow(`in-${placeId}`, 60_000), project_id: "p-place", cwd: path }]),
  );
  const catalog = box.daemon.indexCatalog;
  await poll(async () => (catalog.ready ? true : undefined), 20_000);
  catalog.resnapshot();
  await poll(async () => (catalog.projects.size === 1 ? true : undefined), 20_000);
  catalog.setPlaces(
    new Map([
      [
        "p-place",
        [
          {
            placeId,
            path,
            aliases: [],
            kind: "project" as const,
            caseless: true,
            exists: true,
            mounted: true,
            git: true,
            identityRemote: "github.com/acme/app",
            remotes: ["github.com/acme/app"],
            samples: [],
            hits: [],
            observedAt: 1,
            ...over,
          },
        ],
      ],
    ]),
  );
  return { device: box.daemon.devices.currentDeviceId(), placeId };
}

describe("PJ-7 — a launch names a place (agent.spawn {place})", () => {
  it("runs in the place's own folder, resolved from this desktop's place facts; the ledger names the ref, never the path; the birth hands the place to its project", async () => {
    const box = await setup({ floor: "real", profiles: true });
    const { daemon, dataDir, root } = box;
    const app = join(root, "app");
    mkdirSync(app);
    const ref = await placeOf(box, "pl_app", app);
    const win = await window(daemon, DECK, "pj7a");
    const acted = vi.spyOn(daemon.projectRecords, "actedIn");

    const spawned = (await born(win, "agent.spawn", {
      provider: "scripted",
      place: ref,
      profileSet: "native",
    })) as AgentSpawnResult;
    // the run's folder is the place's path: no path crossed the wire
    expect(readRecord(dataDir, spawned.session.runtimeRunId).cwd).toBe(app);
    // the birth is an act in that place, its recipe the place's (`onPlace`)
    expect(acted).toHaveBeenCalledTimes(1);
    expect(acted.mock.calls[0]?.[0]).toBe(app);
    expect(acted.mock.calls[0]?.[2]).toEqual({ provider: "scripted", profileSet: "native" });
    expect(acted.mock.calls[0]?.[3]).toBe("pl_app");
    // the ledger: the ref the caller sent, and no folder at all
    const act = await auditAct(
      dataDir,
      (entry) => entry.action === "agent.session.spawn" && entry.attrs?.["place"] !== undefined,
    );
    expect(act.attempt.attrs?.["place"]).toEqual(ref);
    expect(act.attempt.attrs).not.toHaveProperty("cwd");
    expect(act.outcome.outcome).toBe("succeeded");
    await win.call("terminal.terminate", { sessionId: spawned.terminal.sessionId });
  }, 60_000);

  it("refuses in fieldd's words before anything starts: another desktop's place, a place this desktop does not know, a folder gone or unmounted, a place beside a cwd", async () => {
    const box = await setup({ floor: "real" });
    const { daemon, dataDir, root, sessions } = box;
    const app = join(root, "app");
    mkdirSync(app);
    const ref = await placeOf(box, "pl_app", app);
    const win = await window(daemon, DECK, "pj7b");
    const refusal = async (params: Record<string, unknown>) =>
      (await win.callErr("agent.spawn", { provider: "scripted", ...params })) as RpcErrorShape;

    // another desktop's ref: this desktop launches only into its own places —
    // the contracts' golden launch (EL9), whose place is another desktop's
    const golden = JSON.parse(
      readFileSync(
        join(import.meta.dirname, "../../contracts/fixtures/agent-spawn-params.place.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const { modelSelection: _model, ...goldenLaunch } = golden;
    const elsewhere = (await win.callErr("agent.spawn", {
      ...goldenLaunch,
      provider: "scripted",
    })) as RpcErrorShape;
    expect(elsewhere.data?.kind).toBe("PRECONDITION_FAILED");
    expect(elsewhere.data?.details).toMatchObject({
      reason: "not-here",
      place: golden["place"],
    });
    // an id this desktop has no facts for
    const unknown = await refusal({ place: { ...ref, placeId: "pl_nowhere" } });
    expect(unknown.data?.kind).toBe("NOT_FOUND");
    expect(unknown.data?.details).toMatchObject({ reason: "unknown-place" });
    // both a place and a folder: which did the caller mean? (the schema's own refusal)
    const both = await refusal({ place: ref, cwd: app });
    expect(both.data?.kind).toBe("PRECONDITION_FAILED");
    expect(both.message).toContain("place");

    // a place whose folder is gone — on disk, whatever the facts last said —
    // and one whose volume is not mounted: today's `missing-cwd`, by ref
    rmSync(app, { recursive: true });
    const gone = await refusal({ place: ref });
    expect(gone.data?.kind).toBe("PRECONDITION_FAILED");
    expect(gone.data?.details).toMatchObject({ reason: "missing-cwd", place: ref });
    expect(JSON.stringify(gone.data?.details)).not.toContain(app);
    mkdirSync(app);
    await placeOf(box, "pl_app", app, { mounted: false });
    const unmounted = await refusal({ place: ref });
    expect(unmounted.data?.details).toMatchObject({ reason: "missing-cwd", place: ref });

    // nothing started, nothing recorded
    expect(sessions).toHaveLength(0);
    expect(existsSync(join(dataDir, ...LAYOUT.AGENT_SESSIONS_DIR))).toBe(false);
  }, 60_000);

  it("Q3 (a) — a native resume that names no folder runs in the conversation's own, from this desktop's index, never in home; a folder gone is `missing-cwd`, and so is a conversation the index files no folder for", async () => {
    const box = await setup({ floor: "real", catalog: FILED_CATALOG });
    const { daemon, dataDir, root, sessions } = box;
    const own = join(root, "conversation-folder");
    mkdirSync(own);
    const win = await window(daemon, DECK, "pj7c");
    await indexReady(win);
    const spawned = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: own,
    })) as AgentSpawnResult;
    const conversation = spawned.session.sessionId;
    // the index files it under the scripted agent, in its own folder
    const fileIn = (cwd: string | null) => {
      writeFileSync(
        box.runtimesFile,
        JSON.stringify([{ id: "rt-scripted", kind: "scripted", data_root: "~/.scripted" }]),
      );
      writeFileSync(
        box.sessionsFile,
        JSON.stringify([{ ...rosettaRow(conversation, 60_000), cwd }]),
      );
    };
    fileIn(own);
    const ended = async (result: AgentSpawnResult) => {
      await win.call("terminal.terminate", { sessionId: result.terminal.sessionId });
      await poll(
        async () =>
          readRecord(dataDir, result.session.runtimeRunId).exited !== undefined ? true : undefined,
        15_000,
      );
    };
    await ended(spawned);

    // the phone's Resume: an id and an agent, no path
    const resumed = (await born(win, "agent.resume", {
      provider: "scripted",
      nativeSessionId: conversation,
    })) as AgentSpawnResult;
    expect(sessions.at(-1)?.resume).toBe(conversation);
    expect(readRecord(dataDir, resumed.session.runtimeRunId).cwd).toBe(own);
    await ended(resumed);

    // the folder is gone: refused as today, never started somewhere else
    rmSync(own, { recursive: true });
    const gone = (await win.callErr("agent.resume", {
      provider: "scripted",
      nativeSessionId: conversation,
    })) as RpcErrorShape;
    expect(gone.data?.kind).toBe("PRECONDITION_FAILED");
    expect(gone.data?.details).toMatchObject({ reason: "missing-cwd", cwd: own });
    // the index knows no folder for it: refused too — home was never its folder
    mkdirSync(own);
    fileIn(null);
    const unfiled = (await win.callErr("agent.resume", {
      provider: "scripted",
      nativeSessionId: conversation,
    })) as RpcErrorShape;
    expect(unfiled.data?.kind).toBe("PRECONDITION_FAILED");
    expect(unfiled.data?.details).toMatchObject({ reason: "missing-cwd" });
    expect(sessions).toHaveLength(2);

    // a caller that names the folder is unchanged: it runs where it said
    const named = (await born(win, "agent.resume", {
      provider: "scripted",
      nativeSessionId: conversation,
      cwd: box.envOut,
    })) as AgentSpawnResult;
    expect(readRecord(dataDir, named.session.runtimeRunId).cwd).toBe(box.envOut);
    await win.call("terminal.terminate", { sessionId: named.terminal.sessionId });
  }, 90_000);
});

describe("Agent Profiles over the REAL floor (AR-S2) — sessions and sign-ins", () => {
  /** A profile with one scripted sign-in; answers the persona and its root. */
  async function signedIn(
    win: WsRpc,
    dataDir: string,
    label: string,
    options: { default?: boolean } = {},
  ): Promise<{ profileId: string; set: string; folder: string; root: string }> {
    const made = (await win.call("agents.profileSets.create", {
      label,
      ...(options.default === true ? { default: true } : {}),
    })) as { set: { id: string } };
    const { persona } = (await win.call("agents.profiles.create", {
      set: made.set.id,
      provider: "scripted",
    })) as AgentsProfilesCreateResult;
    const folder = join(dataDir, ...LAYOUT.AGENT_PROFILE_SETS_DIR, made.set.id);
    const root = join(folder, readdirSync(folder)[0] as string);
    return { profileId: persona.profileId, set: made.set.id, folder, root };
  }

  it("a sign-out waits for the session running under it: out of its profile and out of new spawns at once, its root kept until the session ends, then finished", async () => {
    const { daemon, dataDir, envOut, seen } = await setup({ floor: "real", profiles: true });
    const win = await window(daemon, DECK, "ap1");
    const work = await signedIn(win, dataDir, "Work");
    const spawned = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: envOut,
      profileId: work.profileId,
    })) as AgentSpawnResult;
    expect(seen.at(-1)?.id).toBe(work.profileId);
    expect(spawned.session.profileId).toBe(work.profileId);

    const out = (await win.call("agents.profiles.delete", {
      profileId: work.profileId,
    })) as AgentsProfilesDeleteResult;
    // the scripted adapter never said where it keeps a credential: nothing is claimed past the folder
    expect(out).toEqual({ deleted: false, waiting: 1, credential: "unknown" });
    const listed = (await win.call("agents.profileSets.list", {})) as AgentsProfileSetsListResult;
    expect(listed.sets.find((set) => set.id === work.set)?.personas).toEqual([]);
    const refused = await win.callErr("agent.spawn", {
      provider: "scripted",
      cwd: envOut,
      profileId: work.profileId,
    });
    expect(refused.data?.kind).toBe("NOT_FOUND");
    // the session keeps going, and so does its root
    expect(existsSync(work.root)).toBe(true);

    await win.call("terminal.terminate", { sessionId: spawned.terminal.sessionId });
    await poll(async () => (existsSync(work.root) ? undefined : true), 15_000);
    const registry = JSON.parse(readFileSync(join(dataDir, ...LAYOUT.AGENT_PROFILES_FILE), "utf8"));
    expect(registry.profiles).toEqual([]);
    // the profile itself stays: a sign-out leaves the place
    expect(existsSync(work.folder)).toBe(true);
    // nothing could resume into a root that is gone
    expect(
      existsSync(
        join(dataDir, ...LAYOUT.AGENT_SESSIONS_DIR, `${spawned.session.runtimeRunId}.json`),
      ),
    ).toBe(false);
  }, 60_000);

  it("the default profile is where a spawn that names none runs; a resume continues in the account it was born under whatever the default says now", async () => {
    const { daemon, dataDir, envOut, seen } = await setup({ floor: "real", profiles: true });
    const win = await window(daemon, DECK, "ap2");
    const work = await signedIn(win, dataDir, "Work", { default: true });
    const spawned = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: envOut,
    })) as AgentSpawnResult;
    expect(seen.at(-1)?.id).toBe(work.profileId);
    expect(spawned.session.profileId).toBe(work.profileId);
    expect(readRecord(dataDir, spawned.session.runtimeRunId).profileId).toBe(work.profileId);

    // the default moves back to This Mac; the run was born under Work
    await win.call("agents.profileSets.update", { set: "native", default: true });
    await win.call("terminal.terminate", { sessionId: spawned.terminal.sessionId });
    await poll(
      async () =>
        readRecord(dataDir, spawned.session.runtimeRunId).exited !== undefined ? true : undefined,
      15_000,
    );
    const resumed = (await born(win, "agent.resume", {
      runtimeRunId: spawned.session.runtimeRunId,
    })) as AgentSpawnResult;
    expect(seen.at(-1)?.id).toBe(work.profileId);
    expect(resumed.session.profileId).toBe(work.profileId);
    // …and a fresh spawn now runs in the agent's own folder
    await born(win, "agent.spawn", { provider: "scripted", cwd: envOut });
    expect(seen.at(-1)).toBeUndefined();
    await win.call("terminal.terminate", { sessionId: resumed.terminal.sessionId });
  }, 60_000);

  it("AR-S5 — a spawn under a named profile runs on its sign-in and the row says which profile; This Mac is the agent's own folder; a profile with no sign-in for the agent refuses before anything runs", async () => {
    const { daemon, dataDir, envOut, seen } = await setup({ floor: "real", profiles: true });
    const win = await window(daemon, DECK, "ap5");
    const work = await signedIn(win, dataDir, "Work");
    const spawned = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: envOut,
      profileSet: work.set,
    })) as AgentSpawnResult;
    expect(seen.at(-1)?.id).toBe(work.profileId);
    expect(spawned.session.profileId).toBe(work.profileId);
    expect(spawned.session.profileSet).toBe(work.set);
    // the record keeps it, so a pending or exited row still says it
    expect(readRecord(dataDir, spawned.session.runtimeRunId).profileSet).toBe(work.set);
    const { sessions } = (await win.call("agent.list", {})) as AgentListResult;
    expect(
      sessions.find((row) => row.runtimeRunId === spawned.session.runtimeRunId)?.profileSet,
    ).toBe(work.set);

    // This Mac: the agent's own folder, bound to no sign-in, and named on the row
    const native = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: envOut,
      profileSet: "native",
    })) as AgentSpawnResult;
    expect(seen.at(-1)).toBeUndefined();
    expect(native.session.profileId).toBeUndefined();
    expect(native.session.profileSet).toBe("native");

    // a profile that holds no sign-in for the agent: refused, in puppeteer's words, audited as failed
    const made = (await win.call("agents.profileSets.create", {
      label: "Empty",
    })) as AgentsProfileSetsSetResult;
    const before = seen.length;
    const refused = await win.callErr("agent.spawn", {
      provider: "scripted",
      cwd: envOut,
      profileSet: made.set.id,
    });
    expect(refused.data?.kind).toBe("NOT_FOUND");
    expect(refused.message).toContain("Empty has no scripted account");
    expect(seen.length).toBe(before);
    const act = await auditAct(
      dataDir,
      (entry) =>
        entry.action === "agent.session.spawn" && entry.attrs?.["profileSet"] === made.set.id,
    );
    expect(act.outcome.outcome).toBe("failed");

    await win.call("terminal.terminate", { sessionId: spawned.terminal.sessionId });
    await win.call("terminal.terminate", { sessionId: native.terminal.sessionId });
  }, 60_000);

  it("QL-D10 — a native resume runs where the index files the conversation: in the agent's own folder when it is filed there, never the default profile; naming another persona (by id or by its Agent Profile) refuses, as does a profile with no sign-in for the agent — before anything runs", async () => {
    const box = await setup({ floor: "real", profiles: true, catalog: FILED_CATALOG });
    const { daemon, dataDir, envOut, seen } = box;
    // every conversation here is filed in the agent's own folder (`~/.scripted`,
    // no enrolled root, so no persona)
    fileConversations(box, ["conv-own", "conv-native", "conv-empty"]);
    const win = await window(daemon, DECK, "qn4");
    await indexReady(win);
    const work = await signedIn(win, dataDir, "Work", { default: true });
    const before = seen.length;

    // EL7 (the review's finding 8): the persona is the index's, never the
    // caller's — Work does not hold this conversation, however it is named
    for (const named of [{ profileId: work.profileId }, { profileSet: work.set }]) {
      const refused = await win.callErr("agent.resume", {
        provider: "scripted",
        nativeSessionId: "conv-own",
        cwd: envOut,
        ...named,
      });
      expect(refused.data?.kind, JSON.stringify(named)).toBe("PRECONDITION_FAILED");
      expect(refused.data?.details).toMatchObject({
        nativeSessionId: "conv-own",
        reason: "other-profile",
      });
    }
    // an Agent Profile with no sign-in for the agent refuses as it resolves
    const made = (await win.call("agents.profileSets.create", {
      label: "Empty",
    })) as AgentsProfileSetsSetResult;
    const empty = await win.callErr("agent.resume", {
      provider: "scripted",
      nativeSessionId: "conv-empty",
      cwd: envOut,
      profileSet: made.set.id,
    });
    expect(empty.data?.kind).toBe("NOT_FOUND");
    expect(empty.message).toContain("Empty has no Scripted sign-in");
    expect(seen.length).toBe(before);

    // Work is the DEFAULT, and a resume that names nothing still continues in
    // the agent's own folder: the conversation lives where it was born
    const own = (await born(win, "agent.resume", {
      provider: "scripted",
      nativeSessionId: "conv-own",
      cwd: envOut,
    })) as AgentSpawnResult;
    expect(seen.at(-1)).toBeUndefined();
    expect(own.session.profileId).toBeUndefined();
    // …as does naming the agent's own folder by its Agent Profile
    const native = (await born(win, "agent.resume", {
      provider: "scripted",
      nativeSessionId: "conv-native",
      cwd: envOut,
      profileSet: "native",
    })) as AgentSpawnResult;
    expect(seen.at(-1)).toBeUndefined();
    expect(native.session.profileId).toBeUndefined();

    for (const run of [own, native]) {
      await win.call("terminal.terminate", { sessionId: run.terminal.sessionId });
    }
  }, 60_000);

  it("PJ-7 — a native resume that names no persona runs under the one the index files the conversation under: its sign-in, its root; refused `signed-out` once that persona is signed out; a persona named is still held to the filed one", async () => {
    const box = await setup({ floor: "real", profiles: true, catalog: FILED_CATALOG });
    const { daemon, dataDir, envOut, seen } = box;
    const win = await window(daemon, DECK, "pj7p");
    await indexReady(win);
    const work = await signedIn(win, dataDir, "Work");
    const home = await signedIn(win, dataDir, "Home");
    // Work's root is enrolled with the index (as a persona of an agent the
    // roll call spells is at its creation), and the conversation is filed there.
    // The runtime row is scripted beside the enrolled one, so it outlives the
    // sign-out below as rosetta keeps a retired root's rows (AR-D19)
    await daemon.index.enrollRuntimes([
      { kind: "scripted", dataRoot: work.root, label: "Work", profileId: work.profileId },
    ]);
    await indexReady(win);
    writeFileSync(
      box.runtimesFile,
      JSON.stringify([
        { id: "rt-work", kind: "scripted", data_root: work.root, provenance: "enrolled" },
      ]),
    );
    writeFileSync(
      box.sessionsFile,
      JSON.stringify([{ ...rosettaRow("conv-work", 60_000), runtime_id: "rt-work" }]),
    );

    // the phone's Resume names no persona: the index's is adopted — no word
    // of the caller's is taken for it (EL7, the review's finding 8)
    const resumed = (await born(win, "agent.resume", {
      provider: "scripted",
      nativeSessionId: "conv-work",
      cwd: envOut,
    })) as AgentSpawnResult;
    expect(seen.at(-1)?.id).toBe(work.profileId);
    expect(seen.at(-1)?.dataRoot).toBe(work.root);
    expect(resumed.session.profileId).toBe(work.profileId);
    await win.call("terminal.terminate", { sessionId: resumed.terminal.sessionId });
    await poll(
      async () =>
        readRecord(dataDir, resumed.session.runtimeRunId).exited !== undefined ? true : undefined,
      15_000,
    );

    // a persona NAMED is held to the filed one, as before
    const before = seen.length;
    const other = await win.callErr("agent.resume", {
      provider: "scripted",
      nativeSessionId: "conv-work",
      cwd: envOut,
      profileId: home.profileId,
    });
    expect(other.data?.kind).toBe("PRECONDITION_FAILED");
    expect(other.data?.details).toMatchObject({ reason: "other-profile" });

    // Work signed out: the persona adopted is the one checked
    await win.call("agents.profiles.delete", { profileId: work.profileId });
    let out: RpcErrorShape | undefined;
    await poll(async () => {
      out = (await win.callErr("agent.resume", {
        provider: "scripted",
        nativeSessionId: "conv-work",
        cwd: envOut,
      })) as RpcErrorShape;
      return (out.data?.details as { state?: string } | undefined)?.state === "signed-out"
        ? true
        : undefined;
    }, 15_000);
    expect(out?.data?.kind).toBe("PRECONDITION_FAILED");
    expect(seen.length).toBe(before);
  }, 90_000);

  it("deleting a profile stops the sessions running under it first, then deletes its folder", async () => {
    const { daemon, dataDir, envOut } = await setup({ floor: "real", profiles: true });
    const win = await window(daemon, DECK, "ap3");
    const work = await signedIn(win, dataDir, "Work");
    const spawned = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: envOut,
      profileId: work.profileId,
    })) as AgentSpawnResult;

    const deleted = (await win.call("agents.profileSets.delete", {
      set: work.set,
    })) as AgentsProfileSetsDeleteResult;
    expect(deleted).toEqual({ deleted: true, stopped: 1 });
    expect(existsSync(work.folder)).toBe(false);
    // the run is over; its pane stays until someone closes it (MF-1f), and
    // it offers no resume — the sign-in it would continue in is gone
    const row = await poll(async () => {
      const { sessions } = (await win.call("agent.list", {})) as AgentListResult;
      const found = sessions.find((r) => r.runtimeRunId === spawned.session.runtimeRunId);
      return found === undefined || found.continuation?.exited === true
        ? (found ?? null)
        : undefined;
    }, 15_000);
    if (row !== null) expect(row.continuation).toMatchObject({ exited: true, resumable: false });
    const refused = await win.callErr("agent.resume", {
      runtimeRunId: spawned.session.runtimeRunId,
    });
    expect(refused.data?.kind).toBe("NOT_FOUND");
  }, 60_000);

  it("a sign-out ends a login still open on that sign-in before its folder goes", async () => {
    process.env["SCRIPTED_LOGIN"] = "sleep 60";
    cleanup.push(() => {
      delete process.env["SCRIPTED_LOGIN"];
    });
    const { daemon, dataDir } = await setup({ floor: "real", profiles: true });
    const win = await window(daemon, DECK, "ap4");
    const work = await signedIn(win, dataDir, "Work");
    const login = (await win.call("agents.profiles.login", {
      profileId: work.profileId,
    })) as AgentsProfilesLoginResult;
    const paneId = login.terminal.sessionId;
    // the feed says the sign-in is open, for as long as the pane lives
    const open = await poll(async () => {
      const { sets } = (await win.call(
        "agents.profileSets.list",
        {},
      )) as AgentsProfileSetsListResult;
      const persona = sets
        .find((set) => set.id === work.set)
        ?.personas.find((p) => p.profileId === work.profileId);
      return persona?.signingIn !== undefined ? persona.signingIn : undefined;
    }, 15_000);
    expect(open.sessionId).toBe(paneId);

    const out = (await win.call("agents.profiles.delete", {
      profileId: work.profileId,
    })) as AgentsProfilesDeleteResult;
    // the login was not a session to wait for: it ended, and the sign-in is gone
    expect(out).toMatchObject({ deleted: true });
    expect(existsSync(work.root)).toBe(false);
    // and its pane leaves the floor
    await poll(async () => {
      const { terminals } = (await win.call("terminal.list", {})) as { terminals: TerminalInfo[] };
      return terminals.some((row) => row.sessionId === paneId) ? undefined : true;
    }, 15_000);
  }, 60_000);
});

describe('MF-1 — agent.subscribe {projection: "field"} over the wire', () => {
  it("answers the live board, then carries the change in CHAINED frames no closer than the floor, and no content ever", async () => {
    const box = await setup({ floor: "real" });
    const win = await window(box.daemon, [...DECK, "agent.control"], "fw1");
    const spawned = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: box.envOut,
    })) as AgentSpawnResult;
    const runId = spawned.session.runtimeRunId;
    await joinedRow(win, runId);
    // item 118 — the ⌃C below must meet `cat`, never the shell's prologue
    await catReady(box, spawned.terminal.sessionId);

    // the SNAPSHOT is the live board, not an empty one
    // the floor this subscriber asks for IS the registry's default; naming the
    // constant keeps the option and the spacing assertion below from drifting
    const floorMs = AGENT_FIELD.MIN_INTERVAL_MS;
    const sub = (await win.call("agent.subscribe", {
      projection: "field",
      minIntervalMs: floorMs,
    })) as { subId: string; snapshot: { revision: number; rows: Record<string, unknown>[] } };
    const row = sub.snapshot.rows.find((r) => r["runtimeRunId"] === runId);
    expect(row, "the field snapshot did not carry the run").toBeDefined();
    expect(sub.snapshot.revision).toBeGreaterThan(0);
    expect(row).toMatchObject({ kind: "scripted", alive: true });
    // the allowlist, ON THE WIRE: a leak in the projection reaches a phone
    // through exactly this frame
    for (const key of Object.keys(row ?? {})) expect(FIELD_ROW_KEYS).toContain(key);

    const frames = () =>
      win.notifications.filter(
        // the product API names a subscription's frames `<base>.delta`, where
        // the base drops `.subscribe` (product-api.ts) — `agent.delta` here
        (n) => n.method === "agent.delta" && n.params.subId === sub.subId,
      );
    const payload = (index: number) =>
      frames()[index]?.params.payload as
        | { since: number; revision: number; upserts: Record<string, unknown>[]; removed: string[] }
        | undefined;

    /** Wait until the board STOPS MOVING: two readings of this subscriber's
     * frame count, a few floors apart, that agree.
     *
     * A freshly spawned run keeps arriving for a moment after its birth — the
     * inventory's cell tag on its pane, its first mirror, its status leaving
     * the birth state — and under load those facts land after the snapshot and
     * reach this subscriber as perfectly legitimate deltas. Every stillness
     * claim below is a claim about a SETTLED board, so each one waits for one
     * first. (The gate caught this: the file takes ~59 s beside two xcodebuild
     * lanes, and a birth's own follow-up landed inside the window.) */
    const settle = async (): Promise<number> =>
      await poll(async () => {
        const seen = frames().length;
        await new Promise((resolve) => setTimeout(resolve, 750));
        return frames().length === seen ? seen : undefined;
      }, 30_000);

    const quiet = await settle();
    // the chain continues from the LAST frame this subscriber holds — settling
    // may legitimately have moved the board past the snapshot's revision
    const baseline = quiet === 0 ? sub.snapshot.revision : (payload(quiet - 1)?.revision ?? -1);
    expect(baseline).toBeGreaterThan(0);

    // a settled board sends NOTHING
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(frames().length, "a settled board sent a frame").toBe(quiet);

    // the run's state moves: the scripted PTY's `cat` dies of the interrupt
    const interruptAt = Date.now();
    expect(await win.call("agent.interrupt", { runtimeRunId: runId })).toEqual({ accepted: true });

    await poll(async () => payload(quiet), 20_000);
    // Let the WHOLE change land before judging it. An interrupt's effects are
    // not one fact: the PTY's exit, then the record's, then the pane's, and
    // they can legitimately span two floors under load.
    const afterExit = await settle();

    // THE COALESCING LAW, which is about SPACING AND THE CHAIN — not a count.
    // "Exactly one delta" is not a promise the publisher can keep: it would
    // require every consequence of an interrupt to fall inside one window, and
    // nothing schedules them that way. What IS promised is that frames are
    // never closer than this subscriber's declared floor, that each one applies
    // on top of the last, and that the change arrives. The landing gate caught
    // the count version of this row failing under a loaded graph (3 frames,
    // not 2) while every one of those properties held.
    const changed = frames().slice(quiet);
    expect(changed.length, "the change produced no frame at all").toBeGreaterThan(0);

    // THE CHAIN: unbroken from what this client was left at
    let since = baseline;
    for (const [index, frame] of changed.entries()) {
      const body = frame.params.payload as {
        since: number;
        revision: number;
        upserts: Record<string, unknown>[];
        removed: string[];
      };
      expect(body.since, `frame ${index} did not continue the chain`).toBe(since);
      expect(body.revision).toBeGreaterThan(body.since);
      // NO CONTENT, ever — a leak reaches a phone through exactly these frames
      for (const upsert of body.upserts) {
        for (const key of Object.keys(upsert)) expect(FIELD_ROW_KEYS).toContain(key);
      }
      since = body.revision;
    }

    // THE SPACING, stated as a RATE rather than a per-pair gap — because a gap
    // between ARRIVALS is not a measurement of the floor.
    //
    // The floor is enforced where frames are EMITTED; `receivedAt` is when a
    // loaded Node event loop got round to reading the socket. A stall batches
    // two properly-spaced frames into one tick and reports a gap of ~0, which
    // is a false red — this row caught exactly that on its first loaded run.
    // Batching can only ever DELAY arrivals, never manufacture frames, so the
    // count over a window is sound in the direction that matters: a server
    // honouring a floor of `floorMs` cannot have emitted more than one frame
    // per floor across the window, however they clumped on the way in.
    const lastArrival = changed[changed.length - 1]?.receivedAt ?? interruptAt;
    const windowMs = Math.max(0, lastArrival - interruptAt);
    const ceiling = Math.floor(windowMs / floorMs) + 1;
    expect(
      changed.length,
      `${changed.length} frames in ${windowMs}ms breaches the ${floorMs}ms floor (max ${ceiling})`,
    ).toBeLessThanOrEqual(ceiling);

    // THE CHANGE ITSELF: the run is carried, dead, somewhere in that run of
    // frames — which frame it rode is the scheduler's business, not the law's
    const carried = changed
      .flatMap((f) => (f.params.payload as { upserts: Record<string, unknown>[] }).upserts)
      .filter((r) => r["runtimeRunId"] === runId);
    expect(carried.length, "no frame carried the run that changed").toBeGreaterThan(0);
    expect(carried[carried.length - 1]).toMatchObject({ alive: false });

    // and the board, settled, stays silent
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(frames().length, "a settled board kept sending frames").toBe(afterExit);
  }, 200_000);
});

describe("MF-1f/MF-1g — an agent pane outlives its run, and the fold keeps its row", () => {
  /** A real managed run, really ended, with its pane still on the floor.
   *
   * This is the product's own path since MF-1g: agent terminals are created
   * `keep-until-explicit-close` (terminal-service.ts), so an agent that
   * finishes leaves a PANE — its final screen and its exit facts — instead of
   * a hole. Under the old `keep-until-exit` class the floor dropped the
   * session within 150 ms of the process ending (measured at MF-1f), and this
   * state could not be reached at all.
   */
  async function endedRun(box: Box, win: WsRpc): Promise<{ runId: string; paneId: string }> {
    const spawned = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: box.envOut,
      title: "held open",
    })) as AgentSpawnResult;
    const runId = spawned.session.runtimeRunId;
    await joinedRow(win, runId);
    // the scripted PTY's `cat` dies of the floor's own interrupt, once it IS `cat` (item 118)
    await catReady(box, spawned.terminal.sessionId);
    expect(await win.call("agent.interrupt", { runtimeRunId: runId })).toEqual({ accepted: true });
    await poll(
      async () => {
        const { sessions } = (await win.call("agent.list", {})) as AgentListResult;
        const row = sessions.find((r) => r.runtimeRunId === runId);
        return row?.continuation?.exited === true ? row : undefined;
      },
      INTERRUPTED_EXIT_MS,
      "the interrupted run read as exited",
      exitWitness(box, spawned.terminal.sessionId),
    );
    return { runId, paneId: spawned.terminal.sessionId };
  }

  it("the pane stays and the row with it — exited, hosted, resumable — until the pane is closed", async () => {
    const box = await setup({ floor: "real" });
    const win = await window(box.daemon, [...DECK, "agent.control"], "g1");
    const { runId, paneId } = await endedRun(box, win);

    // not a race with the exit: two seconds later the pane is still the
    // floor's, which is the whole ruling
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(await listed(win, paneId)).toBe(true);

    // item 87 — the row reads exited at once, and resumable once the run's exit
    // cleanup (its workspace's final git reading) has ended
    const row = await poll(
      async (seen) => {
        const { sessions } = (await win.call("agent.list", {})) as AgentListResult;
        const found = sessions.find((r) => r.runtimeRunId === runId);
        seen(found?.continuation ?? null);
        return found?.continuation?.resumable === true ? found : undefined;
      },
      15_000,
      "the exited row reading resumable once its exit cleanup ended",
    );
    expect(row?.continuation).toMatchObject({ persisted: true, resumable: true, exited: true });
    expect(row?.continuation?.pending, "an exited row is not a pending one").toBeUndefined();
    expect(row?.terminal).toMatchObject({ hosted: "local", runtimeSessionId: paneId });
    expect(row?.title).toBe("held open");
    // the mirror is kept, and it is the run's LAST state — the card still
    // shows what the agent had been doing when it stopped
    expect(row?.monitor?.runtimeRunId).toBe(runId);

    // the field projection: not alive, and NOT pending — different questions,
    // different verbs, and a phone that drew `pending` would offer the wrong one
    const field = (await win.call("agent.subscribe", { projection: "field" })) as {
      snapshot: { rows: { runtimeRunId: string; alive: boolean; pending?: string }[] };
    };
    const fieldRow = field.snapshot.rows.find((r) => r.runtimeRunId === runId);
    expect(fieldRow?.alive).toBe(false);
    expect(fieldRow?.pending).toBeUndefined();

    // closing the pane is what ends it — the row's whole reason to exist was
    // that a person could still see that terminal
    await win.call("terminal.terminate", { sessionId: paneId });
    await poll(async () => {
      const { sessions: rows } = (await win.call("agent.list", {})) as AgentListResult;
      return rows.some((r) => r.runtimeRunId === runId) ? undefined : true;
    }, 20_000);
    expect(await listed(win, paneId)).toBe(false);
  }, 200_000);

  it("a restart finds the dead pane and re-lists the row from the record alone", async () => {
    const first = await setup({ floor: "real" });
    const win1 = await window(first.daemon, [...DECK, "agent.control"], "g2a");
    const { runId, paneId } = await endedRun(first, win1);
    await first.daemon.stop();

    const second = await setup({ floor: "real", restartOf: first });
    const win = await window(second.daemon, [...DECK, "agent.control"], "g2b");
    const row = await poll(async () => {
      const { sessions } = (await win.call("agent.list", {})) as AgentListResult;
      return sessions.find((r) => r.runtimeRunId === runId);
    }, 20_000);
    expect(row.continuation).toMatchObject({ persisted: true, resumable: true, exited: true });
    expect(row.terminal).toMatchObject({ hosted: "local", runtimeSessionId: paneId });
    // NOTHING observed this run — a new fieldd never held its adapter — and
    // the row says so rather than inventing a status
    expect(row.status).toBe("unknown");
    expect(row.observationLevel).toBe("none");
    expect(row.sessionIdBasis).toBe("recorded");
    expect(row.monitor).toBeUndefined();
    expect(await listed(win, paneId)).toBe(true);
  }, 200_000);

  it("resume hands the pane over: the successor is born, the husk is reaped, one conversation keeps one row", async () => {
    const box = await setup({ floor: "real" });
    const win = await window(box.daemon, [...DECK, "agent.control"], "g3");
    const { runId, paneId } = await endedRun(box, win);

    // Before MF-1f this refused `terminal-alive`: the husk read as a running
    // session, so the verb on the exited card could not be used at all.
    const resumed = (await born(win, "agent.resume", { runtimeRunId: runId })) as AgentSpawnResult;
    const nextId = resumed.session.runtimeRunId;
    expect(nextId).not.toBe(runId);
    // AR-4's hand-over shape, which is what the deck's resume verb reads: the
    // successor's row NAMES the pane it replaces (GodviewDeck mounts the new
    // ticket into the pane the verb was pressed in)
    expect(resumed.session.terminal).toMatchObject({ hosted: "local", replaced: paneId });

    // MF-1g — and the husk goes, once the successor holds the pane
    await poll(async () => ((await listed(win, paneId)) ? undefined : true), 20_000);

    const rows = await poll(async () => {
      const { sessions } = (await win.call("agent.list", {})) as AgentListResult;
      return sessions.some((r) => r.runtimeRunId === nextId) ? sessions : undefined;
    }, 20_000);
    // ONE row for one native conversation (AR-4b): the successor, not both
    expect(rows.filter((r) => r.sessionId === resumed.session.sessionId)).toHaveLength(1);
    expect(rows.some((r) => r.runtimeRunId === runId)).toBe(false);
    // the successor is alive and its OWN pane is not the one that was reaped
    const next = rows.find((r) => r.runtimeRunId === nextId);
    expect(next?.terminal?.runtimeSessionId).not.toBe(paneId);
    expect(await listed(win, next?.terminal?.runtimeSessionId ?? "")).toBe(true);

    // the record names its successor, so a SECOND resume is refused rather
    // than making a second run on one conversation
    const record = box.records.read(runId);
    expect(record?.reattach).toMatchObject({ state: "resumed", replacedBy: nextId });
    const again = (await win.callErr("agent.resume", { runtimeRunId: runId })) as RpcErrorShape;
    expect(again.data?.kind).toBe("PRECONDITION_FAILED");
    expect((again.data?.details as { state?: string } | undefined)?.state).toBe("replaced");
  }, 200_000);
});

describe("item 72 — a run joins the inventory it was born into", () => {
  it("a run registered after the last inventory that lists its pane is joined to its cell at registration", async () => {
    let daemon: FielddDaemon | undefined;
    const box = await setup({
      floor: "real",
      // the order CI's load made, made certain: every inventory this birth causes reaches the runtime BEFORE the run
      // is registered (the spawn returns only after it), and an idle pane causes no other
      afterBirth: async (paneId) => {
        await poll(
          async (seen) => {
            const terminals = daemon?.terminals;
            const listed =
              terminals !== undefined &&
              terminals.observation() !== undefined &&
              terminals.list().some((terminal) => terminal.sessionId === paneId);
            seen({ listed });
            return listed ? true : undefined;
          },
          15_000,
          "the floor's inventory listing the new pane",
        );
        // the birth's own follow-up pushes (its program's exec) land too, still before the registration
        await new Promise((resolve) => setTimeout(resolve, 500));
      },
    });
    daemon = box.daemon;
    const win = await window(box.daemon, DECK, "i72");
    const spawned = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: box.envOut,
    })) as AgentSpawnResult;
    // read at once: no inventory came after the registration, so a join can only be the registration's own
    const { sessions } = (await win.call("agent.list", {})) as AgentListResult;
    const row = sessions.find((r) => r.runtimeRunId === spawned.session.runtimeRunId);
    expect(row?.terminal?.runtimeSessionId).toBe(spawned.terminal.sessionId);
    expect(
      row?.terminal?.cellBootId,
      "the row is joined to its cell at registration",
    ).toBeDefined();
  }, 60_000);
});

/** Item 81 — the order CI's load made (run 40530144594, attempt 1), made certain: a birth answers its caller only once
 * the floor's exit of that PTY has been fanned out to every listener and one more turn has passed. That is what
 * happens when the birth's answer and the exit of a PTY that ends at once come in one socket read. */
function exitBeforeRegistration(daemon: FielddDaemon): void {
  const heard = new Set<string>();
  const off = daemon.terminals.onSessionExited((event) => heard.add(event.sessionId));
  cleanup.push(() => {
    off();
  });
  const spawn = daemon.terminals.spawn.bind(daemon.terminals);
  vi.spyOn(daemon.terminals, "spawn").mockImplementation(async (spec) => {
    const birth = await spawn(spec);
    await poll(
      async (seen) => {
        seen({ heard: heard.has(birth.sessionId) });
        return heard.has(birth.sessionId) ? true : undefined;
      },
      15_000,
      "the floor's exit of the new PTY, fanned out before its birth answers",
    );
    // fieldd's own exit listener has had its turn: the exit was offered while nothing held the PTY
    await new Promise((resolve) => setImmediate(resolve));
    return birth;
  });
}

describe("item 81 — an exit that comes before its pane is registered", () => {
  it("a login pane that ends before it is registered still verifies its persona", async () => {
    const { daemon } = await setup({ floor: "real" });
    exitBeforeRegistration(daemon);
    const win = await window(daemon, DECK, "i81a");
    await win.call("agents.profiles.login", { profileId: "claude:native-default" });
    const verified = await poll(
      async (seen) => {
        const { personas } = (await win.call("agents.profiles.list", {
          provider: "claude",
        })) as AgentsProfilesListResult;
        const persona = personas.find((p) => p.profileId === "claude:native-default");
        seen(persona);
        return persona?.identity?.loggedIn === true ? persona : undefined;
      },
      15_000,
      "the persona's identity re-read after a login pane that ended before it was registered",
    );
    expect(verified.signingIn, "the pane is no longer signing in").toBeUndefined();
    expect(verified.identity).toMatchObject({ loggedIn: true, email: "persona@example.test" });
  }, 60_000);

  it("a run whose agent ends before it is registered is closed with the floor's own outcome", async () => {
    const box = await setup({ floor: "real", program: "exit 0" });
    exitBeforeRegistration(box.daemon);
    const win = await window(box.daemon, DECK, "i81b");
    const spawned = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: box.envOut,
    })) as AgentSpawnResult;
    const runId = spawned.session.runtimeRunId;
    const exited = await poll(
      async (seen) => {
        const stamp = box.records.read(runId)?.exited;
        seen(stamp ?? null);
        return stamp;
      },
      15_000,
      "the record of a run whose agent ended before it was registered, stamped",
    );
    expect(exited.reason, "the floor's word, never the backstop's unknown").toBe("completed");
    expect(exited.exitCode).toBe(0);
  }, 60_000);
});

describe("item 87 — a run's exit is not held by its workspace's cleanup", () => {
  /** How long the stalled git holds the cleanup: the bound of what these rows prove. An exit read
   * inside it was published before the cleanup ended, and the rows stop the git long before it
   * ends by itself. */
  const STALLED_GIT_MS = 30_000;

  /** A `git` that does not answer: puppeteer finalizes a run's workspace when its process exits, and
   * every git call there is unbounded (puppeteer-workspaces 0.3.0, `git.js`). First on the
   * in-process fieldd's PATH, it stalls that cleanup the way a loaded host can. Each call leaves its
   * pid, and the row stops them by pid. */
  function stalledGit(root: string): { dir: string; called: () => boolean; stop: () => void } {
    const dir = join(root, "stalled-git");
    const pids = join(dir, "pids");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "git"),
      `#!/bin/sh\necho $$ >> "${pids}"\nexec sleep ${STALLED_GIT_MS / 1000}\n`,
      { mode: 0o755 },
    );
    return {
      dir,
      called: () => existsSync(pids),
      stop: () => {
        if (!existsSync(pids)) return;
        for (const pid of readFileSync(pids, "utf8").split("\n")) {
          if (!/^\d+$/.test(pid)) continue;
          try {
            process.kill(Number(pid), "SIGKILL");
          } catch {
            /* already gone */
          }
        }
      },
    };
  }

  /** The events this row's own fieldd logged, in order. */
  const fielddEvents = (box: Box): Array<{ event: string; attrs: Record<string, unknown> }> => {
    const file = join(box.dataDir, "logs", "system", "fieldd.ndjson");
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as { event: string; attrs?: Record<string, unknown> })
      .map((record) => ({ event: record.event, attrs: record.attrs ?? {} }));
  };

  // *Witnessed 2026-10-29:* in a loaded verify the row's own `endedRun` interrupted a run, and the
  // log stopped at `fieldd.agents.interrupted`: no exit for 15 s. Quiet, 60 runs of the same steps
  // all exited, the exit heard 5–27 ms after the interrupt and the row reading it 112–194 ms after.
  // The gap between the two is the run's close awaiting puppeteer's cleanup, whose git calls go
  // through the xcrun shim at 12 ms each. This row stalls that cleanup on purpose.
  it("a run whose workspace cleanup stalls still reads exited, and says the exit was heard and the cleanup is pending", async () => {
    const box = await setup({ floor: "real" });
    const win = await window(box.daemon, [...DECK, "agent.control"], "i87");
    const spawned = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: box.envOut,
      title: "a stalled cleanup",
    })) as AgentSpawnResult;
    const runId = spawned.session.runtimeRunId;
    await joinedRow(win, runId);
    // item 118 — the ⌃C below must meet `cat`, never the shell's prologue
    await catReady(box, spawned.terminal.sessionId);
    // only now: the launch's own git calls (the workspace's baseline) are behind it
    const git = stalledGit(box.root);
    const path = process.env["PATH"];
    process.env["PATH"] = `${git.dir}:${path ?? ""}`;
    try {
      expect(await win.call("agent.interrupt", { runtimeRunId: runId })).toEqual({
        accepted: true,
      });
      const row = await poll(
        async (seen) => {
          const { sessions } = (await win.call("agent.list", {})) as AgentListResult;
          const found = sessions.find((r) => r.runtimeRunId === runId);
          seen({ continuation: found?.continuation ?? null, gitCalled: git.called() });
          return found?.continuation?.exited === true ? found : undefined;
        },
        // item 101 — the heard exit's own budget, as AR-6-0's: the cleanup's stall is STALLED_GIT_MS
        INTERRUPTED_EXIT_MS,
        "the exited row of a run whose workspace cleanup is stalled",
        exitWitness(box, spawned.terminal.sessionId),
      );
      // exited at once, and not yet resumable: the cleanup still holds the old run's workspace
      expect(row.continuation).toMatchObject({ persisted: true, exited: true, resumable: false });
      // the row no longer waits for the cleanup, so its git is reached after the exit is published
      await poll(
        async (seen) => {
          seen({ gitCalled: git.called() });
          return git.called() ? true : undefined;
        },
        2_000,
        "the run's exit cleanup reaching the stalled git",
      );
      const { sessions: held } = (await win.call("agent.list", {})) as AgentListResult;
      expect(
        held.find((r) => r.runtimeRunId === runId)?.continuation,
        "the stalled cleanup holds the resume verb, not the exit",
      ).toMatchObject({ persisted: true, exited: true, resumable: false });
      const heard = await poll(
        async (seen) => {
          seen(
            fielddEvents(box)
              .map((e) => e.event)
              .filter((e) => e.startsWith("fieldd.agents.")),
          );
          return fielddEvents(box).find(
            (e) => e.event === "fieldd.agents.exit_heard" && e.attrs["runtimeRunId"] === runId,
          );
        },
        2_000,
        "the exit as heard, in the row's own log",
      );
      expect(heard.attrs, "the exit as heard, before the cleanup").toMatchObject({
        sessionId: spawned.terminal.sessionId,
        held: true,
      });
      const pending = await poll(
        async (seen) => {
          seen(
            fielddEvents(box)
              .map((e) => e.event)
              .filter((e) => e.startsWith("fieldd.agents.")),
          );
          return fielddEvents(box).find(
            (e) =>
              e.event === "fieldd.agents.exit_cleanup_slow" && e.attrs["runtimeRunId"] === runId,
          );
        },
        AGENT_EXIT.CLEANUP_WARN_MS + 3_000,
        "the warning that the run's exit cleanup is still pending",
      );
      expect(pending.attrs["pendingMs"]).toBeGreaterThanOrEqual(AGENT_EXIT.CLEANUP_WARN_MS);
    } finally {
      process.env["PATH"] = path;
      git.stop();
    }
  }, 60_000);

  it("a resume while the cleanup is pending waits for it, is refused retryably as finalizing past the bound, and goes through once the cleanup ends", async () => {
    const box = await setup({ floor: "real" });
    const win = await window(box.daemon, [...DECK, "agent.control"], "i87r");
    const spawned = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: box.envOut,
      title: "a stalled cleanup",
    })) as AgentSpawnResult;
    const runId = spawned.session.runtimeRunId;
    await joinedRow(win, runId);
    // item 118 — the ⌃C below must meet `cat`, never the shell's prologue
    await catReady(box, spawned.terminal.sessionId);
    const git = stalledGit(box.root);
    const path = process.env["PATH"];
    process.env["PATH"] = `${git.dir}:${path ?? ""}`;
    try {
      expect(await win.call("agent.interrupt", { runtimeRunId: runId })).toEqual({
        accepted: true,
      });
      await poll(
        async (seen) => {
          const { sessions } = (await win.call("agent.list", {})) as AgentListResult;
          const found = sessions.find((r) => r.runtimeRunId === runId);
          seen(found?.continuation ?? null);
          return found?.continuation?.exited === true ? found : undefined;
        },
        // item 101 — the heard exit's own budget, as AR-6-0's: the cleanup's stall is STALLED_GIT_MS
        INTERRUPTED_EXIT_MS,
        "the exited row of a run whose workspace cleanup is stalled",
        exitWitness(box, spawned.terminal.sessionId),
      );
      const askedAt = Date.now();
      const refused = await win.callErr("agent.resume", { runtimeRunId: runId });
      const waited = Date.now() - askedAt;
      expect(refused.data?.retryable, "a cleanup that ends is worth asking again").toBe(true);
      expect(refused.data?.details).toMatchObject({ runtimeRunId: runId, state: "finalizing" });
      expect(waited, "the resume waited for the cleanup first").toBeGreaterThanOrEqual(
        AGENT_EXIT.RESUME_CLEANUP_WAIT_MS - 100,
      );
      expect(git.called(), "the cleanup the resume waited for is the stalled git").toBe(true);
    } finally {
      process.env["PATH"] = path;
      git.stop();
    }
    // the stall ends: the cleanup settles, the row reads resumable, and the resume goes through
    await poll(
      async (seen) => {
        const { sessions } = (await win.call("agent.list", {})) as AgentListResult;
        const found = sessions.find((r) => r.runtimeRunId === runId);
        seen(found?.continuation ?? null);
        return found?.continuation?.resumable === true ? found : undefined;
      },
      5_000,
      "the exited row reading resumable once its cleanup ended",
    );
    const resumed = (await born(win, "agent.resume", { runtimeRunId: runId })) as AgentSpawnResult;
    expect(resumed.session.runtimeRunId).not.toBe(runId);
    expect(resumed.session.sessionId).toBe(spawned.session.sessionId);
  }, 60_000);
});

describe("AR-6-0 — the stop verb (agent.interrupt)", () => {
  it("interrupts a live run through the floor, is refused for an exited or unknown one, needs agent.control, and lands in the ledger", async () => {
    const box = await setup({ floor: "real" });
    const { daemon, dataDir, envOut } = box;
    // the deck's own scopes do NOT include agent.control — the fold's reader
    // is not, by that fact, allowed to steer what it is watching
    const watcher = await window(daemon, DECK, "i0");
    const win = await window(daemon, [...DECK, "agent.control"], "i1");

    const spawned = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: envOut,
    })) as AgentSpawnResult;
    const runId = spawned.session.runtimeRunId;

    expect((await watcher.callErr("agent.interrupt", { runtimeRunId: runId })).data?.kind).toBe(
      "FORBIDDEN_SCOPE",
    );
    // a run nobody ever minted is NOT_FOUND, never a silent no-op
    expect((await win.callErr("agent.interrupt", { runtimeRunId: "run-none" })).data?.kind).toBe(
      "NOT_FOUND",
    );
    expect((await win.callErr("agent.interrupt", {})).data?.kind).toBe("PRECONDITION_FAILED");

    // Wait for the floor's inventory to TAG the session with its cell before
    // steering it. This is not politeness: every automate resolves the session's
    // cell first, and an untagged session sends the operation to the wrong one,
    // where the floor answers "unknown or remote session" and TerminalService
    // raises INTERNAL (terminal-service.ts:645-660 — the pre-existing shape for
    // paste and text too, not something this door introduced).
    const tagged = await poll(async () => {
      const { sessions: rows } = (await win.call("agent.list", {})) as AgentListResult;
      const row = rows.find((r) => r.runtimeRunId === runId);
      return row?.terminal?.cellBootId !== undefined ? row : undefined;
    }, 10_000);
    // Q08 — this adapter names no turn stop, so the verb is still the floor's
    // ⌃C, and the row says that key rather than none
    expect(tagged.stopKey).toBe("ctrl-c");
    // item 118 — and the pane's process is `cat` by now: a ⌃C into the shell's prologue is swallowed
    await catReady(box, spawned.terminal.sessionId);

    // ── the act: the floor takes it, and the scripted PTY's `cat` dies of it ──
    // `accepted` is the FLOOR's word — that the interrupt reached the PTY's
    // process group, not that any agent obeyed it. The witness that it really
    // reached a process is the exit below.
    expect(await win.call("agent.interrupt", { runtimeRunId: runId })).toEqual({ accepted: true });

    // MF-1g — the row does not leave: the agent is over, its PANE is not, and
    // the card keeps the resume verb over its final screen.
    await poll(
      async () => {
        const { sessions: rows } = (await win.call("agent.list", {})) as AgentListResult;
        const row = rows.find((r) => r.runtimeRunId === runId);
        return row?.continuation?.exited === true ? row : undefined;
      },
      INTERRUPTED_EXIT_MS,
      "the interrupted run read as exited",
      exitWitness(box, spawned.terminal.sessionId),
    );
    const exited = await poll(async () => {
      const record = readRecord(dataDir, runId);
      return record.exited !== undefined ? record : undefined;
    }, 10_000);
    expect(exited.exited?.reason).toBeTruthy();

    // ── the same run, now gone: not-alive, with the state a caller can read ──
    const refused = (await win.callErr("agent.interrupt", {
      runtimeRunId: runId,
    })) as RpcErrorShape;
    expect(refused.data?.kind).toBe("PRECONDITION_FAILED");
    expect((refused.data?.details as { state?: string } | undefined)?.state).toBe("not-alive");

    // and closing the pane is what finally withdraws the row (MF-1g: the
    // explicit reap where the old persistence class had an implicit one)
    await win.call("terminal.terminate", { sessionId: spawned.terminal.sessionId });
    await poll(async () => {
      const { sessions: rows } = (await win.call("agent.list", {})) as AgentListResult;
      return rows.some((r) => r.runtimeRunId === runId) ? undefined : true;
    }, 15_000);

    // ── the ledger: this device's own act, on the run, with its outcome ──
    // (the attempt is written BEFORE the effect, so the refusals above are in
    // the ledger too — the act is matched by its target, not by being first)
    const act = await auditAct(
      dataDir,
      (entry) => entry.action === "agent.session.interrupt" && entry.target.id === runId,
    );
    expect(act.attempt.target).toMatchObject({ kind: "agent-session", id: runId });
    expect(act.attempt.actor.kind).toBe("local-token");
    expect(act.outcome.outcome).toBe("succeeded");
    expect(act.outcome.attrs?.["accepted"]).toBe(true);
    // an interrupt aimed at a run that does not exist is ledgered as an
    // ATTEMPT that failed — a reach for someone else's session leaves a trace
    const missed = await auditAct(
      dataDir,
      (entry) => entry.action === "agent.session.interrupt" && entry.target.id === "run-none",
    );
    expect(missed.outcome.outcome).toBe("failed");
    expect(missed.outcome.reasonCode).toBe("NOT_FOUND");
    // (a real floor, two spawns' worth of ladders and an explicit reap: this
    // row outgrew the 5 s default the day MF-1g gave it a pane to close)
  }, 120_000);

  it("Q08 — sends the run's own turn stop, as its adapter names it, never the floor's ⌃C; the row names the key", async () => {
    const { daemon, dataDir, envOut, sessions, turnStops } = await setup({
      floor: "real",
      turnStop: true,
    });
    const win = await window(daemon, [...DECK, "agent.control"], "q8");
    const spawned = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: envOut,
    })) as AgentSpawnResult;
    const runId = spawned.session.runtimeRunId;
    // the cell's tag first, as above: the stop's key rides the same automate
    const tagged = await poll(async () => {
      const { sessions: rows } = (await win.call("agent.list", {})) as AgentListResult;
      const row = rows.find((r) => r.runtimeRunId === runId);
      return row?.terminal?.cellBootId !== undefined ? row : undefined;
    }, 10_000);
    // the adapter's word, repeated: fieldd names no agent and picks no key
    expect(tagged.stopKey).toBe("escape");

    // ── the act: the adapter's stop, once, on the run's own PTY ──
    expect(await win.call("agent.interrupt", { runtimeRunId: runId })).toEqual({ accepted: true });
    expect(turnStops).toEqual([spawned.terminal.sessionId]);
    const typedOut = sessions[0]?.typedOut;
    if (typedOut === undefined) throw new Error("the scripted run was not born");
    const typed = (marker: string) =>
      poll(async () => {
        if (!existsSync(typedOut)) return undefined;
        const text = readFileSync(typedOut, "utf8");
        return text.includes(marker) ? text : undefined;
      }, 10_000);
    // it went through the floor's epoch path to the process ...
    expect(await typed(SCRIPTED_TURN_STOP_TEXT.trim())).toContain(SCRIPTED_TURN_STOP_TEXT.trim());
    // ... and no ⌃C went with it: the `cat` a ⌃C kills still takes a prompt
    const agent = daemon.agents.runtime.agent(spawned.terminal.sessionId);
    expect((await agent?.submitPrompt({ text: "still-running" }))?.status).toBe("confirmed");
    expect(await typed("still-running")).toContain("still-running");
    const { sessions: rows } = (await win.call("agent.list", {})) as AgentListResult;
    expect(rows.find((r) => r.runtimeRunId === runId)?.continuation?.exited).not.toBe(true);

    // ── the ledger: the same act, the same outcome ──
    const act = await auditAct(
      dataDir,
      (entry) => entry.action === "agent.session.interrupt" && entry.target.id === runId,
    );
    expect(act.outcome.outcome).toBe("succeeded");
    expect(act.outcome.attrs?.["accepted"]).toBe(true);
  }, 120_000);
});

// Item 97 — an exit fieldd never heard. AR-6-0 reddened three times after item 87 with its run never
// reading exited and no `fieldd.agents.exit_heard` in the log. The floor's `session-exited` is the one
// word of an exit fieldd hears, and MF-1g keeps an agent's pane, so the husk stays listed and the old
// backstop (a row that LEAVES the inventory) never fired. The floor now lists the husk `exited`, and the
// backstop reads that as an exit after its grace. This row drops the exit at fieldd's own door, for one
// pane, on the real floor: the Rust half (the floor's row) and fieldd's half (the backstop) end to end.
describe("item 97 — an exit fieldd never heard (the real floor)", () => {
  it("a run whose session-exited is lost still reads exited: the floor lists its kept pane exited, and the backstop closes the run after its grace", async () => {
    const box = await setup({ floor: "real" });
    const { daemon, dataDir, envOut } = box;
    const win = await window(daemon, [...DECK, "agent.control"], "i97");
    const spawned = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: envOut,
    })) as AgentSpawnResult;
    const runId = spawned.session.runtimeRunId;
    const paneId = spawned.terminal.sessionId;
    await joinedRow(win, runId);
    // item 118 — the ⌃C below must meet `cat`, never the shell's prologue
    await catReady(box, paneId);

    // fieldd deaf at its own door, for this pane alone: daemon.ts hands each `session-exited` to the
    // runtime by this property, so the floor's exit is dropped where fieldd would have heard it
    const heard = daemon.agents.handleTerminalExit.bind(daemon.agents);
    vi.spyOn(daemon.agents, "handleTerminalExit").mockImplementation(async (event) => {
      if (event.sessionId !== paneId) await heard(event);
    });

    expect(await win.call("agent.interrupt", { runtimeRunId: runId })).toEqual({ accepted: true });
    await poll(
      async () => {
        const { sessions } = (await win.call("agent.list", {})) as AgentListResult;
        const row = sessions.find((r) => r.runtimeRunId === runId);
        return row?.continuation?.exited === true ? row : undefined;
      },
      LOST_EXIT_MS,
      "the run whose exit was lost read as exited",
      exitWitness(box, paneId),
    );
    // the backstop's word, never the floor's outcome: nothing carried the exit but the row
    const record = await poll(async () => {
      const read = readRecord(dataDir, runId);
      return read.exited !== undefined ? read : undefined;
    }, 10_000);
    expect(record.exited).toMatchObject({ exitCode: null, signal: null, reason: "unknown" });
    // the pane is kept, and the floor's own row for it says the process ended
    expect(daemon.terminals.get(paneId)?.exited).toBe(true);
    expect(await listed(win, paneId)).toBe(true);
  }, 120_000);
});

// S1 (the landing review, 2026-10-01) — the ticket is minted AFTER the birth,
// so a mint that fails (`doorsFor`'s `doors_not_published` for a caller this
// desktop does not publish its doors to, a keyless or vanished cell) used to
// answer a FAILED spawn while the agent ran. The fault is placed at the seam the
// owner mints through (the same TerminalService the runtime holds): a real
// birth on the real floor, then a mint that refuses.
describe("S1 — a run born whose ticket cannot be minted", () => {
  it("answers the run it birthed — named, listed, never retryable — and its session mints once the doors answer", async () => {
    const { daemon, envOut } = await setup({ floor: "real" });
    const win = await window(daemon, DECK, "s1");
    const mint = vi.spyOn(daemon.terminals, "createOpenResult").mockImplementation(() => {
      throw new RpcCallError(
        "UNAVAILABLE",
        "this device is not publishing its terminal doors on the tailnet",
        true,
        { service: "terminal", state: "doors_not_published" },
      );
    });
    cleanup.push(() => mint.mockRestore());

    const refused = await win.callErr("agent.spawn", { provider: "scripted", cwd: envOut });
    expect(mint).toHaveBeenCalledTimes(1); // the birth happened; its mint refused
    expect(refused.data?.kind).toBe("UNAVAILABLE");
    // the agent is running: a retried spawn would birth a second one
    expect(refused.data?.retryable).toBe(false);
    const details = refused.data?.details as {
      service: string;
      state: string;
      runtimeRunId: string;
      session: { runtimeRunId: string; tier: string; kind: string; terminal?: unknown };
      reason: unknown;
    };
    // the honest state the reader's face already knows, plus the run
    expect(details.service).toBe("terminal");
    expect(details.state).toBe("doors_not_published");
    expect(details.reason).toEqual({ kind: "UNAVAILABLE", state: "doors_not_published" });
    expect(details.session).toMatchObject({
      runtimeRunId: details.runtimeRunId,
      tier: "managed",
      kind: "scripted",
    });
    expect(refused.message).toContain(`born (${details.runtimeRunId})`);

    // The run is real: the fold lists it, and once its session is tagged with
    // its cell, a ticket for it mints like any other when the doors answer.
    mint.mockRestore();
    const row = await poll(async () => {
      const { sessions } = (await win.call("agent.list", {})) as AgentListResult;
      const listed = sessions.find((s) => s.runtimeRunId === details.runtimeRunId);
      return listed?.terminal?.cellBootId !== undefined ? listed : undefined;
    }, 10_000);
    const sessionId = (row.terminal as { runtimeSessionId: string }).runtimeSessionId;
    const ticket = (await win.call("terminal.openTicket", { sessionId })) as {
      endpoints: { controlUrl: string };
      attachGrant: unknown;
    };
    expect(ticket.endpoints.controlUrl).toMatch(/^ws:/);
    expect(ticket).toHaveProperty("attachGrant");
  }, 60_000);
});

describe("stable ingress — a managed session outlives fieldd (AR-4)", () => {
  it("re-attach across a restart: a graceful stop RELEASES the run (no exit, the PTY alive); the next boot attaches it at the next epoch, the same PTY, automation working; the attached run still refuses a resume; its exit is the ordinary one", async () => {
    const first = await setup({ floor: "real", attach: true });
    const win1 = await window(first.daemon, DECK, "ra1");
    const spawned = (await born(win1, "agent.spawn", {
      provider: "scripted",
      cwd: first.envOut,
      title: "survivor",
    })) as AgentSpawnResult;
    const runId = spawned.session.runtimeRunId;
    const ptyId = spawned.terminal.sessionId;
    const nativeId = spawned.session.sessionId;
    // the durable identity the next boot restores against, and puppeteer's
    // claim registry under this user's agents/ tree
    const record = readRecord(first.dataDir, runId);
    expect(record.creationRequestId).toBeTruthy();
    expect(record.runtimeEpoch).toBe(1);
    expect(record.reattach).toBeUndefined();
    // the pair the adapter bound before its process launched, persisted
    expect(record.ingress).toEqual(first.sessions[0]?.ingress);
    expect(record.ingress?.port).toBe(40_001);
    expect(mode(join(first.dataDir, ...LAYOUT.AGENT_RUNS_DIR))).toBe(0o700);
    expect(existsSync(join(first.dataDir, ...LAYOUT.AGENT_RUNS_DIR, "claims"))).toBe(true);
    await joinedRow(win1, runId);

    // ── the restart: the stop releases; nothing is stamped, the PTY lives ──
    await first.daemon.stop();
    expect(readRecord(first.dataDir, runId).exited).toBeUndefined();
    const second = await setup({ floor: "real", attach: true, restartOf: first });
    const win2 = await window(second.daemon, DECK, "ra2");
    expect(await listed(win2, ptyId)).toBe(true);
    const row = await poll(async () => {
      const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
      const found = sessions.find((r) => r.runtimeRunId === runId);
      return found?.continuation?.reattached === true ? found : undefined;
    }, 20_000);
    expect(row.runtimeEpoch).toBe(2);
    expect(row.sessionId).toBe(nativeId);
    expect(row.title).toBe("survivor");
    expect(row.terminal).toMatchObject({ hosted: "local", runtimeSessionId: ptyId });
    expect(row.continuation).toEqual({ persisted: true, resumable: false, reattached: true });
    expect(row.status).not.toBe(undefined);
    // the adapter was handed exactly the terminal, the native session — and
    // the ingress its process is still posting to, which is the whole point of
    // pinning one: a re-bound listener picks the stream up where it left off
    expect(first.attached).toHaveLength(1);
    expect(first.attached[0]).toMatchObject({ runtimeSessionId: ptyId, sessionId: nativeId });
    expect(first.attached[0]?.ingress).toEqual(record.ingress);
    expect(first.attached[0]?.ingress).toEqual({ port: 40_001, token: "bearer-1" });
    // the record: the new epoch, what the boot did, the ingress unchanged
    const after = readRecord(first.dataDir, runId);
    expect(after.runtimeEpoch).toBe(2);
    expect(after.reattach).toMatchObject({ state: "attached" });
    expect(after.exited).toBeUndefined();
    expect(after.ingress).toEqual(record.ingress);
    // the daemon's own act, read as records: the system actor, the epoch it
    // found on the attempt and the epoch it reached on the outcome
    const reattachAct = await auditAct(
      first.dataDir,
      (entry) => entry.action === "agent.session.reattach" && entry.target.id === runId,
    );
    expect(reattachAct.attempt.actor.kind).toBe("system");
    expect(reattachAct.attempt.target.kind).toBe("agent-session");
    expect(reattachAct.attempt.attrs).toMatchObject({
      provider: "scripted",
      sessionId: ptyId,
      runtimeEpoch: 1,
    });
    expect(reattachAct.outcome.actor.kind).toBe("system");
    expect(reattachAct.outcome.outcome).toBe("succeeded");
    expect(reattachAct.outcome.attrs?.["runtimeEpoch"]).toBe(2);
    // automation through the re-attached run: the floor's epoch path, again
    const agent = second.daemon.agents.runtime.agent(ptyId);
    expect(agent).toBeDefined();
    expect((await agent!.submitPrompt({ text: "still-here" })).status).toBe("confirmed");
    // …and the bytes reach the process the FIRST fieldd started: the surviving
    // `cat` appends them to the file it opened at its own birth, which nothing
    // since has re-created. Accepted-by-the-floor would be true of a PTY that
    // had been replaced underneath us; this is not.
    const typed = await poll(async () => {
      const path = first.sessions[0]?.typedOut;
      if (path === undefined || !existsSync(path)) return undefined;
      const text = readFileSync(path, "utf8");
      return text.includes("still-here") ? text : undefined;
    }, 10_000);
    expect(typed).toContain("still-here");
    // attached and alive: a resume is refused, as before
    const refused = await win2.callErr("agent.resume", { runtimeRunId: runId });
    expect(refused.data?.kind).toBe("PRECONDITION_FAILED");
    expect(JSON.stringify(refused)).toContain("terminal-alive");

    // ── the exit, on the second daemon: the ordinary path ──
    await win2.call("terminal.terminate", { sessionId: ptyId });
    await poll(async () => {
      const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
      return sessions.some((r) => r.runtimeRunId === runId) ? undefined : true;
    }, 15_000);
    expect(readRecord(first.dataDir, runId).exited).toBeDefined();
    // MV-6 (MV-D13): a run that worked, re-attached across a restart and exited
    // left no record of what it did — the session record is the resume's, and
    // the status ledger's directory is never made
    expect(existsSync(join(first.dataDir, "agents", "history"))).toBe(false);
  }, 150_000);

  it("the re-attach study's Step 1 — an attach is handed what the launch knew: the codec's launch options come back, the record keeps its state, and the attach record an attach reports reaches the next restart", async () => {
    const first = await setup({ floor: "real", attach: true, facts: true });
    const win1 = await window(first.daemon, DECK, "rf1");
    const spawned = (await born(win1, "agent.spawn", {
      provider: "scripted",
      cwd: first.envOut,
      title: "facts",
    })) as AgentSpawnResult;
    const runId = spawned.session.runtimeRunId;
    const ptyId = spawned.terminal.sessionId;
    // what the launch knew, persisted: the codec's state and the attach record
    // the adapter reported before its process launched
    const record = readRecord(first.dataDir, runId);
    expect(record.continuation.state).toBe(SCRIPTED_STATE);
    expect(record.attach).toEqual({ version: 1, state: "endpoint-1", secret: "nonce-1" });
    expect(mode(join(first.dataDir, ...LAYOUT.AGENT_SESSIONS_DIR, `${runId}.json`))).toBe(0o600);
    await joinedRow(win1, runId);
    const reattachedAt = async (win: WsRpc, epoch: number) =>
      await poll(async () => {
        const { sessions } = (await win.call("agent.list", {})) as AgentListResult;
        const found = sessions.find((r) => r.runtimeRunId === runId);
        return found?.continuation?.reattached === true && found.runtimeEpoch === epoch
          ? found
          : undefined;
      }, 20_000);

    // ── the first restart: the adapter is handed the launch's facts ──
    await first.daemon.stop();
    const second = await setup({ floor: "real", attach: true, facts: true, restartOf: first });
    const win2 = await window(second.daemon, DECK, "rf2");
    await reattachedAt(win2, 2);
    expect(first.attached).toHaveLength(1);
    expect(first.attached[0]).toMatchObject({
      runtimeSessionId: ptyId,
      // puppeteer's codec restored them from the continuation fieldd handed back
      agentOptions: { root: "scripted-root" },
      attachRecord: { version: 1, state: "endpoint-1", secret: "nonce-1" },
    });
    const after = readRecord(first.dataDir, runId);
    // one attach no longer drops what a later resume needs
    expect(after.continuation).toMatchObject({ state: SCRIPTED_STATE, implementation: "native" });
    expect(after.reattach).toMatchObject({ state: "attached" });
    // the record the attach reported is the one kept (the boot's copy did not
    // write over it)
    expect(after.attach).toEqual({
      version: 1,
      state: "endpoint-1-attached",
      secret: "nonce-attached",
    });

    // ── the second restart reads the fresh facts, not the launch's ──
    await second.daemon.stop();
    const third = await setup({ floor: "real", attach: true, facts: true, restartOf: first });
    const win3 = await window(third.daemon, DECK, "rf3");
    await reattachedAt(win3, 3);
    expect(first.attached).toHaveLength(2);
    expect(first.attached[1]?.attachRecord).toEqual({
      version: 1,
      state: "endpoint-1-attached",
      secret: "nonce-attached",
    });
    expect(readRecord(first.dataDir, runId).continuation.state).toBe(SCRIPTED_STATE);
  }, 180_000);

  it("G5 — an attach the adapter calls transient is asked again: the row is held meanwhile, nothing replaces it, and the retry takes the run back on the same PTY", async () => {
    const first = await setup({ floor: "real", attach: true });
    const win1 = await window(first.daemon, DECK, "rt1");
    const spawned = (await born(win1, "agent.spawn", {
      provider: "scripted",
      cwd: first.envOut,
      title: "transient",
    })) as AgentSpawnResult;
    const runId = spawned.session.runtimeRunId;
    const ptyId = spawned.terminal.sessionId;
    const nativeId = spawned.session.sessionId;
    await joinedRow(win1, runId);
    await first.daemon.stop();
    // the index says the conversation has been still for a minute, and
    // resume-when-idle runs at its quickest: were it armed while the retry
    // waits (1 s), it would replace the PTY before the retry could attach
    writeFileSync(first.sessionsFile, JSON.stringify([rosettaRow(nativeId, 60_000)]));
    const second = await setup({
      floor: "real",
      attach: true,
      restartOf: first,
      attachRefusals: ["retry"],
      resumeWhenIdle: { afterMs: 1, pollMs: 50 },
    });
    const win2 = await window(second.daemon, DECK, "rt2");
    const row = await poll(async () => {
      const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
      const found = sessions.find((r) => r.runtimeRunId === runId);
      return found?.continuation?.reattached === true ? found : undefined;
    }, 20_000);
    // the same PTY, the next epoch: the retry attached, nothing replaced it
    expect(row.runtimeEpoch).toBe(2);
    expect(row.terminal).toMatchObject({ runtimeSessionId: ptyId });
    expect(first.attached).toHaveLength(2);
    expect(first.attached.map((a) => a.runtimeSessionId)).toEqual([ptyId, ptyId]);
    expect(first.sessions).toHaveLength(1);
    // the ledger: the refused attempt with the adapter's word, then the retry
    const outcomes = await poll(async () => {
      const found = auditEntries(first.dataDir).filter(
        (entry) =>
          entry.action === "agent.session.reattach" &&
          entry.target.id === runId &&
          entry.phase === "outcome",
      );
      return found.length === 2 ? found : undefined;
    }, 10_000);
    expect(outcomes.map((entry) => entry.outcome)).toEqual(["failed", "succeeded"]);
    expect(outcomes[0]?.attrs).toMatchObject({ state: "failed", next: "retry" });
    expect(readRecord(first.dataDir, runId).reattach).toMatchObject({ state: "attached" });
  }, 150_000);

  it("a provider that cannot attach: the run is held PENDING across the restart (live, unobserved, resumable), and agent.resume replaces its PTY by hand — the new row names the PTY it replaced", async () => {
    const first = await setup({ floor: "real" });
    const win1 = await window(first.daemon, DECK, "pe1");
    const spawned = (await born(win1, "agent.spawn", {
      provider: "scripted",
      cwd: first.envOut,
      title: "held",
    })) as AgentSpawnResult;
    const runId = spawned.session.runtimeRunId;
    const ptyId = spawned.terminal.sessionId;
    const nativeId = spawned.session.sessionId;
    await joinedRow(win1, runId);
    await first.daemon.stop();
    const spark = keepLegacySpark(first, runId);

    const second = await setup({ floor: "real", restartOf: first, briefing: SPARK_BRIEFING });
    const win2 = await window(second.daemon, DECK, "pe2");
    const pending = await poll(async () => {
      const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
      const found = sessions.find((r) => r.runtimeRunId === runId);
      return found?.continuation?.pending !== undefined ? found : undefined;
    }, 20_000);
    expect(pending).toMatchObject({
      status: "unknown",
      observationLevel: "none",
      sessionIdBasis: "recorded",
      sessionId: nativeId,
      title: "held",
    });
    expect(pending.terminal).toMatchObject({ hosted: "local", runtimeSessionId: ptyId });
    expect(pending.continuation).toMatchObject({
      persisted: true,
      resumable: true,
      pending: "resume-when-idle",
    });
    expect(pending.continuation?.reason).toContain("cannot attach");
    expect(pending.monitor).toBeUndefined();
    expect(readRecord(first.dataDir, runId).reattach).toMatchObject({ state: "unsupported" });
    // the boot's own act, as records: it tried, and the adapter's "I cannot"
    // is the outcome's CODE (a daemon act's reasonCode is a code, not prose)
    const held = await auditAct(
      first.dataDir,
      (entry) => entry.action === "agent.session.reattach" && entry.target.id === runId,
    );
    expect(held.attempt.actor.kind).toBe("system");
    expect(held.attempt.attrs).toMatchObject({ provider: "scripted", sessionId: ptyId });
    expect(held.outcome.outcome).toBe("failed");
    expect(held.outcome.reasonCode).toBe("ATTACH_UNSUPPORTED");
    expect(held.outcome.attrs).toMatchObject({ state: "unsupported" });
    // the PTY is alive, listed by the floor, and nothing observes it
    expect(await listed(win2, ptyId)).toBe(true);
    expect(second.daemon.agents.runtime.agent(ptyId)).toBeUndefined();

    // AR-6-0 — and it CANNOT be interrupted. The PTY is alive and fieldd even
    // knows its id from the record, which is exactly why the refusal matters:
    // nothing observes this run, so typing into its terminal would be steering
    // blind. `not-alive` is the honest state for a row nothing is driving.
    const stopper = await window(second.daemon, [...DECK, "agent.control"], "pe-stop");
    const blind = (await stopper.callErr("agent.interrupt", {
      runtimeRunId: runId,
    })) as RpcErrorShape;
    expect(blind.data?.kind).toBe("PRECONDITION_FAILED");
    expect((blind.data?.details as { state?: string } | undefined)?.state).toBe("not-alive");
    expect(await listed(win2, ptyId)).toBe(true); // and the PTY is untouched

    // CP-1d: preparation must finish before the pending process is terminated.
    rmSync(join(spark.folder, "CLAUDE.md"));
    await expect(
      second.daemon.agents.resume({ runtimeRunId: runId }, { kind: "local-token" }),
    ).rejects.toMatchObject({ details: { reason: "spark-brief-unavailable" } });
    expect(await listed(win2, ptyId)).toBe(true);
    expect(first.sessions).toHaveLength(1);
    writeFileSync(join(spark.folder, "CLAUDE.md"), "Ready for the pending replacement.");

    // ── the replacement by hand ──
    // A second window watches the floor's listing for the whole of the resume:
    // the claim ("the old PTY leaves FIRST, and is gone before the new run is
    // born") is an ORDER, and an end state cannot tell it from the reverse.
    const watcher = await window(second.daemon, DECK, "pe3");
    const gone = watchForGone(watcher, ptyId);
    const resumed = (await born(win2, "agent.resume", { runtimeRunId: runId })) as AgentSpawnResult;
    const goneAt = await gone.stop();
    const bornAt = first.sessions[1]?.bornAt ?? Number.NEGATIVE_INFINITY;
    expect(goneAt, "the watcher never saw the old PTY leave the listing").toBeDefined();
    expect(
      (goneAt ?? Number.POSITIVE_INFINITY) < bornAt,
      `the old PTY was still listed when the new run was born (gone at ${goneAt}, born at ${bornAt})`,
    ).toBe(true);
    expect(resumed.session.runtimeRunId).not.toBe(runId);
    expect(resumed.session.sessionId).toBe(nativeId);
    expect(resumed.session.title).toBe("held");
    expect(resumed.terminal.sessionId).not.toBe(ptyId);
    expect(resumed.session.terminal).toMatchObject({
      hosted: "local",
      runtimeSessionId: resumed.terminal.sessionId,
      replaced: ptyId,
    });
    expect(resumed.session.continuation).toEqual({ persisted: true, resumable: false });
    expect(first.sessions).toHaveLength(2);
    expect(first.sessions[1]?.resume).toBe(nativeId);
    expect(first.sessions[1]?.briefing.instructions).toBe("Ready for the pending replacement.");
    expect(readRecord(first.dataDir, resumed.session.runtimeRunId).spark).toBe(spark.id);
    // the old PTY is gone before the new run was born; the records say what happened
    await untilListed(win2, ptyId, false);
    const old = readRecord(first.dataDir, runId);
    expect(old.exited?.reason).toBe("replaced");
    // the two records name each other: the old one the PTY it gave up and the
    // run that took its place, the new one the PTY it replaced
    expect(old.reattach).toMatchObject({
      state: "resumed",
      replaced: ptyId,
      replacedBy: resumed.session.runtimeRunId,
    });
    const fresh = readRecord(first.dataDir, resumed.session.runtimeRunId);
    expect(fresh.replaced).toBe(ptyId);
    expect(fresh.exited).toBeUndefined();
    expect(fresh.creationRequestId).toBeTruthy();
    // the fold: one row, the new run
    const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
    expect(sessions.map((r) => r.runtimeRunId)).toEqual([resumed.session.runtimeRunId]);
    // The ledger holds ONE act for a resume a person asked for: the door's,
    // under the window's own token — and it is the entry that says a live PTY
    // was ENDED for it (`how: manual`, the PTY it replaced). The daemon writes
    // no second, system-actor copy: that one is reserved for the resume it
    // decides on by itself, and two entries for one act is a double ledger,
    // not corroboration.
    const byDoor = await auditAct(
      first.dataDir,
      (entry) => entry.action === "agent.session.resume" && entry.target.id === runId,
    );
    expect(byDoor.attempt.actor.kind).toBe("local-token");
    expect(byDoor.outcome.outcome).toBe("succeeded");
    expect(byDoor.outcome.attrs).toMatchObject({
      runtimeRunId: resumed.session.runtimeRunId,
      sessionId: resumed.terminal.sessionId,
      how: "manual",
      replaced: ptyId,
    });
    expect(
      auditEntries(first.dataDir).filter(
        (entry) => entry.action === "agent.session.resume" && entry.actor.kind === "system",
      ),
      "a resume asked for at the door was ledgered twice, once as the daemon itself",
    ).toEqual([]);
    await win2.call("terminal.terminate", { sessionId: resumed.terminal.sessionId });
  }, 150_000);

  it("RA-D7 — a pending run whose agent had not saved its conversation: the row says nothing continues it, and agent.resume is refused BEFORE its PTY is touched", async () => {
    const first = await setup({ floor: "real" });
    const win1 = await window(first.daemon, DECK, "ns1");
    const spawned = (await born(win1, "agent.spawn", {
      provider: "scripted",
      cwd: first.envOut,
      title: "unsaved",
    })) as AgentSpawnResult;
    const runId = spawned.session.runtimeRunId;
    const ptyId = spawned.terminal.sessionId;
    await joinedRow(win1, runId);
    await first.daemon.stop();
    // the record as a runtime with puppeteer's mark writes it for a run whose
    // agent has not saved the conversation yet (a provisional id, or an exact
    // one before the agent's first durable record), signed like any other
    const record = first.records.read(runId);
    if (record === undefined) {
      throw new Error("the first boot wrote no verified record for its run");
    }
    first.records.write({ ...record, continuation: { ...record.continuation, resumable: false } });

    const second = await setup({ floor: "real", restartOf: first });
    const win2 = await window(second.daemon, DECK, "ns2");
    const pending = await poll(async (seen) => {
      const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
      const found = sessions.find((r) => r.runtimeRunId === runId);
      seen(found ?? null);
      return found?.continuation?.pending !== undefined ? found : undefined;
    }, 20_000);
    // held, and says no resume is coming (AR-D25's signed-out shape)
    expect(pending.continuation).toMatchObject({ persisted: true, resumable: false });
    expect(pending.terminal).toMatchObject({ hosted: "local", runtimeSessionId: ptyId });

    const refused = (await win2.callErr("agent.resume", { runtimeRunId: runId })) as RpcErrorShape;
    expect(refused.data?.kind).toBe("PRECONDITION_FAILED");
    expect((refused.data?.details as { state?: string } | undefined)?.state).toBe(
      "not-yet-resumable",
    );
    // nothing was ended and nothing was born: the PTY runs, no second run
    // exists, and the record says only that the boot could not attach
    expect(await listed(win2, ptyId)).toBe(true);
    expect(first.sessions).toHaveLength(1);
    const after = readRecord(first.dataDir, runId);
    expect(after.exited).toBeUndefined();
    expect(after.reattach).toMatchObject({ state: "unsupported" });
    expect(after.continuation.resumable).toBe(false);
    await win2.call("terminal.terminate", { sessionId: ptyId });
  }, 120_000);

  it("resume-when-idle: a pending run stays pending while the index knows nothing of it, while its row carries no activity, while its conversation has just moved, and while a still SUBAGENT row sits beside an active canonical one — and is resumed by the daemon itself once the canonical row says the conversation has been still", async () => {
    const first = await setup({ floor: "real" });
    const win1 = await window(first.daemon, DECK, "ri1");
    const spawned = (await born(win1, "agent.spawn", {
      provider: "scripted",
      cwd: first.envOut,
    })) as AgentSpawnResult;
    const runId = spawned.session.runtimeRunId;
    const ptyId = spawned.terminal.sessionId;
    const nativeId = spawned.session.sessionId;
    await joinedRow(win1, runId);
    await first.daemon.stop();

    // the fake index serves NO rows yet: no evidence, no resume
    const second = await setup({
      floor: "real",
      restartOf: first,
      resumeWhenIdle: { afterMs: 30_000, pollMs: 200 },
    });
    const win2 = await window(second.daemon, DECK, "ri2");
    await poll(async () => {
      const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
      return sessions.find((r) => r.runtimeRunId === runId)?.continuation?.pending !== undefined
        ? true
        : undefined;
    }, 20_000);

    /** A window the fold must come through unchanged — WITH the evidence that
     * the poller was awake for it. A sleep alone witnesses nothing: a poll
     * that never fired, a rosettad that never started, and a correct refusal
     * to resume are the same picture. The fake index counts every
     * `/api/sessions` it answers, and that count has to have moved. */
    const heldPending = async (what: string, ms: number): Promise<void> => {
      const asked = sessionRequests(second);
      await new Promise((resolve) => setTimeout(resolve, ms));
      const rows = ((await win2.call("agent.list", {})) as AgentListResult).sessions;
      expect(
        rows.map((r) => r.runtimeRunId),
        `${what}: the fold changed`,
      ).toEqual([runId]);
      expect(rows[0]?.continuation?.pending, `${what}: the run stopped being pending`).toBe(
        "resume-when-idle",
      );
      expect(await listed(win2, ptyId), `${what}: the PTY left the floor`).toBe(true);
      expect(
        sessionRequests(second) - asked,
        `${what}: the index was never ASKED during the window, so the window proves nothing`,
      ).toBeGreaterThan(0);
    };

    // ① the index has never read this session — and no evidence is not idle
    await heldPending("the index knows nothing of it", 1_500);
    // ② rosetta knows the session and has no timestamped evidence for it yet
    writeFileSync(first.sessionsFile, JSON.stringify([rosettaRow(nativeId, null)]));
    await heldPending("the row carries no activity", 1_500);
    // ③ the conversation moved a second ago
    writeFileSync(first.sessionsFile, JSON.stringify([rosettaRow(nativeId, 1_000)]));
    await heldPending("the conversation moved a second ago", 1_500);
    // ④ two rows for the one native id, the DECOY first: a subagent thread
    //    still for a minute beside a canonical row that just moved. A reader
    //    that took the first row would resume here; the canonical row is the
    //    one whose root_session_id is its own id, and its clock is the one
    //    that counts.
    writeFileSync(
      first.sessionsFile,
      JSON.stringify([rosettaRow(nativeId, 60_000, true), rosettaRow(nativeId, 1_000)]),
    );
    await heldPending("a still subagent row beside an active canonical one", 1_500);

    // ⑤ the same pair the other way about: the canonical row has been still
    //    for a minute, and an ACTIVE subagent row ahead of it changes nothing
    const watcher = await window(second.daemon, DECK, "ri3");
    const gone = watchForGone(watcher, ptyId);
    writeFileSync(
      first.sessionsFile,
      JSON.stringify([rosettaRow(nativeId, 1_000, true), rosettaRow(nativeId, 60_000)]),
    );
    const replaced = await poll(async () => {
      const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
      return sessions.find((r) => r.terminal?.replaced === ptyId);
    }, 30_000);
    const goneAt = await gone.stop();
    const bornAt = first.sessions.at(-1)?.bornAt ?? Number.NEGATIVE_INFINITY;
    expect(goneAt, "the watcher never saw the old PTY leave the listing").toBeDefined();
    expect(
      (goneAt ?? Number.POSITIVE_INFINITY) < bornAt,
      `the old PTY was still listed when the new run was born (gone at ${goneAt}, born at ${bornAt})`,
    ).toBe(true);
    expect(replaced.runtimeRunId).not.toBe(runId);
    expect(replaced.sessionId).toBe(nativeId);
    expect(replaced.continuation?.pending).toBeUndefined();
    expect(first.sessions.at(-1)?.resume).toBe(nativeId);
    await untilListed(win2, ptyId, false);
    await untilListed(win2, replaced.terminal?.runtimeSessionId ?? "", true);
    const old = readRecord(first.dataDir, runId);
    expect(old.exited?.reason).toBe("replaced");
    // and the old record names its successor as well as the PTY it gave up
    expect(old.reattach).toMatchObject({
      state: "resumed",
      replaced: ptyId,
      replacedBy: replaced.runtimeRunId,
    });
    // the ledger: ONE act, the daemon's own, and it says how it decided
    const byIdle = await auditAct(
      first.dataDir,
      (entry) =>
        entry.action === "agent.session.resume" &&
        entry.actor.kind === "system" &&
        entry.target.id === runId,
    );
    expect(byIdle.attempt.attrs).toMatchObject({
      provider: "scripted",
      how: "idle",
      replaced: ptyId,
    });
    expect(byIdle.outcome.outcome).toBe("succeeded");
    expect(byIdle.outcome.attrs).toMatchObject({
      runtimeRunId: replaced.runtimeRunId,
      sessionId: replaced.terminal?.runtimeSessionId,
    });
    // nobody asked for it: no door act stands beside the daemon's
    expect(
      auditEntries(first.dataDir).filter(
        (entry) => entry.action === "agent.session.resume" && entry.actor.kind !== "system",
      ),
    ).toEqual([]);
    // the fold holds the new run only
    const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
    expect(sessions.map((r) => r.runtimeRunId)).toEqual([replaced.runtimeRunId]);
    await win2.call("terminal.terminate", { sessionId: replaced.terminal?.runtimeSessionId ?? "" });
  }, 200_000);

  it("a record whose PTY did NOT survive is stamped at the next boot as an unknown exit, and resumes from the door like any other", async () => {
    const first = await setup({ floor: "real", attach: true });
    const win1 = await window(first.daemon, DECK, "go1");
    const spawned = (await born(win1, "agent.spawn", {
      provider: "scripted",
      cwd: first.envOut,
    })) as AgentSpawnResult;
    const runId = spawned.session.runtimeRunId;
    const ptyId = spawned.terminal.sessionId;
    await joinedRow(win1, runId);
    await first.daemon.stop();
    // the process ended while no fieldd was there to see it: the record is
    // un-stamped and names a PTY the floor no longer lists (staged by pointing
    // the record at a session the floor never had — the same fact)
    // The rewrite goes through the product's OWN record store, so the staged
    // record stays SIGNED (AR-4b): a record whose signature does not verify is
    // set aside at read and never acted on, which would witness the tamper
    // path instead of this row's — a PTY that ended unseen.
    const record = readRecord(first.dataDir, runId);
    first.records.write({ ...record, terminalSessionId: "sess-that-never-was" });
    const second = await setup({ floor: "real", attach: true, restartOf: first });
    const win2 = await window(second.daemon, DECK, "go2");
    const stamped = await poll(async () => {
      const r = readRecord(first.dataDir, runId);
      return r.exited !== undefined ? r : undefined;
    }, 20_000);
    expect(stamped.exited?.reason).toBe("unknown");
    expect(stamped.reattach).toBeUndefined();
    expect(first.attached).toHaveLength(0);
    expect(((await win2.call("agent.list", {})) as AgentListResult).sessions).toEqual([]);
    // …and it resumes from the door
    const resumed = (await born(win2, "agent.resume", { runtimeRunId: runId })) as AgentSpawnResult;
    expect(resumed.session.sessionId).toBe(spawned.session.sessionId);
    expect(resumed.session.terminal?.replaced).toBeUndefined();
    await win2.call("terminal.terminate", { sessionId: resumed.terminal.sessionId });
    // the orphaned PTY of the first run is still the floor's; end it too
    await win2.call("terminal.terminate", { sessionId: ptyId }).catch(() => undefined);
  }, 150_000);

  it("a managed PTY that ends on its OWN (killed out of band, nothing asked) withdraws the row and stamps the record", async () => {
    const box = await setup({ floor: "real" });
    const win = await window(box.daemon, DECK, "ko1");
    const spawned = (await born(win, "agent.spawn", {
      provider: "scripted",
      cwd: box.envOut,
    })) as AgentSpawnResult;
    const runId = spawned.session.runtimeRunId;
    const ptyId = spawned.terminal.sessionId;
    await joinedRow(win, runId);
    // the floor's inventory row names the process it started; kill THAT, the
    // way a crash would, with no door touched and nothing telling fieldd
    const { terminals } = (await win.call("terminal.list", {})) as { terminals: TerminalInfo[] };
    const pid = terminals.find((t) => t.sessionId === ptyId)?.pid;
    expect(pid, "the floor's inventory row carries no pid to kill").toBeTypeOf("number");
    process.kill(pid as number, "SIGKILL");

    // MF-1g — the run ends and its PANE does not. Before the class flip this
    // row LEFT the fold here; now a crash leaves what a person needs to read
    // it: the final screen, the exit facts, and the resume verb on the card.
    // The exit still arrives by the floor's own facts or by the inventory
    // backstop (EXIT_GRACE_MS), and the record's reason says which got there
    // first.
    await poll(async () => {
      const { sessions } = (await win.call("agent.list", {})) as AgentListResult;
      const row = sessions.find((r) => r.runtimeRunId === runId);
      return row?.continuation?.exited === true ? row : undefined;
    }, 15_000);
    expect(await listed(win, ptyId), "MF-1g: the pane outlives the process").toBe(true);
    const stamped = await poll(async () => {
      const r = readRecord(box.dataDir, runId);
      return r.exited !== undefined ? r : undefined;
    }, 10_000);
    expect([
      "completed",
      "crashed",
      "signaled",
      "user-terminated",
      "application-terminated",
      "service-terminated",
      "unknown",
    ]).toContain(stamped.exited?.reason);
    // and puppeteer has let the run go with it
    expect(box.daemon.agents.runtime.agent(ptyId)).toBeUndefined();

    // closing the pane is what withdraws the row — the reap the old
    // persistence class did implicitly, now an act someone takes
    await win.call("terminal.terminate", { sessionId: ptyId });
    await poll(async () => {
      const { sessions } = (await win.call("agent.list", {})) as AgentListResult;
      return sessions.some((r) => r.runtimeRunId === runId) ? undefined : true;
    }, 15_000);
    expect(await listed(win, ptyId)).toBe(false);
  }, 120_000);

  it("the index down under a pending run: it stays pending with no replacement and nothing unhandled — and a stop under that armed poll still RELEASES the PTY rather than ending it", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    cleanup.push(() => {
      process.off("unhandledRejection", onUnhandled);
    });

    const first = await setup({ floor: "real" });
    const win1 = await window(first.daemon, DECK, "ix1");
    const spawned = (await born(win1, "agent.spawn", {
      provider: "scripted",
      cwd: first.envOut,
    })) as AgentSpawnResult;
    const runId = spawned.session.runtimeRunId;
    const ptyId = spawned.terminal.sessionId;
    await joinedRow(win1, runId);
    await first.daemon.stop();

    // the second boot's index refuses to start at all: the poll is armed as
    // eagerly as it can be (a millisecond of stillness would do), so if an
    // index that answers NOTHING could ever be read as "idle" this run would
    // be replaced within a tick
    const second = await setup({
      floor: "real",
      restartOf: first,
      rosettadMode: "crash-on-start",
      resumeWhenIdle: { afterMs: 1, pollMs: 100 },
    });
    const win2 = await window(second.daemon, DECK, "ix2");
    const pending = await poll(async () => {
      const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
      const found = sessions.find((r) => r.runtimeRunId === runId);
      return found?.continuation?.pending !== undefined ? found : undefined;
    }, 20_000);
    expect(pending.continuation?.pending).toBe("resume-when-idle");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(second.daemon.health().rosettad.phase, "the index came up after all").not.toBe("ready");
    expect(sessionRequests(second), "a dead index answered a request").toBe(0);
    const rows = ((await win2.call("agent.list", {})) as AgentListResult).sessions;
    expect(rows.map((r) => r.runtimeRunId)).toEqual([runId]);
    expect(rows[0]?.continuation?.pending).toBe("resume-when-idle");
    expect(await listed(win2, ptyId)).toBe(true);
    expect(readRecord(first.dataDir, runId).exited).toBeUndefined();

    // ── the stop, with that poll still armed: the detach promise holds ──
    const asked = Date.now();
    await second.daemon.stop();
    expect(Date.now() - asked, "the stop waited on something").toBeLessThan(10_000);
    expect(readRecord(first.dataDir, runId).exited).toBeUndefined();
    const third = await setup({ floor: "real", restartOf: first });
    const win3 = await window(third.daemon, DECK, "ix3");
    await untilListed(win3, ptyId, true);
    expect(
      unhandled.map((reason) => (reason instanceof Error ? reason.message : String(reason))),
    ).toEqual([]);
    await win3.call("terminal.terminate", { sessionId: ptyId });
  }, 200_000);

  it("one record's trouble does not end the re-attach: a record naming a provider that no longer exists is held pending with its reason, and the good record beside it still attaches", async () => {
    const first = await setup({ floor: "real", attach: true });
    const win1 = await window(first.daemon, DECK, "tr1");
    const good = (await born(win1, "agent.spawn", {
      provider: "scripted",
      cwd: first.envOut,
      title: "the good one",
    })) as AgentSpawnResult;
    const bad = (await born(win1, "agent.spawn", {
      provider: "scripted",
      cwd: first.envOut,
      title: "the troubled one",
    })) as AgentSpawnResult;
    await joinedRow(win1, good.session.runtimeRunId);
    await joinedRow(win1, bad.session.runtimeRunId);
    await first.daemon.stop();
    // one record now names an adapter this daemon has never heard of — and it
    // is the NEWER record, so the re-attach meets it first (records are listed
    // newest first). Written through the store: a signed record fieldd will
    // act on, which is what makes the failure the ATTACH's and not the read's.
    const record = readRecord(first.dataDir, bad.session.runtimeRunId);
    first.records.write({ ...record, provider: "ghost" });

    const second = await setup({ floor: "real", attach: true, restartOf: first });
    const win2 = await window(second.daemon, DECK, "tr2");
    const attached = await poll(async () => {
      const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
      const found = sessions.find((r) => r.runtimeRunId === good.session.runtimeRunId);
      return found?.continuation?.reattached === true ? found : undefined;
    }, 20_000);
    expect(attached.runtimeEpoch).toBe(2);
    expect(attached.title).toBe("the good one");
    expect(first.attached.map((a) => a.runtimeSessionId)).toEqual([good.terminal.sessionId]);
    // the troubled one is held, live and unobserved, with the reason on the
    // record — the state a person resumes from, not a boot that stopped
    const held = await poll(async () => {
      const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
      const found = sessions.find((r) => r.runtimeRunId === bad.session.runtimeRunId);
      return found?.continuation?.pending !== undefined ? found : undefined;
    }, 20_000);
    expect(held.title).toBe("the troubled one");
    // AC-3: the row says what `agent.resume` would do — the catalog shows no
    // agent named "ghost", so it is held (pending) but NOT resumable; before
    // the catalog the row said resumable and the resume failed at the runtime
    expect(held.continuation).toMatchObject({ resumable: false, pending: "resume-when-idle" });
    expect(readRecord(first.dataDir, bad.session.runtimeRunId).reattach).toMatchObject({
      state: "failed",
    });
    const trouble = await auditAct(
      first.dataDir,
      (entry) =>
        entry.action === "agent.session.reattach" && entry.target.id === bad.session.runtimeRunId,
    );
    expect(trouble.attempt.attrs?.["provider"]).toBe("ghost");
    expect(trouble.outcome.outcome).toBe("failed");
    expect(trouble.outcome.reasonCode).toBe("ATTACH_FAILED");
    // both PTYs are still the floor's; end them
    await win2.call("terminal.terminate", { sessionId: good.terminal.sessionId });
    await win2.call("terminal.terminate", { sessionId: bad.terminal.sessionId });
  }, 200_000);
});

const REAL_AGENT = process.env["FIELDD_TEST_REAL_AGENT"] === "1";

describe.skipIf(!REAL_AGENT)(
  "the REAL claude over the real floor (FIELDD_TEST_REAL_AGENT=1)",
  () => {
    it("a real agent in a PTY on the floor with live status: alive, the native session id observed from the vendor's own hooks, the record following it; terminate withdraws it", async () => {
      const { daemon, dataDir, root } = await setup({ floor: "real", realAgent: true });
      const win = await window(daemon, DECK, "real1");
      const cwd = join(root, "work");
      mkdirSync(cwd);
      const spawned = (await born(win, "agent.spawn", {
        provider: "claude",
        cwd,
      })) as AgentSpawnResult;
      expect(spawned.session.kind).toBe("claude");
      expect(spawned.session.terminal?.hosted).toBe("local");
      const runId = spawned.session.runtimeRunId;
      const live = await poll(async () => {
        const { sessions } = (await win.call("agent.list", {})) as AgentListResult;
        const row = sessions.find((r) => r.runtimeRunId === runId);
        return row?.monitor?.alive === true && row.sessionIdBasis === "observed" ? row : undefined;
      }, 60_000);
      // eslint-disable-next-line no-console
      console.log(
        `REAL_AGENT ${JSON.stringify({
          status: live.status,
          observationLevel: live.observationLevel,
          sessionId: live.sessionId,
          level: live.monitor?.freshness?.level,
          schemaVersion: live.monitor?.schemaVersion,
        })}`,
      );
      // The contract's version, never a literal: upstream bumped the monitor
      // schema to 3 and this opt-in row kept asserting AR-3's 2 for as long as
      // the gate could not see it.
      expect(live.monitor?.schemaVersion).toBe(AGENT_MONITOR_SCHEMA_VERSION);
      expect(["idle", "working", "blocked"]).toContain(live.status);
      const record = await poll(async () => {
        const r = readRecord(dataDir, runId);
        return r.continuation.nativeSessionId === live.sessionId ? r : undefined;
      }, 10_000);
      expect(record.provider).toBe("claude");
      // hold the live agent for a moment: a vendor TUI that exits by itself in
      // its first seconds is a finding, and the exit facts say which
      await new Promise((resolve) => setTimeout(resolve, 5_000));
      const still = ((await win.call("agent.list", {})) as AgentListResult).sessions.find(
        (r) => r.runtimeRunId === runId,
      );
      console.log(
        `REAL_AGENT_AFTER_5S ${JSON.stringify({
          present: still !== undefined,
          status: still?.status,
          alive: still?.monitor?.alive,
          level: still?.monitor?.freshness?.level,
          blockers: still?.monitor?.blockers,
          exited: readRecord(dataDir, runId).exited,
        })}`,
      );
      const term = (await win.call("terminal.terminate", {
        sessionId: spawned.terminal.sessionId,
      })) as { terminated: boolean };
      console.log(`REAL_AGENT_TERMINATE ${JSON.stringify(term)}`);
      await poll(async () => {
        const { sessions } = (await win.call("agent.list", {})) as AgentListResult;
        return sessions.some((r) => r.runtimeRunId === runId) ? undefined : true;
      }, 30_000);
      const final = readRecord(dataDir, runId);
      console.log(`REAL_AGENT_EXIT ${JSON.stringify(final.exited)}`);
      expect(final.exited).toBeDefined();
      expect(still, "the real agent left its PTY within seconds of starting").toBeDefined();
      // the AR-3 ledger's own claim for this hold — "`native-hooks` and `idle`
      // after five" — asserted rather than only logged: a run whose evidence
      // has fallen back to the log tail is a finding, not a passing row
      expect(still?.monitor?.freshness?.level).toBe("native-hooks");
      expect(term.terminated).toBe(true);
    }, 150_000);

    it("AR-4 — the REAL claude re-attached across a fieldd restart: the bridge re-bound to the pinned ingress, the run at its next epoch, the hooks flowing again after a prompt", async () => {
      const first = await setup({ floor: "real", realAgent: true });
      const win1 = await window(first.daemon, DECK, "real2");
      const cwd = join(first.root, "work");
      mkdirSync(cwd);
      const spawned = (await born(win1, "agent.spawn", {
        provider: "claude",
        cwd,
      })) as AgentSpawnResult;
      const runId = spawned.session.runtimeRunId;
      const ptyId = spawned.terminal.sessionId;
      const live = await poll(async () => {
        const { sessions } = (await win1.call("agent.list", {})) as AgentListResult;
        const row = sessions.find((r) => r.runtimeRunId === runId);
        return row?.monitor?.alive === true && row.sessionIdBasis === "observed" ? row : undefined;
      }, 60_000);
      const before = readRecord(first.dataDir, runId);
      console.log(
        `REAL_AGENT_INGRESS ${JSON.stringify({ port: before.ingress?.port, hasToken: before.ingress?.token !== undefined, creationRequestId: before.creationRequestId !== undefined })}`,
      );
      expect(before.ingress?.port).toBeGreaterThan(0);
      expect(before.creationRequestId).toBeTruthy();
      // Let the vendor TUI finish starting before the stop — PU-11: a fieldd
      // stop within about a second of the first observed hook LOSES the
      // process (4 of 4 without a hold; 3 of 3 survive with one). Wait for the
      // HOOK rather than for a number of seconds, then give it a beat: a blind
      // sleep is the same number whether the thing it was waiting for happened
      // or not.
      const settled = await poll(async () => {
        const { sessions } = (await win1.call("agent.list", {})) as AgentListResult;
        const found = sessions.find((r) => r.runtimeRunId === runId);
        return found?.monitor?.freshness?.level === "native-hooks" ? found : undefined;
      }, 60_000);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      console.log(
        `REAL_AGENT_BEFORE_STOP ${JSON.stringify({
          listed: await listed(win1, ptyId),
          level: settled.monitor?.freshness?.level,
          status: settled.status,
        })}`,
      );

      await first.daemon.stop();
      expect(readRecord(first.dataDir, runId).exited).toBeUndefined();
      const second = await setup({ floor: "real", realAgent: true, restartOf: first });
      const win2 = await window(second.daemon, DECK, "real3");
      const ptyAlive = await listed(win2, ptyId);
      const fate = await poll(async () => {
        const r = readRecord(first.dataDir, runId);
        return r.reattach !== undefined || r.exited !== undefined ? r : undefined;
      }, 30_000).catch(() => readRecord(first.dataDir, runId));
      console.log(
        `REAL_AGENT_SECOND_BOOT ${JSON.stringify({
          ptyAlive,
          reattach: fate.reattach,
          exited: fate.exited,
          rows: ((await win2.call("agent.list", {})) as AgentListResult).sessions.map((r) => ({
            runtimeRunId: r.runtimeRunId,
            continuation: r.continuation,
          })),
        })}`,
      );
      // the premise of everything below, asserted once the facts are logged:
      // a re-attach to a PTY the stop took with it is not a re-attach
      expect(ptyAlive, "the PTY did not survive the stop").toBe(true);
      const row = await poll(async () => {
        const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
        const found = sessions.find((r) => r.runtimeRunId === runId);
        return found?.continuation?.reattached === true ? found : undefined;
      }, 30_000);
      console.log(
        `REAL_AGENT_REATTACHED ${JSON.stringify({
          runtimeEpoch: row.runtimeEpoch,
          status: row.status,
          observationLevel: row.observationLevel,
          level: row.monitor?.freshness?.level,
          alive: row.monitor?.alive,
          sessionId: row.sessionId,
        })}`,
      );
      expect(row.runtimeEpoch).toBe(2);
      expect(row.sessionId).toBe(live.sessionId);
      expect(row.terminal?.runtimeSessionId).toBe(ptyId);
      // a prompt through the re-attached run: the vendor's hooks reach the
      // re-bound bridge, and the monitor moves on native evidence again
      const agent = second.daemon.agents.runtime.agent(ptyId);
      expect(agent).toBeDefined();
      const receipt = await agent!.submitPrompt({ text: "/clear" });
      console.log(`REAL_AGENT_PROMPT ${JSON.stringify(receipt)}`);
      const hooked = await poll(async () => {
        const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
        const found = sessions.find((r) => r.runtimeRunId === runId);
        return found?.monitor?.alive === true && found.monitor.freshness?.level === "native-hooks"
          ? found
          : undefined;
      }, 60_000);
      console.log(
        `REAL_AGENT_HOOKED ${JSON.stringify({
          status: hooked.status,
          observationLevel: hooked.observationLevel,
          level: hooked.monitor?.freshness?.level,
          sessionId: hooked.sessionId,
          basis: hooked.sessionIdBasis,
        })}`,
      );
      const after = readRecord(first.dataDir, runId);
      expect(after.reattach).toMatchObject({ state: "attached" });
      expect(after.runtimeEpoch).toBe(2);
      const term = (await win2.call("terminal.terminate", { sessionId: ptyId })) as {
        terminated: boolean;
      };
      console.log(`REAL_AGENT_TERMINATE ${JSON.stringify(term)}`);
      await poll(async () => {
        const { sessions } = (await win2.call("agent.list", {})) as AgentListResult;
        return sessions.some((r) => r.runtimeRunId === runId) ? undefined : true;
      }, 30_000);
      const exit = readRecord(first.dataDir, runId).exited;
      console.log(`REAL_AGENT_EXIT ${JSON.stringify(exit)}`);
      // the AR-4 ledger's claim for this ending, asserted: terminated cleanly,
      // the vendor's own process leaving by the application's ladder
      expect(term.terminated).toBe(true);
      expect(exit?.reason).toBe("application-terminated");
    }, 300_000);
  },
);
