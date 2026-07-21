pub mod mesh;
pub mod stubs;

use crate::config::NativeConfig;
use crate::manager::NativeService;
use tokio::sync::mpsc::UnboundedSender;

/// The device's unit set in dependency order (design-02 start order:
/// mgmt is implicit → mesh-gateway → terminal → process). mesh-gateway is real
/// since C1; terminal/process remain stubs until their embed milestones.
pub fn build_units(config: &NativeConfig, ping: UnboundedSender<()>) -> Vec<Box<dyn NativeService>> {
    vec![
        Box::new(mesh::MeshUnit::new(config, ping)),
        Box::new(stubs::StubService::new("terminal", &["mesh-gateway"])),
        Box::new(stubs::StubService::new("process", &[])),
    ]
}
