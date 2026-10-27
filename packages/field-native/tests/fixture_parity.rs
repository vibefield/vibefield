// Cross-language golden-fixture parity (design-01 §9.1):
// every fixture the TS side pins must deserialize here; shapes field-native
// echoes must re-serialize byte-equivalently (Value equality). Fixtures carrying
// deliberate unknown fields are parse-tolerance checks only — serde's default
// ignore-unknown IS the tolerant reader; field-native never echoes those shapes.
use field_native::contracts::{
    DesiredState, DiagnosticLogDeltaV1, DiagnosticLogSnapshotV1, ErrorData, FreewayDeclareParams,
    FreewayDeclareResult, FreewayJoinsAckParams, FreewayJoinsAckResult, FreewayJoinsFrame,
    FreewayRevokeParams, FreewayRevokeResult, FreewayState, Hello, HelloAck, LogRecordV1,
    LoggingHealthV1, MeshEgressProxy, MeshEgressRouteAddParams, MeshEgressRouteBound,
    MeshEgressRouteRef, MeshEgressRouteTable, MeshLaneCloseRequest, MeshLaneClosed,
    MeshLaneOpenRequest, MeshLanePeerOpened, MeshNotUpDetails, MeshSelfIdentity,
    NativeDetachParams, NativeDetachResult, NativeHealth, NativePrepareRestartParams,
    NativePrepareRestartResult, NativeShutdownParams, NativeShutdownResult, NativeTickParams,
    ObservedState, PeerInfo, PingAck, RpcNotification, RpcRequest, RpcResponse, ServeConfig,
    ServeEntry, StoreSnapshot, TerminalRouteSnapshot, TerminalRoutesStreamPayload,
};
use field_native::registries::{native_refusals, terminal_inventory};
use serde_json::Value;
use std::{fs, path::PathBuf};

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../contracts/fixtures")
}

fn load(name: &str) -> Value {
    let p = fixtures_dir().join(name);
    let raw = fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {}: {e}", p.display()));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("json {}: {e}", p.display()))
}

/// A tagged-message fixture with its leg `type` tag stripped — the body a cell
/// actually serializes (the tag is added by the message framing, not by the
/// wire struct). Lets an EMIT-only wire type be checked for Value-equality.
fn without_type(name: &str) -> Value {
    let mut v = load(name);
    v.as_object_mut()
        .expect("tagged fixture is an object")
        .remove("type");
    v
}

fn roundtrip<T>(name: &str, strict: bool)
where
    T: serde::de::DeserializeOwned + serde::Serialize,
{
    let v = load(name);
    let parsed: T = serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("{name}: {e}"));
    if strict {
        let back = serde_json::to_value(&parsed).unwrap();
        assert_eq!(back, v, "{name}: round-trip drifted");
    }
}

#[test]
fn hello_fixtures() {
    roundtrip::<Hello>("hello.valid.json", true);
    roundtrip::<Hello>("hello.pairing.json", true);
    roundtrip::<Hello>("hello.unknown-field.json", false); // tolerant reader (P3)
}

#[test]
fn hello_ack_fixture() {
    roundtrip::<HelloAck>("hello-ack.valid.json", true);
    // NF-D8 — the mgmt ack carrying terminal endpoints; field-native EMITS this
    // shape, so it is strict.
    roundtrip::<HelloAck>("hello-ack.terminal.json", true);
    // TC-D15 (TC-S2) — the ack carrying the revisioned route snapshot beside
    // the legacy single-cell mirror, in lockstep. Emitted here, so strict.
    roundtrip::<HelloAck>("hello-ack.terminal-routes.json", true);
    // TM-1 (MF-1l) — the same ack from a floor whose terminal doors ARE
    // published on the tailnet: `terminalMesh: true` beside a cell row carrying
    // its grant key and its two T1 doors, which is the only shape the boolean
    // can be true over (cells always; the flag means the tailnet door).
    // Emitted here, so strict.
    roundtrip::<HelloAck>("hello-ack.terminal-mesh.json", true);
    // WP12 L2b (§9 R3) — the ack saying how the previous floor ended (`lastExit`), taken from the restart intent
    // at boot. Emitted here, so strict.
    roundtrip::<HelloAck>("hello-ack.last-exit.json", true);
    // AL-8a — how the previous management client left this floor
    roundtrip::<HelloAck>("hello-ack.last-manager.json", true);
    // DS-D15's client half (2026-10-01) — the PRODUCT door's ack naming the
    // device its daemon is (`deviceId`). fieldd emits it, field-native never
    // does; strict anyway, because the generated type is shared and a field it
    // did not carry would drop out of the round trip.
    roundtrip::<HelloAck>("hello-ack.product-device.json", true);
}

#[test]
fn terminal_routes_fixture() {
    // TC-D15 — the subscribe surface's delta payload IS the full snapshot; a
    // cell replacement is a new row under a bumped revision, never an edge.
    roundtrip::<TerminalRouteSnapshot>("terminal-routes.replaced.json", true);
    // TP-S3a — rows carrying the cell's T1 doors (and the grant key beside the
    // token). field-native EMITS this row, so it is strict; the door URLs are
    // pattern-validated newtypes on this side (the contract's loopback rule).
    roundtrip::<TerminalRouteSnapshot>("terminal-routes.doors.json", true);
}

#[test]
fn terminal_routes_stream_fixture() {
    // E-F1 — the routes STREAM payload: the snapshot the subscribe surface has
    // always carried, plus the floor's live `terminalMesh` push. field-native
    // EMITS this shape (`mgmt/mod.rs`'s routes forwarder), so both are strict.
    //
    // BOTH SIDES OF THE TOLERANCE, because only one of them is testable from
    // the shape alone: with the boolean PRESENT the payload is a reading and
    // supersedes the hello's; with it ABSENT — the shape every floor predating
    // E-F1 sends — the payload says nothing about the mesh and a reader keeps
    // what the hello gave it. The strict round-trip is what pins that absence
    // stays absence: `Option<bool>` is `skip_serializing_if`, so a None can
    // never re-serialize as `false` and turn "no reading" into "no".
    roundtrip::<TerminalRoutesStreamPayload>("terminal-routes-stream.published.json", true);
    roundtrip::<TerminalRoutesStreamPayload>("terminal-routes-stream.silent.json", true);
}

#[test]
fn rpc_fixtures() {
    roundtrip::<RpcRequest>("rpc-request.valid.json", true);
    roundtrip::<RpcResponse>("rpc-response.error.json", true);
}

#[test]
fn error_fixtures() {
    roundtrip::<ErrorData>("error-data.unavailable.json", true);
    roundtrip::<ErrorData>("error-data.forbidden.json", true);
    // WG-D4 — fieldd writes these two: a door on the floor's mgmt path while
    // fieldd holds the floor unresponsive, and a cell that did not answer.
    // ErrorData is the envelope both planes share, so its twin reads both.
    roundtrip::<ErrorData>("error-data.native-unresponsive.json", true);
    roundtrip::<ErrorData>("error-data.terminal-unresponsive.json", true);
    // IL-D2 (a) — fieldd writes this one too: a door that acts on the
    // inventory while the cells it would act in are stale.
    roundtrip::<ErrorData>("error-data.terminal-inventory-stale.json", true);
}

/// WG-D6 (`draft/thinking-floor-wedge.md` §7) — the wedge ladder's floor half.
/// field-native EMITS the pong, the tick, the ack's pid and the TIMEOUT for a
/// request past its deadline, and READS a request's `deadlineAt`, so every row
/// is strict: what the floor writes is what fieldd's late-reply record, its
/// tick clock and its health read.
#[test]
fn wedge_ladder_fixtures() {
    // the pong's `ts` is the floor's clock a late reply is kept with (WG-E2)
    roundtrip::<PingAck>("ping-ack.valid.json", true);

    // the tick: the whole notification frame, then its params as the floor
    // builds them
    roundtrip::<RpcNotification>("native-tick.valid.json", true);
    let tick = load("native-tick.valid.json");
    assert_eq!(tick["method"], "native.lifecycle.tick");
    let params: NativeTickParams =
        serde_json::from_value(tick["params"].clone()).expect("native-tick params");
    assert_eq!(serde_json::to_value(&params).unwrap(), tick["params"]);

    // the floor's pid in its hello ack; 0 names no process and is refused
    roundtrip::<HelloAck>("hello-ack.pid.json", true);
    let mut zero = load("hello-ack.pid.json");
    zero["pid"] = serde_json::json!(0);
    assert!(serde_json::from_value::<HelloAck>(zero).is_err());

    // a request's deadline survives the trip; the deadline-free fixture above
    // (`rpc_fixtures`) is the shape a ping and a hello keep
    roundtrip::<RpcRequest>("rpc-request.deadline.json", true);

    // the floor's TIMEOUT for a request past its deadline: its details are JSON
    // the floor writes, in the generated registry's words
    roundtrip::<ErrorData>("error-data.native-deadline-passed.json", true);
    let refusal = load("error-data.native-deadline-passed.json");
    assert_eq!(refusal["kind"], "TIMEOUT");
    assert_eq!(refusal["details"]["service"], native_refusals::SERVICE);
    assert_eq!(
        refusal["details"]["reason"],
        native_refusals::REASON_DEADLINE_PASSED
    );
}

#[test]
fn mgmt_lifecycle_fixtures() {
    // field-native ECHOES these shapes (health + observed are its own outputs) — strict.
    roundtrip::<NativeHealth>("native-health.valid.json", true);
    roundtrip::<DesiredState>("desired-state.valid.json", true);
    // NF-D2(b) — the adopt-before-authority proof field on a pruning set.
    roundtrip::<DesiredState>("desired-state.observed-boot.json", true);
    roundtrip::<ObservedState>("observed-state.valid.json", true);
    roundtrip::<ObservedState>("observed-state.unknown-field.json", false); // tolerant reader (P3)
}

/// IL-D4 (`draft/thinking-inventory-latency.md` §4.1) — the inventory's age on
/// the observed stream. field-native EMITS both rows, so both are strict. The
/// fresh row pins that an empty list stays absent: the generated `Vec` is
/// skipped when empty, so the bound's presence is what says "this floor
/// judges", and `observed-state.valid.json` above stands for an older floor
/// that carries neither field.
#[test]
fn inventory_bound_fixtures() {
    roundtrip::<ObservedState>("observed-state.fresh.json", true);
    let fresh: ObservedState =
        serde_json::from_value(load("observed-state.fresh.json")).expect("fresh");
    assert_eq!(fresh.inventory_bound_ms, Some(terminal_inventory::STALE_MS));
    assert!(fresh.stale_cells.is_empty());

    roundtrip::<ObservedState>("observed-state.stale-cell.json", true);
    let stale: ObservedState =
        serde_json::from_value(load("observed-state.stale-cell.json")).expect("stale");
    assert_eq!(stale.inventory_bound_ms, Some(terminal_inventory::STALE_MS));
    assert_eq!(stale.stale_cells.len(), 1);
    let cell = &stale.stale_cells[0];
    assert_eq!(cell.cell_instance_id, 2);
    assert_eq!(cell.cell_boot_id.as_str(), "01JCELLBOOT0000000000000002");
    assert_eq!(cell.since, 1_792_433_071_000);

    // an entry names a cell and a whole unix-ms instant, or it is refused
    let mut unnamed = load("observed-state.stale-cell.json");
    unnamed["staleCells"][0]["cellBootId"] = serde_json::json!("");
    assert!(serde_json::from_value::<ObservedState>(unnamed).is_err());
    let mut negative = load("observed-state.stale-cell.json");
    negative["staleCells"][0]["since"] = serde_json::json!(-1);
    assert!(serde_json::from_value::<ObservedState>(negative).is_err());
}

#[test]
fn mgmt_freeway_fixtures() {
    // FW-D4 (thinking-freeway.md v0.3 §4.3, §5.2) — the freeway's floor seam. The floor EMITS the
    // state stream, the joins and the revoke's answer, so those are strict; the declaration and the
    // revoke's params are inbound, where strict costs nothing and pins every field. Two fixtures
    // each where the shape has two lives: a phone-only declaration and a pair's, the state up and
    // down (the host gone: no port, no secrets), one client revoked and all, a quiet joins frame
    // and one that counts what the backlog dropped.
    roundtrip::<FreewayDeclareParams>("freeway-declare-params.phone.json", true);
    roundtrip::<FreewayDeclareParams>("freeway-declare-params.pair.json", true);
    roundtrip::<FreewayDeclareResult>("freeway-declare-result.valid.json", true);
    roundtrip::<FreewayState>("freeway-state.up.json", true);
    roundtrip::<FreewayState>("freeway-state.down.json", true);
    roundtrip::<FreewayRevokeParams>("freeway-revoke-params.one.json", true);
    roundtrip::<FreewayRevokeParams>("freeway-revoke-params.all.json", true);
    roundtrip::<FreewayRevokeResult>("freeway-revoke-result.valid.json", true);
    roundtrip::<FreewayJoinsFrame>("freeway-joins-frame.valid.json", true);
    roundtrip::<FreewayJoinsFrame>("freeway-joins-frame.overflow.json", true);
    roundtrip::<FreewayJoinsAckParams>("freeway-joins-ack-params.valid.json", true);
    roundtrip::<FreewayJoinsAckResult>("freeway-joins-ack-result.valid.json", true);

    // The roles are the two hellos a link can open with; the Rust twin refuses what zod refuses.
    let mut window = load("freeway-declare-params.phone.json");
    window["admit"][0]["role"] = Value::String("window".into());
    assert!(
        serde_json::from_value::<FreewayDeclareParams>(window).is_err(),
        "an admitted node is a desktop or a phone, nothing else"
    );
    // The declaration names this desktop: the welcome's `deviceId` comes from nowhere else.
    let mut nameless = load("freeway-declare-params.phone.json");
    nameless.as_object_mut().unwrap().remove("deviceId");
    assert!(
        serde_json::from_value::<FreewayDeclareParams>(nameless).is_err(),
        "a declaration without this desktop's device id"
    );
}

#[test]
fn mgmt_mesh_fixtures() {
    roundtrip::<PeerInfo>("peer-info.valid.json", true);
    roundtrip::<StoreSnapshot>("store-snapshot.valid.json", true);
    roundtrip::<ServeConfig>("serve-config.valid.json", true);
    roundtrip::<ServeConfig>("serve-config.freeway.json", true);
    // TM-2 (F-H3, 2026-09-14) — THE SHAPE FIELDD REALLY SENDS for the terminal
    // cell listener: `target.kind: "routes"` plus one route per live cell. The
    // contract described two target arms while this one had been on the wire
    // and implemented by this crate's own mgmt handler since TM-2, so the twin
    // above could not deserialize it and this golden did not exist. The
    // fixture is generated from `terminal-routes.doors.json` by fieldd's own
    // `terminalServeSpec`, and its fieldd-side test asserts exactly that — so
    // the golden and the wire cannot drift apart again.
    roundtrip::<ServeConfig>("serve-config.routes.json", true);
    roundtrip::<ServeEntry>("serve-entry.valid.json", true);
    // UA-P-4 (RFC 025 §3.6) — `native.mesh.self`, which this crate EMITS, so
    // both rows are strict: the shape fieldd's `MeshSelfIdentity.parse` reads
    // must be the shape the floor writes, `loginAllow` included. The CAPTURING
    // row is the one that matters most — a floor with no login yet still states
    // its (empty) gate, so a reader never has to infer "ungated" from silence.
    roundtrip::<MeshSelfIdentity>("mesh-self-identity.valid.json", true);
    roundtrip::<MeshSelfIdentity>("mesh-self-identity.capturing.json", true);
    // TS-1 (track TS) — the sign-in facts the floor now writes beside the node
    // (its posture, its name in Tailscale, its key's expiry, the console, a
    // sign-out) and its answer while there is no node, typed on both sides.
    roundtrip::<MeshSelfIdentity>("mesh-self-identity.expiring.json", true);
    roundtrip::<MeshSelfIdentity>("mesh-self-identity.signed-out.json", true);
    roundtrip::<MeshNotUpDetails>("mesh-not-up-details.signing-in.json", true);
    roundtrip::<MeshNotUpDetails>("mesh-not-up-details.approval.json", true);
    roundtrip::<MeshNotUpDetails>("mesh-not-up-details.sidecar-missing.json", true);
    // T11 and TS-D15/D16 (track TS) — a node Tailnet Lock holds, with the
    // client it embeds and the log upload it was built with; and a node a
    // tailnet that requires client logs keeps down.
    roundtrip::<MeshSelfIdentity>("mesh-self-identity.locked.json", true);
    roundtrip::<MeshNotUpDetails>("mesh-not-up-details.logs-required.json", true);
}

#[test]
fn mesh_lane_fixtures() {
    // C6-1 pinned these on the TS side; without this they were parsed by zod
    // alone. typify GENERATING a type is not the same as anything PARSING with
    // it — until now `MeshLane*` appeared nowhere outside contracts.rs, so the
    // Rust half of EL9 was nominal for this seam.
    //
    // Requests are inbound-only (fieldd → field-native), so tolerant parse is
    // the whole obligation. The two notifications field-native EMITS are
    // strict: it must produce exactly the shape the fixture pins.
    roundtrip::<MeshLaneOpenRequest>("mesh-lane-open-request.valid.json", true);
    roundtrip::<MeshLaneCloseRequest>("mesh-lane-close-request.valid.json", true);
    roundtrip::<MeshLanePeerOpened>("mesh-lane-peer-opened.valid.json", true);
    roundtrip::<MeshLaneClosed>("mesh-lane-closed.valid.json", true);
}

#[test]
fn mesh_egress_fixtures() {
    // DS-1 — the egress facade. field-native EMITS the proxy answer, the bound
    // route, the removal echo and the table (list AND the subscription's
    // snapshot, whose empty form is the facade's reset), so all four are
    // strict. The add params are inbound only; strict costs nothing there
    // and pins that `login` survives the trip.
    roundtrip::<MeshEgressProxy>("mesh-egress-proxy.valid.json", true);
    roundtrip::<MeshEgressRouteAddParams>("mesh-egress-route-add-params.valid.json", true);
    roundtrip::<MeshEgressRouteBound>("mesh-egress-route-bound.valid.json", true);
    roundtrip::<MeshEgressRouteRef>("mesh-egress-route-ref.valid.json", true);
    roundtrip::<MeshEgressRouteTable>("mesh-egress-route-table.valid.json", true);
    roundtrip::<MeshEgressRouteTable>("mesh-egress-route-table.reset.json", true);
    // The two degraded answers ride ErrorData, whose details are opaque here:
    // the floor writes them as JSON (`mgmt/mesh_egress.rs`), and its own unit
    // test holds that JSON to these same files.
    roundtrip::<ErrorData>("error-data.egress-unsupported.json", true);
    roundtrip::<ErrorData>("error-data.egress-mesh-down.json", true);

    // The patterns are the contract's, carried by typify into regress: the
    // Rust twin must refuse what zod refuses, or the belt is only on one side.
    let mut named = load("mesh-egress-proxy.valid.json");
    named["address"] = Value::String("localhost:41641".into());
    assert!(
        serde_json::from_value::<MeshEgressProxy>(named).is_err(),
        "a proxy address must be a literal loopback, never a name"
    );
    let mut aimed = load("mesh-egress-route-add-params.valid.json");
    aimed["target"] = Value::String("ws://studio.tail1234.ts.net:9422".into());
    assert!(
        serde_json::from_value::<MeshEgressRouteAddParams>(aimed).is_err(),
        "a route target is host:port, never a URL"
    );
    let mut port = load("mesh-egress-route-add-params.valid.json");
    port["target"] = Value::String("studio.tail1234.ts.net:65536".into());
    assert!(serde_json::from_value::<MeshEgressRouteAddParams>(port).is_err());
    let mut id = load("mesh-egress-route-ref.valid.json");
    id["id"] = Value::String("a/b".into());
    assert!(serde_json::from_value::<MeshEgressRouteRef>(id).is_err());
}

#[test]
fn logging_diagnostics_fixtures() {
    roundtrip::<LogRecordV1>("log-record.system.json", true);
    roundtrip::<LogRecordV1>("log-record.plugin.json", true);
    roundtrip::<LoggingHealthV1>("logging-health.valid.json", true);
    roundtrip::<DiagnosticLogSnapshotV1>("diagnostic-snapshot.valid.json", true);
    roundtrip::<DiagnosticLogDeltaV1>("diagnostic-delta.valid.json", true);

    let mut invalid_level = load("log-record.system.json");
    invalid_level["level"] = serde_json::json!(15);
    assert!(serde_json::from_value::<LogRecordV1>(invalid_level).is_err());
}

#[test]
fn geometry_fixtures() {
    // TP-S3c — the geometry seat. Directionality is baked into the wire derives:
    // the cell RECEIVES a claim (Deserialize) and EMITS the commit/refusal
    // (Serialize). So the inbound shape is proven by parsing the fixture; the two
    // outbound shapes are proven by re-serializing to the fixture body (minus the
    // leg's `type` tag) — the same Value-equality EL9 uses for every echoed shape.
    use field_native::tp::wire::{
        ClaimGeometry, GeometryCommitted, GeometryHolder, GeometryHolderFace, GeometryRefused,
        GeometryState, GeometryStateHolder,
    };

    let claim: ClaimGeometry =
        serde_json::from_value(load("tp-tagged-message.claim-geometry.json")).unwrap();
    assert_eq!(claim.session_id, "s1");
    assert_eq!(claim.activation_id, "act-1");
    assert_eq!(claim.claimant.client_id, "client-02");
    assert_eq!((claim.cols, claim.rows), (100, 28));
    assert_eq!(claim.expect_revision, 5);

    let committed = GeometryCommitted {
        holder: GeometryHolder {
            client_id: "client-01".into(),
            view_id: "view-01".into(),
            holder_generation: 2,
        },
        geometry_revision: 5,
        cols: 120,
        rows: 32,
    };
    assert_eq!(
        serde_json::to_value(&committed).unwrap(),
        without_type("tp-tagged-message.geometry-committed.json"),
    );

    let refused = GeometryRefused {
        code: "SEAT_HELD".into(),
        current_holder: Some(GeometryHolder {
            client_id: "client-01".into(),
            view_id: "view-01".into(),
            holder_generation: 2,
        }),
        geometry_revision: Some(5),
    };
    assert_eq!(
        serde_json::to_value(&refused).unwrap(),
        without_type("tp-tagged-message.geometry-refused.json"),
    );

    // item 42 — the seat's announcement, EMITTED by the cell to every
    // `geometry-events` control leg of the session: a phone holding the seat
    // (the face its attach grant carried), the empty seat it leaves (`holder:
    // null`, never omitted, at the size the PTY was left at), and the tagged
    // body (a face without an OS — the key omitted, never null).
    let phone = GeometryStateHolder {
        client_id: "tailnet:owner@github#node-phone~e1".into(),
        view_id: "view-p1".into(),
        holder_generation: 7,
        face: Some(GeometryHolderFace {
            kind: "phone".into(),
            name: "iPhone 16 Pro".into(),
            os: Some("ios".into()),
        }),
    };
    let held = GeometryState {
        session_id: "sess-01J8Z3K9".into(),
        holder: Some(phone),
        geometry_revision: 9,
        cols: 46,
        rows: 30,
    };
    assert_eq!(
        serde_json::to_value(&held).unwrap(),
        load("tp-geometry-state.held.json"),
    );
    let empty = GeometryState {
        holder: None,
        geometry_revision: 10,
        ..held
    };
    assert_eq!(
        serde_json::to_value(&empty).unwrap(),
        load("tp-geometry-state.empty.json"),
    );
    let announced = GeometryState {
        session_id: "s1".into(),
        holder: Some(GeometryStateHolder {
            client_id: "client-02".into(),
            view_id: "view-02".into(),
            holder_generation: 3,
            face: Some(GeometryHolderFace {
                kind: "peer-window".into(),
                name: "Studio".into(),
                os: None,
            }),
        }),
        geometry_revision: 6,
        cols: 100,
        rows: 28,
    };
    assert_eq!(
        serde_json::to_value(&announced).unwrap(),
        without_type("tp-tagged-message.geometry-state.json"),
    );
}

#[test]
fn semver_pattern_is_enforced() {
    let mut bad = load("hello.valid.json");
    bad["contractsVersion"] = Value::String("not-a-version".into());
    assert!(
        serde_json::from_value::<Hello>(bad).is_err(),
        "pattern-invalid contractsVersion must be rejected"
    );
}

/// WP12 L2b (`build-wp12-updater.md` §9 R2/R3) — the restart intent and the floor's self-stop. field-native READS the
/// params and EMITS the results, so every one is strict; a reason outside the vocabulary is refused, never coerced.
#[test]
fn restart_verb_fixtures() {
    roundtrip::<NativePrepareRestartParams>("native-prepare-restart-params.valid.json", true);
    roundtrip::<NativePrepareRestartResult>("native-prepare-restart-result.valid.json", true);
    roundtrip::<NativeShutdownParams>("native-shutdown-params.valid.json", true);
    // AL-2 — a person's quit is a reason the floor's intent records (and its next boot reads planned)
    roundtrip::<NativePrepareRestartParams>("native-prepare-restart-params.quit.json", true);
    roundtrip::<NativeShutdownParams>("native-shutdown-params.quit.json", true);
    // AL-5 — the orphan bound's own reason
    roundtrip::<NativeShutdownParams>("native-shutdown-params.idle.json", true);
    roundtrip::<NativeShutdownResult>("native-shutdown-result.valid.json", true);
    // AL-8a — fieldd's goodbye before a planned stop
    roundtrip::<NativeDetachParams>("native-detach-params.valid.json", true);
    roundtrip::<NativeDetachResult>("native-detach-result.valid.json", true);
    let mut whim = load("native-shutdown-params.valid.json");
    whim["reason"] = serde_json::json!("whim");
    assert!(serde_json::from_value::<NativeShutdownParams>(whim).is_err());
}
