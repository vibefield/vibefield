//! MeshUnit (C1 spike) — truffle-core embedded as this device's single tailnet
//! identity (design-02 §2.1 MeshGateway; v0.5 law: truffle lives ONLY here).
//!
//! Lifecycle honesty over the M2 health shape:
//!   disabled              — mesh off by config (the default until C2 wires the facade)
//!   starting              — background node bring-up (truffle's build() blocks
//!                           until the tailnet is Running, so it runs spawned)
//!   starting + authUrl    — sidecar wants a browser login; URL surfaced verbatim
//!   up                    — node online; detail = tailnet DNS name
//!   degraded              — sidecar missing / bring-up failed (daemon stays up)
//!
//! The sidecar binary is truffle's Go child process. Resolution mirrors
//! truffle-sidecar's runtime order WITHOUT its build-time downloader (a network
//! fetch inside `cargo build` would poison every offline/CI build): explicit
//! env override, then the well-known install locations. Packaging (P2) bundles
//! the sidecar next to field-native, which the exe-adjacent probe picks up.

use crate::config::NativeConfig;
use crate::contracts::{UnitHealth, UnitState};
use crate::manager::NativeService;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc::UnboundedSender;
use truffle_core::{network::tailscale::TailscaleProvider, Node};

/// = @vibefield/contracts registries APP_ID (one tailnet app namespace per product).
const APP_ID: &str = "vibefield";
const SIDECAR_NAMES: [&str; 2] = ["sidecar-slim", "truffle-sidecar"];

type MeshNode = Node<TailscaleProvider>;

struct Shared {
    health: Mutex<UnitHealth>,
    node: tokio::sync::Mutex<Option<Arc<MeshNode>>>,
    /// pokes the daemon's health-refresh task (lib.rs) after every transition
    ping: UnboundedSender<()>,
}

impl Shared {
    fn set(&self, state: UnitState, detail: Option<String>, auth_url: Option<String>) {
        *self.health.lock().unwrap() = UnitHealth {
            unit: "mesh-gateway".into(),
            state,
            detail,
            auth_url,
        };
        let _ = self.ping.send(());
    }
}

pub struct MeshUnit {
    enabled: bool,
    sidecar: Option<PathBuf>,
    searched: Vec<String>,
    state_dir: PathBuf,
    shared: Arc<Shared>,
    task: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl MeshUnit {
    pub fn new(config: &NativeConfig, ping: UnboundedSender<()>) -> Self {
        let mut searched = Vec::new();
        let sidecar = resolve_sidecar(config.sidecar_override.clone(), &mut searched);
        Self {
            enabled: config.mesh_enabled,
            sidecar,
            searched,
            state_dir: config.mesh_state_dir(),
            shared: Arc::new(Shared {
                health: Mutex::new(UnitHealth {
                    unit: "mesh-gateway".into(),
                    state: UnitState::Starting,
                    detail: None,
                    auth_url: None,
                }),
                node: tokio::sync::Mutex::new(None),
                ping,
            }),
            task: Mutex::new(None),
        }
    }

    /// The live node, once up (C2 facade calls go through this).
    pub async fn node(&self) -> Option<Arc<MeshNode>> {
        self.shared.node.lock().await.clone()
    }
}

#[async_trait::async_trait]
impl NativeService for MeshUnit {
    fn id(&self) -> &'static str {
        "mesh-gateway"
    }

    async fn start(&self) -> anyhow::Result<()> {
        if !self.enabled {
            self.shared.set(
                UnitState::Disabled,
                Some("disabled (FIELD_NATIVE_MESH=1 to enable)".into()),
                None,
            );
            return Ok(());
        }
        let Some(sidecar) = self.sidecar.clone() else {
            self.shared.set(
                UnitState::Degraded,
                Some(format!(
                    "tailscale sidecar not found (searched: {}); set FIELD_NATIVE_SIDECAR_PATH",
                    self.searched.join(", ")
                )),
                None,
            );
            return Ok(()); // degraded, not fatal — the daemon keeps serving
        };
        std::fs::create_dir_all(&self.state_dir)?;
        self.shared
            .set(UnitState::Starting, Some("bringing up tailnet node".into()), None);

        let shared = self.shared.clone();
        let state_dir = self.state_dir.to_string_lossy().into_owned();
        let handle = tokio::spawn(async move {
            let auth_shared = shared.clone();
            let built = async {
                Node::<TailscaleProvider>::builder()
                    .app_id(APP_ID)
                    .map_err(|e| anyhow::anyhow!("app_id: {e}"))?
                    .sidecar_path(&sidecar)
                    .state_dir(&state_dir)
                    .build_with_auth_handler(move |url| {
                        tracing::info!(url = %url, "mesh auth required");
                        auth_shared.set(
                            UnitState::Starting,
                            Some("tailnet login required".into()),
                            Some(url),
                        );
                    })
                    .await
                    .map_err(|e| anyhow::anyhow!("node build: {e}"))
            }
            .await;
            match built {
                Ok(node) => {
                    let node = Arc::new(node);
                    let info = node.local_info();
                    let name = info
                        .dns_name
                        .clone()
                        .unwrap_or_else(|| info.tailscale_hostname.clone());
                    *shared.node.lock().await = Some(node);
                    shared.set(UnitState::Up, Some(format!("tailnet {name}")), None);
                    tracing::info!(name = %name, "mesh node up");
                }
                Err(e) => {
                    tracing::error!(error = %e, "mesh bring-up failed");
                    shared.set(UnitState::Degraded, Some(format!("bring-up failed: {e}")), None);
                }
            }
        });
        *self.task.lock().unwrap() = Some(handle);
        Ok(())
    }

    fn health(&self) -> UnitHealth {
        self.shared.health.lock().unwrap().clone()
    }

    async fn stop(&self) -> anyhow::Result<()> {
        if let Some(t) = self.task.lock().unwrap().take() {
            t.abort(); // in-flight bring-up: sidecar child is kill_on_drop
        }
        *self.shared.node.lock().await = None; // dropping the Node kills the sidecar
        Ok(())
    }
}

/// truffle-sidecar's runtime search order, minus the build-time downloader.
/// An explicit override is AUTHORITATIVE: no silent fallback when it's wrong —
/// that would mask config errors with whatever install happens to be lying around.
fn resolve_sidecar(override_path: Option<PathBuf>, searched: &mut Vec<String>) -> Option<PathBuf> {
    if let Some(p) = override_path {
        searched.push(p.display().to_string());
        return p.is_file().then_some(p);
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in SIDECAR_NAMES {
                candidates.push(dir.join(name));
            }
        }
    }
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        #[cfg(target_os = "macos")]
        for name in SIDECAR_NAMES {
            candidates.push(home.join("Library/Application Support/truffle/bin").join(name));
        }
        for name in SIDECAR_NAMES {
            candidates.push(home.join(".config/truffle/bin").join(name));
        }
    }
    for name in SIDECAR_NAMES {
        candidates.push(PathBuf::from("/usr/local/bin").join(name));
    }
    for c in candidates {
        searched.push(c.display().to_string());
        if c.is_file() {
            return Some(c);
        }
    }
    None
}
