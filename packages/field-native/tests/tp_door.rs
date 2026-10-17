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
use tp_mint::{hello, small_capacities, worker_capacities, TestMinter, TransportSpec};

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
    // N-H1 — `small_capacities()`, not the product's: this row is ABOUT the MIN
    // being taken, so it needs an advertisement genuinely below the cell's cap.
    let accepted =
        expect_accepted(say_hello(&mut frames, "frames", &grant, Some(small_capacities())).await);
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

/// F1 — `RevokeClient`: below the client's wall a grant is a rollback, on a set this door has
/// never seen; at the wall it is admitted; another client is untouched.
#[tokio::test]
async fn a_revoked_client_is_refused_below_its_wall_even_on_a_set_the_door_never_saw() {
    let m = minter();
    let door = Door::serve(config(&m)).await.expect("serve");
    let live = m.transport(TransportSpec::basic("set-live", 2, "n-l2"));
    let (mut control, _) = dial(&door.control_url(), None).await;
    expect_accepted(say_hello(&mut control, "control", &live, None).await);
    door.revoke_client("win:1#1", 5);

    let below = m.transport(TransportSpec::basic("set-unseen", 4, "n-u4"));
    let (mut ws, _) = dial(&door.control_url(), None).await;
    expect_refused(
        say_hello(&mut ws, "control", &below, None).await,
        "GRANT_GENERATION_ROLLBACK",
        false,
    );
    let at = m.transport(TransportSpec::basic("set-unseen", 5, "n-u5"));
    let (mut ws, _) = dial(&door.control_url(), None).await;
    expect_accepted(say_hello(&mut ws, "control", &at, None).await);
    let other = m.transport(TransportSpec {
        client_id: "win:2#1",
        ..TransportSpec::basic("set-other", 1, "n-o1")
    });
    let (mut ws, _) = dial(&door.control_url(), None).await;
    expect_accepted(say_hello(&mut ws, "control", &other, None).await);
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

    // a geometry verb IS served now (S3c): a claim naming an activation this leg
    // never attached is a STRUCTURED refusal (NOT_HOLDER) and the leg LIVES — not
    // a protocol close.
    let g1 = m.transport(TransportSpec::basic("set-i", 1, "n-i1"));
    let (mut ws, _) = dial(&door.control_url(), None).await;
    expect_accepted(say_hello(&mut ws, "control", &g1, None).await);
    ws.send(Message::Text(
        json!({"type":"ClaimGeometry","sessionId":"s","activationId":"a1","leaseEpoch":0,"claimant":{"clientId":"c","viewId":"v"},"cols":80,"rows":24,"expectRevision":0})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    match next_reply(&mut ws).await {
        Reply::Text(v) => {
            assert_eq!(v["type"], "GeometryRefused");
            assert_eq!(v["code"], "NOT_HOLDER");
        }
        other => panic!("expected GeometryRefused, got {other:?}"),
    }
    // the leg is still alive: a bogus tag after it still earns the PROTOCOL close.
    ws.send(Message::Text(json!({"type":"Nope"}).to_string().into()))
        .await
        .unwrap();
    expect_close(
        next_reply(&mut ws).await,
        4003,
        "PROTOCOL:unknown-type:Nope",
    );
    // an attach whose grant is not a grant at all: ONE structured refusal, the leg lives
    let g1b = m.transport(TransportSpec::basic("set-i", 2, "n-i1b"));
    let (mut ws, _) = dial(&door.control_url(), None).await;
    expect_accepted(say_hello(&mut ws, "control", &g1b, None).await);
    ws.send(Message::Text(
        json!({"type":"AttachControlLeg","activationId":"a1","attachGrant":{},"initialDemand":{"mode":"live"}})
            .to_string()
            .into(),
    ))
    .await
    .unwrap();
    match next_reply(&mut ws).await {
        Reply::Text(v) => {
            assert_eq!(v["type"], "AttachRefused");
            assert_eq!(v["code"], "GRANT_INVALID");
            assert_eq!(v["activationId"], "a1");
        }
        other => panic!("expected AttachRefused, got {other:?}"),
    }

    // an unknown tag
    let g2 = m.transport(TransportSpec::basic("set-i", 3, "n-i2"));
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
    let g3 = m.transport(TransportSpec::basic("set-i", 4, "n-i3"));
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

/// N-M5 (EL7 Q8) — permessage-deflate, refused against a client that ACTUALLY
/// OFFERS IT.
///
/// The refusal was already asserted in two places, and NEITHER could fail. Both
/// this file's `dial` and the live probe use tokio-tungstenite at default
/// features, which has no compression built in (there is no flate2 in
/// Cargo.lock) — so neither client ever sends `Sec-WebSocket-Extensions`, and a
/// server that never receives an offer cannot accept one. Deleting the door's
/// entire compression stance would have left both assertions green.
///
/// IT MATTERS BECAUSE THE PHONE IS NOT THAT CLIENT. `URLSessionWebSocketTask`
/// ALWAYS offers permessage-deflate, and the whole §8 byte ledger assumes both
/// ends charge the same received length: if the cell ever negotiated it, the
/// client would return credit for the COMPRESSED bytes it received while the
/// cell had charged the uncompressed ones, and the two windows would drift
/// apart silently, in the direction that starves the stream.
///
/// So this row hand-writes the upgrade on a raw socket — the same technique the
/// probe's echo backend uses to read what the sidecar forwards — and reads the
/// response head itself. Nothing but a raw socket can express this offer with
/// the crates in this lockfile.
#[tokio::test]
async fn an_offered_permessage_deflate_is_never_echoed_in_the_101() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let m = minter();
    let door = Door::serve(config(&m)).await.expect("serve");

    let mut sock = tokio::net::TcpStream::connect(("127.0.0.1", door.port()))
        .await
        .expect("connect the control door");
    let request = format!(
        "GET /control HTTP/1.1\r\n\
         Host: 127.0.0.1:{}\r\n\
         Upgrade: websocket\r\n\
         Connection: Upgrade\r\n\
         Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\
         Sec-WebSocket-Version: 13\r\n\
         Origin: {APP_ORIGIN}\r\n\
         Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\n\
         \r\n",
        door.port()
    );
    sock.write_all(request.as_bytes())
        .await
        .expect("write the upgrade");

    // Read until the end of the response head.
    let mut head = Vec::new();
    let mut byte = [0_u8; 1];
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while !head.ends_with(b"\r\n\r\n") {
        if tokio::time::Instant::now() >= deadline {
            panic!("the door never finished a response head: {head:?}");
        }
        match tokio::time::timeout(Duration::from_secs(5), sock.read(&mut byte)).await {
            Ok(Ok(0)) => panic!("the door closed mid-head: {head:?}"),
            Ok(Ok(_)) => head.push(byte[0]),
            Ok(Err(e)) => panic!("read: {e}"),
            Err(_) => panic!("the door never answered the upgrade"),
        }
    }
    let head = String::from_utf8_lossy(&head).to_string();
    let lower = head.to_ascii_lowercase();

    // PIN THE PRECONDITION: the offer really was sent, and the door really did
    // upgrade — otherwise "no extension" would be the trivial truth about a
    // refused connection rather than about a negotiation that declined.
    assert!(
        request.contains("Sec-WebSocket-Extensions: permessage-deflate"),
        "this row is worthless if it does not offer"
    );
    assert!(
        lower.starts_with("http/1.1 101"),
        "the offer must not cost the upgrade — a door that 400s here would break \
         every phone that always offers: {head}"
    );
    assert!(
        !lower.contains("sec-websocket-extensions"),
        "the door echoed an extension it must never negotiate — the §8 byte ledger \
         charges uncompressed length on both ends: {head}"
    );
}

/// T-M3 — an AUTHENTICATED LEG OUTLIVES ITS TRANSPORT GRANT, which is the
/// property the re-mint-rate analysis rests on and which nothing asserted.
///
/// The expiry row above proves only the refusal AT THE HELLO: a grant already
/// dead when it arrives never establishes. What the design actually claims is
/// the other half — that the 60 s `TRANSPORT_GRANT_TTL_MS` is an ESTABLISHMENT
/// DEADLINE and not a session lifetime, so a phone that established a leg keeps
/// it for hours and fieldd mints one transport grant per CONNECTION rather than
/// one per minute. If the door ever re-verified on the heartbeat path, every
/// leg on the device would drop 60 seconds after it opened and the re-mint rate
/// would be sixty times what the design budgeted for.
///
/// The row narrows the skew to zero for its own door so the grant can be
/// genuinely dead in a second rather than in a minute; the skew is a separate
/// dimension and has its own place above.
///
/// AND IT PINS ITS PRECONDITION rather than only asserting the end state: a
/// FRESH hello with an equally dead grant is refused in the same breath. Without
/// that, a run where the clock never actually passed `expiresAt` would pass for
/// the wrong reason.
#[tokio::test]
async fn an_established_leg_outlives_its_transport_grant() {
    let m = minter();
    let verifier = field_native::tp::grant::GrantVerifier::new(
        field_native::tp::grant::GrantKey {
            cell_boot_id: m.cell_boot_id.clone(),
            key_generation: m.key_generation,
            key: m.key.clone(),
        },
        field_native::tp::grant::GrantValidityLimits {
            max_clock_skew_ms: 0,
            ..field_native::tp::grant::GrantValidityLimits::default()
        },
    );
    let door = Door::serve(DoorConfig::new(verifier, vec![APP_ORIGIN.to_string()]))
        .await
        .expect("serve");

    let now = field_native::tp::unix_ms();
    let short = |set: &'static str, nonce: &'static str| TransportSpec {
        issued_at: Some(now - 1_000),
        expires_at: Some(now + 1_200),
        ..TransportSpec::basic(set, 1, nonce)
    };

    let (mut ws, _) = dial(&door.control_url(), Some(APP_ORIGIN)).await;
    let accepted = expect_accepted(
        say_hello(
            &mut ws,
            "control",
            &m.transport(short("set-live", "n-live")),
            None,
        )
        .await,
    );
    assert_eq!(accepted["connectionSetId"], "set-live");

    // Past `expiresAt`, with no skew left to hide in.
    tokio::time::sleep(Duration::from_millis(2_000)).await;
    assert!(
        field_native::tp::unix_ms() > now + 1_200,
        "the clock must really have passed expiresAt, or this row proves nothing"
    );

    // THE PRECONDITION: an equally dead grant cannot establish any more. A
    // different set and nonce, so this is refused for its EXPIRY and not as a
    // replay of the leg above.
    let (mut fresh, _) = dial(&door.control_url(), Some(APP_ORIGIN)).await;
    expect_silent_1008(
        say_hello(
            &mut fresh,
            "control",
            &m.transport(short("set-dead", "n-dead")),
            None,
        )
        .await,
    );

    // THE CLAIM: the leg established while the grant was alive is still a leg.
    ws.send(Message::Text(
        json!({
            "type": "LegHeartbeat",
            "connectionSetId": "set-live",
            "channel": "control",
            "legGeneration": 1,
            "sequence": 1,
        })
        .to_string()
        .into(),
    ))
    .await
    .expect("send a heartbeat");
    match next_reply(&mut ws).await {
        Reply::Text(v) => assert_eq!(
            v["type"], "LegHeartbeatAck",
            "an established leg must survive its transport grant — the TTL is an \
             ESTABLISHMENT deadline, not a session lifetime: {v}"
        ),
        other => panic!("the leg was closed after its grant expired: {other:?}"),
    }

    // And the door still holds it, not merely the socket.
    let snapshot = door.snapshot();
    assert_eq!(snapshot.sets.len(), 1);
    assert_eq!(snapshot.sets[0].connection_set_id, "set-live");
    assert_eq!(snapshot.sets[0].legs.len(), 1);
}
