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
