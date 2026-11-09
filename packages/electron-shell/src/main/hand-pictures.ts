import { rmSync } from "node:fs";
import { mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HandPictureWriteRequest, SCREENSHOT_LIMITS } from "@vibefield/contracts";

// A PICTURE BECOMES A FILE AT THE PLAY (OB-D10 A; `draft/thinking-objects-at-work.md` §4.4). A desk object's picture
// lives in the window as bytes, and what an agent's pane takes is a path, so when such a card is played main writes it
// here. The hand's folder is a fresh private temp directory for this run of the shell (`mkdtemp`, mode 0700, so a same-uid
// process, EL7, cannot have planted a link in it), twelve pictures kept as the stills are, and gone when the app quits.
// Nothing here writes under the person's home.

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** Do these bytes open as a PNG? The door takes pictures, nothing else. PURE. */
export function isPng(bytes: Uint8Array): boolean {
  return PNG_MAGIC.every((byte, index) => bytes[index] === byte);
}

export interface HandPicturesOptions {
  /** where the folder is made (left out: the OS's temp) */
  readonly parent?: string;
  /** how many are kept (left out: as many as the stills) */
  readonly limit?: number;
}

export class HandPictures {
  readonly #parent: string;
  readonly #limit: number;
  #dir: Promise<string> | null = null;
  #path: string | null = null;
  #seq = 0;
  readonly #kept: string[] = [];

  constructor(options: HandPicturesOptions = {}) {
    this.#parent = options.parent ?? tmpdir();
    this.#limit = options.limit ?? SCREENSHOT_LIMITS.RETAINED_STILLS;
  }

  async #folder(): Promise<string> {
    this.#dir ??= mkdtemp(join(this.#parent, "vibefield-hand-"));
    const dir = await this.#dir;
    this.#path = dir;
    return dir;
  }

  /** Write a PNG to the hand's folder and answer its path. The oldest past the limit goes. */
  async write(png: Uint8Array): Promise<string> {
    const dir = await this.#folder();
    this.#seq += 1;
    const path = join(dir, `vibefield-hand-${this.#seq}.png`);
    // `wx`: never over something already there, and only this process's user can read it
    await writeFile(path, png, { flag: "wx", mode: 0o600 });
    this.#kept.push(path);
    while (this.#kept.length > this.#limit) {
      const oldest = this.#kept.shift();
      if (oldest !== undefined) await unlink(oldest).catch(() => undefined);
    }
    return path;
  }

  /** The app is quitting: the folder and everything in it goes. */
  disposeSync(): void {
    if (this.#path === null) return;
    rmSync(this.#path, { recursive: true, force: true });
    this.#path = null;
    this.#dir = null;
    this.#kept.length = 0;
  }
}

/** Why a picture was not written, for the log alone. */
export type HandPictureRefusal = "unregistered-sender" | "not-a-png" | "write-failed";

/** The door's policy half (the still doors' shape): only a window this shell registered may write, and only a PNG within
 * the still's cap. Answers the file's path, or null. */
export function createHandPictureDoor<Sender>(options: {
  readonly owns: (sender: Sender) => boolean;
  readonly write: (png: Uint8Array) => Promise<string>;
  readonly onRefused?: (reason: HandPictureRefusal) => void;
}): (sender: Sender, raw: unknown) => Promise<string | null> {
  return async (sender, raw) => {
    if (!options.owns(sender)) {
      options.onRefused?.("unregistered-sender");
      throw new Error("hand picture refused: unregistered sender");
    }
    const { png } = HandPictureWriteRequest.parse(raw);
    if (!isPng(png)) {
      options.onRefused?.("not-a-png");
      return null;
    }
    try {
      return await options.write(png);
    } catch {
      options.onRefused?.("write-failed");
      return null;
    }
  };
}
