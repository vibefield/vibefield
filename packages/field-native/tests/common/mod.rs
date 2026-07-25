//! Shared harness for the tests that join a REAL tailnet.
//!
//! Every one of them is `#[ignore]`d and gated on `TRUFFLE_TEST_AUTHKEY`: a
//! network round-trip must not sit inside `pnpm verify`, and a machine without
//! a key must never be a red build. Run them deliberately:
//!
//! ```sh
//! cargo test -p field-native --test quic_lane_probe     -- --ignored --nocapture
//! cargo test -p field-native --test quic_lane_transport -- --ignored --nocapture
//! ```
//!
//! COURTESY TO THE TAILNET THEY JOIN: nodes register EPHEMERAL, so they vanish
//! ~30–60 min after the process dies rather than accumulating as dead devices
//! on the account. The app_id is unique per run — truffle's RFC 017 namespacing
//! filters discovery by `truffle-{app_id}-*`, so a shared id would make each run
//! chase the previous runs' lingering ghosts, which is exactly how these tests
//! turn flaky. It also keeps them out of `vibefield`, the product's own
//! namespace: a test must not appear on the tailnet as the product.
//!
//! The auth key is a SECRET. It is read from `.env` (gitignored) and never
//! printed — only a redacted prefix, the way truffle's own harness does it.
#![allow(dead_code)] // each test binary uses a different subset

use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::time::timeout;
use truffle_core::network::tailscale::TailscaleProvider;
use truffle_core::{Node, NodeBuilder};

/// Both sides must share this: a Node's WS transport dials `peer_ip:self_port`.
pub const WS_PORT: u16 = 9417;

pub const AUTHKEY_ENV: &str = "TRUFFLE_TEST_AUTHKEY";

/// Read the key from the environment, else from a `.env` walked up from this
/// crate. A hand parse rather than a dependency: one variable does not justify
/// adding a crate to a daemon's build graph.
pub fn authkey() -> Option<String> {
    if let Ok(k) = std::env::var(AUTHKEY_ENV) {
        if !k.is_empty() {
            return Some(k);
        }
    }
    let mut dir: Option<&Path> = Some(Path::new(env!("CARGO_MANIFEST_DIR")));
    while let Some(d) = dir {
        let candidate = d.join(".env");
        if candidate.is_file() {
            let body = std::fs::read_to_string(&candidate).ok()?;
            for line in body.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                let Some((name, value)) = line.split_once('=') else {
                    continue;
                };
                if name.trim() == AUTHKEY_ENV {
                    let v = value.trim().trim_matches('"').trim_matches('\'');
                    if !v.is_empty() {
                        return Some(v.to_string());
                    }
                }
            }
        }
        dir = d.parent();
    }
    None
}

/// First 12 characters and nothing more — a key in a log is a leaked key.
pub fn redact(key: &str) -> String {
    if key.len() <= 12 {
        "****".into()
    } else {
        format!("{}...", &key[..12])
    }
}

pub fn sidecar() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("FIELD_NATIVE_SIDECAR_PATH") {
        let p = PathBuf::from(p);
        return p.is_file().then_some(p);
    }
    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    for rel in [
        "Library/Application Support/truffle/bin/sidecar-slim",
        "Library/Application Support/truffle/bin/truffle-sidecar",
        ".config/truffle/bin/sidecar-slim",
        ".config/truffle/bin/truffle-sidecar",
    ] {
        let c = home.join(rel);
        if c.is_file() {
            return Some(c);
        }
    }
    let c = PathBuf::from("/usr/local/bin/truffle-sidecar");
    c.is_file().then_some(c)
}

/// A per-run tailnet namespace. NOT the product's `vibefield` app id — see the
/// module note.
pub fn probe_app_id() -> String {
    let suffix: u32 = rand::random();
    format!("vfprobe{suffix:08x}")
}

pub async fn build_node(
    app_id: &str,
    name: &str,
    state: &Path,
    key: &str,
    sidecar: &Path,
) -> Node<TailscaleProvider> {
    NodeBuilder::default()
        .app_id(app_id.to_string())
        .expect("app_id parses")
        .device_name(name.to_string())
        .sidecar_path(sidecar.to_path_buf())
        .state_dir(state.to_str().expect("utf8 state dir"))
        .auth_key(key)
        // Ephemeral: these tests must not leave devices on the account.
        .ephemeral(true)
        .ws_port(WS_PORT)
        .build()
        .await
        .expect("node build")
}

/// Wait until `from` can SEE `host`, and answer with the peer id
/// (`PeerInfo.id` / `tailscale_id`) — the same string `native.mesh.peers.list`
/// publishes and `native.mesh.lane.open` takes back, so the tests exercise the
/// identifier the product actually passes around.
pub async fn rendezvous(from: &Node<TailscaleProvider>, host: &str) -> String {
    timeout(Duration::from_secs(90), async {
        loop {
            if let Some(p) = from.peers().await.into_iter().find(|p| p.hostname == host) {
                return p.tailscale_id;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("never discovered {host} within 90s"))
}
