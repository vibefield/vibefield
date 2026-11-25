/**
 * DK-3 — the desk's assets load with NO `fetch` (the orchestrator's ruling 8; r6 §3).
 *
 * The packaged renderer's CSP admits `connect-src ws://127.0.0.1:*` alone, so ICE's own app's
 * `fetch(url)` of its gobo plates is refused there; `FontFace(url)` is the font loader's road,
 * which `default-src 'self'` admits. This file stands in for that policy: every request door the
 * CSP's `connect-src` governs — `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
 * `navigator.sendBeacon` — THROWS for the whole file, and the plates, the faces and the seed's
 * print must still arrive: the plates byte for byte ICE's generated ones, each face through
 * `new FontFace(family, "url(…)")` into the document's font set. The Electron half — the same
 * loads under the real packaged policy, with no violation said — is `smoke:canvas`'s.
 *
 * IK (2026-11-25; ICE I59) — the same for THE HAND'S PEN: the three faces baked (assets/hand) reach ICE's lender through the
 * desk's own reader, each file from its bundled module, so a lender whose window `fetch` is refused still lands every face.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PEN_FACES } from "@vibecook/ice/desk";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DESK_FACE_URLS,
  DESK_HAND_FILES,
  DESK_HAND_MODULE_NAMES,
  deskHand,
  deskHandFile,
  deskPlate,
  deskText,
  samplePrint,
} from "../src/field/desk/desk-assets";
import {
  DESK_FACE_FILES,
  DESK_FACES_FOLDER,
  DESK_HANDS_FOLDER,
  deskHandFiles,
} from "../src/field/desk/desk-faces";
import { type DeskPlant, PLANT_PLATES, PLATE_BYTES } from "../src/field/desk/desk-plates";

const sha256 = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

/** What a page under a `connect-src`-less policy may not do. */
const CONNECT = ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"] as const;
const refused: string[] = [];
const saved = new Map<string, unknown>();

/** FontFace as the browser's font loader: it records the source it was handed and "loads". */
class RecordingFontFace {
  static made: { family: string; source: string; weight: string | undefined }[] = [];
  readonly family: string;
  constructor(family: string, source: string, descriptors?: { weight?: string }) {
    this.family = family;
    RecordingFontFace.made.push({ family, source, weight: descriptors?.weight });
  }
  load(): Promise<this> {
    return Promise.resolve(this);
  }
}
const added: unknown[] = [];

beforeAll(() => {
  const scope = globalThis as Record<string, unknown>;
  for (const name of CONNECT) {
    saved.set(name, scope[name]);
    scope[name] = vi.fn(() => {
      refused.push(name);
      throw new TypeError(`Refused to connect: ${name} violates connect-src`);
    });
  }
  saved.set("sendBeacon", navigator.sendBeacon);
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: () => {
      refused.push("sendBeacon");
      throw new TypeError("Refused to connect: sendBeacon violates connect-src");
    },
  });
  saved.set("FontFace", scope["FontFace"]);
  scope["FontFace"] = RecordingFontFace;
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { add: (face: unknown) => added.push(face), check: () => false },
  });
});

afterAll(() => {
  const scope = globalThis as Record<string, unknown>;
  for (const [name, value] of saved) {
    if (name === "sendBeacon") {
      Object.defineProperty(navigator, "sendBeacon", { configurable: true, value });
    } else scope[name] = value;
  }
});

describe("the desk's assets under a policy that forbids connect-src", () => {
  it("inflates every plant's plate from its own bundled module — the pinned bytes, no request", async () => {
    const plants = Object.keys(PLANT_PLATES) as DeskPlant[];
    expect(plants).toEqual([
      "monstera",
      "climbing-monstera",
      "fan-palm",
      "coconut-palm",
      "under-the-palm",
      "palm",
      "canopy",
    ]);
    for (const plant of plants) {
      const bytes = await deskPlate(plant);
      expect(bytes.length, plant).toBe(PLATE_BYTES);
      expect(await sha256(bytes), plant).toBe(PLANT_PLATES[plant].sha256);
    }
    // the two grown plates are ICE's generated ones still: the sums the desk shipped with (DK-3)
    expect(PLANT_PLATES.palm.sha256).toBe(
      "d61fdb9f49009c32d008ddd01e34d3317dd2883d1fd723401cf6cb1c938320c5",
    );
    expect(PLANT_PLATES.canopy.sha256).toBe(
      "4e4f5563646845fddaad3d62f595bdf8fccc4eb4d13abccbeb430bf4daaae482",
    );
    // a plant asked for twice is one load: the same bytes, inflated once
    expect(await deskPlate("palm")).toBe(await deskPlate("palm"));
    expect(refused).toEqual([]);
  });

  it("loads every face through FontFace(url) into the document's fonts — no request", async () => {
    const text = deskText();
    const names = Object.keys(DESK_FACE_URLS);
    expect(names).toEqual(["caveat", "caveat-bold", "kalam"]);
    const loaded = await Promise.all(names.map((name) => text.load(name)));
    expect(loaded).toEqual([true, true, true]);
    expect(RecordingFontFace.made.map((f) => f.source)).toEqual(
      names.map((name) => `url(${DESK_FACE_URLS[name]})`),
    );
    // each face is the shipped file, by the asset's own URL (the renderer's `'self'`)
    for (const [name, url] of Object.entries(DESK_FACE_URLS)) {
      expect(url, name).toMatch(/\/(Caveat-500|Caveat-600|Kalam-400)\.ttf/u);
    }
    expect(added).toHaveLength(3);
    expect(names.every((name) => text.ready(name))).toBe(true);
    expect(refused).toEqual([]);
  });

  it("DK-17b: imports exactly the face table's files — the one table a Node caller registers from disk (the playground's still raster)", () => {
    expect(Object.keys(DESK_FACE_URLS)).toEqual(Object.keys(DESK_FACE_FILES));
    for (const [name, url] of Object.entries(DESK_FACE_URLS)) {
      const file = DESK_FACE_FILES[name] ?? "";
      expect(url.endsWith(`/${file}`), `${name}: ${url} is not ${file}`).toBe(true);
      // where a Node caller finds it: the folder beside the table's own module (this package's root is the cwd)
      const onDisk = resolve(process.cwd(), "src/field/desk", DESK_FACES_FOLDER, file);
      expect(existsSync(onDisk), onDisk).toBe(true);
    }
  });

  it("decodes the seed's print from its bundled module — the named bytes, no request", async () => {
    const print = await samplePrint();
    expect(print.type).toBe("image/png");
    expect([print.width, print.height]).toEqual([640, 480]);
    // a PNG: its signature, and the store's name for it
    expect([...print.bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(await sha256(print.bytes)).toBe(print.sha256);
    expect(refused).toEqual([]);
  });

  it("IK: lands every hand face from its bundled modules — the baked atlases, no request", async () => {
    const hand = deskHand();
    // the faces the desk ships files for, by ICE's pen names (its other two are the platform's own, with no file to bake)
    const names = Object.keys(DESK_HAND_FILES);
    expect(names).toEqual(["caveat", "caveat-bold", "kalam"]);
    expect(names.every((name) => name in PEN_FACES)).toBe(true);
    expect(names.every((name) => hand.loading(name))).toBe(true);
    expect(await Promise.all(names.map((name) => hand.load(name)))).toEqual([true, true, true]);
    const faces = names.map((name) => {
      const atlas = hand.face(name);
      return [
        name,
        atlas?.format,
        atlas?.family,
        atlas?.weight,
        Object.keys(atlas?.glyphs ?? {}).length,
      ];
    });
    expect(faces).toEqual([
      ["caveat", "ice-hand/1", "Caveat", 500, 203],
      ["caveat-bold", "ice-hand/1", "Caveat", 600, 203],
      ["kalam", "ice-hand/1", "Kalam", 400, 203],
    ]);
    // each atlas is its own face's: the font the table names, by its hash
    for (const name of names) {
      const atlas = hand.face(name);
      expect(atlas?.source.file, name).toBe(DESK_FACE_FILES[name]);
      expect([atlas?.family, atlas?.weight], name).toEqual([
        PEN_FACES[name]?.family,
        PEN_FACES[name]?.weight,
      ]);
      expect(atlas?.bin.length, name).toBe((atlas?.width ?? 0) * (atlas?.height ?? 0) * 2);
      expect(hand.failed(name), name).toBeUndefined();
      expect(hand.loading(name), name).toBe(false);
    }
    expect(refused).toEqual([]);
  });

  it("IK: each bundled hand file is the committed baked file, byte for byte", async () => {
    for (const name of DESK_HAND_MODULE_NAMES) {
      const answer = await deskHandFile(name);
      expect([answer.ok, answer.status], name).toEqual([true, 200]);
      const bundled = new Uint8Array(await answer.arrayBuffer());
      const committed = readFileSync(
        resolve(process.cwd(), "src/field/desk", DESK_HANDS_FOLDER, name),
      );
      expect(bundled.length, name).toBe(committed.length);
      expect(Buffer.from(bundled).equals(committed), name).toBe(true);
    }
    expect(refused).toEqual([]);
  });

  it("IK: the hand's files are the face table's — each face's two, by ICE's rule; a name outside answers 404", async () => {
    expect(Object.keys(DESK_HAND_FILES)).toEqual(Object.keys(DESK_FACE_FILES));
    for (const [name, file] of Object.entries(DESK_FACE_FILES)) {
      expect(DESK_HAND_FILES[name], name).toEqual(deskHandFiles(file));
    }
    expect(deskHandFiles("Caveat-500.ttf")).toEqual({
      json: "caveat-500.hand.json",
      bin: "caveat-500.hand.bin",
    });
    // the bundle holds exactly the six the table names, and each lies on disk beside the fonts
    expect([...DESK_HAND_MODULE_NAMES].sort()).toEqual(
      Object.values(DESK_HAND_FILES)
        .flatMap((f) => [f.json, f.bin])
        .sort(),
    );
    for (const name of DESK_HAND_MODULE_NAMES) {
      const onDisk = resolve(process.cwd(), "src/field/desk", DESK_HANDS_FOLDER, name);
      expect(existsSync(onDisk), onDisk).toBe(true);
    }
    expect(existsSync(resolve(process.cwd(), "src/field/desk", DESK_HANDS_FOLDER, "OFL.txt"))).toBe(
      true,
    );
    const none = await deskHandFile("cursive.hand.json");
    expect([none.ok, none.status]).toEqual([false, 404]);
    await expect(none.json()).rejects.toThrow(/no hand file/u);
  });
});
