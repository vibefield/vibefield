//! OB custody (C5) — `native.marks.set`: the floor's marks (`crate::marks`) as the management channel sees them.
//!
//! fieldd tells the floor a named number, and the floor answers what it keeps: the highest it was ever told under
//! that name. The verb is answered here and nowhere else, past the hello and the per-request single-client rule in
//! `handle_conn`, so nothing a caller does at the door, and no connection a newer fieldd superseded, can raise a mark
//! (EL7). What is held rides every hello ack (`handle_hello`, `HelloAck.marks`).
//!
//! Its refusals are the helper roots' shape (`mgmt/door.rs`): params that do not parse (a name off the contract's
//! pattern among them) are PRECONDITION_FAILED with no details, and one name past the bound is PRECONDITION_FAILED
//! with `details.reason: "marks-full"`.

use super::{err, ok};
use crate::contracts::{NativeMarksSetParams, NativeMarksSetResult};
use crate::state::DaemonState;
use serde_json::{json, Value};

pub(super) fn set(state: &DaemonState, params: Value, id: Option<Value>) -> Value {
    match serde_json::from_value::<NativeMarksSetParams>(params) {
        Ok(mark) => match state.marks.set(mark.name.as_str(), mark.value) {
            Ok(value) => ok(id, json!(NativeMarksSetResult { value })),
            Err(refused) => err(
                id,
                "PRECONDITION_FAILED",
                -32005,
                "the floor holds as many marks as it keeps",
                false,
                Some(json!({ "reason": refused.reason() })),
            ),
        },
        Err(e) => err(
            id,
            "PRECONDITION_FAILED",
            -32005,
            &format!("bad mark: {e}"),
            false,
            None,
        ),
    }
}
