// Architecture read from the BINARY, not from its filename (distribution spec
// §7.4: "Platform/architecture is verified from binary headers, not filenames
// alone"). A path called `field-native` tells you nothing; an arm64 shell
// spawning an x64 sidecar fails at exec with a message that reads like a
// missing file, and that misdiagnosis is what this exists to prevent.
//
// Pure and dependency-free: it takes the leading bytes, so the caller owns the
// read and the tests own their fixtures.

export type ExecutableArch = "arm64" | "x64" | "unknown";
export type ExecutableFormat = "macho" | "elf" | "pe" | "unknown";

export interface ExecutableIdentity {
  readonly format: ExecutableFormat;
  readonly arch: ExecutableArch;
}

/** Enough bytes for every header field read below. */
export const EXECUTABLE_HEADER_BYTES = 64;

const u32le = (b: Uint8Array, o: number): number =>
  ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16) | ((b[o + 3] ?? 0) << 24)) >>> 0;
const u32be = (b: Uint8Array, o: number): number =>
  (((b[o] ?? 0) << 24) | ((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0)) >>> 0;
const u16le = (b: Uint8Array, o: number): number => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);

// Mach-O cpu types (mach/machine.h): the 0x01000000 bit is CPU_ARCH_ABI64.
const CPU_TYPE_X86_64 = 0x01000007;
const CPU_TYPE_ARM64 = 0x0100000c;

export function identifyExecutable(head: Uint8Array): ExecutableIdentity {
  // Mach-O 64-bit, little-endian host order (0xFEEDFACF read as LE).
  if (u32le(head, 0) === 0xfeedfacf) {
    const cpu = u32le(head, 4);
    return {
      format: "macho",
      arch: cpu === CPU_TYPE_ARM64 ? "arm64" : cpu === CPU_TYPE_X86_64 ? "x64" : "unknown",
    };
  }
  // Universal ("fat") binary: FAT_MAGIC/FAT_CIGAM, big-endian by definition.
  // Deliberately NOT resolved to a single arch — a universal sidecar satisfies
  // any host, and distribution spec EDP-22 defers universal builds anyway.
  if (u32be(head, 0) === 0xcafebabe) return { format: "macho", arch: "unknown" };
  // ELF: 0x7F 'E' 'L' 'F', e_machine at 0x12.
  if (head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) {
    const machine = u16le(head, 0x12);
    return {
      format: "elf",
      arch: machine === 0x3e ? "x64" : machine === 0xb7 ? "arm64" : "unknown",
    };
  }
  // PE: 'MZ' stub, PE header offset at 0x3C, COFF machine two bytes past "PE\0\0".
  if (head[0] === 0x4d && head[1] === 0x5a) {
    const peOffset = u32le(head, 0x3c);
    if (peOffset + 6 <= head.length) {
      const machine = u16le(head, peOffset + 4);
      return {
        format: "pe",
        arch: machine === 0x8664 ? "x64" : machine === 0xaa64 ? "arm64" : "unknown",
      };
    }
    return { format: "pe", arch: "unknown" };
  }
  return { format: "unknown", arch: "unknown" };
}

/** Node's `process.arch` vocabulary mapped onto ours; anything else is a target
 * this spec has not declared (EDP-23 keeps 32-bit and unlisted arches out). */
export function hostArch(nodeArch: string): ExecutableArch {
  return nodeArch === "arm64" ? "arm64" : nodeArch === "x64" ? "x64" : "unknown";
}

/** A sidecar is compatible when we can prove it matches, or when the evidence
 * is genuinely inconclusive (universal binary, unrecognized format). Refusing on
 * "unknown" would fail closed against artifacts that work — the wrong trade for
 * a check whose job is catching an arm64/x64 mixup. */
export function archCompatible(binary: ExecutableArch, host: ExecutableArch): boolean {
  if (binary === "unknown" || host === "unknown") return true;
  return binary === host;
}
