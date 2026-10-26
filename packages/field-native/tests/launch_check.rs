//! BP-1b (2026-10-26) — `--version` is the release's launch check, driven against the REAL binaries
//! (`CARGO_BIN_EXE_…` — cargo builds them for this test). The stage's verify and the build job run each packaged
//! binary with it: dyld resolves every load command before `main`, so a binary whose libraries cannot load fails
//! there, and one that can says its name and version and exits 0 — before reading any config or touching stdout's
//! protocol.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

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
/// ran 10 s against a person's own data dir. Each run gets an EMPTY temp `HOME`, where the default data and log
/// roots live.
///
/// Item 64's errata (2026-10-26): booted and slow are told apart by EVIDENCE, never by the clock. A run that writes
/// anything under its empty HOME has booted (a booting field-native creates its default data and log roots there,
/// its own log file among the first) and is stopped at once. A run that neither exits nor writes by the deadline was
/// only slow, and is said to be. Before, a run still alive at 10 s was called booted, so under load (the lead's
/// verify, load 252) a binary that was merely slow to exit was named as one that booted.
///
/// The deadline now bounds only a slow exit, so it is set from that run's load class. Measured 2026-10-26 on this
/// Mac (lane item64e, records/measure64e.sh), one `--help` run of either binary, cold (a re-copied binary's first
/// exec, which pays macOS's signature validation, as every first run of a fresh `CARGO_BIN_EXE` does) or warm:
/// - load ~7: median 0.3–0.4 s cold and 12 ms warm, worst 0.5 s;
/// - load ~50 to ~450 (80 to 240 busy loops): medians 0.04–1.1 s, worst 5.3 s.
///
/// The lead's verify saw a run pass 10 s at load 252, with the suite's own contention on top. 60 s is ~11× the worst
/// measured, and a boot never waits for it.
const RUN_DEADLINE: Duration = Duration::from_secs(60);

/// What one bounded run came to.
#[derive(Debug)]
enum Run {
    /// It exited, with its code, stdout and stderr.
    Exited {
        code: Option<i32>,
        stdout: String,
        stderr: String,
    },
    /// It wrote under its empty HOME: it booted, and was stopped when the first write was seen.
    Booted {
        after: Duration,
        wrote: Vec<PathBuf>,
    },
    /// It neither exited nor wrote by the deadline: slow, never read as booted.
    Slow {
        deadline: Duration,
        stdout: String,
        stderr: String,
    },
}

impl Run {
    /// The row's words for a run that did not exit.
    fn verdict(&self) -> String {
        match self {
            Run::Exited { code, .. } => format!("exited {code:?}"),
            Run::Booted { after, wrote } => format!(
                "BOOTED: it wrote {} path(s) under its empty HOME within {after:?} (first: {:?}) and was stopped",
                wrote.len(),
                wrote.iter().take(3).collect::<Vec<_>>()
            ),
            Run::Slow {
                deadline,
                stdout,
                stderr,
            } => format!(
                "did not exit within {deadline:?} and wrote nothing under its empty HOME: slow, not booted (a boot \
                 writes its data and log roots there); its stdout so far {stdout:?}, its stderr so far {stderr:?}"
            ),
        }
    }
}

/// Runs `exe arg` with nothing but `HOME`, watching `home` as it runs: an exit ends the run as `Exited`, the first
/// write under `home` as `Booted` (the binary is stopped at once), and the deadline as `Slow`.
fn run_bounded(exe: &str, arg: &str, home: &Path, deadline: Duration) -> Run {
    let mut child = Command::new(exe)
        .arg(arg)
        .env_clear()
        .env("HOME", home)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("the binary runs");
    let started = Instant::now();
    let text = |bytes: &[u8]| String::from_utf8_lossy(bytes).into_owned();
    loop {
        if child
            .try_wait()
            .expect("the child can be waited on")
            .is_some()
        {
            let out = child.wait_with_output().expect("its output is read");
            return Run::Exited {
                code: out.status.code(),
                stdout: text(&out.stdout),
                stderr: text(&out.stderr),
            };
        }
        let wrote = written_under(home);
        if !wrote.is_empty() {
            let after = started.elapsed();
            let _ = child.kill();
            let _ = child.wait();
            return Run::Booted { after, wrote };
        }
        if started.elapsed() > deadline {
            let _ = child.kill();
            let out = child.wait_with_output().expect("its output is read");
            return Run::Slow {
                deadline,
                stdout: text(&out.stdout),
                stderr: text(&out.stderr),
            };
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// Every path under `dir`, so a run can be seen to write (nothing, for a binary that only answers).
fn written_under(dir: &Path) -> Vec<PathBuf> {
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
            match run_bounded(exe, arg, home.path(), RUN_DEADLINE) {
                Run::Exited {
                    code,
                    stdout,
                    stderr,
                } => {
                    assert_eq!(
                        code,
                        Some(0),
                        "{name} {arg} exited {code:?}, not 0; stderr: {stderr}"
                    );
                    assert!(
                        stdout.starts_with(&format!("usage: {name}")),
                        "{name} {arg} printed no usage: {stdout:?}"
                    );
                }
                other => panic!("{name} {arg} {}", other.verdict()),
            }
            assert_eq!(
                written_under(home.path()),
                Vec::<PathBuf>::new(),
                "{name} {arg} wrote under its HOME"
            );
        }
    }
}

#[test]
fn an_argument_a_native_binary_does_not_take_is_refused_touching_nothing() {
    for (exe, name) in BINARIES {
        let home = tempfile::tempdir().expect("a temp home");
        match run_bounded(exe, "--no-such-flag", home.path(), RUN_DEADLINE) {
            Run::Exited {
                code,
                stdout,
                stderr,
            } => {
                assert_eq!(
                    code,
                    Some(2),
                    "{name} --no-such-flag exited {code:?}, not 2; stderr: {stderr}"
                );
                assert!(
                    stderr.contains("--no-such-flag") && stderr.contains(&format!("usage: {name}")),
                    "{name} --no-such-flag did not name the argument with the usage: {stderr:?}"
                );
                assert_eq!(stdout, "", "{name} --no-such-flag wrote to stdout");
            }
            other => panic!("{name} --no-such-flag {}", other.verdict()),
        }
        assert_eq!(
            written_under(home.path()),
            Vec::<PathBuf>::new(),
            "{name} --no-such-flag wrote under its HOME"
        );
    }
}

/// Item 64's errata — the two verdicts, by stand-ins (a `/bin/sh` script as the binary, so no daemon runs): a run that
/// writes under its HOME is called booted and is stopped at its first write, well before its deadline; a run that
/// neither exits nor writes is called slow at its deadline, never booted.
#[cfg(unix)]
#[test]
fn a_write_under_home_is_a_boot_and_silence_past_the_deadline_is_only_slow() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().expect("a temp dir");
    let script = |name: &str, body: &str| {
        let path = dir.path().join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).expect("the stand-in is written");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .expect("the stand-in is executable");
        path.to_string_lossy().into_owned()
    };

    // a boot: its log root first, then it serves
    let boots = script(
        "boots",
        r#"/bin/mkdir -p "$HOME/Library/Logs/VibeField" && : > "$HOME/Library/Logs/VibeField/field-native.ndjson"
exec /bin/sleep 30"#,
    );
    let home = tempfile::tempdir().expect("a temp home");
    let deadline = Duration::from_secs(20);
    let started = Instant::now();
    match run_bounded(&boots, "--help", home.path(), deadline) {
        // the run is stopped at the FIRST write seen, which may be `mkdir -p`'s first directory before the log file
        // exists, so what is certain is `Library` (created first, and everything later is under it)
        Run::Booted { wrote, .. } => assert!(
            wrote
                .iter()
                .any(|path| path == &home.path().join("Library")),
            "{wrote:?}"
        ),
        other => panic!("a run that wrote under its HOME was not called booted: {other:?}"),
    }
    assert!(
        started.elapsed() < deadline,
        "the boot was stopped at its first write, not at the deadline"
    );

    // only slow: no exit and nothing written, past a short deadline
    let slow = script("slow", "exec /bin/sleep 30");
    let home = tempfile::tempdir().expect("a temp home");
    let run = run_bounded(&slow, "--help", home.path(), Duration::from_millis(500));
    assert!(matches!(run, Run::Slow { .. }), "{run:?}");
    assert!(
        run.verdict().starts_with(
            "did not exit within 500ms and wrote nothing under its empty HOME: slow, not booted"
        ),
        "{}",
        run.verdict()
    );
}
