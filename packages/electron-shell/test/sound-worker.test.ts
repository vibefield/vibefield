/**
 * SD-2 — main's render worker: one thread, started on the first ask and ended after a minute with none, every ask
 * answered by id, and a thread that dies failing what it held (the next ask starts another). The last row bundles
 * the real thread entry (as the build does, into dist/main/sound-worker.cjs) and renders through it.
 */
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSoundRenderer,
  RENDER_IDLE_MS,
  type RenderAnswer,
  type RenderAsk,
  type RenderThread,
} from "../src/main/sound-worker";

class FakeThread extends EventEmitter {
  readonly asks: RenderAsk[] = [];
  terminated = 0;
  postMessage(ask: RenderAsk): void {
    this.asks.push(ask);
  }
  unref(): void {}
  async terminate(): Promise<number> {
    this.terminated++;
    return 0;
  }
  answer(answer: RenderAnswer): void {
    this.emit("message", answer);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the render worker, as main holds it", () => {
  it("starts one thread on the first ask and answers each ask by its id", async () => {
    const threads: FakeThread[] = [];
    const renderer = createSoundRenderer({
      path: "/app/main/sound-worker.cjs",
      start: (path) => {
        expect(path).toBe("/app/main/sound-worker.cjs");
        const t = new FakeThread();
        threads.push(t);
        return t as unknown as RenderThread;
      },
    });
    const a = renderer.render("done", { space: "day" });
    const b = renderer.render("approval", {});
    expect(threads).toHaveLength(1);
    const [first, second] = threads[0]!.asks;
    threads[0]!.answer({ id: second!.id, bytes: Uint8Array.from([2]) });
    threads[0]!.answer({ id: first!.id, error: "no such space" });
    await expect(b).resolves.toEqual(Uint8Array.from([2]));
    await expect(a).rejects.toThrow("no such space");
    renderer.dispose();
  });
  it("ends the thread after a minute with no ask, and starts another for the next", async () => {
    vi.useFakeTimers();
    const threads: FakeThread[] = [];
    const renderer = createSoundRenderer({
      path: "/w.cjs",
      start: () => {
        const t = new FakeThread();
        threads.push(t);
        return t as unknown as RenderThread;
      },
    });
    const a = renderer.render("done", {});
    threads[0]!.answer({ id: threads[0]!.asks[0]!.id, bytes: Uint8Array.from([1]) });
    await a;
    vi.advanceTimersByTime(RENDER_IDLE_MS - 1);
    expect(threads[0]!.terminated).toBe(0);
    vi.advanceTimersByTime(1);
    expect(threads[0]!.terminated).toBe(1);
    void renderer.render("done", {}).catch(() => {});
    expect(threads).toHaveLength(2);
    renderer.dispose();
  });
  it("fails what a dying thread held, and starts afresh", async () => {
    const threads: FakeThread[] = [];
    const renderer = createSoundRenderer({
      path: "/w.cjs",
      start: () => {
        const t = new FakeThread();
        threads.push(t);
        return t as unknown as RenderThread;
      },
    });
    const a = renderer.render("failed", {});
    threads[0]!.emit("exit", 1);
    await expect(a).rejects.toThrow("exited (1)");
    void renderer.render("failed", {}).catch(() => {});
    expect(threads).toHaveLength(2);
    renderer.dispose();
  });
  it("refuses a cue the family does not have, starting nothing", async () => {
    const start = vi.fn();
    const renderer = createSoundRenderer({ path: "/w.cjs", start });
    await expect(renderer.render("bell" as never, {})).rejects.toThrow("unknown cue");
    expect(start).not.toHaveBeenCalled();
  });
});

describe("the real thread, bundled as the build bundles it", () => {
  it("renders a sound off main's thread and hands back its WAV", async () => {
    const dir = mkdtempSync(join(tmpdir(), "vf-sound-thread-"));
    try {
      const outfile = join(dir, "sound-worker.cjs");
      await build({
        entryPoints: [join(import.meta.dirname, "../src/main/sound-worker-thread.ts")],
        bundle: true,
        platform: "node",
        format: "cjs",
        outfile,
        logLevel: "silent",
      });
      const renderer = createSoundRenderer({ path: outfile });
      try {
        const wav = await renderer.render("question", { space: "night", pan: 0.3 });
        expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
        expect(wav.length).toBeGreaterThan(44 + 48_000 * 3);
      } finally {
        renderer.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
