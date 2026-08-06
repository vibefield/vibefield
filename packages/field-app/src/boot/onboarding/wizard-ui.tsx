import type { ReactElement, ReactNode } from "react";
import { ThemeToggleButton } from "../../ThemeToggleButton";
import { useTheme } from "../../theme";

// The Setup Assistant's chrome (UA-3w; DESIGN.md §3/§7/§8/§9). Deliberately
// its own small vocabulary rather than the settings one: a full-window pane's
// primary action is not a settings-row chip, and the boot bundle should not
// pull the panels module in to borrow a class string.
//
// Type follows §3's inversion — the headline is BIG and LIGHT, the controls are
// small and medium. Color follows §2.5: none of this chrome is a state, so none
// of it carries a hue. The only saturated thing on screen is the accent the
// user picks, which is content.

/** Primary action — the §8 chip canon's inverted solid, at full-window size. */
export const primaryCls =
  "inline-flex h-10 items-center justify-center rounded-full bg-black px-5 text-[13px] font-medium text-white shadow-md transition-[transform,opacity] hover:opacity-90 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vf-select)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--vf-canvas-bg)] disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none dark:bg-white dark:text-black";

/** Quiet action — skips, backs, second thoughts. */
export const quietCls =
  "inline-flex h-10 items-center justify-center rounded-full bg-black/5 px-4 text-[13px] font-medium text-black/65 transition-[background-color,color,transform] hover:bg-black/10 hover:text-black active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vf-select)] disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none dark:bg-white/10 dark:text-white/65 dark:hover:bg-white/15 dark:hover:text-white";

export const eyebrowCls =
  "text-[10px] font-medium uppercase tracking-[0.08em] text-black/50 dark:text-white/50";
export const voiceCls = "text-[14px] leading-[1.45] text-black/70 dark:text-white/70";
export const factCls = "text-[12px] leading-5 text-black/45 dark:text-white/45";

/** One persistent, uniform glass body around every step. The question inside
 * changes; the material and theme control do not resize or remount around it. */
export function WizardShell({ children }: { children: ReactNode }): ReactElement {
  const { dark, toggle } = useTheme();
  return (
    <div className="flex h-full w-full items-center justify-center p-4">
      <div className="vf-wizard-shell">
        <ThemeToggleButton
          dark={dark}
          onToggle={toggle}
          className="no-drag absolute top-5 right-5"
        />
        <div className="vf-wizard-shell-content">{children}</div>
      </div>
    </div>
  );
}

/** One pane: eyebrow, headline, a line of voice, its content, its actions.
 * `key` the caller passes drives the entrance — one container, new content
 * (M1: nothing crossfades with anything). */
export function WizardPane({
  eyebrow,
  title,
  voice,
  children,
  actions,
  onSubmit,
  centered = false,
}: {
  eyebrow: string;
  title: string;
  voice?: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
  /** The opening welcome is intentionally quieter than the question panes. */
  centered?: boolean;
  /** Enter advances: the primary action is the form's submit button, so the
   * keyboard path is the same object as the pointer path. */
  onSubmit?: () => void;
}): ReactElement {
  return (
    <form
      className={`vf-wizard-pane flex w-full max-w-[30rem] flex-col gap-5 ${
        centered ? "items-center text-center" : ""
      }`}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      <div className={`flex flex-col gap-2 ${centered ? "items-center" : ""}`}>
        <span className={eyebrowCls}>{eyebrow}</span>
        <h1 className="text-[28px] font-light leading-[1.15] tracking-[-0.02em] text-black dark:text-white">
          {title}
        </h1>
        {voice !== undefined && <p className={voiceCls}>{voice}</p>}
      </div>
      {children}
      <div className={`flex flex-wrap items-center gap-2 pt-1 ${centered ? "justify-center" : ""}`}>
        {actions}
      </div>
    </form>
  );
}

/** Every skip names its later home (W3) — this subtitle is verbatim spec. */
export function SkipAction({ label, onSkip }: { label: string; onSkip: () => void }): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <button type="button" className={quietCls} onClick={onSkip}>
        {label}
      </button>
      <span className={factCls}>Set up later — Settings → Account</span>
    </div>
  );
}

/** An error that holds its pane: what happened, and what to do next (§9). */
export function WizardError({ reason }: { reason: string }): ReactElement {
  return (
    <p className="text-[12px] leading-5 text-amber-600 dark:text-amber-400" role="alert">
      {reason}
    </p>
  );
}

/** The wizard's own stylesheet, mounted once with it (the splash/tray
 * precedent). M6: the rise becomes a plain fade at half the duration. */
export function WizardStyles(): ReactElement {
  return (
    <style>{`
      .vf-wizard-shell {
        position: relative;
        overflow: hidden;
        width: min(calc(100vw - 2rem), 44rem);
        height: min(calc(100vh - 2rem), 32rem);
        padding: clamp(2rem, 5vw, 4rem);
        border: 1px solid rgba(0, 0, 0, 0.05);
        border-radius: 32px;
        background: rgba(255, 255, 255, 0.55);
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.08);
        -webkit-backdrop-filter: blur(32px) saturate(1.12);
        backdrop-filter: blur(32px) saturate(1.12);
      }
      .vf-wizard-shell-content {
        display: flex;
        width: 100%;
        height: 100%;
        align-items: center;
        justify-content: center;
        overflow-y: auto;
      }
      .vf-wizard-pane {
        animation: vf-wizard-in 320ms cubic-bezier(0.25, 1, 0.3, 1) both;
      }
      .dark .vf-wizard-shell {
        border-color: rgba(255, 255, 255, 0.1);
        background: rgba(28, 28, 30, 0.55);
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
      }
      @keyframes vf-wizard-in {
        from { opacity: 0; transform: translateY(6px); }
        to { opacity: 1; transform: none; }
      }
      @media (prefers-reduced-motion: reduce) {
        .vf-wizard-pane { animation: vf-wizard-fade 160ms ease both; }
        @keyframes vf-wizard-fade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      }
    `}</style>
  );
}
