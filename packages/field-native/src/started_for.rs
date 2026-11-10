//! OB custody (§8.1, rule 6) — WHAT EACH TERMINAL WAS STARTED FOR (`CUSTODY-SPEC.md` §8.1.0; contracts custody.ts
//! `TerminalStartedFor`, envelope.ts `HelloAck.startedFor`, registries.ts `CUSTODY.STARTED_FOR_MAX`).
//!
//! An agent fieldd launched goes on running in its terminal after fieldd is gone, and the fieldd that pairs next has
//! to say whose run it is. A record on disk cannot tell it: the agent can rewrite its own. This floor outlives
//! fieldd, and where it was handed its pairing secret only a holder of that secret can speak to it. So fieldd tells
//! the floor what it started in a terminal (`native.terminal.startedFor.set`, `mgmt/started_for.rs`), the floor
//! keeps that here, IN MEMORY, and says it in every hello ack (`mgmt/mod.rs`, `handle_hello`).
//!
//! - **An entry stands on a process, not on a number.** At the set the floor reads the pane root's start from the
//!   kernel itself and keeps it. An entry stands while its session is a running pane still rooted at that pid AND
//!   the process holding that pid has that start. The ack hands on the entries that stand and drops the rest.
//! - **A root that execs keeps its entry** (the PM, condition 3). Another image under the same pid has the same
//!   kernel start: it is still the process fieldd launched.
//! - **The door's walk reads the same start** (`root_starts`; `services/door`): a pane with an entry is known by pid
//!   and that exact start, as a helper root is, never by the minute a pane without one is allowed (§8.1.12).
//! - **Bounded** (`STARTED_FOR_MAX`): a new session at the bound first drops what no longer stands.
//! - **Never said in a log, at any level** (the PM, condition 4). An entry names runs and sparks, and the floor's log
//!   stream is passed on by fieldd's diagnostics. So nothing here formats an entry, the types that hold one derive no
//!   `Debug`, and a caller logs `count` and nothing else (`tests/started_for_canary.rs`).
//! - **Only a floor that was handed its pairing secret has this table at all** (`DaemonState::started_for`). Where
//!   the secret is a file a pane can read, anyone can pair, and a table would be a record by another name.

use crate::contracts::{ObservedState, TerminalStartedFor};
use crate::registries::custody::STARTED_FOR_MAX;
use crate::services::door::peer::ProcessTable;
use crate::services::door::walk::{born_with, pane_roots, same_start, PaneRoot};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;

/// The lowest pid an entry's `process` may name (`TerminalStartedForProcess.pid`, contracts: an integer of 2 or
/// more). The generated type carries no such bound, so the floor holds it by hand (the PM, 2026-11-10): neither side
/// trusts the other's generator, and nothing out of bound is kept or handed back.
const LOWEST_PID: i128 = 2;

/// Why a set was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refused {
    /// the entry is not one the contract allows: its `process` names a pid below 2
    OutOfBounds,
    /// no running pane of that id, or no process this floor can read as its root
    NotFound,
    /// the table is at its bound, and nothing in it could be dropped
    Full,
}

/// One terminal's entry: what fieldd said, and the pane root it was said of.
struct Kept {
    entry: TerminalStartedFor,
    root_pid: u32,
    /// the root's start as the floor read it from the kernel at the set, never as a caller said it
    root_start_ms: u64,
}

/// The floor's table, by terminal session. Only the management channel writes here (EL7).
#[derive(Default)]
pub struct StartedFor(Mutex<BTreeMap<String, Kept>>);

impl StartedFor {
    /// The verb: with `entry` a set, with none a clear. In order: an entry out of the contract's bounds is refused and
    /// changes nothing; a session that is not listed and running is not found, and whatever was kept for it goes; a
    /// clear removes, and clearing nothing is an answer too; a set reads the pane's root from `table` and is not
    /// found when the row names no root, the process is gone, or it did not start with the pane; a new session at
    /// the bound drops what no longer stands, and is refused if the table is still full. Replacing an entry is never
    /// refused for the bound.
    pub fn set(
        &self,
        table: &impl ProcessTable,
        observed: &ObservedState,
        session_id: &str,
        entry: Option<TerminalStartedFor>,
    ) -> Result<(), Refused> {
        if entry.as_ref().is_some_and(out_of_bounds) {
            return Err(Refused::OutOfBounds);
        }
        let panes = pane_roots(observed);
        let mut entries = self.0.lock().unwrap();
        if !runs(observed, session_id) {
            entries.remove(session_id);
            return Err(Refused::NotFound);
        }
        let Some(entry) = entry else {
            entries.remove(session_id);
            return Ok(());
        };
        let Some((root_pid, root_start_ms)) = root_of(table, &panes, session_id) else {
            // what was kept was said of the root that is no longer there
            entries.remove(session_id);
            return Err(Refused::NotFound);
        };
        if !entries.contains_key(session_id) && at_bound(&entries) {
            drop_fallen(&mut entries, table, &panes);
            if at_bound(&entries) {
                return Err(Refused::Full);
            }
        }
        let kept = Kept {
            entry,
            root_pid,
            root_start_ms,
        };
        entries.insert(session_id.to_owned(), kept);
        Ok(())
    }

    /// The table as a hello ack says it: every entry that still stands, each with the session it is for
    /// (`TerminalStartedForEntry`). The others are dropped here.
    pub fn handed(&self, table: &impl ProcessTable, observed: &ObservedState) -> Vec<Value> {
        let panes = pane_roots(observed);
        let mut entries = self.0.lock().unwrap();
        drop_fallen(&mut entries, table, &panes);
        entries
            .iter()
            .filter_map(|(session_id, kept)| said(session_id, &kept.entry))
            .collect()
    }

    /// Each pane root an entry was said of, by session: its pid, and the start read at the set. The door's walk
    /// matches such a pane by these and by nothing looser.
    pub fn root_starts(&self) -> HashMap<String, (u32, u64)> {
        let entries = self.0.lock().unwrap();
        entries
            .iter()
            .map(|(session_id, kept)| (session_id.clone(), (kept.root_pid, kept.root_start_ms)))
            .collect()
    }

    /// How many entries are held: all a log may say of this table.
    pub fn count(&self) -> usize {
        self.0.lock().unwrap().len()
    }
}

/// Does this entry's `process` name a pid the contract does not allow? Read through `i128` so the check holds
/// whichever whole-number type the generator gave the field.
fn out_of_bounds(entry: &TerminalStartedFor) -> bool {
    let process = entry.process.as_ref();
    process.is_some_and(|process| i128::from(process.pid) < LOWEST_PID)
}

/// Is `session_id` listed, with a process that has not ended?
fn runs(observed: &ObservedState, session_id: &str) -> bool {
    let mut rows = observed.terminals.iter();
    rows.any(|row| row.session_id == session_id && row.exited != Some(true))
}

/// The root of `session_id`'s pane as the kernel has it now: its pid and its start, when the process holding the
/// row's pid started with the pane. The row's birth is ghosttea's clock and the start is the kernel's, so this is the
/// walk's own rule for a pane nothing has been said of (`born_with`); what is KEPT is the kernel's start, exact.
fn root_of(table: &impl ProcessTable, panes: &[PaneRoot], session_id: &str) -> Option<(u32, u64)> {
    let pane = panes
        .iter()
        .find(|pane| pane.terminal_session_id == session_id)?;
    let facts = table.process(pane.pid)?;
    born_with(facts.started_at_ms, pane.created_at_ms).then_some((pane.pid, facts.started_at_ms))
}

fn at_bound(entries: &BTreeMap<String, Kept>) -> bool {
    entries.len() as u64 >= STARTED_FOR_MAX
}

/// Drop every entry that no longer stands: its session is not a running pane rooted at the pid it was said of, or
/// that pid is gone, or the process holding it has another start.
fn drop_fallen(
    entries: &mut BTreeMap<String, Kept>,
    table: &impl ProcessTable,
    panes: &[PaneRoot],
) {
    let rooted: HashMap<&str, u32> = panes
        .iter()
        .map(|pane| (pane.terminal_session_id.as_str(), pane.pid))
        .collect();
    entries.retain(|session_id, kept| {
        rooted.get(session_id.as_str()) == Some(&kept.root_pid)
            && table
                .process(kept.root_pid)
                .is_some_and(|facts| same_start(facts.started_at_ms, kept.root_start_ms))
    });
}

/// One entry as the ack says it: its own fields, and the session it is for. An entry that will not serialize is not
/// said, and is not described either.
fn said(session_id: &str, entry: &TerminalStartedFor) -> Option<Value> {
    let Ok(Value::Object(mut fields)) = serde_json::to_value(entry) else {
        return None;
    };
    fields.insert("sessionId".to_owned(), Value::String(session_id.to_owned()));
    Some(Value::Object(fields))
}
