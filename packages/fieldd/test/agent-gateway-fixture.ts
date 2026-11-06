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
//    run's record is an ordinary one), and `attachSession` when a row asks;
//  · when a row asks (`observed`), a binding that witnesses its turns, whose
//    status a row moves by handing it a turn (`typedEvent`), as
//    agent-session.test.ts's scripted agent does (ST).
//
// Test-only; the gate's R23 never reads it.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentCatalogEntry } from "@vibefield/contracts";
import {
  type AgentAdapterBinding,
  type AgentAttachNext,
  AgentAttachRefusedError,
  type AgentEvent,
  type AgentHost,
  type AgentNativeInvocationResolution,
  type BoundIngress,
  type PromptReceipt,
  type PromptSubmission,
} from "@vibefield/puppeteer-core";
import type {
  AgentProvider,
  AgentProviderSessionOptions,
  AttachProviderSessionOptions,
} from "@vibefield/puppeteer-runtime";
import { catalogWith } from "./agent-catalog-fixture";
import { SCRIPTED_ROOT_VARIABLE, scriptedProfiles } from "./scripted-profiles";

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

/** ST — an observed binding's candidate listener, by terminal (`observed: true`). */
export type TypedCandidates = Map<
  string,
  Parameters<AgentAdapterBinding["events"]["onCandidate"]>[0]
>;

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
  /** preparations the adapter has BEGUN (a slow one is under way before it is made) */
  preparing: { count: number };
  attached: TypedAttach[];
  /** sessions a door started (`createSession`) */
  created: Array<{ runtimeSessionId: string; resume: string | undefined }>;
  /** ST — each observed binding's candidate listener, by terminal (`observed: true`) */
  observed: TypedCandidates;
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
  return {
    directory,
    real,
    realLog,
    managedLog,
    prepared: [],
    preparing: { count: 0 },
    attached: [],
    created: [],
    observed: new Map(),
  };
}

/** The lines a log holds (none when it was never written). */
export function linesOf(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

/** `observed` — ST: the binding witnesses its turns (`native-hooks`), and a
 * row moves its status by handing the kept listener a turn (`typedEvent`);
 * absent, it reads as `terminal-only`, a status fieldd cannot read. */
function binding(
  host: AgentHost,
  runtimeSessionId: string,
  sessionId: string,
  observed?: TypedCandidates,
): AgentAdapterBinding {
  return {
    sessionId,
    runtimeSessionId,
    observationLevel: () => (observed === undefined ? "terminal-only" : "native-hooks"),
    events: {
      onCandidate: (listener) => {
        if (observed === undefined) return () => undefined;
        observed.set(runtimeSessionId, listener);
        return () => {
          if (observed.get(runtimeSessionId) === listener) observed.delete(runtimeSessionId);
        };
      },
    },
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

/** What the observed scripted agent can report, in puppeteer's own event
 * shapes: a turn's start and end. */
export type TypedEvent = Extract<AgentEvent, { type: "turn:started" | "turn:completed" }>;

/** ST — the observed scripted agent reports an event, as an adapter's native
 * hook would: `turn:started` reads as `working` and `turn:completed` as idle
 * (agent-session.test.ts's `scriptedEvent`, for a typed run's binding). */
export function typedEvent(script: TypedScript, runtimeSessionId: string, event: TypedEvent): void {
  const listener = script.observed.get(runtimeSessionId);
  if (listener === undefined) throw new Error(`no observed binding on ${runtimeSessionId}`);
  const prepared = script.prepared.find((p) => p.adoptedIn === runtimeSessionId);
  listener({
    type: event.type,
    sessionId: prepared?.sessionId ?? runtimeSessionId,
    timestamp: new Date().toISOString(),
    monotonicTime: performance.now(),
    source: "native-hook",
    confidence: "authoritative",
    event,
  } as Parameters<typeof listener>[0]);
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
  /** G5 — what each attach answers, asked once the adapter has recorded it: a next step is the adapter's refusal
   * with it (`AgentAttachRefusedError`, which puppeteer carries to the attach's failure), nothing is the attach. A
   * row holds an attach in flight by answering later (default: every attach binds at once) */
  attachAnswer?: () => Promise<AgentAttachNext | undefined>;
  /** the adapter tells a version query from a session (default true) */
  classifies?: boolean;
  /** the executable the launch provider names (default: the script's real one) */
  executable?: string;
  /** how long the adapter takes to prepare (a slow preparation) */
  prepareDelayMs?: number;
  /** the program the recipe names (default `/bin/sh`): one that does not
   * exist is a recipe the launcher cannot run */
  recipeCommand?: string;
  /** item 191 — shell words the recipe runs BEFORE its MANAGED line, so a row
   * that read the line knows they ran: `trap '' INT; ` makes an agent that
   * ignores ⌃C for good (`cat` inherits the ignore across the exec; a SIGTERM
   * still ends it, and so does end of input), agent-session.test.ts's
   * IGNORES_INT for a typed run */
  prologue?: string;
  /** ST — the binding witnesses its turns (`native-hooks`): a row moves its
   * status with `typedEvent` (default: `terminal-only`, unreadable) */
  observed?: boolean;
  /** SB-2 — the agent can hold a sign-in in an Agent Profile (the scripted
   * account capability, agent-session.test.ts's): its root variable is on the
   * launch allow-list, so a launch carries it and puppeteer attributes the
   * run to the sign-in whose root it names */
  profiles?: boolean;
}

export function typedProvider(
  script: TypedScript,
  options: TypedProviderOptions = {},
): AgentProvider {
  let counter = 0;
  const observed = options.observed === true ? script.observed : undefined;
  const ingressFor = (n: number): BoundIngress => ({
    port: 41_000 + n,
    token: `typed-bearer-${n}`,
  });
  return {
    descriptor: { id: TYPED_PROVIDER, label: "Scripted" },
    ...(options.profiles === true ? { profiles: scriptedProfiles() } : {}),
    launch: {
      provider: {
        id: TYPED_PROVIDER,
        label: "Scripted",
        resume: true,
        nativeInvocation: {
          commands: [{ name: TYPED_COMMAND, executable: options.executable ?? script.real }],
          environmentVariables: options.profiles === true ? [SCRIPTED_ROOT_VARIABLE] : [],
          ...(options.classifies === false ? {} : { classifies: true }),
        },
      },
      normalizeInvocation: (invocation) => normalizeTyped(invocation.argv),
    },
    async prepareSession(session: AgentProviderSessionOptions) {
      const n = ++counter;
      script.preparing.count += 1;
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
          command: options.recipeCommand ?? "/bin/sh",
          args: [
            "-c",
            `${options.prologue ?? ""}echo "MANAGED ${sessionId}" >> '${script.managedLog}'; exec /bin/cat`,
          ],
          cwd: session.cwd,
          env: { SCRIPTED_TYPED: sessionId },
        },
        async adopt(runtimeSessionId: string) {
          prepared.adoptedIn = runtimeSessionId;
          return binding(session.host, runtimeSessionId, sessionId, observed);
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
      return binding(
        session.host,
        runtimeSessionId,
        session.resume ?? `typed-native-${n}`,
        observed,
      );
    },
    ...(options.attach === true
      ? {
          async attachSession(attach: AttachProviderSessionOptions): Promise<AgentAdapterBinding> {
            script.attached.push({
              runtimeSessionId: attach.runtimeSessionId,
              sessionId: attach.sessionId,
              ingress: attach.ingress,
            });
            const next = await options.attachAnswer?.();
            if (next !== undefined) throw new AgentAttachRefusedError(next, `scripted: ${next}`);
            return binding(attach.host, attach.runtimeSessionId, attach.sessionId, observed);
          },
        }
      : {}),
  };
}

/** Where a test keeps a directory of its own beside a file it names. */
export function besideOf(path: string, name: string): string {
  return join(dirname(path), name);
}
