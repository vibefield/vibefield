//! DS-1 — `native.mesh.egress.*`, the facade's egress verbs (design-02 §2.4's
//! egress bullet; shapes in contracts `mgmt.ts`; the substrate is
//! `services/mesh_egress.rs`).
//!
//! Answered BEFORE the mesh facade's node gate, and the order of the refusals
//! below is the contract:
//!
//!  1. `egress-unsupported` first, for EVERY verb. It is a capability fact
//!     about this floor's sidecar and holds whether or not a node is up; a
//!     reader told `mesh-down` instead would wait for a node that can never
//!     carry egress.
//!  2. The table reads (`route.list`, `route.subscribe`) and `route.remove`
//!     need no node: with none, the table is empty (a teardown reset it), so
//!     they answer honestly from what is there.
//!  3. The acts that need a node to carry them (`proxy`, `httpProxy`,
//!     `route.add`) answer `mesh-down` with the gateway's own state beside it.
//!  4. Then the capture-mode belt (nothing reaches out as a node whose account
//!     is not known yet), then the params, then DS-L6's belt: a route may aim
//!     only at a door that demands its own grant (`MESH_EGRESS.ROUTABLE_PORTS`).
//!
//! CONTROL ONLY (EL2): an address, a credential, a route row. The credential is
//! the one secret here — it is answered to the paired client and never logged.

use crate::contracts::{MeshEgressRouteAddParams, MeshEgressRouteRef, MeshMode};
use crate::registries::mesh_egress;
use crate::services::mesh_egress::{EgressError, EgressRoute, ProxyGrant};
use crate::state::{DaemonState, MgmtOutbox, OutMsg};
use serde_json::{json, Value};
use std::sync::Arc;

use super::{err, ok, send};

type Tx = MgmtOutbox;

pub async fn handle(
    state: &Arc<DaemonState>,
    tx: &Tx,
    method: &str,
    params: &Value,
    id: Option<Value>,
) {
    let egress = state.mesh.egress();
    if !egress.supported() {
        send(tx, refusal(state, id, EgressError::Unsupported));
        return;
    }
    let node = state.mesh.node();
    let resp = match method {
        "native.mesh.egress.route.list" => match egress.route_list(node.as_ref()).await {
            Ok(routes) => ok(id, table_json(&routes)),
            Err(e) => refusal(state, id, e),
        },
        "native.mesh.egress.route.subscribe" => {
            let snapshot = match egress.route_list(node.as_ref()).await {
                Ok(routes) => table_json(&routes),
                Err(e) => {
                    send(tx, refusal(state, id, e));
                    return;
                }
            };
            let sub_id = state.sub_id();
            // The response line is sent BEFORE the forwarder exists, so no
            // snapshot notification can overtake the subscribe answer.
            send(tx, ok(id, json!({ "subId": sub_id, "snapshot": snapshot })));
            spawn_route_forwarder(state.clone(), tx.clone(), sub_id);
            return;
        }
        "native.mesh.egress.route.remove" => {
            let parsed = match serde_json::from_value::<MeshEgressRouteRef>(params.clone()) {
                Ok(p) => p,
                Err(e) => {
                    send(tx, malformed(id, "route.remove expects {id}", &e));
                    return;
                }
            };
            let route_id = parsed.id.as_str().to_owned();
            match egress.route_remove(node.as_ref(), &route_id).await {
                Ok(()) => {
                    state.mesh.note_egress_changed();
                    tracing::info!(
                        event = "field_native.mesh.egress.route_removed",
                        component = "mesh",
                        route = %route_id,
                        "egress route removed"
                    );
                    ok(id, json!({ "id": route_id }))
                }
                Err(e) => refusal(state, id, e),
            }
        }
        "native.mesh.egress.proxy"
        | "native.mesh.egress.httpProxy"
        | "native.mesh.egress.route.add" => {
            if !state.mesh.node_present() {
                send(tx, refusal(state, id, EgressError::MeshDown));
                return;
            }
            if state.mesh.mode() == Some(MeshMode::Capture) {
                // The same belt `serve.add` and `store.set` wear (mesh.rs):
                // while the login is being captured the node is ungated, so
                // reaching out through it would reach peers of no known
                // account. Nothing leaves as this node until it is linked.
                send(
                    tx,
                    err(
                        id,
                        "PRECONDITION_FAILED",
                        -32005,
                        "the mesh is capturing a tailscale login; nothing reaches out through the node until it is linked",
                        true,
                        Some(json!({ "code": "MESH_CAPTURING" })),
                    ),
                );
                return;
            }
            match method {
                "native.mesh.egress.proxy" => match egress.loopback_proxy(node.as_ref()).await {
                    Ok(grant) => ok(id, grant_json(&grant)),
                    Err(e) => refusal(state, id, e),
                },
                "native.mesh.egress.httpProxy" => match egress.http_proxy(node.as_ref()).await {
                    Ok(grant) => ok(id, grant_json(&grant)),
                    Err(e) => refusal(state, id, e),
                },
                _ => route_add(state, &egress, node.as_ref(), params, id).await,
            }
        }
        _ => err(id, "NOT_FOUND", -32601, "method not found", false, None),
    };
    send(tx, resp);
}

async fn route_add(
    state: &Arc<DaemonState>,
    egress: &Arc<dyn crate::services::mesh_egress::EgressBackend>,
    node: Option<&Arc<crate::services::mesh::MeshNode>>,
    params: &Value,
    id: Option<Value>,
) -> Value {
    let parsed = match serde_json::from_value::<MeshEgressRouteAddParams>(params.clone()) {
        Ok(p) => p,
        Err(e) => return malformed(id, "route.add expects {id, target, login?}", &e),
    };
    let route_id = parsed.id.as_str().to_owned();
    let target = parsed.target.as_str().to_owned();
    // DS-L6 — the belt. The contract's pattern already guarantees a port after
    // the LAST colon (a bracketed IPv6 host keeps its own colons inside the
    // brackets), so this split cannot misread the host.
    let port = target
        .rsplit_once(':')
        .and_then(|(_, port)| port.parse::<u16>().ok());
    let Some(port) = port.filter(|p| mesh_egress::ROUTABLE_PORTS.contains(p)) else {
        return err(
            id,
            "PRECONDITION_FAILED",
            -32005,
            "an unauthenticated egress route may target only a door that demands its own grant (DS-L6)",
            false,
            Some(json!({
                "code": "EGRESS_PORT_NOT_ROUTABLE",
                "target": target,
                "routablePorts": mesh_egress::ROUTABLE_PORTS,
            })),
        );
    };
    let login = parsed.login.as_ref().map(|l| l.as_str().to_owned());
    match egress
        .route_add(node, &route_id, &target, login.as_deref())
        .await
    {
        Ok(route) => {
            state.mesh.note_egress_changed();
            tracing::info!(
                event = "field_native.mesh.egress.route_bound",
                component = "mesh",
                route = %route.id,
                port,
                listen = %route.listen,
                "egress route bound"
            );
            ok(id, json!({ "id": route.id, "listen": route.listen }))
        }
        Err(e) => refusal(state, id, e),
    }
}

/// `EgressError` → the wire. `egress-unsupported` and `mesh-down` are the two
/// shapes the contract names (the `error-data.egress-*` goldens pin them, and
/// this module's tests hold this function to those files).
fn refusal(state: &Arc<DaemonState>, id: Option<Value>, e: EgressError) -> Value {
    match e {
        EgressError::Unsupported => err(
            id,
            "UNAVAILABLE",
            -32006,
            "egress is unsupported: this floor's tailnet sidecar predates RFC 026",
            false,
            Some(json!({
                "service": mesh_egress::SERVICE,
                "state": mesh_egress::STATE_UNSUPPORTED,
            })),
        ),
        EgressError::MeshDown => err(
            id,
            "UNAVAILABLE",
            -32006,
            "egress needs a mesh node and none is up",
            true,
            Some(json!({
                "service": mesh_egress::SERVICE,
                "state": mesh_egress::STATE_MESH_DOWN,
                "gatewayState": state.mesh.health().state.to_string(),
            })),
        ),
        EgressError::NotFound => err(
            id,
            "NOT_FOUND",
            -32003,
            "egress route not found",
            false,
            None,
        ),
        EgressError::Conflict { bound_target } => err(
            id,
            "CONFLICT",
            -32004,
            "that route id is bound to another target; remove it first (a route never re-aims)",
            false,
            Some(json!({ "code": "EGRESS_ROUTE_CONFLICT", "boundTarget": bound_target })),
        ),
        EgressError::Refused(reason) => err(
            id,
            "PRECONDITION_FAILED",
            -32005,
            &reason,
            false,
            Some(json!({ "code": "EGRESS_TARGET_REFUSED" })),
        ),
        EgressError::Failed(message) => err(id, "INTERNAL", -32000, &message, false, None),
    }
}

fn malformed(id: Option<Value>, expects: &str, e: &serde_json::Error) -> Value {
    err(
        id,
        "PRECONDITION_FAILED",
        -32005,
        &format!("{expects}: {e}"),
        false,
        None,
    )
}

fn grant_json(grant: &ProxyGrant) -> Value {
    json!({ "address": grant.address, "credential": grant.credential })
}

fn table_json(routes: &[EgressRoute]) -> Value {
    json!({
        "routes": routes
            .iter()
            .map(|r| json!({ "id": r.id, "target": r.target, "listen": r.listen }))
            .collect::<Vec<_>>()
    })
}

/// `route.subscribe`'s forwarder: every move of the table (coalesced by the
/// watch) re-reads the WHOLE table and pushes it as a `.snapshot` — the table
/// is state, never an edge, so a reader replaces rather than merges. A
/// teardown's reset arrives here as the empty table: the facade's `reset`.
fn spawn_route_forwarder(state: Arc<DaemonState>, tx: Tx, sub_id: String) {
    let mut changes = state.mesh.egress_changes();
    changes.borrow_and_update();
    tokio::spawn(async move {
        while changes.changed().await.is_ok() {
            if tx.is_closed() {
                break;
            }
            let egress = state.mesh.egress();
            let payload = match egress.route_list(state.mesh.node().as_ref()).await {
                Ok(routes) => table_json(&routes),
                Err(_) => continue, // the arm cannot list right now; the next move re-reads
            };
            let note = json!({
                "jsonrpc": "2.0",
                "method": "native.mesh.egress.route.snapshot",
                "params": { "subId": sub_id, "payload": payload },
            });
            if tx.send(OutMsg::Line(note.to_string())).is_err() {
                break;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn golden(name: &str) -> Value {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../contracts/fixtures")
            .join(name);
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    async fn state() -> (tempfile::TempDir, crate::RunningDaemon) {
        let dir = tempfile::tempdir().unwrap();
        let daemon = crate::bootstrap(crate::config::NativeConfig::for_data_dir(
            dir.path().to_path_buf(),
        ))
        .await
        .unwrap();
        (dir, daemon)
    }

    /// EL9 for the degraded answers: the floor's own JSON IS the golden, key
    /// for key, so the TS reader and this writer cannot drift apart.
    #[tokio::test]
    async fn the_two_degraded_answers_are_the_goldens() {
        let (_dir, daemon) = state().await;
        let unsupported = refusal(&daemon.state, Some(json!(7)), EgressError::Unsupported);
        assert_eq!(
            unsupported["error"]["data"],
            golden("error-data.egress-unsupported.json")
        );
        assert_eq!(unsupported["error"]["code"], -32006);
        // The default posture is offline: the gateway's own word is `disabled`,
        // which is exactly the state the mesh-down golden carries.
        let down = refusal(&daemon.state, Some(json!(8)), EgressError::MeshDown);
        assert_eq!(
            down["error"]["data"],
            golden("error-data.egress-mesh-down.json")
        );
        daemon.shutdown().await;
    }

    #[test]
    fn a_table_answer_is_the_golden_shape() {
        let table = table_json(&[EgressRoute {
            id: "egress-01ARZ3NDEKTSV4RRFFQ69G5FAV-9422".into(),
            target: "truffle-vibefield-studio.tail1234.ts.net:9422".into(),
            listen: "127.0.0.1:53211".into(),
        }]);
        let golden = golden("mesh-egress-route-table.valid.json");
        assert_eq!(table["routes"][0], golden["routes"][0]);
        assert_eq!(
            table_json(&[]),
            self::golden("mesh-egress-route-table.reset.json")
        );
    }
}
