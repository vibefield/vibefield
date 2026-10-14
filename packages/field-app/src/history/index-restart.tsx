import { UiButton } from "@vibefield/design-kit/primitives";
import { type ReactElement, useCallback, useState } from "react";
import { refusalWords } from "./doors";

// fix7 (2026-10-14; DESIGN.md §8 "History" — the index's failed state carries
// its act). PJ-7's first phone run met an index that had FAILED (restart
// intensity), whose sentence said "use the restart affordance to try again" —
// and no window offered one: `system.index.restart` was native.admin, which a
// window's token never holds. It rides `agents.manage` now (methods.ts), the
// window holds that, and this is the button: VibeField's own, in the frame
// under the room, because the room says its own connection line in place of a
// host's node while its status read fails.

/** What the band says after a press. */
export type IndexRestartState =
  | { state: "idle" }
  | { state: "restarting" }
  | { state: "restarted"; words: string }
  | { state: "refused"; words: string };

/** The window's client, as far as this act needs it. */
export interface IndexRestartClient {
  request(method: string, params: unknown): Promise<unknown>;
}

/** `system.index.restart` (it answers when the new generation has answered):
 * the index's new phase in words, or the refusal in fieldd's. */
export async function restartIndex(client: IndexRestartClient): Promise<IndexRestartState> {
  try {
    const answer = (await client.request("system.index.restart", {})) as {
      rosettad?: { phase?: unknown; detail?: unknown };
    };
    const phase = typeof answer.rosettad?.phase === "string" ? answer.rosettad.phase : "unknown";
    const detail = typeof answer.rosettad?.detail === "string" ? answer.rosettad.detail : null;
    if (phase === "ready") return { state: "restarted", words: "The index is running again." };
    if (phase === "failed")
      return {
        state: "refused",
        words: `The index stopped again — ${detail ?? "it did not start"}`,
      };
    // starting, restarting, rebuilding: coming — the room reconnects by itself
    return { state: "restarted", words: `The index is ${phase}.` };
  } catch (cause) {
    return { state: "refused", words: `Could not restart the index — ${refusalWords(cause)}` };
  }
}

/** The band under the room while the index has FAILED: one act, and what it
 * did, in words. The room hears the index come back on its own. */
export function HistoryIndexRestart({ client }: { client: IndexRestartClient }): ReactElement {
  const [state, setState] = useState<IndexRestartState>({ state: "idle" });
  const restart = useCallback(async () => {
    setState({ state: "restarting" });
    setState(await restartIndex(client));
  }, [client]);
  const restarting = state.state === "restarting";
  return (
    <div className="vf-history-index-act" data-state={state.state}>
      <UiButton variant="primary" disabled={restarting} onClick={() => void restart()}>
        {restarting ? "Restarting the index…" : "Restart the index"}
      </UiButton>
      {"words" in state ? (
        <p className="vf-history-index-act-words" role="status">
          {state.words}
        </p>
      ) : null}
    </div>
  );
}
