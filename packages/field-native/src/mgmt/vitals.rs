//! VT-1 — the vitals census on the management channel (`crate::vitals`): fieldd says which pids to measure beside
//! the floor's own, and reads every sample. Authorized as every verb here is: the hello, and the single-client rule.

use super::{err, ok, send_raw};
use crate::contracts::{NativeVitalsSubscribeParams, NativeVitalsWatchSetParams};
use crate::registries::vitals as limits;
use crate::state::{DaemonState, MgmtOutbox, OutMsg};
use crate::vitals::Watch;
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;

/// A subscription's later frames, named as every management subscription's are: fieldd's link routes a frame by
/// its `subId` only when its method ends `.delta` or `.snapshot`. The payload is one `NativeVitalsSample`.
const SAMPLE_METHOD: &str = "native.vitals.delta";

fn refused(id: Option<Value>, message: &str) -> Value {
    err(id, "PRECONDITION_FAILED", -32005, message, false, None)
}

pub fn watch_set(state: &Arc<DaemonState>, params: &Value, id: Option<Value>) -> Value {
    let Ok(parsed) = serde_json::from_value::<NativeVitalsWatchSetParams>(params.clone()) else {
        return refused(id, "expected { watch: [{ pid, tree }] }");
    };
    if parsed.watch.len() as u64 > limits::WATCH_MAX {
        return refused(id, "the watch list is longer than its bound");
    }
    let mut entries = Vec::with_capacity(parsed.watch.len());
    for entry in &parsed.watch {
        let Ok(pid) = u32::try_from(entry.pid.get()) else {
            return refused(id, "a pid is out of range");
        };
        entries.push(Watch {
            pid,
            tree: entry.tree,
        });
    }
    let watching = state.vitals.set_watch(entries);
    ok(id, json!({ "watching": watching }))
}

pub fn subscribe(state: &Arc<DaemonState>, tx: &MgmtOutbox, params: &Value, id: Option<Value>) {
    // `{}` and an absent params both ask for the newest sample alone
    let parsed = if params.is_null() {
        Ok(NativeVitalsSubscribeParams { since_seq: None })
    } else {
        serde_json::from_value::<NativeVitalsSubscribeParams>(params.clone())
    };
    let Ok(parsed) = parsed else {
        send_raw(
            tx,
            OutMsg::Line(refused(id, "expected { sinceSeq? }").to_string()),
        );
        return;
    };

    // Subscribe before the snapshot: a sample that races it is inside the snapshot or after its cursor, never
    // between the two.
    let vitals = state.vitals.clone();
    let mut updates = vitals.subscribe();
    let snapshot = vitals.snapshot(&state.boot_id, parsed.since_seq);
    let mut cursor = snapshot
        .samples
        .last()
        .map(|sample| sample.seq.get())
        .or(parsed.since_seq)
        .unwrap_or_else(|| *updates.borrow_and_update());
    let sub_id = state.sub_id();
    let Ok(snapshot) = serde_json::to_value(&snapshot) else {
        send_raw(
            tx,
            OutMsg::Line(
                err(
                    id,
                    "INTERNAL",
                    -32000,
                    "the snapshot could not be written",
                    false,
                    None,
                )
                .to_string(),
            ),
        );
        return;
    };
    send_raw(
        tx,
        OutMsg::Line(ok(id, json!({ "subId": sub_id, "snapshot": snapshot })).to_string()),
    );

    let tx = tx.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                changed = updates.changed() => {
                    if changed.is_err() {
                        break;
                    }
                }
                // a meter that is not running sends nothing: this is how a closed connection is noticed then
                _ = tokio::time::sleep(Duration::from_secs(5)) => {
                    if tx.is_closed() {
                        break;
                    }
                    continue;
                }
            }
            updates.borrow_and_update();
            for sample in vitals.samples_after(cursor) {
                cursor = sample.seq.get();
                let Ok(payload) = serde_json::to_value(&*sample) else {
                    continue;
                };
                let note = json!({
                    "jsonrpc": "2.0",
                    "method": SAMPLE_METHOD,
                    "params": { "subId": sub_id, "payload": payload }
                });
                if tx.send(OutMsg::Line(note.to_string())).is_err() {
                    return;
                }
            }
        }
    });
}
