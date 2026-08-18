use std::path::PathBuf;

/// GT-4a's master switch, named once so the strip-list claim below can be
/// asserted against the string this file actually reads.
pub const TERMINAL_MESH_ENV: &str = "FIELD_NATIVE_TERMINAL_MESH";

/// The mirror-write capability's home. Deliberately `FIELD_`-prefixed: EL7's
/// strip list is prefix-based (`registries::ENV_PREFIXES`), so naming the
/// variable inside that class is what keeps it out of every agent PTY —
/// `tests/terminal_mesh.rs` binds the two together so a rename cannot quietly
/// move the secret outside the class.
pub const TERMINAL_MIRROR_WRITE_ENV: &str = "FIELD_NATIVE_TERMINAL_MIRROR_WRITE";

/// field-native configuration (design-02 §2.8). Registries default from
/// @vibefield/contracts constants; env overrides (dev):
/// FIELD_NATIVE_DATA_DIR · FIELD_NATIVE_MESH=1 · FIELD_NATIVE_SIDECAR_PATH ·
/// FIELD_NATIVE_TERMINAL_MESH=1 · FIELD_NATIVE_TERMINAL_MIRROR_WRITE.
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
    /// GT-D7/NF-remote §7 — the terminal floor serves the TSP1 mesh. OFF by
    /// default, and off means absent: nothing from `ghosttea-truffle` is
    /// constructed, no advertisement store is opened, no listener exists.
    ///
    /// It is a SEPARATE switch from `mesh_enabled` because the two are not the
    /// same question — one asks whether this device has a tailnet identity at
    /// all, the other whether the terminal floor publishes itself on it. The
    /// dependency runs one way: the terminal mesh borrows the gateway's node,
    /// so on without the gateway is a degraded state carrying the gateway's own
    /// reason, never a panic and never a second node.
    pub terminal_mesh_enabled: bool,
    /// Mirror-write v1 (GT-D7): the single string a remote viewer must present
    /// to gain WRITE on a mirrored session. `None` — the default — means every
    /// peer is view-only. Per-device scoped tokens are the named upgrade
    /// (design-00 §4.8).
    ///
    /// EL7, twice over: it is `FIELD_`-prefixed, so it rides
    /// `registries::ENV_PREFIXES` into ghosttea's strip list and cannot reach an
    /// agent PTY even in inherit mode; and it is never logged — the log records
    /// only whether one is configured. The value travels as an opaque string
    /// rather than anything we compare here, because upstream owns the compare.
    ///
    /// That compare is constant-time in its CONTENTS and not in its length:
    /// `TruffleTerminalConfig::access_for` (ghosttea-truffle 0.9.2 lib.rs:3962-3979)
    /// tests `expected.len() == supplied.len()` before reaching `subtle::ct_eq`,
    /// so a peer that may attach repeatedly can learn how long this string is —
    /// it cannot learn a byte of it. Length is the one fact the timing leaks, and
    /// a capability worth guessing at is long enough for that to buy nothing;
    /// per-device scoped tokens retire the question along with the shared secret.
    pub terminal_mirror_write: Option<String>,
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
        // Trimmed and emptiness-checked: an exported-but-empty variable is a
        // shell accident, and reading it as "the capability is the empty
        // string" would hand write access to any viewer that supplies nothing.
        let terminal_mirror_write = std::env::var(TERMINAL_MIRROR_WRITE_ENV)
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let cell_bin_override = std::env::var_os("FIELD_NATIVE_CELL_BIN").map(PathBuf::from);
        let isolation_window_override = std::env::var("FIELD_NATIVE_ISOLATION_WINDOW_MS")
            .ok()
            .and_then(|value| value.trim().parse::<u64>().ok());
        Ok(Self {
            data_dir,
            log_root,
            log_filter,
            mesh_enabled,
            sidecar_override,
            terminal_mesh_enabled,
            terminal_mirror_write,
            cell_bin_override,
            isolation_window_override,
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
            terminal_mirror_write: None,
            cell_bin_override: None,
            isolation_window_override: None,
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
            terminal_mirror_write: None,
            cell_bin_override: None,
            isolation_window_override: None,
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
