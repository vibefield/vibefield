//! AL-8a (`draft/thinking-app-lifecycle.md` §8.3.1; AL-D10 "A", AL-D11 — James 2026-10-27 15:31Z) — the floor's own
//! orphan bound, and the record of how its management client left.
//!
//! fieldd bounds a pair no shell holds (AL-5); this is the same bound on the floor's side, for a floor whose fieldd is
//! gone. Only one of the two is ever armed: a management client holding the single-client slot disarms this one, and
//! its going arms it with a FRESH span. No session for the span — counted at the source, the cells, where a cell that
//! cannot be read is UNKNOWN and unknown is never idle — and the floor stops itself, planned (`idle`, the restart
//! intent AL-5 added), through the same shutdown arm `native.lifecycle.shutdown` wakes.
//!
//! A client that says `native.lifecycle.detach` before it closes left planned, and so did one a newer client
//! superseded; one that is simply gone (EOF without either: a fieldd crash) left unplanned. The next client's hello
//! carries the record ONCE (`HelloAck.lastManager`), and fieldd says it through AL-7's notice.

use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::contracts::{NativeLastManager, NativePrepareRestartParams, NativeRestartReason};
use crate::registries::{orphan_bound, terminal_inventory};
use crate::state::DaemonState;

/// The floor's own session count, read at the source; `None` = unknown (never idle).
pub type Census = Arc<dyn Fn() -> Option<u64> + Send + Sync>;

/// How a management client's slot emptied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Departure {
    /// its connection closed (EOF)
    Closed,
    /// a newer client's hello took the slot
    Superseded,
}

/// Who holds the management slot, since when nobody has, and how the last holder left.
pub struct ManagerPresence {
    inner: Mutex<Presence>,
    census: OnceLock<Census>,
}

struct Presence {
    /// the connection that said `native.lifecycle.detach`, until it leaves
    detaching: Option<u64>,
    /// since when no client holds the slot (from boot until the first hello)
    vacant_since: Option<Instant>,
    /// how the previous client left, handed to the next hello once
    last: Option<NativeLastManager>,
}

impl ManagerPresence {
    /// A floor boots with the slot empty: the bound runs from boot, so a floor whose fieldd never came is bounded too.
    pub fn new(now: Instant) -> Self {
        Self {
            inner: Mutex::new(Presence {
                detaching: None,
                vacant_since: Some(now),
                last: None,
            }),
            census: OnceLock::new(),
        }
    }

    /// Bootstrap's wiring: the terminal unit's count. An unconfigured floor (an embedded unit daemon) reads unknown.
    pub fn configure_census(&self, census: Census) {
        let _ = self.census.set(census);
    }

    pub fn census(&self) -> Option<u64> {
        self.census.get().and_then(|census| census())
    }

    /// A client authenticated and holds the slot: the bound is disarmed.
    pub fn held(&self) {
        self.inner.lock().unwrap().vacant_since = None;
    }

    /// `native.lifecycle.detach`: this connection is leaving on purpose.
    pub fn detach(&self, conn_id: u64) {
        self.inner.lock().unwrap().detaching = Some(conn_id);
    }

    /// The holder `conn_id` left the slot; answers whether it left planned. A closed slot arms the bound with a fresh
    /// span; a superseded one is held again at once by the hello that superseded it.
    pub fn left(&self, conn_id: u64, how: Departure, at_ms: u64, now: Instant) -> bool {
        let sessions = self.census();
        let mut inner = self.inner.lock().unwrap();
        let said = inner.detaching == Some(conn_id);
        if said {
            inner.detaching = None;
        }
        let planned = said || how == Departure::Superseded;
        inner.last = Some(NativeLastManager {
            planned,
            at: at_ms,
            sessions,
        });
        if how == Departure::Closed {
            inner.vacant_since = Some(now);
        }
        planned
    }

    /// The hello's `lastManager`: how the previous client left, once.
    pub fn take_last(&self) -> Option<NativeLastManager> {
        self.inner.lock().unwrap().last.take()
    }

    pub fn vacant_since(&self) -> Option<Instant> {
        self.inner.lock().unwrap().vacant_since
    }
}

/// What a poll of the bound decided.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verdict {
    Wait,
    /// a whole span with no client and a counted zero: confirm, then stop
    Stop,
}

/// The bound's policy, pure over the instants it is given.
pub struct OrphanBound {
    span: Duration,
    /// the vacancy this span belongs to: a new vacancy is a fresh span
    vacancy: Option<Instant>,
    /// since when the slot has been empty AND the count a counted zero
    idle_since: Option<Instant>,
}

impl OrphanBound {
    pub fn new(span: Duration) -> Self {
        Self {
            span,
            vacancy: None,
            idle_since: None,
        }
    }

    pub fn observe(
        &mut self,
        now: Instant,
        vacant_since: Option<Instant>,
        census: Option<u64>,
    ) -> Verdict {
        let Some(vacant) = vacant_since else {
            self.vacancy = None;
            self.idle_since = None;
            return Verdict::Wait;
        };
        if self.vacancy != Some(vacant) {
            self.vacancy = Some(vacant);
            self.idle_since = None;
        }
        if census != Some(0) {
            // a session, or a count that cannot be read: never idle on a guess
            self.idle_since = None;
            return Verdict::Wait;
        }
        // counted from the first read of a zero in this vacancy: zero is only known from when it was read
        let since = *self.idle_since.get_or_insert(now);
        if now.duration_since(since) >= self.span {
            Verdict::Stop
        } else {
            Verdict::Wait
        }
    }

    /// The confirming read found a session (or no count), or a client came back: a whole new span must pass.
    pub fn refused(&mut self) {
        self.idle_since = None;
    }
}

/// The bound's span and cadence: the registry's, or a test's (`FIELD_NATIVE_ORPHAN_IDLE_MS`, the floor-side seam the
/// isolation window uses — it never enters a cell). A scaled span polls at a tenth of it.
pub fn timings(span_override: Option<u64>) -> (Duration, Duration) {
    match span_override {
        Some(span) => (
            Duration::from_millis(span),
            Duration::from_millis((span / 10).max(10)),
        ),
        None => (
            Duration::from_millis(orphan_bound::IDLE_EXIT_MS),
            Duration::from_millis(orphan_bound::IDLE_POLL_MS),
        ),
    }
}

/// The bound, running: a whole span with no management client and no session, then a confirming read one inventory
/// sample later (a birth with no fieldd needs a grant fieldd minted before it went, so a session can still arrive),
/// then the `idle` intent and main's shutdown arm — the floor's own SIGTERM drain, never a kill.
pub fn spawn(
    state: Arc<DaemonState>,
    span: Duration,
    poll: Duration,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut bound = OrphanBound::new(span);
        let mut tick = tokio::time::interval(poll);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tick.tick().await;
            let verdict = bound.observe(
                Instant::now(),
                state.manager.vacant_since(),
                state.manager.census(),
            );
            if verdict == Verdict::Wait {
                continue;
            }
            tokio::time::sleep(Duration::from_millis(terminal_inventory::SAMPLE_MS)).await;
            let census = state.manager.census();
            if state.manager.vacant_since().is_none() || census != Some(0) {
                bound.refused();
                tracing::info!(
                    event = "field_native.lifecycle.idle_refused",
                    component = "lifecycle",
                    sessions = ?census,
                    "the orphan bound's confirming read found a session or a client; a whole new span must pass"
                );
                continue;
            }
            let intent = NativePrepareRestartParams {
                reason: NativeRestartReason::Idle,
                to_version: None,
            };
            let recorded = state
                .restart
                .record(&intent, &state.boot_id)
                .unwrap_or_else(|error| {
                    tracing::warn!(
                        event = "field_native.lifecycle.restart_intent_failed",
                        component = "lifecycle",
                        error = %error,
                        "the idle intent could not be recorded; the next boot will read unplanned"
                    );
                    false
                });
            tracing::info!(
                event = "field_native.lifecycle.idle_exit",
                component = "lifecycle",
                span_ms = span.as_millis() as u64,
                recorded,
                "no management client and no session for the orphan bound: the floor stops itself"
            );
            state.restart.request_shutdown();
            return;
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SPAN: Duration = Duration::from_millis(1_000);

    fn at(base: Instant, ms: u64) -> Instant {
        base + Duration::from_millis(ms)
    }

    #[test]
    fn a_whole_span_with_no_client_and_a_counted_zero_stops() {
        let t0 = Instant::now();
        let mut bound = OrphanBound::new(SPAN);
        assert_eq!(bound.observe(at(t0, 0), Some(t0), Some(0)), Verdict::Wait);
        assert_eq!(bound.observe(at(t0, 999), Some(t0), Some(0)), Verdict::Wait);
        assert_eq!(
            bound.observe(at(t0, 1_000), Some(t0), Some(0)),
            Verdict::Stop
        );
    }

    #[test]
    fn a_session_or_an_unknown_count_restarts_the_span() {
        let t0 = Instant::now();
        let mut bound = OrphanBound::new(SPAN);
        bound.observe(at(t0, 0), Some(t0), Some(0));
        assert_eq!(bound.observe(at(t0, 600), Some(t0), Some(1)), Verdict::Wait);
        assert_eq!(bound.observe(at(t0, 1_200), Some(t0), None), Verdict::Wait);
        assert_eq!(
            bound.observe(at(t0, 1_300), Some(t0), Some(0)),
            Verdict::Wait
        );
        assert_eq!(
            bound.observe(at(t0, 2_299), Some(t0), Some(0)),
            Verdict::Wait
        );
        assert_eq!(
            bound.observe(at(t0, 2_300), Some(t0), Some(0)),
            Verdict::Stop
        );
    }

    #[test]
    fn a_client_holding_the_slot_disarms_it_and_a_new_vacancy_is_a_fresh_span() {
        let t0 = Instant::now();
        let mut bound = OrphanBound::new(SPAN);
        bound.observe(at(t0, 0), Some(t0), Some(0));
        assert_eq!(bound.observe(at(t0, 900), None, Some(0)), Verdict::Wait);
        // a client came and went between two polls: the vacancy is new, so the span is too, counted from the
        // first poll that read the zero (1 100 ms), never from the earlier vacancy it could not see
        let again = at(t0, 950);
        assert_eq!(
            bound.observe(at(t0, 1_100), Some(again), Some(0)),
            Verdict::Wait
        );
        assert_eq!(
            bound.observe(at(t0, 2_099), Some(again), Some(0)),
            Verdict::Wait
        );
        assert_eq!(
            bound.observe(at(t0, 2_100), Some(again), Some(0)),
            Verdict::Stop
        );
    }

    #[test]
    fn a_refused_stop_waits_a_whole_new_span() {
        let t0 = Instant::now();
        let mut bound = OrphanBound::new(SPAN);
        bound.observe(at(t0, 0), Some(t0), Some(0));
        assert_eq!(
            bound.observe(at(t0, 1_000), Some(t0), Some(0)),
            Verdict::Stop
        );
        bound.refused();
        assert_eq!(
            bound.observe(at(t0, 1_100), Some(t0), Some(0)),
            Verdict::Wait
        );
        assert_eq!(
            bound.observe(at(t0, 2_099), Some(t0), Some(0)),
            Verdict::Wait
        );
        assert_eq!(
            bound.observe(at(t0, 2_100), Some(t0), Some(0)),
            Verdict::Stop
        );
    }

    #[test]
    fn a_detach_reads_planned_a_close_without_it_unplanned_and_a_supersession_planned() {
        let presence = ManagerPresence::new(Instant::now());
        presence.configure_census(Arc::new(|| Some(2)));
        presence.held();
        presence.detach(1);
        assert!(presence.left(1, Departure::Closed, 10, Instant::now()));
        let planned = presence.take_last().expect("a record");
        assert_eq!(
            (planned.planned, planned.at, planned.sessions),
            (true, 10, Some(2))
        );
        assert!(presence.take_last().is_none(), "the record is handed once");

        presence.held();
        assert!(!presence.left(2, Departure::Closed, 20, Instant::now()));
        assert!(!presence.take_last().unwrap().planned);
        assert!(
            presence.vacant_since().is_some(),
            "a closed slot arms the bound"
        );

        presence.held();
        assert!(presence.left(3, Departure::Superseded, 30, Instant::now()));
        assert!(
            presence.vacant_since().is_none(),
            "a superseded slot is held again by its successor"
        );
    }

    #[test]
    fn a_detach_said_by_another_connection_does_not_plan_this_one() {
        let presence = ManagerPresence::new(Instant::now());
        presence.held();
        presence.detach(7);
        assert!(!presence.left(8, Departure::Closed, 1, Instant::now()));
        assert_eq!(
            presence.take_last().unwrap().sessions,
            None,
            "an unconfigured census is unknown, never zero"
        );
    }

    #[test]
    fn a_scaled_span_polls_at_a_tenth_of_it() {
        assert_eq!(
            timings(Some(1_500)),
            (Duration::from_millis(1_500), Duration::from_millis(150))
        );
        assert_eq!(
            timings(None),
            (
                Duration::from_millis(orphan_bound::IDLE_EXIT_MS),
                Duration::from_millis(orphan_bound::IDLE_POLL_MS)
            )
        );
    }
}
