import type { NeedsItem, SparkId } from "@vibefield/contracts";
import {
  type ReactElement,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
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
import { useProfileSets } from "./profile-sets";
import { SparkPane } from "./SparkPane";
import type { SparkEntry } from "./spark-status";
import {
  type SparkOpener,
  showThread,
  sparkEntryNow,
  sparksReadingNow,
  threadOnScreen,
  useBoardRows,
  useChooseRequest,
  useNeedsAnswerer,
  useSparkOpener,
  useSparksReading,
  useThreadMarks,
  whenSparkEntry,
} from "./sparks-feed";
import { threadItemsOf, threadQuiet } from "./thread-items";
import { sparkPaneOf, whenSparkPane } from "./thread-pane-door";
import { sendNote, sendToThread, type ThreadSendOutcome } from "./thread-send";

// CHAT, THE CONTROLLER (SP-1b, SP-1d; DESIGN.md §8 "Chat's list", "Chat's thread", "Chat's composer"). It draws the
// window's one feed (`sparks-feed.ts`, which the frame's host starts for the window's life, so Chat's cell hears a
// spark that needs you from any view), holds the chosen spark (the newest when Chat first shows one, kept until
// another is chosen), mounts the shown spark's own pane while it is awake (`SparkPane`) and its composer
// (`ChatComposer`), keeps each thread's draft for the window's life, and runs the thread's two acts that wake a
// spark — Wake on the line, and Send — through the feed's one wake (`SparkOpener`). It reads what stands in the shown
// thread over its pane (`threadItemsOf`: a new spark's hello and its starters while the thread is quiet), and sends a
// starter pressed as Send sends, one act at a time into a thread, a wake's or a send's. Since CP-3 the needs-you card
// stands there in the hello's place (`useNeedsCard`): its acts answered through the feed (`needs.answer`, by their
// place), an agent's ask shown in its pane by Jump to's path. It tells the feed which thread is on screen — the shown
// one while Chat is the view — so opening a thread reads it, and draws each row's mark as the feed keeps it. It reads
// the Agent Profiles once for every thread (`useProfileSets`: on its first show, and again as @ opens) and hands the
// reading to the composer's @. What it chose, whose hello has left, which threads an act holds, and what its cards
// answer, are this view's alone.

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
  /** what @'s rows read: the Agent Profiles fieldd offers, read here, and an agent's own picker, the composer's
   * (`ComposerPort`; its agents are said by the catalog's labels, so `agent.providers` is not read) */
  port: ComposerPort;
}): ReactElement {
  const reading = useSparksReading();
  // the Agent Profiles, read once for every thread's @ (on Chat's first show, and again as @ opens)
  const profiles = useProfileSets(port, active);
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

  // each thread's draft, for the window's life and written nowhere (HN-D9's rule): state, so what reads it redraws.
  // It is the one copy: the composer parks each change here, and a send's clearing is made here, to the draft as the
  // thread holds it when the send is pasted — whichever composer is drawn for the thread by then follows it.
  const [drafts, setDrafts] = useState<ReadonlyMap<SparkId, readonly DraftPart[]>>(() => new Map());
  const park = useCallback((spark: SparkId, next: SetStateAction<readonly DraftPart[]>) => {
    setDrafts((held) => {
      const now = held.get(spark) ?? NO_DRAFT;
      const parts = typeof next === "function" ? next(now) : next;
      return parts === now ? held : new Map(held).set(spark, parts);
    });
  }, []);

  // the threads whose hello has left for the window's life (DESIGN.md §8 "Chat's thread", when they show): the pane took
  // the keyboard, or a send was pasted into it. Written nowhere (HN-D9's rule), so a new window says hello again.
  const [helloLeft, setHelloLeft] = useState<ReadonlySet<SparkId>>(() => new Set());
  const leaveHello = useCallback((spark: SparkId) => {
    setHelloLeft((left) => (left.has(spark) ? left : new Set(left).add(spark)));
  }, []);

  // One act at a time into a thread, Wake's, Send's or a starter's (DESIGN.md §8 "Chat's thread", "Chat's
  // composer"): two pasted messages would sit in the agent's one input for a single Return to send as one, and a Send
  // into a thread Wake is waking would wake the spark a second time. While one runs, Wake, the starters and Send wait,
  // and a press of any does nothing: the ref is the one guard, which Wake and every send read (so a press within the
  // tick of another is turned away), and the state draws it.
  const [heldThreads, setHeldThreads] = useState<ReadonlySet<SparkId>>(() => new Set());
  const heldNow = useRef(new Set<SparkId>());
  const holdThread = useCallback((spark: SparkId, held: boolean) => {
    if (held) heldNow.current.add(spark);
    else heldNow.current.delete(spark);
    setHeldThreads(new Set(heldNow.current));
  }, []);

  // Wake, on the line: it holds the thread while it runs, and its refusal is said there, once, in fieldd's words
  const open = useSparkOpener();
  const wake = useCallback(
    async (opener: SparkOpener, entry: SparkEntry): Promise<void> => {
      const spark = entry.spark.id;
      if (heldNow.current.has(spark)) return;
      holdThread(spark, true);
      setAct({ spark, act: { state: "busy" } });
      try {
        await opener(spark);
        setAct(null);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        setAct({ spark, act: { state: "refused", reason } });
      } finally {
        holdThread(spark, false);
      }
    },
    [holdThread],
  );

  // Send, into the thread's pane (`thread-send.ts`): it wakes the spark through the same wake, the line reading
  // "Waking…" meanwhile; a refusal is the send's note, never the line's (said once). Pasted, the thread's hello leaves.
  // While another act holds the thread it does nothing and answers null, so nothing is said and nothing let go.
  const sendTo = useCallback(
    (entry: SparkEntry, opener: SparkOpener) =>
      async (text: string, stills: readonly string[]): Promise<ThreadSendOutcome | null> => {
        const spark = entry.spark.id;
        if (heldNow.current.has(spark)) return null;
        holdThread(spark, true);
        const asleep = (): boolean => {
          const now = sparkEntryNow(spark);
          return now !== null && threadLineOf(now) === "asleep";
        };
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
              // asleep, its thread draws no pane: the wait ends as the pane goes, never at the 20 s
              pane: (ms) => whenSparkPane(spark, ms, asleep),
              asleep,
              onScreen: () => threadOnScreen() === spark,
              paneNow: () => sparkPaneOf(spark),
              sparksReading: sparksReadingNow,
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

  // A starter, pressed: sent as Send sends (no stills), its outcome said in Send's own words — never while an act holds
  // its thread (the send's own guard).
  const start = useCallback(
    async (entry: SparkEntry, opener: SparkOpener, words: string): Promise<void> => {
      const outcome = await sendTo(entry, opener)(words, []);
      if (outcome !== null) sayOnLine(sendNote(outcome, entry.spark.name));
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
  // Show, on an agent's ask: its pane in Godview by Jump to's path, the floor session its board row names (none while
  // the board is not read, or can't be); one it cannot show is said in Jump to's words
  const rows = useBoardRows();
  const showAsk = useCallback(
    (item: NeedsItem) => {
      const id = item.from.session;
      if (id === undefined) return;
      const row =
        rows === null || rows === "failed"
          ? undefined
          : rows.find((each) => each.runtimeRunId === id);
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
        onPark={(next) => park(shown.spark.id, next)}
        surface={surface}
        onSurfaceChange={onSurfaceChange}
        profiles={profiles}
        port={port}
        send={sendTo(shown, open)}
        threadSending={heldThreads.has(shown.spark.id)}
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
      sending={shown !== undefined && heldThreads.has(shown.spark.id)}
      onAnswer={needs.answer}
      onShowAsk={showAsk}
      cardRef={needs.cardRef}
      {...(composer === undefined ? {} : { composer })}
    />
  );
}
