//! S1 — does the sidecar answer WhoIs for the node's OWN tailnet address, with
//! the login populated? The static trace (UA spike, 2026-08-05) says yes at
//! every step: the sidecar's whois path has no self special-casing, tailscale
//! resolves the self node at all three lookup steps, and the self user-profile
//! is upstream-guaranteed in the netmap (tailscale#19894). This is the LIVE
//! confirmation that rides UA-4's exit — the left-hand side of the self/guest
//! comparison, proven on a real network. See `common/mod.rs` for the gate and
//! the tailnet courtesies (ephemeral nodes, probe app id).
mod common;

use common::{authkey, build_node, probe_app_id, redact, sidecar, AUTHKEY_ENV};
use std::time::Duration;
use tokio::time::timeout;

#[tokio::test]
#[ignore = "real tailnet: needs TRUFFLE_TEST_AUTHKEY; run with --ignored"]
async fn self_whois_answers_with_login() {
    let Some(key) = authkey() else {
        eprintln!("[skip] mesh_self_probe: {AUTHKEY_ENV} not set");
        return;
    };
    let Some(sidecar) = sidecar() else {
        eprintln!("[skip] mesh_self_probe: no truffle sidecar found");
        return;
    };
    let app_id = probe_app_id();
    eprintln!(
        "[probe] app_id={app_id} sidecar={} authkey={}",
        sidecar.display(),
        redact(&key)
    );
    let dir = tempfile::tempdir().expect("tempdir");
    let node = build_node(&app_id, "self-probe", dir.path(), &key, &sidecar).await;

    // The netmap must be loaded before whois can answer for anyone, self
    // included (the §7.2 timing law: capture after Running, never during
    // bring-up). local_info() carries the ip once the node is up.
    let ip = timeout(Duration::from_secs(90), async {
        loop {
            if let Some(ip) = node.local_info().ip {
                return ip;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    })
    .await
    .expect("node never learned its own tailnet ip");

    let identity = timeout(Duration::from_secs(60), async {
        loop {
            if let Ok(Some(identity)) = node.whois(&ip.to_string()).await {
                if identity
                    .login_name
                    .as_deref()
                    .is_some_and(|l| !l.is_empty())
                {
                    return identity;
                }
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    })
    .await
    .expect("self-whois never answered with a login (S1 refuted?)");

    eprintln!(
        "[probe] S1 CONFIRMED live: self-whois login present (len {})",
        identity.login_name.map(|l| l.len()).unwrap_or(0)
    );
}
