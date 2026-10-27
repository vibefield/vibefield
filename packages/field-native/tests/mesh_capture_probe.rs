//! TS-1 (track TS) — the FLOOR'S OWN capture on a real tailnet, signed in by an
//! auth key with no browser (P7): until TS-1 the floor's bring-up could only
//! run an interactive login, so no test could drive it headlessly (the wall
//! `MeshHandle::force_node_presence_for_tests` documents). This probe runs the
//! product's path end to end against the pinned sidecar:
//!
//!   1. `start_with(Capture, key)` signs the node in by the key;
//!   2. the sign-in facts arrive from a REAL protocol-10 sidecar — the name
//!      Tailscale granted, the key's expiry, the hosted console's Machines page;
//!   3. the capture → linked promotion rebuilds the node gated on its own login
//!      and the capture node's sidecar ends (item 79's live witness);
//!   4. `stop` ends the node, and a second probe node's device list shows it gone.
//!
//! The tailnet courtesies (`common/mod.rs`): a per-run app id outside the
//! product's `vibefield` namespace and a name that says "probe", through the
//! floor's `mesh_probe` seam, and EPHEMERAL nodes, so nothing lingers on the
//! account. The key is read by this process alone (the env, or the `.env` named
//! by `TRUFFLE_TEST_DOTENV`) and never printed; keep a run's log only through
//! `sed 's/tskey-[A-Za-z0-9_-]*/tskey-REDACTED/g'`.
mod common;

use common::{authkey, build_node, probe_app_id, sidecar, AUTHKEY_ENV};
use field_native::config::{MeshProbeIdentity, NativeConfig};
use field_native::contracts::MeshMode;
use field_native::services::mesh::{AuthKey, StartOptions};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::time::timeout;

const PROBE_NAME: &str = "ts1-capture-probe";

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "real tailnet: needs TRUFFLE_TEST_AUTHKEY (or TRUFFLE_TEST_DOTENV); run by name with --ignored"]
async fn the_floors_own_capture_signs_in_with_an_auth_key() {
    let Some(key) = authkey() else {
        eprintln!("[skip] mesh_capture_probe: {AUTHKEY_ENV} not set");
        return;
    };
    let Some(sidecar) = sidecar() else {
        eprintln!("[skip] mesh_capture_probe: no truffle sidecar found");
        return;
    };
    let app_id = probe_app_id();
    eprintln!(
        "[probe] app_id={app_id} name={PROBE_NAME} sidecar={}",
        sidecar.display()
    );
    let dir = tempfile::tempdir().unwrap();
    let config = NativeConfig {
        sidecar_override: Some(sidecar.clone()),
        mesh_probe: Some(MeshProbeIdentity {
            app_id: app_id.clone(),
            device_name: PROBE_NAME.into(),
        }),
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
    };
    let daemon = field_native::bootstrap(config).await.expect("bootstrap");
    let mesh = &daemon.state.mesh;

    // (1) the capture, signed in by the key: no browser, no address offered
    let began = Instant::now();
    mesh.start_with(
        MeshMode::Capture,
        None,
        StartOptions {
            auth_key: Some(AuthKey::new(key.clone())),
            renew: false,
        },
    )
    .await
    .expect("capture start");
    let capture = timeout(Duration::from_secs(120), mesh.wait_for_node())
        .await
        .expect("the key-signed capture node came up within 120 s");
    eprintln!("[probe] (1) capture node up in {:?}", began.elapsed());
    assert!(
        mesh.health().auth_url.is_none(),
        "a key-signed capture offers no browser address"
    );

    // (2) the sign-in facts, from the real sidecar
    let facts = mesh.link_facts();
    eprintln!(
        "[probe] (2) machine_name={:?} key_expiry_ms={:?} admin_url={:?} needs_approval={}",
        facts.machine_name, facts.key_expiry_ms, facts.admin_url, facts.needs_approval
    );
    let expected = format!("truffle-{app_id}-{PROBE_NAME}");
    let name = facts
        .machine_name
        .clone()
        .expect("the granted machine name");
    assert!(
        name.starts_with(&expected),
        "the node carries the probe's name: {name}"
    );
    assert!(
        facts.key_expiry_ms.is_some(),
        "a protocol-10 sidecar reports the key's expiry (or that it is disabled)"
    );
    assert_eq!(
        facts.admin_url.as_deref(),
        Some("https://login.tailscale.com/admin/machines"),
        "the hosted service names its console"
    );
    assert!(!facts.needs_approval);

    // the node's own login, which the promotion gates on
    let deadline = Instant::now() + Duration::from_secs(30);
    let login = loop {
        if let Some(login) = capture.local_info().login_name.filter(|l| !l.is_empty()) {
            break login;
        }
        assert!(Instant::now() < deadline, "the node never named its login");
        tokio::time::sleep(Duration::from_millis(250)).await;
    };
    eprintln!("[probe]     login known ({} chars)", login.len());

    // (3) the promotion: a new node, gated on that login; the capture's sidecar ends
    let capture_pid = capture
        .sidecar_pid()
        .expect("the capture node's sidecar pid");
    assert!(mesh
        .start(MeshMode::Linked, Some(login.clone()))
        .await
        .expect("promotion"));
    let deadline = Instant::now() + Duration::from_secs(120);
    let linked = loop {
        if let Some(node) = mesh.node() {
            if !Arc::ptr_eq(&node, &capture) {
                break node;
            }
        }
        assert!(Instant::now() < deadline, "the promoted node never came up");
        tokio::time::sleep(Duration::from_millis(250)).await;
    };
    assert_eq!(mesh.login_allow(), vec![login.clone()]);
    drop(capture);
    let deadline = Instant::now() + Duration::from_secs(10);
    while alive(capture_pid) {
        assert!(
            Instant::now() < deadline,
            "the capture node's sidecar outlived the promotion"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    eprintln!("[probe] (3) promoted: gated on its login, one sidecar");
    let linked_host = linked.local_info().tailscale_hostname.clone();
    drop(linked);

    // (4) the device list, from a second ephemeral probe node. A POSITIVE CONTROL
    // first: the witness must see the floor's node while it is up, or an empty
    // list would prove nothing (a netmap still loading is empty too).
    let state = tempfile::tempdir().unwrap();
    let witness = build_node(&app_id, "ts1-witness-probe", state.path(), &key, &sidecar).await;
    let watched = Instant::now();
    loop {
        if witness
            .peers()
            .await
            .iter()
            .any(|p| p.hostname == linked_host)
        {
            break;
        }
        assert!(
            watched.elapsed() < Duration::from_secs(90),
            "the witness never saw {linked_host} while it was up"
        );
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    eprintln!(
        "[probe] (4) the witness sees {linked_host} while it is up ({:?})",
        watched.elapsed()
    );
    mesh.stop().await;
    daemon.shutdown().await;
    let stopped = Instant::now();
    let gone = loop {
        if !witness
            .peers()
            .await
            .iter()
            .any(|p| p.hostname == linked_host)
        {
            break true;
        }
        if stopped.elapsed() > Duration::from_secs(300) {
            break false;
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    };
    eprintln!(
        "[probe]     after stop, {linked_host} {} ({:?})",
        if gone {
            "is gone from the witness's device list"
        } else {
            "is STILL listed"
        },
        stopped.elapsed()
    );
    witness.stop().await;
    assert!(
        gone,
        "the ephemeral probe node is still on the tailnet 300 s after its stop"
    );
}

fn alive(pid: u32) -> bool {
    std::process::Command::new("ps")
        .args(["-o", "stat=", "-p", &pid.to_string()])
        .output()
        .map(|out| {
            let stat = String::from_utf8_lossy(&out.stdout).trim().to_string();
            !stat.is_empty() && !stat.starts_with('Z')
        })
        .unwrap_or(false)
}
