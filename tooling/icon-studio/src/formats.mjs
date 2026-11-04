// Binary writers shared by the browser studio and its Node checks. No server, canvas encoder,
// package dependency, or platform executable is involved. PNG compression uses the browser's
// standard CompressionStream API (also available in the repository's Node 22+ runtime).

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const encoder = new TextEncoder();
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let n = value;
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const U32_MAX = 0xffffffff;

/** UTF-8 bytes, without a byte-order mark. */
export function utf8(text) {
  if (typeof text !== "string") throw new TypeError("Expected text to encode as UTF-8");
  return encoder.encode(text);
}

function bytes(value, name = "data") {
  if (!(value instanceof Uint8Array) && !(value instanceof Uint8ClampedArray)) {
    throw new TypeError(`${name} must be a Uint8Array or Uint8ClampedArray`);
  }
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

/** The unsigned IEEE CRC-32 used by PNG and ZIP. */
export function crc32(input) {
  const data = bytes(input);
  let crc = 0xffffffff;
  for (const value of data) crc = CRC_TABLE[(crc ^ value) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function join(parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  if (!Number.isSafeInteger(length) || length > U32_MAX) {
    throw new RangeError("Export exceeds the supported 4 GiB size");
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function pngChunk(type, data) {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(utf8(type), 4);
  out.set(data, 8);
  view.setUint32(out.length - 4, crc32(out.subarray(4, out.length - 4)));
  return out;
}

/**
 * Encode straight, sRGB, 8-bit RGBA pixels as a PNG. opaque=true writes RGB (PNG color type 2),
 * with no alpha channel at all; every incoming alpha must already be 255. It never silently
 * flattens transparency. The default writes RGBA (type 6), preserving every alpha value.
 */
export async function encodePng({ width, height, rgba, opaque = false }) {
  if (![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= 0x7fffffff)) {
    throw new RangeError("PNG width and height must be positive integers below 2³¹");
  }
  const data = bytes(rgba, "rgba");
  if (!Number.isSafeInteger(width * height * 4) || data.length !== width * height * 4) {
    throw new RangeError("RGBA byte length does not match the PNG dimensions");
  }
  if (typeof opaque !== "boolean") throw new TypeError("opaque must be a boolean");
  if (opaque) {
    for (let at = 3; at < data.length; at += 4) {
      if (data[at] !== 255) throw new Error("Opaque PNG requires every pixel to be opaque; composite the background first");
    }
  }
  if (typeof CompressionStream !== "function") {
    throw new Error("PNG export requires CompressionStream support; use a current browser or Node 22+");
  }
  const channels = opaque ? 3 : 4;
  const stride = width * channels + 1;
  if (stride * height > U32_MAX) throw new RangeError("PNG scanlines exceed the supported 4 GiB size");
  const scanlines = new Uint8Array(stride * height);
  // Filter 0 keeps the representation simple and lossless. DEFLATE performs compression.
  for (let y = 0; y < height; y++) {
    const to = y * stride + 1;
    const from = y * width * 4;
    if (!opaque) {
      scanlines.set(data.subarray(from, from + width * 4), to);
    } else {
      for (let x = 0; x < width; x++) {
        scanlines.set(data.subarray(from + x * 4, from + x * 4 + 3), to + x * 3);
      }
    }
  }
  const compressed = new Uint8Array(await new Response(
    new Blob([scanlines]).stream().pipeThrough(new CompressionStream("deflate")),
  ).arrayBuffer());
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8;
  header[9] = opaque ? 2 : 6;
  return join([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("sRGB", new Uint8Array([0])),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

function pngInfo(input) {
  const data = bytes(input);
  if (data.length < 45 || PNG_SIGNATURE.some((byte, i) => byte !== data[i])) {
    throw new TypeError("Icon entry must contain PNG bytes");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) {
    throw new TypeError("Icon entry is missing its PNG IHDR");
  }
  if (crc32(data.subarray(12, 29)) !== view.getUint32(29)) {
    throw new TypeError("Icon entry has a corrupt PNG IHDR");
  }
  if (data[24] !== 8 || ![2, 6].includes(data[25])) {
    throw new TypeError("Icon entry must be an 8-bit RGB or RGBA PNG");
  }
  return { data, width: view.getUint32(16), height: view.getUint32(20), bits: data[25] === 6 ? 32 : 24 };
}

/**
 * A modern Windows ICO containing lossless PNG representations. Entry order is preserved.
 * A 256-pixel dimension is represented by zero, as required by the ICO directory format.
 * This targets current Windows; it does not include BMP payloads for pre-Vista systems.
 */
export function encodeIco(entries) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 65535) {
    throw new RangeError("ICO needs between 1 and 65535 representations");
  }
  const seen = new Set();
  const images = entries.map(({ size, data }) => {
    if (!Number.isInteger(size) || size < 1 || size > 256) throw new RangeError("ICO size must be 1–256 pixels");
    if (seen.has(size)) throw new Error(`Duplicate ICO size: ${size}`);
    seen.add(size);
    const png = pngInfo(data);
    if (png.width !== size || png.height !== size) throw new Error(`ICO ${size}px entry has mismatched PNG dimensions`);
    return { size, ...png };
  });
  const header = new Uint8Array(6 + images.length * 16);
  const view = new DataView(header.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, images.length, true);
  let offset = header.length;
  images.forEach(({ size, bits, data }, i) => {
    if (offset + data.length > U32_MAX) throw new RangeError("ICO exceeds the supported 4 GiB size");
    const at = 6 + i * 16;
    header[at] = size === 256 ? 0 : size;
    header[at + 1] = header[at];
    view.setUint16(at + 4, 1, true);
    view.setUint16(at + 6, bits, true);
    view.setUint32(at + 8, data.length, true);
    view.setUint32(at + 12, offset, true);
    offset += data.length;
  });
  return join([header, ...images.map(({ data }) => data)]);
}

const ICNS_SIZES = Object.freeze({
  icp4: 16, icp5: 32, icp6: 64, ic07: 128, ic08: 256, ic09: 512, ic10: 1024,
  ic11: 32, ic12: 64, ic13: 256, ic14: 512,
});

/**
 * A PNG-backed ICNS fallback. Use icp4/icp5/icp6 for 16/32/64px: legacy ic04/ic05 expect
 * other encodings and are deliberately refused. Retina slots are ic11/ic12/ic13/ic14.
 * This does not compile an Icon Composer asset or replace Xcode's Assets.car compilation.
 */
export function encodeIcns(entries) {
  if (!Array.isArray(entries) || entries.length < 1) throw new RangeError("ICNS needs at least one representation");
  const seen = new Set();
  const chunks = entries.map(({ type, data }) => {
    if (!Object.hasOwn(ICNS_SIZES, type)) throw new TypeError(`Unsupported PNG-backed ICNS type: ${type}`);
    if (seen.has(type)) throw new Error(`Duplicate ICNS type: ${type}`);
    seen.add(type);
    const png = pngInfo(data);
    if (png.width !== ICNS_SIZES[type] || png.height !== ICNS_SIZES[type]) {
      throw new Error(`ICNS ${type} requires a ${ICNS_SIZES[type]}px square PNG`);
    }
    const chunk = new Uint8Array(8);
    chunk.set(utf8(type));
    new DataView(chunk.buffer).setUint32(4, png.data.length + 8);
    return join([chunk, png.data]);
  });
  const length = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (length > U32_MAX) throw new RangeError("ICNS exceeds the supported 4 GiB size");
  const header = new Uint8Array(8);
  header.set(utf8("icns"));
  new DataView(header.buffer).setUint32(4, length);
  return join([header, ...chunks]);
}

function safeName(name) {
  if (typeof name !== "string" || name.length === 0 || /[\\<>:"|?*\u0000-\u001f\u007f]/u.test(name)) {
    throw new TypeError("ZIP entry needs a safe relative filename");
  }
  const segments = name.split("/");
  if (segments.some((part) => !part || part === "." || part === ".." || /[. ]$/u.test(part) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(part))) {
    throw new TypeError(`ZIP entry has an unsafe path: ${name}`);
  }
  const encoded = utf8(name);
  if (encoded.length > 65535) throw new RangeError("ZIP filename exceeds 65535 UTF-8 bytes");
  return encoded;
}

/**
 * Deterministic, uncompressed ZIP (method STORE, UTF-8 names, 1980-01-01 00:00 timestamp).
 * Folders are implicit in file paths. ZIP64 and directory-only entries are not supported.
 * Paths must be safe on macOS, Linux and Windows; case-insensitive duplicate paths are refused.
 */
export function zipStore(entries) {
  if (!Array.isArray(entries) || entries.length > 65535) throw new RangeError("ZIP supports at most 65535 files");
  const localParts = [];
  const centralParts = [];
  const seen = new Set();
  let offset = 0;
  let centralSize = 0;
  for (const { name, data: input } of entries) {
    const filename = safeName(name);
    const key = name.normalize("NFC").toLowerCase();
    if (seen.has(key)) throw new Error(`Duplicate ZIP path: ${name}`);
    seen.add(key);
    const data = typeof input === "string" ? utf8(input) : bytes(input);
    const crc = crc32(data);
    if (data.length > U32_MAX || offset + 30 + filename.length + data.length > U32_MAX) {
      throw new RangeError("ZIP requires ZIP64 for this payload");
    }
    const local = new Uint8Array(30);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(6, 0x0800, true);
    l.setUint16(12, 0x0021, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, data.length, true);
    l.setUint32(22, data.length, true);
    l.setUint16(26, filename.length, true);
    localParts.push(local, filename, data);

    const central = new Uint8Array(46);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(14, 0x0021, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, filename.length, true);
    c.setUint32(42, offset, true);
    centralParts.push(central, filename);
    centralSize += central.length + filename.length;
    offset += local.length + filename.length + data.length;
  }
  if (offset + centralSize + 22 > U32_MAX) throw new RangeError("ZIP requires ZIP64 for this archive");
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);
  return join([...localParts, ...centralParts, end]);
}
