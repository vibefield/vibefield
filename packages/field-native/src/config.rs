use std::path::PathBuf;

/// The terminal mesh's master switch, named once so the strip-list claim below
/// can be asserted against the string this file actually reads.
pub const TERMINAL_MESH_ENV: &str = "FIELD_NATIVE_TERMINAL_MESH";

// RETIRED 2026-09-14 (TM-3, `thinking-terminal-mesh-cells.md` §7 / TM-D3):
// `TERMINAL_MIRROR_WRITE_ENV` = `FIELD_NATIVE_TERMINAL_MIRROR_WRITE`, the
// mirror-write capability's env home, with the mint and the file it named. The
// write right is no longer a durable secret on disk that every same-uid process
// can read; it is a claim in a per-client, expiring, revocable attach grant
// (`rights: ["input", "read"]`, minted by fieldd for a WhoIs-verified self peer).
// Nothing in this process ever compared the string — the reader retired with the
// TSP1 adapter at TM-1 — and since TM-5 nothing off-device asks for it either.

/// TM-1 — what the flag asks of the mesh, and the ONLY thing it asks: are this
/// floor's terminal doors published on the tailnet?
///
/// It used to choose a SERVE SHAPE. Until 2026-09-14 `FIELD_NATIVE_TERMINAL_MESH`
/// kept the pre-cell in-process floor — one embedded ghosttea service hosting
/// every class with `ghosttea-truffle`'s TSP1 adapter borrowing the gateway's
/// node — because a cell cannot borrow that node across a process boundary. The
/// cost was cell isolation XOR the phone, and worse: with the flag set the
/// desktop deck could not open a pane at all (no route rows, no T1 doors, no
/// grant keys, so fieldd could mint no routed ticket). TM-D7 retired that path
/// whole rather than fencing it — it was the pre-TP-S3e product, not "the
/// product minus isolation". Cells now serve unconditionally, and this type
/// answers one question about them.
///
/// Two variants and no payload, and since TM-3 (2026-09-14) that is the whole
/// of it: the enum carries no capability face at all. The mirror-write secret
/// it used to point at is deleted, so "are the doors published?" is the only
/// question this type answers and the only one the hello composes from it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MeshPlan {
    /// The doors stay loopback-only: local windows reach them, the tailnet
    /// does not.
    Off,
    /// The floor was asked to publish its terminal doors on the tailnet. Asked,
    /// not achieved — publishing also needs the gateway's node to be up, which
    /// is a live fact the hello re-reads rather than a config one (TM-1's
    /// `HelloAck.terminalMesh`).
    Requested,
}

impl MeshPlan {
    pub fn resolve(config: &NativeConfig) -> Self {
        if config.terminal_mesh_enabled {
            Self::Requested
        } else {
            Self::Off
        }
    }

    pub fn is_off(&self) -> bool {
        matches!(self, Self::Off)
    }

    /// N-M4 / E-F1 — THE terminal-mesh reading, as a pure function of its two
    /// halves: was the floor asked to publish (this plan), and is a tailnet node
    /// installed right now (`MeshHandle::node_present`)?
    ///
    /// Pure and named because it has TWO callers that must never disagree — the
    /// hello ack (`state.rs`, per pairing) and the routes stream's push
    /// (`mgmt/mod.rs`, per node flip) — and because the old spelling
    /// (`!plan.is_off() && node.is_some()`, inline) had no witness for its FLAG
    /// half: both `mgmt_server.rs` rows that exercised it were false-side rows
    /// (flag off with no gateway; flag on with no gateway), so deleting the flag
    /// conjunct left the suite green. Four combinations, all four asserted
    /// below; the AND is the product law (TM-1): asked is not achieved.
    pub fn publishes(&self, node_present: bool) -> bool {
        !self.is_off() && node_present
    }
}

/// field-native configuration (design-02 §2.8). Registries default from
/// @vibefield/contracts constants; env overrides (dev):
/// FIELD_NATIVE_DATA_DIR · FIELD_NATIVE_MESH=1 · FIELD_NATIVE_SIDECAR_PATH ·
/// FIELD_NATIVE_TERMINAL_MESH=1.
#[derive(Clone, Debug)]
pub struct NativeConfig {
    pub data_dir: PathBuf,
    /// Shared application log root. `None` is reserved for embedded/unit tests
    /// that deliberately do not install a process-global tracing subscriber.
    pub log_root: Option<PathBuf>,
    /// Development/test-only target filter, admitted only by an explicit
    /// caller decision. Production defaults to INFO.
    pub log_filter: Option<String>,
    /// mesh-gateway master switch (C1: off by default until the tailnet story
    /// is wired end to end; the unit reports "disabled" honestly).
    pub mesh_enabled: bool,
    /// explicit sidecar binary path; falls back to the truffle search order.
    pub sidecar_override: Option<PathBuf>,
    /// TM-1 — the terminal floor publishes its doors on the tailnet. OFF by
    /// default. It selects no serve shape: cells serve either way (TM-D7), and
    /// this asks only whether their doors are reachable from off-device.
    ///
    /// It is a SEPARATE switch from `mesh_enabled` because the two are not the
    /// same question — one asks whether this device has a tailnet identity at
    /// all, the other whether the terminal floor publishes itself on it. The
    /// dependency runs one way: publishing needs the gateway's node, so on
    /// without the gateway publishes nothing, and the floor says so on its
    /// hello (`HelloAck.terminalMesh`) rather than degrading a PTY.
    pub terminal_mesh_enabled: bool,
    /// TC-S2 — explicit `field-terminal-host` binary path (test/dev seam,
    /// FIELD_NATIVE_CELL_BIN, the sidecar-override pattern); production falls
    /// back to the sibling of this executable — cargo and the packaged app
    /// both place the two binaries side by side.
    pub cell_bin_override: Option<PathBuf>,
    /// TC-S3 — spawn-isolation window override in ms (test seam,
    /// FIELD_NATIVE_ISOLATION_WINDOW_MS): the kill matrix cannot wait out the
    /// production five minutes to watch a class LEAVE isolation. Floor-side
    /// env is our own domain — EL7's strip discipline is about what enters
    /// CELLS, and this value never does.
    pub isolation_window_override: Option<u64>,
    /// TP-S3a — the renderer `Origin` values the cells' T1 doors admit at the
    /// HTTP upgrade (terminal-pipeline-v3 §8 door hygiene): the packaged app
    /// origin plus the dev renderer's, comma-separated in
    /// FIELD_NATIVE_ALLOWED_ORIGINS (fieldd passes its own list down at spawn —
    /// one allow-list for both doors). Empty = browser sockets are refused,
    /// non-browser sockets (no Origin) still admitted — the grant is the
    /// authority, the list is hygiene. Rides the cell bootstrap line (a
    /// non-secret), never the cell's env.
    pub allowed_origins: Vec<String>,
}

impl NativeConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let data_dir = std::env::var_os("FIELD_NATIVE_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(default_data_dir);
        let log_root = Some(resolve_log_root()?);
        let log_filter = (std::env::var("FIELD_NATIVE_ALLOW_LOG_FILTER").as_deref() == Ok("1"))
            .then(|| std::env::var("FIELD_NATIVE_LOG_FILTER").ok())
            .flatten();
        let mesh_enabled = std::env::var("FIELD_NATIVE_MESH")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        let sidecar_override = std::env::var_os("FIELD_NATIVE_SIDECAR_PATH")
            .or_else(|| std::env::var_os("TRUFFLE_SIDECAR_PATH"))
            .map(PathBuf::from);
        let terminal_mesh_enabled = std::env::var(TERMINAL_MESH_ENV)
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        let cell_bin_override = std::env::var_os("FIELD_NATIVE_CELL_BIN").map(PathBuf::from);
        let isolation_window_override = std::env::var("FIELD_NATIVE_ISOLATION_WINDOW_MS")
            .ok()
            .and_then(|value| value.trim().parse::<u64>().ok());
        let allowed_origins = std::env::var("FIELD_NATIVE_ALLOWED_ORIGINS")
            .ok()
            .map(|value| {
                value
                    .split(',')
                    .map(str::trim)
                    .filter(|origin| !origin.is_empty())
                    .map(str::to_owned)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        Ok(Self {
            data_dir,
            log_root,
            log_filter,
            mesh_enabled,
            sidecar_override,
            terminal_mesh_enabled,
            cell_bin_override,
            isolation_window_override,
            allowed_origins,
        })
    }

    /// Test/dev constructor: mesh off, no overrides.
    pub fn for_data_dir(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            log_root: None,
            log_filter: None,
            mesh_enabled: false,
            sidecar_override: None,
            terminal_mesh_enabled: false,
            cell_bin_override: None,
            isolation_window_override: None,
            allowed_origins: Vec::new(),
        }
    }

    /// Integration-test constructor that exercises the production logging
    /// lifecycle without consulting ambient process environment.
    pub fn for_data_and_log_dir(data_dir: PathBuf, log_root: PathBuf) -> Self {
        Self {
            data_dir,
            log_root: Some(log_root),
            log_filter: None,
            mesh_enabled: false,
            sidecar_override: None,
            terminal_mesh_enabled: false,
            cell_bin_override: None,
            isolation_window_override: None,
            allowed_origins: Vec::new(),
        }
    }

    pub fn native_dir(&self) -> PathBuf {
        self.join_layout(crate::registries::layout::NATIVE_DIR)
    }
    /// 0700 — sockets live here; stable paths across fieldd restarts (external-mode law).
    pub fn run_dir(&self) -> PathBuf {
        self.join_layout(crate::registries::layout::NATIVE_RUN_DIR)
    }
    /// 0600 — the D8 pairing secret, created by field-native on first boot.
    pub fn pairing_file(&self) -> PathBuf {
        self.join_layout(crate::registries::layout::PAIRING_FILE)
    }

    /// The app-owned Ghostty config overlay the terminal unit loads after the
    /// user's own Ghostty files (GT-3). It sits in the native dir, not the run
    /// dir: a user's configuration outlives a boot, and the run dir holds only
    /// what a boot creates. The segments come from the generated LAYOUT — one
    /// spelling, and this plane owns the file, so every reader asks the service
    /// where it is rather than deriving the path a second time.
    pub fn terminal_config_file(&self) -> PathBuf {
        self.join_layout(crate::registries::layout::TERMINAL_CONFIG_FILE)
    }
    pub fn mgmt_socket(&self) -> PathBuf {
        self.join_layout(crate::registries::layout::MGMT_SOCKET)
    }

    /// The MeshData bridge's byte plane (D5). A SECOND socket beside mgmt on
    /// purpose: control and bytes must not share a queue, and this one carries
    /// product data while mgmt carries decisions.
    pub fn meshdata_socket(&self) -> PathBuf {
        self.join_layout(crate::registries::layout::MESHDATA_SOCKET)
    }

    /// WIN-D1 — the endpoint-resolution law. On unix an endpoint IS the joined
    /// LAYOUT path (byte-for-byte the pre-Windows behavior); on win32 it is a
    /// named pipe carrying a scope hash of the data root (crate::endpoints,
    /// pinned by contracts' endpoint vector), because the flat pipe namespace
    /// has no run-directory boundary. `None` = the root cannot be spelled as
    /// the UTF-8 the contract requires — callers degrade honestly (the terminal
    /// unit's Endpoints comment states the same law for its pair).
    pub fn mgmt_endpoint(&self) -> Option<String> {
        self.local_endpoint(
            crate::registries::sockets::MGMT,
            crate::registries::layout::MGMT_SOCKET,
        )
    }
    pub fn meshdata_endpoint(&self) -> Option<String> {
        self.local_endpoint(
            crate::registries::sockets::MESHDATA,
            crate::registries::layout::MESHDATA_SOCKET,
        )
    }
    pub fn terminal_control_endpoint(&self) -> Option<String> {
        self.local_endpoint(
            crate::registries::sockets::TERMINAL_CONTROL,
            crate::registries::layout::TERMINAL_CONTROL_SOCKET,
        )
    }
    pub fn terminal_frame_endpoint(&self) -> Option<String> {
        self.local_endpoint(
            crate::registries::sockets::TERMINAL_FRAME,
            crate::registries::layout::TERMINAL_FRAME_SOCKET,
        )
    }

    /// TC-S2 — a cell's per-instance terminal endpoints: the SAME resolution
    /// law with the instance-suffixed file name (`endpoints::cell_socket_file`,
    /// vector-pinned). Fresh names per instance are what make a cell restart
    /// never a rebind. `None` = the same non-UTF-8 refusal as every endpoint.
    pub fn terminal_cell_control_endpoint(&self, instance: u32) -> Option<String> {
        self.local_endpoint_for_file(&crate::endpoints::cell_socket_file(
            crate::registries::sockets::TERMINAL_CONTROL,
            instance,
        ))
    }
    pub fn terminal_cell_frame_endpoint(&self, instance: u32) -> Option<String> {
        self.local_endpoint_for_file(&crate::endpoints::cell_socket_file(
            crate::registries::sockets::TERMINAL_FRAME,
            instance,
        ))
    }

    /// TC-S3 — a cell's crash-breadcrumb file (TC-D4's attribution seam): the
    /// floor passes this path to the cell via `--crumb`; the cell writes it on
    /// the way down when it can say anything, and the floor reads-and-deletes
    /// it after the wait. A run-dir artifact of one boot, floor↔cell internal —
    /// never a cross-plane contract, so the ONE spelling lives here. Unlinked
    /// before every spawn so a stale generation cannot color a fresh death.
    pub fn terminal_cell_crumb_file(&self, instance: u32) -> PathBuf {
        self.run_dir().join(format!("termcell.{instance}.crumb"))
    }

    /// TC-S3 — how long a class stays in spawn-isolation after an intensity
    /// breach with an Exact offender. The genned registry is the production
    /// authority; the override is the kill matrix's clock.
    pub fn isolation_window(&self) -> std::time::Duration {
        std::time::Duration::from_millis(
            self.isolation_window_override
                .unwrap_or(crate::registries::cell_isolation::ISOLATION_WINDOW_MS),
        )
    }

    /// TC-S2 — where `field-terminal-host` lives: the explicit override
    /// (FIELD_NATIVE_CELL_BIN — the sidecar-override pattern), else this
    /// executable's sibling. cargo and the packaged app both place the two
    /// binaries side by side; a missing sibling is the supervisor's honest
    /// degraded state, not a panic.
    pub fn cell_binary(&self) -> Option<PathBuf> {
        if let Some(explicit) = &self.cell_bin_override {
            return Some(explicit.clone());
        }
        let exe = std::env::current_exe().ok()?;
        let name = if cfg!(windows) {
            "field-terminal-host.exe"
        } else {
            "field-terminal-host"
        };
        // Sibling first (the packaged and `cargo run` layout), then one level
        // up: an EMBEDDED test's current_exe lives in target/debug/deps/ while
        // cargo puts bin targets in target/debug/ — existence-checked so the
        // supervisor's "cannot be located" detail stays honest when neither
        // holds a binary.
        let parent = exe.parent()?;
        let candidates = [parent.join(name), parent.parent()?.join(name)];
        candidates.into_iter().find(|candidate| candidate.exists())
    }

    #[cfg(windows)]
    fn local_endpoint_for_file(&self, socket_file: &str) -> Option<String> {
        let root = self.data_dir.to_str()?;
        Some(crate::endpoints::pipe_endpoint_for(root, socket_file))
    }
    #[cfg(not(windows))]
    fn local_endpoint_for_file(&self, socket_file: &str) -> Option<String> {
        self.run_dir().join(socket_file).to_str().map(str::to_owned)
    }

    #[cfg(windows)]
    fn local_endpoint(&self, socket_file: &str, _segments: &[&str]) -> Option<String> {
        let root = self.data_dir.to_str()?;
        Some(crate::endpoints::pipe_endpoint_for(root, socket_file))
    }
    #[cfg(not(windows))]
    fn local_endpoint(&self, _socket_file: &str, segments: &[&str]) -> Option<String> {
        self.join_layout(segments).to_str().map(str::to_owned)
    }
    /// truffle node state (device identity + tsnet keys) — mesh identity lives
    /// in the longer-lived plane and survives fieldd restarts (design-02 §2.4).
    pub fn mesh_state_dir(&self) -> PathBuf {
        self.join_layout(crate::registries::layout::MESH_STATE_DIR)
    }

    /// UA-D10: every path under the data root derives from the generated
    /// LAYOUT segments — this is the only join site in the native plane.
    fn join_layout(&self, segments: &[&str]) -> PathBuf {
        segments
            .iter()
            .fold(self.data_dir.clone(), |path, segment| path.join(segment))
    }
}

/// `HOME` is a unix fact — Windows has `USERPROFILE`. One resolver so no
/// default below quietly lands on `"."` (a CWD-relative data root would carry
/// the pairing secret and every endpoint to wherever the process was launched).
fn home_dir() -> PathBuf {
    #[cfg(windows)]
    let var = "USERPROFILE";
    #[cfg(not(windows))]
    let var = "HOME";
    std::env::var_os(var)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn default_data_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        home_dir().join("Library/Application Support/VibeField")
    }
    // %APPDATA% (roaming), in lockstep with fieldd's bin.ts default — the two
    // planes must hash ONE root string into ONE pipe scope (WIN-D1).
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home_dir().join("AppData/Roaming"))
            .join("VibeField")
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        home_dir().join(".local/share/VibeField")
    }
}

fn resolve_log_root() -> anyhow::Result<PathBuf> {
    if std::env::var("FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE").as_deref() == Ok("1") {
        if let Some(value) = std::env::var_os("FIELD_LOG_DIR") {
            let path = PathBuf::from(value);
            anyhow::ensure!(path.is_absolute(), "FIELD_LOG_DIR must be absolute");
            return Ok(path);
        }
    }

    let home = home_dir();
    #[cfg(target_os = "macos")]
    {
        Ok(home.join("Library/Logs/VibeField"))
    }
    #[cfg(target_os = "windows")]
    {
        Ok(std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join("AppData/Local"))
            .join("VibeField/Logs"))
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        Ok(std::env::var_os("XDG_STATE_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".local/state"))
            .join("vibefield/logs"))
    }
}

/// What this file still owns, once TM-3 (2026-09-14) deleted the mirror-write
/// mint and its six rows with it: the plan's derivation. Driven on constructed
/// configs rather than `from_env` — the process environment is shared by every
/// test in this binary, and a branch is not a variable.
#[cfg(test)]
mod tests {
    use super::*;

    /// TM-1 — the plan is a two-state answer to ONE question, and `Off` is the
    /// default. It used to select a serve shape; the row that asserted that is
    /// gone with the shape (`tests/terminal_mesh.rs`, deleted), and what is
    /// left is the derivation this file owns.
    #[test]
    fn the_plan_is_off_unless_the_flag_asks_for_the_tailnet_door() {
        let mut config = NativeConfig::for_data_dir(std::path::PathBuf::from("/tmp/vf-plan"));
        assert_eq!(MeshPlan::resolve(&config), MeshPlan::Off);
        assert!(MeshPlan::resolve(&config).is_off());

        config.terminal_mesh_enabled = true;
        assert_eq!(MeshPlan::resolve(&config), MeshPlan::Requested);
        assert!(!MeshPlan::resolve(&config).is_off());
    }
}
