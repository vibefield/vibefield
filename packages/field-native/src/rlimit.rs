//! TC-D6(a) — RLIMIT_NOFILE at daemon start.
//!
//! The absence was REHEARSED, not theorised: field-native costs `24 + 5N` file
//! descriptors at N sessions (measured), so under launchd's 256-fd soft limit
//! session #47 wants 259 and the daemon dies SILENTLY — the plane that is
//! supposed to outlive fieldd is the one that disappears, with no health state
//! and no log line, because the process that would write them can no longer
//! open anything.
//!
//! Raising the soft limit at start is the whole fix: the soft limit is the only
//! half a process may raise for itself, up to the hard limit, and doing it
//! before any listener binds means every later ceiling belongs to the machine
//! rather than to a default nobody chose.
//!
//! A failure here is NOT fatal. A daemon that boots with the limit it was given
//! is the status quo ante — worse than we want, better than refusing to serve —
//! so the raise states what it got and boot continues either way.

/// Test-only sabotage switch: skip the raise so a test can hold the daemon at
/// the low limit it inherited and reproduce the pre-TC-S0 failure class.
///
/// It is `FIELD_`-prefixed, so it rides `registries::ENV_PREFIXES` into
/// ghosttea's strip list and cannot reach an agent PTY. Nothing in production
/// sets it; `tests/resource_governance.rs` is its only caller, and the
/// sabotage arm exists precisely so the real arm can be shown to fail without
/// it.
pub const TEST_NO_RLIMIT_ENV: &str = "FIELD_NATIVE_TEST_NO_RLIMIT";

/// What we ask for: 8192 descriptors is ~1600 sessions at the measured 5/session,
/// which is far past the machine-wide PTY budget (511 on this host) that becomes
/// the real ceiling long before descriptors do. Asking for more would buy nothing
/// a PTY could use.
pub const DESIRED_SOFT: u64 = 8192;

/// The policy, as a pure function so it can be tested without touching the
/// process: the soft limit we should ask for, or `None` when the current one is
/// already at or above what we would request.
///
/// `min(hard, desired)` and never more — a process may raise its soft limit only
/// up to its hard limit, and asking past it fails the whole call rather than
/// clamping.
pub fn target_soft(soft: u64, hard: u64, desired: u64) -> Option<u64> {
    let target = desired.min(hard);
    (target > soft).then_some(target)
}

/// Raise the soft descriptor limit toward `min(hard, DESIRED_SOFT)`, logging
/// before and after. Idempotent, and safe to call when nothing needs raising.
#[cfg(unix)]
pub fn raise_file_limit() {
    if std::env::var(TEST_NO_RLIMIT_ENV).as_deref() == Ok("1") {
        tracing::warn!(
            event = "field_native.rlimit.skipped",
            component = "rlimit",
            reason = TEST_NO_RLIMIT_ENV,
            "The descriptor-limit raise was skipped by a test-only switch"
        );
        return;
    }

    let mut limit = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    // SAFETY: `getrlimit` writes one fully-owned `rlimit` through this pointer
    // and reads nothing else.
    if unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) } != 0 {
        tracing::warn!(
            event = "field_native.rlimit.unreadable",
            component = "rlimit",
            error = %std::io::Error::last_os_error(),
            "The descriptor limit could not be read; booting with whatever this process inherited"
        );
        return;
    }

    // `rlim_t` is `u64` on every unix this daemon builds for, so the limits are
    // read as-is rather than cast through one.
    let soft = limit.rlim_cur;
    let hard = limit.rlim_max;
    let Some(target) = target_soft(soft, hard, DESIRED_SOFT) else {
        tracing::info!(
            event = "field_native.rlimit.sufficient",
            component = "rlimit",
            soft,
            hard,
            desired = DESIRED_SOFT,
            "The inherited descriptor limit already covers the daemon's ceiling"
        );
        return;
    };

    limit.rlim_cur = target as libc::rlim_t;
    // SAFETY: `setrlimit` reads one fully-initialised `rlimit` through this
    // pointer; `target` is `min(hard, …)`, the only range the kernel accepts
    // from an unprivileged process.
    if unsafe { libc::setrlimit(libc::RLIMIT_NOFILE, &limit) } != 0 {
        tracing::warn!(
            event = "field_native.rlimit.refused",
            component = "rlimit",
            soft_before = soft,
            hard,
            requested = target,
            error = %std::io::Error::last_os_error(),
            "The descriptor limit could not be raised; the daemon keeps the limit it inherited"
        );
        return;
    }

    tracing::info!(
        event = "field_native.rlimit.raised",
        component = "rlimit",
        soft_before = soft,
        soft_after = target,
        hard,
        "The descriptor soft limit was raised for the session ceiling"
    );
}

/// Windows has no `RLIMIT_NOFILE`. Handle count is bounded by the desktop heap
/// and paged pool rather than by a per-process descriptor limit a process may
/// raise, so there is nothing to raise here — this is an honest no-op and not a
/// missing port. The fd-pressure health state (`resource_pressure`) is likewise
/// unix-only, and says so at its own definition.
#[cfg(not(unix))]
pub fn raise_file_limit() {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_raise_targets_the_hard_limit_but_never_passes_it() {
        assert_eq!(
            target_soft(256, 1_048_576, DESIRED_SOFT),
            Some(DESIRED_SOFT),
            "launchd's 256 is the rehearsed death case and must be raised to the full ask"
        );
        assert_eq!(
            target_soft(256, 1024, DESIRED_SOFT),
            Some(1024),
            "a hard limit below the ask is the ceiling; asking past it fails the whole call"
        );
        assert_eq!(
            target_soft(DESIRED_SOFT, u64::MAX, DESIRED_SOFT),
            None,
            "a limit already at the ask needs no syscall"
        );
        assert_eq!(
            target_soft(65_536, 1_048_576, DESIRED_SOFT),
            None,
            "a shell-inherited limit ABOVE the ask must never be lowered to it"
        );
        assert_eq!(
            target_soft(256, 256, DESIRED_SOFT),
            None,
            "soft == hard is the end of what an unprivileged process may do"
        );
    }

    /// 24 + 5N fds at N sessions, measured. The point of the raise is that the
    /// number it lands on clears the ceiling the rehearsal found, so state that
    /// as arithmetic rather than as a comment nobody checks.
    #[test]
    fn the_raised_limit_clears_the_rehearsed_death_point() {
        let cost = |sessions: u64| 24 + 5 * sessions;
        assert!(
            cost(47) > 256,
            "the rehearsal: session #47 wants {} fds against launchd's 256",
            cost(47)
        );
        let raised = target_soft(256, u64::MAX, DESIRED_SOFT).expect("256 is raised");
        assert!(
            cost(100) < raised,
            "TC-G6's 100-session envelope wants {} fds and the raise gives {raised}",
            cost(100)
        );
    }
}
