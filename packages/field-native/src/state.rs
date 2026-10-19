use crate::config::MeshPlan;
use crate::contracts::{
    DesiredState, NativeHealth, ObservedState, TerminalEndpoints, TerminalRouteSnapshot,
};
use crate::logging::NativeLogging;
use crate::registries::mesh_control_limits;
use crate::services::mesh::MeshHandle;
use crate::services::mesh_bridge::BridgeHandle;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, watch, Mutex};

pub const MGMT_MAX_FRAME_BYTES: usize = mesh_control_limits::MGMT_FRAME_BYTES;
const MGMT_MAX_QUEUED_BYTES: usize = mesh_control_limits::MGMT_QUEUED_BYTES;
const MGMT_OUTBOX_MESSAGES: usize = mesh_control_limits::MGMT_OUTBOX_MESSAGES;

/** A byte- and message-bounded management outbox. Saturation closes the
 * connection so fieldd reconnects and receives P5 snapshots instead of
 * silently continuing on a stream whose deltas were dropped. A line that
 * carries no state (WG-D6's tick) goes through `offer`, which drops it rather
 * than close anything. */
#[derive(Clone)]
pub struct MgmtOutbox {
    tx: mpsc::Sender<OutMsg>,
    close: watch::Sender<bool>,
    closing: Arc<AtomicBool>,
    queued_bytes: Arc<AtomicUsize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MgmtOutboxClosed;

/// What `MgmtOutbox::offer` did with a line.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Offered {
    Queued,
    /// Lines were already waiting in the outbox, or it was at its byte bound:
    /// the line was dropped and the connection kept.
    Skipped,
}

impl MgmtOutbox {
    pub fn channel() -> (Self, mpsc::Receiver<OutMsg>, watch::Receiver<bool>) {
        let (tx, rx) = mpsc::channel(MGMT_OUTBOX_MESSAGES);
        let (close, close_rx) = watch::channel(false);
        (
            Self {
                tx,
                close,
                closing: Arc::new(AtomicBool::new(false)),
                queued_bytes: Arc::new(AtomicUsize::new(0)),
            },
            rx,
            close_rx,
        )
    }

    pub fn send(&self, msg: OutMsg) -> Result<(), MgmtOutboxClosed> {
        let OutMsg::Line(ref line) = msg else {
            self.closing.store(true, Ordering::Release);
            if self.tx.try_send(msg).is_err() {
                self.close.send_replace(true);
                return Err(MgmtOutboxClosed);
            }
            return Ok(());
        };
        if self.closing.load(Ordering::Acquire) {
            return Err(MgmtOutboxClosed);
        }
        let bytes = line.len() + 1;
        if line.len() > MGMT_MAX_FRAME_BYTES
            || self
                .queued_bytes
                .try_update(Ordering::AcqRel, Ordering::Acquire, |current| {
                    current
                        .checked_add(bytes)
                        .filter(|next| *next <= MGMT_MAX_QUEUED_BYTES)
                })
                .is_err()
        {
            self.closing.store(true, Ordering::Release);
            self.close.send_replace(true);
            return Err(MgmtOutboxClosed);
        }
        if self.tx.try_send(msg).is_err() {
            self.queued_bytes.fetch_sub(bytes, Ordering::AcqRel);
            self.closing.store(true, Ordering::Release);
            self.close.send_replace(true);
            return Err(MgmtOutboxClosed);
        }
        Ok(())
    }

    /// WG-D6 — `send` for a line that carries no state, the floor's tick. It
    /// is queued only when nothing waits in the outbox, and otherwise dropped
    /// with the connection kept, so it holds at most one slot.
    ///
    /// `send` closes on saturation because a dropped delta leaves the reader on
    /// a stream it can no longer trust, so it forces snapshot-on-reconnect. A
    /// dropped tick leaves nothing to rebuild: the next one carries the same
    /// facts, and the gap shows in its `seq`. And a tick queued behind lines
    /// the writer has not drained would arrive stale, while taking a slot a
    /// delta may need: with a reader that has stopped reading, ticks would
    /// otherwise fill the outbox, and the next delta would close the
    /// connection. Refused only when the connection is closing.
    pub fn offer(&self, line: String) -> Result<Offered, MgmtOutboxClosed> {
        if self.is_closed() {
            return Err(MgmtOutboxClosed);
        }
        if self.tx.capacity() < self.tx.max_capacity() {
            return Ok(Offered::Skipped);
        }
        let bytes = line.len() + 1;
        if line.len() > MGMT_MAX_FRAME_BYTES
            || self
                .queued_bytes
                .try_update(Ordering::AcqRel, Ordering::Acquire, |current| {
                    current
                        .checked_add(bytes)
                        .filter(|next| *next <= MGMT_MAX_QUEUED_BYTES)
                })
                .is_err()
        {
            return Ok(Offered::Skipped);
        }
        match self.tx.try_send(OutMsg::Line(line)) {
            Ok(()) => Ok(Offered::Queued),
            Err(mpsc::error::TrySendError::Full(_)) => {
                self.queued_bytes.fetch_sub(bytes, Ordering::AcqRel);
                Ok(Offered::Skipped)
            }
            Err(mpsc::error::TrySendError::Closed(_)) => {
                self.queued_bytes.fetch_sub(bytes, Ordering::AcqRel);
                Err(MgmtOutboxClosed)
            }
        }
    }

    pub fn release(&self, msg: &OutMsg) {
        if let OutMsg::Line(line) = msg {
            self.queued_bytes
                .fetch_sub(line.len() + 1, Ordering::AcqRel);
        }
    }

    pub fn is_closed(&self) -> bool {
        self.closing.load(Ordering::Acquire) || *self.close.borrow() || self.tx.is_closed()
    }

    /// Wake a reader blocked on the same connection so it stops and drops its
    /// half. Called by the writer AFTER it drains and shuts down (WIN-D1: a
    /// Windows named pipe delivers EOF to the peer only when the whole handle
    /// closes — i.e. when both `io::split` halves drop — and `shutdown()` alone
    /// does not FIN it the way a unix socket does). Flipped here, not in
    /// `send(Close)`, so a superseded client still receives its notification
    /// before the connection tears down.
    pub fn signal_closed(&self) {
        self.close.send_replace(true);
    }
}

/// One product plane per device: at most one authenticated mgmt client;
/// a new hello supersedes the old connection (design-02 §2.7).
pub struct ClientHandle {
    pub conn_id: u64,
    pub tx: MgmtOutbox,
}

#[derive(Debug)]
pub enum OutMsg {
    Line(String),
    Close,
}

pub struct DaemonState {
    pub boot_id: String,
    pub secret: [u8; 32],
    pub health_tx: watch::Sender<NativeHealth>,
    pub observed_tx: watch::Sender<ObservedState>,
    pub desired: Mutex<Option<DesiredState>>,
    pub current_client: Mutex<Option<ClientHandle>>,
    /// the mgmt facade's door to the mesh unit (C2)
    pub mesh: MeshHandle,
    /// the lane-control door to the MeshData bridge (C6/D5). Control lives here;
    /// the bytes those lanes carry never touch this channel.
    pub bridge: BridgeHandle,
    /// TC-D15 (TC-S2) — the revisioned terminal route snapshot, watched from
    /// the terminal unit's supervisor: the floor's ONLY truth about where
    /// terminals live. It replaced a `OnceLock<TerminalEndpoints>` the boot
    /// sequence filled from the in-process serve's fixed pair; TM-1 retired
    /// that serve, and with it the second reading (NF-D8's custody is
    /// unchanged — the row carries the same per-boot bearer token on the same
    /// paired channel, memory-only, never a log or an environment).
    pub terminal_routes: watch::Receiver<TerminalRouteSnapshot>,
    /// TM-1 — whether this floor was ASKED to publish its terminal doors on the
    /// tailnet. Config, resolved once at boot; the live half (is the gateway's
    /// node actually up?) is read from `mesh` as each hello is written, because
    /// a node can come and go while a floor keeps serving PTYs.
    pub terminal_mesh: MeshPlan,
    /// F1 — the freeway unit's door: `native.freeway.*` reach it.
    pub freeway: crate::services::freeway::FreewayHandle,
    /// Process-owned native diagnostic producer. Embedded unit tests omit it;
    /// the production main installs it before service composition.
    pub logging: Option<NativeLogging>,
    /// WP12 L2b (`build-wp12-updater.md` §9 R2/R3) — the restart intent's file, how the previous floor ended, and
    /// the request that stops this floor. Configured at boot; embedded unit daemons leave it unconfigured.
    pub restart: crate::restart::RestartControl,
    next_conn_id: AtomicU64,
    next_sub_id: AtomicU64,
    next_tick_seq: AtomicU64,
}

impl DaemonState {
    // Wiring, not API: bootstrap hands every plane its seam in one place, and
    // an args struct would only move the list somewhere harder to read.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        boot_id: String,
        secret: [u8; 32],
        health: NativeHealth,
        observed: ObservedState,
        mesh: MeshHandle,
        bridge: BridgeHandle,
        terminal_routes: watch::Receiver<TerminalRouteSnapshot>,
        terminal_mesh: MeshPlan,
        freeway: crate::services::freeway::FreewayHandle,
        logging: Option<NativeLogging>,
    ) -> Arc<Self> {
        let (health_tx, _) = watch::channel(health);
        let (observed_tx, _) = watch::channel(observed);
        Arc::new(Self {
            boot_id,
            secret,
            health_tx,
            observed_tx,
            desired: Mutex::new(None),
            current_client: Mutex::new(None),
            mesh,
            bridge,
            terminal_routes,
            terminal_mesh,
            freeway,
            logging,
            restart: crate::restart::RestartControl::default(),
            next_conn_id: AtomicU64::new(1),
            next_sub_id: AtomicU64::new(1),
            next_tick_seq: AtomicU64::new(0),
        })
    }

    /// The CURRENT terminal dial coordinates: the route snapshot's FIRST cell,
    /// which `compose_route_rows` keeps as the interactive class host whenever
    /// one serves. `None` is the honest not-up-yet. (Until TM-1 this folded a
    /// second reading in — the in-process serve's fixed pair, held in a
    /// `OnceLock`; that serve is gone, so there is one reading again.)
    pub fn terminal_endpoints_now(&self) -> Option<TerminalEndpoints> {
        self.terminal_routes
            .borrow()
            .cells
            .first()
            .map(|cell| cell.endpoints.clone())
    }

    /// TM-1 (MF-1l) — `HelloAck.terminalMesh`: are this floor's terminal doors
    /// published on the tailnet?
    ///
    /// BOTH halves, or it is false. The flag is a request; publishing needs the
    /// gateway's node, and reading it here — per hello, not once at boot — is
    /// what keeps the answer honest as the node comes and goes. `MeshHandle::node`
    /// is a watch read, so this costs no wait: the 20 s attach budget the old
    /// TSP1 adapter spent at boot has no successor, because nothing is being
    /// CONSTRUCTED from the node any more.
    ///
    /// What it does NOT claim: that any particular door is reachable. The floor
    /// publishes nothing itself — fieldd registers one serve route per live cell
    /// (TM-2) — so this is the floor's half of the fact and fieldd's routes are
    /// the other.
    ///
    /// E-F1 — composed through `MeshPlan::publishes`, the ONE reading the hello
    /// and the routes stream's push both go through. It was spelled inline here
    /// until E-F1, which is how the FLAG half came to have no witness at all
    /// (N-M4): both `mgmt_server.rs` rows over it were false-side rows, so
    /// deleting the flag conjunct left the suite green.
    pub fn terminal_mesh_published(&self) -> bool {
        self.terminal_mesh.publishes(self.mesh.node_present())
    }

    /// E-F1 — subscribe to the half of that reading which MOVES after a hello.
    ///
    /// The flag cannot change without a floor restart. The node can, and
    /// predictably does AFTER the hello has already been answered: the bring-up
    /// task returns before the node exists (`services/mesh.rs`), while the mgmt
    /// listener binds right after `start_all` and fieldd hellos the instant the
    /// socket answers. The routes forwarder holds one of these so that
    /// correction is PUSHED on a stream fieldd already reads, instead of
    /// waiting for an unrelated re-pair that may never come.
    pub fn terminal_mesh_presence(&self) -> crate::services::mesh::NodePresence {
        self.mesh.node_presence()
    }

    pub fn conn_id(&self) -> u64 {
        self.next_conn_id.fetch_add(1, Ordering::Relaxed)
    }

    /// Is this connection still THE paired product plane? Asked per request and
    /// not only at hello: superseding a connection closes its write half, but
    /// its reader stays alive and authenticated, so a stale fieldd can still
    /// reach mutating surfaces unless every one of them re-checks (design-02
    /// §2.7's single-client rule, EL7's same-uid adversary).
    pub async fn is_current_client(&self, conn_id: u64) -> bool {
        self.current_client
            .lock()
            .await
            .as_ref()
            .is_some_and(|client| client.conn_id == conn_id)
    }

    pub fn sub_id(&self) -> String {
        format!("s{}", self.next_sub_id.fetch_add(1, Ordering::Relaxed))
    }

    /// WG-D6 — the next `native.lifecycle.tick`'s `seq`: from 0, one per tick
    /// this floor produces in this boot, whichever connection it goes to. A
    /// tick dropped for a full outbox keeps its number, so the reader sees the
    /// gap.
    pub fn tick_seq(&self) -> u64 {
        self.next_tick_seq.fetch_add(1, Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn management_outbox_closes_instead_of_growing_past_message_capacity() {
        let (outbox, _rx, close) = MgmtOutbox::channel();
        for index in 0..MGMT_OUTBOX_MESSAGES {
            outbox
                .send(OutMsg::Line(format!("message-{index}")))
                .expect("within the fixed queue");
        }
        assert!(outbox.send(OutMsg::Line("overflow".into())).is_err());
        assert!(*close.borrow(), "overflow must force snapshot-on-reconnect");
    }

    /// WG-D6 — the tick's path. An idle outbox queues the offered line; one
    /// with anything waiting drops it and keeps the connection, a full one
    /// included, and spends none of the byte budget on it. Once the writer has
    /// drained, the next offer is queued. Only a closing connection refuses it.
    #[test]
    fn an_offered_line_waits_behind_nothing_and_never_closes_the_connection() {
        let (outbox, mut rx, close) = MgmtOutbox::channel();
        let drain = |rx: &mut mpsc::Receiver<OutMsg>| {
            while let Ok(msg) = rx.try_recv() {
                outbox.release(&msg);
            }
        };

        assert_eq!(outbox.offer("tick".into()), Ok(Offered::Queued));
        assert_eq!(
            outbox.offer("tick".into()),
            Ok(Offered::Skipped),
            "a tick never queues behind another line, a tick included"
        );
        drain(&mut rx);

        let mut queued = 0;
        for index in 0..MGMT_OUTBOX_MESSAGES {
            let line = format!("message-{index}");
            queued += line.len() + 1;
            outbox
                .send(OutMsg::Line(line))
                .expect("within the fixed queue");
        }
        assert_eq!(outbox.offer("tick".into()), Ok(Offered::Skipped));
        assert!(
            !*close.borrow(),
            "a dropped tick must not close the connection"
        );
        assert!(!outbox.is_closed());
        assert_eq!(
            outbox.queued_bytes.load(Ordering::Acquire),
            queued,
            "a skipped line spends none of the byte budget"
        );

        drain(&mut rx);
        assert_eq!(outbox.queued_bytes.load(Ordering::Acquire), 0);
        assert_eq!(outbox.offer("tick".into()), Ok(Offered::Queued));

        drain(&mut rx);
        let _ = outbox.send(OutMsg::Close);
        assert_eq!(outbox.offer("tick".into()), Err(MgmtOutboxClosed));
    }
}
