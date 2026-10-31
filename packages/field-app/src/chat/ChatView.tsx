import type { SparkId } from "@vibefield/contracts";
import { type ReactElement, useCallback, useEffect, useState } from "react";
import { openLiveRow } from "../frame/live-open";
import { type ChatAct, ChatPanelView } from "./ChatPanelView";
import type { SparkEntry } from "./spark-status";
import { refreshSparks, sparksDoor, useSparksReading } from "./sparks-feed";

// CHAT, THE CONTROLLER (SP-1b; DESIGN.md §8 "Chat's list"). It draws the window's one feed (`sparks-feed.ts`, which
// the frame's host starts for the window's life, so Chat's cell hears a spark that needs you from any view), holds
// the chosen spark, and runs its one act: Show, its own session's pane in Godview by Jump to's path (`openLiveRow`),
// or Wake, its last session resumed (`compose.sparks.open`). What it chose is this view's alone.

/** How often the rows' times are said again while Chat shows ("now" becomes "9:41"). */
const CLOCK_MS = 30_000;

export function ChatView({
  active,
}: {
  /** Chat is the view showing: the rows' times are said again while it is */
  active: boolean;
}): ReactElement {
  const reading = useSparksReading();
  const [chosen, setChosen] = useState<SparkId | null>(null);
  const [act, setAct] = useState<{ readonly spark: SparkId; readonly act: ChatAct } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => window.clearInterval(timer);
  }, [active]);

  const show = useCallback(async (entry: SparkEntry): Promise<void> => {
    const spark = entry.spark.id;
    const id = entry.run?.runtimeRunId ?? entry.spark.session?.runtimeRunId;
    if (id === undefined) return;
    setAct({ spark, act: { state: "busy" } });
    const floorSessionId =
      entry.run?.terminal?.runtimeSessionId ?? entry.spark.session?.terminalSessionId ?? null;
    const outcome = await openLiveRow({ id, floorSessionId }, "assistant");
    setAct(outcome.state === "shown" ? null : { spark, act: outcome });
  }, []);

  const wake = useCallback(async (entry: SparkEntry): Promise<void> => {
    const door = sparksDoor();
    if (door === null) return;
    const spark = entry.spark.id;
    setAct({ spark, act: { state: "busy" } });
    try {
      await door.open(spark);
      setAct(null);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setAct({ spark, act: { state: "refused", reason } });
    }
    // the record says what the door did, whether it woke or refused
    refreshSparks();
  }, []);

  const shown =
    chosen ?? (reading.state === "ready" ? (reading.entries[0]?.spark.id ?? null) : null);
  return (
    <ChatPanelView
      reading={reading}
      chosen={chosen}
      now={now}
      act={act !== null && act.spark === shown ? act.act : { state: "idle" }}
      onChoose={setChosen}
      onShow={(entry) => void show(entry)}
      onWake={(entry) => void wake(entry)}
    />
  );
}
