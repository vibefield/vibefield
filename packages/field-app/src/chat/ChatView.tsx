import type { NeedsItem, SparkId } from "@vibefield/contracts";
import {
  type ReactElement,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useReducedMotion } from "../field/desk/bar/bar-motion";
import type { FrameSurface } from "../frame/frame-surface";
import { jumpNote, sayOnLine } from "../frame/line-door";
import { sayStatus } from "../frame/status-line";
import { stillKept } from "../host";
import { NO_HANDLES, sessionHandlesOf } from "./at-rows";
import { ChatComposer, type ComposerPort } from "./ChatComposer";
import { type ChatAct, ChatPanelView, paneSessionOf, shownOf, threadLineOf } from "./ChatPanelView";
import { type DraftMessage, type DraftPart, draftBlank } from "./composer-draft";
import { NO_PAUSE, type PauseAct, pauseTurn, type SparkPauser, turnOf } from "./head-act";
import { useNeedsCard } from "./needs-card-stand";
import { settlePendingSay, standPendingSay } from "./pending-says";
import { useProfileSets } from "./profile-sets";
import { revealRun } from "./reveal-run";
import { SparkPane } from "./SparkPane";
import type { SparkEntry } from "./spark-status";
import {
  boardRowNow,
  type SparkOpener,
  type SparkSayer,
  showThread,
  sparkEntryNow,
  useBoardRows,
  useChooseRequest,
  useNeedsAnswerer,
  useSparkOpener,
  useSparkPauser,
  useSparkSayer,
  useSparksReading,
  useThreadMarks,
} from "./sparks-feed";
import { threadItemsOf, threadQuiet } from "./thread-items";
import { sayRequestId, sendNote, sendToThread, type ThreadSendOutcome } from "./thread-send";

// CHAT, THE CONTROLLER (SP-1b, SP-1d; DESIGN.md §8 "Chat's list", "Chat's thread", "Chat's composer"). It draws the
// window's one feed (`sparks-feed.ts`, which the frame's host starts for the window's life, so Chat's cell hears a
// spark that needs you from any view), holds the chosen spark (the newest when Chat first shows one, kept until
// another is chosen), mounts the shown spark's own pane while it is awake (`SparkPane`) and its composer
// (`ChatComposer`), keeps each thread's draft for the window's life, and runs the thread's two acts that wake a
// spark — Wake (in the head since TH-2), and Send — through the feed's one wake (`SparkOpener`). Since TH-1 Send queues
// your words through the feed's say (`compose.sparks.say`), and its bubble stands at once (`pending-says.ts`). Since
// TH-2 it runs the head's other acts: Jump to, the spark's own session in Godview by Jump to's path, its row read at
// the press (`reveal-run.ts`, which the card's Show goes through too), and Pause current turn, `agent.pause` once
// through the feed (`head-act.ts`), each Pause kept for the turn it was pressed in. It reads what
// stands in the shown thread over its pane (`threadItemsOf`: a new spark's hello and its starters while the thread is
// quiet), and sends a starter pressed as Send sends, one act at a time into a thread, a wake's or a send's. Since CP-3
// the needs-you card
// stands there in the hello's place (`useNeedsCard`): its acts answered through the feed (`needs.answer`, by their
// place), an agent's ask shown in its pane by Jump to's path. It tells the feed which thread is on screen — the shown
// one while Chat is the view — so opening a thread reads it, and draws each row's mark as the feed keeps it. It reads
// the Agent Profiles once for every thread (`useProfileSets`: on its first show, and again as @ opens) and hands the
// reading to the composer's @; with the board's rows it numbers the shown thread's sessions as @ does
// (`sessionHandlesOf`), and its card names them so. What it chose, whose hello has left, which threads an act holds,
// and what its cards answer, are this view's alone.

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
  // thread holds it when the send is queued — whichever composer is drawn for the thread by then follows it.
  const [drafts, setDrafts] = useState<ReadonlyMap<SparkId, readonly DraftPart[]>>(() => new Map());
  const park = useCallback((spark: SparkId, next: SetStateAction<readonly DraftPart[]>) => {
    setDrafts((held) => {
      const now = held.get(spark) ?? NO_DRAFT;
      const parts = typeof next === "function" ? next(now) : next;
      return parts === now ? held : new Map(held).set(spark, parts);
    });
  }, []);

  // the threads whose hello has left for the window's life (DESIGN.md §8 "Chat's thread", when they show): the pane took
  // the keyboard, or a send was queued to it. Written nowhere (HN-D9's rule), so a new window says hello again.
  const [helloLeft, setHelloLeft] = useState<ReadonlySet<SparkId>>(() => new Set());
  const leaveHello = useCallback((spark: SparkId) => {
    setHelloLeft((left) => (left.has(spark) ? left : new Set(left).add(spark)));
  }, []);

  // One act at a time into a thread, Wake's, Send's or a starter's (DESIGN.md §8 "Chat's thread", "Chat's
  // composer"): a Send into a thread Wake is waking would wake the spark a second time. While one runs, Wake, the
  // starters and Send wait,
  // and a press of any does nothing: the ref is the one guard, which Wake and every send read (so a press within the
  // tick of another is turned away), and the state draws it.
  const [heldThreads, setHeldThreads] = useState<ReadonlySet<SparkId>>(() => new Set());
  const heldNow = useRef(new Set<SparkId>());
  const holdThread = useCallback((spark: SparkId, held: boolean) => {
    if (held) heldNow.current.add(spark);
    else heldNow.current.delete(spark);
    setHeldThreads(new Set(heldNow.current));
  }, []);

  // Wake, in the head (TH-2; on the line before): it holds the thread while it runs, and its refusal is said once, in
  // fieldd's words, on the line under the head while that line stands
  const open = useSparkOpener();
  const sayer = useSparkSayer();
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

  // Send (`thread-send.ts`, TH-1): queued to the spark as yours through the feed's say, after the same wake for a
  // spark asleep or not started, the line reading "Waking…" meanwhile. Its bubble stands once the window's own checks
  // pass ("Waking Vela…" while it wakes), takes the say's receipt, and leaves if the send is not taken; a refusal is
  // the send's note, never the line's (said once). Queued, the thread's hello leaves. While another act holds the
  // thread it does nothing and answers null, so nothing is said and nothing let go.
  const sendTo = useCallback(
    (entry: SparkEntry, opener: SparkOpener, sayer: SparkSayer) =>
      async (
        message: DraftMessage,
        stills: readonly string[],
      ): Promise<ThreadSendOutcome | null> => {
        const spark = entry.spark.id;
        if (heldNow.current.has(spark)) return null;
        holdThread(spark, true);
        const needsWake = threadLineOf(entry) !== null;
        const requestId = sayRequestId();
        let outcome: ThreadSendOutcome;
        try {
          outcome = await sendToThread(
            {
              needsWake,
              wake: async () => {
                setAct({ spark, act: { state: "busy" } });
                try {
                  await opener(spark);
                } finally {
                  setAct((current) => (current?.spark === spark ? null : current));
                }
              },
              say: ({ chips, ...ask }) =>
                sayer({ spark, ...ask, ...(chips.length > 0 ? { chips: [...chips] } : {}) }),
              stillKept,
              sending: () =>
                standPendingSay(spark, {
                  requestId,
                  text: message.text,
                  chips: message.chips,
                  at: new Date().toISOString(),
                  ...(needsWake ? { state: "waking" } : {}),
                }),
            },
            message,
            stills,
            requestId,
          );
        } finally {
          holdThread(spark, false);
        }
        settlePendingSay(
          spark,
          requestId,
          outcome.state === "queued" ? outcome.receipt.state : null,
        );
        if (outcome.state === "queued") leaveHello(spark);
        return outcome;
      },
    [holdThread, leaveHello],
  );

  // Jump to, in the head (TH-2): the spark's own session in Godview by Jump to's path, its row read at the press, never
  // from what was drawn; the note says what came of it ("Jumped to its pane", or Jump to's refusal). It holds no
  // thread, so Send goes on, and while it runs its pill waits: the ref is the guard, the state draws it.
  const [jumping, setJumping] = useState<ReadonlySet<SparkId>>(() => new Set());
  const jumpingNow = useRef(new Set<SparkId>());
  const jump = useCallback(async (entry: SparkEntry): Promise<void> => {
    const spark = entry.spark.id;
    if (jumpingNow.current.has(spark)) return;
    jumpingNow.current.add(spark);
    setJumping(new Set(jumpingNow.current));
    try {
      sayOnLine(jumpNote(await revealRun(sparkEntryNow(spark)?.run ?? null)));
    } finally {
      jumpingNow.current.delete(spark);
      setJumping(new Set(jumpingNow.current));
    }
  }, []);

  // Pause current turn, in the head (TH-2; TH-Q3 (b)): `agent.pause` once for the spark's own run, for the turn at
  // work at the press. Kept for that turn alone: pausing from the press until fieldd answers, then while its accepted
  // send stands (the board's `stop` takes over as it lands), or its refusal said in the status's place. A turn already
  // pressed is never sent again (the ref is the guard; fieldd coalesces a second press too).
  const pauser = useSparkPauser();
  const [pauses, setPauses] = useState<ReadonlyMap<SparkId, PauseAct>>(() => new Map());
  const pausingNow = useRef(new Set<SparkId>());
  const pause = useCallback(async (door: SparkPauser, entry: SparkEntry): Promise<void> => {
    const spark = entry.spark.id;
    const now = sparkEntryNow(spark) ?? entry;
    const turn = turnOf(now);
    if (turn === null || now.run === null || pausingNow.current.has(spark)) return;
    pausingNow.current.add(spark);
    const keep = (pressed: PauseAct) => setPauses((held) => new Map(held).set(spark, pressed));
    keep({ state: "busy", turn });
    try {
      const outcome = await pauseTurn(door, now.run.runtimeRunId);
      keep(
        outcome.state === "sent"
          ? { state: "sent", turn }
          : { state: "refused", turn, reason: outcome.reason },
      );
    } finally {
      pausingNow.current.delete(spark);
    }
  }, []);

  // A starter, pressed: sent as Send sends (no chips, no stills), its outcome said in Send's own words — never while an
  // act holds its thread (the send's own guard).
  const start = useCallback(
    async (entry: SparkEntry, opener: SparkOpener, sayer: SparkSayer, words: string) => {
      const outcome = await sendTo(entry, opener, sayer)({ text: words, chips: [] }, []);
      const note = outcome === null ? null : sendNote(outcome, entry.spark.name);
      if (note !== null) sayOnLine(note);
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
  // keyboard, with none to take its place, hands it to the draft. It names a session as the thread's @ does (track
  // CO, the handle): @'s handles for the shown spark, on the board's rows and the one reading of the profiles.
  const answerer = useNeedsAnswerer();
  const reduced = useReducedMotion();
  const [draftKeyboard, setDraftKeyboard] = useState(0);
  const rows = useBoardRows();
  const shownSpark = shown?.spark;
  const handles = useMemo(
    () =>
      shownSpark === undefined ? NO_HANDLES : sessionHandlesOf(shownSpark, rows, profiles.sets),
    [shownSpark, rows, profiles.sets],
  );
  const needs = useNeedsCard(
    shown,
    onScreen !== null,
    reduced,
    {
      answer: answerer,
      say: sayStatus,
      focusDraft: () => setDraftKeyboard((count) => count + 1),
    },
    handles,
  );
  // Show, on an agent's ask: its pane in Godview by the head's one reveal (TH-2, `reveal-run.ts`), its board row read at
  // the press. One it cannot show — not running, its terminal not on this desktop's floor, or a deck that could not —
  // is said in Jump to's words; shown, it says nothing (CP-3)
  const showAsk = useCallback((item: NeedsItem) => {
    const id = item.from.session;
    if (id === undefined) return;
    void revealRun(boardRowNow(id)).then((outcome) => {
      if (outcome.state !== "jumped") sayOnLine(jumpNote(outcome));
    });
  }, []);

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
  // the composer stands under every thread, awake or not: Send wakes the spark (no feed, no wake and no say: none is
  // drawn)
  const composer =
    shown === undefined || open === null || sayer === null ? undefined : (
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
        send={sendTo(shown, open, sayer)}
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
      onJump={(entry) => void jump(entry)}
      jumping={shown !== undefined && jumping.has(shown.spark.id)}
      {...(pauser === null ? {} : { onPause: (entry: SparkEntry) => void pause(pauser, entry) })}
      pause={shown === undefined ? NO_PAUSE : (pauses.get(shown.spark.id) ?? NO_PAUSE)}
      {...(pane === undefined ? {} : { pane })}
      items={items}
      onStarter={
        shown === undefined || open === null || sayer === null
          ? undefined
          : (words: string) => void start(shown, open, sayer, words)
      }
      sending={shown !== undefined && heldThreads.has(shown.spark.id)}
      onAnswer={needs.answer}
      onShowAsk={showAsk}
      cardRef={needs.cardRef}
      {...(composer === undefined ? {} : { composer })}
    />
  );
}
