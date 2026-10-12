import type { RoomSelection, RoomTarget } from "@rosetta/room";
import {
  type AgentProviderSummary,
  AgentProvidersResult,
  type DeviceInfo,
  DeviceListResult,
  ProjectGetResult,
} from "@vibefield/contracts";
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
  jumpNote,
  publishHistoryLineDoor,
  type ResumeOutcome,
  resumeNote,
  sayOnHistoryLine,
} from "../frame/line-door";
import { viewKeysOf } from "../frame/views";
import { getHost } from "../host";
import { getRendererLogger } from "../logging";
import { terminalBootstrapHome } from "../terminal/pool";
import {
  type HistoryActsDeps,
  intentNote,
  jumpTarget,
  newAgent,
  newAgentNote,
  projectIntent,
  resumeTarget,
  type SessionTarget,
  thrownReason,
} from "./acts";
import {
  type HistoryHostActs,
  type HistoryHostState,
  historyHostInputs,
  NO_HOST_STATE,
} from "./host-inputs";
import { deviceOf, EMPTY_HOST_MODEL, type HistoryHostModel, hostModelOf } from "./host-model";
import { readLiveRun } from "./jump";
import { useHistoryOpenAt } from "./open-at";
import { type ResumeReading, readResume } from "./resume";
import { HistoryRoomMount } from "./room-chunk";
import { productHistoryPorts } from "./window-ports";

// HISTORY'S CONTROLLER (AR-8c). It holds the room's ports — the WINDOW's
// (`window-ports.ts`, PJ-4: the Peek's reader reads the same) — tells the
// catalog when the view shows, says the index's state in the frame's words,
// and lends the line History's create: Resume, for the session the room has
// chosen. The room itself is its own chunk (`room-chunk.tsx`, 2026-10-04):
// this controller rides the canvas's chunk and mounts the room through it,
// "Opening History" saying so while it arrives.
//
// While the chosen session runs on this desktop the create is Jump to (P3,
// `jump.ts`): the pane it runs in, revealed by Godview's deck — and Resume
// refuses it in Jump to's words, asking `agent.resume` nothing.
//
// Its search is the frame's — the Peek (2026-10-08, GV-D8; `frame/Peek.tsx`):
// a past row the Peek opens arrives through `open-at.ts`, and this controller
// hands it to the room's own `openAt`.
//
// PJ-4 (H1–H6) — History by project. Beside the room's ports it hands the room
// its HOST INPUTS (`host-inputs.tsx`), drawn from one host model per listing
// (`host-model.ts`): fieldd's projects and this desktop's keyed sessions (the
// catalog port's listing), each desktop's name and OS (`device.list`), what
// runs here now (one plain `agent.list` — P3's reading, asked per listing and
// only while History shows: PF6) and the agents this desktop offers
// (`agent.providers`). The room's own acts — a row's Resume or Jump to, ④'s,
// New agent, the project's acts — are this controller's (`acts.ts`), and
// what each came to is said on the line (`sayOnHistoryLine`).

function log() {
  return getRendererLogger().child({ component: "history" });
}

/** The room's selection as an act names it. */
function targetOfSelection(selection: RoomSelection): SessionTarget {
  return {
    sessionId: selection.sessionId,
    nativeSessionId: selection.nativeSessionId,
    folder: selection.folder,
    ...(selection.hostKey !== undefined ? { hostKey: selection.hostKey } : {}),
  };
}

export function HistoryView({ active }: { active: boolean }): ReactElement {
  const fieldd = useFielddClient();
  const ports = useMemo(() => productHistoryPorts(fieldd), [fieldd]);
  useEffect(() => ports.catalog.setActive(active), [ports, active]);
  const words = useSyncExternalStore(
    useCallback((listener: () => void) => ports.catalog.onWordsChange(listener), [ports]),
    () => ports.catalog.words(),
  );

  /* ── the host model (PJ-4): one per listing, gathered while History shows ── */

  const [model, setModel] = useState<HistoryHostModel>(EMPTY_HOST_MODEL);
  const modelRef = useRef(model);
  modelRef.current = model;
  const roster = useRef<readonly DeviceInfo[]>([]);
  const providers = useRef<readonly AgentProviderSummary[]>([]);
  const activeRef = useRef(active);
  activeRef.current = active;
  const gather = useCallback(async () => {
    if (ports.catalog.listing() === null) return;
    const [devices, offered, runs] = await Promise.allSettled([
      fieldd.request("device.list", {}).then((answer) => DeviceListResult.parse(answer).devices),
      fieldd
        .request("agent.providers", {})
        .then((answer) => AgentProvidersResult.parse(answer).providers),
      fieldd.request("agent.list", {}).then((answer) => {
        const sessions =
          typeof answer === "object" && answer !== null
            ? (answer as { sessions?: unknown }).sessions
            : undefined;
        return Array.isArray(sessions) ? (sessions as unknown[]) : [];
      }),
    ]);
    // a door that could not answer keeps what it said last (a desktop's name,
    // the agents offered); what runs now is read afresh or not at all
    if (devices.status === "fulfilled") roster.current = devices.value;
    if (offered.status === "fulfilled") providers.current = offered.value;
    const latest = ports.catalog.listing();
    if (latest === null) return;
    setModel(
      hostModelOf(
        latest,
        roster.current,
        runs.status === "fulfilled" ? runs.value : [],
        providers.current,
      ),
    );
  }, [fieldd, ports]);
  useEffect(
    () =>
      ports.catalog.onListing(() => {
        if (activeRef.current) void gather();
      }),
    [ports, gather],
  );
  // History showing again reads what runs now (the catalog reads its listing
  // again if a ping was noted meanwhile)
  useEffect(() => {
    if (active) void gather();
  }, [active, gather]);

  /* ── the chosen session and the line's create ────────────────────────── */

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
  // through Resume on its way to Jump to.
  const [live, setLive] = useState(false);
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

  const deps = useMemo<HistoryActsDeps>(
    () => ({
      client: fieldd,
      self: () => modelRef.current.self,
      nameOf: (device) => deviceOf(modelRef.current, device).name,
      unplaced: (what, reason) =>
        log().info("renderer.history.unplaced", "an act ran, but no pane showed it", {
          what,
          ...(reason !== undefined ? { reason } : {}),
        }),
    }),
    [fieldd],
  );
  /** An act that threw is said all the same (2026-10-11, the honest-states
   * rule): its own refusal in the throw's words, where its outcome would have
   * been said — and logged. The acts refuse in words themselves; this is the
   * controller's last word on one that does not. */
  const failed = useCallback((act: string, error: unknown): string => {
    log().error(
      "renderer.history.act_failed",
      "a History act threw; its refusal was said on the line",
      error,
      { act },
    );
    return thrownReason(error);
  }, []);
  /** A press's own answer moves the create, as the line's reading would. */
  const noteRun = useCallback(
    async (target: SessionTarget) => {
      if (selectionRef.current?.sessionId !== target.sessionId) return;
      setLive((await readLiveRun(fieldd, target.nativeSessionId)) !== null);
    },
    [fieldd],
  );

  const resume = useCallback(async (): Promise<ResumeOutcome> => {
    const chosen = selectionRef.current;
    if (chosen === null) return { state: "refused", reason: "choose a session first" };
    const target = targetOfSelection(chosen);
    let outcome: ResumeOutcome;
    try {
      outcome = await resumeTarget(deps, target, readingRef.current);
    } catch (error) {
      return { state: "refused", reason: failed("resume", error) };
    }
    if (outcome.state === "running") await noteRun(target);
    return outcome;
  }, [deps, noteRun, failed]);

  // P3 — Jump to: the run asked for again at the press, the pane showing its
  // floor session revealed in Godview
  const jump = useCallback(async (): Promise<JumpOutcome> => {
    const chosen = selectionRef.current;
    if (chosen === null) return { state: "refused", reason: "choose a session first" };
    const target = targetOfSelection(chosen);
    let outcome: JumpOutcome;
    try {
      outcome = await jumpTarget(deps, target);
    } catch (error) {
      outcome = { state: "refused", reason: failed("jump", error) };
    }
    await noteRun(target);
    return outcome;
  }, [deps, noteRun, failed]);

  const chosen = selection?.sessionId ?? null;
  const waits = current?.state === "waits" ? current.why : null;
  useEffect(() => {
    publishHistoryLineDoor({ chosen, waits, live: chosen !== null && live, resume, jump });
  }, [chosen, waits, live, resume, jump]);
  useEffect(() => () => publishHistoryLineDoor(null), []);

  /* ── the host's state and acts (PJ-4) ────────────────────────────────── */

  const [hostState, setHostState] = useState<HistoryHostState>(() => ({
    ...NO_HOST_STATE,
    home: terminalBootstrapHome(),
  }));
  /** the listing each project's suggestions were last asked in, so a shown
   * project asks `project.get` once per listing */
  const asked = useRef(new Map<string, HistoryHostModel>());
  const showSuggestions = useCallback(
    (project: string) => {
      if (asked.current.get(project) === modelRef.current) return;
      asked.current.set(project, modelRef.current);
      void fieldd
        .request("project.get", { key: project })
        .then((answer) => {
          const { suggestions } = ProjectGetResult.parse(answer);
          setHostState((state) => {
            const held = new Map(state.suggestions);
            held.set(project, suggestions);
            return { ...state, suggestions: held };
          });
        })
        .catch(() => undefined);
    },
    [fieldd],
  );
  const acts = useMemo<HistoryHostActs>(
    () => ({
      setDesktop: (desktop) => setHostState((state) => ({ ...state, desktop })),
      setAgent: (agent) => setHostState((state) => ({ ...state, agent })),
      // each act's outcome is said on the line — and one that threw, as its
      // own refusal (`failed`), never a press that ends in silence
      resume: (target) => {
        void resumeTarget(deps, target).then(
          (outcome) => {
            sayOnHistoryLine(resumeNote(outcome));
            if (outcome.state === "running") void noteRun(target);
          },
          (error: unknown) =>
            sayOnHistoryLine(resumeNote({ state: "refused", reason: failed("resume", error) })),
        );
      },
      jump: (target) => {
        void jumpTarget(deps, target).then(
          (outcome) => {
            sayOnHistoryLine(jumpNote(outcome));
            void noteRun(target);
          },
          (error: unknown) => {
            sayOnHistoryLine(jumpNote({ state: "refused", reason: failed("jump", error) }));
            void noteRun(target);
          },
        );
      },
      newAgent: (ask) => {
        void newAgent(deps, ask).then(
          (outcome) => sayOnHistoryLine(newAgentNote(outcome)),
          (error: unknown) =>
            sayOnHistoryLine(newAgentNote({ state: "refused", reason: failed("newAgent", error) })),
        );
      },
      intent: (params, words) => {
        void projectIntent(fieldd, params).then(
          (outcome) => sayOnHistoryLine(intentNote(outcome, words)),
          (error: unknown) =>
            sayOnHistoryLine(
              intentNote({ state: "refused", reason: failed("intent", error) }, words),
            ),
        );
      },
      // H4 — the room keeps its field open on a rejection and says the
      // error's words under it: the intent's own (`projectIntent`); a rename
      // that took is said on the line
      rename: async (key, name) => {
        const outcome = await projectIntent(fieldd, { key, op: "rename", name });
        if (outcome.state === "refused") throw new Error(outcome.reason);
        sayOnHistoryLine(`Renamed to ${name}`);
      },
      shown: (project) => showSuggestions(project),
    }),
    [deps, fieldd, noteRun, showSuggestions, failed],
  );
  const inputs = useMemo(() => historyHostInputs(model, hostState, acts), [model, hostState, acts]);

  /* ── where the room opens ────────────────────────────────────────────── */

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
        const chosenNow = selectionRef.current;
        if (chosenNow !== null && sessions.has(chosenNow.sessionId))
          setOpenAt({ sessionId: chosenNow.sessionId });
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
      inputs={inputs}
    />
  );
}
