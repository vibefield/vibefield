// Cross-language golden-fixture parity (design-01 §9.1):
// every fixture the TS side pins must deserialize here; shapes field-native
// echoes must re-serialize byte-equivalently (Value equality). Fixtures carrying
// deliberate unknown fields are parse-tolerance checks only — serde's default
// ignore-unknown IS the tolerant reader; field-native never echoes those shapes.
use field_native::contracts::{
    DesiredState, DiagnosticLogDeltaV1, DiagnosticLogSnapshotV1, ErrorData, Hello, HelloAck,
    LogRecordV1, LoggingHealthV1, MeshLaneCloseRequest, MeshLaneClosed, MeshLaneOpenRequest,
    MeshLanePeerOpened, NativeHealth, ObservedState, PeerInfo, RpcRequest, RpcResponse,
    ServeConfig, ServeEntry, StoreSnapshot, TerminalRouteSnapshot,
};
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
fn rpc_fixtures() {
    roundtrip::<RpcRequest>("rpc-request.valid.json", true);
    roundtrip::<RpcResponse>("rpc-response.error.json", true);
}

#[test]
fn error_fixtures() {
    roundtrip::<ErrorData>("error-data.unavailable.json", true);
    roundtrip::<ErrorData>("error-data.forbidden.json", true);
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

#[test]
fn mgmt_mesh_fixtures() {
    roundtrip::<PeerInfo>("peer-info.valid.json", true);
    roundtrip::<StoreSnapshot>("store-snapshot.valid.json", true);
    roundtrip::<ServeConfig>("serve-config.valid.json", true);
    roundtrip::<ServeEntry>("serve-entry.valid.json", true);
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
        ClaimGeometry, GeometryCommitted, GeometryHolder, GeometryRefused,
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
