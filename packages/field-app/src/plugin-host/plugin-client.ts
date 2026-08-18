import { PluginsOpenRendererSessionResult } from "@vibefield/contracts";
import { FielddClient } from "@vibefield/fieldd-client";
import type { PluginProductClient } from "@vibefield/plugin-sdk";

// P3b / PRC-3b — plugin-bound product clients (§11.2): every plugin call rides its OWN
// connection whose bearer token is a short-lived, plugin-scoped lease minted by
// plugins.openRendererSession. fieldd derives {kind:"plugin"} from the lease's plugin binding —
// attribution AND enforcement, never renderer claims or the window's shared principal.
//
// The proxy handed to plugin code is stable and lazy. Its underlying connection is also stable
// across credential renewal: FielddClient rotates the bearer, reconnects, and replays established
// subscriptions with fresh snapshots. Mint results are fenced by the exact registry observation
// and exact window-backend episode, so an out-of-order response can never resurrect stale authority.

export interface PluginLeaseObservation {
  readonly manifestHash?: string;
  readonly grantGeneration?: number;
}

export interface PluginClientBackend {
  readonly windowClient: Pick<FielddClient, "request" | "url">;
}

/** PRC-5e credential minted from an exact update/member/source fence. It seeds a private broker;
 * ordinary `plugins.openRendererSession` renewal remains unavailable until the candidate is live. */
export interface PluginClientLeaseSeed {
  readonly token: string;
  readonly pluginId: string;
  readonly manifestHash: string;
  readonly grantGeneration: number;
  readonly expiresAt: number;
}

interface LeaseConnection {
  connect(): void;
  rotateCredential(credential: string): void;
  ready(): Promise<void>;
  close(): void;
  request(method: string, params?: unknown): Promise<unknown>;
  subscribe(
    method: string,
    params: unknown,
    onEvent: (payload: unknown, kind: "snapshot" | "delta") => void,
  ): Promise<{ readonly snapshot: unknown; readonly unsubscribe: () => void }>;
}

interface LeaseConnectionOptions {
  readonly url: string;
  readonly token: string;
  readonly clientKind: "renderer";
}

export interface PluginClientLeaseBrokerOptions {
  readonly now?: () => number;
  /** Production constructs FielddClient. This structural seam keeps race probes socket-free. */
  readonly createClient?: (options: LeaseConnectionOptions) => LeaseConnection;
  readonly renewBeforeMs?: number;
}

interface InflightLease {
  readonly observationEpoch: number;
  readonly backendEpoch: number;
  readonly task: Promise<LeaseConnection>;
}

interface PluginLeaseState {
  readonly pluginId: string;
  observation: PluginLeaseObservation;
  observationEpoch: number;
  client: LeaseConnection | null;
  expiresAt: number;
  installedObservationEpoch: number;
  installedBackendEpoch: number;
  inflight: InflightLease | null;
}

const STALE_MINT = Symbol("stale plugin lease mint");
const DEFAULT_RENEW_BEFORE_MS = 60_000;

function sameObservation(left: PluginLeaseObservation, right: PluginLeaseObservation): boolean {
  return left.manifestHash === right.manifestHash && left.grantGeneration === right.grantGeneration;
}

function untilAbort<T>(
  task: Promise<T>,
  signal: AbortSignal | undefined,
  label: string,
): Promise<T> {
  if (signal === undefined) return task;
  if (signal.aborted) return Promise.reject(new Error(`${label} aborted`));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error(`${label} aborted`));
    signal.addEventListener("abort", onAbort, { once: true });
    void task.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** One renderer realm's plugin-credential authority. The class form is intentional: production
 * uses the singleton below, while deterministic tests can own an isolated clock and transport. */
export class PluginClientLeaseBroker {
  private backend: PluginClientBackend | null = null;
  private backendEpoch = 0;
  private readonly states = new Map<string, PluginLeaseState>();
  private readonly now: () => number;
  private readonly createClient: (options: LeaseConnectionOptions) => LeaseConnection;
  private readonly renewBeforeMs: number;

  constructor(options: PluginClientLeaseBrokerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.createClient =
      options.createClient ??
      ((clientOptions) =>
        new FielddClient({
          url: clientOptions.url,
          token: clientOptions.token,
          clientKind: clientOptions.clientKind,
        }));
    this.renewBeforeMs = options.renewBeforeMs ?? DEFAULT_RENEW_BEFORE_MS;
  }

  setBackend(next: PluginClientBackend | null): void {
    if (
      next === this.backend ||
      (next !== null && this.backend !== null && next.windowClient === this.backend.windowClient)
    ) {
      return;
    }
    this.backend = next;
    this.backendEpoch += 1;
    for (const state of this.states.values()) {
      state.client?.close();
      state.client = null;
      state.expiresAt = 0;
      state.installedObservationEpoch = -1;
      state.installedBackendEpoch = -1;
      // A detached task may still settle, but its captured backend epoch can no longer install.
      state.inflight = null;
    }
  }

  /** The stable, lazy ctx.client proxy for one plugin in this renderer realm. */
  createProductClient(pluginId: string, observation?: PluginLeaseObservation): PluginProductClient {
    const state = this.stateFor(pluginId);
    if (observation !== undefined) this.observe(state, observation);
    return Object.freeze({
      request: async (method: string, params?: unknown): Promise<unknown> => {
        const client = await this.leasedClient(state);
        return await client.request(method, params);
      },
      subscribe: async (
        method: string,
        params: unknown,
        onEvent: (payload: unknown) => void,
      ): Promise<{ snapshot: unknown; unsubscribe: () => void }> => {
        const client = await this.leasedClient(state);
        const subscription = await client.subscribe(method, params, (payload) => onEvent(payload));
        return { snapshot: subscription.snapshot, unsubscribe: subscription.unsubscribe };
      },
    });
  }

  /** Install one already-authorized candidate credential without consulting the live-row mint.
   * The connection remains this broker's exact state, so expiry renews through the ordinary path
   * and `retire()` synchronously closes it with the owning activation scope. */
  createSeededProductClient(
    pluginId: string,
    observation: PluginLeaseObservation,
    seed: PluginClientLeaseSeed,
  ): PluginProductClient {
    if (seed.pluginId !== pluginId)
      throw new Error(`plugin ${pluginId}: seed belongs to ${seed.pluginId}`);
    if (observation.manifestHash === undefined || seed.manifestHash !== observation.manifestHash) {
      throw new Error(
        `plugin ${pluginId}: seed manifest ${seed.manifestHash} does not match ${String(observation.manifestHash)}`,
      );
    }
    if (
      observation.grantGeneration === undefined ||
      seed.grantGeneration !== observation.grantGeneration
    ) {
      throw new Error(
        `plugin ${pluginId}: seed generation ${seed.grantGeneration} does not match ${String(observation.grantGeneration)}`,
      );
    }
    if (seed.token.trim().length === 0)
      throw new Error(`plugin ${pluginId}: candidate seed is empty`);
    if (!Number.isSafeInteger(seed.grantGeneration) || seed.grantGeneration < 0)
      throw new Error(`plugin ${pluginId}: candidate seed generation is invalid`);
    if (!Number.isFinite(seed.expiresAt) || seed.expiresAt <= this.now())
      throw new Error(`plugin ${pluginId}: candidate seed is expired`);
    const backend = this.backend;
    if (backend === null)
      throw new Error(`plugin ${pluginId}: no fieldd connection (daemon away or still booting)`);
    const state = this.stateFor(pluginId);
    if (state.client !== null || state.inflight !== null)
      throw new Error(`plugin ${pluginId}: candidate broker is already initialized`);
    this.observe(state, observation);
    const observationEpoch = state.observationEpoch;
    const backendEpoch = this.backendEpoch;
    const client = this.createClient({
      url: backend.windowClient.url,
      token: seed.token,
      clientKind: "renderer",
    });
    try {
      client.connect();
    } catch (error) {
      client.close();
      throw error;
    }
    state.client = client;
    state.expiresAt = seed.expiresAt;
    state.installedObservationEpoch = observationEpoch;
    state.installedBackendEpoch = backendEpoch;
    return this.createProductClient(pluginId, observation);
  }

  /** Update provenance without replacing the plugin-visible proxy or its live connection.
   * A completely lazy client has nothing to rotate; an active or minting client must acknowledge
   * the fresh credential before this resolves. */
  async refresh(
    pluginId: string,
    observation: PluginLeaseObservation,
    signal?: AbortSignal,
  ): Promise<void> {
    const state = this.stateFor(pluginId);
    const hadCredentialWork = state.client !== null || state.inflight !== null;
    this.observe(state, observation);
    if (!hadCredentialWork) return;
    const label = `plugin ${pluginId}: credential refresh`;
    const client = await untilAbort(this.leasedClient(state), signal, label);
    try {
      await untilAbort(client.ready(), signal, label);
    } catch (error) {
      if (state.client === client) state.expiresAt = 0;
      throw error;
    }
  }

  /** Exact state retirement: detached mint completions retain their old object identity and are
   * refused even if a later activation creates another state for the same plugin id. */
  retire(pluginId: string): void {
    const state = this.states.get(pluginId);
    if (state === undefined) return;
    this.states.delete(pluginId);
    state.observationEpoch += 1;
    state.inflight = null;
    state.client?.close();
    state.client = null;
  }

  private stateFor(pluginId: string): PluginLeaseState {
    let state = this.states.get(pluginId);
    if (state !== undefined) return state;
    state = {
      pluginId,
      observation: {},
      observationEpoch: 0,
      client: null,
      expiresAt: 0,
      installedObservationEpoch: -1,
      installedBackendEpoch: -1,
      inflight: null,
    };
    this.states.set(pluginId, state);
    return state;
  }

  private observe(state: PluginLeaseState, observation: PluginLeaseObservation): void {
    if (sameObservation(state.observation, observation)) return;
    state.observation = Object.freeze({ ...observation });
    state.observationEpoch += 1;
  }

  private async leasedClient(state: PluginLeaseState): Promise<LeaseConnection> {
    for (;;) {
      this.assertLive(state);
      const current = this.backend;
      if (current === null)
        throw new Error(
          `plugin ${state.pluginId}: no fieldd connection (daemon away or still booting)`,
        );
      const observationEpoch = state.observationEpoch;
      const backendEpoch = this.backendEpoch;
      if (
        state.client !== null &&
        state.installedObservationEpoch === observationEpoch &&
        state.installedBackendEpoch === backendEpoch &&
        this.now() < state.expiresAt - this.renewBeforeMs
      ) {
        return state.client;
      }

      let inflight = state.inflight;
      if (
        inflight === null ||
        inflight.observationEpoch !== observationEpoch ||
        inflight.backendEpoch !== backendEpoch
      ) {
        const task = this.mintAndInstall(state, current, observationEpoch, backendEpoch);
        inflight = { observationEpoch, backendEpoch, task };
        state.inflight = inflight;
        void task.then(
          () => {
            if (state.inflight === inflight) state.inflight = null;
          },
          () => {
            if (state.inflight === inflight) state.inflight = null;
          },
        );
      }
      try {
        return await inflight.task;
      } catch (error) {
        if (error === STALE_MINT) continue;
        throw error;
      }
    }
  }

  private async mintAndInstall(
    state: PluginLeaseState,
    backend: PluginClientBackend,
    observationEpoch: number,
    backendEpoch: number,
  ): Promise<LeaseConnection> {
    const observation = state.observation;
    let raw: unknown;
    try {
      raw = await backend.windowClient.request("plugins.openRendererSession", {
        pluginId: state.pluginId,
        ...(observation.manifestHash !== undefined
          ? { manifestHash: observation.manifestHash }
          : {}),
        ...(observation.grantGeneration !== undefined
          ? { grantGeneration: observation.grantGeneration }
          : {}),
      });
    } catch (error) {
      // A compare-and-mint refusal from an observation that has already been superseded is not the
      // newest caller's failure. Converge that caller through the current episode instead.
      if (!this.isCurrentMint(state, backend, observationEpoch, backendEpoch)) throw STALE_MINT;
      throw error;
    }
    if (!this.isCurrentMint(state, backend, observationEpoch, backendEpoch)) throw STALE_MINT;
    const parsed = PluginsOpenRendererSessionResult.safeParse(raw);
    if (!parsed.success)
      throw new Error(
        `plugin ${state.pluginId}: unreadable lease (${parsed.error.issues[0]?.message})`,
      );
    if (parsed.data.pluginId !== state.pluginId)
      throw new Error(`plugin ${state.pluginId}: lease names ${parsed.data.pluginId}`);
    if (
      observation.grantGeneration !== undefined &&
      parsed.data.grantGeneration !== observation.grantGeneration
    )
      throw new Error(
        `plugin ${state.pluginId}: lease generation ${parsed.data.grantGeneration} does not match ${observation.grantGeneration}`,
      );
    if (!this.isCurrentMint(state, backend, observationEpoch, backendEpoch)) throw STALE_MINT;

    let client = state.client;
    if (client === null) {
      client = this.createClient({
        url: backend.windowClient.url,
        token: parsed.data.token,
        clientKind: "renderer",
      });
      client.connect();
      state.client = client;
    } else {
      client.rotateCredential(parsed.data.token);
    }
    state.expiresAt = parsed.data.expiresAt;
    state.installedObservationEpoch = observationEpoch;
    state.installedBackendEpoch = backendEpoch;
    return client;
  }

  private isCurrentMint(
    state: PluginLeaseState,
    backend: PluginClientBackend,
    observationEpoch: number,
    backendEpoch: number,
  ): boolean {
    return (
      this.states.get(state.pluginId) === state &&
      this.backend === backend &&
      this.backendEpoch === backendEpoch &&
      state.observationEpoch === observationEpoch
    );
  }

  private assertLive(state: PluginLeaseState): void {
    if (this.states.get(state.pluginId) !== state)
      throw new Error(`plugin ${state.pluginId}: product client retired`);
  }
}

const defaultBroker = new PluginClientLeaseBroker();

export function setPluginClientBackend(next: PluginClientBackend | null): void {
  defaultBroker.setBackend(next);
}

export function refreshPluginProductClient(
  pluginId: string,
  observation: PluginLeaseObservation,
  signal?: AbortSignal,
): Promise<void> {
  return defaultBroker.refresh(pluginId, observation, signal);
}

export function retirePluginProductClient(pluginId: string): void {
  defaultBroker.retire(pluginId);
}

/** The ctx.client the harness hands a plugin — lazy: no lease, no connection until the plugin
 * actually calls. Staged callers supply the exact artifact/grant observation. */
export function createPluginProductClient(
  pluginId: string,
  observation?: PluginLeaseObservation,
): PluginProductClient {
  return defaultBroker.createProductClient(pluginId, observation);
}
