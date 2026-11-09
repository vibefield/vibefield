//! Opt-in hardware qualification fixture. Real PTY/cell, Freeway host and Truffle
//! sidecar; only the product approval service is supplied by this test. The
//! approval endpoint accepts the sidecar's authenticated same-login identity,
//! restricts it to this ephemeral namespace, and never returns a signing key.
//! The phone uses the shipping Swift Freeway, routed client and Metal scene.
mod common;

use data_encoding::BASE64URL_NOPAD;
use field_native::mgmt::mesh::{build_serve_config, SecretDoor, ServeConfigInput};
use field_native::services::terminal_client::ControlClient;
use field_native::{bootstrap, config::NativeConfig};
use hmac::{Hmac, KeyInit, Mac};
use serde_json::json;
use sha2::Sha256;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::timeout;
use truffle_core::proxy::{ProxyConfig, ProxyTarget};

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[tokio::test]
#[ignore = "physical Swift client; requires explicit isolated fixture directory and test auth key"]
async fn serve_real_terminal_to_swift_qualification_clients() {
    let out = PathBuf::from(
        std::env::var("VF_GHOSTTY_PROBE_DIRECTORY").expect("fixture output directory"),
    );
    assert!(out.is_dir());
    let key = common::authkey().expect("test auth key must be configured");
    let sidecar = common::vendored_sidecar().expect("the pinned product sidecar");
    let app_id = common::probe_app_id();
    let state = tempfile::tempdir().unwrap();
    let node = common::build_node(&app_id, "ghosttyhost", state.path(), &key, &sidecar).await;
    let login = timeout(Duration::from_secs(60), async {
        loop {
            if let Some(ip) = node.local_info().ip {
                if let Ok(Some(identity)) = node.whois(&ip.to_string()).await {
                    if let Some(login) = identity.login_name {
                        break login;
                    }
                }
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
    })
    .await
    .expect("host login");
    let hostname = node.local_info().tailscale_hostname;
    let dns = node
        .local_info()
        .dns_name
        .unwrap_or_else(|| hostname.clone());
    let data = tempfile::Builder::new()
        .prefix("vf-g14")
        .tempdir_in("/tmp")
        .unwrap();
    let daemon = bootstrap(NativeConfig::for_data_dir(data.path().to_path_buf()))
        .await
        .unwrap();
    let mut routes = daemon.state.terminal_routes.clone();
    timeout(
        Duration::from_secs(30),
        routes.wait_for(|r| {
            r.cells
                .iter()
                .any(|c| c.doors.is_some() && c.grant_key.is_some())
        }),
    )
    .await
    .unwrap()
    .unwrap();
    let cell = routes
        .borrow()
        .cells
        .iter()
        .find(|c| c.doors.is_some() && c.grant_key.is_some())
        .unwrap()
        .clone();
    let (control, _events) =
        ControlClient::connect(&cell.endpoints.control_socket, &cell.endpoints.auth_token)
            .await
            .unwrap();
    let input_file = data.path().join("received-input.txt");
    let program = r#"
printf 'Ghostty migration: ASCII 中 é 👩‍💻 🛙X\n'
while IFS= read -r line; do
  printf '%s\n' "$line" >> "$QUALIFICATION_INPUT_PATH"
  if [ "$line" = G14-DRAW-LOGO ]; then
    printf '\033[2J\033[H\033[38;5;208m████████  ▄▄▄▄  ▐▛███▜▌\r\n████████  ████  ▝▜███▛▘\r\n████████  ▀▀▀▀    ▘▘ ▝▝\033[0m\r\n'
    printf 'normal text / bold / 中 é 👩‍💻\r\n\033[31mred \033[32mgreen \033[38;2;10;120;200mtruecolor\033[0m\r\n'
  else
    printf '%s\n' "$line"
  fi
done
"#;
    let session = control.create_session(json!({
        "executable":"/bin/sh", "args":["-c", program],
        "cols":80,"rows":24,"persistence":"keep-until-exit",
        "environment":{"mode":"clean","variables":{"QUALIFICATION_INPUT_PATH":input_file.to_str().unwrap()}}
    })).await.unwrap();
    let freeway = daemon.state.freeway.clone();
    let mut freeway_state = freeway.state_rx();
    freeway.declare(json!({"deviceId":"dev-ghostty-qualification","admit":[],"doors":{},"exposure":{"terminals":true}}));
    let up = timeout(
        Duration::from_secs(20),
        freeway_state.wait_for(|s| s["up"] == true),
    )
    .await
    .unwrap()
    .unwrap()
    .clone();
    let target = json!({"kind":"port","port":up["port"]});
    let cfg = build_serve_config(ServeConfigInput {
        serve_id: "qualification-freeway",
        name: "qualification-freeway",
        target: &target,
        listen_port: Some(field_native::registries::ports::FREEWAY_SERVE as u64),
        preview_dir: None,
        allow: vec![login.clone()],
        tls: Some(false),
        path_secret: up["pathSecret"].as_str(),
        secret_door: SecretDoor::Freeway,
        routes: &json!([]),
        headers: vec![],
    })
    .unwrap();
    node.proxy().add(cfg).await.unwrap();

    // Test-only approval/status service, behind the same sidecar identity gate.
    let http = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let bootstrap_port = 30080;
    node.proxy()
        .add(ProxyConfig {
            id: "qualification-status".into(),
            name: "qualification-status".into(),
            listen_port: bootstrap_port,
            target: ProxyTarget::default(),
            announce: false,
            tls: false,
            allow_non_loopback: false,
            allow: vec![login.clone()],
            routes: vec![truffle_core::proxy::ProxyRoute {
                prefix: "/".into(),
                target_url: Some(format!(
                    "http://127.0.0.1:{}",
                    http.local_addr().unwrap().port()
                )),
                dir: None,
                fallback: None,
                strip_prefix: false,
                allow: vec![],
                // No response header (EL8-TRUFFLE, the EL8 to truffle 0.7.27, 2026-11-07):
                // truffle #254's per-route and per-serve `headers` stay empty until DR-1 (B)
                // asks, as production's literals name them (mgmt/mesh.rs `parse_cell_routes`).
                headers: vec![],
            }],
            accept_app_capabilities: vec![],
            headers: vec![],
        })
        .await
        .unwrap();
    let ready = json!({"appId":app_id,"hostname":hostname,"host":dns,"login":login,"bootstrapPort":bootstrap_port,"sessionId":session.id,"deviceId":"dev-ghostty-qualification","selectionTextSupported":field_native::tp::wire::CELL_CAPABILITIES.contains(&"selection-text")});
    std::fs::write(
        out.join("ready.json"),
        serde_json::to_vec_pretty(&ready).unwrap(),
    )
    .unwrap();
    println!("QUALIFICATION_FIXTURE_READY");
    let deadline = now_ms() + 30 * 60 * 1000;
    while now_ms() < deadline && !out.join("stop").exists() {
        let Ok(Ok((mut socket, _))) = timeout(Duration::from_secs(1), http.accept()).await else {
            continue;
        };
        let mut request = Vec::new();
        while !request.windows(4).any(|b| b == b"\r\n\r\n") && request.len() < 16384 {
            let mut buf = [0u8; 2048];
            let Ok(Ok(n)) = timeout(Duration::from_secs(5), socket.read(&mut buf)).await else {
                break;
            };
            if n == 0 {
                break;
            }
            request.extend_from_slice(&buf[..n]);
        }
        let request = String::from_utf8_lossy(&request);
        let header = |name: &str| {
            request
                .lines()
                .filter_map(|l| l.split_once(':'))
                .find(|(k, _)| k.eq_ignore_ascii_case(name))
                .map(|(_, v)| v.trim().to_owned())
        };
        let caller = header("tailscale-node-id").unwrap_or_default();
        let peers = node.peers().await;
        let allowed = header("tailscale-user-login").as_deref() == Some(login.as_str())
            && peers.iter().any(|p| p.tailscale_id == caller);
        let (status, body) = if !allowed {
            (403, json!({"error":"not admitted"}))
        } else if request.starts_with("GET /status ") {
            let sessions = control
                .list_sessions()
                .await
                .unwrap()
                .iter()
                .map(|s| json!({"id":s.id,"exited":s.exited}))
                .collect::<Vec<_>>();
            (
                200,
                json!({"input":std::fs::read_to_string(&input_file).unwrap_or_default(),"sessions":sessions}),
            )
        } else if request.starts_with("GET /ready ") {
            freeway.set_peers(peers.iter().map(|p|json!({"deviceId":format!("dev-{}",p.tailscale_id),"nodeId":p.tailscale_id})).collect());
            freeway.declare(json!({"deviceId":"dev-ghostty-qualification","admit":peers.iter().map(|p|json!({"deviceId":format!("dev-{}",p.tailscale_id),"role":"phone"})).collect::<Vec<_>>(),"doors":{},"exposure":{"terminals":true}}));
            let mut placements = serde_json::Map::new();
            placements.insert(session.id.clone(), json!({"cellBootId":cell.cell_boot_id}));
            freeway.set_sessions(placements);
            let protected = json!({"v":1,"typ":"FreewayApproval","iss":"fieldd","alg":"HS256","kid":{"floorBootId":up["floorBootId"],"keyGeneration":up["keyGeneration"]}});
            let issued = now_ms();
            let claims = json!({"audienceFloorBootId":up["floorBootId"],"clientId":format!("freeway:{login}#{caller}"),"principal":{"kind":"tailnet","login":login,"tailscaleId":caller},"rights":["geometry","input","read"],"issuedAt":issued,"expiresAt":issued+field_native::registries::freeway::APPROVAL_TTL_MS,"nonce":BASE64URL_NOPAD.encode(&rand::random::<[u8; 16]>())});
            let input = field_native::tp::jcs::canonical_json(
                &json!({"protected":protected,"claims":claims}),
            )
            .unwrap();
            let mut mac = Hmac::<Sha256>::new_from_slice(
                &hex::decode(up["freewayKeyHex"].as_str().unwrap()).unwrap(),
            )
            .unwrap();
            mac.update(input.as_bytes());
            let approval = json!({"protected":protected,"claims":claims,"mac":BASE64URL_NOPAD.encode(&mac.finalize().into_bytes())});
            field_native::freeway::approval::verify(
                &field_native::freeway::approval::ApprovalKey {
                    floor_boot_id: up["floorBootId"].as_str().unwrap().to_owned(),
                    key_generation: up["keyGeneration"].as_u64().unwrap(),
                    key: hex::decode(up["freewayKeyHex"].as_str().unwrap()).unwrap(),
                },
                &approval,
                now_ms(),
            )
            .expect("fixture approval verifies against the production contract");
            (200, json!({"approval":approval}))
        } else {
            (404, json!({"error":"unknown qualification route"}))
        };
        let body = body.to_string();
        let response=format!("HTTP/1.1 {status} Result\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
        let _ = socket.write_all(response.as_bytes()).await;
        let _ = socket.shutdown().await;
    }
    node.proxy().remove("qualification-status").await.ok();
    node.proxy().remove("qualification-freeway").await.ok();
    control.terminate(&session.id, "user").await.ok();
    daemon.shutdown().await;
    node.stop().await;
    println!("QUALIFICATION_FIXTURE_STOPPED");
}
