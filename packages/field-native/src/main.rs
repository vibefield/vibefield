// field-native — config → pairing → NativeServiceManager → mgmt server → run.
use field_native::config::NativeConfig;
use field_native::logging::{install_panic_hook, new_boot_id, NativeLogging};
use std::time::Duration;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
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
    shutdown_signal().await?;
    running.shutdown().await;
    Ok(())
}

#[cfg(unix)]
async fn shutdown_signal() -> anyhow::Result<()> {
    use tokio::signal::unix::{signal, SignalKind};

    let mut terminate = signal(SignalKind::terminate())?;
    tokio::select! {
        result = tokio::signal::ctrl_c() => result?,
        _ = terminate.recv() => {}
    }
    Ok(())
}

#[cfg(not(unix))]
async fn shutdown_signal() -> anyhow::Result<()> {
    tokio::signal::ctrl_c().await?;
    Ok(())
}
