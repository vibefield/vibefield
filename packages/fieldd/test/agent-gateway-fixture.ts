// AR-7b — the scripted TYPED agent: the instrument every row of
// agent-gateway.test.ts plays. It is an adapter that owns a recipe and a
// grammar, and nothing of any vendor's:
//
//  · a command name a person types (`vf-scripted`), and a REAL executable — a
//    script in the test's own directory that leaves one line per run (its
//    arguments) in a log, so "it ran as typed" and "nothing ran" are both
//    things a row can read;
//  · a normalizer that CLASSIFIES: no arguments and `--resume <id>` are a
//    session it carries, `--version` is a utility, `-p …` is a one-shot, and
//    anything else is a session it cannot carry, naming the argument;
//  · a prepared launch whose recipe leaves one line in another log and then
//    holds the terminal with `cat` — so end-of-file at the prompt ends the
//    agent and leaves the shell;
//  · `createSession`, for the runs a door starts (a resume from a typed
//    run's record is an ordinary one), and `attachSession` when a row asks.
//
// Test-only; the gate's R23 never reads it.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  AgentAdapterBinding,
  AgentHost,
  AgentNativeInvocationResolution,
  BoundIngress,
  PromptReceipt,
  PromptSubmission,
} from "@vibecook/puppeteer-core";
import type {
  AgentProvider,
  AgentProviderSessionOptions,
  AttachProviderSessionOptions,
} from "@vibecook/puppeteer-runtime";
import type { AgentCatalogEntry } from "@vibefield/contracts";
import { catalogWith } from "./agent-catalog-fixture";

/** The name a person types. */
export const TYPED_COMMAND = "vf-scripted";
export const TYPED_PROVIDER = "scripted";

/** The catalog a typed row composes: THE table, the scripted row offering
 * `invoke`. */
export const TYPED_CATALOG: readonly AgentCatalogEntry[] = catalogWith(TYPED_PROVIDER, {
  offers: { invoke: true } as AgentCatalogEntry["offers"],
});

export interface TypedPrepared {
  cwd: string;
  resume: string | undefined;
  sessionId: string;
  ingress: BoundIngress;
  /** the terminal puppeteer adopted it in, once it has */
  adoptedIn?: string;
}

export interface TypedAttach {
  runtimeSessionId: string;
  sessionId: string;
  ingress: AttachProviderSessionOptions["ingress"];
}

/** What the scripted agent left behind, for a row to read. */
export interface TypedScript {
  directory: string;
  /** the real executable the command name stands for */
  real: string;
  /** one line per run of the real executable: `RUN <its arguments>` */
  realLog: string;
  /** one line per MANAGED launch that really ran its recipe */
  managedLog: string;
  prepared: TypedPrepared[];
  attached: TypedAttach[];
  /** sessions a door started (`createSession`) */
  created: Array<{ runtimeSessionId: string; resume: string | undefined }>;
}

/** Lay the scripted agent's files out in `directory`. */
export function typedScript(directory: string): TypedScript {
  mkdirSync(directory, { recursive: true });
  const real = join(directory, "vf-scripted-real");
  const realLog = join(directory, "real.log");
  const managedLog = join(directory, "managed.log");
  if (!existsSync(real)) {
    writeFileSync(real, `#!/bin/sh\nprintf 'RUN %s\\n' "$*" >> '${realLog}'\n`, { mode: 0o755 });
    chmodSync(real, 0o755);
  }
  return { directory, real, realLog, managedLog, prepared: [], attached: [], created: [] };
}

/** The lines a log holds (none when it was never written). */
export function linesOf(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

function binding(
  host: AgentHost,
  runtimeSessionId: string,
  sessionId: string,
): AgentAdapterBinding {
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
    },
    async dispose() {},
  };
}

/** The scripted agent's grammar — the whole of it. */
export function normalizeTyped(argv: readonly string[]): AgentNativeInvocationResolution {
  if (argv.length === 0) return { status: "accepted" };
  const [first, second] = argv;
  if (first === "--resume" && second !== undefined && argv.length === 2) {
    return { status: "accepted", resume: second };
  }
  if (first === "--version") {
    return { status: "passthrough", kind: "utility", reason: "a version query runs no agent" };
  }
  if (first === "-p") {
    return { status: "passthrough", kind: "one-shot", reason: "a print run is not a session" };
  }
  return {
    status: "rejected",
    reason: "the scripted agent has no managed form for it",
    ...(first !== undefined ? { argument: first } : {}),
  };
}

export interface TypedProviderOptions {
  /** give the adapter an `attachSession` (AR-4) */
  attach?: boolean;
  /** the adapter tells a version query from a session (default true) */
  classifies?: boolean;
  /** the executable the launch provider names (default: the script's real one) */
  executable?: string;
  /** how long the adapter takes to prepare (a slow preparation) */
  prepareDelayMs?: number;
}

export function typedProvider(
  script: TypedScript,
  options: TypedProviderOptions = {},
): AgentProvider {
  let counter = 0;
  const ingressFor = (n: number): BoundIngress => ({
    port: 41_000 + n,
    token: `typed-bearer-${n}`,
  });
  return {
    descriptor: { id: TYPED_PROVIDER, label: "Scripted" },
    launch: {
      provider: {
        id: TYPED_PROVIDER,
        label: "Scripted",
        resume: true,
        nativeInvocation: {
          commands: [{ name: TYPED_COMMAND, executable: options.executable ?? script.real }],
          environmentVariables: [],
          ...(options.classifies === false ? {} : { classifies: true }),
        },
      },
      normalizeInvocation: (invocation) => normalizeTyped(invocation.argv),
    },
    async prepareSession(session: AgentProviderSessionOptions) {
      const n = ++counter;
      if (options.prepareDelayMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, options.prepareDelayMs));
      }
      // the stable-ingress contract: bound, REPORTED, and only then a recipe
      const ingress = ingressFor(n);
      session.ingress?.onBound?.(ingress);
      const sessionId = session.resume ?? `typed-native-${n}`;
      const prepared: TypedPrepared = {
        cwd: session.cwd,
        resume: session.resume,
        sessionId,
        ingress,
      };
      script.prepared.push(prepared);
      return {
        sessionId,
        launch: {
          command: "/bin/sh",
          args: ["-c", `echo "MANAGED ${sessionId}" >> '${script.managedLog}'; exec /bin/cat`],
          cwd: session.cwd,
          env: { SCRIPTED_TYPED: sessionId },
        },
        async adopt(runtimeSessionId: string) {
          prepared.adoptedIn = runtimeSessionId;
          return binding(session.host, runtimeSessionId, sessionId);
        },
        async dispose() {},
      };
    },
    async createSession(session: AgentProviderSessionOptions): Promise<AgentAdapterBinding> {
      const n = ++counter;
      session.ingress?.onBound?.(ingressFor(n));
      const { runtimeSessionId } = await session.host.spawnTerminal({
        command: "/bin/sh",
        args: ["-c", "exec /bin/cat"],
        cwd: session.cwd,
        env: {},
      });
      script.created.push({ runtimeSessionId, resume: session.resume });
      return binding(session.host, runtimeSessionId, session.resume ?? `typed-native-${n}`);
    },
    ...(options.attach === true
      ? {
          async attachSession(attach: AttachProviderSessionOptions): Promise<AgentAdapterBinding> {
            script.attached.push({
              runtimeSessionId: attach.runtimeSessionId,
              sessionId: attach.sessionId,
              ingress: attach.ingress,
            });
            return binding(attach.host, attach.runtimeSessionId, attach.sessionId);
          },
        }
      : {}),
  };
}

/** Where a test keeps a directory of its own beside a file it names. */
export function besideOf(path: string, name: string): string {
  return join(dirname(path), name);
}
