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
use crate::services::mesh_bridge::{Lane, LaneClass, LaneEvent, INBOUND_LANE_ID_BASE};
use crate::state::{DaemonState, OutMsg};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::{broadcast, mpsc};
use truffle_core::proxy::{ProxyConfig, ProxyEvent, ProxyRoute, ProxyStatus, ProxyTarget};
use truffle_core::session::PeerEvent;
use truffle_core::synced_store::StoreEvent;

use super::{err, ok, send};

type Tx = mpsc::UnboundedSender<OutMsg>;

pub async fn handle(
    state: &Arc<DaemonState>,
    tx: &Tx,
    method: &str,
    params: &Value,
    id: Option<Value>,
) {
    // Lane control is answered BEFORE the node gate, and not for tidiness:
    // `lane.close` has to work when the mesh is down, because that is exactly
    // when fieldd is tearing lanes down. Gating it behind a live node would
    // make cleanup impossible in the one state that needs it (D5: lanes are
    // cheap and mortal).
    if method.starts_with("native.mesh.lane.") {
        handle_lane(state, tx, method, params, id).await;
        return;
    }
    let Some(node) = state.mesh.node() else {
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
                send(
                    tx,
                    err(
                        id,
                        "PRECONDITION_FAILED",
                        -32005,
                        "storeId required",
                        false,
                        None,
                    ),
                );
                return;
            };
            let store = state.mesh.open_store(&node, store_id).await;
            match method {
                "native.mesh.store.open" => ok(id, store_snapshot(&store).await),
                "native.mesh.store.get" => match params.get("deviceId").and_then(Value::as_str) {
                    Some(dev) => {
                        let slice = store
                            .get(dev)
                            .await
                            .map(|s| serde_json::to_value(s).unwrap());
                        ok(
                            id,
                            json!({"storeId": store_id, "deviceId": dev, "slice": slice}),
                        )
                    }
                    None => ok(
                        id,
                        json!({"storeId": store_id, "deviceId": store.device_id(), "data": store.local().await}),
                    ),
                },
                _ => {
                    let Some(data) = params.get("data") else {
                        send(
                            tx,
                            err(
                                id,
                                "PRECONDITION_FAILED",
                                -32005,
                                "data required",
                                false,
                                None,
                            ),
                        );
                        return;
                    };
                    store.set(data.clone()).await;
                    ok(id, json!({"storeId": store_id, "version": store.version()}))
                }
            }
        }
        "native.mesh.store.subscribe" => {
            let Some(store_id) = params.get("storeId").and_then(Value::as_str) else {
                send(
                    tx,
                    err(
                        id,
                        "PRECONDITION_FAILED",
                        -32005,
                        "storeId required",
                        false,
                        None,
                    ),
                );
                return;
            };
            let store = state.mesh.open_store(&node, store_id).await;
            let sub_id = state.sub_id();
            send(
                tx,
                ok(
                    id,
                    json!({"subId": sub_id, "snapshot": store_snapshot(&store).await}),
                ),
            );
            spawn_store_forwarder(tx.clone(), store, sub_id);
            return;
        }
        "native.mesh.serve.add" => serve_add(state, &node, params, id).await,
        "native.mesh.serve.remove" => {
            let Some(serve_id) = params
                .get("serveId")
                .or_else(|| params.get("name"))
                .and_then(Value::as_str)
            else {
                send(
                    tx,
                    err(
                        id,
                        "PRECONDITION_FAILED",
                        -32005,
                        "serveId required",
                        false,
                        None,
                    ),
                );
                return;
            };
            match node.proxy().remove(serve_id).await {
                Ok(()) => {
                    state.mesh.forget_serve(serve_id).await;
                    ok(id, json!({"serveId": serve_id, "removed": true}))
                }
                Err(e) => map_node_err(state, id, &e.to_string()),
            }
        }
        "native.mesh.serve.list" => ok(id, json!({"serves": serve_entries(state, &node).await})),
        "native.mesh.serve.subscribe" => {
            let sub_id = state.sub_id();
            let snapshot = json!({"serves": serve_entries(state, &node).await});
            send(tx, ok(id, json!({"subId": sub_id, "snapshot": snapshot})));
            spawn_serve_forwarder(state.clone(), tx.clone(), node, sub_id);
            return;
        }
        _ => err(id, "NOT_FOUND", -32601, "method not found", false, None),
    };
    send(tx, resp);
}

/// native.mesh.lane.* — CONTROL ONLY (D5). Every byte a lane carries rides
/// meshdata.sock; nothing below touches a payload, which is what keeps EL2
/// structural rather than promised.
async fn handle_lane(
    state: &Arc<DaemonState>,
    tx: &Tx,
    method: &str,
    params: &Value,
    id: Option<Value>,
) {
    let resp = match method {
        "native.mesh.lane.open" => {
            let (Some(lane_id), Some(class), Some(peer), Some(protocol)) = (
                params.get("laneId").and_then(Value::as_u64),
                params
                    .get("class")
                    .and_then(Value::as_str)
                    .and_then(LaneClass::parse),
                params.get("peer").and_then(Value::as_str),
                params.get("protocol").and_then(Value::as_str),
            ) else {
                send(
                    tx,
                    err(
                        id,
                        "PRECONDITION_FAILED",
                        -32005,
                        "lane.open needs laneId, class, peer, protocol",
                        false,
                        None,
                    ),
                );
                return;
            };
            // The numbering split is a LAW, so the door enforces it rather than
            // trusting fieldd's discipline. Above the base, a caller would be
            // squatting in the space inbound lanes are minted from; past 2^53 it
            // would get an id that does not survive JSON.parse on the way back.
            if lane_id >= INBOUND_LANE_ID_BASE {
                send(
                    tx,
                    err(
                        id,
                        "PRECONDITION_FAILED",
                        -32005,
                        &format!(
                            "laneId {lane_id} is at or above {INBOUND_LANE_ID_BASE}, which is \
                             reserved for lanes peers open toward us"
                        ),
                        false,
                        None,
                    ),
                );
                return;
            }
            // A lane needs somewhere to go. Without a node the honest answer is
            // the mesh unit's real state, not a lane that silently goes nowhere.
            if state.mesh.node().is_none() {
                send(tx, unavailable(state, id));
                return;
            }
            let lane = Lane {
                lane_id,
                class,
                peer: peer.to_string(),
                protocol: protocol.to_string(),
                doc_id: params
                    .get("docId")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                inbound: false,
            };
            match state.bridge.open_lane(lane).await {
                Ok(()) => ok(id, json!({ "laneId": lane_id })),
                // A duplicate id is the caller losing track of its own
                // numbering, which is a precondition failure rather than a
                // transport one — and never a silent reuse.
                Err(e) => err(
                    id,
                    "PRECONDITION_FAILED",
                    -32005,
                    &e.to_string(),
                    false,
                    None,
                ),
            }
        }
        "native.mesh.lane.close" => {
            let Some(lane_id) = params.get("laneId").and_then(Value::as_u64) else {
                send(
                    tx,
                    err(
                        id,
                        "PRECONDITION_FAILED",
                        -32005,
                        "lane.close needs laneId",
                        false,
                        None,
                    ),
                );
                return;
            };
            match state.bridge.close_lane(lane_id).await {
                Ok(()) => ok(id, json!({ "laneId": lane_id })),
                Err(e) => err(id, "INTERNAL", -32000, &e.to_string(), false, None),
            }
        }
        // Lane lifecycle, snapshot-then-delta (P5). Deliberately NOT gated on a
        // live node: fieldd subscribes at boot and must be listening BEFORE the
        // mesh comes up, or it misses the first peer that opens a lane.
        "native.mesh.lane.subscribe" => {
            let sub_id = state.sub_id();
            let events = state.bridge.subscribe_events();
            let snapshot =
                json!({"lanes": state.bridge.lanes().iter().map(lane_json).collect::<Vec<_>>()});
            // Subscribe BEFORE snapshotting, respond BEFORE forwarding: a lane
            // opened in between is then a duplicate rather than a miss, and a
            // duplicate is the recoverable one (fieldd keys lanes by id).
            send(tx, ok(id, json!({"subId": sub_id, "snapshot": snapshot})));
            spawn_lane_forwarder(state.clone(), tx.clone(), events, sub_id);
            return;
        }
        _ => err(id, "NOT_FOUND", -32601, "unknown lane method", false, None),
    };
    send(tx, resp);
}

/// One live lane as the contracts see it (mgmt.ts `MeshLanePeerOpened` for the
/// inbound shape). `whois` is absent, not empty: truffle's `Peer` carries no
/// tailnet user login, and synthesizing one would fabricate identity (EL7,
/// same finding as `list_peers`). It arrives when upstream's `whois(ip)` does.
fn lane_json(lane: &Lane) -> Value {
    let mut v = json!({
        "laneId": lane.lane_id,
        "class": lane.class.as_str(),
        "peer": lane.peer,
        "protocol": lane.protocol,
    });
    if lane.inbound {
        v["inbound"] = json!(true);
    }
    if let Some(doc_id) = &lane.doc_id {
        v["docId"] = json!(doc_id);
    }
    v
}

/// Forwards lane lifecycle to the subscriber. A lagging consumer gets a fresh
/// snapshot rather than a gap (P5) — the lane TABLE is the truth, and the
/// events are only how it is learned promptly.
///
/// ONE `.delta` METHOD CARRYING A `kind`, not a method per event. Not cosmetic:
/// fieldd's NativeLink routes a notification to its subscription only when the
/// method ends in `.delta` or `.snapshot` (native-link.ts). `lane.peerOpened`
/// went out on the wire and was dropped on the floor with no error anywhere —
/// found by writing the consumer, not by testing the producer, because both
/// halves were internally consistent and only disagreed with each other.
/// design-02 §2.4's `lane.peerOpened` / `lane.closed` survive as the kind
/// values, which is where the vocabulary belongs.
fn spawn_lane_forwarder(
    state: Arc<DaemonState>,
    tx: Tx,
    mut events: broadcast::Receiver<LaneEvent>,
    sub_id: String,
) {
    tokio::spawn(async move {
        loop {
            let note = match events.recv().await {
                Ok(LaneEvent::PeerOpened(lane)) => {
                    let mut payload = lane_json(&lane);
                    payload["kind"] = json!("peerOpened");
                    json!({"jsonrpc":"2.0","method":"native.mesh.lane.delta","params":{"subId": sub_id, "payload": payload}})
                }
                Ok(LaneEvent::Closed {
                    lane_id,
                    inbound,
                    reason,
                }) => {
                    json!({"jsonrpc":"2.0","method":"native.mesh.lane.delta","params":{"subId": sub_id, "payload": {"kind": "closed", "laneId": lane_id, "inbound": inbound, "reason": reason}}})
                }
                Err(broadcast::error::RecvError::Lagged(_)) => {
                    let lanes: Vec<Value> = state.bridge.lanes().iter().map(lane_json).collect();
                    json!({"jsonrpc":"2.0","method":"native.mesh.lane.snapshot","params":{"subId": sub_id, "payload": {"lanes": lanes}}})
                }
                Err(_) => break,
            };
            if tx.send(OutMsg::Line(note.to_string())).is_err() {
                break;
            }
        }
    });
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
    err(
        id,
        "UNAVAILABLE",
        -32006,
        "mesh node not up",
        true,
        Some(details),
    )
}

/// truffle errors → wire errors. NotRunning is transient (auth/network) → UNAVAILABLE.
fn map_node_err(state: &Arc<DaemonState>, id: Option<Value>, msg: &str) -> Value {
    if msg.contains("not running") || msg.contains("NotRunning") {
        return unavailable(state, id);
    }
    if msg.contains("[PROXY_NOT_FOUND]") || msg.contains("proxy not found") {
        return err(id, "NOT_FOUND", -32003, "serve not found", false, None);
    }
    if msg.contains("[STATIC_ROOT_INVALID]") {
        return err(
            id,
            "PRECONDITION_FAILED",
            -32005,
            "static root is missing, unreadable, or not a directory",
            false,
            Some(json!({"code": "STATIC_ROOT_INVALID"})),
        );
    }
    err(id, "INTERNAL", -32000, msg, false, None)
}

async fn list_peers(node: &Arc<MeshNode>) -> Vec<Value> {
    let mut out = Vec::new();
    for p in node.peers().await {
        // whois {login, …}: the T1 petition landed (truffle 0.7.9 `whois(ip)`),
        // so the tailnet user identity now populates from the control plane —
        // best-effort, per-peer, riding truffle's own 60s success cache. On
        // any failure (pre-v3 sidecar fails fast, no identity for the
        // address, tagged node without a user) the field is ABSENT — never
        // synthesized (EL7). WhoIsIdentity.login is REQUIRED by the contract,
        // so an answer without a login contributes nothing.
        let whois = match node.whois(&p.ip.to_string()).await {
            Ok(Some(identity)) => {
                identity
                    .login_name
                    .filter(|login| !login.is_empty())
                    .map(|login| {
                        let mut w = json!({ "login": login });
                        if let Some(dns) = identity.dns_name.filter(|d| !d.is_empty()) {
                            w["deviceName"] = json!(dns);
                        }
                        if let Some(node_id) = identity.node_id.filter(|n| !n.is_empty()) {
                            w["tailscaleId"] = json!(node_id);
                        }
                        w
                    })
            }
            _ => None,
        };
        let mut entry = json!({
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
        });
        if let Some(w) = whois {
            entry["whois"] = w;
        }
        out.push(entry);
    }
    out
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

async fn serve_add(
    state: &Arc<DaemonState>,
    node: &Arc<MeshNode>,
    params: &Value,
    id: Option<Value>,
) -> Value {
    let Some(name) = params.get("name").and_then(Value::as_str) else {
        return err(
            id,
            "PRECONDITION_FAILED",
            -32005,
            "name required",
            false,
            None,
        );
    };
    let serve_id = params
        .get("serveId")
        .and_then(Value::as_str)
        .unwrap_or(name);
    if serve_id.is_empty() || name.is_empty() {
        return err(
            id,
            "PRECONDITION_FAILED",
            -32005,
            "serveId and name must be non-empty",
            false,
            None,
        );
    }
    let target = params.get("target").cloned().unwrap_or(Value::Null);
    let allow = params.get("allow").cloned().unwrap_or_else(|| json!([]));
    let tls = params.get("tls").and_then(Value::as_bool);
    let listen_port = match params.get("listenPort") {
        None => None,
        Some(value) => match value.as_u64() {
            Some(port) => Some(port),
            None => {
                return err(
                    id,
                    "PRECONDITION_FAILED",
                    -32005,
                    "listenPort must be an unsigned integer",
                    false,
                    None,
                )
            }
        },
    };
    let preview_dir = match params.get("previewDir") {
        None => None,
        Some(value) => match value.as_str() {
            Some(path) => Some(path),
            None => {
                return err(
                    id,
                    "PRECONDITION_FAILED",
                    -32005,
                    "previewDir must be a string",
                    false,
                    None,
                )
            }
        },
    };
    let path_secret = params.get("pathSecret").and_then(Value::as_str);
    let allow_globs: Vec<String> = allow
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let cfg = match build_serve_config(ServeConfigInput {
        serve_id,
        name,
        target: &target,
        listen_port,
        preview_dir,
        allow: allow_globs,
        tls,
        path_secret,
    }) {
        Ok(c) => c,
        Err(msg) => return err(id, "PRECONDITION_FAILED", -32005, &msg, false, None),
    };
    let effective_listen_port = cfg.listen_port;
    match node.proxy().add(cfg).await {
        Ok(info) => {
            // Cache the FULL declared config (incl. tls + pathSecret) so serve.list /
            // serve.subscribe can re-hydrate it. pathSecret is a daemon secret (EL7):
            // `serve_entry_json` projects only {target, allow, tls} to the wire and
            // NEVER emits pathSecret. The secret's canonical home is fieldd + the
            // sidecar route config (thinking-c3 §1) — this cache copy is never re-shared.
            let mut record = json!({
                "serveId": serve_id,
                "name": name,
                "listenPort": effective_listen_port,
                "target": target,
                "allow": allow,
            });
            if let Some(tls) = tls {
                record["tls"] = json!(tls);
            }
            if let Some(preview_dir) = preview_dir {
                record["previewDir"] = json!(preview_dir);
            }
            if let Some(secret) = path_secret {
                record["pathSecret"] = json!(secret);
            }
            state.mesh.record_serve(serve_id, record).await;
            // The add response echoes the declared config back to fieldd (which already
            // holds the secret); it deliberately carries neither tls nor pathSecret —
            // clients read live status via serve.list / serve.subscribe.
            ok(
                id,
                json!({
                    "serveId": serve_id,
                    "name": name,
                    "listenPort": info.listen_port,
                    "target": target,
                    "url": info.url,
                    "allow": allow,
                }),
            )
        }
        Err(e) => map_node_err(state, id, &e.to_string()),
    }
}

/// Pure params → truffle [`ProxyConfig`] mapping (unit-tested without a node).
///
/// Security-load-bearing (thinking-c3 §1, EL7 — same-uid agents are the adversary):
/// a `path_secret` on a `port` serve builds a ROUTES-mode config whose single route
/// carries the secret prefix `/t/<secret>` with `strip_prefix = false`. Keeping
/// `strip_prefix` **false** is load-bearing: the backend must SEE the secret path on
/// every proxied request — that is the provenance proof that a connection arrived
/// through the tailnet sidecar (only the sidecar's route config and fieldd's memory
/// hold the secret). A `dir` serve is a static surface where a secret path proves
/// nothing, so `path_secret` there is rejected rather than silently served.
struct ServeConfigInput<'a> {
    serve_id: &'a str,
    name: &'a str,
    target: &'a Value,
    listen_port: Option<u64>,
    preview_dir: Option<&'a str>,
    allow: Vec<String>,
    tls: Option<bool>,
    path_secret: Option<&'a str>,
}

fn build_serve_config(input: ServeConfigInput<'_>) -> Result<ProxyConfig, String> {
    let ServeConfigInput {
        serve_id,
        name,
        target,
        listen_port,
        preview_dir,
        allow,
        tls,
        path_secret,
    } = input;
    let tls = tls.unwrap_or(true); // upstream default; the product serve passes false
    if path_secret.is_some() && preview_dir.is_some() {
        return Err("previewDir is not supported with pathSecret".into());
    }
    let explicit_listen_port = listen_port.is_some();
    let parse_listen_port = |legacy: u16| -> Result<u16, String> {
        match listen_port {
            Some(0) => Err("listenPort must be nonzero".into()),
            Some(value) => u16::try_from(value).map_err(|_| "listenPort out of range".to_string()),
            None => Ok(legacy),
        }
    };
    let mut preview_routes = Vec::new();
    if let Some(dir) = preview_dir {
        if !std::path::Path::new(dir).is_absolute() {
            return Err("previewDir must be an absolute path".into());
        }
        preview_routes.push(ProxyRoute {
            prefix: "/.vibefield/preview".into(),
            target_url: None,
            dir: Some(dir.into()),
            fallback: None,
            strip_prefix: false,
            allow: vec![],
        });
    }
    match target.get("kind").and_then(Value::as_str) {
        Some("port") => {
            let port_u64 = target
                .get("port")
                .and_then(Value::as_u64)
                .ok_or("target.port required")?;
            let port =
                u16::try_from(port_u64).map_err(|_| "target.port out of range".to_string())?;
            let scheme = target
                .get("scheme")
                .and_then(Value::as_str)
                .unwrap_or("http");
            if scheme != "http" && scheme != "https" {
                return Err("target.scheme must be http|https".into());
            }
            let listen_port = parse_listen_port(port)?;
            let mut routes = preview_routes;
            match path_secret {
                Some(secret) => routes.push(ProxyRoute {
                    prefix: format!("/t/{secret}"),
                    target_url: Some(format!("{scheme}://127.0.0.1:{port}")),
                    dir: None,
                    fallback: None,
                    strip_prefix: false, // LOAD-BEARING — see fn doc (EL7 provenance proof)
                    allow: vec![],
                }),
                None if explicit_listen_port || !routes.is_empty() => routes.push(ProxyRoute {
                    prefix: "/".into(),
                    target_url: Some(format!("{scheme}://127.0.0.1:{port}")),
                    dir: None,
                    fallback: None,
                    strip_prefix: false,
                    allow: vec![],
                }),
                None => {}
            }
            // Routes mode ignores the top-level target (truffle: "Ignored when routes is
            // non-empty"); the bare v1 shape carries it. Today's plain-port shape preserved.
            let target = if routes.is_empty() {
                ProxyTarget {
                    host: "127.0.0.1".into(),
                    port,
                    scheme: scheme.into(),
                }
            } else {
                ProxyTarget::default()
            };
            Ok(ProxyConfig {
                id: serve_id.into(),
                name: name.into(),
                listen_port,
                target,
                // Explicit FALSE (review 2026-07-21): announce is a no-op until
                // truffle RFC-023 P5 ships discovery — at which point upstream
                // flips its default to false ("no surprise broadcasts"). Our
                // serves must never start broadcasting on an EL8 bump; VibeField
                // discovery is DeviceService/D31 (the registry store), not proxy
                // announcements. Opt-in arrives as a deliberate contract field.
                announce: false,
                tls,
                allow_non_loopback: false,
                allow,
                routes,
            })
        }
        Some("dir") => {
            if path_secret.is_some() {
                return Err("pathSecret is not supported for dir serves".into());
            }
            let path = target
                .get("path")
                .and_then(Value::as_str)
                .ok_or("target.path required")?;
            if !std::path::Path::new(path).is_absolute() {
                return Err("target.path must be an absolute path".into());
            }
            let fallback = target.get("fallback").and_then(Value::as_str);
            if fallback.is_some_and(|value| value != "/index.html") {
                return Err("target.fallback must be /index.html".into());
            }
            let listen_port = parse_listen_port(0)?;
            let mut routes = preview_routes;
            routes.push(ProxyRoute {
                prefix: "/".into(),
                target_url: None,
                dir: Some(path.into()),
                fallback: fallback.map(str::to_string),
                strip_prefix: false,
                allow: vec![],
            });
            Ok(ProxyConfig {
                id: serve_id.into(),
                name: name.into(),
                listen_port,
                target: ProxyTarget::default(),
                announce: false, // same law as the port arm — no surprise broadcasts
                tls,
                allow_non_loopback: false,
                allow,
                routes,
            })
        }
        _ => Err("target.kind must be port|dir".into()),
    }
}

/// Project one declared-config + live proxy status into a ServeEntry JSON.
///
/// The cache `cfg` may hold `pathSecret` (a daemon secret); this projection reads
/// ONLY `{target, allow, tls}` from it — `pathSecret` is never emitted (EL7 redaction,
/// thinking-c3 §1). Pure so the redaction is unit-testable without a node.
fn serve_entry_json(
    serve_id: &str,
    name: &str,
    listen_port: u16,
    url: &str,
    status: &ProxyStatus,
    cfg: Option<&Value>,
) -> Value {
    let mut entry = json!({
        "serveId": serve_id,
        "name": name,
        "listenPort": listen_port,
        "target": cfg.and_then(|c| c.get("target")).cloned(),
        "url": url,
        "allow": cfg.and_then(|c| c.get("allow")).cloned(),
    });
    match status {
        ProxyStatus::Starting => entry["status"] = json!("starting"),
        ProxyStatus::Running => entry["status"] = json!("running"),
        ProxyStatus::Stopped => entry["status"] = json!("stopped"),
        ProxyStatus::Error(msg) => {
            entry["status"] = json!("error");
            entry["error"] = json!(msg);
        }
    }
    // tls is benign (not a secret) — re-hydrate it when the caller declared it.
    if let Some(tls) = cfg.and_then(|c| c.get("tls")).cloned() {
        entry["tls"] = tls;
    }
    entry
}

/// serve.list / serve.subscribe snapshot: live proxies projected to ServeEntry JSON.
async fn serve_entries(state: &Arc<DaemonState>, node: &Arc<MeshNode>) -> Vec<Value> {
    let mut serves = Vec::new();
    for info in node.proxy().list() {
        let cfg = state.mesh.serve_config(&info.id).await;
        serves.push(serve_entry_json(
            &info.id,
            &info.name,
            info.listen_port,
            &info.url,
            &info.status,
            cfg.as_ref(),
        ));
    }
    serves
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
                        StoreEvent::PeerUpdated {
                            device_id,
                            data,
                            version,
                        } => {
                            json!({"kind": "peerUpdated", "deviceId": device_id, "data": data, "version": version})
                        }
                        StoreEvent::PeerRemoved { device_id } => {
                            json!({"kind": "peerRemoved", "deviceId": device_id})
                        }
                        // tolerant: future upstream event kinds must not break the stream
                        #[allow(unreachable_patterns)]
                        _ => continue,
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

/// serve.subscribe forwarder over `node.proxy().subscribe()` (broadcast cap 64),
/// mirroring `spawn_store_forwarder`. The delta payload is a PARTIAL ServeEntry keyed
/// by `serveId` — `{serveId, status, url?, error?}` — that the client merges into the
/// snapshot entry of the same identity (same shape family as the `{serves:[…]}` snapshot).
/// `ProxyEvent.id` is the serve id, so no
/// cache lookup is needed to correlate. On broadcast Lagged we re-project a full
/// snapshot (P5) — the Stopped proxy is already gone from `proxy().list()`, so the
/// per-event delta (not a list rebuild) is what carries a stop honestly.
fn spawn_serve_forwarder(state: Arc<DaemonState>, tx: Tx, node: Arc<MeshNode>, sub_id: String) {
    tokio::spawn(async move {
        let mut rx = node.proxy().subscribe();
        loop {
            match rx.recv().await {
                Ok(ev) => {
                    let payload = match ev {
                        ProxyEvent::Started { id, url, .. } => {
                            json!({"serveId": id, "status": "running", "url": url})
                        }
                        ProxyEvent::Stopped { id } => {
                            json!({"serveId": id, "status": "stopped"})
                        }
                        // Match serve_entry_json's error string: record_runtime_error
                        // stores ProxyStatus::Error("[code] message"), so format alike.
                        ProxyEvent::Error { id, code, message } => {
                            json!({"serveId": id, "status": "error", "error": format!("[{code}] {message}")})
                        }
                    };
                    let note = json!({"jsonrpc":"2.0","method":"native.mesh.serve.delta","params":{"subId": sub_id, "payload": payload}});
                    if tx.send(OutMsg::Line(note.to_string())).is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    // dropped events → fresh snapshot (P5: server may re-snapshot)
                    let payload = json!({"serves": serve_entries(&state, &node).await});
                    let note = json!({"jsonrpc":"2.0","method":"native.mesh.serve.snapshot","params":{"subId": sub_id, "payload": payload}});
                    if tx.send(OutMsg::Line(note.to_string())).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
}

#[cfg(test)]
mod tests {
    //! Pure serve-mapping units — the security-load-bearing pieces exercised
    //! without a node (no tailnet in CI). The node-dependent honesty path
    //! (serve.subscribe → UNAVAILABLE when mesh is down) lives in the mgmt_server
    //! integration harness.
    use super::*;

    fn serve_input<'a>(serve_id: &'a str, target: &'a Value) -> ServeConfigInput<'a> {
        ServeConfigInput {
            serve_id,
            name: serve_id,
            target,
            listen_port: None,
            preview_dir: None,
            allow: vec![],
            tls: None,
            path_secret: None,
        }
    }

    #[test]
    fn port_with_secret_builds_secret_route_strip_false_tls_false() {
        let target = json!({"kind": "port", "port": 9410});
        let cfg = build_serve_config(ServeConfigInput {
            tls: Some(false),
            path_secret: Some("s3cr3t"),
            ..serve_input("product", &target)
        })
        .expect("routes-mode config builds");
        assert!(!cfg.tls, "tls:false must thread through to ProxyConfig");
        assert_eq!(cfg.routes.len(), 1, "port+secret is exactly one route");
        let route = &cfg.routes[0];
        assert_eq!(route.prefix, "/t/s3cr3t", "secret-path prefix");
        assert_eq!(
            route.target_url.as_deref(),
            Some("http://127.0.0.1:9410"),
            "loopback target URL"
        );
        assert!(
            !route.strip_prefix,
            "strip_prefix MUST be false — the backend must see the secret path (EL7 proof)"
        );
        assert!(route.dir.is_none(), "a port route is not a dir route");
        assert_eq!(
            cfg.target.port, 0,
            "routes mode leaves the top-level target unset"
        );
        assert_eq!(cfg.listen_port, 9410);
    }

    #[test]
    fn port_plain_preserves_bare_target_v1_shape() {
        let target = json!({"kind": "port", "port": 3000});
        let cfg =
            build_serve_config(serve_input("web", &target)).expect("bare-target config builds");
        assert!(
            cfg.routes.is_empty(),
            "plain port keeps the v1 bare-target shape"
        );
        assert_eq!(cfg.target.host, "127.0.0.1");
        assert_eq!(cfg.target.port, 3000);
        assert_eq!(cfg.target.scheme, "http");
        assert_eq!(cfg.listen_port, 3000);
        assert!(
            cfg.tls,
            "tls defaults to true when unset (upstream default)"
        );
    }

    #[test]
    fn dir_with_secret_is_rejected() {
        let target = json!({"kind": "dir", "path": "/srv/pub"});
        let err = build_serve_config(ServeConfigInput {
            path_secret: Some("nope"),
            ..serve_input("static", &target)
        })
        .expect_err("dir + pathSecret must be rejected");
        assert!(
            err.contains("pathSecret"),
            "message names the offending field: {err}"
        );
    }

    #[test]
    fn dir_plain_builds_static_route() {
        let target = json!({"kind": "dir", "path": "/srv/pub"});
        let cfg = build_serve_config(ServeConfigInput {
            allow: vec!["*@corp.com".into()],
            ..serve_input("static", &target)
        })
        .expect("dir config builds");
        assert_eq!(cfg.routes.len(), 1);
        assert_eq!(cfg.routes[0].prefix, "/");
        assert_eq!(cfg.routes[0].dir.as_deref(), Some("/srv/pub"));
        assert_eq!(cfg.allow, vec!["*@corp.com".to_string()]);
        assert_eq!(cfg.listen_port, 0);
    }

    #[test]
    fn bad_kind_and_bad_port_are_precondition_failures() {
        let bad_kind = json!({"kind": "nope"});
        assert!(build_serve_config(serve_input("x", &bad_kind)).is_err());
        let missing_port = json!({"kind": "port"});
        assert!(build_serve_config(serve_input("x", &missing_port)).is_err());
        let oversized_port = json!({"kind": "port", "port": 99_999});
        assert!(
            build_serve_config(serve_input("x", &oversized_port)).is_err(),
            "ports above u16::MAX are rejected, not truncated"
        );
    }

    #[test]
    fn serve_entry_json_never_leaks_path_secret() {
        // The cache holds the FULL declared config, secret included …
        let cfg = json!({
            "target": {"kind": "port", "port": 9410},
            "allow": ["*@corp.com"],
            "tls": false,
            "pathSecret": "TOPSECRET",
        });
        let entry = serve_entry_json(
            "product",
            "product",
            9410,
            "https://h.ts.net:9410",
            &ProxyStatus::Running,
            Some(&cfg),
        );
        let text = entry.to_string();
        assert!(
            !text.contains("TOPSECRET"),
            "the secret value must never reach the wire: {text}"
        );
        assert!(
            !text.contains("pathSecret"),
            "no pathSecret field at all: {text}"
        );
        assert_eq!(entry["status"], "running");
        assert_eq!(entry["tls"], false, "tls is benign and IS re-hydrated");
        assert_eq!(entry["allow"][0], "*@corp.com");
        assert_eq!(entry["name"], "product");
        assert_eq!(entry["url"], "https://h.ts.net:9410");
    }

    /// EL9 where it actually bites. `lane_json` hand-builds the notification
    /// payload, so the generated type is the only thing standing between a
    /// contract rename and a producer that keeps emitting the old key —
    /// the TS fixture test would go red while Rust stayed cheerfully wrong.
    /// Parsing our own output with the generated struct closes that.
    #[test]
    fn an_inbound_lane_projects_to_the_contract_shape() {
        let lane = Lane {
            lane_id: crate::services::mesh_bridge::INBOUND_LANE_ID_BASE,
            class: LaneClass::Reliable,
            peer: "n4Kd8xQ2pLmR".into(),
            protocol: "doc-sync".into(),
            doc_id: Some("6b1f0e2a-5c3d-4a7b-8e91-0d2c4f6a8b13".into()),
            inbound: true,
        };
        let projected = lane_json(&lane);
        let parsed: crate::contracts::MeshLanePeerOpened =
            serde_json::from_value(projected.clone()).unwrap_or_else(|e| {
                panic!("lane_json drifted from MeshLanePeerOpened: {e}\n{projected}")
            });
        assert_eq!(parsed.lane_id, lane.lane_id);
        assert!(parsed.inbound, "the contract types this as a literal true");
        assert_eq!(parsed.peer, "n4Kd8xQ2pLmR");
        assert!(
            parsed.whois.is_none(),
            "whois is absent, not fabricated (EL7)"
        );
    }

    #[test]
    fn an_outbound_lane_omits_the_inbound_literal() {
        // `MeshLanePeerOpened.inbound` is a literal `true`, so an OUTBOUND lane
        // must not claim that shape — the snapshot carries both directions and
        // the flag is what keeps their id spaces apart.
        let lane = Lane {
            lane_id: 3,
            class: LaneClass::Lossy,
            peer: "p".into(),
            protocol: "presence".into(),
            doc_id: None,
            inbound: false,
        };
        let projected = lane_json(&lane);
        assert!(projected.get("inbound").is_none());
        assert!(projected.get("docId").is_none());
        assert_eq!(projected["class"], "lossy");
    }

    #[test]
    fn serve_entry_json_maps_error_status_and_message() {
        let entry = serve_entry_json(
            "web",
            "web",
            8443,
            "https://h.ts.net:8443",
            &ProxyStatus::Error("[SERVE_ERROR] boom".into()),
            None,
        );
        assert_eq!(entry["status"], "error");
        assert_eq!(entry["error"], "[SERVE_ERROR] boom");
    }

    #[test]
    fn artifact_proxy_separates_engine_id_name_listener_source_and_preview() {
        let target = json!({"kind": "port", "port": 3000, "scheme": "https"});
        let cfg = build_serve_config(ServeConfigInput {
            name: "artifact:01ARZ3NDEKTSV4RRFFQ69G5FAV",
            listen_port: Some(12_345),
            preview_dir: Some("/var/lib/vibefield/previews/01"),
            allow: vec!["*@corp.com".into()],
            tls: Some(true),
            ..serve_input("artifact-01-fingerprint", &target)
        })
        .expect("AH proxy config builds");
        assert_eq!(cfg.id, "artifact-01-fingerprint");
        assert_eq!(cfg.name, "artifact:01ARZ3NDEKTSV4RRFFQ69G5FAV");
        assert_eq!(cfg.listen_port, 12_345);
        assert!(cfg.tls);
        assert_eq!(cfg.routes.len(), 2);
        assert_eq!(cfg.routes[0].prefix, "/.vibefield/preview");
        assert_eq!(
            cfg.routes[0].dir.as_deref(),
            Some("/var/lib/vibefield/previews/01")
        );
        assert_eq!(cfg.routes[1].prefix, "/");
        assert_eq!(
            cfg.routes[1].target_url.as_deref(),
            Some("https://127.0.0.1:3000")
        );
        assert_eq!(cfg.allow, vec!["*@corp.com".to_string()]);
    }

    #[test]
    fn artifact_folder_uses_stable_port_and_optional_spa_fallback() {
        let target = json!({"kind": "dir", "path": "/srv/pub", "fallback": "/index.html"});
        let cfg = build_serve_config(ServeConfigInput {
            name: "artifact:01ARZ3NDEKTSV4RRFFQ69G5FAW",
            listen_port: Some(19_999),
            preview_dir: Some("/var/lib/vibefield/previews/02"),
            tls: Some(true),
            ..serve_input("artifact-folder-fingerprint", &target)
        })
        .expect("AH folder config builds");
        assert_eq!(cfg.listen_port, 19_999);
        assert_eq!(cfg.routes.len(), 2);
        assert_eq!(cfg.routes[1].dir.as_deref(), Some("/srv/pub"));
        assert_eq!(cfg.routes[1].fallback.as_deref(), Some("/index.html"));
    }
}
