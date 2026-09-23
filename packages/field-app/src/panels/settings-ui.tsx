import { UiPill, UiSwitch, uiButtonClass, uiFieldClass, uiLabelClass } from "@vibefield/design-kit";
import type { ReactElement, ReactNode } from "react";

/** Shared settings-surface vocabulary. These are app chrome, so hierarchy is
 * expressed through the light/dark text-opacity ramp rather than fixed greys. */
export const labelCls = uiLabelClass;
export const borderCls =
  "rounded-[18px] border border-black/5 bg-black/[0.018] p-4 dark:border-white/10 dark:bg-white/[0.025]";
export const fieldCls = uiFieldClass;
export const buttonCls = uiButtonClass;

export function SettingsSection({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: ReactNode;
  /** A section-level act beside the title — a button, never a bare link (pass 16). */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}): ReactElement {
  const heading = (
    <>
      <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-black/85 dark:text-white/85">
        {title}
      </h3>
      {description !== undefined && <p className={`mt-0.5 ${labelCls}`}>{description}</p>}
    </>
  );
  return (
    <section className={`${borderCls} ${className}`}>
      {action === undefined ? (
        <div className="mb-3">{heading}</div>
      ) : (
        <div className="mb-3 flex items-center justify-between gap-4">
          <div className="min-w-0">{heading}</div>
          <div className="flex shrink-0 items-center gap-2">{action}</div>
        </div>
      )}
      {children}
    </section>
  );
}

export function SettingsRow({
  title,
  description,
  children,
  divider = true,
  align = "center",
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  divider?: boolean;
  align?: "center" | "start";
}): ReactElement {
  return (
    <div
      className={`vf-settings-row flex min-h-14 gap-5 py-3 ${align === "start" ? "items-start" : "items-center"} ${
        divider ? "border-b border-black/5 last:border-b-0 dark:border-white/10" : ""
      }`}
    >
      <div className="vf-settings-row-copy min-w-0 flex-1">
        <div className="text-[13px] font-medium leading-5 text-black/80 dark:text-white/80">
          {title}
        </div>
        {description !== undefined && (
          <div className={`mt-0.5 max-w-[56ch] ${labelCls}`}>{description}</div>
        )}
      </div>
      <div className="vf-settings-row-control flex shrink-0 items-center justify-end">
        {children}
      </div>
    </div>
  );
}

export function SettingsSwitch({
  checked,
  disabled = false,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}): ReactElement {
  return <UiSwitch checked={checked} disabled={disabled} onChange={onChange} label={label} />;
}

export function SettingsPill({ children }: { children: ReactNode }): ReactElement {
  return <UiPill>{children}</UiPill>;
}
