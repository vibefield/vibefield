//! VT-1 (track VT, 2026-11-24) — the vitals census: the floor reads every process of VibeField the same way, once
//! every `registries::vitals::SAMPLE_INTERVAL_MS`, and keeps the last `FLOOR_RING_SAMPLES` readings.
//!
//! Why the floor: it outlives fieldd and the shell, so it is still measuring while one hangs and after one dies, the
//! moments worth having. What it measures: itself, the processes it started (the cells, the mesh sidecar, the
//! freeway host), and the pids fieldd asks for (`native.vitals.watch.set`), with a watched pid's descendants summed
//! where asked. It names nothing but its own children, from a closed list: no argument, folder or output of any
//! process is read here (VT-D4).
//!
//! The meter runs on a thread of its own that no runtime owns, and a fault in it ends that thread alone: the meter
//! then says `unavailable`, and no terminal is touched (VT-D3).

pub mod sys;

use crate::contracts::{
    NativeVitalsChild, NativeVitalsOrigin, NativeVitalsReading, NativeVitalsSample,
    NativeVitalsSnapshot, NativeVitalsState, NativeVitalsTree,
};
use crate::registries::vitals as limits;
use std::collections::{HashMap, HashSet, VecDeque};
use std::num::NonZeroU64;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, Weak};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::watch;

/// The meter's door to the operating system: a trait, so its arithmetic is proven on a table of made-up processes.
pub trait Probe {
    fn begin(&mut self);
    fn read(&mut self, pid: u32) -> Option<sys::Raw>;
    fn name(&self, pid: u32) -> Option<String>;
    fn children(&mut self, pid: u32) -> Vec<u32>;
    fn retain(&mut self, live: &HashSet<u32>);
}

impl Probe for sys::Reader {
    fn begin(&mut self) {
        sys::Reader::begin(self);
    }
    fn read(&mut self, pid: u32) -> Option<sys::Raw> {
        sys::Reader::read(self, pid)
    }
    fn name(&self, pid: u32) -> Option<String> {
        sys::Reader::name(self, pid).map(str::to_owned)
    }
    fn children(&mut self, pid: u32) -> Vec<u32> {
        sys::Reader::children(self, pid)
    }
    fn retain(&mut self, live: &HashSet<u32>) {
        sys::Reader::retain(self, live);
    }
}

/// One pid fieldd asked for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Watch {
    pub pid: u32,
    pub tree: bool,
}

/// What the meter remembers of one watched root's descendants between readings.
struct Tree {
    root_started_at_ms: u64,
    /// each living descendant's start and CPU time at the last reading
    seen: HashMap<u32, (u64, u64)>,
    /// the sum that only rises (`NativeVitalsTree.cpuUs`)
    cpu_us: u64,
    read_at_ms: u64,
}

pub struct Meter<P: Probe> {
    probe: P,
    own_pid: u32,
    trees: HashMap<u32, Tree>,
}

/// The floor's own children by executable name. A prefix, since a platform may cut a name short (Linux keeps
/// fifteen characters).
fn child_role(name: Option<&str>) -> NativeVitalsChild {
    match name {
        Some(name) if name.starts_with("field-terminal-") => NativeVitalsChild::TerminalCell,
        Some(name) if name.starts_with("field-freeway-") => NativeVitalsChild::FreewayHost,
        Some(name) if name.starts_with("sidecar-slim") || name.starts_with("truffle-sidecar") => {
            NativeVitalsChild::MeshSidecar
        }
        _ => NativeVitalsChild::Other,
    }
}

fn reading(
    pid: u32,
    raw: &sys::Raw,
    origin: NativeVitalsOrigin,
    child: Option<NativeVitalsChild>,
    tree: Option<NativeVitalsTree>,
) -> Option<NativeVitalsReading> {
    Some(NativeVitalsReading {
        pid: NonZeroU64::new(u64::from(pid))?,
        started_at: raw.started_at_ms,
        origin,
        child,
        cpu_user_us: raw.cpu_user_us,
        cpu_system_us: raw.cpu_system_us,
        resident_bytes: raw.resident_bytes,
        footprint_bytes: raw.footprint_bytes,
        disk_read_bytes: raw.disk_read_bytes,
        disk_written_bytes: raw.disk_written_bytes,
        wakeups: raw.wakeups,
        energy_nj: raw.energy_nj,
        tree,
    })
}

impl<P: Probe> Meter<P> {
    pub fn new(probe: P, own_pid: u32) -> Self {
        Self {
            probe,
            own_pid,
            trees: HashMap::new(),
        }
    }

    /// Every row at `now_ms`: the floor, its children, then the watch list in its order. A pid that cannot be read
    /// (gone, or another user's) has no row. Never more than `FLOOR_ROWS_MAX` rows.
    pub fn read(&mut self, watch: &[Watch], now_ms: u64) -> Vec<NativeVitalsReading> {
        let cap = limits::FLOOR_ROWS_MAX as usize;
        self.probe.begin();
        let mut rows = Vec::new();
        let mut placed: HashSet<u32> = HashSet::new();
        let mut live: HashSet<u32> = HashSet::new();

        if let Some(raw) = self.probe.read(self.own_pid) {
            live.insert(self.own_pid);
            placed.insert(self.own_pid);
            rows.extend(reading(
                self.own_pid,
                &raw,
                NativeVitalsOrigin::Floor,
                None,
                None,
            ));
        }

        let mut children = self.probe.children(self.own_pid);
        children.sort_unstable();
        for pid in children {
            if rows.len() >= cap || !placed.insert(pid) {
                continue;
            }
            let Some(raw) = self.probe.read(pid) else {
                continue;
            };
            live.insert(pid);
            let role = child_role(self.probe.name(pid).as_deref());
            rows.extend(reading(
                pid,
                &raw,
                NativeVitalsOrigin::Child,
                Some(role),
                None,
            ));
        }

        let mut roots: HashSet<u32> = HashSet::new();
        for entry in watch {
            if rows.len() >= cap || !placed.insert(entry.pid) {
                continue;
            }
            let Some(raw) = self.probe.read(entry.pid) else {
                continue;
            };
            live.insert(entry.pid);
            let tree = if entry.tree {
                roots.insert(entry.pid);
                self.tree(entry.pid, &raw, now_ms, &mut live)
            } else {
                None
            };
            rows.extend(reading(
                entry.pid,
                &raw,
                NativeVitalsOrigin::Watched,
                None,
                tree,
            ));
        }

        self.trees.retain(|pid, _| roots.contains(pid));
        self.probe.retain(&live);
        rows
    }

    /// A watched root's descendants, summed. `None` when the walk passes `TREE_SCAN_MAX`: no tree is said rather
    /// than a part of one, and what the meter remembers of it is left as it was.
    fn tree(
        &mut self,
        root: u32,
        root_raw: &sys::Raw,
        now_ms: u64,
        live: &mut HashSet<u32>,
    ) -> Option<NativeVitalsTree> {
        let first = self
            .trees
            .get(&root)
            .is_none_or(|tree| tree.root_started_at_ms != root_raw.started_at_ms);
        if first {
            self.trees.insert(
                root,
                Tree {
                    root_started_at_ms: root_raw.started_at_ms,
                    seen: HashMap::new(),
                    cpu_us: 0,
                    read_at_ms: now_ms,
                },
            );
        }
        let (previous, last_read_ms) = self
            .trees
            .get(&root)
            .map(|tree| (tree.seen.clone(), tree.read_at_ms))?;

        let scan_cap = limits::TREE_SCAN_MAX as usize;
        let mut queue: VecDeque<u32> = self.probe.children(root).into();
        let mut visited: HashSet<u32> = HashSet::from([root]);
        let mut seen: HashMap<u32, (u64, u64)> = HashMap::new();
        let mut processes = 0u64;
        let mut footprint = 0u64;
        let mut grown = 0u64;
        while let Some(pid) = queue.pop_front() {
            if !visited.insert(pid) {
                continue;
            }
            if visited.len() > scan_cap {
                return None;
            }
            let Some(raw) = self.probe.read(pid) else {
                continue;
            };
            live.insert(pid);
            processes += 1;
            footprint = footprint.saturating_add(raw.footprint_bytes.unwrap_or(raw.resident_bytes));
            let cpu = raw.cpu_user_us.saturating_add(raw.cpu_system_us);
            let growth = match previous.get(&pid) {
                Some((started, before)) if *started == raw.started_at_ms => {
                    cpu.saturating_sub(*before)
                }
                // First sight of the root: every descendant is a baseline, so watching begins at zero and not
                // with the descendants' whole past.
                _ if first => 0,
                // Born since the last reading: its whole time is this interval's.
                _ if raw.started_at_ms >= last_read_ms => cpu,
                // An older process that came under the root (re-parented): a baseline.
                _ => 0,
            };
            grown = grown.saturating_add(growth);
            seen.insert(pid, (raw.started_at_ms, cpu));
            queue.extend(self.probe.children(pid));
        }

        let tree = self.trees.get_mut(&root)?;
        tree.seen = seen;
        tree.cpu_us = tree.cpu_us.saturating_add(grown);
        tree.read_at_ms = now_ms;
        Some(NativeVitalsTree {
            processes,
            cpu_us: tree.cpu_us,
            footprint_bytes: footprint,
        })
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

struct Ring {
    samples: VecDeque<Arc<NativeVitalsSample>>,
    next_seq: u64,
}

struct Inner {
    watch: Mutex<Vec<Watch>>,
    ring: Mutex<Ring>,
    /// the newest sample's `seq`: what a subscription's forwarder wakes on
    newest: watch::Sender<u64>,
    state: Mutex<(NativeVitalsState, Option<String>)>,
    started: AtomicBool,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    // A poisoned lock means a holder panicked; the data is plain values and still whole.
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// The floor's meter: the ring, the watch list and the thread that fills the one from the other. The floor's and
/// not a connection's: it measures while no client is attached.
#[derive(Clone)]
pub struct Vitals {
    inner: Arc<Inner>,
}

impl Default for Vitals {
    fn default() -> Self {
        let (newest, _) = watch::channel(0);
        Self {
            inner: Arc::new(Inner {
                watch: Mutex::new(Vec::new()),
                ring: Mutex::new(Ring {
                    samples: VecDeque::new(),
                    next_seq: 1,
                }),
                newest,
                state: Mutex::new((
                    NativeVitalsState::Unavailable,
                    Some("the meter has not started".to_owned()),
                )),
                started: AtomicBool::new(false),
            }),
        }
    }
}

impl Vitals {
    /// Start the meter's thread, once. A platform with no reading, or a thread that cannot start, leaves the state
    /// `unavailable` with its reason; nothing here can fail a boot.
    pub fn start(&self) {
        if self.inner.started.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Some(reason) = sys::unsupported() {
            self.set_state(NativeVitalsState::Unavailable, Some(reason.to_owned()));
            return;
        }
        let inner = Arc::downgrade(&self.inner);
        let spawned = std::thread::Builder::new()
            .name("vitals-meter".to_owned())
            .spawn(move || run(inner));
        match spawned {
            Ok(_) => self.set_state(NativeVitalsState::Running, None),
            Err(error) => {
                tracing::warn!(
                    event = "field_native.vitals.meter_not_started",
                    component = "vitals",
                    error = %error,
                    "The vitals meter's thread could not start"
                );
                self.set_state(
                    NativeVitalsState::Unavailable,
                    Some("the meter's thread could not start".to_owned()),
                );
            }
        }
    }

    fn set_state(&self, state: NativeVitalsState, detail: Option<String>) {
        *lock(&self.inner.state) = (state, detail);
    }

    /// Replace the watch list whole. Returns how many pids are now watched: the list without its repeats, cut at
    /// `WATCH_MAX`.
    pub fn set_watch(&self, entries: impl IntoIterator<Item = Watch>) -> usize {
        let mut seen = HashSet::new();
        let list: Vec<Watch> = entries
            .into_iter()
            .filter(|entry| seen.insert(entry.pid))
            .take(limits::WATCH_MAX as usize)
            .collect();
        let count = list.len();
        *lock(&self.inner.watch) = list;
        count
    }

    /// Wakes with the newest sample's `seq`. Subscribe before reading `snapshot`, so a sample that races the
    /// snapshot is inside it or after it, never between.
    pub fn subscribe(&self) -> watch::Receiver<u64> {
        self.inner.newest.subscribe()
    }

    /// The samples after `seq`, oldest first.
    pub fn samples_after(&self, seq: u64) -> Vec<Arc<NativeVitalsSample>> {
        lock(&self.inner.ring)
            .samples
            .iter()
            .filter(|sample| sample.seq.get() > seq)
            .cloned()
            .collect()
    }

    /// What a subscription opens with. `since_seq` asks for everything after it, of which the newest
    /// `FLOOR_BACKFILL_MAX` are kept; absent, the newest sample alone.
    pub fn snapshot(&self, boot_id: &str, since_seq: Option<u64>) -> NativeVitalsSnapshot {
        let (state, detail) = lock(&self.inner.state).clone();
        let ring = lock(&self.inner.ring);
        let oldest_seq = ring.samples.front().map_or(0, |sample| sample.seq.get());
        let wanted: Vec<&Arc<NativeVitalsSample>> = match since_seq {
            Some(seq) => ring
                .samples
                .iter()
                .filter(|sample| sample.seq.get() > seq)
                .collect(),
            None => ring.samples.back().into_iter().collect(),
        };
        let skip = wanted
            .len()
            .saturating_sub(limits::FLOOR_BACKFILL_MAX as usize);
        NativeVitalsSnapshot {
            v: NonZeroU64::MIN,
            boot_id: boot_id.to_owned(),
            state,
            // the type bounds a detail at 240 characters; one that does not fit is left out, never cut mid-word
            detail: detail.and_then(|text| text.parse().ok()),
            interval_ms: NonZeroU64::new(limits::SAMPLE_INTERVAL_MS).unwrap_or(NonZeroU64::MIN),
            oldest_seq,
            samples: wanted
                .into_iter()
                .skip(skip)
                .map(|sample| (**sample).clone())
                .collect(),
        }
    }

    /// Put one reading in the ring and wake the forwarders. The meter's thread calls it; a test may.
    pub fn record(&self, time: u64, took: Duration, rows: Vec<NativeVitalsReading>) {
        record(&self.inner, time, took, rows);
    }
}

fn record(inner: &Inner, time: u64, took: Duration, rows: Vec<NativeVitalsReading>) {
    let seq = {
        let mut ring = lock(&inner.ring);
        let seq = ring.next_seq;
        ring.next_seq += 1;
        ring.samples.push_back(Arc::new(NativeVitalsSample {
            seq: NonZeroU64::new(seq).unwrap_or(NonZeroU64::MIN),
            time,
            took_us: took.as_micros().min(u128::from(u64::MAX)) as u64,
            rows,
        }));
        while ring.samples.len() > limits::FLOOR_RING_SAMPLES as usize {
            ring.samples.pop_front();
        }
        seq
    };
    inner.newest.send_replace(seq);
}

/// How long the meter stays quiet after saying one reading ran over its budget.
const SLOW_READING_QUIET: Duration = Duration::from_secs(60);

fn run(inner: Weak<Inner>) {
    let interval = Duration::from_millis(limits::SAMPLE_INTERVAL_MS);
    let budget = Duration::from_micros(limits::METER_BUDGET_US);
    let mut meter = Meter::new(sys::Reader::new(), std::process::id());
    let mut next = Instant::now();
    let mut said_slow: Option<Instant> = None;
    loop {
        // The handle is gone (a test's floor, or the process ending): the thread ends with it.
        let Some(inner) = inner.upgrade() else {
            return;
        };
        let watch = lock(&inner.watch).clone();
        let time = now_ms();
        let began = Instant::now();
        let read =
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| meter.read(&watch, time)));
        let took = began.elapsed();
        let rows = match read {
            Ok(rows) => rows,
            Err(_) => {
                tracing::error!(
                    event = "field_native.vitals.meter_stopped",
                    component = "vitals",
                    "The vitals meter stopped after a fault; nothing else is affected"
                );
                *lock(&inner.state) = (
                    NativeVitalsState::Unavailable,
                    Some("the meter stopped after a fault".to_owned()),
                );
                return;
            }
        };
        if took > budget && said_slow.is_none_or(|at| at.elapsed() >= SLOW_READING_QUIET) {
            said_slow = Some(Instant::now());
            tracing::warn!(
                event = "field_native.vitals.slow_reading",
                component = "vitals",
                took_us = took.as_micros() as u64,
                budget_us = limits::METER_BUDGET_US,
                rows = rows.len() as u64,
                "One vitals reading took longer than its budget"
            );
        }
        record(&inner, time, took, rows);
        drop(inner);

        // A beat on the monotonic clock. A reading that overran, or a Mac that slept, skips the beats it missed
        // rather than reading in a burst to catch up.
        next += interval;
        let now = Instant::now();
        if next <= now {
            next = now + interval;
        }
        std::thread::sleep(next - now);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A table of made-up processes: pid → (parent, name, reading).
    #[derive(Default)]
    struct Table {
        rows: HashMap<u32, (u32, &'static str, sys::Raw)>,
        retained: Option<HashSet<u32>>,
    }

    fn raw(started_at_ms: u64, cpu_us: u64, footprint: u64) -> sys::Raw {
        sys::Raw {
            started_at_ms,
            cpu_user_us: cpu_us,
            cpu_system_us: 0,
            resident_bytes: footprint / 2,
            footprint_bytes: Some(footprint),
            disk_read_bytes: Some(0),
            disk_written_bytes: Some(0),
            wakeups: Some(0),
            energy_nj: None,
        }
    }

    impl Table {
        fn put(&mut self, pid: u32, parent: u32, name: &'static str, reading: sys::Raw) {
            self.rows.insert(pid, (parent, name, reading));
        }
        fn cpu(&mut self, pid: u32, cpu_us: u64) {
            self.rows.get_mut(&pid).unwrap().2.cpu_user_us = cpu_us;
        }
    }

    impl Probe for Table {
        fn begin(&mut self) {}
        fn read(&mut self, pid: u32) -> Option<sys::Raw> {
            self.rows.get(&pid).map(|row| row.2.clone())
        }
        fn name(&self, pid: u32) -> Option<String> {
            self.rows.get(&pid).map(|row| row.1.to_owned())
        }
        fn children(&mut self, pid: u32) -> Vec<u32> {
            let mut children: Vec<u32> = self
                .rows
                .iter()
                .filter(|(_, row)| row.0 == pid)
                .map(|(child, _)| *child)
                .collect();
            children.sort_unstable();
            children
        }
        fn retain(&mut self, live: &HashSet<u32>) {
            self.retained = Some(live.clone());
        }
    }

    const FLOOR: u32 = 100;

    fn floor() -> Table {
        let mut table = Table::default();
        table.put(FLOOR, 1, "field-native", raw(1_000, 50, 40 << 20));
        table.put(110, FLOOR, "field-terminal-host", raw(1_100, 10, 30 << 20));
        table.put(111, FLOOR, "sidecar-slim", raw(1_200, 5, 20 << 20));
        table.put(112, FLOOR, "field-freeway-host", raw(1_300, 1, 10 << 20));
        table.put(113, FLOOR, "something-else", raw(1_400, 1, 1 << 20));
        table
    }

    #[test]
    fn the_floor_and_its_children_are_read_unasked_and_named_from_the_closed_list() {
        let mut meter = Meter::new(floor(), FLOOR);
        let rows = meter.read(&[], 5_000);
        let said: Vec<(u64, NativeVitalsOrigin, Option<NativeVitalsChild>)> = rows
            .iter()
            .map(|row| (row.pid.get(), row.origin, row.child))
            .collect();
        assert_eq!(
            said,
            vec![
                (100, NativeVitalsOrigin::Floor, None),
                (
                    110,
                    NativeVitalsOrigin::Child,
                    Some(NativeVitalsChild::TerminalCell)
                ),
                (
                    111,
                    NativeVitalsOrigin::Child,
                    Some(NativeVitalsChild::MeshSidecar)
                ),
                (
                    112,
                    NativeVitalsOrigin::Child,
                    Some(NativeVitalsChild::FreewayHost)
                ),
                (
                    113,
                    NativeVitalsOrigin::Child,
                    Some(NativeVitalsChild::Other)
                ),
            ]
        );
        assert_eq!(rows[0].footprint_bytes, Some(40 << 20));
        assert_eq!(rows[0].started_at, 1_000);
    }

    #[test]
    fn a_watched_pid_is_read_once_and_one_that_is_gone_has_no_row() {
        let mut table = floor();
        table.put(500, 1, "fieldd", raw(2_000, 70, 200 << 20));
        let mut meter = Meter::new(table, FLOOR);
        let watch = [
            Watch {
                pid: 500,
                tree: false,
            },
            // the floor's own child, asked for again: its `child` row stands, and no second row is made
            Watch {
                pid: 110,
                tree: false,
            },
            Watch {
                pid: 999,
                tree: false,
            },
        ];
        let rows = meter.read(&watch, 5_000);
        let pids: Vec<u64> = rows.iter().map(|row| row.pid.get()).collect();
        assert_eq!(pids, vec![100, 110, 111, 112, 113, 500]);
        let watched = rows.last().unwrap();
        assert_eq!(watched.origin, NativeVitalsOrigin::Watched);
        assert!(watched.child.is_none() && watched.tree.is_none());
    }

    /// The tree's CPU only rises: a descendant's growth is added, one that exits takes nothing back, one born
    /// between readings counts whole, and the first sight of a root is a baseline.
    #[test]
    fn a_tree_sums_its_descendants_and_its_cpu_only_rises() {
        let mut table = floor();
        // a shell under a cell, an agent under the shell, a tool under the agent
        table.put(600, 110, "zsh", raw(3_000, 1_000, 8 << 20));
        table.put(601, 600, "agent", raw(3_100, 40_000, 300 << 20));
        table.put(602, 601, "tool", raw(3_200, 9_000, 50 << 20));
        let mut meter = Meter::new(table, FLOOR);
        let watch = [Watch {
            pid: 600,
            tree: true,
        }];

        let tree = |rows: &[NativeVitalsReading]| rows.last().unwrap().tree.clone().unwrap();

        // first sight: the descendants' past is a baseline
        let first = tree(&meter.read(&watch, 10_000));
        assert_eq!((first.processes, first.cpu_us), (2, 0));
        assert_eq!(first.footprint_bytes, (300 << 20) + (50 << 20));

        // both grow
        meter.probe.cpu(601, 40_700);
        meter.probe.cpu(602, 9_300);
        let second = tree(&meter.read(&watch, 11_000));
        assert_eq!((second.processes, second.cpu_us), (2, 1_000));

        // the tool exits; a new one is born inside the interval with 250 µs already used
        meter.probe.rows.remove(&602);
        meter
            .probe
            .put(603, 601, "tool", raw(11_400, 250, 20 << 20));
        meter.probe.cpu(601, 40_800);
        let third = tree(&meter.read(&watch, 12_000));
        assert_eq!((third.processes, third.cpu_us), (2, 1_000 + 100 + 250));
        assert_eq!(third.footprint_bytes, (300 << 20) + (20 << 20));

        // an old process re-parented under the root is a baseline, not a burst
        meter
            .probe
            .put(700, 600, "old", raw(500, 5_000_000, 1 << 20));
        let fourth = tree(&meter.read(&watch, 13_000));
        assert_eq!((fourth.processes, fourth.cpu_us), (3, 1_350));

        // the root's own row is the root alone
        let rows = meter.read(&watch, 14_000);
        let root = rows.last().unwrap();
        assert_eq!(root.pid.get(), 600);
        assert_eq!(root.cpu_user_us, 1_000);
    }

    #[test]
    fn a_reused_root_pid_begins_a_new_tree_and_the_probe_is_told_who_lives() {
        let mut table = floor();
        table.put(600, 110, "zsh", raw(3_000, 0, 8 << 20));
        table.put(601, 600, "agent", raw(3_100, 1_000, 8 << 20));
        let mut meter = Meter::new(table, FLOOR);
        let watch = [Watch {
            pid: 600,
            tree: true,
        }];
        meter.read(&watch, 10_000);
        meter.probe.cpu(601, 3_000);
        assert_eq!(
            meter
                .read(&watch, 11_000)
                .last()
                .unwrap()
                .tree
                .clone()
                .unwrap()
                .cpu_us,
            2_000
        );

        // the pid is another process now
        meter.probe.put(600, 110, "zsh", raw(20_000, 0, 8 << 20));
        let again = meter.read(&watch, 21_000);
        assert_eq!(again.last().unwrap().tree.clone().unwrap().cpu_us, 0);

        let live = meter.probe.retained.clone().unwrap();
        assert!(live.contains(&FLOOR) && live.contains(&600) && live.contains(&601));

        // unwatched, the tree is forgotten
        meter.read(&[], 22_000);
        assert!(meter.trees.is_empty());
    }

    #[test]
    fn the_ring_keeps_the_newest_and_a_snapshot_answers_what_was_asked() {
        let vitals = Vitals::default();
        let empty = vitals.snapshot("boot", None);
        assert_eq!(empty.state, NativeVitalsState::Unavailable);
        assert_eq!(
            empty.detail.as_deref().map(String::as_str),
            Some("the meter has not started")
        );
        assert_eq!((empty.oldest_seq, empty.samples.len()), (0, 0));

        let total = limits::FLOOR_RING_SAMPLES + 5;
        for index in 0..total {
            vitals.record(1_000 + index, Duration::from_micros(300), Vec::new());
        }
        assert_eq!(*vitals.subscribe().borrow(), total);

        // no cursor: the newest alone
        let newest = vitals.snapshot("boot", None);
        assert_eq!(newest.oldest_seq, 6);
        assert_eq!(newest.samples.len(), 1);
        assert_eq!(newest.samples[0].seq.get(), total);
        assert_eq!(newest.samples[0].took_us, 300);

        // a cursor near the end: exactly what came after it
        let after = vitals.snapshot("boot", Some(total - 3));
        let seqs: Vec<u64> = after
            .samples
            .iter()
            .map(|sample| sample.seq.get())
            .collect();
        assert_eq!(seqs, vec![total - 2, total - 1, total]);

        // a cursor from long ago: the newest FLOOR_BACKFILL_MAX, oldest first
        let all = vitals.snapshot("boot", Some(0));
        assert_eq!(all.samples.len() as u64, limits::FLOOR_BACKFILL_MAX);
        assert_eq!(all.samples.last().unwrap().seq.get(), total);
        assert_eq!(
            all.samples[0].seq.get(),
            total - limits::FLOOR_BACKFILL_MAX + 1
        );

        assert_eq!(vitals.samples_after(total - 2).len(), 2);
    }

    #[test]
    fn the_watch_list_is_replaced_whole_without_repeats_and_within_its_bound() {
        let vitals = Vitals::default();
        let many = (1..=(limits::WATCH_MAX as u32 + 40)).map(|pid| Watch { pid, tree: false });
        assert_eq!(vitals.set_watch(many), limits::WATCH_MAX as usize);
        let repeats = [7, 7, 8].map(|pid| Watch { pid, tree: true });
        assert_eq!(vitals.set_watch(repeats), 2);
        assert_eq!(lock(&vitals.inner.watch).len(), 2);
    }

    /// The real meter on this machine: it starts, reads this process, and a second start is nothing.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[test]
    fn the_started_meter_reads_this_process_within_its_first_beats() {
        let vitals = Vitals::default();
        vitals.start();
        vitals.start();
        let deadline = Instant::now() + Duration::from_secs(5);
        let own = u64::from(std::process::id());
        loop {
            let snapshot = vitals.snapshot("boot", None);
            assert_eq!(snapshot.state, NativeVitalsState::Running);
            if let Some(sample) = snapshot.samples.first() {
                let floor = &sample.rows[0];
                assert_eq!(floor.pid.get(), own);
                assert_eq!(floor.origin, NativeVitalsOrigin::Floor);
                assert!(floor.resident_bytes > 0);
                break;
            }
            assert!(Instant::now() < deadline, "no sample within five seconds");
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}
