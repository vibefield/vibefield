//! FW (v0.3 §3, §5.2) — the freeway host binary. A thin shell over `freeway::host::run`: take the
//! floor-held listener off argv, hand the library stdin and stdout, exit 0 on the leash (stdin's
//! EOF) and nonzero when the bootstrap failed. All policy lives in the library, so the lifecycle
//! is testable without this file.

use field_native::freeway::host;
use std::process::ExitCode;

/// The listening socket the floor holds for every host generation of its boot, so a dialer's
/// re-dial waits in its backlog across a host restart (§5.2). It rides an inherited descriptor.
#[cfg(unix)]
fn listener_from_args() -> Result<std::net::TcpListener, String> {
    use std::os::fd::FromRawFd;
    let mut fd = None;
    let mut args = std::env::args().skip(1);
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--listener-fd" => {
                let value = args.next().ok_or("--listener-fd wants a value")?;
                let parsed = value.parse::<i32>();
                fd = Some(parsed.map_err(|e| format!("--listener-fd wants a descriptor: {e}"))?);
            }
            other => return Err(format!("unknown flag: {other}")),
        }
    }
    let fd = fd.ok_or("--listener-fd is required")?;
    // A spawner's mistake reads as one: a descriptor that is not a listening socket is refused
    // before it is adopted, since adopting it would close what this process does not own.
    if !listening(fd) {
        return Err(format!("fd {fd} is not a listening TCP socket"));
    }
    // SAFETY: `fd` is a listening socket the floor handed this process, and nothing else in the
    // process owns it.
    let listener = unsafe { std::net::TcpListener::from_raw_fd(fd) };
    (listener.set_nonblocking(true)).map_err(|e| format!("the listener at fd {fd}: {e}"))?;
    Ok(listener)
}

/// A TCP socket that is not a connection: the floor's listener. macOS cannot read
/// `SO_ACCEPTCONN` back (`getsockopt` answers `ENOPROTOOPT`), so the check is the socket's type,
/// its address family, and the absence of a peer.
#[cfg(unix)]
fn listening(fd: i32) -> bool {
    let mut kind: libc::c_int = 0;
    let mut kind_size = std::mem::size_of::<libc::c_int>() as libc::socklen_t;
    // SAFETY: zeroed is a valid `sockaddr_storage`, and each call below writes at most the size
    // it is given into the buffer it is given.
    let mut address: libc::sockaddr_storage = unsafe { std::mem::zeroed() };
    let storage = std::mem::size_of::<libc::sockaddr_storage>() as libc::socklen_t;
    let (mut named_size, mut peer_size) = (storage, storage);
    let into = (&mut address as *mut libc::sockaddr_storage).cast();
    unsafe {
        let typed = (&mut kind as *mut libc::c_int).cast();
        let stream = libc::getsockopt(fd, libc::SOL_SOCKET, libc::SO_TYPE, typed, &mut kind_size)
            == 0
            && kind == libc::SOCK_STREAM;
        let named = libc::getsockname(fd, into, &mut named_size) == 0
            && matches!(
                address.ss_family as libc::c_int,
                libc::AF_INET | libc::AF_INET6
            );
        let unconnected = libc::getpeername(fd, into, &mut peer_size) == -1
            && std::io::Error::last_os_error().raw_os_error() == Some(libc::ENOTCONN);
        stream && named && unconnected
    }
}

#[cfg(not(unix))]
fn listener_from_args() -> Result<std::net::TcpListener, String> {
    Err(
        "the floor-held listener rides a Unix descriptor; the Windows handle path is not built"
            .into(),
    )
}

/// Item 64's shape (2026-10-26), for the third binary the package ships (F1) — what `--help` prints, and what a refused
/// invocation says beside its error. The floor spawns this binary with `--listener-fd 3` (`services/freeway.rs`, the
/// host's `ChildSpec`); a person never needs to.
const USAGE: &str = "\
usage: field-freeway-host --listener-fd <fd>
       field-freeway-host --version | --help

The freeway host of VibeField's native plane. field-native spawns it on the
listener it holds, hands it its bootstrap on stdin and reads its hello on
stdout; it is not run by hand.
";

fn main() -> ExitCode {
    // BP-1b — the release's launch check (field-native's `main` says why): the name and version, then exit, before the
    // protocol owns stdout. Item 64: `--help` likewise prints the usage and exits 0.
    match std::env::args().nth(1).as_deref() {
        Some("--version") => {
            println!("field-freeway-host {}", env!("CARGO_PKG_VERSION"));
            return ExitCode::SUCCESS;
        }
        Some("--help" | "-h") => {
            print!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        _ => {}
    }
    // Diagnostics belong to stderr: stdout is the hello and the reports, and nothing else.
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_max_level(tracing::Level::INFO)
        .init();
    let listener = match listener_from_args() {
        Ok(listener) => listener,
        Err(error) => {
            eprint!("field-freeway-host: {error}\n\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("field-freeway-host: the runtime did not start: {error}");
            return ExitCode::from(1);
        }
    };
    let served = runtime.block_on(async {
        let listener = tokio::net::TcpListener::from_std(listener)?;
        let stdin = tokio::io::BufReader::new(tokio::io::stdin());
        host::run(
            listener,
            stdin,
            tokio::io::stdout(),
            field_native::tp::unix_ms,
        )
        .await
    });
    match served {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("field-freeway-host: {error:#}");
            ExitCode::from(1)
        }
    }
}
