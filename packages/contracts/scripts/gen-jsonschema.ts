// zod → JSON Schema artifacts (design-01 §3). Committed under gen/jsonschema/;
// field-native's typify-generated Rust is produced from these files.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  ClientKind,
  Hello,
  HelloAck,
  PairingMac,
  RpcError,
  RpcFailure,
  RpcId,
  RpcNotification,
  RpcRequest,
  RpcResponse,
  RpcSuccess,
  SemverString,
  ServerKind,
} from "../src/envelope";
import { ErrorData, ErrorKind, UnavailableDetails } from "../src/errors";
import {
  DesiredState,
  DesiredTerminal,
  DesiredWorker,
  MeshConfig,
  NativeHealth,
  ObservedState,
  ObservedTerminal,
  ObservedWorker,
  PeerInfo,
  ServeConfig,
  ServeEntry,
  ServeTarget,
  StoreSnapshot,
  UnitHealth,
  UnitState,
  WhoIsIdentity,
} from "../src/mgmt";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "gen", "jsonschema");
mkdirSync(OUT, { recursive: true });

// Shared sub-schemas become NAMED definitions so refs are typify-resolvable
// (#/definitions/X — never nested property paths).
const SHARED = {
  SemverString,
  ClientKind,
  ServerKind,
  PairingMac,
  ErrorKind,
  UnavailableDetails,
  ErrorData,
  RpcError,
  RpcId,
  RpcFailure,
  RpcSuccess,
  // mgmt (M2) — EVERY shared/reused sub-schema must be named here, or
  // zod-to-json-schema dedupes it into a nested $ref typify cannot resolve.
  UnitState,
  UnitHealth,
  NativeHealth,
  DesiredTerminal,
  DesiredWorker,
  MeshConfig,
  DesiredState,
  ObservedTerminal,
  ObservedWorker,
  ObservedState,
  WhoIsIdentity,
  PeerInfo,
  StoreSnapshot,
  ServeTarget,
  ServeConfig,
  ServeEntry,
} as const;

const ENTRIES: Record<string, ZodTypeAny> = {
  hello: Hello,
  "hello-ack": HelloAck,
  "pairing-mac": PairingMac,
  "rpc-request": RpcRequest,
  "rpc-notification": RpcNotification,
  "rpc-response": RpcResponse,
  "error-data": ErrorData,
  "unavailable-details": UnavailableDetails,
  "native-health": NativeHealth,
  "desired-state": DesiredState,
  "observed-state": ObservedState,
  "peer-info": PeerInfo,
  "store-snapshot": StoreSnapshot,
  "serve-config": ServeConfig,
  "serve-entry": ServeEntry,
};

for (const [name, schema] of Object.entries(ENTRIES)) {
  const titled = name
    .split("-")
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join("");
  const js = zodToJsonSchema(schema, { name: titled, definitions: SHARED });
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(js, null, 2) + "\n");
}

// One bundle with every type as a named definition — the single typify input
// (per-type files would each duplicate the shared definitions).
const bundle = zodToJsonSchema(Hello, {
  name: "Hello",
  definitions: {
    ...SHARED,
    HelloAck,
    RpcRequest,
    RpcNotification,
    RpcResponse,
  },
});
writeFileSync(join(OUT, "bundle.json"), JSON.stringify(bundle, null, 2) + "\n");
console.log("wrote bundle.json (typify input)");
console.log(`wrote ${Object.keys(ENTRIES).length} schemas -> gen/jsonschema/`);
