import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type CueId, ENGINE_HASH, type RenderOptions, renderKey } from "@vibefield/sound";

// SD-2 — the renders main plays, one file per sound: `<dir>/<ENGINE_HASH>/<renderKey>.wav`. A file rendered once is
// found again on every launch after; the folder is named for the score, so a build whose sound differs never plays an
// older build's file, and the folders of older scores are pruned. Two asks for one sound in flight are one render; a
// render that fails fails its asks and leaves nothing behind, and the next ask tries afresh.

export interface SoundRenderFs {
  exists(path: string): boolean;
  /** Writes the whole file or nothing (the real one writes beside it and renames). */
  write(path: string, bytes: Uint8Array): Promise<void>;
  mkdir(path: string): Promise<void>;
}

/** What one ask found: a file made now, or one already there. */
export interface SoundRenderEvent {
  readonly cue: CueId;
  readonly key: string;
  readonly outcome: "rendered" | "found";
  /** How long a render took, ms; 0 for a file found. */
  readonly ms: number;
}

export class SoundRenders {
  private readonly inFlight = new Map<string, Promise<string>>();
  private readonly folder: string;

  constructor(
    private readonly options: {
      readonly dir: string;
      readonly render: (cue: CueId, options: RenderOptions) => Promise<Uint8Array>;
      readonly fs?: SoundRenderFs;
      readonly onFile?: (event: SoundRenderEvent) => void;
      readonly now?: () => number;
    },
  ) {
    this.folder = join(options.dir, ENGINE_HASH);
  }

  /** The file for this sound, rendering it first if no launch has. */
  file(cue: CueId, options: RenderOptions): Promise<string> {
    const key = renderKey(cue, options);
    const path = join(this.folder, `${key}.wav`);
    const fs = this.options.fs ?? NODE_RENDER_FS;
    if (fs.exists(path)) {
      this.options.onFile?.({ cue, key, outcome: "found", ms: 0 });
      return Promise.resolve(path);
    }
    const running = this.inFlight.get(path);
    if (running !== undefined) return running;
    const now = this.options.now ?? (() => performance.now());
    const started = now();
    const made = (async () => {
      const bytes = await this.options.render(cue, options);
      await fs.mkdir(this.folder);
      await fs.write(path, bytes);
      this.options.onFile?.({ cue, key, outcome: "rendered", ms: Math.round(now() - started) });
      return path;
    })().finally(() => this.inFlight.delete(path));
    this.inFlight.set(path, made);
    return made;
  }
}

/** The renders' real filesystem: a file is written beside itself and renamed into place. */
export const NODE_RENDER_FS: SoundRenderFs = {
  exists: existsSync,
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  write: async (path, bytes) => {
    const partial = `${path}.${randomBytes(4).toString("hex")}.partial`;
    try {
      await writeFile(partial, bytes);
      await rename(partial, path);
    } finally {
      await rm(partial, { force: true });
    }
  },
};

/** An older score's folder: 8 hex digits, as ENGINE_HASH is, and not this one. */
export function isStaleScoreFolder(name: string): boolean {
  return /^[0-9a-f]{8}$/.test(name) && name !== ENGINE_HASH;
}

/** Remove the folders of older scores under `dir`: nothing else there is touched. */
export async function pruneStaleScores(dir: string): Promise<readonly string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const stale = names.filter(isStaleScoreFolder);
  for (const name of stale) await rm(join(dir, name), { recursive: true, force: true });
  return stale;
}
