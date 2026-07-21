use std::path::PathBuf;

/// field-native configuration (design-02 §2.8). Registries default from
/// @vibefield/contracts constants; env overrides (dev):
/// FIELD_NATIVE_DATA_DIR · FIELD_NATIVE_MESH=1 · FIELD_NATIVE_SIDECAR_PATH.
#[derive(Clone, Debug)]
pub struct NativeConfig {
    pub data_dir: PathBuf,
    /// mesh-gateway master switch (C1: off by default until the tailnet story
    /// is wired end to end; the unit reports "disabled" honestly).
    pub mesh_enabled: bool,
    /// explicit sidecar binary path; falls back to the truffle search order.
    pub sidecar_override: Option<PathBuf>,
}

impl NativeConfig {
    pub fn from_env() -> Self {
        let data_dir = std::env::var_os("FIELD_NATIVE_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(default_data_dir);
        let mesh_enabled = std::env::var("FIELD_NATIVE_MESH")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        let sidecar_override = std::env::var_os("FIELD_NATIVE_SIDECAR_PATH")
            .or_else(|| std::env::var_os("TRUFFLE_SIDECAR_PATH"))
            .map(PathBuf::from);
        Self {
            data_dir,
            mesh_enabled,
            sidecar_override,
        }
    }

    /// Test/dev constructor: mesh off, no overrides.
    pub fn for_data_dir(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
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
    pub fn mgmt_socket(&self) -> PathBuf {
        self.run_dir().join("mgmt.sock")
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
