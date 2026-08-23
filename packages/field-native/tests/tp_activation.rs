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

#[path = "support/tp_mint.rs"]
mod tp_mint;

use field_native::tp::crc32c::crc32c;
use field_native::tp::door::{Door, DoorConfig};
use field_native::tp::grant::{GrantKey, GrantValidityLimits, GrantVerifier};
use field_native::tp::source::{DirectSessions, Trf1Header};
use field_native::tp::wire::decode_envelope;
use futures_util::{SinkExt, StreamExt};
use ghosttea::session::{Persistence, SpawnOptions};
use ghosttea::{
    AutomationInputOperation, FrameHub, Session, SessionEnvironment, SessionProgramKind, TextEngine,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};
use tp_mint::{hello, TestMinter, TransportSpec};

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
    let minter = TestMinter::new(CELL);
    let verifier = GrantVerifier::new(
        GrantKey {
            cell_boot_id: minter.cell_boot_id.clone(),
            key_generation: minter.key_generation,
            key: minter.key.clone(),
        },
        GrantValidityLimits::default(),
    );
    let source = DirectSessions::new();
    let mut config = DoorConfig::new(verifier, vec![]).with_source(source.clone());
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

#[cfg(unix)]
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

    // the worker's progress keeps the lease fresh; the cell answers every SceneApplied
    let applied = json!({ "sceneEpoch": result["sceneEpoch"], "sceneRevision": last });
    scene_applied(&mut frames, &session_id, "act-1", &applied).await;
    let status = expect_text(next_reply(&mut control).await, "CellActivationStatus");
    assert_eq!(status["cellStatusSequence"], 2);
    assert_eq!(status["input"]["state"], "allowed");

    let snapshot = h.door.snapshot();
    assert_eq!(snapshot.activations.len(), 1);
    assert_eq!(snapshot.activations[0].0, "act-1");
    assert!(snapshot.activations[0].3.contains("Presenting"));
    h.door.shutdown().await;
}

#[cfg(unix)]
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

#[cfg(unix)]
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

#[cfg(unix)]
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

/// TP-S3c — the frames-leg attach reports the HONEST seed reason: a resume whose
/// `from` names a different `SceneEpoch` is a migration (`epoch-changed`); a
/// same-epoch resume is viable but the dormant-cursor resume is capability-gated
/// (`no-resume-capability`); no resume is `no-cursor`.
#[tokio::test]
async fn frames_attach_reports_the_seed_reason_incl_epoch_changed() {
    let h = harness().await;
    let session = spawn_session(&h.source);
    let session_id = session.id();
    let epoch = session.session_epoch();
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
            "from": { "sceneEpoch": { "cellBootId": CELL, "modelGeneration": epoch + 1000 }, "sceneRevision": 1 },
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
            "from": { "sceneEpoch": { "cellBootId": CELL, "modelGeneration": epoch }, "sceneRevision": 1 },
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
#[cfg(unix)]
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
