//! TP-S3b — static activation, cell side, against a REAL ghosttea session
//! spawned by this harness (the `DirectSessions` source — the test binary's
//! session set until petition G22 lets a production cell share the UDS plane's)
//! and a REAL tungstenite client playing the routed runtime: both legs attach,
//! the seed transfer arrives (chunked, crc32c-checked, a whole TRF1 full
//! frame), `SceneApplied` turns the lease `presenting` + `input: allowed`,
//! deltas flow with base/result stamps as the PTY writes, credit starvation
//! coalesces and a catch-up transfer repairs the lineage once credit returns,
//! a read-only grant never reaches `InputAllowed`, demand `none` detaches the
//! view and `live` re-attaches it, a frames-leg loss revokes the lease on the
//! control leg, and a replaced activation is told so.

// The whole suite rides `spawn_session`'s `/bin/sh` harness (its doc says so:
// "Unix only — WIN-6 rows are the box's"), but only five rows carried the
// gate; the four added since (geometry, seed reason, catch-up, session
// events) failed the first box run with `CreateProcessW "/bin/sh"` os error 3,
// and the win32 build's clippy red (`Trf1Header`/`return_credit` unused) was
// the same gap's shadow. File-level cfg, the `resource_governance`/
// `native_logging` pattern — the TP win32 slice owns porting the harness.
#![cfg(unix)]

#[path = "support/tp_mint.rs"]
mod tp_mint;

use field_native::tp::crc32c::crc32c;
use field_native::tp::door::{Door, DoorConfig};
use field_native::tp::grant::{GrantKey, GrantValidityLimits, GrantVerifier};
use field_native::tp::source::{DirectSessions, SessionSource, Trf1Header};
use field_native::tp::wire::{decode_envelope, JSON_MAX_SAFE_INTEGER};
use futures_util::{SinkExt, StreamExt};
use ghosttea::session::{Persistence, SpawnOptions};
use ghosttea::{
    AutomationInputOperation, ExitOutcome, FrameHub, Session, SessionEnvironment, SessionExit,
    SessionLifecycleEvent, SessionProgramKind, TerminationSource, TextEngine,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use tp_mint::{hello, hello_with_capabilities, TestMinter, TransportSpec};

type Ws = WebSocketStream<MaybeTlsStream<TcpStream>>;

const CELL: &str = "cb-s3b-0001";

fn text_engine() -> Arc<Mutex<TextEngine>> {
    static ENGINE: OnceLock<Arc<Mutex<TextEngine>>> = OnceLock::new();
    ENGINE
        .get_or_init(|| {
            Arc::new(Mutex::new(
                TextEngine::discover().expect("a monospace font"),
            ))
        })
        .clone()
}

/// A real session: `/bin/sh` reading a script from its PTY, so the test can
/// make it PRINT by writing to the PTY. Unix only (WIN-6 rows are the box's).
fn spawn_session(source: &DirectSessions) -> Arc<Session> {
    let hub = FrameHub::new(64);
    let session = Session::spawn(
        SpawnOptions {
            executable: "/bin/sh".into(),
            args: vec![],
            cwd: None,
            env: HashMap::new(),
            environment: Some(SessionEnvironment::Clean {
                variables: HashMap::from([
                    ("PATH".into(), "/usr/bin:/bin".into()),
                    ("PS1".into(), "$ ".into()),
                    ("TERM".into(), "xterm".into()),
                ]),
            }),
            cols: 80,
            rows: 24,
            persistence: Persistence::KeepUntilExit,
            program_kind: SessionProgramKind::Application,
            owner_id: None,
            scrollback_bytes: None,
        },
        hub.clone(),
        text_engine(),
        Arc::new(move |_, _| {}),
    )
    .expect("spawn the session");
    source.insert(session.clone(), hub);
    session
}

struct Harness {
    minter: TestMinter,
    source: Arc<DirectSessions>,
    door: Door,
}

async fn harness() -> Harness {
    harness_cfg(|_| {}).await
}

async fn harness_cfg(configure: impl FnOnce(&mut DoorConfig)) -> Harness {
    harness_with_source(DirectSessions::new(), configure).await
}

async fn harness_with_source(
    source: Arc<DirectSessions>,
    configure: impl FnOnce(&mut DoorConfig),
) -> Harness {
    harness_with_door_source(source.clone(), source, configure).await
}

/// A harness whose DOOR reads sessions through `door_source` (a wrapper such as
/// `HoldingSource`) while the test spawns into `sessions`.
async fn harness_with_door_source(
    source: Arc<DirectSessions>,
    door_source: Arc<dyn SessionSource>,
    configure: impl FnOnce(&mut DoorConfig),
) -> Harness {
    let minter = TestMinter::new(CELL);
    let verifier = GrantVerifier::new(
        GrantKey {
            cell_boot_id: minter.cell_boot_id.clone(),
            key_generation: minter.key_generation,
            key: minter.key.clone(),
        },
        GrantValidityLimits::default(),
    );
    let mut config = DoorConfig::new(verifier, vec![]).with_source(door_source);
    config.tick = Duration::from_millis(100);
    // the tests drive credit by hand on a loaded host; the convergence bound
    // must not race the test's own pacing (production keeps the registry
    // default, `MAX_ACTIVATION_CATCHUP_MS`).
    config.catchup_bound = Duration::from_secs(30);
    configure(&mut config);
    let door = Door::serve(config).await.expect("serve");
    Harness {
        minter,
        source,
        door,
    }
}

impl Harness {
    fn attach_grant(&self, session_id: &str, generation: u64, rights: &[&str]) -> Value {
        let now = field_native::tp::unix_ms();
        let claims = json!({
            "audienceCellBootId": self.minter.cell_boot_id,
            "clientId": "win:1#1",
            "sessionId": session_id,
            "routeRevision": 3,
            "grantGeneration": generation,
            "rights": rights,
            "issuedAt": now - 1_000,
            "expiresAt": now + 600_000 - 1_000,
        });
        let protected = json!({
            "v": 1, "typ": "SessionAttachGrant", "iss": "fieldd", "alg": "HS256",
            "kid": { "cellBootId": self.minter.cell_boot_id, "keyGeneration": 1 },
        });
        let mac = self.minter.sign(&protected, &claims);
        json!({ "protected": protected, "claims": claims, "mac": mac })
    }
}

async fn dial(url: &str) -> Ws {
    let request = url.into_client_request().expect("client request");
    tokio::time::timeout(
        Duration::from_secs(5),
        tokio_tungstenite::connect_async(request),
    )
    .await
    .expect("dial within 5s")
    .expect("accepted upgrade")
    .0
}

#[derive(Debug)]
enum Reply {
    Text(Value),
    Unit(Value, Vec<u8>),
    Close,
    Gone,
}

async fn next_reply(ws: &mut Ws) -> Reply {
    next_reply_within(ws, Duration::from_secs(8)).await
}

async fn next_reply_within(ws: &mut Ws, within: Duration) -> Reply {
    match tokio::time::timeout(within, ws.next()).await {
        Err(_) => panic!("no reply within {within:?}"),
        Ok(None) | Ok(Some(Err(_))) => Reply::Gone,
        Ok(Some(Ok(Message::Text(t)))) => {
            Reply::Text(serde_json::from_str(t.as_str()).expect("reply is JSON"))
        }
        Ok(Some(Ok(Message::Binary(b)))) => {
            let (header, payload) = decode_envelope(&b).expect("a presentation envelope");
            Reply::Unit(header, payload.to_vec())
        }
        Ok(Some(Ok(Message::Close(frame)))) => {
            let _ = frame;
            Reply::Close
        }
        Ok(Some(Ok(_))) => Reply::Gone,
    }
}

async fn send_json(ws: &mut Ws, v: Value) {
    ws.send(Message::Text(v.to_string().into()))
        .await
        .expect("send");
}

fn expect_text(reply: Reply, type_: &str) -> Value {
    match reply {
        Reply::Text(v) if v["type"] == type_ => v,
        other => panic!("expected {type_}, got {other:?}"),
    }
}

/// Open both legs with one transport grant; returns (control, frames, creditEpoch).
async fn connect(h: &Harness, set: &str, generation: u64, caps: Value) -> (Ws, Ws, u64) {
    let grant = h.minter.transport(TransportSpec::basic(
        set,
        generation,
        &format!("n-{set}-{generation}"),
    ));
    let mut control = dial(&h.door.control_url()).await;
    send_json(
        &mut control,
        serde_json::from_str(&hello("control", &grant, None)).unwrap(),
    )
    .await;
    expect_text(next_reply(&mut control).await, "ConnectionAccepted");
    let mut frames = dial(&h.door.frames_url()).await;
    send_json(
        &mut frames,
        serde_json::from_str(&hello("frames", &grant, Some(caps))).unwrap(),
    )
    .await;
    let accepted = expect_text(next_reply(&mut frames).await, "ConnectionAccepted");
    let epoch = accepted["creditEpoch"].as_u64().unwrap();
    (control, frames, epoch)
}

fn caps(connection: u64, per_activation: u64) -> Value {
    json!({
        "connectionCreditBytes": connection,
        "perActivationCreditBytes": per_activation,
        "stagingBytesPerSession": 8_388_608,
        "stagingBytesTotal": 67_108_864,
        "maxConcurrentActivations": 16,
        "maxConcurrentSeeds": 2,
    })
}

async fn attach_both(
    h: &Harness,
    control: &mut Ws,
    frames: &mut Ws,
    session_id: &str,
    activation_id: &str,
    rights: &[&str],
    live: bool,
) -> (Value, Value) {
    let grant = h.attach_grant(session_id, 1, rights);
    send_json(
        control,
        json!({
            "type": "AttachControlLeg",
            "activationId": activation_id,
            "attachGrant": grant,
            "initialDemand": { "mode": if live { "live" } else { "none" } },
        }),
    )
    .await;
    let attached = expect_text(next_reply(control).await, "ControlLegAttached");
    send_json(
        frames,
        json!({
            "type": "AttachFramesLeg",
            "activationId": activation_id,
            "attachGrant": grant,
        }),
    )
    .await;
    let frames_attached = expect_text(next_reply(frames).await, "FramesLegAttached");
    (attached, frames_attached)
}

/// Receive one whole transfer (begin · chunks · end); returns (kind, base, result, bytes).
async fn receive_transfer(frames: &mut Ws) -> (String, Value, Value, Vec<u8>, Vec<Value>) {
    let mut headers = Vec::new();
    // The real engine settles AFTER a seed with ordinary `trf1-frame` deltas (a
    // cursor/prompt frame or two — more of them under ghosttea 0.11.0), and a
    // frames leg may also carry a `calibration` unit; skip those to the transfer.
    let begin = loop {
        match next_reply(frames).await {
            Reply::Unit(h, _) if h["kind"] == "transfer-begin" => break h,
            Reply::Unit(h, _) if h["kind"] == "trf1-frame" || h["kind"] == "calibration" => {
                continue;
            }
            other => panic!("expected transfer-begin, got {other:?}"),
        }
    };
    assert_json_safe_counters(&begin, "transfer-begin");
    let transfer_id = begin["transfer"]["transferId"]
        .as_str()
        .unwrap()
        .to_string();
    let total = begin["transfer"]["totalBytes"].as_u64().unwrap() as usize;
    let chunk_count = begin["transfer"]["chunkCount"].as_u64().unwrap() as usize;
    let checksum = begin["transfer"]["checksum"]["value"].as_u64().unwrap() as u32;
    assert_eq!(begin["transfer"]["checksum"]["alg"], "crc32c");
    assert!(begin["transfer"]["targetLayout"]["cols"].as_u64().unwrap() > 0);
    headers.push(begin.clone());
    let mut bytes = vec![0u8; total];
    for i in 0..chunk_count {
        let (h, p) = match next_reply(frames).await {
            Reply::Unit(h, p) => (h, p),
            other => panic!("expected transfer-chunk {i}, got {other:?}"),
        };
        assert_eq!(h["kind"], "transfer-chunk");
        assert_eq!(h["transfer"]["transferId"], transfer_id);
        assert_eq!(h["transfer"]["chunkIndex"], i as u64);
        assert_json_safe_counters(&h, "transfer-chunk");
        let offset = h["transfer"]["byteOffset"].as_u64().unwrap() as usize;
        bytes[offset..offset + p.len()].copy_from_slice(&p);
        headers.push(h);
    }
    let (end, _) = match next_reply(frames).await {
        Reply::Unit(h, p) => (h, p),
        other => panic!("expected transfer-end, got {other:?}"),
    };
    assert_eq!(end["kind"], "transfer-end");
    assert_eq!(end["transfer"]["transferId"], transfer_id);
    assert_json_safe_counters(&end, "transfer-end");
    headers.push(end.clone());
    assert_eq!(
        crc32c(&bytes),
        checksum,
        "the chunks reassemble to the checksum"
    );
    (
        begin["transfer"]["kind"].as_str().unwrap().to_string(),
        begin["baseContent"].clone(),
        begin["resultContent"].clone(),
        bytes,
        headers,
    )
}

/// Browser readers parse every TP envelope through IEEE-754 JSON numbers.
/// Keep the real Rust presentation path honest: every numeric header field is
/// a non-negative integer that JavaScript can represent exactly.
fn assert_json_safe_counters(value: &Value, path: &str) {
    match value {
        Value::Number(number) => {
            let counter = number
                .as_u64()
                .unwrap_or_else(|| panic!("{path} contains a non-counter JSON number: {number}"));
            assert!(
                counter <= JSON_MAX_SAFE_INTEGER,
                "{path} contains a counter outside JavaScript's exact range: {counter}"
            );
        }
        Value::Array(values) => {
            for (index, value) in values.iter().enumerate() {
                assert_json_safe_counters(value, &format!("{path}[{index}]"));
            }
        }
        Value::Object(fields) => {
            for (key, value) in fields {
                assert_json_safe_counters(value, &format!("{path}.{key}"));
            }
        }
        Value::Null | Value::Bool(_) | Value::String(_) => {}
    }
}

/// Type into the PTY through the AUTOMATION door (fieldd's own path), which
/// needs no attached view of the test's own.
fn type_into(session: &Session, text: &str) {
    let epoch = session.automation_state();
    session
        .automation_input(
            epoch,
            AutomationInputOperation::Text {
                text: text.to_string(),
            },
        )
        .expect("automation input");
}

async fn return_credit(
    frames: &mut Ws,
    epoch: u64,
    seq: u64,
    connection: u64,
    accounts: Vec<(&str, u64)>,
) {
    send_json(
        frames,
        json!({
            "type": "TransportCredit",
            "creditEpoch": epoch,
            "creditSequence": seq,
            "connectionBytesReturned": connection,
            "accounts": accounts.into_iter().map(|(id, b)| json!({"activationId": id, "bytesReturned": b})).collect::<Vec<_>>(),
        }),
    )
    .await;
}

async fn scene_applied(frames: &mut Ws, session_id: &str, activation_id: &str, stamp: &Value) {
    send_json(
        frames,
        json!({
            "type": "SceneApplied",
            "sessionId": session_id,
            "activationId": activation_id,
            "leaseEpoch": 0,
            "appliedContent": stamp,
        }),
    )
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_deck_path_seed_lease_deltas_and_credit() {
    let h = harness().await;
    let session = spawn_session(&h.source);
    let session_id = session.id();
    let (mut control, mut frames, epoch) =
        connect(&h, "set-a", 1, caps(4_000_000, 2_000_000)).await;
    let (attached, frames_attached) = attach_both(
        &h,
        &mut control,
        &mut frames,
        &session_id,
        "act-1",
        &["geometry", "input", "read"],
        true,
    )
    .await;
    assert_eq!(attached["sessionId"], session_id);
    assert_eq!(attached["grantGenerationAccepted"], 1);
    assert_eq!(attached["rights"], json!(["geometry", "input", "read"]));
    let handle = frames_attached["trfIdentity"]["sessionHandle"]
        .as_str()
        .unwrap()
        .to_string();
    assert_eq!(handle, session.summary().handle);
    assert_eq!(frames_attached["trfIdentity"]["viewHandle"], handle);
    assert_eq!(frames_attached["outcome"]["kind"], "seed-required");
    assert!(frames_attached["resumeToken"].as_str().unwrap().len() >= 16);

    // THE SEED: a transfer whose bytes are one FULL TRF1 frame of this session
    let (kind, base, result, bytes, _headers) = receive_transfer(&mut frames).await;
    assert_eq!(kind, "seed");
    assert!(base.is_null(), "a seed carries baseContent = null");
    let trf = Trf1Header::parse(&bytes).expect("a TRF1 frame");
    assert!(trf.full_snapshot);
    assert_eq!(trf.session_handle.to_string(), handle);
    assert_eq!(result["sceneEpoch"]["cellBootId"], CELL);
    assert_eq!(result["sceneRevision"].as_u64().unwrap(), trf.revision);
    // the lease is PENDING until the seed applies: input cannot be allowed yet
    // (nothing is sent before SceneApplied — the cell waits)
    scene_applied(&mut frames, &session_id, "act-1", &result).await;
    let status = expect_text(next_reply(&mut control).await, "CellActivationStatus");
    assert_eq!(status["presentation"]["state"], "presenting");
    assert_eq!(status["input"]["state"], "allowed");
    assert_eq!(status["acceptedContent"], result);
    assert_eq!(status["leaseTtlMs"], 6_000);

    // DELTAS: make the PTY print; ordinary trf1-frame units follow with
    // base = the last sent revision and result = the frame's
    type_into(&session, "echo seed-check-1\n");
    let mut last = result["sceneRevision"].as_u64().unwrap();
    let mut saw_delta = false;
    for _ in 0..20 {
        match next_reply_within(&mut frames, Duration::from_secs(5)).await {
            Reply::Unit(h, p) => {
                assert_eq!(h["kind"], "trf1-frame", "{h}");
                assert_eq!(h["baseContent"]["sceneRevision"].as_u64().unwrap(), last);
                let rev = h["resultContent"]["sceneRevision"].as_u64().unwrap();
                assert!(rev >= last);
                assert_eq!(h["creditEpoch"].as_u64().unwrap(), epoch);
                assert!(Trf1Header::parse(&p).is_some());
                last = rev;
                saw_delta = true;
                if String::from_utf8_lossy(&p).contains("seed-check-1") {
                    break;
                }
            }
            other => panic!("expected a delta unit, got {other:?}"),
        }
    }
    assert!(
        saw_delta,
        "the PTY's output reached the frames leg as deltas"
    );

    // Continuous progress records every revision without a main-thread status
    // for every frame; the bounded periodic refresh keeps the lease alive.
    tokio::time::sleep(Duration::from_millis(2_100)).await;
    // Acknowledge the newest frame DELIVERED, as a worker does: the shell's
    // output line and prompt can follow the echo the loop stopped at, and the
    // cell's lag call is the age of the oldest unit not yet acknowledged (C5),
    // so an ack short of them would leave the lease lagging for good.
    while let Ok(Some(Ok(Message::Binary(unit)))) =
        tokio::time::timeout(Duration::from_millis(300), frames.next()).await
    {
        let (header, _) = decode_envelope(&unit).expect("a presentation envelope");
        if header["kind"] == "trf1-frame" {
            last = last.max(header["resultContent"]["sceneRevision"].as_u64().unwrap());
        }
    }
    let applied = json!({ "sceneEpoch": result["sceneEpoch"], "sceneRevision": last });
    scene_applied(&mut frames, &session_id, "act-1", &applied).await;
    // The intentionally delayed acknowledgement can also produce a transient
    // lagging status. Read through it to the refreshed, current lease.
    loop {
        let status = expect_text(next_reply(&mut control).await, "CellActivationStatus");
        assert!(status["cellStatusSequence"].as_u64().unwrap() >= 2);
        if status["input"]["state"] == "allowed" {
            break;
        }
    }

    let snapshot = h.door.snapshot();
    assert_eq!(snapshot.activations.len(), 1);
    assert_eq!(snapshot.activations[0].0, "act-1");
    assert!(snapshot.activations[0].3.contains("Presenting"));
    h.door.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn credit_gates_the_stream_and_returning_it_resumes_flow() {
    let h = harness().await;
    let session = spawn_session(&h.source);
    let session_id = session.id();
    // A per-activation window that fits the seed with room for a burst of
    // deltas, but NOT the whole flood; the connection window never limits. NO
    // credit is returned until the stall, so what starves is admitted-not-yet-
    // returned bytes — the real invariant.
    let (mut control, mut frames, epoch) = connect(&h, "set-b", 1, caps(8_000_000, 30_000)).await;
    attach_both(
        &h,
        &mut control,
        &mut frames,
        &session_id,
        "act-b",
        &["input", "read"],
        true,
    )
    .await;
    let (kind, _base, result, seed_bytes, _) = receive_transfer(&mut frames).await;
    assert_eq!(kind, "seed");
    scene_applied(&mut frames, &session_id, "act-b", &result).await;
    expect_text(next_reply(&mut control).await, "CellActivationStatus");

    // The engine COALESCES a burst into ~one frame, so a single `seq` cannot
    // starve a window that also fits the seed. Type many DISCRETE lines with a
    // gap between them: each is its own delta the pump sends, and admitted-not-
    // yet-returned bytes climb past the 30 KB window while NO credit is returned.
    let feeder = {
        let session = session.clone();
        tokio::spawn(async move {
            for i in 0..200u32 {
                type_into(&session, &format!("echo {i}-{}\n", "=".repeat(60)));
                tokio::time::sleep(Duration::from_millis(12)).await;
            }
        })
    };

    // Drain WITHOUT returning credit: units arrive, then STOP (starved) while
    // the feeder is still typing — the last idle gap is the witness that credit,
    // not the producer, gates the stream; the activation stays live (starved).
    let mut received = 0usize;
    let mut idle_gap = Duration::ZERO;
    loop {
        match tokio::time::timeout(Duration::from_millis(700), frames.next()).await {
            Ok(Some(Ok(Message::Binary(_)))) => received += 1,
            Ok(Some(Ok(Message::Text(t)))) => panic!("unexpected text on frames: {t}"),
            Err(_) => {
                idle_gap = Duration::from_millis(700);
                break;
            }
            _ => break,
        }
    }
    assert!(
        received > 0,
        "deltas flowed within the window before starving"
    );
    assert!(
        idle_gap >= Duration::from_millis(500),
        "the stream stopped (starved) rather than running to completion"
    );
    assert!(
        h.door.snapshot().activations.iter().any(|a| a.0 == "act-b"),
        "the activation is still live, just starved"
    );
    feeder.abort();

    // return a large cumulative credit: the stream RESUMES (a catch-up transfer
    // repairs the broken lineage, or deltas continue) within the bound
    return_credit(
        &mut frames,
        epoch,
        2,
        20_000_000,
        vec![("act-b", 20_000_000)],
    )
    .await;
    let mut resumed_bytes = 0usize;
    let mut saw_catchup = false;
    for _ in 0..64 {
        match next_reply_within(&mut frames, Duration::from_secs(6)).await {
            Reply::Unit(header, payload) => {
                resumed_bytes += payload.len();
                if header["kind"] == "transfer-begin" {
                    assert_eq!(
                        header["transfer"]["kind"], "catchup",
                        "a repair is a catch-up"
                    );
                    assert!(!header["baseContent"].is_null());
                    saw_catchup = true;
                }
                if header["kind"] == "trf1-frame" || header["kind"] == "transfer-end" {
                    break;
                }
            }
            other => panic!("expected the stream to resume, got {other:?}"),
        }
    }
    assert!(resumed_bytes > 0, "returning credit resumed the stream");
    // the coalesced repair carries the NEW state, never a re-send of the seed
    let _ = (seed_bytes, saw_catchup);
    h.door.shutdown().await;
}

/// The next `CellActivationStatus` on `control` that `pred` accepts, reading
/// through the lease's other traffic (lagging flips, refreshes).
async fn status_until(control: &mut Ws, what: &str, mut pred: impl FnMut(&Value) -> bool) -> Value {
    for _ in 0..64 {
        match next_reply_within(control, Duration::from_secs(10)).await {
            Reply::Text(v) if v["type"] == "CellActivationStatus" => {
                if pred(&v) {
                    return v;
                }
            }
            Reply::Text(_) => continue,
            other => panic!("{what}: expected a status, got {other:?}"),
        }
    }
    panic!("{what}: not among the next 64 control messages");
}

/// C3 — a credit stall that outlives the convergence bound: the lease says
/// `stopped{overload}` (input suspended with it), and the credit returning
/// RECOVERS it — one catch-up transfer, the worker's ack, and the lease
/// `presenting` with input allowed.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_overload_stop_recovers_when_the_credit_returns() {
    let h = harness_cfg(|config| config.catchup_bound = Duration::from_millis(400)).await;
    let session = spawn_session(&h.source);
    let session_id = session.id();
    // credit_gates' window: the seed fits with room for a burst, never the flood
    let (mut control, mut frames, epoch) = connect(&h, "set-ov", 1, caps(8_000_000, 30_000)).await;
    attach_both(
        &h,
        &mut control,
        &mut frames,
        &session_id,
        "act-ov",
        &["input", "read"],
        true,
    )
    .await;
    let (kind, _base, result, _bytes, _headers) = receive_transfer(&mut frames).await;
    assert_eq!(kind, "seed");
    scene_applied(&mut frames, &session_id, "act-ov", &result).await;
    status_until(&mut control, "presenting after the seed", |s| {
        s["presentation"]["state"] == "presenting"
    })
    .await;

    // Discrete lines, NO credit returned: the deltas fill the account, the
    // lineage breaks, and the repair waits on bulk credit past the bound.
    let feeder = {
        let session = session.clone();
        tokio::spawn(async move {
            for i in 0..200u32 {
                type_into(&session, &format!("echo {i}-{}\n", "=".repeat(60)));
                tokio::time::sleep(Duration::from_millis(12)).await;
            }
        })
    };
    let stopped = status_until(&mut control, "the overload stop", |s| {
        s["presentation"]["state"] == "stopped"
    })
    .await;
    assert_eq!(stopped["presentation"]["reason"], "overload");
    assert_eq!(stopped["input"]["state"], "suspended");
    feeder.abort();
    assert!(
        h.door
            .snapshot()
            .activations
            .iter()
            .any(|a| a.0 == "act-ov"),
        "an overload stop never ends the activation"
    );

    // The credit returns: ONE catch-up repairs the lineage, the worker applies
    // it, and the lease is presenting again — said, not inferred.
    return_credit(
        &mut frames,
        epoch,
        1,
        20_000_000,
        vec![("act-ov", 20_000_000)],
    )
    .await;
    let (kind, base, repaired, _bytes, _headers) = receive_transfer(&mut frames).await;
    assert_eq!(
        kind, "catchup",
        "the recovery is a catch-up, never a reseed"
    );
    assert!(!base.is_null());
    scene_applied(&mut frames, &session_id, "act-ov", &repaired).await;
    let recovered = status_until(&mut control, "presenting after the recovery", |s| {
        s["presentation"]["state"] == "presenting"
    })
    .await;
    assert_eq!(recovered["input"]["state"], "allowed");
    h.door.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn read_only_never_input_allowed_demand_none_detaches_and_frames_loss_revokes() {
    let h = harness().await;
    let session = spawn_session(&h.source);
    let session_id = session.id();
    let (mut control, mut frames, _epoch) =
        connect(&h, "set-c", 1, caps(4_000_000, 2_000_000)).await;
    let (attached, _) = attach_both(
        &h,
        &mut control,
        &mut frames,
        &session_id,
        "act-c",
        &["read"],
        true,
    )
    .await;
    assert_eq!(attached["rights"], json!(["read"]));
    let (kind, _, result, _, _) = receive_transfer(&mut frames).await;
    assert_eq!(kind, "seed");
    scene_applied(&mut frames, &session_id, "act-c", &result).await;
    let status = expect_text(next_reply(&mut control).await, "CellActivationStatus");
    assert_eq!(status["presentation"]["state"], "presenting");
    assert_eq!(status["input"]["state"], "revoked");
    assert_eq!(status["input"]["reason"], "not-granted");

    // demand none: the view detaches (the engine stops rendering for it)
    assert!(session.has_active_views());
    send_json(
        &mut control,
        json!({"type":"DeclareDemand","sessionId":session_id,"activationId":"act-c","leaseEpoch":0,"demandSequence":1,"demand":{"mode":"none"}}),
    )
    .await;
    let accepted = expect_text(next_reply(&mut control).await, "DemandAccepted");
    assert_eq!(accepted["demandSequence"], 1);
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(
        !session.has_active_views(),
        "demand none released the view (warm)"
    );
    // live again: re-attached, and the lineage is repaired with a catch-up
    send_json(
        &mut control,
        json!({"type":"DeclareDemand","sessionId":session_id,"activationId":"act-c","leaseEpoch":0,"demandSequence":2,"demand":{"mode":"live"}}),
    )
    .await;
    expect_text(next_reply(&mut control).await, "DemandAccepted");
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(
        session.has_active_views(),
        "demand live re-attached the view (hot)"
    );
    let (kind, base, _, _, _) = receive_transfer(&mut frames).await;
    assert_eq!(kind, "catchup");
    assert!(!base.is_null());

    // the frames leg dies: the control leg learns revoked{leg-dead}; the view goes
    frames.close(None).await.ok();
    let status = expect_text(next_reply(&mut control).await, "CellActivationStatus");
    assert_eq!(status["presentation"]["state"], "revoked");
    assert_eq!(status["presentation"]["reason"], "leg-dead");
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(!session.has_active_views());
    assert!(h.door.snapshot().activations.is_empty());
    h.door.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn idempotent_attach_conflict_replacement_and_unknown_session() {
    let h = harness().await;
    let session = spawn_session(&h.source);
    let session_id = session.id();
    let (mut control, mut frames, _) = connect(&h, "set-d", 1, caps(4_000_000, 2_000_000)).await;
    let grant = h.attach_grant(&session_id, 1, &["input", "read"]);
    let attach = |id: &str, replaces: Option<&str>| {
        let mut m = json!({
            "type": "AttachControlLeg",
            "activationId": id,
            "attachGrant": grant,
            "initialDemand": { "mode": "none" },
        });
        if let Some(r) = replaces {
            m["replacesActivationId"] = json!(r);
        }
        m
    };
    send_json(&mut control, attach("act-d1", None)).await;
    expect_text(next_reply(&mut control).await, "ControlLegAttached");
    // idempotent
    send_json(&mut control, attach("act-d1", None)).await;
    expect_text(next_reply(&mut control).await, "ControlLegAttached");
    // a second id without replaces
    send_json(&mut control, attach("act-d2", None)).await;
    let refused = expect_text(next_reply(&mut control).await, "AttachRefused");
    assert_eq!(refused["code"], "ACTIVATION_CONFLICT");
    assert_eq!(refused["retryable"], true);
    // naming what it replaces: the old activation is revoked{replaced}
    send_json(&mut control, attach("act-d2", Some("act-d1"))).await;
    let status = expect_text(next_reply(&mut control).await, "CellActivationStatus");
    assert_eq!(status["activationId"], "act-d1");
    assert_eq!(status["presentation"]["reason"], "replaced");
    let attached = expect_text(next_reply(&mut control).await, "ControlLegAttached");
    assert_eq!(attached["activationId"], "act-d2");
    // an unknown session
    let ghost = h.attach_grant("no-such-session", 1, &["read"]);
    send_json(
        &mut control,
        json!({"type":"AttachControlLeg","activationId":"act-d3","attachGrant":ghost,"initialDemand":{"mode":"none"}}),
    )
    .await;
    let refused = expect_text(next_reply(&mut control).await, "AttachRefused");
    assert_eq!(refused["code"], "SESSION_UNKNOWN");
    // a frames attach for an activation the control leg never attached
    send_json(
        &mut frames,
        json!({"type":"AttachFramesLeg","activationId":"act-never","attachGrant":grant}),
    )
    .await;
    let refused = expect_text(next_reply(&mut frames).await, "AttachRefused");
    assert_eq!(refused["code"], "ACTIVATION_CONFLICT");
    // a calibration ping echoes as a calibration unit (and keeps the leg alive)
    send_json(
        &mut frames,
        json!({"type":"CalibrationPing","sequence":9,"t0":123.5}),
    )
    .await;
    match next_reply(&mut frames).await {
        Reply::Unit(h, _) => {
            assert_eq!(h["kind"], "calibration");
            assert_eq!(h["calibration"]["sequence"], 9);
            assert_eq!(h["calibration"]["t0"], 123.5);
            assert!(h["calibration"]["t1"].as_f64().unwrap() > 0.0);
        }
        other => panic!("expected a calibration unit, got {other:?}"),
    }
    h.door.shutdown().await;
}

/// TP-S3c — the minimal geometry seat over ghosttea's `claim_control_checked` /
/// `resize_view_checked`, proven against a REAL session: a claim resizes the PTY,
/// a re-claim of the OWN seat resizes it again keeping the holder generation, and
/// a stale revision is refused without touching the size.
#[tokio::test]
async fn geometry_claim_resizes_the_real_pty_and_reclaim_holds_the_generation() {
    let h = harness().await;
    let session = spawn_session(&h.source);
    let session_id = session.id();
    let (mut control, mut frames, _epoch) =
        connect(&h, "set-g", 1, caps(4_000_000, 2_000_000)).await;
    attach_both(
        &h,
        &mut control,
        &mut frames,
        &session_id,
        "act-g",
        &["geometry", "input", "read"],
        true,
    )
    .await;
    // reach a stable presenting lease (seed → applied → status), like the deck.
    let (_kind, _base, result, _bytes, _hdrs) = receive_transfer(&mut frames).await;
    scene_applied(&mut frames, &session_id, "act-g", &result).await;
    expect_text(next_reply(&mut control).await, "CellActivationStatus");

    // the PTY is 80x24 as spawned.
    let (_ctl, cols0, rows0, _le) = session.control_state();
    assert_eq!((cols0, rows0), (80, 24));

    // CLAIM the empty seat at a new size → GeometryCommitted, and the real PTY
    // resizes (ghosttea's `claim_control_checked` committed it).
    send_json(
        &mut control,
        json!({
            "type": "ClaimGeometry",
            "sessionId": session_id, "activationId": "act-g", "leaseEpoch": 0,
            "claimant": { "clientId": "win:1#1", "viewId": "mount-1" },
            "cols": 100, "rows": 40, "expectRevision": 0,
        }),
    )
    .await;
    let committed = expect_text(next_reply(&mut control).await, "GeometryCommitted");
    assert_eq!(committed["holder"]["clientId"], "win:1#1");
    assert_eq!(committed["holder"]["viewId"], "mount-1");
    assert_eq!(committed["holder"]["holderGeneration"], 1);
    assert_eq!(committed["geometryRevision"], 1);
    assert_eq!(committed["cols"], 100);
    assert_eq!(committed["rows"], 40);
    let (_ctl, cols1, rows1, _le) = session.control_state();
    assert_eq!((cols1, rows1), (100, 40), "the engine committed the resize");

    // RE-claim the OWN seat (a resize) → the holder GENERATION is stable, the
    // revision advances, and the PTY resizes again (via `resize_view_checked`).
    send_json(
        &mut control,
        json!({
            "type": "ClaimGeometry",
            "sessionId": session_id, "activationId": "act-g", "leaseEpoch": 0,
            "claimant": { "clientId": "win:1#1", "viewId": "mount-1" },
            "cols": 132, "rows": 50, "expectRevision": 1,
        }),
    )
    .await;
    let resized = expect_text(next_reply(&mut control).await, "GeometryCommitted");
    assert_eq!(
        resized["holder"]["holderGeneration"], 1,
        "a resize keeps the holder generation"
    );
    assert_eq!(resized["geometryRevision"], 2);
    let (_ctl, cols2, rows2, _le) = session.control_state();
    assert_eq!((cols2, rows2), (132, 50));

    // a STALE revision is refused and never touches the size.
    send_json(
        &mut control,
        json!({
            "type": "ClaimGeometry",
            "sessionId": session_id, "activationId": "act-g", "leaseEpoch": 0,
            "claimant": { "clientId": "win:1#1", "viewId": "mount-1" },
            "cols": 10, "rows": 10, "expectRevision": 0,
        }),
    )
    .await;
    let refused = expect_text(next_reply(&mut control).await, "GeometryRefused");
    assert_eq!(refused["code"], "STALE_REVISION");
    assert_eq!(refused["geometryRevision"], 2);
    let (_ctl, cols3, rows3, _le) = session.control_state();
    assert_eq!((cols3, rows3), (132, 50), "a refused claim never resizes");

    h.door.shutdown().await;
}

/// DS-4 (DS-D5's note, TPv3 §6 amended 2026-09-30) — THE TAKE over the real door
/// and a REAL PTY: two clients present one session, A holds the seat, and B —
/// the pane the person focused, on another desktop or the phone — transfers
/// the live holder's seat TO ITSELF on its own `geometry` right. One verb, one
/// engine claim, exactly one committed resize (the engine's layout epoch moves
/// by one), the commit answered on B's control leg only; focus back on A takes
/// it back the same way.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_take_moves_a_held_seat_to_the_focused_client_with_one_resize() {
    let h = harness().await;
    let session = spawn_session(&h.source);
    let session_id = session.id();
    let full = ["geometry", "input", "read"];
    let (mut control_a, frames_a) =
        present_as(&h, "win:1#1", "set-ta", &session_id, "act-a", &full).await;
    let (mut control_b, frames_b) =
        present_as(&h, "win:2#1", "set-tb", &session_id, "act-b", &full).await;

    // A claims the empty seat at 100x40.
    send_json(
        &mut control_a,
        json!({
            "type": "ClaimGeometry",
            "sessionId": session_id, "activationId": "act-a", "leaseEpoch": 0,
            "claimant": { "clientId": "win:1#1", "viewId": "mount-a" },
            "cols": 100, "rows": 40, "expectRevision": 0,
        }),
    )
    .await;
    let held = next_geometry(&mut control_a, "GeometryCommitted").await;
    assert_eq!(held["holder"]["holderGeneration"], 1);
    let (_ctl, cols, rows, epoch_held) = session.control_state();
    assert_eq!((cols, rows), (100, 40));

    // B mounts knowing nothing: its claim is refused, and the refusal names the
    // live holder and the revision — all B's runtime needs for a take.
    send_json(
        &mut control_b,
        json!({
            "type": "ClaimGeometry",
            "sessionId": session_id, "activationId": "act-b", "leaseEpoch": 0,
            "claimant": { "clientId": "win:2#1", "viewId": "mount-b" },
            "cols": 90, "rows": 30, "expectRevision": 0,
        }),
    )
    .await;
    let refused = next_geometry(&mut control_b, "GeometryRefused").await;
    assert_eq!(refused["currentHolder"]["clientId"], "win:1#1");
    let from = refused["currentHolder"].clone();
    let revision = refused["geometryRevision"].as_u64().unwrap();
    assert_eq!(
        session.control_state().1,
        100,
        "a refused claim never resizes"
    );

    // B is focused: its host TAKES — a transfer from the live holder to B.
    send_json(
        &mut control_b,
        json!({
            "type": "TransferGeometry",
            "sessionId": session_id, "activationId": "act-b", "leaseEpoch": 0,
            "from": from,
            "to": { "clientId": "win:2#1", "viewId": "mount-b" },
            "expectRevision": revision, "cols": 90, "rows": 30,
        }),
    )
    .await;
    let taken = next_geometry(&mut control_b, "GeometryCommitted").await;
    assert_eq!(taken["holder"]["clientId"], "win:2#1");
    assert_eq!(taken["holder"]["viewId"], "mount-b");
    assert_eq!(taken["holder"]["holderGeneration"], 2);
    assert_eq!(taken["geometryRevision"], revision + 1);
    let (controller, cols, rows, epoch_taken) = session.control_state();
    assert_eq!((cols, rows), (90, 30), "the engine committed B's size");
    assert_eq!(epoch_taken, epoch_held + 1, "exactly ONE committed resize");
    let controller = controller.expect("the engine seats B");
    assert_eq!(controller.client_id, "win:2#1");
    assert_eq!(controller.view_id, "act-b");

    // The displaced holder is TOLD NOTHING on its leg (the commit answers the
    // caller only) — it renders what B sized and learns the seat from a refusal.
    let heard = drain_texts(&mut control_a, Duration::from_millis(400)).await;
    assert!(
        heard
            .iter()
            .all(|m| m["type"] != "GeometryCommitted" && m["type"] != "GeometryRefused"),
        "A's leg carried a geometry verdict it never asked for: {heard:?}"
    );

    // Focus back on A takes it back: one more step, one more resize.
    send_json(
        &mut control_a,
        json!({
            "type": "TransferGeometry",
            "sessionId": session_id, "activationId": "act-a", "leaseEpoch": 0,
            "from": taken["holder"].clone(),
            "to": { "clientId": "win:1#1", "viewId": "mount-a" },
            "expectRevision": taken["geometryRevision"].clone(), "cols": 100, "rows": 40,
        }),
    )
    .await;
    let back = next_geometry(&mut control_a, "GeometryCommitted").await;
    assert_eq!(back["holder"]["clientId"], "win:1#1");
    assert_eq!(back["holder"]["holderGeneration"], 3);
    let (_ctl, cols, rows, epoch_back) = session.control_state();
    assert_eq!((cols, rows), (100, 40));
    assert_eq!(epoch_back, epoch_taken + 1, "exactly ONE committed resize");

    drop((frames_a, frames_b));
    h.door.shutdown().await;
}

/// DS-4 — the take on a read-only grant: refused `NOT_HOLDER` over the real
/// door, nothing echoed, and the PTY never moves.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_take_without_the_geometry_right_is_refused_and_never_resizes() {
    let h = harness().await;
    let session = spawn_session(&h.source);
    let session_id = session.id();
    let (mut control_a, _frames_a) = present_as(
        &h,
        "win:1#1",
        "set-ra",
        &session_id,
        "act-a",
        &["geometry", "input", "read"],
    )
    .await;
    let (mut control_r, _frames_r) =
        present_as(&h, "win:3#1", "set-rr", &session_id, "act-r", &["read"]).await;
    send_json(
        &mut control_a,
        json!({
            "type": "ClaimGeometry",
            "sessionId": session_id, "activationId": "act-a", "leaseEpoch": 0,
            "claimant": { "clientId": "win:1#1", "viewId": "mount-a" },
            "cols": 100, "rows": 40, "expectRevision": 0,
        }),
    )
    .await;
    let held = next_geometry(&mut control_a, "GeometryCommitted").await;
    let (_ctl, _c, _r, epoch_held) = session.control_state();

    send_json(
        &mut control_r,
        json!({
            "type": "TransferGeometry",
            "sessionId": session_id, "activationId": "act-r", "leaseEpoch": 0,
            "from": held["holder"].clone(),
            "to": { "clientId": "win:3#1", "viewId": "mount-r" },
            "expectRevision": held["geometryRevision"].clone(), "cols": 80, "rows": 24,
        }),
    )
    .await;
    let refused = next_geometry(&mut control_r, "GeometryRefused").await;
    assert_eq!(refused["code"], "NOT_HOLDER");
    assert!(refused.get("currentHolder").is_none());
    let (controller, cols, rows, epoch_after) = session.control_state();
    assert_eq!((cols, rows), (100, 40));
    assert_eq!(epoch_after, epoch_held);
    assert_eq!(controller.expect("A still seated").client_id, "win:1#1");
    h.door.shutdown().await;
}

/// DS-4d — a `SessionSource` that can hold ONE geometry verb in flight. The
/// door looks the session up inside a geometry verb before it touches the
/// engine, so a lookup held here is a verb in flight at a known point:
/// deterministic where two real sockets racing would be a lottery. Armed for a
/// session, the NEXT lookup of it says `reached` and blocks its caller (a door
/// read task's thread) until `release`; everything else is `DirectSessions`'.
struct HoldingSource {
    inner: Arc<DirectSessions>,
    hold: Mutex<Option<Hold>>,
}

struct Hold {
    session_id: String,
    reached: std::sync::mpsc::Sender<()>,
    release: std::sync::mpsc::Receiver<()>,
}

impl SessionSource for HoldingSource {
    fn session(&self, session_id: &str) -> Option<Arc<Session>> {
        let hold = {
            let mut hold = self.hold.lock().unwrap();
            match hold.as_ref() {
                Some(armed) if armed.session_id == session_id => hold.take(),
                _ => None,
            }
        };
        if let Some(hold) = hold {
            let _ = hold.reached.send(());
            // bounded, so a failing row can never hang the suite
            let _ = hold.release.recv_timeout(Duration::from_secs(30));
        }
        self.inner.session(session_id)
    }

    fn frames(&self, session_id: &str) -> Option<FrameHub> {
        self.inner.frames(session_id)
    }

    fn subscribe_lifecycle(
        &self,
    ) -> Option<tokio::sync::broadcast::Receiver<SessionLifecycleEvent>> {
        self.inner.subscribe_lifecycle()
    }
}

/// The next geometry VERDICT on a control leg — committed or refused — skipping
/// the lease's own status traffic.
async fn next_geometry_verdict(control: &mut Ws) -> Value {
    loop {
        match next_reply(control).await {
            Reply::Text(v) if v["type"] == "CellActivationStatus" => continue,
            Reply::Text(v)
                if v["type"] == "GeometryCommitted" || v["type"] == "GeometryRefused" =>
            {
                return v;
            }
            other => panic!("expected a geometry verdict, got {other:?}"),
        }
    }
}

fn is_geometry_verdict(message: &Value) -> bool {
    message["type"] == "GeometryCommitted" || message["type"] == "GeometryRefused"
}

/// DS-4d (the wave-1 review's DS-4 defect) — TWO TAKES AT ONCE against a live
/// holder, over the real door and a REAL PTY. A holds the seat; B's host and
/// C's host both take it, each built on the same holder and revision, and B's
/// take is in flight when C's arrives. Exactly one commits; the ENGINE's
/// controller is the lease's holder; the loser is refused with the winner and
/// its revision (the announcement its runtime retries on); the winner's next
/// resize commits. The defect this pins: a take's engine claim ran outside any
/// ordering with the lease write (last writer wins), so the engine could keep
/// the LOSER and every resize the holder sent read `VIEW_SUPERSEDED` until a
/// retry or the next focus. The cure is one geometry verb per session at a
/// time, precheck → engine → finalize — so C waits for B.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn two_takes_at_once_leave_the_engine_with_the_lease_holder_and_the_winner_resizes() {
    let sessions = DirectSessions::new();
    let holding = Arc::new(HoldingSource {
        inner: sessions.clone(),
        hold: Mutex::new(None),
    });
    let h = harness_with_door_source(sessions, holding.clone(), |config| {
        // no tick during the race: the tick looks sessions up (its prune), and
        // a hold must catch the take's lookup, nothing else
        config.tick = Duration::from_secs(3_600);
    })
    .await;
    let session = spawn_session(&h.source);
    let session_id = session.id();
    let full = ["geometry", "input", "read"];
    let (mut control_a, frames_a) =
        present_as(&h, "win:1#1", "set-xa", &session_id, "act-a", &full).await;
    let (mut control_b, frames_b) =
        present_as(&h, "win:2#1", "set-xb", &session_id, "act-b", &full).await;
    let (mut control_c, frames_c) =
        present_as(&h, "win:3#1", "set-xc", &session_id, "act-c", &full).await;

    // A holds the seat.
    send_json(
        &mut control_a,
        json!({
            "type": "ClaimGeometry",
            "sessionId": session_id, "activationId": "act-a", "leaseEpoch": 0,
            "claimant": { "clientId": "win:1#1", "viewId": "mount-a" },
            "cols": 100, "rows": 40, "expectRevision": 0,
        }),
    )
    .await;
    let held = next_geometry(&mut control_a, "GeometryCommitted").await;
    let from = held["holder"].clone();
    let revision = held["geometryRevision"].as_u64().unwrap();

    // B's take goes in flight, and is held there.
    let (reached_tx, reached_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    *holding.hold.lock().unwrap() = Some(Hold {
        session_id: session_id.clone(),
        reached: reached_tx,
        release: release_rx,
    });
    send_json(
        &mut control_b,
        json!({
            "type": "TransferGeometry",
            "sessionId": session_id, "activationId": "act-b", "leaseEpoch": 0,
            "from": from,
            "to": { "clientId": "win:2#1", "viewId": "mount-b" },
            "expectRevision": revision, "cols": 90, "rows": 30,
        }),
    )
    .await;
    tokio::task::spawn_blocking(move || reached_rx.recv_timeout(Duration::from_secs(10)))
        .await
        .unwrap()
        .expect("B's take reached the door's engine half");

    // C's take arrives while B's is in flight — built on the SAME holder and
    // revision (C focused just after B; neither has heard of the other).
    send_json(
        &mut control_c,
        json!({
            "type": "TransferGeometry",
            "sessionId": session_id, "activationId": "act-c", "leaseEpoch": 0,
            "from": from,
            "to": { "clientId": "win:3#1", "viewId": "mount-c" },
            "expectRevision": revision, "cols": 120, "rows": 50,
        }),
    )
    .await;
    let while_b_in_flight = drain_texts(&mut control_c, Duration::from_millis(600)).await;
    release_tx.send(()).unwrap();
    let verdict_b = next_geometry_verdict(&mut control_b).await;
    let verdict_c = match while_b_in_flight.iter().find(|m| is_geometry_verdict(m)) {
        Some(early) => early.clone(),
        None => next_geometry_verdict(&mut control_c).await,
    };

    // Exactly ONE take commits…
    let takes = [
        (&verdict_b, "win:2#1", "act-b", "mount-b"),
        (&verdict_c, "win:3#1", "act-c", "mount-c"),
    ];
    let committed: Vec<_> = takes
        .iter()
        .filter(|(verdict, ..)| verdict["type"] == "GeometryCommitted")
        .collect();
    assert_eq!(
        committed.len(),
        1,
        "exactly one take commits — B: {verdict_b}, C: {verdict_c}"
    );
    let (winner, winner_client, winner_activation, winner_view) = *committed[0];
    let loser = takes
        .iter()
        .find(|(verdict, ..)| verdict["type"] != "GeometryCommitted")
        .expect("the other take")
        .0;
    // …and the loser is told the seat as it now is: the winner and its revision.
    assert_eq!(loser["type"], "GeometryRefused", "{loser}");
    assert_eq!(loser["currentHolder"], winner["holder"], "{loser}");
    assert_eq!(
        loser["geometryRevision"], winner["geometryRevision"],
        "{loser}"
    );

    // THE ENGINE's controller is the lease's holder.
    let (controller, cols, rows, _layout) = session.control_state();
    let controller = controller.expect("the engine seats a controller");
    assert_eq!(
        (controller.client_id.as_str(), controller.view_id.as_str()),
        (winner_client, winner_activation),
        "the engine's controller is the lease's holder ({winner})"
    );
    assert_eq!(
        (u64::from(cols), u64::from(rows)),
        (
            winner["cols"].as_u64().unwrap(),
            winner["rows"].as_u64().unwrap()
        ),
        "the PTY is the winner's size"
    );

    // The winner's next resize commits — never VIEW_SUPERSEDED.
    let winner_control = if winner_client == "win:2#1" {
        &mut control_b
    } else {
        &mut control_c
    };
    send_json(
        winner_control,
        json!({
            "type": "ClaimGeometry",
            "sessionId": session_id, "activationId": winner_activation, "leaseEpoch": 0,
            "claimant": { "clientId": winner_client, "viewId": winner_view },
            "cols": 132, "rows": 50,
            "expectRevision": winner["geometryRevision"].clone(),
        }),
    )
    .await;
    let resized = next_geometry_verdict(winner_control).await;
    assert_eq!(
        resized["type"], "GeometryCommitted",
        "the holder resizes: {resized}"
    );
    assert_eq!(
        resized["holder"]["holderGeneration"],
        winner["holder"]["holderGeneration"]
    );
    let (_controller, cols, rows, _layout) = session.control_state();
    assert_eq!((cols, rows), (132, 50));

    // C waited for B: one geometry verb per session at a time, so nothing
    // answered C while B's take was in flight.
    assert!(
        while_b_in_flight.iter().all(|m| !is_geometry_verdict(m)),
        "C's take was answered while B's was in flight: {while_b_in_flight:?}"
    );

    drop((frames_a, frames_b, frames_c));
    h.door.shutdown().await;
}

/// One client's legs, attached live and PRESENTING (seed → applied → status),
/// the deck's path for a client other than the harness's default `win:1#1`.
/// The stock hello negotiates nothing, so the control leg hears only the lease
/// while it attaches — held, as it always was, to exactly that.
async fn present_as(
    h: &Harness,
    client: &str,
    set: &str,
    session_id: &str,
    activation_id: &str,
    rights: &[&str],
) -> (Ws, Ws) {
    let presence = Presence {
        client,
        set,
        activation_id,
        rights,
        capabilities: json!(["resume", "something-unknown"]),
        face: None,
    };
    let (control, frames, heard) = present(h, session_id, presence).await;
    assert!(
        heard.iter().all(|m| m["type"] == "CellActivationStatus"),
        "a stock leg hears only the lease while it attaches: {heard:?}"
    );
    (control, frames)
}

/// Who presents — `present_as`'s client, set, activation and rights, plus item
/// 42's two knobs: the control hello's capability advertisement and the attach
/// grant's `face` claim (signed with the rest, as fieldd mints it).
struct Presence<'a> {
    client: &'a str,
    set: &'a str,
    activation_id: &'a str,
    rights: &'a [&'a str],
    capabilities: Value,
    face: Option<Value>,
}

/// `present_as` for any `Presence`. Returns the legs and every control-leg
/// text heard after the attach's `ControlLegAttached`, in order, through the
/// presenting status — an attach's own `GeometryState` (item 42) lands first.
async fn present(h: &Harness, session_id: &str, who: Presence<'_>) -> (Ws, Ws, Vec<Value>) {
    let Presence {
        client,
        set,
        activation_id,
        rights,
        capabilities,
        face,
    } = who;
    let grant = h.minter.transport(TransportSpec {
        client_id: client,
        connection_set_id: set,
        channels: &["control", "frames"],
        generation: 1,
        nonce: set,
        issued_at: None,
        expires_at: None,
        audience: None,
    });
    let mut control = dial(&h.door.control_url()).await;
    send_json(
        &mut control,
        serde_json::from_str(&hello_with_capabilities(
            "control",
            &grant,
            None,
            capabilities,
        ))
        .unwrap(),
    )
    .await;
    expect_text(next_reply(&mut control).await, "ConnectionAccepted");
    let mut frames = dial(&h.door.frames_url()).await;
    send_json(
        &mut frames,
        serde_json::from_str(&hello("frames", &grant, Some(caps(4_000_000, 2_000_000)))).unwrap(),
    )
    .await;
    expect_text(next_reply(&mut frames).await, "ConnectionAccepted");

    let now = field_native::tp::unix_ms();
    let mut claims = json!({
        "audienceCellBootId": h.minter.cell_boot_id,
        "clientId": client,
        "sessionId": session_id,
        "routeRevision": 3,
        "grantGeneration": 1,
        "rights": rights,
        "issuedAt": now - 1_000,
        "expiresAt": now + 600_000 - 1_000,
    });
    if let Some(face) = face {
        claims["face"] = face;
    }
    let protected = json!({
        "v": 1, "typ": "SessionAttachGrant", "iss": "fieldd", "alg": "HS256",
        "kid": { "cellBootId": h.minter.cell_boot_id, "keyGeneration": 1 },
    });
    let mac = h.minter.sign(&protected, &claims);
    let attach = json!({ "protected": protected, "claims": claims, "mac": mac });
    send_json(
        &mut control,
        json!({
            "type": "AttachControlLeg",
            "activationId": activation_id,
            "attachGrant": attach,
            "initialDemand": { "mode": "live" },
        }),
    )
    .await;
    expect_text(next_reply(&mut control).await, "ControlLegAttached");
    send_json(
        &mut frames,
        json!({ "type": "AttachFramesLeg", "activationId": activation_id, "attachGrant": attach }),
    )
    .await;
    expect_text(next_reply(&mut frames).await, "FramesLegAttached");
    let (_kind, _base, result, _bytes, _hdrs) = receive_transfer(&mut frames).await;
    scene_applied(&mut frames, session_id, activation_id, &result).await;
    let mut heard = Vec::new();
    loop {
        let message = match next_reply(&mut control).await {
            Reply::Text(v) => v,
            other => panic!("expected a control-leg text, got {other:?}"),
        };
        let presenting = message["type"] == "CellActivationStatus"
            && message["presentation"]["state"] == "presenting";
        heard.push(message);
        if presenting {
            break;
        }
    }
    (control, frames, heard)
}

/// The next geometry verdict on a control leg, skipping the lease's own
/// status traffic (a resize can move another activation's presentation).
async fn next_geometry(control: &mut Ws, type_: &str) -> Value {
    loop {
        match next_reply(control).await {
            Reply::Text(v) if v["type"] == "CellActivationStatus" => continue,
            reply => return expect_text(reply, type_),
        }
    }
}

/// Every text message a leg carries within `within`, without failing on quiet.
async fn drain_texts(ws: &mut Ws, within: Duration) -> Vec<Value> {
    let mut texts = Vec::new();
    let deadline = tokio::time::Instant::now() + within;
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        if let Message::Text(t) = message {
            texts.push(serde_json::from_str(t.as_str()).expect("JSON"));
        }
    }
    texts
}

/// TP-S3c — the frames-leg attach reports the HONEST seed reason: a resume whose
/// `from` names a different `SceneEpoch` is a migration (`epoch-changed`); a
/// same-epoch resume is viable but the dormant-cursor resume is capability-gated
/// (`no-resume-capability`); no resume is `no-cursor`.
#[tokio::test]
async fn frames_attach_reports_the_seed_reason_incl_epoch_changed() {
    let h = harness().await;
    let session = spawn_session(&h.source);
    let session_id = session.id();
    let _engine_epoch = session.session_epoch();
    // This fresh cell's first observed engine lineage is allocated protocol
    // generation 1, independent of the UUID-derived 64-bit engine token.
    let model_generation = 1;
    let (mut control, mut frames, _e) = connect(&h, "set-m", 1, caps(4_000_000, 2_000_000)).await;

    // ONE activation (demand `none`, so no pump/seed muddies the leg); the seed
    // REASON is recomputed on every frames attach, so re-attaching the leg with a
    // different resume shape exercises all three answers on the one activation.
    let grant = h.attach_grant(&session_id, 1, &["input", "read"]);
    send_json(
        &mut control,
        json!({
            "type": "AttachControlLeg",
            "activationId": "act-m",
            "attachGrant": grant,
            "initialDemand": { "mode": "none" },
        }),
    )
    .await;
    expect_text(next_reply(&mut control).await, "ControlLegAttached");

    async fn attach_frames_resume(
        h: &Harness,
        frames: &mut Ws,
        session_id: &str,
        resume: Option<Value>,
    ) -> Value {
        let grant = h.attach_grant(session_id, 1, &["input", "read"]);
        let mut msg = json!({
            "type": "AttachFramesLeg",
            "activationId": "act-m",
            "attachGrant": grant,
        });
        if let Some(resume) = resume {
            msg["resume"] = resume;
        }
        send_json(frames, msg).await;
        expect_text(next_reply(frames).await, "FramesLegAttached")
    }

    // (a) a resume naming a DIFFERENT epoch → epoch-changed (the migration case).
    let a = attach_frames_resume(
        &h,
        &mut frames,
        &session_id,
        Some(json!({
            "resumeToken": "tok",
            "from": { "sceneEpoch": { "cellBootId": CELL, "modelGeneration": model_generation + 1000 }, "sceneRevision": 1 },
        })),
    )
    .await;
    assert_eq!(a["outcome"]["kind"], "seed-required");
    assert_eq!(a["outcome"]["reason"], "epoch-changed");

    // (b) a resume at the SAME epoch → viable, but capability-gated.
    let b = attach_frames_resume(
        &h,
        &mut frames,
        &session_id,
        Some(json!({
            "resumeToken": "tok",
            "from": { "sceneEpoch": { "cellBootId": CELL, "modelGeneration": model_generation }, "sceneRevision": 1 },
        })),
    )
    .await;
    assert_eq!(b["outcome"]["reason"], "no-resume-capability");

    // (c) no resume → no-cursor.
    let c = attach_frames_resume(&h, &mut frames, &session_id, None).await;
    assert_eq!(c["outcome"]["reason"], "no-cursor");

    h.door.shutdown().await;
}

/// TP-S3d — §8 "every presentation unit is capped: anything larger than
/// `maxUrgentPresentationUnitBytes` becomes a transfer". With the cap set just
/// above the TRF1 header, every incremental trips it, so a change must arrive as
/// a (bulk) CATCH-UP transfer — never a bare oversized `trf1-frame`.
#[tokio::test]
async fn an_oversized_delta_is_carried_by_a_catchup_transfer() {
    let h = harness_cfg(|c| {
        c.protocol_limits.max_urgent_presentation_unit_bytes = 64;
    })
    .await;
    let session = spawn_session(&h.source);
    let session_id = session.id();
    let (mut control, mut frames, _e) = connect(&h, "set-o", 1, caps(4_000_000, 2_000_000)).await;
    attach_both(
        &h,
        &mut control,
        &mut frames,
        &session_id,
        "act-o",
        &["input", "read"],
        true,
    )
    .await;
    let (kind, _b, seed_stamp, _by, _hd) = receive_transfer(&mut frames).await;
    assert_eq!(kind, "seed");
    scene_applied(&mut frames, &session_id, "act-o", &seed_stamp).await;
    expect_text(next_reply(&mut control).await, "CellActivationStatus");

    // A change: the pump drops the oversized incremental (Ok(false) → needs_full)
    // and repairs the lineage with a catch-up transfer, chunked and on the bulk
    // lane — the very path §8 mandates for anything over the urgent-unit cap.
    type_into(&session, "echo s3d\n");
    let (kind2, _b2, _s2, _by2, _hd2) = receive_transfer(&mut frames).await;
    assert_eq!(
        kind2, "catchup",
        "an oversized change becomes a catch-up transfer, not one urgent frame"
    );

    h.door.shutdown().await;
}

/// TP-S3-input — the input verb, end to end against a REAL /bin/sh: a wire
/// `SendInput{text}` reaches the PTY ("exit\n" terminates the shell — the round
/// trip no header inspection can fake); acceptance is witnessed by ghosttea's
/// human-input epoch (`record_input(true)` advances it; every refusal and the
/// dedup return first), so a replayed `inputSequence`, a stale `leaseEpoch` and
/// a read-only viewer all leave the epoch UNMOVED — and no reply rides the wire
/// either way (§5.4: drop-and-audit).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn wire_input_types_into_the_real_pty_and_every_fence_holds() {
    let h = harness().await;
    let session = spawn_session(&h.source);
    let session_id = session.id();
    let (mut control, mut frames, _epoch) =
        connect(&h, "set-in", 1, caps(4_000_000, 2_000_000)).await;
    let (attached, _) = attach_both(
        &h,
        &mut control,
        &mut frames,
        &session_id,
        "act-in",
        &["input", "read"],
        true,
    )
    .await;
    assert_eq!(attached["rights"], json!(["input", "read"]));
    let (kind, _b, result, _by, _hd) = receive_transfer(&mut frames).await;
    assert_eq!(kind, "seed");
    scene_applied(&mut frames, &session_id, "act-in", &result).await;
    let status = expect_text(next_reply(&mut control).await, "CellActivationStatus");
    assert_eq!(status["presentation"]["state"], "presenting");
    assert_eq!(status["input"]["state"], "allowed");

    let send_input = |session_id: &str, activation: &str, lease: u64, seq: u64, op: Value| {
        json!({
            "type": "SendInput",
            "sessionId": session_id,
            "activationId": activation,
            "leaseEpoch": lease,
            "inputSequence": seq,
            "op": op,
        })
    };
    async fn epoch_settles(session: &Session, expect: u64, what: &str) {
        for _ in 0..150 {
            if session.automation_state() == expect {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!(
            "timeout: {what} (epoch {} != {expect})",
            session.automation_state()
        );
    }

    // 1. a keystroke reaches the engine: the human-input epoch advances by one
    let epoch0 = session.automation_state();
    send_json(
        &mut control,
        send_input(
            &session_id,
            "act-in",
            0,
            1,
            json!({"kind":"text","text":"true\n"}),
        ),
    )
    .await;
    epoch_settles(&session, epoch0 + 1, "accepted input records").await;

    // 2. the SAME inputSequence replayed: ghosttea's monotonic dedup authorizes
    //    it ONCE — the epoch does not move again
    send_json(
        &mut control,
        send_input(
            &session_id,
            "act-in",
            0,
            1,
            json!({"kind":"text","text":"REPLAY\n"}),
        ),
    )
    .await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(session.automation_state(), epoch0 + 1, "replay was deduped");

    // 3. a stale leaseEpoch is dropped at the CELL gate (placement fence)
    send_json(
        &mut control,
        send_input(
            &session_id,
            "act-in",
            7,
            2,
            json!({"kind":"text","text":"STALE\n"}),
        ),
    )
    .await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(
        session.automation_state(),
        epoch0 + 1,
        "stale lease dropped"
    );

    // 4. a read-only viewer on a SECOND session (same socket pair — §5.1) is
    //    refused by the lease: its epoch never moves
    let session_b = spawn_session(&h.source);
    let session_b_id = session_b.id();
    // hand-rolled attach: act-in's echo deltas (the typed `true`) are in flight
    // on the SAME legs, so tolerate interleaved units/statuses while attaching
    let grant_b = h.attach_grant(&session_b_id, 1, &["read"]);
    send_json(
        &mut control,
        json!({
            "type": "AttachControlLeg",
            "activationId": "act-ro",
            "attachGrant": grant_b,
            "initialDemand": { "mode": "live" },
        }),
    )
    .await;
    let attached_b = loop {
        match next_reply(&mut control).await {
            Reply::Text(v) if v["type"] == "ControlLegAttached" => break v,
            Reply::Text(v) if v["type"] == "CellActivationStatus" => continue,
            other => panic!("expected ControlLegAttached, got {other:?}"),
        }
    };
    assert_eq!(attached_b["rights"], json!(["read"]));
    send_json(
        &mut frames,
        json!({
            "type": "AttachFramesLeg",
            "activationId": "act-ro",
            "attachGrant": grant_b,
        }),
    )
    .await;
    loop {
        match next_reply(&mut frames).await {
            Reply::Text(v) if v["type"] == "FramesLegAttached" => break,
            Reply::Unit(_, _) => continue,
            other => panic!("expected FramesLegAttached, got {other:?}"),
        }
    }
    let (kind_b, _bb, result_b, _byb, _hdb) = receive_transfer(&mut frames).await;
    assert_eq!(kind_b, "seed");
    scene_applied(&mut frames, &session_b_id, "act-ro", &result_b).await;
    let status_b = loop {
        let v = expect_text(next_reply(&mut control).await, "CellActivationStatus");
        if v["activationId"] == "act-ro" {
            break v;
        }
    };
    assert_eq!(status_b["input"]["state"], "revoked");
    assert_eq!(status_b["input"]["reason"], "not-granted");
    let epoch_b = session_b.automation_state();
    send_json(
        &mut control,
        send_input(
            &session_b_id,
            "act-ro",
            0,
            1,
            json!({"kind":"text","text":"NOPE\n"}),
        ),
    )
    .await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(
        session_b.automation_state(),
        epoch_b,
        "read-only was dropped"
    );

    // 5. the PTY round trip: "exit" terminates the REAL shell
    assert!(!session.summary().exited);
    send_json(
        &mut control,
        send_input(
            &session_id,
            "act-in",
            0,
            3,
            json!({"kind":"text","text":"exit\n"}),
        ),
    )
    .await;
    for _ in 0..250 {
        if session.summary().exited {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(
        session.summary().exited,
        "the typed `exit` reached the real PTY and ended /bin/sh"
    );
    h.door.shutdown().await;
}

// ---------------------------------------------------------------------------
// TP-S3f / G24 — the lifecycle verb. The harness IS the engine here: it
// publishes onto the same bounded bus `ServiceSessions` exposes in production,
// and the door's ONE subscription fans the wire verb out to negotiated legs.

/// Open a control leg whose hello advertises `capabilities`; returns the leg
/// and the accept's echoed intersection.
async fn connect_control(h: &Harness, set: &str, capabilities: Value) -> (Ws, Value) {
    let grant = h
        .minter
        .transport(TransportSpec::basic(set, 1, &format!("n-{set}-se")));
    let mut control = dial(&h.door.control_url()).await;
    send_json(
        &mut control,
        serde_json::from_str(&hello_with_capabilities(
            "control",
            &grant,
            None,
            capabilities,
        ))
        .unwrap(),
    )
    .await;
    let accepted = expect_text(next_reply(&mut control).await, "ConnectionAccepted");
    let echoed = accepted["capabilities"].clone();
    (control, echoed)
}

#[tokio::test]
async fn session_events_reach_a_negotiated_leg_with_every_exit_fact_and_births_stay_quiet() {
    let h = harness().await;
    let (mut control, echoed) =
        connect_control(&h, "set-se-1", json!(["resume", "session-events"])).await;
    assert_eq!(echoed, json!(["session-events"]), "the TP-D25 intersection");

    // A birth on the bus is deliberately NOT an event — clients learn births
    // from the roster read they already do. The exit that follows must be the
    // FIRST thing this leg hears, with every exit fact intact, then the
    // removal, in the bus's order.
    let session = spawn_session(&h.source);
    h.source.publish_lifecycle(SessionLifecycleEvent::Created {
        session: session.clone(),
    });
    h.source.publish_lifecycle(SessionLifecycleEvent::Exited {
        session_id: "sess-ev-1".into(),
        exit: SessionExit {
            exit_code: None,
            exit_signal: Some("SIGHUP".into()),
            requested_termination: Some(TerminationSource::User),
            exit_outcome: ExitOutcome::UserTerminated,
        },
    });
    h.source.publish_lifecycle(SessionLifecycleEvent::Removed {
        session_id: "sess-ev-1".into(),
    });

    let exited = expect_text(next_reply(&mut control).await, "SessionEvent");
    assert_eq!(
        exited["event"],
        json!({
            "kind": "exited",
            "sessionId": "sess-ev-1",
            "exitCode": null,
            "exitSignal": "SIGHUP",
            "requestedTermination": "user",
            "exitOutcome": "user-terminated",
        })
    );
    let removed = expect_text(next_reply(&mut control).await, "SessionEvent");
    assert_eq!(
        removed["event"],
        json!({ "kind": "removed", "sessionId": "sess-ev-1" })
    );
    let _ = session.terminate(TerminationSource::User);
    h.door.shutdown().await;
}

#[tokio::test]
async fn an_unnegotiated_control_leg_never_sees_the_verb() {
    let h = harness().await;
    let (mut negotiated, _) = connect_control(&h, "set-se-a", json!(["session-events"])).await;
    // The stock hello: `resume` + an unknown string — negotiates NOTHING, the
    // exact posture of every pre-S3f client.
    let (mut plain, echoed) =
        connect_control(&h, "set-se-b", json!(["resume", "something-unknown"])).await;
    assert_eq!(echoed, json!([]));

    h.source.publish_lifecycle(SessionLifecycleEvent::Removed {
        session_id: "sess-ev-2".into(),
    });

    // The fan-out enqueues (or skips) BOTH legs under one registry lock, so
    // once the negotiated leg has its copy, the plain leg's silence is the
    // verdict, not a race.
    let event = expect_text(next_reply(&mut negotiated).await, "SessionEvent");
    assert_eq!(event["event"]["kind"], "removed");
    match tokio::time::timeout(Duration::from_millis(150), plain.next()).await {
        Err(_) => {}
        Ok(other) => panic!("the un-negotiated leg heard something: {other:?}"),
    }
    h.door.shutdown().await;
}

#[tokio::test]
async fn a_lagged_lifecycle_bus_tells_negotiated_clients_to_resync() {
    // Capacity 1 + a publish burst with no await between sends: on the
    // current-thread runtime the door's receiver cannot run mid-burst, so it
    // MUST observe `Lagged` — and the wire answer is the honest resync notice
    // followed by the newest surviving fact, never an invented replay.
    let h = harness_with_source(Arc::new(DirectSessions::with_lifecycle_capacity(1)), |_| {}).await;
    let (mut control, _) = connect_control(&h, "set-se-lag", json!(["session-events"])).await;

    for i in 0..3 {
        h.source.publish_lifecycle(SessionLifecycleEvent::Removed {
            session_id: format!("sess-lag-{i}"),
        });
    }

    let first = expect_text(next_reply(&mut control).await, "SessionEvent");
    assert_eq!(first["event"], json!({ "kind": "resync" }));
    let second = expect_text(next_reply(&mut control).await, "SessionEvent");
    assert_eq!(
        second["event"],
        json!({ "kind": "removed", "sessionId": "sess-lag-2" })
    );
    h.door.shutdown().await;
}

// ---------------------------------------------------------------------------
// item 42 (2026-10-19) — the seat announced, over the real door and a REAL
// PTY. A control hello that negotiates `geometry-events` hears `GeometryState`
// for every session it has an activation of: after every change of the
// holder or of the committed size, and once right after an attach's
// `ControlLegAttached`. (b), the stock hello's silence, is the TOLD-NOTHING
// row in `the_take_moves_a_held_seat_to_the_focused_client_with_one_resize`,
// unchanged; (a) below is its negotiated twin.

/// A control hello's advertisement that negotiates `geometry-events`, beside
/// the stock one (`resume` + an unknown string), which negotiates nothing.
fn negotiating() -> Value {
    json!(["resume", "geometry-events", "something-unknown"])
}

/// The face fieldd mints for the phone (contracts `GeometryHolderFace`).
fn phone_face() -> Value {
    json!({ "kind": "phone", "name": "iPhone 16 Pro", "os": "ios" })
}

/// A presence whose hello negotiates `geometry-events`, with every right.
fn negotiated<'a>(
    client: &'a str,
    set: &'a str,
    activation_id: &'a str,
    face: Option<Value>,
) -> Presence<'a> {
    Presence {
        client,
        set,
        activation_id,
        rights: &["geometry", "input", "read"],
        capabilities: negotiating(),
        face,
    }
}

/// A `ClaimGeometry` text for one activation's mount `view`.
fn claim_msg(
    session_id: &str,
    activation_id: &str,
    (client, view): (&str, &str),
    (cols, rows): (u16, u16),
    expect_revision: u64,
) -> Value {
    json!({
        "type": "ClaimGeometry",
        "sessionId": session_id, "activationId": activation_id, "leaseEpoch": 0,
        "claimant": { "clientId": client, "viewId": view },
        "cols": cols, "rows": rows, "expectRevision": expect_revision,
    })
}

/// (a) — the TOLD-NOTHING row's twin: the same take, but both hellos negotiate
/// `geometry-events`, so the displaced holder IS told — a `GeometryState`
/// naming the taker with the face its grant carried — and the taker hears that
/// state right after its own `GeometryCommitted`, never before it.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_take_is_announced_to_the_displaced_holder_and_after_the_takers_commit() {
    let h = harness().await;
    let session = spawn_session(&h.source);
    let session_id = session.id();
    let studio = json!({ "kind": "window", "name": "Studio", "os": "macos" });
    let (mut control_a, frames_a, _) = present(
        &h,
        &session_id,
        negotiated("win:1#1", "set-ga", "act-a", Some(studio.clone())),
    )
    .await;
    let (mut control_b, frames_b, _) = present(
        &h,
        &session_id,
        negotiated("tailnet:me#node-b", "set-gb", "act-b", Some(phone_face())),
    )
    .await;

    // A claims the empty seat: A's commit, then the state, which B hears too.
    let claim = claim_msg(&session_id, "act-a", ("win:1#1", "mount-a"), (100, 40), 0);
    send_json(&mut control_a, claim).await;
    let held = next_geometry(&mut control_a, "GeometryCommitted").await;
    let first = next_geometry(&mut control_a, "GeometryState").await;
    assert_eq!(first["holder"]["clientId"], "win:1#1");
    assert_eq!(first["holder"]["face"], studio);
    assert_eq!(first["geometryRevision"], held["geometryRevision"]);
    assert_eq!(next_geometry(&mut control_b, "GeometryState").await, first);

    // B is focused: its host TAKES the seat.
    send_json(
        &mut control_b,
        json!({
            "type": "TransferGeometry",
            "sessionId": session_id, "activationId": "act-b", "leaseEpoch": 0,
            "from": held["holder"].clone(),
            "to": { "clientId": "tailnet:me#node-b", "viewId": "mount-b" },
            "expectRevision": held["geometryRevision"].clone(), "cols": 90, "rows": 30,
        }),
    )
    .await;
    let taken = next_geometry(&mut control_b, "GeometryCommitted").await;
    let b_sees = next_geometry(&mut control_b, "GeometryState").await;
    assert_eq!(
        b_sees["holder"],
        json!({
            "clientId": "tailnet:me#node-b",
            "viewId": "mount-b",
            "holderGeneration": taken["holder"]["holderGeneration"].clone(),
            "face": phone_face(),
        })
    );
    assert_eq!(b_sees["geometryRevision"], taken["geometryRevision"]);
    assert_eq!(
        (b_sees["cols"].as_u64(), b_sees["rows"].as_u64()),
        (Some(90), Some(30))
    );
    // THE DISPLACED HOLDER IS TOLD: who took the seat, by name, at what size…
    let a_sees = next_geometry(&mut control_a, "GeometryState").await;
    assert_eq!(a_sees, b_sees);
    // …and is still never handed a verdict on a verb it did not send.
    let heard = drain_texts(&mut control_a, Duration::from_millis(300)).await;
    assert!(heard.iter().all(|m| !is_geometry_verdict(m)), "{heard:?}");
    let (_controller, cols, rows, _layout) = session.control_state();
    assert_eq!((cols, rows), (90, 30), "the engine committed B's size");

    drop((frames_a, frames_b));
    h.door.shutdown().await;
}

/// (e) and (c) — the holder's own resize names the new size to every
/// negotiated leg; its release, which has no reply of its own, announces the
/// empty seat at the size the PTY KEEPS (a release resizes nothing), to the
/// releaser as well.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_holders_resize_and_release_are_announced_at_the_size_the_pty_keeps() {
    let h = harness().await;
    let session = spawn_session(&h.source);
    let session_id = session.id();
    let (mut control_a, frames_a, _) = present(
        &h,
        &session_id,
        negotiated("win:1#1", "set-ea", "act-a", None),
    )
    .await;
    let (mut control_b, frames_b, _) = present(
        &h,
        &session_id,
        negotiated("win:2#1", "set-eb", "act-b", None),
    )
    .await;
    let claim = claim_msg(&session_id, "act-a", ("win:1#1", "mount-a"), (100, 40), 0);
    send_json(&mut control_a, claim).await;
    let held = next_geometry(&mut control_a, "GeometryCommitted").await;
    next_geometry(&mut control_a, "GeometryState").await;
    next_geometry(&mut control_b, "GeometryState").await;

    // (e) the holder's own resize — a re-claim of its seat
    let resize = claim_msg(&session_id, "act-a", ("win:1#1", "mount-a"), (132, 50), 1);
    send_json(&mut control_a, resize).await;
    let resized = next_geometry(&mut control_a, "GeometryCommitted").await;
    let state = next_geometry(&mut control_a, "GeometryState").await;
    assert_eq!(
        state["holder"]["holderGeneration"],
        held["holder"]["holderGeneration"]
    );
    assert!(
        state["holder"].get("face").is_none(),
        "a faceless grant: no face key"
    );
    assert_eq!(state["geometryRevision"], resized["geometryRevision"]);
    assert_eq!(
        (state["cols"].as_u64(), state["rows"].as_u64()),
        (Some(132), Some(50))
    );
    assert_eq!(next_geometry(&mut control_b, "GeometryState").await, state);

    // (c) the holder releases: no reply — only the empty seat, to both legs
    send_json(
        &mut control_a,
        json!({
            "type": "ReleaseGeometry",
            "sessionId": session_id, "activationId": "act-a", "leaseEpoch": 0,
            "holder": resized["holder"].clone(),
        }),
    )
    .await;
    let empty = next_geometry(&mut control_a, "GeometryState").await;
    assert!(empty["holder"].is_null(), "{empty}");
    let revision = resized["geometryRevision"].as_u64().unwrap();
    assert_eq!(empty["geometryRevision"], revision + 1);
    assert_eq!(
        (empty["cols"].as_u64(), empty["rows"].as_u64()),
        (Some(132), Some(50))
    );
    assert_eq!(next_geometry(&mut control_b, "GeometryState").await, empty);
    let (_controller, cols, rows, _layout) = session.control_state();
    assert_eq!((cols, rows), (132, 50), "a release resizes nothing");

    drop((frames_a, frames_b));
    h.door.shutdown().await;
}

/// (d) — every AUTOMATIC release says the seat is empty, to every negotiated
/// leg of the session still attached: a view detach (the holder's demand went
/// `none`, so its own leg hears it too) and a control-leg loss (the holder's
/// socket closed, so only the others can).
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_automatic_release_tells_every_negotiated_leg_the_seat_is_empty() {
    let h = harness().await;
    let session = spawn_session(&h.source);
    let session_id = session.id();
    let (mut control_a, frames_a, _) = present(
        &h,
        &session_id,
        negotiated("win:1#1", "set-da", "act-a", None),
    )
    .await;
    let (mut control_b, frames_b, _) = present(
        &h,
        &session_id,
        negotiated("win:2#1", "set-db", "act-b", None),
    )
    .await;

    // (1) a view detach: A holds, then parks its view
    let claim = claim_msg(&session_id, "act-a", ("win:1#1", "mount-a"), (100, 40), 0);
    send_json(&mut control_a, claim).await;
    next_geometry(&mut control_a, "GeometryCommitted").await;
    next_geometry(&mut control_a, "GeometryState").await;
    next_geometry(&mut control_b, "GeometryState").await;
    send_json(
        &mut control_a,
        json!({"type":"DeclareDemand","sessionId":session_id,"activationId":"act-a","leaseEpoch":0,"demandSequence":1,"demand":{"mode":"none"}}),
    )
    .await;
    next_geometry(&mut control_a, "DemandAccepted").await;
    let detached = next_geometry(&mut control_a, "GeometryState").await;
    assert!(detached["holder"].is_null(), "{detached}");
    assert_eq!(detached["geometryRevision"], 2);
    assert_eq!(
        (detached["cols"].as_u64(), detached["rows"].as_u64()),
        (Some(100), Some(40))
    );
    assert_eq!(
        next_geometry(&mut control_b, "GeometryState").await,
        detached
    );

    // (2) a control-leg loss: B holds, then B's control socket goes away
    let claim = claim_msg(&session_id, "act-b", ("win:2#1", "mount-b"), (80, 24), 2);
    send_json(&mut control_b, claim).await;
    next_geometry(&mut control_b, "GeometryCommitted").await;
    next_geometry(&mut control_b, "GeometryState").await;
    let b_holds = next_geometry(&mut control_a, "GeometryState").await;
    assert_eq!(b_holds["holder"]["clientId"], "win:2#1");
    control_b.close(None).await.ok();
    let lost = next_geometry(&mut control_a, "GeometryState").await;
    assert!(lost["holder"].is_null(), "{lost}");
    assert_eq!(lost["geometryRevision"], 4);
    assert_eq!(
        (lost["cols"].as_u64(), lost["rows"].as_u64()),
        (Some(80), Some(24))
    );

    drop((frames_a, frames_b));
    h.door.shutdown().await;
}

/// (f) — a negotiated leg whose activations are all of ANOTHER session hears
/// nothing of this seat: the announcement is activation-scoped, never the
/// connection-wide fan-out `SessionEvent` is.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_leg_attached_only_to_another_session_hears_nothing_of_the_seat() {
    let h = harness().await;
    let session = spawn_session(&h.source);
    let elsewhere = spawn_session(&h.source);
    let session_id = session.id();
    let elsewhere_id = elsewhere.id();
    let (mut control_a, frames_a, _) = present(
        &h,
        &session_id,
        negotiated("win:1#1", "set-fa", "act-a", None),
    )
    .await;
    let (mut control_z, frames_z, _) = present(
        &h,
        &elsewhere_id,
        negotiated("win:9#1", "set-fz", "act-z", None),
    )
    .await;
    let claim = claim_msg(&session_id, "act-a", ("win:1#1", "mount-a"), (100, 40), 0);
    send_json(&mut control_a, claim).await;
    next_geometry(&mut control_a, "GeometryCommitted").await;
    next_geometry(&mut control_a, "GeometryState").await;
    // One finalize enqueued every recipient's copy before A's arrived, so Z's
    // silence is the verdict, not a race.
    let heard = drain_texts(&mut control_z, Duration::from_millis(300)).await;
    assert!(
        heard.iter().all(|m| m["type"] != "GeometryState"),
        "{heard:?}"
    );

    drop((frames_a, frames_z));
    h.door.shutdown().await;
}

/// The on-attach rule (ruled with item 42, 2026-10-19): a desktop pane that
/// attaches WHILE the phone holds the seat is told so at once — right after its
/// `ControlLegAttached`, the phone as holder with the face its grant carried,
/// at the size it committed — so the pane says who drives before anything
/// changes. A stock desktop attaching the same way is told nothing.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_desktop_that_attaches_while_the_phone_drives_hears_the_phone_at_once() {
    let h = harness().await;
    let session = spawn_session(&h.source);
    let session_id = session.id();
    let (mut phone, phone_frames, before) = present(
        &h,
        &session_id,
        negotiated("tailnet:me#node-p", "set-op", "act-p", Some(phone_face())),
    )
    .await;
    assert!(
        before.iter().all(|m| m["type"] == "CellActivationStatus"),
        "no pane ever sized it, so no seat to tell: {before:?}"
    );
    let claim = claim_msg(
        &session_id,
        "act-p",
        ("tailnet:me#node-p", "mount-p"),
        (46, 30),
        0,
    );
    send_json(&mut phone, claim).await;
    let held = next_geometry(&mut phone, "GeometryCommitted").await;
    next_geometry(&mut phone, "GeometryState").await;

    let (_desk, desk_frames, heard) = present(
        &h,
        &session_id,
        negotiated("win:1#1", "set-od", "act-d", None),
    )
    .await;
    let told = &heard[0];
    assert_eq!(
        told["type"], "GeometryState",
        "first after ControlLegAttached: {heard:?}"
    );
    assert_eq!(told["sessionId"], session_id);
    assert_eq!(
        told["holder"],
        json!({
            "clientId": "tailnet:me#node-p",
            "viewId": "mount-p",
            "holderGeneration": held["holder"]["holderGeneration"].clone(),
            "face": phone_face(),
        })
    );
    assert_eq!(told["geometryRevision"], held["geometryRevision"]);
    assert_eq!(
        (told["cols"].as_u64(), told["rows"].as_u64()),
        (Some(46), Some(30))
    );
    // a stock desktop: `present_as` holds its attach to the lease alone
    let full = ["geometry", "input", "read"];
    let (_stock, stock_frames) =
        present_as(&h, "win:2#1", "set-os", &session_id, "act-s", &full).await;

    drop((phone_frames, desk_frames, stock_frames));
    h.door.shutdown().await;
}
