import type { FrameView } from "@vibefield/contracts";
import {
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type MutableRefObject,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { emitLineKeyMarker } from "../development-console";
import { isNewTerminalChord, listenForProductChord } from "../field/product-chords";
import { type FieldHost, getHost } from "../host";
import {
  type ClipboardStore,
  clipboardStore,
  useClipboardItems,
} from "../hud/edge-tray/clipboard-store";
import {
  type AtMini,
  type AtRow,
  atDefaultHot,
  atList,
  atMove,
  atRow,
  atTakeable,
} from "./at-list";
import { AtMenuView, ComposerLineView, type LineNote } from "./ComposerLine";
import {
  atQueryBefore,
  type DraftChip,
  type DraftPart,
  draftBlank,
  draftMessage,
  draftSendable,
  type LineAim,
  normalizeDraft,
  type SendOutcome,
  sendNote,
  spliceDraft,
} from "./draft";
import type { FrameSurface } from "./frame-surface";
import {
  type HistoryLineDoor,
  type LineViewDoor,
  newTerminalNote,
  resumeNote,
  resumeWaits,
  useGodviewLineDoor,
  useHistoryLineDoor,
} from "./line-door";
import type { ViewKeys } from "./views";

// THE LINE'S CONTROLLER (DESIGN.md §8 "The line", §10; One Frame FR-2). It owns
// what the line does — the draft and its chips, @'s list and its hot row, the
// aim, the interim send, the view's create and its key — and nothing the line
// shows, which is `ComposerLineView`'s. Which of the frame's surfaces is open
// is NOT its own: that has one owner (FieldView, `frame-surface.ts`), and this
// asks it.
//
// The draft is an editor (D1: chips inline in the sentence), so while a person
// types the editor's DOM is the truth: every input is read back into parts,
// and the controller writes parts back only when it changes the draft itself —
// a chip landing, an @ taken, a send — by handing the view a new seed and a
// new revision, after which the caret is put where the change leaves it.

/** How long the line's note speaks (DESIGN.md §8). */
const NOTE_MS = 2_400;

/** What a host lends the line: the capture door and the still scheme. */
export type ComposerHost = Pick<FieldHost, "screenshotCapture" | "screenshotStillUrl">;

/** What the line lends the palette (One Frame FR-3): its create, so the
 * palette's row for the view's act runs the line's own — Objects on Canvas,
 * New terminal in Godview, with the line's note saying what came of it. */
export interface LineActs {
  create(): void;
}

export interface ComposerProps {
  /** The window's view. */
  view: FrameView;
  keys: ViewKeys;
  /** The views track, drawn by the frame's controller: the line's left end. */
  track: ReactNode;
  /** The frame's open surface, from its one owner. */
  surface: FrameSurface | null;
  onSurfaceChange: (next: FrameSurface | null) => void;
  /** Where the line lends its acts (the palette's door); left out, it lends none. */
  actsRef?: MutableRefObject<LineActs | null>;
  /** Adapters — the catalog's fixtures; the product takes the defaults. What
   * Godview lends the line (undefined: the deck's published door). */
  godview?: LineViewDoor | null;
  /** What History lends the line (undefined: History's published door). */
  history?: HistoryLineDoor | null;
  clipboard?: ClipboardStore;
  host?: ComposerHost;
  writeClipboard?: (text: string) => Promise<void>;
  /** Whether the line binds its window keys (B, ⌘T). The catalog's live line
   * does not: its page is not a window the line owns. */
  bindKeys?: boolean;
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable ||
    target.closest("[contenteditable='true']") !== null
  );
}

function defaultWriteClipboard(text: string): Promise<void> {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard === undefined) return Promise.reject(new Error("no clipboard"));
  return clipboard.writeText(text);
}

/** The editor's DOM read as parts (adjacent text joined), and the caret in
 * them when it is collapsed in a run of text. */
export function readEditor(
  editor: HTMLElement,
  chips: ReadonlyMap<string, DraftChip>,
): { parts: DraftPart[]; caret: { index: number; offset: number } | null } {
  const parts: DraftPart[] = [];
  let caret: { index: number; offset: number } | null = null;
  const selection = editor.ownerDocument.getSelection();
  const anchor =
    selection !== null && selection.rangeCount > 0 && selection.isCollapsed
      ? selection.anchorNode
      : null;
  const anchorOffset = selection?.anchorOffset ?? 0;
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node as Text).data;
      const last = parts[parts.length - 1];
      const base = last?.kind === "text" ? last.text.length : 0;
      if (last?.kind === "text") parts[parts.length - 1] = { kind: "text", text: last.text + text };
      else parts.push({ kind: "text", text });
      if (node === anchor) caret = { index: parts.length - 1, offset: base + anchorOffset };
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const id = node.dataset["chipId"];
    if (id !== undefined) {
      const chip = chips.get(id);
      if (chip !== undefined) parts.push({ kind: "chip", chip });
      return;
    }
    if (node.tagName === "BR") return;
    node.childNodes.forEach(visit);
  };
  editor.childNodes.forEach(visit);
  return { parts, caret };
}

/** Where a place in the draft is, counted the way the caret moves: one per
 * character, one per chip. */
function linearOffset(parts: readonly DraftPart[], index: number, offset: number): number {
  let at = 0;
  for (let i = 0; i < index; i++) {
    const part = parts[i];
    at += part === undefined ? 0 : part.kind === "text" ? part.text.length : 1;
  }
  return at + offset;
}

/** Put the caret `linear` places into the editor (see `linearOffset`). */
function placeCaret(editor: HTMLElement, linear: number): void {
  const selection = editor.ownerDocument.getSelection();
  if (selection === null) return;
  const range = editor.ownerDocument.createRange();
  let left = linear;
  let placed = false;
  for (const node of Array.from(editor.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = (node as Text).data.length;
      if (left <= length) {
        range.setStart(node, left);
        placed = true;
        break;
      }
      left -= length;
    } else if (node instanceof HTMLElement && node.dataset["chipId"] !== undefined) {
      if (left === 0) {
        range.setStartBefore(node);
        placed = true;
        break;
      }
      left -= 1;
      if (left === 0 && node.nextSibling === null) {
        range.setStartAfter(node);
        placed = true;
        break;
      }
    }
  }
  if (!placed) {
    range.selectNodeContents(editor);
    range.collapse(false);
  } else range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** The caret is before everything in the editor. */
function caretAtStart(editor: HTMLElement, chips: ReadonlyMap<string, DraftChip>): boolean {
  const { parts, caret } = readEditor(editor, chips);
  if (caret === null) return parts.length === 0;
  return linearOffset(parts, caret.index, caret.offset) === 0;
}

let chipSeq = 0;

export function Composer({
  view,
  keys,
  track,
  surface,
  onSurfaceChange,
  actsRef,
  godview,
  history,
  clipboard = clipboardStore,
  host: hostProp,
  writeClipboard = defaultWriteClipboard,
  bindKeys = true,
}: ComposerProps): ReactElement {
  const published = useGodviewLineDoor();
  const door = godview === undefined ? published : godview;
  const publishedHistory = useHistoryLineDoor();
  const historyDoor = history === undefined ? publishedHistory : history;
  const host = hostProp ?? getHost();
  const lineRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const chips = useRef(new Map<string, DraftChip>());
  const pendingCaret = useRef<number | null>(null);
  const [aim, setAim] = useState<LineAim | null>(null);
  const [seed, setSeed] = useState<readonly DraftPart[]>([]);
  const [revision, setRevision] = useState(0);
  const [parts, setParts] = useState<readonly DraftPart[]>([]);
  const [at, setAt] = useState<{ query: string; left: number } | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [note, setNote] = useState<LineNote | null>(null);
  const notes = useRef(0);

  const items = useClipboardItems(clipboard);
  const minis = useMemo<AtMini[]>(
    () =>
      items.map((item) => ({
        id: item.id,
        label: `${item.width} × ${item.height}`,
        path: item.path,
        url: host.screenshotStillUrl?.(item.path) ?? null,
      })),
    [items, host],
  );
  const atOpen = surface === "at" && at !== null;
  const list = useMemo(
    () =>
      atList({
        view,
        panes: door?.panes ?? [],
        clipboard: minis,
        canCapture: host.screenshotCapture !== undefined,
        query: at?.query ?? "",
      }),
    [view, door, minis, host, at],
  );
  const pointed = atRow(list, hot);
  const hotId = pointed !== null && atTakeable(pointed) ? hot : atDefaultHot(list);

  const say = useCallback((text: string, where: LineNote["at"]) => {
    notes.current += 1;
    setNote({ seq: notes.current, text, at: where });
  }, []);
  useEffect(() => {
    if (note === null) return;
    const timer = window.setTimeout(() => setNote(null), NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [note]);

  /** Redraw the editor from `next` and put the caret `caret` places in. */
  const redraw = useCallback((next: readonly DraftPart[], caret: number | null) => {
    pendingCaret.current = caret;
    setSeed(next);
    setParts(normalizeDraft(next));
    setRevision((count) => count + 1);
  }, []);
  useLayoutEffect(() => {
    const editor = editorRef.current;
    const caret = pendingCaret.current;
    if (editor === null || caret === null || revision === 0) return;
    pendingCaret.current = null;
    editor.focus();
    placeCaret(editor, caret);
  }, [revision]);

  const closeAt = useCallback(() => {
    setAt(null);
    setHot(null);
    if (surface === "at") onSurfaceChange(null);
  }, [onSurfaceChange, surface]);

  // A view change is a change of place: whatever the frame had open folds —
  // the line's surfaces and, since the owner holds them too, the head's.
  const shownView = useRef(view);
  useEffect(() => {
    if (shownView.current === view) return;
    shownView.current = view;
    setAt(null);
    if (surface !== null) onSurfaceChange(null);
  }, [view, surface, onSurfaceChange]);

  // Another surface folded @'s list (Objects, Settings, the head's): the @
  // being typed is just text again.
  useEffect(() => {
    if (surface !== "at") setAt(null);
  }, [surface]);

  /** The @ being typed and where the list grows from: 10 before the @, in the
   * px of the box the line stands in, kept on the window. */
  const atAnchor = useCallback((editor: HTMLElement, back: number): number => {
    const line = lineRef.current;
    const box = (line?.offsetParent ?? line?.parentElement) as HTMLElement | null;
    if (line === null || box === null) return 0;
    const boxRect = box.getBoundingClientRect();
    let x = editor.getBoundingClientRect().left;
    const selection = editor.ownerDocument.getSelection();
    const node = selection?.anchorNode;
    if (node?.nodeType === Node.TEXT_NODE && selection !== null) {
      const range = editor.ownerDocument.createRange();
      range.setStart(node, Math.max(0, selection.anchorOffset - back));
      range.collapse(true);
      const rect =
        typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
      if (rect !== null && (rect.left !== 0 || rect.width !== 0)) x = rect.left;
    }
    const room = Math.max(8, boxRect.width - 316 - 8);
    return Math.min(room, Math.max(8, Math.round(x - boxRect.left - 10)));
  }, []);

  const onInput = useCallback(() => {
    const editor = editorRef.current;
    if (editor === null) return;
    const read = readEditor(editor, chips.current);
    setParts(normalizeDraft(read.parts));
    const part = read.caret === null ? undefined : read.parts[read.caret.index];
    const typed =
      read.caret !== null && part?.kind === "text"
        ? atQueryBefore(part.text.slice(0, read.caret.offset))
        : null;
    if (typed !== null && read.caret !== null) {
      setAt({ query: typed.query, left: atAnchor(editor, read.caret.offset - typed.at) });
      setHot(null);
      if (surface !== "at") onSurfaceChange("at");
    } else if (at !== null || surface === "at") closeAt();
  }, [at, atAnchor, closeAt, onSurfaceChange, surface]);

  /** The @ and what was typed after it, taken out of the draft — with a chip
   * set in its place when one is given. Returns the new parts and the caret. */
  const spliceAt = useCallback((chip?: DraftChip): { parts: DraftPart[]; caret: number } | null => {
    const editor = editorRef.current;
    if (editor === null) return null;
    const read = readEditor(editor, chips.current);
    const part = read.caret === null ? undefined : read.parts[read.caret.index];
    if (read.caret === null || part?.kind !== "text") return null;
    const typed = atQueryBefore(part.text.slice(0, read.caret.offset));
    if (typed === null) return null;
    const start = linearOffset(read.parts, read.caret.index, typed.at);
    return {
      parts: spliceDraft(read.parts, read.caret.index, typed.at, read.caret.offset, chip),
      caret: start + (chip === undefined ? 0 : 2),
    };
  }, []);

  /** Set a chip in the sentence: where the @ was, else where the caret is,
   * else at the end. */
  const setChip = useCallback(
    (chip: DraftChip) => {
      chips.current.set(chip.id, chip);
      const editor = editorRef.current;
      const fromAt = spliceAt(chip);
      if (fromAt !== null) {
        redraw(fromAt.parts, fromAt.caret);
        return;
      }
      const read = editor === null ? { parts: [], caret: null } : readEditor(editor, chips.current);
      const index = read.caret?.index ?? read.parts.length;
      const target = read.parts[index];
      const base =
        target?.kind === "text" ? read.parts : [...read.parts, { kind: "text", text: "" } as const];
      const offset = read.caret?.offset ?? 0;
      const next = spliceDraft(base, index, offset, offset, chip);
      redraw(next, linearOffset(base, index, offset) + 2);
    },
    [redraw, spliceAt],
  );

  const captureChip = useCallback((mini: AtMini): DraftChip => {
    chipSeq += 1;
    return { id: `chip-${chipSeq}`, kind: "capture", label: mini.label, path: mini.path };
  }, []);

  const take = useCallback(
    (row: AtRow, mini?: string) => {
      if (!atTakeable(row)) return;
      if (row.kind === "send") {
        setAim({ sessionId: row.sessionId, name: row.name });
        const cut = spliceAt();
        if (cut !== null) redraw(cut.parts, cut.caret);
        closeAt();
        return;
      }
      if (row.kind === "clip") {
        const chosen = row.minis.find((entry) => entry.id === mini) ?? row.minis[0];
        if (chosen !== undefined) setChip(captureChip(chosen));
        closeAt();
        return;
      }
      if (row.id === "capture") {
        const cut = spliceAt();
        if (cut !== null) redraw(cut.parts, cut.caret);
        closeAt();
        const door = host.screenshotCapture;
        if (door === undefined) return;
        void door().then(
          (result) => {
            if (result.status === "ok") {
              const item = clipboard.addCapture(result);
              setChip(
                captureChip({
                  id: item.id,
                  label: `${item.width} × ${item.height}`,
                  path: item.path,
                  url: null,
                }),
              );
            } else if (result.status === "error") say(`Not captured — ${result.message}`, "send");
          },
          (cause: unknown) =>
            say(`Not captured — ${cause instanceof Error ? cause.message : String(cause)}`, "send"),
        );
      }
    },
    [captureChip, clipboard, closeAt, host, redraw, say, setChip, spliceAt],
  );

  const send = useCallback(async () => {
    const text = draftMessage(parts);
    if (text === "") return;
    const pane =
      aim === null ? undefined : door?.panes.find((entry) => entry.sessionId === aim.sessionId);
    let outcome: SendOutcome;
    if (
      aim !== null &&
      pane !== undefined &&
      door?.onScreen === true &&
      door.paste(aim.sessionId, text)
    ) {
      outcome = { kind: "pasted", name: aim.name };
    } else {
      try {
        await writeClipboard(text);
        outcome =
          aim !== null && pane !== undefined
            ? { kind: "copied-off-screen", name: aim.name }
            : { kind: "copied" };
      } catch {
        outcome = { kind: "copy-refused" };
      }
    }
    say(sendNote(outcome), "send");
    if (outcome.kind === "copy-refused") return;
    chips.current.clear();
    // A paste hands the keyboard to the pane, where Return sends it.
    redraw([], outcome.kind === "pasted" ? null : 0);
  }, [aim, door, parts, redraw, say, writeClipboard]);

  const newTerminal = useCallback(async () => {
    if (door === null) {
      say(newTerminalNote({ state: "refused", reason: "the deck is not connected yet" }), "create");
      return;
    }
    say(newTerminalNote(await door.newTerminal()), "create");
  }, [door, say]);

  // History's create is Resume (AR-8c): the chosen session, continued in its
  // own agent; the note says what came of it — in History, or in Godview once
  // the frame has moved there to show the pane.
  const resume = useCallback(async () => {
    const waits = resumeWaits(historyDoor);
    if (historyDoor === null || waits !== null) {
      say(resumeNote({ state: "refused", reason: waits ?? "choose a session first" }), "create");
      return;
    }
    say(resumeNote(await historyDoor.resume()), "create");
  }, [historyDoor, say]);

  const create = useCallback(() => {
    if (view === "canvas") onSurfaceChange(surface === "objects" ? null : "objects");
    else if (view === "godview") void newTerminal();
    else if (view === "history") void resume();
  }, [newTerminal, onSurfaceChange, resume, surface, view]);

  // The palette runs the view's act through the line (One Frame FR-3), so the
  // two doors to one act are one implementation and speak with one note.
  useLayoutEffect(() => {
    if (actsRef === undefined) return;
    actsRef.current = { create };
    return () => {
      actsRef.current = null;
    };
  }, [actsRef, create]);

  // B — Objects, on Canvas only, never while typing (DESIGN.md §10). Heard on
  // the window's bubble phase, so a focused pane, a note being typed in or
  // the draft itself keeps its own b.
  useEffect(() => {
    if (!bindKeys) return;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "b" && event.key !== "B") return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (view !== "canvas" || isEditable(event.target)) return;
      const next = surface === "objects" ? null : "objects";
      onSurfaceChange(next);
      emitLineKeyMarker({ key: "B", view, outcome: next === null ? "closed" : "opened" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bindKeys, onSurfaceChange, surface, view]);

  // ⌘T — Godview's New terminal: a product chord on the capture phase, so a
  // focused pane never sees it (ghostty's new_tab). Only in Godview: it is
  // Godview's create's key, as B is Canvas's.
  useEffect(
    () =>
      listenForProductChord(
        (event) => bindKeys && view === "godview" && isNewTerminalChord(event, keys),
        (event) => {
          if (event.repeat) return;
          emitLineKeyMarker({
            key: keys === "mac" ? "⌘T" : "Ctrl+T",
            view,
            outcome: "new-terminal",
          });
          void newTerminal();
        },
      ),
    [bindKeys, keys, newTerminal, view],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.nativeEvent.isComposing) return;
      if (atOpen) {
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
        event.preventDefault();
        if (!event.shiftKey) void send();
        return;
      }
      if (event.key === "Escape") {
        // CB-2: Escape gives the keyboard back to the view.
        event.currentTarget.blur();
        return;
      }
      if (
        event.key === "Backspace" &&
        aim !== null &&
        caretAtStart(event.currentTarget, chips.current)
      ) {
        event.preventDefault();
        setAim(null);
      }
    },
    [aim, atOpen, closeAt, hotId, list, send, take],
  );

  /** Plain text at the caret — a paste or a drop, never markup (DESIGN.md §8). */
  const insertText = useCallback(
    (text: string) => {
      const flat = text.replace(/\s*[\r\n]+\s*/gu, " ");
      if (flat === "") return;
      const doc = editorRef.current?.ownerDocument;
      if (
        doc !== undefined &&
        typeof doc.execCommand === "function" &&
        doc.execCommand("insertText", false, flat)
      )
        return;
      const selection = doc?.getSelection();
      if (selection === null || selection === undefined || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(doc!.createTextNode(flat));
      range.collapse(false);
      onInput();
    },
    [onInput],
  );

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      event.preventDefault();
      insertText(event.clipboardData.getData("text/plain"));
    },
    [insertText],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const text = event.dataTransfer.getData("text/plain");
      event.preventDefault();
      if (text === "") return;
      const doc = event.currentTarget.ownerDocument;
      const range = doc.caretRangeFromPoint?.(event.clientX, event.clientY) ?? null;
      if (range !== null) {
        const selection = doc.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      insertText(text);
    },
    [insertText],
  );

  /** × on a chip in the sentence: it goes, and the caret stays where it was. */
  const onMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const id = (event.target as Element)
        .closest?.("[data-chip-remove]")
        ?.getAttribute("data-chip-remove");
      if (id === null || id === undefined) return;
      event.preventDefault();
      const editor = editorRef.current;
      if (editor === null) return;
      const read = readEditor(editor, chips.current);
      const index = read.parts.findIndex((part) => part.kind === "chip" && part.chip.id === id);
      if (index === -1) return;
      chips.current.delete(id);
      redraw(
        normalizeDraft(read.parts.filter((_, i) => i !== index)),
        linearOffset(read.parts, index, 0),
      );
    },
    [redraw],
  );

  const createWaits =
    view === "history"
      ? resumeWaits(historyDoor)
      : view === "godview" && door === null
        ? "the deck is not connected yet"
        : null;

  return (
    <>
      <ComposerLineView
        view={view}
        keys={keys}
        track={track}
        objectsOpen={surface === "objects"}
        createWaits={createWaits}
        aim={aim}
        seed={seed}
        revision={revision}
        blank={draftBlank(parts)}
        canSend={draftSendable(parts, atOpen && at !== null ? `@${at.query}` : null)}
        note={note}
        atOpen={atOpen}
        lineRef={lineRef}
        editorRef={editorRef}
        editor={{
          onInput,
          onKeyDown,
          onPaste,
          onDrop,
          onMouseDown,
          onBlur: () => {
            if (atOpen) closeAt();
          },
        }}
        onCreate={create}
        onSend={() => void send()}
        onRemoveAim={() => setAim(null)}
      />
      {atOpen && at !== null ? (
        <AtMenuView list={list} hot={hotId} left={at.left} onHot={setHot} onTake={take} />
      ) : null}
    </>
  );
}
