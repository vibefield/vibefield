import type {
  AgentModelChoice,
  AgentModelSelection,
  AgentProfileSet,
  SparkSummary,
} from "@vibefield/contracts";
import { lendNight, type NightLend, type SparkHatchHandle } from "@vibefield/design-kit/spark-face";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useReducedMotion } from "../field/desk/bar/bar-motion";
import { NewSparkSheetView, type SheetPortal } from "./NewSparkSheetView";
import {
  agentLine,
  agentMenuOf,
  CANNOT_LIST_AGENTS,
  CANNOT_LIST_PROFILES,
  dealSeed,
  defaultProfileOf,
  effortOf,
  type ModelsReading,
  type NewSparkPort,
  profileChipsOf,
  reachOf,
  refusalOf,
  type SheetRefusal,
  type SparkAgent,
  sessionsSeenOf,
  sparkAgentsOf,
  startsOf,
  suggestName,
} from "./new-spark";
import { PORTAL_BOUND_MS, type PortalPhase } from "./portal";
import { chooseSpark, refreshSparks, usePersonSessions, useSparksReading } from "./sparks-feed";
import type { Starter } from "./thread-items";

// THE NEW SPARK SHEET, THE CONTROLLER (SP-1c; DESIGN.md §8 "The New spark sheet"). It reads what the sheet offers —
// the agents that can be a spark (`agent.providers[].offers.spark`, CP-5a), the Agent Profiles, an agent's picker
// when its menu opens (`agent.models`) — holds what the person chose, and hatches (`compose.sparks.hatch`). Created,
// the spark's face flies from the sky to its row in Chat, Chat chooses it, and the sheet folds. A refusal is said
// under what it is about (`refusalOf`), and the sheet stays. Like the Peek it is drawn outside the field, which is out
// of reach and recedes while it stands (`field.tsx`), and it stays for its leave.
// ES-2 (track ES; ES-D2 A): an opening from Chat's empty night may carry a first job (`job`, the frame's hold,
// `first-job.ts`). It stands under the agent, × drops it as the sheet settles, and Create hands it to Chat with its
// choice, only after the hatch (`chooseSpark`), for Chat to send as Send sends.
// ES-3b (track ES; ES-D3 A, ES-D5 A; DESIGN.md §6, the portal): opened while Chat's empty night stands in its own
// container, the sheet borrows that night (`lendNight`) as its sky's window. The window draws its first frame at the
// night's moment, the night steps aside, and the edge closes onto the sky; Cancel, Esc or the dim open it back and hand
// the night back at the window's moment; Create takes the sheet and its window away as one. Where no night can be lent,
// or the window cannot draw, it rises as it always has.

/** How long Create waits for the new spark's row to draw before the face flies (the list re-reads its records). */
const ROW_WAIT_MS = 1_500;

/** Its leave (DESIGN.md §8): 240 ms on the retract curve, `new-spark-sheet.css`. */
const LEAVE_MS = 240;

/** A dropped first job's fold, as the sheet settles to its height (DESIGN.md §8): 240 ms, `new-spark-sheet.css`. */
const JOB_SETTLE_MS = 240;

export function NewSparkSheet({
  open,
  port,
  onClose,
  container,
  takeFocus = true,
  bindKeys = true,
  job = null,
}: {
  /** the frame's surface is `new-spark` */
  open: boolean;
  /** the doors the sheet asks, through the window's fieldd client */
  port: NewSparkPort;
  onClose: () => void;
  /** where it is drawn: the document's body in the product, a plate in the catalog */
  container?: HTMLElement | null | undefined;
  /** the name takes the keyboard as it opens (the product's; a catalog plate leaves the page's focus alone) */
  takeFocus?: boolean | undefined;
  /** Esc folds it (the product's; a catalog plate binds no keys) */
  bindKeys?: boolean | undefined;
  /** ES-2 — the first job this opening carries from Chat's empty night (the frame's hold); null, none */
  job?: Starter | null | undefined;
}): ReactElement | null {
  // each opening is a sheet of its own (a name and a face dealt, the hatch again); a folded one stays for its leave
  const [was, setWas] = useState(open);
  const [opening, setOpening] = useState(0);
  const [leaving, setLeaving] = useState(false);
  // how long its leave stands: its own 240ms, or, through the portal, the face's leave back into the night
  const [leaveMs, setLeaveMs] = useState(LEAVE_MS);
  if (open !== was) {
    setWas(open);
    setLeaving(!open);
    if (open) {
      setOpening(opening + 1);
      setLeaveMs(LEAVE_MS);
    }
  }
  useEffect(() => {
    if (!leaving) return;
    const gone = window.setTimeout(() => setLeaving(false), leaveMs);
    return () => window.clearTimeout(gone);
  }, [leaving, leaveMs]);
  // ES-3e: through the portal the sheet says when it may go, sooner than its bound
  const gone = useCallback(() => setLeaving(false), []);
  if (!open && !leaving) return null;
  const target = container === undefined ? document.body : container;
  if (target === null) return null;
  return createPortal(
    <Sheet
      key={opening}
      open={open}
      port={port}
      onClose={onClose}
      takeFocus={takeFocus}
      bindKeys={bindKeys}
      carried={job}
      container={target}
      onLeaveFor={setLeaveMs}
      onGone={gone}
    />,
    target,
  );
}

/** The portal as the sheet holds it: where the night it borrowed stood, and where the portal is. */
interface PortalHeld {
  readonly from: DOMRectReadOnly;
  readonly clip: string;
  readonly t: number;
  readonly phase: SheetPortal["phase"];
}

function Sheet({
  open,
  port,
  onClose,
  takeFocus,
  bindKeys,
  carried,
  container,
  onLeaveFor,
  onGone,
}: {
  open: boolean;
  port: NewSparkPort;
  onClose: () => void;
  takeFocus: boolean;
  bindKeys: boolean;
  carried: Starter | null;
  /** where it is drawn: the night it may borrow stands inside it */
  container: HTMLElement;
  /** how long its leave stands, once it folds: through the portal, the bound its own word ends sooner */
  onLeaveFor: (ms: number) => void;
  /** ES-3e — through the portal it may go now: the fold has handed the night back and the face has left */
  onGone: () => void;
}): ReactElement {
  const reading = useSparksReading();
  const taken = useMemo(
    () => (reading.state === "ready" ? reading.entries.map((entry) => entry.spark.name) : []),
    [reading],
  );
  const [name, setName] = useState(() => suggestName(taken));
  const [seed, setSeed] = useState(() => dealSeed());
  const [play, setPlay] = useState(1);
  const [agents, setAgents] = useState<readonly SparkAgent[]>([]);
  const [sets, setSets] = useState<readonly AgentProfileSet[]>([]);
  const [agentId, setAgentId] = useState<string | undefined>(undefined);
  const [thinksUnder, setThinksUnder] = useState<string | undefined>(undefined);
  const [profiles, setProfiles] = useState<readonly string[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [models, setModels] = useState<ReadonlyMap<string, ModelsReading>>(new Map());
  const [selection, setSelection] = useState<AgentModelSelection | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [refusal, setRefusal] = useState<SheetRefusal | null>(null);
  const hatch = useRef<SparkHatchHandle>(null);
  // ES-2 — the opening's first job, as it opened: × folds it away, and the sheet settles before it goes
  const [job, setJob] = useState<Starter | null>(carried);
  const [jobLeaving, setJobLeaving] = useState(false);
  useEffect(() => {
    if (!jobLeaving) return;
    const gone = window.setTimeout(() => {
      setJob(null);
      setJobLeaving(false);
    }, JOB_SETTLE_MS);
    return () => window.clearTimeout(gone);
  }, [jobLeaving]);
  // a sheet already folded (by a view change, say, or the palette) never folds whatever opened after it
  const standing = useRef(open);
  standing.current = open;
  // ES-3b — the portal: the night borrowed as it opened, and where the portal is
  const reduced = useReducedMotion();
  const still = useRef(reduced);
  still.current = reduced;
  const [portal, setPortal] = useState<PortalHeld | null>(null);
  const phaseAt = useRef<SheetPortal["phase"] | null>(null);
  phaseAt.current = portal?.phase ?? null;
  const lent = useRef<NightLend | null>(null);
  const given = useRef(false);
  const drawnAt = useRef(0);
  const hatched = useRef(false);
  // the night handed back: drawn at the window's moment where it had stepped aside, carrying on where it had not
  const handBack = useCallback(() => {
    const lend = lent.current;
    if (lend === null) return;
    lent.current = null;
    if (!given.current) {
      lend.cancel();
      return;
    }
    lend.takeBack(hatch.current?.now() ?? lend.t + (performance.now() - drawnAt.current) / 1000);
  }, []);
  // borrowed as it opens, before its first frame, from the night standing in its own container (§6, the portal)
  useLayoutEffect(() => {
    const lend = lendNight(container);
    if (lend === null) return;
    lent.current = lend;
    given.current = false;
    setPortal({ from: lend.rect, clip: lend.clip, t: lend.t, phase: "drawing" });
    // ES-3e: through the portal the sheet leaves once the fold has (`onGone`); the bound ends a wait whose frames
    // never come
    onLeaveFor(PORTAL_BOUND_MS);
    // gone before its fold handed the night back (another opening, the view gone): it is handed back now
    return handBack;
  }, [container, handBack, onLeaveFor]);
  // the window has drawn its first frame: the night steps aside, and the edge closes onto the sky
  const onDrawn = useCallback(() => {
    const lend = lent.current;
    if (lend === null || !standing.current || phaseAt.current !== "drawing") return;
    lend.give();
    given.current = true;
    drawnAt.current = performance.now();
    setPortal((held) => (held === null ? held : { ...held, phase: "closing" }));
  }, []);
  // the window cannot draw (no WebGL2): the night carries on, and the sheet rises as it always has
  const onFailed = useCallback(() => {
    handBack();
    setPortal(null);
    onLeaveFor(LEAVE_MS);
  }, [handBack, onLeaveFor]);
  const phase = portal?.phase;
  // ES-3d: a phase's motion has finished (its own animations, or its own time where nothing animates): the close
  // opens; the fold, the window open again, hands the night back at the window's own moment (§6, the portal)
  const onMoved = useCallback(
    (motion: PortalPhase) => {
      if (motion === "closing")
        setPortal((held) => (held?.phase === "closing" ? { ...held, phase: "open" } : held));
      else if (motion === "folding" && phaseAt.current === "folding") {
        handBack();
        setPortal((held) => (held?.phase === "folding" ? { ...held, phase: "folded" } : held));
      }
    },
    [handBack],
  );
  // Cancel, Esc or the dim open the window back; Create takes the sheet and its window away as one. Folded before the
  // window drew, the night never stepped aside, and carries on
  useLayoutEffect(() => {
    if (open) return;
    if (phaseAt.current === "drawing") {
      // folded before the window drew: nothing of it showed, and nothing is left to wait for
      handBack();
      onLeaveFor(LEAVE_MS);
    } else if (phaseAt.current === "closing" || phaseAt.current === "open")
      setPortal((held) =>
        held === null ? held : { ...held, phase: hatched.current ? "leaving" : "folding" },
      );
  }, [handBack, onLeaveFor, open]);
  // the fold: the face shrinks back into the night as the window opens again; the night is handed back once it has
  // (`onMoved`). ES-3e: once the night is back and the face has left (its 450 on the hatch's own clock), the sheet goes
  const faceGone = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (phase !== "folding") return;
    faceGone.current = reduced ? Promise.resolve() : (hatch.current?.leave() ?? Promise.resolve());
  }, [phase, reduced]);
  useEffect(() => {
    if (phase !== "folded") return;
    let live = true;
    void faceGone.current.then(() => {
      if (live) onGone();
    });
    return () => {
      live = false;
    };
  }, [onGone, phase]);

  // the keyboard goes back where it was as the sheet leaves
  const before = useRef<Element | null>(document.activeElement);
  useEffect(() => {
    if (open || !takeFocus) return;
    const back = before.current;
    if (back instanceof HTMLElement && back.isConnected) back.focus();
  }, [open, takeFocus]);

  // what the sheet offers, read once as it opens
  useEffect(() => {
    let live = true;
    void Promise.allSettled([port.providers(), port.profileSets()]).then(([offered, listed]) => {
      if (!live) return;
      const sparkAgents = offered.status === "fulfilled" ? sparkAgentsOf(offered.value) : [];
      const profileSets = listed.status === "fulfilled" ? listed.value : [];
      setAgents(sparkAgents);
      setSets(profileSets);
      setAgentId((held) => held ?? sparkAgents.find((agent) => agent.takes)?.id);
      const home = defaultProfileOf(profileSets)?.id;
      setThinksUnder((held) => held ?? home);
      setProfiles((held) => (held.length > 0 || home === undefined ? held : [home]));
      // Create waits on these reads (item 149): one that failed is said at the foot, the agents' first, so Create is
      // never left waiting in silence (an agent list with none that can be a spark says so on its pill)
      if (offered.status === "rejected") setRefusal({ at: "foot", words: CANNOT_LIST_AGENTS });
      else if (home === undefined) setRefusal({ at: "foot", words: CANNOT_LIST_PROFILES });
    });
    return () => {
      live = false;
    };
  }, [port]);

  // While open, Esc is the sheet's before anything else hears it, on the window's capture phase as the Peek's is: under
  // a cover the frame stops every key aimed at the body there (`frame/ViewFrame.tsx`), so a sheet that heard Esc on
  // the bubble phase stayed open once the keyboard was on the body. The agent menu folds first, then the sheet.
  useEffect(() => {
    if (!open || !bindKeys) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (menuOpen) setMenuOpen(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [bindKeys, menuOpen, onClose, open]);

  const modelsKey =
    agentId !== undefined && thinksUnder !== undefined ? `${agentId}|${thinksUnder}` : null;
  // the agent's own picker, read when its menu first opens under the profile it thinks under
  useEffect(() => {
    if (!menuOpen || modelsKey === null || agentId === undefined || thinksUnder === undefined)
      return;
    if (models.has(modelsKey)) return;
    setModels((held) => new Map(held).set(modelsKey, { state: "reading" }));
    port.models(agentId, thinksUnder).then(
      (answer) => setModels((held) => new Map(held).set(modelsKey, { state: "read", answer })),
      (error: unknown) =>
        setModels((held) =>
          new Map(held).set(modelsKey, {
            state: "failed",
            words: error instanceof Error ? error.message : String(error),
          }),
        ),
    );
  }, [agentId, menuOpen, models, modelsKey, port, thinksUnder]);

  const agent = agents.find((candidate) => candidate.id === agentId);
  const picker = modelsKey === null ? undefined : models.get(modelsKey);
  const model: AgentModelChoice | undefined =
    picker?.state === "read"
      ? picker.answer.catalog?.models.find((candidate) => candidate.id === selection?.modelId)
      : undefined;
  const effortControl = model?.controls.find((control) => control.role === "effort");
  const manyProfiles = sets.length > 1;
  const under = manyProfiles ? sets.find((set) => set.id === thinksUnder)?.label : undefined;
  const seen = useMemo(
    () => (thinksUnder === undefined ? profiles : [...new Set([...profiles, thinksUnder])]),
    [profiles, thinksUnder],
  );
  const sessions = sessionsSeenOf(usePersonSessions(), sets, seen);

  const reroll = useCallback(() => {
    setSeed(dealSeed());
    setPlay((count) => count + 1);
  }, []);

  const create = useCallback(async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed === "" || agentId === undefined || thinksUnder === undefined || creating) return;
    setCreating(true);
    setRefusal(null);
    let spark: SparkSummary;
    try {
      spark = await port.hatch({
        name: trimmed,
        face: { seed },
        agent: agentId,
        ...(selection === undefined ? {} : { modelSelection: selection }),
        profiles: seen,
        thinksUnder,
      });
    } catch (error) {
      setCreating(false);
      const profile = sets.find((set) => set.id === thinksUnder)?.label;
      setRefusal(
        refusalOf(error, {
          name: trimmed,
          ...(agent === undefined ? {} : { agent: agent.label }),
          ...(profile === undefined ? {} : { profile }),
        }),
      );
      return;
    }
    // hatched: through the portal it now leaves with its window, never folding the night back (Chat holds a spark)
    hatched.current = true;
    onLeaveFor(LEAVE_MS);
    // its row: the list reads the records again, Chat chooses it (with the first job it carries, which Chat sends
    // once its row is read), and the face flies there
    refreshSparks();
    chooseSpark(spark.id, job === null || jobLeaving ? undefined : job.words);
    const row = await rowOf(spark.id);
    if (row !== null && standing.current) await hatch.current?.fly(row);
    if (standing.current) onClose();
  }, [
    agent,
    agentId,
    creating,
    job,
    jobLeaving,
    name,
    onClose,
    onLeaveFor,
    port,
    seed,
    seen,
    selection,
    sets,
    thinksUnder,
  ]);

  return (
    <NewSparkSheetView
      open={open}
      focusName={takeFocus}
      name={name}
      seed={seed}
      play={play}
      agentId={agent?.takes ? agent.id : undefined}
      agentLine={agentLine(agent, model, selection)}
      profileLabel={under}
      menuOpen={menuOpen}
      menu={agentMenuOf(agents, agentId, picker, selection, under)}
      effort={effortOf(model, selection)}
      profiles={
        manyProfiles
          ? {
              chips: profileChipsOf(sets, profiles, thinksUnder),
              reach: reachOf(sessions, startsOf(sets, profiles, thinksUnder, agents)),
            }
          : undefined
      }
      refusal={refusal}
      creating={creating}
      ready={agentId !== undefined && thinksUnder !== undefined}
      hatchRef={hatch}
      {...(portal === null
        ? {}
        : { portal: { ...portal, reduced, onDrawn, onFailed, onMoved } satisfies SheetPortal })}
      {...(job === null ? {} : { job })}
      jobLeaving={jobLeaving}
      onDropJob={() => setJobLeaving(true)}
      onName={(next) => {
        setName(next);
        if (refusal?.at === "name") setRefusal(null);
      }}
      onReroll={reroll}
      onMenu={setMenuOpen}
      onAgent={(id) => {
        setAgentId(id);
        setSelection(undefined);
      }}
      onModel={(id) => {
        setSelection(id === null ? undefined : { modelId: id });
        if (refusal?.at === "agent") setRefusal(null);
      }}
      onEffort={(value) => {
        if (selection === undefined || effortControl === undefined) return;
        setSelection({
          ...selection,
          controls: { ...selection.controls, [effortControl.id]: value },
        });
      }}
      onProfile={(id) => {
        setProfiles((held) =>
          held.includes(id) ? held.filter((profile) => profile !== id) : [...held, id],
        );
        if (refusal?.at === "profiles") setRefusal(null);
      }}
      onCancel={onClose}
      onCreate={() => void create()}
    />
  );
}

/** The new spark's face in Chat's list, once its row draws; null if it has not drawn within the wait. */
function rowOf(spark: string): Promise<HTMLElement | null> {
  const started = performance.now();
  return new Promise((found) => {
    const look = (): void => {
      const face = document.querySelector<HTMLElement>(
        `.vf-chat-row[data-spark="${CSS.escape(spark)}"] .vf-spark-face`,
      );
      if (face !== null) found(face);
      else if (performance.now() - started > ROW_WAIT_MS) found(null);
      else requestAnimationFrame(look);
    };
    look();
  });
}
