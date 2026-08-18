//! TC-S2 — the terminal-host cell binary. A thin shell over `cell::run_cell`:
//! parse argv, hand the runtime the seam, exit with the classification the
//! supervisor reads (0 = requested drain; anything else = crash). All policy
//! lives in the library so the lifecycle is testable without this file.

use field_native::cell::{run_cell, CellArgs};
use std::path::PathBuf;
use std::process::ExitCode;

fn parse_args() -> Result<CellArgs, String> {
    let mut control = None;
    let mut frame = None;
    let mut config = None;
    let mut instance = None;
    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        let mut take = |name: &str| args.next().ok_or(format!("{name} wants a value"));
        match flag.as_str() {
            "--control" => control = Some(take("--control")?),
            "--frame" => frame = Some(take("--frame")?),
            "--config" => config = Some(PathBuf::from(take("--config")?)),
            "--instance" => {
                instance = Some(
                    take("--instance")?
                        .parse::<u32>()
                        .map_err(|e| format!("--instance wants a u32: {e}"))?,
                );
            }
            other => return Err(format!("unknown flag: {other}")),
        }
    }
    Ok(CellArgs {
        control: control.ok_or("--control is required")?,
        frame: frame.ok_or("--frame is required")?,
        config: config.ok_or("--config is required")?,
        instance: instance.ok_or("--instance is required")?,
    })
}

fn main() -> ExitCode {
    // Diagnostics belong to stderr — stdout is the two-line protocol
    // (hello, then the exit report) and nothing else may write to it. Plain
    // fmt at INFO (no env-filter feature in this crate's subscriber build;
    // the parent owns real log routing and forwards stderr).
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_max_level(tracing::Level::INFO)
        .init();

    let args = match parse_args() {
        Ok(args) => args,
        Err(error) => {
            eprintln!("field-terminal-host: {error}");
            return ExitCode::from(2);
        }
    };

    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("field-terminal-host: tokio runtime: {error}");
            return ExitCode::from(2);
        }
    };

    match runtime.block_on(run_cell(args)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("field-terminal-host: {error:#}");
            ExitCode::FAILURE
        }
    }
}
