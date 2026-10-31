import type {
  AgentModelChoice,
  AgentModelSelection,
  AgentProfileSet,
  AgentProviderSummary,
} from "@vibefield/contracts";
import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type CardTargets, cardTargets, TARGET_LAYER } from "../frame/cards/card-targets";
import { nothingToGive, paneTextOf } from "../frame/cards/card-text";
import type { Card } from "../frame/cards/cards-model";
import { OUTCOME_WORDS, TARGET_WORDS } from "../frame/cards/cards-words";
import { type FrameSurface, foldSurface } from "../frame/frame-surface";
import { sayOnLine } from "../frame/line-door";
import { type AtRow, atDefaultHot, atMove, atRow, atRowsOf } from "./at-rows";
import { type AtShown, ChatComposerView, menuRowId } from "./ChatComposerView";
import {
  type AgentChip,
  atQueryBefore,
  type DraftChip,
  type DraftPart,
  draftAfterSend,
  draftBlank,
  draftSendable,
  draftStills,
  draftText,
  insertChipAt,
  normalizeDraft,
  spliceDraft,
} from "./composer-draft";
import {
  atAnchor,
  atLeftAt,
  caretOf,
  caretPlace,
  insertPlainText,
  placeCaret,
  readEditor,
} from "./composer-editor";
import {
  agentMenuOf,
  effortOf,
  type ModelsReading,
  modelWords,
  type NewSparkPort,
} from "./new-spark";
import type { SparkEntry } from "./spark-status";
import { useBoardRows } from "./sparks-feed";
import { sendNote, type ThreadSendOutcome } from "./thread-send";

// CHAT'S COMPOSER, THE CONTROLLER (SP-1d; DESIGN.md §8 "Chat's composer"; LN-D3). It owns what the composer does — the
// draft and its chips, @'s list and its hot row, an agent's menu, Send, and the hand's place for cards on it — and
// nothing it shows, which is `ChatComposerView`'s. Which of the frame's surfaces is open is not its own: @'s list is
// the frame's surface `at`, and this asks the one owner (FieldView, `frame-surface.ts`).
//
// The draft is an editor (D1: chips inline in the sentence), so while a person types the editor's DOM is the truth:
// every input is read back into parts, and the controller writes parts back only when it changes the draft itself — a
// chip landing, an @ taken, a model chosen, a send — by handing the view a new seed and a new revision, after which
// the caret is put where the change leaves it. Restored from the line's controller in git
// (`0e2ad08bc:packages/field-app/src/frame/Composer.tsx`, its editor, @ and send halves); its create, its keys, Send
// to…'s landing and its clipboard road did not come back. The draft is the thread's: every change of it is parked with
// Chat (`onPark`), and on unmount, so leaving the thread or Chat keeps it.

/** What @'s rows read: the agents and profiles fieldd offers, and an agent's own picker (the New spark sheet's doors). */
export type ComposerPort = Pick<NewSparkPort, "providers" | "profileSets" | "models">;

export interface ChatComposerProps {
  /** the spark whose thread this is: who a message goes to */
  entry: SparkEntry;
  /** Chat is the view: the composer is the hand's place for cards while it is */
  active: boolean;
  /** the draft as the thread last left it */
  parked: readonly DraftPart[];
  /** the draft changed (and on unmount): the thread keeps it */
  onPark: (parts: readonly DraftPart[]) => void;
  /** the frame's open surface, from its one owner */
  surface: FrameSurface | null;
  onSurfaceChange: (next: FrameSurface | null) => void;
  port: ComposerPort;
  /** Send into the thread's pane (`thread-send.ts`, over Chat's world) */
  send: (text: string, stills: readonly string[]) => Promise<ThreadSendOutcome>;
  /** where an outcome is said (undefined: the line's note) */
  say?: ((text: string) => boolean) | undefined;
  /** the hand's registry of places (undefined: the window's) */
  targets?: CardTargets | undefined;
}

let chipSeq = 0;
const nextChipId = (): string => {
  chipSeq += 1;
  return `chip-${chipSeq}`;
};

/** The chips a draft holds, by id: what the editor reads its chips' elements back into. */
function chipsOf(parts: readonly DraftPart[]): Map<string, DraftChip> {
  const chips = new Map<string, DraftChip>();
  for (const part of parts) if (part.kind === "chip") chips.set(part.chip.id, part.chip);
  return chips;
}

/** The agent's menu while it stands in @'s box: whose chip, its hot model row, and where the box grew from. */
interface MenuOpen {
  readonly chip: string;
  readonly hot: string | null;
  readonly left: number;
}

/** A picker's models, once read. */
const modelsOf = (picker: ModelsReading | undefined): readonly AgentModelChoice[] =>
  picker?.state === "read" ? (picker.answer.catalog?.models ?? []) : [];

export function ChatComposer({
  entry,
  active,
  parked,
  onPark,
  surface,
  onSurfaceChange,
  port,
  send,
  say = sayOnLine,
  targets = cardTargets,
}: ChatComposerProps): ReactElement {
  const { spark } = entry;
  const name = spark.name;
  const boxRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const chips = useRef<Map<string, DraftChip>>(chipsOf(parked));
  const pendingCaret = useRef<number | null>(null);
  /** the caret the draft last held, wherever the focus went since: a card played on the composer lands there */
  const caretMemo = useRef<number | null>(null);
  /** the editor is being drawn again: the blur its old element gives is not the person leaving it */
  const redrawing = useRef(false);
  const [seed, setSeed] = useState<readonly DraftPart[]>(parked);
  const [revision, setRevision] = useState(0);
  const [parts, setParts] = useState<readonly DraftPart[]>(() => normalizeDraft(parked));
  const [at, setAt] = useState<{ readonly query: string; readonly left: number } | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuOpen | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const live = useRef(true);

  // ── THE DRAFT IS THE THREAD'S: parked on every change, and as the composer goes ──
  const onParkRef = useRef(onPark);
  onParkRef.current = onPark;
  const partsRef = useRef(parts);
  partsRef.current = parts;
  useEffect(() => {
    onParkRef.current(parts);
  }, [parts]);
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;
  const onSurfaceChangeRef = useRef(onSurfaceChange);
  onSurfaceChangeRef.current = onSurfaceChange;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      onParkRef.current(partsRef.current);
      // a thread left with @ open leaves no @ standing over the next
      if (surfaceRef.current === "at") onSurfaceChangeRef.current(null);
    };
  }, []);

  // ── WHAT @ OFFERS: read on Chat's first show and again each time @ opens (an agent's picker as its menu opens) ──
  const [asks, setAsks] = useState(0);
  const [providers, setProviders] = useState<readonly AgentProviderSummary[] | null>(null);
  const [sets, setSets] = useState<readonly AgentProfileSet[] | null>(null);
  const [models, setModels] = useState<ReadonlyMap<string, ModelsReading>>(new Map());
  const shownOnce = useRef(false);
  useEffect(() => {
    if (!active || shownOnce.current) return;
    shownOnce.current = true;
    setAsks((count) => count + 1);
  }, [active]);
  useEffect(() => {
    if (asks === 0) return;
    let current = true;
    void Promise.allSettled([port.providers(), port.profileSets()]).then(([offered, listed]) => {
      if (!current) return;
      // a read that failed offers nothing from it, as the New spark sheet's does
      setProviders(offered.status === "fulfilled" ? offered.value : []);
      setSets(listed.status === "fulfilled" ? listed.value : []);
    });
    return () => {
      current = false;
    };
  }, [asks, port]);
  const rows = useBoardRows();
  const list = useMemo(
    () => atRowsOf({ spark, query: at?.query ?? "", providers, sets, rows }),
    [spark, at, providers, sets, rows],
  );
  const pointed = atRow(list, hot);
  const hotId = pointed !== null ? hot : atDefaultHot(list);

  // ── AN AGENT'S MENU, in @'s box: the New spark sheet's agent menu for the one agent (CH-D5 A) ──
  const menuChip = menu === null ? undefined : chips.current.get(menu.chip);
  const agentChip = menuChip?.kind === "agent" ? menuChip : undefined;
  const pickerKey = agentChip === undefined ? null : `${agentChip.agent}|${agentChip.profile.id}`;
  useEffect(() => {
    if (pickerKey === null || agentChip === undefined || models.has(pickerKey)) return;
    setModels((held) => new Map(held).set(pickerKey, { state: "reading" }));
    port.models(agentChip.agent, agentChip.profile.id).then(
      (answer) => setModels((held) => new Map(held).set(pickerKey, { state: "read", answer })),
      (error: unknown) =>
        setModels((held) =>
          new Map(held).set(pickerKey, {
            state: "failed",
            words: error instanceof Error ? error.message : String(error),
          }),
        ),
    );
  }, [agentChip, models, pickerKey, port]);
  const picker = pickerKey === null ? undefined : models.get(pickerKey);
  const selection = agentChip?.model?.selection;
  const model = modelsOf(picker).find((choice) => choice.id === selection?.modelId);
  const menuRows =
    agentChip === undefined
      ? []
      : agentMenuOf(
          [{ id: agentChip.agent, label: agentChip.label, takes: true }],
          agentChip.agent,
          picker,
          selection,
          agentChip.named ? agentChip.profile.name : undefined,
        );
  const effort = effortOf(model, selection);
  const menuStops = menuRows.flatMap((row) => (row.kind === "model" ? [menuRowId(row.id)] : []));
  const menuHot = menu?.hot ?? menuRowId(selection?.modelId ?? null);

  const atOpen = surface === "at" && (at !== null || agentChip !== undefined);
  const shownAt: AtShown | null = !atOpen
    ? null
    : agentChip !== undefined && menu !== null
      ? { kind: "menu", left: menu.left, rows: menuRows, effort, hot: menuHot }
      : at === null
        ? null
        : { kind: "rows", left: at.left, list, hot: hotId };

  // Another surface folded @'s list (the palette, a view change): the @ being typed is just text again.
  useEffect(() => {
    if (surface === "at") return;
    setAt(null);
    setMenu(null);
  }, [surface]);

  /** Redraw the editor from `next` and put the caret `caret` places in (null: leave the keyboard where it is). */
  const redraw = useCallback((next: readonly DraftPart[], caret: number | null) => {
    pendingCaret.current = caret;
    redrawing.current = true;
    setSeed(next);
    setParts(normalizeDraft(next));
    setRevision((count) => count + 1);
  }, []);
  useLayoutEffect(() => {
    redrawing.current = false;
    const editor = editorRef.current;
    const caret = pendingCaret.current;
    if (editor === null || caret === null || revision === 0) return;
    pendingCaret.current = null;
    editor.focus();
    placeCaret(editor, caret);
  }, [revision]);

  // the caret the draft last held: where a card played on the composer lands
  useEffect(() => {
    const onSelection = (): void => {
      const editor = editorRef.current;
      const selection = editor?.ownerDocument.getSelection();
      if (editor === null || editor === undefined || selection === null || selection === undefined)
        return;
      if (selection.rangeCount === 0 || !editor.contains(selection.anchorNode)) return;
      const place = caretPlace(readEditor(editor, chips.current));
      if (place !== null) caretMemo.current = place;
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, []);

  const closeAt = useCallback(() => {
    setAt(null);
    setHot(null);
    setMenu(null);
    if (surface === "at") onSurfaceChange(null);
  }, [onSurfaceChange, surface]);

  const onInput = useCallback(() => {
    const editor = editorRef.current;
    if (editor === null) return;
    const read = readEditor(editor, chips.current);
    setParts(normalizeDraft(read.parts));
    const place = caretPlace(read);
    if (place !== null) caretMemo.current = place;
    // writing folds an agent's menu; an @ typed opens @'s list in its box
    setMenu(null);
    const part = read.caret === null ? undefined : read.parts[read.caret.index];
    const typed =
      read.caret !== null && part?.kind === "text"
        ? atQueryBefore(part.text.slice(0, read.caret.offset))
        : null;
    const box = boxRef.current;
    if (typed !== null && read.caret !== null && box !== null) {
      setAt({ query: typed.query, left: atAnchor(box, editor, read.caret.offset - typed.at) });
      setHot(null);
      if (surface !== "at") {
        onSurfaceChange("at");
        setAsks((count) => count + 1);
      }
    } else if (at !== null || surface === "at") closeAt();
  }, [at, closeAt, onSurfaceChange, surface]);

  /** The @ and what was typed after it, taken out of the draft — with a chip set in its place when one is given.
   * Returns the new parts and the caret. */
  const spliceAt = useCallback((chip?: DraftChip): { parts: DraftPart[]; caret: number } | null => {
    const editor = editorRef.current;
    if (editor === null) return null;
    const read = readEditor(editor, chips.current);
    const part = read.caret === null ? undefined : read.parts[read.caret.index];
    if (read.caret === null || part?.kind !== "text") return null;
    const typed = atQueryBefore(part.text.slice(0, read.caret.offset));
    if (typed === null) return null;
    const start = caretPlace({
      parts: read.parts,
      caret: { index: read.caret.index, offset: typed.at },
    });
    return {
      parts: spliceDraft(read.parts, read.caret.index, typed.at, read.caret.offset, chip),
      caret: (start ?? 0) + (chip === undefined ? 0 : 2),
    };
  }, []);

  /** Set a chip in the sentence where the caret is, or where it last stood, else at the draft's end. */
  const placeChip = useCallback(
    (chip: DraftChip) => {
      chips.current.set(chip.id, chip);
      const editor = editorRef.current;
      const read = editor === null ? { parts, caret: null } : readEditor(editor, chips.current);
      const memo = caretMemo.current;
      const where = read.caret ?? (memo === null ? null : caretOf(read.parts, memo));
      const next = insertChipAt(read.parts, where, chip);
      redraw(next.parts, next.caret);
    },
    [parts, redraw],
  );

  /** Set a chip taken from @'s list where the @ was (the @ and its query go), else as `placeChip` does. */
  const setChip = useCallback(
    (chip: DraftChip) => {
      chips.current.set(chip.id, chip);
      const fromAt = spliceAt(chip);
      if (fromAt === null) placeChip(chip);
      else redraw(fromAt.parts, fromAt.caret);
    },
    [placeChip, redraw, spliceAt],
  );

  /** A chip in the draft changed (an agent's model or effort): the editor is drawn again with it, the caret kept. */
  const updateChip = useCallback(
    (chip: DraftChip) => {
      chips.current.set(chip.id, chip);
      const editor = editorRef.current;
      if (editor === null) return;
      const read = readEditor(editor, chips.current);
      redraw(read.parts, caretPlace(read) ?? caretMemo.current);
    },
    [redraw],
  );

  const take = useCallback(
    (row: AtRow) => {
      if (row.kind === "session") {
        setChip({
          id: nextChipId(),
          kind: "session",
          session: row.session,
          agent: row.agent,
          label: row.label,
          handle: row.handle,
          project: row.project,
        });
        closeAt();
        return;
      }
      // an agent becomes a chip, and @'s list turns into its menu, in the list's own box (CH-D5 A)
      const chip: AgentChip = {
        id: nextChipId(),
        kind: "agent",
        agent: row.agent,
        label: row.label,
        profile: row.profile,
        named: row.pill !== null,
        model: null,
      };
      const left = at?.left ?? 8;
      setChip(chip);
      setAt(null);
      setHot(null);
      setMenu({ chip: chip.id, hot: null, left });
    },
    [at, closeAt, setChip],
  );

  /** A model of the agent's menu chosen (null: Its own model): its chip says it, its Effort at the model's own. */
  const chooseModel = useCallback(
    (modelId: string | null) => {
      if (agentChip === undefined) return;
      setMenu((open) => (open === null ? open : { ...open, hot: menuRowId(modelId) }));
      if (modelId === null) {
        if (agentChip.model !== null) updateChip({ ...agentChip, model: null });
        return;
      }
      if (agentChip.model?.selection.modelId === modelId) return;
      const chosen: AgentModelSelection = { modelId };
      const choice = modelsOf(picker).find((candidate) => candidate.id === modelId);
      updateChip({ ...agentChip, model: { selection: chosen, words: modelWords(choice, chosen) } });
    },
    [agentChip, picker, updateChip],
  );

  const chooseEffort = useCallback(
    (value: string) => {
      const control = model?.controls.find((candidate) => candidate.role === "effort");
      if (agentChip === undefined || selection === undefined || control === undefined) return;
      const next: AgentModelSelection = {
        ...selection,
        controls: { ...selection.controls, [control.id]: value },
      };
      updateChip({ ...agentChip, model: { selection: next, words: modelWords(model, next) } });
    },
    [agentChip, model, selection, updateChip],
  );

  /** The agent's menu folds, its chip as it stands. */
  const foldMenu = useCallback(() => {
    setMenu(null);
    onSurfaceChange(foldSurface(surface, "at"));
  }, [onSurfaceChange, surface]);

  // ── SEND (DESIGN.md §8 "Chat's composer"): pasted into the thread's pane, Return left to the person ──
  const sendNow = useCallback(async () => {
    const sent = parts;
    if (sending.current || !draftSendable(sent, null)) return;
    sending.current = true;
    setBusy(true);
    let outcome: ThreadSendOutcome;
    try {
      outcome = await send(draftText(sent), draftStills(sent));
    } finally {
      sending.current = false;
      if (live.current) setBusy(false);
    }
    say(sendNote(outcome, name));
    if (outcome.state !== "pasted") return;
    // sent: what it carried is cleared, and what was typed or added while it ran stays; the keyboard stays in the
    // pane, where Return sends it
    const rest = draftAfterSend(sent, partsRef.current);
    // changed within what was sent, the draft stays as it stands
    if (rest === partsRef.current) return;
    chips.current = chipsOf(rest);
    if (live.current) redraw(rest, null);
    else onParkRef.current(rest);
  }, [name, parts, redraw, say, send]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.nativeEvent.isComposing) return;
      if (atOpen && shownAt?.kind === "menu") {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const index = menuStops.indexOf(menuHot);
          const next =
            event.key === "ArrowUp"
              ? Math.max(0, index - 1)
              : Math.min(menuStops.length - 1, index < 0 ? 0 : index + 1);
          const id = menuStops[next];
          if (id !== undefined) setMenu((open) => (open === null ? open : { ...open, hot: id }));
          return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          if (effort === undefined) return;
          event.preventDefault();
          const on = effort.values.findIndex((value) => value.on);
          const step = event.key === "ArrowLeft" ? -1 : 1;
          const value = effort.values[Math.min(effort.values.length - 1, Math.max(0, on + step))];
          if (value !== undefined && !value.on) chooseEffort(value.id);
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          if (menuStops.includes(menuHot)) chooseModel(menuHot === "" ? null : menuHot);
          foldMenu();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          foldMenu();
          return;
        }
      }
      if (atOpen && shownAt?.kind === "rows") {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setHot(atMove(list, hotId, event.key === "ArrowUp" ? "up" : "down"));
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          const row = atRow(list, hotId);
          if (row !== null) take(row);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeAt();
          return;
        }
      }
      if (event.key === "Enter") {
        // Return sends; ⇧Return types nothing: the draft is one line
        event.preventDefault();
        if (!event.shiftKey) void sendNow();
        return;
      }
      // CB-2: Escape gives the keyboard back to the view
      if (event.key === "Escape") event.currentTarget.blur();
    },
    [
      atOpen,
      chooseEffort,
      chooseModel,
      closeAt,
      effort,
      foldMenu,
      hotId,
      list,
      menuHot,
      menuStops,
      sendNow,
      shownAt?.kind,
      take,
    ],
  );

  /** × on a chip: it goes, and the caret stays where it was. An agent's chip pressed opens its menu again. */
  const onMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target as Element;
      const editor = editorRef.current;
      const box = boxRef.current;
      if (editor === null || box === null) return;
      const remove = target.closest?.("[data-chip-remove]")?.getAttribute("data-chip-remove");
      if (remove !== null && remove !== undefined) {
        event.preventDefault();
        const read = readEditor(editor, chips.current);
        const index = read.parts.findIndex(
          (part) => part.kind === "chip" && part.chip.id === remove,
        );
        if (index === -1) return;
        chips.current.delete(remove);
        if (menu?.chip === remove) foldMenu();
        redraw(
          normalizeDraft(read.parts.filter((_, i) => i !== index)),
          caretPlace({ parts: read.parts, caret: { index, offset: 0 } }),
        );
        return;
      }
      const pressed = target.closest?.<HTMLElement>('[data-chip="agent"]');
      const id = pressed?.dataset["chipId"];
      if (pressed === null || pressed === undefined || id === undefined) return;
      event.preventDefault();
      setAt(null);
      setHot(null);
      setMenu({ chip: id, hot: null, left: atLeftAt(box, pressed.getBoundingClientRect().left) });
      if (surface !== "at") onSurfaceChange("at");
    },
    [foldMenu, menu, onSurfaceChange, redraw, surface],
  );

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      event.preventDefault();
      const editor = editorRef.current;
      if (editor !== null)
        insertPlainText(editor, event.clipboardData.getData("text/plain"), onInput);
    },
    [onInput],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const text = event.dataTransfer.getData("text/plain");
      event.preventDefault();
      const editor = editorRef.current;
      if (text === "" || editor === null) return;
      const doc = event.currentTarget.ownerDocument;
      const range = doc.caretRangeFromPoint?.(event.clientX, event.clientY) ?? null;
      if (range !== null) {
        const selection = doc.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      insertPlainText(editor, text, onInput);
    },
    [onInput],
  );

  // ── THE HAND'S PLACE ON THE COMPOSER (DESIGN.md §8 "The hand", "Chat's composer"): a card let go on it lands as a
  // chip at the caret, or at the draft's end, carrying the whole card; it stays in the hand (HN-D4) ──
  const nameRef = useRef(name);
  nameRef.current = name;
  const playRef = useRef<(card: Card, text: string) => void>(() => undefined);
  playRef.current = (card, text) => placeChip({ id: nextChipId(), kind: "card", card, text });
  useEffect(() => {
    if (!active) return;
    return targets.register({
      id: "chat-composer",
      kind: "prompt",
      layer: TARGET_LAYER.prompt,
      rect: () => {
        const box = boxRef.current;
        // under another view's cover the thread is inert: it takes no card there
        return box === null || box.closest("[inert]") !== null ? null : box.getBoundingClientRect();
      },
      element: () => boxRef.current,
      // a card from another app says what it holds only once it is let go
      answer: (card) =>
        card.waiting !== true && paneTextOf(card) === null
          ? { ok: false, label: nothingToGive(card) }
          : { ok: true, label: TARGET_WORDS.prompt(nameRef.current) },
      play: async (card) => {
        const text = paneTextOf(card);
        if (text === null) return { ok: false, note: nothingToGive(card) };
        playRef.current(card, text);
        return { ok: true, note: OUTCOME_WORDS.added(nameRef.current) };
      },
    });
  }, [active, targets]);

  return (
    <ChatComposerView
      name={name}
      seed={seed}
      revision={revision}
      blank={draftBlank(parts)}
      armed={draftSendable(parts, at === null ? null : `@${at.query}`)}
      busy={busy}
      at={shownAt}
      boxRef={boxRef}
      editorRef={editorRef}
      editor={{
        onInput,
        onKeyDown,
        onPaste,
        onDrop,
        onMouseDown,
        onBlur: () => {
          if (atOpen && !redrawing.current) closeAt();
        },
      }}
      onSend={() => void sendNow()}
      onTake={take}
      onHot={(id) => {
        if (shownAt?.kind === "menu")
          setMenu((open) => (open === null ? open : { ...open, hot: id }));
        else setHot(id);
      }}
      onModel={chooseModel}
      onEffort={chooseEffort}
    />
  );
}
