// @vitest-environment node
/**
 * OB-D10 A — a desk picture becomes a file at the play: a private temp folder for this run, twelve kept as the stills
 * are, a PNG only, and only from a window this shell registered. Nothing under the person's home.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SCREENSHOT_LIMITS, SCREENSHOT_STILL } from "@vibefield/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createHandPictureDoor, HandPictures, isPng } from "../src/main/hand-pictures";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let parents: string[] = [];
const parent = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "hand-pictures-test-"));
  parents.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of parents) rmSync(dir, { recursive: true, force: true });
  parents = [];
});

describe("the hand's folder", () => {
  it("writes a picture under a fresh private folder and answers its path", async () => {
    const root = parent();
    const pictures = new HandPictures({ parent: root });
    const path = await pictures.write(PNG);
    expect(dirname(dirname(path))).toBe(root);
    expect(dirname(path).startsWith(join(root, "vibefield-hand-"))).toBe(true);
    expect(readFileSync(path)).toEqual(Buffer.from(PNG));
    expect(statSync(dirname(path)).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("keeps twelve, as the stills are: the oldest past it is gone", async () => {
    const pictures = new HandPictures({ parent: parent() });
    const paths: string[] = [];
    for (let n = 0; n < SCREENSHOT_LIMITS.RETAINED_STILLS + 2; n += 1) {
      paths.push(await pictures.write(PNG));
    }
    expect(existsSync(paths[0] ?? "")).toBe(false);
    expect(existsSync(paths[1] ?? "")).toBe(false);
    expect(existsSync(paths[2] ?? "")).toBe(true);
    expect(readdirSync(dirname(paths[0] ?? ""))).toHaveLength(SCREENSHOT_LIMITS.RETAINED_STILLS);
  });

  it("is gone when the app quits", async () => {
    const pictures = new HandPictures({ parent: parent() });
    const path = await pictures.write(PNG);
    pictures.disposeSync();
    expect(existsSync(dirname(path))).toBe(false);
    expect(() => pictures.disposeSync()).not.toThrow();
  });
});

describe("the door", () => {
  const door = (over: Partial<Parameters<typeof createHandPictureDoor<number>>[0]> = {}) => {
    const refused: string[] = [];
    const take = createHandPictureDoor<number>({
      owns: (sender) => sender === 1,
      write: async () => "/tmp/x/vibefield-hand-1.png",
      onRefused: (reason) => refused.push(reason),
      ...over,
    });
    return { take, refused };
  };

  it("answers the path for a window this shell registered", async () => {
    const { take } = door();
    await expect(take(1, { png: PNG })).resolves.toBe("/tmp/x/vibefield-hand-1.png");
  });

  it("refuses a window it does not know", async () => {
    const { take, refused } = door();
    await expect(take(2, { png: PNG })).rejects.toThrow("unregistered sender");
    expect(refused).toEqual(["unregistered-sender"]);
  });

  it("takes a PNG only, and nothing past the still's cap", async () => {
    const { take, refused } = door();
    await expect(take(1, { png: new Uint8Array([1, 2, 3]) })).resolves.toBeNull();
    expect(refused).toEqual(["not-a-png"]);
    await expect(
      take(1, { png: new Uint8Array(SCREENSHOT_STILL.MAX_BYTES + 1) }),
    ).rejects.toThrow();
    await expect(take(1, { png: "not bytes" })).rejects.toThrow();
  });

  it("answers null when the disk would not take it", async () => {
    const { take, refused } = door({
      write: async () => {
        throw new Error("ENOSPC");
      },
    });
    await expect(take(1, { png: PNG })).resolves.toBeNull();
    expect(refused).toEqual(["write-failed"]);
  });

  it("recognises a PNG by its magic", () => {
    expect(isPng(PNG)).toBe(true);
    expect(isPng(new Uint8Array(4))).toBe(false);
  });
});
