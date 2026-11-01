import type { NeedsItem, SparkId } from "@vibefield/contracts";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "../field/desk/bar/bar-motion";
import type { FrameSurface } from "../frame/frame-surface";
import { jumpNote, sayOnLine } from "../frame/line-door";
import { openLiveRow } from "../frame/live-open";
import { sayStatus } from "../frame/status-line";
import { stillKept } from "../host";
import { terminalPoolConfigured } from "../terminal/pool";
import { ChatComposer, type ComposerPort } from "./ChatComposer";
import { type ChatAct, ChatPanelView, paneSessionOf, shownOf, threadLineOf } from "./ChatPanelView";
import { type DraftPart, draftBlank } from "./composer-draft";
import { useNeedsCard } from "./needs-card-stand";
import { SparkPane } from "./SparkPane";
import type { SparkEntry } from "./spark-status";
import {
  type SparkOpener,
  showThread,
  sparkEntryNow,
  useBoardRows,
  useChooseRequest,
  useNeedsAnswerer,
  useSparkOpener,
  useSparksReading,
  useThreadMarks,
  whenSparkEntry,
} from "./sparks-feed";
import { threadItemsOf, threadQuiet } from "./thread-items";
import { whenSparkPane } from "./thread-pane-door";
import { sendNote, sendToThread, type ThreadSendOutcome } from "./thread-send";

// CHAT, THE CONTROLLER (SP-1b, SP-1d; DESIGN.md §8 "Chat's list", "Chat's thread", "Chat's composer"). It draws the
// window's one feed (`sparks-feed.ts`, which the frame's host starts for the window's life, so Chat's cell hears a
// spark that needs you from any view), holds the chosen spark (the newest when Chat first shows one, kept until
// another is chosen), mounts the shown spark's own pane while it is awake (`SparkPane`) and its composer
// (`ChatComposer`), keeps each thread's draft for the window's life, and runs the thread's two acts that wake a
// spark — Wake on the line, and Send — through the feed's one wake (`SparkOpener`). It reads what stands in the shown
// thread over its pane (`threadItemsOf`: a new spark's hello and its starters while the thread is quiet), and sends a
// starter pressed as Send sends, one send at a time into a thread. Since CP-3 the needs-you card stands there in the
// hello's place (`useNeedsCard`): its acts answered through the feed (`needs.answer`, by their place), an agent's ask
// shown in its pane by Jump to's path. It tells the feed which thread is on screen — the shown one while Chat is the
// view — so opening a thread reads it, and draws each row's mark as the feed keeps it. What it chose, whose hello has
// left, which threads a send runs into, and what its cards answer, are this view's alone.

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

  // the threads whose hello has left for the window's life (DESIGN.md §8 "Chat's thread", when they show): the pane took
  // the keyboard, or a send was pasted into it. Written nowhere (HN-D9's rule), so a new window says hello again.
  const [helloLeft, setHelloLeft] = useState<ReadonlySet<SparkId>>(() => new Set());
  const leaveHello = useCallback((spark: SparkId) => {
    setHelloLeft((left) => (left.has(spark) ? left : new Set(left).add(spark)));
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

  // One send at a time into a thread, Send's or a starter's (DESIGN.md §8 "Chat's thread", "Chat's composer"): two
  // pasted messages would sit in the agent's one input for a single Return to send as one. While one runs, the
  // starters and Send wait, and a press of either does nothing (the ref holds it within one tick, the state draws it).
  const [sending, setSending] = useState<ReadonlySet<SparkId>>(() => new Set());
  const sendingNow = useRef(new Set<SparkId>());
  const holdThread = useCallback((spark: SparkId, held: boolean) => {
    if (held) sendingNow.current.add(spark);
    else sendingNow.current.delete(spark);
    setSending(new Set(sendingNow.current));
  }, []);

  // Send, into the thread's pane (`thread-send.ts`): it wakes the spark through the same wake, the line reading
  // "Waking…" meanwhile; a refusal is the send's note, never the line's (said once). Pasted, the thread's hello leaves.
  const sendTo = useCallback(
    (entry: SparkEntry, opener: SparkOpener) =>
      async (text: string, stills: readonly string[]): Promise<ThreadSendOutcome> => {
        const spark = entry.spark.id;
        holdThread(spark, true);
        let outcome: ThreadSendOutcome;
        try {
          outcome = await sendToThread(
            {
              terminals: terminalPoolConfigured(),
              // its own run's menu in its pane, never a needs-you card, which is answered on the card (CP-3)
              blocked: () => (sparkEntryNow(spark) ?? entry).blocked,
              needsWake: threadLineOf(entry) !== null,
              wake: async () => {
                setAct({ spark, act: { state: "busy" } });
                try {
                  await opener(spark);
                } finally {
                  setAct((current) => (current?.spark === spark ? null : current));
                }
              },
              // from its own run's row, never its word: an item's word stands over Asleep and Hello (CP-3)
              heard: async (ms) => (await whenSparkEntry(spark, (now) => now.heard, ms)) !== null,
              pane: (ms) => whenSparkPane(spark, ms),
              stillKept,
            },
            text,
            stills,
          );
        } finally {
          holdThread(spark, false);
        }
        if (outcome.state === "pasted") leaveHello(spark);
        return outcome;
      },
    [holdThread, leaveHello],
  );

  // A starter, pressed: sent as Send sends (no stills), its outcome said in Send's own words — never while a send into
  // its thread runs.
  const start = useCallback(
    async (entry: SparkEntry, opener: SparkOpener, words: string): Promise<void> => {
      if (sendingNow.current.has(entry.spark.id)) return;
      sayOnLine(sendNote(await sendTo(entry, opener)(words, []), entry.spark.name));
    },
    [sendTo],
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
  // The thread on screen (DESIGN.md §8 "Chat's list", Needs you): the shown one while Chat is the view, and none in
  // another view, nor once Chat is gone. Opening it reads it.
  const onScreen = active ? (shownId ?? null) : null;
  useEffect(() => showThread(onScreen), [onScreen]);
  useEffect(() => () => showThread(null), []);
  const marks = useThreadMarks();

  // CP-3 — the needs-you card the shown thread stands, answered through the feed; a card that leaves holding the
  // keyboard, with none to take its place, hands it to the draft
  const answerer = useNeedsAnswerer();
  const reduced = useReducedMotion();
  const [draftKeyboard, setDraftKeyboard] = useState(0);
  const needs = useNeedsCard(shown, onScreen !== null, reduced, {
    answer: answerer,
    say: sayStatus,
    focusDraft: () => setDraftKeyboard((count) => count + 1),
  });
  // Show, on an agent's ask: its pane in Godview by Jump to's path; one it cannot show is said in Jump to's words
  const rows = useBoardRows();
  const showAsk = useCallback(
    (item: NeedsItem) => {
      const id = item.from.session;
      if (id === undefined) return;
      const row = rows?.find((each) => each.runtimeRunId === id);
      void openLiveRow(
        { id, floorSessionId: row?.terminal?.runtimeSessionId ?? null },
        "assistant",
      ).then((outcome) => {
        if (outcome.state === "refused") sayOnLine(jumpNote(outcome));
      });
    },
    [rows],
  );

  const pane =
    shown === undefined || threadLineOf(shown) !== null ? undefined : (
      <SparkPane
        key={shown.spark.id}
        spark={shown.spark.id}
        name={shown.spark.name}
        sessionId={paneSessionOf(shown)}
        active={active}
        onKeyboard={() => leaveHello(shown.spark.id)}
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
        threadSending={sending.has(shown.spark.id)}
        takeKeyboard={draftKeyboard}
      />
    );
  const items =
    shown === undefined
      ? []
      : threadItemsOf(
          shown,
          threadQuiet(
            shown,
            draftBlank(drafts.get(shown.spark.id) ?? NO_DRAFT),
            helloLeft.has(shown.spark.id),
          ),
          needs.card,
        );
  return (
    <ChatPanelView
      reading={reading}
      chosen={chosen}
      now={now}
      marks={marks}
      act={act !== null && act.spark === shown?.spark.id ? act.act : { state: "idle" }}
      onChoose={setChosen}
      {...(open === null ? {} : { onWake: (entry: SparkEntry) => void wake(open, entry) })}
      {...(pane === undefined ? {} : { pane })}
      items={items}
      onStarter={
        shown === undefined || open === null
          ? undefined
          : (words: string) => void start(shown, open, words)
      }
      sending={shown !== undefined && sending.has(shown.spark.id)}
      onAnswer={needs.answer}
      onShowAsk={showAsk}
      cardRef={needs.cardRef}
      {...(composer === undefined ? {} : { composer })}
    />
  );
}
