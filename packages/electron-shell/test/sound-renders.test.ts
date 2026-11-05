/**
 * SD-2 — the renders main plays. Each sound is rendered once, off main's thread, into a file named for itself under
 * a folder named for the score (`ENGINE_HASH`), so a file is found again across launches and never outlives a change
 * to the sound. Two asks for one sound in flight are one render. The worker's own work is `renderWav`, tested here
 * as a function; the thread around it is the bundle's (verify-production-main).
 */
import { join } from "node:path";
import { ENGINE_HASH, renderKey } from "@vibefield/sound";
import { describe, expect, it, vi } from "vitest";
import { SoundRenders } from "../src/main/sound-renders";
import { renderWav } from "../src/main/sound-worker";

function memoryFs() {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  return {
    files,
    dirs,
    fs: {
      exists: (path: string) => files.has(path),
      write: async (path: string, bytes: Uint8Array) => {
        files.set(path, bytes);
      },
      mkdir: async (path: string) => {
        dirs.add(path);
      },
    },
  };
}

describe("one file per sound", () => {
  it("renders a sound once, into its own name under the score's folder", async () => {
    const m = memoryFs();
    const render = vi.fn(async () => Uint8Array.from([1, 2, 3]));
    const renders = new SoundRenders({ dir: "/cache/sound", render, fs: m.fs });
    const file = await renders.file("done", { space: "night", pan: 0.3 });
    expect(file).toBe(
      join("/cache/sound", ENGINE_HASH, `${renderKey("done", { space: "night", pan: 0.3 })}.wav`),
    );
    expect(m.files.get(file)).toEqual(Uint8Array.from([1, 2, 3]));
    expect(await renders.file("done", { space: "night", pan: 0.3 })).toBe(file);
    expect(render).toHaveBeenCalledTimes(1);
  });
  it("finds a file a past launch rendered, and renders nothing", async () => {
    const m = memoryFs();
    const path = join("/cache/sound", ENGINE_HASH, `${renderKey("question", {})}.wav`);
    m.files.set(path, Uint8Array.from([9]));
    const render = vi.fn(async () => Uint8Array.from([0]));
    const renders = new SoundRenders({ dir: "/cache/sound", render, fs: m.fs });
    expect(await renders.file("question", {})).toBe(path);
    expect(render).not.toHaveBeenCalled();
  });
  it("makes two asks in flight one render", async () => {
    const m = memoryFs();
    let finish!: (bytes: Uint8Array) => void;
    const render = vi.fn(() => new Promise<Uint8Array>((resolve) => (finish = resolve)));
    const renders = new SoundRenders({ dir: "/c", render, fs: m.fs });
    const a = renders.file("approval", {});
    const b = renders.file("approval", {});
    finish(Uint8Array.from([4]));
    expect(await a).toBe(await b);
    expect(render).toHaveBeenCalledTimes(1);
  });
  it("lets a failed render fail its ask, and tries afresh next time", async () => {
    const m = memoryFs();
    const render = vi
      .fn<() => Promise<Uint8Array>>()
      .mockRejectedValueOnce(new Error("worker gone"))
      .mockResolvedValueOnce(Uint8Array.from([5]));
    const renders = new SoundRenders({ dir: "/c", render, fs: m.fs });
    await expect(renders.file("failed", {})).rejects.toThrow("worker gone");
    expect(m.files.size).toBe(0);
    expect(await renders.file("failed", {})).toMatch(/\.wav$/);
    expect(render).toHaveBeenCalledTimes(2);
  });
});

describe("the worker's work", () => {
  it("renders a sound into the WAV the system plays", () => {
    const wav = renderWav("done", { space: "day" });
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe("WAVE");
    expect(wav.length).toBeGreaterThan(44 + 48_000 * 6);
  });
});
