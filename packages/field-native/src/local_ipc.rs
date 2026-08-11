//! WIN-D1 — one local-IPC seam for every channel this daemon binds or dials.
//!
//! The listener half is ghosttea's (`ghosttea::ipc`): `Stream` is a
//! `UnixStream` on unix and a `NamedPipeServer` on windows, where the bind also
//! carries the two protections the flat pipe namespace demands —
//! `first_pipe_instance` (a name someone else already published is refused, the
//! squat guard) and a `CurrentUserOnly` protected DACL (Windows' default pipe
//! DACL grants Everyone and Anonymous read). Reusing the pinned crate instead
//! of re-deriving pipe security is deliberate (EL8: no new dependency, one
//! implementation upstream already tests against live handles).
//!
//! The client half is ours, because upstream leaves dialing to its Node client:
//! unix connects once (the kernel queues); windows must retry `PIPE_BUSY` (one
//! instance serves at a time) and the brief `FILE_NOT_FOUND` while the listener
//! rotates instances — the same contract `openEndpoint` implements in
//! `@vibecook/ghosttea-client`. The loop is unbounded on those two codes on
//! purpose: every caller already wraps the dial in its own deadline, and a
//! second budget here would just be the shorter of two numbers.

use anyhow::Result;
pub use ghosttea::ipc::{remove_stale_endpoint, Listener, Stream};

#[cfg(unix)]
pub type ClientStream = tokio::net::UnixStream;
#[cfg(windows)]
pub type ClientStream = tokio::net::windows::named_pipe::NamedPipeClient;

/// Replace-stale-then-bind, the external-mode law in one place: endpoints are
/// stable across fieldd restarts, so a leftover unix socket node is unlinked
/// (windows reclaims pipe names by itself) and the listener then claims the
/// name. Permissions ride the bind on windows (DACL); unix callers that want a
/// tighter mode than the run directory's set it after this returns.
pub fn bind(endpoint: &str) -> Result<Listener> {
    remove_stale_endpoint(endpoint)?;
    Listener::bind(endpoint)
}

#[cfg(unix)]
pub async fn connect(endpoint: &str) -> std::io::Result<ClientStream> {
    tokio::net::UnixStream::connect(endpoint).await
}

#[cfg(windows)]
pub async fn connect(endpoint: &str) -> std::io::Result<ClientStream> {
    /// The pipe exists but every instance is taken.
    const ERROR_PIPE_BUSY: i32 = 231;
    /// The listener is between instances, so the name is briefly absent.
    const ERROR_FILE_NOT_FOUND: i32 = 2;
    loop {
        match tokio::net::windows::named_pipe::ClientOptions::new().open(endpoint) {
            Ok(client) => return Ok(client),
            Err(error)
                if matches!(
                    error.raw_os_error(),
                    Some(ERROR_PIPE_BUSY) | Some(ERROR_FILE_NOT_FOUND)
                ) => {}
            Err(error) => return Err(error),
        }
        tokio::time::sleep(std::time::Duration::from_millis(5)).await;
    }
}
