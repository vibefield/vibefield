//! OB custody (§8.1) — `native.terminal.startedFor.set`: fieldd says what it started in a terminal, or that nothing
//! is started there any more (contracts mgmt.ts `NativeTerminalStartedForSet*`). The table,
//! its rules and why it exists are `crate::started_for`.
//!
//! In order:
//! - A floor that was not handed its pairing secret keeps no table: `PRECONDITION_FAILED`, `details.reason:
//!   "not-sealed"`, before a word of the params is read.
//! - Params that are not the contract's: `PRECONDITION_FAILED`, the floor's one refusal for those (the error registry
//!   has no kind for invalid params). The message quotes nothing of them. serde's error names the value it stumbled
//!   on, and an entry's values are said in the hello ack and nowhere else. A `process.pid` below 2 is this refusal
//!   too, held by hand: the generated type carries no such bound (`started_for.rs`, `LOWEST_PID`).
//! - The session is not listed and running in the floor's inventory NOW, or (a set) the floor cannot read a process
//!   as its pane's root: `NOT_FOUND`.
//! - A new session at the bound, with nothing in the table to drop: `PRECONDITION_FAILED`, `details.reason:
//!   "started-for-full"`.
//! - Else `{}`: kept, replaced, or cleared (clearing nothing is `{}` too).
//!
//! The process table is the kernel's (`Kernel`): the root's start is read here, never taken from the caller.

use super::{err, ok};
use crate::contracts::NativeTerminalStartedForSetParams;
use crate::services::door::peer::Kernel;
use crate::started_for::Refused;
use crate::state::DaemonState;
use serde_json::{json, Value};

/// `details.reason`: this floor's pairing secret is a file, and it keeps no table.
const NOT_SEALED: &str = "not-sealed";
/// `details.reason`: the table is at its bound.
const FULL: &str = "started-for-full";
/// The one message for params that are not the contract's: it names no value of theirs.
const BAD_PARAMS: &str = "bad started-for: the params are not the contract's";

pub(super) fn set(state: &DaemonState, params: Value, id: Option<Value>) -> Value {
    let Some(table) = state.started_for() else {
        return err(
            id,
            "PRECONDITION_FAILED",
            -32005,
            "this floor was not handed its pairing secret, and keeps no such table",
            false,
            Some(json!({ "reason": NOT_SEALED })),
        );
    };
    let Ok(set) = serde_json::from_value::<NativeTerminalStartedForSetParams>(params) else {
        return err(id, "PRECONDITION_FAILED", -32005, BAD_PARAMS, false, None);
    };
    let session_id = set.session_id.as_str();
    let asked = {
        let observed = state.observed_tx.borrow();
        table.set(&Kernel, &observed, session_id, set.started_for)
    };
    match asked {
        Ok(()) => ok(id, json!({})),
        Err(Refused::OutOfBounds) => {
            err(id, "PRECONDITION_FAILED", -32005, BAD_PARAMS, false, None)
        }
        Err(Refused::NotFound) => err(
            id,
            "NOT_FOUND",
            -32003,
            "no running terminal of that id has a root this floor can read",
            false,
            None,
        ),
        Err(Refused::Full) => err(
            id,
            "PRECONDITION_FAILED",
            -32005,
            "the floor holds as many entries as it keeps",
            false,
            Some(json!({ "reason": FULL })),
        ),
    }
}
