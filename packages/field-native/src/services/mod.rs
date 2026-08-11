pub mod lane_transport;
pub mod mesh;
pub mod mesh_bridge;
pub mod stubs;
pub mod terminal;
pub mod terminal_client;
pub mod terminal_mesh;

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
/// order is design-02 law) and still declares no dependency on it. Since GT-4a
/// it BORROWS that unit's handle — the floor's one named mesh exception (spec
/// §7 / GT-D7) — but borrowing is not depending: with
/// `FIELD_NATIVE_TERMINAL_MESH` unset the unit drops the handle at construction
/// and nothing from `ghosttea-truffle` is ever built, and with it set a gateway
/// that cannot lend a node costs the mesh rather than the PTYs.
pub fn build_units(
    config: &NativeConfig,
    secret: [u8; 32],
    ping: UnboundedSender<()>,
) -> (
    Vec<Box<dyn NativeService>>,
    mesh::MeshHandle,
    mesh_bridge::BridgeHandle,
    terminal::TerminalHandle,
) {
    let mesh_unit = mesh::MeshUnit::new(config, ping.clone());
    let handle = mesh_unit.handle();
    let terminal_unit = terminal::TerminalUnit::new(config, ping.clone(), handle.clone());
    let terminal_handle = terminal_unit.handle();
    let bridge = mesh_bridge::MeshBridge::new(config, secret, ping);
    let bridge_handle = bridge.handle();
    let units: Vec<Box<dyn NativeService>> = vec![
        Box::new(mesh_unit),
        Box::new(terminal_unit),
        Box::new(bridge),
        Box::new(stubs::StubService::new("process", &[])),
    ];
    (units, handle, bridge_handle, terminal_handle)
}
