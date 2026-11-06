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
use std::time::{Duration, Instant};

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

/// The first breath after a failed accept (item 198). Each failure in the same run doubles it.
pub const ACCEPT_BREATH_FIRST: Duration = Duration::from_millis(50);

/// The longest breath a run of failed accepts grows to: a listener that cannot accept for a while still tries once
/// a second.
pub const ACCEPT_BREATH_MOST: Duration = Duration::from_secs(1);

/// A run of failed accepts, as the listener's unit hears of it: the run began with this error, or it ended because
/// an accept succeeded.
#[derive(Debug)]
pub enum AcceptRun<'a> {
    Failing(&'a anyhow::Error),
    Recovered,
}

/// The next connection on `listener`. Item 198: a floor's listener lives as long as its unit, so a failed accept
/// never ends it. The door, the management listener and the MeshData bridge each ended on their first, so one
/// transient EMFILE stopped that listener for the floor's life while its unit still read Up.
///
/// A failure is retried after [`accept_breath`], which grows while the run lasts and starts over at the next
/// success. A run is logged twice: one warn when it begins, and one info when an accept succeeds again, with the
/// count and the span. `on_run` hears the same two moments, so a unit can read Degraded for exactly as long as its
/// listener retries.
pub async fn accept(
    listener: &mut Listener,
    component: &'static str,
    mut on_run: impl FnMut(AcceptRun<'_>),
) -> Stream {
    let mut failures: u32 = 0;
    let mut began: Option<Instant> = None;
    loop {
        match listener.accept().await {
            Ok(stream) => {
                if let Some(began) = began {
                    tracing::info!(
                        event = "field_native.local_ipc.accept_recovered",
                        component,
                        failures,
                        span_ms = began.elapsed().as_millis() as u64,
                        "The listener accepts again after a run of failed accepts"
                    );
                    on_run(AcceptRun::Recovered);
                }
                return stream;
            }
            Err(error) => {
                failures = failures.saturating_add(1);
                if began.is_none() {
                    began = Some(Instant::now());
                    tracing::warn!(
                        event = "field_native.local_ipc.accept_failing",
                        component,
                        error = %error,
                        "An accept failed; the listener retries, breathing longer each time, until one succeeds"
                    );
                    on_run(AcceptRun::Failing(&error));
                }
                tokio::time::sleep(accept_breath(failures)).await;
            }
        }
    }
}

/// The breath after a run's `failures`-th failed accept: [`ACCEPT_BREATH_FIRST`], doubling each time, never past
/// [`ACCEPT_BREATH_MOST`].
pub fn accept_breath(failures: u32) -> Duration {
    let doublings = failures.saturating_sub(1).min(16);
    ACCEPT_BREATH_FIRST
        .saturating_mul(1 << doublings)
        .min(ACCEPT_BREATH_MOST)
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Item 198: a run of failed accepts breathes 50 ms, then twice as long each time, and never past a second.
    #[test]
    fn a_run_of_failed_accepts_breathes_50_ms_doubling_to_one_second() {
        let breaths: Vec<u128> = (1..=8).map(|n| accept_breath(n).as_millis()).collect();
        let want: [u128; 8] = [50, 100, 200, 400, 800, 1_000, 1_000, 1_000];
        assert_eq!(breaths, want);
        // below the first failure and past any run's length, the breath stays inside its bounds
        assert_eq!(accept_breath(0), ACCEPT_BREATH_FIRST);
        assert_eq!(accept_breath(u32::MAX), ACCEPT_BREATH_MOST);
    }
}
