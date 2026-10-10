import type { RoomSelection, RoomTarget } from "@rosetta/room";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  type JumpOutcome,
  publishHistoryLineDoor,
  type ResumeOutcome,
  whenGodviewCanPlace,
} from "../frame/line-door";
import { requestView } from "../frame/view-state";
import { viewKeysOf } from "../frame/views";
import { getHost } from "../host";
import { getRendererLogger } from "../logging";
import { terminalBootstrapHome } from "../terminal/pool";
import { historyPortsOver } from "./doors";
import { type LiveRun, readLiveRun } from "./jump";
import { useHistoryOpenAt } from "./open-at";
import { type ResumeReading, readResume, resumeNative } from "./resume";
import { HistoryRoomMount } from "./room-chunk";

// HISTORY'S CONTROLLER (AR-8c). It builds the room's ports over this window's
// fieldd client (`doors.ts`) and holds them for the view's life — the room is
// mounted on History's first open and kept mounted after (⌘3 out and back in
// keeps its scroll, its selection and its open stream) — tells the catalog when
// the view shows, says the index's state in the frame's words, and lends the
// line History's create: Resume, for the session the room has chosen. The room
// itself is its own chunk (`room-chunk.tsx`, 2026-10-04): this controller rides
// the canvas's chunk and mounts the room through it, "Opening History" saying
// so while it arrives — so the ports, the feed's words and the line's door are
// here from the first open, before the room is.
//
// While the chosen session runs on this desktop the create is Jump to (P3,
// `jump.ts`): the pane it runs in, revealed by Godview's deck — and Resume
// refuses it in Jump to's words, asking `agent.resume` nothing.
//
// Its search is the frame's — the Peek (2026-10-08, GV-D8; `frame/Peek.tsx`):
// a past row the Peek opens arrives through `open-at.ts`, and this controller
// hands it to the room's own `openAt`. The search interim it hosted from
// 2026-10-04 — the room's own sheet as a frame surface, ⌘G / ⇧⌘G on its
// stepper — retired with the Peek's landing.

/** How long Resume waits for Godview's deck — mounted on Godview's first open
 * — to be able to place the resumed agent. */
export const RESUME_DECK_WAIT_MS = 20_000;

function log() {
  return getRendererLogger().child({ component: "history" });
}

export function HistoryView({ active }: { active: boolean }): ReactElement {
  const fieldd = useFielddClient();
  const ports = useMemo(
    () =>
      historyPortsOver(fieldd, {
        platform: getHost().platform ?? null,
        home: terminalBootstrapHome(),
        workspace: {
          copyText: async (text) => {
            const diagnostics = getHost().diagnostics;
            if (diagnostics) await diagnostics.copyText(text);
            else await navigator.clipboard.writeText(text);
          },
        },
      }),
    [fieldd],
  );
  useEffect(() => () => ports.dispose(), [ports]);
  useEffect(() => ports.catalog.setActive(active), [ports, active]);
  const words = useSyncExternalStore(
    useCallback((listener: () => void) => ports.catalog.onWordsChange(listener), [ports]),
    () => ports.catalog.words(),
  );

  // The chosen session, and what Resume would do with it — read as the room
  // reports the choice, so the line can say before a press why it waits.
  const [selection, setSelection] = useState<RoomSelection | null>(null);
  const [reading, setReading] = useState<{
    readonly of: RoomSelection;
    readonly reading: ResumeReading;
  } | null>(null);
  useEffect(() => {
    if (selection === null) return;
    let cancelled = false;
    void readResume(fieldd, selection).then((answer) => {
      if (!cancelled) setReading({ of: selection, reading: answer });
    });
    return () => {
      cancelled = true;
    };
  }, [fieldd, selection]);
  const current = reading !== null && reading.of === selection ? reading.reading : null;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const readingRef = useRef(current);
  readingRef.current = current;

  // P3 — whether the chosen session runs here: one plain `agent.list`, asked
  // on a new choice and when History shows again (a press asks once more). The
  // LAST answer stands until the next arrives, so the create never flickers
  // through Resume on its way to Jump to; it only ever chooses the act — what
  // a press shows is the press's own answer.
  const [live, setLive] = useState(false);
  const noteLiveness = useCallback((of: RoomSelection, run: LiveRun | null) => {
    if (selectionRef.current?.sessionId === of.sessionId) setLive(run !== null);
  }, []);
  useEffect(() => {
    if (selection === null) {
      setLive(false);
      return;
    }
    if (!active) return;
    let cancelled = false;
    void readLiveRun(fieldd, selection.nativeSessionId).then((run) => {
      if (!cancelled) setLive(run !== null);
    });
    return () => {
      cancelled = true;
    };
  }, [fieldd, selection, active]);

  const resume = useCallback(async (): Promise<ResumeOutcome> => {
    const chosen = selectionRef.current;
    if (chosen === null) return { state: "refused", reason: "choose a session first" };
    // Never a second run on a running conversation: asked at the press, since
    // the line's reading may be older than it.
    const running = await readLiveRun(fieldd, chosen.nativeSessionId);
    if (running !== null) {
      noteLiveness(chosen, running);
      return { state: "running" };
    }
    const read = readingRef.current ?? (await readResume(fieldd, chosen));
    if (read.state === "waits") return { state: "refused", reason: read.why };
    const answer = await resumeNative(fieldd, read.facts);
    if (answer.state === "running") {
      // fieldd's one-run law saw a run the fold had not shown us yet
      noteLiveness(chosen, await readLiveRun(fieldd, chosen.nativeSessionId));
      return answer;
    }
    if (answer.state === "refused") return answer;
    // Seen where it runs: the frame moves to Godview, whose deck — mounted on
    // its first open — places the agent in the pane the swarm's open uses.
    void requestView("godview");
    const deck = await whenGodviewCanPlace(RESUME_DECK_WAIT_MS);
    if (deck === null) {
      log().info("renderer.history.resume_unplaced", "the session resumed, but no deck took it", {
        sessionId: chosen.sessionId,
      });
      return { state: "refused", reason: "it resumed, but the deck did not open to show it" };
    }
    const placed = await deck.place(answer.terminal);
    if (placed.state === "opened") return { state: "resumed" };
    log().info("renderer.history.resume_unmounted", "the session resumed, but no pane took it", {
      sessionId: chosen.sessionId,
      reason: placed.reason,
    });
    return { state: "refused", reason: `it resumed, but no pane took it (${placed.reason})` };
  }, [fieldd, noteLiveness]);

  // P3 — Jump to: the run is asked for again at the press (it may have ended
  // since the line's reading), and the pane showing its floor session is
  // revealed in Godview — activated, or mounted in the active pane.
  const jump = useCallback(async (): Promise<JumpOutcome> => {
    const chosen = selectionRef.current;
    if (chosen === null) return { state: "refused", reason: "choose a session first" };
    const run = await readLiveRun(fieldd, chosen.nativeSessionId);
    noteLiveness(chosen, run);
    if (run === null) return { state: "ended" };
    void requestView("godview");
    const deck = await whenGodviewCanPlace(RESUME_DECK_WAIT_MS);
    if (deck === null) return { state: "refused", reason: "the deck did not open to show it" };
    const shown = await deck.reveal(run.floorSessionId);
    if (shown.state === "opened") return { state: "jumped" };
    log().info("renderer.history.jump_unshown", "the running session's pane was not shown", {
      sessionId: chosen.sessionId,
      reason: shown.reason,
    });
    return { state: "refused", reason: shown.reason };
  }, [fieldd, noteLiveness]);

  const chosen = selection?.sessionId ?? null;
  const waits = current?.state === "waits" ? current.why : null;
  useEffect(() => {
    publishHistoryLineDoor({ chosen, waits, live: chosen !== null && live, resume, jump });
  }, [chosen, waits, live, resume, jump]);
  useEffect(() => () => publishHistoryLineDoor(null), []);

  // Where the Peek opened History at a line: each pick a fresh object, which
  // the room's `openAt` lands on (`open-at.ts`).
  const picked = useHistoryOpenAt();
  // PJ-4 — a regroup re-files sessions under new project keys, and the room
  // lets go of a project id it no longer holds: the chosen session is opened
  // again where it is filed now (`openAt` lands a session in its project). The
  // newest ask — the Peek's pick or this — is the one the room hears.
  const [openAt, setOpenAt] = useState<RoomTarget | null>(picked);
  useEffect(() => {
    if (picked !== null) setOpenAt(picked);
  }, [picked]);
  useEffect(
    () =>
      ports.catalog.onRegrouped(({ sessions }) => {
        const chosen = selectionRef.current;
        if (chosen !== null && sessions.has(chosen.sessionId))
          setOpenAt({ sessionId: chosen.sessionId });
      }),
    [ports],
  );
  const [keys] = useState(() => viewKeysOf(getHost().platform));

  return (
    <HistoryRoomMount
      ports={ports}
      unavailable={words}
      onSelect={setSelection}
      openAt={openAt}
      keys={keys}
    />
  );
}
