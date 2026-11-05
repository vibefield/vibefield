import {
  type SoundAttention,
  SoundAttention as SoundAttentionSchema,
  type SoundPreviewCue,
  SoundPreviewParams,
  type SoundPreviewResult,
} from "@vibefield/contracts";

// SD-2 — the window's two sound doors into main (IPC_CHANNELS.soundAttention, .soundPreview), as pure functions of
// the sender so a test knocks without Electron (ipc.ts binds them). Only a registered window's main frame may knock.
// Attention is heard only from the window in front: which pane has the keyboard is the person's (§14 rule 3), and a
// window behind does not have it. A Play in Settings (§8) is answered with whether it played, or why not.

export function createSoundAttentionDoor<Sender>(options: {
  owns: (sender: Sender) => boolean;
  focused: (sender: Sender) => boolean;
  accept: (attention: SoundAttention) => void;
}): (sender: Sender, mainFrame: boolean, raw: unknown) => void {
  return (sender, mainFrame, raw) => {
    if (!mainFrame || !options.owns(sender) || !options.focused(sender)) return;
    const parsed = SoundAttentionSchema.safeParse(raw);
    if (parsed.success) options.accept(parsed.data);
  };
}

export function createSoundPreviewDoor<Sender>(options: {
  owns: (sender: Sender) => boolean;
  play: (cue: SoundPreviewCue) => Promise<SoundPreviewResult>;
}): (sender: Sender, mainFrame: boolean, raw: unknown) => Promise<SoundPreviewResult> {
  return async (sender, mainFrame, raw) => {
    if (!options.owns(sender)) throw new Error("sound preview refused: unregistered sender");
    if (!mainFrame) throw new Error("sound preview refused: not the window's main frame");
    const request = SoundPreviewParams.parse(raw);
    return options.play(request.cue);
  };
}
