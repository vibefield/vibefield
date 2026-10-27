// MeshUnit (C1) lifecycle honesty — no tailnet, no network, no env mutation:
// configs are constructed directly so tests stay parallel-safe.
use field_native::{bootstrap, config::NativeConfig};
use std::sync::Arc;

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

/// Boot returns before every unit has finished coming up: since NF-2 the
/// terminal unit builds its text engine off the boot path, so the first health
/// snapshot is honestly `starting`. A test asking "did the daemon settle?" has
/// to wait for that transition instead of reading the snapshot.
async fn settled_health(daemon: &field_native::RunningDaemon) -> serde_json::Value {
    let mut rx = daemon.state.health_tx.subscribe();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        let h = serde_json::to_value(&*rx.borrow_and_update()).unwrap();
        if h["state"] != "starting" {
            return h;
        }
        tokio::select! {
            r = rx.changed() => r.expect("health channel closed"),
            _ = tokio::time::sleep_until(deadline) => panic!("health never left starting: {h}"),
        }
    }
}

/// UA-P-0a (D1) — the default posture is OFFLINE, and the detail says WHY in
/// the product's own terms. It used to name the env flag, because the flag was
/// the switch; the switch is the LINK now, and a sentence pointing a user at an
/// environment variable would be pointing at the development override.
#[tokio::test]
async fn mesh_is_offline_until_something_links_and_the_daemon_stays_up() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = bootstrap(NativeConfig::for_data_dir(dir.path().to_path_buf()))
        .await
        .unwrap();
    let h = settled_health(&daemon).await;
    let mesh = unit(&h, "mesh-gateway");
    assert_eq!(mesh["state"], "disabled");
    let detail = mesh["detail"].as_str().unwrap();
    assert!(
        detail.contains("offline") && detail.contains("link"),
        "{detail}"
    );
    assert!(
        !detail.contains("FIELD_NATIVE_MESH"),
        "the offline sentence must not send a user to the dev override: {detail}"
    );
    // no node, and no posture: nobody has asked for one
    assert!(daemon.state.mesh.mode().is_none());
    assert!(!daemon.state.mesh.node_present());
    // offline-by-posture is not degradation: the daemon reports up
    assert_eq!(h["state"], "up");
    daemon.shutdown().await;
}

/// UA-P-0a — the posture is recorded and the capture→linked promotion does not
/// need a node to be a real transition. A bring-up cannot happen here (no
/// sidecar, and `build_with_auth_handler` drives an interactive browser login —
/// the same wall `force_node_presence_for_tests` documents), so what this row
/// witnesses is the POSTURE STATE MACHINE: what `mode()`/`login()` answer after
/// each verb, and that `stop` puts both back to nothing.
#[tokio::test]
async fn the_posture_follows_start_and_stop() {
    use field_native::contracts::MeshMode;
    let dir = tempfile::tempdir().unwrap();
    let config = NativeConfig {
        sidecar_override: Some("/nonexistent/sidecar-slim".into()),
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
    };
    let daemon = bootstrap(config).await.unwrap();
    let mesh = &daemon.state.mesh;
    assert!(mesh.mode().is_none(), "boot asks for no posture");

    // the Link act: capture, and no account is named yet
    assert!(mesh.start(MeshMode::Capture, None).await.unwrap());
    assert_eq!(mesh.mode(), Some(MeshMode::Capture));
    assert_eq!(mesh.login(), None);

    // the capture landed: the login IS the account from here on
    assert!(mesh
        .start(MeshMode::Linked, Some("james@github".into()))
        .await
        .unwrap());
    assert_eq!(mesh.mode(), Some(MeshMode::Linked));
    assert_eq!(mesh.login().as_deref(), Some("james@github"));

    // stop is the posture going offline; the identity on disk is untouched
    mesh.stop().await;
    assert!(mesh.mode().is_none());
    assert_eq!(mesh.login(), None);
    daemon.shutdown().await;
}

#[tokio::test]
async fn mesh_enabled_without_sidecar_degrades_honestly() {
    let dir = tempfile::tempdir().unwrap();
    // Struct-update from the test constructor rather than a full literal: this
    // test cares about two fields, and spelling every other one only means a
    // new config field breaks tests that have no opinion about it.
    let config = NativeConfig {
        // UA-P-0a: `mesh_enabled` is the forced-on DEVELOPMENT override now —
        // the one path that still brings a node up at boot with no fieldd to
        // ask for a posture, which is exactly what this row needs.
        mesh_enabled: true,
        sidecar_override: Some("/nonexistent/sidecar-slim".into()),
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
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

/// UA-P-0d (D7) — the mesh state dir is 0700, and so is every directory truffle
/// creates beneath it. The reason is `synced_store/backend.rs`: the FileBackend
/// persists slices with an ordinary create into this tree, and the run dir's own
/// chmod (`lib.rs`) never covered it — so a slice sat on disk at whatever the
/// umask gave it. The secret no longer rides a slice (that is the other half of
/// D7), but the tree still holds the node's identity and keys.
///
/// Driven through a bring-up that DEGRADES (no sidecar): the directory is
/// created and hardened before truffle is handed it, which is the ordering that
/// matters — a mode set after the first write is a mode set too late.
#[cfg(unix)]
#[tokio::test]
async fn the_mesh_state_dir_is_private_to_this_user() {
    use field_native::contracts::MeshMode;
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    // A sidecar that RESOLVES (only `is_file` is checked here) but cannot be a
    // tailnet node: the bring-up gets past the sidecar gate, creates and hardens
    // the state dir synchronously, and then degrades in its spawned task. That
    // ordering is the point — a mode set after truffle's first write is a mode
    // set too late. With a MISSING sidecar the dir is never created at all,
    // which is also correct: no sidecar, no node, no state to protect.
    let config = NativeConfig {
        sidecar_override: Some("/bin/echo".into()),
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
    };
    let state_dir = config.mesh_state_dir();
    let daemon = bootstrap(config).await.unwrap();
    // nothing has asked for a node, so nothing has been created yet
    assert!(
        !state_dir.exists(),
        "an offline desktop mints no mesh state"
    );

    daemon
        .state
        .mesh
        .start(MeshMode::Linked, Some("james@github".into()))
        .await
        .unwrap();
    assert!(state_dir.exists(), "the link act creates the state dir");
    let mode = std::fs::metadata(&state_dir).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o700, "mode was {mode:o}");

    // and a directory truffle would create underneath is hardened on the next
    // pass, which is what `harden_state_dir` walking the tree is for
    let nested = state_dir.join("synced_store");
    std::fs::create_dir_all(&nested).unwrap();
    std::fs::set_permissions(&nested, std::fs::Permissions::from_mode(0o755)).unwrap();
    daemon.state.mesh.stop().await;
    daemon
        .state
        .mesh
        .start(MeshMode::Linked, Some("james@github".into()))
        .await
        .unwrap();
    let nested_mode = std::fs::metadata(&nested).unwrap().permissions().mode() & 0o777;
    assert_eq!(nested_mode, 0o700, "nested mode was {nested_mode:o}");
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
        mesh_enabled: true,
        sidecar_override: Some(sidecar.into()),
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
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

// ---------------------------------------------------------------------------
// UA-P-4 — the gate
// ---------------------------------------------------------------------------

/// UA-P-4 (RFC 025 §3.1) — the LOGIN ALLOW-LIST the floor hands truffle, which
/// is a different fact from the posture and is the one `native.mesh.self`
/// reports as `loginAllow`.
///
/// Driven through a degrading bring-up (no usable sidecar) because that is the
/// only headless path: what it witnesses is the DECISION — linked-with-a-login
/// gates on exactly that login, capture gates on nothing, the development
/// override's login-less `linked` gates on nothing, and a stop clears it. The
/// live witness that truffle honours the list is the real-tailnet row in
/// truffle's own suite (RFC 025 §5) plus the two-account tailnet James owes.
#[tokio::test]
async fn the_gate_is_the_captured_login_and_nothing_wider() {
    use field_native::contracts::MeshMode;
    let dir = tempfile::tempdir().unwrap();
    let config = NativeConfig {
        sidecar_override: Some("/nonexistent/sidecar-slim".into()),
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
    };
    let daemon = bootstrap(config).await.unwrap();
    let mesh = &daemon.state.mesh;
    assert!(mesh.login_allow().is_empty(), "no node, no gate");

    // capture: the tailnet has not said who we are, so there is nothing to gate
    // on. The capture BELT (serve.add / store.set refused) is what holds this
    // window, not a gate invented from a claim.
    mesh.start(MeshMode::Capture, None).await.unwrap();
    assert!(
        mesh.login_allow().is_empty(),
        "capture mode is ungated: {:?}",
        mesh.login_allow()
    );

    // linked: ONE exact login. Not `*@domain`, not a prefix — D2 scopes to the
    // login identity, and a glob would be a wider ruling than the one James made.
    mesh.start(MeshMode::Linked, Some("james@github".into()))
        .await
        .unwrap();
    assert_eq!(mesh.login_allow(), vec!["james@github".to_string()]);

    // relinking to a DIFFERENT account moves the gate with it
    mesh.start(MeshMode::Linked, Some("other@github".into()))
        .await
        .unwrap();
    assert_eq!(mesh.login_allow(), vec!["other@github".to_string()]);

    // offline: no node, no gate — and no stale list left behind for the next
    // reader to mistake for a live one.
    mesh.stop().await;
    assert!(mesh.login_allow().is_empty());
    daemon.shutdown().await;
}

/// UA-P-4 — the development override starts UNGATED, and this row exists to
/// keep that deliberate rather than accidental. `FIELD_NATIVE_MESH=1` brings a
/// node up in `linked` mode with NO login; an empty allow-list is RFC 025's
/// "no gate", which is what the probes and the kill matrix need (they want
/// every peer on a test tailnet and have no account to scope to). The product
/// cannot reach this state: `native.mesh.start` refuses linked without a login.
#[tokio::test]
async fn the_development_override_is_ungated() {
    let dir = tempfile::tempdir().unwrap();
    let config = NativeConfig {
        mesh_enabled: true,
        sidecar_override: Some("/nonexistent/sidecar-slim".into()),
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
    };
    let daemon = bootstrap(config).await.unwrap();
    assert!(
        daemon.state.mesh.login_allow().is_empty(),
        "the forced-on override must not gate: {:?}",
        daemon.state.mesh.login_allow()
    );
    daemon.shutdown().await;
}

/// UA-P-4 (RFC 025 D3) — A GATED NODE REFUSES TO START AGAINST A SIDECAR THAT
/// CANNOT REPORT LOGINS, and the refusal reaches the health shape with
/// truffle's own sentence in it.
///
/// Why this matters more than it looks: below sidecar protocol 5 no peer row
/// carries a `loginName`, so a gated node's filter would fail closed on every
/// row and the node would sit silently peerless — or, read carelessly, be
/// treated as ungated, which is the fail-open shape UA-P-0 spent itself
/// closing. truffle chooses the loud failure (`NetworkError::StartFailed`); the
/// floor's job is not to swallow it.
///
/// THE STAND-IN: a real child process speaking the sidecar's stdin/stdout JSON
/// line protocol, answering `tsnet:start` with a `tsnet:started` that declares
/// `protocolVersion: 4`. It is a stand-in for a SIDECAR, never for the gate —
/// the gate is truffle's, and this test drives the real one.
#[cfg(unix)]
#[tokio::test]
async fn a_gated_node_refuses_a_sidecar_that_cannot_name_a_login() {
    use field_native::contracts::MeshMode;
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let stub = dir.path().join("sidecar-slim");
    std::fs::write(
        &stub,
        r#"#!/bin/sh
# A sidecar from before RFC 025: it starts, and it cannot name anyone's login.
while IFS= read -r line; do
  case "$line" in
    *tsnet:start*)
      printf '%s\n' '{"event":"tsnet:started","data":{"state":"running","hostname":"truffle-vibefield-stub","dnsName":"truffle-vibefield-stub.tail0.ts.net","tailscaleIP":"100.64.0.9","nodeId":"nStub0CNTRL","protocolVersion":4}}'
      ;;
  esac
done
"#,
    )
    .unwrap();
    std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755)).unwrap();

    let config = NativeConfig {
        sidecar_override: Some(stub),
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
    };
    let daemon = bootstrap(config).await.unwrap();
    daemon
        .state
        .mesh
        .start(MeshMode::Linked, Some("james@github".into()))
        .await
        .unwrap();

    // the bring-up runs spawned; wait for the unit to leave `starting`
    let mut rx = daemon.state.health_tx.subscribe();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
    let detail = loop {
        let h = serde_json::to_value(&*rx.borrow_and_update()).unwrap();
        let m = unit(&h, "mesh-gateway").clone();
        if m["state"] == "degraded" {
            break m["detail"].as_str().unwrap().to_string();
        }
        assert_ne!(m["state"], "up", "a gated node must not come up here: {m}");
        tokio::select! {
            r = rx.changed() => r.expect("health channel closed"),
            _ = tokio::time::sleep_until(deadline) => panic!("no transition within 30s: {m}"),
        }
    };

    // truffle's reason, VERBATIM — not a sentence this crate invented about a
    // failure it did not diagnose. The version numbers are the load-bearing
    // half: "5" is what a gate needs, "4" is what this sidecar said.
    assert!(
        detail.contains("login_allow requires sidecar protocol 5"),
        "truffle's reason must ride through verbatim: {detail}"
    );
    assert!(
        detail.contains("this sidecar speaks 4"),
        "the sentence must name what the sidecar actually speaks: {detail}"
    );
    // and no node was installed — a refused gate leaves nothing behind
    assert!(!daemon.state.mesh.node_present());
    daemon.shutdown().await;
}

/// UA-P-4 — the CONTROL for the row above, and the reason it proves anything:
/// the SAME stand-in sidecar, the same bring-up, but UNGATED (capture mode).
/// An ungated node is unaffected by the protocol floor — every version
/// qualifies — so it must NOT degrade with that sentence. Without this row a
/// stub that simply failed to be a sidecar at all would pass the test above.
#[cfg(unix)]
#[tokio::test]
async fn an_ungated_node_is_unaffected_by_the_sidecar_protocol_floor() {
    use field_native::contracts::MeshMode;
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let stub = dir.path().join("sidecar-slim");
    std::fs::write(
        &stub,
        r#"#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *tsnet:start*)
      printf '%s\n' '{"event":"tsnet:started","data":{"state":"running","hostname":"truffle-vibefield-stub","dnsName":"truffle-vibefield-stub.tail0.ts.net","tailscaleIP":"100.64.0.9","nodeId":"nStub0CNTRL","protocolVersion":4}}'
      ;;
  esac
done
"#,
    )
    .unwrap();
    std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755)).unwrap();

    let config = NativeConfig {
        sidecar_override: Some(stub),
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
    };
    let daemon = bootstrap(config).await.unwrap();
    daemon
        .state
        .mesh
        .start(MeshMode::Capture, None)
        .await
        .unwrap();
    assert!(daemon.state.mesh.login_allow().is_empty());

    // Settle far enough to know the protocol refusal did not fire. This node
    // may or may not finish building against a stub (it is not a tailnet), and
    // that is not what is under test — what is under test is that the SENTENCE
    // does not appear, on a node the gate does not apply to.
    let mut rx = daemon.state.health_tx.subscribe();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(20);
    loop {
        let h = serde_json::to_value(&*rx.borrow_and_update()).unwrap();
        let m = unit(&h, "mesh-gateway").clone();
        let detail = m["detail"].as_str().unwrap_or("");
        assert!(
            !detail.contains("login_allow requires sidecar protocol"),
            "an ungated node must never hit the protocol-5 floor: {detail}"
        );
        if m["state"] == "up" || m["state"] == "degraded" {
            break;
        }
        tokio::select! {
            r = rx.changed() => r.expect("health channel closed"),
            _ = tokio::time::sleep_until(deadline) => break,
        }
    }
    daemon.shutdown().await;
}

/// UA-P-4 — THE PROMOTION REBUILDS A **GATED** NODE, which is a stronger claim
/// than "it restarted" and the one that matters.
///
/// The rows above witness the floor's DECISION with no node installed, so the
/// `start` path they take is the ordinary first bring-up. This one takes the
/// PROMOTION path: a LIVE capture node, ungated, asked to become linked.
/// Without it, "linked means gated" would be a fact about an empty floor.
///
/// THE WALL THIS GETS PAST, since `force_node_presence_for_tests` documents the
/// opposite: a node cannot be built headlessly *against a real tailnet*,
/// because `build_with_auth_handler` drives an interactive browser login. It
/// CAN be built against a stand-in sidecar. The sidecar is a child process
/// speaking newline JSON on stdio, so a shell script that answers `tsnet:start`
/// with a protocol-5 `tsnet:started` gets a genuine `Node` installed in the
/// watch — every layer above Layer 3 is the product's. What this cannot
/// witness is truffle honouring the list on a real netmap; that is
/// `mesh_login_gate_probe.rs`, on the real tailnet.
#[cfg(unix)]
#[tokio::test]
async fn the_promotion_rebuilds_a_gated_node_and_keeps_the_identity() {
    use field_native::contracts::MeshMode;
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let stub = dir.path().join("sidecar-slim");
    std::fs::write(
        &stub,
        r#"#!/bin/sh
# A protocol-5 sidecar stand-in: it can name a login, so a gated node may start.
while IFS= read -r line; do
  case "$line" in
    *tsnet:start*)
      printf '%s\n' '{"event":"tsnet:started","data":{"state":"running","hostname":"truffle-vibefield-stub","dnsName":"truffle-vibefield-stub.tail0.ts.net","tailscaleIP":"127.0.0.1","nodeId":"nStub0CNTRL","loginName":"james@github","protocolVersion":5}}'
      ;;
    *tsnet:peers*)
      printf '%s\n' '{"event":"tsnet:peers","data":{"peers":[]}}'
      ;;
  esac
done
"#,
    )
    .unwrap();
    std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755)).unwrap();

    let config = NativeConfig {
        sidecar_override: Some(stub),
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
    };
    let daemon = bootstrap(config).await.unwrap();
    let mesh = &daemon.state.mesh;

    // THE PRECONDITION, asserted rather than assumed: a live CAPTURE node, and
    // it is UNGATED. A row that only checked the end state could pass because
    // the node was gated all along — which is the shape of the bug this slice
    // exists to fix.
    mesh.start(MeshMode::Capture, None).await.unwrap();
    let capture_node = await_node(mesh).await;
    assert!(
        mesh.login_allow().is_empty(),
        "the capture node must be ungated: {:?}",
        mesh.login_allow()
    );
    let capture_device_id = capture_node.local_info().device_id.clone();
    assert!(!capture_device_id.is_empty());

    // A RE-DECLARE OF THE SAME POSTURE MUST NOT CHURN. The control for the
    // rebuild below: if every `start` replaced the node, the assertion that the
    // promotion replaced it would mean nothing.
    assert!(
        !mesh.start(MeshMode::Capture, None).await.unwrap(),
        "re-asking for the live posture is an idempotent no-op"
    );
    assert!(
        Arc::ptr_eq(&capture_node, &mesh.node().expect("still up")),
        "an idempotent re-declare must not replace the node"
    );

    // THE PROMOTION.
    assert!(
        mesh.start(MeshMode::Linked, Some("james@github".into()))
            .await
            .unwrap(),
        "capture → linked is a real transition"
    );
    let linked_node = await_node(mesh).await;

    // (1) GATED — the point of the row. Not "a node is up", not "something
    //     restarted": the installed node carries the captured login as its gate.
    assert_eq!(
        mesh.login_allow(),
        vec!["james@github".to_string()],
        "the promoted node must be gated on the captured login"
    );
    // (2) REBUILT, not relabelled — a different node object is installed.
    assert!(
        !Arc::ptr_eq(&capture_node, &linked_node),
        "the promotion must build a NEW node: the gate is fixed for a node's \
         lifetime (RFC 025 §3.1), so relabelling would leave the ungated one up"
    );
    // (3) …and the IDENTITY survived it. Same state dir, same device id, so the
    //     rebuild costs no second interactive login and peers see no new device.
    assert_eq!(
        linked_node.local_info().device_id,
        capture_device_id,
        "a rebuild is not a re-mint: the tailnet identity must survive"
    );

    // and unlink still takes it all down
    mesh.stop().await;
    assert!(!mesh.node_present());
    assert!(mesh.login_allow().is_empty());
    daemon.shutdown().await;
}

/// Park until a node is installed. The bring-up is spawned, and a promotion
/// tears the old node down before building, so "is there a node?" is briefly
/// false in the middle of one — a bare `node()` read races it.
#[cfg(unix)]
async fn await_node(
    mesh: &field_native::services::mesh::MeshHandle,
) -> Arc<field_native::services::mesh::MeshNode> {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        if let Some(node) = mesh.node() {
            return node;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "no node within 30s — the stub sidecar never brought one up"
        );
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
}

// ---- item 79: a torn-down node's sidecar ends, and the lanes follow the node --
//
// The W11 mini (2026-10-27 04:19Z) ran TWO sidecars on one tailscaled.state for
// 24 minutes after a capture → linked promotion. Two holders, both measured on
// the stand-in below (lanes/item79's probe): the boot-time lane transport kept
// the OLD node in the bridge's slot and was never re-installed, and truffle's
// `Node::drop` does not end a sidecar — only `Node::stop()` does — while
// `teardown_node` only dropped. What these rows do NOT witness: the stand-in
// speaks no QUIC, so `serve_inbound`'s listener does not bind here (on a real
// sidecar it binds, as on the mini's 9440, and holds a second reference), and
// no lane crosses a real tailnet.

/// The stand-in of the promotion row above, protocol 5, also answering
/// `tsnet:listen` (requestId echoed) so a listener request is not left hanging.
#[cfg(unix)]
fn item79_stub(dir: &std::path::Path) -> std::path::PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let stub = dir.join("sidecar-slim");
    std::fs::write(
        &stub,
        r#"#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *tsnet:start*)
      printf '%s\n' '{"event":"tsnet:started","data":{"state":"running","hostname":"truffle-vibefield-stub","dnsName":"truffle-vibefield-stub.tail0.ts.net","tailscaleIP":"127.0.0.1","nodeId":"nStub0CNTRL","loginName":"james@github","protocolVersion":5}}'
      ;;
    *tsnet:peers*)
      printf '%s\n' '{"event":"tsnet:peers","data":{"peers":[]}}'
      ;;
    *'"tsnet:listen"'*)
      rid=$(printf '%s' "$line" | sed -n 's/.*"requestId":"\([^"]*\)".*/\1/p')
      port=$(printf '%s' "$line" | sed -n 's/.*"port":\([0-9]*\).*/\1/p')
      printf '%s\n' "{\"event\":\"tsnet:listening\",\"data\":{\"port\":$port,\"requestId\":\"$rid\"}}"
      ;;
  esac
done
"#,
    )
    .unwrap();
    std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755)).unwrap();
    stub
}

/// A sidecar is gone when `ps` no longer lists it, or lists a zombie (the kill
/// landed; only the reap is pending).
#[cfg(unix)]
fn item79_alive(pid: u32) -> bool {
    std::process::Command::new("ps")
        .args(["-o", "stat=", "-p", &pid.to_string()])
        .output()
        .map(|out| {
            let stat = String::from_utf8_lossy(&out.stdout).trim().to_string();
            !stat.is_empty() && !stat.starts_with('Z')
        })
        .unwrap_or(false)
}

#[cfg(unix)]
async fn item79_until(what: &str, within: std::time::Duration, done: impl Fn() -> bool) {
    let deadline = tokio::time::Instant::now() + within;
    while !done() {
        assert!(tokio::time::Instant::now() < deadline, "{what}");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

/// Item 79 (1)+(2) — after the promotion NOTHING holds the capture node but this
/// row, and its sidecar has ENDED: one sidecar on the state dir, not two. The
/// row keeps its own reference throughout, so the sidecar's end is the
/// teardown's `stop()`, not a drop this row happened to make.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_promotion_lets_the_capture_node_go_and_ends_its_sidecar() {
    use field_native::contracts::MeshMode;
    use std::time::Duration;
    let dir = tempfile::tempdir().unwrap();
    let config = NativeConfig {
        sidecar_override: Some(item79_stub(dir.path())),
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
    };
    let daemon = bootstrap(config).await.unwrap();
    let mesh = &daemon.state.mesh;
    mesh.start(MeshMode::Capture, None).await.unwrap();
    let capture = await_node(mesh).await;
    let capture_pid = capture
        .sidecar_pid()
        .expect("the capture node's sidecar pid");
    // The precondition the mini had: the lane transport ON the capture node
    // (this row, the watch's copy, the bring-up's, and the transport's).
    item79_until(
        "the lane transport never took the capture node",
        Duration::from_secs(20),
        || Arc::strong_count(&capture) >= 4,
    )
    .await;

    assert!(mesh
        .start(MeshMode::Linked, Some("james@github".into()))
        .await
        .unwrap());
    let linked = await_node(mesh).await;
    assert!(!Arc::ptr_eq(&capture, &linked));
    let linked_pid = linked.sidecar_pid().expect("the linked node's sidecar pid");

    item79_until(
        "(1) after the promotion something besides this row still holds the capture node",
        Duration::from_secs(5),
        || Arc::strong_count(&capture) == 1,
    )
    .await;
    item79_until(
        "(2) the capture node's sidecar outlived the promotion (two sidecars, one state dir)",
        Duration::from_secs(5),
        || !item79_alive(capture_pid),
    )
    .await;
    assert!(
        item79_alive(linked_pid),
        "the linked node's sidecar is the one that runs"
    );
    drop((capture, linked));
    daemon.shutdown().await;
}

/// Item 79 (6) — `stop` ends the node's sidecar. It used to drop the node and
/// trust the drop, which ends no sidecar: every unlink, stop and rebuild left
/// one running for the life of the process.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn stopping_the_mesh_ends_the_nodes_sidecar() {
    use field_native::contracts::MeshMode;
    use std::time::Duration;
    let dir = tempfile::tempdir().unwrap();
    let config = NativeConfig {
        sidecar_override: Some(item79_stub(dir.path())),
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
    };
    let daemon = bootstrap(config).await.unwrap();
    let mesh = &daemon.state.mesh;
    mesh.start(MeshMode::Linked, Some("james@github".into()))
        .await
        .unwrap();
    let pid = await_node(mesh)
        .await
        .sidecar_pid()
        .expect("the node's sidecar pid");
    assert!(item79_alive(pid));
    mesh.stop().await;
    assert!(!mesh.node_present());
    item79_until(
        "(6) mesh.stop() left the node's sidecar running",
        Duration::from_secs(5),
        || !item79_alive(pid),
    )
    .await;
    daemon.shutdown().await;
}

/// Item 79 — the lanes FOLLOW the node: after the promotion the lane transport
/// rides the LINKED node (by identity, not by name — both nodes carry one
/// device id), so no lane is left on the ungated node and the gated one is not
/// left without a transport.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_lane_transport_follows_the_promotion_to_the_linked_node() {
    use field_native::contracts::MeshMode;
    use std::time::Duration;
    let dir = tempfile::tempdir().unwrap();
    let config = NativeConfig {
        sidecar_override: Some(item79_stub(dir.path())),
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
    };
    let daemon = bootstrap(config).await.unwrap();
    let mesh = &daemon.state.mesh;
    mesh.start(MeshMode::Capture, None).await.unwrap();
    let capture = await_node(mesh).await;
    item79_until(
        "the lane transport never rode the capture node",
        Duration::from_secs(20),
        || {
            daemon
                .lane_transport_on
                .node()
                .is_some_and(|n| Arc::ptr_eq(&n, &capture))
        },
    )
    .await;
    assert!(mesh
        .start(MeshMode::Linked, Some("james@github".into()))
        .await
        .unwrap());
    let linked = await_node(mesh).await;
    item79_until(
        "after the promotion the lane transport does not ride the linked node",
        Duration::from_secs(20),
        || {
            daemon
                .lane_transport_on
                .node()
                .is_some_and(|n| Arc::ptr_eq(&n, &linked))
        },
    )
    .await;
    mesh.stop().await;
    item79_until(
        "after stop the lane transport still names a node",
        Duration::from_secs(5),
        || daemon.lane_transport_on.node().is_none(),
    )
    .await;
    drop((capture, linked));
    daemon.shutdown().await;
}

// ---- TS-1 (track TS): no dead ends, on stand-in sidecars ----
//
// The sign-in states the floor now names (`LinkFacts`), each driven by a
// stand-in sidecar that speaks the events a real one sends (item 79's pattern).
// What these rows do NOT witness: tsnet itself — a real NeedsMachineAuth, a key
// a person expires in the console, the console's own pages. The live probe on
// the test tailnet (`mesh_capture_auth_key_probe.rs`) drives a real capture.

/// A stand-in that answers `tsnet:start` with `start` (shell, may background
/// later events), and peers/listen as item 79's does.
#[cfg(unix)]
fn ts1_stub(dir: &std::path::Path, start: &str) -> std::path::PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let stub = dir.join("sidecar-slim");
    let script = r#"#!/bin/sh
while IFS= read -r line; do
  case "$line" in
    *'"tsnet:start"'*)
START_BLOCK
      ;;
    *tsnet:peers*)
      printf '%s\n' '{"event":"tsnet:peers","data":{"peers":[]}}'
      ;;
    *'"tsnet:listen"'*)
      rid=$(printf '%s' "$line" | sed -n 's/.*"requestId":"\([^"]*\)".*/\1/p')
      port=$(printf '%s' "$line" | sed -n 's/.*"port":\([0-9]*\).*/\1/p')
      printf '%s\n' "{\"event\":\"tsnet:listening\",\"data\":{\"port\":$port,\"requestId\":\"$rid\"}}"
      ;;
  esac
done
"#
    .replace("START_BLOCK", start);
    std::fs::write(&stub, script).unwrap();
    std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o755)).unwrap();
    stub
}

/// A protocol-10 `tsnet:started`: the hosted control server and a key expiry.
#[cfg(unix)]
const TS1_STARTED: &str = r#"printf '%s\n' '{"event":"tsnet:started","data":{"state":"running","hostname":"truffle-vibefield-stub","dnsName":"truffle-vibefield-stub.tail0.ts.net","tailscaleIP":"127.0.0.1","nodeId":"nStub0CNTRL","loginName":"james@github","protocolVersion":10,"controlUrl":"https://controlplane.tailscale.com","keyExpiry":"2026-11-02T10:00:00Z"}}'"#;
/// 2026-11-02T10:00:00Z, the key expiry above, in ms.
#[cfg(unix)]
const TS1_EXPIRY_MS: i64 = 1_793_613_600_000;

/// TS-1 (P3) — a capture waits on the person, never a timer, and each new
/// sign-in address tsnet issues while it waits replaces the last. The second
/// half proves the value reaches the builder: a test's one-second timeout fails
/// the bring-up, typed `bring_up_failed`, where the product's `None` waits on.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_capture_waits_on_the_person_and_shows_each_new_address() {
    use field_native::contracts::{MeshMode, UnitState};
    use std::time::Duration;
    let dir = tempfile::tempdir().unwrap();
    let stub = ts1_stub(
        dir.path(),
        r#"      printf '%s\n' '{"event":"tsnet:authRequired","data":{"authUrl":"https://login.tailscale.com/a/first"}}'
      ( sleep 1; printf '%s\n' '{"event":"tsnet:authRequired","data":{"authUrl":"https://login.tailscale.com/a/second"}}' ) &"#,
    );
    let config = NativeConfig {
        sidecar_override: Some(stub.clone()),
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
    };
    assert_eq!(
        config.mesh_start_timeout, None,
        "the product waits for ever"
    );
    let daemon = bootstrap(config).await.unwrap();
    let mesh = &daemon.state.mesh;
    mesh.start(MeshMode::Capture, None).await.unwrap();
    item79_until(
        "the second address never replaced the first",
        Duration::from_secs(10),
        || mesh.health().auth_url.as_deref() == Some("https://login.tailscale.com/a/second"),
    )
    .await;
    // well past the stand-in's last word, still waiting, never failed
    tokio::time::sleep(Duration::from_millis(1500)).await;
    let health = mesh.health();
    assert!(matches!(health.state, UnitState::Starting), "{health:?}");
    let facts = mesh.link_facts();
    assert!(facts.failure.is_none(), "{facts:?}");
    let name = facts.machine_name.expect("the composed machine name");
    assert!(name.starts_with("truffle-vibefield-"), "{name}");
    daemon.shutdown().await;

    // the same stand-in, with a test's timeout: the value reaches the builder
    let dir = tempfile::tempdir().unwrap();
    let config = NativeConfig {
        sidecar_override: Some(ts1_stub(
            dir.path(),
            r#"      printf '%s\n' '{"event":"tsnet:authRequired","data":{"authUrl":"https://login.tailscale.com/a/first"}}'"#,
        )),
        mesh_start_timeout: Some(Duration::from_secs(1)),
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
    };
    let daemon = bootstrap(config).await.unwrap();
    let mesh = &daemon.state.mesh;
    mesh.start(MeshMode::Capture, None).await.unwrap();
    item79_until(
        "a one-second start timeout never failed the bring-up",
        Duration::from_secs(15),
        || matches!(mesh.health().state, UnitState::Degraded),
    )
    .await;
    assert_eq!(mesh.link_facts().failure, Some("bring_up_failed"));
    daemon.shutdown().await;
}

/// TS-1 (P4) — device approval is a named state: the sign-in is done, the
/// unit says who acts now, and the fact clears when the node comes up. Up, the
/// node's own facts arrive: the name Tailscale granted, its key's expiry, and
/// the hosted service's console.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn device_approval_is_a_named_state_until_the_node_comes_up() {
    use field_native::contracts::MeshMode;
    use std::time::Duration;
    let dir = tempfile::tempdir().unwrap();
    let start = format!(
        r#"      printf '%s\n' '{{"event":"tsnet:needsApproval"}}'
      ( sleep 1; {TS1_STARTED} ) &"#
    );
    let config = NativeConfig {
        sidecar_override: Some(ts1_stub(dir.path(), &start)),
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
    };
    let daemon = bootstrap(config).await.unwrap();
    let mesh = &daemon.state.mesh;
    mesh.start(MeshMode::Capture, None).await.unwrap();
    item79_until(
        "the approval never reached the unit",
        Duration::from_secs(10),
        || {
            mesh.link_facts().needs_approval
                && mesh.health().detail.as_deref() == Some("waiting for device approval")
        },
    )
    .await;
    assert!(mesh.health().auth_url.is_none(), "the sign-in is done");
    let _node = await_node(mesh).await;
    item79_until(
        "the node came up still marked as waiting",
        Duration::from_secs(5),
        || !mesh.link_facts().needs_approval,
    )
    .await;
    let facts = mesh.link_facts();
    assert_eq!(
        facts.machine_name.as_deref(),
        Some("truffle-vibefield-stub")
    );
    assert_eq!(facts.key_expiry_ms, Some(Some(TS1_EXPIRY_MS)));
    assert_eq!(
        facts.admin_url.as_deref(),
        Some("https://login.tailscale.com/admin/machines")
    );
    daemon.shutdown().await;
}

/// TS-1 (P5) — a running node that falls to NeedsLogin (its key expired, or it
/// was removed) is degraded with the words, and the fact stands for fieldd.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_running_node_signed_out_of_the_tailnet_says_so() {
    use field_native::contracts::{MeshMode, UnitState};
    use std::time::Duration;
    let dir = tempfile::tempdir().unwrap();
    let start = format!(
        r#"      {TS1_STARTED}
      ( sleep 1; printf '%s\n' '{{"event":"tsnet:stateChange","data":{{"state":"NeedsLogin"}}}}' ) &"#
    );
    let config = NativeConfig {
        sidecar_override: Some(ts1_stub(dir.path(), &start)),
        mesh_state_tick: Duration::from_millis(200),
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
    };
    let daemon = bootstrap(config).await.unwrap();
    let mesh = &daemon.state.mesh;
    mesh.start(MeshMode::Linked, Some("james@github".into()))
        .await
        .unwrap();
    let _node = await_node(mesh).await;
    item79_until(
        "the sign-out never reached the unit",
        Duration::from_secs(10),
        || mesh.link_facts().needs_login,
    )
    .await;
    let health = mesh.health();
    assert!(matches!(health.state, UnitState::Degraded), "{health:?}");
    assert!(
        health
            .detail
            .as_deref()
            .unwrap_or("")
            .contains("signed out"),
        "{health:?}"
    );
    daemon.shutdown().await;
}

/// TS-1 — renewal rebuilds an INSTALLED linked node whose gate did not move
/// (only a new bring-up hands out a new sign-in address), on the same identity.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn renewal_rebuilds_the_installed_node_on_its_own_identity() {
    use field_native::contracts::MeshMode;
    use field_native::services::mesh::StartOptions;
    let dir = tempfile::tempdir().unwrap();
    let config = NativeConfig {
        sidecar_override: Some(ts1_stub(dir.path(), &format!("      {TS1_STARTED}"))),
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
    };
    let daemon = bootstrap(config).await.unwrap();
    let mesh = &daemon.state.mesh;
    mesh.start(MeshMode::Linked, Some("james@github".into()))
        .await
        .unwrap();
    let before = await_node(mesh).await;
    // the control: the same posture, no renewal, is the idempotent no-op
    assert!(!mesh
        .start(MeshMode::Linked, Some("james@github".into()))
        .await
        .unwrap());
    assert!(mesh
        .start_with(
            MeshMode::Linked,
            Some("james@github".into()),
            StartOptions {
                renew: true,
                ..StartOptions::default()
            },
        )
        .await
        .unwrap());
    let after = await_node(mesh).await;
    assert!(!Arc::ptr_eq(&before, &after), "a renewal builds a new node");
    assert_eq!(
        before.local_info().device_id,
        after.local_info().device_id,
        "on the same identity: renewal is not a re-mint"
    );
    assert_eq!(mesh.login_allow(), vec!["james@github".to_string()]);
    drop((before, after));
    daemon.shutdown().await;
}

/// TS-1 — a node whose sidecar exits on its own is taken down, so nothing reads
/// it as up, and the unit says why in a typed word.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_sidecar_that_exits_takes_its_node_down_and_says_why() {
    use field_native::contracts::{MeshMode, UnitState};
    use std::time::Duration;
    let dir = tempfile::tempdir().unwrap();
    let start = format!(
        r#"      {TS1_STARTED}
      ( sleep 1; kill $$ ) &"#
    );
    let config = NativeConfig {
        sidecar_override: Some(ts1_stub(dir.path(), &start)),
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
    };
    let daemon = bootstrap(config).await.unwrap();
    let mesh = &daemon.state.mesh;
    mesh.start(MeshMode::Linked, Some("james@github".into()))
        .await
        .unwrap();
    let node = await_node(mesh).await;
    drop(node);
    item79_until(
        "the dead sidecar's node was never taken down",
        Duration::from_secs(10),
        || !mesh.node_present() && matches!(mesh.health().state, UnitState::Degraded),
    )
    .await;
    assert_eq!(mesh.link_facts().failure, Some("sidecar_exited"));
    assert!(
        mesh.health()
            .detail
            .as_deref()
            .unwrap_or("")
            .contains("sidecar exited"),
        "{:?}",
        mesh.health()
    );
    daemon.shutdown().await;
}

/// TS-1 (P7) — an auth key reaches the sidecar's start command, and nothing the
/// floor reports carries it; its `Debug` is redacted.
#[cfg(unix)]
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_auth_key_reaches_the_sidecar_and_nothing_the_floor_reports() {
    use field_native::contracts::MeshMode;
    use field_native::services::mesh::{AuthKey, StartOptions};
    use std::time::Duration;
    const KEY: &str = "tskey-auth-kTS1stub-0123456789abcdef";
    let dir = tempfile::tempdir().unwrap();
    let seen = dir.path().join("start-line");
    let start = format!(
        "      printf '%s\\n' \"$line\" > '{}'\n      {TS1_STARTED}",
        seen.display()
    );
    let config = NativeConfig {
        sidecar_override: Some(ts1_stub(dir.path(), &start)),
        ..NativeConfig::for_data_dir(dir.path().to_path_buf())
    };
    let daemon = bootstrap(config).await.unwrap();
    let mesh = &daemon.state.mesh;
    let key = AuthKey::new(KEY.to_owned());
    assert!(!format!("{key:?}").contains("tskey"), "{key:?}");
    mesh.start_with(
        MeshMode::Capture,
        None,
        StartOptions {
            auth_key: Some(key),
            renew: false,
        },
    )
    .await
    .unwrap();
    let _node = await_node(mesh).await;
    item79_until(
        "the stand-in never saw the start",
        Duration::from_secs(5),
        || seen.exists(),
    )
    .await;
    let line = std::fs::read_to_string(&seen).unwrap();
    assert!(line.contains(&format!("\"authKey\":\"{KEY}\"")), "{line}");
    let reported = format!(
        "{} {:?} {:?}",
        serde_json::to_string(&mesh.health()).unwrap(),
        mesh.link_facts(),
        health_json(&daemon)
    );
    assert!(!reported.contains("tskey"), "{reported}");
    daemon.shutdown().await;
}
