import type { ReactElement, ReactNode, RefObject } from "react";
import { labelCls } from "./settings-ui";

export type SettingsPage =
  | "account"
  | "general"
  | "appearance"
  | "canvas"
  | "plugins"
  | "mesh"
  | "terminal"
  | "diagnostics"
  | "advanced";

interface PageMeta {
  id: SettingsPage;
  label: string;
  description: string;
  icon: "person" | "sliders" | "sun" | "canvas" | "plugin" | "mesh" | "terminal" | "pulse" | "code";
}

const PAGES: readonly PageMeta[] = [
  {
    id: "account",
    label: "Account",
    description: "Who this field belongs to, and the devices it reaches.",
    icon: "person",
  },
  {
    id: "general",
    label: "General",
    description: "Desktop behavior and synced preference history.",
    icon: "sliders",
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "The color mode used by app chrome and cards.",
    icon: "sun",
  },
  {
    id: "canvas",
    label: "Canvas",
    description: "Navigation, snapping, and live card behavior.",
    icon: "canvas",
  },
  {
    id: "plugins",
    label: "Plugins",
    description: "Installed extensions and their preferences.",
    icon: "plugin",
  },
  {
    id: "mesh",
    label: "Mesh",
    description: "Connected devices and document synchronization.",
    icon: "mesh",
  },
  {
    id: "terminal",
    label: "Terminal",
    description: "Configuration every terminal on this device loads.",
    icon: "terminal",
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    description: "System health, logs, and support tooling.",
    icon: "pulse",
  },
  {
    id: "advanced",
    label: "Advanced",
    description: "Developer previews and canvas stress tools.",
    icon: "code",
  },
] as const;

const NAV_GROUPS: ReadonlyArray<{ label: string; pages: readonly SettingsPage[] }> = [
  { label: "Account", pages: ["account"] },
  { label: "Preferences", pages: ["general", "appearance", "canvas"] },
  { label: "Workspace", pages: ["plugins", "mesh", "terminal"] },
  { label: "Support", pages: ["diagnostics", "advanced"] },
];

const PAGE_BY_ID = new Map(PAGES.map((page) => [page.id, page]));

function PageIcon({ name }: { name: PageMeta["icon"] }): ReactElement {
  if (name === "person") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="6.8" r="3.3" />
        <path d="M3.8 16.8a6.2 6.2 0 0 1 12.4 0" />
      </svg>
    );
  }
  if (name === "sliders") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M4 5h12M4 10h12M4 15h12M7 3v4M13 8v4M9 13v4" />
      </svg>
    );
  }
  if (name === "sun") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="3.1" />
        <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />
      </svg>
    );
  }
  if (name === "canvas") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="3" y="3" width="14" height="14" rx="2.5" />
        <path d="M7 3v14M13 3v14M3 7h14M3 13h14" />
      </svg>
    );
  }
  if (name === "plugin") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M8 3h4v3a2 2 0 1 0 0 4v7H8v-3a2 2 0 1 0-4 0v-4h3a2 2 0 1 0 0-4H4V3h4Z" />
      </svg>
    );
  }
  if (name === "mesh") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="5" cy="5" r="2" />
        <circle cx="15" cy="6" r="2" />
        <circle cx="10" cy="15" r="2" />
        <path d="m6.8 5.4 6.2.4M6.2 6.8l2.7 6.3M13.9 7.7l-2.8 5.5" />
      </svg>
    );
  }
  if (name === "terminal") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="2.5" y="4" width="15" height="12" rx="2.5" />
        <path d="m6 8.5 2.5 2L6 13M10.5 13h3.5" />
      </svg>
    );
  }
  if (name === "pulse") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M2.5 10h3l1.6-4.5 3.2 9 2.2-6 1.3 1.5h3.7" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m7 5-4 5 4 5M13 5l4 5-4 5M11.5 3.5l-3 13" />
    </svg>
  );
}

function HistoryIcon({ direction }: { direction: "undo" | "redo" }): ReactElement {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={direction === "redo" ? "scale-x-[-1]" : undefined}
    >
      <path d="M7.2 5.2 3.5 8.8l3.7 3.7M4 8.8h6.3a5.2 5.2 0 0 1 5.2 5.2v.5" />
    </svg>
  );
}

/** Controller-free settings composition shared by the modal and catalog. */
export function SettingsDialog({
  activePage,
  onSelectPage,
  onClose,
  onUndo,
  onRedo,
  historyBusy,
  undoAvailable,
  redoAvailable,
  historyNote = null,
  dialogRef,
  className = "",
  children,
}: {
  activePage: SettingsPage;
  onSelectPage: (page: SettingsPage) => void;
  onClose: () => void;
  onUndo: () => void;
  onRedo: () => void;
  historyBusy: boolean;
  undoAvailable: boolean;
  redoAvailable: boolean;
  historyNote?: string | null;
  dialogRef?: RefObject<HTMLDivElement | null>;
  className?: string;
  children: ReactNode;
}): ReactElement {
  const currentPage = PAGE_BY_ID.get(activePage) ?? PAGES[0]!;
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="vf-settings-title"
      tabIndex={-1}
      data-settings-page={activePage}
      className={`vf-settings-dialog grid h-[min(84vh,760px)] min-h-[540px] w-[min(94vw,1080px)] grid-cols-[224px_minmax(0,1fr)] overflow-hidden rounded-[22px] outline-none ${className}`.trim()}
    >
      <aside className="vf-settings-sidebar flex min-h-0 flex-col border-r border-black/5 p-3 dark:border-white/10">
        <div className="flex h-[58px] items-center gap-2.5 px-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-black text-white shadow-sm dark:bg-white dark:text-black">
            <svg
              viewBox="0 0 20 20"
              aria-hidden="true"
              className="h-4 w-4 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.6]"
            >
              <circle cx="10" cy="10" r="2.3" />
              <path d="M15.8 11.8a1.3 1.3 0 0 0 .3 1.4l.1.1-2.3 2.3-.1-.1a1.3 1.3 0 0 0-1.4-.3 1.3 1.3 0 0 0-.8 1.2v.2H8.4v-.2a1.3 1.3 0 0 0-.8-1.2 1.3 1.3 0 0 0-1.4.3l-.1.1-2.3-2.3.1-.1a1.3 1.3 0 0 0 .3-1.4A1.3 1.3 0 0 0 3 11H2.8V8H3a1.3 1.3 0 0 0 1.2-.8 1.3 1.3 0 0 0-.3-1.4l-.1-.1 2.3-2.3.1.1a1.3 1.3 0 0 0 1.4.3A1.3 1.3 0 0 0 8.4 3v-.2h3.2V3a1.3 1.3 0 0 0 .8 1.2 1.3 1.3 0 0 0 1.4-.3l.1-.1 2.3 2.3-.1.1a1.3 1.3 0 0 0-.3 1.4 1.3 1.3 0 0 0 1.2.8h.2v3H17a1.3 1.3 0 0 0-1.2.8Z" />
            </svg>
          </span>
          <span
            id="vf-settings-title"
            className="vf-settings-sidebar-title text-[15px] font-semibold tracking-[-0.02em] text-black/85 dark:text-white/90"
          >
            Settings
          </span>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto py-2" aria-label="Settings categories">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-4 last:mb-0">
              <div className="vf-settings-nav-group mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-black/30 dark:text-white/30">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.pages.map((pageId) => {
                  const page = PAGE_BY_ID.get(pageId);
                  if (page === undefined) return null;
                  const selected = page.id === activePage;
                  return (
                    <button
                      key={page.id}
                      type="button"
                      aria-current={selected ? "page" : undefined}
                      aria-label={`${page.label} settings`}
                      className={`vf-settings-nav-item flex h-9 w-full items-center gap-2.5 rounded-[10px] px-3 text-left text-[12px] font-medium transition-[background-color,color,transform] active:scale-[0.98] ${
                        selected
                          ? "bg-black/[0.075] text-black dark:bg-white/[0.12] dark:text-white"
                          : "text-black/50 hover:bg-black/[0.04] hover:text-black/80 dark:text-white/50 dark:hover:bg-white/[0.07] dark:hover:text-white/80"
                      }`}
                      onClick={() => onSelectPage(page.id)}
                    >
                      <span className="h-[18px] w-[18px] flex-none [&>svg]:h-full [&>svg]:w-full [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] [&>svg]:[stroke-width:1.5]">
                        <PageIcon name={page.icon} />
                      </span>
                      <span className="vf-settings-nav-label truncate">{page.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="vf-settings-sidebar-note border-t border-black/5 px-3 pt-3 text-[10px] leading-4 text-black/30 dark:border-white/10 dark:text-white/30">
          Synced settings keep a local undo history.
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-col">
        <header className="flex min-h-[76px] shrink-0 items-center justify-between gap-4 border-b border-black/5 px-8 dark:border-white/10">
          <div className="min-w-0 py-3">
            <h1 className="truncate text-[17px] font-semibold tracking-[-0.025em] text-black/90 dark:text-white/90">
              {currentPage.label}
            </h1>
            <p className={`truncate ${labelCls}`}>{currentPage.description}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="vf-settings-history flex items-center rounded-full bg-black/[0.045] p-1 dark:bg-white/[0.08]">
              <button
                type="button"
                aria-label="Undo settings change"
                title="Undo synced settings change (⌘Z)"
                disabled={historyBusy || !undoAvailable}
                className="vf-settings-history-button flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium text-black/55 transition-[background-color,color,transform] hover:bg-white hover:text-black active:scale-95 disabled:pointer-events-none disabled:opacity-30 dark:text-white/55 dark:hover:bg-white/10 dark:hover:text-white"
                onClick={onUndo}
              >
                <span className="h-4 w-4 [&>svg]:h-full [&>svg]:w-full [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] [&>svg]:[stroke-width:1.6]">
                  <HistoryIcon direction="undo" />
                </span>
                <span className="vf-settings-history-label">Undo</span>
              </button>
              <button
                type="button"
                aria-label="Redo settings change"
                title="Redo synced settings change (⇧⌘Z)"
                disabled={historyBusy || !redoAvailable}
                className="vf-settings-history-button flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium text-black/55 transition-[background-color,color,transform] hover:bg-white hover:text-black active:scale-95 disabled:pointer-events-none disabled:opacity-30 dark:text-white/55 dark:hover:bg-white/10 dark:hover:text-white"
                onClick={onRedo}
              >
                <span className="h-4 w-4 [&>svg]:h-full [&>svg]:w-full [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] [&>svg]:[stroke-width:1.6]">
                  <HistoryIcon direction="redo" />
                </span>
                <span className="vf-settings-history-label">Redo</span>
              </button>
            </div>
            <button
              type="button"
              aria-label="Close settings"
              title="Close settings (Esc)"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-black/[0.045] text-black/45 transition-[background-color,color,transform] hover:bg-black/[0.08] hover:text-black active:scale-95 dark:bg-white/[0.08] dark:text-white/45 dark:hover:bg-white/[0.13] dark:hover:text-white"
              onClick={onClose}
            >
              <svg
                viewBox="0 0 20 20"
                aria-hidden="true"
                className="h-4 w-4 fill-none stroke-current [stroke-linecap:round] [stroke-width:1.6]"
              >
                <path d="m5 5 10 10M15 5 5 15" />
              </svg>
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          {historyNote !== null && (
            <div
              aria-live="polite"
              className="mb-4 flex items-center justify-between gap-3 rounded-[14px] bg-black/[0.03] px-3 py-2 text-[11px] text-black/45 dark:bg-white/[0.05] dark:text-white/45"
            >
              <span>{historyNote}</span>
              <span>Synced settings only</span>
            </div>
          )}
          <div className="mx-auto w-full max-w-[760px] pb-2">{children}</div>
        </div>
      </main>
    </div>
  );
}
