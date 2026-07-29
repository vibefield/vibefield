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

mod diagnostics;
mod mesh;

use crate::contracts::{DesiredState, Hello};
use crate::pairing;
use crate::services::terminal;
use crate::services::terminal_client::ControlClient;
use crate::state::{ClientHandle, DaemonState, OutMsg};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::Path;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::mpsc;

const CONTRACTS_VERSION: &str = "0.1.0";

/// How a reconcile prune classifies the exits it causes. `TerminationSource` is
/// a kebab-case wire enum with exactly three variants (session.rs:39-46) and
/// `classify_exit` maps this one to `ExitOutcome::ApplicationTerminated`
/// (session.rs:69-83), which is what every observer of the prune will read.
///
/// The choice among the three, recorded because it is a judgement:
/// * `user` — a human's kill, which is what `terminal.terminate` will carry
///   (NF-D5). A reconcile is not a human act; claiming it were would put a
///   person behind a decision fieldd's bookkeeping made.
/// * `service-shutdown` — reserved for the NF-D3 sweep (`terminal.rs`'s
///   `SWEEP_SOURCE`), and it asserts field-native is going down. Here it would
///   be a lie: the floor keeps serving, and the survivors keep running.
/// * `application` — the application above this floor (fieldd) withdrew the
///   session from its desired set. That is exactly what happened, so this is the
///   honest stamp.
const PRUNE_SOURCE: &str = "application";

pub async fn serve(listener: UnixListener, state: Arc<DaemonState>) {
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let state = state.clone();
                tokio::spawn(async move { handle_conn(stream, state).await });
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

async fn handle_conn(stream: UnixStream, state: Arc<DaemonState>) {
    let conn_id = state.conn_id();
    let (read_half, mut write_half) = stream.into_split();
    let (tx, mut rx) = mpsc::unbounded_channel::<OutMsg>();

    // single writer task; Close tears the socket down
    let writer = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            match msg {
                OutMsg::Line(mut line) => {
                    line.push('\n');
                    if write_half.write_all(line.as_bytes()).await.is_err() {
                        break;
                    }
                }
                OutMsg::Close => break,
            }
        }
        let _ = write_half.shutdown().await;
    });

    let mut lines = BufReader::new(read_half).lines();
    let mut authed = false;

    while let Ok(Some(line)) = lines.next_line().await {
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
            "native.lifecycle.desired.set" => {
                send(&tx, handle_desired_set(&state, &params, id).await);
            }
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
                mesh::handle(&state, &tx, m, &params, id).await;
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

async fn handle_hello(
    state: &Arc<DaemonState>,
    conn_id: u64,
    tx: &mpsc::UnboundedSender<OutMsg>,
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
    let ours_major = CONTRACTS_VERSION.split('.').next().unwrap_or("0");
    let theirs = hello.contracts_version.to_string();
    if theirs.split('.').next().unwrap_or("") != ours_major {
        return (
            err(
                id,
                "INCOMPATIBLE",
                -32009,
                "contracts major mismatch",
                false,
                Some(json!({"server": CONTRACTS_VERSION, "client": theirs})),
            ),
            false,
        );
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
    });
    // NF-D8: the terminal floor's endpoints ride the hello, so fieldd re-learns
    // them at every re-pair and they never enter env, config, or logs. Field
    // names come from the generated contract type, never retyped here. Absent
    // when no terminal unit is configured — tolerated by readers.
    if let Some(endpoints) = state.terminal.get() {
        ack["terminal"] = serde_json::to_value(endpoints).expect("terminal endpoints serialize");
    }
    (ok(id, ack), true)
}

async fn handle_desired_set(state: &Arc<DaemonState>, params: &Value, id: Option<Value>) -> Value {
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
    // Persistence re-policy belongs HERE in spec §5's order (between the guard
    // and the prune) and is not implementable against the pinned ghosttea 0.6.0:
    // no control op changes a live session's policy. Verified in the crate rather
    // than assumed — the `Command` enum's 27 variants carry none
    // (service.rs:142-281), `Session::persistence` is a read-only accessor
    // (session.rs:1031-1033) over a field written once at construction
    // (session.rs:314/611), and persistence enters only as a spawn-time
    // `SessionOptions` input (session.rs:227). So `DesiredTerminal.persistence`
    // is accepted and carried, never pretended to be applied; the G9 ask
    // (spec §12) is what makes re-policy real, and it fills
    // `ObservedTerminal.persistence` in the same stroke.

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
        // The prune is the terminal plane's to execute. Without endpoints there
        // is no plane to execute it on, so the honest answer is that the work
        // did not happen — never a success that killed nothing. (Inventory would
        // normally be empty in that state; the guard states the law regardless.)
        let Some(endpoints) = state.terminal.get() else {
            return err(
                id,
                "UNAVAILABLE",
                -32006,
                "the terminal plane has no endpoints, so the prune cannot be executed",
                true,
                Some(json!({
                    "service": terminal::UNIT_ID,
                    "state": terminal_state(state),
                    "wouldPrune": prune.len(),
                })),
            );
        };
        // Dialing BEFORE anything is recorded: a plane that cannot be reached
        // must refuse the whole set rather than bank a generation whose prune
        // never ran.
        let client = match ControlClient::connect(
            Path::new(&endpoints.control_socket),
            &endpoints.auth_token,
        )
        .await
        {
            Ok((client, _events)) => client,
            Err(error) => {
                tracing::warn!(
                    event = "field_native.lifecycle.prune_unreachable",
                    component = "mgmt",
                    generation = desired.generation,
                    error = %error,
                    "The terminal control plane could not be reached; the desired set was refused"
                );
                return err(
                    id,
                    "UNAVAILABLE",
                    -32006,
                    "the terminal control plane could not be reached, so the prune was not executed",
                    true,
                    Some(json!({
                        "service": terminal::UNIT_ID,
                        "state": terminal_state(state),
                        "wouldPrune": prune.len(),
                    })),
                );
            }
        };

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
        for session_id in &prune {
            // Fire the ladder and move on. Upstream's `terminate` starts it on
            // its own thread and returns (session.rs:1558-1584), so the ladders
            // overlap and this response never waits on an exit — the inventory
            // pump is what reports convergence. A session that already exited or
            // was never known is the ordinary race between fieldd's view and this
            // floor's, so it is debug and not an error: the desired end state
            // (that session is not running) already holds.
            if let Err(error) = client.terminate(session_id, PRUNE_SOURCE).await {
                tracing::debug!(
                    event = "field_native.lifecycle.prune_terminate_skipped",
                    component = "mgmt",
                    session_id = %session_id,
                    error = %error,
                    "A pruned session did not accept termination; it had most likely already exited"
                );
            }
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
    *slot = Some(desired);
    drop(slot);
    state.observed_tx.send_modify(|o| o.generation = generation);
    tracing::info!(
        event = "field_native.lifecycle.desired_applied",
        component = "mgmt",
        generation,
        listed,
        pruned = prune.len(),
        "The desired native state generation was applied"
    );
    ok(id, json!({"applied": generation}))
}

/// The terminal unit's REAL state for an `UNAVAILABLE` detail — the same law the
/// mesh facade follows (C1: details carry the unit's state, never a literal).
/// Read from the health the unit itself publishes; `null` only if the unit was
/// never registered at all.
fn terminal_state(state: &DaemonState) -> Value {
    state
        .health_tx
        .borrow()
        .units
        .iter()
        .find(|unit| unit.unit == terminal::UNIT_ID)
        .map_or(Value::Null, |unit| json!(unit.state.to_string()))
}

fn spawn_forwarder<T>(
    tx: mpsc::UnboundedSender<OutMsg>,
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

fn send(tx: &mpsc::UnboundedSender<OutMsg>, v: Value) {
    let _ = tx.send(OutMsg::Line(v.to_string()));
}
fn send_raw(tx: &mpsc::UnboundedSender<OutMsg>, m: OutMsg) {
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
