//! Does truffle's QUIC stream primitive actually carry lane bytes between two
//! real tailnet nodes? C6-3's `LaneTransport` is about to be built on
//! `connect_quic` / `listen_quic` / `open_stream` / `accept_stream`, and every
//! slice so far has been deliberately provable WITHOUT a tailnet. This is the
//! one thing that cannot be: it answers whether the primitive works on a real
//! network before the transport is written on top of it.
//!
//! GATED AND IGNORED, both on purpose:
//!   · `#[ignore]` — a real-network test must not sit inside `pnpm verify`,
//!     where it would add tens of seconds and a dependency on someone's
//!     tailnet to every commit. Run it deliberately:
//!         cargo test -p field-native --test quic_lane_probe -- --ignored --nocapture
//!   · the auth-key gate — without `TRUFFLE_TEST_AUTHKEY` it prints one `[skip]`
//!     line and passes, matching truffle's own harness convention so a machine
//!     without a key is never a red build.
//!
//! COURTESY TO THE TAILNET IT JOINS: both nodes register EPHEMERAL, so they
//! disappear ~30–60 min after the process dies rather than accumulating as dead
//! devices on the account. The app_id is unique per run — truffle's RFC 017
//! namespacing filters discovery by `truffle-{app_id}-*`, so a shared id would
//! make each run chase the previous runs' lingering ghosts, which is exactly
//! how these tests turn flaky.
//!
//! The auth key is a SECRET. It is read from `.env` (gitignored) and never
//! printed — only a redacted prefix, the way truffle's harness does it.

use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::time::timeout;
use truffle_core::network::tailscale::TailscaleProvider;
use truffle_core::{Node, NodeBuilder};

/// Our own registry constant (PORTS.DOC_SYNC_QUIC) — the probe uses the port
/// doc-sync lanes will actually use, not an arbitrary one.
const DOC_SYNC_QUIC: u16 = 9440;
/// Both sides must share this: a Node's WS transport dials `peer_ip:self_port`.
const WS_PORT: u16 = 9417;

const AUTHKEY_ENV: &str = "TRUFFLE_TEST_AUTHKEY";

/// Read the key from the environment, else from a `.env` walked up from this
/// crate. A hand parse rather than a dependency: one variable does not justify
/// adding a crate to a daemon's build graph.
fn authkey() -> Option<String> {
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
fn redact(key: &str) -> String {
    if key.len() <= 12 {
        "****".into()
    } else {
        format!("{}...", &key[..12])
    }
}

fn sidecar() -> Option<PathBuf> {
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

async fn build_node(
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
        // Ephemeral: this test must not leave devices on the account.
        .ephemeral(true)
        .ws_port(WS_PORT)
        .build()
        .await
        .expect("node build")
}

#[tokio::test]
#[ignore = "real tailnet: needs TRUFFLE_TEST_AUTHKEY; run with --ignored"]
async fn quic_stream_carries_lane_bytes_between_two_tailnet_nodes() {
    let Some(key) = authkey() else {
        eprintln!("[skip] quic_lane_probe: {AUTHKEY_ENV} not set");
        return;
    };
    let Some(sidecar) = sidecar() else {
        eprintln!("[skip] quic_lane_probe: no truffle sidecar found");
        return;
    };

    // Unique per run (RFC 017): a shared app_id makes discovery chase the
    // ephemeral ghosts of previous runs, which linger 30–60 minutes.
    let suffix: u32 = rand::random();
    let app_id = format!("vfprobe{suffix:08x}");
    eprintln!(
        "[probe] app_id={app_id} sidecar={} authkey={}",
        sidecar.display(),
        redact(&key)
    );

    let alpha_state = tempfile::TempDir::with_prefix("vf-probe-alpha-").expect("alpha dir");
    let beta_state = tempfile::TempDir::with_prefix("vf-probe-beta-").expect("beta dir");

    let (alpha, beta) = tokio::join!(
        build_node(&app_id, "alpha", alpha_state.path(), &key, &sidecar),
        build_node(&app_id, "beta", beta_state.path(), &key, &sidecar),
    );
    eprintln!(
        "[probe] nodes up: alpha={} beta={}",
        alpha.local_info().tailscale_hostname,
        beta.local_info().tailscale_hostname
    );

    // Rendezvous: alpha must SEE beta before it can resolve it to an IP.
    let beta_host = beta.local_info().tailscale_hostname.clone();
    let found = timeout(Duration::from_secs(90), async {
        loop {
            let peers = alpha.peers().await;
            if let Some(p) = peers.iter().find(|p| p.hostname == beta_host) {
                return p.hostname.clone();
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    })
    .await
    .expect("alpha never discovered beta within 90s");
    eprintln!("[probe] rendezvous: alpha sees {found}");

    // beta listens on the port doc-sync lanes will use.
    let listener = beta
        .listen_quic(DOC_SYNC_QUIC)
        .await
        .expect("beta listen_quic");

    let payload: Vec<u8> = vec![0, 1, 2, 0, 255, 128, 0, 42]; // binary, with NULs
    let expected = payload.clone();

    let server = tokio::spawn(async move {
        let conn = listener
            .accept()
            .await
            .expect("listener closed before a connection");
        // DOCUMENTED SUBTLETY (transport/quic.rs): accept_stream does not fire
        // until the opener WRITES. A lane that is opened but silent is
        // invisible to the peer — which is why lane announcement rides mgmt
        // rather than being inferred from the stream appearing.
        let mut stream = conn
            .accept_stream()
            .await
            .expect("accept stream")
            .expect("no stream");
        // read() yields up to max_len and Ok(None) at clean EOF, so drain until
        // the writer finishes — a short read is normal, not a failure.
        let mut got = Vec::new();
        while let Some(chunk) = stream.read(64).await.expect("read lane bytes") {
            got.extend_from_slice(&chunk);
            if got.len() >= 8 {
                break;
            }
        }
        got
    });

    let conn = timeout(
        Duration::from_secs(30),
        alpha.connect_quic(&found, DOC_SYNC_QUIC),
    )
    .await
    .expect("connect_quic timed out")
    .expect("connect_quic");
    let mut stream = conn.open_stream().await.expect("open_stream");
    stream.write(&payload).await.expect("write lane bytes");
    // Half-close so the reader sees a clean EOF rather than waiting on a lane
    // that is simply idle.
    stream.finish();

    let got = timeout(Duration::from_secs(30), server)
        .await
        .expect("server timed out")
        .expect("server task");

    assert_eq!(got, expected, "lane bytes must cross the mesh unchanged");
    eprintln!("[probe] {} bytes crossed the tailnet intact", got.len());

    // Ephemeral nodes disappear on their own, but stopping is the courteous
    // path and makes the next run's discovery cleaner.
    alpha.stop().await;
    beta.stop().await;
}
