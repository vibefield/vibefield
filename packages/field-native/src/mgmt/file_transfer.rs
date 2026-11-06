//! DR-3a (W3, VF-FLOOR) — `native.mesh.fileTransfer.*`, the facade's file
//! transfer verbs (contracts mgmt.ts, the file transfer's header; the
//! substrate is `services/file_transfer.rs`).
//!
//! Answered BEFORE the mesh facade's node gate, as egress's verbs are
//! (`mgmt/mesh_egress.rs`), and for the same reason: the contract's refusal
//! order is egress's (W3-1, VF-PM 2026-11-06), and its step 1 is a capability
//! fact that holds whether or not a node is up. The node gate's generic
//! UNAVAILABLE would hide it, and a reader told `mesh-gateway` instead would
//! wait for a node that can never pull by a named root.
//!
//! This slice carries step 1 alone: an arm that cannot pull by a named root
//! (`UnsupportedFileTransfer`, the only arm the floor builds at the `=0.7.24`
//! pin) answers EVERY verb `file-transfer-unsupported`. Steps 2-6 (subscribe
//! with no node, the node gate, MESH_CAPTURING, params, ROOT_UNGATED, CONFLICT,
//! RESOURCE_EXHAUSTED) come with the named-root arm (W3's stack B).
//!
//! CONTROL ONLY (EL2): no byte of an object crosses this channel.

use crate::registries::mesh_file_transfer;
use crate::state::{DaemonState, MgmtOutbox};
use serde_json::{json, Value};
use std::sync::Arc;

use super::{err, send};

type Tx = MgmtOutbox;

pub fn handle(state: &Arc<DaemonState>, tx: &Tx, id: Option<Value>) {
    if !state.mesh.file_transfer().supported() {
        send(tx, unsupported(id));
        return;
    }
    // No arm this floor builds is supported (`services/file_transfer.rs`'s
    // `default_backend`), so no request reaches here: the verbs a supported arm
    // answers are W3's stack B. Until then this is the answer a node gave them
    // before this facade, NOT_FOUND.
    send(
        tx,
        err(id, "NOT_FOUND", -32601, "method not found", false, None),
    );
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
