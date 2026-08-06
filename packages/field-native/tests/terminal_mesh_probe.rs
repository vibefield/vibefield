//! GT-4a's kill matrix over a REAL tailnet: does the floor, wired the way
//! `terminal_mesh.rs` wires it, actually serve a peer?
//!
//! Three nodes in one process, the shape `quic_lane_probe.rs` established:
//!
//!   alpha — the HOST. A real `TerminalService` with a real PTY under it,
//!           carrying our `TruffleTerminalMesh` with a mirror-write capability.
//!   beta  — a viewer holding NO capability. It must SEE and ATTACH, and its
//!           attachment must come back read-only.
//!   gamma — a viewer holding the SAME capability. Same attach, read-write.
//!
//! The viewers serve their mesh directly rather than behind a `TerminalService`:
//! the runtime a service dispatches remote ops to is `TruffleTerminalMesh`'s
//! own, captured here before the adapter moves, so this drives the same object
//! the product would — one JSON-RPC hop closer, and no font database per viewer.
//!
//! WHAT THIS PROVES, EXACTLY. The wire is real: three tailnet identities, real
//! WireGuard, real QUIC, real advertisement convergence through the
//! `terminal.v1.hosts` SyncedStore. And it runs with NO fieldd anywhere, which
//! is the positive half of the fieldd-down asymmetry (native-floor §7): TSP1 is
//! native-served, so a peer sees and attaches while the host's product plane is
//! absent. The `UNAVAILABLE {device}` half of that row belongs to fieldd's
//! control path and is not in this crate.
//!
//! WHAT ONLY TWO PHYSICAL DEVICES CAN PROVE. One process on one machine means
//! the three nodes share a host, a clock, and a NAT: DERP relaying and hole
//! punching between distinct networks, advertisement TTL across genuine clock
//! skew, and a host whose fieldd is killed on a DIFFERENT machine than the
//! viewer are all outside what this can say. It is the strongest in-process
//! statement available, not a substitute for GT-5's phone-on-tailnet run.
//!
//! See `common/mod.rs` for the gate and the tailnet courtesies. Run it:
//!   cargo test -p field-native --test terminal_mesh_probe -- --ignored --nocapture

mod common;

use common::{authkey, build_node, probe_app_id, redact, sidecar, AUTHKEY_ENV};
use field_native::registries;
use field_native::services::terminal_client::ControlClient;
use field_native::services::terminal_mesh;
use ghosttea::mesh::RemoteSessionOpen;
use ghosttea::tunnel_protocol::TunnelInput;
use ghosttea::{
    ConfigLoadOptions, ConfigManager, FrameHub, RemoteHostSummary, SessionRegistry,
    TerminalService, TerminalServiceConfig, TextEngine,
};
use ghosttea_truffle::{MeshRuntime, TruffleTerminalMesh};
use serde_json::json;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::time::timeout;
use truffle_core::network::tailscale::TailscaleProvider;
use truffle_core::Node;

/// The mirror-write string under test. A literal here and nowhere else: this is
/// the value the host gates on and the value gamma presents.
const CAPABILITY: &str = "gt4-mirror-write-probe";

/// A quiet PTY tenant that dies on the first rung of the ladder, matching
/// tests/terminal_unit.rs.
const TENANT: &str = "/bin/cat";

/// Advertisements go out on upstream's own interval and have to reach two
/// peers through the store's sync path, so discovery is polled rather than
/// awaited on an event.
const DISCOVERY_BUDGET: Duration = Duration::from_secs(90);

/// A viewer, wired to the point where its runtime answers remote ops.
struct Viewer {
    runtime: MeshRuntime,
    /// The host-config publisher. HELD, not dropped: a closed publisher is read
    /// by every connection handler as a fault, so letting it fall out of scope
    /// would cut the connections this test is about to make.
    _presentation: tokio::sync::watch::Sender<Arc<ghosttea::TerminalPresentationConfig>>,
    _serving: tokio::task::JoinHandle<()>,
}

/// Serve a mesh on `node` with `capability`, and hand back the door remote ops
/// go through. The capability is BOTH what this node would advertise as a host
/// and what it presents as a viewer (`MeshReady.capability` → the dial's
/// `access_token`), which is why a viewer's posture is set here and nowhere
/// else.
async fn viewer(node: Arc<Node<TailscaleProvider>>, capability: Option<String>) -> Viewer {
    let config = terminal_mesh::truffle_config(capability).expect("upstream config");
    let mesh = TruffleTerminalMesh::new(node, config).expect("terminal mesh adapter");
    let runtime = mesh.runtime();
    let overlay = tempfile::Builder::new()
        .prefix("vfgt4-cfg")
        .tempdir_in("/tmp")
        .expect("overlay dir");
    // An overlay that does not exist is a valid empty config upstream, which is
    // exactly the presentation a viewer with no user settings should carry.
    let snapshot = ConfigManager::load(ConfigLoadOptions::explicit(
        overlay.path().join("config.ghostty"),
    ))
    .snapshot();
    let (presentation, receiver) =
        tokio::sync::watch::channel(Arc::new(snapshot.terminal_presentation()));
    let serving = tokio::spawn(async move {
        if let Err(error) = mesh.serve(SessionRegistry::default(), receiver).await {
            eprintln!("[probe] viewer mesh stopped: {error:#}");
        }
    });
    Viewer {
        runtime,
        _presentation: presentation,
        _serving: serving,
    }
}

/// Poll a viewer's host list until the host advertising `session_id` shows up.
async fn discover(runtime: &MeshRuntime, session_id: &str, who: &str) -> RemoteHostSummary {
    timeout(DISCOVERY_BUDGET, async {
        loop {
            match runtime.hosts().await {
                Ok(hosts) => {
                    if let Some(host) = hosts
                        .into_iter()
                        .find(|h| h.sessions.iter().any(|s| s.session_id == session_id))
                    {
                        return host;
                    }
                }
                Err(error) => eprintln!("[probe] {who} hosts() failed, retrying: {error:#}"),
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("{who} never discovered the session within {DISCOVERY_BUDGET:?}"))
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "real tailnet: needs TRUFFLE_TEST_AUTHKEY; run with --ignored"]
async fn a_peer_sees_and_attaches_and_only_the_capability_holder_may_write() {
    let Some(key) = authkey() else {
        eprintln!("[skip] terminal_mesh_probe: {AUTHKEY_ENV} not set");
        return;
    };
    let Some(sidecar) = sidecar() else {
        eprintln!("[skip] terminal_mesh_probe: no truffle sidecar found");
        return;
    };
    let app_id = probe_app_id();
    eprintln!(
        "[probe] app_id={app_id} sidecar={} authkey={}",
        sidecar.display(),
        redact(&key)
    );

    let alpha_state = tempfile::TempDir::with_prefix("vfgt4-alpha-").expect("alpha dir");
    let beta_state = tempfile::TempDir::with_prefix("vfgt4-beta-").expect("beta dir");
    let gamma_state = tempfile::TempDir::with_prefix("vfgt4-gamma-").expect("gamma dir");
    let (alpha, beta, gamma) = tokio::join!(
        build_node(&app_id, "alpha", alpha_state.path(), &key, &sidecar),
        build_node(&app_id, "beta", beta_state.path(), &key, &sidecar),
        build_node(&app_id, "gamma", gamma_state.path(), &key, &sidecar),
    );
    let (alpha, beta, gamma) = (Arc::new(alpha), Arc::new(beta), Arc::new(gamma));
    eprintln!(
        "[probe] nodes up: alpha={} beta={} gamma={}",
        alpha.local_info().tailscale_hostname,
        beta.local_info().tailscale_hostname,
        gamma.local_info().tailscale_hostname
    );

    // ---- alpha: the floor, as the terminal unit builds it -------------------
    let run = tempfile::Builder::new()
        .prefix("vfgt4-run")
        .tempdir_in("/tmp")
        .expect("run dir under /tmp");
    let control = run.path().join("termctl.sock").display().to_string();
    let frame = run.path().join("termframe.sock").display().to_string();
    let token = "0".repeat(64);
    let engine = tokio::task::spawn_blocking(TextEngine::discover)
        .await
        .expect("font task")
        .expect("a usable monospace font");
    let host_mesh = TruffleTerminalMesh::new(
        Arc::clone(&alpha),
        terminal_mesh::truffle_config(Some(CAPABILITY.into())).expect("upstream config"),
    )
    .expect("host mesh adapter");
    let service = TerminalService::new(TerminalServiceConfig {
        control_socket: control.clone(),
        frame_socket: frame.clone(),
        auth_token: token.clone(),
    })
    .with_config_path(run.path().join("config.ghostty"))
    .with_private_env_prefixes(registries::ENV_PREFIXES.iter().copied())
    .expect("private env prefixes")
    .with_text_engine(engine)
    .with_terminal_mesh(host_mesh);
    let listeners = service.bind().expect("bind host endpoints");
    let (_drain, serving) = service.serve_managed(listeners);
    let _host = tokio::spawn(serving);

    let (client, _events) = ControlClient::connect(Path::new(&control), &token)
        .await
        .expect("dial the host control socket");
    let session = client
        .create_session(json!({
            "executable": TENANT,
            "args": [],
            "cols": 80,
            "rows": 24,
            "persistence": "keep-until-exit",
            "environment": {"mode": "clean", "variables": {}},
        }))
        .await
        .expect("create the hosted session");
    eprintln!("[probe] alpha hosts session {}", session.id);

    // ---- the viewers --------------------------------------------------------
    let read_only = viewer(Arc::clone(&beta), None).await;
    let read_write = viewer(Arc::clone(&gamma), Some(CAPABILITY.into())).await;

    // ROW: a peer LISTS the host over TSP1. This is the hosts store —
    // `terminal.v1.hosts`, published by the adapter our config named.
    let seen = discover(&read_only.runtime, &session.id, "beta").await;
    eprintln!(
        "[probe] beta sees {} ({}) advertising {} session(s)",
        seen.device_name,
        seen.device_id,
        seen.sessions.len()
    );
    let advertised = seen
        .sessions
        .iter()
        .find(|s| s.session_id == session.id)
        .expect("the hosted session in the advertisement");
    assert!(advertised.attachable, "a live session must be attachable");
    assert!(
        advertised.read_write,
        "a host with a mirror-write capability advertises that write is POSSIBLE; \
         whether THIS viewer gets it is decided at attach"
    );

    // `list_sessions` is the second, direct read — the freshness path the door
    // half flagged as unmeasurable without a peer. It is measurable here.
    let listed = read_only
        .runtime
        .list_sessions(&seen.device_id)
        .await
        .expect("beta lists the host's sessions over TSP1");
    assert!(
        listed.iter().any(|s| s.session_id == session.id),
        "the direct session list must agree with the advertisement: {listed:?}"
    );

    // ROW: a peer ATTACHES over TSP1, and write is refused without the string.
    let shared_engine = Arc::new(Mutex::new(
        tokio::task::spawn_blocking(TextEngine::discover)
            .await
            .expect("font task")
            .expect("a usable monospace font"),
    ));
    let opened = read_only
        .runtime
        .open_session(RemoteSessionOpen {
            device_id: seen.device_id.clone(),
            remote_session_id: session.id.clone(),
            cols: 80,
            rows: 24,
            owner_id: None,
            frames: FrameHub::new(64),
            text_engine: Arc::clone(&shared_engine),
        })
        .await
        .expect("beta opens the remote session");
    let attachment = read_only
        .runtime
        .attach_view(&opened.id, "beta-view")
        .await
        .expect("beta attaches a view");
    assert!(
        !attachment.read_write,
        "a viewer holding no mirror-write string must attach READ-ONLY"
    );
    let refused = read_only
        .runtime
        .send_input(
            &opened.id,
            "beta-view",
            attachment.attachment_epoch,
            1,
            TunnelInput::Text("echo denied\n".into()),
        )
        .await;
    assert!(
        refused.is_err(),
        "input from a read-only viewer must be refused at the host, not silently dropped"
    );
    eprintln!("[probe] beta: view granted, write refused ({refused:?})");

    // ROW: the same attach, with the capability, is read-write.
    let host_for_gamma = discover(&read_write.runtime, &session.id, "gamma").await;
    let opened = read_write
        .runtime
        .open_session(RemoteSessionOpen {
            device_id: host_for_gamma.device_id.clone(),
            remote_session_id: session.id.clone(),
            cols: 80,
            rows: 24,
            owner_id: None,
            frames: FrameHub::new(64),
            text_engine: Arc::clone(&shared_engine),
        })
        .await
        .expect("gamma opens the remote session");
    let attachment = read_write
        .runtime
        .attach_view(&opened.id, "gamma-view")
        .await
        .expect("gamma attaches a view");
    assert!(
        attachment.read_write,
        "the capability holder must attach READ-WRITE — this is mirror-write v1"
    );
    read_write
        .runtime
        .claim_control(
            &opened.id,
            "gamma-view",
            attachment.attachment_epoch,
            80,
            24,
        )
        .await
        .expect("gamma claims control");
    read_write
        .runtime
        .send_input(
            &opened.id,
            "gamma-view",
            attachment.attachment_epoch,
            1,
            TunnelInput::Text("echo allowed\n".into()),
        )
        .await
        .expect("the capability holder's input is accepted");
    eprintln!("[probe] gamma: view granted, write accepted");

    client
        .terminate(&session.id, "application")
        .await
        .expect("terminate the hosted session");
    alpha.stop().await;
    beta.stop().await;
    gamma.stop().await;
}
