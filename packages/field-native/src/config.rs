use std::path::PathBuf;

/// field-native configuration (design-02 §2.8). Registries default from
/// @vibefield/contracts constants; env overrides (dev):
/// FIELD_NATIVE_DATA_DIR · FIELD_NATIVE_MESH=1 · FIELD_NATIVE_SIDECAR_PATH.
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
        Ok(Self {
            data_dir,
            log_root,
            log_filter,
            mesh_enabled,
            sidecar_override,
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
        }
    }

    pub fn native_dir(&self) -> PathBuf {
        self.data_dir.join("native")
    }
    /// 0700 — sockets live here; stable paths across fieldd restarts (external-mode law).
    pub fn run_dir(&self) -> PathBuf {
        self.native_dir().join("run")
    }
    /// 0600 — the D8 pairing secret, created by field-native on first boot.
    pub fn pairing_file(&self) -> PathBuf {
        self.native_dir().join("pairing")
    }

    /// The app-owned Ghostty config overlay the terminal unit loads after the
    /// user's own Ghostty files (GT-3). It sits in the native dir, not the run
    /// dir: a user's configuration outlives a boot, and the run dir holds only
    /// what a boot creates. The NAME comes from the generated registries — one
    /// name, and this is the only place it is joined to a directory, because
    /// this plane owns the file and every reader asks the service where it is.
    pub fn terminal_config_file(&self) -> PathBuf {
        self.native_dir()
            .join(crate::registries::files::TERMINAL_CONFIG)
    }
    pub fn mgmt_socket(&self) -> PathBuf {
        self.run_dir().join("mgmt.sock")
    }

    /// The MeshData bridge's byte plane (D5). A SECOND socket beside mgmt on
    /// purpose: control and bytes must not share a queue, and this one carries
    /// product data while mgmt carries decisions.
    pub fn meshdata_socket(&self) -> PathBuf {
        self.run_dir()
            .join(crate::services::mesh_bridge::SOCKET_NAME)
    }
    /// truffle node state (device identity + tsnet keys) — mesh identity lives
    /// in the longer-lived plane and survives fieldd restarts (design-02 §2.4).
    pub fn mesh_state_dir(&self) -> PathBuf {
        self.native_dir().join("mesh")
    }
}

fn default_data_dir() -> PathBuf {
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    #[cfg(target_os = "macos")]
    {
        home.join("Library/Application Support/VibeField")
    }
    #[cfg(not(target_os = "macos"))]
    {
        home.join(".local/share/VibeField")
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

    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
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
