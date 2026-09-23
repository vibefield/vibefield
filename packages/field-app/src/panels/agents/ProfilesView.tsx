import {
  AgentIcon,
  PROFILE_GLYPHS,
  ProfileGlyph,
  suggestProfileGlyph,
} from "@vibecook/puppeteer-views";
import type { AgentProfileSet } from "@vibefield/contracts";
import { EmptyState, InlineNotice, UiButton, UiSwitch } from "@vibefield/design-kit/primitives";
import {
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { SettingsSubpage } from "../SettingsDialog";
import { borderCls, fieldCls, labelCls, SettingsRow, SettingsSection } from "../settings-ui";
import type { AgentsNotice } from "./AgentsView";
import {
  defaultSwitchWords,
  deleteWords,
  emptyProfileWords,
  type ProfileAgentRow,
  type ProfilePageModel,
  percentPlace,
  signOutWords,
  type UsageLine,
  usageLines,
} from "./profiles-model";

// Agent Profiles' views — controller-free, so the catalog mounts the shipping
// composition with fixture data (UI_SYSTEM.md). The design record is R1, pass
// 16: "Agent Profiles are places". A profile's page holds its agents (each a
// sign-in kept in the profile's folder, with the C1 timeline of its usage),
// its settings (name, glyph, the default, the folder) and its deletion behind
// the P7 two-step confirm; one agent inside a profile has its subscription,
// its folder and its sign-out; a new profile is a name, a glyph and a switch.
// Every act is a design-kit button; a sign-in runs in a terminal ON the page
// (the controller hands that card in as `signIn`).

/* ── marks ────────────────────────────────────────────────────────────────── */

/** A profile's mark: its glyph, filled when it is the default; the laptop for This Mac. */
export function ProfileMark({
  set,
  size = 18,
  title,
}: {
  set: Pick<AgentProfileSet, "kind" | "glyph" | "default">;
  size?: number;
  title?: string;
}): ReactElement {
  return (
    <ProfileGlyph
      className="vf-profiles-glyph"
      kind={set.kind}
      glyph={set.glyph}
      filled={set.default}
      size={size}
      {...(title === undefined ? {} : { title })}
    />
  );
}

function AgentTile({ provider }: { provider: string }): ReactElement {
  return (
    <span className="vf-agents-mark vf-agents-mark--row" aria-hidden="true">
      <AgentIcon providerId={provider} />
    </span>
  );
}

function Chevron(): ReactElement {
  return (
    <svg className="vf-agents-chevron" viewBox="0 0 20 20" aria-hidden="true">
      <path d="m7.5 5 5 5-5 5" />
    </svg>
  );
}

function PlusIcon(): ReactElement {
  return (
    <svg className="vf-profiles-plus" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 4.5v11M4.5 10h11" />
    </svg>
  );
}

function ResetIcon(): ReactElement {
  return (
    <svg className="vf-profiles-reset" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M15.5 10a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M14.5 3.5v3h-3" />
    </svg>
  );
}

function DownIcon(): ReactElement {
  return (
    <svg className="vf-profiles-down" viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5.5 8 4.5 4.5L14.5 8" />
    </svg>
  );
}

/** How the page of one agent inside a profile names itself in the header: the
 * agent, and the profile it is in (its mark beside its name). */
export function profileAgentSubpage(
  set: AgentProfileSet,
  agentLabel: string,
  onBack: () => void,
): SettingsSubpage {
  return {
    title: agentLabel,
    description: (
      <span className="vf-profiles-subhead">
        <ProfileMark set={set} size={12} />
        {set.label}
      </span>
    ),
    backLabel: `Back to ${set.label}`,
    onBack,
  };
}

/* ── the C1 timeline ──────────────────────────────────────────────────────── */

/** One line per usage window (pass 10, C1): the track is the window's time,
 * the fill is use, the % rides the fill's head, a line marks "now" when the
 * window's length is known, and the reset closes the track. Orange only when
 * ahead of pace (or over, or near the limit when pace is unknown). */
export function UsageTimeline({
  lines,
  label,
}: {
  lines: readonly UsageLine[];
  /** what these windows belong to, for a screen reader */
  label: string;
}): ReactElement | null {
  if (lines.length === 0) return null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: the lines share one grid's columns (display: contents rows), which a <ul> of <li> would lose
    <div className="vf-profiles-usage" role="list" aria-label={`${label} usage`}>
      {lines.map((line) => {
        const used = Math.min(100, Math.max(0, line.usedPercent));
        const { inside, edge } = percentPlace(line.usedPercent, line.elapsedPercent);
        const words = `${line.label}: ${Math.round(line.usedPercent)}% used${
          line.reset !== undefined ? `, resets in ${line.reset}` : ""
        }${line.hot ? ", ahead of pace" : ""}`;
        return (
          // biome-ignore lint/a11y/useSemanticElements: a row of the grid above; see there
          <div
            key={line.id}
            role="listitem"
            aria-label={words}
            className={`vf-profiles-usage-line${line.hot ? " is-hot" : ""}`}
          >
            <span className="vf-profiles-usage-label" aria-hidden="true">
              {line.label}
            </span>
            <span className="vf-profiles-usage-track" aria-hidden="true">
              <span className="vf-profiles-usage-fill" style={{ width: `${used}%` }} />
              {line.elapsedPercent !== undefined && (
                <span
                  className="vf-profiles-usage-now"
                  style={{ left: `${line.elapsedPercent}%` }}
                />
              )}
              <span
                className={`vf-profiles-usage-pct${inside ? " is-inside" : ""}`}
                style={
                  inside
                    ? { right: `calc(${100 - edge}% + 5px)` }
                    : { left: `calc(${edge}% + 5px)` }
                }
              >
                {Math.round(line.usedPercent)}%
              </span>
            </span>
            <span className="vf-profiles-usage-reset tabular-nums" aria-hidden="true">
              {line.resets && <ResetIcon />}
              {line.reset ?? ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── a menu under a button (island material, Esc closes) ─────────────────── */

export interface MenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
}

export function MenuButton({
  label,
  items,
  heading,
  empty,
  variant = "quiet",
  icon,
  align = "end",
  disabled = false,
  onPick,
}: {
  label: string;
  items: readonly MenuItem[];
  heading?: string;
  /** said in the menu when there is nothing to pick */
  empty?: string;
  variant?: "quiet" | "primary";
  icon?: ReactNode;
  align?: "end" | "center";
  disabled?: boolean;
  onPick: (key: string) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent): void => {
      if (wrap.current !== null && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    // the first item takes focus as the menu opens
    wrap.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const entries = [...(wrap.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const at = entries.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      entries[(at + step + entries.length) % entries.length]?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <div className="vf-profiles-menu-wrap" ref={wrap}>
      <UiButton
        ref={trigger}
        variant={variant}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="vf-profiles-menu-trigger"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        {icon}
        {label}
      </UiButton>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={heading ?? label}
          className={`vf-profiles-menu vf-profiles-menu--${align}`}
          onKeyDown={onMenuKey}
        >
          {heading !== undefined && (
            <div className="vf-profiles-menu-heading" aria-hidden="true">
              {heading}
            </div>
          )}
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="vf-profiles-menu-item"
              onClick={() => {
                close(true);
                onPick(item.key);
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
          {items.length === 0 && empty !== undefined && (
            <div className="vf-profiles-menu-empty" role="none">
              {empty}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── the glyph, chosen ────────────────────────────────────────────────────── */

/** The eleven glyphs in a row, one chosen (the New agent profile page). */
export function GlyphChoice({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (glyph: string) => void;
  label: string;
}): ReactElement {
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const at = PROFILE_GLYPHS.indexOf(value as (typeof PROFILE_GLYPHS)[number]);
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = PROFILE_GLYPHS[(at + step + PROFILE_GLYPHS.length) % PROFILE_GLYPHS.length]!;
    onChange(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-glyph="${next}"]`)?.focus();
  };
  return (
    // eleven drawn glyphs, not labelled inputs: buttons in the radio role carry the choice and the arrow keys
    <div role="radiogroup" aria-label={label} className="vf-profiles-glyphs" onKeyDown={onKey}>
      {PROFILE_GLYPHS.map((glyph) => (
        // biome-ignore lint/a11y/useSemanticElements: a drawn glyph in the radio role (see the group above)
        <button
          key={glyph}
          type="button"
          role="radio"
          aria-checked={glyph === value}
          aria-label={glyph}
          tabIndex={glyph === value ? 0 : -1}
          data-glyph={glyph}
          className="vf-profiles-glyph-option"
          onClick={() => onChange(glyph)}
        >
          <ProfileGlyph glyph={glyph} size={20} />
        </button>
      ))}
    </div>
  );
}

/** A pop-up button that shows the profile's glyph and opens the eleven. */
export function GlyphPopUp({
  set,
  disabled = false,
  onChange,
}: {
  set: AgentProfileSet;
  disabled?: boolean;
  onChange: (glyph: string) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const current = set.glyph ?? "star";

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent): void => {
      if (wrap.current !== null && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    wrap.current?.querySelector<HTMLElement>(`[data-glyph="${current}"]`)?.focus();
    return () => document.removeEventListener("pointerdown", away);
  }, [open, current]);

  const pick = (glyph: string): void => {
    setOpen(false);
    trigger.current?.focus();
    if (glyph !== current) onChange(glyph);
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const options = [...(wrap.current?.querySelectorAll<HTMLElement>("[role=option]") ?? [])];
    const at = options.indexOf(document.activeElement as HTMLElement);
    const columns = 6;
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: columns,
      ArrowUp: -columns,
    };
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    } else if (moves[event.key] !== undefined) {
      event.preventDefault();
      const next = Math.min(options.length - 1, Math.max(0, at + moves[event.key]!));
      options[next]?.focus();
    }
  };

  return (
    <div className="vf-profiles-menu-wrap" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="vf-profiles-popup"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Glyph: ${current}`}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <ProfileMark set={set} size={18} />
        <DownIcon />
      </button>
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="Glyphs"
          className="vf-profiles-menu vf-profiles-menu--end vf-profiles-glyph-grid"
          onKeyDown={onKey}
        >
          {PROFILE_GLYPHS.map((glyph) => (
            <button
              key={glyph}
              type="button"
              role="option"
              aria-selected={glyph === current}
              aria-label={glyph}
              tabIndex={-1}
              data-glyph={glyph}
              className="vf-profiles-glyph-option"
              onClick={() => pick(glyph)}
            >
              <ProfileGlyph glyph={glyph} size={20} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── the two-step confirm (P7) ────────────────────────────────────────────── */

/** A row with an explanation and one act; the act asks first, in place: the
 * question, exactly what goes, the act again, Cancel. Red is text only. */
export function ConfirmRow({
  title,
  description,
  action,
  question,
  what,
  confirm,
  danger = false,
  disabled = false,
  busy = false,
  onConfirm,
}: {
  title: string;
  description: ReactNode;
  /** the row's button ("Delete…", "Sign out…") */
  action: string;
  question: string;
  what: string;
  /** the confirming act ("Delete Work", "Sign out") */
  confirm: string;
  danger?: boolean;
  disabled?: boolean;
  busy?: boolean;
  onConfirm: () => void;
}): ReactElement {
  const [armed, setArmed] = useState(false);
  const act = useRef<HTMLButtonElement>(null);
  const arm = useRef<HTMLButtonElement>(null);
  const questionId = useId();
  useEffect(() => {
    if (armed) act.current?.focus();
  }, [armed]);
  useEffect(() => {
    if (disabled) setArmed(false);
  }, [disabled]);
  return (
    <div className={`vf-profiles-confirm${armed ? " is-armed" : ""}`}>
      <SettingsRow title={title} description={description} divider={false}>
        {!armed && (
          <UiButton
            ref={arm}
            variant={danger ? "danger" : "quiet"}
            disabled={disabled || busy}
            onClick={() => setArmed(true)}
          >
            {action}
          </UiButton>
        )}
      </SettingsRow>
      {armed && (
        <fieldset
          className="vf-profiles-confirm-box"
          aria-labelledby={questionId}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setArmed(false);
            }
          }}
        >
          <p id={questionId} className="vf-profiles-confirm-question">
            {question}
          </p>
          <p className={`vf-profiles-confirm-what ${labelCls}`}>{what}</p>
          <div className="vf-profiles-confirm-acts">
            <UiButton
              ref={act}
              variant={danger ? "danger" : "quiet"}
              disabled={busy}
              onClick={onConfirm}
            >
              {busy ? "Working…" : confirm}
            </UiButton>
            <UiButton disabled={busy} onClick={() => setArmed(false)}>
              Cancel
            </UiButton>
          </div>
        </fieldset>
      )}
    </div>
  );
}

/* ── a profile's page ─────────────────────────────────────────────────────── */

export interface ProfilePageViewProps {
  page: ProfilePageModel;
  /** "now" for the usage lines (the catalog pins it) */
  now?: Date | undefined;
  notice?: AgentsNotice | null | undefined;
  /** an act in flight: "name" · "glyph" · "default" · "reveal" · "delete" · `add:<provider>` */
  busy?: string | null | undefined;
  /** the sign-in terminal, when one runs on this page */
  signIn?: ReactNode;
  revealLabel?: string | undefined;
  onAdd: (provider: string) => void;
  onOpenAgent: (provider: string) => void;
  onSignIn: (provider: string) => void;
  onRename: (label: string) => void;
  onGlyph: (glyph: string) => void;
  onMakeDefault: () => void;
  onReveal: () => void;
  onDelete: () => void;
}

export function ProfilePageView({
  page,
  now,
  notice = null,
  busy = null,
  signIn,
  revealLabel = "Show in Finder",
  onAdd,
  onOpenAgent,
  onSignIn,
  onRename,
  onGlyph,
  onMakeDefault,
  onReveal,
  onDelete,
}: ProfilePageViewProps): ReactElement {
  const { set, rows } = page;
  const managed = set.kind === "managed";
  const addItems: MenuItem[] = page.addable.map((agent) => ({
    key: agent.provider,
    label: agent.label,
    icon: <AgentTile provider={agent.provider} />,
  }));
  const addMenu = (variant: "quiet" | "primary", align: "end" | "center") => (
    <MenuButton
      label="Add agent…"
      variant={variant}
      align={align}
      icon={variant === "quiet" ? <PlusIcon /> : undefined}
      heading={`Sign in to an agent ${page.inOn}`}
      empty="Every installed agent is signed in here."
      items={addItems}
      disabled={busy?.startsWith("add:") === true}
      onPick={onAdd}
    />
  );
  const empty = emptyProfileWords(set);
  const removal = deleteWords(page);
  return (
    <div className="vf-agents vf-agents-page vf-profiles-page" data-profile={set.id}>
      <header className="vf-agents-hero vf-profiles-hero">
        <span className="vf-agents-mark vf-agents-mark--hero" aria-hidden="true">
          <ProfileMark set={set} size={28} />
        </span>
        <div className="vf-agents-hero-text">
          <h2 className="vf-agents-hero-name" tabIndex={-1} data-agents-page-title="">
            {set.label}
          </h2>
          <p className="vf-agents-hero-fact">{page.facts}</p>
        </div>
      </header>

      {notice !== null && (
        <InlineNotice tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </InlineNotice>
      )}

      {rows.length === 0 ? (
        <EmptyState
          className="vf-agents-empty vf-profiles-empty"
          visual={
            <span className="vf-profiles-empty-mark">
              <ProfileMark set={set} size={22} />
            </span>
          }
          title={empty.title}
          description={empty.description}
          actions={addMenu("primary", "center")}
        />
      ) : null}

      {signIn}

      {rows.length > 0 && (
        <SettingsSection title="Agents" action={addMenu("quiet", "end")}>
          <div className="vf-agents-list">
            {rows.map((row) => (
              <ProfileAgentRowView
                key={row.provider}
                row={row}
                now={now}
                busy={busy}
                onOpen={() => onOpenAgent(row.provider)}
                onSignIn={() => onSignIn(row.provider)}
              />
            ))}
          </div>
        </SettingsSection>
      )}

      <SettingsSection title="Profile">
        {managed && (
          <SettingsRow title="Name">
            <NameField
              value={set.label}
              disabled={busy === "name"}
              onCommit={(label) => {
                if (label !== set.label) onRename(label);
              }}
            />
          </SettingsRow>
        )}
        {managed && (
          <SettingsRow title="Glyph">
            <GlyphPopUp set={set} disabled={busy === "glyph"} onChange={onGlyph} />
          </SettingsRow>
        )}
        <SettingsRow title="Use for new sessions" description={defaultSwitchWords(set.default)}>
          <UiSwitch
            checked={set.default}
            // there is always exactly one default: it only ever moves TO a profile
            disabled={set.default || busy === "default"}
            label="Use for new sessions"
            onChange={(on) => {
              if (on) onMakeDefault();
            }}
          />
        </SettingsRow>
        {managed ? (
          <SettingsRow
            title="Folder"
            description={
              set.folder === undefined ? (
                "Made with its first sign-in"
              ) : (
                <span className="vf-agents-path">{set.folder}</span>
              )
            }
            divider={false}
          >
            <UiButton
              onClick={onReveal}
              disabled={set.folder === undefined || busy === "reveal"}
              aria-label={`${revealLabel}: ${set.label}’s folder`}
            >
              {revealLabel}
            </UiButton>
          </SettingsRow>
        ) : (
          <SettingsRow
            title="Folders"
            description="Each agent keeps its own, shown on the agent's page"
            divider={false}
          >
            {null}
          </SettingsRow>
        )}
      </SettingsSection>

      {managed && (
        <section className={`${borderCls} vf-profiles-danger`}>
          <ConfirmRow
            title="Delete this agent profile"
            description={removal.description}
            action="Delete…"
            question={removal.question}
            what={removal.what}
            confirm={`Delete ${set.label}`}
            danger
            disabled={removal.blocked}
            busy={busy === "delete"}
            onConfirm={onDelete}
          />
        </section>
      )}
    </div>
  );
}

function ProfileAgentRowView({
  row,
  now,
  busy,
  onOpen,
  onSignIn,
}: {
  row: ProfileAgentRow;
  now?: Date | undefined;
  busy: string | null;
  onOpen: () => void;
  onSignIn: () => void;
}): ReactElement {
  const factId = `vf-profiles-fact-${row.persona.profileId}`;
  const lines = usageLines(row.usage, now ?? new Date());
  let action: ReactNode = null;
  if (row.state === "expired") {
    action = (
      <UiButton
        onClick={onSignIn}
        disabled={busy !== null}
        aria-label={`Sign in to ${row.label} again`}
      >
        Sign in again
      </UiButton>
    );
  } else if (row.state === "signed-out") {
    action = (
      <UiButton onClick={onSignIn} disabled={busy !== null} aria-label={`Sign in to ${row.label}`}>
        Sign in
      </UiButton>
    );
  }
  return (
    <div
      className={`vf-agents-row vf-profiles-row${lines.length > 0 ? " has-usage" : ""}`}
      data-provider={row.provider}
    >
      <AgentTile provider={row.provider} />
      <div className="vf-agents-row-text">
        <button
          type="button"
          className="vf-agents-row-open"
          aria-describedby={factId}
          onClick={onOpen}
        >
          {row.label}
        </button>
        <span id={factId} className="vf-agents-row-fact">
          {row.state === "expired" ? (
            <>
              <span className="vf-profiles-attention">Sign-in expired</span>
              {row.fact.replace(/^Sign-in expired/u, "")}
            </>
          ) : (
            row.fact
          )}
        </span>
        <UsageTimeline lines={lines} label={row.label} />
      </div>
      <div className="vf-agents-row-actions">{action}</div>
      <Chevron />
    </div>
  );
}

/** A name edited in place; it is written when the field is left or Return is
 * pressed, never per keystroke, and an empty name puts the old one back. */
function NameField({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  onCommit: (label: string) => void;
}): ReactElement {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = (): void => {
    const label = draft.trim();
    if (label.length === 0) {
      setDraft(value);
      return;
    }
    onCommit(label);
  };
  return (
    <input
      className={`${fieldCls} vf-profiles-name`}
      value={draft}
      maxLength={64}
      spellCheck={false}
      aria-label="Profile name"
      disabled={disabled}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          event.stopPropagation();
          setDraft(value);
        }
      }}
    />
  );
}

/* ── one agent inside a profile ───────────────────────────────────────────── */

export interface ProfileAgentPageViewProps {
  set: AgentProfileSet;
  row: ProfileAgentRow;
  /** the shared app's installed version, for the row that leads to it */
  appVersion?: string | undefined;
  /** This Mac's sign-out needs the agent's own command; a profile's always works */
  canSignOut: boolean;
  now?: Date | undefined;
  notice?: AgentsNotice | null | undefined;
  /** "signin" · "reveal" · "signout" */
  busy?: string | null | undefined;
  signIn?: ReactNode;
  revealLabel?: string | undefined;
  onSignIn: () => void;
  onReveal: () => void;
  onSignOut: () => void;
  onOpenApp: () => void;
}

export function ProfileAgentPageView({
  set,
  row,
  appVersion,
  canSignOut,
  now,
  notice = null,
  busy = null,
  signIn,
  revealLabel = "Show in Finder",
  onSignIn,
  onReveal,
  onSignOut,
  onOpenApp,
}: ProfileAgentPageViewProps): ReactElement {
  const lines = usageLines(row.usage, now ?? new Date());
  const identity = row.persona.identity;
  const signedIn = row.state === "signed-in" || row.state === "expired";
  const title = signedIn && identity?.plan !== undefined ? identity.plan : row.label;
  const email = identity?.email ?? identity?.organization;
  const detail =
    row.state === "signed-in"
      ? lines.length > 0
        ? (email ?? "Signed in")
        : `${email ?? "Signed in"}${row.usageUnsupported ? ` · usage isn't reported by ${row.label}` : ""}`
      : row.fact;
  const words = signOutWords(set, row.label);
  const act =
    row.state === "signing-in" ? null : (
      <UiButton onClick={onSignIn} disabled={busy !== null}>
        {row.state === "signed-in"
          ? "Switch account…"
          : row.state === "expired"
            ? "Sign in again"
            : "Sign in"}
      </UiButton>
    );
  return (
    <div className="vf-agents vf-agents-page vf-profiles-agent-page" data-profile={set.id}>
      {/* The page's focus target (the dialog's h1 names it too). */}
      <h2 className="sr-only" tabIndex={-1} data-agents-page-title="">
        {row.label} in {set.label}
      </h2>
      {notice !== null && (
        <InlineNotice tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </InlineNotice>
      )}
      <SettingsSection title="Subscription">
        <div className="vf-agents-row vf-profiles-row vf-profiles-subscription">
          <AgentTile provider={row.provider} />
          <div className="vf-agents-row-text">
            <span className="vf-profiles-subscription-title">{title}</span>
            <span className="vf-agents-row-fact">
              {row.state === "expired" ? (
                <>
                  <span className="vf-profiles-attention">Sign-in expired</span>
                  {email !== undefined ? ` · ${email}` : ""}
                </>
              ) : (
                detail
              )}
            </span>
            <UsageTimeline lines={lines} label={row.label} />
          </div>
          <div className="vf-agents-row-actions">{act}</div>
        </div>
      </SettingsSection>

      {signIn}

      <section className={`${borderCls} vf-profiles-more`}>
        <SettingsRow
          title="Folder"
          description={
            row.persona.folder === undefined ? undefined : (
              <span className="vf-agents-path">{row.persona.folder}</span>
            )
          }
          divider={canSignOut}
        >
          <UiButton
            onClick={onReveal}
            disabled={busy === "reveal"}
            aria-label={`${revealLabel}: ${row.label}’s folder ${set.kind === "native" ? "on This Mac" : `in ${set.label}`}`}
          >
            {revealLabel}
          </UiButton>
        </SettingsRow>
        {canSignOut && (
          <ConfirmRow
            title="Sign out"
            description={words.description}
            action="Sign out…"
            question={words.question}
            what={words.what}
            confirm="Sign out"
            busy={busy === "signout"}
            onConfirm={onSignOut}
          />
        )}
      </section>

      <section className={`${borderCls} vf-profiles-app`}>
        <div className="vf-agents-row">
          <AgentTile provider={row.provider} />
          <div className="vf-agents-row-text">
            <button type="button" className="vf-agents-row-open" onClick={onOpenApp}>
              {row.label}
              {appVersion !== undefined && (
                <span className="vf-profiles-app-version tabular-nums"> {appVersion}</span>
              )}
            </button>
            <span className="vf-agents-row-fact">
              The app itself · shared by every agent profile
            </span>
          </div>
          <span />
          <Chevron />
        </div>
      </section>
    </div>
  );
}

/* ── a new profile ────────────────────────────────────────────────────────── */

export interface NewProfileViewProps {
  busy?: boolean | undefined;
  notice?: AgentsNotice | null | undefined;
  onCancel: () => void;
  onCreate: (profile: { label: string; glyph: string; isDefault: boolean }) => void;
}

export function NewProfileView({
  busy = false,
  notice = null,
  onCancel,
  onCreate,
}: NewProfileViewProps): ReactElement {
  const [label, setLabel] = useState("");
  const [glyph, setGlyph] = useState<string | null>(null);
  const [isDefault, setIsDefault] = useState(false);
  const name = useRef<HTMLInputElement>(null);
  useEffect(() => name.current?.focus(), []);
  // the name suggests a glyph until one is chosen
  const shown = glyph ?? suggestProfileGlyph(label.trim().length > 0 ? label : "profile");
  const ready = label.trim().length > 0;
  return (
    <form
      className="vf-agents vf-agents-page vf-profiles-new"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !busy) onCreate({ label: label.trim(), glyph: shown, isDefault });
      }}
    >
      <h2 className="sr-only" tabIndex={-1} data-agents-page-title="">
        New agent profile
      </h2>
      {notice !== null && (
        <InlineNotice tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </InlineNotice>
      )}
      {/* The header names the page and says what it makes; the form is one card. */}
      <section className={borderCls}>
        <SettingsRow title="Name">
          <input
            ref={name}
            className={`${fieldCls} vf-profiles-name`}
            value={label}
            maxLength={64}
            spellCheck={false}
            placeholder="Work, Personal, a client…"
            aria-label="Name"
            onChange={(event) => setLabel(event.target.value)}
          />
        </SettingsRow>
        <SettingsRow
          title="Glyph"
          description={glyph === null ? "Suggested from the name" : "Its mark wherever it appears"}
          align="start"
        >
          <GlyphChoice value={shown} onChange={setGlyph} label="Glyph" />
        </SettingsRow>
        <SettingsRow
          title="Use for new sessions"
          description="Spawns and the Godview launcher start here"
          divider={false}
        >
          <UiSwitch checked={isDefault} label="Use for new sessions" onChange={setIsDefault} />
        </SettingsRow>
      </section>
      <div className="vf-profiles-foot">
        <UiButton onClick={onCancel} disabled={busy}>
          Cancel
        </UiButton>
        <UiButton type="submit" variant="primary" disabled={!ready || busy}>
          {busy ? "Creating…" : "Create profile"}
        </UiButton>
      </div>
    </form>
  );
}

/* ── the sign-in card's frame ─────────────────────────────────────────────── */

/** The terminal a sign-in runs in, on the page (pass 16): its title bar says
 * which agent, in which profile, and when it closes; under it, where the
 * sign-in lands and the way to cancel. The terminal itself is the child. */
export function SignInCard({
  agentLabel,
  where,
  note,
  onCancel,
  cancelling = false,
  children,
}: {
  agentLabel: string;
  where: string;
  note: string;
  onCancel: () => void;
  cancelling?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="vf-profiles-signin" aria-label={`${agentLabel} sign-in`}>
      <div className="vf-agents-output vf-profiles-signin-card">
        <header className="vf-agents-output-head">
          <span className="vf-profiles-signin-title">
            {agentLabel} · sign in · {where}
          </span>
          <span className="vf-agents-output-state">closes when the sign-in is known</span>
        </header>
        <div className="vf-profiles-signin-body">{children}</div>
      </div>
      <div className="vf-profiles-signin-row">
        <span className={labelCls}>{note}</span>
        <UiButton onClick={onCancel} disabled={cancelling}>
          {cancelling ? "Cancelling…" : "Cancel"}
        </UiButton>
      </div>
    </section>
  );
}
