import assert from "node:assert/strict";
import test from "node:test";
import { inflateSync } from "node:zlib";
import { crc32, encodeIcns, encodeIco, encodePng, utf8, zipStore } from "../src/formats.mjs";

const decoder = new TextDecoder();
const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
function chunks(png) {
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const out = [];
  for (let at = 8; at < png.length; ) {
    const length = view(png).getUint32(at);
    const type = decoder.decode(png.subarray(at + 4, at + 8));
    assert.equal(
      crc32(png.subarray(at + 4, at + 8 + length)),
      view(png).getUint32(at + length + 8),
      `${type} CRC`,
    );
    out.push({ type, data: png.slice(at + 8, at + 8 + length) });
    at += length + 12;
    assert.ok(at <= png.length);
  }
  return out;
}
async function square(size, opaque = false) {
  const rgba = new Uint8Array(size * size * 4);
  for (let at = 0; at < rgba.length; at += 4) rgba.set([255, 0, 84, 255], at);
  return encodePng({ width: size, height: size, rgba, opaque });
}

test("CRC-32 uses the published IEEE check value and UTF-8 keeps non-ASCII names", () => {
  assert.equal(crc32(utf8("123456789")), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
  assert.equal(decoder.decode(utf8("VibeField · 光")), "VibeField · 光");
});

test("RGBA PNG round-trips every component, including transparency and a typed-array offset", async () => {
  const storage = new Uint8ClampedArray([
    99, 255, 0, 84, 0, 0, 245, 155, 127, 8, 60, 255, 255, 255, 255, 255, 255, 99,
  ]);
  const rgba = storage.subarray(1, 17);
  const png = await encodePng({ width: 2, height: 2, rgba });
  const parts = chunks(png);
  assert.deepEqual(
    parts.map(({ type }) => type),
    ["IHDR", "sRGB", "IDAT", "IEND"],
  );
  const ihdr = parts[0].data;
  assert.equal(view(ihdr).getUint32(0), 2);
  assert.equal(view(ihdr).getUint32(4), 2);
  assert.equal(ihdr[8], 8);
  assert.equal(ihdr[9], 6);
  assert.deepEqual(
    [...inflateSync(parts[2].data)],
    [0, ...rgba.subarray(0, 8), 0, ...rgba.subarray(8)],
  );
  assert.deepEqual([...parts[1].data], [0]);
});

test("opaque PNG uses RGB, not an all-255 alpha channel", async () => {
  const png = await encodePng({
    width: 2,
    height: 1,
    rgba: new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]),
    opaque: true,
  });
  const parts = chunks(png);
  assert.equal(parts[0].data[9], 2);
  assert.deepEqual([...inflateSync(parts[2].data)], [0, 1, 2, 3, 4, 5, 6]);
  await assert.rejects(
    encodePng({ width: 1, height: 1, rgba: new Uint8Array([1, 2, 3, 254]), opaque: true }),
    /composite the background/,
  );
});

test("PNG rejects dimension mismatches and invalid dimensions before allocation", async () => {
  await assert.rejects(encodePng({ width: 2, height: 1, rgba: new Uint8Array(4) }), /byte length/);
  for (const width of [0, -1, 0.5, NaN, Infinity, 2 ** 31]) {
    await assert.rejects(
      encodePng({ width, height: 1, rgba: new Uint8Array(4) }),
      /positive integers/,
    );
  }
  await assert.rejects(encodePng({ width: 1, height: 1, rgba: [0, 0, 0, 255] }), /Uint8Array/);
});

test("ICO directories point to complete PNGs and encode 256 as zero", async () => {
  const entries = [
    { size: 16, data: await square(16) },
    { size: 256, data: await square(256, true) },
  ];
  const ico = encodeIco(entries);
  const d = view(ico);
  assert.equal(d.getUint16(0, true), 0);
  assert.equal(d.getUint16(2, true), 1);
  assert.equal(d.getUint16(4, true), 2);
  let offset = 38;
  entries.forEach(({ size, data }, i) => {
    const at = 6 + i * 16;
    assert.equal(ico[at], size === 256 ? 0 : size);
    assert.equal(ico[at + 1], ico[at]);
    assert.equal(d.getUint16(at + 4, true), 1);
    assert.equal(d.getUint16(at + 6, true), i ? 24 : 32);
    assert.equal(d.getUint32(at + 8, true), data.length);
    assert.equal(d.getUint32(at + 12, true), offset);
    assert.deepEqual(ico.subarray(offset, offset + data.length), data);
    offset += data.length;
  });
  assert.equal(offset, ico.length);
});

test("ICO refuses duplicates, wrong image sizes, damaged headers and non-PNG payloads", async () => {
  const data = await square(16);
  assert.throws(() => encodeIco([]), /representations/);
  assert.throws(() => encodeIco([{ size: 512, data }]), /1–256/);
  assert.throws(() => encodeIco([{ size: 32, data }]), /mismatched/);
  assert.throws(
    () =>
      encodeIco([
        { size: 16, data },
        { size: 16, data },
      ]),
    /Duplicate/,
  );
  assert.throws(() => encodeIco([{ size: 16, data: new Uint8Array(50) }]), /PNG bytes/);
  const corrupt = data.slice();
  corrupt[20] ^= 1;
  assert.throws(() => encodeIco([{ size: 16, data: corrupt }]), /corrupt/);
});

test("ICNS includes a correct big-endian file length and PNG-backed normal and Retina slots", async () => {
  const entries = [
    { type: "icp4", data: await square(16) },
    { type: "icp5", data: await square(32) },
    { type: "ic11", data: await square(32) },
    { type: "ic10", data: await square(1024) },
  ];
  const icns = encodeIcns(entries);
  assert.equal(decoder.decode(icns.subarray(0, 4)), "icns");
  assert.equal(view(icns).getUint32(4), icns.length);
  let at = 8;
  for (const { type, data } of entries) {
    assert.equal(decoder.decode(icns.subarray(at, at + 4)), type);
    assert.equal(view(icns).getUint32(at + 4), data.length + 8);
    assert.deepEqual(icns.subarray(at + 8, at + 8 + data.length), data);
    at += data.length + 8;
  }
  assert.equal(at, icns.length);
});

test("ICNS refuses legacy encodings, mismatched slots and duplicate types", async () => {
  const data = await square(16);
  assert.throws(() => encodeIcns([{ type: "ic04", data }]), /Unsupported/);
  assert.throws(() => encodeIcns([{ type: "icp5", data }]), /32px/);
  assert.throws(
    () =>
      encodeIcns([
        { type: "icp4", data },
        { type: "icp4", data },
      ]),
    /Duplicate/,
  );
});

test("ZIP local entries, central directory, UTF-8 flags and CRCs agree", () => {
  const entries = [
    { name: "AppIcon.appiconset/Contents.json", data: '{"info":{"version":1}}\n' },
    { name: "VibeField · 光/mark.png", data: new Uint8Array([137, 80, 78, 71, 0, 255]) },
  ];
  const zip = zipStore(entries);
  assert.deepEqual(zip, zipStore(entries), "same inputs produce the same archive");
  const d = view(zip);
  const end = zip.length - 22;
  assert.equal(d.getUint32(end, true), 0x06054b50);
  assert.equal(d.getUint16(end + 8, true), entries.length);
  assert.equal(d.getUint16(end + 10, true), entries.length);
  const centralOffset = d.getUint32(end + 16, true);
  assert.equal(centralOffset + d.getUint32(end + 12, true), end);
  let central = centralOffset;
  let local = 0;
  for (const entry of entries) {
    const data = typeof entry.data === "string" ? utf8(entry.data) : entry.data;
    const nameLength = utf8(entry.name).length;
    assert.equal(d.getUint32(local, true), 0x04034b50);
    assert.equal(d.getUint16(local + 6, true), 0x0800);
    assert.equal(d.getUint16(local + 8, true), 0, "STORE method");
    assert.equal(d.getUint16(local + 10, true), 0, "midnight");
    assert.equal(d.getUint16(local + 12, true), 0x21, "1980-01-01");
    assert.equal(d.getUint32(local + 14, true), crc32(data));
    assert.equal(d.getUint32(local + 18, true), data.length);
    assert.equal(d.getUint32(local + 22, true), data.length);
    assert.equal(d.getUint16(local + 26, true), nameLength);
    assert.equal(decoder.decode(zip.subarray(local + 30, local + 30 + nameLength)), entry.name);
    assert.deepEqual(
      zip.subarray(local + 30 + nameLength, local + 30 + nameLength + data.length),
      data,
    );
    assert.equal(d.getUint32(central, true), 0x02014b50);
    assert.equal(d.getUint16(central + 8, true), 0x0800);
    assert.equal(d.getUint32(central + 16, true), crc32(data));
    assert.equal(d.getUint32(central + 42, true), local);
    assert.equal(decoder.decode(zip.subarray(central + 46, central + 46 + nameLength)), entry.name);
    local += 30 + nameLength + data.length;
    central += 46 + nameLength;
  }
  assert.equal(local, centralOffset);
  assert.equal(central, end);
});

test("ZIP rejects traversal, absolute and Windows-hostile names, and duplicate paths", () => {
  for (const name of [
    "",
    "/abs",
    "../x",
    "a/../x",
    "a/./x",
    "a//x",
    "a/",
    "a\\x",
    "C:/x",
    "a\0b",
    "a\nb",
    "CON.png",
    "a/NUL",
    "a/space ",
    "a/dot.",
  ]) {
    assert.throws(() => zipStore([{ name, data: "test" }]), /safe|unsafe/, name);
  }
  assert.throws(
    () =>
      zipStore([
        { name: "a.txt", data: "" },
        { name: "a.txt", data: "" },
      ]),
    /Duplicate/,
  );
  assert.throws(
    () =>
      zipStore([
        { name: "AppIcon.png", data: "" },
        { name: "appicon.png", data: "" },
      ]),
    /Duplicate/,
  );
  assert.equal(zipStore([]).length, 22);
});
