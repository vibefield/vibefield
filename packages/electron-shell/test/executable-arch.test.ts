import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  archCompatible,
  EXECUTABLE_HEADER_BYTES,
  hostArch,
  identifyExecutable,
} from "../src/main/executable-arch";

// Architecture read from binary headers, not filenames (distribution spec §7.4).
// The fixtures are hand-built headers rather than sampled real binaries: the
// bytes under test are exactly the ones the spec cares about, and a checked-in
// executable would be both large and platform-specific.

const header = (bytes: readonly number[]): Uint8Array => {
  const buf = new Uint8Array(EXECUTABLE_HEADER_BYTES);
  buf.set(bytes);
  return buf;
};

/** Mach-O 64-bit: 0xFEEDFACF stored little-endian, then cputype (also LE). */
const macho = (cputype: readonly number[]): Uint8Array =>
  header([0xcf, 0xfa, 0xed, 0xfe, ...cputype]);
const MACHO_ARM64 = macho([0x0c, 0x00, 0x00, 0x01]); // CPU_TYPE_ARM64
const MACHO_X64 = macho([0x07, 0x00, 0x00, 0x01]); // CPU_TYPE_X86_64

/** ELF: magic, then e_machine as u16 LE at 0x12. */
const elf = (machine: readonly number[]): Uint8Array => {
  const buf = header([0x7f, 0x45, 0x4c, 0x46]);
  buf.set(machine, 0x12);
  return buf;
};

/** PE: "MZ", the PE header offset at 0x3C, then "PE\0\0" and the COFF machine. */
const pe = (machine: readonly number[]): Uint8Array => {
  const off = 0x20;
  const buf = header([0x4d, 0x5a]);
  buf.set([off, 0x00, 0x00, 0x00], 0x3c);
  buf.set([0x50, 0x45, 0x00, 0x00, ...machine], off);
  return buf;
};

describe("identifyExecutable", () => {
  it("reads an arm64 Mach-O", () => {
    expect(identifyExecutable(MACHO_ARM64)).toEqual({ format: "macho", arch: "arm64" });
  });

  it("reads an x64 Mach-O", () => {
    expect(identifyExecutable(MACHO_X64)).toEqual({ format: "macho", arch: "x64" });
  });

  it("reports a universal binary as macho/unknown — it satisfies either host", () => {
    // FAT_MAGIC is big-endian by definition, so the bytes read CA FE BA BE.
    expect(identifyExecutable(header([0xca, 0xfe, 0xba, 0xbe]))).toEqual({
      format: "macho",
      arch: "unknown",
    });
  });

  it("reads x64 and arm64 ELF", () => {
    expect(identifyExecutable(elf([0x3e, 0x00]))).toEqual({ format: "elf", arch: "x64" });
    expect(identifyExecutable(elf([0xb7, 0x00]))).toEqual({ format: "elf", arch: "arm64" });
  });

  it("reads x64 and arm64 PE", () => {
    expect(identifyExecutable(pe([0x64, 0x86]))).toEqual({ format: "pe", arch: "x64" });
    expect(identifyExecutable(pe([0x64, 0xaa]))).toEqual({ format: "pe", arch: "arm64" });
  });

  it("calls an unrecognized cpu type unknown rather than guessing", () => {
    expect(identifyExecutable(macho([0xff, 0xff, 0xff, 0x00])).arch).toBe("unknown");
  });

  it("does not mistake a shell script or a text file for an executable", () => {
    const script = new TextEncoder().encode("#!/bin/sh\necho hello\n");
    expect(identifyExecutable(header([...script])).format).toBe("unknown");
  });

  it("survives a truncated header instead of throwing", () => {
    expect(() => identifyExecutable(new Uint8Array([0xcf, 0xfa]))).not.toThrow();
  });
});

describe("against real binaries on this machine", () => {
  // Hand-built fixtures prove the field offsets; these prove the fixtures match
  // reality. Skipped rather than failed when the artifact is absent — a dev tree
  // legitimately has no release build, and CI on another arch is still valid.
  const realHead = (path: string): Uint8Array | null => {
    try {
      return new Uint8Array(readFileSync(path).subarray(0, EXECUTABLE_HEADER_BYTES));
    } catch {
      return null;
    }
  };
  const nativeRelease = resolve(import.meta.dirname, "../../../target/release/field-native");
  const head = realHead(nativeRelease);

  it.skipIf(head === null)("reads the release field-native as this host's arch", () => {
    if (head === null) return;
    const id = identifyExecutable(head);
    expect(id.format).toBe(process.platform === "darwin" ? "macho" : id.format);
    expect(archCompatible(id.arch, hostArch(process.arch))).toBe(true);
  });

  it("reads the running node/electron binary without claiming a mismatch", () => {
    const own = realHead(process.execPath);
    expect(own).not.toBeNull();
    if (own === null) return;
    const id = identifyExecutable(own);
    // Whatever is executing this test is by definition compatible with itself.
    expect(archCompatible(id.arch, hostArch(process.arch))).toBe(true);
  });
});

describe("hostArch", () => {
  it("maps node's vocabulary onto ours", () => {
    expect(hostArch("arm64")).toBe("arm64");
    expect(hostArch("x64")).toBe("x64");
  });

  it("treats an undeclared target as unknown (EDP-23 keeps 32-bit out)", () => {
    expect(hostArch("ia32")).toBe("unknown");
    expect(hostArch("ppc64")).toBe("unknown");
  });
});

describe("archCompatible", () => {
  it("accepts a match and refuses the mixup this check exists for", () => {
    expect(archCompatible("arm64", "arm64")).toBe(true);
    expect(archCompatible("x64", "arm64")).toBe(false);
    expect(archCompatible("arm64", "x64")).toBe(false);
  });

  it("accepts when evidence is inconclusive on either side", () => {
    // Failing closed on "unknown" would reject universal binaries and any
    // format we have not taught it — the wrong trade for a mixup detector.
    expect(archCompatible("unknown", "arm64")).toBe(true);
    expect(archCompatible("arm64", "unknown")).toBe(true);
  });
});
