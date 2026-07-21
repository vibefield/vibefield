import type { DocRegistryEntry } from "@vibefield/contracts";
import { type ReactElement, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { DocManagerApi } from "../doc-manager";

/**
 * The file pill (thinking-b4 §3, DESIGN.md §8): top-center chrome — new doc,
 * the editable doc name, and a chevron that morphs the pill into the docs
 * explorer. ONE morphing element (M1), the tray's exact move mirrored to the
 * top edge: 40px pill (the top-chrome control height — 64px stays the bottom
 * island's) ⇄ a top-attached sheet, 600ms island ease over top/width/height/
 * radius; the chevron rotates 180°. Sheet shadow is the §5 recipe sign-flipped
 * for a top sheet. Doc tiles wear the ground motif (canvas-bg + §2.1 CSS dots)
 * as an honest placeholder face until real thumbnails exist; the current doc
 * wears the 1.5px inside --vf-select ring — it IS the selection.
 */

const MORPH_MS = 600;
const EASE = "cubic-bezier(0.25, 1, 0.3, 1)"; // --vf-ease-island

function fmtRelative(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return new Date(ms).toLocaleDateString();
}

export interface FilePillProps {
  manager: DocManagerApi;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FilePill({ manager, open, onOpenChange }: FilePillProps): ReactElement {
  const state = useSyncExternalStore(manager.subscribe, manager.getState);
  const busy = state.phase === "loading";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Fresh registry every expand — the explorer never shows a stale catalog.
  useEffect(() => {
    if (open) void manager.refreshDocs().catch(() => {});
  }, [open, manager]);

  // Esc closes the sheet — capture phase so the canvas keymap (esc exits a
  // container) never also fires; a focused rename input keeps its own Esc.
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.target instanceof HTMLInputElement) return;
      e.stopPropagation();
      onOpenChange(false);
    };
    window.addEventListener("keydown", onEsc, true);
    return () => window.removeEventListener("keydown", onEsc, true);
  }, [open, onOpenChange]);

  const beginEdit = (): void => {
    if (busy || state.doc === null) return;
    setDraft(state.doc.name);
    setEditing(true);
  };
  const commitEdit = (): void => {
    setEditing(false);
    const name = draft.trim();
    if (name.length > 0) void manager.rename(name).catch((e) => console.warn("[file-pill]", e));
  };

  const docName = state.doc?.name ?? "…";

  return (
    <>
      {/* Dimming backdrop — click closes (Escape is the keyboard close); same tier as the tray's. */}
      <div
        className={`absolute inset-0 z-40 bg-black/10 transition-opacity duration-500 dark:bg-black/40 ${
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => onOpenChange(false)}
        aria-hidden
      />

      {/* THE morphing element: file pill ⇄ docs sheet. */}
      <div
        data-file-pill=""
        data-file-pill-open={open ? "true" : "false"}
        className={`no-drag absolute left-1/2 z-50 -translate-x-1/2 overflow-hidden border transition-all ${
          open
            ? "top-0 h-[min(46vh,420px)] w-[min(56%,34rem)] rounded-t-none rounded-b-[2.5rem] border-t-0 border-black/5 bg-white/90 shadow-[0_20px_40px_rgba(0,0,0,0.08)] backdrop-blur-3xl dark:border-white/10 dark:bg-[#1C1C1E]/90 dark:shadow-[0_20px_40px_rgba(0,0,0,0.4)]"
            : "top-4 h-10 w-[280px] rounded-full border-black/5 bg-white/80 shadow-[0_8px_30px_rgba(0,0,0,0.08)] backdrop-blur-xl hover:bg-white/90 dark:border-white/10 dark:bg-[#1C1C1E]/80 dark:shadow-[0_8px_30px_rgba(0,0,0,0.4)] dark:hover:bg-[#1C1C1E]/90"
        }`}
        style={{
          transitionDuration: `${MORPH_MS}ms`,
          transitionTimingFunction: EASE,
          willChange: "width, height, top, border-radius",
        }}
      >
        <div className="flex h-full w-full flex-col">
          {/* The persistent header row — the closed pill IS this row. */}
          <div
            className={`flex w-full shrink-0 items-center gap-1 transition-all ${
              open ? "h-12 px-4" : "h-10 px-1"
            }`}
            style={{ transitionDuration: `${MORPH_MS}ms`, transitionTimingFunction: EASE }}
          >
            <button
              type="button"
              onClick={() => void manager.createDoc()}
              disabled={busy}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-black/60 transition-all hover:bg-black/5 hover:text-black active:scale-95 disabled:pointer-events-none disabled:opacity-40 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
              title="New field"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 5v14M5 12h14"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              </svg>
            </button>

            <div className="flex min-w-0 flex-1 justify-center">
              {editing ? (
                <input
                  ref={inputRef}
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    else if (e.key === "Escape") {
                      e.stopPropagation();
                      setEditing(false); // revert — the store name stands
                    }
                  }}
                  className="w-full min-w-0 bg-transparent text-center text-[13px] font-medium text-black outline-none placeholder:text-black/30 dark:text-white dark:placeholder:text-white/30"
                  placeholder="Untitled"
                  aria-label="Field name"
                />
              ) : (
                <button
                  type="button"
                  onClick={beginEdit}
                  disabled={busy || state.doc === null}
                  className="max-w-full truncate rounded-md px-2 py-0.5 text-[13px] font-medium text-black/80 transition-colors hover:bg-black/5 hover:text-black disabled:pointer-events-none dark:text-white/80 dark:hover:bg-white/10 dark:hover:text-white"
                  title="Rename this field"
                >
                  {docName}
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => onOpenChange(!open)}
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-black/60 transition-all hover:bg-black/5 hover:text-black active:scale-95 dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white ${
                open ? "rotate-180" : "rotate-0"
              }`}
              style={{ transitionDuration: `${MORPH_MS}ms`, transitionTimingFunction: EASE }}
              title={open ? "Close (Esc)" : "Browse fields"}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M6 9l6 6 6-6"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          {/* The explorer grid — tray choreography: delayed rise-in behind the morph. */}
          <div
            className={`min-h-0 flex-1 overflow-y-auto px-6 pt-1 pb-6 no-scrollbar mask-fade-bottom transition-all duration-500 ease-out ${
              open
                ? "translate-y-0 opacity-100 delay-150"
                : "pointer-events-none translate-y-6 opacity-0"
            }`}
          >
            {state.docs.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <span className="rounded-full border border-dashed border-neutral-400/60 px-4 py-1.5 text-[13px] font-medium text-neutral-500 dark:border-neutral-500/60 dark:text-neutral-400">
                  No fields yet — ⊕ creates one
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                {state.docs.map((d: DocRegistryEntry) => {
                  const current = d.docId === state.doc?.docId;
                  return (
                    <button
                      key={d.docId}
                      type="button"
                      onClick={() => {
                        onOpenChange(false);
                        if (!current) void manager.switchTo(d.docId);
                      }}
                      className="group flex flex-col gap-1.5 text-left transition-transform duration-200 hover:scale-[1.03] active:scale-95"
                      title={current ? `${d.name} — current` : `Open ${d.name}`}
                    >
                      <div className="vf-doc-face relative aspect-[16/10] w-full rounded-[10px] border border-black/5 dark:border-white/10">
                        {current && (
                          <div
                            className="absolute inset-0 rounded-[10px]"
                            style={{ boxShadow: "inset 0 0 0 1.5px var(--vf-select)" }}
                            aria-hidden
                          />
                        )}
                      </div>
                      <div className="min-w-0 px-0.5">
                        <div className="truncate text-[12px] font-medium text-black/80 dark:text-white/80">
                          {d.name}
                        </div>
                        <div className="text-[10px] text-black/40 tabular-nums dark:text-white/40">
                          {fmtRelative(d.updatedAt)}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Component-scoped utilities (tray precedent): the doc tile's ground-motif
          face — canvas-bg + the §2.1 CSS-fallback dots, dark-aware. */}
      <style>{`
        .vf-doc-face {
          background-color: var(--vf-canvas-bg);
          background-image: radial-gradient(circle, rgba(0, 0, 0, 0.16) 1px, transparent 1px);
          background-size: 10px 10px;
        }
        .dark .vf-doc-face {
          background-image: radial-gradient(circle, rgba(255, 255, 255, 0.08) 1px, transparent 1px);
        }
      `}</style>
    </>
  );
}
