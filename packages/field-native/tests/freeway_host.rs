//! FW (v0.3 §5.2) — the freeway host's pipes and its inherited listener, driven against the REAL
//! `field-freeway-host` binary (`CARGO_BIN_EXE_…` — cargo builds it for this test). What these
//! rows pin is the SEAM the floor's freeway unit will trust: the listener handed over as a
//! descriptor (`dup2`'d onto 3, as the floor will), the bootstrap on stdin, the hello as stdout's
//! first line, the door served on the inherited socket, EOF ⇒ exit 0, and a bootstrap that fails
//! loudly without ever saying a secret. The protocol has its own rows in `freeway::host`.

#![cfg(unix)]

use field_native::supervised_child::inherit;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::os::fd::AsRawFd;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

const SECRET: &str = "s3cret-path-0f-the-freeway";

fn bootstrap() -> serde_json::Value {
    serde_json::json!({
        "floorBootId": "fb-0191b04e-2026",
        "pathSecret": SECRET,
        "freewayKeyHex": "a5".repeat(32),
        "freewayKeyGeneration": 1,
        "declaration": {
            "deviceId": "dev-desktop-a",
            "admit": [],
            "doors": {},
            "exposure": { "terminals": true },
        },
    })
}

/// The host, spawned as the floor will spawn it: the listener placed at descriptor 3 by the
/// supervised child's own `inherit`. A test process's first socket IS descriptor 3, so these rows
/// walk `dup2`'s trap on every lone run.
fn spawn(listener: &TcpListener, stderr: Stdio) -> Child {
    let mut command = Command::new(env!("CARGO_BIN_EXE_field-freeway-host"));
    command
        .args(["--listener-fd", "3"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(stderr);
    inherit(&mut command, listener.as_raw_fd());
    command.spawn().expect("spawn field-freeway-host")
}

fn wait_exit(mut child: Child, budget: Duration) -> std::process::ExitStatus {
    let deadline = Instant::now() + budget;
    loop {
        if let Some(status) = child.try_wait().expect("try_wait") {
            return status;
        }
        assert!(
            Instant::now() < deadline,
            "the host did not exit within {budget:?}"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn the_host_serves_the_inherited_listener_says_its_hello_and_leaves_on_the_leash() {
    // The floor keeps its own copy for every host generation of its boot; so does this test.
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let mut child = spawn(&listener, Stdio::inherit());
    let mut stdin = child.stdin.take().unwrap();
    writeln!(stdin, "{}", bootstrap()).unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut hello = String::new();
    stdout.read_line(&mut hello).unwrap();
    let hello: serde_json::Value = serde_json::from_str(&hello).expect("line 1 is the hello");
    let boot = hello["hostBootId"].as_str().expect("a host boot id");
    assert!(boot.starts_with("hb-"), "{boot}");
    assert_eq!(hello["pid"], child.id());

    // The door is served on the inherited socket: a path that is not the secret is a 404.
    let mut probe = TcpStream::connect(("127.0.0.1", port)).unwrap();
    let upgrade = "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\n\
                   Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nHost: 127.0.0.1\r\n\r\n";
    write!(probe, "GET /f/not-the-secret HTTP/1.1\r\n{upgrade}").unwrap();
    let mut status = String::new();
    BufReader::new(&probe).read_line(&mut status).unwrap();
    assert!(status.starts_with("HTTP/1.1 404"), "{status}");

    // The leash: EOF, and the host leaves 0, with nothing more said.
    drop(stdin);
    let exit = wait_exit(child, Duration::from_secs(10));
    assert!(exit.success(), "{exit}");
    let mut rest = String::new();
    stdout.read_to_string(&mut rest).unwrap();
    assert_eq!(rest, "");
}

#[test]
fn a_bootstrap_that_does_not_parse_fails_loudly_and_never_says_a_secret() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let mut child = spawn(&listener, Stdio::piped());
    let mut stdin = child.stdin.take().unwrap();
    let mut wrong = bootstrap();
    wrong["freewayKeyGeneration"] = serde_json::json!(SECRET);
    writeln!(stdin, "{wrong}").unwrap();
    let mut stderr = String::new();
    child
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut stderr)
        .unwrap();
    let mut stdout = String::new();
    child
        .stdout
        .take()
        .unwrap()
        .read_to_string(&mut stdout)
        .unwrap();
    let exit = wait_exit(child, Duration::from_secs(10));
    assert_eq!(exit.code(), Some(1), "{stderr}");
    assert!(
        stderr.contains("the bootstrap line did not parse"),
        "{stderr}"
    );
    assert!(
        !stderr.contains(SECRET),
        "a secret in the host's stderr: {stderr}"
    );
    assert_eq!(stdout, "", "no hello for a bootstrap that failed");
}

#[test]
fn a_descriptor_that_is_not_a_listening_socket_is_refused_before_it_is_adopted() {
    // Nothing is handed over: whatever the host finds at 3 (if anything) is not its listener.
    let child = Command::new(env!("CARGO_BIN_EXE_field-freeway-host"))
        .args(["--listener-fd", "3"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("fd 3 is not a listening TCP socket"),
        "{stderr}"
    );
}

#[test]
fn a_host_without_its_listener_is_refused_before_it_reads_anything() {
    let child = Command::new(env!("CARGO_BIN_EXE_field-freeway-host"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert_eq!(output.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("--listener-fd is required"), "{stderr}");
}
