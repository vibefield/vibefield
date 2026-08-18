// field-native — the Rust native-plane daemon (design-02 §2).
// `contracts` is typify-generated from @vibefield/contracts gen/jsonschema/bundle.json
// (regenerate: `pnpm --filter @vibefield/contracts gen:rust`); golden fixtures pin it.
/// TC-L1f — the machine-wide custody admission ledger.
pub mod admission;
pub mod cell;
pub mod config;
pub mod contracts;
pub mod endpoints;
pub mod local_ipc;
pub mod logging;
pub mod manager;
pub mod mgmt;
pub mod pairing;
/// GENERATED (NF-D9) — registries-as-code from @vibefield/contracts; `pnpm gen`.
pub mod registries;
/// TC-D6(b)/(e) — refusal classification and descriptor-pressure gauging.
pub mod resource_pressure;
/// TC-D6(a) — the descriptor-limit raise every boot owes itself.
pub mod rlimit;
pub mod services;
pub mod state;

use anyhow::{Context, Result};
use std::fs;
use std::sync::Arc;

pub struct RunningDaemon {
    /// The mgmt channel's endpoint under the WIN-D1 law: a socket path on
    /// unix, a `\\.\pipe\` name on windows. A String, not a PathBuf — a pipe
    /// name is an endpoint, never a filesystem path.
    pub mgmt_endpoint: String,
    /// D5's byte plane. Exposed for tests and for the C6-3 transport install.
    pub meshdata_endpoint: String,
    /// The 0600 pairing-secret file (WIN-D1: exposed so tests forge a hello MAC
    /// from the SECRET the daemon actually loaded, rather than reverse-deriving
    /// its path from the mgmt endpoint — which the socket-vs-pipe split makes
    /// impossible, a pipe name has no relationship to the data dir on disk).
    pub pairing_file: std::path::PathBuf,
    pub bridge: services::mesh_bridge::BridgeHandle,
    pub boot_id: String,
    pub state: Arc<state::DaemonState>,
    server: tokio::task::JoinHandle<()>,
    health_refresh: tokio::task::JoinHandle<()>,
    /// C6-3: parked until the mesh node exists, then the remote leg + inbound
    /// accept loop. Held so shutdown can abort it — with the mesh disabled it
    /// simply never fires.
    lane_transport: tokio::task::JoinHandle<()>,
    /// NF-2: parked until the terminal service serves, then the self-client's
    /// `observed.terminals` pump. Held so shutdown can abort it before the
    /// drain runs.
    terminal_inventory: tokio::task::JoinHandle<()>,
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
        self.lane_transport.abort();
        // Before stop_all: the terminal unit's G7 drain is the authority on the
        // session registry from here on, and a pump still reconciling would
        // only publish inventory nobody is subscribed to any more.
        self.terminal_inventory.abort();
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
    // The 0700 run dir is the unix boundary around every socket and run file.
    // WIN-D4: windows has no mode bits to set — the boundary there is the
    // profile's inherited ACLs plus the per-pipe CurrentUserOnly DACL that
    // rides every bind (local_ipc); an explicit directory DACL is recorded
    // hardening, not silently skipped protection.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&run_dir, fs::Permissions::from_mode(0o700))?;
    }

    let pairing_file = config.pairing_file();
    let secret = pairing::load_or_create_secret(&pairing_file)?;

    // units push health transitions (e.g. mesh auth flow) via this channel;
    // a refresh task re-aggregates and publishes on every ping
    let (ping_tx, mut ping_rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    let (units, mesh_handle, bridge_handle, terminal_handle) =
        services::build_units(&config, secret, ping_tx);
    let mgr = Arc::new(manager::NativeServiceManager::new(units)?);
    mgr.start_all().await;
    let health = mgr.health(&boot_id);

    // C6-3: joining the mesh unit to the byte plane is WIRING, so it happens
    // here rather than inside either of them. The bridge never learns what a
    // QUIC stream is; the mesh unit never learns what a lane is.
    let lane_transport = services::lane_transport::install_when_ready(
        mesh_handle.clone(),
        bridge_handle.clone(),
        services::lane_transport::DOC_SYNC_QUIC_PORT,
    );

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
        bridge_handle.clone(),
        // TC-D15: the route snapshot watch — wiring, same law as the endpoint
        // and inventory lines below (the mgmt plane reads state; the unit
        // supervises cells; neither learns the other's job).
        terminal_handle.routes_rx(),
        logging.clone(),
    );

    // NF-D8/§4.3: the endpoints reach fieldd through the pairing hello, and the
    // unit's inventory reaches it through the observed watch channel. Both are
    // WIRING — done here so the unit stays ignorant of the mgmt plane and the
    // mgmt facade stays ignorant of the terminal control protocol.
    if let Some(endpoints) = terminal_handle.endpoints() {
        let _ = state.terminal.set(endpoints);
    }
    // TC-L1f: resolving the machine-wide ledger is WIRING for the same reason
    // the two lines above are — the unit must not learn how a data root becomes
    // a machine root, and the ledger must not learn what a session is. `None`
    // means this platform has no honest budget to keep (win32), and the pump
    // then runs with the kernel as the only admission authority.
    let admission = admission::AdmissionLedger::resolve(&config.data_dir, &boot_id);
    let terminal_inventory =
        services::terminal::install_inventory(terminal_handle, state.clone(), admission);

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

    let mgmt_endpoint = config
        .mgmt_endpoint()
        .context("data root is not valid UTF-8, which the endpoint contract requires")?;
    let meshdata_endpoint = config
        .meshdata_endpoint()
        .context("data root is not valid UTF-8, which the endpoint contract requires")?;
    // replace-stale-then-bind rides local_ipc (unlink on unix; windows adds the
    // squat guard + CurrentUserOnly DACL through ghosttea's listener)
    let listener =
        local_ipc::bind(&mgmt_endpoint).with_context(|| format!("bind {mgmt_endpoint}"))?;

    let server = tokio::spawn(mgmt::serve(listener, state.clone()));

    Ok(RunningDaemon {
        meshdata_endpoint,
        pairing_file,
        bridge: bridge_handle,
        mgmt_endpoint,
        boot_id,
        state,
        server,
        health_refresh,
        lane_transport,
        terminal_inventory,
        manager: mgr,
        logging,
    })
}
