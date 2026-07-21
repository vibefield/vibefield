//! Management-channel server (design-02 §2.7): newline JSON-RPC over UDS,
//! hello-gated (D8), single authenticated client (new hello ⇒ SUPERSEDED),
//! snapshot-then-delta subscriptions (P5). Serves the M2 lifecycle surface +
//! the C2 mesh facade (mesh.rs); mesh calls answer UNAVAILABLE with the unit's
//! real state until the node is up.

mod mesh;

use crate::contracts::{DesiredState, Hello};
use crate::pairing;
use crate::state::{ClientHandle, DaemonState, OutMsg};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::mpsc;

const CONTRACTS_VERSION: &str = "0.1.0";

pub async fn serve(listener: UnixListener, state: Arc<DaemonState>) {
    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let state = state.clone();
                tokio::spawn(async move { handle_conn(stream, state).await });
            }
            Err(e) => {
                tracing::error!(error = %e, "mgmt accept failed");
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
            send(&tx, json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"parse error"}}));
            continue;
        };
        let id = req.get("id").cloned();
        let method = req.get("method").and_then(Value::as_str).unwrap_or_default().to_string();
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
                send(&tx, err(id, "UNAUTHORIZED", -32001, "hello required first", false, None));
            }
            "native.lifecycle.health.subscribe" => {
                let sub_id = state.sub_id();
                let snapshot = serde_json::to_value(&*state.health_tx.borrow()).unwrap();
                send(&tx, ok(id, json!({"subId": sub_id, "snapshot": snapshot})));
                spawn_forwarder(tx.clone(), state.health_tx.subscribe(), "native.lifecycle.health.delta", sub_id);
            }
            "native.lifecycle.observed.subscribe" => {
                let sub_id = state.sub_id();
                let snapshot = serde_json::to_value(&*state.observed_tx.borrow()).unwrap();
                send(&tx, ok(id, json!({"subId": sub_id, "snapshot": snapshot})));
                spawn_forwarder(tx.clone(), state.observed_tx.subscribe(), "native.lifecycle.observed.delta", sub_id);
            }
            "native.lifecycle.desired.set" => {
                send(&tx, handle_desired_set(&state, &params, id).await);
            }
            m if m.starts_with("native.mesh.") => {
                mesh::handle(&state, &tx, m, &params, id).await;
            }
            m if m.starts_with("native.process.") || m.starts_with("native.sidecar.") => {
                send(&tx, err(id, "UNAVAILABLE", -32006, "unit not embedded yet",
                    true, Some(json!({"service": m.split('.').nth(1).unwrap_or("native"), "state":"stub"}))));
            }
            _ => {
                send(&tx, err(id, "NOT_FOUND", -32601, "method not found", false, None));
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
            return (err(id, "PRECONDITION_FAILED", -32005, &format!("bad hello: {e}"), false, None), false)
        }
    };

    // version gate: major must match (0.x line — tolerant within it, P3)
    let ours_major = CONTRACTS_VERSION.split('.').next().unwrap_or("0");
    let theirs = hello.contracts_version.to_string();
    if theirs.split('.').next().unwrap_or("") != ours_major {
        return (err(id, "INCOMPATIBLE", -32008, "contracts major mismatch", false,
            Some(json!({"server": CONTRACTS_VERSION, "client": theirs}))), false);
    }

    // D8 pairing credential (read from raw params — variant-name independent)
    let cred = params.get("credential");
    let (Some(boot_id), Some(ts), Some(mac)) = (
        cred.and_then(|c| c.get("bootId")).and_then(Value::as_str),
        cred.and_then(|c| c.get("ts")).and_then(Value::as_i64),
        cred.and_then(|c| c.get("mac")).and_then(Value::as_str),
    ) else {
        return (err(id, "UNAUTHORIZED", -32001, "pairing credential required", false, None), false);
    };
    if !pairing::verify(&state.secret, boot_id, ts, mac, pairing::now_epoch_secs()) {
        return (err(id, "UNAUTHORIZED", -32001, "pairing verification failed", false, None), false);
    }

    // single-client rule: supersede any existing product plane
    let mut cur = state.current_client.lock().await;
    if let Some(old) = cur.take() {
        let _ = old.tx.send(OutMsg::Line(
            json!({"jsonrpc":"2.0","method":"native.lifecycle.superseded","params":{"reason":"new hello"}})
                .to_string(),
        ));
        let _ = old.tx.send(OutMsg::Close);
        tracing::info!(old = old.conn_id, new = conn_id, "mgmt client superseded");
    }
    *cur = Some(ClientHandle { conn_id, tx: tx.clone() });

    let ack = json!({
        "contractsVersion": CONTRACTS_VERSION,
        "serverKind": "field-native",
        "grantedScopes": [],
    });
    (ok(id, ack), true)
}

async fn handle_desired_set(state: &Arc<DaemonState>, params: &Value, id: Option<Value>) -> Value {
    let desired: DesiredState = match serde_json::from_value(params.clone()) {
        Ok(d) => d,
        Err(e) => return err(id, "PRECONDITION_FAILED", -32005, &format!("bad desired state: {e}"), false, None),
    };
    let mut slot = state.desired.lock().await;
    if let Some(cur) = slot.as_ref() {
        if desired.generation < cur.generation {
            return err(id, "PRECONDITION_FAILED", -32005, "stale generation", false,
                Some(json!({"current": cur.generation, "given": desired.generation})));
        }
    }
    let generation = desired.generation;
    *slot = Some(desired);
    drop(slot);
    // skeleton reconciliation: no real units yet — observed tracks the applied generation
    state.observed_tx.send_modify(|o| o.generation = generation);
    ok(id, json!({"applied": generation}))
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
fn err(id: Option<Value>, kind: &str, code: i64, message: &str, retryable: bool, details: Option<Value>) -> Value {
    let mut data = json!({"kind": kind, "retryable": retryable});
    if let Some(d) = details {
        data["details"] = d;
    }
    json!({"jsonrpc":"2.0","id": id.unwrap_or(Value::Null), "error": {"code": code, "message": message, "data": data}})
}
