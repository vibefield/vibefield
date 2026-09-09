//! Embeds `app.manifest` (PerMonitorV2 DPI + the Win10/11 supportedOS entry) into
//! the executable.
//!
//! The embedding runs only when the target OS is Windows AND the HOST is Windows.
//! A build script is compiled for the HOST, so `cfg!(target_os = "windows")` here
//! asks "am I running on Windows?" while `CARGO_CFG_TARGET_OS` asks "what am I
//! building for?". winres shells out to the MSVC resource compiler (`rc.exe`),
//! which exists only on a Windows host — without this guard a cross-target
//! `cargo check --target x86_64-pc-windows-msvc` from a Mac dies in winres with
//! `Selected RC path: '/bin\x86\rc.exe'` (measured). That cross-check is the
//! witness this crate has between Windows box rounds (SNAP-D7), so it must pass
//! from any host. A cross-built binary would carry no manifest; only the box
//! build (and packaging) produce a shippable exe.
fn main() {
    println!("cargo:rerun-if-changed=app.manifest");
    if std::env::var("CARGO_CFG_TARGET_OS").ok().as_deref() != Some("windows") {
        return;
    }
    if !cfg!(target_os = "windows") {
        println!("cargo:warning=field-screenshot-helper: manifest embedding skipped (host is not Windows)");
        return;
    }
    let mut res = winres::WindowsResource::new();
    res.set_manifest_file("app.manifest");
    if let Err(error) = res.compile() {
        eprintln!("winres failed: {error}");
        std::process::exit(1);
    }
}
