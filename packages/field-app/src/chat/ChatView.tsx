import type { SparkId } from "@vibefield/contracts";
import { type ReactElement, useCallback, useEffect, useState } from "react";
import { type ChatAct, ChatPanelView, paneSessionOf, shownOf, threadLineOf } from "./ChatPanelView";
import { SparkPane } from "./SparkPane";
import type { SparkEntry } from "./spark-status";
import {
  type SparkOpener,
  useChooseRequest,
  useSparkOpener,
  useSparksReading,
} from "./sparks-feed";

// CHAT, THE CONTROLLER (SP-1b, SP-1d; DESIGN.md §8 "Chat's list", "Chat's thread"). It draws the window's one feed
// (`sparks-feed.ts`, which the frame's host starts for the window's life, so Chat's cell hears a spark that needs you
// from any view), holds the chosen spark (the newest when Chat first shows one, kept until another is chosen), mounts
// the shown spark's own pane while it is awake (`SparkPane`), and runs the line's one act: Wake, its last session
// resumed (the feed's `SparkOpener`). What it chose is this view's alone.

/** How often the rows' times are said again while Chat shows ("now" becomes "9:41"). */
const CLOCK_MS = 30_000;

export function ChatView({
  active,
}: {
  /** Chat is the view showing: the rows' times are said again, and the thread's pane draws, while it is */
  active: boolean;
}): ReactElement {
  const reading = useSparksReading();
  const [chosen, setChosen] = useState<SparkId | null>(null);
  const [act, setAct] = useState<{ readonly spark: SparkId; readonly act: ChatAct } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // SP-1c — a spark just hatched from the sheet is the one Chat shows
  const request = useChooseRequest();
  useEffect(() => {
    if (request !== null) setChosen(request.spark);
  }, [request]);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => window.clearInterval(timer);
  }, [active]);

  // Wake, on the line: its refusal is said there, once, in fieldd's words
  const open = useSparkOpener();
  const wake = useCallback(async (opener: SparkOpener, entry: SparkEntry): Promise<void> => {
    const spark = entry.spark.id;
    setAct({ spark, act: { state: "busy" } });
    try {
      await opener(spark);
      setAct(null);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      setAct({ spark, act: { state: "refused", reason } });
    }
  }, []);

  const shown = shownOf(reading.state === "ready" ? reading.entries : [], chosen);
  // Chat opens on the newest spark and keeps it until another is chosen (DESIGN.md §8 "Chat's list", the thread it
  // shows): a spark whose activity is newer moves up the list, and never takes the thread, nor the keyboard in its pane.
  // A hatch's choice asked in the same pass stands (the updater keeps what was chosen first).
  const shownId = shown?.spark.id;
  useEffect(() => {
    if (active && chosen === null && shownId !== undefined) {
      setChosen((current) => current ?? shownId);
    }
  }, [active, chosen, shownId]);
  const pane =
    shown === undefined || threadLineOf(shown) !== null ? undefined : (
      <SparkPane
        key={shown.spark.id}
        spark={shown.spark.id}
        name={shown.spark.name}
        sessionId={paneSessionOf(shown)}
        active={active}
      />
    );
  return (
    <ChatPanelView
      reading={reading}
      chosen={chosen}
      now={now}
      act={act !== null && act.spark === shown?.spark.id ? act.act : { state: "idle" }}
      onChoose={setChosen}
      {...(open === null ? {} : { onWake: (entry: SparkEntry) => void wake(open, entry) })}
      {...(pane === undefined ? {} : { pane })}
    />
  );
}
