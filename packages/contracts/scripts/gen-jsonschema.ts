// zod → JSON Schema artifacts (design-01 §3). Committed under gen/jsonschema/;
// field-native's typify-generated Rust is produced from these files.
//
// DELIBERATELY ABSENT: src/plugins.ts and src/live-surfaces.ts. Plugin manifests
// are TS-only — field-native exposes no plugin loader (plugin spec §4.2).
// Live Surfaces v1 is likewise confined to Electron's local control/direct
// lanes; field-native has no reader. Generating Rust for either would be dead
// code the fixtures cannot exercise. The agent plane is absent for the same
// reason (AR-1…AR-5: src/agent-index.ts, src/agent-session.ts,
// src/agent-usage.ts) — every one of its seams is fieldd ↔ renderer or
// fieldd ↔ a sibling daemon over JSON, and field-native reads none of it.
// The files service's door tier (FS-1a, src/workspace.ts) is absent for the
// same reason: fieldd ↔ a window, a phone or a peer daemon, and fieldd ↔ its
// files worker — field-native has no reader. Its LAYOUT rows do reach Rust
// (gen-registries-rs.ts), as every LAYOUT row does. The trust model (TD-0:
// src/trust-root.ts, src/update-policy.ts, plugin-distribution.ts's
// RegistryIndexV2) is absent for the same reason: its verifiers are Electron
// main and fieldd, and field-native signs and reads none of it. So is WP8's
// packaged identity (plugin-distribution.ts's BundledPluginIndex,
// src/release-identity.ts): the stager writes it, the kit, fieldd and the shell
// read it, field-native never does. So are the wedge ladder's fieldd-side shapes
// (WG-D1, src/mgmt.ts): `NativeLinkHealth` (fieldd's health, read by a window),
// `SystemNativeRestartParams`/`Result` (a window's ask of fieldd), and the
// UNAVAILABLE details fieldd writes (`NativeUnavailableDetails`). The floor's
// half rides the bundle: `PingAck`, `NativeTickParams`, `HelloAck.pid` and
// `RpcRequest.deadlineAt`; its TIMEOUT details are JSON the floor writes, pinned
// by `error-data.native-deadline-passed.json` (the egress refusals' bargain).
// The inventory bound (IL-D4) is split the same way: the floor's half rides the
// bundle (`ObservedState.inventoryBoundMs` and `staleCells`, whose entry
// `ObservedStaleCell` is named below), while fieldd's composed view
// (`TerminalObservation.boundMs`/`staleCells`) and the stale refusal's details
// (`TerminalInventoryStaleDetails`) are src/terminal.ts's, which is TS-only.
// The freeway (FW-D4, src/freeway.ts) is HALF here: its floor seam — `native.freeway.declare`, the
// state stream, the joins, revoke — which field-native reads and writes. Its LINK wire (frames, the
// stream-0 messages, the open kinds) is the freeway host's, hand-written in Rust as the cell's TPv3
// wire is (`tp/wire.rs`), and pinned to these schemas by the `freeway-*` fixtures on both sides.
// The phone code (TS-7b, src/phone-code.ts) has no schema at all: a hand-written parser the Mac and the phone share
// through `phone-code.vector.json`, which field-native never reads.
// The person (src/users.ts — the roster file, the face, and IOS-8f's `UserMeResult`) is TS-only: fieldd and
// Electron main read and serve it, the phone decodes it by hand, and field-native reads none of it.
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
  NativeLastExit,
  NativeLastManager,
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
  FreewayAdmitRow,
  FreewayDeclareParams,
  FreewayDeclareResult,
  FreewayDoors,
  FreewayExposure,
  FreewayJoinRow,
  FreewayJoinsAckParams,
  FreewayJoinsAckResult,
  FreewayJoinsFrame,
  FreewayLinkRow,
  FreewayLinkState,
  FreewayRevokeParams,
  FreewayRevokeResult,
  FreewayState,
} from "../src/freeway";
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
  MeshEgressLoopbackAddress,
  MeshEgressProxy,
  MeshEgressRevision,
  MeshEgressRoute,
  MeshEgressRouteAddParams,
  MeshEgressRouteBound,
  MeshEgressRouteId,
  MeshEgressRouteRef,
  MeshEgressRouteTable,
  MeshEgressTarget,
  MeshFailure,
  MeshLaneClass,
  MeshLaneClosed,
  MeshLaneCloseRequest,
  MeshLaneOpenRequest,
  MeshLanePeerOpened,
  MeshLaneProtocol,
  MeshMode,
  MeshNotUpDetails,
  MeshRetireResult,
  MeshSelfIdentity,
  MeshStartParams,
  MeshStartResult,
  MeshStopResult,
  NativeDetachParams,
  NativeDetachResult,
  NativeDoorCaller,
  NativeDoorClosed,
  NativeDoorCloseParams,
  NativeDoorCloseResult,
  NativeDoorInfoResult,
  NativeDoorOpen,
  NativeDoorPane,
  NativeDoorSnapshot,
  NativeDoorSubscribeResult,
  NativeHealth,
  NativePrepareRestartParams,
  NativePrepareRestartResult,
  NativeRestartReason,
  NativeShutdownParams,
  NativeShutdownResult,
  NativeTickParams,
  ObservedStaleCell,
  ObservedState,
  ObservedTerminal,
  ObservedTerminalCell,
  ObservedWorker,
  PeerInfo,
  PingAck,
  ServeConfig,
  ServeEntry,
  ServeRoute,
  ServeTarget,
  StoreSnapshot,
  TerminalRoutesStreamPayload,
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
  // IL-D4 — the entry of `ObservedState.staleCells`, named so the floor reads
  // a typed `ObservedStaleCell`, not an anonymous item type
  ObservedStaleCell,
  ObservedState,
  WhoIsIdentity,
  PeerInfo,
  // TS-1 — the not-up answer's details and their failure word, named so the
  // floor writes a typed `MeshNotUpDetails` and the enum is not copied inline.
  MeshFailure,
  MeshNotUpDetails,
  MeshSelfIdentity,
  MeshRetireResult,
  // UA-P-0a — the posture verbs. `MeshMode` is named for the usual typify
  // reason: it is embedded by BOTH start shapes, so an unnamed copy dedupes
  // into a nested $ref in the bundle.
  MeshMode,
  MeshStartParams,
  MeshStartResult,
  MeshStopResult,
  StoreSnapshot,
  ServeTarget,
  // TM-2 (F-H3) — the routes serve's per-route shape, named for the same
  // typify reason as everything else here.
  ServeRoute,
  ServeConfig,
  ServeEntry,
  MeshLaneClass,
  MeshLaneProtocol,
  MeshLaneOpenRequest,
  MeshLaneCloseRequest,
  MeshLanePeerOpened,
  MeshLaneClosed,
  // CP-1a — the floor's door. The caller and the pane are named: both are embedded by the open door, which the
  // snapshot embeds in turn.
  NativeDoorCaller,
  NativeDoorPane,
  NativeDoorOpen,
  NativeDoorClosed,
  NativeDoorSnapshot,
  NativeDoorSubscribeResult,
  NativeDoorCloseParams,
  NativeDoorCloseResult,
  NativeDoorInfoResult,
  // DS-1 — egress. The three constrained strings are embedded by several
  // shapes each (the loopback address by the proxy answer, the bound route and
  // the table row), so every one is named for the usual typify reason; the
  // row is embedded by the table.
  MeshEgressLoopbackAddress,
  MeshEgressTarget,
  MeshEgressRouteId,
  MeshEgressRevision,
  MeshEgressProxy,
  MeshEgressRouteAddParams,
  MeshEgressRouteBound,
  MeshEgressRouteRef,
  MeshEgressRoute,
  MeshEgressRouteTable,
  // WP12 L2b (build-wp12-updater.md §9 R2/R3) — the restart intent, the floor's self-stop, and the hello ack's
  // `lastExit`, named so field-native reads typed values, never strings
  NativeLastExit,
  NativeRestartReason,
  NativePrepareRestartParams,
  NativePrepareRestartResult,
  NativeShutdownParams,
  NativeShutdownResult,
  NativeDetachParams,
  NativeDetachResult,
  NativeLastManager,
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
  "mesh-not-up-details": MeshNotUpDetails,
  "mesh-retire-result": MeshRetireResult,
  "mesh-start-params": MeshStartParams,
  "mesh-start-result": MeshStartResult,
  "mesh-stop-result": MeshStopResult,
  "store-snapshot": StoreSnapshot,
  "serve-config": ServeConfig,
  "serve-entry": ServeEntry,
  "mesh-lane-open-request": MeshLaneOpenRequest,
  "mesh-lane-close-request": MeshLaneCloseRequest,
  "mesh-lane-peer-opened": MeshLanePeerOpened,
  "mesh-lane-closed": MeshLaneClosed,
  "mesh-egress-proxy": MeshEgressProxy,
  "mesh-egress-route-add-params": MeshEgressRouteAddParams,
  "mesh-egress-route-bound": MeshEgressRouteBound,
  "mesh-egress-route-ref": MeshEgressRouteRef,
  "mesh-egress-route-table": MeshEgressRouteTable,
  // WP12 L2b (build-wp12-updater.md §9 R2/R3) — the floor records its restart intent, then stops itself
  "native-prepare-restart-params": NativePrepareRestartParams,
  "native-prepare-restart-result": NativePrepareRestartResult,
  "native-shutdown-params": NativeShutdownParams,
  "native-shutdown-result": NativeShutdownResult,
  // AL-8a (`thinking-app-lifecycle.md` §8.3.1) — fieldd's goodbye before a planned stop
  "native-detach-params": NativeDetachParams,
  "native-detach-result": NativeDetachResult,
  // FW-D4 — the freeway's floor seam: fieldd declares, the floor reports state and joins, revoke
  "freeway-declare-params": FreewayDeclareParams,
  "freeway-declare-result": FreewayDeclareResult,
  "freeway-state": FreewayState,
  "freeway-revoke-params": FreewayRevokeParams,
  "freeway-revoke-result": FreewayRevokeResult,
  "freeway-joins-frame": FreewayJoinsFrame,
  "freeway-joins-ack-params": FreewayJoinsAckParams,
  "freeway-joins-ack-result": FreewayJoinsAckResult,
  // WG-D6 (draft/thinking-floor-wedge.md §7) — the pong whose `ts` a late reply is kept
  // with, and the floor's own tick
  "ping-ack": PingAck,
  "native-tick-params": NativeTickParams,
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
      // E-F1 — the routes STREAM payload (the snapshot plus the floor's live
      // `terminalMesh` push). BUNDLE-ONLY, not BASE_SHARED: nothing else embeds
      // it, and BASE_SHARED is copied verbatim into all 21 per-entry files.
      TerminalRoutesStreamPayload,
      // FW-D4 — the freeway's floor seam (src/freeway.ts). BUNDLE-ONLY for the
      // same reason: its rows are embedded by its own messages alone, and each is
      // named here so typify resolves it rather than a nested path.
      FreewayAdmitRow,
      FreewayDoors,
      FreewayExposure,
      FreewayDeclareParams,
      FreewayDeclareResult,
      FreewayLinkState,
      FreewayLinkRow,
      FreewayState,
      FreewayRevokeParams,
      FreewayRevokeResult,
      FreewayJoinRow,
      FreewayJoinsFrame,
      FreewayJoinsAckParams,
      FreewayJoinsAckResult,
      // WG-D6 — the wedge ladder's floor half: the pong the floor builds and its
      // tick's params. Bundle-only for the same reason: nothing else embeds them.
      PingAck,
      NativeTickParams,
    },
  }),
);
writeFileSync(join(OUT, "bundle.json"), JSON.stringify(bundle, null, 2) + "\n");
console.log("wrote bundle.json (typify input)");
console.log(`wrote ${Object.keys(ENTRIES).length} schemas -> gen/jsonschema/`);
