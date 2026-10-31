// field-native — config → pairing → NativeServiceManager → mgmt server → run.
use field_native::config::NativeConfig;
use field_native::logging::{install_panic_hook, new_boot_id, NativeLogging};
use std::time::Duration;

/// Item 64 (2026-10-26) — what `--help` prints, and what an argument field-native does not take is refused with.
/// field-native is configured by its environment alone, and with none set it serves the installed app's user
/// root. So an argument it did not know used to be IGNORED and the daemon booted: a lane's `field-native --help`
/// once ran 10 s against a person's own data dir. Every launcher passes either nothing (fieldd's `bin.ts`, the
/// suites' harnesses) or `--version` (the launch check). CP-1a adds one subcommand, `door`, which is no daemon: it
/// reads no environment and touches no data dir (`door_bridge`).
const USAGE: &str = "\
usage: field-native [--version | --help]
       field-native door --endpoint <path>

VibeField's native plane. It takes no other argument: it is configured by its
environment, and with none set it serves this user's installed VibeField data.
`door` is the MCP stdio bridge a spark's agent runs to the floor's door.
  FIELD_NATIVE_DATA_DIR                 the user root it serves
  FIELD_LOG_DIR                         its log root (honored only with
  FIELD_NATIVE_ALLOW_LOG_DIR_OVERRIDE=1)
";

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // BP-1b (2026-10-26) — the release's launch check (the stage's verify, the build job): `--version` says the name
    // and version and exits before anything else. dyld resolves every load command before `main`, so a binary whose
    // libraries cannot load fails here, loudly, instead of at its first boot on someone else's Mac (the package's
    // field-native once linked Homebrew's harfbuzz; LANDED "BP-1b").
    // Item 64: `--help` prints the usage and exits 0; any other argument is refused, exit 2, before any config is
    // read or any file touched. Only a bare invocation boots.
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Some(arg) = args.first() {
        match arg.as_str() {
            // CP-1a — the bridge, before any config: it reads none. It exits through `process::exit`, because tokio's
            // stdin is a blocking read the runtime's shutdown would wait on until the agent wrote another line.
            "door" => std::process::exit(field_native::door_bridge::main(&args[1..]).await),
            "--version" => println!("field-native {}", env!("CARGO_PKG_VERSION")),
            "--help" | "-h" => print!("{USAGE}"),
            other => {
                eprint!("field-native: unknown argument: {other}\n\n{USAGE}");
                std::process::exit(2);
            }
        }
        return Ok(());
    }
    let config = NativeConfig::from_env()?;
    let boot_id = new_boot_id();
    let logging = NativeLogging::install(&config, &boot_id)?;
    install_panic_hook(logging.clone());
    // TC-D6(a): before any listener binds, and after the subscriber exists so
    // the before/after numbers are actually recorded. A process launched by
    // launchd inherits a 256-fd soft limit, which the 24+5N measurement puts
    // one session past at #47 — the rehearsed silent death this raise ends.
    field_native::rlimit::raise_file_limit();
    let running =
        match field_native::bootstrap_with_logging(config, boot_id, Some(logging.clone())).await {
            Ok(running) => running,
            Err(error) => {
                tracing::error!(
                    event = "field_native.lifecycle.bootstrap_failed",
                    component = "bootstrap",
                    error = %error,
                    fatal = true,
                    "field-native bootstrap failed"
                );
                let _ = logging.close(Duration::from_secs(2));
                return Err(error);
            }
        };
    tracing::info!(
        event = "field_native.lifecycle.ready",
        component = "bootstrap",
        endpoint = %running.mgmt_endpoint,
        boot_id = %running.boot_id,
        "field-native ready"
    );
    let state = running.state.clone();
    shutdown_signal(state.restart.shutdown_requested()).await?;
    running.shutdown().await;
    Ok(())
}

/// Every way this floor is asked to stop, each landing on the ONE drain (`RunningDaemon::shutdown`).
///
/// The third arm, `requested`, is WP12 L2b's `native.lifecycle.shutdown` (`build-wp12-updater.md` §9 R2): the paired
/// fieldd asks the floor to stop itself for an update the person consented to (or at census zero). It runs exactly
/// what SIGTERM runs — nothing new ends a session: kill-matrix row S2-B and the terminal unit's SIGTERM sweep
/// (`tests/terminal_unit.rs`, `shutdown_sweeps_every_session_within_budget`) pin that this drain ends the cells and their PTYs. A verb rather than a signal because an
/// adopted floor has no pid its fieldd could aim at, and on Windows a signal is a hard kill.
#[cfg(unix)]
async fn shutdown_signal(requested: impl std::future::Future<Output = ()>) -> anyhow::Result<()> {
    use tokio::signal::unix::{signal, SignalKind};

    let mut terminate = signal(SignalKind::terminate())?;
    tokio::select! {
        result = tokio::signal::ctrl_c() => result?,
        _ = terminate.recv() => {}
        () = requested => tracing::info!(
            event = "field_native.lifecycle.shutdown_requested",
            component = "lifecycle",
            "the paired client asked this floor to stop"
        ),
    }
    Ok(())
}

#[cfg(not(unix))]
async fn shutdown_signal(requested: impl std::future::Future<Output = ()>) -> anyhow::Result<()> {
    tokio::select! {
        result = tokio::signal::ctrl_c() => result?,
        () = requested => tracing::info!(
            event = "field_native.lifecycle.shutdown_requested",
            component = "lifecycle",
            "the paired client asked this floor to stop"
        ),
    }
    Ok(())
}
