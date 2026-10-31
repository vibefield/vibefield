import type {
  AgentModelChoice,
  AgentModelSelection,
  AgentProfileSet,
  SparkSummary,
} from "@vibefield/contracts";
import type { SparkHatchHandle } from "@vibefield/design-kit/spark-face";
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NewSparkSheetView } from "./NewSparkSheetView";
import {
  agentLine,
  agentMenuOf,
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
import { chooseSpark, refreshSparks, useSessionTally, useSparksReading } from "./sparks-feed";

// THE NEW SPARK SHEET, THE CONTROLLER (SP-1c; DESIGN.md §8 "The New spark sheet"). It reads what the sheet offers —
// the agents that can be a spark (`agent.providers[].briefing`), the Agent Profiles, an agent's picker when its menu
// opens (`agent.models`) — holds what the person chose, and hatches (`compose.sparks.hatch`). Created, the spark's
// face flies from the sky to its row in Chat, Chat chooses it, and the sheet folds. A refusal is said under what it
// is about (`refusalOf`), and the sheet stays. Like the Peek it is drawn outside the field, which is out of reach and
// recedes while it stands (`field.tsx`), and it stays for its leave.

/** How long Create waits for the new spark's row to draw before the face flies (the list re-reads its records). */
const ROW_WAIT_MS = 1_500;

/** Its leave (DESIGN.md §8): 240 ms on the retract curve, `new-spark-sheet.css`. */
const LEAVE_MS = 240;

export function NewSparkSheet({
  open,
  port,
  onClose,
  container,
  takeFocus = true,
  bindKeys = true,
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
}): ReactElement | null {
  // each opening is a sheet of its own (a name and a face dealt, the hatch again); a folded one stays for its leave
  const [was, setWas] = useState(open);
  const [opening, setOpening] = useState(0);
  const [leaving, setLeaving] = useState(false);
  if (open !== was) {
    setWas(open);
    setLeaving(!open);
    if (open) setOpening(opening + 1);
  }
  useEffect(() => {
    if (!leaving) return;
    const gone = window.setTimeout(() => setLeaving(false), LEAVE_MS);
    return () => window.clearTimeout(gone);
  }, [leaving]);
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
    />,
    target,
  );
}

function Sheet({
  open,
  port,
  onClose,
  takeFocus,
  bindKeys,
}: {
  open: boolean;
  port: NewSparkPort;
  onClose: () => void;
  takeFocus: boolean;
  bindKeys: boolean;
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
  // a sheet already folded (by a view change, say, or the palette) never folds whatever opened after it
  const standing = useRef(open);
  standing.current = open;
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
      if (offered.status === "rejected")
        setRefusal({ at: "foot", words: "VibeField can't list its agents right now" });
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
  const tally = useSessionTally();
  const sessions = sessionsSeenOf(tally, sets, seen);

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
    // its row: the list reads the records again, Chat chooses it, and the face flies there
    refreshSparks();
    chooseSpark(spark.id);
    const row = await rowOf(spark.id);
    if (row !== null && standing.current) await hatch.current?.fly(row);
    if (standing.current) onClose();
  }, [agent, agentId, creating, name, onClose, port, seed, seen, selection, sets, thinksUnder]);

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
      hatchRef={hatch}
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
