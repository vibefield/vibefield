import type { ButtonHTMLAttributes, ReactElement, ReactNode } from "react";
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
  className = "",
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}): ReactElement {
  return (
    <fieldset className={`vf-ui-segmented ${className}`.trim()} aria-label={label}>
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

/** A preserving placeholder for content whose backing renderer is unavailable. */
export function UnavailableState({
  title,
  description,
  compact = false,
  className = "",
}: {
  title: ReactNode;
  description: ReactNode;
  compact?: boolean;
  className?: string;
}): ReactElement {
  return (
    <div
      className={`vf-ui-unavailable-state ${className}`.trim()}
      data-compact={compact ? "true" : "false"}
      role="status"
    >
      <strong>{title}</strong>
      <span>{description}</span>
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
