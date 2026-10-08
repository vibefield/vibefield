// @vitest-environment happy-dom
/**
 * AR-8 — a recorded image in History is DRAWN (D1, `build-hf.md` §2). The
 * room asks a host for an image's renditions only when the host gives the
 * attachment an address (`attachmentAssetUrl`); ours answered null, so every
 * recorded image read "Image data was not recorded". Here the shipping
 * composition — `HistoryRoomView` with VibeField's asset source
 * (`assetSourceOver`) over rosetta's own client — draws the room's demo
 * session, whose first prompt carries two optimized images: each tile is an
 * `<img>` on an object URL made from bytes read with the session's grant, and
 * the "not recorded" words are nowhere. (The bytes from a real rosettad under a
 * real grant: `history-witness.test.ts`, its synthesized home's D1 row.)
 */
import { PROTOCOL_VERSION, RosettaClient } from "@rosetta/protocol";
import { createDemoPorts, createRoomDemo } from "@rosetta/room/fixtures";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assetSourceOver, type HistoryAssetSource } from "../src/history/asset-source";
import { HistoryRoomView } from "../src/history/HistoryRoomView";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
let assets: HistoryAssetSource | null = null;

// The room is its own chunk in the product; loading it once before the rows
// keeps a row's seconds for the room rather than its first transform.
beforeAll(async () => {
  await import("@rosetta/room");
}, 60_000);

/** An observer that says every observed tile is on screen — happy-dom lays
 * nothing out, and the room draws a tile's `<img>` only once it is visible. */
class OnScreen {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element): void {
    queueMicrotask(() =>
      this.callback(
        [{ isIntersecting: true, target } as unknown as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      ),
    );
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", OnScreen);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  assets?.dispose();
  root = null;
  host = null;
  assets = null;
  vi.unstubAllGlobals();
});

async function until<T>(read: () => T | null | undefined, label: string, ms = 5_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = read();
    if (value !== null && value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`until: ${label}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

describe("History draws a recorded image (D1)", () => {
  it("each tile of the demo prompt is an <img> on an object URL read with the session's grant — never 'not recorded'", async () => {
    // rosettad's REST: every read recorded with the credential it carried
    const reads: Array<{ path: string; authorization: string | null }> = [];
    const rosetta = new RosettaClient({
      baseUrl: "http://127.0.0.1:47000",
      credential: { kind: "grant", grant: "g1" },
      fetchFn: (async (input: string | URL | Request, init?: RequestInit) => {
        reads.push({
          path: new URL(String(input)).pathname,
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return new Response(new Uint8Array([0x52, 0x49, 0x46, 0x46]), {
          status: 200,
          headers: { "x-rosetta-protocol-version": String(PROTOCOL_VERSION) },
        });
      }) as typeof fetch,
    });
    let made = 0;
    const blobs: Blob[] = [];
    assets = assetSourceOver(
      { anyClient: () => rosetta },
      {
        createObjectURL: (blob) => {
          blobs.push(blob);
          made += 1;
          return `blob:history/${made}`;
        },
        revokeObjectURL: () => undefined,
      },
    );
    const demo = createRoomDemo();
    const ports = { ...createDemoPorts(demo), assets, host: null };

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root?.render(<HistoryRoomView ports={ports} storage={null} openAt={{ sessionId: "s0" }} />),
    );

    const tiles = await until(() => {
      const figures = [...(host?.querySelectorAll<HTMLElement>(".tr-att figure") ?? [])];
      return figures.length === 2 ? figures : null;
    }, "the prompt's two attachment tiles");
    // each tile settles as a drawn image or as the room's missing face
    await until(
      () =>
        tiles.every((tile) => tile.querySelector("img") !== null || tile.textContent !== "")
          ? true
          : null,
      "each tile settled",
      3_000,
    );
    expect(tiles.map((tile) => tile.textContent)).toEqual(["", ""]);
    expect(host.textContent).not.toContain("Image data was not recorded");
    expect(host.textContent).not.toContain("Attachment preview unavailable");
    for (const tile of tiles) {
      expect(tile.querySelector("img")?.getAttribute("src")).toMatch(/^blob:history\/\d+$/);
    }
    // each tile's rendition, read from rosettad's own route with the grant
    expect(reads.length).toBeGreaterThanOrEqual(2);
    for (const read of reads) {
      expect(read.path).toMatch(/^\/api\/assets\/[0-9a-f]{64}\.webp$/);
      expect(read.authorization).toBe("Rosetta-Grant g1");
    }
    expect(blobs.every((blob) => blob.type === "image/webp")).toBe(true);
  }, 15_000);
});
