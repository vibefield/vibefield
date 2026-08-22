// zod → JSON Schema artifacts (design-01 §3). Committed under gen/jsonschema/;
// field-native's typify-generated Rust is produced from these files.
//
// DELIBERATELY ABSENT: src/plugins.ts and src/live-surfaces.ts. Plugin manifests
// are TS-only — field-native exposes no plugin loader (plugin spec §4.2).
// Live Surfaces v1 is likewise confined to Electron's local control/direct
// lanes; field-native has no reader. Generating Rust for either would be dead
// code the fixtures cannot exercise.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  DiagnosticCursorV1,
  DiagnosticLogDeltaV1,
  DiagnosticLogSnapshotV1,
  DiagnosticProducerStateV1,
} from "../src/diagnostics";
import {
  CellEndpointSet,
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
  TerminalCellRole,
  TerminalEndpoints,
  TerminalRouteCell,
  TerminalRouteSnapshot,
  TerminalWorkloadClass,
} from "../src/envelope";
import { ErrorData, ErrorKind, UnavailableDetails } from "../src/errors";
import {
  LOG_LEVEL_VALUES_V1,
  LogAttributesV1,
  LogBoundedIdentityV1,
  LogErrorV1,
  LoggingBufferHealthV1,
  LoggingCountersV1,
  LoggingFailureV1,
  LoggingHealthV1,
  LoggingWriterStateV1,
  LogLevelNameV1,
  LogLevelV1,
  LogRecordV1,
  LogRoleV1,
  LogSafeIntegerV1,
  LogSchemaVersionV1,
  LogServiceV1,
  LogSeverityV1,
  LogStreamV1,
  LogTruncationReasonV1,
  LogTruncationV1,
  LogValueV1,
  PluginLogProvenanceV1,
} from "../src/logging";
import {
  DesiredState,
  DesiredTerminal,
  DesiredWorker,
  MeshConfig,
  MeshLaneClass,
  MeshLaneClosed,
  MeshLaneCloseRequest,
  MeshLaneOpenRequest,
  MeshLanePeerOpened,
  MeshLaneProtocol,
  MeshRetireResult,
  MeshSelfIdentity,
  NativeHealth,
  ObservedState,
  ObservedTerminal,
  ObservedTerminalCell,
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
const BASE_SHARED = {
  SemverString,
  ClientKind,
  ServerKind,
  PairingMac,
  // NF-D8 — rides HelloAck (mgmt surface); named so the $ref stays
  // typify-resolvable.
  CellEndpointSet,
  TerminalEndpoints,
  // TC-D15 (TC-S2) — the revisioned route snapshot + its cell row; both
  // named for the same typify reason. TC-S3 adds the class/role enums and
  // the inventory's cell tag.
  TerminalWorkloadClass,
  TerminalCellRole,
  TerminalRouteCell,
  TerminalRouteSnapshot,
  ObservedTerminalCell,
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
  MeshSelfIdentity,
  MeshRetireResult,
  StoreSnapshot,
  ServeTarget,
  ServeConfig,
  ServeEntry,
  MeshLaneClass,
  MeshLaneProtocol,
  MeshLaneOpenRequest,
  MeshLaneCloseRequest,
  MeshLanePeerOpened,
  MeshLaneClosed,
} as const;

// Logging/diagnostics (LOG-42) — ONLY the native-consumed subset. Audit,
// leases, queries, parse failures, and support manifests stay TS-only until
// field-native has a real reader.
const LOGGING_SHARED = {
  LogAttributesV1,
  LogBoundedIdentityV1,
  LogSafeIntegerV1,
  LogSchemaVersionV1,
  LogLevelV1,
  LogLevelNameV1,
  LogSeverityV1,
  LogServiceV1,
  LogRoleV1,
  LogStreamV1,
  LogValueV1,
  PluginLogProvenanceV1,
  LogErrorV1,
  LogTruncationReasonV1,
  LogTruncationV1,
  LogRecordV1,
  LoggingWriterStateV1,
  LoggingBufferHealthV1,
  LoggingCountersV1,
  LoggingFailureV1,
  LoggingHealthV1,
  DiagnosticProducerStateV1,
  DiagnosticCursorV1,
} as const;

const ALL_SHARED = { ...BASE_SHARED, ...LOGGING_SHARED } as const;

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
  "mesh-self-identity": MeshSelfIdentity,
  "mesh-retire-result": MeshRetireResult,
  "store-snapshot": StoreSnapshot,
  "serve-config": ServeConfig,
  "serve-entry": ServeEntry,
  "mesh-lane-open-request": MeshLaneOpenRequest,
  "mesh-lane-close-request": MeshLaneCloseRequest,
  "mesh-lane-peer-opened": MeshLanePeerOpened,
  "mesh-lane-closed": MeshLaneClosed,
  "log-record-v1": LogRecordV1,
  "logging-health-v1": LoggingHealthV1,
  "diagnostic-log-snapshot-v1": DiagnosticLogSnapshotV1,
  "diagnostic-log-delta-v1": DiagnosticLogDeltaV1,
};

const LOGGING_ENTRIES = new Set([
  "log-record-v1",
  "logging-health-v1",
  "diagnostic-log-snapshot-v1",
  "diagnostic-log-delta-v1",
]);

function tightenLoggingWireSchema<T>(schema: T): T {
  const definitions = (schema as { definitions?: Record<string, unknown> }).definitions;
  if (definitions?.LogLevelV1 !== undefined) {
    definitions.LogLevelV1 = {
      type: "integer",
      enum: [...LOG_LEVEL_VALUES_V1],
    };
  }
  if (definitions?.LogAttributesV1 !== undefined) {
    definitions.LogAttributesV1 = {
      type: "object",
      additionalProperties: { $ref: "#/definitions/LogValueV1" },
    };
  }
  return schema;
}

for (const [name, schema] of Object.entries(ENTRIES)) {
  const titled = name
    .split("-")
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join("");
  const definitions = LOGGING_ENTRIES.has(name) ? LOGGING_SHARED : BASE_SHARED;
  const js = tightenLoggingWireSchema(zodToJsonSchema(schema, { name: titled, definitions }));
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(js, null, 2) + "\n");
}

// One bundle with every type as a named definition — the single typify input
// (per-type files would each duplicate the shared definitions).
const bundle = tightenLoggingWireSchema(
  zodToJsonSchema(Hello, {
    name: "Hello",
    definitions: {
      ...ALL_SHARED,
      HelloAck,
      RpcRequest,
      RpcNotification,
      RpcResponse,
      DiagnosticLogSnapshotV1,
      DiagnosticLogDeltaV1,
    },
  }),
);
writeFileSync(join(OUT, "bundle.json"), JSON.stringify(bundle, null, 2) + "\n");
console.log("wrote bundle.json (typify input)");
console.log(`wrote ${Object.keys(ENTRIES).length} schemas -> gen/jsonschema/`);
