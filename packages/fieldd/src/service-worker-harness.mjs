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

// Load the shared host runtime only after the dev-source resolution hook is active. Its workspace
// package exports TypeScript with extensionless relatives; the production bundle inlines it.
const { ActivationEffectSetupError, ActivationScope, InactiveActivationScopeError } = await import(
  "@vibefield/plugin-runtime"
);

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

const root = new ActivationScope(`service:${pluginId}`);
/** namespace → { name → handler } */
const providedHandlers = new Map();
/** live subscription id → identity-bound child lifetime */
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

// Register the lazy connection owner BEFORE the activation child. The activation and all of its
// descendants therefore clean up first; exact host-issued inverses may still use the raw product
// client, and the connection closes last. Merely closing an idle activation never opens a socket.
root.track("product-client", {
  async dispose() {
    const pending = clientPromise;
    if (pending === null) return;
    const client = await pending;
    client.close();
  },
});

const rawClient = Object.freeze({
  request: async (method, params) => (await productClient()).request(method, params),
  subscribe: async (method, params, onEvent) => {
    const client = await productClient();
    const sub = await client.subscribe(method, params, onEvent);
    return { snapshot: sub.snapshot, unsubscribe: sub.unsubscribe };
  },
});

// Build shared SDK veneers over the raw client once. Context-specific wrappers below gate all new
// business work and own every returned lifetime in the exact child that acquired it.
let rawStorage;
if (scopes.includes("storage.self")) {
  const { createStorageSurfaces } = await import("@vibefield/plugin-sdk");
  rawStorage = createStorageSurfaces(rawClient);
}

let rawProcesses;
if (scopes.includes("process.spawn") || scopes.includes("services.provide")) {
  const { createProcessSurfaces } = await import("@vibefield/plugin-sdk");
  rawProcesses = createProcessSurfaces(rawClient);
}

function assertScopeOpen(scope) {
  if (scope.state !== "open") throw new InactiveActivationScopeError(scope.label);
}

/** Publication withdrawal is synchronous at the close edge; its exact inverse remains an awaited
 * ownership record at the normal LIFO position. */
function ownPublication(scope, label, publication) {
  let withdrawal;
  const withdraw = () => {
    if (withdrawal !== undefined) return;
    let resolveWithdrawal;
    let rejectWithdrawal;
    withdrawal = new Promise((resolve, reject) => {
      resolveWithdrawal = resolve;
      rejectWithdrawal = reject;
    });
    void withdrawal.catch(() => undefined);
    try {
      Promise.resolve(publication.dispose()).then(resolveWithdrawal, rejectWithdrawal);
    } catch (error) {
      rejectWithdrawal(error);
    }
  };
  const onAbort = () => withdraw();
  scope.signal.addEventListener("abort", onAbort, { once: true });
  return scope.track(label, {
    dispose() {
      scope.signal.removeEventListener("abort", onAbort);
      withdraw();
      return withdrawal ?? Promise.resolve();
    },
  });
}

function contextFor(ownedBy) {
  const assertOpen = () => assertScopeOpen(ownedBy);
  const guardedLogger = Object.freeze({
    debug(message, fields) {
      assertOpen();
      logger.debug(message, fields);
    },
    info(message, fields) {
      assertOpen();
      logger.info(message, fields);
    },
    warn(message, fields) {
      assertOpen();
      logger.warn(message, fields);
    },
    error(message, fields) {
      assertOpen();
      logger.error(message, fields);
    },
  });

  const client = Object.freeze({
    request(method, params) {
      assertOpen();
      return rawClient.request(method, params);
    },
    async subscribe(method, params, onEvent) {
      assertOpen();
      const subscription = await rawClient.subscribe(method, params, (payload) => {
        if (ownedBy.state === "open") onEvent(payload);
      });
      let live = true;
      const release = {
        dispose() {
          if (!live) return;
          live = false;
          subscription.unsubscribe();
        },
      };
      ownedBy.track(`client.subscribe:${method}`, release);
      return Object.freeze({
        snapshot: subscription.snapshot,
        unsubscribe() {
          void release.dispose();
        },
      });
    },
  });

  const settings =
    rawStorage === undefined
      ? undefined
      : Object.freeze({
          get(key) {
            assertOpen();
            return rawStorage.settings.get(key);
          },
          set(key, value) {
            assertOpen();
            return rawStorage.settings.set(key, value);
          },
          reset(key) {
            assertOpen();
            return rawStorage.settings.reset(key);
          },
          subscribe(key, observer) {
            assertOpen();
            const resource = rawStorage.settings.subscribe(key, (value) => {
              if (ownedBy.state === "open") observer(value);
            });
            return ownedBy.track(`settings.subscribe:${key}`, resource);
          },
        });

  const storage =
    rawStorage === undefined
      ? undefined
      : Object.freeze({
          kv: Object.freeze({
            get(key) {
              assertOpen();
              return rawStorage.storage.kv.get(key);
            },
            set(key, value) {
              assertOpen();
              return rawStorage.storage.kv.set(key, value);
            },
            delete(key) {
              assertOpen();
              return rawStorage.storage.kv.delete(key);
            },
            list(prefix) {
              assertOpen();
              return rawStorage.storage.kv.list(prefix);
            },
          }),
        });

  function track(labelOrResource, resource) {
    return typeof labelOrResource === "string"
      ? ownedBy.track(labelOrResource, resource)
      : ownedBy.track(labelOrResource);
  }

  return Object.freeze({
    plugin: Object.freeze({ id: pluginId, version }),
    signal: ownedBy.signal,
    logger: guardedLogger,
    client,
    services: Object.freeze({
      provide(registration) {
        assertOpen();
        const { namespace, methods } = registration;
        if (providedHandlers.has(namespace))
          throw new Error(`${namespace} already provided in this entry`);
        const generation = Symbol(namespace);
        const handlerMap = new Map(Object.entries(methods));
        providedHandlers.set(namespace, { generation, methods: handlerMap });
        post({
          t: "provide",
          namespace,
          implemented: [...handlerMap].map(([name, handler]) => ({
            name,
            kind: handler.kind,
          })),
        });
        let live = true;
        return ownPublication(ownedBy, `service:${namespace}`, {
          dispose() {
            if (!live) return;
            live = false;
            if (providedHandlers.get(namespace)?.generation !== generation) return;
            providedHandlers.delete(namespace);
            post({ t: "unprovide", namespace });
          },
        });
      },
    }),
    ...(settings === undefined ? {} : { settings }),
    ...(storage === undefined ? {} : { storage }),
    ...(scopes.includes("process.spawn") && rawProcesses !== undefined
      ? {
          process: Object.freeze({
            async spawn(request) {
              assertOpen();
              const handle = await rawProcesses.process.spawn(request);
              const resource = {
                procId: handle.procId,
                signal(sig) {
                  assertOpen();
                  return handle.signal(sig);
                },
                stat() {
                  assertOpen();
                  return handle.stat();
                },
                dispose: () => handle.dispose(),
              };
              return ownedBy.track(`process:${handle.procId}`, resource);
            },
          }),
        }
      : {}),
    ...(scopes.includes("services.provide") && rawProcesses !== undefined
      ? {
          endpoints: Object.freeze({
            async register(request) {
              assertOpen();
              const resource = await rawProcesses.endpoints.register(request);
              return ownedBy.track(`endpoint:${request.serviceId}`, resource);
            },
          }),
        }
      : {}),
    track,
    effect(label, acquire) {
      assertOpen();
      return ownedBy.effect(label, (child) => acquire(contextFor(child)));
    },
  });
}

function errorShape(e) {
  const primary = e instanceof ActivationEffectSetupError ? e.cause : e;
  return {
    kind: "INTERNAL",
    message: primary instanceof Error ? primary.message : String(primary),
  };
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
    await root.effect("activate", (activation) => plugin.activate(contextFor(activation)));
    if (root.state !== "open") return;
    post({ t: "activated" });
  } catch (e) {
    root.close({ kind: "activation-failed", detail: pluginId });
    const cleanup = await root.whenQuiescent();
    post({ t: "activate-failed", error: errorShape(e), cleanup });
  }
}

let deactivationTask = null;
async function runDeactivation() {
  // §18.2/PRC-D2 — close authority synchronously, then prove cooperative scope quiescence. The
  // parent host owns the deadline and the only honest worker-thread force boundary.
  root.close({ kind: "manual", detail: "service-host-stop" });
  const cleanup = await root.whenQuiescent();
  liveSubs.clear();
  return cleanup;
}

async function deactivate(requestId, generation) {
  deactivationTask ??= runDeactivation();
  const cleanup = await deactivationTask;
  post({ t: "deactivated", requestId, generation, cleanup });
}

function handlerFor(namespace, name) {
  return providedHandlers.get(namespace)?.methods.get(name);
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
        let lifetime;
        try {
          await root.effect(`provider.subscribe:${msg.id}`, (subscription) => {
            let stopped = false;
            lifetime = {
              scope: subscription,
              get stopped() {
                return stopped;
              },
              stop() {
                if (stopped) return;
                stopped = true;
                subscription.close({ kind: "manual", detail: `unsubscribe:${msg.id}` });
              },
            };
            liveSubs.set(msg.id, lifetime);
            const sink = {
              snapshot(value) {
                if (subscription.state === "open") post({ t: "sub-snapshot", id: msg.id, value });
              },
              delta(value) {
                if (subscription.state === "open") post({ t: "sub-delta", id: msg.id, value });
              },
            };
            return handler.subscribe(msg.params, { caller: msg.caller }, sink);
          });
          if (lifetime?.scope.state !== "open" && liveSubs.get(msg.id) === lifetime)
            liveSubs.delete(msg.id);
        } catch (e) {
          if (liveSubs.get(msg.id) === lifetime) liveSubs.delete(msg.id);
          if (lifetime?.stopped !== true) post({ t: "sub-end", id: msg.id, error: errorShape(e) });
        }
        return;
      }
      case "unsubscribe": {
        const lifetime = liveSubs.get(msg.id);
        liveSubs.delete(msg.id);
        lifetime?.stop();
        return;
      }
      case "deactivate":
        await deactivate(msg.requestId, msg.generation);
        return;
      default:
        return;
    }
  })();
});

void activate();
