import type { DeviceInfo } from "@vibefield/contracts";
import type { Corpus, CorpusMeta, CorpusPanes } from "./corpus";
import { decodeFrameLine, encodeFrameLine, type RecordedFrame } from "./corpus-frames";

// THE CORPUS ON DISK (MV-0): JSONL. Three header lines the frame decoder skips
// (`corpus-meta`, `corpus-roster`, `corpus-panes`), then one stamped frame per
// line exactly as the recorder writes them — so a RECORDED file (the sink's
// `meta` header, then frames) decodes as a corpus with no roster and no panes,
// and a GENERATED one carries both. Gzip is the host's (`perf/lib/corpus-io.ts`).

export const CORPUS_META_KIND = "corpus-meta";
export const CORPUS_ROSTER_KIND = "corpus-roster";
export const CORPUS_PANES_KIND = "corpus-panes";

export function encodeCorpusJsonl(corpus: Corpus): string {
  const lines: string[] = [
    JSON.stringify({ kind: CORPUS_META_KIND, ...corpus.meta }),
    JSON.stringify({ kind: CORPUS_ROSTER_KIND, devices: corpus.roster }),
    JSON.stringify({ kind: CORPUS_PANES_KIND, panes: corpus.panes }),
  ];
  for (const frame of corpus.frames) lines.push(encodeFrameLine(frame));
  return `${lines.join("\n")}\n`;
}

/** A corpus with whatever headers the text carried; a recorded file has none
 * of ours, so `meta` is then the sink's header (or absent) and the roster and
 * panes are empty. Frame lines that do not decode are skipped. */
export interface DecodedCorpus {
  meta: Partial<CorpusMeta> & Record<string, unknown>;
  roster: DeviceInfo[];
  panes: CorpusPanes;
  frames: RecordedFrame[];
}

const EMPTY_PANES: CorpusPanes = { sessionIds: [], sessions: [], floor: [] };

export function decodeCorpusJsonl(text: string): DecodedCorpus {
  let meta: DecodedCorpus["meta"] = {};
  let roster: DeviceInfo[] = [];
  let panes: CorpusPanes = EMPTY_PANES;
  const frames: RecordedFrame[] = [];
  for (const line of text.split("\n")) {
    const frame = decodeFrameLine(line);
    if (frame !== undefined) {
      frames.push(frame);
      continue;
    }
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
    switch (record["kind"]) {
      case CORPUS_META_KIND:
      case "meta": {
        const { kind: _kind, ...rest } = record;
        meta = rest as DecodedCorpus["meta"];
        break;
      }
      case CORPUS_ROSTER_KIND:
        if (Array.isArray(record["devices"])) roster = record["devices"] as DeviceInfo[];
        break;
      case CORPUS_PANES_KIND:
        if (typeof record["panes"] === "object" && record["panes"] !== null) {
          panes = record["panes"] as CorpusPanes;
        }
        break;
      default:
        break;
    }
  }
  return { meta, roster, panes, frames };
}

/** A decoded corpus whose headers were ours, typed as such; throws otherwise. */
export function asGeneratedCorpus(decoded: DecodedCorpus): Corpus {
  const meta = decoded.meta;
  if (meta.generator !== "vibefield-godview-corpus" || meta.recipe === undefined) {
    throw new Error("not a generated corpus: no `corpus-meta` header with a recipe");
  }
  return {
    meta: meta as CorpusMeta,
    roster: decoded.roster,
    panes: decoded.panes,
    frames: decoded.frames,
  };
}
