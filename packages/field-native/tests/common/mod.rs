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

/// The sidecar npm package this platform's desktop build vendors, by name.
/// `None` on a platform the app does not ship a sidecar for.
fn vendored_sidecar_package() -> Option<&'static str> {
    Some(match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => "truffle-sidecar-darwin-arm64",
        ("macos", "x86_64") => "truffle-sidecar-darwin-x64",
        ("linux", "aarch64") => "truffle-sidecar-linux-arm64",
        ("linux", "x86_64") => "truffle-sidecar-linux-x64",
        ("windows", "x86_64") => "truffle-sidecar-win32-x64",
        _ => return None,
    })
}

/// The binary this workspace PINS, resolved through `apps/desktop`'s own
/// dependency — the same artifact the packaged app ships (EL8, exact `0.7.12`).
pub fn vendored_sidecar() -> Option<PathBuf> {
    let package = vendored_sidecar_package()?;
    let mut dir: Option<&Path> = Some(Path::new(env!("CARGO_MANIFEST_DIR")));
    while let Some(d) = dir {
        if d.join("pnpm-workspace.yaml").is_file() {
            let bin = d
                .join("apps/desktop/node_modules/@vibecook")
                .join(package)
                .join("bin");
            for name in ["sidecar-slim", "truffle-sidecar"] {
                for candidate in [bin.join(name), bin.join(format!("{name}.exe"))] {
                    if candidate.is_file() {
                        return Some(candidate);
                    }
                }
            }
            return None; // repo root found and it holds no vendored sidecar
        }
        dir = d.parent();
    }
    None
}

/// THE PINNED BINARY WINS OVER WHATEVER IS INSTALLED ON THE MACHINE, and the
/// order is the whole point (2026-08-10).
///
/// This used to search the machine-wide truffle installs only, so on a developer
/// box it found `~/.config/truffle/bin/sidecar-slim` — here, a **Jul 16** build —
/// while the repo pinned and vendored an **Aug 2** one for the same version.
/// Every `#[ignore]`d tailnet probe therefore exercised a binary the product
/// never ships, which is how a WhoIs-capable sidecar sat in `node_modules` while
/// the probes ran without it and identity looked assertable (GT-4 close-out).
///
/// `FIELD_NATIVE_SIDECAR_PATH` still outranks everything — an explicit override
/// is authoritative, and a wrong one fails loudly rather than falling back.
/// The machine installs stay as the LAST resort so a checkout without
/// `pnpm install` can still run the probes; they are simply no longer preferred
/// over the version this workspace declares.
pub fn sidecar() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("FIELD_NATIVE_SIDECAR_PATH") {
        let p = PathBuf::from(p);
        return p.is_file().then_some(p);
    }
    if let Some(p) = vendored_sidecar() {
        return Some(p);
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
