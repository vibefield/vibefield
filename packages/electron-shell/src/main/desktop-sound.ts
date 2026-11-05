import type { SoundPlayerState, SoundPreviewCue, SoundPreviewResult } from "@vibefield/contracts";
import { type CueId, type RenderOptions, renderKey } from "@vibefield/sound";
import type { SoundPlayer } from "./sound-player";
import type { SoundPreferences } from "./sound-voice";

// SD-2 — the desktop's sound, as main composes it: the player (sound-player.ts), the renders (sound-renders.ts, off
// main's thread) and the three asks of it.
// - An agent's sound, from the voice (sound-voice.ts), which has already passed the gates (front, Play sounds, Quiet).
// - A Play in Settings → Sound (§8): centred, in the theme's space, through the path an agent's sound takes; it plays
//   while Quiet holds (you asked for it) and answers why when it cannot.
// - The likeliest sound made ahead of need: once Play sounds is on, on a Mac, Done in the theme's space, centred, so
//   the first one plays without waiting on its render. A file a past launch made is found, not
//   remade. It is also smoke:update's packaged witness that the worker starts from inside app.asar.
// A harness never makes a sound (`audible` false): a smoke renders, and every play is held and said.

export interface SoundLog {
  info(event: string, message: string, attrs?: Record<string, unknown>): void;
  warn(event: string, message: string, attrs?: Record<string, unknown>): void;
}

export interface DesktopSound {
  /** Whether this Mac can play the sounds, and if not, why (Settings → Sound's switch line). */
  state(): SoundPlayerState;
  /** Play an agent's sound (the voice's gates already passed). */
  play(cue: CueId, options: RenderOptions): void;
  /** A Play in Settings → Sound. */
  preview(cue: SoundPreviewCue): Promise<SoundPreviewResult>;
  /** Make the likeliest sound ahead of need, once a launch; a no-op until the preferences are read. */
  prepare(): void;
}

export function createDesktopSound(options: {
  readonly player: SoundPlayer;
  readonly renders: { file(cue: CueId, options: RenderOptions): Promise<string> };
  readonly theme: () => "light" | "dark";
  /** null until fieldd's preferences are read: until then nothing plays and nothing is made. */
  readonly preferences: () => SoundPreferences | null;
  /** false in every harness mode: nothing is ever heard there. */
  readonly audible: boolean;
  readonly log: SoundLog;
}): DesktopSound {
  const { player, renders, log } = options;
  const space = () => (options.theme() === "dark" ? "night" : "day");
  let prepared = false;

  const sound = async (cue: CueId, renderOptions: RenderOptions, source: "agent" | "settings") => {
    const key = renderKey(cue, renderOptions);
    if (!options.audible) {
      log.info("desktop.sound.held", "A sound was held: this is a harness run", {
        cue,
        key,
        source,
      });
      return false;
    }
    const file = await renders.file(cue, renderOptions);
    const played = await player.play(file);
    if (played) log.info("desktop.sound.played", "A sound played", { cue, key, source });
    return played;
  };

  return {
    state: () => player.state(),
    play(cue, renderOptions) {
      if (player.state() !== "ready") return;
      void sound(cue, renderOptions, "agent").catch((error: unknown) => {
        log.warn("desktop.sound.play_failed", "An agent's sound could not play", {
          cue,
          reason: error instanceof Error ? error.message : String(error),
        });
      });
    },
    async preview(cue) {
      if (player.state() !== "ready" || !options.audible) {
        return { played: false, reason: "unavailable" };
      }
      if (options.preferences()?.sounds !== true) return { played: false, reason: "off" };
      try {
        const played = await sound(cue, { space: space(), profile: "desktop" }, "settings");
        return played ? { played: true } : { played: false, reason: "failed" };
      } catch (error) {
        log.warn("desktop.sound.preview_failed", "A Play in Settings could not play", {
          cue,
          reason: error instanceof Error ? error.message : String(error),
        });
        return { played: false, reason: "failed" };
      }
    },
    prepare() {
      if (prepared || options.preferences()?.sounds !== true) return;
      // On every Mac, whether or not its player loaded: a player that would not start says so on its own line
      // (`desktop.sound.unavailable`), and the render is the worker's witness either way.
      if (player.state() === "unsupported") return;
      prepared = true;
      void renders.file("done", { space: space(), profile: "desktop" }).catch((error: unknown) => {
        log.warn("desktop.sound.prepare_failed", "The likeliest sound could not be made ahead", {
          reason: error instanceof Error ? error.message : String(error),
        });
      });
    },
  };
}
