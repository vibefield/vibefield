//! NativeServiceManager (design-02 §2.2): ordered start, aggregated health,
//! ordered stop. Restart policy v1: NO in-process service restarts — a failed
//! critical service flips global health to degraded with the unit named;
//! fieldd decides (surface vs restart the daemon). Keep it boring.
//!
//! Shared by-Arc since C1: units push health transitions asynchronously (mesh
//! auth flow), so a background task recomputes `health()` on demand — all
//! methods take `&self` (interior mutability on the failure list).

use crate::contracts::{NativeHealth, NativeHealthState, UnitHealth, UnitState};
use std::sync::Mutex;

#[async_trait::async_trait]
pub trait NativeService: Send + Sync {
    fn id(&self) -> &'static str;
    fn dependencies(&self) -> &'static [&'static str] {
        &[]
    }
    async fn start(&self) -> anyhow::Result<()>;
    fn health(&self) -> UnitHealth;
    async fn stop(&self) -> anyhow::Result<()>;
}

pub struct NativeServiceManager {
    services: Vec<Box<dyn NativeService>>,
    failed: Mutex<Vec<(&'static str, String)>>,
}

impl NativeServiceManager {
    pub fn new(services: Vec<Box<dyn NativeService>>) -> anyhow::Result<Self> {
        // registration order must already satisfy dependencies (checked, not sorted — boring on purpose)
        let mut seen: Vec<&str> = Vec::new();
        for s in &services {
            for dep in s.dependencies() {
                anyhow::ensure!(
                    seen.contains(dep),
                    "service {} depends on {} which is not registered before it",
                    s.id(),
                    dep
                );
            }
            seen.push(s.id());
        }
        Ok(Self { services, failed: Mutex::new(Vec::new()) })
    }

    pub async fn start_all(&self) {
        for s in &self.services {
            if let Err(e) = s.start().await {
                tracing::error!(unit = s.id(), error = %e, "service failed to start");
                self.failed.lock().unwrap().push((s.id(), e.to_string()));
            } else {
                tracing::info!(unit = s.id(), "started");
            }
        }
    }

    pub async fn stop_all(&self) {
        for s in self.services.iter().rev() {
            if let Err(e) = s.stop().await {
                tracing::warn!(unit = s.id(), error = %e, "service stop error");
            }
        }
    }

    /// Aggregate health (mgmt unit included by the caller).
    pub fn health(&self, boot_id: &str) -> NativeHealth {
        let failed = self.failed.lock().unwrap();
        let mut units: Vec<UnitHealth> = vec![UnitHealth {
            unit: "mgmt".into(),
            state: UnitState::Up,
            detail: None,
            auth_url: None,
        }];
        for s in &self.services {
            let mut h = s.health();
            if let Some((_, err)) = failed.iter().find(|(id, _)| *id == s.id()) {
                h.state = UnitState::Crashed;
                h.detail = Some(err.clone());
            }
            units.push(h);
        }
        let state = if units
            .iter()
            .any(|u| matches!(u.state, UnitState::Crashed | UnitState::Degraded))
        {
            NativeHealthState::Degraded
        } else if units.iter().any(|u| matches!(u.state, UnitState::Starting)) {
            NativeHealthState::Starting
        } else {
            NativeHealthState::Up
        };
        NativeHealth {
            state,
            boot_id: boot_id.to_string(),
            units,
        }
    }
}
