import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";
import {
  ArtifactCatalogSlice,
  ArtifactPublishV2Params,
  ArtifactStatus,
  ArtifactView,
  LocalArtifactIntent,
} from "../src/artifacts";
import { DeviceInfo, DeviceSlice } from "../src/devices";
import {
  AuditRecordV1,
  DiagnosticLeaseV1,
  DiagnosticLogDeltaV1,
  DiagnosticLogSnapshotV1,
  SupportBundleManifestV1,
} from "../src/diagnostics";
import {
  DocMeta,
  DocOpenResult,
  DocRegistryEntry,
  DocRenameParams,
  LaneErr,
  LaneHello,
  LaneHelloOk,
  LanePutMeta,
} from "../src/docs";
import { Hello, HelloAck, RpcRequest, RpcResponse, TerminalRouteSnapshot } from "../src/envelope";
import { ErrorData } from "../src/errors";
import { LoggingHealthV1, LogRecordV1 } from "../src/logging";
import {
  DesiredState,
  MeshLaneClosed,
  MeshLaneCloseRequest,
  MeshLaneOpenRequest,
  MeshLanePeerOpened,
  NativeHealth,
  ObservedState,
  PeerInfo,
  ServeConfig,
  ServeEntry,
  StoreSnapshot,
} from "../src/mgmt";
import { PluginRegistrySnapshot } from "../src/plugin-registry";
import { PluginManifestV1 } from "../src/plugins";
import { TerminalCreateParams, TerminalTicket } from "../src/terminal";
import {
  AttachControlLeg,
  AttachFramesLeg,
  CellActivationStatus,
  CellTransportGrant,
  ClaimGeometry,
  ConnectionAccepted,
  ConnectionHello,
  ConnectionRefused,
  ControlLegAttached,
  DeclareDemand,
  FramesLegAttached,
  GeometryCommitted,
  PresentationEnvelopeHeader,
  PresentationStatus,
  ProductSessionRosterItem,
  SceneApplied,
  SessionAttachGrant,
  TerminalCreateOpenResult,
  TerminalOpenTicketResult,
  TerminalRenewAttachParams,
  TransferGeometry,
  TransportCredit,
} from "../src/terminal-pipeline";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

// filename prefix (before the first ".") → schema
const SCHEMA_BY_PREFIX: Record<string, ZodTypeAny> = {
  hello: Hello,
  "hello-ack": HelloAck,
  "rpc-request": RpcRequest,
  "rpc-response": RpcResponse,
  "error-data": ErrorData,
  "artifact-publish": ArtifactPublishV2Params,
  "artifact-intent": LocalArtifactIntent,
  "artifact-status": ArtifactStatus,
  "artifact-catalog": ArtifactCatalogSlice,
  "artifact-view": ArtifactView,
  "native-health": NativeHealth,
  "desired-state": DesiredState,
  "observed-state": ObservedState,
  "peer-info": PeerInfo,
  "store-snapshot": StoreSnapshot,
  "serve-config": ServeConfig,
  "serve-entry": ServeEntry,
  "mesh-lane-open-request": MeshLaneOpenRequest,
  "mesh-lane-close-request": MeshLaneCloseRequest,
  "mesh-lane-peer-opened": MeshLanePeerOpened,
  "mesh-lane-closed": MeshLaneClosed,
  "doc-registry-entry": DocRegistryEntry,
  "doc-open-result": DocOpenResult,
  "doc-rename-params": DocRenameParams,
  "doc-meta": DocMeta,
  "lane-hello": LaneHello,
  "lane-hello-ok": LaneHelloOk,
  "lane-put-meta": LanePutMeta,
  "lane-err": LaneErr,
  "device-slice": DeviceSlice,
  "device-info": DeviceInfo,
  "plugin-manifest": PluginManifestV1,
  "plugin-registry-snapshot": PluginRegistrySnapshot,
  "log-record": LogRecordV1,
  "logging-health": LoggingHealthV1,
  "diagnostic-snapshot": DiagnosticLogSnapshotV1,
  "diagnostic-delta": DiagnosticLogDeltaV1,
  "diagnostic-lease": DiagnosticLeaseV1,
  "audit-record": AuditRecordV1,
  "support-manifest": SupportBundleManifestV1,
  "terminal-ticket": TerminalTicket,
  "terminal-routes": TerminalRouteSnapshot,
  "terminal-create-params": TerminalCreateParams,
  // TPv3 (terminal-pipeline.ts; spec §20 item 1) — every wire shape has a pinned fixture.
  "tp-transport-grant": CellTransportGrant,
  "tp-attach-grant": SessionAttachGrant,
  "tp-open-ticket": TerminalOpenTicketResult,
  "tp-create-open": TerminalCreateOpenResult,
  "tp-renew-attach-params": TerminalRenewAttachParams,
  "tp-connection-hello": ConnectionHello,
  "tp-connection-accepted": ConnectionAccepted,
  "tp-connection-refused": ConnectionRefused,
  "tp-attach-control-leg": AttachControlLeg,
  "tp-control-leg-attached": ControlLegAttached,
  "tp-attach-frames-leg": AttachFramesLeg,
  "tp-frames-leg-attached": FramesLegAttached,
  "tp-scene-applied": SceneApplied,
  "tp-cell-activation-status": CellActivationStatus,
  "tp-presentation-status": PresentationStatus,
  "tp-declare-demand": DeclareDemand,
  "tp-claim-geometry": ClaimGeometry,
  "tp-transfer-geometry": TransferGeometry,
  "tp-geometry-committed": GeometryCommitted,
  "tp-transport-credit": TransportCredit,
  "tp-roster-item": ProductSessionRosterItem,
  "tp-envelope-header": PresentationEnvelopeHeader,
};

// *.vector.json = cross-language crypto vectors, not wire shapes — pinned by their own tests.
const isWireFixture = (f: string) => f.endsWith(".json") && !f.endsWith(".vector.json");

describe("golden fixtures parse (the fixture is the contract)", () => {
  const files = readdirSync(FIXTURES).filter(isWireFixture);
  it("covers every fixture with a schema", () => {
    for (const f of files) {
      const prefix = f.split(".")[0]!;
      expect(SCHEMA_BY_PREFIX[prefix], `no schema mapped for fixture ${f}`).toBeDefined();
    }
    expect(files.length).toBeGreaterThanOrEqual(16);
  });

  for (const f of readdirSync(FIXTURES).filter(isWireFixture)) {
    it(`parses ${f}`, () => {
      const prefix = f.split(".")[0]!;
      const schema = SCHEMA_BY_PREFIX[prefix]!;
      const raw = JSON.parse(readFileSync(join(FIXTURES, f), "utf8"));
      const parsed = schema.safeParse(raw);
      expect(parsed.success, JSON.stringify(parsed.success ? "" : parsed.error.issues)).toBe(true);
    });
  }
});

describe("GT-2d — the hello ack wears a provenance label", () => {
  it("carries the build when the floor names it and stays silent when it does not", () => {
    const named = HelloAck.parse({
      contractsVersion: "0.1.0",
      serverKind: "field-native",
      grantedScopes: [],
      nativeBuild: "field-native/0.1.0+dev-4f3a91c07b2e5d68a1c40b93",
    });
    expect(named.nativeBuild).toBe("field-native/0.1.0+dev-4f3a91c07b2e5d68a1c40b93");

    // Additive: a daemon predating GT-2d acks exactly as it always did, and its
    // silence is the tell — never a parse failure.
    const silent = HelloAck.parse({
      contractsVersion: "0.1.0",
      serverKind: "field-native",
      grantedScopes: [],
    });
    expect(silent.nativeBuild).toBeUndefined();
  });

  it("refuses a non-string label rather than coercing one", () => {
    const parsed = HelloAck.safeParse({
      contractsVersion: "0.1.0",
      serverKind: "field-native",
      grantedScopes: [],
      nativeBuild: 20260728,
    });
    expect(parsed.success).toBe(false);
  });
});

describe("P3 — tolerant reader", () => {
  it("passthrough preserves unknown fields end-to-end", () => {
    const raw = JSON.parse(readFileSync(join(FIXTURES, "hello.unknown-field.json"), "utf8"));
    const parsed = Hello.parse(raw);
    // unknown fields survive the parse (removal would be silent data loss at proxies)
    expect((parsed as Record<string, unknown>)["futureField"]).toEqual(raw.futureField);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(raw);
  });
});
