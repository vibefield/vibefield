//! TC-S2 — the cell's two-line stdout protocol and stdin leash, driven
//! against the REAL `field-terminal-host` binary (`CARGO_BIN_EXE_…` — cargo
//! builds it for this test). What these rows pin is the SEAM the floor
//! supervisor trusts: hello only after the serve plane holds, EOF ⇒ drain ⇒
//! report ⇒ exit 0, and a malformed bootstrap failing loudly before any slow
//! work. The supervisor half (spawn/restart/routes) gets its own rows; the
//! product-fidelity crash story lives in fieldd's kill matrix.

#[path = "support/tp_mint.rs"]
mod tp_mint;

use futures_util::{SinkExt, StreamExt};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};
use tokio_tungstenite::tungstenite::Message;

fn short_root() -> tempfile::TempDir {
    // unix sockets ride the path, and the macOS default tmp blows the
    // ~104-byte sun_path ceiling (the harness memory) — /tmp deliberately.
    #[cfg(unix)]
    {
        tempfile::Builder::new()
            .prefix("vf-cell-")
            .tempdir_in("/tmp")
            .expect("tempdir")
    }
    #[cfg(not(unix))]
    {
        tempfile::tempdir().expect("tempdir")
    }
}

fn endpoint_for(root: &std::path::Path, file: &str) -> String {
    #[cfg(windows)]
    {
        field_native::endpoints::pipe_endpoint_for(root.to_str().expect("utf8 root"), file)
    }
    #[cfg(not(windows))]
    {
        root.join(file).to_str().expect("utf8 root").to_owned()
    }
}

fn spawn_cell(root: &std::path::Path, instance: u32) -> (Child, String, String) {
    let control = endpoint_for(
        root,
        &field_native::endpoints::cell_socket_file("termctl.sock", instance),
    );
    let frame = endpoint_for(
        root,
        &field_native::endpoints::cell_socket_file("termframe.sock", instance),
    );
    let child = Command::new(env!("CARGO_BIN_EXE_field-terminal-host"))
        .args([
            "--control",
            &control,
            "--frame",
            &frame,
            "--config",
            root.join("config.ghostty").to_str().expect("utf8"),
            "--instance",
            &instance.to_string(),
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn field-terminal-host");
    (child, control, frame)
}

fn wait_exit(mut child: Child, budget: Duration) -> std::process::ExitStatus {
    let deadline = Instant::now() + budget;
    loop {
        if let Some(status) = child.try_wait().expect("try_wait") {
            return status;
        }
        assert!(
            Instant::now() < deadline,
            "the cell did not exit within {budget:?}"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn hello_then_eof_drains_and_exits_clean() {
    let root = short_root();
    let (mut child, control, frame) = spawn_cell(root.path(), 1);
    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    let mut lines = BufReader::new(stdout).lines();

    writeln!(stdin, "{}", serde_json::json!({ "token": "test-token-1" })).expect("bootstrap");

    // Hello arrives only after serve_managed holds — the 15s registry budget
    // covers a cold font cache on a loaded host.
    let hello: field_native::cell::CellHello =
        serde_json::from_str(&lines.next().expect("a hello line").expect("read hello"))
            .expect("hello parses");
    assert_eq!(hello.control, control, "hello echoes the exact endpoint");
    assert_eq!(hello.frame, frame);
    assert!(hello.pid > 0);
    assert_eq!(
        hello.cell_boot_id.len(),
        32,
        "16 random bytes hex — identity, not a pid"
    );

    // The leash: dropping the write end IS the stop request (and the orphan
    // story — a dead parent closes the pipe the same way).
    drop(stdin);
    let report: field_native::cell::CellExitReport =
        serde_json::from_str(&lines.next().expect("an exit line").expect("read exit"))
            .expect("exit report parses");
    assert!(
        report.drained.is_some() && report.drain_unknown.is_none(),
        "an EOF ending drains and says so: {report:?}"
    );
    let status = wait_exit(child, Duration::from_secs(10));
    assert!(
        status.success(),
        "a requested drain exits 0, got {status:?}"
    );
}

#[test]
fn a_malformed_bootstrap_fails_loudly_before_any_slow_work() {
    let root = short_root();
    let (mut child, _control, _frame) = spawn_cell(root.path(), 2);
    let mut stdin = child.stdin.take().expect("stdin");
    let started = Instant::now();
    writeln!(stdin, "not json at all").expect("write garbage");
    drop(stdin);
    let status = wait_exit(child, Duration::from_secs(10));
    assert!(!status.success(), "garbage bootstrap must not serve");
    // Loudly AND immediately: no font discovery, no binding — the parse is
    // first. Generous ceiling; the point is it beats the hello budget.
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "a bootstrap refusal must not pay startup costs first"
    );
}

#[test]
fn two_instances_bind_disjoint_names_side_by_side() {
    // The per-instance name scheme's whole point: instance 3 and 4 coexist
    // under one root with no rebind fight — the restart story in miniature.
    let root = short_root();
    let (mut a, control_a, _) = spawn_cell(root.path(), 3);
    let (mut b, control_b, _) = spawn_cell(root.path(), 4);
    assert_ne!(control_a, control_b, "disjoint names by construction");
    let mut stdin_a = a.stdin.take().expect("stdin a");
    let mut stdin_b = b.stdin.take().expect("stdin b");
    writeln!(stdin_a, "{}", serde_json::json!({ "token": "tok-a" })).expect("a");
    writeln!(stdin_b, "{}", serde_json::json!({ "token": "tok-b" })).expect("b");
    // The readers stay ALIVE until the cells exit: dropping one closes the
    // child's stdout, which is the dead-parent shape (the cell tolerates it —
    // its exit report is best-effort — but THIS row is about clean coexistence,
    // so keep the pipes open and read the whole protocol).
    let mut lines_a = BufReader::new(a.stdout.take().expect("out a")).lines();
    let mut lines_b = BufReader::new(b.stdout.take().expect("out b")).lines();
    let hello_a: field_native::cell::CellHello =
        serde_json::from_str(&lines_a.next().expect("hello a").expect("read a")).expect("parse a");
    let hello_b: field_native::cell::CellHello =
        serde_json::from_str(&lines_b.next().expect("hello b").expect("read b")).expect("parse b");
    assert_ne!(hello_a.cell_boot_id, hello_b.cell_boot_id);
    drop(stdin_a);
    drop(stdin_b);
    let _ = lines_a.next();
    let _ = lines_b.next();
    assert!(wait_exit(a, Duration::from_secs(10)).success());
    assert!(wait_exit(b, Duration::from_secs(10)).success());
}

/// TC-S2 regression pin: the drain BROADCASTS. A witness control client must
/// receive `session-exited` (classified as the service's own shutdown) when
/// the leash asks the cell to drain — the sweep's honesty travels the wire,
/// not just the process tree.
#[tokio::test]
async fn a_leash_drain_broadcasts_exits_to_witnesses() {
    let root = short_root();
    let (mut child, control, _frame) = spawn_cell(root.path(), 9);
    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    writeln!(stdin, "{}", serde_json::json!({ "token": "tok-drain" })).expect("bootstrap");
    let mut lines = BufReader::new(stdout).lines();
    let _hello: field_native::cell::CellHello =
        serde_json::from_str(&lines.next().expect("hello").expect("read hello")).expect("parse");

    let (client, mut events) =
        field_native::services::terminal_client::ControlClient::connect(&control, "tok-drain")
            .await
            .expect("dial the cell");
    // WIN-6's role collapse: cmd.exe holds the PTY on windows, /bin/cat on
    // unix (the box gate caught this row shipping a /bin literal — the exact
    // class the mac-blind grep list names).
    #[cfg(windows)]
    let hold = std::env::var("COMSPEC").unwrap_or_else(|_| "C:\\Windows\\System32\\cmd.exe".into());
    #[cfg(not(windows))]
    let hold = "/bin/cat".to_string();
    let session = client
        .create_session(serde_json::json!({
            "executable": hold,
            "args": [],
            "cols": 80,
            "rows": 24,
            "persistence": "keep-until-exit",
            "environment": {"mode": "clean", "variables": {}},
        }))
        .await
        .expect("create");

    drop(stdin); // the leash: drain now
    let mut saw_exit = false;
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while std::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(2), events.recv()).await {
            Ok(Some(event)) => {
                eprintln!("WITNESS EVENT: {event}");
                if event["type"] == "session-exited" && event["sessionId"] == session.id.as_str() {
                    saw_exit = true;
                    break;
                }
            }
            Ok(None) => {
                eprintln!("WITNESS: channel closed");
                break;
            }
            Err(_) => eprintln!("WITNESS: 2s quiet"),
        }
    }
    drop(client);
    assert!(
        saw_exit,
        "the drain's exit broadcast must reach the witness"
    );
    let _ = wait_exit(child, Duration::from_secs(10));
}

/// TP-S3a — the bootstrap carries the grant key, the hello carries the doors,
/// and a grant MAC'd with that key opens the control door of the REAL binary.
/// Without a key the hello honestly carries no doors.
#[tokio::test]
async fn a_grant_key_in_the_bootstrap_opens_t1_doors_in_the_hello() {
    let root = short_root();
    let (mut child, _control, _frame) = spawn_cell(root.path(), 11);
    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    let key_hex = hex::encode(vec![0x5e_u8; 32]);
    writeln!(
        stdin,
        "{}",
        serde_json::json!({
            "token": "tok-doors",
            "grantKey": key_hex,
            "grantKeyGeneration": 1,
            "allowedOrigins": ["vibefield-app://shell"],
        })
    )
    .expect("bootstrap");
    let mut lines = BufReader::new(stdout).lines();
    let hello: field_native::cell::CellHello =
        serde_json::from_str(&lines.next().expect("hello").expect("read hello")).expect("parse");
    let doors = hello.doors.expect("a keyed cell serves its doors");
    assert!(doors.control_url.starts_with("ws://127.0.0.1:"));
    assert!(doors.control_url.ends_with("/control"));
    assert!(doors.frames_url.ends_with("/frames"));

    // a grant for THIS cell boot, MAC'd with the bootstrap key, is accepted
    let minter = tp_mint::TestMinter::new(&hello.cell_boot_id);
    let grant = minter.transport(tp_mint::TransportSpec::basic("set-cell", 1, "n-cell"));
    let (mut ws, _) = tokio::time::timeout(
        Duration::from_secs(5),
        tokio_tungstenite::connect_async(doors.control_url.clone()),
    )
    .await
    .expect("dial within 5s")
    .expect("the real cell's door accepts the upgrade");
    ws.send(Message::Text(
        tp_mint::hello("control", &grant, None).into(),
    ))
    .await
    .expect("send hello");
    let reply = tokio::time::timeout(Duration::from_secs(5), ws.next())
        .await
        .expect("a reply within 5s")
        .expect("a reply")
        .expect("a frame");
    let Message::Text(text) = reply else {
        panic!("expected a text reply, got {reply:?}");
    };
    let accepted: serde_json::Value = serde_json::from_str(text.as_str()).expect("json");
    assert_eq!(accepted["type"], "ConnectionAccepted", "{accepted}");
    assert_eq!(accepted["connectionSetId"], "set-cell");

    // the leash: the door closes the leg 1001 BEFORE the drain, then exit 0
    drop(stdin);
    let close = tokio::time::timeout(Duration::from_secs(10), ws.next())
        .await
        .expect("a close within 10s")
        .expect("a close frame")
        .expect("a frame");
    match close {
        Message::Close(Some(frame)) => assert_eq!(u16::from(frame.code), 1001),
        other => panic!("expected close 1001, got {other:?}"),
    }
    let report: field_native::cell::CellExitReport =
        serde_json::from_str(&lines.next().expect("exit line").expect("read exit")).expect("parse");
    assert!(report.drained.is_some());
    assert!(wait_exit(child, Duration::from_secs(10)).success());
}

/// G22 production integration: create through the cell's ordinary UDS service,
/// then attach that exact session through BOTH T1 doors. This is the regression
/// that an in-process `NoSessions` source could never pass: control resolution
/// proves the shared Session, frames resolution proves its shared FrameHub.
#[cfg(unix)]
#[tokio::test]
async fn uds_born_sessions_are_the_t1_doors_sessions() {
    let root = short_root();
    let (mut child, control_socket, _frame_socket) = spawn_cell(root.path(), 13);
    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    writeln!(
        stdin,
        "{}",
        serde_json::json!({
            "token": "tok-g22",
            "grantKey": hex::encode(vec![0x5e_u8; 32]),
            "grantKeyGeneration": 1,
        })
    )
    .expect("bootstrap");
    let mut lines = BufReader::new(stdout).lines();
    let hello: field_native::cell::CellHello =
        serde_json::from_str(&lines.next().expect("hello").expect("read hello")).expect("parse");
    let doors = hello.doors.expect("keyed cell doors");

    let (uds, _events) =
        field_native::services::terminal_client::ControlClient::connect(&control_socket, "tok-g22")
            .await
            .expect("dial ordinary UDS service");
    let session = uds
        .create_session(serde_json::json!({
            "executable": "/bin/cat",
            "args": [],
            "cols": 80,
            "rows": 24,
            "persistence": "keep-until-exit",
            "environment": {"mode": "clean", "variables": {}},
        }))
        .await
        .expect("create through UDS");

    let minter = tp_mint::TestMinter::new(&hello.cell_boot_id);
    let transport = minter.transport(tp_mint::TransportSpec::basic("set-g22", 1, "n-g22"));
    let attach = minter.attach(&session.id, 1, &["geometry", "input", "read"]);

    let (mut control, _) = tokio_tungstenite::connect_async(&doors.control_url)
        .await
        .expect("dial T1 control");
    control
        .send(Message::Text(
            tp_mint::hello("control", &transport, None).into(),
        ))
        .await
        .expect("control hello");
    let accepted = control
        .next()
        .await
        .expect("control accepted")
        .expect("frame");
    assert!(
        matches!(&accepted, Message::Text(text) if text.contains("ConnectionAccepted")),
        "{accepted:?}"
    );

    let (mut frames, _) = tokio_tungstenite::connect_async(&doors.frames_url)
        .await
        .expect("dial T1 frames");
    frames
        .send(Message::Text(
            tp_mint::hello("frames", &transport, Some(tp_mint::worker_capacities())).into(),
        ))
        .await
        .expect("frames hello");
    let accepted = frames
        .next()
        .await
        .expect("frames accepted")
        .expect("frame");
    assert!(
        matches!(&accepted, Message::Text(text) if text.contains("ConnectionAccepted")),
        "{accepted:?}"
    );

    control
        .send(Message::Text(
            serde_json::json!({
                "type": "AttachControlLeg",
                "activationId": "act-g22",
                "attachGrant": attach.clone(),
                "initialDemand": {"mode": "live"},
            })
            .to_string()
            .into(),
        ))
        .await
        .expect("attach control");
    let attached = control
        .next()
        .await
        .expect("control attached")
        .expect("frame");
    assert!(
        matches!(&attached, Message::Text(text) if text.contains("ControlLegAttached")),
        "the T1 control door must resolve the UDS-born session: {attached:?}"
    );

    frames
        .send(Message::Text(
            serde_json::json!({
                "type": "AttachFramesLeg",
                "activationId": "act-g22",
                "attachGrant": attach,
            })
            .to_string()
            .into(),
        ))
        .await
        .expect("attach frames");
    let attached = frames
        .next()
        .await
        .expect("frames attached")
        .expect("frame");
    assert!(
        matches!(&attached, Message::Text(text) if text.contains("FramesLegAttached")),
        "the T1 frames door must resolve the UDS-born session hub: {attached:?}"
    );

    drop(uds);
    drop(stdin);
    let _ = lines.next();
    assert!(wait_exit(child, Duration::from_secs(10)).success());
}

#[test]
fn a_keyless_bootstrap_serves_no_doors_and_says_so() {
    let root = short_root();
    let (mut child, _control, _frame) = spawn_cell(root.path(), 12);
    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    writeln!(stdin, "{}", serde_json::json!({ "token": "tok-nodoors" })).expect("bootstrap");
    let mut lines = BufReader::new(stdout).lines();
    let raw = lines.next().expect("hello").expect("read hello");
    let hello: field_native::cell::CellHello = serde_json::from_str(&raw).expect("parse");
    assert!(hello.doors.is_none(), "no key, no doors: {raw}");
    assert!(
        !raw.contains("doors"),
        "absence is absence on the wire, never null"
    );
    drop(stdin);
    let _ = lines.next();
    assert!(wait_exit(child, Duration::from_secs(10)).success());
}
