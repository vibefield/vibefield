use crate::contracts::{DesiredState, NativeHealth, ObservedState, TerminalEndpoints};
use crate::logging::NativeLogging;
use crate::registries::mesh_control_limits;
use crate::services::mesh::MeshHandle;
use crate::services::mesh_bridge::BridgeHandle;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use tokio::sync::{mpsc, watch, Mutex};

pub const MGMT_MAX_FRAME_BYTES: usize = mesh_control_limits::MGMT_FRAME_BYTES;
const MGMT_MAX_QUEUED_BYTES: usize = mesh_control_limits::MGMT_QUEUED_BYTES;
const MGMT_OUTBOX_MESSAGES: usize = mesh_control_limits::MGMT_OUTBOX_MESSAGES;

/** A byte- and message-bounded management outbox. Saturation closes the
 * connection so fieldd reconnects and receives P5 snapshots instead of
 * silently continuing on a stream whose deltas were dropped. */
#[derive(Clone)]
pub struct MgmtOutbox {
    tx: mpsc::Sender<OutMsg>,
    close: watch::Sender<bool>,
    closing: Arc<AtomicBool>,
    queued_bytes: Arc<AtomicUsize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MgmtOutboxClosed;

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
                .fetch_update(Ordering::AcqRel, Ordering::Acquire, |current| {
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

    pub fn release(&self, msg: &OutMsg) {
        if let OutMsg::Line(line) = msg {
            self.queued_bytes
                .fetch_sub(line.len() + 1, Ordering::AcqRel);
        }
    }

    pub fn is_closed(&self) -> bool {
        self.closing.load(Ordering::Acquire) || *self.close.borrow() || self.tx.is_closed()
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
    /// NF-D8: the terminal floor's endpoints + per-boot bearer token, which the
    /// pairing hello hands to fieldd. A `OnceLock` and not a constructor
    /// argument because the units are built BEFORE this state exists and the
    /// value never changes again once boot has wired it — its emptiness is
    /// exactly the `HelloAck.terminal` absence the contract allows. Memory-only:
    /// the token never reaches a log, a config file, or any environment (EL7).
    pub terminal: OnceLock<TerminalEndpoints>,
    /// Process-owned native diagnostic producer. Embedded unit tests omit it;
    /// the production main installs it before service composition.
    pub logging: Option<NativeLogging>,
    next_conn_id: AtomicU64,
    next_sub_id: AtomicU64,
}

impl DaemonState {
    pub fn new(
        boot_id: String,
        secret: [u8; 32],
        health: NativeHealth,
        observed: ObservedState,
        mesh: MeshHandle,
        bridge: BridgeHandle,
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
            terminal: OnceLock::new(),
            logging,
            next_conn_id: AtomicU64::new(1),
            next_sub_id: AtomicU64::new(1),
        })
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
}
