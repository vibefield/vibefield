import type { RendererLogger } from "./logging";

// VT-4a (track VT, 2026-11-24) — NOTHING DIES SILENTLY, the product page's half. A script error nobody caught and
// a promise nobody handled went to the page's console, which nothing keeps in a packaged app; four local error
// boundaries were the only faults the log ever heard of. These two listeners say the rest. React reports a render
// error no boundary caught to the same `error` event, so it is heard here too.
//
// They only listen: neither calls `preventDefault`, so the console still shows what it showed. A page that throws
// every frame is said a bounded number of times, then once more that it went on.

/** How many faults one page says in its life before it stops. */
export const PAGE_FAULTS_SAID_MAX = 20;

/** As much of `window` as the listeners use: a test hands its own. */
export interface PageFaultTarget {
  addEventListener(type: "error" | "unhandledrejection", listener: (event: Event) => void): void;
}

/** A script's address as a record may carry it: its last path part, never a query. */
function scriptName(address: unknown): string | undefined {
  if (typeof address !== "string" || address === "") return undefined;
  const path = address.split(/[?#]/)[0] ?? "";
  return (path.split("/").at(-1) ?? "").slice(0, 120) || undefined;
}

/** Hear this page's own faults for the log. Called once, when the host's logger is installed. */
export function hearPageFaults(logger: RendererLogger, target: PageFaultTarget = window): void {
  let said = 0;
  const admit = (): boolean => {
    said += 1;
    if (said === PAGE_FAULTS_SAID_MAX + 1) {
      logger.warn(
        "renderer.page.faults_muted",
        "The page keeps failing; later faults of this page are not said",
        { said: PAGE_FAULTS_SAID_MAX },
      );
    }
    return said <= PAGE_FAULTS_SAID_MAX;
  };
  target.addEventListener("error", (event) => {
    if (!admit()) return;
    const fault = event as Partial<ErrorEvent>;
    const script = scriptName(fault.filename);
    logger.error(
      "renderer.page.uncaught",
      "The page met an error nobody caught",
      fault.error ?? fault.message ?? "an error event with nothing in it",
      {
        ...(script === undefined ? {} : { script }),
        ...(typeof fault.lineno === "number" ? { line: fault.lineno } : {}),
        ...(typeof fault.colno === "number" ? { column: fault.colno } : {}),
      },
    );
  });
  target.addEventListener("unhandledrejection", (event) => {
    if (!admit()) return;
    logger.error(
      "renderer.page.unhandled_rejection",
      "The page left a promise's failure unhandled",
      (event as Partial<PromiseRejectionEvent>).reason ?? "a rejection with no reason",
    );
  });
}
