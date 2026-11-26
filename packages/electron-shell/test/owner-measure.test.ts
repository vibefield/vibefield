// EY-1 (2026-11-19) — the owner's measures for the landing gate (EY-S2-E5, E1, 09, E2), on a fake port: each opens a
// client session of its own and closes it; isolation's second session answers and takes a filterless auto-attach and
// Page.disable; the default filter's attaches are counted; workers lists the page's targets and the owner's children
// as the caller counts them; and the resume measure resumes inside the attach's dispatch for its first two variants and
// later for the rest, reading which frames loaded.
import { describe, expect, it } from "vitest";
import type {
  BrowserAgentEvent,
  BrowserAgentPort,
  BrowserAgentSession,
} from "../src/main/live-surfaces/browser-electron-native";
import { type OwnerMeasure, ownerMeasure } from "../src/testing/owner-measure";

interface Sent {
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly child?: string;
  readonly inDispatch: boolean;
}

/** A page whose frames load only when their first resume came outside the attach's dispatch (EY-S2-E2's finding). */
function fakePort(
  o: {
    readonly refuse?: boolean;
    readonly targets?: readonly { readonly type: string }[];
    readonly attachOnAutoAttach?: readonly string[];
  } = {},
) {
  const sent: Sent[] = [];
  const listeners = new Set<(event: BrowserAgentEvent) => void>();
  const firstResume = new Map<string, boolean>();
  const childOfMark = new Map<string, string>();
  let dispatching = false;
  let closes = 0;
  let opened = 0;
  let n = 0;
  const emit = (event: BrowserAgentEvent): void => {
    dispatching = true;
    try {
      for (const listener of [...listeners]) listener(event);
    } finally {
      dispatching = false;
    }
  };
  const attach = (type: string, url = ""): string => {
    n += 1;
    const child = `C-${n}`;
    emit({
      method: "Target.attachedToTarget",
      params: {
        sessionId: child,
        targetInfo: { targetId: `F-${n}`, type, url },
        waitingForDebugger: true,
      },
    });
    return child;
  };
  const session: BrowserAgentSession = {
    id: "S-client",
    send: async (method, params, child) => {
      sent.push({
        method,
        params,
        ...(child === undefined ? {} : { child }),
        inDispatch: dispatching,
      });
      if (
        method === "Runtime.runIfWaitingForDebugger" &&
        child !== undefined &&
        !firstResume.has(child)
      ) {
        firstResume.set(child, dispatching);
      }
      if (method === "Runtime.evaluate") {
        const expression = String(params["expression"]);
        if (expression === "1 + 1") return { result: { type: "number", value: 2 } };
        const load = /vf-owner-probe:frame-load[\s\S]*?vf-owner-probe=([0-9a-f]+)/.exec(expression);
        if (load?.[1] !== undefined) {
          childOfMark.set(
            load[1],
            attach("iframe", `https://b.test/frame?vf-owner-probe=${load[1]}`),
          );
          return { result: { value: true } };
        }
        const loaded = /vf-owner-probe:frame-loaded[\s\S]*?=== "([0-9a-f]+)"/.exec(expression);
        if (loaded?.[1] !== undefined) {
          return { result: { value: firstResume.get(childOfMark.get(loaded[1]) ?? "") === false } };
        }
        return { result: { value: true } };
      }
      if (method === "Target.setAutoAttach") {
        for (const type of o.attachOnAutoAttach ?? []) attach(type);
        return {};
      }
      if (method === "Target.getTargets") return { targetInfos: o.targets ?? [] };
      if (method === "Target.getTargetInfo") {
        const mark = [...childOfMark.keys()].at(-1) ?? "";
        return {
          targetInfo: { type: "iframe", url: `https://b.test/frame?vf-owner-probe=${mark}` },
        };
      }
      return {};
    },
    onEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: async () => {
      closes += 1;
    },
    closed: new Promise(() => {}),
  };
  const port: BrowserAgentPort = {
    targetId: "DEVTOOLS-A",
    openClientSession: async () => {
      if (o.refuse === true) throw new Error("refused: the page has no debugger");
      opened += 1;
      return session;
    },
    captureScale: () => 1,
    info: () => ({ url: "https://a.test/", title: "A" }),
    onDetach: () => () => {},
    pin: () => ({ applied: Promise.resolve("applied"), release: () => {} }),
    framesHoldFocus: () => false,
    viewImagePoint: (p) => p,
  };
  return {
    port,
    sent,
    firstResume,
    counts: () => ({ opened, closes }),
  };
}

const FAST = { probeTimeoutMs: 20 };

describe("the owner's measures (EY-1 1d, for the landing gate)", () => {
  it("isolation: a second session of the client's own answers, takes a filterless auto-attach and Page.disable, and is closed", async () => {
    const f = fakePort();
    const r = await ownerMeasure(f.port, "isolation", FAST);
    expect(r).toMatchObject({
      separateSession: true,
      sessionWorks: true,
      onIsolated: { setAutoAttachAnswered: true, pageDisableAnswered: true },
      detached: true,
    });
    expect(f.sent.map((s) => s.method)).toEqual([
      "Runtime.evaluate",
      "Target.setAutoAttach",
      "Page.disable",
    ]);
    expect(f.sent[1]?.params).toEqual({
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
    expect(f.counts()).toEqual({ opened: 1, closes: 1 });
  });

  it("isolation with no second session says so", async () => {
    const r = await ownerMeasure(fakePort({ refuse: true }).port, "isolation", FAST);
    expect(r["separateSession"]).toBe(false);
    expect(String(r["error"])).toContain("refused");
  });

  it("default-auto-attach-filter counts what a filterless auto-attach gives the client's own session, then closes it", async () => {
    const f = fakePort({ attachOnAutoAttach: ["iframe", "worker"] });
    const r = await ownerMeasure(f.port, "default-auto-attach-filter", FAST);
    expect(r).toEqual({ setAutoAttachOk: true, attachedTypes: { iframe: 1, worker: 1 } });
    expect(f.counts()).toEqual({ opened: 1, closes: 1 });
  });

  it("workers lists the page's targets on the client's own session, and the owner's children as the caller counts them", async () => {
    const targets = [{ type: "page" }, { type: "iframe" }, { type: "worker" }];
    const counted = await ownerMeasure(fakePort({ targets }).port, "workers", {
      ...FAST,
      ownerChildren: () => 1,
    });
    expect(counted).toEqual({ ownerChildren: 1, targetTypes: { page: 1, iframe: 1, worker: 1 } });
    const uncounted = await ownerMeasure(fakePort({ targets }).port, "workers", FAST);
    expect(uncounted["ownerChildren"]).toBeNull();
  });

  it("resume-in-dispatch resumes inside the attach's dispatch for its first two variants and later for the rest, and reads which frames loaded", async () => {
    const f = fakePort();
    const r = await ownerMeasure(f.port, "resume-in-dispatch", {
      probeTimeoutMs: 100,
      frameUrl: "https://b.test/frame",
    });
    expect(r).toMatchObject({
      measuredVariants: true,
      inDispatchStalls: true,
      laterResumeLoads: true,
    });
    expect([...f.firstResume.entries()]).toEqual([
      ["C-1", true],
      ["C-2", true],
      ["C-3", false],
      ["C-4", false],
      ["C-5", false],
    ]);
    expect(f.sent.find((s) => s.method === "Target.setAutoAttach")?.params).toEqual({
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      filter: [{ type: "iframe" }],
    });
    expect(f.counts()).toEqual({ opened: 1, closes: 1 });
  }, 10_000);

  it("resume-in-dispatch with no frame to probe measures nothing", async () => {
    const r = await ownerMeasure(fakePort().port, "resume-in-dispatch", FAST);
    expect(r).toMatchObject({ measuredVariants: false });
  });

  it("refuses a measure it does not have", async () => {
    const outcome = await ownerMeasure(fakePort().port, "webmcp" as OwnerMeasure, FAST).then(
      () => "resolved",
      (error: unknown) => String(error),
    );
    expect(outcome).toContain("no measure named webmcp");
  });
});
