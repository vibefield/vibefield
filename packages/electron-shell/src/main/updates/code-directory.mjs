// TD-4 (LP-D16, James's ruling 2026-11-05 01:04Z) — a signed Mach-O member of the native plane is digested by its CODE
// DIRECTORY, never its file bytes. A Developer ID signature embeds a CMS blob that carries a signing time and a secure
// timestamp, so the same field-native signs to different bytes every release: by bytes, every release read field-native
// "touched", and every apply asked to end the person's sessions. The CodeDirectory is what the kernel validates the code
// against: it hashes every page of the image before the signature (the header and load commands included), the
// identifier and team, and the special slots (the requirements, the entitlements); the CMS blob that signs it is not
// in it. Apple's cdhash is the CodeDirectory's own hash; this digest is the SHA-256 of the same blob, all 32 bytes.
//
// The reader is strict, and anything it does not read whole falls back to the file's bytes (today's rule), so a doubt
// can only read TOUCHED, never untouched:
//   - a thin Mach-O, 64- or 32-bit, little-endian; a universal file reads every slice, and is read by bytes unless
//     every slice is signed;
//   - exactly one LC_CODE_SIGNATURE, its SuperBlob (0xfade0cc0) ending the image (nothing after it, nothing between the
//     code and it): the CodeDirectory's codeLimit is the signature's offset, so every byte before it is a hashed page;
//   - the CodeDirectory read is the one the KERNEL enforces (its flags, identifier, team and special slots are the
//     ones that bind the running code): XNU's hashPriorities rank SHA-384 > SHA-256 > SHA-256 truncated > SHA-1, and
//     the ruling reads SHA-256 (0xfade0c02, slot 0 or an alternate at 0x1000…0x1004), so a signature carrying a
//     SHA-384 CodeDirectory reads by its bytes, and without one the reader's pick is the kernel's pick by the same
//     order. A hash type the kernel does not know, or one hash type twice (the kernel refuses both), reads by bytes.
//     The other CodeDirectories are not in the digest: the kernel enforces only the one it ranks first;
//   - that CodeDirectory's every code page is hashed again and compared, and every component the SuperBlob carries
//     beside it (requirements, entitlements, …) against its special slot. A file whose code no longer matches its
//     CodeDirectory is NOT signed for this digest: its bytes are.
//
// Errata (2026-11-05, TD-4's review): this reader first ranked SHA-256 ABOVE SHA-384 and checked the other
// CodeDirectories for their magic and length alone, so a SHA-384 CodeDirectory added beside the SHA-256 one (other
// flags, another identifier) left the digest unmoved while the kernel enforced the added one — an untouched read of a
// floor whose enforced signing changed, against this header's "a doubt can only read TOUCHED".
//
// ONE copy, two readers: main's `native-plane.ts` (the installed plane) and `scripts/release-manifest.mjs` (the release
// workflow's) import this file, so the two cannot disagree on a rule. Plain JavaScript so node runs it unbuilt, as
// `smoke-census.mjs` is (item 116); its types are `code-directory.d.mts`. Pure over bytes: it never throws.

import { createHash } from "node:crypto";

const MH_MAGIC = 0xfeedface;
const MH_MAGIC_64 = 0xfeedfacf;
const MH_CIGAM = 0xcefaedfe;
const MH_CIGAM_64 = 0xcffaedfe;
const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;
/** a universal file names at most this many slices (a Java class file shares FAT_MAGIC; its bounds refuse it) */
const FAT_MAX_ARCHS = 64;
const LC_CODE_SIGNATURE = 0x1d;
const CSMAGIC_EMBEDDED_SIGNATURE = 0xfade0cc0;
const CSMAGIC_CODEDIRECTORY = 0xfade0c02;
const CSSLOT_CODEDIRECTORY = 0;
const CSSLOT_ALTERNATE_CODEDIRECTORIES = 0x1000;
const CSSLOT_ALTERNATE_CODEDIRECTORY_COUNT = 5;
/** the CMS blob's slot: it signs the CodeDirectory, and is never part of the digest */
const CSSLOT_SIGNATURESLOT = 0x10000;
/** the fields through `spare2`: every CodeDirectory version has them */
const CD_FIXED_HEADER = 44;
const CD_EARLIEST_VERSION = 0x20001;
const CD_SUPPORTS_SCATTER = 0x20100;
const CD_SUPPORTS_CODELIMIT64 = 0x20300;

/** CS_HASHTYPE_* → node's digest and the slot size */
const HASH_TYPES = new Map([
  [1, { algorithm: "sha1", size: 20 }],
  [2, { algorithm: "sha256", size: 32 }],
  [3, { algorithm: "sha256", size: 20 }], // SHA-256, truncated
  [4, { algorithm: "sha384", size: 48 }],
]);
/** the one hash type XNU's hashPriorities rank above SHA-256: the kernel would enforce it, the ruling reads SHA-256 */
const CS_HASHTYPE_SHA384 = 4;
/** which CodeDirectory the kernel enforces when a signature carries several: XNU's hashPriorities, SHA-384 refused */
const RANK = new Map([
  [2, 3],
  [3, 2],
  [1, 1],
]);

class Unread extends Error {}
const unread = (why) => {
  throw new Unread(why);
};

const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A slot holds the digest (its first `slot.length` bytes: a truncated hash type's slot is shorter than its digest). */
function sameBytes(slot, digest) {
  for (let i = 0; i < slot.length; i++) if (slot[i] !== digest[i]) return false;
  return true;
}

/** One thin image, `bytes[start, end)`: its header's cpu, and the SHA-256 of its verified CodeDirectory. */
function readImage(bytes, view, start, end) {
  const size = end - start;
  if (size < 4) unread("not a Mach-O");
  const magic = view.getUint32(start, true);
  if (magic === MH_CIGAM || magic === MH_CIGAM_64) unread("a big-endian Mach-O");
  if (magic !== MH_MAGIC && magic !== MH_MAGIC_64) unread("not a Mach-O");
  const header = magic === MH_MAGIC_64 ? 32 : 28;
  if (size < header) unread("shorter than its Mach-O header");
  const cputype = view.getUint32(start + 4, true);
  const cpusubtype = view.getUint32(start + 8, true);
  const ncmds = view.getUint32(start + 16, true);
  const commandsEnd = header + view.getUint32(start + 20, true);
  if (commandsEnd > size) unread("its load commands run past the image");

  let signature = null;
  let at = header;
  for (let i = 0; i < ncmds; i++) {
    if (at + 8 > commandsEnd) unread("a load command past sizeofcmds");
    const cmd = view.getUint32(start + at, true);
    const cmdsize = view.getUint32(start + at + 4, true);
    if (cmdsize < 8 || at + cmdsize > commandsEnd) unread("a load command of a bad size");
    if (cmd === LC_CODE_SIGNATURE) {
      if (signature !== null) unread("two LC_CODE_SIGNATURE commands");
      if (cmdsize < 16) unread("a short LC_CODE_SIGNATURE");
      signature = {
        offset: view.getUint32(start + at + 8, true),
        size: view.getUint32(start + at + 12, true),
      };
    }
    at += cmdsize;
  }
  if (signature === null) unread("unsigned");
  // the signature ends the image: a byte after it would be in neither the code nor its signature
  if (signature.offset < commandsEnd || signature.offset + signature.size !== size)
    unread("the signature does not end the image");

  const blobs = readSuperBlob(view, start + signature.offset, signature.size);
  const directories = blobs.filter(
    (blob) =>
      blob.type === CSSLOT_CODEDIRECTORY ||
      (blob.type >= CSSLOT_ALTERNATE_CODEDIRECTORIES &&
        blob.type < CSSLOT_ALTERNATE_CODEDIRECTORIES + CSSLOT_ALTERNATE_CODEDIRECTORY_COUNT),
  );
  if (directories.length === 0) unread("a signature with no CodeDirectory");
  // every CodeDirectory is one the kernel would load, and none is one it would enforce over the SHA-256 one: so the
  // CodeDirectory read here is always the kernel's
  const hashTypes = new Set();
  let best = null;
  for (const directory of directories) {
    if (directory.magic !== CSMAGIC_CODEDIRECTORY)
      unread("a CodeDirectory slot holds another blob");
    if (directory.length < CD_FIXED_HEADER) unread("a short CodeDirectory");
    const hashType = view.getUint8(directory.start + 37);
    const hash = HASH_TYPES.get(hashType);
    if (hash === undefined || view.getUint8(directory.start + 36) !== hash.size)
      unread("a CodeDirectory of an unknown hash type");
    if (hashTypes.has(hashType)) unread("two CodeDirectories of one hash type");
    hashTypes.add(hashType);
    if (hashType === CS_HASHTYPE_SHA384) unread("a CodeDirectory the kernel ranks above SHA-256");
    const rank = RANK.get(hashType) ?? 0;
    if (best === null || rank > best.rank) best = { directory, rank };
  }
  if (best.rank === 0) unread("a CodeDirectory of an unknown hash type");
  const components = blobs.filter(
    (blob) => blob.type > CSSLOT_CODEDIRECTORY && blob.type < CSSLOT_ALTERNATE_CODEDIRECTORIES,
  );
  const hashType = verifyDirectory(
    bytes,
    view,
    start,
    signature.offset,
    best.directory,
    components,
  );
  const { start: cd, length } = best.directory;
  return { cputype, cpusubtype, hashType, cdhash: sha256Hex(bytes.subarray(cd, cd + length)) };
}

/** The embedded signature's blobs, each bounded by the SuperBlob; the CMS blob is named and left out. */
function readSuperBlob(view, at, room) {
  if (room < 12) unread("a signature too short for its SuperBlob");
  if (view.getUint32(at, false) !== CSMAGIC_EMBEDDED_SIGNATURE) unread("no embedded signature");
  const length = view.getUint32(at + 4, false);
  const count = view.getUint32(at + 8, false);
  if (length < 12 || length > room) unread("a SuperBlob past its signature");
  if (12 + count * 8 > length) unread("a SuperBlob index past its length");
  const blobs = [];
  const types = new Set();
  for (let i = 0; i < count; i++) {
    const type = view.getUint32(at + 12 + i * 8, false);
    const offset = view.getUint32(at + 16 + i * 8, false);
    if (types.has(type)) unread("a SuperBlob names a slot twice");
    types.add(type);
    if (offset < 12 + count * 8 || offset + 8 > length) unread("a blob outside its SuperBlob");
    const magic = view.getUint32(at + offset, false);
    const blobLength = view.getUint32(at + offset + 4, false);
    if (blobLength < 8 || offset + blobLength > length) unread("a blob past its SuperBlob");
    if (type === CSSLOT_SIGNATURESLOT) continue;
    blobs.push({ type, magic, start: at + offset, length: blobLength });
  }
  return blobs;
}

/** The CodeDirectory covers the image: its every code page, and each component the SuperBlob carries. */
function verifyDirectory(bytes, view, start, signatureOffset, directory, components) {
  const at = directory.start;
  const length = directory.length;
  const version = view.getUint32(at + 8, false);
  const hashOffset = view.getUint32(at + 16, false);
  const nSpecialSlots = view.getUint32(at + 24, false);
  const nCodeSlots = view.getUint32(at + 28, false);
  let codeLimit = view.getUint32(at + 32, false);
  const hashSize = view.getUint8(at + 36);
  const hashType = view.getUint8(at + 37);
  const pageBits = view.getUint8(at + 39);
  if (version < CD_EARLIEST_VERSION) unread("a CodeDirectory older than any kernel reads");
  const hash = HASH_TYPES.get(hashType);
  if (hash === undefined || hashSize !== hash.size)
    unread("a CodeDirectory of an unknown hash type");
  if (version >= CD_SUPPORTS_SCATTER) {
    if (length < 48) unread("a short CodeDirectory");
    if (view.getUint32(at + 44, false) !== 0) unread("a scattered CodeDirectory");
  }
  if (version >= CD_SUPPORTS_CODELIMIT64) {
    if (length < 64) unread("a short CodeDirectory");
    const codeLimit64 = view.getBigUint64(at + 56, false);
    if (codeLimit64 > BigInt(Number.MAX_SAFE_INTEGER)) unread("a code limit past any file");
    if (codeLimit64 !== 0n) codeLimit = Number(codeLimit64);
  }
  // every byte before the signature is a hashed page
  if (codeLimit !== signatureOffset) unread("a CodeDirectory that does not reach the signature");
  if (pageBits > 30) unread("a page size past any kernel's");
  const pageSize = pageBits === 0 ? Math.max(codeLimit, 1) : 2 ** pageBits;
  if (nCodeSlots !== Math.ceil(codeLimit / pageSize)) unread("a code slot count off its pages");
  if (hashOffset < CD_FIXED_HEADER + nSpecialSlots * hashSize)
    unread("special slots in the header");
  if (hashOffset + nCodeSlots * hashSize > length) unread("code slots past the CodeDirectory");

  const digest = (data) => createHash(hash.algorithm).update(data).digest();
  const slot = (index) =>
    bytes.subarray(at + hashOffset + index * hashSize, at + hashOffset + (index + 1) * hashSize);
  for (let page = 0; page < nCodeSlots; page++) {
    const from = start + page * pageSize;
    const to = start + Math.min((page + 1) * pageSize, codeLimit);
    if (!sameBytes(slot(page), digest(bytes.subarray(from, to))))
      unread(`code page ${page} does not match its CodeDirectory`);
  }
  for (const component of components) {
    if (component.type > nSpecialSlots)
      unread(`a component (slot ${component.type}) the CodeDirectory does not bind`);
    const data = bytes.subarray(component.start, component.start + component.length);
    if (!sameBytes(slot(-component.type), digest(data)))
      unread(`a component (slot ${component.type}) does not match its CodeDirectory`);
  }
  return hashType;
}

/**
 * The file's code signature as this digest reads it: every image signed and verified (`signed`), or why it is read by
 * its bytes. Never throws.
 */
export function readCodeSignature(bytes) {
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const fat = bytes.byteLength >= 4 ? view.getUint32(0, false) : 0;
    if (fat !== FAT_MAGIC && fat !== FAT_MAGIC_64)
      return {
        signed: true,
        universal: false,
        slices: [readImage(bytes, view, 0, bytes.byteLength)],
      };
    const count = bytes.byteLength >= 8 ? view.getUint32(4, false) : 0;
    const entry = fat === FAT_MAGIC_64 ? 32 : 20;
    const table = 8 + count * entry;
    if (count === 0 || count > FAT_MAX_ARCHS || table > bytes.byteLength)
      unread("not a universal binary");
    const slices = [];
    for (let i = 0; i < count; i++) {
      const at = 8 + i * entry;
      const offset =
        fat === FAT_MAGIC_64
          ? Number(view.getBigUint64(at + 8, false))
          : view.getUint32(at + 8, false);
      const size =
        fat === FAT_MAGIC_64
          ? Number(view.getBigUint64(at + 16, false))
          : view.getUint32(at + 12, false);
      if (offset < table || offset + size > bytes.byteLength) unread("a slice outside the file");
      slices.push(readImage(bytes, view, offset, offset + size));
    }
    return { signed: true, universal: true, slices };
  } catch (error) {
    if (error instanceof Unread) return { signed: false, why: error.message };
    return {
      signed: false,
      why: `unreadable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * A native-plane member's digest: its cdhash when it is a signed Mach-O (a universal file's, the sha256 over its
 * slices' sorted `cputype/cpusubtype\0cdhash` lines), else the sha256 of its bytes.
 */
export function memberDigest(bytes) {
  const read = readCodeSignature(bytes);
  if (!read.signed) return { by: "bytes", digest: sha256Hex(bytes), why: read.why };
  const [only] = read.slices;
  if (!read.universal && only !== undefined) return { by: "cdhash", digest: only.cdhash };
  const lines = read.slices.map((slice) => `${slice.cputype}/${slice.cpusubtype}\0${slice.cdhash}`);
  return { by: "cdhash", digest: sha256Hex(lines.sort().join("\n")) };
}

/**
 * A member's line in the plane's digest (the plane's digest is the sha256 of its sorted lines, joined by "\n"):
 * `path\0cdhash:<hex>` for a signed Mach-O, `path\0<sha256 of the bytes>` otherwise — an unsigned plane's lines are
 * the ones the byte rule wrote.
 */
export function memberLine(path, bytes) {
  return lineOf(path, memberDigest(bytes));
}

/** `memberLine` from a digest already read (the release workflow's hasher also says how it read each member). */
export function lineOf(path, member) {
  return `${path}\0${member.by === "cdhash" ? "cdhash:" : ""}${member.digest}`;
}
