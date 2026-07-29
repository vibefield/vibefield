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
