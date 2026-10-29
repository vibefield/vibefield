//! CP-1a — the floor's door (`thinking-roled-agents.md` §16; the CO lead's brief, 2026-10-29): `door.sock`, which a
//! spark's MCP bridge (`field-native door --endpoint`) dials, and which names its caller by the kernel's word and the
//! pane the floor walks it to.
//!
//! - `peer`: what the kernel says about a caller and its processes.
//! - `walk`: from a caller up its parents to the pane it was started in.
//!
//! **A door is a lane.** Each door opens a local lane on the MeshData bridge (protocol `mcp`, peer `door:<connId>`):
//! the caller's bytes reach fieldd as that lane's DATA frames, and fieldd's DATA on that lane reach the caller. The
//! bytes are raw; the floor never parses MCP. The lane is never announced on `native.mesh.lane.subscribe`. The door
//! stream (`native.door.subscribe`, `mgmt/door.rs`) announces it, with who is calling.
//!
//! **What the accept refuses** (`judge`): a caller of another uid (`refused-uid`), a delegated socket (`delegated`),
//! a caller already gone or whose pid now belongs to a process started after the accept (`peer-gone`), and the
//! 65th door (`limit`). A refused caller is hung up on, opens no lane, is never announced, and is logged at most once
//! a second per reason with the count since (`field_native.door.refused`). A same-uid process can connect as fast as
//! it likes, and nothing it does at the door may reach the management channel (EL7; the CO lead's ruling).
//!
//! **A door outlives fieldd** (the two-plane law). While fieldd cannot take a door's bytes (no byte-plane client, or
//! no live door subscription), the floor holds them in order, at most `HELD_BYTES_PER_DOOR` per door and
//! `HELD_BYTES_TOTAL` in all, and closes a door past either (`held-too-long`). The next subscription's snapshot lists
//! every open door, and the held bytes then follow in order. It waits for the subscription as well as the byte
//! plane because fieldd parks bytes for a lane it has not been told of for 30 s (`DEFAULT_ORPHAN_TTL_MS`,
//! mesh-lane.ts), and a fieldd that dialed the byte plane need not have subscribed by then. Toward the caller, fieldd's
//! bytes wait for the caller to read; a caller that lets more than its door's bound wait is closed the same way.

pub mod peer;
pub mod walk;

use crate::config::NativeConfig;
use crate::contracts::{
    NativeDoorCaller, NativeDoorClosed, NativeDoorClosedConnId, NativeDoorInfoResult,
    NativeDoorOpen, NativeDoorOpenConnId, NativeDoorPane, NativeDoorPaneTerminalSessionId,
    NativeDoorSnapshot, ObservedState, UnitHealth, UnitState,
};
use crate::manager::NativeService;
use crate::orphan::{Census, SessionCensus, FRESH_COUNT_WAIT};
use crate::registries::native_door::{
    HELD_BYTES_PER_DOOR, HELD_BYTES_TOTAL, MAX_OPEN, START_RESOLUTION_MS,
};
use crate::services::mesh_bridge::{BridgeHandle, LaneClass, LocalLaneSink};
use peer::{PeerFacts, ProcessFacts, ProcessTable};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};
use std::time::Duration;
use tokio::sync::mpsc::{self, UnboundedSender};
use tokio::sync::{broadcast, watch};

/// A door lane's protocol (contracts `MeshLaneProtocol`).
const PROTOCOL: &str = "mcp";
/// One read from a caller, and so at most one DATA frame.
const READ_CHUNK: usize = 64 * 1024;
/// The door stream's event buffer. A subscriber that falls behind it is owed a snapshot, never a gap.
const EVENT_CAPACITY: usize = 64;
/// How often a refusal of one reason may be logged.
const REFUSAL_WARN_EVERY: Duration = Duration::from_secs(1);
/// How often the walk's second look checks for the inventory it asked for.
const CENSUS_POLL: Duration = Duration::from_millis(25);

/// A door opening or closing, as the door stream says it.
#[derive(Debug, Clone)]
pub enum DoorEvent {
    Opened(NativeDoorOpen),
    Closed(NativeDoorClosed),
}

struct Door {
    row: NativeDoorOpen,
    /// the caller's bytes while fieldd cannot take them
    io: Mutex<DoorIo>,
    /// fieldd's bytes, to the task that writes them to the caller
    out: UnboundedSender<Vec<u8>>,
    /// fieldd's bytes the caller has not read yet
    out_bytes: AtomicUsize,
    stop: watch::Sender<bool>,
}

impl Door {
    fn conn_id(&self) -> &str {
        &self.row.conn_id
    }
    fn lane_id(&self) -> u64 {
        self.row.lane_id
    }
}

#[derive(Default)]
struct DoorIo {
    held: VecDeque<Vec<u8>>,
    held_bytes: usize,
    closed: bool,
}

#[derive(Default)]
struct Refusals {
    last_warn: Option<std::time::Instant>,
    since_warn: u64,
}

struct Shared {
    health: Mutex<UnitHealth>,
    ping: UnboundedSender<()>,
    bridge: BridgeHandle,
    endpoint: Option<String>,
    doors: Mutex<HashMap<String, Arc<Door>>>,
    held_total: AtomicUsize,
    next_conn: AtomicU64,
    events: broadcast::Sender<DoorEvent>,
    /// the floor's observed inventory (wiring, `DoorHandle::observe`): the panes the walk reads
    observed: OnceLock<watch::Receiver<ObservedState>>,
    /// the cells' census (wiring, `DoorHandle::configure_census`): how a missed walk asks for a fresh inventory
    census: OnceLock<Arc<dyn SessionCensus>>,
    /// live door subscriptions; fieldd takes a door's bytes only while one is
    subscribers: watch::Sender<usize>,
    refusals: Mutex<HashMap<&'static str, Refusals>>,
}

impl Shared {
    fn set(&self, state: UnitState, detail: &str) {
        *self.health.lock().unwrap() = UnitHealth {
            unit: "door".into(),
            state,
            detail: Some(detail.into()),
            auth_url: None,
        };
        let _ = self.ping.send(());
    }

    /// Can fieldd take a door's bytes now: a byte-plane client attached AND a door subscription live?
    fn gate_open(&self) -> bool {
        *self.subscribers.borrow() > 0 && self.bridge.client_attached()
    }

    fn reserve(&self, bytes: usize) -> bool {
        self.held_total
            .try_update(Ordering::AcqRel, Ordering::Acquire, |held| {
                held.checked_add(bytes)
                    .filter(|next| *next <= HELD_BYTES_TOTAL as usize)
            })
            .is_ok()
    }

    fn release(&self, bytes: usize) {
        self.held_total.fetch_sub(bytes, Ordering::AcqRel);
    }

    /// A chunk the caller wrote: to fieldd now if it can take it and nothing waits ahead of it, else held. `Err` when
    /// holding it would pass the door's bound or the floor's.
    fn take_inbound(&self, door: &Door, chunk: Vec<u8>) -> Result<(), ()> {
        let mut io = door.io.lock().unwrap();
        if io.closed {
            return Ok(());
        }
        if self.gate_open() {
            self.flush_locked(door, &mut io);
            if io.held.is_empty() && self.bridge.deliver_local(door.lane_id(), &chunk) {
                return Ok(());
            }
        }
        let bytes = chunk.len();
        if io.held_bytes + bytes > HELD_BYTES_PER_DOOR as usize || !self.reserve(bytes) {
            return Err(());
        }
        io.held_bytes += bytes;
        io.held.push_back(chunk);
        Ok(())
    }

    /// Send what a door holds, in order, until fieldd stops taking it.
    fn flush_locked(&self, door: &Door, io: &mut DoorIo) {
        while let Some(front) = io.held.front() {
            if !self.bridge.deliver_local(door.lane_id(), front) {
                return;
            }
            let sent = io.held.pop_front().expect("a front was read");
            io.held_bytes -= sent.len();
            self.release(sent.len());
        }
    }

    fn flush_all(&self) {
        if !self.gate_open() {
            return;
        }
        let doors: Vec<Arc<Door>> = self.doors.lock().unwrap().values().cloned().collect();
        for door in doors {
            let mut io = door.io.lock().unwrap();
            if !io.closed {
                self.flush_locked(&door, &mut io);
            }
        }
    }

    /// Close a door, announced with `reason`: it leaves the registry, its lane goes, what it held is dropped, and
    /// its caller is hung up on. `false` when no such door is open (already closed: the normal race).
    fn close_door(&self, conn_id: &str, reason: &str) -> bool {
        let Some(door) = self.doors.lock().unwrap().remove(conn_id) else {
            return false;
        };
        let dropped = self.retire(&door);
        let closed = NativeDoorClosed {
            conn_id: NativeDoorClosedConnId::try_from(conn_id).expect("a minted door id"),
            state: "closed".into(),
            reason: reason.into(),
        };
        let _ = self.events.send(DoorEvent::Closed(closed));
        tracing::info!(
            event = "field_native.door.closed",
            component = "door",
            conn_id,
            lane_id = door.lane_id(),
            reason,
            held_dropped = dropped,
            "A door closed"
        );
        true
    }

    /// The door's end, unannounced: what it held is released and dropped, its lane goes, its tasks stop.
    fn retire(&self, door: &Door) -> usize {
        let dropped = {
            let mut io = door.io.lock().unwrap();
            io.closed = true;
            io.held.clear();
            std::mem::take(&mut io.held_bytes)
        };
        self.release(dropped);
        self.bridge.close_local_lane(door.lane_id());
        let _ = door.stop.send(true);
        dropped
    }

    fn refused(&self, reason: &'static str, facts: Option<PeerFacts>) {
        let count = {
            let mut log = self.refusals.lock().unwrap();
            let entry = log.entry(reason).or_default();
            entry.since_warn += 1;
            let due = entry
                .last_warn
                .is_none_or(|at| at.elapsed() >= REFUSAL_WARN_EVERY);
            if !due {
                return;
            }
            entry.last_warn = Some(std::time::Instant::now());
            std::mem::take(&mut entry.since_warn)
        };
        tracing::warn!(
            event = "field_native.door.refused",
            component = "door",
            reason,
            count,
            pid = facts.map(|f| f.pid),
            effective_pid = facts.map(|f| f.effective_pid),
            uid = facts.map(|f| f.uid),
            "A door was refused at accept: it opened no lane and is not announced (count: refusals of this reason since the last such line)"
        );
    }

    fn walk_now(&self, pid: u32) -> Option<walk::Found> {
        let panes = walk::pane_roots(&self.observed.get()?.borrow());
        walk::walk(&peer::Kernel, pid, &panes)
    }

    /// The caller's pane. A miss may be a pane born a moment ago that the inventory has not reached yet: a quiet cell
    /// reconciles on an event or at its backstop, and under load an event's reconcile lags. So every cell is asked
    /// now, and the walk looks once more on the inventory from after the ask (a reconcile writes its rows before it
    /// stamps itself, terminal.rs `reconcile_cell`), or at `FRESH_COUNT_WAIT` on what there is. Only a caller outside
    /// every pane pays for the second look.
    async fn resolve_pane(&self, pid: u32) -> Option<NativeDoorPane> {
        let found = match self.walk_now(pid) {
            Some(found) => found,
            None => {
                let census = self.census.get()?.clone();
                let asked = std::time::Instant::now();
                census.ask();
                let deadline = tokio::time::Instant::now() + FRESH_COUNT_WAIT;
                while matches!(census.count(Some(asked)), Census::NotYet)
                    && tokio::time::Instant::now() < deadline
                {
                    tokio::time::sleep(CENSUS_POLL).await;
                }
                self.walk_now(pid)?
            }
        };
        Some(NativeDoorPane {
            terminal_session_id: NativeDoorPaneTerminalSessionId::try_from(
                found.terminal_session_id,
            )
            .ok()?,
            depth: u64::from(found.depth),
        })
    }
}

/// The accept's verdict on what the kernel said: the caller, or the reason it is refused. The checks run in the
/// order a refusal is cheapest to state: a foreign uid before anything is read of its process.
fn judge(
    own_uid: u32,
    facts: Option<PeerFacts>,
    process: Option<ProcessFacts>,
    accepted_at_ms: u64,
) -> Result<NativeDoorCaller, &'static str> {
    let facts = facts.ok_or("peer-gone")?;
    if facts.uid != own_uid {
        return Err("refused-uid");
    }
    if facts.pid != facts.effective_pid {
        return Err("delegated");
    }
    let process = process.ok_or("peer-gone")?;
    // The caller connected before the accept, so its start cannot be later. A start in a later second is a process
    // the pid was handed to after the caller left (a reuse within the accept's own second goes unseen: the start's
    // resolution).
    if process.started_at_ms / START_RESOLUTION_MS > accepted_at_ms / START_RESOLUTION_MS {
        return Err("peer-gone");
    }
    Ok(NativeDoorCaller {
        pid: std::num::NonZeroU64::new(u64::from(facts.pid)).ok_or("peer-gone")?,
        started_at_ms: process.started_at_ms,
    })
}

fn unix_ms_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// A door lane's other end: fieldd's bytes, to the door's caller.
struct DoorSink {
    door: Weak<Door>,
    shared: Weak<Shared>,
}

impl LocalLaneSink for DoorSink {
    fn send(&self, payload: &[u8]) -> anyhow::Result<()> {
        let (Some(door), Some(shared)) = (self.door.upgrade(), self.shared.upgrade()) else {
            anyhow::bail!("the door is gone");
        };
        // the bound is on what already waits, so one message of any size goes through to a caller that reads
        if door.out_bytes.load(Ordering::Acquire) > HELD_BYTES_PER_DOOR as usize {
            shared.close_door(door.conn_id(), "held-too-long");
            anyhow::bail!(
                "door {} holds more than its bound for a caller that is not reading",
                door.conn_id()
            );
        }
        door.out_bytes.fetch_add(payload.len(), Ordering::AcqRel);
        door.out.send(payload.to_vec()).map_err(|_| {
            door.out_bytes.fetch_sub(payload.len(), Ordering::AcqRel);
            anyhow::anyhow!("door {} is closed", door.conn_id())
        })
    }
}

#[cfg(unix)]
impl Shared {
    async fn admit(self: Arc<Self>, stream: tokio::net::UnixStream) {
        // the accept's instant FIRST, then the caller's start: the order the reuse guard compares them in
        let accepted_at_ms = unix_ms_now();
        let facts = peer::peer_facts(&stream).ok();
        let process = facts.and_then(|f| peer::Kernel.process(f.pid));
        let caller = match judge(peer::own_uid(), facts, process, accepted_at_ms) {
            Ok(caller) => caller,
            Err(reason) => return self.refused(reason, facts),
        };
        if self.doors.lock().unwrap().len() >= MAX_OPEN as usize {
            return self.refused("limit", facts);
        }
        let pid = caller.pid.get() as u32;
        let pane = self.resolve_pane(pid).await;
        self.open(stream, caller, pane, facts);
    }

    fn open(
        self: &Arc<Self>,
        stream: tokio::net::UnixStream,
        caller: NativeDoorCaller,
        pane: Option<NativeDoorPane>,
        facts: Option<PeerFacts>,
    ) {
        let conn_id = format!("door-{}", self.next_conn.fetch_add(1, Ordering::Relaxed));
        let (out, out_rx) = mpsc::unbounded_channel();
        let (stop, _) = watch::channel(false);
        let door = Arc::new_cyclic(|this: &Weak<Door>| {
            // the lane first, with its sink, because the door's row names the lane
            let lane = self.bridge.open_local_lane(
                LaneClass::Reliable,
                format!("door:{conn_id}"),
                PROTOCOL.into(),
                Arc::new(DoorSink {
                    door: this.clone(),
                    shared: Arc::downgrade(self),
                }),
            );
            Door {
                row: NativeDoorOpen {
                    conn_id: NativeDoorOpenConnId::try_from(conn_id.as_str())
                        .expect("a minted door id"),
                    lane_id: lane.lane_id,
                    state: "open".into(),
                    caller,
                    pane,
                },
                io: Mutex::new(DoorIo::default()),
                out,
                out_bytes: AtomicUsize::new(0),
                stop,
            }
        });
        {
            let mut doors = self.doors.lock().unwrap();
            // counted again under the guard: the walk awaited, and others may have opened meanwhile
            if doors.len() >= MAX_OPEN as usize {
                drop(doors);
                self.retire(&door);
                return self.refused("limit", facts);
            }
            doors.insert(conn_id.clone(), door.clone());
        }
        let _ = self.events.send(DoorEvent::Opened(door.row.clone()));
        tracing::info!(
            event = "field_native.door.opened",
            component = "door",
            conn_id = conn_id.as_str(),
            lane_id = door.lane_id(),
            pid = door.row.caller.pid.get(),
            pane = door
                .row
                .pane
                .as_ref()
                .map(|p| p.terminal_session_id.as_str()),
            depth = door.row.pane.as_ref().map(|p| p.depth),
            "A door opened"
        );
        let (read, write) = stream.into_split();
        tokio::spawn(read_from_caller(self.clone(), door.clone(), read));
        tokio::spawn(write_to_caller(door, write, out_rx));
    }
}

#[cfg(unix)]
async fn read_from_caller(
    shared: Arc<Shared>,
    door: Arc<Door>,
    mut read: tokio::net::unix::OwnedReadHalf,
) {
    use tokio::io::AsyncReadExt;
    let mut stop = door.stop.subscribe();
    let mut buf = vec![0u8; READ_CHUNK];
    let reason = loop {
        tokio::select! {
            // closed elsewhere, and that close said why
            _ = stop.wait_for(|stopped| *stopped) => return,
            read = read.read(&mut buf) => match read {
                Ok(0) | Err(_) => break "eof",
                Ok(n) => {
                    if shared.take_inbound(&door, buf[..n].to_vec()).is_err() {
                        break "held-too-long";
                    }
                }
            },
        }
    };
    shared.close_door(door.conn_id(), reason);
}

#[cfg(unix)]
async fn write_to_caller(
    door: Arc<Door>,
    mut write: tokio::net::unix::OwnedWriteHalf,
    mut out: mpsc::UnboundedReceiver<Vec<u8>>,
) {
    use tokio::io::AsyncWriteExt;
    let mut stop = door.stop.subscribe();
    loop {
        let next = tokio::select! {
            _ = stop.wait_for(|stopped| *stopped) => None,
            next = out.recv() => next,
        };
        let Some(bytes) = next else { break };
        // a caller that stops reading must not hold this task past its door's close
        let wrote = tokio::select! {
            _ = stop.wait_for(|stopped| *stopped) => false,
            wrote = write.write_all(&bytes) => wrote.is_ok(),
        };
        if !wrote {
            break;
        }
        door.out_bytes.fetch_sub(bytes.len(), Ordering::AcqRel);
    }
    let _ = write.shutdown().await;
}

/// The mgmt plane's door to the doors.
#[derive(Clone)]
pub struct DoorHandle {
    shared: Arc<Shared>,
}

/// One live door subscription. fieldd takes doors' bytes while one lives; dropping it ends that.
pub struct DoorSubscriber {
    shared: Arc<Shared>,
}

impl Drop for DoorSubscriber {
    fn drop(&mut self) {
        self.shared
            .subscribers
            .send_modify(|count| *count = count.saturating_sub(1));
    }
}

impl DoorHandle {
    /// Every open door, in the order they opened.
    pub fn snapshot(&self) -> NativeDoorSnapshot {
        let mut doors: Vec<NativeDoorOpen> = (self.shared.doors.lock().unwrap().values())
            .map(|door| door.row.clone())
            .collect();
        doors.sort_by_key(|door| door.lane_id);
        NativeDoorSnapshot { doors }
    }

    pub fn subscribe_events(&self) -> broadcast::Receiver<DoorEvent> {
        self.shared.events.subscribe()
    }

    /// A door subscription begins: fieldd can take doors' bytes while it lives (and a byte-plane client is attached),
    /// and what doors held then follows.
    pub fn subscriber(&self) -> DoorSubscriber {
        self.shared
            .subscribers
            .send_modify(|count| *count = count.saturating_add(1));
        DoorSubscriber {
            shared: self.shared.clone(),
        }
    }

    /// `native.door.close`. `false` for a door already gone.
    pub fn close(&self, conn_id: &str, reason: &str) -> bool {
        self.shared.close_door(conn_id, reason)
    }

    /// `native.door.info`: the endpoint and the bridge command a spark's MCP config runs. `Err` says why there is
    /// none, for the UNAVAILABLE it answers.
    pub fn info(&self) -> Result<NativeDoorInfoResult, String> {
        let health = self.shared.health.lock().unwrap().clone();
        if !matches!(health.state, UnitState::Up) {
            return Err(health
                .detail
                .unwrap_or_else(|| "the door is not open".into()));
        }
        let endpoint = self
            .shared
            .endpoint
            .clone()
            .ok_or("the data root is not valid UTF-8")?;
        let command = std::env::current_exe()
            .map_err(|e| format!("this floor's own path is unreadable: {e}"))?
            .to_str()
            .ok_or("this floor's own path is not valid UTF-8")?
            .to_owned();
        Ok(NativeDoorInfoResult {
            args: vec!["door".into(), "--endpoint".into(), endpoint.clone()],
            command: command.as_str().try_into().map_err(|_| "no command")?,
            endpoint: endpoint.as_str().try_into().map_err(|_| "no endpoint")?,
        })
    }

    /// The unit's health now, for the state an UNAVAILABLE names.
    pub fn health(&self) -> UnitHealth {
        self.shared.health.lock().unwrap().clone()
    }

    /// Wiring: the floor's observed inventory, which the walk reads its panes from. Set once.
    pub fn observe(&self, observed: watch::Receiver<ObservedState>) {
        let _ = self.shared.observed.set(observed);
    }

    /// Wiring: the cells' census, which a missed walk asks for a fresh inventory. Set once.
    pub fn configure_census(&self, census: Arc<dyn SessionCensus>) {
        let _ = self.shared.census.set(census);
    }

    /// Doors open now.
    pub fn open_count(&self) -> usize {
        self.shared.doors.lock().unwrap().len()
    }

    /// Is fieldd sent doors' bytes now: a byte-plane client attached and a door subscription live?
    pub fn takes_bytes(&self) -> bool {
        self.shared.gate_open()
    }

    /// Bytes held for fieldd now, across every door.
    pub fn held_bytes(&self) -> usize {
        self.shared.held_total.load(Ordering::Acquire)
    }
}

pub struct DoorUnit {
    shared: Arc<Shared>,
    tasks: Mutex<Vec<tokio::task::JoinHandle<()>>>,
}

impl DoorUnit {
    pub fn new(config: &NativeConfig, ping: UnboundedSender<()>, bridge: BridgeHandle) -> Self {
        Self {
            shared: Arc::new(Shared {
                health: Mutex::new(UnitHealth {
                    unit: "door".into(),
                    state: UnitState::Starting,
                    detail: None,
                    auth_url: None,
                }),
                ping,
                bridge,
                endpoint: config.door_endpoint(),
                doors: Mutex::new(HashMap::new()),
                held_total: AtomicUsize::new(0),
                next_conn: AtomicU64::new(1),
                events: broadcast::channel(EVENT_CAPACITY).0,
                observed: OnceLock::new(),
                census: OnceLock::new(),
                subscribers: watch::channel(0).0,
                refusals: Mutex::new(HashMap::new()),
            }),
            tasks: Mutex::new(Vec::new()),
        }
    }

    pub fn handle(&self) -> DoorHandle {
        DoorHandle {
            shared: self.shared.clone(),
        }
    }
}

#[async_trait::async_trait]
impl NativeService for DoorUnit {
    fn id(&self) -> &'static str {
        "door"
    }

    fn dependencies(&self) -> &'static [&'static str] {
        &["mesh-bridge"]
    }

    #[cfg(unix)]
    async fn start(&self) -> anyhow::Result<()> {
        use std::os::unix::fs::PermissionsExt;
        let Some(endpoint) = self.shared.endpoint.clone() else {
            anyhow::bail!("data root is not valid UTF-8, which the endpoint contract requires");
        };
        // replace-stale-then-bind (the external-mode law), then 0600: the run dir is 0700 already, and the socket
        // is held to its owner as well
        let mut listener = crate::local_ipc::bind(&endpoint)?;
        std::fs::set_permissions(&endpoint, std::fs::Permissions::from_mode(0o600))?;
        let shared = self.shared.clone();
        let accept = tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok(stream) => {
                        tokio::spawn(shared.clone().admit(stream));
                    }
                    Err(e) => {
                        tracing::error!(
                            event = "field_native.door.accept_failed",
                            component = "door",
                            error = %e,
                            "The door stopped accepting connections"
                        );
                        break;
                    }
                }
            }
        });
        // what doors held goes to fieldd as soon as it can take it: a byte-plane client authenticating, or a door
        // subscription beginning
        let shared = self.shared.clone();
        let flush = tokio::spawn(async move {
            let mut attached = shared.bridge.attached_rx();
            let mut subscribers = shared.subscribers.subscribe();
            loop {
                shared.flush_all();
                tokio::select! {
                    changed = attached.changed() => if changed.is_err() { break },
                    changed = subscribers.changed() => if changed.is_err() { break },
                }
            }
        });
        self.tasks.lock().unwrap().extend([accept, flush]);
        self.shared.set(UnitState::Up, "door socket bound");
        Ok(())
    }

    /// The door is unix-only: its caller is named by a unix socket's peer credentials. Windows answers UNAVAILABLE.
    #[cfg(not(unix))]
    async fn start(&self) -> anyhow::Result<()> {
        self.shared.set(
            UnitState::Disabled,
            "the door names its caller by a unix socket's peer credentials; this platform has none (CP-1a)",
        );
        Ok(())
    }

    fn health(&self) -> UnitHealth {
        self.shared.health.lock().unwrap().clone()
    }

    async fn stop(&self) -> anyhow::Result<()> {
        for task in self.tasks.lock().unwrap().drain(..) {
            task.abort();
        }
        let doors: Vec<Arc<Door>> = (self.shared.doors.lock().unwrap().drain())
            .map(|(_, door)| door)
            .collect();
        for door in doors {
            self.shared.retire(&door);
        }
        if let Some(endpoint) = &self.shared.endpoint {
            let _ = crate::local_ipc::remove_stale_endpoint(endpoint);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ACCEPT: u64 = 1_792_431_662_417;
    const UID: u32 = 501;

    fn facts(pid: u32, effective_pid: u32, uid: u32) -> Option<PeerFacts> {
        Some(PeerFacts {
            pid,
            effective_pid,
            uid,
        })
    }

    fn started(at: u64) -> Option<ProcessFacts> {
        Some(ProcessFacts {
            parent: 1,
            started_at_ms: at,
        })
    }

    #[test]
    fn the_accept_names_a_caller_of_its_own_uid_by_its_pid_and_start() {
        let caller = judge(
            UID,
            facts(51842, 51842, UID),
            started(ACCEPT - 4_000),
            ACCEPT,
        )
        .unwrap();
        assert_eq!(caller.pid.get(), 51842);
        assert_eq!(caller.started_at_ms, ACCEPT - 4_000);
        // a start in the accept's own second is the caller's: the start's resolution
        assert!(judge(UID, facts(7, 7, UID), started(ACCEPT + 500), ACCEPT).is_ok());
    }

    #[test]
    fn the_accept_refuses_a_foreign_uid_a_delegated_socket_and_a_caller_gone() {
        assert_eq!(
            judge(UID, facts(7, 7, 0), started(ACCEPT), ACCEPT).unwrap_err(),
            "refused-uid"
        );
        // the holder and the process the socket acts for differ: delegated, whichever is named
        assert_eq!(
            judge(UID, facts(7, 8, UID), started(ACCEPT), ACCEPT).unwrap_err(),
            "delegated"
        );
        assert_eq!(
            judge(UID, None, started(ACCEPT), ACCEPT).unwrap_err(),
            "peer-gone"
        );
        assert_eq!(
            judge(UID, facts(7, 7, UID), None, ACCEPT).unwrap_err(),
            "peer-gone"
        );
        // the pid now belongs to a process started after the accept: the caller left and its pid was handed on
        assert_eq!(
            judge(UID, facts(7, 7, UID), started(ACCEPT + 1_000), ACCEPT).unwrap_err(),
            "peer-gone"
        );
        // a foreign uid is refused before its process is read at all
        assert_eq!(
            judge(UID, facts(7, 8, 0), None, ACCEPT).unwrap_err(),
            "refused-uid"
        );
    }
}
