import type { Logger } from "@vibefield/logging";
import type { ServeSpec, ServeState } from "../mesh-client";
import { RouteServeDriver } from "../route-serve";

// SP-7a (red) — the transcript worker's routed serve: a skeleton the rows load. It publishes nothing and names no
// endpoint yet.

export const TRANSCRIPT_SERVE_ID = "spark-transcripts" as const;

export function transcriptServeSpec(_input: {
  port: number | undefined;
  linkedLogin: string | null;
}): ServeSpec | null {
  return null;
}

export interface TranscriptServeDriverOptions {
  port: () => number | undefined;
  linkedLogin: () => string | null;
  declare: (spec: ServeSpec | null) => Promise<boolean>;
  serves?: () => readonly ServeState[];
  logger?: Logger;
}

export class TranscriptServeDriver extends RouteServeDriver {
  constructor(opts: TranscriptServeDriverOptions) {
    super({
      desired: () => null,
      declare: opts.declare,
      log: {
        declared: "fieldd.transcripts.serve.declared",
        deferred: "fieldd.transcripts.serve.declare_deferred",
        declaredMessage: "",
        withdrawnMessage: "",
        deferredMessage: "",
      },
    });
  }
}

export function transcriptEndpointFrom(
  _serves: readonly ServeState[],
  _port: number | undefined,
): string | undefined {
  return undefined;
}
