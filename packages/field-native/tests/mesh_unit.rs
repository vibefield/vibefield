// MeshUnit (C1) lifecycle honesty — no tailnet, no network, no env mutation:
// configs are constructed directly so tests stay parallel-safe.
use field_native::{bootstrap, config::NativeConfig};

fn unit<'a>(h: &'a serde_json::Value, name: &str) -> &'a serde_json::Value {
    h["units"]
        .as_array()
        .unwrap()
        .iter()
        .find(|u| u["unit"] == name)
        .unwrap_or_else(|| panic!("unit {name} missing"))
}

fn health_json(daemon: &field_native::RunningDaemon) -> serde_json::Value {
    serde_json::to_value(&*daemon.state.health_tx.borrow()).unwrap()
}

#[tokio::test]
async fn mesh_disabled_by_default_and_daemon_stays_up() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = bootstrap(NativeConfig::for_data_dir(dir.path().to_path_buf()))
        .await
        .unwrap();
    let h = health_json(&daemon);
    let mesh = unit(&h, "mesh-gateway");
    assert_eq!(mesh["state"], "disabled");
    assert!(mesh["detail"]
        .as_str()
        .unwrap()
        .contains("FIELD_NATIVE_MESH"));
    // disabled-by-config is not degradation: the daemon reports up
    assert_eq!(h["state"], "up");
    daemon.shutdown().await;
}

#[tokio::test]
async fn mesh_enabled_without_sidecar_degrades_honestly() {
    let dir = tempfile::tempdir().unwrap();
    let config = NativeConfig {
        data_dir: dir.path().to_path_buf(),
        log_root: None,
        log_filter: None,
        mesh_enabled: true,
        sidecar_override: Some("/nonexistent/sidecar-slim".into()),
    };
    let daemon = bootstrap(config).await.unwrap();
    let h = health_json(&daemon);
    let mesh = unit(&h, "mesh-gateway");
    assert_eq!(mesh["state"], "degraded");
    let detail = mesh["detail"].as_str().unwrap();
    assert!(detail.contains("sidecar") && detail.contains("FIELD_NATIVE_SIDECAR_PATH"));
    // an enabled-but-broken mesh SHOULD shout: overall degraded
    assert_eq!(h["state"], "degraded");
    daemon.shutdown().await;
}

/// Live tailnet bring-up — needs a real sidecar binary (and possibly a browser
/// login). Run by hand:
///   FIELD_NATIVE_SIDECAR_PATH=<path-to-sidecar-slim> \
///   cargo test -p field-native --test mesh_unit -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn mesh_live_bring_up_reaches_auth_or_up() {
    let sidecar = std::env::var("FIELD_NATIVE_SIDECAR_PATH")
        .or_else(|_| std::env::var("TRUFFLE_SIDECAR_PATH"))
        .expect("set FIELD_NATIVE_SIDECAR_PATH for the live test");
    let dir = tempfile::tempdir().unwrap();
    let config = NativeConfig {
        data_dir: dir.path().to_path_buf(),
        log_root: None,
        log_filter: None,
        mesh_enabled: true,
        sidecar_override: Some(sidecar.into()),
    };
    let daemon = bootstrap(config).await.unwrap();

    // watch the live health stream until the unit leaves plain "starting"
    let mut rx = daemon.state.health_tx.subscribe();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(120);
    loop {
        let h = serde_json::to_value(&*rx.borrow_and_update()).unwrap();
        let mesh = unit(&h, "mesh-gateway").clone();
        let state = mesh["state"].as_str().unwrap().to_string();
        let has_auth = mesh.get("authUrl").is_some_and(|u| u.is_string());
        eprintln!(
            "mesh: {state} auth_url={has_auth} detail={:?}",
            mesh["detail"]
        );
        if state == "up" || has_auth || state == "degraded" {
            assert_ne!(state, "degraded", "bring-up failed: {:?}", mesh["detail"]);
            break;
        }
        tokio::select! {
            r = rx.changed() => r.expect("health channel closed"),
            _ = tokio::time::sleep_until(deadline) => panic!("no transition within 120s"),
        }
    }
    daemon.shutdown().await;
}
