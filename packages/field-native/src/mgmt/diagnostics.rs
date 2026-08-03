use super::{err, ok, send_raw};
use crate::state::{DaemonState, MgmtOutbox, OutMsg};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(MAX_SAFE_INTEGER as u128) as u64
}

fn unavailable(id: Option<Value>) -> Value {
    err(
        id,
        "UNAVAILABLE",
        -32006,
        "native diagnostics are not configured",
        true,
        Some(json!({"service":"field-native","state":"unavailable"})),
    )
}

pub fn query(state: &Arc<DaemonState>, params: &Value, id: Option<Value>) -> Value {
    let Some(logging) = state.logging.as_ref() else {
        return unavailable(id);
    };
    let query = match crate::logging::NativeLogging::parse_query(params) {
        Ok(query) => query,
        Err(message) => return err(id, "PRECONDITION_FAILED", -32005, &message, false, None),
    };
    ok(id, logging.snapshot(&query))
}

pub fn lease_create(state: &Arc<DaemonState>, params: &Value, id: Option<Value>) -> Value {
    let Some(logging) = state.logging.as_ref().cloned() else {
        return unavailable(id);
    };
    let Some(lease) = params.get("lease") else {
        return err(
            id,
            "PRECONDITION_FAILED",
            -32005,
            "expected { lease }",
            false,
            None,
        );
    };
    let created = match logging.create_diagnostic_lease(lease) {
        Ok(created) => created,
        Err(message) => return err(id, "PRECONDITION_FAILED", -32005, &message, false, None),
    };
    if let Some(expires_at) = created.get("expiresAt").and_then(Value::as_u64) {
        if expires_at < MAX_SAFE_INTEGER {
            let delay = Duration::from_millis(expires_at.saturating_sub(now_millis()));
            tokio::spawn(async move {
                tokio::time::sleep(delay).await;
                if let Err(error) = logging.prune_diagnostic_leases() {
                    tracing::warn!(
                        event = "field_native.diagnostics.lease_expiry_failed",
                        component = "diagnostics",
                        error = %error,
                        "A native diagnostic lease expired but its filter could not be restored"
                    );
                }
            });
        }
    }
    ok(id, created)
}

pub fn lease_list(state: &Arc<DaemonState>, id: Option<Value>) -> Value {
    let Some(logging) = state.logging.as_ref() else {
        return unavailable(id);
    };
    match logging.list_diagnostic_leases() {
        Ok(leases) => ok(id, json!({"v":1,"observedAt":now_millis(),"leases":leases})),
        Err(message) => err(id, "INTERNAL", -32000, &message, false, None),
    }
}

pub fn lease_revoke(state: &Arc<DaemonState>, params: &Value, id: Option<Value>) -> Value {
    let Some(logging) = state.logging.as_ref() else {
        return unavailable(id);
    };
    let Some(lease_id) = params
        .get("leaseId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.len() <= 256)
    else {
        return err(
            id,
            "PRECONDITION_FAILED",
            -32005,
            "expected { leaseId }",
            false,
            None,
        );
    };
    match logging.revoke_diagnostic_lease(lease_id) {
        Ok(revoked) => ok(id, json!({"revoked":revoked})),
        Err(message) => err(id, "INTERNAL", -32000, &message, false, None),
    }
}

pub fn subscribe(state: &Arc<DaemonState>, tx: &MgmtOutbox, params: &Value, id: Option<Value>) {
    let Some(logging) = state.logging.as_ref().cloned() else {
        send_raw(tx, OutMsg::Line(unavailable(id).to_string()));
        return;
    };
    let query = match crate::logging::NativeLogging::parse_query(params) {
        Ok(query) => query,
        Err(message) => {
            send_raw(
                tx,
                OutMsg::Line(
                    err(id, "PRECONDITION_FAILED", -32005, &message, false, None).to_string(),
                ),
            );
            return;
        }
    };

    // Subscribe before taking the snapshot: a record racing the snapshot is
    // then either inside that snapshot or visible as a later cursor, never
    // silently between the two.
    let mut updates = logging.subscribe_updates();
    let snapshot = logging.snapshot(&query);
    let mut cursor = snapshot
        .get("nextCursor")
        .and_then(Value::as_str)
        .and_then(crate::logging::NativeLogging::cursor_from)
        .unwrap_or(0);
    let sub_id = state.sub_id();
    send_raw(
        tx,
        OutMsg::Line(ok(id, json!({"subId":sub_id,"snapshot":snapshot})).to_string()),
    );

    let tx = tx.clone();
    tokio::spawn(async move {
        let mut backlog = false;
        loop {
            if !backlog {
                tokio::select! {
                    changed = updates.changed() => {
                        if changed.is_err() {
                            break;
                        }
                    }
                    _ = tokio::time::sleep(Duration::from_secs(1)) => {
                        if tx.is_closed() {
                            break;
                        }
                        continue;
                    }
                }
            }
            // Coalesce producer bursts globally at the management boundary.
            // The sole mgmt principal can have multiple views without creating
            // a filesystem watcher or affecting the writer.
            tokio::time::sleep(Duration::from_millis(100)).await;
            let target_cursor = *updates.borrow_and_update();
            let delta = logging.delta(&query, cursor);
            cursor = delta
                .get("cursor")
                .and_then(Value::as_str)
                .and_then(crate::logging::NativeLogging::cursor_from)
                .unwrap_or(cursor);
            backlog = cursor < target_cursor;
            let note = json!({
                "jsonrpc":"2.0",
                "method":"native.diagnostics.delta",
                "params":{"subId":sub_id,"payload":delta}
            });
            if tx.send(OutMsg::Line(note.to_string())).is_err() {
                break;
            }
        }
    });
}
