/**
 * Shell chrome overlaying the monitor stage — at GT-3m, the mock label.
 *
 * It is rendered BESIDE the active view rather than inside it, so a view that
 * cares about the space it occupies finds it through this marker instead of by
 * knowing what the chrome is. The swarm keeps bubbles from behind it; a
 * scrolling view clears it with `--vf-monitor-chrome-height`. A view that does
 * not care simply never looks.
 *
 * The reference's chrome is its account-usage panel, which is AR-side work here
 * (design-04 §8's usage story rides the agent track). The marker ports anyway
 * because the mock LABEL is chrome by the same definition — it must not be
 * drawn over, and GT-D13 makes it non-negotiable furniture rather than a
 * decoration a view may ignore.
 */
export const MONITOR_STAGE_CLASS = "vf-godview-monitor-stage";
export const MONITOR_CHROME_ATTRIBUTE = "data-monitor-chrome";
export const MONITOR_CHROME_SELECTOR = `[${MONITOR_CHROME_ATTRIBUTE}]`;

/** Chrome elements sharing a stage with `viewRoot`, in stage coordinates. */
export function monitorChromeElements(viewRoot: HTMLElement): HTMLElement[] {
  const stage = viewRoot.closest(`.${MONITOR_STAGE_CLASS}`) ?? viewRoot;
  return [...stage.querySelectorAll<HTMLElement>(MONITOR_CHROME_SELECTOR)];
}
