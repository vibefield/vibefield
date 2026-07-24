// The `.vfplugin` artifact (plugin-architecture spec §5.3.1, §5.4 item 2
// "pack", verify-item §27.10): a DETERMINISTIC zip of the §5.2 installed
// bundle (vibefield.plugin.json + dist/** + assets/**) plus its sha256 in
// the index-pin format (`sha256:<hex>`). Byte-stability is the whole point
// — the registry pins the hash and reviewers diff it, so packing the same
// tree on any machine, from any input order, MUST yield identical bytes.
//
// STORE, not deflate: artifacts are small (a manifest and a couple of
// bundled entries), and byte-stability beats bytes saved. STORE removes the
// entire nondeterminism class deflate would introduce — compression level,
// zlib stream framing, cross-version zlib drift — none of which we would
// want to have to prove stable for a hash that gets reviewed. So the writer
// compresses nothing and the reader accepts STORE only: fewer moving parts,
// a smaller install-path attack surface, and no node:zlib dependency at all.
//
// The reader is the security seam of the install path (fieldd unpacks
// registry and sideload artifacts with it): a hostile zip must never write
// outside destDir. Path traversal, absolute paths, backslash names, and
// symlink entries are refused before a single byte is written.

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

// The bundle members packed by default (spec §5.2): the manifest file and
// the two artifact trees. Everything else in a plugin's working directory
// (source, package.json, tsconfig) is not part of the installed shape.
const MANIFEST_NAME = "vibefield.plugin.json";
const BUNDLE_DIRS = ["dist", "assets"] as const;

// Fixed DOS timestamp: 1980-01-01 00:00:00 (the DOS epoch). date bits are
// (year-1980)<<9 | month<<5 | day = 0x0021; time is 0. A constant clock is
// what makes two packs of the same bytes identical.
const DOS_TIME = 0x0000;
const DOS_DATE = 0x0021;

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const LOCAL_HEADER_LEN = 30;
const CENTRAL_HEADER_LEN = 46;
const EOCD_LEN = 22;
const MAX_COMMENT = 0xffff;

// version made by / needed: 2.0, host 0 (FAT). Zero external attributes and
// no extra fields keep every header byte fixed.
const VERSION = 20;
// General-purpose bit 11: filenames are UTF-8. Set on both headers so a
// reader decodes non-ASCII entry names correctly; no other bit is used
// (no encryption, no streaming data descriptor).
const GP_FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;

/** A refusal or malformed-container failure from {@link unpackVfplugin}. */
export class VfpluginError extends Error {
  constructor(
    message: string,
    readonly code: VfpluginErrorCode,
  ) {
    super(message);
    this.name = "VfpluginError";
  }
}

export type VfpluginErrorCode =
  | "malformed"
  | "unsupported-method"
  | "crc-mismatch"
  | "absolute-path"
  | "backslash"
  | "path-traversal"
  | "symlink"
  | "directory-entry"
  | "empty-name"
  | "nul-in-name"
  | "missing-declared-entry";

export interface PackVfpluginOptions {
  /** Plugin working directory whose §5.2 members are packed. */
  rootDir: string;
  /**
   * Explicit forward-slash relative paths to pack instead of the default
   * §5.2 walk. Each must be a relative POSIX path (no `..`, no leading `/`,
   * no backslash); order is irrelevant — entries are sorted bytewise.
   */
  files?: string[];
}

export interface PackVfpluginResult {
  bytes: Buffer;
  /** `sha256:<hex>` over `bytes` — the index-pin format (§5.3.1). */
  sha256: string;
}

export interface UnpackVfpluginResult {
  /** Written entry paths, forward-slash, sorted bytewise. */
  entries: string[];
}

interface PlannedEntry {
  name: string;
  nameBytes: Buffer;
  data: Buffer;
}

// Standard PKZIP/IEEE CRC-32 (poly 0xedb88320, reflected). Computed
// bitwise: no lookup table, so nothing to index under
// noUncheckedIndexedAccess, and artifacts are small enough that it costs
// nothing.
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function bytewise(a: Buffer, b: Buffer): number {
  return Buffer.compare(a, b);
}

// Reject anything that is not a safe forward-slash relative path. Applied to
// both the writer's explicit `files` and every entry name a hostile reader
// input carries — the refusal set is the security contract in both
// directions.
function assertSafeEntryName(name: string): void {
  if (name.length === 0) throw new VfpluginError("empty entry name", "empty-name");
  if (name.includes("\u0000")) throw new VfpluginError(`NUL in entry name: ${name}`, "nul-in-name");
  if (name.includes("\\")) throw new VfpluginError(`backslash in entry name: ${name}`, "backslash");
  if (name.endsWith("/"))
    throw new VfpluginError(`directory entry not allowed: ${name}`, "directory-entry");
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name))
    throw new VfpluginError(`absolute path not allowed: ${name}`, "absolute-path");
  for (const segment of name.split("/")) {
    if (segment === "..")
      throw new VfpluginError(`path traversal not allowed: ${name}`, "path-traversal");
  }
}

function walkBundleDir(rootDir: string, subdir: string): PlannedEntry[] {
  const out: PlannedEntry[] = [];
  const recurse = (prefix: string): void => {
    const abs = join(rootDir, ...prefix.split("/"));
    for (const dirent of readdirSync(abs, { withFileTypes: true })) {
      const childName = dirent.name;
      // Dotfiles (.DS_Store, editor cruft) and node_modules never belong in
      // a distributed artifact. Symlinks are skipped, never followed: the
      // packed bytes stay confined to real files under rootDir.
      if (childName.startsWith(".") || childName === "node_modules") continue;
      if (dirent.isSymbolicLink()) continue;
      const childPath = `${prefix}/${childName}`;
      if (dirent.isDirectory()) {
        recurse(childPath);
      } else if (dirent.isFile()) {
        out.push(makeEntry(rootDir, childPath));
      }
    }
  };
  recurse(subdir);
  return out;
}

function makeEntry(rootDir: string, name: string): PlannedEntry {
  return {
    name,
    nameBytes: Buffer.from(name, "utf8"),
    data: readFileSync(join(rootDir, ...name.split("/"))),
  };
}

function collectDefaultEntries(rootDir: string): PlannedEntry[] {
  const entries: PlannedEntry[] = [];
  const manifestAbs = join(rootDir, MANIFEST_NAME);
  if (existsFile(manifestAbs)) entries.push(makeEntry(rootDir, MANIFEST_NAME));
  for (const dir of BUNDLE_DIRS) {
    if (existsDir(join(rootDir, dir))) entries.push(...walkBundleDir(rootDir, dir));
  }
  // The manifest's DECLARED entry modules always belong to the bundle — a
  // plain-JS plugin keeps them at the package root, outside dist/. An
  // artifact whose declared entry is missing would fail at INSTALL time;
  // §5.4's law is fail-at-build, so packing refuses instead.
  if (existsFile(manifestAbs)) {
    const seen = new Set(entries.map((e) => e.name));
    for (const rel of declaredEntryModules(manifestAbs)) {
      assertSafeEntryName(rel);
      if (seen.has(rel)) continue;
      if (!existsFile(join(rootDir, ...rel.split("/"))))
        throw new VfpluginError(
          `manifest declares entry ${rel} but the file does not exist`,
          "missing-declared-entry",
        );
      entries.push(makeEntry(rootDir, rel));
    }
  }
  return entries;
}

/** entries.renderer / entries.service from the manifest, normalized to the
 * zip's forward-slash form (declared as ./-relative per the contract). */
function declaredEntryModules(manifestAbs: string): string[] {
  try {
    const parsed = JSON.parse(readFileSync(manifestAbs, "utf8")) as {
      entries?: { renderer?: unknown; service?: unknown };
    };
    return [parsed.entries?.renderer, parsed.entries?.service]
      .filter((v): v is string => typeof v === "string")
      .map((v) => (v.startsWith("./") ? v.slice(2) : v));
  } catch {
    return []; // an unreadable manifest already fails validation elsewhere
  }
}

function existsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function existsDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Pack `rootDir`'s §5.2 bundle into a deterministic `.vfplugin` zip.
 *
 * Entries are sorted bytewise by their forward-slash path; every header
 * field a normal zip lets vary (timestamps, extra fields, external
 * attributes, name encoding) is fixed. Packing the same tree twice — in
 * different directories, from shuffled input — yields identical bytes and
 * an identical {@link PackVfpluginResult.sha256} (verify-item §27.10).
 */
export async function packVfplugin(opts: PackVfpluginOptions): Promise<PackVfpluginResult> {
  const entries =
    opts.files !== undefined
      ? opts.files.map((name) => {
          assertSafeEntryName(name);
          return makeEntry(opts.rootDir, name);
        })
      : collectDefaultEntries(opts.rootDir);

  entries.sort((a, b) => bytewise(a.nameBytes, b.nameBytes));

  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = Buffer.alloc(LOCAL_HEADER_LEN);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(GP_FLAG_UTF8, 6);
    local.writeUInt16LE(METHOD_STORE, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(entry.nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, entry.nameBytes, entry.data);

    const central = Buffer.alloc(CENTRAL_HEADER_LEN);
    central.writeUInt32LE(CENTRAL_SIG, 0);
    central.writeUInt16LE(VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(GP_FLAG_UTF8, 8);
    central.writeUInt16LE(METHOD_STORE, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(entry.nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, entry.nameBytes);

    offset += LOCAL_HEADER_LEN + entry.nameBytes.length + size;
  }

  const localBytes = Buffer.concat(locals);
  const centralBytes = Buffer.concat(centrals);

  const eocd = Buffer.alloc(EOCD_LEN);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(localBytes.length, 16);
  eocd.writeUInt16LE(0, 20);

  const bytes = Buffer.concat([localBytes, centralBytes, eocd]);
  const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  return { bytes, sha256 };
}

function findEocd(bytes: Buffer): number {
  if (bytes.length < EOCD_LEN) throw new VfpluginError("truncated container", "malformed");
  const earliest = Math.max(0, bytes.length - EOCD_LEN - MAX_COMMENT);
  for (let p = bytes.length - EOCD_LEN; p >= earliest; p--) {
    if (bytes.readUInt32LE(p) !== EOCD_SIG) continue;
    const commentLen = bytes.readUInt16LE(p + 20);
    if (p + EOCD_LEN + commentLen === bytes.length) return p;
  }
  throw new VfpluginError("no end-of-central-directory record", "malformed");
}

function isSymlinkAttrs(externalAttrs: number): boolean {
  // Unix mode lives in the high 16 bits of the external attributes; S_IFLNK
  // is 0xa000 under the S_IFMT (0xf000) mask. Checked regardless of the
  // host byte: a FAT-hosted entry leaves these bits zero, so a symlink mode
  // here is always a hostile signal.
  return ((externalAttrs >>> 16) & 0xf000) === 0xa000;
}

/**
 * Unpack a `.vfplugin` produced by {@link packVfplugin} into `destDir`,
 * validating the container and refusing any entry that would escape it.
 *
 * The central directory is authoritative; each entry's local header is
 * cross-checked (signature + name) and its stored CRC-32 must match the
 * bytes written. Absolute paths, `..` traversal, backslash names, directory
 * entries, and symlink modes are refused before any write. Round-trips the
 * writer byte-for-byte.
 */
export async function unpackVfplugin(
  bytes: Buffer,
  destDir: string,
): Promise<UnpackVfpluginResult> {
  const eocd = findEocd(bytes);
  const total = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (centralOffset + centralSize > eocd || centralOffset > bytes.length)
    throw new VfpluginError("central directory out of bounds", "malformed");

  const resolvedDest = resolve(destDir);
  const written: { target: string; name: string; data: Buffer }[] = [];

  let p = centralOffset;
  for (let i = 0; i < total; i++) {
    if (p + CENTRAL_HEADER_LEN > centralOffset + centralSize)
      throw new VfpluginError("central directory truncated", "malformed");
    if (bytes.readUInt32LE(p) !== CENTRAL_SIG)
      throw new VfpluginError("bad central directory signature", "malformed");

    const method = bytes.readUInt16LE(p + 10);
    const crc = bytes.readUInt32LE(p + 16);
    const compSize = bytes.readUInt32LE(p + 20);
    const uncompSize = bytes.readUInt32LE(p + 24);
    const fnLen = bytes.readUInt16LE(p + 28);
    const extraLen = bytes.readUInt16LE(p + 30);
    const commentLen = bytes.readUInt16LE(p + 32);
    const externalAttrs = bytes.readUInt32LE(p + 38);
    const localOffset = bytes.readUInt32LE(p + 42);
    const nameBytes = bytes.subarray(p + CENTRAL_HEADER_LEN, p + CENTRAL_HEADER_LEN + fnLen);
    p += CENTRAL_HEADER_LEN + fnLen + extraLen + commentLen;

    if (method !== METHOD_STORE)
      throw new VfpluginError(`unsupported compression method ${method}`, "unsupported-method");
    if (isSymlinkAttrs(externalAttrs))
      throw new VfpluginError(`symlink entry refused: ${nameBytes.toString("utf8")}`, "symlink");
    if (compSize !== uncompSize) throw new VfpluginError("stored size mismatch", "malformed");

    const name = nameBytes.toString("utf8");
    assertSafeEntryName(name);

    const target = resolve(resolvedDest, name);
    if (target !== resolvedDest && !target.startsWith(resolvedDest + sep))
      throw new VfpluginError(`entry escapes destDir: ${name}`, "path-traversal");

    // Locate the file data via the local header (its name length may differ
    // in a tampered archive, so read it from the local record) and confirm
    // the local name matches the central one before trusting the offset.
    if (
      localOffset + LOCAL_HEADER_LEN > bytes.length ||
      bytes.readUInt32LE(localOffset) !== LOCAL_SIG
    )
      throw new VfpluginError("bad local header", "malformed");
    const localFnLen = bytes.readUInt16LE(localOffset + 26);
    const localExtraLen = bytes.readUInt16LE(localOffset + 28);
    const localName = bytes.subarray(
      localOffset + LOCAL_HEADER_LEN,
      localOffset + LOCAL_HEADER_LEN + localFnLen,
    );
    if (bytewise(localName, nameBytes) !== 0)
      throw new VfpluginError("local/central name mismatch", "malformed");

    const dataStart = localOffset + LOCAL_HEADER_LEN + localFnLen + localExtraLen;
    if (dataStart + compSize > bytes.length)
      throw new VfpluginError("entry data out of bounds", "malformed");
    const data = bytes.subarray(dataStart, dataStart + compSize);
    if (data.length !== uncompSize || crc32(data) !== crc)
      throw new VfpluginError(`CRC mismatch: ${name}`, "crc-mismatch");

    written.push({ target, name, data: Buffer.from(data) });
  }

  // All entries validated before any write: a container that fails halfway
  // never leaves a partial install on disk.
  for (const { target, data } of written) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  }

  return {
    entries: written.map((w) => w.name).sort((a, b) => bytewise(Buffer.from(a), Buffer.from(b))),
  };
}
