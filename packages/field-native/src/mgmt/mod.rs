//! Management-channel server (design-02 §2.7): newline JSON-RPC over UDS,
//! hello-gated (D8), single authenticated client (new hello ⇒ SUPERSEDED),
//! snapshot-then-delta subscriptions (P5). Serves the M2 lifecycle surface +
//! the C2 mesh facade (mesh.rs); mesh calls answer UNAVAILABLE with the unit's
//! real state until the node is up.
//!
//! Since NF-5 `desired.set` carries real authority over the terminal floor: it
//! retains and prunes live sessions (native-floor spec §5). The three NF-D2
//! safety laws are what make that safe rather than merely powerful — silence
//! kills nothing, a prune needs proof the client saw THIS boot's inventory, and
//! generations only move forward. Interactive ops still never ride this channel.
//!
//! A fourth gate is the single-client rule itself, enforced per request rather
//! than at hello: a superseded connection's reader survives its supersession, and
//! none of the three laws above can fence it — a stale client may hold a HIGHER
//! generation than the fieldd that replaced it, and prove the same bootId.

mod diagnostics;
/// T-M4 — PUBLIC so an integration test can build a serve config through the
/// PRODUCTION mapping rather than a copy of it (`build_serve_config`; the
/// `terminal_cell_route_probe` row that dials a cell route). Nothing else in
/// the module is part of that surface.
pub mod mesh;
/// DS-1 — the egress verbs, dispatched from `mesh::handle` ahead of its node gate.
mod mesh_egress;

use crate::config::MeshPlan;
use crate::contracts::{
    DesiredState, Hello, NativePrepareRestartParams, NativePrepareRestartResult,
    NativeShutdownParams, NativeShutdownResult, TerminalRouteSnapshot, TerminalRoutesStreamPayload,
};
#[cfg(test)]
use crate::contracts::{TerminalEndpoints, TerminalRouteCell};
use crate::local_ipc;
use crate::pairing;
use crate::registries::mesh_control_limits;
use crate::services::mesh::NodePresence;
use crate::services::terminal;
use crate::services::terminal_client::ControlClient;
use crate::state::{ClientHandle, DaemonState, MgmtOutbox, OutMsg, MGMT_MAX_FRAME_BYTES};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, OwnedSemaphorePermit, Semaphore};
use tokio::task::JoinSet;

const CONTRACTS_VERSION: &str = "0.1.0";

// The work bound beside the shared management byte budget — both from the
// registry (`MESH_CONTROL_LIMITS`, generated), never retyped here. A waiting
// mesh service must neither block the socket reader nor grow its heap without
// limit (design-02 §2.7, Phase 0 correction).
const MESH_PENDING_REQUESTS: usize = mesh_control_limits::MGMT_PENDING_MESH_REQUESTS;

struct MeshRequest {
    conn_id: u64,
    tx: MgmtOutbox,
    method: String,
    params: Value,
    id: Option<Value>,
    _bytes: OwnedSemaphorePermit,
}

#[derive(Clone)]
struct MeshQueue {
    tx: mpsc::Sender<MeshRequest>,
    bytes: Arc<Semaphore>,
}

impl MeshQueue {
    fn enqueue(
        &self,
        conn_id: u64,
        tx: &MgmtOutbox,
        method: String,
        params: Value,
        id: Option<Value>,
        frame_bytes: usize,
    ) {
        // Frames are bounded before parsing, so this fits u32. Retain the
        // permit through execution: one large in-flight call still counts.
        let Ok(bytes) = self
            .bytes
            .clone()
            .try_acquire_many_owned(frame_bytes as u32)
        else {
            send(tx, mesh_queue_full(id));
            return;
        };
        let request = MeshRequest {
            conn_id,
            tx: tx.clone(),
            method,
            params,
            id,
            _bytes: bytes,
        };
        match self.tx.try_send(request) {
            Ok(()) => {}
            Err(mpsc::error::TrySendError::Full(request)) => {
                send(tx, mesh_queue_full(request.id));
            }
            Err(mpsc::error::TrySendError::Closed(request)) => {
                send(
                    tx,
                    err(
                        request.id,
                        "UNAVAILABLE",
                        -32006,
                        "mesh request worker stopped",
                        true,
                        Some(json!({"service":"mesh-gateway", "state":"stopped"})),
                    ),
                );
            }
        }
    }
}

fn mesh_queue_full(id: Option<Value>) -> Value {
    err(
        id,
        "RESOURCE_EXHAUSTED",
        -32010,
        "mesh request queue is full",
        true,
        Some(json!({"service":"mesh-gateway"})),
    )
}

/// How a reconcile prune classifies the exits it causes. `TerminationSource` is
/// a kebab-case wire enum with exactly three variants (session.rs:39-46) and
/// `classify_exit` maps this one to `ExitOutcome::ApplicationTerminated`
/// (session.rs:69-83), which is what every observer of the prune will read.
///
/// The choice among the three, recorded because it is a judgement:
/// * `user` — a human's kill, which is what `terminal.terminate` will carry
///   (NF-D5). A reconcile is not a human act; claiming it were would put a
///   person behind a decision fieldd's bookkeeping made.
/// * `service-shutdown` — reserved for the shutdown drain (G7's
///   `ServiceHandle::shutdown` stamps it upstream since NF-7), and it asserts
///   field-native is going down. Here it would be a lie: the floor keeps
///   serving, and the survivors keep running.
/// * `application` — the application above this floor (fieldd) withdrew the
///   session from its desired set. That is exactly what happened, so this is the
///   honest stamp.
const PRUNE_SOURCE: &str = "application";

/// Upstream's message for a `terminate` naming a session its registry does not
/// hold: `bail!("unknown session")` in `Command::Terminate`
/// (service.rs:1325-1343), reaching us through `{type:"error", message}` built
/// from `error.to_string()` (service.rs:1375-1380). It is the ONE failure that
/// means the session is already gone — everything else is a failure to reach the
/// plane, which says nothing about whether the ladder ran.
const UNKNOWN_SESSION: &str = "unknown session";

/// What a failed prune terminate actually tells us.
#[derive(Debug, PartialEq, Eq)]
enum PruneErrorKind {
    /// The floor no longer holds that session, so the desired end state (it is
    /// not running) already holds. fieldd's view merely lagged.
    AlreadyGone,
    /// A timeout, a closed connection, a refused write: the ladder may never
    /// have started and this daemon cannot say the session was pruned.
    Failed,
}

/// Classified from the message rather than a type because the wire carries only
/// a string: upstream answers `{type:"error", message}` and there is no code to
/// match on (service.rs:349-351).
fn classify_prune_error(message: &str) -> PruneErrorKind {
    // Two upstream refusal strings, one meaning: `terminate` answers
    // "unknown session", `set-persistence` answers "unknown or remote session"
    // (service.rs SetPersistence handler) — both say the registry row is gone.
    if message.contains(UNKNOWN_SESSION) || message.contains("unknown or remote session") {
        PruneErrorKind::AlreadyGone
    } else {
        PruneErrorKind::Failed
    }
}

pub async fn serve(mut listener: local_ipc::Listener, state: Arc<DaemonState>) {
    let (mesh_tx, mut mesh_rx) = mpsc::channel::<MeshRequest>(MESH_PENDING_REQUESTS);
    let mesh_queue = MeshQueue {
        tx: mesh_tx,
        bytes: Arc::new(Semaphore::new(mesh_control_limits::MGMT_QUEUED_BYTES)),
    };
    // One worker for the server, not one per client: a replacement fieldd's
    // replay cannot race the previous client's in-flight node/listener change.
    // JoinSet aborts it if the server is stopped. A mere client disconnect does
    // not cancel a partially applied mesh mutation.
    let mut mesh_worker = JoinSet::new();
    let mesh_state = state.clone();
    mesh_worker.spawn(async move {
        while let Some(request) = mesh_rx.recv().await {
            if request.tx.is_closed() || !mesh_state.is_current_client(request.conn_id).await {
                continue;
            }
            mesh::handle(
                &mesh_state,
                &request.tx,
                &request.method,
                &request.params,
                request.id,
            )
            .await;
        }
    });
    loop {
        match listener.accept().await {
            Ok(stream) => {
                let state = state.clone();
                let mesh_queue = mesh_queue.clone();
                tokio::spawn(async move { handle_conn(stream, state, mesh_queue).await });
            }
            Err(e) => {
                tracing::error!(
                    event = "field_native.mgmt.accept_failed",
                    component = "mgmt",
                    error = %e,
                    "The native management listener stopped accepting connections"
                );
                break;
            }
        }
    }
}

async fn handle_conn(stream: local_ipc::Stream, state: Arc<DaemonState>, mesh_queue: MeshQueue) {
    let conn_id = state.conn_id();
    // io::split, not into_split: a NamedPipeServer has no owned split, and the
    // generic halves serve both transports identically.
    let (read_half, mut write_half) = tokio::io::split(stream);
    let (tx, mut rx, mut close_rx) = MgmtOutbox::channel();
    // A second view of the close watch for the reader (below). The writer takes
    // the original; both halves must stop for the pipe handle to close (WIN-D1).
    let mut reader_close = close_rx.clone();

    // single writer task; Close tears the socket down
    let writer_outbox = tx.clone();
    let writer = tokio::spawn(async move {
        loop {
            tokio::select! {
                changed = close_rx.changed() => {
                    if changed.is_err() || *close_rx.borrow() {
                        break;
                    }
                }
                msg = rx.recv() => {
                    let Some(msg) = msg else { break };
                    match &msg {
                        OutMsg::Line(line) => {
                            let result = async {
                                write_half.write_all(line.as_bytes()).await?;
                                write_half.write_all(b"\n").await
                            }
                            .await;
                            writer_outbox.release(&msg);
                            if result.is_err() {
                                break;
                            }
                        }
                        OutMsg::Close => break,
                    }
                }
            }
        }
        let _ = write_half.shutdown().await;
        // The reader may still be parked on a read (a supersession closes this
        // connection from another task's hello). Wake it so its half drops too
        // and the stream closes — the client's EOF depends on it (WIN-D1).
        writer_outbox.signal_closed();
    });

    let mut reader = BufReader::new(read_half);
    let mut authed = false;

    loop {
        let mut raw = Vec::new();
        // Bound to a local so the Take adapter outlives the select's read future
        // (a temporary would be dropped while the future still borrows it).
        let mut limited = (&mut reader).take((MGMT_MAX_FRAME_BYTES + 2) as u64);
        let read = tokio::select! {
            // Writer flipped the close watch after draining and shutting down.
            // Stop reading so both io::split halves drop and the stream closes;
            // on unix shutdown() already FINed the peer, so this only makes the
            // teardown prompt there. Either changed() outcome means "closing".
            _ = reader_close.changed() => break,
            read = limited.read_until(b'\n', &mut raw) => read,
        };
        let Ok(bytes) = read else { break };
        if bytes == 0 {
            break;
        }
        if raw.last() != Some(&b'\n') || raw.len() - 1 > MGMT_MAX_FRAME_BYTES {
            tracing::warn!(
                event = "field_native.mgmt.frame_too_large",
                component = "mgmt",
                limit = MGMT_MAX_FRAME_BYTES,
                "The management client sent an oversized or unterminated frame"
            );
            break;
        }
        raw.pop();
        let Ok(line) = String::from_utf8(raw) else {
            break;
        };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(req) = serde_json::from_str::<Value>(&line) else {
            send(
                &tx,
                json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"parse error"}}),
            );
            continue;
        };
        let id = req.get("id").cloned();
        let method = req
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let params = req.get("params").cloned().unwrap_or(Value::Null);

        // The single-client rule is a per-REQUEST law, not a hello-time one.
        // Superseding a connection closes its WRITE half (handle_hello sends
        // `Close`), but its reader loop keeps running and keeps its `authed`
        // flag, so a stale fieldd could still reach every mutating surface. The
        // generation guard cannot stand in for this: a stale client may hold a
        // HIGHER generation than the successor and would then be admitted to
        // prune the successor's PTYs. A re-hello is exempt — that is this
        // connection asking to become current again, which the rule allows.
        if authed && method != "native.lifecycle.hello" && !state.is_current_client(conn_id).await {
            send(&tx, superseded(id));
            send_raw(&tx, OutMsg::Close);
            break;
        }

        match method.as_str() {
            "native.lifecycle.hello" => {
                let (resp, ok) = handle_hello(&state, conn_id, &tx, &params, id).await;
                send(&tx, resp);
                if ok {
                    authed = true;
                } else {
                    send_raw(&tx, OutMsg::Close);
                    break;
                }
            }
            _ if !authed => {
                send(
                    &tx,
                    err(
                        id,
                        "UNAUTHORIZED",
                        -32001,
                        "hello required first",
                        false,
                        None,
                    ),
                );
            }
            "native.lifecycle.health.subscribe" => {
                let sub_id = state.sub_id();
                let snapshot = serde_json::to_value(&*state.health_tx.borrow()).unwrap();
                send(&tx, ok(id, json!({"subId": sub_id, "snapshot": snapshot})));
                spawn_forwarder(
                    tx.clone(),
                    state.health_tx.subscribe(),
                    "native.lifecycle.health.delta",
                    sub_id,
                );
            }
            "native.lifecycle.ping" => {
                // TC-D2 — the heartbeat probe rides the full control path
                // (socket → framing → dispatch → reply): a wedge anywhere on
                // that path is what the caller is measuring. The boot id lets
                // a supervisor notice a floor that restarted underneath a
                // surviving socket.
                // Phase 0 correction: external mesh waits belong to the FIFO
                // worker; they must not stall this shared reader/dispatch path.
                let ts = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                send(&tx, ok(id, json!({"bootId": state.boot_id, "ts": ts})));
            }
            // WP12 L2b (`build-wp12-updater.md` §9 R2/R3) — an update that touches this floor. Both verbs are
            // authorized by the single-client rule and nothing else: a superseded connection was refused above,
            // before any effect, with the same `superseded` answer every mutating verb gets.
            "native.lifecycle.prepareRestart" => {
                let reply = match serde_json::from_value::<NativePrepareRestartParams>(params) {
                    Ok(intent) => {
                        let recorded = state.restart.record(&intent, &state.boot_id).unwrap_or_else(|error| {
                            tracing::warn!(
                                event = "field_native.lifecycle.restart_intent_failed",
                                component = "lifecycle",
                                error = %error,
                                "the restart intent could not be recorded; the next boot will read unplanned"
                            );
                            false
                        });
                        tracing::info!(
                            event = "field_native.lifecycle.restart_prepared",
                            component = "lifecycle",
                            reason = %intent.reason,
                            recorded,
                            "the paired client recorded a restart intent"
                        );
                        ok(id, json!(NativePrepareRestartResult { recorded }))
                    }
                    Err(e) => err(
                        id,
                        "PRECONDITION_FAILED",
                        -32005,
                        &format!("bad restart intent: {e}"),
                        false,
                        None,
                    ),
                };
                send(&tx, reply);
            }
            "native.lifecycle.shutdown" => {
                match serde_json::from_value::<NativeShutdownParams>(params) {
                    Ok(request) => {
                        tracing::info!(
                            event = "field_native.lifecycle.shutdown_accepted",
                            component = "lifecycle",
                            reason = %request.reason,
                            connection = conn_id,
                            "the paired client asked this floor to stop; the SIGTERM drain follows"
                        );
                        // The reply first, then main's third arm: the drain that follows aborts the accept loop but
                        // not this connection's writer, and fieldd's witness is the socket closing either way.
                        send(&tx, ok(id, json!(NativeShutdownResult { stopping: true })));
                        state.restart.request_shutdown();
                    }
                    Err(e) => send(
                        &tx,
                        err(
                            id,
                            "PRECONDITION_FAILED",
                            -32005,
                            &format!("bad shutdown request: {e}"),
                            false,
                            None,
                        ),
                    ),
                }
            }
            "native.lifecycle.observed.subscribe" => {
                let sub_id = state.sub_id();
                let snapshot = serde_json::to_value(&*state.observed_tx.borrow()).unwrap();
                send(&tx, ok(id, json!({"subId": sub_id, "snapshot": snapshot})));
                spawn_forwarder(
                    tx.clone(),
                    state.observed_tx.subscribe(),
                    "native.lifecycle.observed.delta",
                    sub_id,
                );
            }
            "native.lifecycle.terminal.routes.subscribe" => {
                // TC-D15 — snapshot now, FULL snapshots as deltas (state
                // transfer, never edges: a missed delta is repaired by the
                // next one, and reconnect re-subscribes).
                //
                // MF-2i — under `disclosed_routes`, the SAME rule the hello
                // applies: an unrevised snapshot is withheld from both
                // surfaces, so the subscription can never contradict the ack
                // that preceded it. Its own forwarder rather than the generic
                // one for exactly that reason — the rule has to hold for the
                // deltas too, or the contradiction simply moves one message
                // later.
                //
                // E-F1 — the snapshot and every delta now carry the floor's
                // LIVE `terminalMesh`, because the hello's reading is taken at
                // a moment it is predictably false (the mesh node is installed
                // by a spawned bring-up task that returns before the node
                // exists) and nothing re-hellos. The SAME rule governs both
                // halves here as governs the snapshot: a withheld snapshot
                // carries no boolean either, and the forwarder is told so, so
                // its first node flip is never deduped against a reading this
                // subscriber never received.
                let sub_id = state.sub_id();
                let published = state.terminal_mesh_published();
                let mut result = json!({ "subId": sub_id.clone() });
                let mut sent_at_subscribe = None;
                if let Some(snapshot) = disclosed_routes(&state.terminal_routes.borrow()) {
                    result["snapshot"] =
                        serde_json::to_value(routes_stream_payload(snapshot, published)).unwrap();
                    sent_at_subscribe = Some(published);
                }
                send(&tx, ok(id, result));
                spawn_routes_forwarder(
                    tx.clone(),
                    state.terminal_routes.clone(),
                    state.terminal_mesh_presence(),
                    state.terminal_mesh,
                    sent_at_subscribe,
                    sub_id,
                );
            }
            "native.lifecycle.desired.set" => {
                send(&tx, handle_desired_set(&state, conn_id, &params, id).await);
            }
            // RETIRED 2026-09-14 (TM-3, `thinking-terminal-mesh-cells.md` §7 /
            // TM-D3): `native.terminal.mirrorWriteCapability`, the ONE hop that
            // ever carried this floor's mirror-write capability to its single
            // pairing-verified client, so fieldd could grant it to a self peer.
            // Deleted with the mint, the key file and the env var — the write
            // right is a claim in a per-client expiring attach grant now, and
            // no verb on this channel carries a durable secret for it. A
            // pre-TM-3 caller falls through to METHOD_NOT_FOUND below, which is
            // the honest answer: the door is gone, not temporarily unavailable.
            "native.diagnostics.query" => {
                send(&tx, diagnostics::query(&state, &params, id));
            }
            "native.diagnostics.subscribe" => {
                diagnostics::subscribe(&state, &tx, &params, id);
            }
            "native.diagnostics.lease.create" => {
                send(&tx, diagnostics::lease_create(&state, &params, id));
            }
            "native.diagnostics.lease.list" => {
                send(&tx, diagnostics::lease_list(&state, id));
            }
            "native.diagnostics.lease.revoke" => {
                send(&tx, diagnostics::lease_revoke(&state, &params, id));
            }
            m if m.starts_with("native.mesh.") => {
                mesh_queue.enqueue(conn_id, &tx, method, params, id, line.len() + 1);
            }
            m if m.starts_with("native.process.") || m.starts_with("native.sidecar.") => {
                send(
                    &tx,
                    err(
                        id,
                        "UNAVAILABLE",
                        -32006,
                        "unit not embedded yet",
                        true,
                        Some(
                            json!({"service": m.split('.').nth(1).unwrap_or("native"), "state":"stub"}),
                        ),
                    ),
                );
            }
            _ => {
                send(
                    &tx,
                    err(id, "NOT_FOUND", -32601, "method not found", false, None),
                );
            }
        }
    }

    // cleanup: release the single-client slot if it is still ours
    let mut cur = state.current_client.lock().await;
    if cur.as_ref().is_some_and(|c| c.conn_id == conn_id) {
        *cur = None;
    }
    drop(cur);
    send_raw(&tx, OutMsg::Close);
    let _ = writer.await;
}

/// The hello's version gate: a refusal when the client's contracts MAJOR is not ours (0.x line — tolerant within
/// it, P3). It runs BEFORE the pairing credential is verified, so it carries NO server details — EL7 (WP12 L2a): a
/// refusal sent before the credential is checked must carry no server details.
fn refuse_incompatible_major(theirs: &str, id: Option<Value>) -> Option<Value> {
    let ours_major = CONTRACTS_VERSION.split('.').next().unwrap_or("0");
    if theirs.split('.').next().unwrap_or("") == ours_major {
        return None;
    }
    Some(err(
        id,
        "INCOMPATIBLE",
        -32009,
        "contracts major mismatch",
        false,
        None,
    ))
}

async fn handle_hello(
    state: &Arc<DaemonState>,
    conn_id: u64,
    tx: &MgmtOutbox,
    params: &Value,
    id: Option<Value>,
) -> (Value, bool) {
    // shape-validate through the contracts type (tolerant reader — P3)
    let hello: Hello = match serde_json::from_value(params.clone()) {
        Ok(h) => h,
        Err(e) => {
            return (
                err(
                    id,
                    "PRECONDITION_FAILED",
                    -32005,
                    &format!("bad hello: {e}"),
                    false,
                    None,
                ),
                false,
            )
        }
    };

    // version gate: major must match (0.x line — tolerant within it, P3)
    if let Some(refusal) =
        refuse_incompatible_major(&hello.contracts_version.to_string(), id.clone())
    {
        return (refusal, false);
    }

    // D8 pairing credential (read from raw params — variant-name independent)
    let cred = params.get("credential");
    let (Some(boot_id), Some(ts), Some(mac)) = (
        cred.and_then(|c| c.get("bootId")).and_then(Value::as_str),
        cred.and_then(|c| c.get("ts")).and_then(Value::as_i64),
        cred.and_then(|c| c.get("mac")).and_then(Value::as_str),
    ) else {
        return (
            err(
                id,
                "UNAUTHORIZED",
                -32001,
                "pairing credential required",
                false,
                None,
            ),
            false,
        );
    };
    if !pairing::verify(&state.secret, boot_id, ts, mac, pairing::now_epoch_secs()) {
        return (
            err(
                id,
                "UNAUTHORIZED",
                -32001,
                "pairing verification failed",
                false,
                None,
            ),
            false,
        );
    }

    // single-client rule: supersede any existing product plane
    let mut cur = state.current_client.lock().await;
    if let Some(old) = cur.take() {
        let _ = old.tx.send(OutMsg::Line(
            json!({"jsonrpc":"2.0","method":"native.lifecycle.superseded","params":{"reason":"new hello"}})
                .to_string(),
        ));
        let _ = old.tx.send(OutMsg::Close);
        tracing::info!(
            event = "field_native.mgmt.client_superseded",
            component = "mgmt",
            previous_connection = old.conn_id,
            new_connection = conn_id,
            "A newer fieldd management client superseded the previous connection"
        );
    }
    *cur = Some(ClientHandle {
        conn_id,
        tx: tx.clone(),
    });
    tracing::info!(
        event = "field_native.mgmt.client_authenticated",
        component = "mgmt",
        connection = conn_id,
        "fieldd authenticated to the native management channel"
    );

    let mut ack = json!({
        "contractsVersion": CONTRACTS_VERSION,
        "serverKind": "field-native",
        "grantedScopes": [],
        "nativeBuild": native_build(),
    });
    // WIN-10 — answer the client's challenge, so it can tell THIS daemon from
    // anything else that reached its endpoint first. Only when a nonce was
    // offered: a pre-WIN-10 fieldd sends none and gets the old ack unchanged,
    // while a WIN-10 fieldd REFUSES an ack with no proof (the downgrade an
    // attacker would otherwise simply request).
    if let Some(nonce) = cred.and_then(|c| c.get("nonce")).and_then(Value::as_str) {
        ack["serverMac"] = json!(pairing::compute_ack_mac(&state.secret, nonce, boot_id));
    }
    // NF-D8: the terminal floor's endpoints ride the hello, so fieldd re-learns
    // them at every re-pair and they never enter env, config, or logs. Field
    // names come from the generated contract type, never retyped here. Absent
    // when no terminal unit is configured — tolerated by readers.
    //
    // TC-D15 (TC-S2): `terminal` is now the LEGACY single-cell mirror, kept in
    // lockstep with `terminalRoutes` — the revisioned snapshot new readers
    // prefer. Both come from the snapshot (TM-1 retired the in-process serve,
    // which was the one shape that filled the mirror from somewhere else).
    //
    // MF-2i: `disclosed_routes` is the rule, stated once, and the routes
    // subscription applies the same one instead of contradicting this ack a
    // message later.
    if let Some(endpoints) = state.terminal_endpoints_now() {
        ack["terminal"] = serde_json::to_value(endpoints).expect("terminal endpoints serialize");
    }
    if let Some(routes) = disclosed_routes(&state.terminal_routes.borrow()) {
        ack["terminalRoutes"] = serde_json::to_value(routes).expect("terminal routes serialize");
    }
    // TM-1 (MF-1l) — whether this floor's terminal doors are published on the
    // tailnet, re-asserted on EVERY hello because both halves can move between
    // pairings (the flag with a floor restart, the node whenever the gateway's
    // does). Unconditional, unlike the two fields above: `false` is a real
    // answer here, and withholding it would make a floor that says "no"
    // indistinguishable from one that predates the field. Secret-free — a
    // boolean, never the capability, the node's name, or a port (EL7).
    ack["terminalMesh"] = json!(state.terminal_mesh_published());
    // WP12 L2b (§9 R3) — how the floor before this boot ended, taken from the restart intent at boot. Absent from
    // an unconfigured (embedded) floor: it cannot say, and silence is not `unplanned`.
    if let Some(last_exit) = state.restart.last_exit() {
        ack["lastExit"] = json!(last_exit);
    }
    (ok(id, ack), true)
}

/// GT-2d — who is actually answering this socket. This plane outlives fieldd
/// and is adopted by design, so the floor a shell pairs with can be many builds
/// older than the tree that started the pairing; a July native answering an
/// August fieldd reports its missing units perfectly honestly and reads as a
/// product bug. The crate version is always available; `FIELDD_BUILD_ID` is the
/// app's build identity, inherited from the fieldd that spawned this process
/// (bin.ts hands its whole environment down): the dev runner's snapshot id in
/// development and, since WP12 L2a (2026-10-15), the staged identity's
/// `<appVersion>+<commit7>` in a packaged run — so a packaged label names the
/// app build that SPAWNED this floor, which is how an old floor under a new app
/// shows in a support bundle. *(Corrected 2026-10-15, WP12 L2b: this said the
/// stamp was "absent in a packaged run"; L2a made it present.)* Still a suffix,
/// not a requirement — a fieldd started by hand may carry none. A build label,
/// never a secret and never parsed for behavior.
fn native_build() -> String {
    const BASE: &str = concat!("field-native/", env!("CARGO_PKG_VERSION"));
    match std::env::var("FIELDD_BUILD_ID") {
        Ok(stamp) if !stamp.is_empty() => format!("{BASE}+{stamp}"),
        _ => BASE.to_string(),
    }
}

async fn handle_desired_set(
    state: &Arc<DaemonState>,
    conn_id: u64,
    params: &Value,
    id: Option<Value>,
) -> Value {
    let desired: DesiredState = match serde_json::from_value(params.clone()) {
        Ok(d) => d,
        Err(e) => {
            return err(
                id,
                "PRECONDITION_FAILED",
                -32005,
                &format!("bad desired state: {e}"),
                false,
                None,
            )
        }
    };
    // Held across the whole reconcile: two sets must never interleave their
    // prunes, and a refused set must leave nothing of itself behind.
    let mut slot = state.desired.lock().await;
    // Asked again HERE, adjacent to the effect and under the reconcile lock. The
    // dispatch gate in `handle_conn` only knows the truth as of the moment the
    // request was read, and this set may have waited behind another one's prune
    // while a hello superseded its connection. Lock order is desired →
    // current_client and nothing takes them the other way round.
    if !state.is_current_client(conn_id).await {
        return superseded(id);
    }
    if let Some(cur) = slot.as_ref() {
        if desired.generation < cur.generation {
            return err(
                id,
                "PRECONDITION_FAILED",
                -32005,
                "stale generation",
                false,
                Some(json!({"current": cur.generation, "given": desired.generation})),
            );
        }
    }

    // NF-D2: the survivor set IS the authority — what fieldd lists it keeps,
    // what it omits runs its ladder. Measured against the inventory the terminal
    // unit publishes, whose truth is `list-sessions` (spec §10.5). Owned ids
    // because a watch borrow cannot cross an await.
    let prune: Vec<String> = {
        let listed: HashSet<&str> = desired
            .terminals
            .iter()
            .map(|terminal| terminal.session_id.as_str())
            .collect();
        let observed = state.observed_tx.borrow();
        observed
            .terminals
            .iter()
            .map(|terminal| terminal.session_id.as_str())
            .filter(|session_id| !listed.contains(session_id))
            .map(str::to_owned)
            .collect()
    };

    // Desired NEVER creates: creation is interactive and rides ghosttea's own
    // control socket (NF-D2, design-02 §2.7's no-interactive-ops law). A session
    // this set lists that the floor does not have is fieldd's view lagging, not
    // an instruction — it is retained by saying nothing about it.
    //
    // Persistence re-policy is REAL since NF-7 (ghosttea 0.7.0, the G9
    // landing): `set-persistence` writes under the service's registry lock and
    // answers with the applied summary, and `SessionSummary.persistence` fills
    // the observed inventory this diff is computed against. Only sessions the
    // floor OBSERVES are re-policied — a desired row the inventory lacks is
    // fieldd's view lagging (same law as creation above), and a `None` in
    // observed is unknown, so a stated desire applies.
    let repolicy: Vec<(String, String)> = {
        let observed = state.observed_tx.borrow();
        desired
            .terminals
            .iter()
            .filter_map(|terminal| {
                let want = terminal.persistence.as_ref()?;
                let row = observed
                    .terminals
                    .iter()
                    .find(|row| row.session_id == terminal.session_id)?;
                (row.persistence.as_deref() != Some(want.as_str()))
                    .then(|| (terminal.session_id.clone(), want.clone()))
            })
            .collect()
    };

    if !prune.is_empty() {
        // NF-D2(b): a fieldd may only kill what it has SEEN this boot. An absent
        // proof and a stale one are the same refusal — either way the client is
        // pruning against an inventory that is not this daemon's.
        if desired.observed_boot_id.as_deref() != Some(state.boot_id.as_str()) {
            return err(
                id,
                "PRECONDITION_FAILED",
                -32005,
                "observedBootId must match this boot before a desired set may prune (NF-D2)",
                false,
                Some(json!({
                    "current": state.boot_id,
                    "given": desired.observed_boot_id,
                    "wouldPrune": prune.len(),
                })),
            );
        }
    }

    // One plane connection for every effect this set carries (re-policy and
    // prune). NF-6's dial-before-store law covers both: a plane that cannot be
    // reached refuses the WHOLE set rather than banking a generation whose
    // effects never ran, and without endpoints there is no plane to execute on
    // — never a success that did nothing. (Inventory would normally be empty in
    // that state; the guard states the law regardless.)
    //
    // The event receiver rides in `plane` for the whole reconcile on purpose.
    // Every control connection receives every broadcast event
    // (service.rs:470/624), so the first `session-exited` a prune causes comes
    // back on this very connection; a receiver dropped early would make it
    // undeliverable while the prune is still issuing terminates. The client
    // discards undeliverable events rather than ending its read loop, so this
    // is the second of two independent reasons the reconcile cannot wedge
    // itself.
    let plane = if !prune.is_empty() || !repolicy.is_empty() {
        let involved = prune
            .iter()
            .map(String::as_str)
            .chain(repolicy.iter().map(|(session_id, _)| session_id.as_str()));
        match connect_planes(state, involved).await {
            Ok(router) => Some(router),
            Err(detail) => {
                tracing::warn!(
                    event = "field_native.lifecycle.plane_unreachable",
                    component = "mgmt",
                    generation = desired.generation,
                    error = %detail,
                    "The terminal control plane could not be reached; the desired set was refused"
                );
                return err(
                    id,
                    "UNAVAILABLE",
                    -32006,
                    &format!("the desired set was not applied: {detail}"),
                    true,
                    Some(json!({
                        "service": terminal::UNIT_ID,
                        "state": terminal_state(state),
                        "wouldPrune": prune.len(),
                        "wouldRepolicy": repolicy.len(),
                    })),
                );
            }
        }
    } else {
        None
    };

    // Spec §5's order: re-policy BEFORE the prune — a session promoted and
    // withdrawn by the same set still gets its retention decided by the new
    // policy when its ladder concludes.
    if !repolicy.is_empty() {
        let router = plane.as_ref().expect("plane is connected when work exists");
        tracing::info!(
            event = "field_native.lifecycle.repolicy_attempt",
            component = "mgmt",
            generation = desired.generation,
            sessions = repolicy.len(),
            "The desired set changes session persistence; applying it"
        );
        let mut failed_repolicy: Vec<&str> = Vec::new();
        for (session_id, persistence) in &repolicy {
            // TC-S3 — the session's cell left the route snapshot: it died and
            // took the session with it (the S3 ceiling), so its policy is
            // moot — the ordinary race, in its per-cell shape.
            let Some(client) = router.client_for(session_id) else {
                tracing::debug!(
                    event = "field_native.lifecycle.repolicy_skipped",
                    component = "mgmt",
                    session_id = %session_id,
                    "A re-policied session's cell is gone; the session ended with it"
                );
                continue;
            };
            match client.set_persistence(session_id, persistence).await {
                Ok(()) => {}
                Err(error) => match classify_prune_error(&format!("{error:#}")) {
                    // The observed row was stale: the session concluded between
                    // fieldd's snapshot and this call. Its policy is moot — the
                    // ordinary race, not a failure.
                    PruneErrorKind::AlreadyGone => tracing::debug!(
                        event = "field_native.lifecycle.repolicy_skipped",
                        component = "mgmt",
                        session_id = %session_id,
                        error = %error,
                        "A re-policied session was already gone from the terminal registry"
                    ),
                    // Same law as the prune below: a set whose effects half-ran
                    // is NOT applied — nothing banked, and `set-persistence` is
                    // idempotent, so retrying this same generation is safe.
                    PruneErrorKind::Failed => {
                        failed_repolicy.push(session_id);
                        tracing::warn!(
                            event = "field_native.lifecycle.repolicy_failed",
                            component = "mgmt",
                            generation = desired.generation,
                            session_id = %session_id,
                            error = %error,
                            "A session's persistence change could not be applied; the desired set was refused"
                        );
                    }
                },
            }
        }
        if !failed_repolicy.is_empty() {
            return err(
                id,
                "UNAVAILABLE",
                -32006,
                "some persistence changes could not be applied, so the desired set was not applied",
                true,
                Some(json!({
                    "service": terminal::UNIT_ID,
                    "state": terminal_state(state),
                    "generation": desired.generation,
                    "failedRepolicy": failed_repolicy,
                })),
            );
        }
    }

    if !prune.is_empty() {
        let router = plane.as_ref().expect("plane is connected when work exists");

        // Attempt-before-effect (spec §8): the intent is on the record before a
        // single ladder fires, so a prune is accountable even if this daemon dies
        // mid-reconcile. The durable audit record is the LOG-L6 writer's job,
        // above this seam.
        tracing::info!(
            event = "field_native.lifecycle.prune_attempt",
            component = "mgmt",
            generation = desired.generation,
            sessions = %prune.join(","),
            source = PRUNE_SOURCE,
            "The desired set withdrew terminal sessions; terminating them"
        );
        // Per-session outcomes, because `{applied}` may only be said of a prune
        // that actually happened. `pruned` counts the sessions whose desired end
        // state now holds (terminated, or already gone); `failed` names the ones
        // this daemon cannot vouch for.
        let mut pruned = 0_usize;
        let mut failed: Vec<&str> = Vec::new();
        for session_id in &prune {
            // TC-S3 — a session tagged to a cell that left the route snapshot
            // is already dead (the cell died; its PTYs died with it), so the
            // desired end state holds without a ladder.
            let Some(client) = router.client_for(session_id) else {
                pruned += 1;
                tracing::debug!(
                    event = "field_native.lifecycle.prune_terminate_skipped",
                    component = "mgmt",
                    session_id = %session_id,
                    "A pruned session's cell is gone; the desired end state already holds"
                );
                continue;
            };
            // Fire the ladder and move on. Upstream's `terminate` starts it on
            // its own thread and returns (session.rs:1558-1584), so the ladders
            // overlap and this response never waits on an exit — the inventory
            // pump is what reports convergence.
            match client.terminate(session_id, PRUNE_SOURCE).await {
                Ok(()) => pruned += 1,
                Err(error) => match classify_prune_error(&format!("{error:#}")) {
                    // The ordinary race between fieldd's view and this floor's:
                    // the desired end state already holds, so it is debug and it
                    // counts toward the prune.
                    PruneErrorKind::AlreadyGone => {
                        pruned += 1;
                        tracing::debug!(
                            event = "field_native.lifecycle.prune_terminate_skipped",
                            component = "mgmt",
                            session_id = %session_id,
                            error = %error,
                            "A pruned session was already gone from the terminal registry"
                        );
                    }
                    // A timeout or a torn connection says NOTHING about whether
                    // the ladder started. Swallowing these is what let `{applied}`
                    // lie about a prune that half-ran.
                    PruneErrorKind::Failed => {
                        failed.push(session_id);
                        tracing::warn!(
                            event = "field_native.lifecycle.prune_terminate_failed",
                            component = "mgmt",
                            generation = desired.generation,
                            session_id = %session_id,
                            error = %error,
                            "A pruned session's termination could not be confirmed; the desired set was refused"
                        );
                    }
                },
            }
        }
        // A set whose prune half-ran is NOT applied: nothing is stored and no
        // generation is banked, so fieldd retries the SAME generation and the
        // monotonicity guard admits it precisely because we stored nothing.
        if !failed.is_empty() {
            return err(
                id,
                "UNAVAILABLE",
                -32006,
                "some withdrawn terminal sessions could not be terminated, so the desired set was not applied",
                true,
                Some(json!({
                    "service": terminal::UNIT_ID,
                    "state": terminal_state(state),
                    "generation": desired.generation,
                    "pruned": pruned,
                    "failed": failed,
                })),
            );
        }
    }

    let generation = desired.generation;
    // What fieldd LISTED, which is not the same as what was retained: a listed
    // session this floor never had is not a survivor, just a stale row.
    let listed = desired.terminals.len();
    // Inert by spec §5 until a native worker exists, and by NF-D2 for the mesh:
    // tolerated on the wire, logged so a fieldd sending them is not left
    // believing they took effect.
    if !desired.workers.is_empty() || desired.mesh_config.is_some() {
        tracing::debug!(
            event = "field_native.lifecycle.desired_inert_fields",
            component = "mgmt",
            generation,
            workers = desired.workers.len(),
            mesh_config = desired.mesh_config.is_some(),
            "The desired set carried fields this floor does not act on yet"
        );
    }
    // Both under the reconcile lock, and in this order: storing first means a
    // published generation is always one this daemon has banked, and publishing
    // before the lock is released means two concurrent sets cannot hand
    // subscribers their generations out of order (the watch channel would then
    // report a moving-backwards generation the guard forbids).
    *slot = Some(desired);
    state.observed_tx.send_modify(|o| o.generation = generation);
    drop(slot);
    tracing::info!(
        event = "field_native.lifecycle.desired_applied",
        component = "mgmt",
        generation,
        listed,
        pruned = prune.len(),
        repolicied = repolicy.len(),
        "The desired native state generation was applied"
    );
    ok(id, json!({"applied": generation}))
}

/// The terminal unit's REAL state for an `UNAVAILABLE` detail — the same law the
/// mesh facade follows (C1: details carry the unit's state, never a literal).
/// Read from the health the unit itself publishes; `null` only if the unit was
/// never registered at all.
/// TC-S3 — the desired set's effects must reach the cell that HOSTS each
/// session: with K=2 class cells plus solos, one client cannot see every
/// session, and asking the wrong cell answers "unknown or remote session" —
/// which the race classifier would read as already-gone, silently skipping a
/// termination. The router groups the involved sessions by their inventory
/// `cell` tag and dials each involved cell once, before any effect
/// (dial-before-store: an unreachable involved plane refuses the WHOLE set).
/// The events receivers ride alongside for the reason the old single `plane`
/// kept its: the exits a prune causes come back on these very connections,
/// and a dropped receiver would make them undeliverable mid-prune.
struct PlaneRouter {
    clients: Vec<(ControlClient, tokio::sync::mpsc::UnboundedReceiver<Value>)>,
    by_session: std::collections::HashMap<String, usize>,
}

impl PlaneRouter {
    /// The client for this session's cell — or None when the tagged cell has
    /// LEFT the route snapshot: the cell died and its sessions died with it
    /// (the S3 ceiling), so a prune's end state already holds and a repolicy
    /// is moot. Callers treat None as the already-gone race.
    fn client_for(&self, session_id: &str) -> Option<&ControlClient> {
        self.by_session
            .get(session_id)
            .map(|index| &self.clients[*index].0)
    }
}

/// Dial every cell the involved sessions live on. Sessions without a tag
/// (legacy floors, the in-process serve) ride the legacy single endpoints,
/// exactly as before TC-S3. Err carries the human refusal detail.
async fn connect_planes<'a>(
    state: &Arc<DaemonState>,
    involved: impl Iterator<Item = &'a str>,
) -> Result<PlaneRouter, String> {
    let mut legacy_group: Vec<String> = Vec::new();
    let mut tagged: std::collections::HashMap<String, Vec<String>> = Default::default();
    {
        let observed = state.observed_tx.borrow();
        for session_id in involved {
            let tag = observed
                .terminals
                .iter()
                .find(|row| row.session_id == session_id)
                .and_then(|row| row.cell.as_ref())
                .map(|cell| cell.cell_boot_id.clone());
            match tag {
                Some(boot) => tagged.entry(boot).or_default().push(session_id.to_string()),
                None => legacy_group.push(session_id.to_string()),
            }
        }
    }
    let routes = state.terminal_routes.borrow().clone();
    let mut router = PlaneRouter {
        clients: Vec::new(),
        by_session: Default::default(),
    };
    for (boot, sessions) in tagged {
        let Some(row) = routes.cells.iter().find(|cell| cell.cell_boot_id == boot) else {
            // The cell is gone from the snapshot: `client_for` answers None
            // for these sessions and the caller classifies already-gone.
            continue;
        };
        let pair = ControlClient::connect(&row.endpoints.control_socket, &row.endpoints.auth_token)
            .await
            .map_err(|error| {
                format!(
                    "terminal cell {} could not be reached: {error:#}",
                    row.cell_instance_id
                )
            })?;
        let index = router.clients.len();
        router.clients.push(pair);
        for session in sessions {
            router.by_session.insert(session, index);
        }
    }
    if !legacy_group.is_empty() {
        let Some(endpoints) = state.terminal_endpoints_now() else {
            return Err(
                "the terminal plane has no endpoints, so the desired set's effects cannot be \
                 executed"
                    .into(),
            );
        };
        let pair = ControlClient::connect(&endpoints.control_socket, &endpoints.auth_token)
            .await
            .map_err(|error| {
                format!("the terminal control plane could not be reached: {error:#}")
            })?;
        let index = router.clients.len();
        router.clients.push(pair);
        for session in legacy_group {
            router.by_session.insert(session, index);
        }
    }
    Ok(router)
}

fn terminal_state(state: &DaemonState) -> Value {
    state
        .health_tx
        .borrow()
        .units
        .iter()
        .find(|unit| unit.unit == terminal::UNIT_ID)
        .map_or(Value::Null, |unit| json!(unit.state.to_string()))
}

/// MF-2i — the ROUTE-SNAPSHOT DISCLOSURE rule, in the ONE place both of its
/// readers share (the hello ack and `native.lifecycle.terminal.routes.subscribe`,
/// snapshot and deltas alike). The hello has applied it since TC-S2; the
/// subscription did not, and that disagreement is the defect.
///
/// **An UNREVISED snapshot is not a reading, and is disclosed on no surface.**
/// `{revision: 0, cells: []}` is the watch channel's initial, and TC-D15 gives
/// revision ≥ 1 its own meaning: the cell supervisor's FIRST act is to publish
/// an empty snapshot at revision 1 — "this floor speaks routes; no cell yet" —
/// so that revision is a capability announcement, not just an ordering key
/// (`services/terminal.rs`, `publish_routes_capability`). A floor that has not
/// announced has nothing to say about cells.
///
/// The mesh-flagged in-process serve never announces at all: TC-D3/TC-S2 keep
/// the legacy serve because a cell cannot borrow the floor's tailnet node, so
/// that floor has no cell system, its snapshot never leaves the initial, and its
/// LEGACY `terminal` mirror carries the real endpoints. Publish that initial and
/// it says "this floor has no cells" in the one shape a reader resolves to "no
/// endpoints".
///
/// That is what QA 2026-09-13 (finding 2) hit: the hello withheld the initial
/// and the subscription answered it one message later, so fieldd learned the
/// endpoints from the ack and threw them away — `device.list` answered
/// `terminalHost: false`, Godview said the deck could not reach fieldd, and
/// `terminal.create` refused on a floor that was serving PTYs the whole time.
///
/// ABSENCE is how a withheld snapshot is spelled, not an empty one: it is the
/// pre-TC-S2 shape every reader already tolerates (`HelloAck.terminalRoutes` is
/// optional and `SubscribeResult.snapshot` is `z.unknown()`, so both are
/// contract-legal). TC-D15's state-transfer law is unharmed — a floor with no
/// revision has no state to transfer, and the announcement arrives as an
/// ordinary FULL-snapshot delta the moment it exists, which is also what closes
/// the one window this rule leaves open: a cell floor paired in the instant
/// before its supervisor's first act says nothing about routes on either
/// surface (the hello has always behaved exactly so), and the revision-1 delta
/// repairs that reader without a re-pair.
///
/// The paired reader is `packages/fieldd/src/native-link.ts`
/// (`applyTerminalRoutes`), which refuses the same shape from a floor that
/// predates this rule — this plane outlives fieldd and is adopted by design
/// (GT-2d), so an already-running floor is a reader's problem, not a rebuild's.
fn disclosed_routes(routes: &TerminalRouteSnapshot) -> Option<&TerminalRouteSnapshot> {
    (routes.revision > 0).then_some(routes)
}

/// E-F1 — one stream payload: the disclosed snapshot plus the floor's LIVE
/// terminal-mesh reading, built through the generated contract type so the
/// bytes on the wire are the ones `fixture_parity` pins (EL9).
///
/// The boolean is always PRESENT here, never omitted to mean "unchanged". A
/// reader's tolerance for absence is for floors that predate this field, not a
/// channel this floor uses to say nothing — a live payload that withheld it
/// would be indistinguishable from an old floor's.
fn routes_stream_payload(
    routes: &TerminalRouteSnapshot,
    published: bool,
) -> TerminalRoutesStreamPayload {
    TerminalRoutesStreamPayload {
        revision: routes.revision,
        cells: routes.cells.clone(),
        terminal_mesh: Some(published),
    }
}

/// MF-2i — the routes stream's forwarder: `spawn_forwarder`'s shape with
/// `disclosed_routes` applied to every payload, so a delta can never say what
/// the snapshot was forbidden to say.
///
/// CORRECTED 2026-09-14 (N-L7). This used to justify the rule with two facts in
/// the PRESENT TENSE, one of which had already stopped being a fact: "the
/// in-process serve's channel never moves off its initial" described the
/// mesh-flagged floor TM-1 DELETED. There is one shape left — a cell floor,
/// whose first send IS the revision-1 announcement — so the rule now skips
/// nothing any floor sends, and that was always the point: it holds by
/// construction rather than by the shapes of the day staying as they are. T-M2
/// gives it a driven witness below, which is the stronger form of the same
/// claim.
///
/// E-F1 — and it now forwards a SECOND fact on the same stream: whether this
/// floor's terminal doors are published on the tailnet. Two triggers, and the
/// rule for each is stated here because nothing else states it (T-M2 — the
/// delta path lost its only test when TM-2a retired the withholding row):
///
///   · THE ROUTES MOVED — emit, exactly as before, whenever the new snapshot is
///     a reading (`disclosed_routes`). The revision is the key: an unrevised
///     snapshot is withheld here as it is at the hello, so the two surfaces can
///     never contradict each other. The live boolean rides along.
///   · THE NODE FLIPPED — emit the UNCHANGED snapshot under the NEW boolean,
///     and only when the boolean actually moved. A node watch can wake without
///     moving the composed reading (a flagless floor's node coming up is still
///     "not published"), and a payload that repeated itself would be a delta
///     that says nothing. The revision deliberately does NOT move: it orders
///     ROUTE state, which did not change, and bumping it to announce a
///     different fact would make `revision` mean two things.
///
/// The second trigger is the whole point of E-F1. `HelloAck.terminalMesh` is
/// read once, at a moment it is reliably FALSE — the mesh bring-up task returns
/// before its node exists, while the mgmt listener binds immediately after
/// `start_all` — and nothing re-hellos. Without this push a cold boot with
/// `FIELD_NATIVE_MESH=1 FIELD_NATIVE_TERMINAL_MESH=1` reads false until fieldd
/// re-pairs for some unrelated reason, with no route declared and the phone's
/// card naming a flag that IS set.
fn spawn_routes_forwarder(
    tx: MgmtOutbox,
    mut rx: tokio::sync::watch::Receiver<TerminalRouteSnapshot>,
    mut presence: NodePresence,
    plan: MeshPlan,
    // What the subscribe RESULT conveyed, or `None` when it withheld the
    // snapshot and therefore said nothing about the mesh. This is the dedupe
    // baseline, and it is deliberately "what the READER last learned" rather
    // than "what was last true": with no baseline the first node flip must
    // always be sent, because the reader is still holding the hello's answer.
    sent_at_subscribe: Option<bool>,
    sub_id: String,
) {
    tokio::spawn(async move {
        // THE BASELINE IS WHAT THE SUBSCRIBE RESULT JUST SENT (T-M2). The
        // receiver in `DaemonState` is never itself advanced, so a clone of it
        // arrives here with the channel's INITIAL still marked unseen: the
        // first `changed()` resolves instantly and the forwarder repeats, as a
        // delta, the snapshot the result carried a microsecond earlier. That is
        // harmless under TC-D15's state-transfer law — a full snapshot applied
        // twice is the same state — which is exactly why it survived unnoticed;
        // it is still a delta that reports no change, and E-F1's dedupe needs
        // the baseline to be honest. Marking the current value seen makes the
        // stream's first word a real one.
        let _ = rx.borrow_and_update();
        let mut last_sent = sent_at_subscribe;
        loop {
            enum Woke {
                Routes,
                Node,
                Gone,
            }
            let woke = tokio::select! {
                r = rx.changed() => if r.is_ok() { Woke::Routes } else { Woke::Gone },
                r = presence.changed() => if r.is_ok() { Woke::Node } else { Woke::Gone },
            };
            if matches!(woke, Woke::Gone) {
                break;
            }
            let published = plan.publishes(presence.get());
            if matches!(woke, Woke::Node) && last_sent == Some(published) {
                continue;
            }
            let routes = rx.borrow().clone();
            let Some(snapshot) = disclosed_routes(&routes) else {
                // Withheld: nothing was delivered, so the reader learned
                // nothing and the baseline must NOT move. The revision-1
                // announcement carries the current boolean the moment it exists.
                continue;
            };
            last_sent = Some(published);
            let payload = serde_json::to_value(routes_stream_payload(snapshot, published)).unwrap();
            let note = json!({"jsonrpc":"2.0","method":"native.lifecycle.terminal.routes.delta","params": {"subId": sub_id, "payload": payload}});
            if tx.send(OutMsg::Line(note.to_string())).is_err() {
                break;
            }
        }
    });
}

fn spawn_forwarder<T>(
    tx: MgmtOutbox,
    mut rx: tokio::sync::watch::Receiver<T>,
    method: &'static str,
    sub_id: String,
) where
    T: serde::Serialize + Clone + Send + Sync + 'static,
{
    tokio::spawn(async move {
        while rx.changed().await.is_ok() {
            let payload = serde_json::to_value(&*rx.borrow()).unwrap();
            let note = json!({"jsonrpc":"2.0","method": method, "params": {"subId": sub_id, "payload": payload}});
            if tx.send(OutMsg::Line(note.to_string())).is_err() {
                break;
            }
        }
    });
}

/// What a superseded connection's requests get. The `superseded` notification
/// already told that client why its plane ended; this is the honest answer to
/// anything it asks afterwards, and refusing rather than serving is what keeps a
/// stale fieldd from pruning its successor's sessions.
fn superseded(id: Option<Value>) -> Value {
    err(
        id,
        "UNAUTHORIZED",
        -32001,
        "this connection was superseded by a newer management client",
        false,
        None,
    )
}

fn send(tx: &MgmtOutbox, v: Value) {
    let _ = tx.send(OutMsg::Line(v.to_string()));
}
fn send_raw(tx: &MgmtOutbox, m: OutMsg) {
    let _ = tx.send(m);
}
fn ok(id: Option<Value>, result: Value) -> Value {
    json!({"jsonrpc":"2.0","id": id.unwrap_or(Value::Null), "result": result})
}
fn err(
    id: Option<Value>,
    kind: &str,
    code: i64,
    message: &str,
    retryable: bool,
    details: Option<Value>,
) -> Value {
    let mut data = json!({"kind": kind, "retryable": retryable});
    if let Some(d) = details {
        data["details"] = d;
    }
    json!({"jsonrpc":"2.0","id": id.unwrap_or(Value::Null), "error": {"code": code, "message": message, "data": data}})
}

/// The prune classifier gets unit tests rather than an e2e case for an honest
/// reason: a real terminate failure cannot be forced against a live floor
/// without wedging the service, and every string below is one this exact client
/// produces (`terminal_client.rs`) or one upstream produces
/// (`service.rs:1325-1343`). The happy path stays covered end to end.
#[cfg(test)]
mod tests {
    use super::*;

    /// WP12 L2a (EL7) — the version gate runs before the pairing credential is checked, so its refusal says
    /// nothing of this floor: no server version, no details at all.
    #[test]
    fn a_major_refusal_before_the_credential_carries_no_server_details() {
        assert!(refuse_incompatible_major(CONTRACTS_VERSION, Some(json!(1))).is_none());
        let refusal = refuse_incompatible_major("99.0.0", Some(json!(1)))
            .expect("a foreign major is refused");
        assert_eq!(refusal["error"]["message"], "contracts major mismatch");
        let text = refusal.to_string();
        assert!(
            !text.contains(CONTRACTS_VERSION),
            "the refusal names the server's version: {text}"
        );
        assert!(
            !text.contains("\"server\""),
            "the refusal carries server details: {text}"
        );
    }

    #[test]
    fn an_unknown_session_is_the_ordinary_race() {
        assert_eq!(
            classify_prune_error("terminal control error: unknown session"),
            PruneErrorKind::AlreadyGone
        );
    }

    /// MF-2i — the disclosure rule itself, at the one function both the hello
    /// ack and the routes subscription read it through. The REVISION is the
    /// key, and TC-D15 is what gives it that job: a cell floor ANNOUNCES with
    /// an empty snapshot at revision 1, so an unrevised one is a floor that has
    /// said nothing about routes at all.
    #[test]
    fn an_unrevised_route_snapshot_is_disclosed_on_neither_surface() {
        let initial = TerminalRouteSnapshot {
            revision: 0,
            cells: vec![],
        };
        assert!(
            disclosed_routes(&initial).is_none(),
            "the watch channel's initial must never be published as a floor with no cells"
        );

        // Revision, not emptiness: a revised snapshot IS a reading whether or
        // not a cell is up right now (TC-D15 — empty `cells` is honest state).
        let revised_empty = TerminalRouteSnapshot {
            revision: 1,
            cells: vec![],
        };
        // The generated contract type derives no PartialEq (typify's output is
        // never hand-edited), so identity is the assertion: the rule DISCLOSES,
        // it never rewrites.
        assert!(
            disclosed_routes(&revised_empty).is_some_and(|r| std::ptr::eq(r, &revised_empty)),
            "a revised snapshot is a reading even with no cell up"
        );

        let cell = TerminalRouteCell {
            cell_boot_id: "cell-boot".to_string(),
            cell_instance_id: 1,
            doors: None,
            endpoints: TerminalEndpoints {
                auth_token: "ab".repeat(32),
                control_socket: "/tmp/termctl.1.sock".to_string(),
                frame_socket: "/tmp/termframe.1.sock".to_string(),
            },
            grant_key: None,
            grant_key_generation: None,
            pid: 4242,
            role: None,
            token_generation: 1,
            workload_class: None,
        };
        let revised = TerminalRouteSnapshot {
            revision: 2,
            cells: vec![cell.clone()],
        };
        assert!(disclosed_routes(&revised).is_some_and(|r| std::ptr::eq(r, &revised)));

        // And the reverse of the same key, stated so it cannot drift: rows
        // without a revision are still the initial as far as readers go.
        let unrevised_with_rows = TerminalRouteSnapshot {
            revision: 0,
            cells: vec![cell],
        };
        assert!(disclosed_routes(&unrevised_with_rows).is_none());
    }

    #[test]
    fn unreachability_is_a_real_prune_failure() {
        for message in [
            // the client's own three, verbatim
            "terminal control request timed out",
            "terminal control connection closed before answering",
            "write control request: Broken pipe (os error 32)",
            // an upstream refusal that is NOT already-gone
            "terminal control error: session owner is already closed",
        ] {
            assert_eq!(
                classify_prune_error(message),
                PruneErrorKind::Failed,
                "{message} must not be read as an already-exited session"
            );
        }
    }

    /// T-M2 / E-F1 — THE ROUTES FORWARDER'S RULE, driven directly.
    ///
    /// The delta path lost its only test when TM-2a retired
    /// `the_routes_subscription_withholds_an_unrevised_snapshot_like_the_hello`
    /// and its `recv_within` helper. `disclosed_routes`' SNAPSHOT half kept its
    /// rows; the forwarder was left "holding by construction" with nothing
    /// asserting it, at the same moment E-F1 gave it a second trigger and a
    /// dedupe. This drives a watch from revision zero and pins both.
    ///
    /// THE RULE, in full:
    ///   · an UNREVISED snapshot is withheld — the watch channel's initial is
    ///     not a reading, and rows without a revision are still the initial;
    ///   · a ROUTES move emits once the revision is real;
    ///   · a NODE flip emits the UNCHANGED snapshot at the UNCHANGED revision
    ///     under the new boolean — the revision orders ROUTE state, and moving
    ///     it to announce a different fact would make it mean two things;
    ///   · a node flip that does NOT move the composed reading emits nothing.
    #[tokio::test]
    async fn the_routes_forwarder_withholds_the_initial_and_pushes_a_node_flip_in_place() {
        use crate::services::mesh::NodePresence;
        use std::time::Duration;

        fn cell(id: &str) -> TerminalRouteCell {
            TerminalRouteCell {
                cell_boot_id: id.to_string(),
                cell_instance_id: 1,
                doors: None,
                endpoints: TerminalEndpoints {
                    auth_token: "ab".repeat(32),
                    control_socket: "/tmp/termctl.1.sock".to_string(),
                    frame_socket: "/tmp/termframe.1.sock".to_string(),
                },
                grant_key: None,
                grant_key_generation: None,
                pid: 4242,
                role: None,
                token_generation: 1,
                workload_class: None,
            }
        }

        let (routes_tx, routes_rx) = tokio::sync::watch::channel(TerminalRouteSnapshot {
            revision: 0,
            cells: vec![],
        });
        let (presence_tx, presence_rx) = tokio::sync::watch::channel(false);
        let (tx, mut outbox, _close) = MgmtOutbox::channel();

        // `sent_at_subscribe: None` — the subscribe result withheld the
        // snapshot, so this reader has been told nothing about the mesh and its
        // first node flip must never be deduped away.
        spawn_routes_forwarder(
            tx,
            routes_rx,
            NodePresence::for_tests(presence_rx),
            MeshPlan::Requested,
            None,
            "s-test".to_string(),
        );

        async fn next_payload(
            outbox: &mut tokio::sync::mpsc::Receiver<OutMsg>,
        ) -> Option<serde_json::Value> {
            let msg = tokio::time::timeout(Duration::from_millis(400), outbox.recv())
                .await
                .ok()??;
            let OutMsg::Line(line) = msg else {
                panic!("the forwarder never closes the outbox");
            };
            let note: Value = serde_json::from_str(&line).expect("a JSON notification");
            assert_eq!(note["method"], "native.lifecycle.terminal.routes.delta");
            Some(note["params"]["payload"].clone())
        }

        // (1) the INITIAL, moved but still unrevised: rows without a revision
        // are the initial as far as readers go, so nothing may be published.
        routes_tx.send_replace(TerminalRouteSnapshot {
            revision: 0,
            cells: vec![cell("cb-early")],
        });
        assert!(
            next_payload(&mut outbox).await.is_none(),
            "an unrevised snapshot is not a reading, however many rows it carries"
        );

        // (2) a node flip while unrevised publishes nothing either — there is
        // no payload to carry a boolean on.
        presence_tx.send_replace(true);
        assert!(
            next_payload(&mut outbox).await.is_none(),
            "a floor that has said nothing about routes says nothing about the mesh"
        );

        // (3) the REVISION moves: the first real reading, carrying the node
        // state that flipped silently in (2).
        routes_tx.send_replace(TerminalRouteSnapshot {
            revision: 1,
            cells: vec![cell("cb-1")],
        });
        let payload = next_payload(&mut outbox)
            .await
            .expect("a revised snapshot publishes");
        assert_eq!(payload["revision"], 1);
        assert_eq!(
            payload["terminalMesh"], true,
            "the first delivered payload carries the CURRENT reading, not the one \
             that was true when the subscription started"
        );

        // (4) a node flip IN PLACE: same revision, new boolean. This is the
        // whole of E-F1 — the correction the hello could not make.
        presence_tx.send_replace(false);
        let payload = next_payload(&mut outbox)
            .await
            .expect("a node flip publishes");
        assert_eq!(
            payload["revision"], 1,
            "a node flip changes no route state, so the revision must not move"
        );
        assert_eq!(payload["terminalMesh"], false);
        assert_eq!(
            payload["cells"][0]["cellBootId"], "cb-1",
            "the push carries the unchanged snapshot, not a bare boolean"
        );

        // (5) a node flip that does not move the READING is silent. The watch
        // really moves here — it is the composition that does not, because the
        // value is the one already delivered.
        presence_tx.send_replace(false);
        assert!(
            next_payload(&mut outbox).await.is_none(),
            "a reading that did not move is not a delta"
        );
    }
}
