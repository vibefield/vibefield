import type { ReactElement, ReactNode } from "react";

/** Shared settings-surface vocabulary. These are app chrome, so hierarchy is
 * expressed through the light/dark text-opacity ramp rather than fixed greys. */
export const labelCls = "text-[12px] leading-5 text-black/45 dark:text-white/45";
export const borderCls =
  "rounded-[18px] border border-black/5 bg-black/[0.018] p-4 dark:border-white/10 dark:bg-white/[0.025]";
export const fieldCls =
  "h-9 min-w-0 rounded-[9px] border border-black/10 bg-white px-3 text-[13px] text-black/80 outline-none transition-[border-color,box-shadow,background-color] placeholder:text-black/30 focus:border-black/25 focus:shadow-[0_0_0_3px_rgba(0,0,0,0.05)] disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-white/[0.06] dark:text-white/85 dark:placeholder:text-white/30 dark:focus:border-white/25 dark:focus:shadow-[0_0_0_3px_rgba(255,255,255,0.07)]";
export const buttonCls =
  "inline-flex h-9 items-center justify-center rounded-full bg-black/5 px-3.5 text-[12px] font-medium text-black/65 transition-[background-color,color,transform] hover:bg-black/10 hover:text-black active:scale-95 disabled:pointer-events-none disabled:opacity-40 dark:bg-white/10 dark:text-white/65 dark:hover:bg-white/15 dark:hover:text-white";

export function SettingsSection({
  title,
  description,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <section className={`${borderCls} ${className}`}>
      <div className="mb-3">
        <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-black/85 dark:text-white/85">
          {title}
        </h3>
        {description !== undefined && <p className={`mt-0.5 ${labelCls}`}>{description}</p>}
      </div>
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
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? "bg-black dark:bg-white" : "bg-black/15 dark:bg-white/20"
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-200 dark:bg-neutral-900 ${
          checked ? "translate-x-[19px]" : "translate-x-[3px]"
        }`}
      />
    </button>
  );
}

export function SettingsPill({ children }: { children: ReactNode }): ReactElement {
  return (
    <span className="rounded-full bg-black/5 px-2 py-0.5 text-[10px] font-medium text-black/45 dark:bg-white/10 dark:text-white/45">
      {children}
    </span>
  );
}
