//! UA-P-4 (RFC 025) — THE LOGIN GATE, ON A REAL TAILNET.
//!
//! The unit rows in `mesh_unit.rs` witness the floor's DECISION: which
//! allow-list a posture hands truffle, and that a gated bring-up against a
//! pre-protocol-5 sidecar degrades loudly. They cannot witness the gate itself,
//! because a node cannot be built headlessly. This one can, and it is the live
//! half: three ephemeral nodes on the real tailnet, one ungated, one gated on
//! the account's REAL login, one gated on a glob that cannot match.
//!
//! WHY IT LIVES HERE AND NOT ONLY UPSTREAM. truffle has its own real-tailnet
//! row for RFC 025 §5. This one runs in VibeField's tree, against the truffle
//! this repo PINS, through the same `NodeBuilder` the floor calls — so it
//! answers "does the gate work for us, at our pin" rather than "does the gate
//! work". While the petition window is open those are different questions.
//!
//! `#[ignore]`d and gated on `TRUFFLE_TEST_AUTHKEY` for the reasons in
//! `common/mod.rs`. Run it deliberately, with a PROTOCOL-5 sidecar:
//!
//! ```sh
//! set -a; . ./.env; set +a
//! FIELD_NATIVE_SIDECAR_PATH=target/debug/sidecar-slim \
//!   cargo test -p field-native --test mesh_login_gate_probe -- --ignored --nocapture
//! ```
//!
//! The env var is not optional housekeeping: `common::sidecar()` prefers the
//! VENDORED npm sidecar, which is pre-RFC-025 while the window is open, and a
//! gated node refuses to start against it (correctly, loudly).

mod common;

use common::{authkey, build_gated_node, build_node, probe_app_id, redact, sidecar, AUTHKEY_ENV};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::{Duration, Instant};
use truffle_core::network::tailscale::TailscaleProvider;
use truffle_core::Node;

/// A glob no tailnet login can match. Not a typo'd address — `path.Match` has
/// no escape that would make this equal a real login, and a login cannot
/// contain `/`.
const IMPOSSIBLE: &str = "nobody-at-all@invalid.example";

const STORE: &str = "field.gate.probe.v1";

async fn peer_hostnames(node: &Arc<Node<TailscaleProvider>>) -> Vec<String> {
    node.peers().await.into_iter().map(|p| p.hostname).collect()
}

/// Wait until `from` sees `host`, answering with how long it took. Returns
/// `None` on timeout rather than panicking: one call here is a CONTROL whose
/// duration the later settle window is derived from, and another is a row that
/// must NOT succeed — the caller decides which a timeout means.
async fn wait_for_peer(
    from: &Arc<Node<TailscaleProvider>>,
    host: &str,
    limit: Duration,
) -> Option<Duration> {
    let started = Instant::now();
    loop {
        if peer_hostnames(from).await.iter().any(|h| h == host) {
            return Some(started.elapsed());
        }
        if started.elapsed() > limit {
            return None;
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "real tailnet: needs TRUFFLE_TEST_AUTHKEY; run with --ignored"]
async fn a_gated_node_sees_its_own_login_and_a_walled_one_sees_nobody() {
    let Some(key) = authkey() else {
        eprintln!("[skip] mesh_login_gate_probe: {AUTHKEY_ENV} not set");
        return;
    };
    let Some(sidecar_path) = sidecar() else {
        eprintln!("[skip] mesh_login_gate_probe: no truffle sidecar found");
        return;
    };
    let app_id = probe_app_id();
    eprintln!(
        "[gate] app_id={app_id} sidecar={} authkey={}",
        sidecar_path.display(),
        redact(&key)
    );

    let open_state = tempfile::TempDir::with_prefix("vf-gate-open-").unwrap();
    let gated_state = tempfile::TempDir::with_prefix("vf-gate-gated-").unwrap();
    let walled_state = tempfile::TempDir::with_prefix("vf-gate-walled-").unwrap();

    // 1. THE CONTROL, and it must come first: an UNGATED node. Everything below
    //    is an absence or a presence measured against what this node can do, so
    //    if discovery is broken for this app_id the whole probe has to say so
    //    here rather than report a gate that "worked".
    let open = Arc::new(build_node(&app_id, "open", open_state.path(), &key, &sidecar_path).await);
    let open_host = open.local_info().tailscale_hostname.clone();

    // 2. THE LIVE LOGIN. RFC 025 §3.3 puts the node's own owner on the status
    //    event at protocol 5, so this is read from the tailnet rather than
    //    configured — which also makes it the T4 witness: if `login_name` is
    //    absent here the sidecar is pre-protocol-5 and nothing below is valid.
    let login = {
        let deadline = Instant::now() + Duration::from_secs(60);
        loop {
            if let Some(l) = open
                .local_info()
                .login_name
                .clone()
                .filter(|l| !l.is_empty())
            {
                break l;
            }
            assert!(
                Instant::now() < deadline,
                "the node never learned its own login — is this sidecar protocol 5? \
                 (`common::sidecar()` prefers the vendored npm one, which is pre-RFC-025 \
                 while the petition window is open; set FIELD_NATIVE_SIDECAR_PATH)"
            );
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    };
    eprintln!(
        "[gate] this tailnet's login is present (len {})",
        login.len()
    );

    // 3. The gated pair. A build failure here is the protocol-5 refusal far more
    //    often than anything else, so it says so.
    let gated = Arc::new(
        build_gated_node(
            &app_id,
            "gated",
            gated_state.path(),
            &key,
            &sidecar_path,
            std::slice::from_ref(&login),
        )
        .await
        .unwrap_or_else(|e| {
            panic!("the gated node did not start ({e}) — a sidecar below protocol 5 refuses")
        }),
    );
    let gated_host = gated.local_info().tailscale_hostname.clone();
    let walled = Arc::new(
        build_gated_node(
            &app_id,
            "walled",
            walled_state.path(),
            &key,
            &sidecar_path,
            &[IMPOSSIBLE.to_string()],
        )
        .await
        .expect("the walled node builds — a gate that matches nobody is still a valid gate"),
    );
    eprintln!("[gate] nodes up: open={open_host} gated={gated_host} walled=(gated on IMPOSSIBLE)");

    // 4. THE CONTROL MEASUREMENT: the ungated node discovers the gated one.
    //    Its duration is the unit the walled node's settle window is expressed
    //    in — a fixed sleep would be a guess about this tailnet's latency.
    let discovery = wait_for_peer(&open, &gated_host, Duration::from_secs(120))
        .await
        .expect(
            "the CONTROL failed: an ungated node never discovered the gated one, \
                 so nothing below is a statement about the gate",
        );
    eprintln!("[gate] control: ungated discovery took {discovery:?}");

    // 5. THE GATE ADMITS THIS ACCOUNT. The gated node's allow-list is this
    //    tailnet's own login, and every node here is under it.
    assert!(
        wait_for_peer(&gated, &open_host, Duration::from_secs(120))
            .await
            .is_some(),
        "a node gated on its OWN login must still see this account's nodes"
    );
    eprintln!("[gate] gated node sees the account's own peer");

    // 6. THE STORE CONVERGES ACROSS THE GATE. This is the whole point of
    //    UA-P-4 for VibeField: the bus may carry content again because its
    //    audience is the account. A gate that admitted the peer but broke the
    //    session plane would pass step 5 and fail the product.
    let open_store = open.synced_store::<Value>(STORE);
    let gated_store = gated.synced_store::<Value>(STORE);
    open_store.set(json!({ "from": "open", "v": 1 })).await;
    let converged = {
        let deadline = Instant::now() + discovery * 4 + Duration::from_secs(30);
        loop {
            let all = gated_store.all().await;
            if all.values().any(|slice| slice.data["from"] == "open") {
                break true;
            }
            if Instant::now() > deadline {
                break false;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    };
    assert!(
        converged,
        "the store did not converge between two nodes the gate admits"
    );
    eprintln!("[gate] store converged across the gate");

    // 7. THE WALLED NODE SEES NOBODY, and the window is derived rather than
    //    guessed: four times the measured control, with a floor so a very fast
    //    tailnet does not produce a meaninglessly short one. A walled node that
    //    is merely SLOW would show up inside this; one the gate refused never
    //    will.
    let settle = (discovery * 4).max(Duration::from_secs(30));
    eprintln!("[gate] settling {settle:?} before reading the walled node");
    tokio::time::sleep(settle).await;
    let seen = peer_hostnames(&walled).await;

    // THE SIMULTANEOUS CONTROL, read in the same beat: the ungated node sees
    // BOTH of the others right now. Without this, "the walled node saw nothing"
    // could equally mean the netmap had not propagated, or that this app_id's
    // namespace was empty, or that the run was simply too early — and the
    // measured discovery above cannot rule that out, because on a warm tailnet
    // it comes back in microseconds and measures nothing at all. Two readings
    // of the same instant, disagreeing, is the evidence.
    let open_sees = peer_hostnames(&open).await;
    assert!(
        open_sees.contains(&gated_host) && open_sees.len() >= 2,
        "the CONTROL failed at read time: the ungated node should see both others, saw {open_sees:?}"
    );

    assert!(
        seen.is_empty(),
        "a node gated on a glob that matches no login must hold at zero peers, saw {seen:?} \
         while the ungated node saw {open_sees:?}"
    );

    // …and the walled node is really ON the tailnet rather than never joined:
    // it has an identity and the tailnet named its owner. It simply admits
    // no one.
    assert!(
        !walled.local_info().tailscale_id.is_empty(),
        "the walled node is really on the tailnet"
    );
    assert!(
        walled.local_info().login_name.is_some(),
        "the walled node's own login is known — it is gated, not blind"
    );
    eprintln!(
        "[gate] walled node is live and holds 0 peers while the ungated node holds {} — \
         the gate refused, not the network",
        open_sees.len()
    );
}
