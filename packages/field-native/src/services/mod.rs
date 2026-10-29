/// CP-1a — the floor's door.
pub mod door;
pub mod freeway;
pub mod lane_transport;
mod lossy_lane;
pub mod mesh;
pub mod mesh_bridge;
pub mod mesh_egress;
pub mod stubs;
pub mod terminal;
pub mod terminal_client;

use crate::config::NativeConfig;
use crate::manager::NativeService;
use tokio::sync::mpsc::UnboundedSender;

/// The device's unit set in dependency order (design-02 §2.2:
/// mgmt is implicit → mesh-gateway → terminal → mesh-bridge → process).
/// mesh-gateway is real since C1, mesh-bridge since C6, and terminal since
/// NF-2; `process` remains a stub until its embed milestone. Returns the three
/// handles the boot sequence needs as doors — mesh (C2), the lane bridge
/// (C6/D5), and the terminal floor (NF-D7/D8).
///
/// The terminal unit keeps its REGISTRATION slot after mesh-gateway (start
/// order is design-02 law) and declares no dependency on it. TM-1 made that
/// literal: it no longer takes the gateway's handle at all. GT-4a's exception —
/// the floor borrowing the gateway's `Arc<Node>` to serve TSP1 in-process — is
/// retired, so nothing in this unit set reaches from terminals to the tailnet.
/// Whether the terminal doors are PUBLISHED is a fact the mgmt hello composes
/// from the config's plan and the gateway's live node, and fieldd owns the
/// routes that do the publishing (TM-2).
pub fn build_units(
    config: &NativeConfig,
    secret: [u8; 32],
    boot_id: &str,
    ping: UnboundedSender<()>,
) -> (
    Vec<Box<dyn NativeService>>,
    mesh::MeshHandle,
    mesh_bridge::BridgeHandle,
    terminal::TerminalHandle,
    freeway::FreewayHandle,
) {
    let mesh_unit = mesh::MeshUnit::new(config, ping.clone());
    let handle = mesh_unit.handle();
    let terminal_unit = terminal::TerminalUnit::new(config, ping.clone());
    let terminal_handle = terminal_unit.handle();
    let bridge = mesh_bridge::MeshBridge::new(config, secret, ping.clone());
    let bridge_handle = bridge.handle();
    // F1 — after the terminal unit, whose cells the host's walls reach.
    let freeway_unit = freeway::FreewayUnit::new(config, boot_id, ping, terminal_handle.clone());
    let freeway_handle = freeway_unit.handle();
    let units: Vec<Box<dyn NativeService>> = vec![
        Box::new(mesh_unit),
        Box::new(terminal_unit),
        Box::new(bridge),
        Box::new(freeway_unit),
        Box::new(stubs::StubService::new("process", &[])),
    ];
    (
        units,
        handle,
        bridge_handle,
        terminal_handle,
        freeway_handle,
    )
}
