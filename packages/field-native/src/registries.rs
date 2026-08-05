// GENERATED from @vibefield/contracts src/registries.ts — do not edit.
// Regenerate: `pnpm gen` (root) or `pnpm --filter @vibefield/contracts gen:rust`.
// NF-D9: registries reach Rust by generation, never by retyping (drift class R4).

pub const APP_ID: &str = "vibefield";

/// Env prefixes joining Ghosttea's strip list (G1′/EL7) — daemon secrets
/// never enter agent PTYs.
pub const ENV_PREFIXES: &[&str] = &["FIELD_", "FIELDD_"];

pub mod ports {
    pub const FIELDD_WS_CONTROL: u16 = 9410;
    pub const FIELDD_WS_DATA: u16 = 9411;
    pub const TRUFFLE_WS_RESERVED: u16 = 9417;
    pub const GHOSTTEA_TSP1_QUIC: u16 = 9420;
    pub const GHOSTTEA_TSP1_TCP: u16 = 9421;
    pub const DOC_SYNC_QUIC: u16 = 9440;
    pub const PRESENCE_UDP: u16 = 9441;
    pub const RELAY_HTTPS: u16 = 443;
}

/// Socket file names under the daemon run dirs; paths are stable across
/// restarts (external-mode law).
pub mod sockets {
    pub const FIELDD: &str = "fieldd.sock";
    pub const MGMT: &str = "mgmt.sock";
    pub const MESHDATA: &str = "meshdata.sock";
    pub const TERMINAL_CONTROL: &str = "terminal-control.sock";
    pub const TERMINAL_FRAME: &str = "terminal-frame.sock";
}

pub mod stores {
    pub const TERMINAL_HOSTS: &str = "terminal.v1.hosts";
    pub const DOCS: &str = "field.docs.v1";
    pub const ARTIFACTS: &str = "field.artifacts.v1";
    pub const PUSH: &str = "field.push.v1";
    pub const DEVICES: &str = "field.devices.v1";
}

pub mod mesh_control_limits {
    pub const REMOTE_ORIGINS: usize = 256;
    pub const OWNER_CHARS: usize = 256;
    pub const ARTIFACT_SLICE_BYTES: usize = 262144;
    pub const DEVICE_SLICE_BYTES: usize = 65536;
    pub const MGMT_FRAME_BYTES: usize = 83886080;
    pub const MGMT_QUEUED_BYTES: usize = 100663296;
    pub const MGMT_OUTBOX_MESSAGES: usize = 64;
    pub const PRODUCT_FRAME_BYTES: usize = 134217728;
    pub const PRODUCT_QUEUED_BYTES: usize = 134217728;
}

/// File names beneath a daemon's own data directory. The plane that OWNS the
/// file joins the name to its data dir; readers ask that plane for the path.
pub mod files {
    pub const TERMINAL_CONFIG: &str = "config.ghostty";
}

/// UA-D10 — the on-disk layout under a data root, as segments. One authority;
/// consumers join, never respell. Pinned by fixtures/layout.vector.json.
pub mod layout {
    pub const FIELDD_RUN_DIR: &[&str] = &["fieldd", "run"];
    pub const PRODUCT_JSON: &[&str] = &["fieldd", "run", "product.json"];
    pub const SHELL_TOKEN: &[&str] = &["fieldd", "run", "shell.token"];
    pub const DEVICE_ID: &[&str] = &["fieldd", "device-id"];
    pub const SETTINGS_DOC: &[&str] = &["fieldd", "settings", "doc.loro"];
    pub const REGISTRIES_DIR: &[&str] = &["registries"];
    pub const DOCS_DIR: &[&str] = &["docs"];
    pub const ARTIFACT_PREVIEWS_DIR: &[&str] = &["artifacts", "previews"];
    pub const AUDIT_DIR: &[&str] = &["audit"];
    pub const PLUGINS_INSTALLED_DIR: &[&str] = &["plugins", "installed"];
    pub const NATIVE_DIR: &[&str] = &["native"];
    pub const NATIVE_RUN_DIR: &[&str] = &["native", "run"];
    pub const PAIRING_FILE: &[&str] = &["native", "pairing"];
    pub const MESH_STATE_DIR: &[&str] = &["native", "mesh"];
    pub const TERMINAL_CONFIG_FILE: &[&str] = &["native", "config.ghostty"];
    pub const MGMT_SOCKET: &[&str] = &["native", "run", "mgmt.sock"];
    pub const MESHDATA_SOCKET: &[&str] = &["native", "run", "meshdata.sock"];
    pub const TERMINAL_CONTROL_SOCKET: &[&str] = &["native", "run", "terminal-control.sock"];
    pub const TERMINAL_FRAME_SOCKET: &[&str] = &["native", "run", "terminal-frame.sock"];
    pub const CRASH_DIR: &[&str] = &["crash"];
    pub const EXPORTS_STAGING_DIR: &[&str] = &["exports", ".staging"];
    pub const USERS_DIR: &[&str] = &["users"];
    pub const USERS_FILE: &[&str] = &["users.json"];
    pub const USERS_LOCK: &[&str] = &["users.json.lock"];
    pub const LAYOUT_STAMP: &[&str] = &["layout.json"];
    /// Every entry, for the cross-language fixture test.
    pub const ALL: &[(&str, &[&str])] = &[
        ("FIELDD_RUN_DIR", FIELDD_RUN_DIR),
        ("PRODUCT_JSON", PRODUCT_JSON),
        ("SHELL_TOKEN", SHELL_TOKEN),
        ("DEVICE_ID", DEVICE_ID),
        ("SETTINGS_DOC", SETTINGS_DOC),
        ("REGISTRIES_DIR", REGISTRIES_DIR),
        ("DOCS_DIR", DOCS_DIR),
        ("ARTIFACT_PREVIEWS_DIR", ARTIFACT_PREVIEWS_DIR),
        ("AUDIT_DIR", AUDIT_DIR),
        ("PLUGINS_INSTALLED_DIR", PLUGINS_INSTALLED_DIR),
        ("NATIVE_DIR", NATIVE_DIR),
        ("NATIVE_RUN_DIR", NATIVE_RUN_DIR),
        ("PAIRING_FILE", PAIRING_FILE),
        ("MESH_STATE_DIR", MESH_STATE_DIR),
        ("TERMINAL_CONFIG_FILE", TERMINAL_CONFIG_FILE),
        ("MGMT_SOCKET", MGMT_SOCKET),
        ("MESHDATA_SOCKET", MESHDATA_SOCKET),
        ("TERMINAL_CONTROL_SOCKET", TERMINAL_CONTROL_SOCKET),
        ("TERMINAL_FRAME_SOCKET", TERMINAL_FRAME_SOCKET),
        ("CRASH_DIR", CRASH_DIR),
        ("EXPORTS_STAGING_DIR", EXPORTS_STAGING_DIR),
        ("USERS_DIR", USERS_DIR),
        ("USERS_FILE", USERS_FILE),
        ("USERS_LOCK", USERS_LOCK),
        ("LAYOUT_STAMP", LAYOUT_STAMP),
    ];
}
