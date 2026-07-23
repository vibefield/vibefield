// field-native — the Rust native-plane daemon (design-02 §2).
// `contracts` is typify-generated from @vibefield/contracts gen/jsonschema/bundle.json
// (regenerate: `pnpm --filter @vibefield/contracts gen:rust`); golden fixtures pin it.
pub mod config;
pub mod contracts;
pub mod logging;
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
    health_refresh: tokio::task::JoinHandle<()>,
    manager: Arc<manager::NativeServiceManager>,
    logging: Option<logging::NativeLogging>,
}

impl RunningDaemon {
    pub async fn shutdown(self) {
        tracing::info!(
            event = "field_native.lifecycle.stopping",
            component = "lifecycle",
            "field-native is stopping"
        );
        self.server.abort();
        self.health_refresh.abort();
        self.manager.stop_all().await;
        tracing::info!(
            event = "field_native.lifecycle.stopped",
            component = "lifecycle",
            "field-native stopped"
        );
        if let Some(logging) = self.logging {
            let _ = logging.close(std::time::Duration::from_secs(2));
        }
    }
}

/// Boot (design-02 §2.8): config → pairing → manager start → bind mgmt → ready.
pub async fn bootstrap(config: config::NativeConfig) -> Result<RunningDaemon> {
    bootstrap_with_logging(config, logging::new_boot_id(), None).await
}

/// Production boot after the process-owned writer and tracing subscriber have
/// been installed by main. Tests use `bootstrap` to avoid competing global
/// subscribers inside one test process.
pub async fn bootstrap_with_logging(
    config: config::NativeConfig,
    boot_id: String,
    logging: Option<logging::NativeLogging>,
) -> Result<RunningDaemon> {
    tracing::info!(
        event = "field_native.lifecycle.boot_started",
        component = "bootstrap",
        "field-native boot started"
    );
    let run_dir = config.run_dir();
    fs::create_dir_all(&run_dir).with_context(|| format!("create {}", run_dir.display()))?;
    fs::set_permissions(&run_dir, fs::Permissions::from_mode(0o700))?;

    let secret = pairing::load_or_create_secret(&config.pairing_file())?;

    // units push health transitions (e.g. mesh auth flow) via this channel;
    // a refresh task re-aggregates and publishes on every ping
    let (ping_tx, mut ping_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    let (units, mesh_handle) = services::build_units(&config, ping_tx);
    let mgr = Arc::new(manager::NativeServiceManager::new(units)?);
    mgr.start_all().await;
    let health = mgr.health(&boot_id);

    let observed = contracts::ObservedState {
        generation: 0,
        boot_id: boot_id.clone(),
        terminals: vec![],
        workers: vec![],
    };

    let state = state::DaemonState::new(
        boot_id.clone(),
        secret,
        health,
        observed,
        mesh_handle,
        logging.clone(),
    );

    let health_refresh = tokio::spawn({
        let mgr = mgr.clone();
        let state = state.clone();
        let boot_id = boot_id.clone();
        async move {
            while ping_rx.recv().await.is_some() {
                while ping_rx.try_recv().is_ok() {} // coalesce bursts
                let _ = state.health_tx.send(mgr.health(&boot_id));
            }
        }
    });

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
        health_refresh,
        manager: mgr,
        logging,
    })
}
