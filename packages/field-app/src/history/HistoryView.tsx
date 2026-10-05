import type { RoomSelection } from "@rosetta/room";
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
  publishHistoryLineDoor,
  type ResumeOutcome,
  whenGodviewCanPlace,
} from "../frame/line-door";
import { requestView } from "../frame/view-state";
import { getHost } from "../host";
import { getRendererLogger } from "../logging";
import { historyPortsOver } from "./doors";
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

/** How long Resume waits for Godview's deck — mounted on Godview's first open
 * — to be able to place the resumed agent. */
export const RESUME_DECK_WAIT_MS = 20_000;

function log() {
  return getRendererLogger().child({ component: "history" });
}

export function HistoryView({ active }: { active: boolean }): ReactElement {
  const fieldd = useFielddClient();
  const ports = useMemo(
    () => historyPortsOver(fieldd, { platform: getHost().platform ?? null }),
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

  const resume = useCallback(async (): Promise<ResumeOutcome> => {
    const chosen = selectionRef.current;
    if (chosen === null) return { state: "refused", reason: "choose a session first" };
    const read = readingRef.current ?? (await readResume(fieldd, chosen));
    if (read.state === "waits") return { state: "refused", reason: read.why };
    const answer = await resumeNative(fieldd, read.facts);
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
  }, [fieldd]);

  const chosen = selection?.sessionId ?? null;
  const waits = current?.state === "waits" ? current.why : null;
  useEffect(() => {
    publishHistoryLineDoor({ chosen, waits, resume });
  }, [chosen, waits, resume]);
  useEffect(() => () => publishHistoryLineDoor(null), []);

  return <HistoryRoomMount ports={ports} unavailable={words} onSelect={setSelection} />;
}
