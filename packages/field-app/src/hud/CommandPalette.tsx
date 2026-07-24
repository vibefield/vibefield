import { type CanvasEngine, selectedEntities } from "@vibecook/ice";
import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { invoke as invokeCommand, isCommandBound } from "../plugin-host/command-registry";
import { usePluginRegistrySnapshot } from "../plugin-host/plugin-registry-store";

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

interface PaletteCommand {
  id: string;
  title: string;
  description?: string;
  pluginId: string;
  pluginTitle: string;
  available: boolean;
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

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
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
    <div
      className={`absolute inset-0 z-[70] flex items-start justify-center transition-opacity duration-200 ease-out ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      {/* §5 backdrop dim — click closes (aria-hidden: Esc is the keyboard close). */}
      <div
        className="absolute inset-0 bg-black/10 dark:bg-black/40"
        onClick={onClose}
        aria-hidden
      />

      {/* The palette island: §5 overlay material, §4 card radius, hairline,
          island shadow. Pop-in about its own top (M6-aware). */}
      <div
        role="dialog"
        aria-label="Command palette"
        className={`relative mt-[16vh] flex max-h-[60vh] w-[min(92%,40rem)] flex-col overflow-hidden rounded-[22px] border border-black/5 bg-white/90 shadow-[0_8px_30px_rgba(0,0,0,0.08)] backdrop-blur-xl transition-transform duration-[280ms] motion-reduce:transition-none dark:border-white/10 dark:bg-[#1C1C1E]/90 dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)] ${
          visible ? "scale-100" : "scale-95"
        }`}
        style={{ transitionTimingFunction: "var(--vf-ease-pop)" }}
      >
        {/* Search row — transparent input, magnifier at the text ramp. */}
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
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Search commands"
            className="w-full bg-transparent text-[15px] text-black outline-none placeholder:text-black/40 dark:text-white dark:placeholder:text-white/40"
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        {/* Results. */}
        <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {matched.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-black/40 dark:text-white/40">
              {commands.length === 0 ? "No commands available" : "No commands match"}
            </div>
          ) : (
            matched.map((cmd) => {
              const activeId = availableIds[clampedActive];
              const isActive = cmd.available && cmd.id === activeId;
              return (
                <button
                  key={cmd.id}
                  type="button"
                  disabled={!cmd.available}
                  onClick={() => cmd.available && run(cmd.id)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors duration-150 ${
                    cmd.available
                      ? isActive
                        ? "bg-black/5 dark:bg-white/10"
                        : "hover:bg-black/5 dark:hover:bg-white/10"
                      : "cursor-default opacity-40"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-black dark:text-white">
                      {cmd.title}
                    </div>
                    {cmd.description !== undefined && (
                      <div className="truncate text-[12px] text-black/50 dark:text-white/50">
                        {cmd.description}
                      </div>
                    )}
                  </div>
                  {cmd.available ? (
                    <span className="shrink-0 text-[11px] font-medium text-black/40 dark:text-white/40">
                      {cmd.pluginTitle}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[11px] font-medium text-black/40 dark:text-white/40">
                      unavailable
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer hint — quiet caption (§3 caption ramp). */}
        <div className="flex items-center gap-4 border-t border-black/5 px-4 py-2 text-[11px] text-black/40 dark:border-white/10 dark:text-white/40">
          <span>↵ to run</span>
          <span>esc to close</span>
        </div>
      </div>
    </div>
  );
}
