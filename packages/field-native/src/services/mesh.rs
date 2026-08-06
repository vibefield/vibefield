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
//! env override, then the well-known install locations. AH-1b packages the
//! exact platform sidecar release next to field-native, which the
//! executable-adjacent probe picks up first.

use crate::config::NativeConfig;
use crate::contracts::{UnitHealth, UnitState};
use crate::manager::NativeService;
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc::UnboundedSender;
use tokio::sync::watch;
use truffle_core::synced_store::SyncedStore;
use truffle_core::{network::tailscale::TailscaleProvider, Node};

/// = @vibefield/contracts registries APP_ID (one tailnet app namespace per product).
const APP_ID: &str = "vibefield";
const SIDECAR_NAMES: [&str; 2] = ["sidecar-slim", "truffle-sidecar"];

pub type MeshNode = Node<TailscaleProvider>;
pub type JsonStore = SyncedStore<Value>;

struct Shared {
    health: Mutex<UnitHealth>,
    /// A WATCH and not a mutex: bring-up is asynchronous, so consumers that
    /// cannot start until the node exists (C6-3's lane transport) need to be
    /// woken rather than to poll. `borrow()` still answers "is it up yet?"
    /// synchronously, which is what the mgmt facade asks.
    node: watch::Sender<Option<Arc<MeshNode>>>,
    /// pokes the daemon's health-refresh task (lib.rs) after every transition
    ping: UnboundedSender<()>,
    /// facade state (C2): open stores + declared serves (config JSON kept for list)
    stores: tokio::sync::Mutex<HashMap<String, Arc<JsonStore>>>,
    serves: tokio::sync::Mutex<HashMap<String, Value>>,
    /// truffle state root (identity + keys) — lives on Shared so the mgmt
    /// facade can retire it even when no node ever came up (UA-3 unlink).
    state_dir: PathBuf,
    /// UA-3 — set by retire(); the bring-up task checks it before installing
    /// a node, so a login completing AFTER an unlink cannot resurrect the
    /// identity the user just archived.
    retired: std::sync::atomic::AtomicBool,
}

/// Cloneable door to the mesh for the mgmt server (design-02: fieldd consumes
/// mesh-as-a-service; this handle is the in-process seam it lands on).
#[derive(Clone)]
pub struct MeshHandle {
    shared: Arc<Shared>,
}

impl MeshHandle {
    pub fn node(&self) -> Option<Arc<MeshNode>> {
        self.shared.node.borrow().clone()
    }

    /// The gateway's own health, for a consumer that must decide whether
    /// waiting for a node is still worth doing (GT-4a's terminal mesh). A
    /// `disabled`/`degraded` gateway will never produce one, and its `detail`
    /// is the reason — so a borrower reports the gateway's words rather than
    /// inventing its own account of a failure it did not see.
    pub fn health(&self) -> UnitHealth {
        self.shared.health.lock().unwrap().clone()
    }

    /// Park until the node exists, then hand it over. Never resolves while the
    /// mesh is disabled or degraded — which is the honest answer, not a hang to
    /// paper over: there is no node to give, and a caller that needs one has
    /// nothing to do until there is. Callers spawn this and are aborted at
    /// shutdown.
    pub async fn wait_for_node(&self) -> Arc<MeshNode> {
        let mut rx = self.shared.node.subscribe();
        loop {
            if let Some(node) = rx.borrow_and_update().clone() {
                return node;
            }
            if rx.changed().await.is_err() {
                // The unit is gone; there will never be a node. Park forever
                // rather than return a lie — the task is aborted on shutdown.
                std::future::pending::<()>().await;
            }
        }
    }

    /// Get-or-create a JSON synced store, file-backed under the node's state dir.
    pub async fn open_store(&self, node: &Arc<MeshNode>, store_id: &str) -> Arc<JsonStore> {
        let mut stores = self.shared.stores.lock().await;
        if let Some(s) = stores.get(store_id) {
            return s.clone();
        }
        let backend = Arc::new(truffle_core::synced_store::FileBackend::new(
            node.state_dir().join("synced_store"),
        ));
        let store = node.synced_store_with_backend::<Value>(store_id, backend);
        stores.insert(store_id.to_string(), store.clone());
        store
    }

    pub async fn record_serve(&self, name: &str, config: Value) {
        self.shared
            .serves
            .lock()
            .await
            .insert(name.to_string(), config);
    }
    pub async fn forget_serve(&self, name: &str) {
        self.shared.serves.lock().await.remove(name);
    }
    pub async fn serve_config(&self, name: &str) -> Option<Value> {
        self.shared.serves.lock().await.get(name).cloned()
    }

    /// UA-3 unlink, native half: drop the node (the sidecar dies with it),
    /// clear the facade's node-bound state, mark the unit retired so a
    /// mid-flight bring-up cannot resurrect the identity, and hand back the
    /// state dir to archive — Some only when there is state on disk. The
    /// caller (the mgmt handler) owns the rename; this owns the lifecycle.
    pub async fn retire(&self) -> Option<PathBuf> {
        self.shared
            .retired
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let old = self.shared.node.send_replace(None);
        self.shared.stores.lock().await.clear();
        self.shared.serves.lock().await.clear();
        drop(old); // node drop kills the sidecar (kill_on_drop)
        self.shared.set(
            UnitState::Disabled,
            Some("retired — relink to mint a new tailnet identity".into()),
            None,
        );
        let dir = self.shared.state_dir.clone();
        dir.exists().then_some(dir)
    }
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
            shared: Arc::new(Shared {
                health: Mutex::new(UnitHealth {
                    unit: "mesh-gateway".into(),
                    state: UnitState::Starting,
                    detail: None,
                    auth_url: None,
                }),
                node: watch::channel(None).0,
                ping,
                stores: tokio::sync::Mutex::new(HashMap::new()),
                serves: tokio::sync::Mutex::new(HashMap::new()),
                state_dir: config.mesh_state_dir(),
                retired: std::sync::atomic::AtomicBool::new(false),
            }),
            task: Mutex::new(None),
        }
    }

    /// The mgmt server's door to the mesh (C2 facade).
    pub fn handle(&self) -> MeshHandle {
        MeshHandle {
            shared: self.shared.clone(),
        }
    }

    /// The live node, once up (C2 facade calls go through this).
    pub fn node(&self) -> Option<Arc<MeshNode>> {
        self.shared.node.borrow().clone()
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
        std::fs::create_dir_all(&self.shared.state_dir)?;
        self.shared.set(
            UnitState::Starting,
            Some("bringing up tailnet node".into()),
            None,
        );

        let shared = self.shared.clone();
        let state_dir = self.shared.state_dir.to_string_lossy().into_owned();
        let handle = tokio::spawn(async move {
            let auth_shared = shared.clone();
            let built = async {
                Node::<TailscaleProvider>::builder()
                    .app_id(APP_ID)
                    .map_err(|e| anyhow::anyhow!("app_id: {e}"))?
                    .sidecar_path(&sidecar)
                    .state_dir(&state_dir)
                    .build_with_auth_handler(move |url| {
                        tracing::info!(
                            event = "field_native.mesh.authentication_required",
                            component = "mesh",
                            auth_url_present = true,
                            "Mesh authentication is required"
                        );
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
                    if shared.retired.load(std::sync::atomic::Ordering::SeqCst) {
                        // UA-3: retired mid-bring-up — never resurrect an
                        // identity the user just archived; dropping the node
                        // kills the sidecar and the retired face stands.
                        tracing::info!(
                            event = "field_native.mesh.bring_up_discarded",
                            component = "mesh",
                            "Mesh bring-up completed after retire; node discarded"
                        );
                        return;
                    }
                    let node = Arc::new(node);
                    let info = node.local_info();
                    let name = info
                        .dns_name
                        .clone()
                        .unwrap_or_else(|| info.tailscale_hostname.clone());
                    shared.node.send_replace(Some(node));
                    shared.set(UnitState::Up, Some(format!("tailnet {name}")), None);
                    tracing::info!(
                        event = "field_native.mesh.node_ready",
                        component = "mesh",
                        node_name = %name,
                        "The mesh node is ready"
                    );
                }
                Err(e) => {
                    tracing::error!(
                        event = "field_native.mesh.bring_up_failed",
                        component = "mesh",
                        error = %e,
                        "Mesh bring-up failed"
                    );
                    shared.set(
                        UnitState::Degraded,
                        Some(format!("bring-up failed: {e}")),
                        None,
                    );
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
        self.shared.node.send_replace(None); // dropping the Node kills the sidecar
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
            candidates.push(
                home.join("Library/Application Support/truffle/bin")
                    .join(name),
            );
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

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;

    // UA-3 — the retire lifecycle at the handle seam: state-dir custody and
    // the resurrection guard. The archive RENAME belongs to the mgmt handler
    // and the live sidecar path to the #[ignore]d probes.

    #[tokio::test]
    async fn retire_hands_back_nothing_when_no_state_exists() {
        let dir = tempfile::tempdir().unwrap();
        let config = crate::config::NativeConfig::for_data_dir(dir.path().to_path_buf());
        let (ping, _rx) = mpsc::unbounded_channel();
        let unit = MeshUnit::new(&config, ping);
        let handle = unit.handle();
        assert!(handle.retire().await.is_none());
        let health = unit.shared.health.lock().unwrap().clone();
        assert!(matches!(health.state, UnitState::Disabled));
        assert!(health.detail.unwrap_or_default().contains("retired"));
    }

    #[tokio::test]
    async fn retire_hands_back_an_existing_state_dir_and_blocks_resurrection() {
        let dir = tempfile::tempdir().unwrap();
        let config = crate::config::NativeConfig::for_data_dir(dir.path().to_path_buf());
        std::fs::create_dir_all(config.mesh_state_dir()).unwrap();
        let (ping, _rx) = mpsc::unbounded_channel();
        let unit = MeshUnit::new(&config, ping);
        let handle = unit.handle();
        let handed = handle
            .retire()
            .await
            .expect("existing state dir handed back");
        assert_eq!(handed, config.mesh_state_dir());
        // the retired flag stands — a bring-up finishing AFTER an unlink must
        // never install a node over the archived identity
        assert!(unit
            .shared
            .retired
            .load(std::sync::atomic::Ordering::SeqCst));
    }
}
