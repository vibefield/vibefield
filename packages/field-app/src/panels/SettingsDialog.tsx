import { faceLiftHostClass, UserFaceView } from "@vibefield/design-kit/face";
import { FieldGlyph, type GlyphName } from "@vibefield/design-kit/glyphs";
import { UiButton } from "@vibefield/design-kit/primitives";
import {
  Fragment,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
} from "react";
import type { FieldUserFace } from "../host";
import { labelCls } from "./settings-ui";

export type SettingsPage =
  | "account"
  | "general"
  | "appearance"
  | "canvas"
  | "agents"
  | "profiles"
  | "plugins"
  | "mesh"
  | "terminal"
  | "diagnostics"
  | "advanced";

interface PageMeta {
  id: SettingsPage;
  label: string;
  description: string;
  icon:
    | "person"
    | "sliders"
    | "sun"
    | "canvas"
    | "agents"
    | "profiles"
    | "plugin"
    | "mesh"
    | "terminal"
    | "pulse"
    | "code";
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
    id: "agents",
    label: "Agents",
    description: "Installed once on this Mac and shared by every agent profile.",
    icon: "agents",
  },
  {
    // Reached through the "Agent Profiles" group, one item per profile; the
    // page's head names the profile (`head`), so this line is a fallback.
    id: "profiles",
    label: "Agent Profiles",
    description: "Places you work in, each holding one sign-in per agent.",
    icon: "profiles",
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
    description: "How terminals look in this window, and how every terminal on this Mac behaves.",
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
  { label: "Workspace", pages: ["agents", "plugins", "mesh", "terminal"] },
  { label: "Support", pages: ["diagnostics", "advanced"] },
];

const PAGE_BY_ID = new Map(PAGES.map((page) => [page.id, page]));

/** UA-D19 — the head of Settings when the account is known: the card that
 * replaces the gear tile and the word "Settings", and the other users as faces
 * under it. With it, the Account nav group folds away — the head IS the
 * account. Without it (a browser harness, an older shell) the dialog keeps its
 * gear head and the Account item, so the page is never unreachable. */
export interface SettingsAccountHead {
  readonly me: {
    readonly userId: string;
    readonly name: string;
    readonly face: FieldUserFace;
    /** The login, or the link state in words ("offline · not linked"). */
    readonly detail: string;
    readonly detailIsLogin?: boolean;
  };
  readonly others: readonly {
    readonly userId: string;
    readonly name: string;
    readonly face: FieldUserFace;
    /** Agents waiting in that user (no feed yet — spec v0.3 §12). */
    readonly waiting?: number;
  }[];
  /** Absent: this host cannot switch, so the faces are shown, not offered.
   * `from` is the face that was pressed — the switch carries it (§8). */
  readonly onSwitch?: ((userId: string, from?: Element) => void) | undefined;
  readonly busy?: boolean;
  /** A switch main refused, in its words — shown under the faces until the
   * next attempt, so a click never just does nothing. */
  readonly notice?: string | null | undefined;
}

/** AO-D10 — "Finish setting up": the Setup Assistant's steps put off, under the
 * account card, each with its glyph and its one line (DESIGN.md §8). Continue
 * setup opens their panes as a sheet over the app; Hide removes the tile for
 * good, and every step still lives on its page. Empty: no tile at all. */
export interface SettingsFinishSetup {
  readonly rows: readonly {
    readonly step: string;
    readonly glyph: GlyphName;
    readonly label: string;
  }[];
  readonly onContinue: () => void;
  readonly onHide: () => void;
}

/** AR-S2 — the sidebar's "Agent Profiles" group (the design record's R1: a
 * profile is a place). One item per profile, This Mac first, each led by its
 * mark (the caller draws it: the glyph, filled for the default), then "New
 * profile…". `current` is the profile whose page is open, or "new". */
export interface SettingsProfilesNav {
  readonly items: readonly { id: string; label: string; mark: ReactNode }[];
  readonly current: string | null;
  readonly onSelect: (id: string) => void;
  readonly onNew: () => void;
}

/** A page below a settings page — one agent's page under Agents. The header
 * names it and offers the way back; the nav keeps its parent current. */
export interface SettingsSubpage {
  readonly title: string;
  /** a line under the title; a node, so a profile's page can lead with its mark */
  readonly description: ReactNode;
  /** the back button's accessible name ("Back to Agents") */
  readonly backLabel: string;
  readonly onBack: () => void;
}

function AccountHead({
  account,
  current,
  onOpenAccount,
}: {
  account: SettingsAccountHead;
  current: boolean;
  onOpenAccount: () => void;
}): ReactElement {
  const { me, others, onSwitch, busy = false, notice = null } = account;
  return (
    <div className="vf-settings-account">
      {/* The dialog is still "Settings" to assistive tech; the card is its head. */}
      <span id="vf-settings-title" className="sr-only">
        Settings
      </span>
      <button
        type="button"
        className={`vf-settings-account-card ${faceLiftHostClass}`}
        aria-current={current ? "page" : undefined}
        aria-label={`${me.name}${me.detail.length > 0 ? `, ${me.detail}` : ""} — account settings`}
        onClick={onOpenAccount}
      >
        <UserFaceView emoji={me.face.emoji} frame={me.face.frame} size={40} seed={me.userId} />
        <span className="vf-settings-account-text">
          <span className="vf-settings-account-name">{me.name}</span>
          {me.detail.length > 0 && (
            <span
              className={`vf-settings-account-detail${me.detailIsLogin === true ? " vf-ui-mono" : ""}`}
            >
              {me.detail}
            </span>
          )}
        </span>
        <span className="vf-settings-account-chevron" aria-hidden="true">
          ›
        </span>
      </button>
      {others.length > 0 && (
        <div className="vf-settings-account-others">
          <span className="vf-settings-account-eyebrow">Switch user</span>
          {others.map((other) => {
            const waiting = other.waiting ?? 0;
            return (
              <button
                key={other.userId}
                type="button"
                className={`vf-settings-account-other ${faceLiftHostClass}`}
                title={`Switch to ${other.name}`}
                aria-label={`Switch to ${other.name}${waiting > 0 ? `, ${waiting} waiting` : ""}`}
                disabled={onSwitch === undefined || busy}
                onClick={(event) => onSwitch?.(other.userId, event.currentTarget)}
              >
                <UserFaceView
                  emoji={other.face.emoji}
                  frame={other.face.frame}
                  size={24}
                  seed={other.userId}
                />
                {waiting > 0 && (
                  <span className="vf-settings-account-waiting tabular-nums" aria-hidden="true">
                    {waiting}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {notice !== null && (
        <p className="vf-settings-account-notice" role="alert">
          {notice}
        </p>
      )}
    </div>
  );
}

/** Finish setting up — never a badge, never a count on the face, never on launch:
 * a quiet tile Settings shows while something was put off. */
function FinishSetupTile({ finish }: { finish: SettingsFinishSetup }): ReactElement | null {
  if (finish.rows.length === 0) return null;
  return (
    <section className="vf-settings-finish" aria-labelledby="vf-settings-finish-title">
      <span id="vf-settings-finish-title" className="vf-settings-finish-title">
        Finish setting up
      </span>
      <ul className="vf-settings-finish-rows">
        {finish.rows.map((row) => (
          <li key={row.step}>
            <FieldGlyph name={row.glyph} size={14} />
            <span>{row.label}</span>
          </li>
        ))}
      </ul>
      <div className="vf-settings-finish-acts">
        <UiButton variant="primary" onClick={finish.onContinue}>
          Continue setup
        </UiButton>
        <UiButton onClick={finish.onHide}>Hide</UiButton>
      </div>
    </section>
  );
}

/** The "Agent Profiles" nav group: every profile as a place, then New profile…
 * (the add item in the muted ramp, as the record draws it). */
function ProfilesNavGroup({
  profiles,
  active,
}: {
  profiles: SettingsProfilesNav;
  active: boolean;
}): ReactElement {
  const itemCls = (selected: boolean, add = false) =>
    `vf-settings-nav-item flex h-9 w-full items-center gap-2.5 rounded-[10px] px-3 text-left text-[12px] font-medium transition-[background-color,color,transform] active:scale-[0.98] ${
      selected
        ? "bg-black/[0.075] text-black dark:bg-white/[0.12] dark:text-white"
        : add
          ? "text-black/40 hover:bg-black/[0.04] hover:text-black/70 dark:text-white/40 dark:hover:bg-white/[0.07] dark:hover:text-white/70"
          : "text-black/50 hover:bg-black/[0.04] hover:text-black/80 dark:text-white/50 dark:hover:bg-white/[0.07] dark:hover:text-white/80"
    }`;
  return (
    <div className="mb-4 last:mb-0" data-settings-profiles="">
      <div className="vf-settings-nav-group mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-black/30 dark:text-white/30">
        Agent Profiles
      </div>
      <div className="space-y-0.5">
        {profiles.items.map((item) => {
          const selected = active && profiles.current === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-current={selected ? "page" : undefined}
              aria-label={`${item.label} agent profile`}
              className={itemCls(selected)}
              onClick={() => profiles.onSelect(item.id)}
            >
              <span className="flex h-[18px] w-[18px] flex-none items-center justify-center">
                {item.mark}
              </span>
              <span className="vf-settings-nav-label truncate">{item.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          aria-current={active && profiles.current === "new" ? "page" : undefined}
          className={itemCls(active && profiles.current === "new", true)}
          onClick={profiles.onNew}
        >
          <span className="h-[18px] w-[18px] flex-none [&>svg]:h-full [&>svg]:w-full [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] [&>svg]:[stroke-width:1.5]">
            <FieldGlyph name="plus" size={18} />
          </span>
          <span className="vf-settings-nav-label truncate">New profile…</span>
        </button>
      </div>
    </div>
  );
}

const PAGE_GLYPH: Record<PageMeta["icon"], GlyphName> = {
  person: "person",
  sliders: "sliders",
  sun: "sun",
  canvas: "canvas",
  agents: "agents",
  profiles: "profiles",
  plugin: "plugin",
  mesh: "mesh",
  terminal: "terminal",
  pulse: "pulse",
  code: "code",
};

function PageIcon({ name }: { name: PageMeta["icon"] }): ReactElement {
  return <FieldGlyph name={PAGE_GLYPH[name]} size={18} />;
}

function HistoryIcon({ direction }: { direction: "undo" | "redo" }): ReactElement {
  return <FieldGlyph name="undo" size={16} flip={direction === "redo"} />;
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
  account,
  finish,
  profiles,
  head = null,
  subpage = null,
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
  /** UA-D19 — the account at the head of Settings; see `SettingsAccountHead`. */
  account?: SettingsAccountHead | undefined;
  /** AO-D10 — Finish setting up, under the account (see `SettingsFinishSetup`). */
  finish?: SettingsFinishSetup | undefined;
  /** AR-S2 — the Agent Profiles group (see `SettingsProfilesNav`); absent, no group. */
  profiles?: SettingsProfilesNav | undefined;
  /** A page's own title and line when its page meta cannot say it (a profile's name). */
  head?: { title: string; description: ReactNode } | null | undefined;
  /** A page below the active one (see `SettingsSubpage`); null at the page itself. */
  subpage?: SettingsSubpage | null | undefined;
  dialogRef?: RefObject<HTMLDivElement | null>;
  className?: string;
  children: ReactNode;
}): ReactElement {
  const currentPage = PAGE_BY_ID.get(activePage) ?? PAGES[0]!;
  const navGroups =
    account === undefined ? NAV_GROUPS : NAV_GROUPS.filter((group) => group.label !== "Account");
  // A new page or subpage opens at its top.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const subpageTitle = subpage?.title ?? head?.title ?? null;
  useEffect(() => {
    if (scrollerRef.current !== null) scrollerRef.current.scrollTop = 0;
  }, [activePage, subpageTitle]);
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
        {account !== undefined ? (
          <AccountHead
            account={account}
            current={activePage === "account"}
            onOpenAccount={() => onSelectPage("account")}
          />
        ) : (
          <div className="flex h-[58px] items-center gap-2.5 px-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-black text-white shadow-sm dark:bg-white dark:text-black">
              <FieldGlyph name="gear" size={16} />
            </span>
            <span
              id="vf-settings-title"
              className="vf-settings-sidebar-title text-[15px] font-semibold tracking-[-0.02em] text-black/85 dark:text-white/90"
            >
              Settings
            </span>
          </div>
        )}
        {finish !== undefined && <FinishSetupTile finish={finish} />}

        <nav className="min-h-0 flex-1 overflow-y-auto py-2" aria-label="Settings categories">
          {navGroups.map((group) => (
            <Fragment key={group.label}>
              <div className="mb-4 last:mb-0">
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
              {group.label === "Workspace" && profiles !== undefined && (
                <ProfilesNavGroup profiles={profiles} active={activePage === "profiles"} />
              )}
            </Fragment>
          ))}
        </nav>

        <div className="vf-settings-sidebar-note border-t border-black/5 px-3 pt-3 text-[10px] leading-4 text-black/30 dark:border-white/10 dark:text-white/30">
          Synced settings keep a local undo history.
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-col">
        <header className="flex min-h-[76px] shrink-0 items-center justify-between gap-4 border-b border-black/5 px-8 dark:border-white/10">
          <div className="flex min-w-0 items-center gap-3 py-3">
            {subpage !== null && (
              <button
                type="button"
                aria-label={subpage.backLabel}
                title={subpage.backLabel}
                className="vf-settings-back flex h-9 w-9 flex-none items-center justify-center rounded-full bg-black/[0.045] text-black/45 transition-[background-color,color,transform] hover:bg-black/[0.08] hover:text-black active:scale-95 dark:bg-white/[0.08] dark:text-white/45 dark:hover:bg-white/[0.13] dark:hover:text-white"
                onClick={subpage.onBack}
              >
                <FieldGlyph name="chevron" size={16} turn={180} />
              </button>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-[17px] font-semibold tracking-[-0.025em] text-black/90 dark:text-white/90">
                {subpage?.title ?? head?.title ?? currentPage.label}
              </h1>
              <p className={`truncate ${labelCls}`}>
                {subpage?.description ?? head?.description ?? currentPage.description}
              </p>
            </div>
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
              <FieldGlyph name="close" size={16} />
            </button>
          </div>
        </header>

        <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
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
