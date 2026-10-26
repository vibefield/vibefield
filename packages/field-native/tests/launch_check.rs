//! BP-1b (2026-10-26) — `--version` is the release's launch check, driven against the REAL binaries
//! (`CARGO_BIN_EXE_…` — cargo builds them for this test). The stage's verify and the build job run each packaged
//! binary with it: dyld resolves every load command before `main`, so a binary whose libraries cannot load fails
//! there, and one that can says its name and version and exits 0 — before reading any config or touching stdout's
//! protocol.

use std::process::Command;

#[test]
fn each_native_binary_answers_version_and_exits() {
    for (exe, name) in [
        (env!("CARGO_BIN_EXE_field-native"), "field-native"),
        (
            env!("CARGO_BIN_EXE_field-terminal-host"),
            "field-terminal-host",
        ),
    ] {
        let out = Command::new(exe)
            .arg("--version")
            .env_clear()
            .output()
            .expect("the binary runs");
        assert!(
            out.status.success(),
            "{name} --version exited {:?}",
            out.status
        );
        assert_eq!(
            String::from_utf8_lossy(&out.stdout).trim(),
            format!("{name} {}", env!("CARGO_PKG_VERSION")),
            "{name} --version said something else",
        );
    }
}

/// Item 64 (2026-10-26) — `--help` prints the usage and exits 0, and an argument a binary does not take is refused
/// (exit 2), each before any config is read or any file touched. field-native once IGNORED an argument it did not
/// take and booted: with no FIELD_NATIVE_DATA_DIR it serves the installed app's user root, and a lane's `--help`
/// ran 10 s against a person's own data dir. Each run gets an EMPTY temp `HOME` (the default data and log roots
/// live under it) and is bounded: a binary that boots instead of exiting is killed at the deadline, and the row
/// says so.
const RUN_DEADLINE: std::time::Duration = std::time::Duration::from_secs(10);

/// Runs `exe arg` with nothing but `HOME`, and answers its exit code (None = it was still running at the deadline,
/// so it booted), stdout and stderr.
fn run_bounded(exe: &str, arg: &str, home: &std::path::Path) -> (Option<i32>, String, String) {
    let mut child = Command::new(exe)
        .arg(arg)
        .env_clear()
        .env("HOME", home)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("the binary runs");
    let started = std::time::Instant::now();
    let code = loop {
        if let Some(status) = child.try_wait().expect("the child can be waited on") {
            break status.code();
        }
        if started.elapsed() > RUN_DEADLINE {
            let _ = child.kill();
            let _ = child.wait();
            return (None, String::new(), String::new());
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    };
    let out = child.wait_with_output().expect("its output is read");
    (
        code,
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

/// Every path under `dir`, so a row can say what a run wrote (nothing, for a binary that only answered).
fn written_under(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut found = Vec::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(next) = stack.pop() {
        for entry in std::fs::read_dir(&next).expect("the temp home reads") {
            let path = entry.expect("an entry").path();
            if path.is_dir() {
                stack.push(path.clone());
            }
            found.push(path);
        }
    }
    found
}

const BINARIES: [(&str, &str); 2] = [
    (env!("CARGO_BIN_EXE_field-native"), "field-native"),
    (
        env!("CARGO_BIN_EXE_field-terminal-host"),
        "field-terminal-host",
    ),
];

#[test]
fn each_native_binary_answers_help_and_exits_touching_nothing() {
    for (exe, name) in BINARIES {
        for arg in ["--help", "-h"] {
            let home = tempfile::tempdir().expect("a temp home");
            let (code, stdout, stderr) = run_bounded(exe, arg, home.path());
            assert_eq!(
                code,
                Some(0),
                "{name} {arg} did not exit 0 within {RUN_DEADLINE:?} (None = it booted); stderr: {stderr}"
            );
            assert!(
                stdout.starts_with(&format!("usage: {name}")),
                "{name} {arg} printed no usage: {stdout:?}"
            );
            assert_eq!(
                written_under(home.path()),
                Vec::<std::path::PathBuf>::new(),
                "{name} {arg} wrote under its HOME"
            );
        }
    }
}

#[test]
fn an_argument_a_native_binary_does_not_take_is_refused_touching_nothing() {
    for (exe, name) in BINARIES {
        let home = tempfile::tempdir().expect("a temp home");
        let (code, stdout, stderr) = run_bounded(exe, "--no-such-flag", home.path());
        assert_eq!(
            code,
            Some(2),
            "{name} --no-such-flag did not exit 2 within {RUN_DEADLINE:?} (None = it booted); stderr: {stderr}"
        );
        assert!(
            stderr.contains("--no-such-flag") && stderr.contains(&format!("usage: {name}")),
            "{name} --no-such-flag did not name the argument with the usage: {stderr:?}"
        );
        assert_eq!(stdout, "", "{name} --no-such-flag wrote to stdout");
        assert_eq!(
            written_under(home.path()),
            Vec::<std::path::PathBuf>::new(),
            "{name} --no-such-flag wrote under its HOME"
        );
    }
}
