//! GT-4a's kill matrix over a REAL tailnet: does the floor, wired the way
//! `terminal_mesh.rs` wires it, actually serve a peer?
//!
//! Five nodes in one process, the shape `quic_lane_probe.rs` established:
//!
//!   alpha   — the HOST. A real `TerminalService` with a real PTY under it,
//!             carrying our `TruffleTerminalMesh` with a mirror-write capability.
//!   beta    — a viewer holding NO capability. It must SEE and ATTACH, and its
//!             attachment must come back read-only.
//!   gamma   — a viewer holding the SAME capability. Same attach, read-write.
//!   delta   — a viewer holding a WRONG capability of the same LENGTH.
//!   epsilon — a viewer holding a WRONG capability of a different length.
//!
//! WHY FIVE AND NOT THREE (GT-5d). With beta and gamma alone this file never
//! exercised the COMPARISON it is named after: beta supplies `None`, which
//! `access_for` short-circuits on before it looks at the configured string
//! (ghosttea-truffle 0.9.2 lib.rs:3962-3979), and gamma supplies the right one.
//! A regression that granted `ReadWrite` for ANY non-empty token passed both
//! rows. Delta is the row that catches it. Epsilon is separate because the same
//! function tests `expected.len() == supplied.len()` BEFORE reaching
//! `subtle::ct_eq`, so a wrong string of the wrong length never reaches the
//! content compare at all — one wrong value can only prove one of those two
//! branches, and both are load-bearing.
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

/// Delta's string: wrong, and exactly as long as the real one, so `access_for`
/// gets past its length gate and the constant-time CONTENT compare is what
/// decides. One byte apart on purpose — the narrowest miss the compare can be
/// asked to catch.
const WRONG_SAME_LENGTH: &str = "gt5-mirror-write-probe";

/// Epsilon's string: wrong at a different length, which `access_for` refuses on
/// the length test alone. A separate row because it never reaches the code
/// delta's row proves.
const WRONG_OTHER_LENGTH: &str = "gt4-mirror-write-probe-and-then-some";

// The two wrong values only mean what their names say if these hold, and a
// later edit to any of the three literals must not be able to quietly turn one
// of the rows into a copy of the other.
const _: () = assert!(WRONG_SAME_LENGTH.len() == CAPABILITY.len());
const _: () = assert!(WRONG_OTHER_LENGTH.len() != CAPABILITY.len());

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

/// What one viewer got out of the host.
struct Verdict {
    /// The access the host granted at attach — `access_for`'s answer, which is
    /// the thing under test.
    read_write: bool,
    /// Whether a keystroke actually reached the host's PTY.
    wrote: bool,
    /// The upstream results behind the two booleans, for the run log.
    detail: String,
}

/// Discover the host, open the session, attach, and try to type.
///
/// Every viewer runs THIS and nothing else, so the only thing that differs
/// between the four rows is the string its config carries. That is the whole
/// point: a comparison exercised by a different code path per row is not a
/// comparison. The one branch inside is on the HOST's answer — claiming control
/// is a writer's first move and a read-only pane never makes it — never on
/// which viewer is calling.
async fn attach_and_type(
    viewer: &Viewer,
    session_id: &str,
    who: &str,
    engine: &Arc<Mutex<TextEngine>>,
) -> Verdict {
    let host = discover(&viewer.runtime, session_id, who).await;
    let opened = viewer
        .runtime
        .open_session(RemoteSessionOpen {
            device_id: host.device_id.clone(),
            remote_session_id: session_id.to_owned(),
            cols: 80,
            rows: 24,
            owner_id: None,
            frames: FrameHub::new(64),
            text_engine: Arc::clone(engine),
        })
        .await
        .unwrap_or_else(|error| panic!("{who} opens the remote session: {error:#}"));
    let view = format!("{who}-view");
    let attachment = viewer
        .runtime
        .attach_view(&opened.id, &view)
        .await
        .unwrap_or_else(|error| panic!("{who} attaches a view: {error:#}"));

    let mut detail = String::new();
    if attachment.read_write {
        let claimed = viewer
            .runtime
            .claim_control(&opened.id, &view, attachment.attachment_epoch, 80, 24)
            .await;
        detail.push_str(&format!("claim={claimed:?} "));
        if claimed.is_err() {
            return Verdict {
                read_write: true,
                wrote: false,
                detail,
            };
        }
    }
    let typed = viewer
        .runtime
        .send_input(
            &opened.id,
            &view,
            attachment.attachment_epoch,
            1,
            TunnelInput::Text(format!("echo {who}\n")),
        )
        .await;
    detail.push_str(&format!("input={typed:?}"));
    Verdict {
        read_write: attachment.read_write,
        wrote: typed.is_ok(),
        detail,
    }
}

/// A viewer the host must refuse write to, whatever it presented. Input from
/// one has to be refused AT THE HOST rather than silently dropped, which is why
/// `wrote` reads the send's result and not the absence of an echo.
fn assert_read_only(verdict: &Verdict, who: &str, because: &str) {
    assert!(
        !verdict.read_write,
        "{who} presented {because} and must attach READ-ONLY: {}",
        verdict.detail
    );
    assert!(
        !verdict.wrote,
        "{who} presented {because} and its input must be refused at the host: {}",
        verdict.detail
    );
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

    assert_ne!(
        WRONG_SAME_LENGTH, CAPABILITY,
        "delta's string must be WRONG; the const assertions only bind its length"
    );
    assert_ne!(
        WRONG_OTHER_LENGTH, CAPABILITY,
        "epsilon's string must be WRONG"
    );

    let alpha_state = tempfile::TempDir::with_prefix("vfgt4-alpha-").expect("alpha dir");
    let beta_state = tempfile::TempDir::with_prefix("vfgt4-beta-").expect("beta dir");
    let gamma_state = tempfile::TempDir::with_prefix("vfgt4-gamma-").expect("gamma dir");
    let delta_state = tempfile::TempDir::with_prefix("vfgt4-delta-").expect("delta dir");
    let epsilon_state = tempfile::TempDir::with_prefix("vfgt4-epsilon-").expect("epsilon dir");
    let (alpha, beta, gamma, delta, epsilon) = tokio::join!(
        build_node(&app_id, "alpha", alpha_state.path(), &key, &sidecar),
        build_node(&app_id, "beta", beta_state.path(), &key, &sidecar),
        build_node(&app_id, "gamma", gamma_state.path(), &key, &sidecar),
        build_node(&app_id, "delta", delta_state.path(), &key, &sidecar),
        build_node(&app_id, "epsilon", epsilon_state.path(), &key, &sidecar),
    );
    let (alpha, beta, gamma, delta, epsilon) = (
        Arc::new(alpha),
        Arc::new(beta),
        Arc::new(gamma),
        Arc::new(delta),
        Arc::new(epsilon),
    );
    eprintln!(
        "[probe] nodes up: alpha={} beta={} gamma={} delta={} epsilon={}",
        alpha.local_info().tailscale_hostname,
        beta.local_info().tailscale_hostname,
        gamma.local_info().tailscale_hostname,
        delta.local_info().tailscale_hostname,
        epsilon.local_info().tailscale_hostname
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
    let near_miss = viewer(Arc::clone(&delta), Some(WRONG_SAME_LENGTH.into())).await;
    let wrong_length = viewer(Arc::clone(&epsilon), Some(WRONG_OTHER_LENGTH.into())).await;

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
    let beta_got = attach_and_type(&read_only, &session.id, "beta", &shared_engine).await;
    assert_read_only(&beta_got, "beta", "no mirror-write string at all");
    eprintln!(
        "[probe] beta: view granted, write refused ({})",
        beta_got.detail
    );

    // ROW: the same attach, with the capability, is read-write. The A/B control
    // for all three refusals — without it they would prove only that the host
    // refuses everyone.
    let gamma_got = attach_and_type(&read_write, &session.id, "gamma", &shared_engine).await;
    assert!(
        gamma_got.read_write,
        "the capability holder must attach READ-WRITE — this is mirror-write v1: {}",
        gamma_got.detail
    );
    assert!(
        gamma_got.wrote,
        "the capability holder's input must be accepted: {}",
        gamma_got.detail
    );
    eprintln!("[probe] gamma: view granted, write accepted");

    // ROW: a wrong string of the RIGHT length. The only row that reaches
    // `access_for`'s constant-time content compare with something to compare,
    // and so the only one a "any non-empty token is good enough" regression
    // fails on.
    let delta_got = attach_and_type(&near_miss, &session.id, "delta", &shared_engine).await;
    assert_read_only(&delta_got, "delta", "a wrong string of the same length");
    eprintln!(
        "[probe] delta: wrong capability (same length), write refused ({})",
        delta_got.detail
    );

    // ROW: a wrong string of the WRONG length, refused on the length test before
    // the content compare is ever reached.
    let epsilon_got = attach_and_type(&wrong_length, &session.id, "epsilon", &shared_engine).await;
    assert_read_only(
        &epsilon_got,
        "epsilon",
        "a wrong string of a different length",
    );
    eprintln!(
        "[probe] epsilon: wrong capability (different length), write refused ({})",
        epsilon_got.detail
    );

    client
        .terminate(&session.id, "application")
        .await
        .expect("terminate the hosted session");
    alpha.stop().await;
    beta.stop().await;
    gamma.stop().await;
    delta.stop().await;
    epsilon.stop().await;
}
