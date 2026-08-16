import { EventEmitter } from "node:events";
import {
  type CallerContext,
  type DynamicSubEvent,
  NAMESPACES,
  SCOPES,
  type ServiceMethodContribution,
  type ServiceProviderRecord,
  type ServicesSnapshot,
} from "@vibefield/contracts";
import { createNoopLogger, type Logger } from "@vibefield/logging";
import { Ajv, type ValidateFunction } from "ajv";
import { RpcCallError } from "./native-link";

// ServiceRegistry — the dynamic-method router (plugin spec §14.4–14.7, P4).
// The registered-namespace EXACT MAP (§6.2/§14.6): full method string → one
// provider entry; the router never splits dotted names. Registration is the
// static validation surface (§22.4): manifest-declared methods only, exact
// match in BOTH directions, schemas compiled at register time — a provider
// that cannot validate never enters the table.
//
// Pipeline per call (§14.4): derive caller → capability gate → validate input
// → invoke → validate output → record. Provider handlers receive a SANITIZED
// caller (kind + pluginId), never caller-supplied identity.
//
// Capability gate (§15, recorded v1 decisions in thinking-p4):
//   - core-scope requirement → the connection's token scopes decide;
//   - custom x.* requirement → plugin principals need the cap in their
//     registry grant; the LOCAL shell/window principal passes custom-cap
//     gates (the user's own trusted UI is the grant authority until P6's
//     grants UX) — core-scope gates still bind it;
//   - non-loopback transports are refused outright (dynamic methods are
//     local-only in v1 and never enter PeerLink federation, §14.6).

export interface ServiceCallerInfo {
  kind: string;
  pluginId?: string;
}

export interface ServiceProviderHandlers {
  call(name: string, params: unknown, caller: ServiceCallerInfo): Promise<unknown>;
  subscribe(
    name: string,
    params: unknown,
    caller: ServiceCallerInfo,
    sink: {
      snapshot(value: unknown): void;
      delta(value: unknown): void;
      end(error?: { kind: string; message: string }): void;
    },
  ): Promise<() => void>;
}

export interface ServiceProviderBinding {
  pluginId: string;
  namespace: string;
  declarations: ServiceMethodContribution[];
  /** what the provider actually implements — §14.4 exact-match runs BOTH ways
   * (an undeclared implementation and an unimplemented declaration both refuse) */
  implemented: Array<{ name: string; kind: "query" | "mutation" | "subscription" }>;
  handlers: ServiceProviderHandlers;
}

interface MethodEntry {
  pluginId: string;
  namespace: string;
  decl: ServiceMethodContribution;
  handlers: ServiceProviderHandlers;
  input: ValidateFunction;
  output?: ValidateFunction;
  snapshot?: ValidateFunction;
  delta?: ValidateFunction;
}

interface LiveSub {
  namespace: string;
  stop: () => void;
  ended: boolean;
  end(error: { kind: string; message: string }, stopUpstream: boolean): void;
}

const FIRST_SNAPSHOT_DEADLINE_MS = 5_000;

export class ServiceRegistry extends EventEmitter {
  private readonly ajv = new Ajv({ allErrors: false, strict: false });
  private readonly methods = new Map<string, MethodEntry>();
  private readonly providers = new Map<string, ServiceProviderBinding>();
  /** A draining provider remains as a method-kind tombstone so new work gets typed UNAVAILABLE
   * until the worker generation is actually withdrawn. It is absent from public availability. */
  private readonly drainingNamespaces = new Set<string>();
  private readonly subs = new Set<LiveSub>();
  private readonly logger: Logger;
  private generation = 0;

  constructor(
    private readonly opts: {
      /** the plugin registry's granted set (undefined = unknown plugin) */
      grantedCapabilities(pluginId: string): readonly string[] | undefined;
      logger?: Logger;
    },
  ) {
    super();
    this.logger = opts.logger ?? createNoopLogger();
  }

  /** §14.4/§14.6 registration. Throws RpcCallError; on success returns the
   * unregister function. The NEWER registration fails on collision — a live
   * provider is never replaced. */
  register(binding: ServiceProviderBinding): () => void {
    const { pluginId, namespace, declarations, implemented, handlers } = binding;
    if (namespace !== `${NAMESPACES.DYNAMIC_PREFIX}${pluginId}`)
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `${namespace} is not ${pluginId}'s namespace (§14.6 — a plugin provides only x.<its-id>.*)`,
        false,
      );
    if (this.providers.has(namespace))
      throw new RpcCallError("CONFLICT", `${namespace} already has a live provider`, false);
    // §14.4 — exact match, both directions, kinds included
    const declByName = new Map(declarations.map((d) => [d.name, d]));
    for (const impl of implemented) {
      const decl = declByName.get(impl.name);
      if (decl === undefined)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          `${namespace}.${impl.name} is implemented but not declared in the manifest`,
          false,
        );
      if (decl.kind !== impl.kind)
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          `${namespace}.${impl.name}: implemented as ${impl.kind}, declared as ${decl.kind}`,
          false,
        );
    }
    const implementedNames = new Set(implemented.map((i) => i.name));
    for (const decl of declarations)
      if (!implementedNames.has(decl.name))
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          `${namespace}.${decl.name} is declared but not implemented`,
          false,
        );

    const entries = new Map<string, MethodEntry>();
    for (const decl of declarations) {
      const full = `${namespace}.${decl.name}`;
      if (this.methods.has(full) || entries.has(full))
        throw new RpcCallError("CONFLICT", `${full} already has a live provider`, false);
      let input: ValidateFunction;
      let output: ValidateFunction | undefined;
      let snapshot: ValidateFunction | undefined;
      let delta: ValidateFunction | undefined;
      try {
        input = this.ajv.compile(decl.input);
        if (decl.kind === "subscription") {
          snapshot = this.ajv.compile(decl.snapshot);
          delta = this.ajv.compile(decl.delta);
        } else {
          output = this.ajv.compile(decl.output);
        }
      } catch (e) {
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          `${full}: schema does not compile (${e instanceof Error ? e.message : String(e)})`,
          false,
        );
      }
      entries.set(full, {
        pluginId,
        namespace,
        decl,
        handlers,
        input,
        ...(output !== undefined ? { output } : {}),
        ...(snapshot !== undefined ? { snapshot } : {}),
        ...(delta !== undefined ? { delta } : {}),
      });
    }

    this.providers.set(namespace, binding);
    for (const [full, entry] of entries) this.methods.set(full, entry);
    this.publish();
    return () => this.withdrawNamespace(namespace);
  }

  withdrawPlugin(pluginId: string): void {
    for (const [ns, p] of [...this.providers])
      if (p.pluginId === pluginId) this.withdrawNamespace(ns);
  }

  /** PRC-2's synchronous route edge. Existing calls already hold their MethodEntry; new calls and
   * subscriptions see UNAVAILABLE, live subscriptions receive one terminal, and replacement still
   * collides until withdrawPlugin retires the exact old provider generation. */
  beginDrainPlugin(pluginId: string): void {
    let changed = false;
    for (const [namespace, provider] of this.providers) {
      if (provider.pluginId !== pluginId || this.drainingNamespaces.has(namespace)) continue;
      this.drainingNamespaces.add(namespace);
      changed = true;
      for (const sub of [...this.subs]) {
        if (sub.namespace !== namespace) continue;
        sub.end({ kind: "UNAVAILABLE", message: "provider draining" }, true);
      }
    }
    if (changed) this.publish();
  }

  private withdrawNamespace(namespace: string): void {
    if (!this.providers.delete(namespace)) return;
    this.drainingNamespaces.delete(namespace);
    for (const [full, entry] of [...this.methods])
      if (entry.namespace === namespace) this.methods.delete(full);
    // §14.5 — provider loss terminates upstream subscriptions with UNAVAILABLE
    for (const sub of [...this.subs]) {
      if (sub.namespace === namespace)
        sub.end({ kind: "UNAVAILABLE", message: "provider withdrawn" }, true);
    }
    this.publish();
  }

  resolve(fullMethod: string): { pluginId: string; decl: ServiceMethodContribution } | undefined {
    const entry = this.methods.get(fullMethod);
    return entry === undefined || this.drainingNamespaces.has(entry.namespace)
      ? undefined
      : { pluginId: entry.pluginId, decl: entry.decl };
  }

  /** what ProductApi asks before dispatching an x.* method */
  kindOf(fullMethod: string): "call" | "subscription" | undefined {
    const entry = this.methods.get(fullMethod);
    if (entry === undefined) return undefined;
    return entry.decl.kind === "subscription" ? "subscription" : "call";
  }

  snapshot(): ServicesSnapshot {
    const providers: ServiceProviderRecord[] = [...this.providers.values()]
      .filter((provider) => !this.drainingNamespaces.has(provider.namespace))
      .map((p) => ({
        pluginId: p.pluginId,
        namespace: p.namespace,
        methods: p.declarations.map((d) => ({
          name: d.name,
          kind: d.kind,
          idempotent: d.idempotent,
          requiredCapability: d.requiredCapability,
        })),
        state: "active" as const,
      }))
      .sort((a, b) => a.namespace.localeCompare(b.namespace));
    return { generation: this.generation, providers };
  }

  async call(ctx: CallerContext, method: string, params: unknown): Promise<unknown> {
    const entry = this.gate(ctx, method, params);
    if (entry.decl.kind === "subscription")
      throw new RpcCallError("PRECONDITION_FAILED", `${method} is a subscription`, false);
    const started = Date.now();
    let value: unknown;
    try {
      value = await entry.handlers.call(entry.decl.name, params, callerInfo(ctx));
    } catch (e) {
      if (e instanceof RpcCallError) throw e;
      // provider bug: sanitized message, no stack on the wire
      throw new RpcCallError(
        "INTERNAL",
        `provider error in ${method}: ${e instanceof Error ? e.message : "unknown"}`,
        false,
      );
    }
    if (entry.output !== undefined && !entry.output(value)) {
      this.logger.error(
        "fieldd.plugin_service.output_schema_rejected",
        "Plugin service output failed its declared schema",
        undefined,
        { method, pluginId: entry.pluginId },
      );
      throw new RpcCallError("INTERNAL", `${method}: provider returned schema-invalid data`, false);
    }
    const caller = callerInfo(ctx);
    this.logger.info("fieldd.plugin_service.call_completed", "Plugin service call completed", {
      method,
      pluginId: entry.pluginId,
      durationMs: Date.now() - started,
      callerKind: caller.kind,
      ...(caller.pluginId !== undefined ? { callerPluginId: caller.pluginId } : {}),
    });
    return value;
  }

  /** P6 §17.4 — is a namespace's provider live right now (MCP availability)? */
  providerUp(namespace: string): boolean {
    return this.providers.has(namespace) && !this.drainingNamespaces.has(namespace);
  }

  /** P6 §17.4 — an MCP tool projection invoking its declared method. The
   * tool's existence was gated by McpService (declaration + mcp.contribute +
   * the caller's mcp.consume at the product method); the projection executes
   * as the daemon's own "mcp" caller. Input/output validation binds exactly
   * as for any caller; the custom-cap gate does not — DECLARING the tool is
   * the plugin's opt-in (§17.4), and user policy sits above in McpService. */
  async callProjected(method: string, params: unknown): Promise<unknown> {
    const entry = this.methods.get(method);
    if (entry === undefined)
      throw new RpcCallError("NOT_FOUND", `no live provider for ${method}`, false, {
        pluginKind: "PLUGIN_PROVIDER_GONE",
      });
    if (this.drainingNamespaces.has(entry.namespace))
      throw new RpcCallError("UNAVAILABLE", `${method}: provider is draining`, true, {
        pluginKind: "PLUGIN_PROVIDER_GONE",
      });
    if (entry.decl.kind === "subscription")
      throw new RpcCallError("PRECONDITION_FAILED", `${method} is a subscription`, false);
    const args = params ?? {};
    if (!entry.input(args))
      throw new RpcCallError(
        "PRECONDITION_FAILED",
        `${method}: arguments failed the declared schema`,
        false,
        { pluginKind: "PLUGIN_SCHEMA_VIOLATION" },
      );
    let value: unknown;
    try {
      value = await entry.handlers.call(entry.decl.name, args, { kind: "mcp" });
    } catch (e) {
      if (e instanceof RpcCallError) throw e;
      throw new RpcCallError(
        "INTERNAL",
        `provider error in ${method}: ${e instanceof Error ? e.message : "unknown"}`,
        false,
      );
    }
    if (entry.output !== undefined && !entry.output(value))
      throw new RpcCallError("INTERNAL", `${method}: provider returned schema-invalid data`, false);
    return value;
  }

  async subscribe(
    ctx: CallerContext,
    method: string,
    params: unknown,
    emit: (payload: DynamicSubEvent) => void,
  ): Promise<{ snapshot: DynamicSubEvent; dispose: () => void }> {
    const entry = this.gate(ctx, method, params);
    if (entry.decl.kind !== "subscription")
      throw new RpcCallError("PRECONDITION_FAILED", `${method} is not a subscription`, false);

    let settleFirst: ((v: DynamicSubEvent) => void) | null = null;
    let rejectFirst: ((e: Error) => void) | null = null;
    let terminalError: { kind: string; message: string } | null = null;
    let published = false;
    const first = new Promise<DynamicSubEvent>((resolve, reject) => {
      settleFirst = resolve;
      rejectFirst = reject;
    });
    // Provider setup may itself be async. Mark early rejection handled while this method is still
    // awaiting the provider's release handle; awaiting `first` below still observes the error.
    void first.catch(() => undefined);
    const timer = setTimeout(() => {
      rejectFirst?.(
        new RpcCallError("TIMEOUT", `${method}: no initial snapshot within 5s`, true) as Error,
      );
    }, FIRST_SNAPSHOT_DEADLINE_MS);

    const sub: LiveSub = {
      namespace: entry.namespace,
      stop: () => {},
      ended: false,
      end: (error, stopUpstream) => {
        if (sub.ended) return;
        sub.ended = true;
        terminalError = error;
        clearTimeout(timer);
        if (!published) {
          if (settleFirst !== null) {
            rejectFirst?.(new RpcCallError("UNAVAILABLE", error.message, true));
            settleFirst = null;
            rejectFirst = null;
          }
        } else {
          try {
            emit({ kind: "unavailable", error });
          } catch (deliveryError) {
            this.logger.warn(
              "fieldd.plugin_service.subscription_terminal_delivery_failed",
              "A subscription consumer rejected its provider terminal event",
              {
                namespace: sub.namespace,
                error:
                  deliveryError instanceof Error ? deliveryError.message : String(deliveryError),
              },
            );
          }
        }
        try {
          if (stopUpstream) sub.stop();
        } catch (releaseError) {
          this.logger.warn(
            "fieldd.plugin_service.subscription_release_failed",
            "A provider subscription release failed during route withdrawal",
            {
              namespace: sub.namespace,
              error: releaseError instanceof Error ? releaseError.message : String(releaseError),
            },
          );
        } finally {
          this.subs.delete(sub);
        }
      },
    };

    const sink = {
      snapshot: (value: unknown) => {
        if (sub.ended) return;
        if (entry.snapshot !== undefined && !entry.snapshot(value)) {
          this.logger.error(
            "fieldd.plugin_service.subscription_snapshot_rejected",
            "Plugin service subscription snapshot failed its declared schema",
            undefined,
            { method, pluginId: entry.pluginId },
          );
          return;
        }
        const event: DynamicSubEvent = { kind: "snapshot", value };
        if (settleFirst !== null) {
          clearTimeout(timer);
          settleFirst(event);
          settleFirst = null;
          rejectFirst = null;
        } else {
          emit(event); // §14.5: a later authoritative snapshot rides the stream
        }
      },
      delta: (value: unknown) => {
        if (sub.ended || settleFirst !== null) return; // no deltas before the snapshot
        if (entry.delta !== undefined && !entry.delta(value)) {
          this.logger.error(
            "fieldd.plugin_service.subscription_delta_rejected",
            "Plugin service subscription delta failed its declared schema",
            undefined,
            { method, pluginId: entry.pluginId },
          );
          return;
        }
        emit({ kind: "delta", value });
      },
      end: (error?: { kind: string; message: string }) => {
        sub.end(error ?? { kind: "UNAVAILABLE", message: "provider ended the stream" }, false);
      },
    };

    let unsubscribe: () => void;
    try {
      unsubscribe = await entry.handlers.subscribe(entry.decl.name, params, callerInfo(ctx), sink);
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof RpcCallError) throw e;
      throw new RpcCallError(
        "INTERNAL",
        `provider error in ${method}: ${e instanceof Error ? e.message : "unknown"}`,
        false,
      );
    }
    let stopped = false;
    sub.stop = () => {
      if (stopped) return;
      stopped = true;
      unsubscribe();
    };
    if (sub.ended || this.drainingNamespaces.has(entry.namespace)) {
      try {
        sub.stop();
      } finally {
        clearTimeout(timer);
      }
      const error = terminalError ?? { kind: "UNAVAILABLE", message: "provider draining" };
      throw new RpcCallError("UNAVAILABLE", error.message, true);
    }
    this.subs.add(sub);

    let snapshot: DynamicSubEvent;
    try {
      snapshot = await first;
      if (sub.ended) {
        const error = terminalError ?? { kind: "UNAVAILABLE", message: "provider ended" };
        throw new RpcCallError("UNAVAILABLE", error.message, true);
      }
      published = true;
    } catch (error) {
      sub.ended = true;
      sub.stop();
      this.subs.delete(sub);
      throw error;
    } finally {
      clearTimeout(timer);
    }
    return {
      snapshot,
      dispose: () => {
        if (!sub.ended) {
          sub.ended = true;
          sub.stop();
        }
        this.subs.delete(sub);
      },
    };
  }

  dispose(): void {
    for (const sub of [...this.subs]) {
      if (!sub.ended) {
        sub.ended = true;
        try {
          sub.stop();
        } catch {
          // Registry shutdown continues across an ill-behaved provider release.
        }
      }
    }
    this.subs.clear();
    this.removeAllListeners();
  }

  /** shared §14.4 steps 1–3: resolve → capability gate → validate input */
  private gate(ctx: CallerContext, method: string, params: unknown): MethodEntry {
    const entry = this.methods.get(method);
    if (entry === undefined)
      throw new RpcCallError("NOT_FOUND", `no provider for ${method}`, false);
    if (this.drainingNamespaces.has(entry.namespace))
      throw new RpcCallError("UNAVAILABLE", `${method}: provider is draining`, true, {
        pluginKind: "PLUGIN_PROVIDER_GONE",
      });
    if (ctx.transport !== "ws-loopback")
      throw new RpcCallError(
        "FORBIDDEN_SCOPE",
        "dynamic methods are local-only (v1 — never federated)",
        false,
      );
    const cap = entry.decl.requiredCapability;
    if ((SCOPES as readonly string[]).includes(cap)) {
      const scopes =
        ctx.principal.kind === "local-token" ||
        ctx.principal.kind === "shell-main" ||
        ctx.principal.kind === "plugin"
          ? ctx.principal.scopes
          : [];
      if (!scopes.includes(cap))
        throw new RpcCallError("FORBIDDEN_SCOPE", `requires ${cap}`, false, { required: cap });
    } else if (ctx.principal.kind === "plugin") {
      const granted = this.opts.grantedCapabilities(ctx.principal.id) ?? [];
      if (!granted.includes(cap))
        throw new RpcCallError("FORBIDDEN_SCOPE", `requires ${cap}`, false, { required: cap });
    } else if (ctx.principal.kind !== "local-token" && ctx.principal.kind !== "shell-main") {
      // local-token non-plugin principals pass custom-cap gates — recorded v1
      // (the user's own trusted UI is the grant authority until P6 grants UX)
      throw new RpcCallError("FORBIDDEN_SCOPE", `requires ${cap}`, false, { required: cap });
    }
    if (!entry.input(params ?? {}))
      throw new RpcCallError("PRECONDITION_FAILED", `${method}: input failed its schema`, false, {
        issues: (entry.input.errors ?? []).map((e) => `${e.instancePath || "<root>"} ${e.message}`),
      });
    return entry;
  }

  private publish(): void {
    this.generation += 1;
    this.emit("changed", this.snapshot());
  }
}

function callerInfo(ctx: CallerContext): ServiceCallerInfo {
  if (ctx.principal.kind === "plugin") return { kind: "plugin", pluginId: ctx.principal.id };
  return { kind: ctx.principal.kind };
}
