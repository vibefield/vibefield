// The host-owned SERVICE worker harness (plugin spec §10.3/§14.2, P4).
// Plain ESM on purpose: worker_threads loads this file directly in dev
// (vitest runs TS via transform, but a Worker entry cannot) and as-is beside
// the bundled daemon. The plugin module is imported HERE — fieldd's own graph
// never imports plugin code.
//
// The worker receives (workerData): pluginId, version, entryPath (absolute,
// daemon-resolved — never leaves this process), leaseUrl + leaseToken (a
// plugin-bound product credential minted host-side; §14.2 — no daemon secrets,
// no token table, no other plugin's context). Everything else arrives over the
// parent port as the small message protocol below; handlers stay worker-side,
// only metadata crosses.
import { parentPort, workerData } from "node:worker_threads";

const port = parentPort;
if (port === null) throw new Error("service harness must run as a worker");

const { pluginId, version, entryPath, leaseUrl, leaseToken } = workerData;

const controller = new AbortController();
const tracked = [];
/** namespace → { name → handler } */
const providedHandlers = new Map();
/** live subscription id → un-subscribe fn */
const liveSubs = new Map();

const post = (msg) => port.postMessage(msg);
const log = (level) => (message, fields) =>
  post({ t: "log", level, message: String(message), fields });

const logger = {
  debug: log("debug"),
  info: log("info"),
  warn: log("warn"),
  error: log("error"),
};

/** ctx.client — a plugin-bound product connection over loopback WS (Node ≥22
 * global WebSocket satisfies the isomorphic client). Lazy: created on first
 * call so an idle service costs no socket. */
let clientPromise = null;
async function productClient() {
  if (clientPromise === null) {
    clientPromise = (async () => {
      const { FielddClient } = await import("@vibefield/fieldd-client");
      const client = new FielddClient({
        url: leaseUrl,
        token: leaseToken,
        clientKind: "plugin-worker",
      });
      client.connect();
      return client;
    })();
  }
  return clientPromise;
}

const ctx = {
  plugin: { id: pluginId, version },
  signal: controller.signal,
  logger,
  client: {
    request: async (method, params) => (await productClient()).request(method, params),
    subscribe: async (method, params, onEvent) => {
      const client = await productClient();
      const sub = await client.subscribe(method, params, (payload) => onEvent(payload));
      return { snapshot: sub.snapshot, unsubscribe: sub.unsubscribe };
    },
  },
  services: {
    provide(registration) {
      if (controller.signal.aborted) throw new Error(`${pluginId}: provide after deactivation`);
      const { namespace, methods } = registration;
      if (providedHandlers.has(namespace))
        throw new Error(`${namespace} already provided in this entry`);
      const handlerMap = new Map(Object.entries(methods));
      providedHandlers.set(namespace, handlerMap);
      post({
        t: "provide",
        namespace,
        implemented: [...handlerMap].map(([name, h]) => ({ name, kind: h.kind })),
      });
      return {
        dispose() {
          providedHandlers.delete(namespace);
          post({ t: "unprovide", namespace });
        },
      };
    },
  },
  track(resource) {
    tracked.push(resource);
    return resource;
  },
};

function errorShape(e) {
  return { kind: "INTERNAL", message: e instanceof Error ? e.message : String(e) };
}

async function activate() {
  try {
    const mod = await import(entryPath);
    const plugin = mod.default ?? mod;
    if (typeof plugin?.activate !== "function")
      throw new Error(`${entryPath} does not export an activate(ctx) module`);
    const result = await plugin.activate(ctx);
    if (result !== undefined && result !== null) tracked.push(result);
    post({ t: "activated" });
  } catch (e) {
    post({ t: "activate-failed", error: errorShape(e) });
  }
}

async function deactivate() {
  // §18.2 — abort, dispose activation-returned + tracked in REVERSE, report.
  controller.abort();
  for (const [id, stop] of [...liveSubs]) {
    try {
      stop();
    } catch {}
    liveSubs.delete(id);
  }
  for (const resource of tracked.reverse()) {
    try {
      await resource.dispose?.();
    } catch (e) {
      logger.warn(`dispose failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  try {
    (await clientPromise)?.close();
  } catch {}
  post({ t: "deactivated" });
}

function handlerFor(namespace, name) {
  return providedHandlers.get(namespace)?.get(name);
}

port.on("message", (msg) => {
  void (async () => {
    switch (msg.t) {
      case "call": {
        const handler = handlerFor(msg.namespace, msg.name);
        if (handler === undefined || handler.kind === "subscription") {
          post({
            t: "result",
            id: msg.id,
            ok: false,
            error: { kind: "NOT_FOUND", message: `${msg.namespace}.${msg.name}` },
          });
          return;
        }
        try {
          const value = await handler.handle(msg.params, { caller: msg.caller });
          post({ t: "result", id: msg.id, ok: true, value });
        } catch (e) {
          post({ t: "result", id: msg.id, ok: false, error: errorShape(e) });
        }
        return;
      }
      case "subscribe": {
        const handler = handlerFor(msg.namespace, msg.name);
        if (handler === undefined || handler.kind !== "subscription") {
          post({
            t: "sub-end",
            id: msg.id,
            error: { kind: "NOT_FOUND", message: `${msg.namespace}.${msg.name}` },
          });
          return;
        }
        const sink = {
          snapshot: (value) => post({ t: "sub-snapshot", id: msg.id, value }),
          delta: (value) => post({ t: "sub-delta", id: msg.id, value }),
        };
        try {
          const disposable = await handler.subscribe(msg.params, { caller: msg.caller }, sink);
          liveSubs.set(msg.id, () => disposable?.dispose?.());
        } catch (e) {
          post({ t: "sub-end", id: msg.id, error: errorShape(e) });
        }
        return;
      }
      case "unsubscribe": {
        const stop = liveSubs.get(msg.id);
        liveSubs.delete(msg.id);
        try {
          stop?.();
        } catch {}
        return;
      }
      case "deactivate":
        await deactivate();
        return;
      default:
        return;
    }
  })();
});

void activate();
