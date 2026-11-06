//! DR-3a (W3, VF-FLOOR) — `native.mesh.fileTransfer.*`, the facade's file
//! transfer verbs (contracts mgmt.ts, the file transfer's header; the
//! substrate is `services/file_transfer.rs`).
//!
//! Answered BEFORE the mesh facade's node gate, as egress's verbs are
//! (`mgmt/mesh_egress.rs`), in egress's refusal order (W3-1, VF-PM
//! 2026-11-06), which is the contract's:
//!
//!  1. an arm that cannot pull by a named root (`UnsupportedFileTransfer`, the
//!     only arm production builds at the `=0.7.24` pin) answers EVERY verb
//!     `file-transfer-unsupported`: a capability fact that holds whether or not
//!     a node is up, which the node gate's generic UNAVAILABLE would hide;
//!  2. `subscribe` is answered with no node up: its stream is the arm's, held
//!     on the mesh unit across node rebuilds (W3-2), because fieldd's
//!     NativeLink keeps a refused subscription's replay silent until its next
//!     reconnect;
//!  3. `roots` and `pull` with no node answer the node gate's UNAVAILABLE
//!     (`mesh::unavailable`, `MeshNotUpDetails`);
//!  4. while the login is captured they are refused MESH_CAPTURING, as
//!     `serve.add` is;
//!  5. params the generated types cannot read are PRECONDITION_FAILED;
//!  6. then the arm: `roots` registers each root or answers it ROOT_UNGATED,
//!     and `pull` is refused CONFLICT (by its id, then by its digest), then
//!     RESOURCE_EXHAUSTED past DRIVE_LIMITS.PULLS_IN_FLIGHT.
//!
//! A verb is a method the contract declares (contracts methods.ts: `roots`,
//! `pull`, `subscribe`). Any other name under the prefix is none: `offer` (a
//! push) stays reserved and undeclared there, and a misspelt verb is not one
//! either. Such a name answers NOT_FOUND, as `mesh::handle`'s own unknown names
//! do, AHEAD of step 1, so its answer is the same on every arm (D36: declared
//! == shipped).
//!
//! A pull is answered at once: the mesh worker is serial (`mgmt/mod.rs`,
//! `serve`'s one worker), so a pull it awaited would hold every serve, store
//! and lane call behind it. Its progress and its end ride
//! `native.mesh.fileTransfer.delta` (one method with a `kind`: NativeLink
//! routes only `.delta` and `.snapshot` to a subscription), and a reader the
//! stream outran is owed one `.snapshot`, the door stream's shape
//! (`mgmt/door.rs`): every line goes through `MgmtOutbox::offer_rebuildable`,
//! so the stream never costs fieldd its connection.
//!
//! CONTROL ONLY (EL2): no byte of an object crosses this channel.

use crate::contracts::{
    MeshMode, NativeFileTransferPullParams, NativeFileTransferRootsParams, NativeFileTransferRow,
};
use crate::registries::{drive_limits, mesh_file_transfer};
use crate::services::file_transfer::{FileTransferBackend, FileTransferError, PullEvent};
use crate::state::{DaemonState, MgmtOutbox, Offered};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast::{self, error::RecvError, error::TryRecvError};

use super::{err, ok, send};

type Tx = MgmtOutbox;

const ROOTS: &str = "native.mesh.fileTransfer.roots";
const PULL: &str = "native.mesh.fileTransfer.pull";
const SUBSCRIBE: &str = "native.mesh.fileTransfer.subscribe";
/// The stream's two notifications (contracts mgmt.ts, the file transfer's
/// header).
const DELTA: &str = "native.mesh.fileTransfer.delta";
const SNAPSHOT: &str = "native.mesh.fileTransfer.snapshot";
/// How long a stream owed a snapshot waits for the outbox's headroom before it
/// offers again (the door stream's, `mgmt/door.rs`).
const SNAPSHOT_RETRY: Duration = Duration::from_millis(100);

pub async fn handle(
    state: &Arc<DaemonState>,
    tx: &Tx,
    method: &str,
    params: &Value,
    id: Option<Value>,
) {
    if !matches!(method, ROOTS | PULL | SUBSCRIBE) {
        send(
            tx,
            err(id, "NOT_FOUND", -32601, "method not found", false, None),
        );
        return;
    }
    let arm = state.mesh.file_transfer();
    if !arm.supported() {
        send(tx, unsupported(id));
        return;
    }
    if method == SUBSCRIBE {
        subscribe(state, tx, &arm, id);
        return;
    }
    if !state.mesh.node_present() {
        send(tx, super::mesh::unavailable(state, id));
        return;
    }
    if state.mesh.mode() == Some(MeshMode::Capture) {
        // The belt `serve.add` and `store.set` wear (mesh.rs): the node is
        // ungated while the login is captured, so nothing is declared on it
        // and nothing is pulled through it until it is linked.
        send(
            tx,
            err(
                id,
                "PRECONDITION_FAILED",
                -32005,
                "the mesh is capturing a tailscale login; nothing is declared or pulled until it is linked",
                true,
                Some(json!({ "code": "MESH_CAPTURING" })),
            ),
        );
        return;
    }
    let resp = if method == ROOTS {
        roots(state, &arm, params, id).await
    } else {
        pull(state, &arm, params, id)
    };
    send(tx, resp);
}

async fn roots(
    state: &Arc<DaemonState>,
    arm: &Arc<dyn FileTransferBackend>,
    params: &Value,
    id: Option<Value>,
) -> Value {
    let parsed = match serde_json::from_value::<NativeFileTransferRootsParams>(params.clone()) {
        Ok(parsed) => parsed,
        Err(e) => return malformed(id, "roots expects {roots: [a named root]}", &e),
    };
    // The gate the INSTALLED node was built with, read per request as the
    // facade reads it (`mesh::handle`), and the posture's login the set is
    // bound to (contracts mgmt.ts `NativeFileTransferRootsParams`).
    let gated = !state.mesh.login_allow().is_empty();
    match arm.roots(parsed.roots, gated, state.mesh.login()).await {
        Ok(roots) => ok(id, json!({ "roots": roots })),
        Err(e) => refusal(state, id, e),
    }
}

fn pull(
    state: &Arc<DaemonState>,
    arm: &Arc<dyn FileTransferBackend>,
    params: &Value,
    id: Option<Value>,
) -> Value {
    let parsed = match serde_json::from_value::<NativeFileTransferPullParams>(params.clone()) {
        Ok(parsed) => parsed,
        Err(e) => {
            return malformed(
                id,
                "pull expects {transferId, peer, root, path, digest}",
                &e,
            )
        }
    };
    let transfer_id = parsed.transfer_id.clone();
    match arm.pull(parsed) {
        Ok(()) => ok(id, json!({ "transferId": transfer_id })),
        Err(e) => refusal(state, id, e),
    }
}

fn subscribe(
    state: &Arc<DaemonState>,
    tx: &Tx,
    arm: &Arc<dyn FileTransferBackend>,
    id: Option<Value>,
) {
    // Subscribe BEFORE the snapshot, answer BEFORE forwarding (the door
    // stream's order): an end in between is a delta for a row the snapshot may
    // still list, never a miss.
    let events = arm.subscribe();
    let sub_id = state.sub_id();
    let snapshot = snapshot_json(&arm.snapshot());
    send(tx, ok(id, json!({ "subId": sub_id, "snapshot": snapshot })));
    spawn_forwarder(state.clone(), tx.clone(), events, sub_id);
}

/// Step 1's answer, the `error-data.file-transfer-unsupported` golden key for
/// key (`tests/mgmt_server.rs` holds the floor's own answer to it): retryable
/// false, because it is a fact for the floor's life, and its words are the
/// generated registry's.
fn unsupported(id: Option<Value>) -> Value {
    err(
        id,
        "UNAVAILABLE",
        -32006,
        "file transfer is unsupported: this floor's truffle cannot pull by a named root",
        false,
        Some(json!({
            "service": mesh_file_transfer::SERVICE,
            "state": mesh_file_transfer::STATE_UNSUPPORTED,
        })),
    )
}

/// An arm's refusal on the wire. CONFLICT is the
/// `error-data.file-transfer-conflict` golden: no details, retryable false
/// (DR-2a's review nit 9: fieldd's own table keeps both cases from the floor,
/// so this is a belt). RESOURCE_EXHAUSTED is retryable: a slot frees when a
/// running pull ends.
fn refusal(state: &Arc<DaemonState>, id: Option<Value>, e: FileTransferError) -> Value {
    match e {
        FileTransferError::Unsupported => unsupported(id),
        FileTransferError::MeshDown => super::mesh::unavailable(state, id),
        FileTransferError::Conflict(why) => err(id, "CONFLICT", -32004, why, false, None),
        FileTransferError::Exhausted => err(
            id,
            "RESOURCE_EXHAUSTED",
            -32010,
            "as many pulls as the floor runs at once are running",
            true,
            Some(json!({ "limit": drive_limits::PULLS_IN_FLIGHT })),
        ),
        FileTransferError::Internal(message) => err(id, "INTERNAL", -32000, &message, false, None),
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

/// The stream's snapshot as the contract spells it
/// (`NativeFileTransferSnapshot`).
fn snapshot_json(rows: &[NativeFileTransferRow]) -> Value {
    json!({ "transfers": rows })
}

/// One delta as the contract spells it (`NativeFileTransferDelta`): `kind` is
/// the zod discriminator's word.
fn delta_json(event: &PullEvent) -> Value {
    match event {
        PullEvent::Progress {
            transfer_id,
            bytes,
            total,
        } => json!({
            "kind": "progress",
            "transferId": transfer_id,
            "bytes": bytes,
            "total": total,
        }),
        PullEvent::Completed {
            transfer_id,
            digest,
            incoming,
            bytes,
            sha256,
        } => json!({
            "kind": "completed",
            "transferId": transfer_id,
            "digest": digest,
            "incoming": incoming,
            "bytes": bytes,
            "sha256": sha256,
        }),
        PullEvent::Failed {
            transfer_id,
            reason,
            message,
        } => json!({
            "kind": "failed",
            "transferId": transfer_id,
            "reason": reason,
            "message": message,
        }),
    }
}

fn note(method: &str, sub_id: &str, payload: Value) -> String {
    json!({"jsonrpc": "2.0", "method": method, "params": {"subId": sub_id, "payload": payload}})
        .to_string()
}

/// The stream's forwarder, the door stream's shape (`mgmt/door.rs`): every
/// line is offered as rebuildable, and a line the outbox has no headroom for,
/// or a lag past the arm's event buffer, owes the reader one `.snapshot`,
/// offered until it fits. It ends with its connection.
fn spawn_forwarder(
    state: Arc<DaemonState>,
    tx: Tx,
    mut events: broadcast::Receiver<PullEvent>,
    sub_id: String,
) {
    tokio::spawn(async move {
        let mut owed = false;
        loop {
            if owed {
                // what the snapshot covers is drained first, so it is not then
                // sent again as deltas
                loop {
                    match events.try_recv() {
                        Ok(_) | Err(TryRecvError::Lagged(_)) => {}
                        Err(TryRecvError::Empty) => break,
                        Err(TryRecvError::Closed) => return,
                    }
                }
                let snapshot = snapshot_json(&state.mesh.file_transfer().snapshot());
                match tx.offer_rebuildable(note(SNAPSHOT, &sub_id, snapshot)) {
                    Ok(Offered::Queued) => owed = false,
                    Ok(Offered::Skipped) => {
                        tokio::select! {
                            _ = tokio::time::sleep(SNAPSHOT_RETRY) => {}
                            _ = tx.closed() => return,
                        }
                    }
                    Err(_) => return,
                }
                continue;
            }
            let event = tokio::select! {
                event = events.recv() => event,
                _ = tx.closed() => return,
            };
            let payload = match event {
                Ok(event) => delta_json(&event),
                Err(RecvError::Lagged(_)) => {
                    owed = true;
                    continue;
                }
                Err(RecvError::Closed) => return,
            };
            match tx.offer_rebuildable(note(DELTA, &sub_id, payload)) {
                Ok(Offered::Queued) => {}
                Ok(Offered::Skipped) => owed = true,
                Err(_) => return,
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::{Blake3Hex, FileTransferId, FileTransferRootName};

    fn golden(name: &str) -> Value {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../contracts/fixtures")
            .join(name);
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    /// EL9 at the writer: the stream's lines ARE the goldens, key for key, so
    /// fieldd's zod reader and this writer cannot drift apart.
    #[test]
    fn the_stream_lines_are_the_goldens() {
        let id = FileTransferId::try_from("01JC8ZK4W2MX7N3Q5R9T6V0B1D").unwrap();
        let digest =
            Blake3Hex::try_from("b02750d32042f3e5061f34a1d35dd4c03cf03266de5063222e68afeca8b4b201")
                .unwrap();
        let progress = PullEvent::Progress {
            transfer_id: id.clone(),
            bytes: 16_384,
            total: 48_213,
        };
        assert_eq!(
            delta_json(&progress),
            golden("native-file-transfer-delta.progress.json")
        );
        let completed = PullEvent::Completed {
            transfer_id: id.clone(),
            digest: digest.clone(),
            incoming: format!("{}.{}", digest.as_str(), id.as_str()),
            bytes: 48_213,
            sha256: "075eeb056ba8f587858fe88dd968e5d29207d6537944d88d8826a56cb8e89a42".into(),
        };
        assert_eq!(
            delta_json(&completed),
            golden("native-file-transfer-delta.completed.json")
        );
        let failed = PullEvent::Failed {
            transfer_id: id.clone(),
            reason: mesh_file_transfer::FAILED_REJECTED,
            message: "the holder refused the pull".into(),
        };
        assert_eq!(
            delta_json(&failed),
            golden("native-file-transfer-delta.failed.json")
        );
        let row = NativeFileTransferRow {
            bytes: 16_384,
            digest,
            peer: "n4Kd8xQ2pLmR".into(),
            root: FileTransferRootName::DriveObjects,
            total: Some(48_213),
            transfer_id: id,
        };
        assert_eq!(
            snapshot_json(&[row]),
            golden("native-file-transfer-snapshot.valid.json")
        );
        assert_eq!(
            snapshot_json(&[]),
            golden("native-file-transfer-snapshot.empty.json")
        );
    }
}
