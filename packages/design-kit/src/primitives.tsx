import type { ButtonHTMLAttributes, ReactElement, ReactNode, Ref } from "react";
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

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "regular",
  className = "",
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** `small` (DESIGN.md §8): a switch inside a composition, not heading one. */
  size?: "regular" | "small";
  className?: string;
}): ReactElement {
  return (
    <fieldset
      className={`vf-ui-segmented ${className}`.trim()}
      aria-label={label}
      data-size={size === "small" ? "small" : undefined}
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </fieldset>
  );
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
