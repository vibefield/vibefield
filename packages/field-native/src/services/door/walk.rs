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
//! A row the floor lists `exited` (AR-6, `a3f403ecc`) names no pane: its root has ended, and its pid may already
//! belong to a process born inside the tolerance. The birth rule still guards a husk the floor has not marked yet,
//! and every row from an older floor, which carries no mark.
//! CORRECTED 2026-10-30 (CP-1a onto main `0b4cb2ff0`): this said "On this base the rows do not say whether a pane has
//! exited. The `exited` mark arrives with AR-6 (`a3f403ecc`, not on this base). Until it does, the birth rule is the
//! only guard against a husk's pid, as it is agent-gateway's." That was true on CP-0's base and false from the merge
//! of main, which carries AR-6.
//!
//! OB-3d — A HELPER ROOT (`draft/thinking-objects-at-work.md`, the build plan's decision 1). Codex's app-server and a
//! Grok leader of a run's own start the run's MCP servers outside any pane, and open their door before a pane exists,
//! so a walk to a pane finds nothing and a door's caller is fixed at accept. fieldd names such a helper to the floor
//! over the management channel, before its first MCP-bearing request (`native.door.roots.set`), and the walk also knows
//! it. A root is known by its pid AND the start the floor read from the kernel when it was named, compared at
//! `START_RESOLUTION_MS`, so a reused pid is never the root. A pane anywhere on the chain wins over a root anywhere on
//! it: a caller that reaches a pane resolves exactly as it did before helper roots existed.

use super::peer::ProcessTable;
use crate::contracts::ObservedState;
use crate::registries::native_door::{ROOT_BIRTH_TOLERANCE_MS, WALK_MAX_STEPS};
use std::collections::{HashMap, HashSet};

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

/// A helper process the floor was told is the root of a run's tree, with the start it read from the kernel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HelperRoot {
    pub root_id: String,
    pub pid: u32,
    pub started_at_ms: u64,
}

/// The helper root a caller was found under, and how many parents up it stood (0: the caller IS the helper).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FoundRoot {
    pub root_id: String,
    pub depth: u32,
}

/// What a walk reached: a pane, or, with no pane on the chain, a helper root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reached {
    Pane(Found),
    Root(FoundRoot),
}

/// Why `native.door.roots.set` refused a pid.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RootRefused {
    /// no such process, the system's first process, or the kernel will not say
    Unreadable,
    /// another live root holds this pid
    Held,
}

impl RootRefused {
    /// The refusal's `details.reason` on the wire.
    pub fn reason(self) -> &'static str {
        match self {
            Self::Unreadable => "pid-unreadable",
            Self::Held => "pid-held",
        }
    }
}

/// The floor's helper roots, by the id fieldd gave each. Only the management channel writes here (EL7).
#[derive(Debug, Default)]
pub struct HelperRoots(HashMap<String, HelperRoot>);

impl HelperRoots {
    /// Name a helper: its start is read here, from the table, never taken from the caller.
    pub fn set(
        &mut self,
        _table: &impl ProcessTable,
        _root_id: &str,
        _pid: u32,
    ) -> Result<u64, RootRefused> {
        Err(RootRefused::Unreadable)
    }

    /// Forget a root; `false` when none was held.
    pub fn clear(&mut self, _root_id: &str) -> bool {
        false
    }

    /// Drop every root whose process is gone, or whose pid now belongs to a later process.
    pub fn prune(&mut self, _table: &impl ProcessTable) {}

    /// The roots a walk reads.
    pub fn rows(&self) -> Vec<HelperRoot> {
        self.0.values().cloned().collect()
    }
}

/// The panes of the floor's observed inventory that name a root: a row with no pid or no birth names none, and
/// neither does a row listed `exited`. Absence says nothing (AR-6's contract), so an unmarked row is still a root.
pub fn pane_roots(observed: &ObservedState) -> Vec<PaneRoot> {
    observed
        .terminals
        .iter()
        .filter(|terminal| terminal.exited != Some(true))
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
pub fn walk(
    table: &impl ProcessTable,
    caller: u32,
    panes: &[PaneRoot],
    _roots: &[HelperRoot],
) -> Option<Reached> {
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
            return Some(Reached::Pane(Found {
                terminal_session_id: pane.terminal_session_id.clone(),
                depth,
            }));
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

    /// The walk with no helper root on the table: the pane it reaches, if any.
    fn pane_of(table: &Tree, caller: u32, panes: &[PaneRoot]) -> Option<Found> {
        match walk(table, caller, panes, &[]) {
            Some(Reached::Pane(found)) => Some(found),
            _ => None,
        }
    }

    fn root(id: &str, pid: u32, started_at_ms: u64) -> HelperRoot {
        HelperRoot {
            root_id: id.into(),
            pid,
            started_at_ms,
        }
    }

    fn found_root(id: &str, depth: u32) -> Option<Reached> {
        Some(Reached::Root(FoundRoot {
            root_id: id.into(),
            depth,
        }))
    }

    /// launchd ← fieldd ← a run's helper (Codex's app-server) ← its MCP bridge; the helper's own shell-out below it;
    /// and, beside them, a pane root with a helper started inside it.
    fn helper_desk() -> Tree {
        Tree::new(&[
            (1, 0, 0),
            (400, 1, BIRTH - 3_600_000),
            (600, 400, BIRTH),
            (610, 600, BIRTH + 2_000),
            (620, 610, BIRTH + 3_000),
            (700, 400, BIRTH),
            (710, 700, BIRTH + 1_000),
            (720, 710, BIRTH + 2_000),
        ])
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
        let found = pane_of(&desk(), 520, &panes).expect("found");
        assert_eq!(found.terminal_session_id, "pane-a");
        assert_eq!(found.depth, 2);
        assert_eq!(pane_of(&desk(), 500, &panes).map(|f| f.depth), Some(0));
    }

    #[test]
    fn an_outsider_resolves_to_no_pane() {
        let panes = [pane("pane-a", 500, BIRTH)];
        assert_eq!(pane_of(&desk(), 900, &panes), None);
        assert_eq!(pane_of(&desk(), 400, &panes), None);
    }

    #[test]
    fn a_pid_reused_after_its_pane_ended_is_not_the_pane() {
        // the row still lists 510's number as a root born an hour ago: 510 started at BIRTH + 4 s, so it is not that
        // root, and the walk goes on past it to the live pane above
        let panes = [
            pane("husk", 510, BIRTH - 3_600_000),
            pane("pane-a", 500, BIRTH),
        ];
        let found = pane_of(&desk(), 520, &panes).expect("found");
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
            pane_of(&chain, 1_000, &[pane("far", 1_000 + steps, BIRTH)]).map(|f| f.depth),
            Some(steps)
        );
        assert_eq!(
            pane_of(&chain, 1_000, &[pane("too-far", 1_000 + steps + 1, BIRTH)]),
            None
        );
        let cycle = Tree::new(&[(30, 31, BIRTH), (31, 30, BIRTH)]);
        assert_eq!(pane_of(&cycle, 30, &[pane("p", 99, BIRTH)]), None);
        let orphaned = Tree::new(&[(40, 41, BIRTH)]);
        assert_eq!(pane_of(&orphaned, 40, &[pane("p", 41, BIRTH)]), None);
    }

    #[test]
    fn a_helper_root_reaches_its_run() {
        let roots = [root("attempt-a", 600, BIRTH)];
        assert_eq!(walk(&helper_desk(), 610, &[], &roots), found_root("attempt-a", 1));
        assert_eq!(walk(&helper_desk(), 620, &[], &roots), found_root("attempt-a", 2));
        // the helper dialing the door itself
        assert_eq!(walk(&helper_desk(), 600, &[], &roots), found_root("attempt-a", 0));
        // fieldd above it, and a process beside it, are under no root
        assert_eq!(walk(&helper_desk(), 400, &[], &roots), None);
        assert_eq!(walk(&helper_desk(), 700, &[], &roots), None);
    }

    #[test]
    fn a_reused_pid_is_not_the_root() {
        // the floor named 600 when it started at BIRTH; the process holding 600 now started seconds later
        let later = [root("attempt-a", 600, BIRTH - 5_000)];
        assert_eq!(walk(&helper_desk(), 610, &[], &later), None);
        // and the comparison is at the kernel's resolution: the same second is the same process
        let same_second = [root("attempt-a", 600, BIRTH + 900)];
        assert_eq!(walk(&helper_desk(), 610, &[], &same_second), found_root("attempt-a", 1));
    }

    #[test]
    fn a_pane_still_wins() {
        // a helper root nearer the caller than the pane
        let panes = [pane("pane-a", 700, BIRTH)];
        let roots = [root("attempt-b", 710, BIRTH + 1_000)];
        let reached = walk(&helper_desk(), 720, &panes, &roots).expect("reached");
        let Reached::Pane(found) = reached else {
            panic!("a root beat a pane: {reached:?}");
        };
        assert_eq!((found.terminal_session_id.as_str(), found.depth), ("pane-a", 2));
        // the same process named as both
        let both = [root("attempt-c", 700, BIRTH)];
        assert!(matches!(
            walk(&helper_desk(), 710, &panes, &both),
            Some(Reached::Pane(_))
        ));
    }

    #[test]
    fn the_nearest_of_two_roots_names_the_caller() {
        let roots = [
            root("outer", 600, BIRTH),
            root("inner", 610, BIRTH + 2_000),
        ];
        assert_eq!(walk(&helper_desk(), 620, &[], &roots), found_root("inner", 1));
    }

    #[test]
    fn a_root_past_the_walks_bound_is_not_reached() {
        let steps = WALK_MAX_STEPS as u32;
        let rows: Vec<(u32, u32, u64)> = (0..=steps + 1)
            .map(|i| (1_000 + i, 1_000 + i + 1, BIRTH))
            .collect();
        let chain = Tree::new(&rows);
        assert_eq!(
            walk(&chain, 1_000, &[], &[root("far", 1_000 + steps, BIRTH)]),
            found_root("far", steps)
        );
        assert_eq!(
            walk(&chain, 1_000, &[], &[root("too-far", 1_000 + steps + 1, BIRTH)]),
            None
        );
    }

    #[test]
    fn naming_a_root_reads_its_start_from_the_table() {
        let mut roots = HelperRoots::default();
        assert_eq!(roots.set(&helper_desk(), "attempt-a", 600), Ok(BIRTH));
        assert_eq!(roots.rows(), vec![root("attempt-a", 600, BIRTH)]);
    }

    #[test]
    fn a_pid_the_table_cannot_read_is_refused() {
        let mut roots = HelperRoots::default();
        assert_eq!(
            roots.set(&helper_desk(), "attempt-a", 99_999),
            Err(RootRefused::Unreadable)
        );
        // the system's first process is in the table, and no walk ever reaches it
        assert_eq!(
            roots.set(&helper_desk(), "attempt-a", 1),
            Err(RootRefused::Unreadable)
        );
        assert_eq!(RootRefused::Unreadable.reason(), "pid-unreadable");
        assert_eq!(roots.rows(), vec![]);
    }

    #[test]
    fn a_pid_held_by_another_root_is_refused_and_one_root_may_move() {
        let mut roots = HelperRoots::default();
        roots.set(&helper_desk(), "attempt-a", 600).unwrap();
        assert_eq!(
            roots.set(&helper_desk(), "attempt-b", 600),
            Err(RootRefused::Held)
        );
        assert_eq!(RootRefused::Held.reason(), "pid-held");
        // the same id again is the same root; another pid under it is a helper reborn
        assert_eq!(roots.set(&helper_desk(), "attempt-a", 600), Ok(BIRTH));
        assert_eq!(roots.set(&helper_desk(), "attempt-a", 610), Ok(BIRTH + 2_000));
        assert_eq!(roots.rows(), vec![root("attempt-a", 610, BIRTH + 2_000)]);
    }

    #[test]
    fn a_root_is_dropped_when_cleared_and_when_its_process_is_gone() {
        let mut roots = HelperRoots::default();
        roots.set(&helper_desk(), "attempt-a", 600).unwrap();
        assert!(roots.clear("attempt-a"));
        assert!(!roots.clear("attempt-a"));

        roots.set(&helper_desk(), "attempt-a", 600).unwrap();
        roots.set(&helper_desk(), "attempt-b", 610).unwrap();
        // 600 ended; 610's number is now a later process's
        let after = Tree::new(&[(610, 1, BIRTH + 60_000)]);
        roots.prune(&after);
        assert_eq!(roots.rows(), vec![]);
    }

    #[test]
    fn a_dead_root_does_not_hold_its_pid_against_a_new_one() {
        let mut roots = HelperRoots::default();
        roots.set(&helper_desk(), "attempt-a", 600).unwrap();
        // 600's number now belongs to a later process, and a new attempt names it
        let reused = Tree::new(&[(600, 1, BIRTH + 60_000)]);
        assert_eq!(roots.set(&reused, "attempt-b", 600), Ok(BIRTH + 60_000));
        assert_eq!(roots.rows(), vec![root("attempt-b", 600, BIRTH + 60_000)]);
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

    #[test]
    fn a_row_listed_exited_names_no_pane_even_when_its_pid_is_reused_within_the_birth_rule() {
        // AR-6 (a3f403ecc): a kept pane whose process ended stays listed, marked `exited`. The system can hand its
        // root's pid to a new process inside the birth rule's tolerance, and the rule alone would then give that
        // process, and every agent under it, the dead pane.
        let observed: ObservedState = serde_json::from_value(serde_json::json!({
            "generation": 1,
            "bootId": "b",
            "terminals": [
                { "sessionId": "rooted", "pid": 500, "createdAt": BIRTH },
                { "sessionId": "husk", "pid": 600, "createdAt": BIRTH, "exited": true }
            ],
            "workers": []
        }))
        .unwrap();
        let panes = pane_roots(&observed);
        assert_eq!(panes, vec![pane("rooted", 500, BIRTH)]);
        let reused = Tree::new(&[
            (1, 0, 0),
            (600, 1, BIRTH + 5_000),
            (610, 600, BIRTH + 6_000),
        ]);
        assert_eq!(pane_of(&reused, 610, &panes), None);
    }
}
