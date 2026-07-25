use crate::contracts::{DesiredState, NativeHealth, ObservedState};
use crate::logging::NativeLogging;
use crate::services::mesh::MeshHandle;
use crate::services::mesh_bridge::BridgeHandle;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, watch, Mutex};

/// One product plane per device: at most one authenticated mgmt client;
/// a new hello supersedes the old connection (design-02 §2.7).
pub struct ClientHandle {
    pub conn_id: u64,
    pub tx: mpsc::UnboundedSender<OutMsg>,
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
            logging,
            next_conn_id: AtomicU64::new(1),
            next_sub_id: AtomicU64::new(1),
        })
    }

    pub fn conn_id(&self) -> u64 {
        self.next_conn_id.fetch_add(1, Ordering::Relaxed)
    }
    pub fn sub_id(&self) -> String {
        format!("s{}", self.next_sub_id.fetch_add(1, Ordering::Relaxed))
    }
}
