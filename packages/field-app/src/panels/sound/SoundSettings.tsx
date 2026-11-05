import type { SoundPlayerState } from "@vibefield/contracts";
import { UiButton } from "@vibefield/design-kit";
import { CUES, PREVIEW_CUES } from "@vibefield/sound";
import type { ReactElement } from "react";
import { labelCls, SettingsRow, SettingsSection, SettingsSwitch } from "../settings-ui";

// SD-2 — Settings → Sound (DESIGN.md §8 "Settings → Sound"; the law is §14), controller-free: what the page shows and
// where each act goes. The page's switch, the family's rows in §14's order (each its name, what it says, and Play),
// Quiet, and the foot. Without a player the switch is off and disabled and its own line says why: never a switch that
// silently does nothing. The live section (`SoundSection`) and the catalog (`SoundSettingsPreview`) both mount it.

export type PreviewCue = (typeof PREVIEW_CUES)[number];

export interface SoundSettingsModel {
  /** Play sounds, as the person's preferences say it. */
  readonly on: boolean;
  /** Whether this Mac can play the sounds, and if not, why. */
  readonly player: SoundPlayerState;
  /** While Quiet holds, when it ends, in this Mac's own time format ("8:00 AM"); absent, no Quiet. */
  readonly quietUntilText?: string;
  /** False while the preferences cannot be read or a change is on its way: nothing can be changed (default true). */
  readonly writable?: boolean;
}

const PLAYS_FOR =
  "A sound when an agent finishes, asks you something, needs your approval or stops on an error.";

/** The switch's line where there is no player (§8): why, never a switch that silently does nothing. */
const WHY_NOT: Record<Exclude<SoundPlayerState, "ready">, string> = {
  unsupported: "Sounds play on macOS.",
  missing: "This build has no sound player.",
  failed: "The sound player didn't start.",
};

export function SoundSettingsView({
  model,
  onSounds,
  onPlay,
  onQuiet,
}: {
  model: SoundSettingsModel;
  onSounds: (on: boolean) => void;
  onPlay: (cue: PreviewCue) => void;
  onQuiet: (quiet: "hour" | "tomorrow" | null) => void;
}): ReactElement {
  const ready = model.player === "ready";
  const writable = model.writable ?? true;
  const on = ready && model.on;
  const quiet = model.quietUntilText !== undefined;
  return (
    <SettingsSection
      title="Play sounds"
      description={model.player === "ready" ? PLAYS_FOR : WHY_NOT[model.player]}
      action={
        <SettingsSwitch
          label="Play sounds"
          checked={on}
          disabled={!ready || !writable}
          onChange={onSounds}
        />
      }
    >
      {PREVIEW_CUES.map((cue) => (
        <SettingsRow
          key={cue}
          title={CUES[cue].label}
          description={CUES[cue].says}
          marks={{ "data-sound-row": cue }}
        >
          {/* §8: Play plays while Quiet holds (you asked for it), and is disabled while Play sounds is off */}
          <UiButton
            variant="quiet"
            aria-label={`Play ${CUES[cue].label}`}
            disabled={!on}
            onClick={() => onPlay(cue)}
          >
            Play
          </UiButton>
        </SettingsRow>
      ))}
      <SettingsRow
        title="Quiet"
        {...(quiet ? { description: `Quiet until ${model.quietUntilText}.` } : {})}
        divider={false}
      >
        {quiet ? (
          <UiButton variant="quiet" disabled={!writable} onClick={() => onQuiet(null)}>
            Turn sounds back on
          </UiButton>
        ) : (
          <div className="flex items-center gap-2">
            <UiButton variant="quiet" disabled={!on || !writable} onClick={() => onQuiet("hour")}>
              For an hour
            </UiButton>
            <UiButton
              variant="quiet"
              disabled={!on || !writable}
              onClick={() => onQuiet("tomorrow")}
            >
              Until tomorrow
            </UiButton>
          </div>
        )}
      </SettingsRow>
      <p className={`mt-3 max-w-[60ch] ${labelCls}`}>
        Sounds follow your Mac's alert volume and the output chosen for sound effects in System
        Settings → Sound. For now they play only while a VibeField window is in front.
      </p>
    </SettingsSection>
  );
}
