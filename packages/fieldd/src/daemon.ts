import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONTRACTS_VERSION,
  METHODS,
  type NativeHealth,
  PORTS,
  SCOPES,
  type Scope,
} from "@vibefield/contracts";
import { MeshClient } from "./mesh-client";
import { NativeLink, RpcCallError } from "./native-link";
import { ProductApi } from "./product-api";
import { TokenService } from "./token-service";

// fieldd bootstrap (design-02 §3.6, P0 slice): tokens → NativeLink (pair +
// health subscription) → ProductAPI listen → run files → ready. SUPERSEDED is
// fatal for this product plane: the API stops immediately (never a zombie
// serving cached truth). Bootstrap is transactional: any failure after pairing
// releases the native single-client slot before rejecting.
//
// Track A adds the shell bootstrap contract: after listen, fieldd writes
// <dataDir>/fieldd/run/shell.token (0600, all scopes — the shell is the trusted
// root that mints narrower per-window tokens via system.mintWindowToken) and
// product.json (port/pid/bootId discovery metadata for adopt-or-spawn).

export interface FielddConfig {
  dataDir: string;
  controlPort?: number; // default PORTS.FIELDD_WS_CONTROL; 0 = ephemeral (tests)
  allowedOrigins?: string[];
  /** invoked when this fieldd must die (e.g. superseded by a newer boot) */
  onFatal?: (reason: string) => void;
  /** pid of a field-native the caller spawned (recorded in product.json for cleanup tooling) */
  nativePid?: number;
}

export interface FielddHealth {
  fieldd: { state: "up"; bootId: string; contractsVersion: string; startedAt: number; pid: number };
  nativeConnected: boolean;
  native: NativeHealth | null;
}

export interface FielddDaemon {
  bootId: string;
  controlPort: number;
  tokens: TokenService;
  native: NativeLink;
  mesh: MeshClient;
  /** the all-scopes token written to run/shell.token (tests read it here) */
  shellToken: string;
  health(): FielddHealth;
  nativeHealth(): NativeHealth | null;
  stop(): Promise<void>;
}

export async function bootstrap(config: FielddConfig): Promise<FielddDaemon> {
  const bootId = `fieldd-${randomBytes(8).toString("hex")}`;
  const startedAt = Date.now();
  const tokens = new TokenService();

  const native = new NativeLink({
    socketPath: join(config.dataDir, "native", "run", "mgmt.sock"),
    pairingFile: join(config.dataDir, "native", "pairing"),
    bootId,
  });
  await native.connect();

  // everything past pairing is transactional — never leak the client slot
  try {
    const mesh = new MeshClient(native);
    // -- health aggregation: native deltas + link liveness, one stream out --
    let latestHealth: NativeHealth | null = null;
    const healthListeners = new Set<(h: FielddHealth) => void>();
    const health = (): FielddHealth => ({
      fieldd: {
        state: "up",
        bootId,
        contractsVersion: CONTRACTS_VERSION,
        startedAt,
        pid: process.pid,
      },
      nativeConnected: native.connected,
      native: latestHealth,
    });
    const emitHealth = () => {
      const h = health();
      for (const fn of healthListeners) fn(h);
    };

    const { snapshot } = await native.subscribe(
      "native.lifecycle.health.subscribe",
      {},
      (payload) => {
        latestHealth = payload as NativeHealth; // deltas + reconnect re-snapshots (P5)
        emitHealth();
      },
    );
    latestHealth = snapshot as NativeHealth;
    // link down/up flips stream immediately (each backoff attempt re-emits; cheap and honest)
    native.on("reconnecting", emitHealth);
    native.on("connected", emitHealth);

    const api = new ProductApi({
      port: config.controlPort ?? PORTS.FIELDD_WS_CONTROL,
      tokens,
      ...(config.allowedOrigins ? { allowedOrigins: config.allowedOrigins } : {}),
    });

    api.register("system.health", () => health());
    api.register("system.capabilities", () => ({
      methods: METHODS.filter((m) => m.surface === "product").map((m) => m.method),
    }));
    api.registerSubscription("system.health.subscribe", (_ctx, _params, emit) => {
      const fn = (h: FielddHealth) => emit(h);
      healthListeners.add(fn);
      return { snapshot: health(), dispose: () => healthListeners.delete(fn) };
    });
    api.register("system.mintWindowToken", (ctx, params) => {
      const p = params as { scopes?: unknown; label?: unknown } | undefined;
      const scopes = p?.scopes;
      const label = p?.label;
      if (
        !Array.isArray(scopes) ||
        !scopes.every((s) => typeof s === "string") ||
        typeof label !== "string"
      )
        throw new RpcCallError(
          "PRECONDITION_FAILED",
          "expected { scopes: string[], label: string }",
        );
      if (scopes.some((s) => !(SCOPES as readonly string[]).includes(s)))
        throw new RpcCallError("PRECONDITION_FAILED", "unknown scope requested");
      // no privilege escalation: minted ⊆ caller's own grant
      const callerScopes = (ctx.principal as { scopes?: string[] }).scopes ?? [];
      const outside = scopes.filter((s) => !callerScopes.includes(s));
      if (outside.length > 0)
        throw new RpcCallError(
          "FORBIDDEN_SCOPE",
          `cannot mint beyond own grant: ${outside.join(",")}`,
          false,
          {
            outside,
          },
        );
      const grant = tokens.mint(scopes as Scope[], label);
      return { token: grant.token, tokenId: grant.tokenId, scopes: grant.scopes };
    });

    // SUPERSEDED = another fieldd owns the native plane now; this one is done.
    native.on("superseded", () => {
      api.close();
      native.close();
      config.onFatal?.("superseded: another fieldd took over this device's native plane");
    });

    const controlPort = await api.listen();

    // -- run files (shell bootstrap contract) --
    const runDir = join(config.dataDir, "fieldd", "run");
    mkdirSync(runDir, { recursive: true });
    const shellGrant = tokens.mint([...SCOPES], "shell");
    const tokenPath = join(runDir, "shell.token");
    const productPath = join(runDir, "product.json");
    writeFileSync(tokenPath, shellGrant.token, { mode: 0o600 });
    chmodSync(tokenPath, 0o600); // umask-proof
    writeFileSync(
      productPath,
      JSON.stringify(
        {
          port: controlPort,
          pid: process.pid,
          bootId,
          contractsVersion: CONTRACTS_VERSION,
          startedAt,
          nativePid: config.nativePid ?? null,
        },
        null,
        2,
      ) + "\n",
    );

    return {
      bootId,
      controlPort,
      tokens,
      native,
      mesh,
      shellToken: shellGrant.token,
      health,
      nativeHealth: () => latestHealth,
      async stop() {
        api.close();
        native.close();
        // a superseding fieldd rewrites these for the same dataDir — never
        // delete what is no longer ours
        if (!native.superseded) {
          rmSync(tokenPath, { force: true });
          rmSync(productPath, { force: true });
        }
      },
    };
  } catch (e) {
    native.close(); // rollback: release the mgmt client slot
    throw e;
  }
}
