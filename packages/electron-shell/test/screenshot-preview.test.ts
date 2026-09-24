import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createScreenshotPreviewDoor } from "../src/main/screenshot-preview";

vi.mock("electron", () => ({ protocol: {} }));
const { resolveStillFile } = await import("../src/main/still-protocol");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "vf-preview-"));
  roots.push(root);
  const path = join(root, "capture.png");
  writeFileSync(path, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  let retained = [path];
  const sender = { id: 1 };
  const preview = vi.fn(async () => {});
  const door = createScreenshotPreviewDoor({
    owns: (candidate: typeof sender) => candidate === sender,
    resolve: (url) => resolveStillFile(url, { retained: () => retained }),
    preview,
  });
  return {
    root,
    path,
    sender,
    preview,
    door,
    evict: () => {
      retained = [];
    },
  };
}

describe("the retained-still Quick Look door", () => {
  it("passes only a real retained file to the native preview, then refuses it after eviction", async () => {
    const f = fixture();
    expect(await f.door(f.sender, { name: "capture.png" })).toEqual({ ok: true });
    expect(f.preview).toHaveBeenCalledWith(f.sender, expect.stringMatching(/\/capture\.png$/));
    f.evict();
    expect(await f.door(f.sender, { name: "capture.png" })).toMatchObject({ ok: false });
    expect(f.preview).toHaveBeenCalledTimes(1);
  });

  it("rejects foreign senders, paths, non-PNGs and unretained names", async () => {
    const f = fixture();
    await expect(f.door({ id: 1 }, { name: "capture.png" })).rejects.toThrow("unregistered");
    for (const name of [f.path, "../capture.png", "..\\capture.png", "secret", "bad\0.png"]) {
      await expect(f.door(f.sender, { name })).rejects.toThrow();
    }
    expect(await f.door(f.sender, { name: "other.png" })).toMatchObject({ ok: false });
    expect(f.preview).not.toHaveBeenCalled();
  });

  it("refuses a retained path replaced by a symlink", async () => {
    const f = fixture();
    const other = join(f.root, "other.png");
    writeFileSync(other, "not the retained file");
    rmSync(f.path);
    symlinkSync(other, f.path);
    expect(await f.door(f.sender, { name: "capture.png" })).toMatchObject({ ok: false });
    expect(f.preview).not.toHaveBeenCalled();
  });

  it("reports a native preview failure to the tile", async () => {
    const f = fixture();
    f.preview.mockRejectedValue(new Error("native failure"));
    expect(await f.door(f.sender, { name: "capture.png" })).toMatchObject({
      ok: false,
      message: expect.stringContaining("could not"),
    });
  });
});
