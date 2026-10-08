import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { constants, gunzipSync, gzipSync } from "node:zlib";
import type { Corpus } from "../../src/godview/monitor/perf/corpus";
import {
  type DecodedCorpus,
  decodeCorpusJsonl,
  encodeCorpusJsonl,
} from "../../src/godview/monitor/perf/corpus-codec";
import {
  type DecodedModelStream,
  decodeModelStreamJsonl,
  encodeModelStreamJsonl,
  type ModelStream,
} from "../../src/godview/monitor/perf/model-stream";

// The corpus files (MV-0), Node side: gzip on, gzip off. A `.jsonl.gz` is the
// one shape every harness reads — generated corpora, and the files the main
// process's recording sink writes from a live renderer.

export function writeCorpusGz(path: string, corpus: Corpus): number {
  mkdirSync(dirname(path), { recursive: true });
  const bytes = gzipSync(Buffer.from(encodeCorpusJsonl(corpus), "utf8"), { level: 9 });
  writeFileSync(path, bytes);
  return bytes.byteLength;
}

export function readCorpusGz(path: string): DecodedCorpus {
  const raw = readFileSync(path);
  // `Z_SYNC_FLUSH`: a file the recording sink was still writing when its app
  // exited has every drained block and no trailer; it reads to its last flush.
  const text = path.endsWith(".gz")
    ? gunzipSync(raw, { finishFlush: constants.Z_SYNC_FLUSH }).toString("utf8")
    : raw.toString("utf8");
  return decodeCorpusJsonl(text);
}

/** The gzipped size a corpus would have on disk, without writing it. */
export function corpusGzBytes(corpus: Corpus): number {
  return gzipSync(Buffer.from(encodeCorpusJsonl(corpus), "utf8"), { level: 9 }).byteLength;
}

// MV-3c — the model stream beside its corpus (`model-stream.ts`), the same
// gzip rule: written whole at level 9, read to its last flush.

export function writeModelStreamGz(path: string, stream: ModelStream): number {
  mkdirSync(dirname(path), { recursive: true });
  const bytes = gzipSync(Buffer.from(encodeModelStreamJsonl(stream), "utf8"), { level: 9 });
  writeFileSync(path, bytes);
  return bytes.byteLength;
}

export function readModelStreamText(path: string): string {
  const raw = readFileSync(path);
  return path.endsWith(".gz")
    ? gunzipSync(raw, { finishFlush: constants.Z_SYNC_FLUSH }).toString("utf8")
    : raw.toString("utf8");
}

export function readModelStreamGz(path: string): DecodedModelStream {
  return decodeModelStreamJsonl(readModelStreamText(path));
}
