import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { CONTRACTS_VERSION, METHODS, PORTS, type NativeHealth } from "@vibefield/contracts";
import { NativeLink } from "./native-link";
import { ProductApi } from "./product-api";
import { TokenService } from "./token-service";

// fieldd bootstrap (design-02 §3.6, P0 slice): tokens → NativeLink (pair +
// health subscription) → ProductAPI listen → ready. Single-instance lock (D10)
// and the remaining services land in their own milestones.

export interface FielddConfig {
  dataDir: string;
  controlPort?: number; // default PORTS.FIELDD_WS_CONTROL; 0 = ephemeral (tests)
  allowedOrigins?: string[];
}

export interface FielddDaemon {
  bootId: string;
  controlPort: number;
  tokens: TokenService;
  native: NativeLink;
  nativeHealth(): NativeHealth | null;
  stop(): Promise<void>;
}

export async function bootstrap(config: FielddConfig): Promise<FielddDaemon> {
  const bootId = `fieldd-${randomBytes(8).toString("hex")}`;
  const tokens = new TokenService();

  const native = new NativeLink({
    socketPath: join(config.dataDir, "native", "run", "mgmt.sock"),
    pairingFile: join(config.dataDir, "native", "pairing"),
    bootId,
  });
  await native.connect();

  let latestHealth: NativeHealth | null = null;
  const { snapshot } = await native.subscribe("native.lifecycle.health.subscribe", {}, (payload) => {
    latestHealth = payload as NativeHealth; // deltas + reconnect re-snapshots (P5)
  });
  latestHealth = snapshot as NativeHealth;

  const api = new ProductApi({
    port: config.controlPort ?? PORTS.FIELDD_WS_CONTROL,
    tokens,
    ...(config.allowedOrigins ? { allowedOrigins: config.allowedOrigins } : {}),
  });

  api.register("system.health", () => ({
    fieldd: { state: "up", bootId, contractsVersion: CONTRACTS_VERSION },
    native: latestHealth,
  }));
  api.register("system.capabilities", () => ({
    methods: METHODS.filter((m) => m.surface === "product").map((m) => m.method),
  }));

  const controlPort = await api.listen();

  return {
    bootId,
    controlPort,
    tokens,
    native,
    nativeHealth: () => latestHealth,
    async stop() {
      api.close();
      native.close();
    },
  };
}
