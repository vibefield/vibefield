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
import type { KeyedCallClient } from "../forwarded-call";
import type { FrameSurface } from "../frame/frame-surface";
import { jumpNote, sayOnLine } from "../frame/line-door";
import { sayStatus } from "../frame/status-line";
import { requestView } from "../frame/view-state";
import type { ViewKeys } from "../frame/views";
import { stillKept } from "../host";
import { NO_HANDLES, sessionHandlesOf } from "./at-rows";
import { ChatComposer, type ComposerPort } from "./ChatComposer";
import { ChatEmptyView } from "./ChatEmptyView";
import { type ChatAct, ChatPanelView, shownOf } from "./ChatPanelView";
import type { DraftMessage, DraftPart } from "./composer-draft";
import { crewCardsOf, crewsOfFlow } from "./crew-card";
import { CREWS_READING, type CrewsDoor, type CrewsReading, useSparkCrews } from "./crews-port";
import { NO_PAUSE, type PauseAct, pauseTurn, type SparkPauser, turnOf } from "./head-act";
import { useNeedsCard } from "./needs-card-stand";
import { type NightAgentsDoor, nightProviders, useNightAgents } from "./night-agents";
import {
  letGoPendingSays,
  settlePendingSay,
  standPendingSay,
  usePendingSays,
} from "./pending-says";
import { useProfileSets } from "./profile-sets";
import { revealRun } from "./reveal-run";
import type { SparkEntry } from "./spark-status";
import {
  boardRowNow,
  type SparkOpener,
  type SparkSayer,
  showThread,
  sparkEntryNow,
  takeFirstJob,
  useBoardRows,
  useChooseRequest,
  useNeedsAnswerer,
  useSparkOpener,
  useSparkPauser,
  useSparkSayer,
  useSparksReading,
  useThreadMarks,
} from "./sparks-feed";
import { startersOf } from "./starters";
import { ThreadFlowView } from "./ThreadFlowView";
import { footItemsOf, type Starter, sparkIsNew } from "./thread-items";
import { sayRequestId, sendNote, sendToThread, type ThreadSendOutcome } from "./thread-send";
import { saidRequestsOf, transcriptItemsOf } from "./transcript-items";
import {
  READING,
  type TranscriptDoor,
  type TranscriptReading,
  useSparkTranscript,
} from "./transcript-port";

// CHAT, THE CONTROLLER (SP-1b, SP-1d, TH-1; DESIGN.md §8 "Chat's list", "Chat's thread", "Chat's composer"). It draws
// the window's one feed (`sparks-feed.ts`, which the frame's host starts for the window's life, so Chat's cell hears a
// spark that needs you from any view), holds the chosen spark (the newest when Chat first shows one, kept until
// another is chosen), draws the shown spark's conversation (`ThreadFlowView`) from its transcript, read through the
// window's own ticket (`useSparkTranscript`; the earlier conversations once asked for) with this window's sends the
// record does not show yet (`usePendingSays`, let go as the record shows them), mounts its composer (`ChatComposer`),
// keeps each thread's draft for the window's life, and runs the thread's two acts that wake a spark — Wake (in the
// head since TH-2), and Send — through the feed's one wake (`SparkOpener`). Send queues your words through the feed's
// say (`compose.sparks.say`), and its bubble stands at once (`pending-says.ts`). Since TH-2 it runs the head's other
// acts: Jump to, the spark's own session in Godview by Jump to's path, its row read at the press (`reveal-run.ts`,
// which the card's Show goes through too), and Pause current turn, `agent.pause` once through the feed
// (`head-act.ts`), each Pause kept for the turn it was pressed in. A starter pressed in the flow's hello is sent as
// Send sends, one act at a time into a thread, a wake's or a send's. Since CP-3 the needs-you card stands in the
// thread's foot (`useNeedsCard`): its acts answered through the feed (`needs.answer`, by their place), an agent's ask
// shown in its pane by Jump to's path. It tells the feed which thread is on screen — the shown one while Chat is the
// view — so opening a thread reads it, and draws each row's mark as the feed keeps it. It reads the Agent Profiles once
// for every thread (`useProfileSets`: on its first show, and again as @ opens) and hands the reading to the composer's
// @; with the board's rows it numbers the shown thread's sessions as @ does (`sessionHandlesOf`), and its card names
// them so. What it chose, which threads an act holds, and what its cards answer, are this view's alone.
// Since track ES, with no spark the panel is the night (`ChatEmptyView`): it reads which agents here can be a spark
// while the night stands (`useNightAgents`), and its New spark and first jobs open the New spark sheet, the line's
// create; Open Agents settings is the window's (`onOpenAgents`). ES-2: a first job is handed to the frame as the sheet
// opens (`onFirstJob`, the frame's hold), and a hatched spark's job, handed back with its choice, is sent here once as
// Send sends, as soon as its row is read.
// *Amended 2026-11-05 (TH-1, the pane leaves Chat):* it mounted the shown spark's own pane while it was awake
// (`SparkPane`), stood the hello over it while the thread was quiet (`threadItemsOf`), and kept which threads' hello
// had left. They are in git.

/** How often the rows' times are said again while Chat shows ("now" becomes "9:41"). */
const CLOCK_MS = 30_000;

const NO_DRAFT: readonly DraftPart[] = Object.freeze([]);

export function ChatView({
  active,
  surface,
  onSurfaceChange,
  port,
  transcripts,
  crews,
  runs,
  agents,
  keys = "mac",
  onOpenAgents,
  onFirstJob,
}: {
  /** Chat is the view showing: the rows' times are said again while it is, and the thread on screen is read */
  active: boolean;
  /** the frame's open surface, from its one owner (@'s list is `at`) */
  surface: FrameSurface | null;
  onSurfaceChange: (next: FrameSurface | null) => void;
  /** what @'s rows read: the Agent Profiles fieldd offers, read here, and an agent's own picker, the composer's
   * (`ComposerPort`; its agents are said by the catalog's labels, so `agent.providers` is not read) */
  port: ComposerPort;
  /** the window's door to its sparks' transcripts (`transcriptDoorOver`): fieldd's ticket, the worker's socket */
  transcripts: TranscriptDoor;
  /** SP-1e2 — the window's door to the shown spark's crews (`crewsDoorOver`); absent: no crew card is drawn */
  crews?: CrewsDoor | undefined;
  /** item 187 — the window's door to fieldd's runs (`agent.list`, whole for this desktop's windows): where a run's
   * terminal is, read once at the press by Jump to, the card's Show and a crew member's reveal (`reveal-run.ts`) */
  runs: KeyedCallClient;
  /** track ES — the night's door (`agent.providers`): which agents here can be a spark, read while Chat is the view
   * and holds no spark; absent, the night is live and its agents unread */
  agents?: NightAgentsDoor | undefined;
  /** the window's keys: New spark's key as the night prints it (⌘N on a Mac, Ctrl+N elsewhere) */
  keys?: ViewKeys | undefined;
  /** track ES — Open Agents settings, pressed on the night while no agent here can be a spark: Settings → Agents */
  onOpenAgents?: (() => void) | undefined;
  /** ES-2 — the job the night hands the frame as it opens the New spark sheet (a first job), or none (New spark) */
  onFirstJob?: ((job: Starter | null) => void) | undefined;
}): ReactElement {
  const reading = useSparksReading();
  // track ES — the night before the first spark (DESIGN.md §8 "Chat's list", Empty: the night): which agents here can
  // be a spark, read only while it stands
  const night = reading.state === "ready" && reading.entries.length === 0;
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
  // spark asleep or not started. Its bubble stands once the window's own checks pass ("Waking Vela…" while it wakes),
  // takes the say's receipt, and leaves if the send is not taken; a refusal is the send's note, said once. While
  // another act holds the thread it does nothing and answers null, so nothing is said and nothing let go.
  const sendTo = useCallback(
    (entry: SparkEntry, opener: SparkOpener, sayer: SparkSayer) =>
      async (
        message: DraftMessage,
        stills: readonly string[],
      ): Promise<ThreadSendOutcome | null> => {
        const spark = entry.spark.id;
        if (heldNow.current.has(spark)) return null;
        holdThread(spark, true);
        // asleep or not started: its session does not run, so the send wakes it first
        const needsWake = !entry.awake;
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
        return outcome;
      },
    [holdThread],
  );

  // Jump to, in the head (TH-2): the spark's own session in Godview by Jump to's path, its row read at the press, never
  // from what was drawn; the note says what came of it ("Jumped to its pane", or Jump to's refusal). It holds no
  // thread, so Send goes on, and while it runs its pill waits: the ref is the guard, the state draws it.
  const [jumping, setJumping] = useState<ReadonlySet<SparkId>>(() => new Set());
  const jumpingNow = useRef(new Set<SparkId>());
  const jump = useCallback(
    async (entry: SparkEntry): Promise<void> => {
      const spark = entry.spark.id;
      if (jumpingNow.current.has(spark)) return;
      jumpingNow.current.add(spark);
      setJumping(new Set(jumpingNow.current));
      try {
        sayOnLine(jumpNote(await revealRun(sparkEntryNow(spark)?.run ?? null, runs)));
      } finally {
        jumpingNow.current.delete(spark);
        setJumping(new Set(jumpingNow.current));
      }
    },
    [runs],
  );

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

  // ES-2 — a hatch's first job (DESIGN.md §8 "The New spark sheet", Its first job): the sheet hands it with its choice,
  // only after the hatch; it is sent here as Send sends, once (`takeFirstJob`), as soon as the spark's row is read
  useEffect(() => {
    if (request === null || reading.state !== "ready" || open === null || sayer === null) return;
    for (const entry of reading.entries) {
      const job = takeFirstJob(entry.spark.id);
      if (job !== null) void start(entry, open, sayer, job);
    }
  }, [open, reading, request, sayer, start]);

  const shown = shownOf(reading.state === "ready" ? reading.entries : [], chosen);
  // Chat opens on the newest spark and keeps it until another is chosen (DESIGN.md §8 "Chat's list", the thread it
  // shows): a spark whose activity is newer moves up the list, and never takes the thread.
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
  // track ES — this Mac's agents, read while the night stands or a new spark's hello does (DESIGN.md §8 "Chat's list",
  // Empty: the night; §9 the hello): which can be a spark (the night's Off), and, with the board's runs, the starters'
  // words (ES-4, `starters.ts`), one reading for both
  const hello = shown !== undefined && sparkIsNew(shown);
  const nightAgents = useNightAgents(agents, active && (night || hello));
  const starters = useMemo(
    () => startersOf({ agents: nightProviders(nightAgents), rows }),
    [nightAgents, rows],
  );
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
  const showAsk = useCallback(
    (item: NeedsItem) => {
      const id = item.from.session;
      if (id === undefined) return;
      void revealRun(boardRowNow(id), runs).then((outcome) => {
        if (outcome.state !== "jumped") sayOnLine(jumpNote(outcome));
      });
    },
    [runs],
  );

  // TH-1 — the shown spark's conversation: its transcript, read through the window's own ticket while Chat is the
  // view (the latest conversation, or every one once "Earlier conversations" is pressed, for the window's life), with
  // this window's sends the record does not show yet; a send the record shows is the record's, and its bubble is let go
  const [whole, setWhole] = useState<ReadonlySet<SparkId>>(() => new Set());
  const record = useSparkTranscript(
    onScreen,
    transcripts,
    onScreen !== null && whole.has(onScreen),
  );
  // in another view nothing is read, and the thread keeps what it last drew (so it neither flashes nor loses its
  // scroll when Chat shows again)
  const lastRecord = useRef<{ readonly spark: SparkId; readonly record: TranscriptReading } | null>(
    null,
  );
  if (record !== null && onScreen !== null) lastRecord.current = { spark: onScreen, record };
  const held = lastRecord.current;
  const drawn = record ?? (held !== null && held.spark === shownId ? held.record : READING);
  const pending = usePendingSays(shownId ?? null);
  useEffect(() => {
    if (onScreen === null || record === null) return;
    const said = saidRequestsOf(record);
    if (said.size > 0) letGoPendingSays(onScreen, said);
  }, [onScreen, record]);
  const threadFlow =
    shown === undefined
      ? undefined
      : transcriptItemsOf({
          entry: shown,
          reading: drawn,
          pending,
          earlier: drawn.state === "ready" && drawn.whole,
          now,
          starters: starters.starters,
        });

  // SP-1e2 — each crew's card under its act line (DESIGN.md §8 "Chat's crew card"): the shown spark's crews, read on
  // their own door while Chat is the view (in another view the thread keeps the cards it last drew, as it keeps its
  // lines), with the board's rows and @'s handles. A member the board has held and no longer holds is Ended; one it
  // has not held yet is Starting, since its start can reach the record before its row reaches the board. The runs
  // seen are crew members only, so the set grows by the crews' members alone.
  const crewsRead = useSparkCrews(onScreen, crews ?? null);
  const lastCrews = useRef<{ readonly spark: SparkId; readonly reading: CrewsReading } | null>(
    null,
  );
  if (crewsRead !== null && onScreen !== null)
    lastCrews.current = { spark: onScreen, reading: crewsRead };
  const crewsHeld = lastCrews.current;
  const crewsDrawn =
    crewsRead ??
    (crewsHeld !== null && crewsHeld.spark === shownId ? crewsHeld.reading : CREWS_READING);
  const seenRuns = useRef(new Set<string>());
  if (Array.isArray(rows))
    for (const row of rows)
      if (row.origin?.crew !== undefined) seenRuns.current.add(row.runtimeRunId);
  const crewIds = useMemo(
    () => (threadFlow === undefined ? [] : crewsOfFlow(threadFlow)),
    [threadFlow],
  );
  const cards = useMemo(
    () =>
      crewCardsOf({
        crews: crewIds,
        reading: crewsDrawn,
        rows,
        handles,
        name: shown?.spark.name ?? "",
        asleep: shown !== undefined && !shown.awake,
        seen: seenRuns.current,
      }),
    [crewIds, crewsDrawn, rows, handles, shown],
  );
  // a row pressed: that member's pane in Godview by the one reveal (TH-2), its board row read at the press; the note
  // says what came of it, as Jump to's does. While it runs the row waits: the ref is the guard, the state draws it.
  const [revealing, setRevealing] = useState<ReadonlySet<string>>(() => new Set());
  const revealingNow = useRef(new Set<string>());
  const revealMember = useCallback(
    async (runtimeRunId: string): Promise<void> => {
      if (revealingNow.current.has(runtimeRunId)) return;
      revealingNow.current.add(runtimeRunId);
      setRevealing(new Set(revealingNow.current));
      try {
        sayOnLine(jumpNote(await revealRun(boardRowNow(runtimeRunId), runs)));
      } finally {
        revealingNow.current.delete(runtimeRunId);
        setRevealing(new Set(revealingNow.current));
      }
    },
    [runs],
  );
  const openGodview = useCallback(() => void requestView("godview"), []);

  const flow =
    shown === undefined || threadFlow === undefined ? undefined : (
      <ThreadFlowView
        key={shown.spark.id}
        flow={threadFlow}
        name={shown.spark.name}
        face={{ seed: shown.spark.face.seed, status: shown.status }}
        {...(open === null || sayer === null
          ? {}
          : { onStarter: (words: string) => void start(shown, open, sayer, words) })}
        sending={heldThreads.has(shown.spark.id)}
        startersHeld={starters.state === "reading"}
        onEarlier={() => setWhole((asked) => new Set(asked).add(shown.spark.id))}
        crews={cards}
        onCrewRow={(runtimeRunId) => void revealMember(runtimeRunId)}
        onOpenGodview={openGodview}
        revealing={revealing}
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
  const footItems = footItemsOf(needs.card);
  // the night's acts: New spark and a first job open the line's create, the New spark sheet, a job carried (ES-2)
  const empty = night ? (
    <ChatEmptyView
      agents={nightAgents}
      jobs={starters.starters}
      held={starters.state === "reading"}
      keys={keys}
      active={active}
      onNewSpark={() => {
        onFirstJob?.(null);
        onSurfaceChange("new-spark");
      }}
      onJob={(job) => {
        onFirstJob?.(job);
        onSurfaceChange("new-spark");
      }}
      onAgents={onOpenAgents}
    />
  ) : undefined;
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
      {...(flow === undefined ? {} : { flow })}
      items={footItems}
      sending={shown !== undefined && heldThreads.has(shown.spark.id)}
      onAnswer={needs.answer}
      onShowAsk={showAsk}
      cardRef={needs.cardRef}
      {...(composer === undefined ? {} : { composer })}
      {...(empty === undefined ? {} : { empty })}
    />
  );
}
