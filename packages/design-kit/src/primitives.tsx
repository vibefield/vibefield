import {
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefCallback,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";
import "./primitives.css";

export const uiLabelClass = "vf-ui-label";
export const uiFieldClass = "vf-ui-field";
export const uiButtonClass = "vf-ui-button";
export const uiIconButtonClass = "vf-ui-icon-button";

export type UiButtonVariant = "quiet" | "primary" | "danger";

export function UiButton({
  variant = "quiet",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: UiButtonVariant;
  /** React 19 hands `ref` to a function component as a prop; it reaches the
   * button with the rest, so a caller can move focus to it (a menu's trigger
   * on close, a confirm's act when it arms). */
  ref?: Ref<HTMLButtonElement> | undefined;
}): ReactElement {
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      className={`${uiButtonClass} ${className}`.trim()}
      data-variant={variant}
    />
  );
}

export function UiIconButton({
  active = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
}): ReactElement {
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      className={`${uiIconButtonClass} ${className}`.trim()}
      data-active={active ? "true" : "false"}
    />
  );
}

export function UiSwitch({
  checked,
  disabled = false,
  onChange,
  label,
  className = "",
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  className?: string;
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`vf-ui-switch ${className}`.trim()}
    >
      <span aria-hidden="true" className="vf-ui-switch__thumb" />
    </button>
  );
}

export function UiPill({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return <span className={`vf-ui-pill ${className}`.trim()}>{children}</span>;
}

/**
 * One segment of a `SegmentedControl` (R19, DK-13): its `id` — what `value` and `onChange` speak — and what it
 * shows, which need not be the id (a filter's `""` reads "All"). A bare string is both, as before.
 */
export interface SegmentedOption<T extends string> {
  readonly id: T;
  readonly label: ReactNode;
  /** The segment's tooltip, when it says more than its label. */
  readonly title?: string;
}

export type SegmentedEntry<T extends string> = T | SegmentedOption<T>;

const segmentOf = <T extends string>(entry: SegmentedEntry<T>): SegmentedOption<T> =>
  typeof entry === "string" ? { id: entry, label: entry } : entry;

/** The keys that choose (R19): ← → one segment over, Home End the ends — never wrapping. */
export function segmentForKey(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowLeft":
      return index < 0 ? 0 : Math.max(0, index - 1);
    case "ArrowRight":
      return index < 0 ? 0 : Math.min(count - 1, index + 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * The segmented control (DESIGN.md §8 "Segmented control"; R19 — EXTENDED at DK-13): a full-round track and a
 * sliding solid THUMB (its own element, under the chosen segment, sliding 300 ms on the island curve — none under
 * reduced motion); options whose ids are distinct from their labels; ← → Home End choosing, the chosen segment the
 * group's one stop of Tab. Until the thumb has been placed (it measures the chosen segment — no layout, no
 * measure) the chosen segment wears the thumb's look itself, so a control is never drawn without its choice.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "regular",
  className = "",
  ref,
}: {
  options: readonly SegmentedEntry<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** `small` (DESIGN.md §8): a switch inside a composition, not heading one. */
  size?: "regular" | "small";
  className?: string;
  /** The track itself (a composition that scrolls it reads its scroll — the pegboard's filters, DK-13). */
  ref?: Ref<HTMLFieldSetElement> | undefined;
}): ReactElement {
  const segments = options.map(segmentOf);
  const chosen = segments.findIndex((segment) => segment.id === value);
  const track = useRef<HTMLFieldSetElement | null>(null);
  const thumb = useRef<HTMLSpanElement | null>(null);
  const setTrack = useCallback<RefCallback<HTMLFieldSetElement>>(
    (el) => {
      track.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref !== null && ref !== undefined)
        (ref as { current: HTMLFieldSetElement | null }).current = el;
    },
    [ref],
  );
  const ids = `${segments.length}:${segments.map((segment) => segment.id).join("\u0000")}`;

  // THE THUMB: placed under the chosen segment from its measured box — at once the first time (no slide in from
  // the track's start), sliding after; re-placed when the track or a segment changes size (a label, a font).
  useLayoutEffect(() => {
    const el = track.current;
    const t = thumb.current;
    if (el === null || t === null || ids === "0:") return;
    const place = (): void => {
      const on =
        chosen < 0 ? undefined : el.querySelectorAll<HTMLElement>(":scope > button")[chosen];
      if (on === undefined || on.offsetWidth === 0) {
        delete el.dataset["thumb"];
        return;
      }
      t.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`;
      t.style.width = `${on.offsetWidth}px`;
      t.style.height = `${on.offsetHeight}px`;
      if (el.dataset["thumb"] !== "placed") {
        t.style.transition = "none";
        el.dataset["thumb"] = "placed";
        void t.offsetWidth;
        t.style.transition = "";
      }
    };
    place();
    if (typeof ResizeObserver === "undefined") return;
    const resize = new ResizeObserver(place);
    resize.observe(el);
    for (const button of el.querySelectorAll(":scope > button")) resize.observe(button);
    return () => resize.disconnect();
  }, [chosen, ids]);

  const onKeyDown = (event: KeyboardEvent<HTMLFieldSetElement>): void => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const el = track.current;
    const all = el === null ? [] : [...el.querySelectorAll<HTMLButtonElement>(":scope > button")];
    // from the segment the focus is on (the selection follows the focus, as a radio's does — a value an owner has
    // not yet handed back still moves on from where the keys left it), else from the choice
    const focused = all.indexOf(event.target as HTMLButtonElement);
    const from = focused >= 0 ? focused : chosen;
    const next = segmentForKey(event.key, from, segments.length);
    if (next === null) return;
    event.preventDefault();
    const segment = segments[next];
    if (segment === undefined) return;
    const button = all[next];
    button?.focus({ preventScroll: true });
    if (el !== null && button !== undefined) revealSegment(el, button);
    if (next !== from || segment.id !== value) onChange(segment.id);
  };

  return (
    <fieldset
      ref={setTrack}
      className={`vf-ui-segmented ${className}`.trim()}
      aria-label={label}
      data-size={size === "small" ? "small" : undefined}
      onKeyDown={onKeyDown}
    >
      <span ref={thumb} className="vf-ui-segmented-thumb" aria-hidden="true" />
      {segments.map((segment, index) => (
        <button
          key={segment.id}
          type="button"
          data-id={segment.id}
          aria-pressed={value === segment.id}
          tabIndex={index === chosen || (chosen < 0 && index === 0) ? 0 : -1}
          title={segment.title}
          onClick={(event) => {
            revealSegment(event.currentTarget.parentElement, event.currentTarget);
            onChange(segment.id);
          }}
        >
          {segment.label}
        </button>
      ))}
    </fieldset>
  );
}

/** A track that scrolls (past its width) brings a chosen segment into view inside itself — never the page. */
function revealSegment(track: HTMLElement | null, button: HTMLElement): void {
  if (track === null || track.scrollWidth <= track.clientWidth) return;
  const left = button.offsetLeft;
  const right = left + button.offsetWidth;
  const pad = 12;
  if (left - pad < track.scrollLeft) track.scrollLeft = Math.max(0, left - pad);
  else if (right + pad > track.scrollLeft + track.clientWidth)
    track.scrollLeft = right + pad - track.clientWidth;
}

export function PlaceholderFace({ className = "" }: { className?: string }): ReactElement {
  return <span className={`vf-ui-placeholder-face ${className}`.trim()} aria-hidden="true" />;
}

export function EmptyState({
  title,
  description,
  visual,
  actions,
  className = "",
}: {
  title: ReactNode;
  description: ReactNode;
  visual?: ReactNode;
  actions?: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div className={`vf-ui-empty-state ${className}`.trim()}>
      {visual !== undefined && <div className="vf-ui-empty-state__visual">{visual}</div>}
      <strong className="vf-ui-empty-state__title">{title}</strong>
      <span className="vf-ui-empty-state__description">{description}</span>
      {actions !== undefined && <div className="vf-ui-empty-state__actions">{actions}</div>}
    </div>
  );
}

/** A preserving placeholder for content whose backing renderer is unavailable.
 *
 * DESIGN.md §8 "When the desk can't draw" (R18, DK-3) extends it for a whole view that cannot draw:
 * `card` is the 380-wide variant — centred on its ground, corners 22, padded 26 26 22, what happened
 * at 14/600 and what to do at 12.5/400 — with an `action` slot (one act: the desk's Reload, a
 * primary 36 tall) and a `detail` slot, last and small (11 mono, faint, 12 below): the renderer's
 * own words, verbatim. */
export function UnavailableState({
  title,
  description,
  compact = false,
  card = false,
  action,
  detail,
  className = "",
}: {
  title: ReactNode;
  description: ReactNode;
  compact?: boolean;
  /** The 380-wide card a whole view shows when it cannot draw (DESIGN.md §8, R18). */
  card?: boolean;
  /** The one act under the words — the primary `UiButton` (a Reload). */
  action?: ReactNode;
  /** The renderer's own message, verbatim, last and small. */
  detail?: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div
      className={`vf-ui-unavailable-state ${className}`.trim()}
      data-compact={compact ? "true" : "false"}
      {...(card ? { "data-card": "true" } : {})}
      role="status"
    >
      <strong>{title}</strong>
      <span>{description}</span>
      {action === undefined ? null : (
        <div className="vf-ui-unavailable-state__action">{action}</div>
      )}
      {detail === undefined ? null : <p className="vf-ui-unavailable-state__detail">{detail}</p>}
    </div>
  );
}

export function InlineNotice({
  children,
  tone = "neutral",
  className = "",
  role,
}: {
  children: ReactNode;
  tone?: "neutral" | "attention" | "error";
  className?: string;
  role?: "alert" | "status";
}): ReactElement {
  return (
    <div className={`vf-ui-inline-notice ${className}`.trim()} data-tone={tone} role={role}>
      {children}
    </div>
  );
}

export function StatusDot({
  tone = "muted",
  className = "",
}: {
  tone?: "muted" | "healthy" | "attention" | "error";
  className?: string;
}): ReactElement {
  return (
    <span className={`vf-ui-status-dot ${className}`.trim()} data-tone={tone} aria-hidden="true" />
  );
}
