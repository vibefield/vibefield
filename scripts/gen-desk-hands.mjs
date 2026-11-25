#!/usr/bin/env node
// IK (2026-11-25) — THE DESK'S PEN (ICE I59): the hand's three faces BAKED, never typed by hand. The desk ships its three
// handwriting fonts (packages/field-app/src/field/desk/assets/fonts: Caveat 500 and 600, Kalam 400, OFL), and ICE's baker
// (`@vibecook/ice/desk/bake`, `bakeHand` at its defaults: `HAND_GLYPH_SET`, `HAND_CORRECTIONS`, the soft hyphen inkless)
// turns each into its `ice-hand/1` atlas: `<stem>.hand.json`, the canonical text (`handAtlasText`), and `<stem>.hand.bin`,
// its RG8 texels, in assets/hand beside the fonts. The desk lends them to its kinds as their pen (field/desk/desk-assets.ts,
// `deskHand`). Which file each face is, and the two names it bakes into, are desk-faces.ts's: the one table every reader of
// the files reads.
//
// A bake is the same bytes on every host (ICE reads the font with correctly rounded arithmetic alone), so `pnpm gen` bakes
// the three again and `pnpm gen:check` fails when a committed file is not byte for byte what the bake makes: an EL8 that
// moves the baker is an event, and these files say what it changed. The files are byte for byte ICE's own desk's too
// (apps/desk/assets/hand), because the fonts are.
//
//   node scripts/gen-desk-hands.mjs                write the six files
//   node scripts/gen-desk-hands.mjs --check        exit 1 naming each file a bake would change
//   node scripts/gen-desk-hands.mjs --out <dir>    (either) another folder than assets/hand

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DESK_FACE_FILES,
  DESK_FACES_FOLDER,
  DESK_HANDS_FOLDER,
  deskHandFiles,
} from "../packages/field-app/src/field/desk/desk-faces.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DESK = join(ROOT, "packages/field-app/src/field/desk");

/** Where the fonts lie, and where their baked hands go. */
export const FONTS_DIR = join(DESK, DESK_FACES_FOLDER);
export const HANDS_DIR = join(DESK, DESK_HANDS_FOLDER);

/** ICE's baker, from the package that installs ICE for the desk (field-app's: the repo's root depends on no ICE). */
function baker() {
  const entry = createRequire(join(ROOT, "packages/field-app/package.json")).resolve(
    "@vibecook/ice/desk/bake",
  );
  return import(pathToFileURL(entry).href);
}

/** One face of the desk's table, baked at ICE's defaults: the bake and the two files it is written to. */
export async function bakeDeskFace(name) {
  const file = DESK_FACE_FILES[name];
  if (file === undefined) throw new Error(`the desk has no face named ${name}`);
  const { bakeHand } = await baker();
  const baked = bakeHand(new Uint8Array(readFileSync(join(FONTS_DIR, file))), { file });
  return { name, file, files: deskHandFiles(file), baked };
}

/**
 * What a bake would change: each of the face's two files that is missing (`read` answers undefined) or is not byte for byte
 * what the bake made. Empty when the files are fresh.
 */
export function staleFiles(face, read) {
  const made = [
    [face.files.json, Buffer.from(face.baked.text, "utf8")],
    [face.files.bin, Buffer.from(face.baked.bin)],
  ];
  const stale = [];
  for (const [file, bytes] of made) {
    const have = read(file);
    if (have === undefined) stale.push(`${file} is missing`);
    else if (!Buffer.from(have).equals(bytes)) stale.push(`${file} is stale`);
  }
  return stale;
}

const hex = (code) => `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const at = args.indexOf("--out");
  if (at >= 0 && (args[at + 1] === undefined || args[at + 1].startsWith("--"))) {
    console.error("usage: node scripts/gen-desk-hands.mjs [--check] [--out <dir>]");
    process.exit(2);
  }
  const out = at >= 0 ? resolve(args[at + 1]) : HANDS_DIR;
  let failed = 0;
  for (const name of Object.keys(DESK_FACE_FILES)) {
    const t0 = performance.now();
    const face = await bakeDeskFace(name);
    const ms = Math.round(performance.now() - t0);
    const { json, missing, refused } = face.baked;
    const glyphs = Object.values(json.glyphs);
    const said =
      `${name} (${face.file}): ${json.family} ${json.weight}, ${glyphs.length} glyphs ` +
      `(${glyphs.filter((g) => g.rect !== undefined).length} inked), ${json.width} × ${json.height} at ${json.em} an em, ` +
      `${Object.keys(json.kerning).length} kerning pairs, corrections [${json.corrections.join(", ")}], ` +
      `missing [${missing.map(hex).join(" ")}] — ${ms} ms`;
    if (refused.length > 0) {
      // the derivation moved under a correction: its glyph is to be looked at, and nothing of this face is written
      console.error(`${said}: corrections refused — ${refused.join(", ")}; nothing written`);
      failed++;
      continue;
    }
    if (check) {
      const stale = staleFiles(face, (file) =>
        existsSync(join(out, file)) ? readFileSync(join(out, file)) : undefined,
      );
      if (stale.length > 0) {
        console.error(`${said}: ${stale.join(", ")} in ${out} — run \`pnpm gen:hands\``);
        failed++;
      } else console.log(`${said}: fresh`);
    } else {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, face.files.json), face.baked.text);
      writeFileSync(join(out, face.files.bin), face.baked.bin);
      console.log(`${said}: wrote ${face.files.json}, ${face.files.bin}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}
