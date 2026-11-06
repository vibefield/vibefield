//! TC-S2 — the cell's two-line stdout protocol and stdin leash, driven
//! against the REAL `field-terminal-host` binary (`CARGO_BIN_EXE_…` — cargo
//! builds it for this test). What these rows pin is the SEAM the floor
//! supervisor trusts: hello only after the serve plane holds, EOF ⇒ drain ⇒
//! report ⇒ exit 0, and a malformed bootstrap failing loudly before any slow
//! work. The supervisor half (spawn/restart/routes) gets its own rows; the
//! product-fidelity crash story lives in fieldd's kill matrix.

#[path = "support/tp_dial.rs"]
mod tp_dial;
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
    spawn_cell_with_env(root, instance, &[], Stdio::null())
}

/// N-M6 — `spawn_cell` with variables planted in the CELL PROCESS's own
/// environment, which is the only way to exercise the EL7 strip: the strip acts
/// on what the cell inherited, so a test that cannot poison that inheritance
/// cannot see the strip at all.
fn spawn_cell_with_env(
    root: &std::path::Path,
    instance: u32,
    env: &[(&str, &str)],
    stderr: Stdio,
) -> (Child, String, String) {
    let (mut command, control, frame) = cell_command(root, instance);
    for (key, value) in env {
        command.env(key, value);
    }
    let child = command
        .stderr(stderr)
        .spawn()
        .expect("spawn field-terminal-host");
    (child, control, frame)
}

/// The cell's `Command` before it spawns: its endpoints derived from the root and the ordinal,
/// stdin and stdout the protocol's pipes. A row that shapes the process (its environment, a
/// descriptor limit) finishes it.
fn cell_command(root: &std::path::Path, instance: u32) -> (Command, String, String) {
    let control = endpoint_for(
        root,
        &field_native::endpoints::cell_socket_file("termctl.sock", instance),
    );
    let frame = endpoint_for(
        root,
        &field_native::endpoints::cell_socket_file("termframe.sock", instance),
    );
    let mut command = Command::new(env!("CARGO_BIN_EXE_field-terminal-host"));
    command
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
        .stdout(Stdio::piped());
    (command, control, frame)
}

/// RV #47 — the cell at a LOW soft descriptor limit, set in the forked child before exec, so its
/// accept loop runs out of descriptors while this test process's own limit stays where it was.
#[cfg(unix)]
fn lower_the_soft_descriptor_limit(command: &mut Command, soft: libc::rlim_t) {
    use std::os::unix::process::CommandExt;
    // SAFETY: runs in the forked child before exec. `getrlimit`/`setrlimit` are
    // async-signal-safe, allocate nothing, and touch only this child's own limits. Only the SOFT
    // half is lowered, as item 198's low-limit floor lowers it.
    unsafe {
        command.pre_exec(move || {
            let mut limit = libc::rlimit {
                rlim_cur: 0,
                rlim_max: 0,
            };
            if libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            limit.rlim_cur = soft.min(limit.rlim_max);
            if libc::setrlimit(libc::RLIMIT_NOFILE, &limit) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
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

/// Item 196 (b): a cell whose floor is gone exits with its own code, never a
/// panic. Its stderr is the floor's pipe, and once the floor is gone the pipe
/// has no reader: `eprint!` panics on that EPIPE, and the panic hook's crumb
/// then reads as a crash. An unknown flag is the cell's first stderr write, so
/// it is the row: exit 2 with its usage, on a stderr nobody reads.
#[cfg(unix)]
#[test]
fn a_cell_whose_stderr_has_no_reader_exits_with_its_code_not_a_panic() {
    let (reader, writer) = std::io::pipe().expect("pipe");
    drop(reader);
    let status = Command::new(env!("CARGO_BIN_EXE_field-terminal-host"))
        .arg("--no-such-flag")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(writer)
        .status()
        .expect("spawn the cell");
    assert_eq!(status.code(), Some(2), "{status:?}");
}

/// RV #47 (native-terminal-1): a cell whose serve plane fails on its own exits, nonzero, while
/// its leash is still held. The floor holds the leash for as long as it waits on the cell, and
/// that wait is its one crash signal. The failure is a real one: at a soft limit of 64
/// descriptors the row's 64 held dials outnumber what the cell has left, and ghosttea ends its
/// control plane on the first accept that fails (EMFILE). The cell reports that, then it must
/// leave. Read on the runtime (tokio's stdin), the leash is an uncancellable read on the blocking
/// pool, and dropping the runtime waits for that read: until the floor closes stdin, which it
/// never does while it waits.
#[cfg(unix)]
#[test]
fn a_serve_plane_that_fails_on_its_own_exits_nonzero_with_the_leash_held() {
    use std::os::unix::net::UnixStream;
    const SOFT_LIMIT: libc::rlim_t = 64;

    let root = short_root();
    let (mut command, control, _frame) = cell_command(root.path(), 31);
    lower_the_soft_descriptor_limit(&mut command, SOFT_LIMIT);
    let mut child = command
        .stderr(Stdio::inherit())
        .spawn()
        .expect("spawn field-terminal-host");
    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    // stdout is read on a thread of the row's own, so a cell that never reports fails the row at
    // its bound instead of hanging it.
    let (said, heard) = std::sync::mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if said.send(line).is_err() {
                break;
            }
        }
    });

    writeln!(stdin, "{}", serde_json::json!({ "token": "tok-ceiling" })).expect("bootstrap");
    let hello: field_native::cell::CellHello =
        serde_json::from_str(&heard.recv().expect("a hello line")).expect("hello parses");
    assert_eq!(hello.control, control, "the hello names the plane");

    // As many dials as the cell has descriptors, its own stdio among them. Each one it accepts
    // holds a descriptor until ghosttea's 10 s AUTH_TIMEOUT, so an accept fails long before any
    // comes back. A refused dial is the one the failed accept dropped (macOS) or one after the
    // plane closed: either way the ceiling was already reached.
    let held: Vec<UnixStream> = (0..SOFT_LIMIT)
        .filter_map(|_| UnixStream::connect(&control).ok())
        .collect();
    let line = heard
        .recv_timeout(Duration::from_secs(10))
        .expect("the cell reports that its serve plane ended");
    let report: field_native::cell::CellExitReport =
        serde_json::from_str(&line).expect("exit report parses");
    let unknown = report.drain_unknown.as_deref().unwrap_or_default();
    assert!(
        report.drained.is_none() && unknown.starts_with("the serve plane failed"),
        "the plane's own failure, said as one: {report:?}"
    );

    // THE ROW: the cell leaves, with main's own failure, while the leash is still held.
    let status = wait_exit(child, Duration::from_secs(10));
    assert_eq!(
        status.code(),
        Some(1),
        "a serve plane that failed on its own is a crash the floor must see: {status:?}"
    );
    drop(held);
    drop(stdin);
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

/// F1 — a stdin line after the bootstrap is an update. The floor's `revokeClient` reaches the
/// REAL cell's door, which then refuses that client's grants below the wall even on a set it
/// never saw, and admits one at the wall; a line that does not parse is reported and ignored;
/// EOF is still the leash. The cell's own stderr says when the wall stands, which orders the
/// dials after it.
#[tokio::test]
async fn a_revoke_client_line_walls_the_clients_older_grants_and_the_leash_still_drains() {
    let root = short_root();
    let (mut child, _control, _frame) = spawn_cell_with_env(root.path(), 21, &[], Stdio::piped());
    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    let stderr = child.stderr.take().expect("stderr");
    let (said, heard) = std::sync::mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if said.send(line).is_err() {
                break;
            }
        }
    });
    let bootstrap = serde_json::json!({
        "token": "tok-revoke",
        "grantKey": hex::encode(vec![0x5e_u8; 32]),
        "grantKeyGeneration": 1,
    });
    writeln!(stdin, "{bootstrap}").expect("bootstrap");
    let mut lines = BufReader::new(stdout).lines();
    let hello: field_native::cell::CellHello =
        serde_json::from_str(&lines.next().expect("hello").expect("read hello")).expect("parse");
    let doors = hello.doors.expect("a keyed cell serves its doors");
    let minter = tp_mint::TestMinter::new(&hello.cell_boot_id);

    writeln!(stdin, "not an update").expect("a line");
    let wall =
        serde_json::json!({ "revokeClient": { "clientId": "win:1#1", "beforeGeneration": 5 } });
    writeln!(stdin, "{wall}").expect("the revoke");
    let mut events = Vec::new();
    while !events
        .iter()
        .any(|line: &String| line.contains("field_native.cell.revoke_client"))
    {
        let line = heard
            .recv_timeout(Duration::from_secs(10))
            .expect("the cell says the wall stands");
        events.push(line);
    }
    let unparsed = events
        .iter()
        .any(|line| line.contains("field_native.cell.update_unparsed"));
    assert!(
        unparsed,
        "the line that did not parse is reported: {events:?}"
    );

    let below = minter.transport(tp_mint::TransportSpec::basic("set-never-seen", 4, "n-r4"));
    let refused =
        tp_dial::control_hello(&doors.control_url, tp_mint::hello("control", &below, None)).await;
    assert_eq!(
        refused,
        (
            "ConnectionRefused".to_owned(),
            "GRANT_GENERATION_ROLLBACK".to_owned()
        )
    );
    let at = minter.transport(tp_mint::TransportSpec::basic("set-never-seen", 5, "n-r5"));
    assert_eq!(
        tp_dial::control_hello(&doors.control_url, tp_mint::hello("control", &at, None))
            .await
            .0,
        "ConnectionAccepted"
    );

    drop(stdin);
    let report: field_native::cell::CellExitReport =
        serde_json::from_str(&lines.next().expect("exit line").expect("read exit")).expect("parse");
    assert!(report.drained.is_some());
    assert!(wait_exit(child, Duration::from_secs(10)).success());
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

/// N-M6 (EL7 — daemon secrets never enter agent environments) — the
/// `FIELD_*` / `FIELDD_*` strip at PTY creation, witnessed on THIS plane.
///
/// The strip is one line in `cell.rs`
/// (`with_private_env_prefixes(registries::ENV_PREFIXES…)`) and it had no Rust
/// witness at all: fieldd's kill matrix proves it from outside, so deleting that
/// line left the entire field-native gate green. A wall whose only witness lives
/// in another package is a wall one refactor away from being a comment.
///
/// WHY IT IS THE WHOLE OF EL7 HERE. fieldd spawns the floor by handing down its
/// ENTIRE environment (`bin.ts`), so every `FIELD_*`/`FIELDD_*` the shell was
/// started with — pairing paths, build ids, daemon-private switches — reaches
/// this process. A same-uid agent in a PTY is the adversary the law names, and
/// the only thing between it and those values is this strip.
///
/// `mode: "inherit"` is the mode under test and the one the DECK uses
/// (`terminal-service.ts`): inherit-minus-strip. Under `mode: "clean"` the row
/// would pass against a cell with no strip at all, because nothing is inherited
/// to strip — which is exactly the shape of vacuous test this wave is clearing
/// out, so it is stated rather than left to be rediscovered.
///
/// THE CONTROL VARIABLE is what makes the absence mean something: an unprefixed
/// variable planted the same way MUST arrive. Without it, a cell that inherited
/// nothing at all (or a session that failed to start) would read as a pass.
#[tokio::test]
async fn a_real_pty_never_inherits_the_daemon_private_prefixes() {
    use field_native::services::terminal_client::ControlClient;

    let root = short_root();
    let dump = root.path().join("envdump.txt");
    let dump_path = dump.to_str().expect("utf8 dump path").to_string();

    // Planted in the CELL's own environment, the way fieldd's handed-down
    // environment plants the real ones. Both prefixes from the generated
    // registry, plus an unprefixed control.
    let (mut child, control, _frame) = spawn_cell_with_env(
        root.path(),
        11,
        &[
            ("FIELD_SMUGGLE", "field-must-not-escape"),
            ("FIELDD_SMUGGLE", "fieldd-must-not-escape"),
            ("VF_CELL_CONTROL", "this-one-must-arrive"),
        ],
        Stdio::null(),
    );
    let mut stdin = child.stdin.take().expect("stdin");
    let stdout = child.stdout.take().expect("stdout");
    writeln!(stdin, "{}", serde_json::json!({ "token": "tok-strip" })).expect("bootstrap");
    let mut lines = BufReader::new(stdout).lines();
    let _hello: field_native::cell::CellHello =
        serde_json::from_str(&lines.next().expect("hello").expect("read hello")).expect("parse");

    let (client, _events) = ControlClient::connect(&control, "tok-strip")
        .await
        .expect("dial the cell's control socket");

    // A REAL PTY, reporting its own environment. Written to a file rather than
    // read off the frame plane so the assertion is over the tenant's actual
    // `environ` and not over anything this test had to decode.
    #[cfg(unix)]
    let (executable, args) = (
        "/bin/sh",
        serde_json::json!(["-c", format!("env > {dump_path}")]),
    );
    #[cfg(windows)]
    let (executable, args) = (
        "cmd.exe",
        serde_json::json!(["/c", format!("set > {dump_path}")]),
    );

    let session = client
        .create_session(serde_json::json!({
            "executable": executable,
            "args": args,
            "cols": 80,
            "rows": 24,
            "persistence": "keep-until-exit",
            // INHERIT, deliberately — see the doc comment. Under "clean" this
            // row would hold against a cell with no strip at all.
            "environment": {"mode": "inherit"},
        }))
        .await
        .expect("create a session on the real cell");

    let deadline = Instant::now() + Duration::from_secs(20);
    let dumped = loop {
        if let Ok(text) = std::fs::read_to_string(&dump) {
            if !text.is_empty() {
                break text;
            }
        }
        assert!(
            Instant::now() < deadline,
            "the tenant never wrote its environment to {dump_path}"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    };

    // THE CONTROL FIRST: if this is absent the run proves nothing about the
    // strip, because nothing was inherited for it to act on.
    assert!(
        dumped.contains("VF_CELL_CONTROL=this-one-must-arrive"),
        "an unprefixed variable must reach the PTY, or this row is vacuous:\n{dumped}"
    );
    for prefix in field_native::registries::ENV_PREFIXES {
        assert!(
            !dumped.contains(&format!("{prefix}SMUGGLE")),
            "a {prefix}* variable reached a same-uid tenant's environment (EL7):\n{dumped}"
        );
    }
    // And by value too, so a renamed-but-forwarded variable cannot pass.
    assert!(
        !dumped.contains("must-not-escape"),
        "a daemon-private VALUE reached the PTY under some other name:\n{dumped}"
    );

    let _ = client.terminate(&session.id, "strip-row").await;
    drop(stdin);
    let _ = lines.next();
    let _ = wait_exit(child, Duration::from_secs(10));
}
