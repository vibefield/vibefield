import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute } from "node:path";
import type { SoundPlayerState } from "@vibefield/contracts";

// SD-2 (DESIGN.md §14 "In VibeField", §8 "Settings → Sound") — the system-sound player, as main holds it. The addon
// (apps/desktop/native/macos/sound/player.mm) plays a file as a system sound through the alert volume and the
// sound-effects device, and answers the OSStatus once the file has played to its end. It is loaded once, lazily, as
// the haptic adapter is (zoom-haptics.ts), and says honestly why it cannot play: off macOS (`unsupported`), a build
// without it (`missing`), or one it would not start (`failed`, said once and never retried). Settings → Sound says
// each in the switch's own line: never a switch that silently does nothing.

interface NativeSoundPlayer {
  play(path: string): Promise<number>;
}

export interface SoundPlayer {
  /** Whether this Mac can play the sounds, and if not, why. The first ask loads the addon. */
  state(): SoundPlayerState;
  /** Play one rendered file; true once the system has played it to its end. */
  play(file: string): Promise<boolean>;
}

/** The longest sound is the mark at night, about 6.6 s (§14); a play that has not answered by then never will. */
export const SOUND_PLAY_BOUND_MS = 15_000;

export function createSoundPlayer(options: {
  platform: string;
  path: string | null;
  exists?: (path: string) => boolean;
  load?: (path: string) => unknown;
  onError?: (error: unknown) => void;
  boundMs?: number;
}): SoundPlayer {
  let state: SoundPlayerState | null = null;
  let addon: NativeSoundPlayer | null = null;

  const loadState = (): SoundPlayerState => {
    if (options.platform !== "darwin") return "unsupported";
    const path = options.path;
    if (path === null) return "missing";
    try {
      if (!isAbsolute(path)) throw new Error("sound player path must be absolute");
      if (!(options.exists ?? existsSync)(path)) return "missing";
      const raw = (options.load ?? createRequire(__filename))(path);
      if (
        typeof raw !== "object" ||
        raw === null ||
        typeof (raw as NativeSoundPlayer).play !== "function"
      ) {
        throw new Error("sound player has an invalid export surface");
      }
      addon = raw as NativeSoundPlayer;
      return "ready";
    } catch (error) {
      options.onError?.(error);
      return "failed";
    }
  };

  // Settled on the first ask and never retried: a player that would not start says so once.
  const resolveState = (): SoundPlayerState => {
    state ??= loadState();
    return state;
  };

  return {
    state: resolveState,
    async play(file) {
      if (resolveState() !== "ready" || addon === null) return false;
      const bound = options.boundMs ?? SOUND_PLAY_BOUND_MS;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const status = await Promise.race([
          addon.play(file),
          new Promise<"timeout">((resolve) => {
            timer = setTimeout(() => resolve("timeout"), bound);
          }),
        ]);
        if (status === 0) return true;
        options.onError?.(
          new Error(
            status === "timeout"
              ? `sound play did not finish within ${bound} ms`
              : `sound play refused (OSStatus ${status})`,
          ),
        );
        return false;
      } catch (error) {
        options.onError?.(error);
        return false;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}
