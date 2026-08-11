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
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { parentPort, workerData } from "node:worker_threads";

// Dev-source resolution: workspace packages export .ts sources with
// EXTENSIONLESS relative imports (tsc/vite resolve them; Node's type
// stripping erases but never resolves). Retry <specifier>.ts for relative
// misses OUTSIDE node_modules; the bundled daemon's harness ships compiled
// JS and never hits this path.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      // PA-36/§11.6 — the SDK runtime is a HOST-provided singleton: an
      // INSTALLED artifact (unpacked .vfplugin, no node_modules above it)
      // imports it bare, and the harness binds it to the daemon's own copy.
      // This is the worker half of the singleton law, not a fallback hack.
      if (specifier === "@vibefield/plugin-sdk" || specifier.startsWith("@vibefield/plugin-sdk/")) {
        return nextResolve(specifier, { ...context, parentURL: import.meta.url });
      }
      if (
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        !specifier.endsWith(".ts") &&
        context.parentURL !== undefined &&
        !context.parentURL.includes("/node_modules/")
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const port = parentPort;
if (port === null) throw new Error("service harness must run as a worker");

const {
  pluginId,
  version,
  entryPath,
  leaseUrl,
  leaseToken,
  scopes = [],
  logLimits = {
    recordBytes: 16 * 1024,
    messageBytes: 4 * 1024,
    stringBytes: 4 * 1024,
    objectDepth: 4,
    objectKeys: 50,
    arrayItems: 50,
  },
} = workerData;

const controller = new AbortController();
const tracked = [];
/** namespace → { name → handler } */
const providedHandlers = new Map();
/** live subscription id → un-subscribe fn */
const liveSubs = new Map();

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const byteLength = (value) => encoder.encode(value).byteLength;
function truncateUtf8(value, maxBytes) {
  if (byteLength(value) <= maxBytes) return value;
  const marker = "…[truncated]";
  const markerBytes = encoder.encode(marker);
  const source = encoder.encode(value);
  for (let end = maxBytes - markerBytes.byteLength; end > 0; end -= 1) {
    try {
      return `${decoder.decode(source.subarray(0, end))}${marker}`;
    } catch {
      // Walk to the previous complete UTF-8 boundary.
    }
  }
  return marker;
}

function safeLogValue(value, depth, ancestors, truncated) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const bounded = truncateUtf8(value, logLimits.stringBytes);
    if (bounded !== value) truncated.value = true;
    return bounded;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : "[non-finite]";
  if (typeof value === "bigint") return `[bigint:${truncateUtf8(String(value), 128)}]`;
  if (typeof value === "undefined") return "[undefined]";
  if (typeof value === "function") return "[unsupported:function]";
  if (typeof value === "symbol") return "[unsupported:symbol]";
  if (depth >= logLimits.objectDepth) {
    truncated.value = true;
    return "[truncated:object-depth]";
  }
  if (ancestors.has(value)) return "[circular]";
  ancestors.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key === "symbol")) return "[unsupported:symbol-keys]";
    if (Array.isArray(value)) {
      const result = [];
      const length =
        descriptors.length &&
        "value" in descriptors.length &&
        typeof descriptors.length.value === "number"
          ? descriptors.length.value
          : 0;
      const count = Math.min(length, logLimits.arrayItems);
      for (let index = 0; index < count; index += 1) {
        const descriptor = descriptors[String(index)];
        result.push(
          descriptor && "value" in descriptor
            ? safeLogValue(descriptor.value, depth + 1, ancestors, truncated)
            : "[sparse]",
        );
      }
      if (length > count) truncated.value = true;
      return result;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return "[unsupported:object]";
    const result = Object.create(null);
    let accepted = 0;
    for (const key of keys) {
      if (typeof key !== "string" || key === "__proto__" || key === "constructor") continue;
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !("value" in descriptor)) continue;
      if (accepted >= logLimits.objectKeys) {
        truncated.value = true;
        break;
      }
      result[truncateUtf8(key, 160)] = safeLogValue(
        descriptor.value,
        depth + 1,
        ancestors,
        truncated,
      );
      accepted += 1;
    }
    return result;
  } catch {
    return "[unavailable]";
  } finally {
    ancestors.delete(value);
  }
}

function boundedPluginLog(message, fields) {
  const rawMessage =
    typeof message === "string" ? message : "[plugin emitted a non-string log message]";
  const boundedMessage = truncateUtf8(rawMessage, logLimits.messageBytes);
  const truncated = { value: boundedMessage !== rawMessage };
  const normalized =
    fields !== null && typeof fields === "object" && !Array.isArray(fields)
      ? safeLogValue(fields, 0, new WeakSet(), truncated)
      : undefined;
  const result = {
    message: boundedMessage,
    ...(normalized !== undefined ? { fields: normalized } : {}),
  };
  if (byteLength(JSON.stringify(result)) > logLimits.recordBytes) {
    result.fields = { pluginLogTruncated: true };
  } else if (truncated.value && result.fields && typeof result.fields === "object") {
    result.fields.pluginLogTruncated = true;
  }
  return result;
}

const post = (msg) => port.postMessage(msg);
const log = (level) => (message, fields) =>
  post({ t: "log", level, ...boundedPluginLog(message, fields) });

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

// P5 — ctx.settings/ctx.storage: present iff the lease carries storage.self
// (§10.2 absent-API law). One shared implementation from the SDK, riding the
// plugin's own product client — the daemon's caller matrix is the authority.
if (scopes.includes("storage.self")) {
  const { createStorageSurfaces } = await import("@vibefield/plugin-sdk");
  const surfaces = createStorageSurfaces(ctx.client);
  ctx.settings = surfaces.settings;
  ctx.storage = surfaces.storage;
}

// P6 — ctx.process (§17.1) iff process.spawn; ctx.endpoints (§17.3) iff
// services.provide. Same law, same one shared SDK implementation.
if (scopes.includes("process.spawn") || scopes.includes("services.provide")) {
  const { createProcessSurfaces } = await import("@vibefield/plugin-sdk");
  const surfaces = createProcessSurfaces(ctx.client);
  if (scopes.includes("process.spawn")) ctx.process = surfaces.process;
  if (scopes.includes("services.provide")) ctx.endpoints = surfaces.endpoints;
}

function errorShape(e) {
  return { kind: "INTERNAL", message: e instanceof Error ? e.message : String(e) };
}

async function activate() {
  try {
    // pathToFileURL, not the bare path: ESM dynamic import of an ABSOLUTE path
    // throws ERR_UNSUPPORTED_ESM_URL_SCHEME on Windows (it reads `C:` as a
    // protocol) — a leading-slash unix path is accepted but a drive path is not.
    // A file:// URL is valid on both, and it makes relative resolution FROM this
    // module (the .ts retry hook above) consistent too.
    const mod = await import(pathToFileURL(entryPath).href);
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
