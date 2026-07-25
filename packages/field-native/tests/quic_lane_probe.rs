//! Does truffle's QUIC stream primitive actually carry lane bytes between two
//! real tailnet nodes? C6-3's `LaneTransport` was built on `connect_quic` /
//! `listen_quic` / `open_stream` / `accept_stream`, and every slice before it
//! was deliberately provable WITHOUT a tailnet. This is the one thing that
//! cannot be: it answers whether the PRIMITIVE works on a real network,
//! underneath everything the transport layers on top.
//!
//! It stays after `quic_lane_transport.rs` landed, and on purpose: when the
//! transport test goes red, this says in one run whether the ground moved or
//! our code did. See `common/mod.rs` for the gate and the tailnet courtesies.

mod common;

use common::{authkey, build_node, probe_app_id, redact, rendezvous, sidecar, AUTHKEY_ENV};
use std::time::Duration;
use tokio::time::timeout;

/// Our own registry constant (PORTS.DOC_SYNC_QUIC) — the probe uses the port
/// doc-sync lanes will actually use, not an arbitrary one.
const DOC_SYNC_QUIC: u16 = 9440;

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

    let app_id = probe_app_id();
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
    let beta_id = rendezvous(&alpha, &beta_host).await;
    eprintln!("[probe] rendezvous: alpha sees {beta_host} as {beta_id}");

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
        // invisible to the peer — which is why the transport's LANE_OPEN header
        // goes out inside `open()` rather than with the first payload.
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
        alpha.connect_quic(&beta_id, DOC_SYNC_QUIC),
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
