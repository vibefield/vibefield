//! P0-skeleton placeholders for the real units (design-02 start order:
//! mgmt-server → mesh-gateway → terminal → mesh-bridge → process). Each reports
//! honestly as a stub; the real embeddings (ghosttea TerminalService, truffle
//! MeshGateway) replace these in the next milestones.

use crate::contracts::{UnitHealth, UnitState};
use crate::manager::NativeService;

pub struct StubService {
    id: &'static str,
    deps: &'static [&'static str],
}

impl StubService {
    pub fn new(id: &'static str, deps: &'static [&'static str]) -> Self {
        Self { id, deps }
    }
}

#[async_trait::async_trait]
impl NativeService for StubService {
    fn id(&self) -> &'static str {
        self.id
    }
    fn dependencies(&self) -> &'static [&'static str] {
        self.deps
    }
    async fn start(&self) -> anyhow::Result<()> {
        Ok(())
    }
    fn health(&self) -> UnitHealth {
        UnitHealth {
            unit: self.id.to_string(),
            state: UnitState::Up,
            detail: Some("stub (P0 skeleton)".into()),
            auth_url: None,
        }
    }
    async fn stop(&self) -> anyhow::Result<()> {
        Ok(())
    }
}

pub fn default_stubs() -> Vec<Box<dyn NativeService>> {
    vec![
        Box::new(StubService::new("mesh-gateway", &[])),
        Box::new(StubService::new("terminal", &["mesh-gateway"])),
        Box::new(StubService::new("process", &[])),
    ]
}
