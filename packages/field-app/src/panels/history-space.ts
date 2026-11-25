import { IndexStatus } from "@vibefield/contracts/agent-index";
import type { FielddClient } from "@vibefield/fieldd-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatBytes } from "../format/bytes";
import type { HistorySpaceFacts } from "../frame/HistorySpace";

// WHAT HISTORY KEEPS, AS SETTINGS → HISTORY READS IT (track HD, HD-1; DESIGN.md §8 "Settings → History": "the space
// History's copy uses on this Mac"). The measure is rosetta's own (IM-D4): `index.status` hands this desktop's own
// windows the index's `storage` and `memory`, and rosettad measures only while someone asks. The import sign's panel
// draws the same measure from the room's reading, which exists only while the room is up; this page reads the door
// itself, every few seconds while it is open. The parts' names and resting notes are the room's (rosetta-room's
// `spaceOf`), restated here because the room hands out its sign and nothing else; the sizes are said as every size
// on a Settings page is (`formatBytes`, §9: in thousands, as Finder counts).

/** What the page knows of the index's space. */
export type HistoryKept =
  /** the first reading is coming */
  | { readonly kind: "looking" }
  /** the index did not answer, or is not running */
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "read";
      /** the drawing's facts; null when the index says no measure (an older daemon, or before its first) */
      readonly space: HistorySpaceFacts | null;
      /** the four parts together, in bytes; null with `space` */
      readonly keptBytes: number | null;
      /** the index waits for consent: it reads nothing */
      readonly waiting: boolean;
      /** the profiles' own folders the record enrols: read by construction, so read again after a clear */
      readonly profiles: number;
      /** HD-7 — the agents History is reading for the first time now, by kind, each in the page's words
       * ("Importing · 188 MB read"); empty when none is */
      readonly importing: ReadonlyMap<string, string>;
    };

/** HD-7 — what a row says while its agent is read for the first time: "Importing · 188 MB read", and "Importing…"
 * before its first figure. An import is on only while the index says so (its phase is not live): a runtime's board
 * row outlives its import, so its state alone says nothing afterwards. */
export function importingOf(status: IndexStatus): ReadonlyMap<string, string> {
  const importing = new Map<string, string>();
  if (status.phase === "live" || status.phase === "awaiting_consent") return importing;
  for (const runtime of status.runtimes) {
    const backfill = runtime.backfill;
    if (runtime.provenance !== "discovered" || backfill === undefined || backfill.state === "done")
      continue;
    importing.set(
      runtime.kind,
      backfill.bytesStreamed > 0
        ? `Importing · ${formatBytes(backfill.bytesStreamed)} read`
        : "Importing…",
    );
  }
  return importing;
}

/** The drawing's facts from one status. */
export function historyKeptOf(status: IndexStatus): HistoryKept {
  // a daemon that is down answers a status with no runtimes and no measure: nothing can be said of the space
  if (status.rosettad.phase !== "ready") return { kind: "unavailable" };
  const waiting = status.phase === "awaiting_consent";
  const profiles = status.enrollment.runtimes.length;
  const importing = importingOf(status);
  const storage = status.storage;
  if (storage === undefined)
    return { kind: "read", space: null, keptBytes: null, waiting, profiles, importing };
  const inMemory = status.memory?.archiveBytes ?? null;
  const size = (bytes: number): string => (bytes > 0 ? formatBytes(bytes) : "—");
  const keptBytes =
    storage.recordBytes + storage.archiveBytes + storage.searchBytes + storage.mediaBytes;
  return {
    kind: "read",
    keptBytes,
    waiting,
    profiles,
    importing,
    space: {
      read: null,
      kept: formatBytes(keptBytes),
      inMemory: inMemory === null ? null : formatBytes(inMemory),
      memory: status.memory === undefined ? null : formatBytes(status.memory.footprintBytes),
      parts: [
        {
          key: "record",
          name: "Record",
          note: "kept for good",
          size: size(storage.recordBytes),
          disk: storage.recordBytes,
          memory: 0,
        },
        {
          key: "archive",
          name: "Archive",
          note:
            inMemory === null
              ? "what you browse · rebuilt from the record"
              : storage.archiveBytes > 0
                ? "being written to disk"
                : "in memory while the import runs",
          size: size(storage.archiveBytes + (inMemory ?? 0)),
          disk: storage.archiveBytes,
          memory: inMemory ?? 0,
        },
        {
          key: "search",
          name: "Search",
          note: "rebuilt from the archive",
          size: size(storage.searchBytes),
          disk: storage.searchBytes,
          memory: 0,
        },
        {
          key: "media",
          name: "Media",
          note: "images and files agents sent",
          size: size(storage.mediaBytes),
          disk: storage.mediaBytes,
          memory: 0,
        },
      ],
    },
  };
}

/** The page asks again this often while it is open: rosettad's own walk is paced behind its last (never under 5 s). */
const ASK_EVERY_MS = 5_000;
/** HD-7 — and this often while an agent imports: what it has read moves every second. */
const ASK_IMPORTING_MS = 2_000;
const ASK_TIMEOUT_MS = 5_000;

/** The index's space while the page is open, and a way to ask now (after a clear, after a switch). */
export function useHistoryKept(client: FielddClient): { kept: HistoryKept; askNow: () => void } {
  const [kept, setKept] = useState<HistoryKept>({ kind: "looking" });
  const ask = useRef<() => void>(() => undefined);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let asking = false;
    let every = ASK_EVERY_MS;
    const once = async (): Promise<void> => {
      if (asking) return;
      asking = true;
      try {
        const status = IndexStatus.parse(
          await client.request("index.status", {}, { timeoutMs: ASK_TIMEOUT_MS }),
        );
        const next = historyKeptOf(status);
        // an index that is still looking for an agent just turned on is about to import, too
        every =
          (next.kind === "read" && next.importing.size > 0) || status.phase === "discovering"
            ? ASK_IMPORTING_MS
            : ASK_EVERY_MS;
        if (!stopped) setKept(next);
      } catch {
        if (!stopped) setKept({ kind: "unavailable" });
      } finally {
        asking = false;
        if (!stopped) {
          clearTimeout(timer);
          timer = setTimeout(() => void once(), every);
        }
      }
    };
    ask.current = () => void once();
    void once();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ask.current = () => undefined;
    };
  }, [client]);
  const askNow = useCallback(() => ask.current(), []);
  return { kept, askNow };
}
