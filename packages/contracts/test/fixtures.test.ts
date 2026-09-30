import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type ZodTypeAny, z } from "zod";
import { AgentCatalogResult } from "../src/agent-catalog";
import {
  AgentsExtensionsActResult,
  AgentsExtensionsAddResult,
  AgentsExtensionsAddSkillResult,
  AgentsExtensionsCatalogResult,
  AgentsExtensionsCheckResult,
  AgentsExtensionsListResult,
  AgentsExtensionsPlanResult,
  AgentsExtensionsPlanSkillResult,
  AgentsExtensionsPlanSourceResult,
  AgentsExtensionsSignInResult,
  AgentsExtensionsTerminalResult,
} from "../src/agent-extensions";
import {
  AgentDeskRow,
  AgentFieldDelta,
  AgentFieldSlice,
  AgentFieldSnapshot,
  AgentInterruptResult,
  AgentMeshFrame,
  AgentMeshOpen,
} from "../src/agent-field";
import {
  AgentDistributionRecord,
  AgentPersona,
  AgentsInstallsResult,
  AgentsProfileSetsListResult,
  AgentsProfilesVerifyResult,
  AgentsReleasesResult,
  AgentsUpdateResult,
  IndexDiscovery,
  IndexEnrollmentRecord,
  IndexRecentParams,
  IndexRecentResult,
  IndexSearchResponse,
  IndexSearchResult,
  IndexSessionsResult,
  IndexStatus,
} from "../src/agent-index";
import {
  AgentListResult,
  AgentMonitorMirror,
  AgentProvidersResult,
  AgentResumeParams,
  AgentSessionRecord,
  AgentSessionSummary,
  AgentSpawnResult,
  AgentsProfilesLoginResult,
} from "../src/agent-session";
import { AgentAccountUsageBatch } from "../src/agent-usage";
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
  MeshEgressProxy,
  MeshEgressRouteAddParams,
  MeshEgressRouteBound,
  MeshEgressRouteRef,
  MeshEgressRouteTable,
  MeshLaneClosed,
  MeshLaneCloseRequest,
  MeshLaneOpenRequest,
  MeshLanePeerOpened,
  MeshSelfIdentity,
  NativeHealth,
  ObservedState,
  PeerInfo,
  ServeConfig,
  ServeEntry,
  ServeRoute,
  StoreSnapshot,
  TerminalRoutesStreamPayload,
} from "../src/mgmt";
import { PluginRegistrySnapshot } from "../src/plugin-registry";
import { PluginManifestV1 } from "../src/plugins";
import {
  ScreenshotCaptureResult,
  ScreenshotHelperCommand,
  ScreenshotHelperEvent,
} from "../src/screenshot";
import { TerminalBindingsFile, TerminalCreateParams } from "../src/terminal";
import {
  AttachControlLeg,
  AttachFramesLeg,
  AttachRefused,
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
  ProtocolLimits,
  SceneApplied,
  SendInput,
  SessionAttachGrant,
  SessionEvent,
  TaggedTpMessage,
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
  // DS-1 — the egress facade (mgmt.ts). The table has TWO fixtures on purpose:
  // a bound table (a MagicDNS target and a bracketed IPv6 one) and the EMPTY
  // snapshot a node teardown pushes, which is the facade's reset.
  "mesh-egress-proxy": MeshEgressProxy,
  "mesh-egress-route-add-params": MeshEgressRouteAddParams,
  "mesh-egress-route-bound": MeshEgressRouteBound,
  "mesh-egress-route-ref": MeshEgressRouteRef,
  "mesh-egress-route-table": MeshEgressRouteTable,
  "doc-registry-entry": DocRegistryEntry,
  "doc-open-result": DocOpenResult,
  "doc-rename-params": DocRenameParams,
  "doc-meta": DocMeta,
  "lane-hello": LaneHello,
  "lane-hello-ok": LaneHelloOk,
  "lane-put-meta": LanePutMeta,
  "lane-err": LaneErr,
  "device-slice": DeviceSlice,
  // UA-P-0e (D2) — TWO fixtures on purpose: the SELF row (everything, because
  // it is that process) and a SELF-PEER row (identity, liveness and a derived
  // door locator, with every slice-derived claim absent because the peer
  // publishes nothing).
  "device-info": DeviceInfo,
  // UA-P-4 (RFC 025 §3.6) — TWO fixtures on purpose: a LINKED node (a login and
  // the one-entry gate it was built with) and a CAPTURING one (no login yet, so
  // `loginAllow` is the empty list truffle reads as "no gate"). The pair pins
  // that the gate is always stated and never inferred from the login's presence.
  "mesh-self-identity": MeshSelfIdentity,
  "plugin-manifest": PluginManifestV1,
  "plugin-registry-snapshot": PluginRegistrySnapshot,
  "log-record": LogRecordV1,
  "logging-health": LoggingHealthV1,
  "diagnostic-snapshot": DiagnosticLogSnapshotV1,
  "diagnostic-delta": DiagnosticLogDeltaV1,
  "diagnostic-lease": DiagnosticLeaseV1,
  "audit-record": AuditRecordV1,
  "support-manifest": SupportBundleManifestV1,
  "terminal-routes": TerminalRouteSnapshot,
  // E-F1 — the routes STREAM payload: the same snapshot plus the floor's live
  // `terminalMesh` push. Two fixtures on purpose — the boolean present (a floor
  // that speaks it) and ABSENT (one that predates it, whose deltas must leave a
  // reader's hello value alone).
  "terminal-routes-stream": TerminalRoutesStreamPayload,
  "terminal-create-params": TerminalCreateParams,
  // SB-2 — fieldd's record of which shells were born under an Agent Profile
  // (`users/<fuid>/fieldd/terminal-bindings.json`); fieldd's store writes this
  // shape and its test parses what it wrote with the same schema.
  "terminal-bindings": TerminalBindingsFile,
  // SNAP-D2 — the screenshot helper's stdout line and the shell's answer; the
  // Swift harness and the Rust crate parse these same files.
  "screenshot-helper-event": ScreenshotHelperEvent,
  "screenshot-capture-result": ScreenshotCaptureResult,
  // The warm macOS service (bc15f28f): one pipe, both directions — the host's
  // `capture` command and the helper's idle/ready lines — so one prefix parses
  // as either side. Its own suite pins each side separately (screenshot.test.ts).
  "screenshot-service": z.union([ScreenshotHelperCommand, ScreenshotHelperEvent]),
  // AR-1 — the enrollment record is rosettad's `--enroll` input as well as
  // VibeField's truth; the valid fixture is the exact shape rosetta's own
  // integration bench writes (crates/rosettad/tests/enrolled_serve.rs) plus
  // the keys only VibeField reads.
  "index-enrollment": IndexEnrollmentRecord,
  "index-discovery": IndexDiscovery,
  "index-status": IndexStatus,
  // AR-5e — the find sheet's two sides of one seam: what rosetta answers on
  // `/api/search` (transcribed from the reference's committed protocol-20
  // golden, digest cited in the file) and what `index.search` answers over it.
  "index-search": IndexSearchResponse,
  "index-search-result": IndexSearchResult,
  "index-sessions": IndexSessionsResult,
  // QL — the empty pane launcher's list: a folder's sessions (a worktree's
  // under its repo's project, a persona's with its profile) beside one with no
  // workspace, which is never "here"; and the ask.
  "index-recent": IndexRecentResult,
  "index-recent-params": IndexRecentParams,
  "agent-persona": AgentPersona,
  "agent-distribution": AgentDistributionRecord,
  "agents-installs": AgentsInstallsResult,
  "agents-releases": AgentsReleasesResult,
  "agents-update": AgentsUpdateResult,
  "agents-profiles-verify": AgentsProfilesVerifyResult,
  // AR-3 — the managed-session doors. `agent-monitor-state` is puppeteer's
  // OWN monitor contract fixture (packages/core/src/monitor/types.test.ts at
  // the pinned revision), transcribed: the mirror must read it and carry the
  // rest through — a wire change upstream is a red gate here (AR-D4, §12).
  "agent-monitor-state": AgentMonitorMirror,
  "agent-session-summary": AgentSessionSummary,
  "agent-session-record": AgentSessionRecord,
  "agent-spawn": AgentSpawnResult,
  // QL-D10 — both arms of agent.resume's params: a run (the record's), and a
  // conversation by its native id with the persona whose root holds it.
  "agent-resume-params": AgentResumeParams,
  "agent-list": AgentListResult,
  "agent-providers": AgentProvidersResult,
  // AC-1 — the catalog as `agent.catalog` answers it (the whole table; the
  // phone's kit mirrors this file byte for byte).
  "agent-catalog": AgentCatalogResult,
  "agents-profiles-login": AgentsProfilesLoginResult,
  // AR-S2 — Agent Profiles: the native set beside a managed one, a sign-in
  // mid-login, the display folders, the Add menu's candidates.
  "agents-profile-sets": AgentsProfileSetsListResult,
  "agents-extensions": AgentsExtensionsListResult,
  // AR-S4c — an act's answer: the finished run and its receipt.
  "agents-extensions-act": AgentsExtensionsActResult,
  // AR-S4e — a plugin's update: the version the second read found moved.
  "agents-extensions-plugin-act": AgentsExtensionsActResult,
  // AR-S4c — a server's sign-in: the run while its pane is open, and the caller's ticket.
  "agents-extensions-sign-in": AgentsExtensionsSignInResult,
  // AR-S4d — Add server's answer (each agent's receipt), and the plan beside the form.
  "agents-extensions-add": AgentsExtensionsAddResult,
  "agents-extensions-plan": AgentsExtensionsPlanResult,
  // AR-S4d2 — Add skill's answer (the name it is kept under, each agent's receipt), and the plan beside the form.
  "agents-extensions-add-skill": AgentsExtensionsAddSkillResult,
  "agents-extensions-plan-skill": AgentsExtensionsPlanSkillResult,
  // AR-S4e2 — Claude's catalog in Work (review held with a newer version listed,
  // changelog to install in one click, deploy's install in a terminal, telemetry
  // flagged, the official marketplace suggested), a check's run, a typed source's
  // plan, and an install's pane
  "agents-extensions-catalog": AgentsExtensionsCatalogResult,
  "agents-extensions-check": AgentsExtensionsCheckResult,
  "agents-extensions-plan-source": AgentsExtensionsPlanSourceResult,
  "agents-extensions-terminal": AgentsExtensionsTerminalResult,
  // AR-5d — the usage column's feed: one batch with three states beside the
  // honest empty one the door answers before the first refresh.
  "agent-usage": AgentAccountUsageBatch,
  // MF-1 (§10.1) — the field projection's three frames and its two new doors.
  // The slice's five rows are the states a phone must draw without asking for
  // anything else: blocked on a named tool, working with bars, idle, a PENDING
  // row nothing observes (AR-4), and one whose PTY is gone. Content is
  // deliberately absent from every one of them — no reply line, no blocker
  // input, no title, no mirror.
  "agent-field-snapshot": AgentFieldSnapshot,
  "agent-field-delta": AgentFieldDelta,
  "agent-field-slice": AgentFieldSlice,
  // DS-3 — the desk row (the field row plus the reply line, the blocker's
  // question and the cost, each bounded), the mesh board's open (every self
  // desktop, an asleep one keeping its board, one never heard carrying none)
  // and its frames in order (a delta, a device going stale, its reset, live).
  "agent-desk-row": AgentDeskRow,
  "agent-mesh-open": AgentMeshOpen,
  "agent-mesh-frames": z.array(AgentMeshFrame),
  // Both arms of the interrupt's union: the refusal carries the FLOOR's own
  // word, never a sentence composed at the door.
  "agent-interrupt": AgentInterruptResult,
  // TPv3 (terminal-pipeline.ts; spec §20 item 1) — every wire shape has a pinned fixture.
  "tp-transport-grant": CellTransportGrant,
  "tp-attach-grant": SessionAttachGrant,
  "tp-open-ticket": TerminalOpenTicketResult,
  // TM-2 (thinking-terminal-mesh-cells.md §3 T) — the SAME ticket shape with
  // the TAILNET door set and a self peer's rights. Pinned beside the loopback
  // one so both arms of the endpoints union are golden, not just the arm the
  // desktop ships today.
  "tp-remote-open-ticket": TerminalOpenTicketResult,
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
  "tp-send-input": SendInput,
  "tp-session-event": SessionEvent,
  "tp-envelope-header": PresentationEnvelopeHeader,
  "tp-attach-refused": AttachRefused,
  "tp-protocol-limits": ProtocolLimits,
  "tp-tagged-message": TaggedTpMessage,
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

describe("TM-1 (MF-1l) — the hello says whether the terminal doors are on the tailnet", () => {
  const floor = {
    contractsVersion: "0.1.0",
    serverKind: "field-native" as const,
    grantedScopes: [],
  };

  it("carries the boolean both ways and keeps absence distinct from false", () => {
    expect(HelloAck.parse({ ...floor, terminalMesh: true }).terminalMesh).toBe(true);
    expect(HelloAck.parse({ ...floor, terminalMesh: false }).terminalMesh).toBe(false);
    // A floor predating the field says nothing — which a reader that needs the
    // distinction must be able to tell from a floor that says "no".
    expect(HelloAck.parse(floor).terminalMesh).toBeUndefined();
  });

  it("refuses a non-boolean rather than coercing one", () => {
    // The field gates a remote-attach path, so a truthy string must never read
    // as `true` on the way in.
    expect(HelloAck.safeParse({ ...floor, terminalMesh: "yes" }).success).toBe(false);
    expect(HelloAck.safeParse({ ...floor, terminalMesh: 1 }).success).toBe(false);
  });
});

describe("TM-2 (F-H3) — the mgmt wire's THIRD serve target, and the routes it carries", () => {
  // The contract described `port` and `dir` while fieldd had been sending
  // `routes` and field-native had been implementing it since TM-2. These rows
  // are the floor's own admission rules (`parse_cell_routes`,
  // field-native/src/mgmt/mesh.rs), restated where the wire is described, so a
  // spec the floor would refuse is refused before it is sent.
  const base = {
    serveId: "terminal",
    name: "terminal",
    listenPort: 9422,
    target: { kind: "routes" as const },
    tls: false,
    allow: ["james@github"],
  };

  it("admits the routes target and its prefix/port pairs", () => {
    const parsed = ServeConfig.safeParse({
      ...base,
      routes: [{ prefix: "/cell/01JCELLBOOT0000000000000004", targetPort: 49152 }],
    });
    expect(parsed.success, JSON.stringify(parsed.success ? "" : parsed.error.issues)).toBe(true);
  });

  it("refuses a relative prefix and a TRAILING SLASH, which never matches at all", () => {
    // measured against the shipped sidecar (TM-2b): `/cell/<boot>/` did not
    // take `/cell/<boot>/control`, and `stripPrefix` then has nothing to act on
    expect(ServeRoute.safeParse({ prefix: "cell/x", targetPort: 49152 }).success).toBe(false);
    expect(ServeRoute.safeParse({ prefix: "/cell/x/", targetPort: 49152 }).success).toBe(false);
    expect(ServeRoute.safeParse({ prefix: "", targetPort: 49152 }).success).toBe(false);
    // the root itself has no trailing slash to refuse, exactly as the floor reads it
    expect(ServeRoute.safeParse({ prefix: "/", targetPort: 49152 }).success).toBe(true);
    expect(ServeRoute.safeParse({ prefix: "/a//b", targetPort: 49152 }).success).toBe(true);
  });

  it("refuses a zero or out-of-range target port", () => {
    // the floor does `u16::try_from` and then refuses 0 — a route to port 0 is
    // a route to nothing
    expect(ServeRoute.safeParse({ prefix: "/a", targetPort: 0 }).success).toBe(false);
    expect(ServeRoute.safeParse({ prefix: "/a", targetPort: 65_536 }).success).toBe(false);
    expect(ServeRoute.safeParse({ prefix: "/a", targetPort: 1.5 }).success).toBe(false);
  });

  it("carries NOTHING else per route — no dir, no fallback, no per-route allow", () => {
    // the narrowness IS the EL7 argument: the worst a compromised fieldd can
    // publish here is another loopback port on a machine it already owns. The
    // tolerant-reader law keeps unknown keys rather than throwing, so what is
    // pinned is that they are not PART of the shape a reader may rely on.
    const parsed = ServeRoute.parse({
      prefix: "/a",
      targetPort: 49152,
      dir: "/etc",
      allow: ["*"],
    }) as Record<string, unknown>;
    expect(Object.keys(ServeRoute.shape)).toEqual(["prefix", "targetPort"]);
    expect(parsed["dir"], "kept, per P3 — but no reader is entitled to it").toBe("/etc");
  });

  it("leaves the other two targets exactly as they were", () => {
    expect(
      ServeConfig.safeParse({ name: "product", target: { kind: "port", port: 3000 } }).success,
    ).toBe(true);
    expect(ServeConfig.safeParse({ name: "a", target: { kind: "dir", path: "/x" } }).success).toBe(
      true,
    );
    expect(ServeConfig.safeParse({ name: "a", target: { kind: "nope" } }).success).toBe(false);
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
