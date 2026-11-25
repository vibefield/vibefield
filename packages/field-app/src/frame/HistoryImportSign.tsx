import { catalogIdForKind } from "@vibefield/contracts";
import { FieldGlyph } from "@vibefield/design-kit/glyphs";
import { UiSwitch } from "@vibefield/design-kit/primitives";
import { useFielddClient } from "@vibefield/fieldd-client/react";
import { AgentIcon } from "@vibefield/puppeteer-view-sdk/react";
// the room's types only, which ride no chunk: this module is the frame's
import type {
  ImportSign,
  ImportSignAgent,
  ImportSignSpace,
  ImportSignStep,
} from "@vibefield/rosetta-room";
import {
  type CSSProperties,
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { formatBytes } from "../format/bytes";
import { lastUsedWords } from "../setup/history-consent";
import { COVER_RESERVE_PX, HEAD_BAND_PX } from "./frame-geometry";
import { HistorySpace } from "./HistorySpace";
import { useImportSign } from "./import-sign-door";
import { type UnreadAgents, useUnreadAgents } from "./unread-agents";
import "./menu.css";
import "./history-import-sign.css";

// THE HISTORY CIRCLE (track IM, IM-1; DESIGN.md §8 "History", the import's sign; §6 the arc; §8 "The head").
// Under History the head holds the import's sign one head gap left of the frame's search button: a 40 glass circle,
// the `history` glyph under the arc while the import works, a rim of four quarters (one per step, never summed), and a
// dot for what needs you. Its panel, the solid menu, says what each step opens, each agent, and what is read and kept
// on this Mac. The words are rosetta's room's (R11, handed out through `import-sign-door.ts`); VibeField draws them.
// Its one act is the frame's own (track HD, HD-1): History Settings…, a menu row at the panel's end, which opens
// Settings → History, where what is kept can be cleared and whose sessions are read is chosen.
//
// *2026-11-24 (HD-7):* under the agents History reads, the panel lists THE AGENTS NOT IN HISTORY: the ones with past
// sessions on this Mac that it does not read, each with the census's facts and a switch that brings it in, as its
// switch in Settings → History does. They are fieldd's census, not the room's sign (`unread-agents.ts`).

/** The pointer rests this long on the circle before the panel opens. */
export const SIGN_OPEN_INTENT_MS = 120;
/** Leaving the circle and the panel closes it after this long. */
export const SIGN_CLOSE_GRACE_MS = 220;
/** The panel's top: 10 under the head band. */
const PANEL_TOP_PX = HEAD_BAND_PX + 10;

/** The circle in the frame's head while History is the view shown and the room has a sign to give. */
export function HistoryImportSign({
  shown,
  onOpenSettings,
}: {
  shown: boolean;
  /** HD-1 — the panel's History Settings…: Settings → History */
  onOpenSettings?: (() => void) | undefined;
}): ReactElement | null {
  const sign = useImportSign();
  const client = useFielddClient();
  const [open, setOpen] = useState(false);
  const standing = shown && sign !== null;
  // HD-7 — the census is asked while the panel is open, and again when the agents the sign names change
  const unread = useUnreadAgents(
    client,
    standing && open,
    sign === null ? "" : sign.agents.map((agent) => agent.kind).join("\n"),
  );
  useEffect(() => {
    if (!standing) setOpen(false);
  }, [standing]);
  if (!shown || sign === null) return null;
  return (
    <HistoryImportSignView
      sign={sign}
      onOpenSettings={onOpenSettings}
      unread={unread}
      onOpenChange={setOpen}
    />
  );
}

/** The circle and its panel over one sign: what the frame draws, and what the catalog mounts. */
export function HistoryImportSignView({
  sign,
  initiallyOpen = false,
  onOpenSettings,
  unread,
  onOpenChange,
  now = Date.now(),
}: {
  sign: ImportSign;
  /** the panel stands open from the first frame (a still, a catalog plate) */
  initiallyOpen?: boolean;
  /** HD-1 — the panel's History Settings… row; absent: the panel draws no act */
  onOpenSettings?: (() => void) | undefined;
  /** HD-7 — the agents not in History, each with its switch; absent: the panel lists none */
  unread?: UnreadAgents | undefined;
  /** HD-7 — the panel opened or closed (its host asks the census while it is open) */
  onOpenChange?: ((open: boolean) => void) | undefined;
  /** the clock "last used" is said against */
  now?: number;
}): ReactElement {
  const [open, setOpen] = useState(initiallyOpen);
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  // a press holds it open until a second press, Escape or a press outside
  const [held, setHeld] = useState(initiallyOpen);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const close = useCallback(() => {
    clear();
    setOpen(false);
    setHeld(false);
  }, [clear]);
  const enter = useCallback(() => {
    clear();
    if (!open) timer.current = setTimeout(() => setOpen(true), SIGN_OPEN_INTENT_MS);
  }, [clear, open]);
  const leave = useCallback(() => {
    clear();
    if (open && !held) timer.current = setTimeout(() => setOpen(false), SIGN_CLOSE_GRACE_MS);
  }, [clear, open, held]);
  const press = useCallback(() => {
    clear();
    if (open && held) {
      setOpen(false);
      setHeld(false);
    } else {
      setOpen(true);
      setHeld(true);
    }
  }, [clear, open, held]);
  useEffect(() => clear, [clear]);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      close();
      buttonRef.current?.focus();
    };
    const onDown = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (
        target !== null &&
        (buttonRef.current?.contains(target) || panelRef.current?.contains(target))
      )
        return;
      close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [open, close]);

  return (
    <>
      <div
        className="vf-history-sign no-drag"
        data-tone={sign.tone}
        onPointerEnter={enter}
        onPointerLeave={leave}
      >
        <button
          ref={buttonRef}
          type="button"
          className="vf-history-sign-button"
          aria-label={sign.label}
          aria-haspopup="dialog"
          aria-expanded={open}
          {...(open ? { "aria-controls": panelId } : {})}
          onClick={press}
        >
          <SignFace sign={sign} />
        </button>
      </div>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="History import"
          className="vf-history-sign-panel"
          style={
            {
              top: `${PANEL_TOP_PX}px`,
              maxHeight: `calc(100vh - ${PANEL_TOP_PX + COVER_RESERVE_PX}px)`,
            } as CSSProperties
          }
          onPointerEnter={enter}
          onPointerLeave={leave}
        >
          <SignPanel
            sign={sign}
            unread={unread}
            now={now}
            onOpenSettings={
              onOpenSettings === undefined
                ? undefined
                : () => {
                    // the panel goes first: Settings opens over the frame, and a panel left open would stand under it
                    close();
                    onOpenSettings();
                  }
            }
          />
        </div>
      )}
    </>
  );
}

/* ── the circle ─────────────────────────────────────────────────────────── */

/** The rim's geometry in the 40 (DESIGN.md §8 "History"): radius 17.5, 14° between quarters. */
const RIM = { center: 20, radius: 17.5, gap: 14 } as const;

/** An arc of the rim's circle from `from`° to `to`°, clockwise from twelve o'clock. */
export function rimArc(from: number, to: number): string {
  const { center, radius } = RIM;
  const at = (deg: number): string => {
    const rad = (deg * Math.PI) / 180;
    return `${(center + radius * Math.sin(rad)).toFixed(2)} ${(center - radius * Math.cos(rad)).toFixed(2)}`;
  };
  return `M${at(from)}A${radius} ${radius} 0 ${to - from > 180 ? 1 : 0} 1 ${at(to)}`;
}

/** How full a step's quarter is: whole once done, its own fraction while current, empty before. */
export function quarterFill(step: ImportSignStep): number {
  if (step.state === "done") return 1;
  if (step.state === "later") return 0;
  return Math.max(0, Math.min(1, step.fraction ?? 0));
}

function SignFace({ sign }: { sign: ImportSign }): ReactElement {
  // the import is under way (or stopped mid-way): the glyph at a third of its ink under the arc
  const importing = sign.tone === "working" || sign.tone === "paused" || sign.tone === "attention";
  return (
    <span className="vf-history-sign-face">
      {sign.tone !== "rest" && (
        <svg
          className="vf-history-sign-rim"
          viewBox="0 0 40 40"
          width={40}
          height={40}
          aria-hidden="true"
        >
          {sign.steps.map((step, index) => {
            const from = index * 90 + RIM.gap / 2;
            const to = (index + 1) * 90 - RIM.gap / 2;
            const fill = quarterFill(step);
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: the four quarters are the four steps, in order
              <g key={index} data-step={step.state}>
                <path d={rimArc(from, to)} className="vf-history-sign-track" />
                {fill > 0.004 && (
                  <path
                    d={rimArc(from, from + (to - from) * fill)}
                    className="vf-history-sign-fill"
                  />
                )}
              </g>
            );
          })}
        </svg>
      )}
      <span
        className="vf-history-sign-glyph"
        {...(importing ? { "data-importing": "" } : {})}
        {...(sign.tone === "working" ? { "data-turning": "" } : {})}
      >
        <FieldGlyph name="history" size={18} />
        {importing && <FieldGlyph name="importing" size={18} className="vf-history-sign-arc" />}
      </span>
      {sign.attention !== null && (
        <span className="vf-history-sign-dot" data-attention={sign.attention} aria-hidden="true" />
      )}
    </span>
  );
}

/* ── the panel ──────────────────────────────────────────────────────────── */

function SignPanel({
  sign,
  onOpenSettings,
  unread,
  now,
}: {
  sign: ImportSign;
  onOpenSettings?: (() => void) | undefined;
  unread?: UnreadAgents | undefined;
  now: number;
}): ReactElement {
  const unreadRows = unread !== undefined && unread.rows.length > 0;
  return (
    <>
      <header className="vf-history-sign-head">
        <span className="vf-history-sign-eye">{sign.eyebrow}</span>
        <h2 className="vf-history-sign-title">{sign.title}</h2>
        {sign.count !== null && <p className="vf-history-sign-count">{sign.count}</p>}
        {sign.tone === "rest" && <p className="vf-history-sign-detail">{sign.detail}</p>}
      </header>
      <section className="vf-history-sign-section" aria-label="What you can do now">
        <h3 className="vf-history-sign-eye">What you can do now</h3>
        <ol className="vf-history-sign-steps">
          {sign.steps.map((step) => (
            <StepRow key={step.opens} step={step} turning={sign.tone === "working"} />
          ))}
        </ol>
      </section>
      {(sign.agents.length > 0 || unreadRows) && (
        <AgentRows sign={sign} unread={unread} now={now} />
      )}
      {sign.space !== null && <SpaceRows space={sign.space} />}
      {onOpenSettings !== undefined && (
        <div className="vf-history-sign-acts">
          <button type="button" className="vf-menu-row" onClick={onOpenSettings}>
            <span className="vf-menu-ico" aria-hidden="true">
              <FieldGlyph name="gear" size={16} />
            </span>
            <span className="vf-menu-label">History Settings…</span>
          </button>
        </div>
      )}
      <footer className="vf-history-sign-foot">
        <span>{sign.footer}</span>
        {sign.elapsed !== null && <span>{sign.elapsed}</span>}
      </footer>
    </>
  );
}

/** A colourless hairline (HG-W3): the ramp's t2 over the strong hairline, only for a fraction the step knows. */
function Hairline({ fraction, label }: { fraction: number; label: string }): ReactElement {
  const share = Math.max(0, Math.min(1, fraction));
  return (
    <span
      className="vf-history-sign-hairline"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.floor(share * 100)}
    >
      <i style={{ width: `${(share * 100).toFixed(1)}%` }} />
    </span>
  );
}

function StepRow({ step, turning }: { step: ImportSignStep; turning: boolean }): ReactElement {
  return (
    <li className="vf-history-sign-step" data-state={step.state}>
      <StepMark step={step} turning={turning} />
      <span className="vf-history-sign-step-opens">{step.opens}</span>
      <span className="vf-history-sign-figure">{step.figure}</span>
      {step.state === "current" && (step.fraction !== null || step.lines.length > 0) && (
        <span className="vf-history-sign-step-under">
          {step.fraction !== null && <Hairline fraction={step.fraction} label={step.opens} />}
          {step.lines.map((line) => (
            <span key={line} className="vf-history-sign-line">
              {line}
            </span>
          ))}
        </span>
      )}
    </li>
  );
}

/** A step's mark: ticked once done, a ring filling (or the arc turning) while current, a dashed ring before. */
function StepMark({ step, turning }: { step: ImportSignStep; turning: boolean }): ReactElement {
  if (step.state === "done") {
    return (
      <span className="vf-history-sign-step-mark" data-state="done" aria-hidden="true">
        <FieldGlyph name="check" size={10} />
      </span>
    );
  }
  if (step.state === "later") {
    return <span className="vf-history-sign-step-mark" data-state="later" aria-hidden="true" />;
  }
  const fill = step.fraction;
  return (
    <span className="vf-history-sign-step-mark" data-state="current" aria-hidden="true">
      <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden="true">
        <circle cx={8} cy={8} r={6.5} className="vf-history-sign-track" />
        {fill === null ? (
          <path
            d="M8 1.5A6.5 6.5 0 0 1 14.18 5.99"
            className="vf-history-sign-fill vf-history-sign-step-arc"
            {...(turning ? { "data-turning": "" } : {})}
          />
        ) : (
          fill > 0.004 && (
            <circle
              cx={8}
              cy={8}
              r={6.5}
              className="vf-history-sign-fill"
              pathLength={100}
              strokeDasharray={`${(Math.min(fill, 1) * 100).toFixed(1)} 100`}
              transform="rotate(-90 8 8)"
            />
          )
        )}
      </svg>
    </span>
  );
}

function AgentMarkOf({ kind }: { kind: string }): ReactElement {
  const id = catalogIdForKind(kind);
  return (
    <span className="vf-history-sign-agent-mark" aria-hidden="true">
      {id === undefined ? <FieldGlyph name="agents" size={14} /> : <AgentIcon providerId={id} />}
    </span>
  );
}

function AgentRows({
  sign,
  unread,
  now,
}: {
  sign: ImportSign;
  unread?: UnreadAgents | undefined;
  now: number;
}): ReactElement {
  const working = sign.agents.filter((agent) => agent.state !== "done" && agent.state !== "live");
  const done = sign.agents.filter((agent) => agent.state === "done" || agent.state === "live");
  const resting = sign.tone === "rest";
  return (
    <section className="vf-history-sign-section" aria-label="Agents">
      <h3 className="vf-history-sign-eye">
        Agents
        <span>
          {done.length} of {sign.agents.length} done
        </span>
      </h3>
      {working.map((agent) => (
        <AgentRow key={agent.runtimeId || agent.kind} agent={agent} />
      ))}
      {resting
        ? done.map((agent) => (
            <div key={agent.runtimeId || agent.kind} className="vf-history-sign-agent">
              <AgentMarkOf kind={agent.kind} />
              <span className="vf-history-sign-agent-name">{agent.name}</span>
              <span className="vf-history-sign-figure">{agent.lastNew ?? agent.figure}</span>
            </div>
          ))
        : done.length > 0 && (
            <div className="vf-history-sign-done">
              <span className="vf-history-sign-done-word">Ready to browse</span>
              {done.map((agent) => (
                <span key={agent.runtimeId || agent.kind} className="vf-history-sign-done-agent">
                  <AgentMarkOf kind={agent.kind} />
                  {agent.name}
                </span>
              ))}
            </div>
          )}
      {unread !== undefined && unread.rows.length > 0 && <UnreadRows unread={unread} now={now} />}
    </section>
  );
}

/** HD-7 — the agents with past sessions on this Mac that History does not read: each with the census's facts and
 * the switch that brings it in. A switch that is on stays on, so a row here is only ever off, or being taken. */
function UnreadRows({ unread, now }: { unread: UnreadAgents; now: number }): ReactElement {
  return (
    <div className="vf-history-sign-unread">
      <span className="vf-history-sign-unread-word">Not in History</span>
      {unread.rows.map((row) => (
        <div key={row.kind} className="vf-history-sign-agent" data-state="unread">
          <AgentMarkOf kind={row.kind} />
          <span className="vf-history-sign-agent-name">{row.label}</span>
          <UiSwitch
            label={`Bring in ${row.label}'s history`}
            checked={unread.bringing === row.kind}
            disabled={unread.bringing !== null}
            onChange={(on) => {
              if (on) unread.onBringIn(row.kind);
            }}
          />
          <span className="vf-history-sign-agent-under">
            <span className="vf-history-sign-line">
              {formatBytes(row.bytes)} · last used {lastUsedWords(row.newestModifiedMs, now)}
            </span>
          </span>
        </div>
      ))}
      {unread.error !== null && (
        <p className="vf-history-sign-unread-error" role="alert">
          {unread.error}
        </p>
      )}
    </div>
  );
}

function AgentRow({ agent }: { agent: ImportSignAgent }): ReactElement {
  return (
    <div className="vf-history-sign-agent" data-state={agent.state}>
      <AgentMarkOf kind={agent.kind} />
      <span className="vf-history-sign-agent-name">{agent.name}</span>
      <span className="vf-history-sign-figure">{agent.figure}</span>
      <span className="vf-history-sign-agent-under">
        <span className="vf-history-sign-line">{agent.caption}</span>
        {agent.fraction !== null && agent.state !== "queued" && (
          <Hairline fraction={agent.fraction} label={`${agent.name}: ${agent.caption}`} />
        )}
      </span>
    </div>
  );
}

function SpaceRows({ space }: { space: ImportSignSpace }): ReactElement {
  return (
    <section className="vf-history-sign-section" aria-label="On this Mac">
      <h3 className="vf-history-sign-eye">On this Mac</h3>
      <HistorySpace space={space} />
    </section>
  );
}
