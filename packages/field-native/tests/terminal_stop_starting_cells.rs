//! Item 196 — a stop inside a cell's start window ends that cell too.
//!
//! Every floor starts two cells at boot, one per workload class (Agent and Interactive), and a
//! cell has a route row only once it has said hello. `TerminalService::stop()` waited for the
//! routes to empty, so a stop that came before a hello returned at once, and the unit's teardown
//! dropped the start in flight. Nothing killed the child (no `kill_on_drop`): the cell lived on
//! with its pipes closed, panicked on its first stderr write (EPIPE), and wrote its crumb and
//! bound its sockets inside a data root its test was removing. a9's attribution run found it in
//! the lib's `services::mesh::` tests, whose every boot awaits `shutdown()`.
//!
//! The row lands each stop inside the window: it waits until a cell process exists, then stops
//! at once. The floor runs in this process, so its cells are this process's children, and this
//! file holds this one test, so every `field-terminal-host` child of this process is the row's.
//! After the awaited stop none may remain, no cell may have panicked (a crumb), and the root,
//! once dropped, must be gone.
#![cfg(unix)]

use field_native::{bootstrap, config::NativeConfig};
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

/// Each round is one boot and one stop; one round in the window was enough to leave a root.
const ROUNDS: usize = 5;
/// Long enough for an orphaned cell to reach its first stderr write and its panic hook.
const GRACE: Duration = Duration::from_millis(300);

/// The `field-terminal-host` children of this process, by pid (pgrep's `-P` names the parent).
fn cells_of_this_process() -> Vec<u32> {
    let pid = std::process::id().to_string();
    let out = Command::new("pgrep")
        .args(["-P", &pid, "-f", "field-terminal-host"])
        .output()
        .expect("pgrep runs");
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .filter_map(|line| line.trim().parse().ok())
        .collect()
}

/// The crumbs in a floor's run dir. A cell writes one only from its panic hook (`cell.rs`).
fn crumbs(run: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(run) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with("termcell.") && name.ends_with(".crumb"))
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_stop_inside_the_cells_start_window_ends_them_and_leaves_nothing_under_the_root() {
    for round in 0..ROUNDS {
        let dir = tempfile::Builder::new()
            .prefix("vf-stop-")
            .tempdir_in("/tmp")
            .expect("tempdir");
        let config = NativeConfig::for_data_dir(dir.path().to_path_buf());
        let run = config.run_dir();
        let daemon = bootstrap(config).await.expect("bootstrap");

        // The window: a cell process exists, and the stop comes now, before it can say hello.
        let deadline = Instant::now() + Duration::from_secs(10);
        while cells_of_this_process().is_empty() {
            assert!(
                Instant::now() < deadline,
                "round {round}: no cell started within 10 s"
            );
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
        daemon.shutdown().await;

        let left = cells_of_this_process();
        assert!(
            left.is_empty(),
            "round {round}: cells outlived the awaited stop: {left:?}"
        );
        tokio::time::sleep(GRACE).await;
        let panicked = crumbs(&run);
        assert!(
            panicked.is_empty(),
            "round {round}: a cell panicked on its way out: {panicked:?}"
        );

        let root = dir.path().to_path_buf();
        drop(dir);
        tokio::time::sleep(GRACE).await;
        assert!(
            !root.exists(),
            "round {round}: the root stayed or came back: {}",
            root.display()
        );
    }
}
