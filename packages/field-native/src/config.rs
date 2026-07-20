use std::path::PathBuf;

/// field-native configuration (design-02 §2.8). Registries default from
/// @vibefield/contracts constants; env override: FIELD_NATIVE_DATA_DIR (dev).
#[derive(Clone, Debug)]
pub struct NativeConfig {
    pub data_dir: PathBuf,
}

impl NativeConfig {
    pub fn from_env() -> Self {
        let data_dir = std::env::var_os("FIELD_NATIVE_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(default_data_dir);
        Self { data_dir }
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
