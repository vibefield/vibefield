//! native.mesh.* facade (C2, design-02 §2.4): peers / store / serve backed by
//! the MeshUnit's node. Honesty rules:
//! - no node yet (disabled / starting / auth-required / degraded) → UNAVAILABLE
//!   carrying the unit's REAL state (+authUrl when present);
//! - store ops work the moment the node exists (offline-tolerant by design —
//!   local slice writes sync when peers appear);
//! - serve requires Running: truffle's NotRunning maps to UNAVAILABLE.
//!
//! Handlers send their own responses (subscribe paths must order the response
//! line before any forwarded event).

use crate::services::mesh::{JsonStore, MeshNode};
use crate::state::{DaemonState, OutMsg};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::mpsc;
use truffle_core::proxy::ProxyConfig;
use truffle_core::session::PeerEvent;
use truffle_core::synced_store::StoreEvent;

use super::{err, ok, send};

type Tx = mpsc::UnboundedSender<OutMsg>;

pub async fn handle(state: &Arc<DaemonState>, tx: &Tx, method: &str, params: &Value, id: Option<Value>) {
    let Some(node) = state.mesh.node().await else {
        send(tx, unavailable(state, id));
        return;
    };
    let resp = match method {
        "native.mesh.peers.list" => ok(id, json!({ "peers": list_peers(&node).await })),
        "native.mesh.peers.subscribe" => {
            let sub_id = state.sub_id();
            let snapshot = json!({ "peers": list_peers(&node).await });
            send(tx, ok(id, json!({"subId": sub_id, "snapshot": snapshot})));
            spawn_peer_forwarder(tx.clone(), node, sub_id);
            return;
        }
        "native.mesh.store.open" | "native.mesh.store.get" | "native.mesh.store.set" => {
            let Some(store_id) = params.get("storeId").and_then(Value::as_str) else {
                send(tx, err(id, "PRECONDITION_FAILED", -32005, "storeId required", false, None));
                return;
            };
            let store = state.mesh.open_store(&node, store_id).await;
            match method {
                "native.mesh.store.open" => ok(id, store_snapshot(&store).await),
                "native.mesh.store.get" => {
                    match params.get("deviceId").and_then(Value::as_str) {
                        Some(dev) => {
                            let slice = store.get(dev).await.map(|s| serde_json::to_value(s).unwrap());
                            ok(id, json!({"storeId": store_id, "deviceId": dev, "slice": slice}))
                        }
                        None => ok(id, json!({"storeId": store_id, "deviceId": store.device_id(), "data": store.local().await})),
                    }
                }
                _ => {
                    let Some(data) = params.get("data") else {
                        send(tx, err(id, "PRECONDITION_FAILED", -32005, "data required", false, None));
                        return;
                    };
                    store.set(data.clone()).await;
                    ok(id, json!({"storeId": store_id, "version": store.version()}))
                }
            }
        }
        "native.mesh.store.subscribe" => {
            let Some(store_id) = params.get("storeId").and_then(Value::as_str) else {
                send(tx, err(id, "PRECONDITION_FAILED", -32005, "storeId required", false, None));
                return;
            };
            let store = state.mesh.open_store(&node, store_id).await;
            let sub_id = state.sub_id();
            send(tx, ok(id, json!({"subId": sub_id, "snapshot": store_snapshot(&store).await})));
            spawn_store_forwarder(tx.clone(), store, sub_id);
            return;
        }
        "native.mesh.serve.add" => serve_add(state, &node, params, id).await,
        "native.mesh.serve.remove" => {
            let Some(name) = params.get("name").and_then(Value::as_str) else {
                send(tx, err(id, "PRECONDITION_FAILED", -32005, "name required", false, None));
                return;
            };
            match node.proxy().remove(name).await {
                Ok(()) => {
                    state.mesh.forget_serve(name).await;
                    ok(id, json!({"removed": true}))
                }
                Err(e) => map_node_err(state, id, &e.to_string()),
            }
        }
        "native.mesh.serve.list" => {
            let mut serves = Vec::new();
            for info in node.proxy().list() {
                let cfg = state.mesh.serve_config(&info.name).await;
                serves.push(json!({
                    "name": info.name,
                    "target": cfg.as_ref().and_then(|c| c.get("target")).cloned(),
                    "url": info.url,
                    "allow": cfg.as_ref().and_then(|c| c.get("allow")).cloned(),
                }));
            }
            ok(id, json!({"serves": serves}))
        }
        _ => err(id, "NOT_FOUND", -32601, "method not found", false, None),
    };
    send(tx, resp);
}

/// UNAVAILABLE carrying the mesh unit's live state (+authUrl) — the C1 shape.
fn unavailable(state: &Arc<DaemonState>, id: Option<Value>) -> Value {
    let (mesh_state, auth_url) = {
        let h = state.health_tx.borrow();
        h.units
            .iter()
            .find(|u| u.unit == "mesh-gateway")
            .map(|u| (u.state.to_string(), u.auth_url.clone()))
            .unwrap_or_else(|| ("unknown".into(), None))
    };
    let mut details = json!({"service":"mesh-gateway","state": mesh_state});
    if let Some(url) = auth_url {
        details["authUrl"] = json!(url);
    }
    err(id, "UNAVAILABLE", -32006, "mesh node not up", true, Some(details))
}

/// truffle errors → wire errors. NotRunning is transient (auth/network) → UNAVAILABLE.
fn map_node_err(state: &Arc<DaemonState>, id: Option<Value>, msg: &str) -> Value {
    if msg.contains("not running") || msg.contains("NotRunning") {
        return unavailable(state, id);
    }
    err(id, "INTERNAL", -32000, msg, false, None)
}

async fn list_peers(node: &Arc<MeshNode>) -> Vec<Value> {
    node.peers()
        .await
        .into_iter()
        .map(|p| {
            json!({
                "id": p.tailscale_id,
                "name": p.display_name,
                "online": p.online,
                "addresses": [p.ip.to_string()],
                // passthrough extras (P3 — tolerant readers keep them)
                "deviceId": p.device_id,
                "deviceName": p.device_name,
                "hostname": p.hostname,
                "connectionType": p.connection_type,
                "lastSeen": p.last_seen,
            })
        })
        .collect()
}

async fn store_snapshot(store: &Arc<JsonStore>) -> Value {
    let slices: serde_json::Map<String, Value> = store
        .all()
        .await
        .into_iter()
        .map(|(dev, slice)| (dev, serde_json::to_value(slice).unwrap()))
        .collect();
    json!({"storeId": store.store_id(), "slices": slices})
}

async fn serve_add(state: &Arc<DaemonState>, node: &Arc<MeshNode>, params: &Value, id: Option<Value>) -> Value {
    let Some(name) = params.get("name").and_then(Value::as_str) else {
        return err(id, "PRECONDITION_FAILED", -32005, "name required", false, None);
    };
    let target = params.get("target").cloned().unwrap_or(Value::Null);
    let allow = params.get("allow").cloned().unwrap_or_else(|| json!([]));
    let cfg_json = match target.get("kind").and_then(Value::as_str) {
        Some("port") => {
            let Some(port) = target.get("port").and_then(Value::as_u64) else {
                return err(id, "PRECONDITION_FAILED", -32005, "target.port required", false, None);
            };
            json!({
                "id": name, "name": name, "listen_port": port,
                "target": {"host": "127.0.0.1", "port": port, "scheme": "http"},
                "allow": allow, "routes": [],
            })
        }
        Some("dir") => {
            let Some(path) = target.get("path").and_then(Value::as_str) else {
                return err(id, "PRECONDITION_FAILED", -32005, "target.path required", false, None);
            };
            json!({
                "id": name, "name": name, "listen_port": 0,
                "allow": allow,
                "routes": [{"prefix": "/", "dir": path}],
            })
        }
        _ => return err(id, "PRECONDITION_FAILED", -32005, "target.kind must be port|dir", false, None),
    };
    let cfg: ProxyConfig = match serde_json::from_value(cfg_json) {
        Ok(c) => c,
        Err(e) => return err(id, "INTERNAL", -32000, &format!("proxy config: {e}"), false, None),
    };
    match node.proxy().add(cfg).await {
        Ok(info) => {
            state
                .mesh
                .record_serve(name, json!({"target": target, "allow": allow}))
                .await;
            ok(id, json!({"name": name, "target": target, "url": info.url, "allow": allow}))
        }
        Err(e) => map_node_err(state, id, &e.to_string()),
    }
}

fn spawn_peer_forwarder(tx: Tx, node: Arc<MeshNode>, sub_id: String) {
    tokio::spawn(async move {
        let mut rx = node.on_peer_change();
        loop {
            match rx.recv().await {
                Ok(ev) => {
                    if matches!(ev, PeerEvent::AuthRequired { .. }) {
                        continue; // surfaced via health, not the peer list
                    }
                    // coalesce bursts, then re-project the full list (self-healing)
                    while rx.try_recv().is_ok() {}
                    let payload = json!({ "peers": list_peers(&node).await });
                    let note = json!({"jsonrpc":"2.0","method":"native.mesh.peers.delta","params":{"subId": sub_id, "payload": payload}});
                    if tx.send(OutMsg::Line(note.to_string())).is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue, // next event re-projects anyway
                Err(_) => break,
            }
        }
    });
}

fn spawn_store_forwarder(tx: Tx, store: Arc<JsonStore>, sub_id: String) {
    tokio::spawn(async move {
        let mut rx = store.subscribe();
        loop {
            match rx.recv().await {
                Ok(ev) => {
                    let payload = match ev {
                        StoreEvent::LocalChanged(data) => {
                            json!({"kind": "localChanged", "deviceId": store.device_id(), "data": data})
                        }
                        StoreEvent::PeerUpdated { device_id, data, version } => {
                            json!({"kind": "peerUpdated", "deviceId": device_id, "data": data, "version": version})
                        }
                        StoreEvent::PeerRemoved { device_id } => {
                            json!({"kind": "peerRemoved", "deviceId": device_id})
                        }
                        _ => continue, // tolerant: future event kinds don't break the stream
                    };
                    let note = json!({"jsonrpc":"2.0","method":"native.mesh.store.delta","params":{"subId": sub_id, "payload": payload}});
                    if tx.send(OutMsg::Line(note.to_string())).is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    // dropped events → fresh snapshot (P5: server may re-snapshot)
                    let note = json!({"jsonrpc":"2.0","method":"native.mesh.store.snapshot","params":{"subId": sub_id, "payload": store_snapshot(&store).await}});
                    if tx.send(OutMsg::Line(note.to_string())).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
}
