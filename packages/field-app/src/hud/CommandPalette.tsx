import { type CanvasEngine, selectedEntities } from "@vibecook/ice";
import type { FrameView } from "@vibefield/contracts";
import { FieldGlyph, type GlyphName } from "@vibefield/design-kit/glyphs";
import {
  Fragment,
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { historyCreateWaits, useHistoryLineDoor } from "../frame/line-door";
import { type FrameActRun, frameActGroups } from "../frame/palette-acts";
import type { ViewKeys } from "../frame/views";
import { invoke as invokeCommand, isCommandBound } from "../plugin-host/command-registry";
import { usePluginRegistrySnapshot } from "../plugin-host/plugin-registry-store";
import "../frame/menu.css";
import "./CommandPalette.css";

// The ⌘K command palette (P6, spec §8.3/§13.1; re-cut for One Frame FR-3, §7 —
// DESIGN.md §8 "The head"). A solid panel under the head, over the stage, in
// every view: the frame's acts first — the views, this view's acts, the app's —
// each with its key at the row's end (FR-5: the palette is where keys are
// said), then the palette-placement commands of ENABLED plugins from the
// fieldd snapshot (P5: the snapshot is truth — no optimistic list), each under
// its plugin's name; a declared command with no live handler is drawn
// "unavailable" and never run (§8.3). Enter (or a click) runs a frame act
// through the frame's own doors, or invokes a command through the spine
// registry with a {source:"palette"} invocation carrying the current selection
// and a real user gesture (§13.1). Open and closed is the frame's one owner's
// (`frame-surface.ts`); this draws and runs.

export interface PaletteCommand {
  id: string;
  title: string;
  description?: string;
  pluginId: string;
  pluginTitle: string;
  available: boolean;
}

/** One row as the palette draws it. */
export interface PaletteRow {
  readonly id: string;
  readonly name: string;
  readonly glyph: GlyphName | null;
  /** The key, said at the row's end; null where there is none. */
  readonly key: string | null;
  /** A small line under the name: a command's description. */
  readonly sub?: string;
  /** Why it cannot run, said under its name; null when it can. */
  readonly waits: string | null;
  /** More words it answers to when typed. */
  readonly terms?: string;
}

export interface PaletteGroup {
  readonly id: string;
  readonly eyebrow: string;
  readonly rows: readonly PaletteRow[];
}

/** Controller-free production composition. What the rows are and what running
 * one does stay in CommandPalette; the catalog supplies deterministic groups
 * without maintaining a second DOM or visual recipe. */
export function CommandPaletteView({
  visible,
  query,
  groups,
  hotId,
  inputRef,
  onQueryChange,
  onInputKeyDown,
  onRun,
  onHot,
  onClose,
}: {
  visible: boolean;
  query: string;
  groups: readonly PaletteGroup[];
  /** The hot row: what Return runs. */
  hotId?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onQueryChange: (query: string) => void;
  onInputKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onRun: (rowId: string) => void;
  onHot?: (rowId: string) => void;
  onClose: () => void;
}): ReactElement {
  const empty = groups.every((group) => group.rows.length === 0);
  const listId = useId();
  const rowDomId = (id: string): string => `${listId}-${id.replace(/[^\w-]/gu, "_")}`;
  return (
    <div className="vf-palette-layer" {...(visible ? { "data-visible": "true" } : {})}>
      <div className="vf-palette-dim" onClick={onClose} aria-hidden />
      <div role="dialog" aria-label="Command palette" className="vf-menu vf-command-palette">
        <div className="vf-palette-field">
          <FieldGlyph name="search" size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Type a command or a view…"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            {...(hotId === undefined ? {} : { "aria-activedescendant": rowDomId(hotId) })}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div id={listId} className="vf-palette-list vf-no-scrollbar" role="listbox">
          {empty ? (
            <div className="vf-palette-empty">Nothing matches</div>
          ) : (
            groups.map((group) =>
              group.rows.length === 0 ? null : (
                <Fragment key={group.id}>
                  <div className="vf-menu-eye" aria-hidden>
                    {group.eyebrow}
                  </div>
                  {group.rows.map((row) => (
                    <button
                      key={row.id}
                      id={rowDomId(row.id)}
                      type="button"
                      role="option"
                      aria-selected={row.id === hotId}
                      className="vf-menu-row"
                      data-row={row.id}
                      tabIndex={-1}
                      {...(row.id === hotId ? { "data-hot": "true" } : {})}
                      {...(row.waits === null ? {} : { "aria-disabled": true })}
                      // The field keeps the keyboard while a row is pointed at.
                      onMouseDown={(event) => event.preventDefault()}
                      onPointerEnter={() => {
                        if (row.waits === null) onHot?.(row.id);
                      }}
                      onClick={() => {
                        if (row.waits === null) onRun(row.id);
                      }}
                    >
                      <span className="vf-menu-ico">
                        {row.glyph === null ? null : <FieldGlyph name={row.glyph} size={16} />}
                      </span>
                      <span className="vf-menu-label">
                        {row.name}
                        {row.waits !== null ? (
                          <small>{row.waits}</small>
                        ) : row.sub !== undefined ? (
                          <small>{row.sub}</small>
                        ) : null}
                      </span>
                      {row.key === null ? null : <kbd className="vf-menu-key">{row.key}</kbd>}
                    </button>
                  ))}
                </Fragment>
              ),
            )
          )}
        </div>
      </div>
    </div>
  );
}

/** Subsequence fuzzy score with a contiguity bonus; null = no match. */
function fuzzyScore(query: string, text: string): number | null {
  if (query === "") return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  let score = 0;
  let last = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti += 1) {
    if (t[ti] === q[qi]) {
      score += last === ti - 1 ? 2 : 1;
      last = ti;
      qi += 1;
    }
  }
  return qi === q.length ? score : null;
}

/** The rows that match `query` — by a row's name, its terms or its group's
 * name — the groups kept in their order and each group's rows ranked: those
 * that can run first, then by score (ties keep their order). */
export function filterPalette(
  groups: readonly PaletteGroup[],
  query: string,
): readonly PaletteGroup[] {
  if (query === "") return groups;
  return groups.map((group) => {
    const scored: Array<{ row: PaletteRow; score: number }> = [];
    for (const row of group.rows) {
      const score = fuzzyScore(query, `${row.name} ${row.terms ?? ""} ${group.eyebrow}`);
      if (score !== null) scored.push({ row, score });
    }
    scored.sort((a, b) =>
      (a.row.waits === null) !== (b.row.waits === null)
        ? a.row.waits === null
          ? -1
          : 1
        : b.score - a.score,
    );
    return { ...group, rows: scored.map((entry) => entry.row) };
  });
}

/** The rows Return and the arrows walk: every row that can run, in order. */
function runnable(groups: readonly PaletteGroup[]): PaletteRow[] {
  return groups.flatMap((group) => group.rows.filter((row) => row.waits === null));
}

export function CommandPalette({
  ce,
  open,
  onClose,
  windowId,
  view,
  keys,
  onAct,
}: {
  ce: CanvasEngine;
  open: boolean;
  onClose: () => void;
  windowId: string;
  /** The window's view: its acts are "On this view". */
  view: FrameView;
  keys: ViewKeys;
  /** Run one of the frame's acts — through the frame's own doors. */
  onAct: (run: FrameActRun) => void;
}): ReactElement | null {
  const snapshot = usePluginRegistrySnapshot();
  const [query, setQuery] = useState("");
  const [hot, setHot] = useState<string | null>(null);
  const [rendered, setRendered] = useState(open);
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Enter/exit choreography (M1/M4): mount on open, grow in the next frame,
  // fade out and then unmount — never a hard vanish.
  useEffect(() => {
    if (open) {
      setRendered(true);
      setQuery("");
      setHot(null);
      const id = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(id);
    }
    setVisible(false);
    const t = window.setTimeout(() => setRendered(false), 200);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (visible) inputRef.current?.focus();
  }, [visible]);

  // Esc closes, consuming the event before the desk's own Esc ladder sees it
  // (capture + stopImmediatePropagation — the old Objects sheet's precedent,
  // which the pegboard's Esc keeps since DK-13; made absolute so no co-listener
  // on window also fires).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  // The frame's acts, as this view has them — History's Resume waiting for
  // what History lends the line (AR-8c), and Jump to while the chosen session
  // runs here (P3), exactly as the line's create does.
  const historyDoor = useHistoryLineDoor();
  const historyWaits = historyCreateWaits(historyDoor);
  const historyLive = historyDoor?.live === true;
  const acts = useMemo(
    () => frameActGroups(view, keys, historyWaits, historyLive),
    [view, keys, historyWaits, historyLive],
  );

  // All palette-placement commands of enabled plugins (§8.3), each plugin's
  // under its own name. null snapshot → none (honest: fieldd has not told us
  // what exists yet), never a guess.
  const commands = useMemo<PaletteCommand[]>(() => {
    if (snapshot === null) return [];
    const out: PaletteCommand[] = [];
    for (const p of snapshot.plugins) {
      if (!p.enabled) continue;
      for (const c of p.contributions.commands) {
        if (!c.placements.includes("palette")) continue;
        out.push({
          id: c.id,
          title: c.title,
          ...(c.description !== undefined ? { description: c.description } : {}),
          pluginId: p.id,
          pluginTitle: p.title,
          available: isCommandBound(c.id),
        });
      }
    }
    return out;
  }, [snapshot]);

  const groups = useMemo<PaletteGroup[]>(() => {
    const out: PaletteGroup[] = acts.map((group) => ({
      id: group.id,
      eyebrow: group.eyebrow,
      rows: group.acts.map((act) => ({
        id: act.id,
        name: act.name,
        glyph: act.glyph,
        key: act.key,
        waits: act.waits,
        ...(act.terms === undefined ? {} : { terms: act.terms }),
      })),
    }));
    const byPlugin = new Map<string, PaletteRow[]>();
    const titles = new Map<string, string>();
    for (const command of commands) {
      const rows = byPlugin.get(command.pluginId) ?? [];
      rows.push({
        id: command.id,
        name: command.title,
        glyph: "plugin",
        key: null,
        ...(command.description !== undefined ? { sub: command.description } : {}),
        waits: command.available ? null : "unavailable",
      });
      byPlugin.set(command.pluginId, rows);
      titles.set(command.pluginId, command.pluginTitle);
    }
    for (const [pluginId, rows] of byPlugin) {
      // Available first, then by title (the old ranking, within the plugin).
      rows.sort((a, b) =>
        (a.waits === null) !== (b.waits === null)
          ? a.waits === null
            ? -1
            : 1
          : a.name.localeCompare(b.name),
      );
      out.push({ id: `plugin:${pluginId}`, eyebrow: titles.get(pluginId) ?? pluginId, rows });
    }
    return out;
  }, [acts, commands]);

  const matched = useMemo(() => filterPalette(groups, query), [groups, query]);
  const walk = useMemo(() => runnable(matched), [matched]);
  // The hot row: the one pointed at or walked to, while it still matches;
  // else the first that can run.
  const hotId = walk.some((row) => row.id === hot) ? (hot ?? undefined) : walk[0]?.id;

  const run = (rowId: string): void => {
    const act = acts.flatMap((group) => group.acts).find((entry) => entry.id === rowId);
    onClose();
    if (act !== undefined) {
      onAct(act.run);
      return;
    }
    const selection = selectedEntities(ce.world).map((e) => String(e));
    void invokeCommand(rowId, undefined, {
      source: "palette",
      windowId,
      selection,
      userGesture: true,
    });
  };

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (walk.length === 0) return;
      const at = walk.findIndex((row) => row.id === hotId);
      const next =
        e.key === "ArrowDown" ? (at + 1) % walk.length : (at - 1 + walk.length) % walk.length;
      setHot(walk[next]?.id ?? null);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hotId !== undefined) run(hotId);
    }
  };

  if (!rendered) return null;

  return (
    <CommandPaletteView
      visible={visible}
      query={query}
      groups={matched}
      {...(hotId === undefined ? {} : { hotId })}
      inputRef={inputRef}
      onQueryChange={(nextQuery) => {
        setQuery(nextQuery);
        setHot(null);
      }}
      onInputKeyDown={onInputKeyDown}
      onRun={run}
      onHot={setHot}
      onClose={onClose}
    />
  );
}
