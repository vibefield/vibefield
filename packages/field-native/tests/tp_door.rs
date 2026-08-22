//! TP-S3a — the cell's T1 doors, driven in-process against a REAL
//! `tokio-tungstenite` client (terminal-pipeline-v3 §5.1 handshake, §8 door
//! hygiene, the contracts' CONNECTION_LEG machine and failure matrix). Every
//! row here is a gate line of the S3a slice: both sockets accepted; invalid
//! Origin / grant / stale generation refused with the NAMED codes (silent
//! `1008` for the pre-auth class, `ConnectionRefused` for the structured class);
//! channel uniqueness + higher-generation replacement; heartbeat expiry closes a
//! leg; shutdown closes every leg `1001`.

#[path = "support/tp_mint.rs"]
mod tp_mint;

use field_native::tp::door::{Door, DoorConfig, LegClose};
use field_native::tp::grant::{GrantKey, GrantValidityLimits, GrantVerifier};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use tp_mint::{hello, worker_capacities, TestMinter, TransportSpec};

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

const CELL: &str = "cb-test-0001";
const APP_ORIGIN: &str = "vibefield-app://shell";

fn minter() -> TestMinter {
    TestMinter::new(CELL)
}

fn config(m: &TestMinter) -> DoorConfig {
    let verifier = GrantVerifier::new(
        GrantKey {
            cell_boot_id: m.cell_boot_id.clone(),
            key_generation: m.key_generation,
            key: m.key.clone(),
        },
        GrantValidityLimits::default(),
    );
    DoorConfig::new(verifier, vec![APP_ORIGIN.to_string()])
}

async fn dial(url: &str, origin: Option<&str>) -> (Ws, http::Response<Option<Vec<u8>>>) {
    let mut request = url.into_client_request().expect("client request");
    if let Some(o) = origin {
        request
            .headers_mut()
            .insert("origin", o.parse().expect("origin header"));
    }
    tokio::time::timeout(
        Duration::from_secs(5),
        tokio_tungstenite::connect_async(request),
    )
    .await
    .expect("dial within 5s")
    .expect("the door accepts the upgrade")
}

#[derive(Debug)]
enum Reply {
    Text(Value),
    Close(Option<(u16, String)>),
    Gone,
    Other,
}

async fn next_reply(ws: &mut Ws) -> Reply {
    match tokio::time::timeout(Duration::from_secs(5), ws.next()).await {
        Err(_) => panic!("no reply within 5s"),
        Ok(None) => Reply::Gone,
        Ok(Some(Err(_))) => Reply::Gone,
        Ok(Some(Ok(Message::Text(t)))) => {
            Reply::Text(serde_json::from_str(t.as_str()).expect("reply is JSON"))
        }
        Ok(Some(Ok(Message::Close(frame)))) => {
            Reply::Close(frame.map(|f| (u16::from(f.code), f.reason.to_string())))
        }
        Ok(Some(Ok(_))) => Reply::Other,
    }
}

async fn say_hello(ws: &mut Ws, channel: &str, grant: &Value, caps: Option<Value>) -> Reply {
    ws.send(Message::Text(hello(channel, grant, caps).into()))
        .await
        .expect("send hello");
    next_reply(ws).await
}

fn expect_accepted(reply: Reply) -> Value {
    match reply {
        Reply::Text(v) if v["type"] == "ConnectionAccepted" => v,
        other => panic!("expected ConnectionAccepted, got {other:?}"),
    }
}

fn expect_refused(reply: Reply, code: &str, retryable: bool) {
    match reply {
        Reply::Text(v) if v["type"] == "ConnectionRefused" => {
            assert_eq!(v["code"], code);
            assert_eq!(v["retryable"], retryable, "{code} retryable");
        }
        other => panic!("expected ConnectionRefused {code}, got {other:?}"),
    }
}

fn expect_close(reply: Reply, code: u16, reason: &str) {
    match reply {
        Reply::Close(Some((c, r))) => {
            assert_eq!(c, code, "close code (reason {r:?})");
            assert_eq!(r, reason, "close reason");
        }
        other => panic!("expected close {code} {reason:?}, got {other:?}"),
    }
}

/// The silent class: a `1008` close frame with NO reason and nothing before it.
fn expect_silent_1008(reply: Reply) {
    expect_close(reply, 1008, "");
}

fn fixture(name: &str) -> Value {
    let p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../contracts/fixtures")
        .join(name);
    serde_json::from_str(&std::fs::read_to_string(&p).expect("fixture read")).expect("json")
}

#[tokio::test]
async fn both_channels_accept_with_one_grant_and_announce_the_contracts_numbers() {
    let m = minter();
    let door = Door::serve(config(&m)).await.expect("serve");
    let grant = m.transport(TransportSpec::basic("set-a", 1, "n-1"));

    // control: no credit epoch, no windows — and no compression negotiated.
    let (mut control, response) = dial(&door.control_url(), Some(APP_ORIGIN)).await;
    assert!(
        response.headers().get("sec-websocket-extensions").is_none(),
        "permessage-deflate is never negotiated (both ends charge the same bytes)"
    );
    let accepted = expect_accepted(say_hello(&mut control, "control", &grant, None).await);
    assert_eq!(accepted["channel"], "control");
    assert_eq!(accepted["connectionSetId"], "set-a");
    assert_eq!(accepted["legGeneration"], 1);
    assert_eq!(
        accepted["selectedProtocolVersion"],
        json!({"major": 1, "minor": 0})
    );
    assert_eq!(accepted["heartbeatTtlMs"], 15_000);
    assert!(accepted.get("creditEpoch").is_none());
    assert!(accepted.get("initialWindows").is_none());
    assert_eq!(
        accepted["protocolLimits"],
        fixture("tp-protocol-limits.defaults.json"),
        "the announced limits ARE the contracts' defaults"
    );
    assert_eq!(
        accepted["capabilities"],
        json!([]),
        "the v1 core cell speaks no wire capability; unknown client strings are ignored"
    );

    // frames, with the SAME grant (one generation may establish both
    // channels): a credit epoch and the MIN of advertised and cell windows.
    let (mut frames, _) = dial(&door.frames_url(), Some(APP_ORIGIN)).await;
    let accepted =
        expect_accepted(say_hello(&mut frames, "frames", &grant, Some(worker_capacities())).await);
    assert_eq!(accepted["channel"], "frames");
    assert_eq!(accepted["legGeneration"], 1);
    assert_eq!(
        accepted["creditEpoch"], 1,
        "the credit epoch IS the frames-leg generation"
    );
    let windows = &accepted["initialWindows"];
    assert_eq!(
        windows["connectionCreditBytes"], 1_048_576,
        "advertised < cell cap → advertised"
    );
    assert_eq!(windows["maxConcurrentSeeds"], 2);
    assert_eq!(windows["stagingBytesTotal"], 16_777_216);

    let snapshot = door.snapshot();
    assert_eq!(snapshot.sets.len(), 1);
    assert_eq!(snapshot.sets[0].connection_set_id, "set-a");
    assert_eq!(snapshot.sets[0].client_id, "win:1#1");
    assert_eq!(snapshot.sets[0].legs.len(), 2);
    assert_eq!(snapshot.sets[0].high_water, Some(1));
    assert_eq!(
        snapshot.pre_auth_connections, 0,
        "accepted legs left the pre-auth count"
    );

    // the same (nonce, channel) can never establish the same channel again
    let (mut again, _) = dial(&door.control_url(), Some(APP_ORIGIN)).await;
    expect_refused(
        say_hello(&mut again, "control", &grant, None).await,
        "GRANT_NONCE_REPLAYED",
        false,
    );
    door.shutdown().await;
}

#[tokio::test]
async fn origin_is_checked_at_the_upgrade_and_absence_is_admitted() {
    let m = minter();
    let door = Door::serve(config(&m)).await.expect("serve");
    // a browser origin outside the allow-list: silent 1008, nothing before it
    let (mut bad, _) = dial(&door.control_url(), Some("http://evil.example")).await;
    expect_silent_1008(next_reply(&mut bad).await);
    // a non-browser client (no Origin): the grant is the authority
    let (mut bare, _) = dial(&door.control_url(), None).await;
    let grant = m.transport(TransportSpec::basic("set-b", 1, "n-b"));
    expect_accepted(say_hello(&mut bare, "control", &grant, None).await);
    door.shutdown().await;
}

#[tokio::test]
async fn the_silent_class_closes_1008_with_no_body() {
    let m = minter();
    let door = Door::serve(config(&m)).await.expect("serve");
    let good = m.transport(TransportSpec::basic("set-c", 1, "n-c"));

    // a tampered claim (bad MAC)
    let mut tampered = good.clone();
    tampered["claims"]["clientId"] = json!("win:evil");
    let (mut ws, _) = dial(&door.control_url(), None).await;
    expect_silent_1008(say_hello(&mut ws, "control", &tampered, None).await);

    // another cell's audience, signed with this key
    let other = m.transport(TransportSpec {
        audience: Some("cb-other"),
        ..TransportSpec::basic("set-c", 1, "n-c2")
    });
    let (mut ws, _) = dial(&door.control_url(), None).await;
    expect_silent_1008(say_hello(&mut ws, "control", &other, None).await);

    // expired (establishment deadline passed beyond the skew)
    let now = field_native::tp::unix_ms();
    let expired = m.transport(TransportSpec {
        issued_at: Some(now - 120_000),
        expires_at: Some(now - 60_000),
        ..TransportSpec::basic("set-c", 1, "n-c3")
    });
    let (mut ws, _) = dial(&door.control_url(), None).await;
    expect_silent_1008(say_hello(&mut ws, "control", &expired, None).await);

    // the first frame is not a hello
    let (mut ws, _) = dial(&door.control_url(), None).await;
    ws.send(Message::Text(
        json!({"type":"LegHeartbeat","connectionSetId":"set-c","channel":"control","legGeneration":1,"sequence":1})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    expect_silent_1008(next_reply(&mut ws).await);

    // a hello whose channel does not match the path
    let (mut ws, _) = dial(&door.frames_url(), None).await;
    expect_silent_1008(say_hello(&mut ws, "control", &good, None).await);

    // a binary first frame
    let (mut ws, _) = dial(&door.control_url(), None).await;
    ws.send(Message::Binary(vec![1, 2, 3].into()))
        .await
        .unwrap();
    expect_silent_1008(next_reply(&mut ws).await);

    // an unknown path
    let (mut ws, _) = dial(&format!("ws://127.0.0.1:{}/nope", door.port()), None).await;
    expect_silent_1008(next_reply(&mut ws).await);

    // nothing was allocated for any of them
    let snapshot = door.snapshot();
    assert!(snapshot.sets.is_empty());
    assert_eq!(
        snapshot.ledger_sizes,
        (0, 0, 0),
        "no high-water, no nonce consumed"
    );
    door.shutdown().await;
}

#[tokio::test]
async fn the_hello_deadline_and_the_pre_auth_cap_close_1008() {
    let m = minter();
    let mut cfg = config(&m);
    cfg.hello_deadline = Duration::from_millis(500);
    cfg.pre_auth_connection_cap = 1;
    let door = Door::serve(cfg).await.expect("serve");

    // deadline: a socket that never says hello
    let (mut silent, _) = dial(&door.control_url(), None).await;
    let started = std::time::Instant::now();
    expect_silent_1008(next_reply(&mut silent).await);
    assert!(started.elapsed() < Duration::from_secs(3));

    // cap: the first pre-auth socket holds the only slot; the second is refused
    let (mut first, _) = dial(&door.control_url(), None).await;
    let (mut second, _) = dial(&door.control_url(), None).await;
    expect_silent_1008(next_reply(&mut second).await);
    // the first still completes its hello within its own deadline window
    let grant = m.transport(TransportSpec::basic("set-d", 1, "n-d"));
    expect_accepted(say_hello(&mut first, "control", &grant, None).await);
    door.shutdown().await;
}

#[tokio::test]
async fn the_structured_class_answers_connection_refused_with_the_named_code() {
    let m = minter();
    let mut cfg = config(&m);
    cfg.max_connection_sets = 1;
    let door = Door::serve(cfg).await.expect("serve");

    // generation 2 establishes the set's high-water
    let g2 = m.transport(TransportSpec::basic("set-e", 2, "n-e2"));
    let (mut control, _) = dial(&door.control_url(), None).await;
    expect_accepted(say_hello(&mut control, "control", &g2, None).await);

    // a lower generation is a rollback — terminal for that grant
    let g1 = m.transport(TransportSpec::basic("set-e", 1, "n-e1"));
    let (mut ws, _) = dial(&door.frames_url(), None).await;
    expect_refused(
        say_hello(&mut ws, "frames", &g1, Some(worker_capacities())).await,
        "GRANT_GENERATION_ROLLBACK",
        false,
    );
    expect_close(next_reply(&mut ws).await, 1000, "GRANT_GENERATION_ROLLBACK");

    // a channel the grant does not allow
    let control_only = m.transport(TransportSpec {
        channels: &["control"],
        ..TransportSpec::basic("set-e", 3, "n-e3")
    });
    let (mut ws, _) = dial(&door.frames_url(), None).await;
    expect_refused(
        say_hello(&mut ws, "frames", &control_only, None).await,
        "CHANNEL_NOT_ALLOWED",
        false,
    );

    // a protocol major this cell does not speak
    let g4 = m.transport(TransportSpec::basic("set-e", 4, "n-e4"));
    let (mut ws, _) = dial(&door.frames_url(), None).await;
    let mut v: Value = serde_json::from_str(&hello("frames", &g4, None)).unwrap();
    v["protocolMajor"] = json!(2);
    ws.send(Message::Text(v.to_string().into())).await.unwrap();
    expect_refused(next_reply(&mut ws).await, "VERSION_UNSUPPORTED", false);

    // capacity: a SECOND connection set on a one-set door
    let other = m.transport(TransportSpec::basic("set-f", 1, "n-f1"));
    let (mut ws, _) = dial(&door.control_url(), None).await;
    expect_refused(
        say_hello(&mut ws, "control", &other, None).await,
        "CAPACITY",
        true,
    );

    // the live leg was untouched by every refusal above
    assert_eq!(door.snapshot().sets[0].legs.len(), 1);
    door.shutdown().await;
}

#[tokio::test]
async fn one_leg_per_channel_with_higher_generation_replacement() {
    let m = minter();
    let door = Door::serve(config(&m)).await.expect("serve");
    let now = field_native::tp::unix_ms();

    let g1 = m.transport(TransportSpec {
        issued_at: Some(now - 5_000),
        ..TransportSpec::basic("set-g", 1, "n-g1")
    });
    let (mut leg_a, _) = dial(&door.control_url(), None).await;
    expect_accepted(say_hello(&mut leg_a, "control", &g1, None).await);

    // a higher generation takes the channel; A learns it is superseded
    let g2 = m.transport(TransportSpec {
        issued_at: Some(now - 4_000),
        ..TransportSpec::basic("set-g", 2, "n-g2")
    });
    let (mut leg_b, _) = dial(&door.control_url(), None).await;
    let accepted = expect_accepted(say_hello(&mut leg_b, "control", &g2, None).await);
    assert_eq!(
        accepted["legGeneration"], 2,
        "leg generations are monotonic per channel"
    );
    expect_close(next_reply(&mut leg_a).await, 4002, "SUPERSEDED");

    // equal generation, OLDER grant (issued before B's): busy, retryable
    let g2_old = m.transport(TransportSpec {
        issued_at: Some(now - 4_500),
        ..TransportSpec::basic("set-g", 2, "n-g2old")
    });
    let (mut ws, _) = dial(&door.control_url(), None).await;
    expect_refused(
        say_hello(&mut ws, "control", &g2_old, None).await,
        "SET_CHANNEL_BUSY",
        true,
    );

    // equal generation, NEWER grant: replaces B
    let g2_new = m.transport(TransportSpec {
        issued_at: Some(now - 3_000),
        ..TransportSpec::basic("set-g", 2, "n-g2new")
    });
    let (mut leg_c, _) = dial(&door.control_url(), None).await;
    let accepted = expect_accepted(say_hello(&mut leg_c, "control", &g2_new, None).await);
    assert_eq!(accepted["legGeneration"], 3);
    expect_close(next_reply(&mut leg_b).await, 4002, "SUPERSEDED");

    let snapshot = door.snapshot();
    assert_eq!(
        snapshot.sets[0].legs,
        vec![(field_native::tp::grant::Channel::Control, 3, 2)]
    );
    assert_eq!(snapshot.sets[0].high_water, Some(2));
    door.shutdown().await;
}

#[tokio::test]
async fn heartbeats_ack_and_the_receipt_deadline_closes_4004() {
    let m = minter();
    let mut cfg = config(&m);
    cfg.heartbeat_ttl = Duration::from_millis(400);
    let door = Door::serve(cfg).await.expect("serve");
    let grant = m.transport(TransportSpec::basic("set-h", 1, "n-h"));

    let (mut ws, _) = dial(&door.control_url(), None).await;
    let accepted = expect_accepted(say_hello(&mut ws, "control", &grant, None).await);
    assert_eq!(accepted["heartbeatTtlMs"], 400);
    // heartbeats inside the TTL keep the leg alive and are acked by sequence
    for sequence in 1..=3u64 {
        tokio::time::sleep(Duration::from_millis(150)).await;
        ws.send(Message::Text(
            json!({"type":"LegHeartbeat","connectionSetId":"set-h","channel":"control","legGeneration":1,"sequence":sequence})
                .to_string()
                .into(),
        ))
        .await
        .unwrap();
        match next_reply(&mut ws).await {
            Reply::Text(v) => {
                assert_eq!(v["type"], "LegHeartbeatAck");
                assert_eq!(v["sequence"], sequence);
            }
            other => panic!("expected an ack, got {other:?}"),
        }
    }
    // a heartbeat naming another leg is a protocol error
    ws.send(Message::Text(
        json!({"type":"LegHeartbeat","connectionSetId":"set-h","channel":"control","legGeneration":7,"sequence":9})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    expect_close(
        next_reply(&mut ws).await,
        4003,
        "PROTOCOL:heartbeat-identity",
    );

    // a new leg that goes quiet dies at the deadline
    let grant2 = m.transport(TransportSpec::basic("set-h", 2, "n-h2"));
    let (mut quiet, _) = dial(&door.control_url(), None).await;
    expect_accepted(say_hello(&mut quiet, "control", &grant2, None).await);
    let started = std::time::Instant::now();
    expect_close(next_reply(&mut quiet).await, 4004, "LEG_TIMEOUT");
    assert!(started.elapsed() >= Duration::from_millis(350));
    assert!(
        door.snapshot().sets.is_empty(),
        "the dead leg deregistered its set"
    );
    door.shutdown().await;
}

#[tokio::test]
async fn anything_beyond_the_connection_layer_is_an_honest_protocol_close() {
    let m = minter();
    let door = Door::serve(config(&m)).await.expect("serve");

    // a KNOWN control message the S3a door does not serve yet
    let g1 = m.transport(TransportSpec::basic("set-i", 1, "n-i1"));
    let (mut ws, _) = dial(&door.control_url(), None).await;
    expect_accepted(say_hello(&mut ws, "control", &g1, None).await);
    ws.send(Message::Text(
        json!({"type":"AttachControlLeg","activationId":"a1","attachGrant":{},"initialDemand":{"mode":"live"}})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    expect_close(
        next_reply(&mut ws).await,
        4003,
        "PROTOCOL:unsupported-at-s3a:AttachControlLeg",
    );

    // an unknown tag
    let g2 = m.transport(TransportSpec::basic("set-i", 2, "n-i2"));
    let (mut ws, _) = dial(&door.control_url(), None).await;
    expect_accepted(say_hello(&mut ws, "control", &g2, None).await);
    ws.send(Message::Text(json!({"type":"Nope"}).to_string().into()))
        .await
        .unwrap();
    expect_close(
        next_reply(&mut ws).await,
        4003,
        "PROTOCOL:unknown-type:Nope",
    );

    // binary on an accepted leg
    let g3 = m.transport(TransportSpec::basic("set-i", 3, "n-i3"));
    let (mut ws, _) = dial(&door.control_url(), None).await;
    expect_accepted(say_hello(&mut ws, "control", &g3, None).await);
    ws.send(Message::Binary(vec![0x54, 0x50].into()))
        .await
        .unwrap();
    expect_close(next_reply(&mut ws).await, 4003, "PROTOCOL:binary-inbound");
    door.shutdown().await;
}

#[tokio::test]
async fn shutdown_closes_every_leg_1001_and_close_set_names_its_reason() {
    let m = minter();
    let door = Door::serve(config(&m)).await.expect("serve");
    let grant = m.transport(TransportSpec::basic("set-j", 1, "n-j"));
    let (mut control, _) = dial(&door.control_url(), None).await;
    expect_accepted(say_hello(&mut control, "control", &grant, None).await);
    let (mut frames, _) = dial(&door.frames_url(), None).await;
    expect_accepted(say_hello(&mut frames, "frames", &grant, Some(worker_capacities())).await);

    // TC-S6's signal: a superseded cell answers STALE_ROUTE at its door
    let other = m.transport(TransportSpec::basic("set-k", 1, "n-k"));
    let (mut stale, _) = dial(&door.control_url(), None).await;
    expect_accepted(say_hello(&mut stale, "control", &other, None).await);
    assert_eq!(door.close_set("set-k", LegClose::StaleRoute), 1);
    expect_close(next_reply(&mut stale).await, 4000, "STALE_ROUTE");

    let port = door.port();
    door.shutdown().await;
    expect_close(next_reply(&mut control).await, 1001, "GOING_AWAY");
    expect_close(next_reply(&mut frames).await, 1001, "GOING_AWAY");
    assert!(door.snapshot().sets.is_empty());
    // and the door no longer accepts
    let refused = tokio::time::timeout(
        Duration::from_secs(2),
        tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}/control")),
    )
    .await;
    assert!(
        matches!(refused, Ok(Err(_)) | Err(_)),
        "a stopped door does not accept: {refused:?}"
    );
}
