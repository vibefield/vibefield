import { type BlobStore, hashBytes, type StoredBlob } from "@vibecook/ice/desk/kit";
import { getRendererLogger } from "../../logging";

// THE DESK'S BYTE STORE (DK-3; DK-D21 ruled 2 Oct): renderer-local and CONTENT-ADDRESSED — a print's
// picture goes by the SHA-256 of its bytes (`hashBytes`, the name every desk store must give), kept in
// the origin-private file system under `vibefield-desk-blobs/`: the bytes in `<hash>`, their media type
// beside them in `<hash>.type`. Memory holds what this page has met; OPFS keeps it across launches.
// The cross-device half is the upload plane's (Phase 6): a print whose bytes live on another desktop
// names a hash this store does not hold, and the desk draws that print's paper alone — the honest
// "elsewhere" face (ICE's photo kind with no blob). Bytes never ride JSON-RPC (EL2): nothing here
// talks to fieldd.
//
// BESIDE the content-addressed bytes, a KEYED shelf (DK-4, DK-D27): bytes a key names and REPLACES —
// the explorer's stills, one per document id, in `vibefield-desk-blobs/keyed/<key>` (+ `.type`). A
// still is retaken every time its board settles, so keying it by content would keep every one it ever
// was; keyed, a board holds one picture, and a new one takes its place.

const DIR = "vibefield-desk-blobs";
const KEYED = "keyed";
const HASH = /^[0-9a-f]{64}$/;
/** A key names one file on the shelf: letters, digits, `.`, `_`, `-` — never a path. */
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UNTYPED = "application/octet-stream";

export type DeskBlobPersistence = "opfs" | "memory";

export interface DeskBlobStore extends BlobStore {
  /** Where the bytes outlive the page: `opfs`, or `memory` where the origin has no file system (a
   * test, an origin that refused it) — resolved on first use. */
  persistence(): Promise<DeskBlobPersistence>;
  /** Hashes held in memory now (a witness, not an index of what OPFS keeps). */
  size(): number;
  /** Keep `bytes` under `key` on the keyed shelf, in place of what it held. A key that is not a plain
   * name throws. */
  keep(key: string, bytes: Uint8Array<ArrayBuffer>, type: string): Promise<void>;
  /** What the shelf keeps under `key` — this page's or a former launch's — or undefined. */
  kept(key: string): Promise<StoredBlob | undefined>;
}

type DirectorySource = () => Promise<FileSystemDirectoryHandle | undefined>;

/** The origin's file system root, or undefined where there is none. */
const opfsRoot: DirectorySource = async () => {
  const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
  if (storage === undefined || typeof storage.getDirectory !== "function") return undefined;
  return storage.getDirectory();
};

export function createDeskBlobStore(opts: { root?: DirectorySource } = {}): DeskBlobStore {
  const memory = new Map<string, StoredBlob>();
  const shelf = new Map<string, StoredBlob>();
  const log = getRendererLogger().child({ component: "desk.blobs" });
  let directory: Promise<FileSystemDirectoryHandle | undefined> | null = null;
  let keyedDirectory: Promise<FileSystemDirectoryHandle | undefined> | null = null;

  const dir = (): Promise<FileSystemDirectoryHandle | undefined> => {
    directory ??= (async () => {
      try {
        const root = await (opts.root ?? opfsRoot)();
        return root === undefined
          ? undefined
          : await root.getDirectoryHandle(DIR, { create: true });
      } catch (error) {
        log.warn(
          "renderer.desk.blobs_memory_only",
          "The desk's byte store keeps prints in memory only",
          {
            error: String(error),
          },
        );
        return undefined;
      }
    })();
    return directory;
  };

  const write = async (
    at: FileSystemDirectoryHandle,
    name: string,
    data: Uint8Array<ArrayBuffer> | string,
  ): Promise<void> => {
    const handle = await at.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
  };

  /** The keyed shelf's directory inside the store's, made on first use. */
  const keyedDir = (): Promise<FileSystemDirectoryHandle | undefined> => {
    keyedDirectory ??= (async () => {
      const at = await dir();
      if (at === undefined) return undefined;
      try {
        return await at.getDirectoryHandle(KEYED, { create: true });
      } catch (error) {
        log.warn("renderer.desk.blobs_keyed_memory_only", "The desk's keyed shelf is memory only", {
          error: String(error),
        });
        return undefined;
      }
    })();
    return keyedDirectory;
  };

  /** A file and its `.type` beside it, from one directory. */
  const readFrom = async (
    at: FileSystemDirectoryHandle | undefined,
    name: string,
  ): Promise<StoredBlob | undefined> => {
    if (at === undefined) return undefined;
    try {
      const file = await (await at.getFileHandle(name)).getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      let type = UNTYPED;
      try {
        type = await (await (await at.getFileHandle(`${name}.type`)).getFile()).text();
      } catch {
        // bytes without their type: still the picture; the decoder sniffs it
      }
      return { bytes, type };
    } catch (error) {
      if ((error as { name?: string }).name !== "NotFoundError") {
        log.warn("renderer.desk.blob_read_failed", "A print's bytes could not be read", {
          name,
          error: String(error),
        });
      }
      return undefined;
    }
  };

  const read = async (hash: string): Promise<StoredBlob | undefined> => readFrom(await dir(), hash);

  const keyOf = (key: string): string => {
    if (!KEY.test(key)) throw new Error(`desk blobs: "${key}" is not a key the shelf can name`);
    return key;
  };

  return {
    async put(bytes, type) {
      const hash = await hashBytes(bytes);
      if (memory.has(hash)) return hash;
      memory.set(hash, { bytes: bytes.slice(), type });
      const at = await dir();
      if (at !== undefined) {
        try {
          await write(at, hash, bytes);
          await write(at, `${hash}.type`, type);
        } catch (error) {
          log.warn("renderer.desk.blob_write_failed", "A print's bytes were kept in memory only", {
            hash,
            error: String(error),
          });
        }
      }
      return hash;
    },
    async get(hash) {
      if (!HASH.test(hash)) return undefined;
      const held = memory.get(hash);
      if (held !== undefined) return held;
      const found = await read(hash);
      if (found !== undefined) memory.set(hash, found);
      return found;
    },
    persistence: async () => ((await dir()) === undefined ? "memory" : "opfs"),
    size: () => memory.size,
    async keep(key, bytes, type) {
      const name = keyOf(key);
      shelf.set(name, { bytes: bytes.slice(), type });
      const at = await keyedDir();
      if (at === undefined) return;
      try {
        await write(at, name, bytes);
        await write(at, `${name}.type`, type);
      } catch (error) {
        log.warn("renderer.desk.blob_keep_failed", "A kept picture stayed in memory only", {
          key: name,
          error: String(error),
        });
      }
    },
    async kept(key) {
      const name = keyOf(key);
      const held = shelf.get(name);
      if (held !== undefined) return held;
      const found = await readFrom(await keyedDir(), name);
      if (found !== undefined) shelf.set(name, found);
      return found;
    },
  };
}

let shared: DeskBlobStore | null = null;

/** The page's ONE store: the layer reads it, the seed and every print write it. */
export function deskBlobs(): DeskBlobStore {
  shared ??= createDeskBlobStore();
  return shared;
}
