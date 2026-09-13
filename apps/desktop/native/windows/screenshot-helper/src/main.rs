mod annotate;
mod capture;
mod chrome;
mod clipboard;
mod d3d;
mod geometry;
mod monitors;
mod overlay;
mod png;
mod protocol;
mod sample;
mod snap;
mod toolbar;

use crate::clipboard::ShotImage;
use crate::overlay::{OverlayOutcome, Smoke};
use crate::protocol::{HelperError, HostBounds, HostErrorCode};
use std::env;
use std::io::{self, Write};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};
use windows::Win32::UI::HiDpi::{
    SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    RegisterHotKey, UnregisterHotKey, MOD_ALT, MOD_NOREPEAT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetMessageW, TranslateMessage, MSG, WM_HOTKEY,
};

enum Command {
    Once,
    Standalone,
    CaptureTest,
    OverlaySmoke(Smoke),
    Help,
}

fn main() {
    let _ = unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };

    match parse_args(env::args().skip(1).collect()) {
        Command::Help => print_usage(),
        Command::CaptureTest => run_capture_test(),
        Command::Once => run_once(None),
        Command::OverlaySmoke(smoke) => run_once(Some(smoke)),
        Command::Standalone => run_standalone(),
    }
}

fn parse_args(args: Vec<String>) -> Command {
    if args.iter().any(|arg| arg == "--help" || arg == "-h") {
        return Command::Help;
    }
    if args.iter().any(|arg| arg == "--capture-test") {
        return Command::CaptureTest;
    }
    if args.iter().any(|arg| arg == "--overlay-smoke") {
        if args.iter().any(|arg| arg == "cancel" || arg == "--cancel") {
            return Command::OverlaySmoke(Smoke::Cancel);
        }
        if args.iter().any(|arg| arg == "snap" || arg == "--snap") {
            return Command::OverlaySmoke(Smoke::Snap);
        }
        return Command::OverlaySmoke(Smoke::Confirm);
    }
    if args.iter().any(|arg| arg == "--standalone") {
        return Command::Standalone;
    }
    Command::Once
}

fn print_usage() {
    let text = "\
field-screenshot-helper — VibeField's native screenshot helper

  field-screenshot-helper.exe --once          Capture immediately (default)
  field-screenshot-helper.exe --standalone    Stay running; Alt+A captures
  field-screenshot-helper.exe --capture-test  Capture displays to %TEMP%, no overlay
  field-screenshot-helper.exe --overlay-smoke [cancel|snap]  Auto confirm/cancel/snap (CI)
  field-screenshot-helper.exe --help          This text

Confirm copies PNG+DIB to the clipboard and prints ONE JSON line (protocol v1) to
stdout; everything else is stderr.
";
    let _ = io::stdout().write_all(text.as_bytes());
    let _ = io::stdout().flush();
}

fn run_capture_test() {
    if let Err(error) = capture_test() {
        protocol::fail(&error);
        std::process::exit(1);
    }
}

fn capture_test() -> Result<(), HelperError> {
    let snapshots = capture::capture_all_displays(true)?;
    let mut first_path = None;
    for snapshot in &snapshots {
        let file_name = format!("vibefield-capture-test-{}.png", snapshot.display_id);
        let path = env::temp_dir().join(file_name);
        crate::png::write_bgra(
            &path,
            snapshot.width,
            snapshot.height,
            &snapshot.pixels_bgra,
        )
        .map_err(HelperError::write_failed)?;
        let path_text = path.to_string_lossy().into_owned();
        let _ = writeln!(
            io::stderr(),
            "wrote {} {}x{} ({})",
            path_text,
            snapshot.width,
            snapshot.height,
            match snapshot.source {
                capture::Source::Wgc => "wgc",
                capture::Source::Dxgi => "dxgi",
                capture::Source::Gdi => "gdi",
                capture::Source::Synthetic => "synthetic",
            }
        );
        if first_path.is_none() {
            first_path = Some(path_text);
        }
    }

    let Some(first) = snapshots.first() else {
        // capture_all_displays answers NoDisplays when nothing was enumerated, so
        // an empty vector here means the capture chain produced nothing.
        return Err(HelperError::capture_failed("no snapshots"));
    };
    protocol::ok(
        first_path.unwrap_or_default(),
        first.width as i32,
        first.height as i32,
        first.scale,
        first.display_id,
        HostBounds {
            x: first.x as f64,
            y: first.y as f64,
            width: first.screen_width as f64,
            height: first.screen_height as f64,
        },
    );
    Ok(())
}

fn run_once(smoke: Option<Smoke>) {
    if let Err(error) = run_session(smoke) {
        protocol::fail(&error);
        std::process::exit(1);
    }
}

fn run_session(smoke: Option<Smoke>) -> Result<(), HelperError> {
    let snapshots = capture::capture_all_displays(smoke.is_some())?;
    // The overlay's failures are window-class, DC and bitmap failures: the capture
    // could not be shown, which the host reads as a failed capture.
    match overlay::run(snapshots, smoke).map_err(HelperError::capture_failed)? {
        OverlayOutcome::Cancelled => {
            protocol::cancel();
            Ok(())
        }
        OverlayOutcome::Confirmed(shot) => {
            let path = clipboard::write(&ShotImage {
                width: shot.width,
                height: shot.height,
                pixels_bgra: shot.pixels_bgra,
            })
            .map_err(HelperError::write_failed)?;
            protocol::ok(
                path.to_string_lossy().into_owned(),
                shot.width as i32,
                shot.height as i32,
                shot.scale,
                shot.display_id,
                shot.bounds,
            );
            Ok(())
        }
    }
}

fn run_standalone() {
    unsafe {
        if RegisterHotKey(None, 1, MOD_ALT | MOD_NOREPEAT, 0x41).is_err() {
            // No hotkey, no way to start a capture in this mode.
            protocol::error(HostErrorCode::CaptureFailed, "could not register Alt+A");
            std::process::exit(1);
        }
    }
    // Stdout carries protocol lines ONLY — a banner there is a protocol violation
    // the host would kill the helper for, so the dev loop's banner is stderr.
    let _ = writeln!(
        io::stderr(),
        "field-screenshot-helper running. Press Alt+A to capture."
    );
    let _ = io::stderr().flush();

    let mut message = MSG::default();
    unsafe {
        while GetMessageW(&mut message, None, 0, 0).as_bool() {
            if message.message == WM_HOTKEY {
                if let Err(error) = run_session(None) {
                    protocol::fail(&error);
                }
                continue;
            }
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        let _ = UnregisterHotKey(None, 1);
    }
}
