pub mod lane_transport;
pub mod mesh;
pub mod mesh_bridge;
pub mod stubs;

use crate::config::NativeConfig;
use crate::manager::NativeService;
use tokio::sync::mpsc::UnboundedSender;

/// The device's unit set in dependency order (design-02 §2.2:
/// mgmt is implicit → mesh-gateway → terminal → mesh-bridge → process).
/// mesh-gateway is real since C1 and mesh-bridge since C6; terminal/process
/// remain stubs until their embed milestones. Returns the two handles the mgmt
/// facade needs as doors — mesh (C2) and the lane bridge (C6/D5).
pub fn build_units(
    config: &NativeConfig,
    secret: [u8; 32],
    ping: UnboundedSender<()>,
) -> (
    Vec<Box<dyn NativeService>>,
    mesh::MeshHandle,
    mesh_bridge::BridgeHandle,
) {
    let mesh_unit = mesh::MeshUnit::new(config, ping.clone());
    let handle = mesh_unit.handle();
    let bridge = mesh_bridge::MeshBridge::new(config, secret, ping);
    let bridge_handle = bridge.handle();
    let units: Vec<Box<dyn NativeService>> = vec![
        Box::new(mesh_unit),
        Box::new(stubs::StubService::new("terminal", &["mesh-gateway"])),
        Box::new(bridge),
        Box::new(stubs::StubService::new("process", &[])),
    ];
    (units, handle, bridge_handle)
}
