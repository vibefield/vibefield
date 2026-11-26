// EY-1 (2026-11-19) — THE OWNER'S MEASURES, for the landing gate's adapter in testing alone (the walls keep any
// production entry from importing a testing module). Each measure reads a ruled decision on a real desk page, through
// the page's port (browser-electron-native.ts, `browserAgentPortOf`), and answers in the lab's shapes so its case
// tables read them unchanged:
//   isolation (EY-S2-E5): a client drives the page on its own second session, attached to the page itself, and its
//     filterless auto-attach and Page.disable there leave the owner's session as it was. The second session design
//     rests on it. The case reads the owner's holds after.
//   default-auto-attach-filter (EY-S2-E1): what a filterless auto-attach on that second session is given. A page's
//     dedicated worker reaches the agent through the client's own auto-attach, never the owner's.
//   workers (EY-S2-09, BU-22): the page's targets as a client's own session lists them, and the owner's own child
//     sessions as the caller counts them: a count of frames by the owner's own definition (its sessions of the page's
//     frames of other sites, the window's childSessions()). The owner keeps only its frames of other sites, and
//     workers stay the client's.
//   resume-in-dispatch (EY-S2-E2): a frame of another site waiting on the client's own auto-attach, resumed five ways
//     from the attach's handler, one fresh frame each. A resume sent inside the attach's own dispatch stalls the frame;
//     every later resume loads it. The rule it backs: never resume inside the attach's dispatch. The frame also waits
//     on the owner's own attach, which resumes it as that rule says.
// Each opens its own client session and closes it at its end. No measure here names a person, a key or a page's
// contents: counts, types and answers alone.

import { randomBytes } from "node:crypto";
import type {
  BrowserAgentEvent,
  BrowserAgentPort,
  BrowserAgentSession,
} from "../main/live-surfaces/browser-electron-native";

export const OWNER_MEASURES = [
  "isolation",
  "default-auto-attach-filter",
  "workers",
  "resume-in-dispatch",
] as const;
export type OwnerMeasure = (typeof OWNER_MEASURES)[number];

export interface OwnerMeasureOptions {
  /** the lab's probe timeout (1 s): the waits are its halves and multiples */
  readonly probeTimeoutMs?: number;
  /** resume-in-dispatch: a page of another site to frame; without one the variants are not measured */
  readonly frameUrl?: string;
  /** workers: the owner's own child sessions (the window's childSessions()); without it, null */
  readonly ownerChildren?: () => number;
}

/** The lab's five ways to resume a waiting frame, in its order (EY-S2-E2). */
export const RESUME_VARIANTS = [
  "in-dispatch",
  "in-dispatch-then-again",
  "command-then-resume",
  "set-immediate-then-resume",
  "delay-200-then-resume",
] as const;
type ResumeVariant = (typeof RESUME_VARIANTS)[number];

const DEFAULT_PROBE_TIMEOUT_MS = 1_000;
const PROBE_EXPRESSION = { expression: "1 + 1", returnByValue: true, silent: true } as const;
const PROBE_ATTRIBUTE = "data-vf-owner-probe";
const TRUST = "the same trusted Electron debugger client (a second session of the one attach)";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const messageOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, 200);
type Settled =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly error: string };
const settle = (promise: Promise<unknown>): Promise<Settled> =>
  promise.then(
    (result) => ({ ok: true, result }),
    (error: unknown) => ({ ok: false, error: messageOf(error) }),
  );

function countBy(values: readonly unknown[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    const k = typeof v === "string" && v !== "" ? v : "unknown";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

const infoOf = (event: BrowserAgentEvent): { type?: unknown; url?: unknown; targetId?: unknown } =>
  (event.params["targetInfo"] ?? {}) as { type?: unknown; url?: unknown; targetId?: unknown };

/** One measure, on a fresh client session of the page, closed at its end. */
export async function ownerMeasure(
  port: BrowserAgentPort,
  what: OwnerMeasure,
  o: OwnerMeasureOptions = {},
): Promise<Record<string, unknown>> {
  if (!(OWNER_MEASURES as readonly string[]).includes(what)) {
    throw new Error(`owner-measure: no measure named ${String(what)}`);
  }
  const timeout = o.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new TypeError("owner-measure: probeTimeoutMs must be > 0");
  }
  let session: BrowserAgentSession;
  try {
    session = await port.openClientSession();
  } catch (error) {
    if (what === "isolation") return { separateSession: false, error: messageOf(error) };
    throw new Error(`owner-measure: no client session to measure on (${messageOf(error)})`);
  }
  try {
    switch (what) {
      case "isolation":
        return await isolation(session, timeout);
      case "default-auto-attach-filter":
        return await defaultFilter(session, timeout);
      case "workers":
        return await workers(session, o);
      default:
        return await resumeInDispatch(session, timeout, o.frameUrl);
    }
  } finally {
    if (what !== "isolation") await session.close().catch(() => undefined);
  }
}

async function isolation(
  session: BrowserAgentSession,
  timeout: number,
): Promise<Record<string, unknown>> {
  const probe = await settle(session.send("Runtime.evaluate", PROBE_EXPRESSION));
  const autoAttach = await settle(
    session.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    }),
  );
  const pageDisable = await settle(session.send("Page.disable", {}));
  if (autoAttach.ok) await sleep(timeout / 2);
  const closed = await settle(session.close());
  const value = probe.ok
    ? (probe.result as { result?: { value?: unknown } } | undefined)?.result?.value
    : undefined;
  return {
    separateSession: true,
    sessionWorks: value === 2,
    onIsolated: {
      setAutoAttachAnswered: autoAttach.ok,
      pageDisableAnswered: pageDisable.ok,
      ...(autoAttach.ok ? {} : { setAutoAttachError: autoAttach.error }),
      ...(pageDisable.ok ? {} : { pageDisableError: pageDisable.error }),
    },
    trust: TRUST,
    detached: closed.ok,
    ...(closed.ok ? {} : { detachError: closed.error }),
  };
}

async function defaultFilter(
  session: BrowserAgentSession,
  timeout: number,
): Promise<Record<string, unknown>> {
  const seen: unknown[] = [];
  const off = session.onEvent((event) => {
    if (event.method === "Target.attachedToTarget" && event.child === undefined) {
      seen.push(infoOf(event).type);
    }
  });
  try {
    const set = await settle(
      session.send("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
      }),
    );
    if (set.ok) await sleep(timeout);
    return {
      setAutoAttachOk: set.ok,
      attachedTypes: countBy(seen),
      ...(set.ok ? {} : { error: set.error }),
    };
  } finally {
    off();
  }
}

async function workers(
  session: BrowserAgentSession,
  o: OwnerMeasureOptions,
): Promise<Record<string, unknown>> {
  const targets = await settle(session.send("Target.getTargets", {}));
  const infos = targets.ok
    ? ((targets.result as { targetInfos?: { type?: unknown }[] } | undefined)?.targetInfos ?? [])
    : [];
  return {
    ownerChildren: o.ownerChildren === undefined ? null : o.ownerChildren(),
    targetTypes: targets.ok ? countBy(infos.map((t) => t?.type)) : null,
    ...(targets.ok ? {} : { targetsError: targets.error }),
  };
}

// ---- resume-in-dispatch ----

function probeFrameUrlFor(frameUrl: string, mark: string): string | null {
  try {
    const parsed = new URL(frameUrl);
    parsed.searchParams.set("vf-owner-probe", mark);
    parsed.hash = `vf-owner-probe-${mark}`;
    return parsed.href;
  } catch {
    return null;
  }
}

function probeFrameMatch(info: { type?: unknown; url?: unknown }, mark: string): string | null {
  if (info.type !== "iframe") return null;
  const url = typeof info.url === "string" ? info.url : "";
  if (url.includes(mark)) return "mark";
  if (url === "" || url === "about:blank") return "uncommitted";
  return null;
}

const frameLoadProbeCode = (mark: string, url: string): string =>
  `/* vf-owner-probe:frame-load */ (() => { const f = document.createElement("iframe"); f.style.display = "none"; f.setAttribute(${JSON.stringify(PROBE_ATTRIBUTE)}, ${JSON.stringify(mark)}); f.addEventListener("load", () => f.setAttribute(${JSON.stringify(`${PROBE_ATTRIBUTE}-loaded`)}, "1")); f.src = ${JSON.stringify(url)}; (document.body || document.documentElement).appendChild(f); return true; })()`;
const frameLoadedCode = (mark: string): string =>
  `/* vf-owner-probe:frame-loaded */ (() => { for (const f of document.querySelectorAll("iframe")) { if (f.getAttribute(${JSON.stringify(PROBE_ATTRIBUTE)}) === ${JSON.stringify(mark)}) return f.getAttribute(${JSON.stringify(`${PROBE_ATTRIBUTE}-loaded`)}) === "1"; } return null; })()`;
const frameRemoveCode = (mark: string): string =>
  `/* vf-owner-probe:frame-remove */ (() => { for (const f of document.querySelectorAll("iframe")) { if (f.getAttribute(${JSON.stringify(PROBE_ATTRIBUTE)}) === ${JSON.stringify(mark)}) f.remove(); } return true; })()`;

async function resumeInDispatch(
  session: BrowserAgentSession,
  timeout: number,
  frameUrl: string | undefined,
): Promise<Record<string, unknown>> {
  const versions = {
    electron: process.versions["electron"] ?? null,
    chrome: process.versions["chrome"] ?? null,
  };
  if (typeof frameUrl !== "string" || frameUrl === "") {
    return {
      ...versions,
      measuredVariants: false,
      reason: "no cross-site frame URL to probe with",
    };
  }
  const evaluate = async (expression: string): Promise<unknown> => {
    const answer = (await session.send("Runtime.evaluate", { expression, returnByValue: true })) as
      | { result?: { value?: unknown } }
      | undefined;
    return answer?.result?.value;
  };
  // frames alone, each waiting on the client's own attach as on the owner's
  const set = await settle(
    session.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      filter: [{ type: "iframe" }],
    }),
  );
  if (!set.ok) return { ...versions, measuredVariants: false, reason: set.error };
  const variants: Record<string, Record<string, unknown>> = {};
  for (const variant of RESUME_VARIANTS) {
    variants[variant] = await resumeVariant(session, evaluate, variant, frameUrl, timeout);
  }
  const loaded = (v: ResumeVariant): boolean => variants[v]?.["loaded"] === true;
  const attachedAll = RESUME_VARIANTS.every((v) => variants[v]?.["attached"] === true);
  return {
    ...versions,
    measuredVariants: attachedAll,
    waitMs: timeout * 4,
    variants,
    inDispatchStalls: attachedAll && !loaded("in-dispatch") && !loaded("in-dispatch-then-again"),
    laterResumeLoads:
      attachedAll &&
      loaded("command-then-resume") &&
      loaded("set-immediate-then-resume") &&
      loaded("delay-200-then-resume"),
  };
}

async function resumeVariant(
  session: BrowserAgentSession,
  evaluate: (expression: string) => Promise<unknown>,
  variant: ResumeVariant,
  frameUrl: string,
  timeout: number,
): Promise<Record<string, unknown>> {
  const mark = randomBytes(8).toString("hex");
  const url = probeFrameUrlFor(frameUrl, mark);
  if (url === null) return { attached: false, reason: "the probe frame URL does not parse" };
  const resume = (child: string): Promise<unknown> =>
    session.send("Runtime.runIfWaitingForDebugger", {}, child);
  let first: Promise<Settled> | null = null;
  let attached: { readonly child: string; readonly targetId: unknown } | null = null;
  // called synchronously from the attach's own dispatch: the port says it to its listeners as Electron says it
  const onAttach = (child: string): void => {
    switch (variant) {
      case "in-dispatch":
        first = settle(resume(child));
        break;
      case "in-dispatch-then-again":
        first = settle(resume(child));
        void first.then(() => resume(child).catch(() => undefined));
        break;
      case "command-then-resume":
        first = settle(
          session
            .send("Runtime.enable", {}, child)
            .catch(() => undefined)
            .then(() => resume(child)),
        );
        break;
      case "set-immediate-then-resume":
        first = settle(new Promise((r) => setImmediate(r)).then(() => resume(child)));
        break;
      default:
        first = settle(sleep(200).then(() => resume(child)));
    }
  };
  let seen: () => void = () => undefined;
  const attachedOnce = new Promise<void>((resolve) => {
    seen = resolve;
  });
  const off = session.onEvent((event) => {
    if (
      attached !== null ||
      event.method !== "Target.attachedToTarget" ||
      event.child !== undefined
    )
      return;
    const child = event.params["sessionId"];
    const info = infoOf(event);
    if (typeof child !== "string" || probeFrameMatch(info, mark) === null) return;
    attached = { child, targetId: info.targetId };
    onAttach(child);
    seen();
  });
  const started = Date.now();
  try {
    try {
      await evaluate(frameLoadProbeCode(mark, url));
    } catch (error) {
      return { attached: false, reason: messageOf(error) };
    }
    await Promise.race([attachedOnce, sleep(timeout * 5)]);
    let loadedAfterMs: number | null = null;
    if (attached !== null) {
      const deadline = Date.now() + timeout * 4;
      while (Date.now() < deadline) {
        if ((await evaluate(frameLoadedCode(mark)).catch(() => null)) === true) {
          loadedAfterMs = Date.now() - started;
          break;
        }
        await sleep(50);
      }
    }
    const answer =
      first === null
        ? null
        : await Promise.race([
            first as Promise<Settled>,
            sleep(timeout).then((): Settled => ({ ok: false, error: "no answer" })),
          ]);
    let committed: boolean | null = null;
    const found = attached as { readonly child: string; readonly targetId: unknown } | null;
    if (found !== null && typeof found.targetId === "string") {
      const info = await session.send("Target.getTargetInfo", { targetId: found.targetId }).then(
        (r) => (r as { targetInfo?: { type?: unknown; url?: unknown } } | undefined)?.targetInfo,
        () => undefined,
      );
      committed = info === undefined ? null : probeFrameMatch(info, mark) === "mark";
    }
    await evaluate(frameRemoveCode(mark)).catch(() => undefined);
    return {
      attached: found !== null,
      resumeAnswered: answer === null ? null : answer.ok,
      loaded: loadedAfterMs !== null,
      loadedAfterMs,
      urlCommitted: committed,
    };
  } finally {
    off();
  }
}
