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
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DESK_FACE_URLS, deskPlates, deskText, samplePrint } from "../src/field/desk/desk-assets";
import { PLATE_BYTES, PLATE_SHA256 } from "../src/field/desk/desk-plates";

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
  it("inflates the generated plates from their bundled module — ICE's bytes, no request", async () => {
    const plates = await deskPlates();
    expect(plates.c.length).toBe(PLATE_BYTES);
    expect(plates.b.length).toBe(PLATE_BYTES);
    expect(await sha256(plates.c)).toBe(PLATE_SHA256.c);
    expect(await sha256(plates.b)).toBe(PLATE_SHA256.b);
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

  it("decodes the seed's print from its bundled module — the named bytes, no request", async () => {
    const print = await samplePrint();
    expect(print.type).toBe("image/png");
    expect([print.width, print.height]).toEqual([640, 480]);
    // a PNG: its signature, and the store's name for it
    expect([...print.bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(await sha256(print.bytes)).toBe(print.sha256);
    expect(refused).toEqual([]);
  });
});
