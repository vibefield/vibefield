import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "@vibefield/logging";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ReleaseState, TerminalReleases } from "../src/terminal-releases";

const roots: string[] = [];
const queues: TerminalReleases[] = [];
const logger = { debug: vi.fn() } as unknown as Logger;
const request = { sessionId: "shell", condition: "unused" as const };
function fixture(release = vi.fn(async (): Promise<ReleaseState> => "released"), file?: string) {
  if (file === undefined) {
    const root = mkdtempSync(join(tmpdir(), "vf-releases-"));
    roots.push(root);
    file = join(root, "pending.json");
  }
  const queue = new TerminalReleases({ file, release, logger, retryMs: 60_000 });
  queues.push(queue);
  return { queue, release, file };
}
afterEach(() => {
  for (const queue of queues.splice(0)) queue.dispose();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("durable conditional terminal release", () => {
  it("survives a lost response and a fieldd restart, discharging only on the native answer", async () => {
    const first = fixture(
      vi.fn(async () => {
        throw new Error("response lost");
      }),
    );
    first.queue.enqueue(request);
    expect(JSON.parse(readFileSync(first.file, "utf8")).pending).toEqual([request]);
    await first.queue.flush();
    first.queue.dispose();
    const restarted = fixture(
      vi.fn(async () => "gone" as const),
      first.file,
    );
    expect(restarted.queue.list()).toEqual([request]);
    await restarted.queue.flush();
    expect(restarted.release).toHaveBeenCalledExactlyOnceWith(request);
    expect(JSON.parse(readFileSync(first.file, "utf8")).pending).toEqual([]);
  });

  it.each(["attached", "busy", "running"] as const)(
    "retains a %s session until the owner permits release",
    async (state) => {
      const f = fixture(vi.fn(async (): Promise<ReleaseState> => state));
      f.queue.enqueue(request);
      await f.queue.flush();
      expect(f.queue.list()).toEqual([request]);
      f.release.mockResolvedValue("released");
      await f.queue.flush();
      expect(f.queue.list()).toEqual([]);
    },
  );

  it.each(["used", "not-shell"] as const)(
    "discharges a %s session without asking to kill it",
    async (state) => {
      const f = fixture(vi.fn(async () => state));
      f.queue.enqueue(request);
      await f.queue.flush();
      expect(f.queue.list()).toEqual([]);
      expect(f.release).toHaveBeenCalledExactlyOnceWith(request);
    },
  );

  it("coalesces in-flight deliveries and fences completions after disposal", async () => {
    let finish!: (state: ReleaseState) => void;
    const f = fixture(
      vi.fn(
        () =>
          new Promise<ReleaseState>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    f.queue.enqueue(request);
    const pending = f.queue.flush();
    f.queue.enqueue(request);
    await f.queue.flush();
    expect(f.release).toHaveBeenCalledTimes(1);
    f.queue.dispose();
    finish("released");
    await pending;
    expect(JSON.parse(readFileSync(f.file, "utf8")).pending).toEqual([request]);
  });

  it("does not let an older unused intent overwrite an exited obligation", async () => {
    const f = fixture(vi.fn(async (): Promise<ReleaseState> => "attached"));
    f.queue.enqueue(request);
    f.queue.enqueue({ ...request, condition: "exited" });
    f.queue.enqueue(request);
    expect(f.queue.list()).toHaveLength(2);
    await f.queue.flush();
    expect(f.release).toHaveBeenCalledTimes(2);
  });

  it("refuses before accepting an intent that cannot be persisted", () => {
    const f = fixture();
    rmSync(f.file, { force: true });
    rmSync(join(f.file, ".."), { recursive: true, force: true });
    writeFileSync(join(f.file, ".."), "blocks the directory");
    expect(() => f.queue.enqueue(request)).toThrow();
    expect(f.queue.list()).toEqual([]);
    expect(f.release).not.toHaveBeenCalled();
  });
});
