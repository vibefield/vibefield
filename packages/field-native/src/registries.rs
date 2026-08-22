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
    pub const TERMINAL_CONTROL: &str = "termctl.sock";
    pub const TERMINAL_FRAME: &str = "termframe.sock";
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

/// TC-D6(c) — per-class scrollback BYTE caps, enforced at the native create
/// seam (agents < interactive; the fleet-memory lever).
pub mod terminal_scrollback_class_bytes {
    pub const AGENT: usize = 2097152;
    pub const INTERACTIVE: usize = 10485760;
}

/// TC-S2 — the floor's supervision budget for a field-terminal-host cell.
/// One authority with the TS side; see registries.ts for the rationale.
pub mod cell_supervision {
    pub const HELLO_DEADLINE_MS: u64 = 15000;
    pub const DRAIN_BUDGET_MS: u64 = 6000;
    pub const EXIT_GRACE_MS: u64 = 2000;
    pub const RESPAWN_MAX: u64 = 3;
    pub const RESPAWN_WINDOW_MS: u64 = 60000;
}

/// TC-S3/TC-D4 — spawn-isolation policy (Exact-only strikes; solo-cell cap
/// is the TC-D6(f) bound). See registries.ts for the rationale.
pub mod cell_isolation {
    pub const ISOLATION_WINDOW_MS: u64 = 300000;
    pub const MAX_SOLO_CELLS: u64 = 8;
}

/// TPv3 (terminal-pipeline-v3 §5.1/§8; §20 item 5) — the pipeline's numbers:
/// protocol version, door hygiene, grant validity, the cell's receive caps and
/// the announced ProtocolLimits. PROVISIONAL until the numeric checkpoint; one
/// authority with fieldd and the renderer. See registries.ts for the owners.
pub mod terminal_pipeline {
    pub const PROTOCOL_MAJOR: u64 = 1;
    pub const PROTOCOL_MINOR: u64 = 0;
    pub const HEARTBEAT_INTERVAL_MS: u64 = 5000;
    pub const HEARTBEAT_TTL_MS: u64 = 15000;
    pub const HELLO_DEADLINE_MS: u64 = 5000;
    pub const PRE_AUTH_MAX_BYTES: u64 = 65536;
    pub const PRE_AUTH_CONNECTION_CAP: u64 = 64;
    pub const MAX_CONNECTION_SETS: u64 = 256;
    pub const MAX_CLOCK_SKEW_MS: u64 = 5000;
    pub const MAX_GRANT_LIFETIME_MS: u64 = 600000;
    pub const TRANSPORT_GRANT_TTL_MS: u64 = 60000;
    pub const CELL_CONNECTION_CREDIT_BYTES: u64 = 16777216;
    pub const CELL_PER_ACTIVATION_CREDIT_BYTES: u64 = 4194304;
    pub const CELL_STAGING_BYTES_PER_SESSION: u64 = 8388608;
    pub const CELL_STAGING_BYTES_TOTAL: u64 = 67108864;
    pub const CELL_MAX_CONCURRENT_ACTIVATIONS: u64 = 256;
    pub const CELL_MAX_CONCURRENT_SEEDS: u64 = 4;
    pub const MAX_CONTROL_MESSAGE_BYTES: u64 = 262144;
    pub const MAX_PRESENTATION_CHUNK_BYTES: u64 = 1048576;
    pub const MAX_BATCH_LATENCY_MS: u64 = 4;
    pub const MAX_CREDIT_RETURN_DELAY_MS: u64 = 16;
    pub const MAX_SCENE_APPLIED_DELAY_MS: u64 = 1000;
    pub const SCENE_APPLIED_REFRESH_MS: u64 = 2000;
    pub const PRESENTATION_STATUS_REFRESH_MS: u64 = 2000;
    pub const ACTIVATION_ATTACH_DEADLINE_MS: u64 = 5000;
    pub const MAX_ACTIVATION_CATCHUP_MS: u64 = 3000;
    pub const MAX_CATCHUP_BYTES: u64 = 8388608;
    pub const CREDIT_ACCOUNT_DRAIN_TTL_MS: u64 = 5000;
    pub const CELL_LEASE_TTL_MS: u64 = 6000;
    pub const INPUT_LAG_SUSPEND_REVISIONS: u64 = 64;
    pub const ATTACH_RENEWAL_MARGIN_MS: u64 = 60000;
    pub const SEED_FRAME_WAIT_MS: u64 = 2000;
    pub const URGENT_RESERVE_BYTES: u64 = 2097152;
    pub const MAX_BULK_BYTES_ADMITTED_AHEAD: u64 = 4194304;
    pub const MAX_URGENT_PRESENTATION_UNIT_BYTES: u64 = 262144;
}

/// TPv3 — the cell doors' WebSocket close codes (1008 = silent pre-auth; 4000+
/// named). See registries.ts.
pub mod terminal_pipeline_close_codes {
    pub const GOING_AWAY: u16 = 1001;
    pub const POLICY_PRE_AUTH: u16 = 1008;
    pub const SERVER_ERROR: u16 = 1011;
    pub const STALE_ROUTE: u16 = 4000;
    pub const FENCED: u16 = 4001;
    pub const SUPERSEDED: u16 = 4002;
    pub const PROTOCOL: u16 = 4003;
    pub const LEG_TIMEOUT: u16 = 4004;
}

/// File names beneath a daemon's own data directory. The plane that OWNS the
/// file joins the name to its data dir; readers ask that plane for the path.
pub mod files {
    pub const TERMINAL_CONFIG: &str = "config.ghostty";
    pub const CUSTODY_ADMISSION_LEDGER: &str = "custody-admission.v1.json";
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
    pub const LINK_FILE: &[&str] = &["fieldd", "link.json"];
    pub const TERMINAL_CONFIG_FILE: &[&str] = &["native", "config.ghostty"];
    pub const MGMT_SOCKET: &[&str] = &["native", "run", "mgmt.sock"];
    pub const MESHDATA_SOCKET: &[&str] = &["native", "run", "meshdata.sock"];
    pub const TERMINAL_CONTROL_SOCKET: &[&str] = &["native", "run", "termctl.sock"];
    pub const TERMINAL_FRAME_SOCKET: &[&str] = &["native", "run", "termframe.sock"];
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
        ("LINK_FILE", LINK_FILE),
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
