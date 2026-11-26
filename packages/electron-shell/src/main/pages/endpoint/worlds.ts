// EY-1 (2026-11-19) — A CLIENT'S WORLDS (track EY; BU-23: filter per client). Each client drives a page through its
// own second debugger session (EY-S2-E5), and every session with Runtime enabled hears every context of the page: the
// person's page world, the owner's own world, and every other client's isolated worlds. BU-23 rules that a client gets
// the page's own contexts and only the isolated worlds it made, so no world becomes a channel between clients.
//
// The event cannot say whose world it is. A created event very likely comes before the answer that names its id, and
// a world asked for by `Page.addScriptToEvaluateOnNewDocument` is made afresh at each navigation with no answer at all,
// a new world per session, so two clients that ask for the same name (Puppeteer asks for one fixed name, by both
// calls) each get a world under it. So the bridge makes a client's world names its own: on the way in, a world's name
// becomes the client's private name, `__vfc<n>__` and the client's name; on the way out, the client's own contexts
// carry its name back. An isolated context is forwarded only under the client's own prefix: another client's, the
// owner's (`__vibefield…`) and any unprefixed isolated world are dropped. Default contexts, and contexts with no
// auxData (a worker's), pass. A name of the bridge's own is refused, a world's or a binding's: a client binding named
// as the owner's (`__vibefieldPageScale`, `__vibefieldFrameWords`) would hear the owner's own calls.
//
// A context the client names in a command must be one forwarded to it on that session (by `contextId`,
// `executionContextId` or `uniqueContextId`), and still live; else the command is refused `forbidden`. Events that
// carry a context (a console call, a thrown exception, a binding called) reach the client only from a context it was
// given. A RemoteObjectId needs no filter: it belongs to the inspector session that minted it, so a client cannot use
// another session's.
//
// THE DEBUGGER (2026-11-24). A script belongs to the context it was parsed in, and a session's debugger hears every
// script of the page, the owner's and every other client's among them. So the same rule holds for scripts: a
// `Debugger.scriptParsed` (or `scriptFailedToParse`) reaches the client only for the page's own world, a worker's, or
// an isolated world it was given, read off the script's own world mark so Runtime need not be enabled; and its id is
// then the client's to name. A command naming a script by its id (`getScriptSource`, `setScriptSource`,
// `setBreakpoint`) is refused for any other id, told or guessed. A breakpoint by address names one exact, non-empty
// address: a pattern or a hash would match a script of any world, and the owner's scripts carry no address. A
// `Debugger.paused` is the client's only when every frame of it is in a script of its own; one that is not is dropped
// as `foreign-pause`, and the endpoint lets the page run on. `evaluateOnCallFrame` names only a frame of the pause the
// client was last told of. What stays open is said where the rule is: two clients' scripts under one exact address.
//
// Context ids are per session (a frame of another site is its own process), so everything here is kept by the session
// the client's call or event is on: its page session or one of its children. Pure.

import {
  BRIDGE_OK,
  type BridgeVerdict,
  type CdpCall,
  type CdpEvent,
  type CdpParams,
  type CleanedEvent,
} from "../core/types";

/** The prefix of a client's private world names; with the client's ordinal and `__`, e.g. `__vfc3__utility`. */
export const CLIENT_WORLD_PREFIX = "__vfc";
/** The owner's worlds (browser-electron-native.ts's words world): never a client's. */
export const OWNER_WORLD_PREFIX = "__vibefield";

/** A command as the bridge forwards it: its verdict, and the call (a world's name rewritten). */
export interface WorldsCall {
  readonly verdict: BridgeVerdict;
  readonly call: CdpCall;
}

export interface ClientWorlds {
  /** `__vfc<n>__` */
  readonly prefix: string;
  /** a command the client sends on `session`: refused when it names a context or world it may not use */
  command(session: string, call: CdpCall): WorldsCall;
  /** the answer to a forwarded command: `Page.createIsolatedWorld`'s world is the client's at once, before its event */
  answered(session: string, call: CdpCall, result: CdpParams): void;
  /** an event on the client's own `session` */
  event(session: string, event: CdpEvent): CleanedEvent;
  /** the session ended: its contexts go with it */
  sessionEnded(session: string): void;
  /** the isolated worlds the client was given on `session` (BridgeClient.isolatedWorlds) */
  isolatedWorlds(session: string): ReadonlySet<number>;
}

interface Given {
  readonly isolated: boolean;
  readonly uniqueId: string | undefined;
}

/** Commands that name a context by number, and the parameter that does. */
const BY_ID: Readonly<Record<string, readonly string[]>> = {
  "Runtime.evaluate": ["contextId"],
  "Runtime.callFunctionOn": ["executionContextId"],
  "Runtime.compileScript": ["executionContextId"],
  "Runtime.runScript": ["executionContextId"],
  "Runtime.globalLexicalScopeNames": ["executionContextId"],
  "Runtime.addBinding": ["executionContextId"],
  "DOM.resolveNode": ["executionContextId"],
};
/** Commands that name a context by its unique id. */
const BY_UNIQUE_ID = new Set(["Runtime.evaluate", "Runtime.callFunctionOn"]);
/** Commands that name a binding: never under the bridge's own prefixes. */
const BINDINGS = new Set(["Runtime.addBinding", "Runtime.removeBinding"]);
/** Commands whose world name is rewritten, and whether an empty or missing name means the page's own world. */
const NAMED: Readonly<
  Record<string, { readonly param: string; readonly emptyIsPageWorld: boolean }>
> = {
  "Page.createIsolatedWorld": { param: "worldName", emptyIsPageWorld: false },
  "Page.addScriptToEvaluateOnNewDocument": { param: "worldName", emptyIsPageWorld: true },
  "Runtime.addBinding": { param: "executionContextName", emptyIsPageWorld: true },
};

const forbidden = (reason: string): BridgeVerdict => ({ ok: false, code: "forbidden", reason });
const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;

/** Debugger commands that name a script by its id, and where the id is. */
const BY_SCRIPT: Readonly<Record<string, (params: CdpParams) => unknown>> = {
  "Debugger.getScriptSource": (params) => params["scriptId"],
  "Debugger.setScriptSource": (params) => params["scriptId"],
  "Debugger.setBreakpoint": (params) => record(params["location"])?.["scriptId"],
};
/** Script ids kept per session before the oldest is forgotten: a bound on memory. A forgotten script is refused and
 * a pause in it is run on, never the other way. */
export const SCRIPTS_KEPT = 16_384;

/** Whether a context's world mark says an isolated world; no mark (a worker's context) is none. */
const isolatedMark = (auxData: unknown): boolean => {
  const aux = record(auxData);
  return aux !== undefined && (aux["isDefault"] === false || aux["type"] === "isolated");
};

export function clientWorlds(ordinal: number): ClientWorlds {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0)
    throw new RangeError("a client's ordinal is a whole number");
  const prefix = `${CLIENT_WORLD_PREFIX}${ordinal}__`;
  const bySession = new Map<string, Map<number, Given>>();
  const contextsOf = (session: string): Map<number, Given> => {
    let contexts = bySession.get(session);
    if (contexts === undefined) {
      contexts = new Map();
      bySession.set(session, contexts);
    }
    return contexts;
  };
  const givenId = (session: string, id: unknown): boolean =>
    typeof id === "number" && (bySession.get(session)?.has(id) ?? false);
  const givenUniqueId = (session: string, uniqueId: unknown): boolean =>
    typeof uniqueId === "string" &&
    [...(bySession.get(session)?.values() ?? [])].some((g) => g.uniqueId === uniqueId);
  /** the scripts the client was told of on a session, oldest first */
  const scriptsBySession = new Map<string, Set<string>>();
  /** the call frames of the pause the client was last told of on a session */
  const framesBySession = new Map<string, ReadonlySet<string>>();
  const scriptGiven = (session: string, scriptId: unknown): boolean =>
    typeof scriptId === "string" && (scriptsBySession.get(session)?.has(scriptId) ?? false);
  const noteScript = (session: string, scriptId: string): void => {
    let scripts = scriptsBySession.get(session);
    if (scripts === undefined) {
      scripts = new Set();
      scriptsBySession.set(session, scripts);
    }
    scripts.add(scriptId);
    if (scripts.size > SCRIPTS_KEPT) {
      const oldest = scripts.values().next();
      if (oldest.done !== true) scripts.delete(oldest.value);
    }
  };

  const debuggerCommand = (session: string, call: CdpCall): BridgeVerdict => {
    const scriptOf = BY_SCRIPT[call.method];
    if (scriptOf !== undefined && !scriptGiven(session, scriptOf(call.params)))
      return forbidden("a script this client was not given");
    if (call.method === "Debugger.evaluateOnCallFrame") {
      const frame = call.params["callFrameId"];
      if (typeof frame !== "string" || framesBySession.get(session)?.has(frame) !== true)
        return forbidden("a call frame this client was not given");
    }
    if (call.method === "Debugger.setBreakpointByUrl") {
      // One exact address. Two scripts under the same address in two clients' worlds are both named by it; nothing
      // here tells them apart, and a pause in the other's is run on.
      const url = call.params["url"];
      if (
        call.params["urlRegex"] !== undefined ||
        call.params["scriptHash"] !== undefined ||
        typeof url !== "string" ||
        url === ""
      )
        return forbidden("a breakpoint by address names one exact address");
    }
    return BRIDGE_OK;
  };

  const command = (session: string, call: CdpCall): WorldsCall => {
    const debugged = debuggerCommand(session, call);
    if (!debugged.ok) return { verdict: debugged, call };
    for (const param of BY_ID[call.method] ?? []) {
      const id = call.params[param];
      if (id !== undefined && !givenId(session, id))
        return { verdict: forbidden("a context this client was not given"), call };
    }
    if (BY_UNIQUE_ID.has(call.method)) {
      const uniqueId = call.params["uniqueContextId"];
      if (uniqueId !== undefined && !givenUniqueId(session, uniqueId))
        return { verdict: forbidden("a context this client was not given"), call };
    }
    if (BINDINGS.has(call.method)) {
      const binding = call.params["name"];
      if (
        typeof binding === "string" &&
        (binding.startsWith(CLIENT_WORLD_PREFIX) || binding.startsWith(OWNER_WORLD_PREFIX))
      )
        return { verdict: forbidden("a binding name of the bridge's own"), call };
    }
    const named = NAMED[call.method];
    if (named === undefined) return { verdict: BRIDGE_OK, call };
    const name = call.params[named.param];
    if (name !== undefined && typeof name !== "string")
      return { verdict: forbidden("a world's name is text"), call };
    if (
      name !== undefined &&
      (name.startsWith(CLIENT_WORLD_PREFIX) || name.startsWith(OWNER_WORLD_PREFIX))
    )
      return { verdict: forbidden("a world name of the bridge's own"), call };
    if ((name === undefined || name === "") && named.emptyIsPageWorld)
      return { verdict: BRIDGE_OK, call };
    return {
      verdict: BRIDGE_OK,
      call: {
        method: call.method,
        params: { ...call.params, [named.param]: `${prefix}${name ?? ""}` },
      },
    };
  };

  const answered = (session: string, call: CdpCall, result: CdpParams): void => {
    const id = result["executionContextId"];
    if (call.method === "Page.createIsolatedWorld" && typeof id === "number") {
      const contexts = contextsOf(session);
      if (!contexts.has(id)) contexts.set(id, { isolated: true, uniqueId: undefined });
    }
  };

  const fromGiven = (session: string, id: unknown): CleanedEvent | undefined =>
    id === undefined || givenId(session, id)
      ? undefined
      : { action: "drop", reason: "not-the-clients" };

  const event = (session: string, e: CdpEvent): CleanedEvent => {
    const forward: CleanedEvent = { action: "forward", event: e };
    switch (e.method) {
      case "Runtime.executionContextCreated": {
        const context = record(e.params["context"]);
        const id = context?.["id"];
        if (context === undefined || typeof id !== "number")
          return { action: "drop", reason: "not-the-clients" };
        const isolated = isolatedMark(context["auxData"]);
        const uniqueId = typeof context["uniqueId"] === "string" ? context["uniqueId"] : undefined;
        if (!isolated) {
          contextsOf(session).set(id, { isolated: false, uniqueId });
          return forward;
        }
        const name = context["name"];
        if (typeof name !== "string" || !name.startsWith(prefix))
          return { action: "drop", reason: "not-the-clients" };
        contextsOf(session).set(id, { isolated: true, uniqueId });
        return {
          action: "forward",
          event: {
            ...e,
            params: { ...e.params, context: { ...context, name: name.slice(prefix.length) } },
          },
        };
      }
      case "Runtime.executionContextDestroyed": {
        const contexts = bySession.get(session);
        const id = e.params["executionContextId"];
        const uniqueId = e.params["executionContextUniqueId"];
        const found =
          typeof id === "number" && contexts?.has(id)
            ? id
            : [...(contexts?.entries() ?? [])].find(
                ([, g]) => typeof uniqueId === "string" && g.uniqueId === uniqueId,
              )?.[0];
        if (found === undefined) return { action: "drop", reason: "not-the-clients" };
        contexts?.delete(found);
        return forward;
      }
      case "Runtime.executionContextsCleared":
        bySession.get(session)?.clear();
        return forward;
      case "Runtime.consoleAPICalled":
      case "Runtime.bindingCalled":
        return fromGiven(session, e.params["executionContextId"]) ?? forward;
      case "Runtime.exceptionThrown":
        return (
          fromGiven(session, record(e.params["exceptionDetails"])?.["executionContextId"]) ??
          forward
        );
      case "Debugger.scriptParsed":
      case "Debugger.scriptFailedToParse": {
        const scriptId = e.params["scriptId"];
        // an isolated world's script is the client's only when the world is one it was given
        const contextId = e.params["executionContextId"];
        const mine =
          !isolatedMark(e.params["executionContextAuxData"]) ||
          (typeof contextId === "number" &&
            bySession.get(session)?.get(contextId)?.isolated === true);
        if (typeof scriptId !== "string" || !mine)
          return { action: "drop", reason: "not-the-clients" };
        noteScript(session, scriptId);
        return forward;
      }
      case "Debugger.paused": {
        const frames = e.params["callFrames"];
        const ids: string[] = [];
        for (const f of Array.isArray(frames) ? frames : [null]) {
          const frame = record(f);
          const frameId = frame?.["callFrameId"];
          if (
            typeof frameId !== "string" ||
            !scriptGiven(session, record(frame?.["location"])?.["scriptId"])
          )
            return { action: "drop", reason: "foreign-pause" };
          ids.push(frameId);
        }
        framesBySession.set(session, new Set(ids));
        return forward;
      }
      case "Debugger.resumed":
        framesBySession.delete(session);
        return forward;
      case "Debugger.breakpointResolved":
        return scriptGiven(session, record(e.params["location"])?.["scriptId"])
          ? forward
          : { action: "drop", reason: "not-the-clients" };
      default:
        return forward;
    }
  };

  return {
    prefix,
    command,
    answered,
    event,
    sessionEnded: (session) => {
      bySession.delete(session);
      scriptsBySession.delete(session);
      framesBySession.delete(session);
    },
    isolatedWorlds: (session) =>
      new Set(
        [...(bySession.get(session)?.entries() ?? [])]
          .filter(([, g]) => g.isolated)
          .map(([id]) => id),
      ),
  };
}
