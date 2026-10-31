//! CP-1a — `native.door.*`: the floor's door (`services/door`) as the management channel sees it.
//!
//! The door stream is snapshot-then-delta (P5), like the lane stream, with one difference that is the CO lead's ruling
//! of 2026-10-29: it never costs fieldd its connection. Its events come from callers, and a same-uid process can open
//! and close doors as fast as it can connect, so every line goes through `MgmtOutbox::offer_rebuildable`. A line the
//! outbox has no headroom for is dropped, and the stream then owes its reader one `.snapshot`, offered until it fits.
//! `send` would close the connection on saturation instead (EL7). A lag past the event buffer is owed the same way.
//!
//! A subscription is also what lets fieldd be sent doors' bytes (`DoorHandle::subscriber`): taken after the answer
//! that lists every door, and dropped when the connection goes.

use super::{err, ok, send};
use crate::contracts::{NativeDoorCloseParams, NativeDoorCloseResult, NativeDoorSubscribeResult};
use crate::services::door::{DoorEvent, DoorSubscriber};
use crate::state::{DaemonState, MgmtOutbox, Offered};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::broadcast::{self, error::RecvError, error::TryRecvError};

/// How long a stream owed a snapshot waits for the outbox's headroom before it offers again.
const SNAPSHOT_RETRY: Duration = Duration::from_millis(100);

pub(super) fn handle(
    state: &Arc<DaemonState>,
    tx: &MgmtOutbox,
    method: &str,
    params: Value,
    id: Option<Value>,
) {
    let reply = match method {
        "native.door.subscribe" => {
            let sub_id = state.sub_id();
            // Subscribe BEFORE the snapshot, answer BEFORE forwarding (the lane stream's order): a door opened in
            // between is a duplicate, never a miss.
            let events = state.door.subscribe_events();
            let result = NativeDoorSubscribeResult {
                snapshot: state.door.snapshot(),
                sub_id: sub_id.clone(),
            };
            send(tx, ok(id, json!(result)));
            // Only now may fieldd be sent doors' bytes: it has been told of every door that holds any.
            let subscriber = state.door.subscriber();
            spawn_door_forwarder(state.clone(), tx.clone(), events, sub_id, subscriber);
            return;
        }
        "native.door.close" => match serde_json::from_value::<NativeDoorCloseParams>(params) {
            Ok(close) => {
                let reason = close.reason.as_deref().unwrap_or("closed-by-fieldd");
                let closed = state.door.close(&close.conn_id, reason);
                ok(id, json!(NativeDoorCloseResult { closed }))
            }
            Err(e) => err(
                id,
                "PRECONDITION_FAILED",
                -32005,
                &format!("bad door close: {e}"),
                false,
                None,
            ),
        },
        "native.door.info" => match state.door.info() {
            Ok(info) => ok(id, json!(info)),
            Err(why) => {
                let health = state.door.health();
                let starting = matches!(health.state, crate::contracts::UnitState::Starting);
                err(
                    id,
                    "UNAVAILABLE",
                    -32006,
                    &why,
                    starting,
                    Some(json!({ "service": "door", "state": health.state })),
                )
            }
        },
        _ => err(id, "NOT_FOUND", -32601, "unknown door method", false, None),
    };
    send(tx, reply);
}

fn note(method: &str, sub_id: &str, payload: Value) -> String {
    json!({"jsonrpc": "2.0", "method": method, "params": {"subId": sub_id, "payload": payload}})
        .to_string()
}

fn spawn_door_forwarder(
    state: Arc<DaemonState>,
    tx: MgmtOutbox,
    mut events: broadcast::Receiver<DoorEvent>,
    sub_id: String,
    subscriber: DoorSubscriber,
) {
    tokio::spawn(async move {
        // fieldd is sent doors' bytes while this lives, and it lives as long as the connection
        let _subscriber = subscriber;
        let mut owed = false;
        loop {
            if owed {
                // what the snapshot covers is drained first, so it is not then sent again as deltas
                loop {
                    match events.try_recv() {
                        Ok(_) | Err(TryRecvError::Lagged(_)) => {}
                        Err(TryRecvError::Empty) => break,
                        Err(TryRecvError::Closed) => return,
                    }
                }
                let snapshot = json!(state.door.snapshot());
                match tx.offer_rebuildable(note("native.door.snapshot", &sub_id, snapshot)) {
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
                Ok(DoorEvent::Opened(open)) => json!(open),
                Ok(DoorEvent::Closed(closed)) => json!(closed),
                Err(RecvError::Lagged(_)) => {
                    owed = true;
                    continue;
                }
                Err(RecvError::Closed) => return,
            };
            match tx.offer_rebuildable(note("native.door.delta", &sub_id, payload)) {
                Ok(Offered::Queued) => {}
                Ok(Offered::Skipped) => owed = true,
                Err(_) => return,
            }
        }
    });
}
