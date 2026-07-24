import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { packVfplugin, unpackVfplugin, VfpluginError } from "../src/pack";

// A minimal §5.2 bundle written to a fresh temp dir. Content is fixed so
// two trees built from it differ only in the directory they live in — the
// across-machines variable §27.10 cares about.
function writeBundle(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), "vfplugin-src-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, ...rel.split("/"));
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

function freshDir(): string {
  return mkdtempSync(join(tmpdir(), "vfplugin-out-"));
}

const BUNDLE: Record<string, string | Buffer> = {
  "vibefield.plugin.json": '{\n  "id": "com.example.notes"\n}\n',
  "dist/renderer.js": "export const activate = () => {};\n",
  "dist/service.js": "export const activate = () => {};\n",
  "assets/icon.png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};

// Standard PKZIP CRC-32, duplicated here so hostile fixtures can carry a
// correct checksum (the reader must fail them on the NAME, not the CRC).
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface HostileEntry {
  name: string;
  data: Buffer;
  externalAttrs?: number;
  crc?: number;
  localName?: string;
}

// A hand-built STORE zip that BYPASSES the writer's guards, so the reader's
// refusals are exercised on inputs the writer would never emit.
function buildZip(entries: HostileEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBytes = Buffer.from(e.name, "utf8");
    const localNameBytes = Buffer.from(e.localName ?? e.name, "utf8");
    const crc = e.crc ?? crc32(e.data);
    const size = e.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(localNameBytes.length, 26);
    locals.push(local, localNameBytes, e.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(e.externalAttrs ?? 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += 30 + localNameBytes.length + size;
  }
  const localBytes = Buffer.concat(locals);
  const centralBytes = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(localBytes.length, 16);
  return Buffer.concat([localBytes, centralBytes, eocd]);
}

describe("packVfplugin — determinism (§27.10)", () => {
  it("packs the same tree in different dirs, from shuffled input order, to identical bytes", async () => {
    const rootA = writeBundle(BUNDLE);
    const rootB = writeBundle(BUNDLE);

    const shuffled = [
      "dist/service.js",
      "vibefield.plugin.json",
      "assets/icon.png",
      "dist/renderer.js",
    ];
    const reversed = [...shuffled].reverse();

    const a = await packVfplugin({ rootDir: rootA, files: shuffled });
    const b = await packVfplugin({ rootDir: rootB, files: reversed });

    expect(a.bytes.equals(b.bytes)).toBe(true);
    expect(a.sha256).toBe(b.sha256);
  });

  it("the default §5.2 walk yields the same bytes as an explicit shuffled file set", async () => {
    const root = writeBundle(BUNDLE);
    const walked = await packVfplugin({ rootDir: root });
    const explicit = await packVfplugin({
      rootDir: root,
      files: ["dist/service.js", "assets/icon.png", "vibefield.plugin.json", "dist/renderer.js"],
    });
    expect(walked.bytes.equals(explicit.bytes)).toBe(true);
    expect(walked.sha256).toBe(explicit.sha256);
  });

  it("returns the sha256 in the index-pin format", async () => {
    const root = writeBundle(BUNDLE);
    const { sha256 } = await packVfplugin({ rootDir: root });
    expect(sha256).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe("packVfplugin — the default §5.2 walk", () => {
  it("packs only vibefield.plugin.json + dist/** + assets/**, excluding stray files, dotfiles, node_modules", async () => {
    const root = writeBundle({
      ...BUNDLE,
      "package.json": "{}\n", // stray root file — not a §5.2 member
      "src/index.ts": "// source", // stray tree — not staged
      "dist/.hidden": "dotfile",
      "dist/node_modules/dep.js": "vendored",
      "assets/.DS_Store": "junk",
    });

    const { bytes } = await packVfplugin({ rootDir: root });
    const dest = freshDir();
    const { entries } = await unpackVfplugin(bytes, dest);

    expect(entries).toEqual([
      "assets/icon.png",
      "dist/renderer.js",
      "dist/service.js",
      "vibefield.plugin.json",
    ]);
  });

  it("refuses an unsafe explicit file path at pack time", async () => {
    const root = writeBundle(BUNDLE);
    await expect(packVfplugin({ rootDir: root, files: ["../escape.js"] })).rejects.toMatchObject({
      code: "path-traversal",
    });
  });
});

describe("unpackVfplugin — round-trip fidelity", () => {
  it("restores every packed file byte-for-byte", async () => {
    const root = writeBundle(BUNDLE);
    const { bytes } = await packVfplugin({ rootDir: root });

    const dest = freshDir();
    const { entries } = await unpackVfplugin(bytes, dest);

    expect(entries).toEqual([
      "assets/icon.png",
      "dist/renderer.js",
      "dist/service.js",
      "vibefield.plugin.json",
    ]);
    for (const [rel, body] of Object.entries(BUNDLE)) {
      const expected = typeof body === "string" ? Buffer.from(body) : body;
      expect(readFileSync(join(dest, ...rel.split("/"))).equals(expected)).toBe(true);
    }
  });
});

describe("unpackVfplugin — hostile-entry refusals (the install security seam)", () => {
  const data = Buffer.from("payload");

  it("refuses a `..` traversal entry", async () => {
    const zip = buildZip([{ name: "../escape.txt", data }]);
    await expect(unpackVfplugin(zip, freshDir())).rejects.toMatchObject({ code: "path-traversal" });
  });

  it("refuses a nested `..` traversal entry", async () => {
    const zip = buildZip([{ name: "dist/../../escape.txt", data }]);
    await expect(unpackVfplugin(zip, freshDir())).rejects.toMatchObject({ code: "path-traversal" });
  });

  it("refuses an absolute-path entry", async () => {
    const zip = buildZip([{ name: "/etc/evil", data }]);
    await expect(unpackVfplugin(zip, freshDir())).rejects.toMatchObject({ code: "absolute-path" });
  });

  it("refuses a drive-letter absolute path", async () => {
    const zip = buildZip([{ name: "C:/evil", data }]);
    await expect(unpackVfplugin(zip, freshDir())).rejects.toMatchObject({ code: "absolute-path" });
  });

  it("refuses a backslash entry name", async () => {
    const zip = buildZip([{ name: "dist\\evil.js", data }]);
    await expect(unpackVfplugin(zip, freshDir())).rejects.toMatchObject({ code: "backslash" });
  });

  it("refuses a symlink entry (Unix S_IFLNK in external attributes)", async () => {
    const zip = buildZip([{ name: "link", data, externalAttrs: 0xa1ff0000 }]);
    await expect(unpackVfplugin(zip, freshDir())).rejects.toMatchObject({ code: "symlink" });
  });

  it("refuses a directory entry", async () => {
    const zip = buildZip([{ name: "dir/", data: Buffer.alloc(0) }]);
    await expect(unpackVfplugin(zip, freshDir())).rejects.toMatchObject({
      code: "directory-entry",
    });
  });

  it("refuses a corrupted entry whose CRC does not match its bytes", async () => {
    const zip = buildZip([{ name: "ok.txt", data, crc: 0xdeadbeef }]);
    await expect(unpackVfplugin(zip, freshDir())).rejects.toMatchObject({ code: "crc-mismatch" });
  });

  it("refuses a tampered archive whose local and central names disagree", async () => {
    const zip = buildZip([{ name: "central.txt", data, localName: "local.txt" }]);
    await expect(unpackVfplugin(zip, freshDir())).rejects.toBeInstanceOf(VfpluginError);
  });

  it("writes nothing when any entry in the archive is hostile", async () => {
    const dest = freshDir();
    const zip = buildZip([
      { name: "good.txt", data },
      { name: "../escape.txt", data },
    ]);
    await expect(unpackVfplugin(zip, dest)).rejects.toMatchObject({ code: "path-traversal" });
    expect(existsSync(join(dest, "good.txt"))).toBe(false);
  });
});
