// TD-4 test fixture — a minimal signed Mach-O, built in memory and laid out as codesign lays one: the header, one
// LC_CODE_SIGNATURE, the code, then the signature's reserved space holding the SuperBlob (0xfade0cc0) — a version
// 0x20400 CodeDirectory per hash type (slot 0, then the alternates from 0x1000), the requirements (slot 2), the
// entitlements when given (slot 5), and the CMS blob (0x10000) — padded with zeros to the reserve. Every hash in the
// CodeDirectory is the real one, so the reader's verification runs on it. A universal file wraps thin images in a
// FAT_MAGIC table. No real binary is checked in: the bytes under test are exactly the ones the rule reads.

import { createHash } from "node:crypto";

export const CPU_ARM64 = 0x0100000c;
export const CPU_X86_64 = 0x01000007;

export interface Signing {
  /** the CMS blob's contents: what a signing time and a secure timestamp change, never the code */
  readonly cms?: string;
  readonly identifier?: string;
  readonly team?: string;
  /** an entitlements plist, carried as its own blob (slot 5) and bound by special slot 5 */
  readonly entitlements?: string;
  /** the CodeDirectories' hash types in slot order: the first at slot 0, the rest alternates from 0x1000 */
  readonly hashTypes?: readonly (1 | 2)[];
  /** LC_CODE_SIGNATURE's datasize: the space codesign reserves for the SuperBlob (zeros after it) */
  readonly reserve?: number;
  /** log2 of the code page size (codesign's 4 KiB) */
  readonly pageBits?: number;
}

export interface Image {
  readonly bytes: Buffer;
  /** the CodeDirectory blobs, in slot order (none when unsigned) */
  readonly directories: readonly Buffer[];
}

const HASHES = {
  1: { algorithm: "sha1", size: 20 },
  2: { algorithm: "sha256", size: 32 },
} as const;
const CD_HEADER = 88; // a version 0x20400 CodeDirectory's fields, through execSegFlags

function blob(magic: number, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(magic, 0);
  head.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([head, body]);
}

function codeDirectory(
  image: Buffer,
  hashType: 1 | 2,
  components: ReadonlyMap<number, Buffer>,
  signing: Signing,
): Buffer {
  const { algorithm, size } = HASHES[hashType];
  const pageBits = signing.pageBits ?? 12;
  const pageSize = 2 ** pageBits;
  const nCodeSlots = Math.ceil(image.length / pageSize);
  const nSpecialSlots = Math.max(0, ...components.keys());
  const identifier = Buffer.from(`${signing.identifier ?? "field-native"}\0`);
  const team = Buffer.from(`${signing.team ?? "TEAMID0001"}\0`);
  const identOffset = CD_HEADER;
  const teamOffset = identOffset + identifier.length;
  const hashOffset = teamOffset + team.length + nSpecialSlots * size;
  const length = hashOffset + nCodeSlots * size;
  const cd = Buffer.alloc(length);
  cd.writeUInt32BE(0xfade0c02, 0);
  cd.writeUInt32BE(length, 4);
  cd.writeUInt32BE(0x20400, 8);
  cd.writeUInt32BE(0x10000, 12); // flags: the hardened runtime
  cd.writeUInt32BE(hashOffset, 16);
  cd.writeUInt32BE(identOffset, 20);
  cd.writeUInt32BE(nSpecialSlots, 24);
  cd.writeUInt32BE(nCodeSlots, 28);
  cd.writeUInt32BE(image.length, 32); // codeLimit: the signature's offset
  cd.writeUInt8(size, 36);
  cd.writeUInt8(hashType, 37);
  cd.writeUInt8(pageBits, 39);
  // 40 spare2 · 44 scatterOffset (none) · 52 spare3 · 56 codeLimit64 (0: the 32-bit limit stands) · 64 execSegBase
  cd.writeUInt32BE(teamOffset, 48);
  cd.writeBigUInt64BE(BigInt(image.length), 72); // execSegLimit
  cd.writeBigUInt64BE(1n, 80); // execSegFlags: CS_EXECSEG_MAIN_BINARY
  identifier.copy(cd, identOffset);
  team.copy(cd, teamOffset);
  const hash = (data: Buffer) => createHash(algorithm).update(data).digest().subarray(0, size);
  for (const [slot, component] of components) hash(component).copy(cd, hashOffset - slot * size);
  for (let page = 0; page < nCodeSlots; page++)
    hash(image.subarray(page * pageSize, (page + 1) * pageSize)).copy(cd, hashOffset + page * size);
  return cd;
}

function superBlob(slots: readonly (readonly [number, Buffer])[]): Buffer {
  const index = Buffer.alloc(12 + slots.length * 8);
  index.writeUInt32BE(0xfade0cc0, 0);
  let offset = index.length;
  slots.forEach(([type, data], i) => {
    index.writeUInt32BE(type, 12 + i * 8);
    index.writeUInt32BE(offset, 16 + i * 8);
    offset += data.length;
  });
  index.writeUInt32BE(offset, 4);
  index.writeUInt32BE(slots.length, 8);
  return Buffer.concat([index, ...slots.map(([, data]) => data)]);
}

/** A thin 64-bit little-endian Mach-O executable; `signing: null` leaves it unsigned (no LC_CODE_SIGNATURE). */
export function machO(
  code: string | Uint8Array,
  signing: Signing | null = {},
  cputype = CPU_ARM64,
): Image {
  const body = typeof code === "string" ? Buffer.from(code) : Buffer.from(code);
  const header = Buffer.alloc(32);
  header.writeUInt32LE(0xfeedfacf, 0);
  header.writeUInt32LE(cputype, 4);
  header.writeUInt32LE(2, 12); // MH_EXECUTE
  header.writeUInt32LE(signing === null ? 0 : 1, 16);
  header.writeUInt32LE(signing === null ? 0 : 16, 20);
  if (signing === null) return { bytes: Buffer.concat([header, body]), directories: [] };

  const codeLimit = Math.ceil((header.length + 16 + body.length) / 16) * 16;
  const reserve = signing.reserve ?? 8192;
  const command = Buffer.alloc(16);
  command.writeUInt32LE(0x1d, 0); // LC_CODE_SIGNATURE
  command.writeUInt32LE(16, 4);
  command.writeUInt32LE(codeLimit, 8);
  command.writeUInt32LE(reserve, 12);
  const image = Buffer.alloc(codeLimit);
  Buffer.concat([header, command, body]).copy(image);

  const components = new Map<number, Buffer>([[2, blob(0xfade0c01, Buffer.alloc(4))]]); // no requirements
  if (signing.entitlements !== undefined)
    components.set(5, blob(0xfade7171, Buffer.from(signing.entitlements)));
  const options: Signing = signing;
  const hashTypes: readonly (1 | 2)[] = signing.hashTypes ?? [2];
  const directories = hashTypes.map((hashType) =>
    codeDirectory(image, hashType, components, options),
  );
  const cms = blob(0xfade0b01, Buffer.from(signing.cms ?? "CMS: signed 2026-11-05T01:00:00Z"));
  const slots: (readonly [number, Buffer])[] = [
    ...directories.map((cd, i) => [i === 0 ? 0 : 0x1000 + i - 1, cd] as const),
    ...components,
    [0x10000, cms] as const,
  ];
  const signature = superBlob(slots.sort((a, b) => a[0] - b[0]));
  if (signature.length > reserve)
    throw new Error(`the SuperBlob (${signature.length}) outgrew its reserve`);
  const reserved = Buffer.alloc(reserve);
  signature.copy(reserved);
  return { bytes: Buffer.concat([image, reserved]), directories };
}

/** A universal file: a FAT_MAGIC table, then each image at a 16 KiB boundary. */
export function universal(images: readonly Image[]): Buffer {
  const align = 14;
  const table = Buffer.alloc(8 + images.length * 20);
  table.writeUInt32BE(0xcafebabe, 0);
  table.writeUInt32BE(images.length, 4);
  const parts: Buffer[] = [table];
  let offset = table.length;
  images.forEach(({ bytes }, i) => {
    const start = Math.ceil(offset / 2 ** align) * 2 ** align;
    parts.push(Buffer.alloc(start - offset), bytes);
    const entry = 8 + i * 20;
    table.writeUInt32BE(bytes.readUInt32LE(4), entry); // cputype
    table.writeUInt32BE(bytes.readUInt32LE(8), entry + 4); // cpusubtype
    table.writeUInt32BE(start, entry + 8);
    table.writeUInt32BE(bytes.length, entry + 12);
    table.writeUInt32BE(align, entry + 16);
    offset = start + bytes.length;
  });
  return Buffer.concat(parts);
}
