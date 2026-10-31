// WP12b (build-wp12-updater.md §3) — the updater's persisted client state: the person's choices (off switch,
// channel, declined versions) and TD-10's remembered versions, beside `UpdateState`. Electron main writes it; the
// renderer never does (EDP-38). Atomic (temp + rename), 0600 in a 0700 directory.
//
// A file that cannot be read is moved aside (kept for diagnosis) and replaced by a fresh state, SAID through the
// returned `recovered` flag — never a silent reset, and never a permanent refusal that would leave an installation
// unable to update for the rest of its life.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  type UpdateChannel,
  UpdateClientStateFile,
  type UpdateLastApply,
} from "@vibefield/contracts";
import type { AdoptedRoot } from "./root-chain";
import { NOTHING_REMEMBERED, type RememberedVersions } from "./verify-chain";

export interface UpdateClientState {
  readonly enabled: boolean | undefined;
  readonly channel: UpdateChannel | undefined;
  readonly declined: readonly string[];
  readonly remembered: RememberedVersions;
  readonly lastCheckAt: number | null;
  /** WP12c (§10 S4) — the last apply's branch, written before every exit it takes */
  readonly lastApply: UpdateLastApply | null;
  /** AU-1 (AU-D3 A) — the version staged on this Mac and when it FIRST became ready (kept across launches) */
  readonly staged: { readonly version: string; readonly at: number } | null;
  /** L3b-ii (B5) — the trust-root documents adopted by rotation, oldest first (`root-chain.ts`) */
  readonly trustRoots: readonly AdoptedRoot[];
}

export const FRESH_CLIENT_STATE: UpdateClientState = {
  enabled: undefined,
  channel: undefined,
  declined: [],
  remembered: NOTHING_REMEMBERED,
  lastCheckAt: null,
  lastApply: null,
  staged: null,
  trustRoots: [],
};

export interface StoreFs {
  readFile(path: string): string | null;
  writeAtomic(path: string, text: string): void;
  moveAside(path: string, to: string): void;
}

const nodeFs: StoreFs = {
  readFile(path) {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  },
  writeAtomic(path, text) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, text, { mode: 0o600 });
    renameSync(tmp, path);
  },
  moveAside(path, to) {
    renameSync(path, to);
  },
};

export class UpdateStateStore {
  constructor(
    private readonly path: string,
    private readonly fs: StoreFs = nodeFs,
    private readonly now: () => number = Date.now,
  ) {}

  /** The persisted state, or a fresh one; `recovered` names a file that could not be read and was moved aside. */
  load(): { state: UpdateClientState; recovered: string | null } {
    const text = this.fs.readFile(this.path);
    if (text === null) return { state: FRESH_CLIENT_STATE, recovered: null };
    let parsed: ReturnType<typeof UpdateClientStateFile.safeParse> | null = null;
    try {
      parsed = UpdateClientStateFile.safeParse(JSON.parse(text));
    } catch {
      parsed = null;
    }
    if (parsed === null || !parsed.success) {
      const aside = `${this.path}.unreadable-${this.now()}`;
      try {
        this.fs.moveAside(this.path, aside);
      } catch {
        // a state we can neither read nor move is still replaced on the next save
      }
      return { state: FRESH_CLIENT_STATE, recovered: aside };
    }
    const data = parsed.data;
    return {
      state: {
        enabled: data.enabled,
        channel: data.channel,
        declined: data.declined,
        remembered: data.remembered,
        lastCheckAt: data.lastCheckAt,
        lastApply: data.lastApply,
        staged: data.staged,
        trustRoots: data.trustRoots,
      },
      recovered: null,
    };
  }

  save(state: UpdateClientState): void {
    const doc = {
      schemaVersion: 1,
      ...(state.enabled !== undefined ? { enabled: state.enabled } : {}),
      ...(state.channel !== undefined ? { channel: state.channel } : {}),
      declined: [...state.declined],
      remembered: state.remembered,
      lastCheckAt: state.lastCheckAt,
      lastApply: state.lastApply,
      staged: state.staged,
      trustRoots: [...state.trustRoots],
    };
    this.fs.writeAtomic(this.path, `${JSON.stringify(doc, null, 2)}\n`);
  }
}
