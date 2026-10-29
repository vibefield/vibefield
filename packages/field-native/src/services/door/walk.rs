//! CP-1a — THE FLOOR WALKS (the CO lead's brief, 2026-10-29; `thinking-roled-agents.md` §16). A door's caller is
//! followed up its parents to the first live pane it was started in, so fieldd learns which pane a spark dialed from
//! and never reads a process table itself.
//!
//! A pane is known by its ROOT: the process the floor forked as it created the session (`ObservedTerminal.pid`).
//! A root's pid alone does not name it. The floor's row keeps listing that pid after the root has ended, and the
//! system hands an ended pid to another process in time. So a pid is the pane's root only when the process holding
//! it started with the pane: within `ROOT_BIRTH_TOLERANCE_MS` of `createdAt`. That is agent-gateway.ts's
//! `SHELL_BIRTH_TOLERANCE_MS` rule, for the same reason. ghosttea stamps `createdAt` with `now_ms()` just after the
//! PTY child is spawned (ghosttea 0.13.7 `session.rs:1462`), so a root and its row are milliseconds apart, and a
//! reused pid is minutes to days later.
//!
//! *On this base the rows do not say whether a pane has exited.* The `exited` mark arrives with AR-6 (`a3f403ecc`,
//! not on this base). Until it does, the birth rule is the only guard against a husk's pid, as it is agent-gateway's.

use super::peer::ProcessTable;
use crate::contracts::ObservedState;
use crate::registries::native_door::{ROOT_BIRTH_TOLERANCE_MS, WALK_MAX_STEPS};
use std::collections::HashSet;

/// One pane as the walk reads it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaneRoot {
    pub terminal_session_id: String,
    pub pid: u32,
    pub created_at_ms: u64,
}

/// The pane a caller was found in, and how many parents up its root stood (0: the caller IS the root).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub terminal_session_id: String,
    pub depth: u32,
}

/// The panes of the floor's observed inventory that name a root: a row with no pid or no birth names none.
pub fn pane_roots(observed: &ObservedState) -> Vec<PaneRoot> {
    observed
        .terminals
        .iter()
        .filter_map(|terminal| {
            Some(PaneRoot {
                terminal_session_id: terminal.session_id.clone(),
                pid: u32::try_from(terminal.pid?).ok().filter(|pid| *pid > 1)?,
                created_at_ms: u64::try_from(terminal.created_at?).ok()?,
            })
        })
        .collect()
}

/// Did the process that started at `started_at_ms` start with the pane born at `created_at_ms`?
pub fn born_with(started_at_ms: u64, created_at_ms: u64) -> bool {
    started_at_ms.abs_diff(created_at_ms) <= ROOT_BIRTH_TOLERANCE_MS
}

/// From `caller` up its parents, at most `WALK_MAX_STEPS` of them, to the first pane whose root it reaches. It ends
/// with none at the system's first process (pid 1, or 0), at a process the table no longer knows, or on a cycle,
/// which a live table never holds and a racing read can.
pub fn walk(table: &impl ProcessTable, caller: u32, panes: &[PaneRoot]) -> Option<Found> {
    let mut pid = caller;
    let mut seen = HashSet::new();
    for depth in 0..=WALK_MAX_STEPS as u32 {
        if pid <= 1 || !seen.insert(pid) {
            return None;
        }
        let facts = table.process(pid)?;
        let root = panes
            .iter()
            .find(|pane| pane.pid == pid && born_with(facts.started_at_ms, pane.created_at_ms));
        if let Some(pane) = root {
            return Some(Found {
                terminal_session_id: pane.terminal_session_id.clone(),
                depth,
            });
        }
        pid = facts.parent;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::super::peer::ProcessFacts;
    use super::*;
    use std::collections::HashMap;

    const BIRTH: u64 = 1_792_431_660_000;

    /// A fixed tree: pid → (parent, start).
    struct Tree(HashMap<u32, ProcessFacts>);

    impl Tree {
        fn new(rows: &[(u32, u32, u64)]) -> Self {
            Self(
                rows.iter()
                    .map(|&(pid, parent, started_at_ms)| {
                        (
                            pid,
                            ProcessFacts {
                                parent,
                                started_at_ms,
                            },
                        )
                    })
                    .collect(),
            )
        }
    }

    impl ProcessTable for Tree {
        fn process(&self, pid: u32) -> Option<ProcessFacts> {
            self.0.get(&pid).copied()
        }
    }

    fn pane(id: &str, pid: u32, created_at_ms: u64) -> PaneRoot {
        PaneRoot {
            terminal_session_id: id.into(),
            pid,
            created_at_ms,
        }
    }

    /// launchd ← the floor's cell ← a pane root (a shell) ← an agent ← its MCP bridge; and an outsider beside it.
    fn desk() -> Tree {
        Tree::new(&[
            (1, 0, 0),
            (400, 1, BIRTH - 3_600_000),
            (500, 400, BIRTH - 12),
            (510, 500, BIRTH + 4_000),
            (520, 510, BIRTH + 9_000),
            (900, 1, BIRTH),
        ])
    }

    #[test]
    fn a_grandchild_of_a_pane_root_resolves_to_its_pane() {
        let panes = [pane("pane-a", 500, BIRTH)];
        let found = walk(&desk(), 520, &panes).expect("found");
        assert_eq!(found.terminal_session_id, "pane-a");
        assert_eq!(found.depth, 2);
        assert_eq!(walk(&desk(), 500, &panes).map(|f| f.depth), Some(0));
    }

    #[test]
    fn an_outsider_resolves_to_no_pane() {
        let panes = [pane("pane-a", 500, BIRTH)];
        assert_eq!(walk(&desk(), 900, &panes), None);
        assert_eq!(walk(&desk(), 400, &panes), None);
    }

    #[test]
    fn a_pid_reused_after_its_pane_ended_is_not_the_pane() {
        // the row still lists 510's number as a root born an hour ago: 510 started at BIRTH + 4 s, so it is not that
        // root, and the walk goes on past it to the live pane above
        let panes = [
            pane("husk", 510, BIRTH - 3_600_000),
            pane("pane-a", 500, BIRTH),
        ];
        let found = walk(&desk(), 520, &panes).expect("found");
        assert_eq!(
            (found.terminal_session_id.as_str(), found.depth),
            ("pane-a", 2)
        );
    }

    #[test]
    fn a_root_and_its_row_agree_within_the_tolerance_either_way() {
        assert!(born_with(BIRTH, BIRTH + ROOT_BIRTH_TOLERANCE_MS));
        assert!(born_with(BIRTH + ROOT_BIRTH_TOLERANCE_MS, BIRTH));
        assert!(!born_with(BIRTH, BIRTH + ROOT_BIRTH_TOLERANCE_MS + 1));
        // `ps` and a loaded host: a whole second late is the same birth
        assert!(born_with(BIRTH - 999, BIRTH));
    }

    #[test]
    fn the_walk_ends_at_its_bound_on_a_cycle_and_at_a_vanished_parent() {
        // a chain of WALK_MAX_STEPS parents above the caller reaches a root at the bound, and one more does not
        let steps = WALK_MAX_STEPS as u32;
        let rows: Vec<(u32, u32, u64)> = (0..=steps + 1)
            .map(|i| (1_000 + i, 1_000 + i + 1, BIRTH))
            .collect();
        let chain = Tree::new(&rows);
        assert_eq!(
            walk(&chain, 1_000, &[pane("far", 1_000 + steps, BIRTH)]).map(|f| f.depth),
            Some(steps)
        );
        assert_eq!(
            walk(&chain, 1_000, &[pane("too-far", 1_000 + steps + 1, BIRTH)]),
            None
        );
        let cycle = Tree::new(&[(30, 31, BIRTH), (31, 30, BIRTH)]);
        assert_eq!(walk(&cycle, 30, &[pane("p", 99, BIRTH)]), None);
        let orphaned = Tree::new(&[(40, 41, BIRTH)]);
        assert_eq!(walk(&orphaned, 40, &[pane("p", 41, BIRTH)]), None);
    }

    #[test]
    fn rows_without_a_root_or_a_birth_name_no_pane() {
        let observed: ObservedState = serde_json::from_value(serde_json::json!({
            "generation": 1,
            "bootId": "b",
            "terminals": [
                { "sessionId": "rooted", "pid": 500, "createdAt": BIRTH },
                { "sessionId": "no-pid", "createdAt": BIRTH },
                { "sessionId": "no-birth", "pid": 501 },
                { "sessionId": "launchd", "pid": 1, "createdAt": BIRTH }
            ],
            "workers": []
        }))
        .unwrap();
        assert_eq!(pane_roots(&observed), vec![pane("rooted", 500, BIRTH)]);
    }
}
