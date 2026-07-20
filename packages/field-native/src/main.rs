// field-native — config → pairing → NativeServiceManager → mgmt server → run.
use field_native::config::NativeConfig;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().init();
    let config = NativeConfig::from_env();
    let running = field_native::bootstrap(config).await?;
    tracing::info!(
        socket = %running.mgmt_socket.display(),
        boot_id = %running.boot_id,
        "field-native ready"
    );
    tokio::signal::ctrl_c().await?;
    tracing::info!("SIGINT — stopping");
    running.shutdown().await;
    Ok(())
}
