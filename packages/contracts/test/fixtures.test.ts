import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";
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
import { Hello, HelloAck, RpcRequest, RpcResponse } from "../src/envelope";
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

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

// filename prefix (before the first ".") → schema
const SCHEMA_BY_PREFIX: Record<string, ZodTypeAny> = {
  hello: Hello,
  "hello-ack": HelloAck,
  "rpc-request": RpcRequest,
  "rpc-response": RpcResponse,
  "error-data": ErrorData,
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

describe("P3 — tolerant reader", () => {
  it("passthrough preserves unknown fields end-to-end", () => {
    const raw = JSON.parse(readFileSync(join(FIXTURES, "hello.unknown-field.json"), "utf8"));
    const parsed = Hello.parse(raw);
    // unknown fields survive the parse (removal would be silent data loss at proxies)
    expect((parsed as Record<string, unknown>)["futureField"]).toEqual(raw.futureField);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(raw);
  });
});
