//! F1 — the floor relays a line to every running cell (`TerminalHandle::tell_cells`, the freeway
//! host's `revokeClient`), driven against the REAL cells of a booted floor. The row orders its dials
//! after the cell has applied the line by hearing the cell say so: the floor forwards a cell's
//! stderr as its own diagnostics, and a thread-local subscriber on the row's current-thread runtime
//! hears them. That signal is only sound with the row ALONE in its process — tracing caches each
//! callsite's interest globally, and beside `terminal_unit`'s other rows (other threads hitting the
//! same callsites) the subscriber heard the first event and none after (measured 10-17) — so this
//! file holds this one row.

#[path = "support/tp_dial.rs"]
mod tp_dial;
#[path = "support/tp_mint.rs"]
mod tp_mint;

use field_native::{bootstrap, config::NativeConfig, RunningDaemon};
use serde_json::json;
use std::path::Path;
use std::time::Duration;
use tokio::time::timeout;

#[cfg(unix)]
fn short_tempdir() -> tempfile::TempDir {
    let dir = tempfile::Builder::new()
        .prefix("vfnf")
        .tempdir_in("/tmp")
        .expect("tempdir under /tmp");
    let probe = dir.path().join("native/run/termctl.sock");
    assert!(
        probe.as_os_str().len() < 100,
        "socket path would risk sun_path truncation: {}",
        probe.display()
    );
    dir
}

/// Windows endpoints are pipe names, not filesystem paths, so there is no
/// `sun_path` budget to protect — the platform temp dir is fine as-is.
#[cfg(windows)]
fn short_tempdir() -> tempfile::TempDir {
    tempfile::Builder::new()
        .prefix("vfnf")
        .tempdir()
        .expect("tempdir")
}

async fn boot(dir: &Path) -> RunningDaemon {
    let daemon = bootstrap(NativeConfig::for_data_dir(dir.to_path_buf()))
        .await
        .expect("bootstrap");
    // TC-S2: every row here drives the live service, and since the extraction
    // the hello omits `terminal` until the CELL's own hello lands (fresh
    // spawn, font discovery). Waiting for the route snapshot's first cell in
    // ONE place keeps fifteen rows honest about what they test — the unit's
    // behavior WITH an engine — instead of each re-learning the birth window.
    let mut routes = daemon.state.terminal_routes.clone();
    tokio::time::timeout(
        Duration::from_secs(20),
        routes.wait_for(|snapshot| !snapshot.cells.is_empty()),
    )
    .await
    .expect("the terminal cell announced within its hello budget")
    .expect("the routes watch outlives boot");
    daemon
}
/// The test's own subscriber writes every formatted event here, as a line.
struct Captured(tokio::sync::mpsc::UnboundedSender<String>);

impl std::io::Write for Captured {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        let _ = self.0.send(String::from_utf8_lossy(bytes).into_owned());
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// F1 — the floor relays a line to every running cell. `TerminalHandle::tell_cells` hands the
/// freeway host's `revokeClient` to each cell's stdin, and the REAL cell's door then refuses the
/// client's grants below the wall on a set it never saw, and admits one at it. The floor forwards
/// a cell's stderr as its own diagnostics, so this test's subscriber (the current-thread runtime
/// runs the forwarder here) hears the cell say the wall stands, which orders the dials after it.
#[tokio::test]
async fn a_line_told_to_the_cells_reaches_each_running_cell_and_walls_the_client() {
    let (said, mut heard) = tokio::sync::mpsc::unbounded_channel();
    let subscriber = tracing_subscriber::fmt()
        .with_writer(move || Captured(said.clone()))
        .with_ansi(false)
        .finish();
    let _capture = tracing::subscriber::set_default(subscriber);
    let dir = short_tempdir();
    let daemon = boot(dir.path()).await;
    let cell = (daemon.state.terminal_routes.borrow().cells.iter())
        .find(|cell| cell.doors.is_some() && cell.grant_key.is_some())
        .cloned()
        .expect("a cell serving its doors");
    let minter = tp_mint::TestMinter {
        cell_boot_id: cell.cell_boot_id.clone(),
        key_generation: 1,
        key: hex::decode(cell.grant_key.as_deref().unwrap()).unwrap(),
    };
    let wall = json!({ "revokeClient": { "clientId": "win:1#1", "beforeGeneration": 5 } });
    assert!(
        daemon.terminal.tell_cells(&wall) >= 1,
        "every running cell is told"
    );
    let this_cell = format!("instance={}", cell.cell_instance_id);
    let mut lines = Vec::new();
    loop {
        let Ok(line) = timeout(Duration::from_secs(10), heard.recv()).await else {
            panic!("the cell never said the wall stands; the floor said: {lines:#?}");
        };
        let line = line.expect("the capture lives");
        if line.contains("field_native.cell.revoke_client") && line.contains(&this_cell) {
            break;
        }
        lines.push(line);
    }
    let control = cell.doors.as_ref().unwrap().control_url.to_string();
    let below = minter.transport(tp_mint::TransportSpec::basic("set-never-seen", 4, "n-t4"));
    let refused = tp_dial::control_hello(&control, tp_mint::hello("control", &below, None)).await;
    let rollback = (
        "ConnectionRefused".to_owned(),
        "GRANT_GENERATION_ROLLBACK".to_owned(),
    );
    assert_eq!(refused, rollback);
    let at = minter.transport(tp_mint::TransportSpec::basic("set-never-seen", 5, "n-t5"));
    let accepted = tp_dial::control_hello(&control, tp_mint::hello("control", &at, None)).await;
    assert_eq!(accepted.0, "ConnectionAccepted");
    daemon.shutdown().await;
}
