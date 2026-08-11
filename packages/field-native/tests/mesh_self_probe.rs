//! S1 — does the sidecar answer WhoIs for the node's OWN tailnet address, with
//! the login populated? The static trace (UA spike, 2026-08-05) says yes at
//! every step: the sidecar's whois path has no self special-casing, tailscale
//! resolves the self node at all three lookup steps, and the self user-profile
//! is upstream-guaranteed in the netmap (tailscale#19894). This is the LIVE
//! confirmation that rides UA-4's exit — the left-hand side of the self/guest
//! comparison, proven on a real network. See `common/mod.rs` for the gate and
//! the tailnet courtesies (ephemeral nodes, probe app id).
mod common;

use common::{authkey, build_node, probe_app_id, redact, sidecar, vendored_sidecar, AUTHKEY_ENV};
use std::time::Duration;
use tokio::time::timeout;

/// THE ONLY OFFLINE TEST IN THE PROBE FAMILY, and it guards the fidelity every
/// other probe's verdict rests on: which binary they actually run.
///
/// It lives beside S1 because S1 is the claim that suffered — the probes ran a
/// **Jul 16** machine-wide `~/.config/truffle/bin/sidecar-slim` while this
/// workspace pinned and vendored an **Aug 2** one, so a WhoIs-capable sidecar
/// sat in `node_modules` unused and identity looked assertable (GT-4). Every
/// other test here is `#[ignore]`d behind a live tailnet, so without this row
/// nothing in `pnpm verify` would notice the order silently inverting again.
#[test]
fn sidecar_resolution_prefers_the_workspace_pinned_binary() {
    if std::env::var_os("FIELD_NATIVE_SIDECAR_PATH").is_some() {
        // An explicit override is authoritative by design, so a run that sets
        // one says nothing about the fallback order this test is about.
        eprintln!("[skip] sidecar order: FIELD_NATIVE_SIDECAR_PATH is set and outranks it");
        return;
    }
    let Some(vendored) = vendored_sidecar() else {
        // A checkout without `pnpm install` has nothing to prefer.
        eprintln!("[skip] sidecar order: this workspace vendors no sidecar for this platform");
        return;
    };
    assert_eq!(
        sidecar().as_deref(),
        Some(vendored.as_path()),
        "the harness must run the sidecar this workspace PINS, not whatever is installed on the machine"
    );
}

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
