import type { AgentModelMeshFrame, AgentModelMeshOpen } from "@vibefield/contracts";
import type { CorpusMeta, ResolvedCorpusRecipe } from "./corpus";
import type { FrameStamp } from "./corpus-frames";

// THE MODEL STREAM (MV-3c, build-mv M30) — what the window's ONE door
// (`agent.subscribe {projection: "model", scope: "mesh"}`, MV-D18) would have
// answered while a corpus played: the open, then every per-device frame, each
// stamped on the corpus's own timeline.
//
// A corpus (`corpus.ts`) is what TODAY's seam receives: whole fold boards at
// 16 ms and the desk's mesh board. After MV-3b the window receives the model
// instead, computed beside the runtime by the backend fieldd hosts. The paired
// harness must hand B the model the way it hands A the fold, so B measures the
// renderer alone, as A does. The stream is therefore computed OFFLINE, in Node,
// by fieldd's own code (`perf/lib/model-stream.ts`: the hosted backend and its
// host port per desktop, the model board, the peer's desk cut, the mesh relay),
// and replayed in the page into the window adapter (`model-replay-client.ts`).
//
// One stream belongs to one corpus: `meta.corpus` and `meta.corpusFrames` name
// it, and every frame says which corpus frame it follows on the live wire
// (`after`, the corpus frame's `seq`; 0 = before the corpus's first). A player
// interleaves the two by it: a fold frame and the model frame of the same
// instant arrive in the order the daemon would have sent them, and the mark
// lands right before the model frame that carries the marker's change, so
// change-to-pixel latency is timed from the same moment in both arms — the
// frame carrying the change being handed to the renderer.
//
// JSONL like the corpus: a `model-stream-meta` header, then one stamped frame
// per line. Renderer-safe (the player decodes it in the page); gzip is the
// host's (`perf/lib/corpus-io.ts`).

export const MODEL_STREAM_GENERATOR = "vibefield-godview-model-stream";
export const MODEL_STREAM_VERSION = 1;
export const MODEL_STREAM_META_KIND = "model-stream-meta";

export type ModelStreamEvent =
  | { kind: "model-open"; open: AgentModelMeshOpen }
  | { kind: "model-frame"; frame: AgentModelMeshFrame }
  /** the corpus's mark, moved to the model frame that carries its change */
  | { kind: "mark"; name: string; detail?: Readonly<Record<string, unknown>> };

export type ModelStreamFrame = FrameStamp & ModelStreamEvent & { after: number };

export interface ModelStreamMeta {
  generator: typeof MODEL_STREAM_GENERATOR;
  version: typeof MODEL_STREAM_VERSION;
  /** the corpus this stream was computed from (`recipeName`) */
  corpus: string;
  /** that corpus's frame count: a player refuses a stream for another corpus */
  corpusFrames: number;
  recipe: ResolvedCorpusRecipe;
  here: string;
  peer: string;
  marker: CorpusMeta["marker"];
  /** the floors the stream was cut at: this desktop's model board, the peer's desk */
  floors: { model: number; desk: number };
  counts: { open: number; frames: number; marks: number; upserts: number; bytes: number };
}

export interface ModelStream {
  meta: ModelStreamMeta;
  frames: ModelStreamFrame[];
}

export function encodeModelStreamJsonl(stream: ModelStream): string {
  const lines = [JSON.stringify({ kind: MODEL_STREAM_META_KIND, ...stream.meta })];
  for (const frame of stream.frames) lines.push(JSON.stringify(frame));
  return `${lines.join("\n")}\n`;
}

const KINDS: ReadonlySet<string> = new Set(["model-open", "model-frame", "mark"]);

export interface DecodedModelStream {
  meta: Partial<ModelStreamMeta>;
  frames: ModelStreamFrame[];
}

/** Lines that are not ours are skipped, never thrown on (the corpus codec's rule). */
export function decodeModelStreamJsonl(text: string): DecodedModelStream {
  let meta: Partial<ModelStreamMeta> = {};
  const frames: ModelStreamFrame[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (typeof value !== "object" || value === null) continue;
    const record = value as Record<string, unknown>;
    if (record["kind"] === MODEL_STREAM_META_KIND) {
      const { kind: _kind, ...rest } = record;
      meta = rest as Partial<ModelStreamMeta>;
      continue;
    }
    if (
      typeof record["kind"] === "string" &&
      KINDS.has(record["kind"]) &&
      typeof record["seq"] === "number" &&
      typeof record["t"] === "number" &&
      typeof record["wall"] === "number" &&
      typeof record["after"] === "number"
    ) {
      frames.push(record as unknown as ModelStreamFrame);
    }
  }
  return { meta, frames };
}

/** `n10-8s-s1.model.jsonl.gz` beside `n10-8s-s1.jsonl.gz`. */
export function modelStreamFileName(corpus: string, gz = true): string {
  return `${corpus}.model.jsonl${gz ? ".gz" : ""}`;
}
