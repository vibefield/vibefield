import type { SparkId } from "@vibefield/contracts";
import { type ReactElement, useCallback, useEffect, useState } from "react";
import type { FrameSurface } from "../frame/frame-surface";
import { stillKept } from "../host";
import { terminalPoolConfigured } from "../terminal/pool";
import { ChatComposer, type ComposerPort } from "./ChatComposer";
import { type ChatAct, ChatPanelView, paneSessionOf, shownOf, threadLineOf } from "./ChatPanelView";
import type { DraftPart } from "./composer-draft";
import { SparkPane } from "./SparkPane";
import type { SparkEntry } from "./spark-status";
import {
  type SparkOpener,
  sparkEntryNow,
  useChooseRequest,
  useSparkOpener,
  useSparksReading,
  whenSparkEntry,
} from "./sparks-feed";
import { whenSparkPane } from "./thread-pane-door";
import { sendToThread, type ThreadSendOutcome } from "./thread-send";

// CHAT, THE CONTROLLER (SP-1b, SP-1d; DESIGN.md §8 "Chat's list", "Chat's thread", "Chat's composer"). It draws the
// window's one feed (`sparks-feed.ts`, which the frame's host starts for the window's life, so Chat's cell hears a
// spark that needs you from any view), holds the chosen spark (the newest when Chat first shows one, kept until
// another is chosen), mounts the shown spark's own pane while it is awake (`SparkPane`) and its composer
// (`ChatComposer`), keeps each thread's draft for the window's life, and runs the thread's two acts that wake a
// spark — Wake on the line, and Send — through the feed's one wake (`SparkOpener`). What it chose is this view's alone.

/** How often the rows' times are said again while Chat shows ("now" becomes "9:41"). */
const CLOCK_MS = 30_000;

const NO_DRAFT: readonly DraftPart[] = Object.freeze([]);

export function ChatView({
  active,
  surface,
  onSurfaceChange,
  port,
}: {
  /** Chat is the view showing: the rows' times are said again, and the thread's pane draws, while it is */
  active: boolean;
  /** the frame's open surface, from its one owner (@'s list is `at`) */
  surface: FrameSurface | null;
  onSurfaceChange: (next: FrameSurface | null) => void;
  /** what @'s rows read: the agents and profiles fieldd offers, and an agent's own picker */
  port: ComposerPort;
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

  // each thread's draft, for the window's life and written nowhere (HN-D9's rule): state, so what reads it redraws
  const [drafts, setDrafts] = useState<ReadonlyMap<SparkId, readonly DraftPart[]>>(() => new Map());
  const park = useCallback((spark: SparkId, parts: readonly DraftPart[]) => {
    setDrafts((held) => (held.get(spark) === parts ? held : new Map(held).set(spark, parts)));
  }, []);

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

  // Send, into the thread's pane (`thread-send.ts`): it wakes the spark through the same wake, the line reading
  // "Waking…" meanwhile; a refusal is the send's note, never the line's (said once)
  const sendTo = useCallback(
    (entry: SparkEntry, opener: SparkOpener) =>
      (text: string, stills: readonly string[]): Promise<ThreadSendOutcome> => {
        const spark = entry.spark.id;
        return sendToThread(
          {
            terminals: terminalPoolConfigured(),
            needsYou: () => (sparkEntryNow(spark) ?? entry).needsYou,
            needsWake: threadLineOf(entry) !== null,
            wake: async () => {
              setAct({ spark, act: { state: "busy" } });
              try {
                await opener(spark);
              } finally {
                setAct((current) => (current?.spark === spark ? null : current));
              }
            },
            heard: async (ms) =>
              (await whenSparkEntry(
                spark,
                (heard) => heard.status !== "hello" && heard.status !== "sleeping",
                ms,
              )) !== null,
            pane: (ms) => whenSparkPane(spark, ms),
            stillKept,
          },
          text,
          stills,
        );
      },
    [],
  );

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
  // the composer stands under every thread, awake or not: Send wakes the spark (no feed, no wake: none is drawn)
  const composer =
    shown === undefined || open === null ? undefined : (
      <ChatComposer
        key={shown.spark.id}
        entry={shown}
        active={active}
        parked={drafts.get(shown.spark.id) ?? NO_DRAFT}
        onPark={(parts) => park(shown.spark.id, parts)}
        surface={surface}
        onSurfaceChange={onSurfaceChange}
        port={port}
        send={sendTo(shown, open)}
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
      {...(composer === undefined ? {} : { composer })}
    />
  );
}
