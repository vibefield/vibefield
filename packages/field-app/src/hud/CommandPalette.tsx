import { type CanvasEngine, selectedEntities } from "@vibecook/ice";
import {
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke as invokeCommand, isCommandBound } from "../plugin-host/command-registry";
import { usePluginRegistrySnapshot } from "../plugin-host/plugin-registry-store";
import "./CommandPalette.css";

// The ⌘K command palette (P6, spec §8.3/§13.1). Lists the palette-placement
// commands of ENABLED plugins from the fieldd snapshot (P5: the snapshot is
// truth — no optimistic list); a declared command with no live handler renders
// as an UNAVAILABLE row (§8.3 "visible as unavailable when useful"). Enter (or a
// click) invokes through the spine command registry with a {source:"palette"}
// invocation carrying the current selection and a real user gesture (§13.1).
//
// DESIGN.md governs every pixel: §5 overlay material (surface/90 + backdrop
// blur, hairline, island shadow) over the §5 backdrop dim; §3 type ramp; §6
// named easings (pop-in, reduced-motion aware — M6); §9 voice (sentence case,
// honest states). The palette is chrome: near-colorless, the drama stays on the
// field.

export interface PaletteCommand {
  id: string;
  title: string;
  description?: string;
  pluginId: string;
  pluginTitle: string;
  available: boolean;
}

/** Controller-free production composition. Runtime discovery and command
 * invocation stay in CommandPalette; the catalog can supply deterministic
 * commands without maintaining a second DOM or visual recipe. */
export function CommandPaletteView({
  visible,
  query,
  commands,
  matched,
  activeId,
  inputRef,
  onQueryChange,
  onInputKeyDown,
  onRun,
  onClose,
}: {
  visible: boolean;
  query: string;
  commands: readonly PaletteCommand[];
  matched: readonly PaletteCommand[];
  activeId?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  onQueryChange: (query: string) => void;
  onInputKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onRun: (commandId: string) => void;
  onClose: () => void;
}): ReactElement {
  return (
    <div
      className={`absolute inset-0 z-[70] flex items-start justify-center transition-opacity duration-200 ease-out ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="vf-ui-backdrop absolute inset-0" onClick={onClose} aria-hidden />

      <div
        role="dialog"
        aria-label="Command palette"
        className={`vf-command-palette relative mt-[16vh] flex max-h-[60vh] w-[min(92%,40rem)] flex-col overflow-hidden ${
          visible ? "scale-100" : "scale-95"
        }`}
      >
        <div className="flex items-center gap-3 border-b border-black/5 px-4 py-3.5 dark:border-white/10">
          <svg
            aria-hidden="true"
            className="h-4 w-4 shrink-0 text-black/40 dark:text-white/40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.2-3.2" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search commands"
            className="w-full bg-transparent text-[15px] text-black outline-none placeholder:text-black/40 dark:text-white dark:placeholder:text-white/40"
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {matched.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-black/40 dark:text-white/40">
              {commands.length === 0 ? "No commands available" : "No commands match"}
            </div>
          ) : (
            matched.map((command) => {
              const isActive = command.available && command.id === activeId;
              return (
                <button
                  key={command.id}
                  type="button"
                  disabled={!command.available}
                  onClick={() => command.available && onRun(command.id)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 ${
                    command.available
                      ? isActive
                        ? "bg-black/5 dark:bg-white/10"
                        : "hover:bg-black/5 dark:hover:bg-white/10"
                      : "cursor-default opacity-40"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-black dark:text-white">
                      {command.title}
                    </div>
                    {command.description !== undefined && (
                      <div className="truncate text-[12px] text-black/50 dark:text-white/50">
                        {command.description}
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 text-[11px] font-medium text-black/40 dark:text-white/40">
                    {command.available ? command.pluginTitle : "unavailable"}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-black/5 px-4 py-2 text-[11px] text-black/40 dark:border-white/10 dark:text-white/40">
          <span>↵ to run</span>
          <span>esc to close</span>
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

export function CommandPalette({
  ce,
  open,
  onClose,
  windowId,
}: {
  ce: CanvasEngine;
  open: boolean;
  onClose: () => void;
  windowId: string;
}): ReactElement | null {
  const snapshot = usePluginRegistrySnapshot();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [rendered, setRendered] = useState(open);
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Enter/exit choreography (M1/M4): mount on open, fade+pop in next frame,
  // fade out then unmount after the transition — never a hard vanish.
  useEffect(() => {
    if (open) {
      setRendered(true);
      setQuery("");
      setActiveIndex(0);
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

  // Esc closes, consuming the event before the tray/exit-container handlers see
  // it (capture + stopImmediatePropagation — the WidgetTray Esc precedent, made
  // absolute so no co-listener on window also fires).
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

  // All palette-placement commands of enabled plugins (§8.3). null snapshot →
  // empty (honest: fieldd has not told us what exists yet), never a guess.
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

  // Filter + rank: available first (by score, then title), unavailable after.
  const matched = useMemo(() => {
    const scored: Array<{ cmd: PaletteCommand; score: number }> = [];
    for (const cmd of commands) {
      const score = fuzzyScore(query, `${cmd.title} ${cmd.pluginTitle}`);
      if (score !== null) scored.push({ cmd, score });
    }
    scored.sort((a, b) => {
      if (a.cmd.available !== b.cmd.available) return a.cmd.available ? -1 : 1;
      if (a.score !== b.score) return b.score - a.score;
      return a.cmd.title.localeCompare(b.cmd.title);
    });
    return scored.map((s) => s.cmd);
  }, [commands, query]);

  // Keyboard nav rides the AVAILABLE subset only (§8.3: unavailable rows are
  // shown for diagnosis, not run).
  const availableIds = useMemo(
    () => matched.filter((c) => c.available).map((c) => c.id),
    [matched],
  );
  const clampedActive =
    availableIds.length === 0 ? -1 : Math.min(activeIndex, availableIds.length - 1);

  const run = (commandId: string): void => {
    const selection = selectedEntities(ce.world).map((e) => String(e));
    void invokeCommand(commandId, undefined, {
      source: "palette",
      windowId,
      selection,
      userGesture: true,
    });
    onClose();
  };

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (availableIds.length === 0 ? 0 : (i + 1) % availableIds.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) =>
        availableIds.length === 0 ? 0 : (i - 1 + availableIds.length) % availableIds.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const id = availableIds[clampedActive];
      if (id !== undefined) run(id);
    }
  };

  if (!rendered) return null;

  return (
    <CommandPaletteView
      visible={visible}
      query={query}
      commands={commands}
      matched={matched}
      {...(availableIds[clampedActive] === undefined
        ? {}
        : { activeId: availableIds[clampedActive] })}
      inputRef={inputRef}
      onQueryChange={(nextQuery) => {
        setQuery(nextQuery);
        setActiveIndex(0);
      }}
      onInputKeyDown={onInputKeyDown}
      onRun={run}
      onClose={onClose}
    />
  );
}
