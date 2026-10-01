//! DS-1b — the egress witness on a REAL tailnet (design-06 §3, DS-L5): floor A
//! answers `native.mesh.egress.proxy` and `native.mesh.egress.route.*` over its
//! real management socket, through the truffle arm, from truffle's RFC 026
//! crate and a protocol-6 sidecar built from the same branch; node B serves a
//! door; and B's sidecar names A's NODE on every request that came through A's
//! egress — E1 (the node's own SOCKS5, PeerLink's road) and E2 (a loopback
//! route with a fixed target, the terminal rewriter's road).
//!
//! WHAT IS REAL: two ephemeral nodes on the tailnet `.env`'s key names; the
//! floor, bootstrapped in-process, with its management facade, its egress
//! handler's refusal order and the truffle arm (`TruffleEgress`, the
//! `RouteMirror` before the sidecar's table); tsnet's loopback SOCKS5 and the
//! sidecar's egress routes; B's sidecar's reverse proxy stamping the caller's
//! identity from WhoIs. The SOCKS5 client is the test's own (RFC 1928/1929),
//! and it is the only code here that opens a connection for an egress rung:
//! every connect it makes is recorded and asserted to be a LOOPBACK address,
//! with B's MagicDNS name sent as a DOMAINNAME so the PROXY resolves it.
//!
//! WHAT IS NOT: the floor's node is minted by the harness from the auth key
//! and installed with `MeshHandle::install_node_for_tests` (a floor cannot
//! join a tailnet headlessly; its bring-up is an interactive login), so the
//! node is the harness's, not the floor's own bring-up; both nodes sit on one
//! machine (no DERP between networks); and the Tailscale app is not asserted
//! quit. That run, two desktops with the app QUIT, is James's after the pin
//! moves.
//!
//! Needs the feature AND a local patch (truffle-core 0.7.14 has no egress), a
//! sidecar built from the same branch, and `TRUFFLE_TEST_AUTHKEY` (the
//! harness reads `.env` walking up from this crate; from another worktree,
//! export it in the shell that runs cargo):
//!
//! ```sh
//! FIELD_NATIVE_SIDECAR_PATH=<truffle-rfc025/packages/sidecar-slim built with go build> \
//! cargo test -p field-native --features truffle-egress \
//!   --config <a file holding [patch.crates-io] truffle-core = { path = "<truffle-rfc025>/crates/truffle-core" }> \
//!   --test mesh_egress_probe -- --ignored --nocapture
//! ```
#![cfg(feature = "truffle-egress")]

mod common;

use common::{
    authkey, build_gated_node, build_node, probe_app_id, redact, rendezvous, sidecar, AUTHKEY_ENV,
};
use field_native::registries::ports::TERMINAL_CELLS_SERVE;
use field_native::{bootstrap, config::NativeConfig, local_ipc, pairing, RunningDaemon};
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;
use truffle_core::proxy::{ProxyConfig, ProxyTarget};

/// The management channel, as fieldd speaks it: paired hello, then calls.
struct Mgmt {
    reader: tokio::io::Lines<BufReader<tokio::io::ReadHalf<local_ipc::ClientStream>>>,
    writer: tokio::io::WriteHalf<local_ipc::ClientStream>,
    next_id: u64,
}

impl Mgmt {
    async fn connect(daemon: &RunningDaemon) -> Self {
        let stream = local_ipc::connect(&daemon.mgmt_endpoint)
            .await
            .expect("connect mgmt");
        let (r, w) = tokio::io::split(stream);
        let mut me = Self {
            reader: BufReader::new(r).lines(),
            writer: w,
            next_id: 1,
        };
        let secret = hex::decode(
            std::fs::read_to_string(&daemon.pairing_file)
                .unwrap()
                .trim(),
        )
        .unwrap();
        let ts = pairing::now_epoch_secs();
        let boot = "ds1b-egress-probe";
        let mac = pairing::compute_mac(&secret, boot, ts);
        let ack = me
            .call(
                "native.lifecycle.hello",
                json!({
                    "contractsVersion":"0.1.0","minCompatible":"0.1.0","clientKind":"fieldd",
                    "credential":{"bootId":boot,"ts":ts,"mac":mac}
                }),
            )
            .await;
        assert!(ack.get("result").is_some(), "hello refused: {ack}");
        me
    }

    /// One request, its response; notifications in between are skipped. The
    /// budget is a real sidecar's: an add reads the netmap (up to 10 s) and the
    /// core waits 20 s for it.
    async fn call(&mut self, method: &str, params: Value) -> Value {
        let id = self.next_id;
        self.next_id += 1;
        let line = format!(
            "{}\n",
            json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})
        );
        self.writer.write_all(line.as_bytes()).await.unwrap();
        loop {
            let line = timeout(Duration::from_secs(40), self.reader.next_line())
                .await
                .expect("mgmt reply deadline")
                .expect("mgmt read error")
                .expect("mgmt connection closed");
            let msg: Value = serde_json::from_str(&line).expect("json line");
            if msg.get("id") == Some(&json!(id)) {
                return msg;
            }
        }
    }
}

/// B's door: answers every request with the `Tailscale-Node-Id` B's sidecar
/// stamped on it (empty when none was), and keeps a copy.
async fn echo_door(seen: Arc<Mutex<Vec<String>>>) -> (u16, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let task = tokio::spawn(async move {
        loop {
            let Ok((mut sock, _)) = listener.accept().await else {
                return;
            };
            let seen = seen.clone();
            tokio::spawn(async move {
                let mut head = Vec::new();
                let mut buf = [0u8; 1024];
                while !head.windows(4).any(|w| w == b"\r\n\r\n") {
                    let Ok(n) = sock.read(&mut buf).await else {
                        return;
                    };
                    if n == 0 || head.len() > 64 * 1024 {
                        return;
                    }
                    head.extend_from_slice(&buf[..n]);
                }
                let text = String::from_utf8_lossy(&head);
                let node_id = text
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.trim()
                            .eq_ignore_ascii_case("tailscale-node-id")
                            .then(|| value.trim().to_string())
                    })
                    .unwrap_or_default();
                seen.lock().unwrap().push(node_id.clone());
                let reply = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{node_id}",
                    node_id.len()
                );
                let _ = sock.write_all(reply.as_bytes()).await;
                let _ = sock.shutdown().await;
            });
        }
    });
    (port, task)
}

/// Every TCP connection this test opens for an egress rung, by address.
#[derive(Default)]
struct Connects(Vec<String>);

impl Connects {
    async fn open(&mut self, address: &str) -> std::io::Result<TcpStream> {
        self.0.push(address.to_string());
        TcpStream::connect(address).await
    }
}

/// RFC 1928 + RFC 1929 to `host:port` THROUGH the proxy, the host sent as a
/// DOMAINNAME (0x03) so the proxy resolves it — never the OS.
async fn socks5(
    connects: &mut Connects,
    proxy: &str,
    username: &str,
    password: &str,
    host: &str,
    port: u16,
) -> std::io::Result<TcpStream> {
    let other = std::io::Error::other;
    let mut s = connects.open(proxy).await?;
    s.write_all(&[0x05, 0x01, 0x02]).await?;
    let mut two = [0u8; 2];
    s.read_exact(&mut two).await?;
    if two != [0x05, 0x02] {
        return Err(other(format!(
            "the proxy chose method {two:?}, not username/password"
        )));
    }
    let mut auth = vec![0x01, username.len() as u8];
    auth.extend_from_slice(username.as_bytes());
    auth.push(password.len() as u8);
    auth.extend_from_slice(password.as_bytes());
    s.write_all(&auth).await?;
    s.read_exact(&mut two).await?;
    if two != [0x01, 0x00] {
        return Err(other("the proxy refused the credential".to_string()));
    }
    let mut request = vec![0x05, 0x01, 0x00, 0x03, host.len() as u8];
    request.extend_from_slice(host.as_bytes());
    request.extend_from_slice(&port.to_be_bytes());
    s.write_all(&request).await?;
    let mut head = [0u8; 4];
    s.read_exact(&mut head).await?;
    if head[1] != 0x00 {
        return Err(other(format!(
            "the proxy refused the CONNECT (REP {})",
            head[1]
        )));
    }
    let skip = match head[3] {
        0x01 => 4 + 2,
        0x04 => 16 + 2,
        0x03 => {
            let mut len = [0u8; 1];
            s.read_exact(&mut len).await?;
            len[0] as usize + 2
        }
        atyp => return Err(other(format!("unknown BND address type {atyp}"))),
    };
    let mut rest = vec![0u8; skip];
    s.read_exact(&mut rest).await?;
    Ok(s)
}

/// One HTTP GET over a stream already reaching B's door; the body is the node
/// id the door saw.
async fn who_did_the_door_see(mut stream: TcpStream, host: &str) -> std::io::Result<String> {
    let request = format!("GET /whoami HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).await?;
    let mut response = Vec::new();
    timeout(Duration::from_secs(30), stream.read_to_end(&mut response))
        .await
        .map_err(|_| std::io::Error::other("the door never answered"))??;
    let text = String::from_utf8_lossy(&response).into_owned();
    let Some((head, body)) = text.split_once("\r\n\r\n") else {
        return Err(std::io::Error::other(format!(
            "not an HTTP response: {text:?}"
        )));
    };
    let status = head.lines().next().unwrap_or_default();
    if !status.starts_with("HTTP/1.1 200") {
        return Err(std::io::Error::other(format!("the door answered {status}")));
    }
    Ok(body.to_string())
}

fn is_loopback(address: &str) -> bool {
    address
        .parse::<SocketAddr>()
        .map(|a| a.ip().is_loopback())
        .unwrap_or(false)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "joins a real tailnet; needs TRUFFLE_TEST_AUTHKEY, the feature, the local patch, a protocol-6 sidecar"]
async fn a_peer_door_is_reached_through_the_floors_egress_and_names_the_floors_node() {
    let Some(key) = authkey() else {
        eprintln!("[skip] mesh_egress_probe: {AUTHKEY_ENV} not set");
        return;
    };
    let Some(sidecar) = sidecar() else {
        eprintln!("[skip] mesh_egress_probe: no truffle sidecar found");
        return;
    };
    let app_id = probe_app_id();
    eprintln!(
        "[probe] app_id={app_id} sidecar={} authkey={}",
        sidecar.display(),
        redact(&key)
    );

    // ---- two nodes: B first, so A can be GATED on B's (the account's) login ----
    let state_a = tempfile::tempdir().expect("state a");
    let state_b = tempfile::tempdir().expect("state b");
    let node_b = build_node(&app_id, "egressb", state_b.path(), &key, &sidecar).await;
    let login = node_b.local_info().login_name;
    let node_a = match login.as_deref() {
        Some(login) => {
            eprintln!("[probe] node A is gated on the account's login (login_allow = [it])");
            build_gated_node(
                &app_id,
                "egressa",
                state_a.path(),
                &key,
                &sidecar,
                &[login.to_string()],
            )
            .await
            .expect("a gated node A (protocol >= 5)")
        }
        None => {
            eprintln!("[probe] the netmap names no login for B; node A runs UNGATED");
            build_node(&app_id, "egressa", state_a.path(), &key, &sidecar).await
        }
    };
    let node_a = Arc::new(node_a);
    let info_a = node_a.local_info();
    let info_b = node_b.local_info();
    let host_b = info_b
        .dns_name
        .clone()
        .unwrap_or_else(|| info_b.tailscale_hostname.clone());
    let host_b = host_b.trim_end_matches('.').to_string();
    let _ = rendezvous(&node_a, &info_b.tailscale_hostname).await;
    let _ = rendezvous(&node_b, &info_a.tailscale_hostname).await;
    eprintln!(
        "[probe] nodes up: A id={} · B {host_b} id={}",
        info_a.tailscale_id, info_b.tailscale_id
    );
    assert!(!info_a.tailscale_id.is_empty(), "A has a stable node id");

    // ---- B serves a door on the one routable port (DS-L6) ----
    let seen = Arc::new(Mutex::new(Vec::<String>::new()));
    let (door_port, _door) = echo_door(seen.clone()).await;
    node_b
        .proxy()
        .add(ProxyConfig {
            id: "ds1b-egress-door".into(),
            name: "ds1b-egress-door".into(),
            listen_port: TERMINAL_CELLS_SERVE,
            target: ProxyTarget {
                host: "127.0.0.1".into(),
                port: door_port,
                scheme: "http".into(),
            },
            announce: false,
            tls: false,
            allow_non_loopback: false,
            allow: vec![],
            routes: vec![],
        })
        .await
        .expect("B serves its door");
    eprintln!("[probe] B serves its door on :{TERMINAL_CELLS_SERVE} -> 127.0.0.1:{door_port}");

    // ---- floor A, with node A installed, over its real management socket ----
    let dir = tempfile::tempdir().expect("floor dir");
    let daemon = bootstrap(NativeConfig::for_data_dir(dir.path().to_path_buf()))
        .await
        .expect("bootstrap floor A");
    assert_eq!(daemon.state.mesh.egress().arm(), "truffle");
    daemon.state.mesh.install_node_for_tests(node_a.clone());
    let mut mgmt = Mgmt::connect(&daemon).await;

    // ---- E1: the node's own SOCKS5 (PeerLink's road) ----
    let proxy = mgmt.call("native.mesh.egress.proxy", json!({})).await;
    let grant = proxy.get("result").cloned().unwrap_or_else(|| {
        panic!("floor A refused the proxy ask: {}", proxy["error"]);
    });
    let address = grant["address"].as_str().expect("address").to_string();
    let username = grant["username"].as_str().expect("username").to_string();
    let credential = grant["credential"]
        .as_str()
        .expect("credential")
        .to_string();
    assert!(
        is_loopback(&address),
        "the proxy listens on loopback: {address}"
    );
    assert_eq!(username, "tsnet");
    assert!(!credential.is_empty());
    eprintln!("[probe] E1: floor A answered native.mesh.egress.proxy -> {address} as {username}");

    let mut refused = Connects::default();
    let wrong = socks5(
        &mut refused,
        &address,
        &username,
        "not-the-credential",
        &host_b,
        TERMINAL_CELLS_SERVE,
    )
    .await;
    assert!(
        matches!(&wrong, Err(e) if e.to_string().contains("refused the credential")),
        "the credential is the proxy's whole gate: {wrong:?}"
    );

    let mut e1 = Connects::default();
    let through = timeout(
        Duration::from_secs(60),
        socks5(
            &mut e1,
            &address,
            &username,
            &credential,
            &host_b,
            TERMINAL_CELLS_SERVE,
        ),
    )
    .await
    .expect("E1 SOCKS5 deadline")
    .expect("E1 reaches B's door through A's proxy");
    let saw = who_did_the_door_see(through, &host_b)
        .await
        .expect("E1 GET");
    eprintln!(
        "[probe] E1: B's door saw Tailscale-Node-Id={saw} (A's own id {})",
        info_a.tailscale_id
    );
    assert_eq!(
        saw, info_a.tailscale_id,
        "B's sidecar names A's node: the dial left as A"
    );
    assert_eq!(
        e1.0,
        vec![address.clone()],
        "the ONLY connect was to the proxy's loopback address"
    );

    // ---- E2: a loopback route with a fixed target (the rewriter's road) ----
    let target = format!("{host_b}:{TERMINAL_CELLS_SERVE}");
    let added = mgmt
        .call(
            "native.mesh.egress.route.add",
            json!({"id": "egress-probe-b-9422", "target": target}),
        )
        .await;
    let bound = added.get("result").cloned().unwrap_or_else(|| {
        panic!("floor A refused the route: {}", added["error"]);
    });
    let listen = bound["listen"].as_str().expect("listen").to_string();
    assert!(
        is_loopback(&listen),
        "a route listens on loopback: {listen}"
    );
    eprintln!(
        "[probe] E2: floor A bound route egress-probe-b-9422 -> {target} at {listen} (revision {}, floor boot {})",
        bound["revision"], bound["bootId"]
    );
    let mut e2 = Connects::default();
    let routed = e2.open(&listen).await.expect("E2 connect");
    let saw = who_did_the_door_see(routed, &host_b).await.expect("E2 GET");
    eprintln!("[probe] E2: B's door saw Tailscale-Node-Id={saw} through the route");
    assert_eq!(
        saw, info_a.tailscale_id,
        "the route's splice leaves as A too"
    );
    assert_eq!(
        e2.0,
        vec![listen.clone()],
        "the only connect was to the route's loopback listener"
    );

    // the real sidecar refuses ANY held id, so a re-add is the arm's mirror
    let again = mgmt
        .call(
            "native.mesh.egress.route.add",
            json!({"id": "egress-probe-b-9422", "target": target}),
        )
        .await;
    assert_eq!(
        again["result"]["listen"],
        json!(listen),
        "a re-add answers the bound listener: {again}"
    );
    let stranger = mgmt
        .call(
            "native.mesh.egress.route.add",
            json!({"id": "egress-probe-stranger", "target": format!("nobody-here.{}:{TERMINAL_CELLS_SERVE}", host_b.split_once('.').map(|(_, t)| t).unwrap_or("ts.net"))}),
        )
        .await;
    eprintln!(
        "[probe] E2: a target outside the netmap -> {}",
        stranger["error"]["data"]
    );
    assert_eq!(
        stranger["error"]["data"]["details"]["code"], "TARGET_NOT_PEER",
        "{stranger}"
    );
    let listed = mgmt.call("native.mesh.egress.route.list", json!({})).await;
    assert_eq!(
        listed["result"]["routes"].as_array().map(Vec::len),
        Some(1),
        "{listed}"
    );
    let removed = mgmt
        .call(
            "native.mesh.egress.route.remove",
            json!({"id": "egress-probe-b-9422"}),
        )
        .await;
    assert_eq!(removed["result"]["id"], "egress-probe-b-9422", "{removed}");
    let twice = mgmt
        .call(
            "native.mesh.egress.route.remove",
            json!({"id": "egress-probe-b-9422"}),
        )
        .await;
    assert_eq!(
        twice["error"]["data"]["kind"], "NOT_FOUND",
        "the sidecar's own answer: {twice}"
    );
    let after = timeout(Duration::from_secs(5), TcpStream::connect(&listen)).await;
    let gone = match after {
        Ok(Ok(mut stream)) => {
            let mut byte = [0u8; 1];
            matches!(
                timeout(Duration::from_secs(5), stream.read(&mut byte)).await,
                Ok(Ok(0)) | Ok(Err(_))
            )
        }
        _ => true,
    };
    assert!(gone, "a removed route's listener no longer reaches B");
    eprintln!("[probe] E2: removed; a second remove is NOT_FOUND; the listener is gone");
    eprintln!("[probe] B's door saw, in order: {:?}", seen.lock().unwrap());

    drop(mgmt);
    daemon.shutdown().await;
    let _ = node_b.proxy().remove("ds1b-egress-door").await;
    node_a.stop().await;
    node_b.stop().await;
}
