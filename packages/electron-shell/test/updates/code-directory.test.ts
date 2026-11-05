import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  lineOf,
  memberDigest,
  memberLine,
  readCodeSignature,
} from "../../src/main/updates/code-directory.mjs";
import { CPU_ARM64, CPU_X86_64, machO, universal } from "./macho-fixture";

// TD-4 (LP-D16, James's ruling 2026-11-05 01:04Z) — a signed Mach-O member of the native plane is digested by its
// CodeDirectory, never its bytes: a Developer ID signature's CMS blob carries a signing time and a secure timestamp, so
// the same field-native signed to new bytes every release and every apply asked to end the person's sessions. The
// images here are built in memory (`macho-fixture.ts`) with every CodeDirectory hash real; the last row holds the reader
// to codesign itself on a platform binary, on a Mac.

const sha256 = (data: Uint8Array | string): string =>
  createHash("sha256").update(data).digest("hex");
/** three 4 KiB pages of code and a tail */
const CODE = "field-native's code. ".repeat(640);

describe("the member digest: a signed Mach-O by its CodeDirectory (TD-4)", () => {
  it("is the SHA-256 of the CodeDirectory blob, all 32 bytes; its line says so", () => {
    const image = machO(CODE);
    const member = memberDigest(image.bytes);
    expect(member).toEqual({ by: "cdhash", digest: sha256(image.directories[0]!) });
    expect(memberLine("bin/field-native", image.bytes)).toBe(
      `bin/field-native\0cdhash:${member.digest}`,
    );
    expect(lineOf("bin/field-native", member)).toBe(memberLine("bin/field-native", image.bytes));
  });

  it("the same code under another CMS blob — a new signing time, a new timestamp — is the same digest", () => {
    const monday = machO(CODE, { cms: "signed Monday 01:00Z · timestamp token A" });
    const tuesday = machO(CODE, {
      cms: "signed Tuesday 01:00Z · a longer timestamp token B, its chain",
    });
    expect(sha256(tuesday.bytes)).not.toBe(sha256(monday.bytes));
    expect(memberDigest(monday.bytes).by).toBe("cdhash");
    expect(memberDigest(tuesday.bytes)).toEqual(memberDigest(monday.bytes));
  });

  it("a changed code page is another digest: re-signed, by its new CodeDirectory; left stale, by its bytes", () => {
    const before = machO(CODE);
    const rebuilt = machO(CODE.replace("code", "CODE"));
    expect(memberDigest(rebuilt.bytes).by).toBe("cdhash");
    expect(memberDigest(rebuilt.bytes).digest).not.toBe(memberDigest(before.bytes).digest);
    // one byte of code changed under the old signature: the code no longer matches its CodeDirectory
    const tampered = Buffer.from(before.bytes);
    tampered[100] = (tampered[100] ?? 0) ^ 0xff;
    expect(memberDigest(tampered)).toEqual({
      by: "bytes",
      digest: sha256(tampered),
      why: "code page 0 does not match its CodeDirectory",
    });
    // and a byte of the last page
    const tail = Buffer.from(before.bytes);
    const codeLimit = tail.readUInt32LE(40); // LC_CODE_SIGNATURE's dataoff
    tail[codeLimit - 1] = (tail[codeLimit - 1] ?? 0) ^ 0xff;
    expect(memberDigest(tail).by).toBe("bytes");
  });

  it("binds the identifier, the entitlements and the reserved signature space (the header page names its size)", () => {
    const base = memberDigest(machO(CODE).bytes).digest;
    expect(memberDigest(machO(CODE, { identifier: "field-native-2" }).bytes).digest).not.toBe(base);
    const entitled = machO(CODE, { entitlements: "<plist><dict/></plist>" });
    expect(memberDigest(entitled.bytes)).toEqual({
      by: "cdhash",
      digest: sha256(entitled.directories[0]!),
    });
    expect(memberDigest(entitled.bytes).digest).not.toBe(base);
    expect(memberDigest(machO(CODE, { reserve: 16384 }).bytes).digest).not.toBe(base);
    // entitlements changed under the old signature: they no longer match their special slot
    const swapped = Buffer.from(entitled.bytes);
    const at = swapped.indexOf("<dict/>");
    swapped.write("<DICT/>", at);
    expect(memberDigest(swapped)).toEqual({
      by: "bytes",
      digest: sha256(swapped),
      why: "a component (slot 5) does not match its CodeDirectory",
    });
  });

  it("reads the SHA-256 CodeDirectory when a SHA-1 one holds slot 0; a SHA-1 one alone still reads", () => {
    const both = machO(CODE, { hashTypes: [1, 2] });
    expect(readCodeSignature(both.bytes)).toEqual({
      signed: true,
      universal: false,
      slices: [
        { cputype: CPU_ARM64, cpusubtype: 0, hashType: 2, cdhash: sha256(both.directories[1]!) },
      ],
    });
    const sha1 = machO(CODE, { hashTypes: [1] });
    expect(memberDigest(sha1.bytes)).toEqual({
      by: "cdhash",
      digest: sha256(sha1.directories[0]!),
    });
  });

  // TD-4's review: XNU's hashPriorities rank SHA-384 above SHA-256 and the kernel enforces the CodeDirectory it ranks
  // first (its flags, identifier, team, special slots), so the digest's CodeDirectory must always be the kernel's.
  it("reads the CodeDirectory the kernel enforces: one beside a SHA-384 one, of an unknown hash type, or twice reads by bytes", () => {
    const alone = machO(CODE);
    const added = machO(CODE, { hashTypes: [2, 4] });
    // the SHA-256 CodeDirectory is the same blob either way: only the added SHA-384 one differs
    expect(added.directories[0]?.equals(alone.directories[0]!)).toBe(true);
    // ... and the added one with the hardened runtime cleared, the SHA-256 one left as signed
    const cleared = Buffer.from(added.bytes);
    const sha384 = cleared.indexOf(added.directories[1]!);
    expect(sha384).toBeGreaterThan(0);
    cleared.writeUInt32BE(0, sha384 + 12); // the CodeDirectory's flags: CS_RUNTIME gone
    for (const bytes of [added.bytes, cleared]) {
      expect(memberDigest(bytes)).toEqual({
        by: "bytes",
        digest: sha256(bytes),
        why: "a CodeDirectory the kernel ranks above SHA-256",
      });
      expect(memberDigest(bytes).digest).not.toBe(memberDigest(alone.bytes).digest);
    }
    expect(memberDigest(machO(CODE, { hashTypes: [4] }).bytes)).toMatchObject({
      by: "bytes",
      why: "a CodeDirectory the kernel ranks above SHA-256",
    });
    // one hash type twice: the kernel refuses the signature
    expect(memberDigest(machO(CODE, { hashTypes: [2, 2] }).bytes)).toMatchObject({
      by: "bytes",
      why: "two CodeDirectories of one hash type",
    });
    // an alternate of a hash type the kernel does not know: the kernel refuses the signature
    const both = machO(CODE, { hashTypes: [2, 1] });
    expect(memberDigest(both.bytes)).toEqual({
      by: "cdhash",
      digest: sha256(both.directories[0]!),
    });
    const unknown = Buffer.from(both.bytes);
    const alternate = unknown.indexOf(both.directories[1]!);
    expect(alternate).toBeGreaterThan(0);
    unknown.writeUInt8(9, alternate + 37); // the alternate's hashType
    expect(memberDigest(unknown)).toMatchObject({
      by: "bytes",
      why: "a CodeDirectory of an unknown hash type",
    });
  });

  it("an unsigned Mach-O, a script, a symlink's text and nothing are read by their bytes — the byte rule's own line", () => {
    for (const [bytes, why] of [
      [machO(CODE, null).bytes, "unsigned"],
      [Buffer.from('#!/bin/sh\nexec ./field-native "$@"\n'), "not a Mach-O"],
      [Buffer.from("link:field-native"), "not a Mach-O"],
      [Buffer.alloc(0), "not a Mach-O"],
    ] as const) {
      expect(memberDigest(bytes)).toEqual({ by: "bytes", digest: sha256(bytes), why });
      expect(memberLine("bin/sidecar-slim", bytes)).toBe(`bin/sidecar-slim\0${sha256(bytes)}`);
    }
  });

  it("a universal file reads slice by slice: one digest over its slices, by its bytes unless every slice is signed", () => {
    const arm = machO(CODE);
    const intel = machO(CODE, {}, CPU_X86_64);
    const fat = universal([intel, arm]);
    expect(readCodeSignature(fat)).toEqual({
      signed: true,
      universal: true,
      slices: [
        { cputype: CPU_X86_64, cpusubtype: 0, hashType: 2, cdhash: sha256(intel.directories[0]!) },
        { cputype: CPU_ARM64, cpusubtype: 0, hashType: 2, cdhash: sha256(arm.directories[0]!) },
      ],
    });
    expect(memberDigest(fat).by).toBe("cdhash");
    // both slices signed again, each under a new CMS blob: the same digest
    const resigned = universal([
      machO(CODE, { cms: "another day's CMS, and its timestamp" }, CPU_X86_64),
      machO(CODE, { cms: "another day's CMS" }),
    ]);
    expect(sha256(resigned)).not.toBe(sha256(fat));
    expect(memberDigest(resigned)).toEqual(memberDigest(fat));
    // the slices' order is not the code: the same two slices the other way round read the same
    expect(memberDigest(universal([arm, intel]))).toEqual(memberDigest(fat));
    // one unsigned slice: the whole file by its bytes
    const half = universal([machO(CODE, null, CPU_X86_64), arm]);
    expect(memberDigest(half)).toEqual({ by: "bytes", digest: sha256(half), why: "unsigned" });
  });

  it("never throws: a truncated file, a corrupt SuperBlob, or a byte past the signature reads by its bytes", () => {
    const { bytes } = machO(CODE);
    for (const [cut, why] of [
      [10, "shorter than its Mach-O header"],
      [40, "its load commands run past the image"],
      [bytes.length - 1, "the signature does not end the image"],
    ] as const) {
      const part = bytes.subarray(0, cut);
      expect(memberDigest(part)).toEqual({ by: "bytes", digest: sha256(part), why });
    }
    const corrupt = Buffer.from(bytes);
    corrupt.writeUInt32BE(0xffffffff, corrupt.readUInt32LE(40) + 8); // the SuperBlob's count
    expect(memberDigest(corrupt)).toMatchObject({
      by: "bytes",
      why: "a SuperBlob index past its length",
    });
    const trailing = Buffer.concat([bytes, Buffer.from([0])]);
    expect(memberDigest(trailing)).toMatchObject({
      by: "bytes",
      why: "the signature does not end the image",
    });
    // a Java class file shares the universal magic: its "slice count" is its version, and its bounds refuse it
    const klass = Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x41, 0x00, 0x10]);
    expect(memberDigest(klass)).toMatchObject({ by: "bytes", why: "not a universal binary" });
  });

  // The rule is Apple's own: a SHA-256 CodeDirectory's digest IS codesign's full cdhash. /bin/ls is universal, and
  // codesign names the host's slice.
  it.skipIf(process.platform !== "darwin" || !existsSync("/bin/ls"))(
    "agrees with codesign on /bin/ls: its CandidateCDHashFull is one slice's digest",
    () => {
      const shown = spawnSync("codesign", ["-dvvv", "/bin/ls"], { encoding: "utf8" });
      const full = /CandidateCDHashFull sha256=([0-9a-f]{64})/.exec(shown.stderr)?.[1];
      expect(full, shown.stderr).toBeDefined();
      const read = readCodeSignature(readFileSync("/bin/ls"));
      expect(read.signed, JSON.stringify(read)).toBe(true);
      if (read.signed) expect(read.slices.map((slice) => slice.cdhash)).toContain(full);
    },
  );
});
