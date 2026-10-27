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
//!
//! A count that must hold at a moment is ASKED for and read from reconciles begun AFTER it (`SessionCensus`): the
//! record's count from after the departure, the bound's stop from after its decision. *Corrected 2026-10-27 (the EL8's
//! verify, AL-8a-2):* both read the cells' last reconciles, however old, so a session born after a cell's last
//! reconcile and before a fieldd crash was recorded as `sessions: 0`, and the bound's confirming read could take the
//! same stale zero for idle. A quiet cell reconciles only every `TERMINAL_INVENTORY.BACKSTOP_MS` (5 s), so a fresh count
//! is asked for, never waited for.

use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::contracts::{NativeLastManager, NativePrepareRestartParams, NativeRestartReason};
use crate::registries::{orphan_bound, terminal_inventory};
use crate::state::DaemonState;

/// The floor's own session count, read at the source (`SessionCensus::count`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Census {
    /// every live cell's inventory applied, from a reconcile begun after the moment asked about
    Counted(u64),
    /// a live cell has no such reconcile yet: one asked for begins within a reconcile tick
    NotYet,
    /// no count can be read (no inventory, a stale cell, a faulted pump); never idle
    Unknown,
}

impl Census {
    pub fn counted(self) -> Option<u64> {
        match self {
            Census::Counted(sessions) => Some(sessions),
            Census::NotYet | Census::Unknown => None,
        }
    }
}

/// The floor's sessions, counted where they live: the terminal unit (`TerminalHandle`).
pub trait SessionCensus: Send + Sync {
    /// The count from reconciles begun after `after`, or from the last applied ones (`None`).
    fn count(&self, after: Option<Instant>) -> Census;
    /// Asks every live cell for a reconcile now, so a count from after this moment comes within a reconcile tick
    /// rather than at a quiet cell's backstop.
    fn ask(&self);
}

/// How long a fresh count is waited for once asked: twice the slow-reconcile line, 2 × 1 s = 2 s. An asked reconcile
/// begins within one 100 ms reconcile tick and a healthy one is a local socket hop, so this covers a slow reconcile
/// with as much again to spare. The hello holds its ack this long at most, a fifth of fieldd's 10 s hello deadline
/// (`HELLO_TIMEOUT_MS` in fieldd's native-link.ts), and the departure asked first, so the next fieldd's boot is a head
/// start. Past it the count is sent as unknown, never as a zero the floor did not see.
pub const FRESH_COUNT_WAIT: Duration =
    Duration::from_millis(2 * terminal_inventory::SLOW_RECONCILE_MS);
const FRESH_COUNT_POLL: Duration = Duration::from_millis(25);

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
    census: OnceLock<Arc<dyn SessionCensus>>,
}

struct Presence {
    /// the connection that said `native.lifecycle.detach`, until it leaves
    detaching: Option<u64>,
    /// since when no client holds the slot (from boot until the first hello)
    vacant_since: Option<Instant>,
    /// how the previous client left, handed to the next hello once
    last: Option<Departed>,
}

/// A departure, its count still to be read from after it.
#[derive(Debug, Clone, Copy)]
struct Departed {
    planned: bool,
    at_ms: u64,
    at: Instant,
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
    pub fn configure_census(&self, census: Arc<dyn SessionCensus>) {
        let _ = self.census.set(census);
    }

    pub fn census(&self, after: Option<Instant>) -> Census {
        self.census
            .get()
            .map_or(Census::Unknown, |census| census.count(after))
    }

    fn ask(&self) {
        if let Some(census) = self.census.get() {
            census.ask();
        }
    }

    /// The count from reconciles begun after `after`, asked for and waited for up to `wait`: `None` when it cannot be
    /// read or is not fresh in time — unknown, never a stale zero.
    pub async fn fresh_count(&self, after: Instant, wait: Duration) -> Option<u64> {
        self.ask();
        let deadline = Instant::now() + wait;
        loop {
            match self.census(Some(after)) {
                Census::Counted(sessions) => return Some(sessions),
                Census::Unknown => return None,
                Census::NotYet if Instant::now() >= deadline => return None,
                Census::NotYet => tokio::time::sleep(FRESH_COUNT_POLL).await,
            }
        }
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
    /// span; a superseded one is held again at once by the hello that superseded it. The departure asks for its count
    /// at once, so the next hello rarely waits for it.
    pub fn left(&self, conn_id: u64, how: Departure, at_ms: u64, now: Instant) -> bool {
        let planned = {
            let mut inner = self.inner.lock().unwrap();
            let said = inner.detaching == Some(conn_id);
            if said {
                inner.detaching = None;
            }
            let planned = said || how == Departure::Superseded;
            inner.last = Some(Departed {
                planned,
                at_ms,
                at: now,
            });
            if how == Departure::Closed {
                inner.vacant_since = Some(now);
            }
            planned
        };
        self.ask();
        planned
    }

    /// The hello's `lastManager`: how the previous client left, once, with the sessions that kept running counted
    /// from reconciles begun after it left. An unplanned departure (the one fieldd says) asks again and waits up to
    /// `FRESH_COUNT_WAIT` for that count; a planned one is never waited on, since nothing says its count.
    pub async fn take_last(&self) -> Option<NativeLastManager> {
        self.take_last_within(FRESH_COUNT_WAIT).await
    }

    pub async fn take_last_within(&self, wait: Duration) -> Option<NativeLastManager> {
        let departed = self.inner.lock().unwrap().last.take()?;
        let sessions = if departed.planned {
            self.census(Some(departed.at)).counted()
        } else {
            self.fresh_count(departed.at, wait).await
        };
        Some(NativeLastManager {
            planned: departed.planned,
            at: departed.at_ms,
            sessions,
        })
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

/// The bound, running: a whole span with no management client and no session, then a confirming read from
/// reconciles begun after the decision (a birth with no fieldd needs a grant fieldd minted before it went, so a
/// session can still arrive), then the `idle` intent and main's shutdown arm — the floor's own SIGTERM drain, never a
/// kill.
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
            let decided = Instant::now();
            let verdict = bound.observe(
                decided,
                state.manager.vacant_since(),
                state.manager.census(None).counted(),
            );
            if verdict == Verdict::Wait {
                continue;
            }
            // the confirming read: a count asked for and read from reconciles begun after the decision, so a session
            // born since a cell's last reconcile is in it; one not fresh in time is a whole new wait, never a stop
            let census = state.manager.fresh_count(decided, FRESH_COUNT_WAIT).await;
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

    /// A census that always reads the same.
    struct Fixed(Census);

    impl SessionCensus for Fixed {
        fn count(&self, _after: Option<Instant>) -> Census {
            self.0
        }
        fn ask(&self) {}
    }

    #[tokio::test]
    async fn a_detach_reads_planned_a_close_without_it_unplanned_and_a_supersession_planned() {
        let presence = ManagerPresence::new(Instant::now());
        presence.configure_census(Arc::new(Fixed(Census::Counted(2))));
        presence.held();
        presence.detach(1);
        assert!(presence.left(1, Departure::Closed, 10, Instant::now()));
        let planned = presence.take_last().await.expect("a record");
        assert_eq!(
            (planned.planned, planned.at, planned.sessions),
            (true, 10, Some(2))
        );
        assert!(
            presence.take_last().await.is_none(),
            "the record is handed once"
        );

        presence.held();
        assert!(!presence.left(2, Departure::Closed, 20, Instant::now()));
        assert!(!presence.take_last().await.unwrap().planned);
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

    #[tokio::test]
    async fn a_detach_said_by_another_connection_does_not_plan_this_one() {
        let presence = ManagerPresence::new(Instant::now());
        presence.held();
        presence.detach(7);
        assert!(!presence.left(8, Departure::Closed, 1, Instant::now()));
        assert_eq!(
            presence.take_last().await.unwrap().sessions,
            None,
            "an unconfigured census is unknown, never zero"
        );
    }

    /// One cell as `TerminalHandle` counts it: its sessions now, and its last applied reconcile (when it began, what
    /// it saw). An answering cell reconciles when asked; a mute one never does.
    struct OneCell {
        sessions: u64,
        answers: bool,
        last: Mutex<(Instant, u64)>,
        asks: std::sync::atomic::AtomicUsize,
    }

    impl OneCell {
        /// Its last reconcile saw it empty, and `sessions` were born since.
        fn born_since(sessions: u64, answers: bool) -> Arc<Self> {
            Arc::new(Self {
                sessions,
                answers,
                last: Mutex::new((Instant::now(), 0)),
                asks: std::sync::atomic::AtomicUsize::new(0),
            })
        }

        fn asks(&self) -> usize {
            self.asks.load(std::sync::atomic::Ordering::SeqCst)
        }
    }

    impl SessionCensus for OneCell {
        fn count(&self, after: Option<Instant>) -> Census {
            let (began, seen) = *self.last.lock().unwrap();
            if after.is_none_or(|after| began > after) {
                Census::Counted(seen)
            } else {
                Census::NotYet
            }
        }

        fn ask(&self) {
            self.asks.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if self.answers {
                // an asked reconcile begins at the pump's next tick, after the ask
                std::thread::sleep(Duration::from_millis(1));
                *self.last.lock().unwrap() = (Instant::now(), self.sessions);
            }
        }
    }

    // AL-8a-2's finding (2026-10-27): the count at a departure was the cells' LAST reconcile, however old, so a
    // session born after it and before a fieldd crash was recorded as 0. The departure asks for a reconcile and the
    // record counts only from one begun after it; a cell that does not answer in time is unknown, never that zero.
    #[tokio::test]
    async fn a_departure_asks_for_its_count_and_never_says_a_stale_zero() {
        let mute = OneCell::born_since(1, false);
        let presence = ManagerPresence::new(Instant::now());
        presence.configure_census(mute.clone());
        presence.held();
        std::thread::sleep(Duration::from_millis(2));
        assert!(!presence.left(1, Departure::Closed, 10, Instant::now()));
        assert_eq!(mute.asks(), 1, "the departure asks at once");
        assert_eq!(presence.census(None), Census::Counted(0), "the stale zero");
        let unknown = presence
            .take_last_within(Duration::from_millis(60))
            .await
            .expect("a record");
        assert_eq!(
            (unknown.planned, unknown.sessions),
            (false, None),
            "a count no reconcile after the crash has made is unknown, never 0"
        );

        // a cell that answers: the reconcile the departure asked for sees the session, and the record counts it
        let answering = OneCell::born_since(1, true);
        let presence = ManagerPresence::new(Instant::now());
        presence.configure_census(answering.clone());
        presence.held();
        std::thread::sleep(Duration::from_millis(2));
        assert!(!presence.left(2, Departure::Closed, 20, Instant::now()));
        let counted = presence
            .take_last_within(Duration::from_secs(5))
            .await
            .expect("a record");
        assert_eq!((counted.planned, counted.sessions), (false, Some(1)));
    }

    #[tokio::test]
    async fn a_planned_departure_is_never_waited_on_and_an_unreadable_count_ends_the_wait() {
        let presence = ManagerPresence::new(Instant::now());
        presence.configure_census(OneCell::born_since(0, false));
        presence.held();
        presence.detach(1);
        std::thread::sleep(Duration::from_millis(2));
        assert!(presence.left(1, Departure::Closed, 10, Instant::now()));
        let began = Instant::now();
        let planned = presence
            .take_last_within(Duration::from_secs(5))
            .await
            .unwrap();
        assert_eq!((planned.planned, planned.sessions), (true, None));
        assert!(
            began.elapsed() < Duration::from_secs(1),
            "a planned record never waits"
        );

        let unknown = ManagerPresence::new(Instant::now());
        unknown.configure_census(Arc::new(Fixed(Census::Unknown)));
        unknown.held();
        assert!(!unknown.left(2, Departure::Closed, 20, Instant::now()));
        let began = Instant::now();
        assert_eq!(
            unknown
                .take_last_within(Duration::from_secs(5))
                .await
                .unwrap()
                .sessions,
            None
        );
        assert!(
            began.elapsed() < Duration::from_secs(1),
            "a count that cannot be read is not waited for"
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
