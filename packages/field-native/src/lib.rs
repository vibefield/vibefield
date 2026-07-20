// field-native — the Rust native-plane daemon (design-02 §2).
// `contracts` is typify-generated from @vibefield/contracts gen/jsonschema/bundle.json
// (regenerate: `pnpm --filter @vibefield/contracts gen:rust`); golden fixtures pin it.
pub mod config;
pub mod contracts;
pub mod manager;
pub mod mgmt;
pub mod pairing;
pub mod services;
pub mod state;

use anyhow::{Context, Result};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::net::UnixListener;

pub struct RunningDaemon {
    pub mgmt_socket: PathBuf,
    pub boot_id: String,
    pub state: Arc<state::DaemonState>,
    server: tokio::task::JoinHandle<()>,
    manager: manager::NativeServiceManager,
}

impl RunningDaemon {
    pub async fn shutdown(mut self) {
        self.server.abort();
        self.manager.stop_all().await;
    }
}

/// Boot (design-02 §2.8): config → pairing → manager start → bind mgmt → ready.
pub async fn bootstrap(config: config::NativeConfig) -> Result<RunningDaemon> {
    let run_dir = config.run_dir();
    fs::create_dir_all(&run_dir).with_context(|| format!("create {}", run_dir.display()))?;
    fs::set_permissions(&run_dir, fs::Permissions::from_mode(0o700))?;

    let secret = pairing::load_or_create_secret(&config.pairing_file())?;

    let mut boot_bytes = [0u8; 16];
    rand::fill(&mut boot_bytes);
    let boot_id = hex::encode(boot_bytes);

    let mut mgr = manager::NativeServiceManager::new(services::stubs::default_stubs())?;
    mgr.start_all().await;
    let health = mgr.health(&boot_id);

    let observed = contracts::ObservedState {
        generation: 0,
        boot_id: boot_id.clone(),
        terminals: vec![],
        workers: vec![],
    };

    let state = state::DaemonState::new(boot_id.clone(), secret, health, observed);

    let socket_path = config.mgmt_socket();
    if socket_path.exists() {
        fs::remove_file(&socket_path)?; // unlink-stale-then-bind
    }
    let listener = UnixListener::bind(&socket_path)
        .with_context(|| format!("bind {}", socket_path.display()))?;

    let server = tokio::spawn(mgmt::serve(listener, state.clone()));

    Ok(RunningDaemon {
        mgmt_socket: socket_path,
        boot_id,
        state,
        server,
        manager: mgr,
    })
}
