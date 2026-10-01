//! DS-1 — the egress facade over the REAL management socket: pairing, the
//! mesh worker, the handler's refusal order, the table and its stream.
//!
//! What these rows witness, stated plainly because it bounds them: a tailnet
//! node cannot be built headlessly (the wall `force_node_presence_for_tests`
//! documents), so the node-carried arms here are `FakeEgress` — real loopback
//! listeners splicing to a door the test owns — under a FORCED node presence.
//! They prove the facade (verbs, shapes, refusals, reset, stream) and the
//! production default (`egress-unsupported` on every verb). tsnet's own
//! egress is the petition window's witness, on two desktops with the
//! Tailscale app quit.
use field_native::contracts::{
    MeshEgressProxy, MeshEgressRouteBound, MeshEgressRouteRef, MeshEgressRouteTable, MeshMode,
};
use field_native::local_ipc;
use field_native::services::mesh_egress::{FakeEgress, ProxyGrant};
use field_native::{bootstrap, config::NativeConfig, pairing, RunningDaemon};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::time::timeout;

const PEER_CELLS: &str = "studio.tail1234.ts.net:9422";

struct Mgmt {
    reader: tokio::io::Lines<BufReader<tokio::io::ReadHalf<local_ipc::ClientStream>>>,
    writer: tokio::io::WriteHalf<local_ipc::ClientStream>,
    next_id: u64,
    /// notifications read while waiting for a response, in arrival order
    notes: VecDeque<Value>,
}

impl Mgmt {
    async fn connect(daemon: &RunningDaemon) -> Self {
        let stream = local_ipc::connect(&daemon.mgmt_endpoint)
            .await
            .expect("connect mgmt");
        let (r, w) = tokio::io::split(stream);
        let mut me = Self {
            reader: BufReader::new(r).lines(),
            writer: w,
            next_id: 1,
            notes: VecDeque::new(),
        };
        let secret = hex::decode(
            std::fs::read_to_string(&daemon.pairing_file)
                .unwrap()
                .trim(),
        )
        .unwrap();
        let ts = pairing::now_epoch_secs();
        let boot = "ds1-egress-test";
        let mac = pairing::compute_mac(&secret, boot, ts);
        let ack = me
            .call(
                "native.lifecycle.hello",
                json!({
                    "contractsVersion":"0.1.0","minCompatible":"0.1.0","clientKind":"fieldd",
                    "credential":{"bootId":boot,"ts":ts,"mac":mac}
                }),
            )
            .await;
        assert!(ack.get("result").is_some(), "hello refused: {ack}");
        me
    }

    async fn next_line(&mut self) -> Value {
        let line = timeout(Duration::from_secs(5), self.reader.next_line())
            .await
            .expect("mgmt reply deadline")
            .expect("mgmt read error")
            .expect("mgmt connection closed");
        serde_json::from_str(&line).expect("json line")
    }

    /// Send a request and return ITS response; notifications that arrive
    /// first are kept for `note`.
    async fn call(&mut self, method: &str, params: Value) -> Value {
        let id = self.next_id;
        self.next_id += 1;
        let line = format!(
            "{}\n",
            json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})
        );
        self.writer.write_all(line.as_bytes()).await.unwrap();
        loop {
            let msg = self.next_line().await;
            if msg.get("id") == Some(&json!(id)) {
                return msg;
            }
            self.notes.push_back(msg);
        }
    }

    /// The next notification named `method`.
    async fn note(&mut self, method: &str) -> Value {
        if let Some(i) = self.notes.iter().position(|n| n["method"] == method) {
            return self.notes.remove(i).unwrap();
        }
        loop {
            let msg = self.next_line().await;
            if msg["method"] == method {
                return msg;
            }
            self.notes.push_back(msg);
        }
    }
}

async fn boot(
    config: impl FnOnce(NativeConfig) -> NativeConfig,
) -> (tempfile::TempDir, RunningDaemon) {
    let dir = tempfile::tempdir().unwrap();
    let daemon = bootstrap(config(NativeConfig::for_data_dir(dir.path().to_path_buf())))
        .await
        .expect("bootstrap");
    (dir, daemon)
}

fn golden(name: &str) -> Value {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../contracts/fixtures")
        .join(name);
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

/// A door the test owns: answers every connection's first read with
/// `door:<what it read>`.
async fn door() -> SocketAddr {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        while let Ok((mut sock, _)) = listener.accept().await {
            tokio::spawn(async move {
                let mut buf = [0u8; 64];
                let Ok(n) = sock.read(&mut buf).await else {
                    return;
                };
                let mut reply = b"door:".to_vec();
                reply.extend_from_slice(&buf[..n]);
                let _ = sock.write_all(&reply).await;
            });
        }
    });
    addr
}

/// One exchange through `listen`; `None` when nothing came back (refused,
/// reset, or closed before the door answered).
async fn exchange(listen: &str, payload: &[u8]) -> Option<Vec<u8>> {
    let mut sock = tokio::net::TcpStream::connect(listen).await.ok()?;
    sock.write_all(payload).await.ok()?;
    let mut out = Vec::new();
    let mut buf = [0u8; 64];
    let read = timeout(Duration::from_secs(5), async {
        while out.len() < payload.len() + 5 {
            match sock.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => out.extend_from_slice(&buf[..n]),
            }
        }
    })
    .await;
    (read.is_ok() && !out.is_empty()).then_some(out)
}

fn error_code(reply: &Value) -> &Value {
    &reply["error"]["data"]["details"]["code"]
}

/// A floor with a fake egress arm and a node present.
async fn fake_floor() -> (
    tempfile::TempDir,
    RunningDaemon,
    Arc<FakeEgress>,
    SocketAddr,
) {
    let (dir, daemon) = boot(|c| c).await;
    let fake = Arc::new(FakeEgress::new().with_proxies(
        ProxyGrant {
            address: "127.0.0.1:41641".into(),
            username: "tsnet".into(),
            credential: "socks-credential-for-the-test".into(),
        },
        ProxyGrant {
            address: "[::1]:41642".into(),
            username: "tsnet".into(),
            credential: "http-credential-for-the-test".into(),
        },
    ));
    let door = door().await;
    fake.admit(PEER_CELLS, door);
    daemon.state.mesh.install_egress_for_tests(fake.clone());
    daemon.state.mesh.force_node_presence_for_tests(true);
    (dir, daemon, fake, door)
}

/// THE PRODUCTION DEFAULT. truffle-core 0.7.14's sidecar has no egress, so
/// every verb answers the golden `egress-unsupported` — and says so with no
/// node up, which is the point of answering it before the node gate: a floor
/// that said `mesh-down` here would send fieldd waiting for a node that can
/// never carry egress. (Built without `truffle-egress`; the feature build's
/// default is the next row's.)
#[cfg(not(feature = "truffle-egress"))]
#[tokio::test]
async fn a_floor_without_rfc_026_answers_every_verb_egress_unsupported() {
    let (_dir, daemon) = boot(|c| c).await;
    assert!(
        !daemon.state.mesh.node_present(),
        "the default posture has no node"
    );
    let mut mgmt = Mgmt::connect(&daemon).await;
    let unsupported = golden("error-data.egress-unsupported.json");
    for (method, params) in [
        ("native.mesh.egress.proxy", json!({})),
        ("native.mesh.egress.httpProxy", json!({})),
        (
            "native.mesh.egress.route.add",
            json!({"id": "r1", "target": PEER_CELLS}),
        ),
        ("native.mesh.egress.route.remove", json!({"id": "r1"})),
        ("native.mesh.egress.route.list", json!({})),
        ("native.mesh.egress.route.subscribe", json!({})),
    ] {
        let reply = mgmt.call(method, params).await;
        assert_eq!(reply["error"]["code"], -32006, "{method}: {reply}");
        assert_eq!(reply["error"]["data"], unsupported, "{method}: {reply}");
    }
    // …and it is still unsupported with a node present: a capability, not a state.
    daemon.state.mesh.force_node_presence_for_tests(true);
    let reply = mgmt.call("native.mesh.egress.proxy", json!({})).await;
    assert_eq!(reply["error"]["data"], unsupported, "{reply}");
    drop(mgmt);
    daemon.shutdown().await;
}

/// DS-1b (2026-10-01) — the FEATURE build's default is the real arm. With no
/// node it is no longer `egress-unsupported` (the arm can carry egress once a
/// node exists): the acts answer `mesh-down`, the table reads answer empty,
/// and a forced presence with no node behind it still answers `mesh-down`,
/// because the arm asks the node itself and there is none. A protocol-5
/// sidecar under this arm answers `egress-unsupported` per call, from the core
/// (`truffle_refusal`); the real tailnet is `mesh_egress_probe.rs`'s.
#[cfg(feature = "truffle-egress")]
#[tokio::test]
async fn the_truffle_arm_without_a_node_answers_mesh_down_and_an_empty_table() {
    let (_dir, daemon) = boot(|c| c).await;
    assert_eq!(daemon.state.mesh.egress().arm(), "truffle");
    let mut mgmt = Mgmt::connect(&daemon).await;
    let down = golden("error-data.egress-mesh-down.json");
    for method in ["native.mesh.egress.proxy", "native.mesh.egress.httpProxy"] {
        let reply = mgmt.call(method, json!({})).await;
        assert_eq!(reply["error"]["code"], -32006, "{method}: {reply}");
        assert_eq!(
            reply["error"]["data"]["state"], down["state"],
            "{method}: {reply}"
        );
    }
    let listed = mgmt.call("native.mesh.egress.route.list", json!({})).await;
    assert_eq!(listed["result"]["routes"], json!([]), "{listed}");
    let removed = mgmt
        .call("native.mesh.egress.route.remove", json!({"id": "r1"}))
        .await;
    assert_eq!(removed["error"]["data"]["kind"], "NOT_FOUND", "{removed}");
    daemon.state.mesh.force_node_presence_for_tests(true);
    let reply = mgmt.call("native.mesh.egress.proxy", json!({})).await;
    assert_eq!(reply["error"]["data"]["state"], down["state"], "{reply}");
    drop(mgmt);
    daemon.shutdown().await;
}

#[tokio::test]
async fn the_proxies_answer_the_contracts_shape() {
    let (_dir, daemon, _fake, _door) = fake_floor().await;
    let mut mgmt = Mgmt::connect(&daemon).await;
    let socks = mgmt.call("native.mesh.egress.proxy", json!({})).await;
    let socks: MeshEgressProxy = serde_json::from_value(socks["result"].clone()).unwrap();
    assert_eq!(socks.address.as_str(), "127.0.0.1:41641");
    assert_eq!(socks.username.as_str(), "tsnet");
    assert_eq!(socks.credential.as_str(), "socks-credential-for-the-test");
    let http = mgmt.call("native.mesh.egress.httpProxy", json!({})).await;
    let http: MeshEgressProxy = serde_json::from_value(http["result"].clone()).unwrap();
    assert_eq!(http.address.as_str(), "[::1]:41642");
    drop(mgmt);
    daemon.shutdown().await;
}

/// E2 end to end on one floor: a route binds a real listener, a byte reaches
/// the door through it, the table and its stream say so, a re-add is the same
/// listener, a re-aim is a conflict, and removal closes it.
#[tokio::test]
async fn a_route_is_bound_listed_streamed_and_removed() {
    let (_dir, daemon, fake, door) = fake_floor().await;
    let mut mgmt = Mgmt::connect(&daemon).await;

    let sub = mgmt
        .call("native.mesh.egress.route.subscribe", json!({}))
        .await;
    let sub_id = sub["result"]["subId"].clone();
    let empty: MeshEgressRouteTable =
        serde_json::from_value(sub["result"]["snapshot"].clone()).unwrap();
    assert!(empty.routes.is_empty());

    let added = mgmt
        .call(
            "native.mesh.egress.route.add",
            json!({"id": "egress-dev-b-9422", "target": PEER_CELLS, "login": "me@example.com"}),
        )
        .await;
    let bound: MeshEgressRouteBound =
        serde_json::from_value(added["result"].clone()).unwrap_or_else(|e| panic!("{e}: {added}"));
    assert_eq!(bound.id.as_str(), "egress-dev-b-9422");
    let listen = bound.listen.as_str().to_owned();
    assert!(listen.starts_with("127.0.0.1:"), "{listen}");
    assert_ne!(listen, door.to_string());
    assert_eq!(
        exchange(&listen, b"hi").await.as_deref(),
        Some(&b"door:hi"[..]),
        "a byte through the route reaches the door"
    );

    let note = mgmt.note("native.mesh.egress.route.snapshot").await;
    assert_eq!(note["params"]["subId"], sub_id);
    let streamed: MeshEgressRouteTable =
        serde_json::from_value(note["params"]["payload"].clone()).unwrap();
    assert!(
        streamed.revision.0 >= bound.revision.0,
        "the push that carries a binding is stamped at or after it"
    );
    assert!(
        bound.revision.0 > empty.revision.0,
        "an add moves the revision"
    );
    assert_eq!(streamed.routes.len(), 1);
    assert_eq!(streamed.routes[0].listen.as_str(), listen);
    assert_eq!(streamed.routes[0].target.as_str(), PEER_CELLS);

    // idempotent per id: the SAME listener, not a second one
    let again = mgmt
        .call(
            "native.mesh.egress.route.add",
            json!({"id": "egress-dev-b-9422", "target": PEER_CELLS}),
        )
        .await;
    assert_eq!(again["result"]["listen"], json!(listen), "{again}");

    // a route never re-aims
    fake.admit("laptop.tail1234.ts.net:9422", door);
    let reaim = mgmt
        .call(
            "native.mesh.egress.route.add",
            json!({"id": "egress-dev-b-9422", "target": "laptop.tail1234.ts.net:9422"}),
        )
        .await;
    assert_eq!(reaim["error"]["data"]["kind"], "CONFLICT", "{reaim}");
    assert_eq!(error_code(&reaim), "EGRESS_ROUTE_CONFLICT");
    assert_eq!(reaim["error"]["data"]["details"]["boundTarget"], PEER_CELLS);

    let listed = mgmt.call("native.mesh.egress.route.list", json!({})).await;
    let listed: MeshEgressRouteTable = serde_json::from_value(listed["result"].clone()).unwrap();
    assert_eq!(listed.routes.len(), 1);

    let removed = mgmt
        .call(
            "native.mesh.egress.route.remove",
            json!({"id": "egress-dev-b-9422"}),
        )
        .await;
    let removed: MeshEgressRouteRef = serde_json::from_value(removed["result"].clone()).unwrap();
    assert_eq!(removed.id.as_str(), "egress-dev-b-9422");
    // the stream's latest word is the empty table (the watch may coalesce the
    // idempotent re-add's bump into this one, so read until it settles)
    loop {
        let note = mgmt.note("native.mesh.egress.route.snapshot").await;
        if note["params"]["payload"]["routes"] == json!([]) {
            break;
        }
    }
    assert_eq!(
        exchange(&listen, b"late").await,
        None,
        "a removed route reaches nothing"
    );
    let twice = mgmt
        .call(
            "native.mesh.egress.route.remove",
            json!({"id": "egress-dev-b-9422"}),
        )
        .await;
    assert_eq!(twice["error"]["data"]["kind"], "NOT_FOUND", "{twice}");
    drop(mgmt);
    daemon.shutdown().await;
}

/// DS-L6's belt, and the substrate's own refusal of a non-peer.
#[tokio::test]
async fn a_route_may_aim_only_at_an_admitted_peers_grant_door() {
    let (_dir, daemon, fake, door) = fake_floor().await;
    fake.admit("studio.tail1234.ts.net:9423", door);
    let mut mgmt = Mgmt::connect(&daemon).await;

    // The product door trusts the node's login, so an unauthenticated route to
    // it would hand any same-uid process the peer's whole door (EL7). Refused
    // by the FLOOR even though the fake would happily bind it.
    let product = mgmt
        .call(
            "native.mesh.egress.route.add",
            json!({"id": "r1", "target": "studio.tail1234.ts.net:9423"}),
        )
        .await;
    assert_eq!(
        product["error"]["data"]["kind"], "PRECONDITION_FAILED",
        "{product}"
    );
    assert_eq!(error_code(&product), "EGRESS_PORT_NOT_ROUTABLE");
    assert_eq!(
        product["error"]["data"]["details"]["routablePorts"],
        json!([9422])
    );

    let stranger = mgmt
        .call(
            "native.mesh.egress.route.add",
            json!({"id": "r2", "target": "stranger.tail1234.ts.net:9422"}),
        )
        .await;
    // the substrate's code, verbatim (RFC 026's sidecar answers the same one)
    assert_eq!(error_code(&stranger), "TARGET_NOT_PEER", "{stranger}");

    // the contract's own pattern, on the floor's side of the wire
    let url = mgmt
        .call(
            "native.mesh.egress.route.add",
            json!({"id": "r3", "target": "ws://studio.tail1234.ts.net:9422"}),
        )
        .await;
    assert_eq!(url["error"]["data"]["kind"], "PRECONDITION_FAILED", "{url}");

    let listed = mgmt.call("native.mesh.egress.route.list", json!({})).await;
    assert_eq!(listed["result"]["routes"], json!([]), "nothing was bound");
    drop(mgmt);
    daemon.shutdown().await;
}

/// No node: the acts that need one say `mesh-down` with the gateway's word,
/// while the table reads still answer — empty, which is the truth.
#[tokio::test]
async fn without_a_node_the_acts_answer_mesh_down_and_the_table_reads_empty() {
    let (_dir, daemon, _fake, _door) = fake_floor().await;
    daemon.state.mesh.force_node_presence_for_tests(false);
    let mut mgmt = Mgmt::connect(&daemon).await;
    let down = golden("error-data.egress-mesh-down.json");
    for (method, params) in [
        ("native.mesh.egress.proxy", json!({})),
        ("native.mesh.egress.httpProxy", json!({})),
        (
            "native.mesh.egress.route.add",
            json!({"id": "r1", "target": PEER_CELLS}),
        ),
    ] {
        let reply = mgmt.call(method, params).await;
        assert_eq!(reply["error"]["data"], down, "{method}: {reply}");
    }
    let listed = mgmt.call("native.mesh.egress.route.list", json!({})).await;
    assert_eq!(listed["result"]["routes"], json!([]));
    drop(mgmt);
    daemon.shutdown().await;
}

/// The capture-mode belt `serve.add` and `store.set` already wear: while the
/// login is being captured the node is ungated, so nothing reaches out as it.
#[tokio::test]
async fn capture_mode_reaches_out_through_nothing() {
    let (_dir, daemon) = boot(|c| NativeConfig {
        sidecar_override: Some("/nonexistent/sidecar-slim".into()),
        ..c
    })
    .await;
    let fake = Arc::new(FakeEgress::new());
    fake.admit(PEER_CELLS, door().await);
    daemon.state.mesh.install_egress_for_tests(fake);
    daemon.state.mesh.force_node_presence_for_tests(true);
    daemon
        .state
        .mesh
        .start(MeshMode::Capture, None)
        .await
        .unwrap();
    let mut mgmt = Mgmt::connect(&daemon).await;
    for (method, params) in [
        ("native.mesh.egress.proxy", json!({})),
        ("native.mesh.egress.httpProxy", json!({})),
        (
            "native.mesh.egress.route.add",
            json!({"id": "r1", "target": PEER_CELLS}),
        ),
    ] {
        let reply = mgmt.call(method, params).await;
        assert_eq!(error_code(&reply), "MESH_CAPTURING", "{method}: {reply}");
    }
    drop(mgmt);
    daemon.shutdown().await;
}

/// REBUILT-NOT-PERSISTED: a node teardown drops every route, and the stream
/// pushes the emptied table — the facade's reset, which is how fieldd learns
/// the listen addresses it handed out are dead.
#[tokio::test]
async fn a_node_teardown_resets_the_table_and_the_stream_says_so() {
    let (_dir, daemon, _fake, _door) = fake_floor().await;
    let mut mgmt = Mgmt::connect(&daemon).await;
    mgmt.call("native.mesh.egress.route.subscribe", json!({}))
        .await;
    let added = mgmt
        .call(
            "native.mesh.egress.route.add",
            json!({"id": "r1", "target": PEER_CELLS}),
        )
        .await;
    let bound: MeshEgressRouteBound = serde_json::from_value(added["result"].clone()).unwrap();
    let listen = bound.listen.as_str().to_owned();
    let first = mgmt.note("native.mesh.egress.route.snapshot").await;
    assert_eq!(first["params"]["payload"]["routes"][0]["id"], "r1");

    // the posture going offline tears the node down (the same teardown a
    // gate-change rebuild and an unlink run)
    daemon.state.mesh.stop().await;
    let reset = mgmt.note("native.mesh.egress.route.snapshot").await;
    let reset: MeshEgressRouteTable =
        serde_json::from_value(reset["params"]["payload"].clone()).unwrap();
    assert!(reset.routes.is_empty(), "the reset is the empty table");
    assert!(
        reset.revision.0 > bound.revision.0,
        "a reader holding the binding can tell the reset is NEWER than it"
    );
    assert_eq!(exchange(&listen, b"after").await, None);
    let listed = mgmt.call("native.mesh.egress.route.list", json!({})).await;
    let listed: MeshEgressRouteTable = serde_json::from_value(listed["result"].clone()).unwrap();
    assert!(listed.routes.is_empty());
    assert_eq!(
        listed.boot_id.as_str(),
        bound.boot_id.as_str(),
        "one floor boot: its revisions are one order"
    );
    assert_eq!(listed.boot_id.as_str(), daemon.state.boot_id);
    assert_eq!(
        listed.revision.0, reset.revision.0,
        "nothing moved since the reset"
    );
    drop(mgmt);
    daemon.shutdown().await;
}
