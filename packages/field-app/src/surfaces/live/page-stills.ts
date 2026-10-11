// THE PAGES' LAST STILLS, KEPT (PT-5b ruling 1) — a pane with no page shows what it last showed. The still is the HOST's: the
// desk's `LIVE` service takes it off its own writer (still-taker.ts), keeps it here and shows it (desk-live.ts); a plugin
// never touches a frame (PA-22). And it STAYS ON THIS DEVICE: a page's pixels may be private, so a still is never in the
// document, never synced, never in a log, a diagnostic or a support snapshot — it lives on the renderer's byte store's
// KEYED shelf (field/desk/desk-blobs.ts: the origin's private file system), and nothing here says its bytes or its address
// to anything but that shelf.
//  - ITS NAME: `page.<document>.<object>` — the document's id and the object's durable key, each as it is where it is a plain
//    name (a UUID, a `peer-counter` key: both are), else a digest of it. A document's stills share a prefix
//    (`docStillPrefix`), which is how they are forgotten with it.
//  - WHAT IS KEPT: ONE container a still — the picture's encoded bytes behind a small header that says what it is a
//    photograph OF: the ADDRESS the page was at, its LOGICAL size (the pane's density law must hold for a still), the
//    picture's own size and type, when it was taken. One file, replaced whole: a still and its address can never be torn
//    apart (the shelf writes a file and its type separately; this needs no second file).
//  - THE BOUND: `PAGE_STILLS_MAX_BYTES` a device (64 MB). Held at each keep: the shelf's index is read (the directory
//    itself — desk-blobs `list`) and the OLDEST stills are forgotten first until what is kept fits; the one just kept is
//    never the one forgotten. A trim that fails (the shelf could not be listed) is that keep's alone: the next one trims.
//  - THE SWEEP (PT-5b2 ruling 2): a deleted pane's still is forgotten when its page's grace lapses — by a timer in the
//    LIVE service's memory, which a reload, a quit or a board's close inside that minute takes away. So when a document
//    is OPEN AND WHOLE (use-workspace-session.ts: this device's own saved copy, its journal applied — nothing of it can
//    "not have arrived yet") the stills under its prefix that no STANDING object's name makes are forgotten: a name is
//    made of the object's key through `part` (plain, or its digest), so the standing objects' names are the whole truth
//    for both — no digest is ever read back.

import { deskBlobs, type KeptEntry } from "../../field/desk/desk-blobs";

/** Every page still's name begins so. */
export const PAGE_STILL_PREFIX = "page.";
/** The container's media type on the shelf. */
export const PAGE_STILL_TYPE = "application/x-vibefield-page-still";
/** A still's longest side, px — a held page's 2560 × 1600 is kept at 1600 × 1000. */
export const PAGE_STILL_MAX_PX = 1600;
/** What a device keeps of page stills, at most. */
export const PAGE_STILLS_MAX_BYTES = 64 * 1024 * 1024;

/** A page's last still: a photograph of ONE address. */
export interface PageStill {
  /** The address the page was at when it was photographed. */
  readonly address: string;
  /** The page's LOGICAL size then (its CSS viewport), and the picture's own size, px. */
  readonly logical: readonly [number, number];
  readonly size: readonly [number, number];
  /** The picture: its media type and its encoded bytes. */
  readonly type: string;
  readonly image: Uint8Array<ArrayBuffer>;
  /** When it was taken, ms since the epoch. */
  readonly takenAt: number;
}

/** The keyed shelf as the stills use it (the desk's byte store's). */
export interface StillShelf {
  keep(key: string, bytes: Uint8Array<ArrayBuffer>, type: string): Promise<void>;
  kept(
    key: string,
  ): Promise<{ readonly bytes: Uint8Array<ArrayBuffer>; readonly type: string } | undefined>;
  forget(key: string): Promise<void>;
  list(prefix: string): Promise<readonly KeptEntry[]>;
}

const MAGIC = [0x56, 0x46, 0x50, 0x53] as const; // "VFPS"
const VERSION = 1;
const HEAD = 9; // the magic, the version, the header's length (u32, little-endian)
/** The longest header read back (an address is at most a few thousand characters). */
const HEADER_MAX = 64 * 1024;

const whole = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const pair = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && whole(v[0]) && whole(v[1]);

/** A still as ONE run of bytes: the header, then the picture. */
export function packStill(still: PageStill): Uint8Array<ArrayBuffer> {
  const header = new TextEncoder().encode(
    JSON.stringify({
      address: still.address,
      logical: [still.logical[0], still.logical[1]],
      size: [still.size[0], still.size[1]],
      type: still.type,
      takenAt: still.takenAt,
    }),
  );
  const out = new Uint8Array(HEAD + header.byteLength + still.image.byteLength);
  out.set(MAGIC, 0);
  out[4] = VERSION;
  new DataView(out.buffer).setUint32(5, header.byteLength, true);
  out.set(header, HEAD);
  out.set(still.image, HEAD + header.byteLength);
  return out;
}

/** A still read back — or undefined for bytes that are not one whole (another version, a torn file): never half a still. */
export function unpackStill(bytes: Uint8Array): PageStill | undefined {
  if (bytes.byteLength < HEAD || MAGIC.some((b, i) => bytes[i] !== b) || bytes[4] !== VERSION)
    return undefined;
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(5, true);
  if (length < 2 || length > HEADER_MAX || HEAD + length >= bytes.byteLength) return undefined;
  let said: unknown;
  try {
    said = JSON.parse(new TextDecoder().decode(bytes.subarray(HEAD, HEAD + length)));
  } catch {
    return undefined;
  }
  if (typeof said !== "object" || said === null) return undefined;
  const { address, logical, size, type, takenAt } = said as Record<string, unknown>;
  if (typeof address !== "string" || address.length === 0) return undefined;
  if (!pair(logical) || !pair(size)) return undefined;
  // (PT-5b2: a still is at most `PAGE_STILL_MAX_PX` on its long side — a container that says more is none this desk kept)
  if (Math.max(size[0], size[1]) > PAGE_STILL_MAX_PX) return undefined;
  if (typeof type !== "string" || !/^image\/[a-z0-9.+-]{1,40}$/.test(type)) return undefined;
  if (typeof takenAt !== "number" || !Number.isFinite(takenAt)) return undefined;
  return {
    address,
    logical: [logical[0], logical[1]],
    size: [size[0], size[1]],
    type,
    image: bytes.slice(HEAD + length) as Uint8Array<ArrayBuffer>,
    takenAt,
  };
}

/** A part of a name as it is, where it is a plain one — else a digest of it (two 64-bit FNV-1a passes, 32 hex). */
function part(text: string): string {
  if (/^[A-Za-z0-9_-]{1,48}$/.test(text)) return text;
  const pass = (seed: bigint): string => {
    let h = seed;
    for (let i = 0; i < text.length; i += 1) {
      h ^= BigInt(text.charCodeAt(i));
      h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    return h.toString(16).padStart(16, "0");
  };
  return `x${pass(0xcbf29ce484222325n)}${pass(0x84222325cbf29ce4n)}`;
}

/** What begins the names of a document's stills. */
export const docStillPrefix = (docId: string): string => `${PAGE_STILL_PREFIX}${part(docId)}.`;

/** The shelf's name for the still of the object `key` in the document `docId`. */
export const pageStillName = (docId: string, key: string): string =>
  `${docStillPrefix(docId)}${part(key)}`;

export interface PageStills {
  /** Keep a page's still in place of its last, then hold the bound (the oldest forgotten first). */
  keep(docId: string, key: string, still: PageStill): Promise<void>;
  /** The still kept for the object — this page's or a former launch's — or undefined. */
  kept(docId: string, key: string): Promise<PageStill | undefined>;
  /** When the object's still was last written (ms), or undefined: none kept. A witness's read. */
  keptAt(docId: string, key: string): Promise<number | undefined>;
  forget(docId: string, key: string): Promise<void>;
  /** A document deleted: every still of its panes forgotten. Answers how many. */
  forgetDocument(docId: string): Promise<number>;
  /**
   * PT-5b2 (ruling 2) — THE SWEEP: of the document's stills, those whose name no STANDING object makes are forgotten
   * (`standing`: the durable keys of the objects the document holds — the caller's word, given only for a document that
   * is open and whole). Answers how many went.
   */
  sweep(docId: string, standing: readonly string[]): Promise<number>;
  /** What the shelf keeps of page stills now. */
  usage(): Promise<{ readonly bytes: number; readonly stills: number }>;
}

export function createPageStills(
  shelf: () => StillShelf,
  opts: { readonly maxBytes?: number } = {},
): PageStills {
  const maxBytes = opts.maxBytes ?? PAGE_STILLS_MAX_BYTES;
  /** One trim at a time: two keeps landing together read one index, not two halves of it. */
  let trimming: Promise<void> = Promise.resolve();
  const trim = (spare: string): Promise<void> => {
    const run = trimming.then(async () => {
      const kept = [...(await shelf().list(PAGE_STILL_PREFIX))];
      let bytes = kept.reduce((sum, e) => sum + e.bytes, 0);
      // the oldest first; of two written in one instant, by name (a list has no order of its own)
      kept.sort((a, b) => a.modified - b.modified || (a.key < b.key ? -1 : 1));
      for (const entry of kept) {
        if (bytes <= maxBytes) break;
        if (entry.key === spare) continue;
        await shelf().forget(entry.key);
        bytes -= entry.bytes;
      }
    });
    // (PT-5b2: a trim that failed is its own keep's — the chain goes on, and the next keep holds the bound again)
    trimming = run.catch(() => undefined);
    return run;
  };
  return {
    async keep(docId, key, still) {
      const name = pageStillName(docId, key);
      await shelf().keep(name, packStill(still), PAGE_STILL_TYPE);
      // the still IS kept: a bound that could not be held this once is no failed keep
      await trim(name).catch(() => undefined);
    },
    async kept(docId, key) {
      const blob = await shelf().kept(pageStillName(docId, key));
      return blob === undefined ? undefined : unpackStill(blob.bytes);
    },
    async keptAt(docId, key) {
      const name = pageStillName(docId, key);
      return (await shelf().list(name)).find((e) => e.key === name)?.modified;
    },
    forget: (docId, key) => shelf().forget(pageStillName(docId, key)),
    async forgetDocument(docId) {
      const mine = await shelf().list(docStillPrefix(docId));
      for (const entry of mine) await shelf().forget(entry.key);
      return mine.length;
    },
    async sweep(docId, standing) {
      const stand = new Set(standing.map((key) => pageStillName(docId, key)));
      let swept = 0;
      for (const entry of await shelf().list(docStillPrefix(docId))) {
        if (stand.has(entry.key)) continue;
        await shelf().forget(entry.key);
        swept += 1;
      }
      return swept;
    },
    async usage() {
      const kept = await shelf().list(PAGE_STILL_PREFIX);
      return { bytes: kept.reduce((sum, e) => sum + e.bytes, 0), stills: kept.length };
    },
  };
}

let shared: PageStills | null = null;

/** The page's ONE keeper of page stills, over the desk's byte store's keyed shelf. */
export function pageStills(): PageStills {
  shared ??= createPageStills(deskBlobs);
  return shared;
}
