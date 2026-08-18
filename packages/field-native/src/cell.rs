//! TC-S2 — the terminal-host CELL runtime (TC-D3's extraction, first rung).
//!
//! `field-terminal-host` embeds today's ghosttea TerminalService AS-IS,
//! self-custody: the PTYs still live and die with this process (the vault
//! arrives beneath it at TC-S4+). What the process boundary buys NOW is blast
//! containment with supervision — a terminal-engine crash loses only its
//! class, and the floor survives to say so honestly (the S2 string).
//!
//! The seam is deliberately dumb, portable, and secret-free:
//!
//! - argv carries the NON-secrets: the pre-resolved control/frame endpoint
//!   strings (the parent's `NativeConfig` is the ONE derivation authority —
//!   this process derives nothing), the config overlay path, and the
//!   1-based instance ordinal whose per-instance socket names make a restart
//!   never a rebind (`endpoints::cell_socket_file`).
//! - stdin line 1 carries the auth token (EL7: never argv, never env — both
//!   are same-uid-readable on the platforms that matter). stdin then stays
//!   open as the LIFETIME LEASH: EOF means the parent is gone or asked us to
//!   stop, and either way the answer is drain-and-exit. One portable signal,
//!   no SIGTERM story to duplicate on win32, and a parent crash reaps the
//!   cell for free (TC-D14's bootstrap-pipe pattern at S2 scale).
//! - stdout line 1 is the hello `{cellBootId, pid, control, frame}` — printed
//!   only after `serve_managed` returned a handle, so a hello means the
//!   endpoints are dialable. stdout's LAST line is the drain report (or its
//!   honest absence). Everything diagnostic goes to stderr, which the parent
//!   owns.
//!
//! Exit codes: 0 = the leash asked and the drain ran; anything else = the
//! serve plane ended on its own or the bootstrap failed — the parent's
//! supervisor classifies and applies restart intensity.

use crate::registries;
use anyhow::{Context, Result};
use ghosttea::{ipc, TerminalService, TerminalServiceConfig, TerminalServiceListeners, TextEngine};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

/// The non-secret half of the bootstrap, straight off argv.
#[derive(Debug, Clone)]
pub struct CellArgs {
    pub control: String,
    pub frame: String,
    pub config: PathBuf,
    pub instance: u32,
    /// TC-S3/TC-D4 — where to leave the crash breadcrumb. Optional so a bare
    /// invocation (and the pre-S3 test rows) still runs; the floor always
    /// passes it.
    pub crumb: Option<PathBuf>,
}

/// stdin line 1. A struct rather than a bare string so the seam can grow
/// (e.g. a mesh face at TC-S3+) without re-cutting the pipe protocol.
#[derive(Debug, Deserialize)]
pub struct CellBootstrap {
    pub token: String,
}

/// stdout line 1 — printed only once the serve plane holds. The parent binds
/// this to the route snapshot row it publishes (TC-D15).
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellHello {
    pub cell_boot_id: String,
    pub pid: u32,
    pub control: String,
    pub frame: String,
}

/// stdout's last line. `drained` carries upstream's own report rendering;
/// `drain_unknown` is the honest shape for an ending that never drained —
/// the parent logs it VERBATIM rather than inventing a cleaner story.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellExitReport {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drained: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub drain_unknown: Option<String>,
}

/// TC-D4 — the crash breadcrumb, written on the way down and read (then
/// deleted) by the floor after the wait. `cellBootId` fences generations: a
/// crumb whose boot id is not the one the floor's hello named is stale
/// evidence and classifies nothing. `sessionId` present ⇒ Exact{session};
/// absent ⇒ Infrastructure — and at TC-S3 the embedded service's feed path is
/// upstream's, so THIS binary can only ever write the sessionless form (the
/// panic hook below). A session-naming writer arrives with custody (TC-S4+),
/// when the feed path is ours to instrument. The file protocol is the seam
/// the kill matrix exercises either way.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CellCrumb {
    pub cell_boot_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// Run the cell to completion. Ok(()) is the requested-drain ending; any Err
/// is a crash the supervisor classifies.
pub async fn run_cell(args: CellArgs) -> Result<()> {
    // The token FIRST — before any slow work, so a parent that dies mid-spawn
    // costs nothing and a malformed bootstrap fails loudly and immediately.
    let mut stdin = BufReader::new(tokio::io::stdin());
    let mut first = String::new();
    stdin
        .read_line(&mut first)
        .await
        .context("read the bootstrap line from stdin")?;
    let bootstrap: CellBootstrap =
        serde_json::from_str(first.trim()).context("parse the bootstrap line")?;

    // Minted before any fallible work: the panic hook needs it, and the hello
    // below reuses it — one identity per cell process, start to grave.
    let cell_boot_id = hex::encode(rand::random::<[u8; 16]>());

    // TC-D4 — the attribution hook. Every panic leaves a SESSIONLESS crumb
    // (Infrastructure: this binary cannot see inside upstream's feed path, and
    // a blame it cannot evidence is worse than none — never "last active").
    // Chained so the default hook still prints to stderr, which the parent
    // forwards; the write itself is best-effort — a hook must never panic.
    // Written on EVERY panic, survivable ones included: a caught task panic's
    // crumb may outlive it and color a later signal-death as Infrastructure
    // with stale detail, which stays blame-free — the floor's Exact/None
    // distinction is untouched, and the detail is diagnostic only.
    if let Some(crumb_path) = args.crumb.clone() {
        let hook_boot_id = cell_boot_id.clone();
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            let crumb = CellCrumb {
                cell_boot_id: hook_boot_id.clone(),
                session_id: None,
                detail: Some(info.to_string()),
            };
            if let Ok(line) = serde_json::to_string(&crumb) {
                let _ = std::fs::write(&crumb_path, line);
            }
            previous(info);
        }));
    }

    // Per-instance names are FRESH by design, so stale removal is
    // belt-and-braces for a re-used ordinal after an unclean floor boot —
    // never the unlink-a-live-listener hazard the instance scheme exists to
    // avoid (a live prior instance holds a DIFFERENT name).
    ipc::remove_stale_endpoint(&args.control)?;
    ipc::remove_stale_endpoint(&args.frame)?;
    let control = ipc::Listener::bind(&args.control)?;
    let frames = ipc::Listener::bind(&args.frame)?;
    #[cfg(unix)]
    {
        set_private_socket_permissions(&args.control)?;
        set_private_socket_permissions(&args.frame)?;
    }

    // Same discovery, same honesty as the in-process unit: no usable font is
    // a refusal to start, stated on stderr and in the exit code — the parent
    // surfaces it as unit detail, not this process's problem to soften.
    let engine = tokio::task::spawn_blocking(TextEngine::discover)
        .await
        .context("font discovery task")?
        .context("no usable monospace font")?;

    let service = TerminalService::new(TerminalServiceConfig {
        control_socket: args.control.clone(),
        frame_socket: args.frame.clone(),
        auth_token: bootstrap.token,
    })
    // GT-3 overlay + EL7 strip: byte-identical policy to the in-process unit
    // (the prefixes come from the same generated registries this binary links).
    .with_config_path(args.config.clone())
    .with_private_env_prefixes(registries::ENV_PREFIXES.iter().copied())
    .context("private env prefixes rejected")?
    .with_text_engine(engine);

    // NO mesh arm, by design: a cell cannot borrow the floor's tailnet node
    // across a process boundary, so FIELD_NATIVE_TERMINAL_MESH keeps the
    // in-process path in the parent (the flagged fallback) and the extracted
    // path is mesh-free until the G14-class seam exists.

    let (handle, serving) = service.serve_managed(TerminalServiceListeners::new(control, frames));

    let hello = CellHello {
        cell_boot_id,
        pid: std::process::id(),
        control: args.control.clone(),
        frame: args.frame.clone(),
    };
    // One line, flushed: the parent's hello deadline is watching this pipe.
    // Explicit and fallible — a parent that already closed our stdout cannot
    // hear a hello, and that is a failed start stated cleanly, never a
    // `println!` panic (Rust ignores SIGPIPE; println panics on EPIPE).
    write_stdout_line(&serde_json::to_string(&hello).context("serialize hello")?)
        .context("write hello — is the parent still listening?")?;

    // The leash: consume (and discard) anything else on stdin until EOF.
    let leash = async move {
        let mut sink = [0u8; 256];
        loop {
            match stdin.read(&mut sink).await {
                Ok(0) | Err(_) => break,
                Ok(_) => continue,
            }
        }
    };

    // The serve future must OUTLIVE a leash-triggered drain: `select!` drops
    // its losing futures before the winning arm's body runs, and dropping
    // `serving` tears down every connection — the drain would then sweep
    // sessions on a service whose witnesses were already disconnected
    // (measured: a witness saw session-created, then only the close). A task
    // keeps it alive through the shutdown, exactly as the in-process unit's
    // serve task always did.
    let mut serving = tokio::spawn(serving);
    tokio::select! {
        _ = leash => {
            // Requested (or orphaned — same answer): drain within the shared
            // budget, report, exit clean. The budget is the genned authority,
            // mirroring upstream's own sweep window.
            let budget = Duration::from_millis(registries::cell_supervision::DRAIN_BUDGET_MS);
            let report = handle.shutdown(budget).await;
            // A completed shutdown is the one non-failure way serving ends —
            // let it conclude so every broadcast the drain queued is flushed
            // by a LIVING service before the runtime goes away.
            let _ = tokio::time::timeout(WRITER_FLUSH_GRACE, &mut serving).await;
            // The drain's exit broadcasts ride per-client writer TASKS the
            // shutdown does not await — in-process they always flushed on the
            // long-lived runtime, but this process is about to drop its
            // runtime, which aborts unflushed writers and silently eats the
            // very exits the sweep exists to announce (measured: a witness
            // saw session-created, then only the close). A bounded grace lets
            // them reach the socket; delivery stays best-effort, the bound
            // keeps the leash contract prompt.
            tokio::time::sleep(WRITER_FLUSH_GRACE).await;
            let line = CellExitReport {
                drained: Some(format!("{report:?}")),
                drain_unknown: None,
            };
            // Best-effort BY DESIGN: the leash may have closed because the
            // parent DIED, and a dead parent's pipe must not turn a clean
            // drain into an EPIPE panic. The drain already happened; the
            // report is a courtesy.
            let _ = write_stdout_line(&serde_json::to_string(&line).unwrap_or_default());
            Ok(())
        }
        outcome = &mut serving => {
            let outcome = outcome.unwrap_or_else(|join| Err(anyhow::anyhow!(join)));
            // The serve plane ended on its own — a crash by definition (the
            // requested path above never lets it finish first). No drain ran;
            // say so rather than pretend.
            let line = CellExitReport {
                drained: None,
                drain_unknown: Some(match &outcome {
                    Ok(()) => "the serve plane stopped on its own".to_string(),
                    Err(error) => format!("the serve plane failed: {error}"),
                }),
            };
            let _ = write_stdout_line(&serde_json::to_string(&line).unwrap_or_default());
            match outcome {
                Ok(()) => anyhow::bail!("the serve plane stopped without being asked"),
                Err(error) => Err(error).context("the serve plane failed"),
            }
        }
    }
}

/// How long a drained cell lingers so the drain's own exit broadcasts flush
/// to witness sockets before the runtime (and its writer tasks) die with the
/// process. Bounded and small: the leash promises a prompt exit.
const WRITER_FLUSH_GRACE: Duration = Duration::from_millis(250);

/// One protocol line to stdout, flushed, error surfaced to the caller — the
/// only writer stdout has (diagnostics ride stderr).
fn write_stdout_line(line: &str) -> std::io::Result<()> {
    use std::io::Write;
    let mut out = std::io::stdout().lock();
    writeln!(out, "{line}")?;
    out.flush()
}

/// The 0700 run directory is the real boundary; 0600 on the socket is one
/// syscall of not relying on it (the windows pipes get their CurrentUserOnly
/// DACL at bind, inside ghosttea's listener — WIN-D4).
#[cfg(unix)]
fn set_private_socket_permissions(path: &str) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(PathBuf::from(path), std::fs::Permissions::from_mode(0o600))
}
