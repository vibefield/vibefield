use super::{err, ok, send_raw};
use crate::state::{DaemonState, OutMsg};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

pub fn query(state: &Arc<DaemonState>, params: &Value, id: Option<Value>) -> Value {
    let Some(logging) = state.logging.as_ref() else {
        return err(
            id,
            "UNAVAILABLE",
            -32006,
            "native diagnostics are not configured",
            true,
            Some(json!({"service":"field-native","state":"unavailable"})),
        );
    };
    let query = match crate::logging::NativeLogging::parse_query(params) {
        Ok(query) => query,
        Err(message) => return err(id, "PRECONDITION_FAILED", -32005, &message, false, None),
    };
    ok(id, logging.snapshot(&query))
}

pub fn subscribe(
    state: &Arc<DaemonState>,
    tx: &mpsc::UnboundedSender<OutMsg>,
    params: &Value,
    id: Option<Value>,
) {
    let Some(logging) = state.logging.as_ref().cloned() else {
        send_raw(
            tx,
            OutMsg::Line(
                err(
                    id,
                    "UNAVAILABLE",
                    -32006,
                    "native diagnostics are not configured",
                    true,
                    Some(json!({"service":"field-native","state":"unavailable"})),
                )
                .to_string(),
            ),
        );
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
