// EY-1 (2026-11-24) — THE BRIDGE'S WALL ON ITS REAL PARTS, for the rows that hold it. The endpoint is given the real
// call windows, the real journal, the real method policy, the real event cleaning and the real input step; only the
// page is a stand-in: a port whose client sessions record what is sent on them and answer as a row says. Time is the
// kit's own clock, so a row moves it.

import { expect, vi } from "vitest";
import type {
  BrowserAgentEvent,
  BrowserAgentPort,
  BrowserAgentSession,
} from "../src/main/live-surfaces/browser-electron-native";
import { cleanEvent } from "../src/main/pages/core/events";
import { createJournal } from "../src/main/pages/core/journal";
import { classify } from "../src/main/pages/core/policy";
import {
  BRIDGE_REFUSED_CODE,
  type BridgePage,
  type CallRefusal,
  type PageClass,
  type PageLease,
  type ScriptMatcher,
  type WindowKind,
} from "../src/main/pages/core/types";
import { createWindows } from "../src/main/pages/core/windows";
import {
  createEndpoint,
  type Endpoint,
  type EndpointEngine,
} from "../src/main/pages/endpoint/endpoint";
import { agentInput } from "../src/main/pages/endpoint/input";

export type Frame = {
  readonly id?: number;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly sessionId?: string;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: string };
};

export const RUN = "run-1";
export const PAGE = "P-a";
export const TARGET = "DEVTOOLS-A";
export const LEASE: PageLease = { runKey: RUN, producerEpoch: 1, bindingRevision: 1 };

const ENGINE: EndpointEngine = {
  product: "Chrome/150.0.0.0",
  userAgent: "Mozilla/5.0 Chrome/150.0.0.0",
  protocolVersion: "1.3",
  revision: "",
  jsVersion: "15.0",
};

export type Sent = {
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly child?: string;
};

/** What the page answers a command with; a promise is an answer still on its way. A throw is the page's refusal. */
export type PageAnswer = (
  method: string,
  params: Readonly<Record<string, unknown>>,
  child: string | undefined,
) => unknown;

export interface FakeSession extends BrowserAgentSession {
  readonly sent: Sent[];
  emit(event: BrowserAgentEvent): void;
}

export function fakePort(
  targetId: string,
  answer: PageAnswer = () => ({}),
): { readonly port: BrowserAgentPort; readonly sessions: FakeSession[] } {
  const sessions: FakeSession[] = [];
  let n = 0;
  const port: BrowserAgentPort = {
    targetId,
    openClientSession: async () => {
      n += 1;
      const sent: Sent[] = [];
      const listeners = new Set<(event: BrowserAgentEvent) => void>();
      const session: FakeSession = {
        id: `real-${targetId}-${n}`,
        sent,
        emit: (event) => {
          for (const listener of listeners) listener(event);
        },
        send: async (method, params, child) => {
          sent.push({ method, params, ...(child === undefined ? {} : { child }) });
          return answer(method, params, child);
        },
        onEvent: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        close: async () => {},
        closed: new Promise(() => {}),
      };
      sessions.push(session);
      return session;
    },
    captureScale: () => 1,
    info: () => ({ url: "https://a.test/", title: "A" }),
    onDetach: () => () => {},
    pin: () => ({ applied: Promise.resolve("applied"), release: () => {} }),
    framesHoldFocus: () => false,
    viewImagePoint: (p) => p,
  };
  return { port, sessions };
}

/** An answer a row gives later. */
export function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (error: Error) => void;
} {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** One page of the run's, granted and leased, behind the wall's real parts. */
export function wall(
  o: {
    readonly pageClass?: PageClass;
    readonly answer?: PageAnswer;
    /** binding names the pin's record holds: Runtime.addBinding passes by these alone */
    readonly bindings?: readonly string[];
    /** script bodies the pin's record holds as reads: the engine's own, admitted in a read window */
    readonly reads?: readonly string[];
  } = {},
) {
  let t = 1_000;
  const now = () => t;
  const windows = createWindows({ actLeaseMs: 5_000, now });
  const journal = createJournal({ now });
  const log = vi.fn<(line: { readonly event: string; readonly [k: string]: unknown }) => void>();
  const refused = vi.fn<(r: CallRefusal) => void>();
  const bindings = new Set(o.bindings ?? []);
  const reads = new Set(o.reads ?? []);
  const matchScript: ScriptMatcher = (body, method) => {
    if (method === "Runtime.addBinding") {
      return bindings.has(body)
        ? { matched: true, entryId: "row-binding", commandClass: "act" }
        : { matched: false };
    }
    return reads.has(body)
      ? { matched: true, entryId: "row-read", commandClass: "read" }
      : { matched: false };
  };
  const endpoint = createEndpoint({
    engine: () => ENGINE,
    windows,
    classify: (q) => classify(q, { matchScript, siteOf: (host) => host }),
    journal,
    clean: cleanEvent,
    make: async () => ({ ok: false, refused: "no-window" }),
    closeMade: async () => {},
    made: () => false,
    giveBack: async () => ({ ok: false, refused: "held" }),
    input: agentInput,
    stillMaxBytes: 1_024,
    log,
    refused,
  });
  const pageClass = o.pageClass ?? "own";
  const a = fakePort(TARGET, o.answer);
  const page: BridgePage = {
    pageId: PAGE,
    pageClass,
    runKey: RUN,
    site: pageClass === "signed-in" ? "a.test" : null,
    runFolder: null,
  };
  expect(endpoint.grant(RUN, page, a.port, LEASE)).toEqual({ ok: true });
  windows.lease(PAGE, LEASE);
  let calls = 0;
  /** a call's window opens on the page; its call id */
  const open = (kind: WindowKind = "act"): string => {
    calls += 1;
    const callId = `call-${calls}`;
    expect(windows.open(PAGE, { kind, callId, action: "row" })).toEqual({ ok: true });
    return callId;
  };
  return {
    endpoint,
    windows,
    journal,
    log,
    refused,
    a,
    page,
    open,
    /** the call ends: its window closes */
    close: (callId: string) => windows.close(PAGE, callId),
    tick: (ms: number) => {
      t += ms;
    },
    /** the page's first client session, as the page sees it */
    session: (): FakeSession => {
      const first = a.sessions[0];
      if (first === undefined) throw new Error("no client session is attached");
      return first;
    },
  };
}

export type Wall = ReturnType<typeof wall>;

export function client(endpoint: Endpoint, runKey = RUN) {
  const frames: Frame[] = [];
  const closes: { readonly code: number; readonly reason: string }[] = [];
  const c = endpoint.connect(runKey, 1, {
    send: (frame) => {
      frames.push(JSON.parse(frame) as Frame);
    },
    close: (code, reason) => closes.push({ code, reason }),
  });
  let next = 0;
  const call = async (method: string, params: Record<string, unknown> = {}, sessionId?: string) => {
    next += 1;
    const id = next;
    const from = frames.length;
    await c.message(
      JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }),
    );
    const said = frames.slice(from);
    const at = said.findIndex((f) => f.id === id);
    return { answer: said[at], before: at < 0 ? said : said.slice(0, at), said };
  };
  /** the client's own session on the run's page */
  const attach = async (targetId = TARGET): Promise<string> => {
    const answer = (await call("Target.attachToTarget", { targetId, flatten: true })).answer;
    const sessionId = answer?.result?.sessionId;
    if (typeof sessionId !== "string") throw new Error("the page did not attach");
    return sessionId;
  };
  return { call, attach, frames, closes };
}

export const refusedAs = (answer: Frame | undefined, word: string) => {
  expect(answer?.error?.code).toBe(BRIDGE_REFUSED_CODE);
  expect(answer?.error?.data).toBe(`vf:${word}`);
  expect(answer?.error?.message.startsWith(`vf:${word}: `)).toBe(true);
};

/** The person picks the page up, as the broker's hand makes it: the windows first, then the bridge's half. */
export async function pickUp(w: Wall): Promise<void> {
  w.windows.hold(PAGE);
  await w.endpoint.hold(PAGE);
}

/** The person puts the page down. */
export async function putDown(w: Wall): Promise<void> {
  w.windows.putDown(PAGE);
  await w.endpoint.putDown(PAGE);
}
