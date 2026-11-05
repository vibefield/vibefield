import type {
  ComposeSayChip,
  SparkId,
  SparkTranscriptKnownLine,
  SparkTranscriptRun,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import type { Agent } from "@vibefield/puppeteer-runtime";

// TH-1 — THE SPARK'S TRANSCRIPT, KEPT (TH0-Q1 = O1; DESIGN.md §8 "Chat's thread", the spark's transcript;
// `spark-transcript.ts` in contracts holds the line and the wire). A skeleton: the red commit's rows run against it.

/** How a run of a spark came to be entered: a birth begins a conversation; a resume continues one; a re-attach is the
 * same run again after fieldd restarted; an adoption is a run typed in a pane. */
export type SparkRunBegun = "spawn" | "resume" | "reattach" | "adopt";

/** A line's body as a writer hands it: its kind's own fields, `at` when it is not now. */
export type TranscriptBody =
  | { readonly kind: "run"; readonly runtimeRunId: string; readonly fresh: boolean }
  | {
      readonly kind: "you";
      readonly via: "chat" | "terminal";
      readonly text: string;
      readonly input?: string | undefined;
      readonly requestId?: string | undefined;
      readonly state?: string | undefined;
      readonly chips?: readonly ComposeSayChip[] | undefined;
    }
  | {
      readonly kind: "outcome";
      readonly of: string;
      readonly state: string;
      readonly reason?: string | undefined;
    }
  | {
      readonly kind: "reply";
      readonly messageId: string;
      readonly turn?: string | undefined;
      readonly text: string;
    }
  | {
      readonly kind: "tool";
      readonly toolCallId: string;
      readonly turn?: string | undefined;
      readonly toolKind: string;
      readonly detail?: string | undefined;
      readonly ours?: true | undefined;
    }
  | { readonly kind: "act"; readonly what: string; readonly text: string }
  | { readonly kind: "turn"; readonly edge: string; readonly turn?: string | undefined }
  | { readonly kind: "gap"; readonly since: string };

/** One run's file read back: its lines that verify, in order, and how many did not; or why it could not be read. */
export type TranscriptRead =
  | { readonly lines: readonly SparkTranscriptKnownLine[]; readonly dropped: number }
  | { readonly absent: true }
  | { readonly unavailable: string };

/** A spark's runs as its folder holds them, oldest first; or why the folder could not be read. */
export type TranscriptRuns =
  | { readonly runs: readonly SparkTranscriptRun[] }
  | { readonly unavailable: string };

export interface SparkTranscriptsOptions {
  /** LAYOUT.SPARK_FILES_DIR, absolute: each spark's folder, item 159's */
  readonly dir: string;
  /** LAYOUT.SPARK_FILES_KEY_FILE, absolute: the folder's one key */
  readonly keyPath: string;
  readonly logger?: Logger | undefined;
  readonly now?: () => Date;
}

export class SparkTranscripts {
  readonly #logger: Logger;

  constructor(readonly opts: SparkTranscriptsOptions) {
    this.#logger = opts.logger ?? createNoopLogger();
  }

  append(
    _spark: SparkId,
    _run: string,
    _body: TranscriptBody,
  ): SparkTranscriptKnownLine | undefined {
    this.#logger.debug("fieldd.transcripts.skeleton", "not built yet");
    return undefined;
  }

  read(_spark: SparkId, _run: string): TranscriptRead {
    throw new Error("TH-1: the transcript store is not built yet");
  }

  runs(_spark: SparkId): TranscriptRuns {
    throw new Error("TH-1: the transcript store is not built yet");
  }

  secret(): Buffer {
    throw new Error("TH-1: the transcript store is not built yet");
  }
}

/** What the recorder hears a run by: puppeteer's Agent, its one `.on(...)` surface and its monitor. */
export type TranscriptAgent = Pick<Agent, "on" | "monitor">;

export interface SparkRunEntered {
  readonly agent: TranscriptAgent;
  readonly spark: SparkId;
  readonly runtimeRunId: string;
  readonly begun: SparkRunBegun;
}

export class SparkTranscriptRecorder {
  constructor(
    readonly store: SparkTranscripts,
    readonly logger: Logger = createNoopLogger(),
  ) {}

  entered(_run: SparkRunEntered): void {}

  expectPrompt(_runtimeRunId: string, _text: string): void {}

  said(
    _spark: SparkId,
    _runtimeRunId: string,
    _say: {
      readonly text: string;
      readonly input: string;
      readonly requestId: string;
      readonly state: string;
      readonly chips?: readonly ComposeSayChip[] | undefined;
    },
  ): void {}

  outcome(_runtimeRunId: string, _of: string, _state: string, _reason?: string): void {}

  act(_spark: SparkId, _runtimeRunId: string, _what: string, _text: string): void {}

  served(_runtimeRunId: string): void {}
}
