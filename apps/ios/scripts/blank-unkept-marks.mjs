#!/usr/bin/env node
// Blanks, IN PLACE, every tile of the swarm's mark atlas (FieldSwarm/Resources/marks.png) that the
// app does not draw (LP-4, 2026-11-05, the 0.9 launch: James kept two vendor logos in v1, Claude
// Code's and Codex's, so the bundle carries those two and no other vendor's mark).
//
//   node apps/ios/scripts/blank-unkept-marks.mjs           blanks the unkept tiles, rewrites the png, prints the pin
//   node apps/ios/scripts/blank-unkept-marks.mjs --check   the committed png against the table and the pin (no write)
//
// `pnpm check:ios-fixtures` (in `pnpm verify`) runs `--check` (scripts/check-ios-fixtures.mjs,
// EDITED_IN_PLACE), so a `candidates`/`kept` edit the png does not follow is red in the gate, not
// only when FieldSwarmTests runs on the kit slot.
//
// Why a blanking and not a re-bake: the atlas's generator (research/svg-sdf, which baked
// @lobehub/icons-static-svg@1.94.0 into 64-texel signed-distance tiles) is not in this repo. So the
// two kept tiles stay the generator's bytes, untouched, and each unkept tile becomes transparent
// black — every channel 0, alpha 0 — which the swarm's text shader reads as "outside every edge"
// (the field is the red channel, 0.5 at the edge). The grid stays as baked: 6 columns at a 66-texel
// pitch, the tile order MarksAtlas.swift's `candidates` names, so no tile coordinate moves.
//
// The tile table below is held to MarksAtlas.swift (each `Candidate(id:… tile: at(N) …)` row, its
// order and its `kept`), and the png is held to the table: every texel outside the 20 baked tiles
// (the gutters and the four empty slots) is zero, every baked tile is fully opaque as baked or
// already blank, alpha is only 0 or 255, red is 0 wherever alpha is, and every texel this script
// does not blank comes out byte for byte as it went in. A wrong table fails loudly, never quietly.
//
// The pin it prints is FieldSwarmTests' `uploadedMarksMatchDesktopPixels`: the sha256 of the red
// channel as MarksAtlas.makeTexture uploads it (CGContext, premultipliedLast). With alpha 0 or 255
// and red 0 wherever alpha is 0, premultiplying changes nothing, so the raw red channel IS the
// upload. The png carries no colour chunk (only IHDR, IDAT, IEND), so CoreGraphics converts nothing.
// The pin is over pixels, not file bytes: a different zlib may compress them differently.
//
// Node only (node:zlib, node:crypto); no dependency.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync, inflateSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = join(HERE, "..", "VibeFieldKit");
const ROOT = join(HERE, "..", "..", "..");
const ATLAS = join(KIT, "Sources", "FieldSwarm", "Resources", "marks.png");
const TABLE = join(KIT, "Sources", "FieldSwarm", "MarksAtlas.swift");
const PIN = join(KIT, "Tests", "FieldSwarmTests", "FieldSwarmTests.swift");

// MarksAtlas.swift's geometry (held to it below).
const WIDTH = 396;
const HEIGHT = 264;
const TILE = 64;
const PITCH = 66;
const COLUMNS = 6;

// MarksAtlas.swift's `candidates`, in bake order (index → tile), and the two it keeps.
const CANDIDATES = [
  "claudecode",
  "claude",
  "anthropic",
  "codex",
  "openai",
  "grok",
  "xai",
  "kimi",
  "moonshot",
  "opencode",
  "hermesagent",
  "nousresearch",
  "antigravity",
  "geminicli",
  "gemini",
  "githubcopilot",
  "copilot",
  "github",
  "pi",
  "inflection",
];
const KEPT = new Set(["claudecode", "codex"]);

const check = process.argv.includes("--check");
const unknown = process.argv.slice(2).filter((arg) => arg !== "--check");
if (unknown.length > 0) fail(`unknown argument(s): ${unknown.join(" ")}`);

function fail(message) {
  console.error(`blank-unkept-marks: ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

// --- the table, held to MarksAtlas.swift -----------------------------------------------------

function holdTableToSwift() {
  const source = readFileSync(TABLE, "utf8");
  for (const [name, value] of [
    ["width", WIDTH],
    ["height", HEIGHT],
    ["tile", TILE],
  ]) {
    assert(
      new RegExp(`public static let ${name} = ${value}\\b`).test(source),
      `MarksAtlas.swift's ${name} is not ${value}`,
    );
  }
  assert(/private static let pitch = 66\b/.test(source), "MarksAtlas.swift's pitch is not 66");
  assert(
    /Tile\(x: \(index % 6\) \* pitch, y: \(index \/ 6\) \* pitch\)/.test(source),
    "MarksAtlas.swift no longer lays tiles out 6 to a row at the pitch",
  );
  const rows = [
    ...source.matchAll(
      /^\s*Candidate\(id: "([^"]+)",.*?tile: at\((\d+)\),.*?chosen: (true|false)(?:, kept: (true|false))?\)/gm,
    ),
  ].map(([, id, index, chosen, kept]) => ({
    id,
    index: Number(index),
    chosen: chosen === "true",
    kept: kept === "true",
  }));
  assert(
    rows.map((row) => row.id).join() === CANDIDATES.join(),
    `MarksAtlas.swift's candidates are not this script's table:\n  swift:  ${rows.map((row) => row.id).join(", ")}\n  script: ${CANDIDATES.join(", ")}`,
  );
  for (const [index, row] of rows.entries()) {
    assert(row.index === index, `MarksAtlas.swift puts ${row.id} at tile ${row.index}, not ${index}`);
    assert(
      row.kept === KEPT.has(row.id),
      `MarksAtlas.swift ${row.kept ? "keeps" : "does not keep"} ${row.id}; this script ${KEPT.has(row.id) ? "keeps" : "blanks"} it`,
    );
    assert(!row.kept || row.chosen, `MarksAtlas.swift keeps ${row.id} but does not choose it`);
  }
}

// --- PNG (8-bit RGBA, non-interlaced) --------------------------------------------------------

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function decode(bytes) {
  assert(bytes.subarray(0, 8).equals(SIGNATURE), "not a png");
  const chunks = [];
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("latin1", at + 4, at + 8);
    const data = bytes.subarray(at + 8, at + 8 + length);
    const crc = bytes.readUInt32BE(at + 8 + length);
    assert(crc32(bytes.subarray(at + 4, at + 8 + length)) === crc, `${type}: bad crc`);
    chunks.push({ type, data });
    at += 12 + length;
  }
  const types = chunks.map((chunk) => chunk.type);
  assert(
    types[0] === "IHDR" &&
      types.at(-1) === "IEND" &&
      types.slice(1, -1).every((type) => type === "IDAT"),
    `expected IHDR, IDAT…, IEND only (a colour chunk would let CoreGraphics convert the field); found ${types.join(", ")}`,
  );
  const header = chunks[0].data;
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  assert(width === WIDTH && height === HEIGHT, `the atlas is ${width}x${height}, not ${WIDTH}x${HEIGHT}`);
  assert(
    header[8] === 8 && header[9] === 6 && header[10] === 0 && header[11] === 0 && header[12] === 0,
    "the atlas is not 8-bit RGBA, deflate, adaptive filtering, non-interlaced",
  );
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data)));
  const stride = WIDTH * 4;
  assert(raw.length === HEIGHT * (stride + 1), "the image data is not one filtered row per scanline");
  const pixels = Buffer.alloc(HEIGHT * stride);
  for (let y = 0; y < HEIGHT; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const corner = x >= 4 && y > 0 ? pixels[(y - 1) * stride + x - 4] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, corner);
      else assert(filter === 0, `row ${y}: unknown filter ${filter}`);
      pixels[y * stride + x] = value & 0xff;
    }
  }
  return pixels;
}

function paeth(left, up, corner) {
  const estimate = left + up - corner;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toCorner = Math.abs(estimate - corner);
  if (toLeft <= toUp && toLeft <= toCorner) return left;
  return toUp <= toCorner ? up : corner;
}

/** Each row takes the filter whose output has the least sum of absolute (signed) bytes — libpng's heuristic, deterministic. */
function encode(pixels) {
  const stride = WIDTH * 4;
  const rows = [];
  for (let y = 0; y < HEIGHT; y++) {
    let best = null;
    for (let filter = 0; filter <= 4; filter++) {
      const line = Buffer.alloc(stride + 1);
      line[0] = filter;
      let cost = 0;
      for (let x = 0; x < stride; x++) {
        const value = pixels[y * stride + x];
        const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
        const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
        const corner = x >= 4 && y > 0 ? pixels[(y - 1) * stride + x - 4] : 0;
        const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, corner)][filter];
        const out = (value - predicted) & 0xff;
        line[x + 1] = out;
        cost += out < 128 ? out : 256 - out;
      }
      if (best === null || cost < best.cost) best = { cost, line };
    }
    rows.push(best.line);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

// --- the tiles ---------------------------------------------------------------------------------

/** The candidate whose 64-texel tile holds (x, y), or null for a gutter or an empty slot. */
function tileAt(x, y) {
  if (x % PITCH >= TILE || y % PITCH >= TILE) return null;
  const index = Math.floor(y / PITCH) * COLUMNS + Math.floor(x / PITCH);
  return index < CANDIDATES.length ? CANDIDATES[index] : null;
}

function texel(pixels, x, y) {
  const at = (y * WIDTH + x) * 4;
  return { r: pixels[at], g: pixels[at + 1], b: pixels[at + 2], a: pixels[at + 3] };
}

/** Per tile: how many texels are opaque and how many carry any red, plus the png-wide invariants. */
function survey(pixels, label) {
  const tiles = new Map(CANDIDATES.map((id) => [id, { opaque: 0, inked: 0, zero: 0 }]));
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const { r, g, b, a } = texel(pixels, x, y);
      assert(a === 0 || a === 255, `${label}: alpha ${a} at (${x}, ${y}); the pin assumes 0 or 255`);
      assert(a !== 0 || r === 0, `${label}: red ${r} under alpha 0 at (${x}, ${y}); the upload premultiplies`);
      assert(r === g && g === b, `${label}: (${x}, ${y}) is not grey; the field is one channel`);
      const id = tileAt(x, y);
      if (id === null) {
        assert(a === 0 && r === 0, `${label}: (${x}, ${y}) lies outside every tile but is not empty`);
        continue;
      }
      const tile = tiles.get(id);
      if (a === 255) tile.opaque++;
      if (r !== 0) tile.inked++;
      if (r === 0 && a === 0) tile.zero++;
    }
  }
  return tiles;
}

// --- run ---------------------------------------------------------------------------------------

holdTableToSwift();

const before = decode(readFileSync(ATLAS));
const area = TILE * TILE;
for (const [id, tile] of survey(before, "in")) {
  if (KEPT.has(id)) {
    assert(tile.opaque === area && tile.inked > 0, `in: kept tile ${id} is not a baked mark`);
  } else {
    assert(
      (tile.opaque === area && tile.inked > 0) || tile.zero === area,
      `in: tile ${id} is neither a baked mark nor blank (${tile.opaque} opaque, ${tile.inked} inked)`,
    );
  }
}

const after = Buffer.from(before);
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    const id = tileAt(x, y);
    if (id !== null && !KEPT.has(id)) after.fill(0, (y * WIDTH + x) * 4, (y * WIDTH + x + 1) * 4);
  }
}

// Byte for byte: every texel outside an unkept tile is the input's, every texel inside one is 0.
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    const id = tileAt(x, y);
    const at = (y * WIDTH + x) * 4;
    const blanked = id !== null && !KEPT.has(id);
    for (let channel = 0; channel < 4; channel++) {
      assert(
        after[at + channel] === (blanked ? 0 : before[at + channel]),
        `out: (${x}, ${y}) channel ${channel} is ${after[at + channel]}`,
      );
    }
  }
}
for (const [id, tile] of survey(after, "out")) {
  assert(
    KEPT.has(id) ? tile.opaque === area && tile.inked > 0 : tile.zero === area,
    `out: tile ${id} is ${KEPT.has(id) ? "not its baked mark" : "not blank"}`,
  );
}

const red = Buffer.alloc(WIDTH * HEIGHT);
for (let index = 0; index < WIDTH * HEIGHT; index++) red[index] = after[index * 4];
const digest = createHash("sha256").update(red).digest("hex");
const pinned = readFileSync(PIN, "utf8").match(
  /uploadedMarksMatchDesktopPixels[\s\S]*?#expect\(digest == "([0-9a-f]{64})"\)/,
)?.[1];
assert(pinned, `no digest pin found in ${relative(ROOT, PIN)}`);

if (check) {
  assert(before.equals(after), `${relative(ROOT, ATLAS)} still carries unkept tiles; run without --check`);
  assert(pinned === digest, `the pin is ${pinned}; the atlas's red channel hashes to ${digest}`);
  console.log(`ok: ${relative(ROOT, ATLAS)} carries only ${[...KEPT].join(" and ")}; red-channel sha256 ${digest} = the pin`);
} else {
  const bytes = encode(after);
  assert(decode(bytes).equals(after), "the re-encoded png does not decode to the blanked pixels");
  writeFileSync(ATLAS, bytes);
  const blanked = CANDIDATES.filter((id) => !KEPT.has(id));
  console.log(`wrote ${relative(ROOT, ATLAS)} (${bytes.length} bytes): kept ${[...KEPT].join(", ")}; blank ${blanked.join(", ")}`);
  console.log(`red-channel sha256 (FieldSwarmTests' uploadedMarksMatchDesktopPixels): ${digest}`);
  console.log(pinned === digest ? "the pin already matches" : `the pin still says ${pinned}: move it`);
}
